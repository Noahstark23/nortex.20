/**
 * NORTEX — Motor Contable de Partida Doble (NIIF PyMES)
 * 
 * Cada transacción del POS genera asientos contables automáticos.
 * El ferretero no ve nada; Nortex construye estados financieros en silencio.
 * 
 * Regla sagrada: SUM(Debe) === SUM(Haber) en cada asiento.
 */

// @ts-ignore
import { PrismaClient } from '@prisma/client';

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
    const existing = await prisma.account.count({ where: { tenantId } });
    if (existing > 0) return; // Already seeded

    await prisma.account.createMany({
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
    console.log(`📊 Chart of Accounts seeded for tenant ${tenantId} (${CHART_OF_ACCOUNTS.length} accounts)`);
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

async function createJournalEntry(
    tx: any,
    tenantId: string,
    description: string,
    referenceId: string,
    referenceType: string,
    userId: string,
    lines: { accountCode: string; debit: number; credit: number }[]
): Promise<void> {
    // Validate: Sum of debits must equal sum of credits
    const totalDebit = lines.reduce((sum, l) => sum + l.debit, 0);
    const totalCredit = lines.reduce((sum, l) => sum + l.credit, 0);
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
        throw new Error(`ASIENTO DESCUADRADO: Debe=${totalDebit.toFixed(2)} Haber=${totalCredit.toFixed(2)}`);
    }

    // Resolve account IDs
    const accounts = await Promise.all(
        lines.map(l => getAccount(tenantId, l.accountCode))
    );

    const entry = await tx.journalEntry.create({
        data: {
            tenantId,
            description,
            referenceId,
            referenceType,
            isAutomatic: true,
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
    tx: any,
    tenantId: string,
    userId: string,
    saleId: string,
    saleTotal: number,
    costTotal: number,
    paymentMethod: string
) {
    const salesNeto = Math.round((saleTotal / 1.15) * 100) / 100;
    const ivaAmount = Math.round((saleTotal - salesNeto) * 100) / 100;

    const cashAccount = paymentMethod === 'CREDIT' ? '1.1.3' : '1.1.1'; // CxC vs Caja
    const description = paymentMethod === 'CREDIT'
        ? `Venta a crédito #${saleId.slice(0, 8)}`
        : `Venta de contado #${saleId.slice(0, 8)}`;

    await createJournalEntry(tx, tenantId, description, saleId, 'SALE', userId, [
        { accountCode: cashAccount, debit: saleTotal, credit: 0 },       // Caja o CxC ↑
        { accountCode: '4.1.1', debit: 0, credit: salesNeto },           // Ventas ↑
        { accountCode: '2.1.2', debit: 0, credit: ivaAmount },           // IVA por Pagar ↑
        { accountCode: '5.1.1', debit: costTotal, credit: 0 },           // Costo de Ventas ↑
        { accountCode: '1.1.4', debit: 0, credit: costTotal },           // Inventario ↓
    ]);
}

/**
 * PAGO DE CLIENTE (abono a crédito):
 *   Debe: Caja (1.1.1)
 *   Haber: Cuentas por Cobrar (1.1.3)
 */
export async function recordPayment(
    tx: any,
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
    tx: any,
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
    tx: any,
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
    tx: any,
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
    tx: any,
    tenantId: string,
    userId: string,
    returnId: string,
    total: number,
    costTotal: number
) {
    const salesNeto = Math.round((total / 1.15) * 100) / 100;
    const ivaAmount = Math.round((total - salesNeto) * 100) / 100;

    await createJournalEntry(tx, tenantId, `Devolución #${returnId.slice(0, 8)}`, returnId, 'RETURN', userId, [
        { accountCode: '4.1.2', debit: salesNeto, credit: 0 },       // Dev/Ventas ↑ (contra-ingreso)
        { accountCode: '2.1.2', debit: ivaAmount, credit: 0 },       // IVA por Pagar ↓
        { accountCode: '1.1.4', debit: costTotal, credit: 0 },       // Inventario ↑
        { accountCode: '1.1.1', debit: 0, credit: total },           // Caja ↓
        { accountCode: '5.1.1', debit: 0, credit: costTotal },       // Costo Ventas ↓
    ]);
}

/**
 * NÓMINA:
 *   Debe: Gastos de Nómina (5.2.2) + INSS Patronal (5.2.3) + INATEC (5.2.4)
 *   Haber: Caja (1.1.1) + INSS por Pagar (2.1.5) + INATEC por Pagar (2.1.6)
 */
export async function recordPayroll(
    tx: any,
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
    const whereClause: any = { tenantId };
    if (month && year) {
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0, 23, 59, 59);
        // Get journal entries for this period
        const entries = await prisma.journalEntry.findMany({
            where: { tenantId, date: { gte: startDate, lte: endDate } },
            include: { lines: { include: { account: true } } }
        });

        let totalRevenue = 0;
        let totalCOGS = 0;
        let totalExpenses = 0;
        const revenueLines: any[] = [];
        const expenseLines: any[] = [];

        for (const entry of entries) {
            for (const line of entry.lines) {
                if (line.account.type === 'REVENUE') {
                    const amount = Number(line.credit) - Number(line.debit);
                    totalRevenue += amount;
                    revenueLines.push({ account: line.account.name, amount });
                } else if (line.account.type === 'EXPENSE') {
                    const amount = Number(line.debit) - Number(line.credit);
                    if (line.account.code === '5.1.1') totalCOGS += amount;
                    else totalExpenses += amount;
                    expenseLines.push({ account: line.account.name, amount });
                }
            }
        }

        return {
            period: `${month}/${year}`,
            revenue: { total: totalRevenue, lines: revenueLines },
            costOfSales: totalCOGS,
            grossProfit: totalRevenue - totalCOGS,
            operatingExpenses: { total: totalExpenses, lines: expenseLines },
            netIncome: totalRevenue - totalCOGS - totalExpenses,
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
