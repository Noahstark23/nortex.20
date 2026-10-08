import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({ $transaction: vi.fn() }));
vi.mock('../backend/lib/prisma', () => ({ default: prismaMock }));
vi.mock('../backend/middleware/auth', () => ({ authenticate: (_req: unknown, _res: unknown, next: () => void) => next() }));

const principal = { tenantId: 'tenant-a', userId: 'owner-a', role: 'OWNER' };
const input = () => ({ supplierId: 'supplier-a', notes: 'Reponer mostrador', expectedDate: '2026-09-12',
    items: [{ productId: 'product-a', quantity: '1.25', unitCost: '7.123456' }] });
function fixture() {
    const supplier = { id: 'supplier-a', tenantId: 'tenant-a', name: 'Proveedor local', status: 'ACTIVE', deletedAt: null, currency: 'NIO', leadTimeDays: 2 };
    const user = { id: 'owner-a', tenantId: 'tenant-a', role: 'OWNER', status: 'ACTIVE' };
    const products = [{ id: 'product-a', tenantId: 'tenant-a', name: 'Cable', unit: 'm', saleMode: 'MEASURED', quantityStep: '0.25', cost: 7, stock: 3, packSize: 10, ivaExento: false, requiresBatchTracking: false }];
    const orders: any[] = [];
    const audits: any[] = [];
    const commands: any[] = [];
    let sequence: { lastNumber: bigint } | undefined;
    const tx = {
        $executeRaw: vi.fn(async (_query: any, _tenantId: string, lastNumber: bigint) => { sequence ??= { lastNumber }; return 1; }),
        $queryRaw: vi.fn(async (query: any, ...values: any[]) => {
            const sql = Array.isArray(query) ? query.join('') : query.sql;
            if (!Array.isArray(query)) values = query.values;
            if (sql.includes('FROM `PurchaseOrderDraftSequence`')) return sequence ? [sequence] : [];
            if (sql.includes('FROM `PurchaseOrderDraftCommand`')) return commands.filter(command => command.tenantId === values[0] && command.requestKey === values[1]);
            if (sql.includes('FROM `User`')) return user.tenantId === values[1] && user.id === values[0] ? [user] : [];
            if (sql.includes('FROM `Supplier`')) return supplier.tenantId === values[1] && supplier.id === values[0] ? [supplier] : [];
            if (sql.includes('FROM `Product`')) return products.filter(product => product.tenantId === values[0] && values.slice(1).includes(product.id));
            if (sql.includes('FROM `Tenant`')) return [{ id: 'tenant-a' }];
            if (sql.includes('FROM `PurchaseOrder`')) return [{ maximum: orders.reduce((max, order) => Math.max(max, Number(order.orderNumber.slice(3))), 0) }];
            throw new Error(`Consulta inesperada: ${sql}`);
        }),
        user: { findFirst: vi.fn(async ({ where }: any) => user.id === where.id && user.tenantId === where.tenantId && user.status === where.status ? user : null) },
        supplier: { findFirst: vi.fn(async ({ where }: any) => supplier.id === where.id && supplier.tenantId === where.tenantId ? supplier : null) },
        product: { findMany: vi.fn(async ({ where }: any) => products.filter(product => product.tenantId === where.tenantId && where.id.in.includes(product.id))) },
        purchaseOrderDraftSequence: {
            update: vi.fn(async ({ data }: any) => { sequence = { ...data }; return sequence; }),
        },
        purchaseOrderDraftCommand: {
            createMany: vi.fn(async ({ data }: any) => {
                for (const command of data) if (!commands.some(row => row.tenantId === command.tenantId && row.requestKey === command.requestKey)) commands.push({ ...command, id: `command-${commands.length}`, purchaseOrderId: null, resultJson: null });
                return { count: 1 };
            }),
            updateMany: vi.fn(async ({ where, data }: any) => {
                const command = commands.find(row => Object.entries(where).every(([key, value]) => row[key] === value));
                if (!command) return { count: 0 };
                Object.assign(command, data); return { count: 1 };
            }),
        },
        purchaseOrder: {
            count: vi.fn(async () => orders.length),
            create: vi.fn(async ({ data }: any) => {
                const order = { ...data, id: `po-${orders.length + 1}`, items: data.items.create.map((item: any, i: number) => ({ ...item, id: `item-${i}`, quantityReceived: 0 })) };
                orders.push(order); return order;
            }),
        },
        auditLog: { create: vi.fn(async ({ data }: any) => { audits.push(data); return data; }) },
    };
    prismaMock.$transaction.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
        const previous = { orders: [...orders], audits: [...audits], commands: structuredClone(commands), sequence: sequence && { ...sequence } };
        try { return await callback(tx); } catch (error) {
            orders.splice(0, orders.length, ...previous.orders); audits.splice(0, audits.length, ...previous.audits); commands.splice(0, commands.length, ...previous.commands); sequence = previous.sequence; throw error;
        }
    });
    return { tx, supplier, products, orders, audits, commands, user, db: prismaMock as any };
}
async function createDraft(body: unknown, actor = principal, requestKey?: string) {
    const { default: router } = await import('../backend/routes/purchaseOrders');
    const route = (router as any).stack.find((layer: any) => layer.route?.path === '/' && layer.route.methods.post).route;
    const response = { statusCode: 200, body: undefined as any,
        status(code: number) { this.statusCode = code; return this; },
        json(value: unknown) { this.body = value; return this; },
    };
    const req = { ...actor, body, headers: {}, get: () => requestKey };
    // Ejecuta también authenticate/checkRole para caracterizar el contrato HTTP.
    const dispatch = async (index: number): Promise<any> => route.stack[index]?.handle(req, response, () => dispatch(index + 1));
    await dispatch(0);
    return response;
}
beforeEach(() => vi.clearAllMocks());

