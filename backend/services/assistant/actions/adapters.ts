import { createHash } from 'node:crypto';
import { z } from 'zod';
import { PURCHASE_WRITE_ROLES, SUPPLIER_RETURN_WRITE_ROLES } from '../../../middleware/accessPolicies.js';
import { preparePurchaseOrderDraft, executePurchaseOrderDraftInTransaction } from '../../purchaseOrderDraftService.js';
import { prepareBatchWriteoff, executeBatchWriteoffInTransaction } from '../../batchWriteoffService.js';
import { BATCH_WRITEOFF_ROLES } from '../../batchWriteoffPreparation.js';
import { prepareSupplierReturnInTransaction, executeSupplierReturn } from '../../supplierReturnService.js';
import { CreateSupplierReturnSchema, SUPPLIER_RETURN_REASON_CODES } from '../../../validation/supplierReturnSchemas.js';
import { purchasePayloadHash } from '../../purchaseRegistrationAuthority.js';
import type { AssistantJsonObject } from '../../../../shared/assistantOperations.js';
import type { AssistantActionAdapter } from './types.js';

const id = z.string().trim().max(191);
const decimalText = z.string().trim().max(64);
const text = z.string().max(4000);
const json = (value: unknown): AssistantJsonObject => JSON.parse(JSON.stringify(value));
// Guardar un borrador incompleto no convierte sus campos en una operación válida.
export const actionOrderDraftSchema = z.object({
  supplierId: id.optional(), notes: text.nullable().optional(), expectedDate: z.string().max(40).nullable().optional(),
  items: z.array(z.object({productId: id.optional(), quantity: decimalText.optional(), unitCost: decimalText.optional()}).strict()).max(200).default([]),
}).strict();
export const actionWriteoffDraftSchema = z.object({
  batchId: id.optional(), warehouseId: id.optional(), quantity: decimalText.optional(), reason: z.string().max(500).optional(),
  physicalRemovalConfirmed: z.boolean().default(false),
}).strict();
export const actionSupplierReturnDraftSchema = z.object({
  supplierId: id.optional(), reasonCode: z.enum(SUPPLIER_RETURN_REASON_CODES).optional(), reason: z.string().max(1000).optional(),
  supplierReference: z.string().max(191).nullable().optional(), physicalShipmentConfirmed: z.boolean().default(false),
  lines: z.array(z.discriminatedUnion('sourceType', [
    z.object({sourceType: z.literal('DIRECT_PURCHASE_ITEM'), purchaseItemId: id.optional(), quantity: decimalText.optional()}).strict(),
    z.object({sourceType: z.literal('GOODS_RECEIPT_UNMATCHED'), goodsReceiptItemId: id.optional(), quantity: decimalText.optional()}).strict(),
    z.object({sourceType: z.literal('PURCHASE_MATCH_ALLOCATION'), purchaseMatchAllocationId: id.optional(), quantity: decimalText.optional()}).strict(),
  ])).max(100).default([]),
}).strict();

