#!/usr/bin/env node
/**
 * NORTEX — Guardia de ALCANCE de las pruebas de mutación.
 *
 * PROBLEMA QUE RESUELVE (verificado ejecutándolo, no teórico):
 * el `mutate` de stryker.config.json apunta a módulos puros completos y a ciertas
 * funciones de infraestructura por RANGO DE LÍNEAS. Esos rangos se desfasan
 * con cualquier refactor que mueva la
 * función — y Stryker NO avisa:
 *   · Insertar 8 líneas arriba de buildSaleJournalLines dejó el archivo con 7
 *     mutantes en vez de 18 (el `return [...]` con los CINCO códigos de cuenta
 *     quedó sin mutar) y el reporte igual mostró "accounting.ts 100.00%".
 *   · Un rango inválido (`nicaTax.ts:900-950` en un archivo de 509 líneas) da
 *     `score NaN`, y `NaN >= break` se evalúa como que PASA → exit 0.
 * O sea: la red entera puede volverse un no-op silencioso y el CI quedar verde.
 * Sacar un archivo del array `mutate` tiene el mismo efecto y cuesta una línea.
 *
 * Este guardián afirma un PISO de mutantes por archivo protegido: si el conteo
 * baja (rango corrido, archivo removido del alcance, función renombrada), falla
 * ruidosamente con instrucciones. Los pisos SOLO SUBEN, igual que el umbral.
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const REPORT = path.join(__dirname, '..', 'reports', 'mutation', 'mutation.json');

// Piso de mutantes por archivo. Medido en la línea base; si agregás cobertura,
// SUBÍ el número. Un piso solo puede bajar cuando se BORRÓ código de producción,
// nunca para esconder sobrevivientes: primero se realinea el rango y luego se
// documenta el conteo exacto y la razón de la reducción.
const PISO_MUTANTES = {
    // money.ts entró con el rediseño (formatMoney + los parsers de captura).
    // Bajó exactamente de 60 a 56 al borrar el ternario equivalente de
    // sanitizeDecimalInput: con dot=-1 la expresión única de slices ya devuelve
    // `cleaned`. La corrida completa detectó los 56; no se perdió una conducta.
    'utils/money.ts': 56,
    // calc-laborales.ts bajó de 96 a 88 mutantes en el barrido del motor de
    // nómina, y es una de las bajas legítimas que este guardián contempla: NO se
    // corrió un rango ni se sacó el archivo del alcance, se BORRÓ CÓDIGO. La
    // guarda `aplicaIndemnizacion && anios > 0` de calcLiquidacion tenía la mitad
    // de más (`anios` ya viene acotado a ≥0 y el bloque acumula 0 días solo), así
    // que sus 8 mutantes eran equivalentes por construcción: ninguna aserción
    // podía matarlos. Se reemplazó por `indemnizacionDias > 0`, que sí discrimina
    // —el piso de 1 mes no le toca a quien entra y sale el mismo día— y cuyos
    // mutantes SÍ mueren. Menos mutantes, más score (96.81% → 98.86%).
    // La configuración global `Decimal.set` restante también era exactamente el
    // default de decimal.js y corría antes de que perTest atribuyera cobertura.
    // Al borrarla el conteo baja de 88 a 87; los 87 quedan detectados.
    'utils/calc-laborales.ts': 87,
    // pricing.ts bajó de 66 a 51 mutantes cuando el contrato de empaque dejó
    // de inferirse por umbral y pasó a requerir `presentation: 'PACK'`
    // explícita. En esa limpieza se borraron guardas redundantes (`x != null`
    // con `x > 0`) y el default string del parámetro, que eran equivalentes:
    // no había aserción honesta que los distinguiera porque cualquier valor
    // distinto de 'PACK' se trata como BASE. Menos mutantes, mayor señal.
    // La segunda simplificación borró 11 mutantes equivalentes más: el
    // `threshold` que nunca competía con otro tier, su asignación, y la
    // renormalización de `presentation` que ya discriminaba solo 'PACK'. El
    // contrato explícito BASE/PACK no cambia y los 40 restantes quedan detectados.
    'utils/pricing.ts': 40,
    // margen.ts cubre ganancia bruta real, retiro seguro, efectivo del turno y
    // el ingreso de CUOTA_FIJA: 70/70 mutantes detectados. Los cuatro agregados
    // por el régimen fiscal mueren. El 15% de IVA se construye DENTRO de la función a
    // propósito: como constante de módulo su mutante sobrevivía siempre
    // (se evalúa al importar, antes de que Stryker active el mutante).
    'utils/margen.ts': 70,
    // stockAlert.ts entró con el aviso de existencias del carrito. Bajó
    // exactamente de 110 a 106 al reemplazar `disponible !== null &&
    // disponible < 0` por la comparación numérica equivalente: DESCONOCIDO ya
    // retorna antes y `Number(null) < 0` es false. Los 106 quedan detectados.
    // No es dinero, es inventario — pero es la misma clase
    // de número que el dueño verifica a ojo contra la góndola, y un aviso falso
    // se aprende a ignorar.
    // La tolerancia de 1e-6 se construye DENTRO de una función por el mismo
    // motivo que el IVA de margen.ts: como constante de módulo su mutante
    // sobrevivía siempre.
    'utils/stockAlert.ts': 106,
    // cartPersistence.ts creció de 142 a 337 mutantes al incorporar el canal
    // autenticado cotización → POS y sus fronteras de versión, identidad, TTL y
    // máximo de líneas. Los 337/337 quedan detectados: una línea inválida no se
    // cuela por `some`, 500 sigue siendo válido y ninguna identidad/fecha usa
    // coerción de JavaScript. No es dinero, pero defiende que una venta a medias
    // jamás aparezca en otro turno o tenant.
    'utils/cartPersistence.ts': 337,
    // posSearch.ts entró con P0-2 (la grilla dejó de pintar 1,003 tarjetas) y
    // creció con la resolución segura de Enter: 62/62 mutantes detectados. El
    // recorte nunca es silencioso y una búsqueda ambigua jamás adivina producto.
    'utils/posSearch.ts': 62,
    // Alta rápida, compatibilidad de cantidades y clasificación de errores del
    // POS: 221/221. Protege precio/costo/stock, pasos y reintentos idempotentes.
    'utils/posActivation.ts': 221,
    // Efectivo recibido, faltante, vuelto y denominaciones NIO: 99/99.
    'utils/posCash.ts': 99,
    // Foto de recibido/vuelto para ticket inmediato: 23/23.
    'utils/postSalePrintCash.ts': 23,
    // DTO autoritativo de /api/products para POS: conserva cero vendible,
    // normaliza campos legacy y evita que una foto inválida rompa la tarjeta.
    // Corrida dirigida del bloque farmacia: 46/46.
    'utils/posProductMapper.ts': 46,
    // Los seis presets operativos se validan completos, sin fiscalidad/precio:
    // 45/45 mutantes detectados.
    'utils/productFamilyPresets.ts': 45,
    // Dominio exacto de cantidad: 257 mutantes, 99.61%. El único survivor es
    // la construcción exportada de MAX_QUANTITY al importar el módulo, antes
    // de que coverageAnalysis=perTest pueda activar un mutante estático.
    'utils/quantity.ts': 257,
    // Transferencias de bodega reutilizan modo/paso autoritativos: 18/18.
    'utils/stockTransferQuantity.ts': 18,
    // Parser declarativo completo de etiquetas: 370 mutantes, 100.00% (incluye
    // un timeout por hit-limit que Stryker cuenta como detectado).
    'utils/scaleLabels.ts': 370,
    // Conversión autoritativa BASE/PACK y costo unitario: 117/117.
    'utils/purchasePackaging.ts': 117,
    // Serialización pura de filas para el XLSX de reportes medidos: 3/3.
    'utils/measuredReportExport.ts': 3,
    // Núcleo monetario completo de reportes: Decimal/HALF_UP, IVA histórico,
    // netos, utilidad, ticket, redondeo y prorrateo exacto de devoluciones.
    // Corrida dirigida final: 73/73 killed, 0 survived, 0 timeout y
    // 0 NoCoverage (100.00%), sin rangos ni ignores.
    // moneyUsd completo produce exactamente un ArrowFunction con Stryker 9.6.1.
    // Medido killed; el contrato AST también protege su firma y cuerpo completos.
    'backend/lib/shiftCloseReport.ts': 1,
    'backend/lib/reportMoney.ts': 73,
    // Agrupación exacta de cantidades vendidas: 67/67.
    'backend/lib/salesQuantityReport.ts': 67,
    // Saldo recibido aún facturable por producto: 16/16.
    'backend/lib/purchaseOrderAvailability.ts': 16,
    // Redondeo HALF_UP por línea de factura de compra: 21/21. Protege que
    // C$0.10 gravados produzcan C$0.12 liquidables y no un saldo C$0.1150.
    'backend/lib/purchaseMoney.ts': 21,
    // Motor 3-way completo: identidad por PurchaseOrderItem, disponibilidad
    // recibida-asignada, FIFO, tolerancia 18,6, legacy, CASH fail-closed y
    // resolución idempotente. Corrida dirigida: 310/310, 0 NoCoverage; la
    // recarga aislada del módulo también ejecuta sus helpers concisos.
    'backend/lib/procurementMatch.ts': 310,
    // Recepción formal completa: UUID/payload canónico, exactitud 18,4/18,6,
    // lotes, vencimientos y resultado persistido. Dirigida: 269/269.
    'backend/lib/procurementReceipts.ts': 269,
    // Libro puro por lote+bodega y source keys bounded: 165/165.
    'backend/lib/batchWarehouseLedger.ts': 165,
    // Decisión OFF/SHADOW, reconciliación canónica y replay fail-closed:
    // 496/496, incluidos primitivos, arrays, JSON corrupto, orden y duplicados.
    'backend/lib/batchWarehouseReadiness.ts': 496,
    // Transiciones manuales batch/no-batch y comando persistido: 112/112.
    'backend/lib/manualBatchMovements.ts': 112,
    // Fecha civil Managua, piso de expiración y parser estricto: 40/40.
    'backend/lib/managuaBusinessDate.ts': 40,
    // Clasificación y DTO físico/retenido/vendible por vencimiento: 31/31.
    'backend/lib/pharmacyExpiryAlerts.ts': 31,
    // Un mismo producto+lote no puede mezclar dos vencimientos impresos:
    // 41/41, incluidos formatos inválidos y mensajes de conflicto estables.
    'backend/lib/productBatchIdentity.ts': 41,
    // Intención Decimal exacta, payload canónico, hash e idempotencia de
    // cuarentena lote+bodega: 142/142.
    'backend/lib/productBatchHold.ts': 142,
    // Cierre corto de OC con cantidades Decimal exactas e idempotencia: 157/157.
    'backend/lib/purchaseOrderCloseShort.ts': 157,
    // Comando canónico de transferencia multi-bodega: 160/160.
    'backend/lib/stockTransferCommand.ts': 160,
    // Telemetría de rechazo sin barcode crudo: 31/31.
    'backend/lib/scaleLabelTelemetry.ts': 31,
    // Huella canónica del replay offline: 58/58. Incluye identidad económica,
    // versión fiscal observada, mediciones y privacidad (solo SHA-256 del
    // código; nunca código crudo).
    'backend/lib/offlineSaleReplay.ts': 58,
    // Saldo efectivo, Decimal 4dp, plan de abono e idempotencia de CxP:
    // 156/156 mutantes detectados en la corrida dirigida, sin sobrevivientes.
    'backend/lib/supplierPayments.ts': 156,
    // Escape de HTML + CSP con nonce acotado para vistas fiscales: 27/27.
    'backend/lib/htmlSecurity.ts': 27,
    // saleCancellation.ts: las reglas de ANULACIÓN de comprobantes (DGI-5).
    // 73 mutantes, score medido 100.00%. Lo que protege: que anular no cuente
    // dos veces la misma mercadería ni el mismo dinero, y que la reversión use
    // los importes CONGELADOS de la venta y no los de hoy. El único mutante que
    // sobrevivía era el de la constante ESTADO_ANULADA (nivel módulo, se evalúa
    // al importar); se mató aseverando el LITERAL 'VOIDED' en el test, no la
    // constante importada — comparar la constante consigo misma no mata nada.
    'backend/services/saleCancellation.ts': 73,
    // shiftIdentity.ts: quién queda como CAJERO al abrir la caja, ahora que el
    // PIN dejó de ser obligatorio. 68 mutantes, score medido 100.00%. No es
    // dinero, pero decide a nombre de quién queda un faltante del arqueo — y
    // eso es una acusación. Lo que protege: que el PIN, cuando VIENE, gane
    // siempre (un PIN equivocado no puede caer al modo automático y abrir la
    // caja a nombre de otro), y que con dos empleados posibles NO se adivine:
    // se abre sin identidad antes que ponerle el turno a quien quizá ni estaba.
    // Sus dos sobrevivientes iniciales eran el campo `modo` en los caminos de
    // rechazo — los tests miraban `codigo` y `employeeId` pero no `modo`.
    'backend/services/shiftIdentity.ts': 68,
    // Intención explícita de precio desde compras: roles exactos, presencia,
    // Decimal persistible, deduplicación y before/after. Corrida dirigida 68/68.
    'backend/services/purchaseSalePriceService.ts': 68,
    'backend/services/loanMath.ts': 12,
    // DTO público mínimo de tracking: 5/5; descarta notas, GPS y teléfonos.
    'backend/services/pedidoTrackingService.ts': 5,
    // Decimal/huella/conflicto idempotente (39) y restauración exacta de lotes
    // por allocation+bodega (219): 258/258 entre los tres rangos actuales.
    // Resolución de líneas + restauración lote/bodega + huella de idempotencia
    // con expediente aprobado. 260/260 después de distinguir dos aprobaciones
    // y normalizar espacios sin perder identidad.
    'backend/services/returnService.ts': 260,
    'backend/lib/saleCorrections.ts': 51,
    // nicaLabor.ts es el motor de nómina del ERP: lo que de verdad se le paga a un
    // trabajador (planilla, retención de IR, finiquito). Entró sin ninguna red —
    // el 95,59% histórico protegía utils/calc-laborales.ts, que es el ESPEJO
    // público del blog, no esto. Entró con 107 mutantes y score 98.17%. El fix de
    // fechas calendario eliminó dos restas de timestamps duplicadas (antigüedad
    // y aguinaldo) y las concentró en calendarDaysBetween, cuyos 3 mutantes
    // mueren con la regresión de horas/DST. Con los CUATRO rangos realineados el
    // conteo exacto es 106 y el score 98.11%: la baja de un mutante viene de
    // código aritmético borrado, no de una función que haya quedado fuera.
    // Escribir la
    // red destapó tres errores de dinero: el techo cotizable del INSS (derogado
    // por el Decreto 06-2019), un hueco de un centavo entre tramos de la tabla IR
    // que devolvía IR = 0, y un finiquito que imprimía los días sin topar junto a
    // un monto topado. Entra por rangos: las constantes de módulo y
    // calculateLaborLiability (llama `new Date()`) quedan fuera — ver el config.
    'backend/services/nicaLabor.ts': 106,
    'backend/services/nicaTax.ts': 7,
    // Régimen fiscal puro: normalización, conflicto de versión (incluido el
    // cliente legacy tras un cambio) y desglose autoritativo GENERAL/CUOTA_FIJA.
    // 42/42 mutantes detectados.
    'utils/fiscalRegime.ts': 42,
    // sellerReport.ts: fold puro del reporte por vendedor (cuánto vende y
    // cuánto cobra cada quien — el número con el que el dueño paga o reclama).
    // 59 mutantes, score medido 100.00%.
    'backend/services/sellerReport.ts': 59,
    // stripe.ts entra solo por sus dos funciones PURAS de cobro (35-62), no por
    // el cliente de Stripe: 13 mutantes, score medido 100.00%. Protegen el rail
    // que de verdad cobra en Nicaragua — Stripe no soporta el país como
    // comercio, así que el dinero entra por depósito con comprobante y
    // activación a mano. Antes aprobar daba 30 días con cualquier monto
    // reportado y los contaba desde hoy, perdiendo los días de quien renovaba
    // anticipado.
    'backend/services/stripe.ts': 13,
    'backend/services/stockService.ts': 5,
    // PR-01 protege toda la canalización pura de posting: normalización
    // estricta string/Decimal, límites 18,4, balance, orden total y huella.
    // Corrida dirigida: 175/175, sin NoCoverage, ignores ni sobrevivientes.
    'backend/services/journalPosting.ts': 175,
    // Identidad legacy tenant+turno y hash de intención: 9/9.
    'backend/services/legacyShiftCloseService.ts': 9,
    // JSON canónico de cierre (NIO 2dp, USD 4dp, notas normalizadas): 8/8.
    'backend/validation/schemas.ts': 8,
    // Los siete cuerpos previos pasan de 212 a 199 al centralizar selectores
    // de medios de pago (venta -1, abono -6, devolución -6), no por recorte.
    // Movimientos de caja añade 33; corrida dirigida: 232/232 killed.
    // El piso agregado SUBE y los pisos AST de cada función impiden que la
    // ampliación oculte otra función perdida. Evidencia en el runbook de release.
    'backend/services/accounting.ts': 232,
    'backend/lib/paymentAccounts.ts': 11,
    // Reglas cruzadas RETURN/VOID: 50/50 sobre el superRefine autoritativo.
    'backend/validation/saleCorrectionSchemas.ts': 50,
};

// Los totales por archivo no detectan una función perdida si otra crece.
// Cada función exige su declaración COMPLETA en mutate y su propio piso.
// La reducción 212 → 199 anterior a ampliar caja se explica función por función
// en docs/releases/2026-09-04-production-gate.md; no fue un rango truncado.
const FUNCTION_FLOORS = {
    'backend/services/accounting.ts': {
        canonicalJournalAccountLockOrder: 7,
        buildSaleJournalLines: 40,
        buildPaymentJournalLines: 25,
        buildSupplierPaymentJournalLines: 12,
        buildPurchaseJournalLines: 64,
        returnMoney: 10,
        buildReturnJournalLines: 41,
        cashMovementJournalLines: 33,
    },
    'backend/lib/paymentAccounts.ts': { settledPaymentAccount: 11 },
    'backend/validation/schemas.ts': { canonicalizeCloseShiftPayload: 8 },
    'backend/lib/shiftCloseReport.ts': { moneyUsd: 1 },
};

/** Pure checker: fixtures exercise negative cases without reading Stryker's
 * instrumented working copy during its own dry-run. Report positions are
 * one-based; config columns are zero-based and include their endpoint. */
