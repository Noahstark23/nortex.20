/**
 * NORTEX — Activos Fijos & Depreciación (FASE B parte 2, Ley 822)
 *
 * Método de LÍNEA RECTA: cuota mensual = costo / vidaUtilMeses.
 * El corrido mensual es IDEMPOTENTE por dos vías:
 *   - DepreciationEntry @@unique([assetId, year, month]) (idempotencia dura).
 *   - FixedAsset.ultimoPeriodoDep (corte rápido sin tocar la tabla).
 * Cada cuota postea un asiento (Debe 5.2.5 Depreciación / Haber 1.2.2
 * Depreciación Acumulada) que RESPETA el bloqueo de períodos de la Fase A.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { createJournalEntry, PeriodLockedError } from './accounting';

const prisma = new PrismaClient();

// Vida útil por categoría (meses) — defaults Ley 822 línea recta, editables.
export const VIDA_UTIL_DEFAULT: Record<string, number> = {
    EDIFICIO: 240,   // 20 años (5%)
    VEHICULO: 60,    // 5 años (20%)
    MAQUINARIA: 120, // 10 años (10%)
    MOBILIARIO: 60,  // 5 años (20%)
    COMPUTO: 24,     // 2 años (50%)
    OTRO: 60,
};

const periodKey = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`;
/** Último día del mes (la cuota se fecha ahí → cae en el período correcto). */
const endOfMonth = (y: number, m: number) => new Date(y, m, 0, 23, 59, 59);

// E3 — tope de cuotas de catch-up por activo POR CORRIDO: acota la duración de
// la request/cron (cada cuota es una tx). Si un activo debe más meses, el
// siguiente corrido continúa donde quedó (el avance persiste en mesesDepreciados).
const MAX_CUOTAS_POR_CORRIDO = 60;

/** Mes N-ésimo (0-based) desde la adquisición → {year, month}. El mes de
 *  adquisición cuenta como la primera cuota (offset 0), igual que siempre. */
function periodoDesdeAdquisicion(fechaAdquisicion: Date, offset: number): { year: number; month: number } {
    // @db.Date llega como medianoche UTC → accesores UTC para no correrse un
    // día (y por lo tanto un mes) según la zona horaria del server.
    const base = fechaAdquisicion.getUTCFullYear() * 12 + fechaAdquisicion.getUTCMonth() + offset;
    return { year: Math.floor(base / 12), month: (base % 12) + 1 };
}

export interface DepreciationRunResult {
    period: string;
    depreciados: number;
    omitidos: number;
    montoTotal: number;
    detalles: { asset: string; amount: number; motivo?: string }[];
}

/**
 * Corre la depreciación de un tenant HASTA el período (year, month) inclusive.
 *
 * E3 — catch-up: antes solo se posteaba el período pedido; si el cron se caía
 * un mes (deploy, server abajo) o el activo se registraba con fecha de
 * adquisición vieja, esos meses quedaban SIN cuota para siempre (gasto
 * subestimado y PP&E sobrevaluado). Ahora cada activo postea TODAS sus cuotas
 * pendientes desde donde quedó (mesesDepreciados) hasta el período objetivo,
 * cada una fechada en su mes histórico (el P&L de cada mes recibe SU gasto).
 * Si un mes histórico ya está CERRADO fiscalmente, la cuota se postea con
 * fecha ACTUAL marcada como extemporánea (la idempotencia por
 * DepreciationEntry conserva el período que cubre) — así el libro queda
 * completo sin violar el bloqueo de períodos.
 *
 * E5 — última cuota = TODO el restante: `costo/vidaUtil` redondeado a 2dp deja
 * residuo (p. ej. 100/36 → 2.78×36 = 100.08, o 33.33×3 = 99.99). Antes solo se
 * recortaba hacia abajo (min(cuota, restante)): si el residuo era positivo, el
 * activo quedaba con centavos de valor en libros ETERNOS (mesesDepreciados
 * llegaba a vidaUtil y nunca más se corría). Ahora la última cuota absorbe el
 * residuo en ambos sentidos → valor en libros termina exactamente en 0.
 *
 * Atómico por cuota: si una falla (carrera P2002), se omite y se sigue.
 */
