import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { AssistantPrincipal, InvoiceDraft } from '../shared/assistant';
import { getAssistantCapabilities } from '../backend/services/assistant/access';
import {
    createProposalFromManual, updateProposalFromManual, reviseProposal, confirmProposal, getProposal, cancelUncommittedProposal,
} from '../backend/services/assistant/proposals';
import type { ManualPurchaseSource } from '../backend/services/assistant/purchaseSource';

const domain = vi.hoisted(() => ({ preview: vi.fn(), register: vi.fn() }));
vi.mock('../backend/services/purchaseRegistrationService.js', () => ({
    preparePurchasePreview: domain.preview, registerPurchase: domain.register,
}));

const principal: AssistantPrincipal = { tenantId: 'tenant-a', userId: 'user-a', role: 'OWNER' };
const future = () => new Date(Date.now() + 86_400_000);
const source = (): ManualPurchaseSource => ({ kind: 'MANUAL', origin: 'NORTEX_CHAT',
    conversationId: 'conversation-a', intakeId: 'intake-a',
    evidence: [{ requestId: '11111111-1111-4111-8111-111111111111', field: 'purchase', suppliedText: 'Compré 2 cajas de tornillos.' }],
});
const draft = (): InvoiceDraft => ({ currency: 'NIO', supplierId: 'supplier-a', invoiceNumber: 'F-MANUAL',
    date: '2026-09-05', dueDate: '2026-10-05', warehouseId: 'warehouse-a', paymentMethod: 'CREDIT',
    receivedConfirmed: true, paymentConfirmed: false, documentSubtotal: '20.00', documentTax: '3.00', documentTotal: '23.00',
    warnings: [], items: [{ productId: 'product-a', description: 'Tornillos', quantity: '2', unitCost: '10', purchaseUnit: 'BASE' }],
});
const proposal = (patch: Record<string, unknown> = {}) => ({ id: 'intake-a', tenantId: 'tenant-a', userId: 'user-a',
    roleAtCreation: 'OWNER', source: source(), attachmentIds: [], draft: draft(), issues: [], version: 1,
    status: 'DRAFT', expiresAt: future(), preview: null, payloadHash: null, result: null, ...patch,
});

/** Dobles de persistencia; permisos, origen, revisión y confirmación usan exports reales. */
function fixture(initial: ReturnType<typeof proposal> | null = null, actor = principal) {
    const state = {
        row: initial ? structuredClone(initial) : null,
        user: { id: actor.userId, tenantId: actor.tenantId, role: actor.role, status: 'ACTIVE' },
        conversation: { id: 'conversation-a', tenantId: actor.tenantId, userId: actor.userId,
            roleAtCreation: actor.role, expiresAt: future() },
        beforeUpdate: undefined as (() => void) | undefined,
    };
    const matches = (row: any, where: any): boolean => !!row && Object.entries(where).every(([key, value]: [string, any]) => {
        if (value && typeof value === 'object' && 'in' in value) return value.in.includes(row[key]);
        if (value && typeof value === 'object' && 'gt' in value) return row[key] > value.gt;
        return row[key] === value;
    });
    const mocks = {
        user: { findFirst: vi.fn(async ({ where }) => matches(state.user, where) ? structuredClone(state.user) : null) },
        assistantTenantConfig: { findUnique: vi.fn(async () => ({ enabled: true, extractionEnabled: true, executionEnabled: true })) },
        employee: { findFirst: vi.fn().mockResolvedValue(null) },
        assistantConversation: { findFirst: vi.fn(async ({ where }) => matches(state.conversation, where) ? structuredClone(state.conversation) : null) },
        assistantProposal: {
            findFirst: vi.fn(async ({ where }) => matches(state.row, where) ? structuredClone(state.row) : null),
            create: vi.fn(async ({ data }) => {
                state.row = proposal({ ...structuredClone(data), source: data.source ?? null, version: 1 });
                return structuredClone(state.row);
            }),
            updateMany: vi.fn(async ({ where, data }) => {
                state.beforeUpdate?.();
                if (!matches(state.row, where)) return { count: 0 };
                for (const [key, value] of Object.entries(data)) {
                    (state.row as any)[key] = key === 'version' ? state.row!.version + (value as { increment: number }).increment
                        : value === Prisma.DbNull ? null : structuredClone(value);
                }
                return { count: 1 };
            }),
        },
        assistantAttachment: { count: vi.fn(async () => 0), updateMany: vi.fn(async () => ({ count: 0 })) },
        purchase: { create: vi.fn() }, purchaseCommand: { create: vi.fn() },
    };
    return { state, mocks, db: mocks as unknown as PrismaClient };
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NORTEX_ASSISTANT_ENABLED', 'true');
    vi.stubEnv('NORTEX_ASSISTANT_EXTRACTION_ENABLED', 'false');
    vi.stubEnv('NORTEX_ASSISTANT_EXECUTION_ENABLED', 'true');
    domain.preview.mockResolvedValue({ supplier: { id: 'supplier-a', name: 'Proveedor A' }, warehouseName: 'Principal',
        subtotal: '20.00', tax: '3.00', total: '23.00', cashOutflow: '0.00', payableIncrease: '23.00', hash: 'a'.repeat(64),
        lines: [{ productId: 'product-a', productName: 'Tornillos', quantity: '2', total: '20.00' }],
    });
    domain.register.mockImplementation(async ({ beforeCommit }, db) => {
        await beforeCommit(db, { id: 'purchase-a' });
        return { replayed: false, purchase: { id: 'purchase-a' }, result: {} };
    });
});
afterEach(() => vi.unstubAllEnvs());

