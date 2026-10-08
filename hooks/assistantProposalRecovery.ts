import type { AssistantProposalDTO, InvoiceDraft } from '../shared/assistant';
import type { AssistantDocumentDecision } from '../shared/assistantDocumentReview';
import type { AssistantRequest } from './useNortexAssistant';

function canonical(value: unknown): string {
    const normalize = (item: unknown): unknown => {
        if (Array.isArray(item)) return item.map(normalize);
        if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).filter(([, entry]) => entry !== undefined)
            .sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, key === 'warnings' ? entry : normalize(entry)]));
        return typeof item === 'string' ? item.trim() : item;
    };
    return JSON.stringify(normalize(value));
}

/** Una lectura sólo acredita la revisión perdida si conserva todos los datos y decisiones enviados. */
export function matchesSavedProposal(previous: AssistantProposalDTO, saved: AssistantProposalDTO, draft: InvoiceDraft,
    decisions: AssistantDocumentDecision[] = []): boolean {
    if (saved.id !== previous.id || saved.version !== previous.version + 1 || !['DRAFT', 'READY'].includes(saved.status)) return false;
    const expected = structuredClone(draft);
    if (previous.documentReview) expected.warnings = expected.warnings.filter(warning => !warning.startsWith('Diferencia en '));
    for (const decision of decisions) {
        const conflict = previous.documentReview?.conflicts.find(item => item.id === decision.conflictId);
        const resolution = saved.documentReview?.conflicts.find(item => item.id === decision.conflictId)?.resolution;
        if (!conflict || !resolution || resolution.choice !== decision.choice || resolution.reason !== decision.reason.trim() || resolution.proposalVersion !== saved.version) return false;
        const value = (decision.choice === 'DECLARED' ? conflict.declaredValue : conflict.documentValue) ?? '';
        const line = conflict.path.match(/^items\.(\d+)\.(quantity|unitCost|purchaseUnit|batchNumber|expiryDate)$/);
        if (line) {
            if (!expected.items[Number(line[1])]) return false;
            Object.assign(expected.items[Number(line[1])], { [line[2]]: value });
        } else if (Object.hasOwn(expected, conflict.path)) Object.assign(expected, { [conflict.path]: value });
        else return false;
    }
    return canonical(expected) === canonical(saved.draft);
}

export async function saveAssistantProposal(request: AssistantRequest, previous: AssistantProposalDTO, draft: InvoiceDraft,
    documentDecisions?: AssistantDocumentDecision[]): Promise<AssistantProposalDTO> {
    const path = `/proposals/${encodeURIComponent(previous.id)}`;
    try {
        return await request<AssistantProposalDTO>(path, { method: 'PATCH', body: JSON.stringify({ version: previous.version, draft, ...(documentDecisions ? { documentDecisions } : {}) }) });
    } catch (error) {
        const status = (error as { status?: number })?.status;
        if (!status || status === 409 || status >= 500) {
            try {
                const saved = await request<AssistantProposalDTO>(path);
                if (matchesSavedProposal(previous, saved, draft, documentDecisions)) return saved;
            } catch { /* La falta de evidencia no descarta las correcciones locales ni repite el PATCH. */ }
        }
        throw error;
    }
}
