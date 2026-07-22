/**
 * 🏦 AGENTE BANCARIO (corresponsalía no bancaria) — Fase A
 *
 * El negocio (ferretería/pulpería/farmacia) opera como Agente Banpro / Rapibac /
 * ServiRED / punto Puntoxpress. La transacción bancaria real pasa por el
 * dispositivo del banco; Nortex la registra EN PARALELO para cuadrar la caja:
 * cada operación genera un CashMovement firmado (category AGENTE_BANCARIO,
 * entra al arqueo y al libro encadenado sin tocar su fórmula) + una
 * AgentTransaction con el detalle (convenio, operación, comisión, voucher).
 *
 * Principios (ver docs/PLAN_AGENTE_BANCARIO.md):
 * - El monto principal NO es ingreso: va a la cuenta puente 2.1.12
 *   "Corresponsalía Bancaria por Liquidar". Solo la comisión es ingreso (4.1.4),
 *   devengada contra 1.1.7 "Comisiones por Cobrar Corresponsalía".
 * - Dos saldos espejo: efectivo en gaveta ↔ settlementBalance del convenio.
 * - El tope real de retiro lo pone la gaveta → guarda anti-sobregiro bajo
 *   FOR UPDATE (mismo patrón que /api/cash-movements, con backticks MySQL).
 */
import express from 'express';
import Decimal from 'decimal.js';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { checkRole } from '../middleware/checkRole';
import { appendSignedCashMovement } from '../services/ledger';
import { recordAgentTransaction, seedChartOfAccounts } from '../services/accounting';
import {
    validate,
    CreateAgentAgreementSchema,
    UpdateAgentAgreementSchema,
    CreateAgentTxSchema,
} from '../validation/schemas';

const router = express.Router();

// Configurar convenios = decisión de negocio (contrato con el banco).
const AGENT_MANAGER = checkRole(['OWNER', 'ADMIN']);

// ─────────────────────────────────────────────────────────────────────────────
// REGLA PURA (testeable sin server — QA ronda 2 en .cjs)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dirección del efectivo por operación:
 * IN  = entra efectivo a la gaveta (el negocio queda debiendo al banco).
 * OUT = sale efectivo de la gaveta (el banco queda debiendo al negocio).
 */
export const AGENT_OPERATION_DIRECTION: Record<string, 'IN' | 'OUT'> = {
    DEPOSITO: 'IN',
    PAGO_TARJETA: 'IN',
    PAGO_PRESTAMO: 'IN',
    PAGO_SERVICIO: 'IN',
    RECARGA: 'IN',
    REMESA_ENVIO: 'IN',
    RETIRO: 'OUT',
    REMESA_COBRO: 'OUT',
};

/**
 * Comisión devengada por operación según el contrato del convenio:
 * commissionConfig = { OPERACION: { fija, pct } } (ambos opcionales).
 * Config ausente/corrupta ⇒ 0 (nunca lanza: el registro de caja no puede
 * caerse por una config mala). Redondeo a 4 decimales (Decimal 18,4).
 */
export function calcAgentCommission(config: unknown, operation: string, amount: Decimal): Decimal {
    if (!config || typeof config !== 'object') return new Decimal(0);
    const entry = (config as Record<string, any>)[operation];
    if (!entry || typeof entry !== 'object') return new Decimal(0);
    const fijaNum = Number(entry.fija);
    const pctNum = Number(entry.pct);
    const fija = entry.fija != null && isFinite(fijaNum) && fijaNum > 0 ? new Decimal(fijaNum) : new Decimal(0);
    const pct = entry.pct != null && isFinite(pctNum) && pctNum > 0 ? new Decimal(pctNum) : new Decimal(0);
    return fija.plus(amount.mul(pct).dividedBy(100)).toDecimalPlaces(4);
}

// ─────────────────────────────────────────────────────────────────────────────
// CONVENIOS
// ─────────────────────────────────────────────────────────────────────────────

// Listar convenios del tenant (para el selector del POS).
router.get('/agreements', authenticate, async (req: any, res: any) => {
    try {
        const agreements = await prisma.agentAgreement.findMany({
            where: { tenantId: req.tenantId },
            orderBy: { createdAt: 'asc' },
            take: 100,
        });
        res.json({ success: true, data: agreements });
    } catch (error) {
        console.error('Error listando convenios de agente:', error);
        res.status(500).json({ success: false, error: 'Error obteniendo los convenios' });
    }
});

// Crear convenio (dueño/admin — es firmar un contrato con el banco/red).
router.post('/agreements', authenticate, AGENT_MANAGER, validate(CreateAgentAgreementSchema), async (req: any, res: any) => {
    try {
        const { name, kind, commissionConfig } = req.body;
        const agreement = await prisma.agentAgreement.create({
            data: {
                tenantId: req.tenantId,
                name,
                kind,
                commissionConfig: commissionConfig ?? undefined,
            },
        });
        await prisma.auditLog.create({
            data: {
                tenantId: req.tenantId,
                userId: req.userId,
                action: 'AGENT_AGREEMENT_CREATED',
                details: JSON.stringify({ agreementId: agreement.id, name, kind }),
            },
        });
        res.json({ success: true, data: agreement });
    } catch (error) {
        console.error('Error creando convenio de agente:', error);
        res.status(500).json({ success: false, error: 'Error creando el convenio' });
    }
});