describe('propuestas manuales: autoridad vigente y origen privado', () => {
    it.each(['OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER'])('%s prepara sólo DRAFT sin OCR ni archivo ficticio', async role => {
        const actor = { ...principal, role }, { db, mocks, state } = fixture(null, actor);
        expect(await getAssistantCapabilities(actor, db)).toMatchObject({ purchasePrepare: true, invoicePrepare: false });
        const result = await createProposalFromManual(actor, draft(), source(), { db });
        expect(result).toMatchObject({ id: 'intake-a', source: 'MANUAL', version: 1, status: 'DRAFT', preview: null, attachmentIds: [] });
        expect(state.row).toMatchObject({ tenantId: actor.tenantId, userId: actor.userId, roleAtCreation: role,
            source: source(), draft: draft(), payloadHash: null, result: null });
        expect(mocks.assistantProposal.create).toHaveBeenCalledWith({ data: expect.objectContaining({
            tenantId: actor.tenantId, userId: actor.userId, roleAtCreation: role, source: source(), draft: draft(), status: 'DRAFT', attachmentIds: [],
        }) });
        expect(state.row).not.toHaveProperty('role');
        expect(mocks.assistantAttachment.count).not.toHaveBeenCalled();
        expect(domain.preview).not.toHaveBeenCalled();
        expect(domain.register).not.toHaveBeenCalled();
        expect(mocks.purchase.create).not.toHaveBeenCalled();
        expect(mocks.purchaseCommand.create).not.toHaveBeenCalled();
    });

    it.each(['ACCOUNTANT', 'VIEWER', 'BODEGUERO', 'CASHIER', 'VENDEDOR', 'EMPLOYEE', 'LENDER', 'DRIVER'])
    ('%s no obtiene preparación manual por tener acceso al chat', async role => {
        const actor = { ...principal, role }, { db, mocks } = fixture(null, actor);
        expect(await getAssistantCapabilities(actor, db)).toMatchObject({ help: true, purchasePrepare: false });
        await expect(createProposalFromManual(actor, draft(), source(), { db })).rejects.toMatchObject({ code: 'ASSISTANT_FORBIDDEN' });
        expect(mocks.assistantConversation.findFirst).not.toHaveBeenCalled();
        expect(mocks.assistantProposal.create).not.toHaveBeenCalled();
    });

    it.each([
        { tenantId: 'tenant-b' }, { userId: 'user-b' }, { roleAtCreation: 'ADMIN' }, { expiresAt: new Date(0) },
    ])('rechaza conversación ajena, de otro rol o vencida: %j', async patch => {
        const { db, mocks, state } = fixture();
        Object.assign(state.conversation, patch);
        await expect(createProposalFromManual(principal, draft(), source(), { db })).rejects.toMatchObject({ code: 'PURCHASE_SOURCE_UNAVAILABLE', statusCode: 403 });
        expect(mocks.assistantConversation.findFirst.mock.calls[0][0].where).toEqual({ id: 'conversation-a', tenantId: 'tenant-a',
            userId: 'user-a', roleAtCreation: 'OWNER', expiresAt: { gt: expect.any(Date) } });
        expect(mocks.assistantProposal.create).not.toHaveBeenCalled();
    });

    it.each([null, undefined, { kind: 'UNKNOWN' }, { kind: 'DOCUMENT' }, { ...source(), tenantId: 'tenant-b' }, { ...source(), evidence: [] }])
    ('no sustituye la procedencia faltante o manipulada: %j', async value => {
        const { db, mocks } = fixture();
        await expect(createProposalFromManual(principal, draft(), value as ManualPurchaseSource, { db }))
            .rejects.toMatchObject({ code: 'PURCHASE_SOURCE_INVALID' });
        expect(mocks.assistantProposal.create).not.toHaveBeenCalled();
    });

    it('revalida al usuario activo antes de recuperar o preparar una propuesta', async () => {
        const { db, mocks, state } = fixture(proposal());
        state.user.status = 'DISABLED';
        await expect(createProposalFromManual(principal, draft(), source(), { db })).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
        await expect(getProposal(principal, 'intake-a', db)).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
        expect(mocks.assistantProposal.findFirst).not.toHaveBeenCalled();
        expect(mocks.assistantProposal.create).not.toHaveBeenCalled();
    });

    it.each([{ tenantId: 'tenant-b' }, { userId: 'user-b' }, { role: 'MANAGER' }])
    ('un identificador de propuesta no concede acceso a otro principal: %j', async patch => {
        const actor = { ...principal, ...patch }, { db, mocks } = fixture(proposal(), actor);
        await expect(getProposal(actor, 'intake-a', db)).rejects.toMatchObject({ code: 'PROPOSAL_NOT_FOUND' });
        await expect(updateProposalFromManual(actor, 'intake-a', draft(), source(), { db, expectedVersion: 1 }))
            .rejects.toMatchObject({ code: 'PROPOSAL_NOT_FOUND' });
        expect(mocks.assistantProposal.updateMany).not.toHaveBeenCalled();
        expect(domain.register).not.toHaveBeenCalled();
    });
});

