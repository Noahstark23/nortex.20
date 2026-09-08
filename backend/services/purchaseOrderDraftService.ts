import Decimal from 'decimal.js';
import { Prisma, type PrismaClient } from '@prisma/client';
import prisma from '../lib/prisma';
import { extractPurchaseOrderProductIds, normalizePurchaseOrderLines } from '../../utils/purchaseOrderQuantities';
import { assertPurchaseOrderDraftPrincipal, parsePurchaseOrderDraftInput, parsePurchaseOrderDraftKey,
    purchaseOrderDraftHash, PurchaseOrderDraftError,
    type PurchaseOrderDraftDb, type PurchaseOrderDraftInput, type PurchaseOrderDraftPrincipal } from './purchaseOrderDraftAuthority';
export { purchaseOrderDraftSchema, PurchaseOrderDraftError, type PurchaseOrderDraftPrincipal } from './purchaseOrderDraftAuthority';

export interface PurchaseOrderDraftReceipt { id: string; tenantId: string; status: string; [key: string]: any }
export interface PurchaseOrderDraftResult { purchaseOrder: PurchaseOrderDraftReceipt; result: PurchaseOrderDraftReceipt; replayed: boolean }
export interface ExecutePurchaseOrderDraftOptions {
    principal: PurchaseOrderDraftPrincipal;
    input: unknown;
    requestKey?: string;
    expectedPreviewHash?: string;
    /** Integrador confiable dentro de esta transacción; nunca una llamada externa. */
    beforeCommit?: (tx: Prisma.TransactionClient, order: PurchaseOrderDraftReceipt) => Promise<void>;
}

const supplierSelect = { id: true, name: true, status: true, deletedAt: true, currency: true,
    ruc: true, paymentTermsDays: true, leadTimeDays: true, minimumOrderAmount: true } as const;
const productSelect = { id: true, name: true, sku: true, unit: true, saleMode: true, quantityStep: true,
    cost: true, price: true, wholesalePrice: true, wholesaleMinQty: true, packUnit: true, packSize: true,
    packPrice: true, ivaExento: true, requiresBatchTracking: true, defaultSupplierId: true, stock: true } as const;
type SupplierAuthority = Prisma.SupplierGetPayload<{ select: typeof supplierSelect }>;
type ProductAuthority = Prisma.ProductGetPayload<{ select: typeof productSelect }>;
const selectedFields = (select: Record<string, boolean>) => Prisma.join(Object.keys(select).map(field => Prisma.raw(`\`${field}\``)));

async function prepareResolvedDraft(principal: PurchaseOrderDraftPrincipal, input: PurchaseOrderDraftInput, db: PurchaseOrderDraftDb,
    locked?: { supplier: SupplierAuthority | undefined; products: ProductAuthority[] }) {
    const productIds = extractPurchaseOrderProductIds(input.items);
    const supplier = locked ? locked.supplier : await db.supplier.findFirst({ where: { id: input.supplierId, tenantId: principal.tenantId }, select: supplierSelect });
    if (!supplier) throw new PurchaseOrderDraftError('SUPPLIER_NOT_FOUND', 404, 'Proveedor no encontrado');
    if (supplier.status !== 'ACTIVE' || supplier.deletedAt !== null) {
        throw new PurchaseOrderDraftError('SUPPLIER_NOT_ACTIVE', 409, 'El proveedor no está activo para nuevas órdenes de compra');
    }
    const products = locked ? locked.products : await db.product.findMany({ where: { id: { in: productIds }, tenantId: principal.tenantId }, select: productSelect, take: 200 });
    const lines = normalizePurchaseOrderLines(input.items, products);
    const items = lines.map(item => ({ productId: item.productId, productName: item.productName,
        quantity: item.quantity.toString(), unitCost: item.unitCost.toString(),
        unitAtOrder: item.unitAtOrder, saleModeAtOrder: item.saleModeAtOrder, quantityStepAtOrder: item.quantityStepAtOrder }));
    const preview = {
        status: 'DRAFT' as const, supplier: JSON.parse(JSON.stringify(supplier)), notes: input.notes,
        expectedDate: input.expectedDate ? new Date(input.expectedDate).toISOString() : null,
        items, estimatedSubtotal: lines.reduce((total, item) => total.plus(item.quantity.times(item.unitCost)), new Decimal(0)).toFixed(2),
        effects: { stock: false as const, finance: false as const },
    };
    return { ...preview, previewHash: purchaseOrderDraftHash({ tenantId: principal.tenantId, preview,
        references: [...products].sort((a, b) => a.id.localeCompare(b.id)) }) };
}
export type PurchaseOrderDraftPreview = Awaited<ReturnType<typeof prepareResolvedDraft>>;

