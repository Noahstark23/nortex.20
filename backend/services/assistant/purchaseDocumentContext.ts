import { z } from 'zod';
import Decimal from 'decimal.js';
import { invoiceDraftSchema } from './proposalValidation.js';
import { AssistantDocumentError } from './attachments.js';
import type { InvoiceDraft, InvoiceDraftLine } from '../../../shared/assistant.js';

export interface PurchaseDocumentIntake {
  intakeId: string;
  stateVersion: number;
  draft: InvoiceDraft;
  evidence: string[];
}

export const purchaseDocumentContextSchema = z.object({
  version: z.literal(1),
  conversationId: z.string().min(1).max(191),
  intakeId: z.string().min(1).max(191),
  stateVersion: z.number().int().nonnegative(),
  draft: invoiceDraftSchema,
  evidence: z.array(z.string().max(700)).max(200),
}).strict();

export interface PurchaseDocumentContext extends PurchaseDocumentIntake {
  version: 1;
  conversationId: string;
}

export function createPurchaseDocumentContext(conversationId: string, intake: PurchaseDocumentIntake): PurchaseDocumentContext {
  return purchaseDocumentContextSchema.parse({version: 1, conversationId, ...intake}) as PurchaseDocumentContext;
}

export function parsePurchaseDocumentContext(value: unknown): PurchaseDocumentContext | null {
  if (value === null || value === undefined) return null;
  const parsed = purchaseDocumentContextSchema.safeParse(value);
  if (!parsed.success) throw new AssistantDocumentError('DOCUMENT_CONTEXT_INVALID', 'No se pudo verificar lo declarado antes de adjuntar la factura. Retomá la compra en el chat.', 409);
  return parsed.data as PurchaseDocumentContext;
}

export function hasSamePurchaseDocumentFacts(context: PurchaseDocumentContext, current: PurchaseDocumentIntake | null): boolean {
  if (!current || current.intakeId !== context.intakeId) return false;
  // Zod materializa siempre el mismo orden; comparamos hechos, no cambios de modo del chat.
  return JSON.stringify(invoiceDraftSchema.parse(current.draft)) === JSON.stringify(context.draft);
}

const present = (value: string | undefined): value is string => typeof value === 'string' && value.trim().length > 0;
const normalized = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').trim().replace(/\s+/g, ' ').toLowerCase();
function sameValue(a: string, b: string, numeric = false): boolean {
  if (numeric && /^\d+(?:\.\d+)?$/.test(a) && /^\d+(?:\.\d+)?$/.test(b)) return new Decimal(a).equals(b);
  return normalized(a) === normalized(b);
}
const lineSummary = (line: InvoiceDraftLine) => `${line.description || 'producto sin nombre'} (cantidad ${line.quantity || 'pendiente'}, costo ${line.unitCost || 'pendiente'}, unidad ${line.purchaseUnit})`;

