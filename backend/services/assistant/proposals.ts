import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { assertAssistantAccess, AssistantAccessError } from './access.js';
import { preparePurchasePreview, registerPurchase, type PurchasePreview } from '../purchaseRegistrationService.js';
import { invoiceDraftSchema, draftIssues, toPurchaseInput, totalIssues } from './proposalValidation.js';
import { readManualPurchaseSource, assertManualPurchaseSource, appendManualPurchaseEvidence, type ManualPurchaseSource } from './purchaseSource.js';
import type { AssistantPrincipal, AssistantProposalDTO, AssistantOperationDTO, AssistantPurchasePreview, InvoiceDraft } from '../../../shared/assistant';

type Database = PrismaClient | Prisma.TransactionClient;
const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export class AssistantProposalError extends Error {
  constructor(public statusCode: number, public code: string, message: string) { super(message); }
}
const notFound = () => new AssistantProposalError(404, 'PROPOSAL_NOT_FOUND', 'No encontramos esa propuesta para tu sesión.');

function toDTO(row: any): AssistantProposalDTO {
  return {id: row.id, version: row.version, status: row.status,
    source: readManualPurchaseSource(row.source) ? 'MANUAL' : 'DOCUMENT',
    draft: row.draft as InvoiceDraft, issues: row.issues as string[], preview: row.preview as AssistantPurchasePreview | null,
    attachmentIds: row.attachmentIds as string[], expiresAt: row.expiresAt.toISOString(), ...(row.result ? {result: row.result as AssistantOperationDTO} : {})};
}
const owner = (principal: AssistantPrincipal) => ({tenantId: principal.tenantId, userId: principal.userId, roleAtCreation: principal.role});
async function findOwned(principal: AssistantPrincipal, id: string, db: Database) {
  const row = await db.assistantProposal.findFirst({where: {id, ...owner(principal)}});
  if (!row) throw notFound();
  if (row.status !== 'COMMITTED' && row.expiresAt <= new Date()) throw new AssistantProposalError(410, 'PROPOSAL_EXPIRED', 'La propuesta venció. Volvé a preparar el documento.');
  return row;
}
async function assertAttachments(principal: AssistantPrincipal, ids: string[], db: Database) {
  if (!ids.length || ids.length > 10 || new Set(ids).size !== ids.length) throw new AssistantProposalError(400,'INVALID_ATTACHMENTS','La propuesta necesita sus archivos de origen.');
  const count = await db.assistantAttachment.count({where: {id: {in: ids}, ...owner(principal),
    purchaseId: null, status: {in: ['UPLOADED', 'VALIDATED']}, OR: [{expiresAt: null}, {expiresAt: {gt: new Date()}}]}});
  if (count !== ids.length) throw new AssistantProposalError(403,'ATTACHMENT_UNAVAILABLE','No se pudo verificar el archivo de origen.');
}

async function assertProposalEvidence(principal: AssistantPrincipal, row: any, db: Database) {
  const source = readManualPurchaseSource(row.source);
  if (!source) return assertAttachments(principal, row.attachmentIds as string[], db);
  if (!Array.isArray(row.attachmentIds) || row.attachmentIds.length) throw new AssistantProposalError(400, 'PURCHASE_SOURCE_INVALID', 'La procedencia manual de la compra no es válida.');
  await assertManualPurchaseSource(principal, source, db);
}

/** Captura humana de texto: crea sólo un borrador, sin archivo ficticio ni contabilización. */
export async function createProposalFromManual(principal: AssistantPrincipal, draft: InvoiceDraft, rawSource: ManualPurchaseSource, options: {db?: Database; id?: string} = {}) {
  const db = options.db ?? prisma;
  await assertAssistantAccess(principal, 'purchasePrepare', db as PrismaClient);
  const source = readManualPurchaseSource(rawSource);
  if (!source) throw new AssistantProposalError(400, 'PURCHASE_SOURCE_INVALID', 'La compra necesita su conversación de origen.');
  await assertManualPurchaseSource(principal, source, db);
  const safe = invoiceDraftSchema.parse(draft);
  const row = await db.assistantProposal.create({data: {
    id: options.id ?? source.intakeId, ...owner(principal), attachmentIds: [], source: asJson(source), draft: asJson(safe),
    issues: ['Preparada con los datos que declaraste. Revisá los efectos antes de confirmar.'], status: 'DRAFT',
    expiresAt: new Date(Date.now() + 7 * 86400_000),
  }});
  return toDTO(row);
}