describe('POST /api/purchase-orders: caracterización previa a extracción', () => {
    it('crea DRAFT con snapshots exactos y auditoría, sin recibir mercadería', async () => {
        const f = fixture();
        const response = await createDraft({ ...input(), tenantId: 'tenant-ajeno', createdBy: 'otro', status: 'APPROVED' });
        expect(response.statusCode).toBe(201);
        expect(response.body).toMatchObject({ success: true, data: { tenantId: 'tenant-a', createdBy: 'owner-a', status: 'DRAFT', orderNumber: 'OC-0001', notes: 'Reponer mostrador',
            items: [{ productId: 'product-a', productName: 'Cable', quantityOrdered: 1.25, quantityOrderedExact: '1.25', quantityReceivedExact: '0', unitCost: '7.12', unitCostExact: '7.123456', unitAtOrder: 'm', saleModeAtOrder: 'MEASURED', quantityStepAtOrder: '0.25' }] } });
        const productQuery = f.tx.$queryRaw.mock.calls.find(([query]) => !Array.isArray(query) && query.sql.includes('FROM `Product`'))![0];
        expect(productQuery.sql).toContain('WHERE `tenantId` = ? AND id IN (?)');
        expect(productQuery.values).toEqual(['tenant-a', 'product-a']);
        expect(f.audits).toHaveLength(1);
        expect(f.audits[0]).toMatchObject({ tenantId: 'tenant-a', userId: 'owner-a', action: 'PO_CREATED' });
        expect(JSON.parse(f.audits[0].details)).toMatchObject({ before: null, after: { status: 'DRAFT', supplierId: 'supplier-a', itemCount: 1 } });
    });
    it('rechaza proveedor suspendido sin crear OC ni auditoría', async () => {
        const f = fixture(); f.supplier.status = 'SUSPENDED';
        const response = await createDraft(input());
        expect(response.statusCode).toBe(409);
        expect(response.body).toMatchObject({ code: 'SUPPLIER_NOT_ACTIVE' });
        expect(f.orders).toHaveLength(0); expect(f.audits).toHaveLength(0);
    });
    it('rechaza producto ajeno y conserva el código del formulario', async () => {
        const f = fixture(); f.products[0].tenantId = 'otro';
        const response = await createDraft(input());
        expect(response.statusCode).toBe(400);
        expect(response.body).toMatchObject({ code: 'PRODUCT_NOT_IN_TENANT' });
        expect(f.orders).toHaveLength(0);
    });
    it('rechaza duplicados antes de consultar productos', async () => {
        const f = fixture(); const body = input(); body.items.push(body.items[0]);
        const response = await createDraft(body);
        expect(response.statusCode).toBe(400);
        expect(response.body).toMatchObject({ code: 'DUPLICATE_PRODUCT' });
        expect(f.tx.product.findMany).not.toHaveBeenCalled();
    });
    it.each(['CASHIER', 'VIEWER', 'BODEGUERO', 'ACCOUNTANT'])('impide crear al rol %s', async role => {
        const f = fixture(); const response = await createDraft(input(), { ...principal, role });
        expect(response.statusCode).toBe(403); expect(f.orders).toHaveLength(0);
    });
});

