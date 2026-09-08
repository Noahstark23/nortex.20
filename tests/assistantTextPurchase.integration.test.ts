import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import prisma from '../backend/lib/prisma';
import { api, baseUrl, invoiceEffects, roleActor, status, type PurchaseFixture } from './fixtures/assistant/integrationHelpers';
import { captureManualConversation, cementDraft, manualFixture, manualOrigin, manualProposal, readyManualProposal } from './fixtures/assistant/manualPurchaseHelpers';

const qa = baseUrl ? describe.sequential : describe.skip;
let owner: PurchaseFixture;
let foreign: PurchaseFixture;
const confirm = (proposal: { id: string; version: number }, key = randomUUID(), actor = owner) =>
  api(`/api/assistant/proposals/${proposal.id}/confirm`, actor, 'POST', { version: proposal.version, idempotencyKey: key });

qa('NortexGPT: compra declarada por texto, HTTP y MySQL descartable', () => {
  beforeAll(async () => { owner = await manualFixture(); foreign = await manualFixture(); }, 120_000);

  it('prepara manual sin lectura pagada y confirma crédito una sola vez, sin archivos ficticios', async () => {
    await prisma.assistantTenantConfig.update({ where: { tenantId: owner.tenantId }, data: { extractionEnabled: false } });
    try {
      const capabilities = await api('/api/assistant/capabilities', owner); status(capabilities, 200);
      expect(capabilities.body).toMatchObject({ invoicePrepare: false, purchasePrepare: true, invoiceConfirm: true });
      const draft = cementDraft(owner); const before = await invoiceEffects(owner, draft.invoiceNumber);
      const seeded = await manualProposal(owner, draft);
      expect(seeded.proposal).toMatchObject({ status: 'DRAFT', source: 'MANUAL', attachmentIds: [] });
      expect((await invoiceEffects(owner, draft.invoiceNumber)).stock).toBe(before.stock);
      const reviewed = await api(`/api/assistant/proposals/${seeded.proposal.id}`, owner, 'PATCH', { version: seeded.proposal.version, draft }); status(reviewed, 200);
      expect(reviewed.body).toMatchObject({ status: 'READY', source: 'MANUAL' });
      expect(reviewed.body.preview).toMatchObject({ subtotal: '500.00', tax: '75.00', total: '575.00', cashOut: '0.00', payable: '575.00' });
      const key = randomUUID(); const results = await Promise.all([confirm(reviewed.body, key), confirm(reviewed.body, key)]);
      results.forEach(result => status(result, 200)); expect(results[0].body.purchaseId).toBe(results[1].body.purchaseId);
      const replay = await confirm(reviewed.body, key); status(replay, 200); expect(replay.body.replayed).toBe(true);
      const effects = await invoiceEffects(owner, draft.invoiceNumber);
      expect(effects.stock - before.stock).toBe(50); expect(effects.kardex - before.kardex).toBe(1); expect(effects.purchases).toHaveLength(1);
      expect(effects.purchases[0].balanceDue.toFixed(2)).toBe('575.00');
      expect(await prisma.auditLog.count({ where: { tenantId: owner.tenantId, action: 'PURCHASE_CREATED', details: { contains: results[0].body.purchaseId } } })).toBe(1);
      expect(await prisma.assistantAttachment.count({ where: { tenantId: owner.tenantId, purchaseId: results[0].body.purchaseId } })).toBe(0);
      const stored = await prisma.assistantProposal.findUniqueOrThrow({ where: { id: seeded.proposal.id } });
      expect(stored.source).toEqual(seeded.source);
    } finally { await prisma.assistantTenantConfig.update({ where: { tenantId: owner.tenantId }, data: { extractionEnabled: true } }); }
  });

  it('compra manual de contado requiere pago declarado y deja un solo débito de caja', async () => {
    const opened = await api('/api/shifts/open', owner, 'POST', { initialCash: 1000 }); status(opened, 200);
    const draft = cementDraft(owner, { paymentMethod: 'CASH', paymentConfirmed: false, dueDate: undefined });
    const seeded = await manualProposal(owner, draft);
    const pending = await api(`/api/assistant/proposals/${seeded.proposal.id}`, owner, 'PATCH', { version: 1, draft }); status(pending, 200);
    expect(pending.body.status).toBe('DRAFT'); status(await confirm(pending.body), 409);
    const reviewed = await api(`/api/assistant/proposals/${seeded.proposal.id}`, owner, 'PATCH', { version: pending.body.version, draft: { ...draft, paymentConfirmed: true } }); status(reviewed, 200);
    const key = randomUUID(); const committed = await confirm(reviewed.body, key); status(committed, 200);
    status(await confirm(reviewed.body, key), 200);
    const purchase = await prisma.purchase.findFirstOrThrow({ where: { id: committed.body.purchaseId, tenantId: owner.tenantId } });
    expect(purchase.balanceDue.toFixed(2)).toBe('0.00');
    const movements = await prisma.cashMovement.findMany({ where: { tenantId: owner.tenantId, shiftId: opened.body.id, category: 'COMPRA_CONTADO' }, take: 10 });
    expect(movements).toHaveLength(1); expect(movements[0].amount.toFixed(2)).toBe('575.00');
  });

  it('fuente documental vacía sigue bloqueada y el navegador no puede sustituir procedencia', async () => {
    const draft = cementDraft(owner);
    const broken = await prisma.assistantProposal.create({ data: { tenantId: owner.tenantId, userId: owner.userId,
      roleAtCreation: owner.role, attachmentIds: [], draft: JSON.parse(JSON.stringify(draft)), issues: [], expiresAt: new Date(Date.now() + 86_400_000) } });
    const reviewed = await api(`/api/assistant/proposals/${broken.id}`, owner, 'PATCH', { version: 1, draft }); status(reviewed, 400);
    expect(reviewed.body.code).toBe('INVALID_ATTACHMENTS');
    const source = await manualOrigin(owner);
    status(await api(`/api/assistant/proposals/${broken.id}`, owner, 'PATCH', { version: 1, draft, source }), 400);
    expect((await invoiceEffects(owner, draft.invoiceNumber)).purchases).toHaveLength(0);
  });

  it('rechaza conversación ajena, otro usuario y procedencia caducada antes de revisar o confirmar', async () => {
    const { createProposalFromManual } = await import('../backend/services/assistant/proposals');
    const foreignSource = await manualOrigin(foreign);
    await expect(createProposalFromManual(owner, cementDraft(owner), foreignSource)).rejects.toMatchObject({ statusCode: 403, code: 'PURCHASE_SOURCE_UNAVAILABLE' });
    const ready = await readyManualProposal(owner);
    expect(ready.proposal.status).toBe('READY');
    const peer = await roleActor(owner, 'OWNER');
    status(await confirm(ready.proposal, randomUUID(), { ...owner, ...peer }), 404);
    status(await confirm(ready.proposal, randomUUID(), foreign), 404);
    await prisma.assistantConversation.update({ where: { id: ready.source.conversationId }, data: { expiresAt: new Date(0) } });
    status(await confirm(ready.proposal), 403);
    expect((await invoiceEffects(owner, ready.draft.invoiceNumber)).purchases).toHaveLength(0);
  });

  it('corregir desde conversación invalida revisión anterior y conserva evidencia', async () => {
    const { updateProposalFromManual } = await import('../backend/services/assistant/proposals');
    const ready = await readyManualProposal(owner);
    const nextEvidence = { requestId: randomUUID(), field: 'notes', suppliedText: 'Corregí la observación: entrega completa.' };
    const modified = await updateProposalFromManual(owner, ready.proposal.id, { ...ready.draft, notes: 'Entrega completa' },
      { ...ready.source, evidence: [nextEvidence] }, { db: prisma, expectedVersion: ready.proposal.version });
    expect(modified).toMatchObject({ status: 'DRAFT', version: ready.proposal.version + 1, preview: null });
    status(await confirm(ready.proposal), 409);
    const stored = await prisma.assistantProposal.findUniqueOrThrow({ where: { id: ready.proposal.id } });
    expect((stored.source as any).evidence).toEqual([...ready.source.evidence, nextEvidence]);
    expect((await invoiceEffects(owner, ready.draft.invoiceNumber)).purchases).toHaveLength(0);
  });

  it('permiso revocado y cierre fiscal no dejan una compra manual parcialmente confirmada', async () => {
    const ready = await readyManualProposal(owner, cementDraft(owner, { postingDate: '2038-08-05' }));
    await prisma.user.update({ where: { id: owner.userId }, data: { role: 'CASHIER' } });
    try { status(await confirm(ready.proposal), 403); }
    finally { await prisma.user.update({ where: { id: owner.userId }, data: { role: owner.role } }); }
    const before = await invoiceEffects(owner, ready.draft.invoiceNumber);
    await prisma.fiscalPeriod.create({ data: { tenantId: owner.tenantId, year: 2038, month: 8, status: 'CLOSED' } });
    const key = randomUUID(); status(await confirm(ready.proposal, key), 423);
    const after = await invoiceEffects(owner, ready.draft.invoiceNumber);
    expect(after.stock).toBe(before.stock); expect(after.kardex).toBe(before.kardex); expect(after.purchases).toHaveLength(0);
    expect(await prisma.purchaseCommand.count({ where: { tenantId: owner.tenantId, requestKey: key } })).toBe(0);
    expect(await prisma.assistantProposal.findUnique({ where: { id: ready.proposal.id } })).toMatchObject({ status: 'READY', result: null });
  });

  it('conversa compra de 50 cementos, conserva captura al recargar y nunca registra por un sí', async () => {
    const conversation = await api('/api/assistant/conversations', owner, 'POST', {}); status(conversation, 201);
    const path = `/api/assistant/conversations/${conversation.body.id}/messages`;
    const purchasesBefore = await prisma.purchase.count({ where: { tenantId: owner.tenantId } });
    const stockBefore = (await prisma.product.findFirstOrThrow({ where: { id: owner.productId, tenantId: owner.tenantId } })).stock;
    const first = { requestId: randomUUID(), text: 'Nortex, compré 50 bolsas de cemento' };
    const offered = await api(path, owner, 'POST', first); status(offered, 200);
    expect(offered.body.purchaseIntake.phase).toBe('CHOOSE_INPUT');
    expect(offered.body.actions.map((action: any) => action.type)).toEqual(expect.arrayContaining(['UPLOAD_INVOICE', 'CONTINUE_PURCHASE']));
    const replay = await api(path, owner, 'POST', first); status(replay, 200); expect(replay.body.id).toBe(offered.body.id);
    const during = await api(`/api/assistant/conversations/${conversation.body.id}`, owner); status(during, 200);
    expect(during.body.purchaseIntake).toMatchObject({ id: offered.body.purchaseIntake.id, phase: 'CHOOSE_INPUT' });
    const invoice = `F-TEXT-${randomUUID().slice(0, 8)}`;
    const answers = ['Completar por aquí', '1', 'BASE', 'C$ 230', 'Cementos Alfa', '1', invoice,
      '2026-09-05', '13225', 'a crédito', '2026-10-05', 'sí', '1'];
    let last: any;
    let lastRequest: any;
    const trace: Array<{ input: string; output: string; phase: string }> = [];
    for (const text of answers) {
      lastRequest = { requestId: randomUUID(), text };
      const reply = await api(path, owner, 'POST', lastRequest); status(reply, 200);
      last = reply.body; trace.push({ input: text, output: last.text, phase: last.purchaseIntake?.phase });
    }
    expect(last.proposalId, JSON.stringify(trace)).toBeTruthy();
    expect(last.purchaseIntake.phase).toBe('REVIEW');
    const duplicate = await api(path, owner, 'POST', lastRequest); status(duplicate, 200);
    expect(duplicate.body.proposalId).toBe(last.proposalId); expect(duplicate.body.id).toBe(last.id);
    const reloaded = await api(`/api/assistant/conversations/${conversation.body.id}`, owner); status(reloaded, 200);
    expect(reloaded.body.proposalId).toBe(last.proposalId);
    expect(reloaded.body.purchaseIntake).toMatchObject({ id: offered.body.purchaseIntake.id, phase: 'REVIEW' });
    const linked = await prisma.assistantProposal.findMany({ where: { tenantId: owner.tenantId, userId: owner.userId,
      source: { path: '$.conversationId', equals: conversation.body.id } }, take: 5 });
    expect(linked).toHaveLength(1); expect(linked[0].status).toBe('DRAFT'); expect(linked[0].attachmentIds).toEqual([]);
    expect(linked[0].draft).toMatchObject({ supplierId: owner.supplierId, invoiceNumber: invoice, paymentMethod: 'CREDIT',
      documentTotal: '13225', receivedConfirmed: true, paymentConfirmed: false,
      items: [expect.objectContaining({ productId: owner.productId, quantity: '50', unitCost: '230', purchaseUnit: 'BASE' })] });
    const yes = await api(path, owner, 'POST', { requestId: randomUUID(), text: 'sí' }); status(yes, 200);
    expect(yes.body.proposalId).toBe(last.proposalId);
    expect(await prisma.purchase.count({ where: { tenantId: owner.tenantId } })).toBe(purchasesBefore);
    expect((await prisma.product.findFirstOrThrow({ where: { id: owner.productId, tenantId: owner.tenantId } })).stock).toBe(stockBefore);
    expect(await prisma.assistantProposal.findUnique({ where: { id: last.proposalId } })).toMatchObject({ status: 'DRAFT' });
  }, 120_000);

  it('conserva flete y notas editados en revisión cuando se corrige cantidad por chat', async () => {
    const captured = await captureManualConversation(owner);
    const draft = { ...captured.proposal.draft, freight: '5', notes: 'Flete declarado por separado' };
    const saved = await api(`/api/assistant/proposals/${captured.proposal.id}`, owner, 'PATCH', {
      version: captured.proposal.version, draft,
    }); status(saved, 200);
    expect(saved.body).toMatchObject({ status: 'DRAFT', draft: { freight: '5', notes: draft.notes } });
    const before = await invoiceEffects(owner, draft.invoiceNumber);
    const corrected = await api(captured.path, owner, 'POST', { requestId: randomUUID(), text: 'cantidad 60' }); status(corrected, 200);
    expect(corrected.body.proposalId).toBe(captured.proposal.id);
    const stored = await api(`/api/assistant/proposals/${captured.proposal.id}`, owner); status(stored, 200);
    expect(stored.body).toMatchObject({ status: 'DRAFT', version: saved.body.version + 1, preview: null,
      draft: { freight: '5', notes: draft.notes, items: [expect.objectContaining({ quantity: '60' })] } });
    const reviewedAgain = await api(`/api/assistant/proposals/${captured.proposal.id}`, owner, 'PATCH', {
      version: stored.body.version, draft: stored.body.draft,
    }); status(reviewedAgain, 200);
    expect(reviewedAgain.body.status).toBe('DRAFT');
    expect(reviewedAgain.body.issues.some((issue: string) => issue.includes('no representa flete'))).toBe(true);
    status(await confirm(saved.body), 409); status(await confirm(reviewedAgain.body), 409);
    const after = await invoiceEffects(owner, draft.invoiceNumber);
    expect(after.stock).toBe(before.stock); expect(after.purchases).toHaveLength(0);
  }, 120_000);

  it('cancelar captura manual READY revoca la propuesta y bloquea su confirmación anterior', async () => {
    const captured = await captureManualConversation(owner);
    const reviewed = await api(`/api/assistant/proposals/${captured.proposal.id}`, owner, 'PATCH', {
      version: captured.proposal.version, draft: captured.proposal.draft,
    }); status(reviewed, 200); expect(reviewed.body.status).toBe('READY');
    const before = await invoiceEffects(owner, reviewed.body.draft.invoiceNumber);
    const request = { requestId: randomUUID(), text: 'cancelar compra' };
    const cancelled = await api(captured.path, owner, 'POST', request); status(cancelled, 200);
    expect(cancelled.body.purchaseIntake).toBeNull();
    const replay = await api(captured.path, owner, 'POST', request); status(replay, 200); expect(replay.body.id).toBe(cancelled.body.id);
    const stored = await api(`/api/assistant/proposals/${captured.proposal.id}`, owner); status(stored, 200);
    expect(stored.body).toMatchObject({ status: 'CANCELLED', version: reviewed.body.version + 1, preview: null });
    const persisted = await prisma.assistantProposal.findUniqueOrThrow({ where: { id: captured.proposal.id } });
    expect(persisted.payloadHash).toBeNull();
    expect(persisted.source).toMatchObject({ kind: 'MANUAL', conversationId: captured.conversationId });
    expect(persisted.attachmentIds).toEqual([]);
    status(await confirm(reviewed.body), 409);
    const conversation = await api(`/api/assistant/conversations/${captured.conversationId}`, owner); status(conversation, 200);
    expect(conversation.body.purchaseIntake).toBeNull();
    const after = await invoiceEffects(owner, reviewed.body.draft.invoiceNumber);
    expect(after.stock).toBe(before.stock); expect(after.purchases).toHaveLength(0);
  }, 120_000);

  it('concilia cancelación y confirmación concurrentes sin compra parcial ni reversión por chat', async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const captured = await captureManualConversation(owner);
      const reviewed = await api(`/api/assistant/proposals/${captured.proposal.id}`, owner, 'PATCH', {
        version: captured.proposal.version, draft: captured.proposal.draft,
      }); status(reviewed, 200); expect(reviewed.body.status).toBe('READY');
      const before = await invoiceEffects(owner, reviewed.body.draft.invoiceNumber);
      const key = randomUUID();
      const [cancelled, committed] = await Promise.all([
        api(captured.path, owner, 'POST', { requestId: randomUUID(), text: 'cancelar compra' }),
        confirm(reviewed.body, key),
      ]);
      expect([200, 409]).toContain(cancelled.status); expect([200, 409]).toContain(committed.status);
      const stored = await prisma.assistantProposal.findUniqueOrThrow({ where: { id: captured.proposal.id } });
      const after = await invoiceEffects(owner, reviewed.body.draft.invoiceNumber);
      if (committed.status === 200) {
        expect(stored.status).toBe('COMMITTED'); expect(after.purchases).toHaveLength(1);
        expect(after.stock - before.stock).toBe(50); expect(after.kardex - before.kardex).toBe(1);
        expect(after.purchases[0].balanceDue.toFixed(2)).toBe('575.00');
        status(await confirm(reviewed.body, key), 200);
      } else {
        expect(stored.status).toBe('CANCELLED'); expect(after.purchases).toHaveLength(0);
        expect(after.stock).toBe(before.stock); expect(after.kardex).toBe(before.kardex);
        expect(await prisma.purchaseCommand.count({ where: { tenantId: owner.tenantId, requestKey: key } })).toBe(0);
      }
    }
  }, 120_000);
});