export async function runDepreciationForTenant(tenantId: string, year: number, month: number, userId = 'SYSTEM'): Promise<DepreciationRunResult> {
    const period = periodKey(year, month);
    const cutoff = endOfMonth(year, month);
    const targetIndex = year * 12 + (month - 1); // mes objetivo en meses absolutos

    const assets = await prisma.fixedAsset.findMany({
        where: {
            tenantId,
            estado: 'ACTIVO',
            fechaAdquisicion: { lte: cutoff },
        },
    });

    const detalles: DepreciationRunResult['detalles'] = [];
    let depreciados = 0, omitidos = 0;
    let montoTotal = new Decimal(0);

    for (const a of assets) {
        if (a.mesesDepreciados >= a.vidaUtilMeses) { omitidos++; continue; }

        // Cuotas que el activo DEBERÍA tener posteadas al período objetivo:
        // meses transcurridos desde la adquisición (inclusive), topado a la vida útil.
        const acqIndex = a.fechaAdquisicion.getUTCFullYear() * 12 + a.fechaAdquisicion.getUTCMonth();
        const transcurridos = targetIndex - acqIndex + 1;
        const esperadas = Math.min(a.vidaUtilMeses, Math.max(0, transcurridos));
        let pendientes = esperadas - a.mesesDepreciados;
        if (pendientes <= 0) { omitidos++; continue; }

        const catchupRecortado = pendientes > MAX_CUOTAS_POR_CORRIDO;
        if (catchupRecortado) pendientes = MAX_CUOTAS_POR_CORRIDO;

        const costo = new Decimal(a.costo.toString());
        const cuotaPlena = costo.dividedBy(a.vidaUtilMeses).toDecimalPlaces(2);

        // Estado vivo del activo a lo largo del catch-up (persiste por tx).
        let meses = a.mesesDepreciados;
        let acum = new Decimal(a.depreciacionAcumulada.toString());
        let posteadas = 0;
        let montoActivo = new Decimal(0);

        for (let i = 0; i < pendientes; i++) {
            const { year: hy, month: hm } = periodoDesdeAdquisicion(a.fechaAdquisicion, meses);
            const histPeriod = periodKey(hy, hm);
            const restante = costo.minus(acum);
            // E5: en la ÚLTIMA cuota de la vida útil va TODO el restante (absorbe
            // el residuo de redondeo en ambos sentidos → valor en libros = 0).
            const esUltima = meses === a.vidaUtilMeses - 1;
            const cuota = (esUltima ? restante : Decimal.min(cuotaPlena, restante)).toDecimalPlaces(2);
            if (cuota.lessThanOrEqualTo(0)) break; // ya sin valor que depreciar

            const postear = (fecha: Date, extemporanea: boolean) =>
                prisma.$transaction(async (tx) => {
                    // Idempotencia dura: si ya existe la cuota del período, P2002 aborta.
                    await tx.depreciationEntry.create({
                        data: { assetId: a.id, tenantId, year: hy, month: hm, amount: cuota.toNumber() },
                    });
                    await createJournalEntry(
                        tx as Parameters<typeof createJournalEntry>[0],
                        tenantId,
                        extemporanea
                            ? `Depreciación ${histPeriod} — ${a.nombre} (extemporánea: período cerrado)`
                            : `Depreciación ${histPeriod} — ${a.nombre}`,
                        a.id, 'DEPRECIATION', userId,
                        [
                            { accountCode: '5.2.5', debit: cuota.toNumber(), credit: 0 },
                            { accountCode: '1.2.2', debit: 0, credit: cuota.toNumber() },
                        ],
                        { isAutomatic: true, date: fecha }
                    );
                    await tx.fixedAsset.update({
                        where: { id: a.id },
                        data: {
                            depreciacionAcumulada: { increment: cuota.toNumber() },
                            mesesDepreciados: { increment: 1 },
                            ultimoPeriodoDep: histPeriod,
                        },
                    });
                });

            try {
                try {
                    await postear(endOfMonth(hy, hm), false);
                } catch (err) {
                    if (err instanceof PeriodLockedError) {
                        // Mes histórico cerrado → la cuota entra HOY como extemporánea
                        // (el período que cubre queda en DepreciationEntry y en la glosa).
                        await postear(new Date(), true);
                    } else {
                        throw err;
                    }
                }
                meses++;
                acum = acum.plus(cuota);
                posteadas++;
                montoActivo = montoActivo.plus(cuota);
            } catch (err) {
                if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
                    // Cuota del período ya existe (carrera con otro corrido) —
                    // el estado en BD avanzó por el otro lado: cortar este activo.
                    omitidos++;
                    break;
                }
                if (err instanceof PeriodLockedError) {
                    // El período ACTUAL también está cerrado (el retry extemporáneo
                    // tampoco pudo entrar) → cortar este activo, no abortar el lote.
                    // Lo ya posteado se reporta abajo; si no posteó nada, se anota.
                    if (posteadas === 0) {
                        omitidos++;
                        detalles.push({ asset: a.nombre, amount: 0, motivo: 'período cerrado' });
                    }
                    break;
                }
                throw err;
            }
        }

        if (posteadas > 0) {
            depreciados += posteadas;
            montoTotal = montoTotal.plus(montoActivo);
            detalles.push({
                asset: a.nombre,
                amount: montoActivo.toNumber(),
                ...(catchupRecortado ? { motivo: `catch-up parcial (${posteadas} cuotas; corré de nuevo para continuar)` } : posteadas > 1 ? { motivo: `${posteadas} cuotas (catch-up)` } : {}),
            });
        } else {
            omitidos++;
        }
    }

    return { period, depreciados, omitidos, montoTotal: montoTotal.toNumber(), detalles };
}

/** Corrido para TODOS los tenants del mes actual (lo llama el cron). */
export async function runMonthlyDepreciationAllTenants(): Promise<void> {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const tenantsConActivos = await prisma.fixedAsset.findMany({
        where: { estado: 'ACTIVO' },
        select: { tenantId: true },
        distinct: ['tenantId'],
    });
    let total = 0;
    for (const t of tenantsConActivos) {
        try {
            const r = await runDepreciationForTenant(t.tenantId, year, month);
            total += r.depreciados;
        } catch (err) {
            console.error(`⚠️ Depreciación falló para tenant ${t.tenantId}:`, err);
        }
    }
    if (total > 0) console.log(`🏭 Depreciación ${periodKey(year, month)}: ${total} cuotas posteadas.`);
}