describe('la revisión usa el origen persistido y el dominio de Compras', () => {
    it.each([null, undefined])('DOCUMENT legado (%s) sigue necesitando adjuntos', async storedSource => {
        vi.stubEnv('NORTEX_ASSISTANT_EXTRACTION_ENABLED', 'true');
        const { db, mocks } = fixture(proposal({ source: storedSource }));
        expect(await getProposal(principal, 'intake-a', db)).toMatchObject({ source: 'DOCUMENT' });
        await expect(reviseProposal(principal, 'intake-a', 1, draft(), db)).rejects.toMatchObject({ code: 'INVALID_ATTACHMENTS' });
        expect(domain.preview).not.toHaveBeenCalled();
        expect(mocks.assistantProposal.updateMany).not.toHaveBeenCalled();
    });

    it('un origen desconocido no recibe ni revisión ni lectura de su contenido', async () => {
        const { db, mocks } = fixture(proposal({ source: { kind: 'OCR_BYPASS' } }));
        await expect(getProposal(principal, 'intake-a', db)).rejects.toMatchObject({ code: 'PURCHASE_SOURCE_INVALID' });
        await expect(reviseProposal(principal, 'intake-a', 1, draft(), db)).rejects.toMatchObject({ code: 'PURCHASE_SOURCE_INVALID' });
        expect(mocks.assistantProposal.updateMany).not.toHaveBeenCalled();
    });

    it('tampoco convierte en manual una propuesta documental existente', async () => {
        const { db, mocks } = fixture(proposal({ source: null, attachmentIds: ['attachment-a'] }));
        await expect(updateProposalFromManual(principal, 'intake-a', draft(), source(), { db, expectedVersion: 1 }))
            .rejects.toMatchObject({ code: 'PURCHASE_SOURCE_CHANGED' });
        expect(mocks.assistantProposal.updateMany).not.toHaveBeenCalled();
    });

    it('MANUAL no puede esconder adjuntos para omitir su autorización', async () => {
        const { db, mocks } = fixture(proposal({ attachmentIds: ['attachment-a'] }));
        await expect(reviseProposal(principal, 'intake-a', 1, draft(), db)).rejects.toMatchObject({ code: 'PURCHASE_SOURCE_INVALID' });
        expect(domain.preview).not.toHaveBeenCalled();
        expect(mocks.assistantProposal.updateMany).not.toHaveBeenCalled();
    });

    it('prepara efectos exactos con Compras y conserva la procedencia cuando OCR está apagado', async () => {
        const { db, mocks, state } = fixture(proposal());
        const result = await reviseProposal(principal, 'intake-a', 1, draft(), db);
        expect(result).toMatchObject({ source: 'MANUAL', version: 2, status: 'READY', issues: [],
            preview: { total: '23.00', cashOut: '0.00', payable: '23.00', hash: 'a'.repeat(64) } });
        expect(domain.preview).toHaveBeenCalledWith({ principal, input: expect.objectContaining({ supplierId: 'supplier-a', invoiceNumber: 'F-MANUAL' }) }, db);
        expect(state.row!.source).toEqual(source());
        expect(mocks.assistantAttachment.count).not.toHaveBeenCalled();
        expect(domain.register).not.toHaveBeenCalled();
    });

    it('el navegador no puede convertir un documento en manual mediante el draft', async () => {
        const { db, mocks } = fixture(proposal());
        await expect(reviseProposal(principal, 'intake-a', 1, { ...draft(), source: source() }, db)).rejects.toMatchObject({ name: 'ZodError' });
        expect(mocks.assistantProposal.updateMany).not.toHaveBeenCalled();
    });
});

