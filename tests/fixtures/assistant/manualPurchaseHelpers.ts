import { randomUUID } from 'node:crypto';
import prisma from '../../../backend/lib/prisma';
import type { InvoiceDraft } from '../../../shared/assistant';
import type { ManualPurchaseSource } from '../../../backend/services/assistant/purchaseSource';
import { api, fixture, invoiceDraft, roleActor, status, type PurchaseFixture } from './integrationHelpers';

export async function manualFixture(): Promise<PurchaseFixture> {
  const setup = await fixture();
  const principal = await roleActor(setup, 'OWNER');
  await prisma.product.update({ where: { id: setup.productId }, data: { name: 'Cemento Holcim 42.5' } });
  await prisma.supplier.update({ where: { id: setup.supplierId }, data: { name: 'Cementos Alfa' } });
  return { ...setup, ...principal };
}

export function cementDraft(f: PurchaseFixture, overrides: Partial<InvoiceDraft> = {}): InvoiceDraft {
  return invoiceDraft(f, { documentSubtotal: '500.00', documentTax: '75.00', documentTotal: '575.00',
    items: [{ productId: f.productId, description: 'Cemento Holcim 42.5', quantity: '50', unitCost: '10', purchaseUnit: 'BASE' }],
    ...overrides });
}

/** Fixture: datos que el usuario declaró, ya asociados a una conversación propia. No usa OCR. */
export async function manualOrigin(f: PurchaseFixture): Promise<ManualPurchaseSource> {
  const conversation = await api('/api/assistant/conversations', f, 'POST', {}); status(conversation, 201);
  const requestId = randomUUID();
  const suppliedText = 'Compré 50 unidades de Cemento Holcim 42.5 a Cementos Alfa, costo unitario 10 córdobas.';
  await prisma.assistantMessage.create({ data: { tenantId: f.tenantId, userId: f.userId,
    conversationId: conversation.body.id, requestId, role: 'user', content: { text: suppliedText } } });
  return { kind: 'MANUAL', origin: 'NORTEX_CHAT', conversationId: conversation.body.id, intakeId: randomUUID(),
    evidence: [{ requestId, field: 'purchase', suppliedText }] };
}

export async function manualProposal(f: PurchaseFixture, draft = cementDraft(f)) {
  const { createProposalFromManual } = await import('../../../backend/services/assistant/proposals');
  const source = await manualOrigin(f);
  return { proposal: await createProposalFromManual(f, draft, source), source, draft };
}

export async function readyManualProposal(f: PurchaseFixture, draft = cementDraft(f)) {
  const seeded = await manualProposal(f, draft);
  const reviewed = await api(`/api/assistant/proposals/${seeded.proposal.id}`, f, 'PATCH', { version: seeded.proposal.version, draft });
  status(reviewed, 200);
  return { ...seeded, proposal: reviewed.body };
}

/** Captura real por mensajes HTTP, sin sembrar el estado interno del asistente. */
export async function captureManualConversation(f: PurchaseFixture) {
  const conversation = await api('/api/assistant/conversations', f, 'POST', {}); status(conversation, 201);
  const path = `/api/assistant/conversations/${conversation.body.id}/messages`;
  const answers = ['Nortex, compré 50 bolsas de cemento', 'Completar por aquí', '1', 'BASE', 'C$ 10',
    'Cementos Alfa', '1', `F-CHAT-${randomUUID().slice(0, 8)}`, '2026-09-05', '575', 'a crédito',
    '2026-10-05', 'sí', '1'];
  let last: any;
  for (const text of answers) {
    const reply = await api(path, f, 'POST', { requestId: randomUUID(), text }); status(reply, 200);
    last = reply.body;
  }
  if (!last.proposalId) throw new Error(`La captura no produjo borrador: ${last.text}`);
  const proposal = await api(`/api/assistant/proposals/${last.proposalId}`, f); status(proposal, 200);
  return { conversationId: conversation.body.id as string, path, proposal: proposal.body };
}
