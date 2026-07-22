/**
 * NORTEX — Motor Contable de Partida Doble (NIIF PyMES)
 *
 * Cada transacción del POS genera asientos contables automáticos.
 * El ferretero no ve nada; Nortex construye estados financieros en silencio.
 *
 * Regla sagrada: SUM(Debe) === SUM(Haber) en cada asiento.
 * Precisión numérica: Decimal.js — NIIF exige mínimo 4 d.p. internos, 2 al persistir.
 */

import { PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import { generateMonthlyReport } from './nicaTax';

// Configuración global: 20 dígitos significativos, redondeo HALF_UP (DGI)
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

const prisma = new PrismaClient();

// ==========================================
// CATÁLOGO DE CUENTAS ESTÁNDAR (NIIF PyMES Nicaragua)
// ==========================================

const CHART_OF_ACCOUNTS = [
    // ACTIVOS (1.x.x)
    { code: '1.1.1', name: 'Caja General', type: 'ASSET', subtype: 'CURRENT_ASSET' },
    { code: '1.1.2', name: 'Bancos', type: 'ASSET', subtype: 'CURRENT_ASSET' },
    { code: '1.1.3', name: 'Cuentas por Cobrar', type: 'ASSET', subtype: 'CURRENT_ASSET' },
    { code: '1.1.4', name: 'Inventario de Mercancías', type: 'ASSET', subtype: 'CURRENT_ASSET' },
    { code: '1.1.5', name: 'IVA Crédito Fiscal', type: 'ASSET', subtype: 'CURRENT_ASSET' },
    { code: '1.1.6', name: 'Anticipo IR (Retenciones Sufridas)', type: 'ASSET', subtype: 'CURRENT_ASSET' },
    // Agente bancario (corresponsalía): comisiones devengadas que el banco/red
    // liquida después (típicamente mensual) — ver docs/PLAN_AGENTE_BANCARIO.md.
    { code: '1.1.7', name: 'Comisiones por Cobrar Corresponsalía', type: 'ASSET', subtype: 'CURRENT_ASSET' },
    { code: '1.2.1', name: 'Mobiliario y Equipo', type: 'ASSET', subtype: 'FIXED_ASSET' },
    { code: '1.2.2', name: 'Depreciación Acumulada', type: 'ASSET', subtype: 'FIXED_ASSET' },
    // PASIVOS (2.x.x)
    { code: '2.1.1', name: 'Cuentas por Pagar Proveedores', type: 'LIABILITY', subtype: 'CURRENT_LIABILITY' },
    { code: '2.1.2', name: 'IVA por Pagar', type: 'LIABILITY', subtype: 'CURRENT_LIABILITY' },
    { code: '2.1.3', name: 'IR por Pagar', type: 'LIABILITY', subtype: 'CURRENT_LIABILITY' },
    { code: '2.1.4', name: 'IMI Alcaldía por Pagar', type: 'LIABILITY', subtype: 'CURRENT_LIABILITY' },
    { code: '2.1.5', name: 'INSS Patronal por Pagar', type: 'LIABILITY', subtype: 'CURRENT_LIABILITY' },
    { code: '2.1.6', name: 'INATEC por Pagar', type: 'LIABILITY', subtype: 'CURRENT_LIABILITY' },
    { code: '2.1.7', name: 'Retenciones por Pagar', type: 'LIABILITY', subtype: 'CURRENT_LIABILITY' },
    { code: '2.1.8', name: 'Préstamos Nortex Capital por Pagar', type: 'LIABILITY', subtype: 'CURRENT_LIABILITY' },
    { code: '2.1.9', name: 'Aguinaldo por Pagar', type: 'LIABILITY', subtype: 'CURRENT_LIABILITY' },
    { code: '2.1.10', name: 'Vacaciones por Pagar', type: 'LIABILITY', subtype: 'CURRENT_LIABILITY' },
    { code: '2.1.11', name: 'Indemnización por Pagar', type: 'LIABILITY', subtype: 'CURRENT_LIABILITY' },
    // Agente bancario: efectivo captado por cuenta del banco (depósitos, pagos
    // de servicios...) — es del banco, NO ingreso del negocio.
    { code: '2.1.12', name: 'Corresponsalía Bancaria por Liquidar', type: 'LIABILITY', subtype: 'CURRENT_LIABILITY' },
    // CAPITAL (3.x.x)
    { code: '3.1.1', name: 'Capital Social', type: 'EQUITY', subtype: null },
    { code: '3.1.2', name: 'Utilidades Retenidas', type: 'EQUITY', subtype: null },
    { code: '3.1.3', name: 'Utilidad del Ejercicio', type: 'EQUITY', subtype: null },
    // INGRESOS (4.x.x)
    { code: '4.1.1', name: 'Ventas', type: 'REVENUE', subtype: null },
    { code: '4.1.2', name: 'Devoluciones sobre Ventas', type: 'REVENUE', subtype: null },
    { code: '4.1.3', name: 'Sobrantes de Inventario', type: 'REVENUE', subtype: null },
    // Agente bancario: la comisión SÍ es ingreso del negocio (el monto principal no).
    { code: '4.1.4', name: 'Comisiones por Corresponsalía', type: 'REVENUE', subtype: null },
    // GASTOS (5.x.x)
    { code: '5.1.1', name: 'Costo de Ventas', type: 'EXPENSE', subtype: null },
    { code: '5.1.2', name: 'Pérdida por Merma de Inventario', type: 'EXPENSE', subtype: null },
    { code: '5.2.1', name: 'Gastos Operativos', type: 'EXPENSE', subtype: null },
    { code: '5.2.2', name: 'Gastos de Nómina', type: 'EXPENSE', subtype: null },
    { code: '5.2.3', name: 'INSS Patronal (Gasto)', type: 'EXPENSE', subtype: null },
    { code: '5.2.4', name: 'INATEC (Gasto)', type: 'EXPENSE', subtype: null },
    { code: '5.2.5', name: 'Depreciación', type: 'EXPENSE', subtype: null },
    { code: '5.2.6', name: 'Prestaciones Sociales', type: 'EXPENSE', subtype: null },
    { code: '5.2.7', name: 'Cuentas Incobrables', type: 'EXPENSE', subtype: null },
];

// ==========================================
// SEED: Crear catálogo automáticamente para un tenant
// ==========================================

export async function seedChartOfAccounts(tenantId: string): Promise<void> {
    // Idempotente y AUTO-SANABLE: createMany skipDuplicates agrega solo las
    // cuentas faltantes (el @@unique(tenantId,code) las dedupe). Así un tenant
    // ya sembrado recibe cuentas NUEVAS del catálogo (ej. 1.1.6) sin migración.
    const result = await prisma.account.createMany({
        data: CHART_OF_ACCOUNTS.map(a => ({
            tenantId,
            code: a.code,
            name: a.name,
            type: a.type,
            subtype: a.subtype,
            balance: 0,
            isSystem: true,
        })),
        skipDuplicates: true,
    });
    if (result.count > 0) {
        console.log(`📊 Chart of Accounts: +${result.count} cuentas para tenant ${tenantId}`);
    }
}

// ==========================================
// HELPERS
// ==========================================

async function getAccount(tenantId: string, code: string) {
    const account = await prisma.account.findUnique({
        where: { tenantId_code: { tenantId, code } }
    });
    if (!account) {
        // Auto-seed if missing
        await seedChartOfAccounts(tenantId);
        return prisma.account.findUnique({
            where: { tenantId_code: { tenantId, code } }
        });
    }
    return account;
}

// ── FASE A — Bloqueo de períodos fiscales ───────────────────────────────────

type AnyTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Error tipado: el período de la fecha del asiento está cerrado. → HTTP 409. */
export class PeriodLockedError extends Error {
    constructor(public readonly period: string) {
        super(`PERÍODO CERRADO: el período ${period} ya fue cerrado fiscalmente. Reábrelo para registrar movimientos con esa fecha.`);
        this.name = 'PeriodLockedError';
    }
}

/**
 * Verifica que el período (año/mes) de `date` no esté cerrado. Sin fila de
 * FiscalPeriod = abierto (no rompe los flujos previos). Es el guard único:
 * lo llama createJournalEntry, así que protege ventas, compras, gastos,
 * nómina, devoluciones y asientos manuales por igual.
 */
export async function assertPeriodOpen(tx: AnyTx, tenantId: string, date: Date): Promise<void> {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const period = await tx.fiscalPeriod.findUnique({
        where: { tenantId_year_month: { tenantId, year, month } },
    });
    if (period && period.status === 'CLOSED') {
        throw new PeriodLockedError(`${year}-${String(month).padStart(2, '0')}`);
    }
}

export async function createJournalEntry(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    tenantId: string,
    description: string,
    referenceId: string,
    referenceType: string,
    userId: string,
    lines: { accountCode: string; debit: number; credit: number }[],
    opts?: { isAutomatic?: boolean; date?: Date }
): Promise<void> {
    const date = opts?.date ?? new Date();
    const isAutomatic = opts?.isAutomatic ?? true;

    // A3: ningún asiento entra en un período cerrado (cubre TODO el motor).
    await assertPeriodOpen(tx, tenantId, date);

    // Validate: Sum of debits must equal sum of credits (Decimal para evitar 0.1+0.2 != 0.3)
    const totalDebit = lines.reduce((sum, l) => new Decimal(sum).plus(l.debit).toNumber(), 0);
    const totalCredit = lines.reduce((sum, l) => new Decimal(sum).plus(l.credit).toNumber(), 0);
    if (new Decimal(totalDebit).minus(totalCredit).abs().greaterThan('0.01')) {
        throw new Error(`ASIENTO DESCUADRADO: Debe=${new Decimal(totalDebit).toFixed(2)} Haber=${new Decimal(totalCredit).toFixed(2)}`);
    }

    // Resolve account IDs — SECUENCIAL a propósito: getAccount auto-siembra el
    // catálogo cuando falta una cuenta, y dos seedChartOfAccounts (createMany
    // skipDuplicates) concurrentes sobre el mismo tenant se deadlockean (P2034).
    // Con 2+ cuentas nuevas del catálogo en un MISMO asiento, el Promise.all
    // anterior disparaba esos seeds en paralelo y el asiento moría.
    const accounts: Awaited<ReturnType<typeof getAccount>>[] = [];
    for (const l of lines) {
        accounts.push(await getAccount(tenantId, l.accountCode));
    }

    const entry = await tx.journalEntry.create({
        data: {
            tenantId,
            date,
            description,
            referenceId,
            referenceType,
            isAutomatic,
            createdBy: userId,
        }
    });

    for (let i = 0; i < lines.length; i++) {
        const account = accounts[i];
        if (!account) continue;

        await tx.journalLine.create({
            data: {
                journalEntryId: entry.id,
                accountId: account.id,
                debit: lines[i].debit,
                credit: lines[i].credit,
            }
        });

        // Update account balance
        // ASSET & EXPENSE: Debit increases, Credit decreases
        // LIABILITY, EQUITY, REVENUE: Credit increases, Debit decreases
        const isDebitNormal = ['ASSET', 'EXPENSE'].includes(account.type);
        const balanceChange = isDebitNormal
            ? lines[i].debit - lines[i].credit
            : lines[i].credit - lines[i].debit;

        await tx.account.update({
            where: { id: account.id },
            data: { balance: { increment: balanceChange } }
        });
    }
}

// ==========================================
// RECORDING FUNCTIONS (auto-called from endpoints)
// ==========================================

/**
 * VENTA EN EFECTIVO:
 *   Debe: Caja (1.1.1) + Costo de Ventas (5.1.1)
 *   Haber: Ventas (4.1.1) + Inventario (1.1.4) + IVA por Pagar (2.1.2)
 */
export async function recordSale(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    tenantId: string,
    userId: string,
    saleId: string,
    saleTotal: number,
    costTotal: number,
    paymentMethod: string
) {
    // IVA Nicaragua 15%: total = neto * 1.15  →  neto = total / 1.15
    const dTotal = new Decimal(saleTotal);
    const salesNeto = dTotal.dividedBy('1.15').toDecimalPlaces(4);
    const ivaAmount = dTotal.minus(salesNeto).toDecimalPlaces(4);

    const cashAccount = paymentMethod === 'CREDIT' ? '1.1.3' : '1.1.1'; // CxC vs Caja
    const description = paymentMethod === 'CREDIT'
        ? `Venta a crédito #${saleId.slice(0, 8)}`
        : `Venta de contado #${saleId.slice(0, 8)}`;

    await createJournalEntry(tx, tenantId, description, saleId, 'SALE', userId, [
        { accountCode: cashAccount, debit: saleTotal, credit: 0 },
        { accountCode: '4.1.1', debit: 0, credit: salesNeto.toNumber() },
        { accountCode: '2.1.2', debit: 0, credit: ivaAmount.toNumber() },
        { accountCode: '5.1.1', debit: costTotal, credit: 0 },
        { accountCode: '1.1.4', debit: 0, credit: costTotal },
    ]);
}

/**
 * PAGO DE CLIENTE (abono a crédito):
 *   Debe: Caja (1.1.1)
 *   Haber: Cuentas por Cobrar (1.1.3)
 */
export async function recordPayment(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    tenantId: string,
    userId: string,
    paymentId: string,
    amount: number
) {
    await createJournalEntry(tx, tenantId, `Abono a crédito #${paymentId.slice(0, 8)}`, paymentId, 'PAYMENT', userId, [
        { accountCode: '1.1.1', debit: amount, credit: 0 },
        { accountCode: '1.1.3', debit: 0, credit: amount },
    ]);
}

/**
 * COMPRA (con IVA crédito fiscal):
 *   Debe: Inventario (1.1.4) + IVA Crédito (1.1.5)
 *   Haber: Caja (1.1.1) o CxP (2.1.1)
 */
export async function recordPurchase(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    tenantId: string,
    userId: string,
    purchaseId: string,
    total: number,
    tax: number,
    paymentMethod: string
) {
    const subtotal = new Decimal(total).minus(tax).toDecimalPlaces(4).toNumber();
    const creditAccount = paymentMethod === 'CREDIT' ? '2.1.1' : '1.1.1';
    const description = paymentMethod === 'CREDIT'
        ? `Compra a crédito #${purchaseId.slice(0, 8)}`
        : `Compra de contado #${purchaseId.slice(0, 8)}`;

    await createJournalEntry(tx, tenantId, description, purchaseId, 'PURCHASE', userId, [
        { accountCode: '1.1.4', debit: subtotal, credit: 0 },       // Inventario ↑
        { accountCode: '1.1.5', debit: tax, credit: 0 },            // IVA Crédito ↑
        { accountCode: creditAccount, debit: 0, credit: total },     // Caja ↓ o CxP ↑
    ]);
}

/**
 * SALIDA DE EFECTIVO (gasto operativo):
 *   Debe: Gastos Operativos (5.2.1)
 *   Haber: Caja (1.1.1)
 */
export async function recordExpense(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    tenantId: string,
    userId: string,
    movementId: string,
    amount: number,
    description: string
) {
    await createJournalEntry(tx, tenantId, `Gasto: ${description}`, movementId, 'EXPENSE', userId, [
        { accountCode: '5.2.1', debit: amount, credit: 0 },
        { accountCode: '1.1.1', debit: 0, credit: amount },
    ]);
}

/**
 * ENTRADA DE EFECTIVO (inyección de capital):
 *   Debe: Caja (1.1.1)
 *   Haber: Capital Social (3.1.1)
 */
export async function recordCashIn(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    tenantId: string,
    userId: string,
    movementId: string,
    amount: number,
    description: string
) {
    await createJournalEntry(tx, tenantId, `Entrada: ${description}`, movementId, 'CASH_IN', userId, [
        { accountCode: '1.1.1', debit: amount, credit: 0 },
        { accountCode: '3.1.1', debit: 0, credit: amount },
    ]);
}

/**
 * OPERACIÓN DE AGENTE BANCARIO (corresponsalía) — un solo asiento balanceado.
 * El monto principal NO es ingreso (es efectivo por cuenta del banco):
 *   IN  (depósito/pago servicio/remesa enviada):  Debe Caja (1.1.1) / Haber Corresponsalía por Liquidar (2.1.12)
 *   OUT (retiro/remesa pagada):                   Debe 2.1.12 / Haber Caja (1.1.1)
 * La comisión SÍ es ingreso, devengada (el banco la paga después):
 *   Debe Comisiones por Cobrar (1.1.7) / Haber Comisiones por Corresponsalía (4.1.4)
 * Ver docs/PLAN_AGENTE_BANCARIO.md.
 */
export async function recordAgentTransaction(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    tenantId: string,
    userId: string,
    agentTxId: string,
    direction: 'IN' | 'OUT',
    amount: number,
    commission: number,
    description: string
) {
    const lines = direction === 'IN'
        ? [
            { accountCode: '1.1.1', debit: amount, credit: 0 },
            { accountCode: '2.1.12', debit: 0, credit: amount },
        ]
        : [
            { accountCode: '2.1.12', debit: amount, credit: 0 },
            { accountCode: '1.1.1', debit: 0, credit: amount },
        ];
    if (commission > 0) {
        lines.push(
            { accountCode: '1.1.7', debit: commission, credit: 0 },
            { accountCode: '4.1.4', debit: 0, credit: commission },
        );
    }
    await createJournalEntry(tx, tenantId, `Agente bancario: ${description}`, agentTxId, 'AGENT_TX', userId, lines);
}

/**
 * REVERSA de una operación de agente (Fase B): asiento espejo exacto del
 * original — deshace el movimiento principal Y la comisión devengada.
 * `direction` es la dirección de la operación ORIGINAL.
 */
export async function recordAgentReversal(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    tenantId: string,
    userId: string,
    agentTxId: string,
    originalDirection: 'IN' | 'OUT',
    amount: number,
    commission: number,
    description: string
) {
    // Espejo: si el original fue IN (Debe Caja / Haber 2.1.12), la reversa es
    // Debe 2.1.12 / Haber Caja — y viceversa.
    const lines = originalDirection === 'IN'
        ? [
            { accountCode: '2.1.12', debit: amount, credit: 0 },
            { accountCode: '1.1.1', debit: 0, credit: amount },
        ]
        : [
            { accountCode: '1.1.1', debit: amount, credit: 0 },
            { accountCode: '2.1.12', debit: 0, credit: amount },
        ];
    if (commission > 0) {
        lines.push(
            { accountCode: '4.1.4', debit: commission, credit: 0 },
            { accountCode: '1.1.7', debit: 0, credit: commission },
        );
    }
    await createJournalEntry(tx, tenantId, `Reversa agente: ${description}`, agentTxId, 'AGENT_TX_REVERSAL', userId, lines);
}

/**
 * LIQUIDACIÓN DE COMISIONES (Fase B): el banco/red paga a la cuenta bancaria
 * del negocio las comisiones devengadas.
 *   Debe: Bancos (1.1.2) / Haber: Comisiones por Cobrar Corresponsalía (1.1.7)
 * No toca la gaveta (va a cuenta bancaria, no a efectivo).
 */
export async function recordAgentCommissionSettlement(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    tenantId: string,
    userId: string,
    agreementId: string,
    amount: number,
    description: string
) {
    await createJournalEntry(tx, tenantId, `Liquidación comisiones: ${description}`, agreementId, 'AGENT_COMMISSION_SETTLEMENT', userId, [
        { accountCode: '1.1.2', debit: amount, credit: 0 },
        { accountCode: '1.1.7', debit: 0, credit: amount },
    ]);
}

/**
 * DEVOLUCIÓN:
 *   Debe: Devoluciones sobre Ventas (4.1.2) + Inventario (1.1.4)
 *   Haber: Caja (1.1.1) + Costo de Ventas (5.1.1)
 */
export async function recordReturn(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    tenantId: string,
    userId: string,
    returnId: string,
    total: number,
    costTotal: number
) {
    const dTotal = new Decimal(total);
    const salesNeto = dTotal.dividedBy('1.15').toDecimalPlaces(4);
    const ivaAmount = dTotal.minus(salesNeto).toDecimalPlaces(4);

    await createJournalEntry(tx, tenantId, `Devolución #${returnId.slice(0, 8)}`, returnId, 'RETURN', userId, [
        { accountCode: '4.1.2', debit: salesNeto.toNumber(), credit: 0 },
        { accountCode: '2.1.2', debit: ivaAmount.toNumber(), credit: 0 },
        { accountCode: '1.1.4', debit: costTotal, credit: 0 },
        { accountCode: '1.1.1', debit: 0, credit: total },
        { accountCode: '5.1.1', debit: 0, credit: costTotal },
    ]);
}

/**
 * CASTIGO DE CUENTA INCOBRABLE (write-off de una venta a crédito):
 *   Debe: Cuentas Incobrables (5.2.7, gasto) / Haber: Cuentas por Cobrar (1.1.3).
 * Reconoce la pérdida y saca la deuda del activo. `amount` = saldo pendiente.
 * Requiere 5.2.7: el endpoint llama seedChartOfAccounts antes.
 */
export async function recordBadDebt(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    tenantId: string,
    userId: string,
    saleId: string,
    amount: number
) {
    const amt = new Decimal(amount).toDecimalPlaces(2);
    if (amt.lessThanOrEqualTo(0)) return;
    await createJournalEntry(tx, tenantId, `Castigo incobrable #${saleId.slice(0, 8)}`, saleId, 'BAD_DEBT', userId, [
        { accountCode: '5.2.7', debit: amt.toNumber(), credit: 0 },
        { accountCode: '1.1.3', debit: 0, credit: amt.toNumber() },
    ]);
}

/**
 * TOMA FÍSICA (ajuste de inventario por conteo cíclico):
 *   Merma   (Σ pérdidas·costo): Debe Pérdida por Merma (5.1.2) / Haber Inventario (1.1.4).
 *   Sobrante (Σ sobrantes·costo): Debe Inventario (1.1.4) / Haber Sobrantes (4.1.3).
 * Se netea Inventario (1.1.4) en una sola línea para que el asiento quede limpio.
 * `lossValue` y `gainValue` son magnitudes positivas (valuadas al costo promedio).
 * Requiere que 5.1.2/4.1.3 existan: el endpoint llama seedChartOfAccounts antes.
 */
export async function recordStockCountAdjustment(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    tenantId: string,
    userId: string,
    countId: string,
    lossValue: number,
    gainValue: number
) {
    const loss = new Decimal(lossValue).toDecimalPlaces(2);
    const gain = new Decimal(gainValue).toDecimalPlaces(2);
    if (loss.lessThanOrEqualTo(0) && gain.lessThanOrEqualTo(0)) return; // sin discrepancia → sin asiento

    const lines: { accountCode: string; debit: number; credit: number }[] = [];
    if (loss.greaterThan(0)) lines.push({ accountCode: '5.1.2', debit: loss.toNumber(), credit: 0 });
    if (gain.greaterThan(0)) lines.push({ accountCode: '4.1.3', debit: 0, credit: gain.toNumber() });

    // Inventario neteado: sobrante sube (Debe), merma baja (Haber).
    const net = gain.minus(loss); // >0 → Debe; <0 → Haber
    if (net.greaterThan(0)) lines.push({ accountCode: '1.1.4', debit: net.toNumber(), credit: 0 });
    else if (net.lessThan(0)) lines.push({ accountCode: '1.1.4', debit: 0, credit: net.abs().toNumber() });

    await createJournalEntry(
        tx, tenantId, `Toma física #${countId.slice(0, 8)}`, countId, 'STOCK_COUNT', userId, lines
    );
}

/**
 * NÓMINA:
 *   Debe: Gastos de Nómina (5.2.2, = neto + INSS laboral + IR laboral) +
 *         INSS Patronal (5.2.3) + INATEC (5.2.4)
 *   Haber: Caja (1.1.1, neto al trabajador) + Retenciones por Pagar (2.1.7, INSS
 *         laboral retenido) + IR por Pagar (2.1.3, IR retenido) + INSS Patronal
 *         por Pagar (2.1.5) + INATEC por Pagar (2.1.6)
 * Así el gasto de nómina refleja el salario devengado (no solo el neto) y las
 * retenciones del trabajador quedan como pasivo (ligado al cierre IR_LABORAL/INSS).
 */
export async function recordPayroll(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    tenantId: string,
    userId: string,
    payrollId: string,
    netSalary: number,
    inssLaboral: number,
    irLaboral: number,
    inssPatronal: number,
    inatec: number
) {
    // El gasto de nómina = lo que recibe el trabajador + lo retenido a su nombre.
    const gastoNomina = Number((netSalary + inssLaboral + irLaboral).toFixed(2));

    await createJournalEntry(tx, tenantId, `Nómina #${payrollId.slice(0, 8)}`, payrollId, 'PAYROLL', userId, [
        { accountCode: '5.2.2', debit: gastoNomina, credit: 0 },     // Gasto Nómina ↑ (devengado)
        { accountCode: '5.2.3', debit: inssPatronal, credit: 0 },    // INSS Patronal ↑
        { accountCode: '5.2.4', debit: inatec, credit: 0 },          // INATEC ↑
        { accountCode: '1.1.1', debit: 0, credit: netSalary },       // Caja ↓ (neto)
        { accountCode: '2.1.7', debit: 0, credit: inssLaboral },     // Retenciones por Pagar (INSS laboral) ↑
        { accountCode: '2.1.3', debit: 0, credit: irLaboral },       // IR por Pagar ↑
        { accountCode: '2.1.5', debit: 0, credit: inssPatronal },    // INSS Patronal por Pagar ↑
        { accountCode: '2.1.6', debit: 0, credit: inatec },          // INATEC por Pagar ↑
    ]);
}

/**
 * PROVISIÓN DE PRESTACIONES SOCIALES (devengo mensual del pasivo laboral):
 *   Debe: Prestaciones Sociales (5.2.6, gasto)
 *   Haber: Aguinaldo (2.1.9) + Vacaciones (2.1.10) + Indemnización (2.1.11) por Pagar
 * Reconoce cada mes el costo que se acumula para el treceavo mes, las vacaciones
 * y la antigüedad — así el P&L deja de subestimar ~25% el costo laboral.
 */
export async function recordLaborProvision(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    tenantId: string,
    userId: string,
    payrollId: string,
    aguinaldo: number,
    vacaciones: number,
    indemnizacion: number
) {
    // Redondear cada componente a 2 decimales y derivar el total de la suma
    // redondeada → garantiza Σdebe == Σhaber en createJournalEntry.
    const ag = Number(aguinaldo.toFixed(2));
    const vac = Number(vacaciones.toFixed(2));
    const ind = Number(indemnizacion.toFixed(2));
    const total = Number((ag + vac + ind).toFixed(2));
    if (total <= 0) return;

    await createJournalEntry(tx, tenantId, `Provisión prestaciones #${payrollId.slice(0, 8)}`, payrollId, 'PAYROLL_PROVISION', userId, [
        { accountCode: '5.2.6', debit: total, credit: 0 },     // Prestaciones Sociales ↑
        { accountCode: '2.1.9', debit: 0, credit: ag },        // Aguinaldo por Pagar ↑
        { accountCode: '2.1.10', debit: 0, credit: vac },      // Vacaciones por Pagar ↑
        { accountCode: '2.1.11', debit: 0, credit: ind },      // Indemnización por Pagar ↑
    ]);
}

/**
 * PAGO DE AGUINALDO (treceavo mes, exento de INSS/IR):
 *   Debe: Aguinaldo por Pagar (2.1.9) — cancela la provisión acumulada
 *   Haber: Caja (1.1.1)
 */
export async function recordAguinaldoPayment(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    tenantId: string,
    userId: string,
    aguinaldoId: string,
    monto: number
) {
    const m = Number(monto.toFixed(2));
    if (m <= 0) return;
    await createJournalEntry(tx, tenantId, `Aguinaldo #${aguinaldoId.slice(0, 8)}`, aguinaldoId, 'AGUINALDO', userId, [
        { accountCode: '2.1.9', debit: m, credit: 0 },  // Aguinaldo por Pagar ↓
        { accountCode: '1.1.1', debit: 0, credit: m },  // Caja ↓
    ]);
}

/**
 * LIQUIDACIÓN FINAL (finiquito): cancela las provisiones acumuladas y paga.
 *   Debe: Aguinaldo (2.1.9) + Vacaciones (2.1.10) + Indemnización (2.1.11) por Pagar
 *   Haber: Caja (1.1.1)
 */
export async function recordSettlement(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    tenantId: string,
    userId: string,
    settlementId: string,
    aguinaldo: number,
    vacaciones: number,
    indemnizacion: number
) {
    const ag = Number(aguinaldo.toFixed(2));
    const vac = Number(vacaciones.toFixed(2));
    const ind = Number(indemnizacion.toFixed(2));
    const total = Number((ag + vac + ind).toFixed(2));
    if (total <= 0) return;

    const lines: { accountCode: string; debit: number; credit: number }[] = [];
    if (ag > 0) lines.push({ accountCode: '2.1.9', debit: ag, credit: 0 });
    if (vac > 0) lines.push({ accountCode: '2.1.10', debit: vac, credit: 0 });
    if (ind > 0) lines.push({ accountCode: '2.1.11', debit: ind, credit: 0 });
    lines.push({ accountCode: '1.1.1', debit: 0, credit: total }); // Caja ↓

    await createJournalEntry(tx, tenantId, `Liquidación #${settlementId.slice(0, 8)}`, settlementId, 'SETTLEMENT', userId, lines);
}

// ==========================================
// FINANCIAL STATEMENTS
// ==========================================

export async function getBalanceGeneral(tenantId: string) {
    await seedChartOfAccounts(tenantId);

    const accounts = await prisma.account.findMany({
        where: { tenantId },
        orderBy: { code: 'asc' }
    });

    const assets = accounts.filter(a => a.type === 'ASSET');
    const liabilities = accounts.filter(a => a.type === 'LIABILITY');
    const equity = accounts.filter(a => a.type === 'EQUITY');

    // Estado financiero NIIF: acumular y cuadrar con Decimal.js (cero float nativo).
    const sumBalances = (accs: typeof accounts) =>
        accs.reduce((sum, a) => sum.plus(a.balance.toString()), new Decimal(0));

    const totalAssets = sumBalances(assets);
    const totalLiabilities = sumBalances(liabilities);
    const totalEquity = sumBalances(equity);

    // Add net income to equity for balance
    const revenue = accounts.filter(a => a.type === 'REVENUE');
    const expenses = accounts.filter(a => a.type === 'EXPENSE');
    const totalRevenue = sumBalances(revenue);
    const totalExpenses = sumBalances(expenses);
    const netIncome = totalRevenue.minus(totalExpenses);
    const equityPlusIncome = totalEquity.plus(netIncome);

    return {
        assets: assets.map(a => ({ code: a.code, name: a.name, balance: Number(a.balance) })),
        liabilities: liabilities.map(a => ({ code: a.code, name: a.name, balance: Number(a.balance) })),
        equity: equity.map(a => ({ code: a.code, name: a.name, balance: Number(a.balance) })),
        totals: {
            assets: totalAssets.toNumber(),
            liabilities: totalLiabilities.toNumber(),
            equity: totalEquity.toNumber(),
            netIncome: netIncome.toNumber(),
            equityPlusIncome: equityPlusIncome.toNumber(),
            isBalanced: totalAssets.minus(totalLiabilities.plus(equityPlusIncome)).abs().lessThan('0.01'),
        }
    };
}

export async function getEstadoResultados(tenantId: string, month?: number, year?: number) {
    await seedChartOfAccounts(tenantId);

    // If month/year provided, aggregate from journal lines for that period
    const whereClause: { tenantId: string } = { tenantId };
    if (month && year) {
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0, 23, 59, 59);
        // Get journal entries for this period
        const entries = await prisma.journalEntry.findMany({
            where: { tenantId, date: { gte: startDate, lte: endDate } },
            include: { lines: { include: { account: true } } }
        });

        let totalRevenue = new Decimal(0);
        let totalCOGS = new Decimal(0);
        let totalExpenses = new Decimal(0);
        const revenueLines: { account: string; amount: number }[] = [];
        const expenseLines: { account: string; amount: number }[] = [];

        for (const entry of entries) {
            for (const line of entry.lines) {
                if (line.account.type === 'REVENUE') {
                    const amount = new Decimal(line.credit.toString()).minus(line.debit.toString());
                    totalRevenue = totalRevenue.plus(amount);
                    revenueLines.push({ account: line.account.name, amount: amount.toNumber() });
                } else if (line.account.type === 'EXPENSE') {
                    const amount = new Decimal(line.debit.toString()).minus(line.credit.toString());
                    if (line.account.code === '5.1.1') totalCOGS = totalCOGS.plus(amount);
                    else totalExpenses = totalExpenses.plus(amount);
                    expenseLines.push({ account: line.account.name, amount: amount.toNumber() });
                }
            }
        }

        return {
            period: `${month}/${year}`,
            revenue: { total: totalRevenue.toNumber(), lines: revenueLines },
            costOfSales: totalCOGS.toNumber(),
            grossProfit: totalRevenue.minus(totalCOGS).toNumber(),
            operatingExpenses: { total: totalExpenses.toNumber(), lines: expenseLines },
            netIncome: totalRevenue.minus(totalCOGS).minus(totalExpenses).toNumber(),
        };
    }

    // All-time from account balances — acumular con Decimal.js (cero float nativo),
    // igual que la rama con periodo, para un estado financiero NIIF consistente.
    const accounts = await prisma.account.findMany({ where: { tenantId }, orderBy: { code: 'asc' } });
    const revenue = accounts.filter(a => a.type === 'REVENUE');
    const expenses = accounts.filter(a => a.type === 'EXPENSE');
    const opExpenses = expenses.filter(a => a.code !== '5.1.1');
    const totalRevenue = revenue.reduce((sum, a) => sum.plus(a.balance.toString()), new Decimal(0));
    const cogsAccount = accounts.find(a => a.code === '5.1.1');
    const totalCOGS = cogsAccount ? new Decimal(cogsAccount.balance.toString()) : new Decimal(0);
    const totalExpenses = opExpenses.reduce((sum, a) => sum.plus(a.balance.toString()), new Decimal(0));

    return {
        period: 'Acumulado',
        revenue: { total: totalRevenue.toNumber(), lines: revenue.map(a => ({ account: a.name, amount: Number(a.balance) })) },
        costOfSales: totalCOGS.toNumber(),
        grossProfit: totalRevenue.minus(totalCOGS).toNumber(),
        operatingExpenses: { total: totalExpenses.toNumber(), lines: opExpenses.map(a => ({ account: a.name, amount: Number(a.balance) })) },
        netIncome: totalRevenue.minus(totalCOGS).minus(totalExpenses).toNumber(),
    };
}

