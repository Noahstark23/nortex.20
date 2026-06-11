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

export interface DepreciationRunResult {
    period: string;
    depreciados: number;
    omitidos: number;
    montoTotal: number;
    detalles: { asset: string; amount: number; motivo?: string }[];
}

/**
 * Corre la depreciación de UN período para un tenant. Solo activos ACTIVOS,
 * adquiridos a más tardar ese mes, no totalmente depreciados y no corridos aún
 * en ese período. Atómico por activo: si el período está cerrado, omite ese
 * activo (no aborta todo el lote).
 */
export async function runDepreciationForTenant(tenantId: string, year: number, month: number, userId = 'SYSTEM'): Promise<DepreciationRunResult> {
    const period = periodKey(year, month);
    const cutoff = endOfMonth(year, month);

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
        if (a.ultimoPeriodoDep === period) { omitidos++; continue; }
        if (a.mesesDepreciados >= a.vidaUtilMeses) { omitidos++; continue; }

        const costo = new Decimal(a.costo.toString());
        const acum = new Decimal(a.depreciacionAcumulada.toString());
        const cuotaPlena = costo.dividedBy(a.vidaUtilMeses).toDecimalPlaces(2);
        const restante = costo.minus(acum);
        // Último mes: ajusta para no sobre-depreciar (cuota = lo que queda).
        const cuota = Decimal.min(cuotaPlena, restante).toDecimalPlaces(2);
        if (cuota.lessThanOrEqualTo(0)) { omitidos++; continue; }

        try {
            await prisma.$transaction(async (tx) => {
                // Idempotencia dura: si ya existe la cuota del período, P2002 aborta.
                await tx.depreciationEntry.create({
                    data: { assetId: a.id, tenantId, year, month, amount: cuota.toNumber() },
                });
                await createJournalEntry(
                    tx as Parameters<typeof createJournalEntry>[0],
                    tenantId,
                    `Depreciación ${period} — ${a.nombre}`,
                    a.id, 'DEPRECIATION', userId,
                    [
                        { accountCode: '5.2.5', debit: cuota.toNumber(), credit: 0 },
                        { accountCode: '1.2.2', debit: 0, credit: cuota.toNumber() },
                    ],
                    { isAutomatic: true, date: cutoff }
                );
                await tx.fixedAsset.update({
                    where: { id: a.id },
                    data: {
                        depreciacionAcumulada: { increment: cuota.toNumber() },
                        mesesDepreciados: { increment: 1 },
                        ultimoPeriodoDep: period,
                    },
                });
            });
            depreciados++;
            montoTotal = montoTotal.plus(cuota);
            detalles.push({ asset: a.nombre, amount: cuota.toNumber() });
        } catch (err) {
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
                omitidos++; // ya depreciado este período (carrera) — idempotente
            } else if (err instanceof PeriodLockedError) {
                omitidos++;
                detalles.push({ asset: a.nombre, amount: 0, motivo: 'período cerrado' });
            } else {
                throw err;
            }
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