function checkFunctionScopes({ config, report, readSource, floors = FUNCTION_FLOORS }) {
    const failures = [];
    const counts = {};
    const mutate = config.mutate;
    if (!Array.isArray(mutate) || mutate.some((entry) => typeof entry !== 'string' || entry.startsWith('!'))) {
        return { failures: ['mutate debe declarar rangos positivos explícitos, sin exclusiones.'], counts };
    }
    for (const [file, functions] of Object.entries(floors)) {
        const fail = (message) => failures.push(`${file}: ${message}`);
        const keys = Object.keys(report.files ?? {}).filter((key) => key === file || key.endsWith(`/${file}`));
        if (keys.length !== 1) {
            fail('reporte ausente o ambiguo.');
            continue;
        }
        const source = readSource(file);
        const reported = report.files[keys[0]];
        if (reported.source !== source) {
            fail('el reporte no corresponde al código actual; ejecutar de nuevo la mutación.');
            continue;
        }
        const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
        if (ast.parseDiagnostics.length) {
            fail('TypeScript inválido; no se puede demostrar el alcance.');
            continue;
        }
        const lines = ast.getLineStarts();
        const intervals = [];
        for (const entry of mutate) {
            if (entry === file) {
                intervals.push([0, source.length]);
            } else if (entry.startsWith(`${file}:`)) {
                const match = entry.slice(file.length).match(/^:(\d+)(?::(\d+))?-(\d+)(?::(\d+))?$/);
                const first = match && Number(match[1]);
                const last = match && Number(match[3]);
                const firstColumn = Number(match?.[2] ?? 0);
                const lastColumn = match?.[4] === undefined ? undefined : Number(match[4]);
                if (!first || !last || first > last || first > lines.length || last > lines.length) {
                    fail('rango explícito inválido.');
                    continue;
                }
                const start = lines[first - 1] + firstColumn;
                const end = lastColumn === undefined ? (lines[last] ?? source.length) : lines[last - 1] + lastColumn + 1;
                if (start >= end || start >= (lines[first] ?? source.length) || end > (lines[last] ?? source.length)) {
                    fail('columnas del rango fuera de la línea.');
                    continue;
                }
                intervals.push([start, end]);
            }
        }
        intervals.sort((a, b) => a[0] - b[0]);
        const declarations = [];
        for (const statement of ast.statements) {
            if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
                declarations.push({ name: statement.name.text, node: statement, cover: statement });
            } else if (ts.isVariableStatement(statement)) {
                for (const declaration of statement.declarationList.declarations) {
                    if (ts.isIdentifier(declaration.name) && declaration.initializer &&
                        (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))) {
                        declarations.push({ name: declaration.name.text, node: declaration, cover: statement });
                    }
                }
            }
        }
        const reportOffset = (position) => {
            if (!position || !Number.isInteger(position.line) || !Number.isInteger(position.column) ||
                position.line < 1 || position.line > lines.length || position.column < 1) return NaN;
            const offset = lines[position.line - 1] + position.column - 1;
            return offset <= (lines[position.line] ?? source.length) ? offset : NaN;
        };
        const mutants = (reported.mutants ?? []).map((mutant) => ({
            start: reportOffset(mutant.location?.start), end: reportOffset(mutant.location?.end), status: mutant.status,
        }));
        if (mutants.some((mutant) => !Number.isFinite(mutant.start) || !Number.isFinite(mutant.end) || mutant.end <= mutant.start)) {
            fail('ubicación de mutante inválida.');
        }
        for (const [name, floor] of Object.entries(functions)) {
            const matches = declarations.filter((declaration) => declaration.name === name);
            if (matches.length !== 1) {
                fail(`${name}: declaración ausente o duplicada.`);
                continue;
            }
            const start = matches[0].node.getStart(ast);
            const end = matches[0].node.getEnd();
            let coveredUntil = matches[0].cover.getStart(ast);
            for (const [from, to] of intervals) {
                if (from <= coveredUntil && to > coveredUntil) coveredUntil = to;
            }
            if (coveredUntil < matches[0].cover.getEnd()) fail(`${name}: mutate no cubre la declaración completa (firma y cuerpo).`);
            const scoped = mutants.filter((mutant) => mutant.start >= start && mutant.end <= end);
            if (scoped.some((mutant) => mutant.status === 'Ignored' || mutant.status === 'CompileError')) {
                fail(`${name}: contiene mutantes ignorados o no compilables; no acreditan conducta.`);
            }
            const count = scoped.filter((mutant) => mutant.status !== 'Ignored' && mutant.status !== 'CompileError').length;
            counts[`${file}#${name}`] = count;
            if (count < floor) fail(`${name}: ${count} mutantes < piso ${floor}.`);
        }
    }
    return { failures, counts };
}

