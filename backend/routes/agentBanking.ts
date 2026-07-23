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
import {
    recordAgentTransaction,
    recordAgentReversal,
    recordAgentCommissionSettlement,
    seedChartOfAccounts,
} from '../services/accounting';
import {
    validate,
    CreateAgentAgreementSchema,
    UpdateAgentAgreementSchema,
    CreateAgentTxSchema,
    ReverseAgentTxSchema,
    SettleCommissionsSchema,
    AgentSettingsSchema,
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
    // Fase B — traslado de efectivo con el banco (manager, comisión 0). Mismo
    // delta de saldo que las demás: ENTREGA baja la deuda (−), FONDEO la sube (+).
    LIQUIDACION_ENTREGA: 'OUT',
    LIQUIDACION_FONDEO: 'IN',
};

/** Roles que pueden conciliar (liquidaciones y reversas) — espejo del gate del panóptico. */
const MANAGER_ROLES = ['OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER'];

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

/**
 * Límites del contrato por operación (Fase C): por transacción (maxTx) y por
 * día (maxDia). Devuelve el mensaje de error o null si pasa. Config ausente o
 * corrupta ⇒ sin límite (el registro no puede caerse por una config mala).
 */
export function validarLimites(config: unknown, operation: string, amount: Decimal, acumuladoHoy: Decimal): string | null {
    if (!config || typeof config !== 'object') return null;
    const entry = (config as Record<string, any>)[operation];
    if (!entry || typeof entry !== 'object') return null;
    const opLabel = operation.replace(/_/g, ' ').toLowerCase();
    const maxTxN = Number(entry.maxTx);
    if (entry.maxTx != null && isFinite(maxTxN) && maxTxN > 0 && amount.greaterThan(maxTxN)) {
        return `El monto excede el límite por transacción de ${opLabel} del convenio (C$${maxTxN.toFixed(2)}).`;
    }
    const maxDiaN = Number(entry.maxDia);
    if (entry.maxDia != null && isFinite(maxDiaN) && maxDiaN > 0 && acumuladoHoy.plus(amount).greaterThan(maxDiaN)) {
        return `Con esta operación superás el límite diario de ${opLabel} del convenio (C$${maxDiaN.toFixed(2)}; llevás C$${acumuladoHoy.toFixed(2)} hoy).`;
    }
    return null;
}

/** ¿El contrato define límite diario para esta operación? (decide si hay que agregar/lockear) */
export function tieneLimiteDiario(config: unknown, operation: string): boolean {
    if (!config || typeof config !== 'object') return false;
    const entry = (config as Record<string, any>)[operation];
    const maxDiaN = Number(entry?.maxDia);
    return entry?.maxDia != null && isFinite(maxDiaN) && maxDiaN > 0;
}

/**
 * Efectivo disponible en la gaveta del turno (fondo + ventas CASH + INs − OUTs),
 * con decimal.js. Sirve con el cliente global (lectura) o con una tx (frescura
 * bajo lock). La fórmula es la misma del arqueo.
 */