describe('servicio compartido de borradores OC', () => {
    const service = () => import('../backend/services/purchaseOrderDraftService');
    const key = 'po-draft-event-1';
    it('prepara cantidades y costo estimado exactos sin escribir', async () => {
        const f = fixture(); const { preparePurchaseOrderDraft } = await service();
        const preview = await preparePurchaseOrderDraft(principal, input(), f.tx as any);
        expect(preview).toMatchObject({ status: 'DRAFT', estimatedSubtotal: '8.90', effects: { stock: false, finance: false }, items: [{ quantity: '1.25', unitCost: '7.123456' }] });
        expect(preview.previewHash).toMatch(/^[a-f0-9]{64}$/);
        expect(f.tx.$queryRaw).not.toHaveBeenCalled();
        expect(f.tx.$executeRaw).not.toHaveBeenCalled();
        expect(f.orders).toHaveLength(0); expect(f.commands).toHaveLength(0); expect(f.audits).toHaveLength(0);
        expect(f.tx.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: principal.userId, tenantId: principal.tenantId, status: 'ACTIVE' } }));
    });
    it('confirma exactamente y recupera el mismo comprobante tras perder respuesta aunque cambie catálogo', async () => {
        const f = fixture(); const { preparePurchaseOrderDraft, executePurchaseOrderDraft } = await service();
        const preview = await preparePurchaseOrderDraft(principal, input(), f.tx as any);
        const beforeCommit = vi.fn(async () => undefined);
        const args = { principal, input: input(), requestKey: key, expectedPreviewHash: preview.previewHash, beforeCommit };
        const first = await executePurchaseOrderDraft(args, f.db);
        f.products[0].cost = 22; f.supplier.status = 'BLOCKED';
        const retry = await executePurchaseOrderDraft(args, f.db);
        expect(first.replayed).toBe(false); expect(retry.replayed).toBe(true);
        expect(retry.purchaseOrder).toEqual(first.purchaseOrder); expect(retry.result).toEqual(first.result);
        expect(f.orders).toHaveLength(1); expect(f.audits).toHaveLength(1); expect(f.commands).toHaveLength(1);
        expect(beforeCommit).toHaveBeenCalledExactlyOnceWith(f.tx, first.purchaseOrder);
    });
    it('la cabecera opcional comparte idempotencia con el formulario', async () => {
        const f = fixture(); const first = await createDraft(input(), principal, key);
        const retry = await createDraft(input(), principal, key);
        expect(first.statusCode).toBe(201); expect(retry.statusCode).toBe(201);
        expect(retry.body.data.id).toBe(first.body.data.id); expect(f.orders).toHaveLength(1);
    });
    it.each(['quantity', 'unitCost', 'notes'])('rechaza reuso del identificador con cambio de %s', async field => {
        const f = fixture(); const { executePurchaseOrderDraft } = await service();
        await executePurchaseOrderDraft({ principal, input: input(), requestKey: key }, f.db);
        const changed = input();
        if (field === 'notes') changed.notes = 'Otra instrucción'; else changed.items[0][field] = '2';
        await expect(executePurchaseOrderDraft({ principal, input: changed, requestKey: key }, f.db)).rejects.toMatchObject({ code: 'PO_IDEMPOTENCY_CONFLICT', httpStatus: 409 });
        expect(f.orders).toHaveLength(1);
    });
    it('no entrega el comprobante a otro usuario con la misma clave', async () => {
        const f = fixture(); const { executePurchaseOrderDraft } = await service();
        await executePurchaseOrderDraft({ principal, input: input(), requestKey: key }, f.db);
        f.user.id = 'owner-b';
        await expect(executePurchaseOrderDraft({ principal: { ...principal, userId: f.user.id }, input: input(), requestKey: key }, f.db)).rejects.toMatchObject({ code: 'PO_IDEMPOTENCY_CONFLICT' });
    });
    it.each(['DISABLED', 'role', 'tenant'])('revalida identidad vigente también al recuperar: %s', async changed => {
        const f = fixture(); const { executePurchaseOrderDraft } = await service();
        await executePurchaseOrderDraft({ principal, input: input(), requestKey: key }, f.db);
        if (changed === 'role') f.user.role = 'VIEWER'; else if (changed === 'tenant') f.user.tenantId = 'tenant-b'; else f.user.status = changed;
        await expect(executePurchaseOrderDraft({ principal, input: input(), requestKey: key }, f.db)).rejects.toMatchObject({ code: 'PO_FORBIDDEN', httpStatus: 403 });
        expect(f.orders).toHaveLength(1);
    });
    it.each(['cost', 'stock', 'packSize', 'name', 'quantityStep', 'supplier'])('invalida revisión con cambio material de %s', async field => {
        const f = fixture(); const { preparePurchaseOrderDraft, executePurchaseOrderDraft } = await service();
        const preview = await preparePurchaseOrderDraft(principal, input(), f.tx as any);
        if (field === 'supplier') f.supplier.leadTimeDays = 9;
        else if (field === 'name') f.products[0].name = 'Cable distinto';
        else if (field === 'quantityStep') f.products[0].quantityStep = '0.05';
        else f.products[0][field] = 11;
        await expect(executePurchaseOrderDraft({ principal, input: input(), requestKey: key, expectedPreviewHash: preview.previewHash }, f.db)).rejects.toMatchObject({ code: 'PO_PREVIEW_CHANGED' });
        expect(f.orders).toHaveLength(0); expect(f.commands).toHaveLength(0);
    });
    it('mantiene la revisión ante el orden incidental de lectura de productos', async () => {
        const f = fixture(); const { preparePurchaseOrderDraft } = await service();
        f.products.push({ ...f.products[0], id: 'product-b', name: 'Clavo' });
        const body = input(); body.items.push({ ...body.items[0], productId: 'product-b' });
        const before = await preparePurchaseOrderDraft(principal, body, f.tx as any); f.products.reverse();
        const after = await preparePurchaseOrderDraft(principal, body, f.tx as any);
        expect(after.previewHash).toBe(before.previewHash);
    });
    it.each(['audit', 'callback', 'receipt'])('aborta borrador y comando juntos cuando falla %s', async failure => {
        const f = fixture(); const { executePurchaseOrderDraft } = await service();
        if (failure === 'audit') f.tx.auditLog.create.mockRejectedValueOnce(new Error('fallo de auditoría'));
        if (failure === 'receipt') f.tx.purchaseOrderDraftCommand.updateMany.mockResolvedValueOnce({ count: 0 });
        const beforeCommit = async () => { if (failure === 'callback') throw new Error('fallo de integración'); };
        await expect(executePurchaseOrderDraft({ principal, input: input(), requestKey: key, beforeCommit }, f.db)).rejects.toThrow();
        expect(f.orders).toHaveLength(0); expect(f.audits).toHaveLength(0); expect(f.commands).toHaveLength(0);
        await executePurchaseOrderDraft({ principal, input: input(), requestKey: key }, f.db);
        expect(f.orders).toHaveLength(1); expect(f.orders[0].orderNumber).toBe('OC-0001');
    });
    it('continúa el máximo correlativo aunque existan huecos y lo lee bajo bloqueo', async () => {
        const f = fixture(); const { executePurchaseOrderDraft } = await service();
        f.orders.push({ id: 'legacy', orderNumber: 'OC-0027' });
        const result = await executePurchaseOrderDraft({ principal, input: input() }, f.db);
        expect(result.purchaseOrder.orderNumber).toBe('OC-0028');
        const queries = f.tx.$queryRaw.mock.calls.map(([query]) => Array.isArray(query) ? query.join('') : query.sql);
        expect(queries.find(sql => sql.includes('FROM `PurchaseOrderDraftSequence`'))).toContain('FOR UPDATE');
        expect(queries.some(sql => sql.includes('FROM `Tenant`'))).toBe(false);
    });
    it('exporta ejecución componible en la transacción recibida sin anidar otra', async () => {
        const f = fixture(); const { executePurchaseOrderDraftInTransaction } = await service();
        await executePurchaseOrderDraftInTransaction({ principal, input: input() }, f.tx as any);
        expect(prismaMock.$transaction).not.toHaveBeenCalled(); expect(f.orders).toHaveLength(1);
    });
    it.each(['2026-02-30', 'not-a-date'])('rechaza fecha civil inválida %s', async expectedDate => {
        fixture(); const response = await createDraft({ ...input(), expectedDate });
        expect(response.statusCode).toBe(400); expect(response.body.code).toBe('PO_INVALID_INPUT');
    });
});
