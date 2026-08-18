#!/usr/bin/env node
/**
 * NORTEX — Guardia de ALCANCE de las pruebas de mutación.
 *
 * PROBLEMA QUE RESUELVE (verificado ejecutándolo, no teórico):
 * el `mutate` de stryker.config.json apunta a las funciones puras de dinero por
 * RANGO DE LÍNEAS. Esos rangos se desfasan con cualquier refactor que mueva la
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
// SUBÍ el número (nunca lo bajes para que pase un PR — eso es el juego que esto
// viene a prevenir; si un refactor legítimo reduce mutantes, ajustá el rango del
// config primero y recién ahí revisá este piso, explicando el porqué en el PR).
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
    'utils/pricing.ts': 66,
    // margen.ts entró con NX-01/02/03 (ganancia bruta real, retiro seguro y
    // efectivo del turno): 66 mutantes, score medido 100.00% — sin
    // sobrevivientes. El 15% de IVA se construye DENTRO de la función a
    // propósito: como constante de módulo su mutante sobrevivía siempre
    // (se evalúa al importar, antes de que Stryker active el mutante).
    'utils/margen.ts': 66,
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
    // cartPersistence.ts entró con P0-1 (el carrito sobrevive a la navegación):
    // 142 mutantes, score medido 100.00% — sin sobrevivientes. No es dinero,
    // pero defiende un invariante que SÍ lo es: una venta a medias jamás se
    // restaura en un turno que no es el suyo, porque eso descuadra el arqueo de
    // otro. La ventana de 12 h se construye dentro de una función por el mismo
    // motivo que el IVA de margen.ts.
    'utils/cartPersistence.ts': 142,
    // posSearch.ts entró con P0-2 (la grilla dejó de pintar 1,003 tarjetas):
    // 46 mutantes, score medido 100.00%. Lo que protege es que el recorte NUNCA
    // se haga en silencio (visibles + ocultos == total) y que el SKU exacto —el
    // camino del escáner— le siga ganando a cualquier coincidencia parcial.
    'utils/posSearch.ts': 46,
    'backend/services/loanMath.ts': 12,
    // nicaLabor.ts es el motor de nómina del ERP: lo que de verdad se le paga a un
    // trabajador (planilla, retención de IR, finiquito). Entró sin ninguna red —
    // el 95,59% histórico protegía utils/calc-laborales.ts, que es el ESPEJO
    // público del blog, no esto. 107 mutantes, score medido 98.17%. Escribir la
    // red destapó tres errores de dinero: el techo cotizable del INSS (derogado
    // por el Decreto 06-2019), un hueco de un centavo entre tramos de la tabla IR
    // que devolvía IR = 0, y un finiquito que imprimía los días sin topar junto a
    // un monto topado. Entra por rangos: las constantes de módulo y
    // calculateLaborLiability (llama `new Date()`) quedan fuera — ver el config.
    'backend/services/nicaLabor.ts': 107,
    'backend/services/nicaTax.ts': 7,
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
    'backend/services/accounting.ts': 18,
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
    console.error('\n❌ ALCANCE DE MUTACIÓN ROTO — la red de seguridad de dinero perdió cobertura.\n');
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
console.log(`✅ Alcance de mutación intacto: ${total} mutantes sobre ${Object.keys(PISO_MUTANTES).length} módulos de dinero protegidos.`);