async function calcularGaveta(client: any, shift: { id: string; initialCash: any; initialCashUsd?: any }, moneda: 'NIO' | 'USD' = 'NIO'): Promise<Decimal> {
    // Fase D: la gaveta es POR MONEDA. Ventas solo aplican a C$ (el POS vende
    // en córdobas); el fondo inicial USD vive en Shift.initialCashUsd.
    const freshSales: Array<{ total: any }> = moneda === 'NIO'
        ? await client.sale.findMany({
            where: { shiftId: shift.id, paymentMethod: 'CASH' },
            select: { total: true },
        })
        : [];
    const freshMovements: Array<{ type: string; amount: any; currency: string | null }> = await client.cashMovement.findMany({
        where: { shiftId: shift.id, isVoided: false },
        select: { type: true, amount: true, currency: true },
    });
    const mismaMoneda = (m: any) => (m.currency || 'NIO') === moneda;
    const cashSalesTotal = freshSales
        .reduce((sum: Decimal, s: any) => sum.plus(new Decimal(s.total.toString())), new Decimal(0));
    const totalINs = freshMovements
        .filter((m) => m.type === 'IN' && mismaMoneda(m))
        .reduce((sum: Decimal, m: any) => sum.plus(new Decimal(m.amount.toString())), new Decimal(0));
    const totalOUTs = freshMovements
        .filter((m) => m.type === 'OUT' && mismaMoneda(m))
        .reduce((sum: Decimal, m: any) => sum.plus(new Decimal(m.amount.toString())), new Decimal(0));
    const fondo = moneda === 'NIO'
        ? new Decimal(shift.initialCash.toString())
        : new Decimal((shift.initialCashUsd ?? 0).toString());
    return fondo.plus(cashSalesTotal).plus(totalINs).minus(totalOUTs);
}

/**
 * Guarda anti-sobregiro para salidas de efectivo: bloquea la fila del turno
 * (FOR UPDATE, backticks MySQL) y recalcula el efectivo disponible con datos
 * frescos DENTRO de la transacción (cierra el TOCTOU de dos OUT concurrentes).
 * Lanza si la gaveta no alcanza. DEBE llamarse dentro de una $transaction.
 */
async function assertGavetaAlcanza(tx: any, shift: { id: string; initialCash: any; initialCashUsd?: any }, tenantId: string, monto: Decimal, moneda: 'NIO' | 'USD' = 'NIO'): Promise<void> {
    await tx.$queryRaw`SELECT id FROM \`Shift\` WHERE id = ${shift.id} AND \`tenantId\` = ${tenantId} FOR UPDATE`;
    const availableCash = await calcularGaveta(tx, shift, moneda);
    const simbolo = moneda === 'NIO' ? 'C$' : 'US$';
    if (monto.greaterThan(availableCash)) {
        throw new Error(`Efectivo insuficiente en la gaveta para pagar esta operación. Disponible: ${simbolo}${availableCash.toFixed(2)}`);
    }
}

/**
 * Alertas de gaveta (Fase C) — best effort tras la operación: umbral mínimo
 * (no poder pagar retiros) y máximo (exceso de efectivo → sugerir entrega al
 * banco). Nunca lanza: una alerta no puede romper el registro.
 */
