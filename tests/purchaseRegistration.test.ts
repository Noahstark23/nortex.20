import Decimal from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';
import { registerPurchase, preparePurchasePreview } from '../backend/services/purchaseRegistrationService';

const runtime = vi.hoisted(() => ({ current: null as any }));
vi.mock('../backend/services/accounting', () => ({
    recordPurchase: (...args: any[]) => runtime.current.context.recordPurchase(...args),
    assertPeriodOpen: vi.fn(async () => undefined),
}));
vi.mock('../backend/services/stockService', async importOriginal => {
    const actual = await importOriginal<typeof import('../backend/services/stockService')>();
    return { ...actual,
        applyStockDelta: (...args: any[]) => runtime.current.context.applyStockDelta(...args),
        asegurarBodegaPorDefecto: (...args: any[]) => runtime.current.context.asegurarBodegaPorDefecto(...args),
        resolveOperationalWarehouse: (...args: any[]) => runtime.current.context.resolveOperationalWarehouse(...args),
    };
});
vi.mock('../backend/services/procurementMatchService', () => ({
    executeProcurementMatch: (...args: any[]) => runtime.current.context.executeProcurementMatch(...args),
}));
vi.mock('../backend/services/productBatchWarehouseLedgerService', () => ({
    applyBatchWarehouseDelta: (...args: any[]) => runtime.current.context.applyBatchWarehouseDelta(...args),
    resolveBatchWarehouseLedgerMode: (...args: any[]) => runtime.current.context.resolveBatchWarehouseLedgerMode(...args),
}));
vi.mock('../backend/services/supplierPayment', async importOriginal => {
    const actual = await importOriginal<typeof import('../backend/services/supplierPayment')>();
    return { ...actual, registrarSalidaDeCajaPorCompra: (...args: any[]) => runtime.current.context.registrarSalidaDeCajaPorCompra(...args) };
});

const input = (overrides: Record<string, unknown> = {}) => ({
    supplierId: 'supplier-1', warehouseId: 'warehouse-1', invoiceNumber: 'FAC-001',
    date: '2026-09-05', dueDate: '2026-10-05', paymentMethod: 'CREDIT',
    items: [{ productId: 'product-1', quantity: '2', unitCost: '10', purchaseUnit: 'BASE' }],
    ...overrides,
});
const principal = { tenantId: 'tenant-1', userId: 'user-1', role: 'OWNER' };