/** El llamador usa la transacción del turno; una corrección invalida toda revisión previa. */
export async function updateProposalFromManual(principal: AssistantPrincipal, id: string, draft: InvoiceDraft, nextSource: ManualPurchaseSource, options: {db: Database; expectedVersion: number}) {
  const db = options.db;
  await assertAssistantAccess(principal, 'purchasePrepare', db as PrismaClient);
  const row = await findOwned(principal, id, db);
  const previous = readManualPurchaseSource(row.source), incoming = readManualPurchaseSource(nextSource);
  if (!previous || !incoming) throw new AssistantProposalError(409, 'PURCHASE_SOURCE_CHANGED', 'Esta propuesta no corresponde a una captura manual.');
  await assertProposalEvidence(principal, row, db);
  const source = appendManualPurchaseEvidence(previous, incoming);
  const safe = invoiceDraftSchema.parse(draft);
  const changed = await db.assistantProposal.updateMany({where: {id, ...owner(principal), version: options.expectedVersion,
    status: {in: ['DRAFT', 'READY']}, expiresAt: {gt: new Date()}}, data: {
      draft: asJson(safe), source: asJson(source), status: 'DRAFT', version: {increment: 1}, preview: Prisma.DbNull, payloadHash: null,
      issues: ['La conversación cambió los datos. Volvé a revisar los efectos antes de confirmar.'],
    }});
  if (changed.count !== 1) throw new AssistantProposalError(409, 'PROPOSAL_CHANGED', 'La compra ya se registró o cambió desde tu última revisión. Actualizala antes de continuar.');
  return toDTO(await findOwned(principal, id, db));
}

/** Abandona sólo la propuesta; una compra confirmada nunca se cancela por chat. */
export async function cancelUncommittedProposal(principal: AssistantPrincipal, id: string, expectedVersion: number, tx: Prisma.TransactionClient) {
  await assertAssistantAccess(principal, 'purchasePrepare', tx as PrismaClient);
  const changed = await tx.assistantProposal.updateMany({where: {
    id, ...owner(principal), version: expectedVersion, status: {in: ['DRAFT', 'READY']}, expiresAt: {gt: new Date()},
  }, data: {
    status: 'CANCELLED', version: {increment: 1}, preview: Prisma.DbNull, payloadHash: null,
    issues: ['Dejaste de preparar esta compra desde la conversación. No se registró una compra por esta cancelación.'],
  }});
  if (changed.count !== 1) throw new AssistantProposalError(409, 'PROPOSAL_CHANGED', 'La propuesta cambió o la compra ya se registró. Actualizá su estado antes de continuar.');
}

/** El worker sólo genera un borrador. Nunca valida un pago o recepción por OCR. */
export async function createProposalFromExtraction(principal: AssistantPrincipal, draft: InvoiceDraft, attachmentIds: string[], options: {db?: Database; id?: string; declaredPaymentMethod?: 'CASH' | 'CREDIT'} = {}) {
  const db = options.db ?? prisma;
  await assertAssistantAccess(principal, 'invoicePrepare', db as PrismaClient);
  await assertAttachments(principal, attachmentIds, db);
  const safe = invoiceDraftSchema.parse({...draft, receivedConfirmed: false, paymentConfirmed: false, paymentMethod: options.declaredPaymentMethod});
  const row = await db.assistantProposal.create({data: {
    id: options.id ?? randomUUID(), ...owner(principal), attachmentIds, draft: asJson(safe),
    issues: ['Revisá los datos extraídos y confirmá las condiciones de la compra.'], status: 'DRAFT',
    expiresAt: new Date(Date.now() + 7 * 86400_000),
  }});
  return toDTO(row);
}

