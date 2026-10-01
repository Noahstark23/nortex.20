/**
 * Corrida anual del aguinaldo (treceavo mes) — Art. 93-95 Ley 185.
 *
 * Extraída de server.ts. Cada colaborador se paga en su PROPIA transacción:
 * fila Aguinaldo + asiento (Debe 2.1.9 / Haber 1.1.1) + AuditLog se confirman
 * juntos o no se confirma nada.
 *
 * H8: antes el asiento era fail-soft (`try { recordAguinaldoPayment } catch {}`)
 * y el pago quedaba PAGADO aunque el mes estuviera cerrado: un pago huérfano,
 * sin contrapartida en el mayor. Ahora, si el asiento falla, la transacción
 * revierte y el colaborador se informa en `fallidos` con su causa.
 */
import Decimal from 'decimal.js';
import prisma from '../lib/prisma';
import { PeriodLockedError, recordAguinaldoPayment } from './accounting';
import { computeAguinaldoAnual } from './nicaLabor';

export interface AguinaldoRunFailure {
    employeeId: string;
    code: 'PERIOD_LOCKED' | 'PAYMENT_FAILED';
    error: string;
}

export interface AguinaldoRunResult {
    pagados: number;
    total: number;
    fallidos: AguinaldoRunFailure[];
}

type AguinaldoRunDb = Pick<typeof prisma, 'employee' | 'aguinaldo' | '$transaction'>;

export async function runAguinaldoForYear(params: {
    tenantId: string;
    userId: string;
    year: number;
    today: Date;
    db?: AguinaldoRunDb;
    postPayment?: typeof recordAguinaldoPayment;
}): Promise<AguinaldoRunResult> {
    const { tenantId, userId, year, today } = params;
    const db = params.db ?? prisma;
    const postPayment = params.postPayment ?? recordAguinaldoPayment;

    const employees = await db.employee.findMany({ where: { tenantId, status: 'ACTIVE' } });
    const existing = await db.aguinaldo.findMany({ where: { tenantId, year }, select: { employeeId: true } });
    const alreadyPaid = new Set(existing.map(a => a.employeeId));

    let pagados = 0;
    let total = new Decimal(0);
    const fallidos: AguinaldoRunFailure[] = [];
    for (const emp of employees) {
        if (alreadyPaid.has(emp.id)) continue; // ya tiene aguinaldo este año
        const base = new Decimal(emp.baseSalary.toString());
        const { dias, monto } = computeAguinaldoAnual(base, new Date(emp.hireDate), year, today);
        if (monto <= 0) continue;
        try {
            await db.$transaction(async (tx: any) => {
                const ag = await tx.aguinaldo.create({
                    data: { tenantId, employeeId: emp.id, year, diasLaborados: dias, baseSalary: base.toNumber(), monto, status: 'PAGADO' },
                });
                // Exento de INSS/IR: Debe Aguinaldo por Pagar / Haber Caja.
                // Sin try/catch: un asiento rechazado revierte también el pago.
                await postPayment(tx, tenantId, userId, ag.id, monto);
                await tx.auditLog.create({
                    data: {
                        tenantId,
                        userId,
                        action: 'AGUINALDO_PAID',
                        details: JSON.stringify({
                            aguinaldoId: ag.id,
                            employeeId: emp.id,
                            year,
                            diasLaborados: dias,
                            baseSalary: base.toFixed(2),
                            monto,
                            timestamp: new Date().toISOString(),
                        }),
                    },
                });
            });
            pagados++;
            total = total.plus(monto);
        } catch (e: any) {
            if (e?.code === 'P2002') continue; // carrera: ya pagado
            if (e instanceof PeriodLockedError) {
                fallidos.push({ employeeId: emp.id, code: 'PERIOD_LOCKED', error: e.message });
                continue;
            }
            console.error('Aguinaldo empleado error:', e);
            fallidos.push({ employeeId: emp.id, code: 'PAYMENT_FAILED', error: 'No se pudo registrar el pago con su asiento.' });
        }
    }

    return { pagados, total: total.toDecimalPlaces(2).toNumber(), fallidos };
}