describe('correcciones por conversación: versión, evidencia e inmutabilidad', () => {
    it('agrega evidencia, conserva su identidad y descarta una revisión anterior', async () => {
        const { db, state } = fixture(proposal({ status: 'READY', version: 7, payloadHash: 'a'.repeat(64), preview: { total: '23.00' } }));
        const corrected = { ...draft(), invoiceNumber: 'F-CORREGIDA' };
        const extra = { requestId: '22222222-2222-4222-8222-222222222222', field: 'invoiceNumber', suppliedText: 'factura F-CORREGIDA' };
        const next = { ...source(), evidence: [...source().evidence, extra] };
        const result = await updateProposalFromManual(principal, 'intake-a', corrected, next, { db, expectedVersion: 7 });
        expect(result).toMatchObject({ version: 8, status: 'DRAFT', preview: null, draft: corrected });
        expect(state.row).toMatchObject({ payloadHash: null, source: { ...source(), evidence: [source().evidence[0], extra] } });
        expect(domain.preview).not.toHaveBeenCalled();
        expect(domain.register).not.toHaveBeenCalled();
    });

    it.each([{ conversationId: 'conversation-b' }, { intakeId: 'intake-b' }])('rechaza cambiar la identidad de origen: %j', async patch => {
        const { db, mocks, state } = fixture(proposal());
        const before = structuredClone(state.row);
        await expect(updateProposalFromManual(principal, 'intake-a', draft(), { ...source(), ...patch }, { db, expectedVersion: 1 }))
            .rejects.toMatchObject({ code: 'PURCHASE_SOURCE_CHANGED' });
        expect(state.row).toEqual(before);
        expect(mocks.assistantProposal.updateMany).not.toHaveBeenCalled();
    });

    it('un turno viejo no pisa una revisión que la UI ya guardó', async () => {
        const uiDraft = { ...draft(), invoiceNumber: 'F-UI' };
        const { db, mocks, state } = fixture(proposal({ draft: uiDraft, version: 2, status: 'READY', payloadHash: 'b'.repeat(64) }));
        const before = structuredClone(state.row);
        await expect(updateProposalFromManual(principal, 'intake-a', draft(), source(), { db, expectedVersion: 1 }))
            .rejects.toMatchObject({ code: 'PROPOSAL_CHANGED' });
        expect(state.row).toEqual(before);
        expect(mocks.assistantProposal.updateMany.mock.calls[0][0].where).toMatchObject({ id: 'intake-a', tenantId: 'tenant-a',
            userId: 'user-a', roleAtCreation: 'OWNER', version: 1, status: { in: ['DRAFT', 'READY'] }, expiresAt: { gt: expect.any(Date) } });
    });

    it('también conserva una revisión concurrente ocurrida entre lectura y escritura', async () => {
        const { db, state } = fixture(proposal());
        state.beforeUpdate = () => { state.row!.version = 2; state.row!.draft = { ...draft(), invoiceNumber: 'F-UI-CONCURRENTE' }; };
        await expect(updateProposalFromManual(principal, 'intake-a', draft(), source(), { db, expectedVersion: 1 }))
            .rejects.toMatchObject({ code: 'PROPOSAL_CHANGED' });
        expect(state.row).toMatchObject({ version: 2, draft: { invoiceNumber: 'F-UI-CONCURRENTE' } });
    });

    it('COMMITTED conserva la propuesta, el hash y su comprobante', async () => {
        const { db, state } = fixture(proposal({ status: 'COMMITTED', payloadHash: 'a'.repeat(64), result: { purchaseId: 'purchase-a' } }));
        const before = structuredClone(state.row);
        await expect(updateProposalFromManual(principal, 'intake-a', { ...draft(), invoiceNumber: 'F-OTRA' }, source(), { db, expectedVersion: 1 }))
            .rejects.toMatchObject({ code: 'PROPOSAL_CHANGED' });
        expect(state.row).toEqual(before);
        expect(domain.register).not.toHaveBeenCalled();
    });
});

