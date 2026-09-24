import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runFirstCutModelEvaluation, validateFirstCutReview } from '../scripts/assistant-evaluation/first-cut-model.mjs';

const folders: string[] = [];
beforeEach(() => {
  vi.stubEnv('DATABASE_URL', 'mysql://root:synthetic@127.0.0.1:32835/nortex_quality_first_cut_model');
  vi.stubEnv('NORTEX_QA_DATABASE_ACK', 'disposable-database');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(folders.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});
const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });

async function fixture(options: { reviewed?: boolean; loseResponse?: boolean; providerUsage?: boolean; operations?: boolean; missingLink?: boolean; businessMutationModel?: string; balanceMutation?: boolean } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'nortex-first-cut-eval-')); folders.push(dir);
  const report = path.join(dir, 'report.json'), reviewPath = path.join(dir, 'review.json'), session = path.join(dir, 'session');
  const review = JSON.parse(await readFile('docs/evidence/nortexgpt/evaluation-20260923/first-cut-help-review.json', 'utf8'));
  review.expectedOutcomesReviewed = options.reviewed ?? true;
  review.reviewer = review.expectedOutcomesReviewed ? 'Synthetic test reviewer' : null;
  review.reviewedAt = review.expectedOutcomesReviewed ? '2026-09-23T20:00:00Z' : null;
  await writeFile(reviewPath, JSON.stringify(review));
  const token = `qa.${Buffer.from(JSON.stringify({ userId: 'qa-owner', tenantId: review.tenantId, role: 'OWNER' })).toString('base64url')}.signature`;
  await writeFile(session, token, { mode: 0o600 });
  const args = ['--allow-paid-model', '--synthetic-tenant', '--base-url', 'http://127.0.0.1:3211',
    '--review-file', reviewPath, '--session-token-file', session, '--report', report];
  let submitted: { requestId: string; text: string } | null = null;
  const businessRows = vi.fn(async () => submitted ? [{ id: 'new-row', status: 'DRAFT',
    version: 1, updatedAt: new Date('2026-09-23T20:00:00Z'), stock: 3,
    balance: '1.0000', amount: '1.00', date: new Date('2026-09-23T20:00:00Z') }] : []);
  const balanceRows = vi.fn(async () => [{ id: 'existing-account', balance: submitted ? '2.0000' : '1.0000' }]);
  const db = {
    user: { findFirst: vi.fn(async () => ({ id: 'qa-owner' })) },
    assistantTenantConfig: { findUnique: vi.fn(async () => ({ enabled: true, operationsEnabled: false,
      actionsEnabled: false, executionEnabled: false, extractionEnabled: false, promotionsEnabled: false,
      privateWhatsappEnabled: false, monthlyBudgetUsd: '2', approvedMonthlyBudgetUsd: '2' })) },
    assistantKnowledgeControl: { findUnique: vi.fn(async () => ({ activeReleaseId: 'release-a' })) },
    assistantKnowledgeRelease: { findUnique: vi.fn(async () => ({ status: 'PUBLISHED', manifestHash: review.manifestHash,
      reviewedById: 'qa-editor', reviewedAt: new Date(), publishedAt: new Date() })) },
    assistantConversation: { findUnique: vi.fn(async () => ({ id: 'conversation-a', tenantId: review.tenantId,
      userId: 'qa-owner', roleAtCreation: 'OWNER' })) },
    assistantMessage: { findMany: vi.fn(async () => submitted ? [
      { id: 'user-a', role: 'user', content: { text: submitted.text } },
      { id: 'answer-a', role: 'assistant', content: { text: 'Ayuda sintética.' } },
    ] : []) },
    assistantUsage: { findMany: vi.fn(async () => submitted && options.providerUsage !== false ? [{
      id: 'usage-a', status: 'SETTLED', reservedUsd: '0.281920', actualUsd: '0.000200',
      providerRequestId: 'provider-a', createdAt: new Date(),
    }] : []), findFirst: vi.fn(async () => {
      if (options.missingLink) throw new Error('Unknown column AssistantUsage.runId');
      return null;
    }) },
    assistantRun: { count: vi.fn(async () => 0) },
    ...Object.fromEntries(['assistantProposal', 'assistantActionProposal', 'assistantActionCommand',
      'purchaseOrderDraftCommand', 'purchaseCommand', 'purchaseOrder', 'purchase', 'goodsReceipt',
      'supplierReturn', 'productReturn', 'stockTransfer', 'kardexMovement', 'productBatchLedgerEntry',
      'product', 'productStock', 'productBatch', 'productBatchWarehouseStock', 'journalEntry',
      'sale', 'cashMovement', 'expense', 'account', 'payment']
      .map(model => [model, { findMany: model === options.businessMutationModel ? businessRows
        : model === 'account' && options.balanceMutation ? balanceRows : vi.fn(async () => []) }])),
  };
  const fetcher = vi.fn(async (url: URL, init: RequestInit) => {
    if (url.pathname.endsWith('/capabilities')) return json({ enabled: true, help: true, operations: false, accessScope: 'OWNER:budget:true' });
    if (url.pathname.endsWith('/status')) return json({ switches: { enabled: true, languageEnabled: true,
      operationsEnabled: options.operations ?? false, actionsEnabled: false, executionEnabled: false,
      extractionEnabled: false, promotionsEnabled: false, privateWhatsappEnabled: false } });
    if (url.pathname === '/api/assistant/conversations' && init.method === 'POST') return json({ id: 'conversation-a' });
    if (url.pathname.endsWith('/messages') && init.method === 'POST') {
      submitted = JSON.parse(String(init.body));
      if (options.loseResponse) throw new Error('response lost');
      return json({ id: 'answer-a' });
    }
    if (url.pathname.endsWith('/conversations/conversation-a') && init.method === 'GET')
      return json({ id: 'conversation-a', messages: submitted ? [{ id: 'answer-a', role: 'assistant', text: 'Ayuda sintética.',
        citations: [{ id: review.expectedCitationId, version: review.expectedCitationVersion,
          contentHash: review.expectedCitationHash }] }] : [] });
    throw new Error(`Ruta no prevista: ${url.pathname}`);
  });
  return { report, reviewPath, review, session, args, db, fetcher };
}