function main() {
if (!fs.existsSync(REPORT)) {
    console.error(`❌ No se encontró el reporte de mutación en ${REPORT}.`);
    console.error('   ¿Corrió `stryker run` con el reporter "json" activo?');
    process.exit(1);
}

const report = JSON.parse(fs.readFileSync(REPORT, 'utf-8'));
const archivos = report.files ?? {};
const fallas = [];
const functionScopes = checkFunctionScopes({
    config: JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'stryker.config.json'), 'utf-8')),
    report,
    readSource: (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf-8'),
});

for (const [ruta, piso] of Object.entries(PISO_MUTANTES)) {
    // Las claves del reporte pueden venir absolutas o relativas según el entorno.
    const clave = Object.keys(archivos).find((k) => k === ruta || k.endsWith(`/${ruta}`));
    const cantidad = clave ? (archivos[clave].mutants?.length ?? 0) : 0;
    if (cantidad < piso) {
        fallas.push({ ruta, cantidad, piso, ausente: !clave });
    }
}

if (fallas.length > 0 || functionScopes.failures.length > 0) {
    console.error('\n❌ ALCANCE DE MUTACIÓN ROTO — la red de seguridad de dominio perdió cobertura.\n');
    for (const f of fallas) {
        console.error(
            f.ausente
                ? `   · ${f.ruta}: NO aparece en el reporte (¿lo sacaron del array "mutate"?). Se esperaban ≥ ${f.piso} mutantes.`
                : `   · ${f.ruta}: ${f.cantidad} mutantes < ${f.piso} esperados.`
        );
    }
    for (const failure of functionScopes.failures) console.error(`   · ${failure}`);
    console.error('\n   Causa más común: un rango de líneas de stryker.config.json quedó desfasado');
    console.error('   porque la función se movió. Revisá que el rango cubra la función completa.');
    console.error('   NO bajes los pisos de scripts/check-mutation-scope.cjs para que esto pase.\n');
    process.exit(1);
}

const total = Object.values(archivos).reduce((s, f) => s + (f.mutants?.length ?? 0), 0);
console.log(`✅ Alcance de mutación intacto: ${total} mutantes sobre ${Object.keys(PISO_MUTANTES).length} módulos puros protegidos.`);
console.log(`   ${Object.keys(functionScopes.counts).length} funciones con declaración completa y piso individual comprobados por AST.`);
}

module.exports = { checkFunctionScopes, FUNCTION_FLOORS, PISO_MUTANTES };
if (require.main === module) main();
