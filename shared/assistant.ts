/** Contrato del asistente interno. Importes/cantidades viajan como texto decimal. */
export interface AssistantPrincipal { tenantId: string; userId: string; role: string }
export interface AssistantCapabilities {
    /** Invalida datos privados locales si cambia el alcance vigente del usuario. */
    accessScope?: string;
  enabled: boolean; help: boolean; overview: boolean; inventory: boolean;
  invoiceRead: boolean; invoicePrepare: boolean; invoiceConfirm: boolean;
  extractionEnabled: boolean; executionEnabled: boolean;
  /** Captura manual de compras; independiente de la lectura pagada de archivos. */
  purchasePrepare?: boolean;
  operations?: boolean; dailyBrief?: boolean; actionPrepare?: boolean; actionConfirm?: boolean;
  promotionManage?: boolean; privateWhatsapp?: boolean;
  budgetManage?: boolean;
  cashReview?: boolean;
}
export interface AssistantCitation { id: string; title: string; section: string; version: string; path: string }
export interface AssistantMetric { key: string; label: string; value: string | null; unit: 'money' | 'count'; status: 'ok' | 'unavailable'; source: string }
export interface AssistantOverview { checkedAt: string; startDate: string; endDate: string; scope: string; metrics: AssistantMetric[] }
export interface AssistantAction { type: 'UPLOAD_INVOICE' | 'CONTINUE_PURCHASE' | 'REVIEW_PURCHASE'; label: string; proposalId?: string }
export interface AssistantPurchaseIntakeDTO { id: string; summary: string; phase: 'CHOOSE_INPUT' | 'COLLECTING' | 'REVIEW'; missing: string[] }
export interface AssistantMessageDTO {
  id: string; role: 'user' | 'assistant'; text: string; createdAt: string;
  citations?: AssistantCitation[]; overview?: AssistantOverview; proposalId?: string;
  actions?: AssistantAction[]; purchaseIntake?: AssistantPurchaseIntakeDTO | null;
  operationalRunId?: string;
}
export interface InvoiceDraftLine {
  productId?: string; description: string; quantity: string; unitCost: string;
  purchaseUnit: 'BASE' | 'PACK'; batchNumber?: string; expiryDate?: string;
  purchaseOrderItemId?: string;
}
export interface InvoiceDraft {
  currency: string; supplierId?: string; supplierName?: string; invoiceNumber: string;
  date: string; postingDate?: string; dueDate?: string; warehouseId?: string;
  purchaseOrderId?: string; paymentMethod?: 'CASH' | 'CREDIT'; notes?: string;
  receivedConfirmed: boolean; paymentConfirmed: boolean;
  documentSubtotal?: string; documentTax?: string; documentTotal: string;
  discount?: string; freight?: string; otherCharges?: string;
  items: InvoiceDraftLine[]; warnings: string[];
}
export interface AssistantPurchasePreview {
  supplierName: string; warehouseName?: string; subtotal: string; tax: string; total: string;
  stockEffect: 'INCREASE' | 'ALREADY_RECEIVED'; cashOut: string; payable: string;
  cashShiftId?: string; cashShiftLabel?: string;
  lines: Array<{productId: string; name: string; quantity: string; purchaseUnit: string; baseQuantity: string; unitCost: string; lineTotal: string; batchNumber?: string; expiryDate?: string}>;
  hash: string;
}
export interface AssistantProposalDTO {
  id: string; version: number; status: 'DRAFT' | 'READY' | 'COMMITTED' | 'CANCELLED' | 'EXPIRED';
  draft: InvoiceDraft; issues: string[]; preview: AssistantPurchasePreview | null;
  attachmentIds: string[]; expiresAt: string; result?: AssistantOperationDTO;
  source?: 'DOCUMENT' | 'MANUAL';
}
export interface AssistantOperationDTO { id: string; proposalId: string; purchaseId: string; message: string; replayed: boolean }
export interface AssistantAttachmentDTO { id: string; name: string; mediaType: string; bytes: number; pages: number; status: string }
export interface AssistantJobDTO { id: string; status: 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED'; proposalId?: string; error?: string }
export interface AssistantConversationDTO { id: string; messages: AssistantMessageDTO[]; actions?: AssistantAction[]; purchaseIntake?: AssistantPurchaseIntakeDTO | null; proposalId?: string }
