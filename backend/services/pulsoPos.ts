/**
 * NORTEX — Pulso del día del POS (gamificación honesta).
 *
 * El "juego" que le importa a un dueño de pulpería no son puntos ni medallas:
 * es VER su plata del día crecer. Este módulo calcula, a partir de los días de
 * venta reales, las tres mecánicas que hacen que cobrar tenga gancho:
 *
 *  - RACHA: días consecutivos vendiendo (terminando hoy, o ayer si hoy aún no
 *    hay venta — "vendé hoy para no cortarla").
 *  - META DIARIA automática: el promedio de los últimos días con venta,
 *    redondeado HACIA ARRIBA a múltiplo de C$50 — la meta de hoy es superar tu
 *    propio promedio, no un número inventado.
 *  - RÉCORD: el mejor día de la ventana (sin contar hoy), para poder celebrar
 *    "¡hoy es tu mejor día!" cuando de verdad lo es.
 *
 * PURO a propósito (sin Prisma): la agrupación por día la hace la BD y esto
 * solo pliega — así los casos borde (racha cortada, meta con poca historia,
 * récord empatado) quedan fijados por tests.
 */
import Decimal from 'decimal.js';

// Managua es UTC-6 fijo (Nicaragua no observa DST). Mismo valor que
// nicaTax.MANAGUA_UTC_OFFSET_HOURS — duplicado acá a propósito: nicaTax
// instancia PrismaClient a nivel módulo y este archivo debe seguir puro.
export const MANAGUA_UTC_OFFSET_HOURS = 6;

/** Clave YYYY-MM-DD del día calendario de Managua para un instante dado. */
export function claveDelDiaManagua(ahora: Date): string {
    return new Date(ahora.getTime() - MANAGUA_UTC_OFFSET_HOURS * 3_600_000).toISOString().slice(0, 10);
}

/** Instante UTC en que empieza el día de Managua que contiene `ahora`. */
export function inicioDelDiaManagua(ahora: Date): Date {
    return new Date(`${claveDelDiaManagua(ahora)}T${String(MANAGUA_UTC_OFFSET_HOURS).padStart(2, '0')}:00:00Z`);
}

export interface DiaDeVentas {
    dia: string;               // YYYY-MM-DD (día calendario de Managua)
    total: Decimal.Value;      // Σ ventas del día
    ventas: number;            // conteo de ventas del día
}

export interface PulsoCalculado {
    racha: number;             // días consecutivos con venta
    rachaIncluyeHoy: boolean;  // false = la racha termina ayer (hoy aún sin venta)
    metaDiaria: string | null; // 2dp; null con menos de 3 días de historia
    record: string | null;     // mejor día de la ventana SIN contar hoy; 2dp
    esRecordHoy: boolean;      // hoy ya superó ese récord
}

const ESCALON_META = new Decimal(50);   // la meta se redondea a billete de C$50
const MIN_DIAS_HISTORIA = 3;            // sin historia no hay meta ni récord honestos
const DIAS_PROMEDIO_META = 7;           // promedio de los últimos 7 días CON venta

function diaAnterior(dia: string): string {
    const d = new Date(`${dia}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
}

export function calcularPulso(dias: DiaDeVentas[], hoy: string): PulsoCalculado {
    const porDia = new Map<string, Decimal>();
    for (const d of dias) {
        if (d.ventas > 0) porDia.set(d.dia, new Decimal(d.total.toString()));
    }

    // ── Racha: caminar hacia atrás desde hoy (o desde ayer si hoy está vacío).
    const rachaIncluyeHoy = porDia.has(hoy);
    let cursor = rachaIncluyeHoy ? hoy : diaAnterior(hoy);
    let racha = 0;
    while (porDia.has(cursor)) {
        racha++;
        cursor = diaAnterior(cursor);
    }

    // ── Historia previa (solo días ANTERIORES a hoy, más recientes primero).
    const previos = dias
        .filter(d => d.ventas > 0 && d.dia < hoy)
        .sort((a, b) => (a.dia < b.dia ? 1 : -1));

    if (previos.length < MIN_DIAS_HISTORIA) {
        // El día 1 no se le pone meta ni se le grita "récord" por su única venta.
        return { racha, rachaIncluyeHoy, metaDiaria: null, record: null, esRecordHoy: false };
    }

    // ── Meta: promedio de los últimos N días con venta, redondeado ARRIBA a C$50.
    const muestra = previos.slice(0, DIAS_PROMEDIO_META);
    const promedio = muestra
        .reduce((s, d) => s.plus(d.total.toString()), new Decimal(0))
        .div(muestra.length);
    const metaDiaria = promedio.div(ESCALON_META).ceil().mul(ESCALON_META).toFixed(2);

    // ── Récord: el mejor día previo. Superarlo (estricto: empatar no es romper).
    const record = previos.reduce(
        (max, d) => Decimal.max(max, new Decimal(d.total.toString())),
        new Decimal(0)
    );
    const totalHoy = porDia.get(hoy) ?? new Decimal(0);
    return {
        racha,
        rachaIncluyeHoy,
        metaDiaria,
        record: record.toFixed(2),
        esRecordHoy: totalHoy.greaterThan(record),
    };
}