// Actualizar convenio (activar/desactivar, nombre, comisiones).
router.patch('/agreements/:id', authenticate, AGENT_MANAGER, validate(UpdateAgentAgreementSchema), async (req: any, res: any) => {
    try {
        const { id } = req.params;
        // Ownership check: nunca update por id suelto.
        const existing = await prisma.agentAgreement.findFirst({ where: { id, tenantId: req.tenantId } });
        if (!existing) return res.status(404).json({ success: false, error: 'Convenio no encontrado' });

        const { name, active, commissionConfig } = req.body;
        const updated = await prisma.agentAgreement.update({
            where: { id: existing.id },
            data: {
                ...(name !== undefined ? { name } : {}),
                ...(active !== undefined ? { active } : {}),
                ...(commissionConfig !== undefined ? { commissionConfig } : {}),
            },
        });
        await prisma.auditLog.create({
            data: {
                tenantId: req.tenantId,
                userId: req.userId,
                action: 'AGENT_AGREEMENT_UPDATED',
                details: JSON.stringify({
                    agreementId: id,
                    before: { name: existing.name, active: existing.active, commissionConfig: existing.commissionConfig },
                    after: { name: updated.name, active: updated.active, commissionConfig: updated.commissionConfig },
                }),
            },
        });
        res.json({ success: true, data: updated });
    } catch (error) {
        console.error('Error actualizando convenio de agente:', error);
        res.status(500).json({ success: false, error: 'Error actualizando el convenio' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// TRANSACCIONES
// ─────────────────────────────────────────────────────────────────────────────

// Registrar una operación de mostrador (cajero con caja abierta).
router.post('/transactions', authenticate, validate(CreateAgentTxSchema), async (req: any, res: any) => {
    try {
        const { agreementId, operation, amount, currency, commission, externalRef, customerRef } = req.body;

        // Fase A: solo córdobas. USD requiere tipo de cambio por transacción
        // (Fase C) — mezclar monedas corrompería settlementBalance y el arqueo.
        if (currency !== 'NIO') {
            return res.status(400).json({ success: false, error: 'Por ahora las operaciones de agente se registran solo en córdobas (C$).' });
        }

        const direction = AGENT_OPERATION_DIRECTION[operation];
        if (!direction) {
            return res.status(400).json({ success: false, error: 'Operación de agente no soportada' });
        }

        // Convenio del MISMO tenant, activo.
        const agreement = await prisma.agentAgreement.findFirst({
            where: { id: agreementId, tenantId: req.tenantId, active: true },
        });
        if (!agreement) {
            return res.status(404).json({ success: false, error: 'Convenio no encontrado o inactivo' });
        }

        // Caja abierta del usuario (mismo criterio que /api/cash-movements).
        const currentShift = await prisma.shift.findFirst({
            where: { userId: req.userId, status: 'OPEN' },
        });
        if (!currentShift) {
            return res.status(400).json({ success: false, error: 'No hay caja abierta. Abrí una caja primero.' });
        }

        const dAmount = new Decimal(amount);
        // Comisión: manual si viene en el body; si no, la del contrato del convenio.
        const dCommission = commission !== undefined
            ? new Decimal(commission).toDecimalPlaces(4)
            : calcAgentCommission(agreement.commissionConfig, operation, dAmount);

        // Garantizar el catálogo contable ANTES de abrir la transacción: el
        // auto-seed perezoso de getAccount corre con el cliente global, y el
        // snapshot REPEATABLE READ de la tx (fijado en su primera lectura) no
        // ve filas commiteadas después → el asiento moriría con P2025 en el
        // primer uso de un tenant fresco. Un findUnique barato lo evita.
        const anchorAccount = await prisma.account.findUnique({
            where: { tenantId_code: { tenantId: req.tenantId, code: '2.1.12' } },
            select: { id: true },
        });
        if (!anchorAccount) await seedChartOfAccounts(req.tenantId);

        const result = await prisma.$transaction(async (tx: any) => {
            // Guarda anti-sobregiro para salidas (retiros/remesas pagadas):
            // el tope real de retiro lo pone la gaveta (Banpro lo delega al
            // comercio). Revalidación race-safe bajo row-lock del turno,
            // mismo patrón que /api/cash-movements pero con backticks MySQL.
            if (direction === 'OUT') {
                await tx.$queryRaw`SELECT id FROM \`Shift\` WHERE id = ${currentShift.id} AND \`tenantId\` = ${req.tenantId} FOR UPDATE`;
                const freshSales: Array<{ total: any }> = await tx.sale.findMany({
                    where: { shiftId: currentShift.id, paymentMethod: 'CASH' },
                    select: { total: true },
                });
                const freshMovements: Array<{ type: string; amount: any }> = await tx.cashMovement.findMany({
                    where: { shiftId: currentShift.id, isVoided: false },
                    select: { type: true, amount: true },
                });
                const cashSalesTotal = freshSales
                    .reduce((sum: Decimal, s: any) => sum.plus(new Decimal(s.total.toString())), new Decimal(0));
                const totalINs = freshMovements
                    .filter((m) => m.type === 'IN')
                    .reduce((sum: Decimal, m: any) => sum.plus(new Decimal(m.amount.toString())), new Decimal(0));
                const totalOUTs = freshMovements
                    .filter((m) => m.type === 'OUT')
                    .reduce((sum: Decimal, m: any) => sum.plus(new Decimal(m.amount.toString())), new Decimal(0));
                const availableCash = new Decimal(currentShift.initialCash.toString())
                    .plus(cashSalesTotal).plus(totalINs).minus(totalOUTs);
                if (dAmount.greaterThan(availableCash)) {
                    throw new Error(`Efectivo insuficiente en la gaveta para pagar esta operación. Disponible: C$${availableCash.toFixed(2)}`);
                }
            }

            // 1. Movimiento de caja FIRMADO (entra al arqueo y al libro encadenado).
            const movement = await appendSignedCashMovement(tx, {
                tenantId: req.tenantId,
                shiftId: currentShift.id,
                userId: req.userId,
                type: direction,
                amount: dAmount.toNumber(),
                currency: 'NIO',
                category: 'AGENTE_BANCARIO',
                description: `[${agreement.name}] ${operation}${externalRef ? ` · ref ${externalRef}` : ''}`,
                expenseId: null,
            });

            // 2. Detalle de la operación de agente (1:1 con el movimiento).
            const agentTx = await tx.agentTransaction.create({
                data: {
                    tenantId: req.tenantId,
                    agreementId: agreement.id,
                    cashMovementId: movement.id,
                    shiftId: currentShift.id,
                    userId: req.userId,
                    operation,
                    direction,
                    amount: dAmount.toNumber(),
                    currency: 'NIO',
                    commission: dCommission.toNumber(),
                    externalRef: externalRef || null,
                    customerRef: customerRef || null,
                },
            });

            // 3. Saldos espejo del convenio (proyección atómica en la misma tx):
            // IN  → el negocio captó efectivo del banco ⇒ debe más (+).
            // OUT → el negocio pagó efectivo por el banco ⇒ el banco le debe (−).
            const balanceBefore = new Decimal(agreement.settlementBalance.toString());
            const delta = direction === 'IN' ? dAmount : dAmount.negated();
            await tx.agentAgreement.update({
                where: { id: agreement.id },
                data: {
                    settlementBalance: { increment: delta.toNumber() },
                    commissionAccrued: { increment: dCommission.toNumber() },
                },
            });

            // 4. Asiento de partida doble (Caja ↔ 2.1.12; comisión 1.1.7 ↔ 4.1.4).
            await recordAgentTransaction(
                tx, req.tenantId, req.userId, agentTx.id, direction,
                dAmount.toNumber(), dCommission.toNumber(),
                `${agreement.name} ${operation}${externalRef ? ` ref ${externalRef}` : ''}`
            );

            // 5. AuditLog inmutable con before/after del saldo del convenio.
            await tx.auditLog.create({
                data: {
                    tenantId: req.tenantId,
                    userId: req.userId,
                    action: direction === 'IN' ? 'AGENT_TX_CASH_IN' : 'AGENT_TX_CASH_OUT',
                    details: JSON.stringify({
                        agentTxId: agentTx.id,
                        movimientoId: movement.id,
                        convenio: agreement.name,
                        operacion: operation,
                        monto: dAmount.toNumber(),
                        comision: dCommission.toNumber(),
                        referencia: externalRef || null,
                        turnoId: currentShift.id,
                        before: { settlementBalance: balanceBefore.toNumber() },
                        after: { settlementBalance: balanceBefore.plus(delta).toNumber() },
                    }),
                },
            });

            return { agentTx, movement, settlementBalance: balanceBefore.plus(delta).toNumber() };
        });

        res.json({ success: true, data: result });
    } catch (error: any) {
        console.error('Error registrando operación de agente:', error);
        const msg = error?.message?.startsWith('Efectivo insuficiente')
            ? error.message
            : 'Error registrando la operación de agente';
        res.status(error?.message?.startsWith('Efectivo insuficiente') ? 400 : 500).json({ success: false, error: msg });
    }
});

// Listar operaciones (paginado; filtro opcional por convenio y turno).
router.get('/transactions', authenticate, async (req: any, res: any) => {
    try {
        const take = Math.min(parseInt(req.query.take) || 50, 200);
        const where: any = { tenantId: req.tenantId };
        if (req.query.agreementId) where.agreementId = String(req.query.agreementId);
        if (req.query.shiftId) where.shiftId = String(req.query.shiftId);
        const txs = await prisma.agentTransaction.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take,
            include: { agreement: { select: { name: true, kind: true } } },
        });
        res.json({ success: true, data: txs });
    } catch (error) {
        console.error('Error listando operaciones de agente:', error);
        res.status(500).json({ success: false, error: 'Error obteniendo las operaciones' });
    }
});

export default router;
