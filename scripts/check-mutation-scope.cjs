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

const REPORT = path.join(__dirname, '..', 'reports', 'mutation', 'mutation.json');

// Piso de mutantes por archivo. Medido en la línea base; si agregás cobertura,
// SUBÍ el número. Un piso solo puede bajar cuando se BORRÓ código de producción,
// nunca para esconder sobrevivientes: primero se realinea el rango y luego se
// documenta el conteo exacto y la razón de la reducción.
const PISO_MUTANTES = {
    // money.ts entró con el rediseño (formatMoney + los parsers de captura):
    // 60 mutantes, score medido 98.33%. El único sobreviviente es equivalente
    // (`dot === -1 ? cleaned : …` — con dot=-1 la rama else calcula lo mismo).
    'utils/money.ts': 60,
    // calc-laborales.ts bajó de 96 a 88 mutantes en el barrido del motor de
    // nómina, y es una de las bajas legítimas que este guardián contempla: NO se
    // corrió un rango ni se sacó el archivo del alcance, se BORRÓ CÓDIGO. La
    // guarda `aplicaIndemnizacion && anios > 0` de calcLiquidacion tenía la mitad
    // de más (`anios` ya viene acotado a ≥0 y el bloque acumula 0 días solo), así
    // que sus 8 mutantes eran equivalentes por construcción: ninguna aserción
    // podía matarlos. Se reemplazó por `indemnizacionDias > 0`, que sí discrimina
    // —el piso de 1 mes no le toca a quien entra y sale el mismo día— y cuyos
    // mutantes SÍ mueren. Menos mutantes, más score (96.81% → 98.86%).
    'utils/calc-laborales.ts': 88,
    // pricing.ts bajó de 66 a 51 mutantes cuando el contrato de empaque dejó
    // de inferirse por umbral y pasó a requerir `presentation: 'PACK'`
    // explícita. En esa limpieza se borraron guardas redundantes (`x != null`
    // con `x > 0`) y el default string del parámetro, que eran equivalentes:
    // no había aserción honesta que los distinguiera porque cualquier valor
    // distinto de 'PACK' se trata como BASE. Menos mutantes, mayor señal.
    'utils/pricing.ts': 51,
    // margen.ts cubre ganancia bruta real, retiro seguro, efectivo del turno y
    // el ingreso de CUOTA_FIJA: 70/70 mutantes detectados. Los cuatro agregados
    // por el régimen fiscal mueren. El 15% de IVA se construye DENTRO de la función a
    // propósito: como constante de módulo su mutante sobrevivía siempre
    // (se evalúa al importar, antes de que Stryker active el mutante).
    'utils/margen.ts': 70,
    // stockAlert.ts entró con el aviso de existencias del carrito: 110 mutantes,
    // score medido 99.09%. No es dinero, es inventario — pero es la misma clase
    // de número que el dueño verifica a ojo contra la góndola, y un aviso falso
    // se aprende a ignorar. El único sobreviviente es equivalente: la guarda
    // `disponible !== null` de textoAviso es inalcanzable (el estado DESCONOCIDO
    // retorna antes), y existe solo para que TypeScript acepte la comparación.
    // La tolerancia de 1e-6 se construye DENTRO de una función por el mismo
    // motivo que el IVA de margen.ts: como constante de módulo su mutante
    // sobrevivía siempre.
    'utils/stockAlert.ts': 110,
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
    'backend/services/loanMath.ts': 12,
    // DTO público mínimo de tracking: 5/5; descarta notas, GPS y teléfonos.
    'backend/services/pedidoTrackingService.ts': 5,
    // Decimal/huella/conflicto idempotente (39) y restauración exacta de lotes
    // por allocation+bodega (219): 258/258 entre los tres rangos actuales.
    'backend/services/returnService.ts': 258,
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
    // Asientos puros de venta, abonos, compra+PPV y devolución: 177/177, más
    // 7/7 del orden canónico de locks contables. La factura ligada a OC deja
    // Inventario al costo recibido y separa variación favorable/desfavorable
    // en 5.1.3, incluidos bordes CUOTA_FIJA.
    'backend/services/accounting.ts': 184,
};

if (!fs.existsSync(REPORT)) {
    console.error(`❌ No se encontró el reporte de mutación en ${REPORT}.`);
    console.error('   ¿Corrió `stryker run` con el reporter "json" activo?');
    process.exit(1);
}

const report = JSON.parse(fs.readFileSync(REPORT, 'utf-8'));
const archivos = report.files ?? {};
const fallas = [];

for (const [ruta, piso] of Object.entries(PISO_MUTANTES)) {
    // Las claves del reporte pueden venir absolutas o relativas según el entorno.
    const clave = Object.keys(archivos).find((k) => k === ruta || k.endsWith(`/${ruta}`));
    const cantidad = clave ? (archivos[clave].mutants?.length ?? 0) : 0;
    if (cantidad < piso) {
        fallas.push({ ruta, cantidad, piso, ausente: !clave });
    }
}

if (fallas.length > 0) {
    console.error('\n❌ ALCANCE DE MUTACIÓN ROTO — la red de seguridad de dominio perdió cobertura.\n');
    for (const f of fallas) {
        console.error(
            f.ausente
                ? `   · ${f.ruta}: NO aparece en el reporte (¿lo sacaron del array "mutate"?). Se esperaban ≥ ${f.piso} mutantes.`
                : `   · ${f.ruta}: ${f.cantidad} mutantes < ${f.piso} esperados.`
        );
    }
    console.error('\n   Causa más común: un rango de líneas de stryker.config.json quedó desfasado');
    console.error('   porque la función se movió. Revisá que el rango cubra la función completa.');
    console.error('   NO bajes los pisos de scripts/check-mutation-scope.cjs para que esto pase.\n');
    process.exit(1);
}

const total = Object.values(archivos).reduce((s, f) => s + (f.mutants?.length ?? 0), 0);
console.log(`✅ Alcance de mutación intacto: ${total} mutantes sobre ${Object.keys(PISO_MUTANTES).length} módulos puros protegidos.`);
