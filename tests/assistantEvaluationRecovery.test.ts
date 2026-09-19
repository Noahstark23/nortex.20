import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runOperationsModelEvaluation } from '../scripts/assistant-evaluation/operations-model.mjs';

const folders: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(folders.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'nortex-evaluation-test-')); folders.push(dir);
  const report = path.join(dir, 'report.json'), session = path.join(dir, 'session'), review = path.join(dir, 'review.json');
  const corpus = JSON.parse(await readFile('tests/fixtures/assistant/operations/model-reserved.json', 'utf8'));
  const scenario = corpus.cases.find((row: any) => row.vertical === 'ferreteria' && row.role === 'OWNER');
  await writeFile(session, 'synthetic-session-a', { mode: 0o600 });
  await writeFile(review, JSON.stringify({ synthetic: true, expectedOutcomesReviewed: true, reviewer: 'TEST ONLY', reviewedAt: '2026-09-07T18:00:00Z', vertical: 'ferreteria', role: 'OWNER', scenarioIds: [scenario.id] }));
  const args = ['--allow-paid-model', '--synthetic-tenant', '--base-url', 'http://127.0.0.1:3210', '--review-file', review, '--session-token-file', session, '--vertical', 'ferreteria', '--role', 'OWNER', '--report', report];
  return { dir, report, session, review, args };
}
const json = (data: any, status = 200) => new Response(JSON.stringify(data), { status });
function transport(loseResponse = true) {
  let run: any;
  const fetcher = vi.fn(async (url: URL, init: RequestInit) => {
    if (url.pathname.endsWith('/capabilities')) return json({ operations: true, accessScope: 'OWNER' });
    if (url.pathname === '/api/assistant/conversations') return json({ id: 'conversation-a' });
    if (init.method === 'POST') {
      const body = JSON.parse(String(init.body));
      run = { id: 'run-a', conversationId: 'conversation-a', requestId: body.requestId, status: 'SUCCEEDED', result: { text: 'Synthetic result', degraded: false }, steps: [] };
      if (loseResponse) throw new Error('Lost response');
      return json(run);
    }
    return json(url.pathname.endsWith('/runs') ? { runs: run ? [run] : [] } : run);
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
describe('evaluación de IA: conservar identidad y evidencia tras una interrupción', () => {
  it('rechaza sobrescribir evidencia existente incluso en modo sin proveedor', async () => {
    const f = await fixture();
    await writeFile(f.report, '{"status":"incomplete","results":[{"requestId":"existing"}]}');
    const before = await readFile(f.report, 'utf8');
    await expect(runOperationsModelEvaluation(['--report', f.report])).rejects.toThrow(/existe/);
    expect(await readFile(f.report, 'utf8')).toBe(before);
  });
  it('recupera una respuesta perdida mediante lecturas sin crear ni reenviar consultas', async () => {
    const f = await fixture(), fetcher = transport();
    const first = await runOperationsModelEvaluation(f.args);
    expect(first.results[0].status).toBe('uncertain');
    const requestId = first.results[0].requestId;
    fetcher.mockClear();
    const recovered = await runOperationsModelEvaluation([...f.args, '--resume']);
    expect(recovered.results).toHaveLength(1);
    expect(recovered.results[0]).toMatchObject({ requestId, runId: 'run-a', status: 'executed_pending_human_review' });
    expect(fetcher.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true);
    expect((await stat(f.report)).mode & 0o077).toBe(0);
    expect(await readFile(f.report, 'utf8')).not.toContain('synthetic-session-a');
  });
  it('no convierte una ausencia remota en permiso para repetir una llamada', async () => {
    const f = await fixture(); transport(); await runOperationsModelEvaluation(f.args);
    const fetcher = transport(); // No run visible in this server snapshot.
    const result = await runOperationsModelEvaluation([...f.args, '--resume']);
    expect(result.status).toBe('incomplete');
    expect(result.results[0].status).toBe('uncertain');
    expect(fetcher.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true);
  });
  it.each(['session', 'review', 'base'])('rechaza reanudación si cambia %s antes de contactar el servidor', async change => {
    const f = await fixture(); transport(false); await runOperationsModelEvaluation(f.args);
    if (change === 'session') await writeFile(f.session, 'synthetic-session-b');
    if (change === 'review') { const review = JSON.parse(await readFile(f.review, 'utf8')); review.reviewer = 'Different reviewer'; await writeFile(f.review, JSON.stringify(review)); }
    const args = change === 'base' ? f.args.map(arg => arg === 'http://127.0.0.1:3210' ? 'http://127.0.0.1:3211' : arg) : f.args;
    const fetcher = transport(false), before = await readFile(f.report, 'utf8');
    await expect(runOperationsModelEvaluation([...args, '--resume'])).rejects.toThrow(/identidad|montaje/);
    expect(fetcher).not.toHaveBeenCalled(); expect(await readFile(f.report, 'utf8')).toBe(before);
  });
  it('exige reanudación explícita y excluye procesos concurrentes', async () => {
    const f = await fixture(); transport(false); await runOperationsModelEvaluation(f.args);
    const fetcher = transport(false);
    await expect(runOperationsModelEvaluation(f.args)).rejects.toThrow(/existe/);
    expect(fetcher).not.toHaveBeenCalled();
    await writeFile(f.report + '.lock', 'test lock');
    await expect(runOperationsModelEvaluation([...f.args, '--resume'])).rejects.toThrow(/bloqueado/);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rechaza otro escritor mientras el primero está esperando al servidor', async () => {
    const f = await fixture();
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const delegate = transport(false);
    vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
      if (url.pathname.endsWith('/capabilities')) { entered(); await blocked; }
      return delegate(url, init);
    }));
    const first = runOperationsModelEvaluation(f.args); await started;
    try { await expect(runOperationsModelEvaluation(f.args)).rejects.toThrow('bloqueado'); }
    finally { release(); }
    expect((await first).status).toBe('executed_pending_human_review');
  });
  it('conserva JSON nulo y no permite tratarlo como archivo inexistente', async () => {
    const f = await fixture(); await writeFile(f.report, 'null');
    await expect(runOperationsModelEvaluation(['--report', f.report])).rejects.toThrow('existe');
    expect(await readFile(f.report, 'utf8')).toBe('null');
  });
  it('mantiene el informe intacto si se revoca el acceso al recuperar', async () => {
    const f = await fixture(); transport(false); await runOperationsModelEvaluation(f.args);
    const before = await readFile(f.report, 'utf8');
    vi.stubGlobal('fetch', vi.fn(async () => json({ code: 'DENIED' }, 403)));
    await expect(runOperationsModelEvaluation([...f.args, '--resume'])).rejects.toThrow(/403/);
    expect(await readFile(f.report, 'utf8')).toBe(before);
  });
});