async function alertasDeGaveta(tenantId: string, shift: { id: string; initialCash: any }): Promise<string[]> {
    const alerts: string[] = [];
    try {
        const tenant = await prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { agentCashMin: true, agentCashMax: true },
        });
        if (!tenant || (tenant.agentCashMin == null && tenant.agentCashMax == null)) return alerts;
        const gaveta = await calcularGaveta(prisma, shift);
        if (tenant.agentCashMin != null && gaveta.lessThan(new Decimal(tenant.agentCashMin.toString()))) {
            alerts.push(`⚠️ Gaveta baja: C$${gaveta.toFixed(2)} (mínimo C$${Number(tenant.agentCashMin).toFixed(2)}). Podés quedarte sin efectivo para pagar retiros — considerá fondear la gaveta.`);
        }
        if (tenant.agentCashMax != null && gaveta.greaterThan(new Decimal(tenant.agentCashMax.toString()))) {
            alerts.push(`⚠️ Exceso de efectivo: C$${gaveta.toFixed(2)} (máximo C$${Number(tenant.agentCashMax).toFixed(2)}). Riesgo de robo — considerá entregar efectivo al banco.`);
        }
    } catch { /* best effort */ }
    return alerts;
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
        const { name, kind, commissionConfig, limitsConfig } = req.body;
        const agreement = await prisma.agentAgreement.create({
            data: {
                tenantId: req.tenantId,
                name,
                kind,
                commissionConfig: commissionConfig ?? undefined,
                limitsConfig: limitsConfig ?? undefined,
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

        const { name, active, commissionConfig, limitsConfig } = req.body;
        const updated = await prisma.agentAgreement.update({
            where: { id: existing.id },
            data: {
                ...(name !== undefined ? { name } : {}),
                ...(active !== undefined ? { active } : {}),
                ...(commissionConfig !== undefined ? { commissionConfig } : {}),
                ...(limitsConfig !== undefined ? { limitsConfig } : {}),
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
        const { agreementId, operation, amount, currency, exchangeRate, commission, externalRef, customerRef } = req.body;

        const direction = AGENT_OPERATION_DIRECTION[operation];
        if (!direction) {
            return res.status(400).json({ success: false, error: 'Operación de agente no soportada' });
        }

        // Traslados de efectivo con el banco (Fase B): decisión de conciliación,
        // no de mostrador → solo managers, y nunca devengan comisión.
        const isLiquidacion = operation.startsWith('LIQUIDACION');
        if (isLiquidacion && !MANAGER_ROLES.includes(req.role || '')) {
            return res.status(403).json({ success: false, error: 'Solo un administrador puede registrar traslados de efectivo con el banco.' });
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
        // Fase D: valor contable en C$ (moneda funcional). USD: amount × tipo
        // de cambio de la transacción (Zod ya exige exchangeRate en USD).
        const dRate = currency === 'USD' ? new Decimal(exchangeRate) : null;
        const dAmountNio = dRate ? dAmount.mul(dRate).toDecimalPlaces(4) : dAmount;
        // Comisión (en C$): manual si viene en el body; si no, la del contrato
        // aplicada sobre el EQUIVALENTE en córdobas. Los traslados de efectivo
        // (LIQUIDACION_*) nunca devengan comisión.
        const dCommission = isLiquidacion
            ? new Decimal(0)
            : commission !== undefined
                ? new Decimal(commission).toDecimalPlaces(4)
                : calcAgentCommission(agreement.commissionConfig, operation, dAmountNio);

        // La comisión es un cargo de mostrador que el cliente provee (override) o
        // se calcula del convenio. Nunca puede exceder el VALOR de la operación:
        // sin este tope, un `commission` arbitrario (p. ej. amount 1, commission
        // 50M) devengaba ingreso/CxC ficticios que luego se liquidaban como caja
        // bancaria fantasma (fraude de estados financieros disparable por un
        // cajero). Cotamos al equivalente en C$ del monto de la transacción.
        if (dCommission.greaterThan(dAmountNio)) {
            return res.status(400).json({
                success: false,
                error: 'La comisión no puede superar el monto de la operación.',
            });
        }

        // Límites del contrato (Fase C): chequeo rápido del tope por transacción
        // antes de abrir la tx (respuesta 400 limpia). El límite DIARIO se
        // revalida DENTRO de la tx bajo lock del convenio (race-safe). Los
        // traslados internos (LIQUIDACION_*) no son operaciones del banco →
        // sin límites de contrato.
        if (!isLiquidacion) {
            // Los límites del contrato están en C$ → comparar el equivalente.
            const limErrRapido = validarLimites(agreement.limitsConfig, operation, dAmountNio, new Decimal(0));
            if (limErrRapido) {
                return res.status(400).json({ success: false, error: limErrRapido });
            }
        }

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
            // Guarda anti-sobregiro para salidas (retiros/remesas pagadas/entregas
            // al banco): el tope real de retiro lo pone la gaveta (Banpro lo
            // delega al comercio). Row-lock + recálculo fresco dentro de la tx.
            if (direction === 'OUT') {
                await assertGavetaAlcanza(tx, currentShift, req.tenantId, dAmount, currency === 'USD' ? 'USD' : 'NIO');
            }

            // Límite DIARIO del contrato (Fase C): lock de la fila del convenio
            // (serializa las operaciones del convenio entre cajas) + agregado
            // fresco del día en SQL. Día calendario del server.
            if (!isLiquidacion && tieneLimiteDiario(agreement.limitsConfig, operation)) {
                await tx.$queryRaw`SELECT id FROM \`AgentAgreement\` WHERE id = ${agreement.id} FOR UPDATE`;
                const hoy0 = new Date();
                hoy0.setHours(0, 0, 0, 0);
                // Suma del día en C$: COALESCE(amountNio, amount) — las filas
                // anteriores a Fase D no tienen amountNio pero son NIO puras.
                const aggRows: Array<{ total: any }> = await tx.$queryRaw`
                    SELECT COALESCE(SUM(COALESCE(\`amountNio\`, \`amount\`)), 0) AS total
                    FROM \`AgentTransaction\`
                    WHERE \`agreementId\` = ${agreement.id} AND \`operation\` = ${operation}
                      AND \`status\` = 'COMPLETED' AND \`createdAt\` >= ${hoy0}`;
                const acumuladoHoy = new Decimal((aggRows[0]?.total ?? 0).toString());
                const limErr = validarLimites(agreement.limitsConfig, operation, dAmountNio, acumuladoHoy);
                if (limErr) throw new Error(`LIMITE: ${limErr}`);
            }

            // 1. Movimiento de caja FIRMADO (entra al arqueo y al libro encadenado).
            const movement = await appendSignedCashMovement(tx, {
                tenantId: req.tenantId,
                shiftId: currentShift.id,
                userId: req.userId,
                type: direction,
                amount: dAmount.toNumber(),
                currency: currency === 'USD' ? 'USD' : 'NIO',
                category: 'AGENTE_BANCARIO',
                description: `[${agreement.name}] ${operation}${currency === 'USD' ? ` US$${dAmount.toFixed(2)} @ ${dRate!.toFixed(4)}` : ''}${externalRef ? ` · ref ${externalRef}` : ''}`,
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
                    currency: currency === 'USD' ? 'USD' : 'NIO',
                    exchangeRate: dRate ? dRate.toNumber() : null,
                    amountNio: dAmountNio.toNumber(),
                    commission: dCommission.toNumber(),
                    externalRef: externalRef || null,
                    customerRef: customerRef || null,
                },
            });

            // 3. Saldos espejo del convenio (proyección atómica en la misma tx):
            // IN  → el negocio captó efectivo del banco ⇒ debe más (+).
            // OUT → el negocio pagó efectivo por el banco ⇒ el banco le debe (−).
            // El saldo con el banco se lleva en C$ (moneda funcional): USD
            // entra por su equivalente al tipo de cambio de la transacción.
            const balanceBefore = new Decimal(agreement.settlementBalance.toString());
            const delta = direction === 'IN' ? dAmountNio : dAmountNio.negated();
            await tx.agentAgreement.update({
                where: { id: agreement.id },
                data: {
                    settlementBalance: { increment: delta.toNumber() },
                    commissionAccrued: { increment: dCommission.toNumber() },
                },
            });

            // 4. Asiento de partida doble en C$ (USD mueve 1.1.8 Caja M/E).
            await recordAgentTransaction(
                tx, req.tenantId, req.userId, agentTx.id, direction,
                dAmountNio.toNumber(), dCommission.toNumber(),
                `${agreement.name} ${operation}${currency === 'USD' ? ` US$${dAmount.toFixed(2)} @ ${dRate!.toFixed(4)}` : ''}${externalRef ? ` ref ${externalRef}` : ''}`,
                currency === 'USD' ? '1.1.8' : '1.1.1'
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
                        moneda: currency === 'USD' ? 'USD' : 'NIO',
                        tipoCambio: dRate ? dRate.toNumber() : null,
                        montoNio: dAmountNio.toNumber(),
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

        // Alertas de gaveta (Fase C) — tras el commit, best effort.
        const alerts = await alertasDeGaveta(req.tenantId, currentShift);

        res.json({ success: true, data: { ...result, alerts } });
    } catch (error: any) {
        console.error('Error registrando operación de agente:', error);
        if (error?.message?.startsWith('Efectivo insuficiente')) {
            return res.status(400).json({ success: false, error: error.message });
        }
        if (error?.message?.startsWith('LIMITE: ')) {
            return res.status(400).json({ success: false, error: error.message.slice('LIMITE: '.length) });
        }
        res.status(500).json({ success: false, error: 'Error registrando la operación de agente' });
    }
});

// Reversar una operación (Fase B): la transacción falló o se anuló en el
// dispositivo del banco. El registro original es INMUTABLE (libro firmado):
// se crea una CONTRAPARTIDA firmada en el turno abierto de quien reversa
// (el efectivo vuelve/sale HOY, no en el turno histórico), se deshacen los
// saldos del convenio y el asiento, y la operación queda REVERSED.
router.post('/transactions/:id/reverse', authenticate, checkRole(['OWNER', 'ADMIN', 'MANAGER']), validate(ReverseAgentTxSchema), async (req: any, res: any) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        const original = await prisma.agentTransaction.findFirst({
            where: { id, tenantId: req.tenantId },
            include: { agreement: true },
        });
        if (!original) return res.status(404).json({ success: false, error: 'Operación no encontrada' });
        if (original.status !== 'COMPLETED') {
            return res.status(400).json({ success: false, error: 'Esta operación ya fue reversada.' });
        }

        const currentShift = await prisma.shift.findFirst({
            where: { userId: req.userId, status: 'OPEN' },
        });
        if (!currentShift) {
            return res.status(400).json({ success: false, error: 'Abrí una caja primero: la reversa mueve efectivo de la gaveta actual.' });
        }

        const dAmount = new Decimal(original.amount.toString());
        const dCommission = new Decimal(original.commission.toString());
        // Fase D: la contrapartida devuelve la MISMA moneda física; el valor
        // contable usa el amountNio del registro original (mismo tipo de
        // cambio → la reversa cancela exacto, sin diferencial cambiario).
        // Filas anteriores a Fase D no tienen amountNio pero son NIO puras.
        const monedaOriginal: 'NIO' | 'USD' = original.currency === 'USD' ? 'USD' : 'NIO';
        const dAmountNio = new Decimal((original.amountNio ?? original.amount).toString());
        // La contrapartida va en dirección opuesta: reversar un depósito (IN)
        // significa DEVOLVER el efectivo al cliente (OUT), y viceversa.
        const compensatingDirection: 'IN' | 'OUT' = original.direction === 'IN' ? 'OUT' : 'IN';

        const result = await prisma.$transaction(async (tx: any) => {
            if (compensatingDirection === 'OUT') {
                await assertGavetaAlcanza(tx, currentShift, req.tenantId, dAmount, monedaOriginal);
            }

            // Guard atómico contra doble reversa concurrente: solo gana quien
            // encuentre la fila todavía COMPLETED.
            const marked = await tx.agentTransaction.updateMany({
                where: { id: original.id, tenantId: req.tenantId, status: 'COMPLETED' },
                data: { status: 'REVERSED', reversedAt: new Date(), reversedBy: req.userId },
            });
            if (marked.count !== 1) throw new Error('Esta operación ya fue reversada.');

            // Contrapartida firmada — entra al arqueo del turno ACTUAL.
            const movement = await appendSignedCashMovement(tx, {
                tenantId: req.tenantId,
                shiftId: currentShift.id,
                userId: req.userId,
                type: compensatingDirection,
                amount: dAmount.toNumber(),
                currency: monedaOriginal,
                category: 'AGENTE_BANCARIO',
                description: `[REVERSA] [${original.agreement.name}] ${original.operation}${monedaOriginal === 'USD' ? ` US$${dAmount.toFixed(2)}` : ''}${original.externalRef ? ` · ref ${original.externalRef}` : ''} · ${reason}`,
                expenseId: null,
            });

            // Deshacer los saldos espejo del convenio (delta opuesto al original).
            // La comisión devengada solo puede revertirse HASTA lo que siga
            // devengado: si ya se liquidó (settle-commissions la bajó a 0), un
            // decremento incondicional dejaba `commissionAccrued` NEGATIVO y
            // duplicaba el asiento de 1.1.7 (banco sobrevaluado). Lockeamos la
            // fila del convenio (FOR UPDATE, serializa contra una liquidación
            // concurrente) y acotamos al remanente. El principal (settlementBalance)
            // SÍ se revierte completo: el efectivo de la contrapartida es total.
            const lockedAgg: any[] = await tx.$queryRaw`SELECT \`commissionAccrued\` FROM \`AgentAgreement\` WHERE id = ${original.agreementId} AND \`tenantId\` = ${req.tenantId} FOR UPDATE`;
            const freshAccrued = new Decimal((lockedAgg[0]?.commissionAccrued ?? 0).toString());
            const commissionToReverse = Decimal.min(dCommission, Decimal.max(freshAccrued, new Decimal(0)));

            const balanceBefore = new Decimal(original.agreement.settlementBalance.toString());
            const delta = original.direction === 'IN' ? dAmountNio.negated() : dAmountNio;
            await tx.agentAgreement.update({
                where: { id: original.agreementId },
                data: {
                    settlementBalance: { increment: delta.toNumber() },
                    commissionAccrued: { decrement: commissionToReverse.toNumber() },
                },
            });

            // Asiento espejo (deshace monto principal + la comisión REALMENTE
            // desdevengada). Las cuentas ya existen: la operación original las sembró.
            await recordAgentReversal(
                tx, req.tenantId, req.userId, original.id, original.direction as 'IN' | 'OUT',
                dAmountNio.toNumber(), commissionToReverse.toNumber(),
                `${original.agreement.name} ${original.operation}`,
                monedaOriginal === 'USD' ? '1.1.8' : '1.1.1'
            );

            await tx.auditLog.create({
                data: {
                    tenantId: req.tenantId,
                    userId: req.userId,
                    action: 'AGENT_TX_REVERSED',
                    details: JSON.stringify({
                        agentTxId: original.id,
                        contrapartidaId: movement.id,
                        convenio: original.agreement.name,
                        operacion: original.operation,
                        monto: dAmount.toNumber(),
                        comisionRevertida: commissionToReverse.toNumber(),
                        motivo: reason,
                        turnoId: currentShift.id,
                        before: { settlementBalance: balanceBefore.toNumber(), status: 'COMPLETED' },
                        after: { settlementBalance: balanceBefore.plus(delta).toNumber(), status: 'REVERSED' },
                    }),
                },
            });

            return {
                reversedId: original.id,
                compensatingMovementId: movement.id,
                settlementBalance: balanceBefore.plus(delta).toNumber(),
            };
        });

        res.json({ success: true, data: result });
    } catch (error: any) {
        console.error('Error reversando operación de agente:', error);
        const known = error?.message?.startsWith('Efectivo insuficiente') || error?.message?.includes('ya fue reversada');
        res.status(known ? 400 : 500).json({ success: false, error: known ? error.message : 'Error reversando la operación' });
    }
});

// Liquidar comisiones devengadas (Fase B): el banco/red las paga a la CUENTA
// BANCARIA del negocio (no toca la gaveta). Sin monto = liquidar todo.
router.post('/agreements/:id/settle-commissions', authenticate, checkRole(['OWNER', 'ADMIN', 'MANAGER']), validate(SettleCommissionsSchema), async (req: any, res: any) => {
    try {
        const { id } = req.params;
        const agreement = await prisma.agentAgreement.findFirst({ where: { id, tenantId: req.tenantId } });
        if (!agreement) return res.status(404).json({ success: false, error: 'Convenio no encontrado' });

        const accrued = new Decimal(agreement.commissionAccrued.toString());
        const dAmount = req.body.amount !== undefined
            ? new Decimal(req.body.amount).toDecimalPlaces(4)
            : accrued;
        if (dAmount.lessThanOrEqualTo(0)) {
            return res.status(400).json({ success: false, error: 'No hay comisiones por liquidar en este convenio.' });
        }
        if (dAmount.greaterThan(accrued)) {
            return res.status(400).json({ success: false, error: `Solo hay C$${accrued.toFixed(2)} en comisiones devengadas.` });
        }

        const result = await prisma.$transaction(async (tx: any) => {
            // Guard atómico: decrementa solo si el devengado sigue alcanzando
            // (cierra la carrera con reversas o liquidaciones concurrentes).
            const upd = await tx.agentAgreement.updateMany({
                where: { id: agreement.id, tenantId: req.tenantId, commissionAccrued: { gte: dAmount.toNumber() } },
                data: { commissionAccrued: { decrement: dAmount.toNumber() } },
            });
            if (upd.count !== 1) throw new Error('Las comisiones devengadas cambiaron; actualizá y volvé a intentar.');

            // Debe Bancos (1.1.2) / Haber Comisiones por Cobrar (1.1.7).
            // Las cuentas ya existen: hubo operaciones que las sembraron.
            await recordAgentCommissionSettlement(
                tx, req.tenantId, req.userId, agreement.id, dAmount.toNumber(), agreement.name
            );

            await tx.auditLog.create({
                data: {
                    tenantId: req.tenantId,
                    userId: req.userId,
                    action: 'AGENT_COMMISSIONS_SETTLED',
                    details: JSON.stringify({
                        agreementId: agreement.id,
                        convenio: agreement.name,
                        liquidado: dAmount.toNumber(),
                        before: { commissionAccrued: accrued.toNumber() },
                        after: { commissionAccrued: accrued.minus(dAmount).toNumber() },
                    }),
                },
            });

            return { liquidado: dAmount.toNumber(), comisionesRestantes: accrued.minus(dAmount).toNumber() };
        });

        res.json({ success: true, data: result });
    } catch (error: any) {
        console.error('Error liquidando comisiones:', error);
        const known = error?.message?.includes('comisiones devengadas cambiaron');
        res.status(known ? 409 : 500).json({ success: false, error: known ? error.message : 'Error liquidando las comisiones' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS Y REPORTE (Fase C)
// ─────────────────────────────────────────────────────────────────────────────

// Umbrales de alerta de gaveta del tenant.
router.get('/settings', authenticate, checkRole(['OWNER', 'ADMIN', 'MANAGER']), async (req: any, res: any) => {
    try {
        const tenant = await prisma.tenant.findUnique({
            where: { id: req.tenantId },
            select: { agentCashMin: true, agentCashMax: true },
        });
        res.json({
            success: true,
            data: {
                agentCashMin: tenant?.agentCashMin != null ? Number(tenant.agentCashMin) : null,
                agentCashMax: tenant?.agentCashMax != null ? Number(tenant.agentCashMax) : null,
            },
        });
    } catch (error) {
        console.error('Error leyendo settings de agente:', error);
        res.status(500).json({ success: false, error: 'Error obteniendo la configuración' });
    }
});

router.patch('/settings', authenticate, checkRole(['OWNER', 'ADMIN', 'MANAGER']), validate(AgentSettingsSchema), async (req: any, res: any) => {
    try {
        const { agentCashMin, agentCashMax } = req.body;
        const tenant = await prisma.tenant.findUnique({
            where: { id: req.tenantId },
            select: { agentCashMin: true, agentCashMax: true },
        });
        if (!tenant) return res.status(404).json({ success: false, error: 'Negocio no encontrado' });

        // Validación cruzada sobre el ESTADO FINAL (update parcial: el otro
        // umbral puede venir de la BD).
        const finalMin = agentCashMin !== undefined
            ? (agentCashMin === null ? null : parseFloat(agentCashMin))
            : (tenant.agentCashMin != null ? Number(tenant.agentCashMin) : null);
        const finalMax = agentCashMax !== undefined
            ? (agentCashMax === null ? null : parseFloat(agentCashMax))
            : (tenant.agentCashMax != null ? Number(tenant.agentCashMax) : null);
        if (finalMin != null && finalMax != null && finalMin >= finalMax) {
            return res.status(400).json({ success: false, error: 'El umbral mínimo debe ser menor que el máximo.' });
        }

        const updated = await prisma.tenant.update({
            where: { id: req.tenantId },
            data: {
                ...(agentCashMin !== undefined ? { agentCashMin: agentCashMin === null ? null : parseFloat(agentCashMin) } : {}),
                ...(agentCashMax !== undefined ? { agentCashMax: agentCashMax === null ? null : parseFloat(agentCashMax) } : {}),
            },
            select: { agentCashMin: true, agentCashMax: true },
        });
        await prisma.auditLog.create({
            data: {
                tenantId: req.tenantId,
                userId: req.userId,
                action: 'AGENT_SETTINGS_UPDATED',
                details: JSON.stringify({
                    before: { agentCashMin: tenant.agentCashMin != null ? Number(tenant.agentCashMin) : null, agentCashMax: tenant.agentCashMax != null ? Number(tenant.agentCashMax) : null },
                    after: { agentCashMin: updated.agentCashMin != null ? Number(updated.agentCashMin) : null, agentCashMax: updated.agentCashMax != null ? Number(updated.agentCashMax) : null },
                }),
            },
        });
        res.json({
            success: true,
            data: {
                agentCashMin: updated.agentCashMin != null ? Number(updated.agentCashMin) : null,
                agentCashMax: updated.agentCashMax != null ? Number(updated.agentCashMax) : null,
            },
        });
    } catch (error) {
        console.error('Error actualizando settings de agente:', error);
        res.status(500).json({ success: false, error: 'Error guardando la configuración' });
    }
});

// Reporte de conciliación: TODO agregado en SQL (groupBy convenio × operación
// × estado) — nada de traer filas y sumar en JS (guardrail de escalabilidad).
router.get('/report', authenticate, checkRole(['OWNER', 'ADMIN', 'MANAGER']), async (req: any, res: any) => {
    try {
        const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 365);
        const desde = new Date();
        desde.setDate(desde.getDate() - days);
        desde.setHours(0, 0, 0, 0);

        const [agreements, grouped] = await Promise.all([
            prisma.agentAgreement.findMany({
                where: { tenantId: req.tenantId },
                select: { id: true, name: true, kind: true, active: true, settlementBalance: true, commissionAccrued: true },
                orderBy: { createdAt: 'asc' },
                take: 100,
            }),
            prisma.agentTransaction.groupBy({
                by: ['agreementId', 'operation', 'status'],
                where: { tenantId: req.tenantId, createdAt: { gte: desde } },
                _count: { _all: true },
                _sum: { amount: true, commission: true },
            }),
        ]);

        const breakdown = grouped.map((g: any) => ({
            agreementId: g.agreementId,
            operation: g.operation,
            status: g.status,
            count: g._count._all,
            totalAmount: Number(g._sum.amount ?? 0),
            totalCommission: Number(g._sum.commission ?? 0),
        }));

        res.json({
            success: true,
            data: {
                days,
                desde,
                agreements: agreements.map((a: any) => ({
                    ...a,
                    settlementBalance: Number(a.settlementBalance),
                    commissionAccrued: Number(a.commissionAccrued),
                })),
                breakdown,
            },
        });
    } catch (error) {
        console.error('Error generando reporte de agente:', error);
        res.status(500).json({ success: false, error: 'Error generando el reporte' });
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