/** El documento se lee por separado; los hechos del chat no sesgan la extracción del proveedor. */
export function mergePurchaseDocumentContext(document: InvoiceDraft, context: PurchaseDocumentContext | null): InvoiceDraft {
  if (!context) return document;
  const declared = context.draft;
  const pendingPrefix = 'Dato pendiente declarado por conversación: ';
  const pending = new Set(declared.warnings.filter(warning => warning.startsWith(pendingPrefix)).map(warning => warning.slice(pendingPrefix.length)));
  // Los faltantes del chat se recalculan desde la propuesta; no quedan avisos obsoletos tras leer la factura.
  const warnings = [...document.warnings, ...declared.warnings.filter(warning => !warning.startsWith(pendingPrefix)).map(warning => `Conversación: ${warning}`)];
  const result: InvoiceDraft = {...document, items: document.items.map(line => ({...line})), receivedConfirmed: false, paymentConfirmed: false};
  const conflict = (label: string, fromChat: string, fromDocument: string) => {
    warnings.push(`Diferencia en ${label}: conversación «${fromChat}»; documento «${fromDocument}». Revisá ambos valores.`);
  };
  const merge = (fromChat: string | undefined, fromDocument: string | undefined, label: string, numeric = false) => {
    if (!present(fromChat)) return fromDocument;
    if (!present(fromDocument)) return fromChat;
    if (!sameValue(fromChat, fromDocument, numeric)) conflict(label, fromChat, fromDocument);
    return fromDocument;
  };
  for (const [key, label, numeric] of [
    ['supplierName', 'proveedor', false], ['invoiceNumber', 'número de factura', false],
    ['date', 'fecha de compra', false], ['postingDate', 'fecha contable', false], ['dueDate', 'fecha de vencimiento del crédito', false],
    ['documentSubtotal', 'subtotal', true], ['documentTax', 'IVA', true], ['documentTotal', 'total', true],
    ['discount', 'descuento', true], ['freight', 'flete', true], ['otherCharges', 'otros cargos', true],
  ] as const) {
    const value = merge(declared[key], document[key], label, numeric);
    if (value !== undefined) result[key] = value;
  }
  const currency = (value: string) => ['NIO', 'C$'].includes(value.trim().toUpperCase()) ? 'NIO' : value;
  result.currency = merge(currency(declared.currency), currency(document.currency), 'moneda') ?? '';
  result.paymentMethod = merge(declared.paymentMethod, document.paymentMethod, 'condición de pago') as InvoiceDraft['paymentMethod'];

  const matched = new Set<number>();
  result.items = result.items.map(line => {
    const matches = declared.items.flatMap((item, index) => present(item.description) && normalized(item.description) === normalized(line.description) ? [index] : []);
    if (!present(line.description) && document.items.length === 1 && declared.items.length === 1) matches.push(0);
    const duplicatedDocumentDescription = document.items.filter(item => normalized(item.description) === normalized(line.description)).length > 1;
    if (matches.length !== 1 || duplicatedDocumentDescription) return line;
    const index = matches[0], previous = declared.items[index];
    matched.add(index);
    // Ningún ID de catálogo, bodega u OC viaja de la conversación a la propuesta documental.
    const label = (line.description || previous.description).slice(0, 120);
    if (pending.has(`items.${index}.purchaseUnit`)) warnings.push(`La unidad declarada para ${label} no estaba confirmada. El documento indica ${line.purchaseUnit}; revisá BASE/PACK contra el producto elegido antes de registrar.`);
    return {...line,
      description: line.description || previous.description,
      quantity: merge(previous.quantity, line.quantity, `cantidad de ${label}`, true) ?? '',
      unitCost: merge(previous.unitCost, line.unitCost, `costo de ${label}`, true) ?? '',
      purchaseUnit: merge(pending.has(`items.${index}.purchaseUnit`) ? undefined : previous.purchaseUnit, line.purchaseUnit, `unidad de ${label}`) as InvoiceDraftLine['purchaseUnit'],
      batchNumber: merge(previous.batchNumber, line.batchNumber, `lote de ${label}`),
      expiryDate: merge(previous.expiryDate, line.expiryDate, `vencimiento de ${label}`),
    };
  });
  for (const [index, line] of declared.items.entries()) {
    if (!matched.has(index)) {
      const printed = document.items.length === 1 ? ` Documento: ${lineSummary(document.items[0])}.` : '';
      warnings.push(`No se pudo relacionar sin ambigüedad lo declarado: ${lineSummary(line)}.${printed} Revisá su correspondencia con el documento; no se agregaron renglones por suposición.`);
    }
  }
  if (declared.supplierId || declared.warehouseId || declared.purchaseOrderId || declared.items.some(line => line.productId || line.purchaseOrderItemId)) {
    warnings.push('Volvé a revisar las selecciones de catálogo, proveedor, bodega y recepción en la propuesta documental.');
  }
  result.warnings = [...new Set(warnings)];
  if (result.warnings.length > 100 || result.warnings.some(warning => warning.length > 500)) throw new AssistantDocumentError('DOCUMENT_CONTEXT_LIMIT', 'Hay demasiadas diferencias para unir la conversación y la factura. Revisá la compra manualmente.');
  const source = context.evidence.length ? context.evidence.join(' | ') : declared.items.map(lineSummary).join(' | ');
  result.notes = [document.notes, declared.notes, `Declarado antes de adjuntar: ${source}`].filter(Boolean).join('\n').slice(0, 500);
  return result;
}