/** UUID estable del comando físico, elegido por el servidor desde la propuesta. */
function eventId(proposalId: string) {
  const hex = createHash('sha256').update(`assistant-action:${proposalId}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
const PREVIEW_EVENT = '00000000-0000-4000-8000-000000000000';

export const purchaseOrderAdapter: AssistantActionAdapter = {
  roles: PURCHASE_WRITE_ROLES,
  parseDraft: raw => json(actionOrderDraftSchema.parse(raw)),
  async prepare(principal, draft, tx) {
    const prepared = await preparePurchaseOrderDraft(principal, draft, tx);
    return {hash: prepared.previewHash, issues: [], preview: {
      summary: `Crear borrador de orden para ${prepared.supplier.name}.`, lines: prepared.items.map(json),
      effects: [{label: 'Subtotal estimado', value: prepared.estimatedSubtotal, unit: 'C$'}, {label: 'Cambio en stock', value: '0'}, {label: 'Cambio en caja y deuda', value: '0', unit: 'C$'}],
      warnings: ['El borrador no aprueba ni envía la orden al proveedor. No recibe mercadería ni registra una compra.'], confirmLabel: 'Crear borrador de orden',
    }};
  },
  async execute(principal, draft, context) {
    const result = await executePurchaseOrderDraftInTransaction({principal, input: draft, requestKey: context.requestKey, expectedPreviewHash: context.domainHash}, context.tx);
    return {resourceId: result.purchaseOrder.id, message: 'Borrador de orden creado. No se recibió mercadería ni se generó deuda.'};
  },
};

export const batchWriteoffAdapter: AssistantActionAdapter = {
  roles: BATCH_WRITEOFF_ROLES,
  parseDraft: raw => json(actionWriteoffDraftSchema.parse(raw)),
  async prepare(principal, draft, tx) {
    const {physicalRemovalConfirmed, ...input} = actionWriteoffDraftSchema.parse(draft);
    const prepared = await prepareBatchWriteoff(principal, input, tx);
    return {hash: prepared.hash, issues: physicalRemovalConfirmed ? [] : ['Confirmá que esta cantidad fue retirada físicamente de la venta.'], preview: {
      summary: `Dar de baja ${prepared.draft.quantity} ${prepared.product.unit} de ${prepared.product.name}.`,
      lines: [json({productId: prepared.product.id, productName: prepared.product.name, quantity: prepared.draft.quantity, unit: prepared.product.unit, batchId: prepared.batch.id, batchNumber: prepared.batch.number, expiryDate: prepared.batch.expiryDate, warehouseId: prepared.warehouse.id, warehouseName: prepared.warehouse.name, batchStockBefore: prepared.batch.stock, warehouseStockBefore: prepared.warehouse.stock})],
      effects: [{label: 'Retiro de existencias', value: prepared.draft.quantity, unit: prepared.product.unit}, {label: 'Pérdida por merma', value: prepared.lossValue, unit: 'C$'}, {label: 'Cambio en caja y deuda', value: '0', unit: 'C$'}],
      warnings: ['La baja registra una salida física y su pérdida contable. No es un bloqueo temporal del lote.'], confirmLabel: 'Registrar baja del lote',
    }};
  },
  async execute(principal, draft, context) {
    const {physicalRemovalConfirmed: _confirmed, batchId, ...input} = actionWriteoffDraftSchema.parse(draft);
    await executeBatchWriteoffInTransaction({principal, batchId: batchId!, input: {...input, clientEventId: eventId(context.proposalId)}, expectedPreviewHash: context.domainHash}, context.tx);
    return {resourceId: batchId, message: 'Baja de lote registrada con su movimiento de inventario y comprobante contable.'};
  },
};

function returnInput(draft: AssistantJsonObject, clientEventId = PREVIEW_EVENT) {
  const {supplierId, physicalShipmentConfirmed, ...input} = actionSupplierReturnDraftSchema.parse(draft);
  if (!supplierId?.trim()) throw new Error('Seleccioná el proveedor de la devolución.');
  return {supplierId, physicalShipmentConfirmed, request: CreateSupplierReturnSchema.parse({...input, clientEventId})};
}
export const supplierReturnAdapter: AssistantActionAdapter = {
  roles: SUPPLIER_RETURN_WRITE_ROLES,
  parseDraft: raw => json(actionSupplierReturnDraftSchema.parse(raw)),
  async prepare(principal, draft, tx) {
    const input = returnInput(draft);
    const prepared = await prepareSupplierReturnInTransaction({tx, ...principal, ...input});
    // Costos libro participan en la huella, pero no se muestran al rol de bodega.
    return {hash: purchasePayloadHash(prepared), issues: input.physicalShipmentConfirmed ? [] : ['Confirmá que la mercadería fue entregada físicamente al proveedor.'], preview: {
      summary: 'Registrar la devolución física al proveedor de origen.',
      lines: prepared.lines.map(line => json({productId: line.productId, productName: line.productNameAtReturn, quantity: line.quantityExact, unit: line.unitAtReturn, sourceType: line.sourceType, sourceId: line.sourceId, warehouseId: line.warehouseId, warehouseName: prepared.warehouses.find(w => w.id === line.warehouseId)?.name ?? line.warehouseId, batchId: line.batchId, batchNumber: line.batchNumberAtReturn, expiryDate: line.expiryDateAtReturn})),
      effects: [{label: 'Cambio en cuentas por pagar', value: '0', unit: 'C$'}, {label: 'Cambio en caja', value: '0', unit: 'C$'}],
      warnings: ['Las cantidades indicadas saldrán del inventario. Una nota de crédito del proveedor se registra aparte; esta devolución no reduce la deuda.'], confirmLabel: 'Registrar devolución física',
    }};
  },
  async execute(principal, draft, context) {
    const input = returnInput(draft, eventId(context.proposalId));
    const result = await executeSupplierReturn({tx: context.tx, ...principal, ...input});
    return {resourceId: result.supplierReturn.id, message: 'Devolución física registrada. La deuda permanece igual hasta registrar la nota de crédito correspondiente.'};
  },
};