describe('confirmación manual: misma autoridad y servicio compartido', () => {
    it.each([
        [null, 'INVALID_ATTACHMENTS'], [{ kind: 'UNKNOWN' }, 'PURCHASE_SOURCE_INVALID'],
    ])('confirmar no omite evidencia para el origen %j', async (storedSource, code) => {
        const { db, mocks } = fixture(proposal({ source: storedSource, status: 'READY', payloadHash: 'a'.repeat(64) }));
        await expect(confirmProposal(principal, 'intake-a', 1, 'operation-a', db)).rejects.toMatchObject({ code });
        expect(domain.register).not.toHaveBeenCalled();
        expect(mocks.assistantProposal.updateMany).not.toHaveBeenCalled();
    });

    it('revalida la conversación dentro del callback y no requiere adjuntos ficticios', async () => {
        const { db, mocks, state } = fixture(proposal({ status: 'READY', payloadHash: 'a'.repeat(64) }));
        const operation = await confirmProposal(principal, 'intake-a', 1, 'operation-a', db);
        expect(operation).toMatchObject({ purchaseId: 'purchase-a', proposalId: 'intake-a', replayed: false });
        expect(domain.register).toHaveBeenCalledTimes(1);
        expect(domain.register.mock.calls[0][0]).toMatchObject({ principal, expectedPreviewHash: 'a'.repeat(64), idempotencyKey: 'operation-a' });
        expect(mocks.assistantConversation.findFirst).toHaveBeenCalledTimes(2);
        expect(mocks.assistantAttachment.count).not.toHaveBeenCalled();
        expect(mocks.assistantAttachment.updateMany).not.toHaveBeenCalled();
        expect(state.row).toMatchObject({ status: 'COMMITTED', result: operation });
    });

    it('la conversación que vence entre revisión y commit bloquea finalizar la propuesta', async () => {
        const { db, mocks, state } = fixture(proposal({ status: 'READY', payloadHash: 'a'.repeat(64) }));
        domain.register.mockImplementationOnce(async ({ beforeCommit }, tx) => {
            state.conversation.expiresAt = new Date(0);
            await beforeCommit(tx, { id: 'purchase-a' });
        });
        await expect(confirmProposal(principal, 'intake-a', 1, 'operation-a', db)).rejects.toMatchObject({ code: 'PURCHASE_SOURCE_UNAVAILABLE' });
        expect(mocks.assistantProposal.updateMany).not.toHaveBeenCalled();
        expect(state.row).toMatchObject({ status: 'READY', result: null });
    });

    it('revocar el usuario antes del callback también impide finalizar la propuesta', async () => {
        const { db, mocks, state } = fixture(proposal({ status: 'READY', payloadHash: 'a'.repeat(64) }));
        domain.register.mockImplementationOnce(async ({ beforeCommit }, tx) => {
            state.user.status = 'DISABLED';
            await beforeCommit(tx, { id: 'purchase-a' });
        });
        await expect(confirmProposal(principal, 'intake-a', 1, 'operation-a', db)).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
        expect(mocks.assistantProposal.updateMany).not.toHaveBeenCalled();
        expect(state.row).toMatchObject({ status: 'READY', result: null });
    });
});