export async function getProposal(principal: AssistantPrincipal, id: string, db: PrismaClient = prisma) {
  await assertAssistantAccess(principal, 'invoiceRead', db);
  return toDTO(await findOwned(principal,id,db));
}

function mapPreview(preview: PurchasePreview, draft: InvoiceDraft): AssistantPurchasePreview {
  return {supplierName: preview.supplier.name, warehouseName: preview.warehouseName ?? undefined,
    subtotal: preview.subtotal, tax: preview.tax, total: preview.total,
    stockEffect: draft.purchaseOrderId ? 'ALREADY_RECEIVED' : 'INCREASE',
    cashOut: preview.cashOutflow, payable: preview.payableIncrease, hash: preview.hash,
    ...(preview.shiftId ? {cashShiftId:preview.shiftId,cashShiftLabel:preview.shiftLabel ?? preview.shiftId} : {}),
    lines: preview.lines.map((line,index) => ({productId: line.productId, name: line.productName,
      quantity: draft.items[index].quantity, purchaseUnit: draft.items[index].purchaseUnit,
      baseQuantity: String(line.quantity), unitCost: draft.items[index].unitCost, lineTotal: line.total,
      ...(line.batchNumber ? {batchNumber: line.batchNumber} : {}), ...(line.expiryDate ? {expiryDate: line.expiryDate} : {})})),
  };
}

export async function reviseProposal(principal: AssistantPrincipal, id: string, version: number, raw: unknown, db: PrismaClient = prisma) {
  await assertAssistantAccess(principal, 'invoiceRead', db);
  const existing = await findOwned(principal,id,db);
  await assertAssistantAccess(principal, readManualPurchaseSource(existing.source) ? 'purchasePrepare' : 'invoicePrepare', db);
  if (!['DRAFT','READY'].includes(existing.status) || existing.version !== version) throw new AssistantProposalError(409,'PROPOSAL_CHANGED','La propuesta cambió. Actualizala antes de revisar.');
  await assertProposalEvidence(principal, existing,db);
  const draft = invoiceDraftSchema.parse(raw);
  const issues = draftIssues(draft);
  let preview: AssistantPurchasePreview | null = null;
  if (!issues.length) {
    try {
      const prepared = await preparePurchasePreview({principal,input:toPurchaseInput(draft)},db);
      issues.push(...totalIssues(draft,prepared));
      preview = mapPreview(prepared,draft);
    } catch (error: any) {
      if (error instanceof AssistantAccessError || error?.code === 'PURCHASE_FORBIDDEN') throw error;
      if (error?.name === 'ZodError') issues.push('Revisá fechas, cantidades, costos y vencimiento del crédito.');
      else if (error?.message === 'FACTURA_DUPLICADA') issues.push('Esa factura ya está registrada para el proveedor. Revisala en Compras.');
      else if (typeof error?.message === 'string' && /LOTE_REQUERIDO/.test(error.message)) issues.push('Ingresá lote y vencimiento para los productos que lo requieren.');
      else issues.push('No pudimos validar la compra con su proveedor, catálogo, bodega, recepción o período. Revisá los datos y volvé a intentar.');
    }
  }
  const status = issues.length ? 'DRAFT' : 'READY';
  const changed = await db.assistantProposal.updateMany({where: {id,...owner(principal),version,status:{in:['DRAFT','READY']},expiresAt:{gt:new Date()}},
    data: {version:{increment:1},draft:asJson(draft),issues:asJson(issues),preview:preview ? asJson(preview) : Prisma.DbNull,
      payloadHash: preview?.hash ?? null,status}});
  if (changed.count !== 1) throw new AssistantProposalError(409,'PROPOSAL_CHANGED','Otra revisión modificó la propuesta. Actualizala.');
  return toDTO(await findOwned(principal,id,db));
}