describe('evaluación pagada del primer corte, cerrada hasta revisión', () => {
  it('rechaza el formulario entregado sin revisión y sin acceder al proveedor', async () => {
    const f = await fixture({ reviewed: false });
    expect(() => validateFirstCutReview(f.review)).toThrow(/revisión humana/);
    await expect(runFirstCutModelEvaluation(f.args, { db: f.db, fetch: f.fetcher })).rejects.toThrow(/revisión humana/);
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.db.assistantUsage.findMany).not.toHaveBeenCalled();
  });

  it('rechaza un modo distinto antes de llamar al backend', async () => {
    const f = await fixture();
    f.review.expectedMode = 'operations';
    await writeFile(f.reviewPath, JSON.stringify(f.review));
    await expect(runFirstCutModelEvaluation(f.args, { db: f.db, fetch: f.fetcher })).rejects.toThrow(/revisión humana/);
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it('guarda identidad y costo por mensaje; una respuesta perdida no repite el POST al recuperar', async () => {
    const f = await fixture({ loseResponse: true });
    const first = await runFirstCutModelEvaluation(f.args, { db: f.db, fetch: f.fetcher });
    expect(first).toMatchObject({ status: 'executed_pending_human_review', modelContactCredited: true,
      expectedCitationPresent: true, operationalRuns: 0, settledUsdForMessage: '0.000200' });
    expect(first.businessStateComparison.changedModels).toEqual([]);
    expect(first.businessStateComparison.before).toEqual(first.businessStateComparison.after);
    expect(first.usageKey).toBe(`message:conversation-a:${first.requestId}`);
    expect(f.db.assistantUsage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ runId: first.usageKey }),
    }));
    expect(await readFile(f.report, 'utf8')).not.toContain('signature');
    expect((await stat(f.report)).mode & 0o077).toBe(0);
    f.fetcher.mockClear();
    const resumed = await runFirstCutModelEvaluation([...f.args, '--resume'], { db: f.db, fetch: f.fetcher });
    expect(resumed.requestId).toBe(first.requestId);
    expect(f.fetcher.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true);
  });

  it.each(['assistantActionProposal', 'purchase', 'kardexMovement', 'productStock', 'account', 'payment'])
  ('un cambio en %s durante el mensaje deja el ensayo incompleto con antes y después', async model => {
    const f = await fixture({ businessMutationModel: model });
    const result = await runFirstCutModelEvaluation(f.args, { db: f.db, fetch: f.fetcher });
    expect(result.status).toBe('incomplete');
    expect(result.businessStateComparison.changedModels).toContain(model);
    expect(result.businessStateComparison.before[model]).toEqual([]);
    expect(result.businessStateComparison.after[model]).toHaveLength(1);
  });

  it('detecta un saldo monetario alterado sin crear filas nuevas', async () => {
    const f = await fixture({ balanceMutation: true });
    const result = await runFirstCutModelEvaluation(f.args, { db: f.db, fetch: f.fetcher });
    expect(result.status).toBe('incomplete');
    expect(result.businessStateComparison.changedModels).toContain('account');
    expect(result.businessStateComparison.before.account[0].balance).toBe('1.0000');
    expect(result.businessStateComparison.after.account[0].balance).toBe('2.0000');
  });

  it('sin consumo vinculado conserva resultado incompleto y nunca crea una consulta sustituta', async () => {
    const f = await fixture({ providerUsage: false });
    const first = await runFirstCutModelEvaluation(f.args, { db: f.db, fetch: f.fetcher });
    expect(first.status).toBe('incomplete');
    expect(first.modelContactCredited).toBe(false);
    f.fetcher.mockClear();
    await runFirstCutModelEvaluation([...f.args, '--resume'], { db: f.db, fetch: f.fetcher });
    expect(f.fetcher.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true);
  });

  it('bloquea operaciones globales antes de crear la conversación', async () => {
    const f = await fixture({ operations: true });
    await expect(runFirstCutModelEvaluation(f.args, { db: f.db, fetch: f.fetcher })).rejects.toThrow(/flags efectivos/);
    expect(f.fetcher.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true);
  });

  it('rechaza una sesión de otro negocio antes de la llamada', async () => {
    const f = await fixture();
    const wrong = `qa.${Buffer.from(JSON.stringify({ userId: 'qa-owner', tenantId: 'otro-negocio', role: 'OWNER' })).toString('base64url')}.signature`;
    await writeFile(f.session, wrong);
    await expect(runFirstCutModelEvaluation(f.args, { db: f.db, fetch: f.fetcher })).rejects.toThrow(/negocio y rol/);
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it('rechaza una base sin la columna de vínculo antes del POST', async () => {
    const f = await fixture({ missingLink: true });
    await expect(runFirstCutModelEvaluation(f.args, { db: f.db, fetch: f.fetcher })).rejects.toThrow(/Unknown column/);
    expect(f.fetcher.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true);
  });

  it('rechaza sobreescritura y cambio de revisión al recuperar', async () => {
    const f = await fixture();
    await runFirstCutModelEvaluation(f.args, { db: f.db, fetch: f.fetcher });
    f.fetcher.mockClear();
    await expect(runFirstCutModelEvaluation(f.args, { db: f.db, fetch: f.fetcher })).rejects.toThrow(/existe/);
    const changed = { ...f.review, reviewer: 'Otra persona' };
    await writeFile(f.reviewPath, JSON.stringify(changed));
    await expect(runFirstCutModelEvaluation([...f.args, '--resume'], { db: f.db, fetch: f.fetcher })).rejects.toThrow(/Cambió la identidad/);
    expect(f.fetcher).not.toHaveBeenCalled();
  });
});