function fixture() {
    const events: string[] = [];
    const state: any = { purchases: [], commands: [], stock: 5, cost: 4 };
    const product = { id: 'product-1', name: 'Tornillo', unit: 'unidad', ivaExento: false,
        requiresBatchTracking: false, saleMode: 'COUNTED', quantityStep: '1', packUnit: 'caja', packSize: 10 };
    const db: any = {
        account: { findUnique: vi.fn(async () => ({ id: 'account-1' })) },
        user: { findFirst: vi.fn(async () => ({ ...principal, id: principal.userId, status: 'ACTIVE' })) },
        tenant: { findUnique: vi.fn(async () => ({ fiscalRegime: 'GENERAL' })) },
        supplier: { findFirst: vi.fn(async () => ({ id: 'supplier-1', name: 'Proveedor', status: 'ACTIVE', deletedAt: null })) },
        shift: { findFirst: vi.fn(async () => ({ id: 'shift-1' })) },
        product: { findMany: vi.fn(async () => [product]), update: vi.fn(async ({ data }) => { state.cost = data.cost; }) },
        purchaseOrder: { findFirst: vi.fn(async () => null) },
        purchase: {
            findFirst: vi.fn(async ({ where }) => state.purchases.find(p => where.id ? p.id === where.id : p.invoiceNumber === where.invoiceNumber) ?? null),
            create: vi.fn(async ({ data }) => {
                events.push('purchase');
                const row = { ...data, id: 'purchase-1', items: data.items.create,
                    supplier: { id: 'supplier-1', name: 'Proveedor' } };
                state.purchases.push(row); return row;
            }),
        },
        purchaseItem: {
            findMany: vi.fn(async () => state.purchases.at(-1)?.items ?? []),
            updateMany: vi.fn(async () => ({ count: 1 })),
        },
        purchaseCommand: {
            createMany: vi.fn(async ({ data }) => {
                const command = data[0];
                if (state.commands.some(c => c.tenantId === command.tenantId && c.requestKey === command.requestKey)) return { count: 0 };
                state.commands.push({ ...command, id: 'command-1', purchaseId: null, result: null }); return { count: 1 };
            }),
            updateMany: vi.fn(async ({ where, data }) => {
                const command = state.commands.find(c => c.tenantId === where.tenantId && c.requestKey === where.requestKey);
                if (!command) return { count: 0 }; Object.assign(command, data); return { count: 1 };
            }),
        },
        productBatch: { upsert: vi.fn(async () => ({ id: 'batch-1' })), findMany: vi.fn(async () => []) },
        auditLog: { create: vi.fn(async () => { events.push('audit'); return { id: 'audit-1' }; }) },
        kardexMovement: { create: vi.fn(async () => { events.push('kardex'); }) },
        $queryRaw: vi.fn(async (strings: TemplateStringsArray | { strings: string[] }, ...values: unknown[]) => {
            const sql = ('strings' in strings ? strings.strings : strings).join('?');
            if (sql.includes('FROM `User`')) return [{ ...principal, id: principal.userId, status: 'ACTIVE' }];
            if (sql.includes('FROM `PurchaseCommand`')) return state.commands.filter(c => c.tenantId === values[0] && c.requestKey === values[1]);
            return sql.includes('SELECT cost') ? [{ cost: state.cost }] : [{ id: 'supplier-1' }];
        }),
        $transaction: vi.fn(async (run: (tx: any) => Promise<unknown>) => {
            const before = structuredClone(state);
            try { return await run(db); } catch (error) { Object.assign(state, before); throw error; }
        }),
    };
    const recordPurchase = vi.fn(async () => { events.push('journal'); });
    const applyStockDelta = vi.fn(async (_tx: any, { delta }: { delta: number }) => {
        events.push('stock'); const stockBefore = state.stock; state.stock += delta;
        return { stockBefore, stockAfter: state.stock, warehouseId: 'warehouse-1' };
    });
    const context = {
        asegurarBodegaPorDefecto: vi.fn(),
        resolveOperationalWarehouse: vi.fn(async () => ({ id: 'warehouse-1', name: 'Principal', isDefault: true })),
        resolveBatchWarehouseLedgerMode: vi.fn(async () => 'OFF'), applyBatchWarehouseDelta: vi.fn(),
        executeProcurementMatch: vi.fn(async () => ({ matchStatus: 'NOT_REQUIRED', paymentHold: false, priceTolerancePct: '0', plan: { expectedAmount: '20' } })),
        recordPurchase, applyStockDelta,
        registrarSalidaDeCajaPorCompra: vi.fn(async () => { events.push('cash'); return { efectivoAntes: new Decimal(100), efectivoDespues: new Decimal(77) }; }),
    };
    return { db, state, events, product, context };
}

async function register(fake: ReturnType<typeof fixture>, body: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    runtime.current = fake;
    return registerPurchase({ principal, input: body, ...extra }, fake.db);
}

