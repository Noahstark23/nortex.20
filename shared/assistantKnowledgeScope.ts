import type { AssistantCapabilities } from './assistant';

// Exhaustivo: una capacidad nueva debe incorporarse antes de reutilizar ayuda visible.
const relevantCapabilities = {
    enabled: true, help: true, overview: true, inventory: true,
    invoiceRead: true, invoicePrepare: true, invoiceConfirm: true,
    extractionEnabled: true, executionEnabled: true, purchasePrepare: true,
    operations: true, dailyBrief: true, actionPrepare: true, actionConfirm: true,
    promotionManage: true, privateWhatsapp: true, budgetManage: true, cashReview: true,
} satisfies Record<Exclude<keyof AssistantCapabilities, 'accessScope'>, true>;

/** Identidad de autorización de ayuda; no contiene sesión, token ni datos del negocio. */
export function assistantKnowledgeCapabilityScope(capabilities: AssistantCapabilities | null | undefined): string {
    if (!capabilities) return 'unavailable';
    const keys = Object.keys(relevantCapabilities) as Array<keyof typeof relevantCapabilities>;
    return JSON.stringify([capabilities.accessScope ?? '', ...keys.map(key => capabilities[key] === true)]);
}