export async function confirmProposal(principal: AssistantPrincipal, id: string, version: number, idempotencyKey: string, db: PrismaClient = prisma): Promise<AssistantOperationDTO> {
  await assertAssistantAccess(principal,'invoiceConfirm',db);
  const row = await findOwned(principal,id,db);
  if (row.version !== version) throw new AssistantProposalError(409,'PROPOSAL_CHANGED','Revisá la versión actual antes de confirmar.');
  if (row.status === 'COMMITTED' && row.result) return {...row.result as unknown as AssistantOperationDTO,replayed:true};
  if (row.status !== 'READY' || !row.payloadHash) throw new AssistantProposalError(409,'PROPOSAL_NOT_READY','Revisá y corregí la propuesta antes de confirmar.');
  const draft = invoiceDraftSchema.parse(row.draft);
  if (draftIssues(draft).length) throw new AssistantProposalError(409,'PROPOSAL_NOT_READY','La propuesta tiene datos pendientes.');
  await assertProposalEvidence(principal,row,db);
  const operation = (purchaseId: string): AssistantOperationDTO => ({id:idempotencyKey,proposalId:id,purchaseId,
    message: 'Compra registrada y comprobante confirmado.',replayed:false});
  try {
    await registerPurchase({principal,input:toPurchaseInput(draft),idempotencyKey,expectedPreviewHash:row.payloadHash,
      beforeCommit: async (tx,purchase) => {
        await assertAssistantAccess(principal,'invoiceConfirm',tx as PrismaClient);
        await assertProposalEvidence(principal,row,tx);
        const changed = await tx.assistantProposal.updateMany({where:{id,...owner(principal),version,status:'READY',payloadHash:row.payloadHash,expiresAt:{gt:new Date()}},
          data:{status:'COMMITTED',operationId:idempotencyKey,result:asJson(operation(purchase.id))}});
        if (changed.count !== 1) throw new AssistantProposalError(409,'PROPOSAL_CHANGED','La propuesta cambió; no se registró esta operación.');
        if (!readManualPurchaseSource(row.source)) {
          const attached = await tx.assistantAttachment.updateMany({where:{id:{in:row.attachmentIds as string[]},...owner(principal),purchaseId:null,
            status:{in:['UPLOADED','VALIDATED']},OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]},data:{purchaseId:purchase.id,expiresAt:null,status:'ATTACHED'}});
          if (attached.count !== (row.attachmentIds as string[]).length) throw new AssistantProposalError(409,'ATTACHMENT_UNAVAILABLE','La evidencia dejó de estar disponible; no se registró la compra.');
        }
      }},db);
  } catch (error) {
    // Otra confirmación concurrente pudo terminar; sólo un comprobante propio
    // persistido de la misma propuesta/versión permite declarar el resultado.
    const current = await findOwned(principal,id,db);
    if (current.status === 'COMMITTED' && current.version === version && current.result) return {...current.result as unknown as AssistantOperationDTO,replayed:true};
    throw error;
  }
  const committed = await findOwned(principal,id,db);
  if (committed.status !== 'COMMITTED' || !committed.result) throw new AssistantProposalError(409,'OPERATION_CONFLICT','Ese identificador pertenece a otro registro. Revisá Compras antes de continuar.');
  return committed.result as unknown as AssistantOperationDTO;
}

export async function getOperation(principal: AssistantPrincipal, key: string, db: PrismaClient = prisma): Promise<AssistantOperationDTO> {
  await assertAssistantAccess(principal,'invoiceRead',db);
  const row = await db.assistantProposal.findFirst({where:{...owner(principal),operationId:key,status:'COMMITTED'}});
  if (!row?.result) throw new AssistantProposalError(404,'OPERATION_NOT_FOUND','Todavía no hay un comprobante confirmado para esa operación. Conservá su referencia.');
  return {...row.result as unknown as AssistantOperationDTO,replayed:true};
}
