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
    'utils/calc-laborales.ts': 96,
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
    'backend/services/nicaTax.ts': 7,
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
