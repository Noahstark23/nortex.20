import { describe, expect, it, vi } from 'vitest';
import { matchesSavedProposal, saveAssistantProposal } from '../hooks/assistantProposalRecovery';
import type { AssistantProposalDTO } from '../shared/assistant';

const proposal = (): AssistantProposalDTO => ({ id: 'p1', version: 1, status: 'DRAFT', source: 'DOCUMENT', expiresAt: '2026-09-25T00:00:00Z', attachmentIds: ['a1'], issues: [], preview: null,
    draft: { currency: 'NIO', invoiceNumber: '', date: '', receivedConfirmed: false, paymentConfirmed: false, documentTotal: '', warnings: [], items: [{ description: 'Cemento', quantity: '50', unitCost: '', purchaseUnit: 'BASE' }] } });
describe('recuperación de revisión de propuesta', () => {
    it('respuesta perdida hace sólo GET y recupera la versión exacta conservada', async () => {
        const previous = proposal(), saved = { ...previous, version: 2 };
        const request = vi.fn().mockRejectedValueOnce(new Error('Red interrumpida')).mockResolvedValueOnce(saved);
        expect(await saveAssistantProposal(request, previous, previous.draft)).toBe(saved);
        expect(request.mock.calls.map(([, init]) => init?.method ?? 'GET')).toEqual(['PATCH', 'GET']);
    });
    it.each(['quantity', 'version', 'id', 'received'])('no adopta cambios ajenos (%s) ni repite la escritura', async field => {
        const previous = proposal(), saved = structuredClone({ ...previous, version: 2 });
        if (field === 'quantity') saved.draft.items[0].quantity = '40';
        if (field === 'version') saved.version = 3;
        if (field === 'id') saved.id = 'other';
        if (field === 'received') saved.draft.receivedConfirmed = true;
        const error = new Error('Red interrumpida'), request = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(saved);
        await expect(saveAssistantProposal(request, previous, previous.draft)).rejects.toBe(error);
        expect(previous.draft.items[0].quantity).toBe('50'); expect(request).toHaveBeenCalledTimes(2);
    });
    it.each(['exact', 'choice', 'reason', 'version', 'missing'])('recupera una decisión sólo con comprobante coincidente (%s)', async variant => {
        const previous = proposal(), document = structuredClone(previous.draft);
        document.items[0].quantity = '40';
        previous.documentReview = { version: 1, declared: structuredClone(previous.draft), document,
            hasUnresolved: true, conflicts: [{ id: 'quantity-0', kind: 'VALUE', path: 'items.0.quantity', label: 'Cantidad', declaredValue: '50', documentValue: '40', status: 'PENDING' }] };
        const saved = structuredClone({ ...previous, version: 2 });
        saved.draft.items[0].quantity = '40'; saved.documentReview!.hasUnresolved = false;
        saved.documentReview!.conflicts[0] = { ...previous.documentReview.conflicts[0], status: 'RESOLVED',
            resolution: { conflictId: 'quantity-0', choice: 'DOCUMENT', reason: 'Verifiqué la factura', proposalVersion: 2, resolvedBy: 'user-1', resolvedAt: '2026-09-19T00:00:00Z' } };
        const resolution = saved.documentReview!.conflicts[0].resolution!;
        if (variant === 'choice') resolution.choice = 'DECLARED';
        if (variant === 'reason') resolution.reason = 'Otra revisión';
        if (variant === 'version') resolution.proposalVersion = 3;
        if (variant === 'missing') delete saved.documentReview!.conflicts[0].resolution;
        const error = new Error('Respuesta perdida'), request = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(saved);
        const promise = saveAssistantProposal(request, previous, previous.draft, [{ conflictId: 'quantity-0', choice: 'DOCUMENT', reason: ' Verifiqué la factura ' }]);
        if (variant === 'exact') expect(await promise).toBe(saved);
        else await expect(promise).rejects.toBe(error);
        expect(request.mock.calls.map(([, init]) => init?.method ?? 'GET')).toEqual(['PATCH', 'GET']);
        expect(previous.draft.items[0].quantity).toBe('50');
    });
    it('no consulta ni reintenta una denegación de permiso', async () => {
        const request = vi.fn().mockRejectedValue({ status: 403 }); const previous = proposal();
        await expect(saveAssistantProposal(request, previous, previous.draft)).rejects.toEqual({ status: 403 }); expect(request).toHaveBeenCalledTimes(1);
    });
    it('normalización no convierte recepción o pago desconocidos en confirmados', () => {
        const previous = proposal(), draft = { ...previous.draft, invoiceNumber: ' F-1 ' }, saved = { ...previous, version: 2, draft: { ...draft, invoiceNumber: 'F-1' } };
        expect(matchesSavedProposal(previous, saved, draft)).toBe(true);
        expect(matchesSavedProposal(previous, { ...saved, draft: { ...saved.draft, paymentConfirmed: true } }, draft)).toBe(false);
    });
});