// ==========================================
// RETENCIONES DGI (IR 2%, IMI 1%, IVA RETENIDO)
// ==========================================

const IR_RETENTION_RATE = 0.02;   // 2% sobre compras de bienes/servicios
const IMI_RETENTION_RATE = 0.01;  // 1% impuesto municipal
const IVA_RETENTION_RATE = 0.15;  // 15% IVA retenido (gran contribuyente)

/**
 * Genera retenciones fiscales del periodo desde las compras registradas.
 * Crea registros en FiscalRetention para cada tipo.
 */
export async function generateRetentions(tenantId: string, month: number, year: number, db: AnyTx = prisma) {
    const period = `${year}-${String(month).padStart(2, '0')}`;
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    // Verificar si ya se generaron para este periodo
    const existing = await db.fiscalRetention.count({
        where: { tenantId, period }
    });
    if (existing > 0) {
        return { message: `Retenciones ya generadas para ${period}`, existing: true };
    }

    // Obtener compras del periodo
    const purchases = await db.purchase.findMany({
        where: {
            tenantId,
            date: { gte: startDate, lte: endDate },
        },
        include: {
            supplier: { select: { id: true, name: true } },
        },
    });

    interface RetentionInput {
        tenantId: string; type: string; amount: number; baseAmount: number;
        supplierId: string; purchaseId: string; description: string; period: string;
    }
    const retentions: RetentionInput[] = [];
    let totalIR = new Decimal(0), totalIMI = new Decimal(0), totalIVA = new Decimal(0);

    for (const purchase of purchases) {
        const baseAmount = new Decimal(purchase.subtotal?.toString() ?? purchase.total.toString());
        const tax = new Decimal(purchase.tax?.toString() ?? '0');

        // IR 2% sobre base gravable
        const irAmount = baseAmount.mul(IR_RETENTION_RATE.toString()).toDecimalPlaces(4);
        if (irAmount.greaterThan(0)) {
            retentions.push({
                tenantId,
                type: 'IR_2PCT',
                amount: irAmount.toNumber(),
                baseAmount: baseAmount.toNumber(),
                supplierId: purchase.supplierId,
                purchaseId: purchase.id,
                description: `Retención IR 2% - ${purchase.supplier?.name ?? 'Proveedor'} - Compra #${purchase.id.slice(0, 8)}`,
                period,
            });
            totalIR = totalIR.plus(irAmount);
        }

        // IMI 1% municipal
        const imiAmount = baseAmount.mul(IMI_RETENTION_RATE.toString()).toDecimalPlaces(4);
        if (imiAmount.greaterThan(0)) {
            retentions.push({
                tenantId,
                type: 'IMI_1PCT',
                amount: imiAmount.toNumber(),
                baseAmount: baseAmount.toNumber(),
                supplierId: purchase.supplierId,
                purchaseId: purchase.id,
                description: `Retención IMI 1% - ${purchase.supplier?.name ?? 'Proveedor'} - Compra #${purchase.id.slice(0, 8)}`,
                period,
            });
            totalIMI = totalIMI.plus(imiAmount);
        }

        // IVA Retenido (si aplica)
        if (tax.greaterThan(0)) {
            retentions.push({
                tenantId,
                type: 'IVA_RETENIDO',
                amount: tax.toNumber(),
                baseAmount: baseAmount.toNumber(),
                supplierId: purchase.supplierId,
                purchaseId: purchase.id,
                description: `IVA Retenido - ${purchase.supplier?.name ?? 'Proveedor'} - Compra #${purchase.id.slice(0, 8)}`,
                period,
            });
            totalIVA = totalIVA.plus(tax);
        }
    }

    // Guardar todas las retenciones
    if (retentions.length > 0) {
        await db.fiscalRetention.createMany({ data: retentions });
    }

    return {
        period,
        existing: false,
        purchasesProcessed: purchases.length,
        retentions: {
            ir2pct: { count: purchases.length, total: totalIR.toNumber() },
            imi1pct: { count: purchases.length, total: totalIMI.toNumber() },
            ivaRetenido: { count: retentions.filter(r => r.type === 'IVA_RETENIDO').length, total: totalIVA.toNumber() },
        },
        grandTotal: totalIR.plus(totalIMI).plus(totalIVA).toNumber(),
    };
}