/** Solo lecturas: no crea OC, correlativo, bodega ni reserva idempotente. */
export async function preparePurchaseOrderDraft(principal: PurchaseOrderDraftPrincipal, raw: unknown, db: PurchaseOrderDraftDb = prisma): Promise<PurchaseOrderDraftPreview> {
    const input = parsePurchaseOrderDraftInput(raw);
    const prepare = async (tx: Prisma.TransactionClient) => {
        await assertPurchaseOrderDraftPrincipal(tx, principal);
        return prepareResolvedDraft(principal, input, tx);
    };
    return '$transaction' in db
        ? db.$transaction(prepare, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
        : prepare(db);
}

/** El llamador debe confirmar/abortar la misma transacción; jamás captura sus errores para continuar. */
export async function executePurchaseOrderDraftInTransaction(options: ExecutePurchaseOrderDraftOptions, tx: Prisma.TransactionClient): Promise<PurchaseOrderDraftResult> {
    const { principal, beforeCommit, expectedPreviewHash } = options;
    const input = parsePurchaseOrderDraftInput(options.input);
    const requestKey = parsePurchaseOrderDraftKey(options.requestKey);
    if (expectedPreviewHash !== undefined && !/^[a-f0-9]{64}$/.test(expectedPreviewHash)) {
        throw new PurchaseOrderDraftError('PO_INVALID_PREVIEW', 400, 'La revisión de la orden no es válida.');
    }
    // La identidad del comando depende de lo pedido, no del catálogo mutable.
    const payloadHash = purchaseOrderDraftHash(input);
    let commandId: string | undefined;
    // Antes de cualquier FK al usuario: evita upgrades S→X concurrentes al confirmar.
    await assertPurchaseOrderDraftPrincipal(tx, principal, true);
    if (requestKey) {
        await tx.purchaseOrderDraftCommand.createMany({ data: [{ tenantId: principal.tenantId, userId: principal.userId, requestKey, payloadHash }], skipDuplicates: true });
        const [command] = await tx.$queryRaw<Array<{ id: string; userId: string; payloadHash: string; purchaseOrderId: string | null; resultJson: any }>>`SELECT id, userId, payloadHash, purchaseOrderId, resultJson FROM \`PurchaseOrderDraftCommand\` WHERE \`tenantId\` = ${principal.tenantId} AND \`requestKey\` = ${requestKey} FOR UPDATE`;
        if (!command) throw new PurchaseOrderDraftError('PO_COMMAND_UNAVAILABLE', 409, 'No pudimos reservar la operación. Volvé a intentar.');
        if (command.userId !== principal.userId || command.payloadHash !== payloadHash) {
            throw new PurchaseOrderDraftError('PO_IDEMPOTENCY_CONFLICT', 409, 'Ese identificador ya corresponde a otra orden.');
        }
        commandId = command.id;
        if (command.purchaseOrderId) {
            const order = typeof command.resultJson === 'string' ? JSON.parse(command.resultJson) : command.resultJson;
            if (!order || order.id !== command.purchaseOrderId || order.tenantId !== principal.tenantId) {
                throw new PurchaseOrderDraftError('PO_RECEIPT_INVALID', 409, 'El comprobante requiere revisión.');
            }
            return { purchaseOrder: order, result: order, replayed: true };
        }
    }

    const [supplier] = await tx.$queryRaw<SupplierAuthority[]>(Prisma.sql`SELECT ${selectedFields(supplierSelect)} FROM \`Supplier\` WHERE id = ${input.supplierId} AND \`tenantId\` = ${principal.tenantId} FOR UPDATE`);
    const productIds = extractPurchaseOrderProductIds(input.items).sort();
    const products = await tx.$queryRaw<ProductAuthority[]>(Prisma.sql`SELECT ${selectedFields(productSelect)} FROM \`Product\` WHERE \`tenantId\` = ${principal.tenantId} AND id IN (${Prisma.join(productIds)}) ORDER BY id FOR UPDATE`);
    // Las lecturas locking devuelven autoridad vigente aun si el llamador ya creó
    // un snapshot REPEATABLE READ. Normaliza los TINYINT de MySQL a boolean.
    const preview = await prepareResolvedDraft(principal, input, tx, { supplier,
        products: products.map(product => ({ ...product, ivaExento: Boolean(product.ivaExento), requiresBatchTracking: Boolean(product.requiresBatchTracking) })) });
    if (expectedPreviewHash && expectedPreviewHash !== preview.previewHash) {
        throw new PurchaseOrderDraftError('PO_PREVIEW_CHANGED', 409, 'Cambió el proveedor, catálogo o contenido de la orden. Revisá la propuesta otra vez.');
    }
    // Fila exclusiva para el correlativo. Bloquear Tenant aquí convertiría los
    // locks compartidos de sus FKs en un deadlock entre dos borradores nuevos.
    const [legacy] = await tx.$queryRaw<Array<{ maximum: bigint | string | null }>>`SELECT MAX(CAST(SUBSTRING(\`orderNumber\`, 4) AS UNSIGNED)) AS maximum FROM \`PurchaseOrder\` WHERE \`tenantId\` = ${principal.tenantId} AND \`orderNumber\` REGEXP '^OC-[0-9]+$'`;
    // MySQL nativo: el upsert emulado de Prisma compite con P2002 en la primera
    // fila. ON DUPLICATE toma X y conserva al ganador sin upgrades de INSERT IGNORE.
    await tx.$executeRaw`INSERT INTO \`PurchaseOrderDraftSequence\` (\`tenantId\`, \`lastNumber\`) VALUES (${principal.tenantId}, ${BigInt(legacy?.maximum ?? 0)}) ON DUPLICATE KEY UPDATE \`lastNumber\` = \`lastNumber\``;
    const [sequence] = await tx.$queryRaw<Array<{ lastNumber: bigint }>>`SELECT lastNumber FROM \`PurchaseOrderDraftSequence\` WHERE \`tenantId\` = ${principal.tenantId} FOR UPDATE`;
    if (!sequence) throw new PurchaseOrderDraftError('PO_SEQUENCE_UNAVAILABLE', 409, 'No pudimos reservar el número de orden.');
    const next = BigInt(sequence.lastNumber) + 1n;
    await tx.purchaseOrderDraftSequence.update({ where: { tenantId: principal.tenantId }, data: { lastNumber: next } });
    const created = await tx.purchaseOrder.create({ data: {
        tenantId: principal.tenantId, supplierId: input.supplierId, orderNumber: `OC-${String(next).padStart(4, '0')}`,
        status: 'DRAFT', notes: preview.notes, expectedDate: preview.expectedDate ? new Date(preview.expectedDate) : null,
        createdBy: principal.userId, items: { create: preview.items.map(item => ({
            productId: item.productId, productName: item.productName, quantityOrdered: new Decimal(item.quantity).toNumber(),
            quantityOrderedExact: item.quantity, quantityReceivedExact: '0', unitAtOrder: item.unitAtOrder,
            saleModeAtOrder: item.saleModeAtOrder, quantityStepAtOrder: item.quantityStepAtOrder,
            unitCost: new Decimal(item.unitCost).toFixed(2), unitCostExact: item.unitCost,
        })) },
    }, include: { items: true } });
    await tx.auditLog.create({ data: { tenantId: principal.tenantId, userId: principal.userId, action: 'PO_CREATED',
        details: JSON.stringify({ poId: created.id, orderNumber: created.orderNumber, before: null,
            after: { status: created.status, supplierId: created.supplierId, itemCount: created.items.length }, previewHash: preview.previewHash }),
    } });
    const order = JSON.parse(JSON.stringify(created)) as PurchaseOrderDraftReceipt;
    if (beforeCommit) await beforeCommit(tx, order);
    if (commandId) {
        const updated = await tx.purchaseOrderDraftCommand.updateMany({
            where: { id: commandId, tenantId: principal.tenantId, userId: principal.userId, payloadHash, purchaseOrderId: null },
            data: { purchaseOrderId: created.id, resultJson: order },
        });
        if (updated.count !== 1) throw new PurchaseOrderDraftError('PO_COMMAND_CONFLICT', 409, 'No pudimos guardar el comprobante. Volvé a intentar.');
    }
    return { purchaseOrder: order, result: order, replayed: false };
}

/** Una autoridad para formulario y asistente. El borrador no recibe ni paga mercancía. */
export async function executePurchaseOrderDraft(options: ExecutePurchaseOrderDraftOptions, db: PrismaClient = prisma): Promise<PurchaseOrderDraftResult> {
    return db.$transaction(tx => executePurchaseOrderDraftInTransaction(options, tx), { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