describe('registro de compra — caracterización conservada contra el servicio importado', () => {
    it('crédito persiste C$23, aumenta stock dos y audita después del asiento', async () => {
        const fake = fixture(); const result = await register(fake, input());
        expect(result.purchase).toMatchObject({ total: '23.00', tax: '3.00', balanceDue: '23.00', status: 'PENDING_PAYMENT', paymentMethod: 'CREDIT' });
        expect(fake.state.stock).toBe(7);
        expect(fake.events).toEqual(['purchase', 'stock', 'kardex', 'journal', 'audit']);
    });
    it('contado exige caja antes de cualquier compra', async () => {
        const fake = fixture(); fake.db.shift.findFirst.mockResolvedValue(null);
        await expect(register(fake, input({ paymentMethod: 'CASH' }))).rejects.toThrow('No hay caja abierta');
        expect(fake.db.purchase.create).not.toHaveBeenCalled();
    });
    it('un producto ajeno y un proveedor deshabilitado no crean efectos', async () => {
        const fake = fixture(); fake.db.product.findMany.mockResolvedValue([]);
        await expect(register(fake, input())).rejects.toThrow('Producto no encontrado');
        fake.db.supplier.findFirst.mockResolvedValue(null);
        await expect(register(fake, input())).rejects.toThrow('Proveedor no encontrado');
        expect(fake.events).toEqual([]);
    });
    it('farmacia exige lote y vencimiento', async () => {
        const fake = fixture(); fake.product.requiresBatchTracking = true;
        await expect(register(fake, input())).rejects.toThrow('LOTE_REQUERIDO');
        expect(fake.db.purchase.create).not.toHaveBeenCalled();
    });
    it('factura vinculada a recepción registra dinero sin reingresar stock', async () => {
        const fake = fixture();
        fake.db.purchaseOrder.findFirst.mockResolvedValue({ id: 'po-1', supplierId: 'supplier-1', status: 'RECEIVED',
            items: [{ id: 'poi-1', productId: 'product-1', productName: 'Tornillo', quantityReceived: 2, quantityReceivedExact: '2' }], receipts: [] });
        await register(fake, input({ purchaseOrderId: 'po-1' }));
        expect(fake.state.stock).toBe(5);
        expect(fake.events).toEqual(['purchase', 'journal', 'audit']);
    });
    it('fallo de auditoría revierte compra y stock', async () => {
        const fake = fixture(); fake.db.auditLog.create.mockRejectedValue(new Error('audit failed'));
        await expect(register(fake, input())).rejects.toThrow('audit failed');
        expect(fake.state.purchases).toEqual([]); expect(fake.state.stock).toBe(5);
    });
    it('factura repetida permanece bloqueada', async () => {
        const fake = fixture(); await register(fake, input());
        await expect(register(fake, input())).rejects.toThrow('FACTURA_DUPLICADA');
        expect(fake.state.purchases).toHaveLength(1); expect(fake.state.stock).toBe(7);
    });
    it('contado liquida y mueve caja en la misma transacción', async () => {
        const fake = fixture(); const result = await register(fake, input({ paymentMethod: 'CASH' }));
        expect(result.purchase).toMatchObject({ balanceDue: '0.00', status: 'COMPLETED' });
        expect(result.purchase.paidAt).toBeTruthy();
        expect(fake.events).toEqual(['purchase', 'stock', 'kardex', 'cash', 'journal', 'audit']);
    });
    it('mismo identificador devuelve comprobante idéntico y no repite callback', async () => {
        const fake = fixture(); const beforeCommit = vi.fn();
        const options = { idempotencyKey: 'purchase-attempt-1', beforeCommit };
        const original = await register(fake, input(), options);
        const replay = await register(fake, input(), options);
        expect(original.replayed).toBe(false); expect(replay.replayed).toBe(true);
        expect(replay.purchase).toEqual(original.purchase);
        expect(beforeCommit).toHaveBeenCalledExactlyOnceWith(fake.db, expect.objectContaining({ id: 'purchase-1' }));
        expect(fake.state.stock).toBe(7); expect(fake.state.purchases).toHaveLength(1);
    });
    it('mismo identificador y contenido distinto rechaza sin nuevos efectos', async () => {
        const fake = fixture(); const options = { idempotencyKey: 'purchase-attempt-1' };
        await register(fake, input(), options);
        await expect(register(fake, input({ invoiceNumber: 'FAC-002' }), options))
            .rejects.toMatchObject({ code: 'PURCHASE_IDEMPOTENCY_CONFLICT', httpStatus: 409 });
        expect(fake.state.stock).toBe(7); expect(fake.state.purchases).toHaveLength(1);
    });
    it('rechaza sesión revocada incluso al recuperar un comprobante', async () => {
        const fake = fixture(); const options = { idempotencyKey: 'purchase-attempt-1' };
        await register(fake, input(), options);
        fake.db.user.findFirst.mockResolvedValue(null);
        await expect(register(fake, input(), options)).rejects.toMatchObject({ code: 'PURCHASE_FORBIDDEN', httpStatus: 403 });
    });
    it('el callback fallido revierte compra, stock y reserva de comando', async () => {
        const fake = fixture();
        await expect(register(fake, input(), { idempotencyKey: 'purchase-attempt-1',
            beforeCommit: async () => { throw new Error('proposal changed'); } })).rejects.toThrow('proposal changed');
        expect(fake.state.purchases).toEqual([]); expect(fake.state.commands).toEqual([]); expect(fake.state.stock).toBe(5);
    });
    it('preview no escribe y autoriza los importes desde catálogo', async () => {
        const fake = fixture(); runtime.current = fake;
        const preview = await preparePurchasePreview({ principal, input: input() }, fake.db);
        expect(preview).toMatchObject({ subtotal: '20.00', tax: '3.00', total: '23.00', cashOutflow: '0.00', payableIncrease: '23.00' });
        expect(preview.stockChanges).toEqual([expect.objectContaining({ productId: 'product-1', quantity: '2' })]);
        expect(preview.hash).toMatch(/^[a-f0-9]{64}$/);
        expect(fake.context.asegurarBodegaPorDefecto).not.toHaveBeenCalled();
        expect(fake.state.commands).toEqual([]); expect(fake.events).toEqual([]);
    });
    it('un cambio fiscal tras revisión invalida propuesta antes de registrar', async () => {
        const fake = fixture(); runtime.current = fake;
        const preview = await preparePurchasePreview({ principal, input: input() }, fake.db);
        fake.product.ivaExento = true;
        await expect(register(fake, input(), { expectedPreviewHash: preview.hash }))
            .rejects.toMatchObject({ code: 'PURCHASE_PREVIEW_CHANGED', httpStatus: 409 });
        expect(fake.state.purchases).toEqual([]); expect(fake.state.stock).toBe(5);
    });
    it('revisión válida ejecuta exactamente los efectos consultados', async () => {
        const fake = fixture(); runtime.current = fake;
        const preview = await preparePurchasePreview({ principal, input: input() }, fake.db);
        const result = await register(fake, input(), { expectedPreviewHash: preview.hash });
        expect(result.purchase.total).toBe(preview.total); expect(fake.state.stock).toBe(7);
    });
    it('PACK usa factor del catálogo y preserva el costo promedio', async () => {
        const fake = fixture();
        const result = await register(fake, input({ items: [{ productId: 'product-1', quantity: '2', unitCost: '10', purchaseUnit: 'PACK' }] }));
        expect(result.purchase).toMatchObject({ total: '23.00' });
        expect(result.purchase.items[0]).toMatchObject({ quantityExact: '20', unitCostExact: '1.000000' });
        expect(fake.state.stock).toBe(25); expect(fake.state.cost).toBe(1.6);
    });
    it.each(['CASHIER', 'BODEGUERO', 'ACCOUNTANT', 'VIEWER', 'EMPLOYEE', 'VENDEDOR'])('rechaza rol %s en la autoridad del servicio', async role => {
        const fake = fixture();
        await expect(register(fake, input(), { principal: { ...principal, role } }))
            .rejects.toMatchObject({ code: 'PURCHASE_FORBIDDEN', httpStatus: 403 });
        expect(fake.db.$transaction).not.toHaveBeenCalled();
    });
    it('revalida el usuario con lock antes de escribir aunque la lectura previa pasó', async () => {
        const fake = fixture();
        const queryOriginal = fake.db.$queryRaw.getMockImplementation();
        fake.db.$queryRaw.mockImplementation(async (query: any, ...values: unknown[]) => {
            if (('strings' in query ? query.strings : query).join('?').includes('FROM `User`')) return [{ id: principal.userId, role: 'VIEWER', status: 'ACTIVE' }];
            return queryOriginal(query, ...values);
        });
        await expect(register(fake, input(), { idempotencyKey: 'purchase-attempt-1' }))
            .rejects.toMatchObject({ code: 'PURCHASE_FORBIDDEN', httpStatus: 403 });
        await expect(register(fake, input())).rejects.toMatchObject({ code: 'PURCHASE_FORBIDDEN' });
        expect(fake.state.purchases).toEqual([]); expect(fake.state.commands).toEqual([]);
    });
    it('las consultas de propiedad usan exclusivamente el tenant autenticado', async () => {
        const fake = fixture(); await register(fake, input({ tenantId: 'attacker-tenant' }));
        expect(fake.db.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: principal.userId, tenantId: principal.tenantId, status: 'ACTIVE' } }));
        expect(fake.db.supplier.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'supplier-1', tenantId: principal.tenantId, status: 'ACTIVE', deletedAt: null } }));
        expect(fake.db.product.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['product-1'] }, tenantId: principal.tenantId }, take: 200 }));
        expect(fake.state.purchases[0].tenantId).toBe(principal.tenantId);
    });
    it('un cambio de empaque invalida incluso cuando se solicita BASE', async () => {
        const fake = fixture(); runtime.current = fake;
        const preview = await preparePurchasePreview({ principal, input: input() }, fake.db);
        fake.product.packSize = 12;
        await expect(register(fake, input(), { expectedPreviewHash: preview.hash })).rejects.toMatchObject({ code: 'PURCHASE_PREVIEW_CHANGED' });
        expect(fake.state.stock).toBe(5);
    });
    it('un identificador inválido nunca abre transacción', async () => {
        const fake = fixture();
        await expect(register(fake, input(), { idempotencyKey: '' })).rejects.toMatchObject({ code: 'PURCHASE_INVALID_KEY', httpStatus: 400 });
        await expect(register(fake, input(), { expectedPreviewHash: '' })).rejects.toMatchObject({ code: 'PURCHASE_INVALID_PREVIEW', httpStatus: 400 });
        expect(fake.db.$transaction).not.toHaveBeenCalled();
    });
    it('el vencimiento de un lote existente no puede reinterpretarse al comprar', async () => {
        const fake = fixture(); fake.product.requiresBatchTracking = true;
        fake.db.productBatch.findMany.mockResolvedValue([{ productId: 'product-1', batchNumber: 'LOTE-A', expiryDate: new Date('2027-01-01T12:00:00Z') }]);
        const body = input({ items: [{ productId: 'product-1', quantity: '2', unitCost: '10', batchNumber: 'LOTE-A', expiryDate: '2027-02-01' }] });
        runtime.current = fake;
        await expect(preparePurchasePreview({ principal, input: body }, fake.db)).rejects.toMatchObject({ code: 'BATCH_EXPIRY_CONFLICT' });
        await expect(register(fake, body)).rejects.toMatchObject({ code: 'BATCH_EXPIRY_CONFLICT' });
        expect(fake.state.purchases).toEqual([]); expect(fake.state.stock).toBe(5);
    });
    it('dos líneas del mismo lote con fechas contradictorias tampoco crean existencias', async () => {
        const fake = fixture(); fake.product.requiresBatchTracking = true;
        const row = { productId: 'product-1', quantity: '2', unitCost: '10', batchNumber: 'LOTE-A' };
        await expect(register(fake, input({ items: [{ ...row, expiryDate: '2027-01-01' }, { ...row, expiryDate: '2027-02-01' }] })))
            .rejects.toMatchObject({ code: 'BATCH_EXPIRY_CONFLICT' });
        expect(fake.state.purchases).toEqual([]); expect(fake.state.stock).toBe(5);
    });
});