/**
 * Cierre fiscal mensual: genera snapshot del Balance General + P&L
 * y guarda en TaxReport.
 */
export async function fiscalClose(tenantId: string, month: number, year: number, closedBy: string = 'SYSTEM') {
    const period = `${year}-${String(month).padStart(2, '0')}`;

    // Generar estados financieros del periodo
    const balance = await getBalanceGeneral(tenantId);
    const estado = await getEstadoResultados(tenantId, month, year);

    // Reporte fiscal REAL del mes (IVA pagado, IVA neto y total a pagar netos de
    // retenciones sufridas). Reutiliza el motor DGI de nicaTax en vez de fijar
    // ceros que pisarían la fila que saveMonthlyReport ya calcula correctamente.
    const monthly = await generateMonthlyReport(tenantId, month, year);

    const reportData = {
        tenantId,
        month,
        year,
        totalSales: monthly.totalSales,
        totalIVACollected: monthly.totalIVACollected,
        totalIVAPaid: monthly.totalIVAPaid,
        ivaNeto: monthly.ivaNeto,
        anticipoIR: monthly.anticipoIR,
        imiAlcaldia: monthly.imiAlcaldia,
        totalToPay: monthly.totalToPay,
    };

    // Snapshot ANTES del cierre (para el AuditLog inmutable before/after).
    const [existingReport, existingPeriod] = await Promise.all([
        prisma.taxReport.findFirst({ where: { tenantId, month, year } }),
        prisma.fiscalPeriod.findUnique({ where: { tenantId_year_month: { tenantId, year, month } } }),
    ]);

    // Atomicidad del cierre: retenciones + TaxReport + FiscalPeriod + AuditLog en
    // una sola transacción, para no dejar estado parcial ante un fallo intermedio.
    let retentions!: Awaited<ReturnType<typeof generateRetentions>>;
    await prisma.$transaction(async (tx) => {
        // Generar retenciones si no existen (idempotente por conteo del período).
        retentions = await generateRetentions(tenantId, month, year, tx);

        // Guardar o actualizar TaxReport como snapshot del cierre.
        if (existingReport) {
            await tx.taxReport.update({ where: { id: existingReport.id }, data: reportData });
        } else {
            await tx.taxReport.create({ data: reportData });
        }

        // A3: CERRAR el período → ningún asiento futuro puede caer en este mes.
        await tx.fiscalPeriod.upsert({
            where: { tenantId_year_month: { tenantId, year, month } },
            create: { tenantId, year, month, status: 'CLOSED', closedBy, closedAt: new Date() },
            update: { status: 'CLOSED', closedBy, closedAt: new Date(), reopenedBy: null, reopenedAt: null, reopenReason: null },
        });

        // Traza forense inmutable del cierre (análoga al AuditLog del reopen).
        await tx.auditLog.create({
            data: {
                tenantId,
                userId: closedBy,
                action: 'FISCAL_CLOSE',
                details: JSON.stringify({
                    period,
                    month,
                    year,
                    before: {
                        periodStatus: existingPeriod?.status ?? 'OPEN',
                        taxReport: existingReport
                            ? {
                                totalSales: Number(existingReport.totalSales),
                                totalIVACollected: Number(existingReport.totalIVACollected),
                                totalIVAPaid: Number(existingReport.totalIVAPaid),
                                ivaNeto: Number(existingReport.ivaNeto),
                                anticipoIR: Number(existingReport.anticipoIR),
                                imiAlcaldia: Number(existingReport.imiAlcaldia),
                                totalToPay: Number(existingReport.totalToPay),
                            }
                            : null,
                    },
                    after: { periodStatus: 'CLOSED', taxReport: reportData },
                }),
            },
        });
    });

    return {
        period,
        locked: true,
        balance: balance.totals,
        estadoResultados: {
            revenue: estado.revenue.total,
            costOfSales: estado.costOfSales,
            grossProfit: estado.grossProfit,
            operatingExpenses: estado.operatingExpenses.total,
            netIncome: estado.netIncome,
        },
        retentions: retentions.existing ? 'Ya generadas' : retentions.retentions,
        taxes: reportData,
    };
}
