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
    // CAPITAL (3.x.x)
    { code: '3.1.1', name: 'Capital Social', type: 'EQUITY', subtype: null },
    { code: '3.1.2', name: 'Utilidades Retenidas', type: 'EQUITY', subtype: null },
    { code: '3.1.3', name: 'Utilidad del Ejercicio', type: 'EQUITY', subtype: null },
    // INGRESOS (4.x.x)
    { code: '4.1.1', name: 'Ventas', type: 'REVENUE', subtype: null },
    { code: '4.1.2', name: 'Devoluciones sobre Ventas', type: 'REVENUE', subtype: null },
    // GASTOS (5.x.x)
    { code: '5.1.1', name: 'Costo de Ventas', type: 'EXPENSE', subtype: null },
    { code: '5.2.1', name: 'Gastos Operativos', type: 'EXPENSE', subtype: null },
    { code: '5.2.2', name: 'Gastos de Nómina', type: 'EXPENSE', subtype: null },
    { code: '5.2.3', name: 'INSS Patronal (Gasto)', type: 'EXPENSE', subtype: null },
    { code: '5.2.4', name: 'INATEC (Gasto)', type: 'EXPENSE', subtype: null },
    { code: '5.2.5', name: 'Depreciación', type: 'EXPENSE', subtype: null },
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

    // Resolve account IDs
    const accounts = await Promise.all(
        lines.map(l => getAccount(tenantId, l.accountCode))
    );

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
    const subtotal = total - tax;
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
 * NÓMINA:
 *   Debe: Gastos de Nómina (5.2.2) + INSS Patronal (5.2.3) + INATEC (5.2.4)
 *   Haber: Caja (1.1.1) + INSS por Pagar (2.1.5) + INATEC por Pagar (2.1.6)
 */
export async function recordPayroll(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    tenantId: string,
    userId: string,
    payrollId: string,
    netSalary: number,
    inssPatronal: number,
    inatec: number
) {
    const totalCost = netSalary + inssPatronal + inatec;

    await createJournalEntry(tx, tenantId, `Nómina #${payrollId.slice(0, 8)}`, payrollId, 'PAYROLL', userId, [
        { accountCode: '5.2.2', debit: netSalary, credit: 0 },       // Gasto Nómina ↑
        { accountCode: '5.2.3', debit: inssPatronal, credit: 0 },    // INSS Patronal ↑
        { accountCode: '5.2.4', debit: inatec, credit: 0 },          // INATEC ↑
        { accountCode: '1.1.1', debit: 0, credit: netSalary },       // Caja ↓
        { accountCode: '2.1.5', debit: 0, credit: inssPatronal },    // INSS por Pagar ↑
        { accountCode: '2.1.6', debit: 0, credit: inatec },          // INATEC por Pagar ↑
    ]);
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

    const totalAssets = assets.reduce((sum, a) => sum + Number(a.balance), 0);
    const totalLiabilities = liabilities.reduce((sum, a) => sum + Number(a.balance), 0);
    const totalEquity = equity.reduce((sum, a) => sum + Number(a.balance), 0);

    // Add net income to equity for balance
    const revenue = accounts.filter(a => a.type === 'REVENUE');
    const expenses = accounts.filter(a => a.type === 'EXPENSE');
    const totalRevenue = revenue.reduce((sum, a) => sum + Number(a.balance), 0);
    const totalExpenses = expenses.reduce((sum, a) => sum + Number(a.balance), 0);
    const netIncome = totalRevenue - totalExpenses;

    return {
        assets: assets.map(a => ({ code: a.code, name: a.name, balance: Number(a.balance) })),
        liabilities: liabilities.map(a => ({ code: a.code, name: a.name, balance: Number(a.balance) })),
        equity: equity.map(a => ({ code: a.code, name: a.name, balance: Number(a.balance) })),
        totals: {
            assets: totalAssets,
            liabilities: totalLiabilities,
            equity: totalEquity,
            netIncome,
            equityPlusIncome: totalEquity + netIncome,
            isBalanced: Math.abs(totalAssets - (totalLiabilities + totalEquity + netIncome)) < 0.01,
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

    // All-time from account balances
    const accounts = await prisma.account.findMany({ where: { tenantId }, orderBy: { code: 'asc' } });
    const revenue = accounts.filter(a => a.type === 'REVENUE');
    const expenses = accounts.filter(a => a.type === 'EXPENSE');
    const totalRevenue = revenue.reduce((sum, a) => sum + Number(a.balance), 0);
    const cogsAccount = accounts.find(a => a.code === '5.1.1');
    const totalCOGS = cogsAccount ? Number(cogsAccount.balance) : 0;
    const totalExpenses = expenses.filter(a => a.code !== '5.1.1').reduce((sum, a) => sum + Number(a.balance), 0);

    return {
        period: 'Acumulado',
        revenue: { total: totalRevenue, lines: revenue.map(a => ({ account: a.name, amount: Number(a.balance) })) },
        costOfSales: totalCOGS,
        grossProfit: totalRevenue - totalCOGS,
        operatingExpenses: { total: totalExpenses, lines: expenses.filter(a => a.code !== '5.1.1').map(a => ({ account: a.name, amount: Number(a.balance) })) },
        netIncome: totalRevenue - totalCOGS - totalExpenses,
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
export async function generateRetentions(tenantId: string, month: number, year: number) {
    const period = `${year}-${String(month).padStart(2, '0')}`;
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    // Verificar si ya se generaron para este periodo
    const existing = await prisma.fiscalRetention.count({
        where: { tenantId, period }
    });
    if (existing > 0) {
        return { message: `Retenciones ya generadas para ${period}`, existing: true };
    }

    // Obtener compras del periodo
    const purchases = await prisma.purchase.findMany({
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
        await prisma.fiscalRetention.createMany({ data: retentions });
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

    // Generar retenciones si no existen
    const retentions = await generateRetentions(tenantId, month, year);

    // Guardar o actualizar TaxReport como snapshot del cierre
    const existingReport = await prisma.taxReport.findFirst({
        where: { tenantId, month, year }
    });

    const dRevenue = new Decimal(estado.revenue.total);
    const ivaCollected = dRevenue.mul('0.15').dividedBy('1.15').toDecimalPlaces(4);
    const anticipoIR = dRevenue.mul('0.01').toDecimalPlaces(4);
    const imiAlcaldia = dRevenue.mul('0.01').toDecimalPlaces(4);

    const reportData = {
        tenantId,
        month,
        year,
        totalSales: estado.revenue.total,
        totalIVACollected: ivaCollected.toNumber(),
        totalCompras: estado.costOfSales,
        totalIVAPaid: 0,
        ivaNeto: 0,
        anticipoIR: anticipoIR.toNumber(),
        imiAlcaldia: imiAlcaldia.toNumber(),
        totalToPay: 0,
    };

    reportData.ivaNeto = Decimal.max(0, new Decimal(reportData.totalIVACollected).minus(reportData.totalIVAPaid)).toNumber();

    if (existingReport) {
        await prisma.taxReport.update({
            where: { id: existingReport.id },
            data: reportData,
        });
    } else {
        await prisma.taxReport.create({ data: reportData });
    }

    // A3: CERRAR el período → ningún asiento futuro puede caer en este mes.
    await prisma.fiscalPeriod.upsert({
        where: { tenantId_year_month: { tenantId, year, month } },
        create: { tenantId, year, month, status: 'CLOSED', closedBy, closedAt: new Date() },
        update: { status: 'CLOSED', closedBy, closedAt: new Date(), reopenedBy: null, reopenedAt: null, reopenReason: null },
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