describe('abandonar un borrador conserva evidencia y nunca cancela compras', () => {
    it.each(['DRAFT', 'READY'])('cancela %s e invalida la versión y los efectos revisados', async status => {
        const { db, mocks, state } = fixture(proposal({ status, version: 4, payloadHash: 'a'.repeat(64), preview: { total: '23.00' } }));
        const originalDraft = structuredClone(state.row!.draft), originalSource = structuredClone(state.row!.source);
        await cancelUncommittedProposal(principal, 'intake-a', 4, db);
        expect(state.row).toMatchObject({ status: 'CANCELLED', version: 5, preview: null, payloadHash: null,
            draft: originalDraft, source: originalSource, attachmentIds: [], result: null });
        expect(mocks.assistantProposal.updateMany.mock.calls[0][0].where).toEqual({ id: 'intake-a', tenantId: 'tenant-a',
            userId: 'user-a', roleAtCreation: 'OWNER', version: 4, status: { in: ['DRAFT', 'READY'] }, expiresAt: { gt: expect.any(Date) } });
        await expect(confirmProposal(principal, 'intake-a', 4, 'operation-a', db)).rejects.toMatchObject({ code: 'PROPOSAL_CHANGED' });
        await expect(confirmProposal(principal, 'intake-a', 5, 'operation-a', db)).rejects.toMatchObject({ code: 'PROPOSAL_NOT_READY' });
        expect(domain.register).not.toHaveBeenCalled();
        expect(mocks.purchase.create).not.toHaveBeenCalled();
        expect(mocks.purchaseCommand.create).not.toHaveBeenCalled();
    });

    it.each([
        { tenantId: 'tenant-b' }, { userId: 'user-b' }, { roleAtCreation: 'ADMIN' }, { version: 2 },
        { status: 'COMMITTED', result: { purchaseId: 'purchase-a' } }, { expiresAt: new Date(0) },
    ])('rechaza dueño, versión, estado o vigencia diferentes: %j', async patch => {
        const { db, state } = fixture(proposal(patch));
        const before = structuredClone(state.row);
        await expect(cancelUncommittedProposal(principal, 'intake-a', 1, db)).rejects.toMatchObject({ code: 'PROPOSAL_CHANGED' });
        expect(state.row).toEqual(before);
        expect(domain.register).not.toHaveBeenCalled();
    });

    it('una confirmación concurrente conserva el comprobante y no queda CANCELLED', async () => {
        const { db, state } = fixture(proposal({ status: 'READY', payloadHash: 'a'.repeat(64) }));
        state.beforeUpdate = () => { state.row!.status = 'COMMITTED'; state.row!.result = { purchaseId: 'purchase-a' }; };
        await expect(cancelUncommittedProposal(principal, 'intake-a', 1, db)).rejects.toMatchObject({ code: 'PROPOSAL_CHANGED' });
        expect(state.row).toMatchObject({ status: 'COMMITTED', version: 1, result: { purchaseId: 'purchase-a' }, payloadHash: 'a'.repeat(64) });
    });

    it('revalida un rol revocado antes de modificar el borrador', async () => {
        const { db, mocks, state } = fixture(proposal());
        state.user.role = 'ACCOUNTANT';
        await expect(cancelUncommittedProposal(principal, 'intake-a', 1, db)).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
        expect(mocks.assistantProposal.updateMany).not.toHaveBeenCalled();
        expect(state.row!.status).toBe('DRAFT');
    });

    it('el rol vigente de consulta tampoco puede abandonar propuestas de compras', async () => {
        const actor = { ...principal, role: 'ACCOUNTANT' }, { db, mocks } = fixture(proposal(), actor);
        await expect(cancelUncommittedProposal(actor, 'intake-a', 1, db)).rejects.toMatchObject({ code: 'ASSISTANT_FORBIDDEN' });
        expect(mocks.assistantProposal.updateMany).not.toHaveBeenCalled();
    });

    it('puede abandonar DOCUMENT con OCR apagado y conserva el archivo sin vincularlo a una compra', async () => {
        const { db, mocks, state } = fixture(proposal({ source: null, attachmentIds: ['attachment-a'], status: 'READY', payloadHash: 'a'.repeat(64) }));
        await cancelUncommittedProposal(principal, 'intake-a', 1, db);
        expect(state.row).toMatchObject({ status: 'CANCELLED', version: 2, source: null, attachmentIds: ['attachment-a'], result: null, payloadHash: null });
        expect(mocks.assistantAttachment.updateMany).not.toHaveBeenCalled();
        expect(domain.register).not.toHaveBeenCalled();
    });
});
