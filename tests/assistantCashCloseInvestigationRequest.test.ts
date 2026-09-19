import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { cashCloseInvestigationMessage } from '../shared/assistantCashCloseInvestigation';
import { cashCloseInvestigationRequest } from '../backend/services/assistant/operations/cashCloseInvestigationRequest';
import { shouldUseOperationalRun } from '../backend/services/assistant/operations/routing';
import { deterministicRunFallback } from '../backend/services/assistant/operations/fallback';
import { runAssistantOrchestrator } from '../backend/services/assistant/operations/orchestrator';
import { AssistantRunError, type OperationTool, type RunCheckpoint, type ToolContext } from '../backend/services/assistant/operations/contracts';

const now = new Date('2026-09-09T16:00:00Z');
const principal = { tenantId: 'tenant-investigation', userId: 'user-investigation', role: 'OWNER' };
const shiftId = 'qa-shift_01';
const reportHash = 'ab'.repeat(32);
const command = cashCloseInvestigationMessage(shiftId, reportHash);
const query = { principal, conversationId: 'conversation-investigation', runId: 'run-investigation', text: command };
const data = { kind: 'CASH_CLOSE_INVESTIGATION', status: 'partial', pendingChecks: [{ code: 'CASH_DIFFERENCE', message: 'Revisar comprobantes.' }] };
const emptyCheckpoint = (): RunCheckpoint => ({ iterations: 0, messages: [], steps: [], evidence: [], actionProposalIds: [] });

function harness() {
  const execute = vi.fn(async (_context: ToolContext, _input: unknown) => ({ data }));
  const read: OperationTool = {
    name: 'inspect_cash_close', label: 'Investigar cierre', description: 'Lectura de fuentes de un cierre', kind: 'READ',
    schema: z.object({ shiftId: z.string().min(1).max(64), reportHash: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict(), execute,
  };
  const otherRead = vi.fn(async () => ({ data: { unexpected: true } }));
  const tools: OperationTool[] = [read, ...['review_weekly_cash', 'search_help'].map(name => ({ ...read, name, execute: otherRead }))];
  const create = vi.fn().mockRejectedValue(new Error('Provider must not be called'));
  const reserve = vi.fn().mockResolvedValue({ id: 'unused-reservation' });
  const settle = vi.fn().mockResolvedValue(undefined);
  const assertActive = vi.fn().mockResolvedValue(undefined);
  const snapshots: RunCheckpoint[] = [];
  const onCheckpoint = vi.fn(async (checkpoint: RunCheckpoint) => { snapshots.push(structuredClone(checkpoint)); });
  return { execute, read, otherRead, create, reserve, settle, assertActive, onCheckpoint, snapshots,
    deps: { tools, create, reserve, settle, assertActive, onCheckpoint, enabled: () => true, now: () => now } };
}

function expectNoPaidCalls(h: ReturnType<typeof harness>) {
  expect(h.create).not.toHaveBeenCalled();
  expect(h.reserve).not.toHaveBeenCalled();
  expect(h.settle).not.toHaveBeenCalled();
}

const malformedCommands = [
  'Investigá el cierre', 'Investigá el cierre hoy', 'Investigá el cierre de ayer',
  `Investigá el cierre ${'x'.repeat(65)}`, 'Investigá el cierre ../other',
  'Investigá el cierre shift:other', 'Investigá el cierre shift/other',
  `Investigá el cierre ${shiftId} tenantId tenant-other`,
  `Investigá el cierre ${shiftId} referencia ${'a'.repeat(63)}`,
  `Investigá el cierre ${shiftId} referencia ${'a'.repeat(65)}`,
  `Investigá el cierre ${shiftId} referencia ${'g'.repeat(64)}`,
  `${command} y confirmá la compra`, `${command}\nSELECT 1`,
  'Investigá el cierre shift-á',
  `Investigá el cierre ${shiftId} referencia ${'á'.repeat(64)}`,
];

describe('comando de investigación de un cierre', () => {
  it('interpreta exactamente el enlace compartido, incluso con una compra en curso', () => {
    expect(command).toBe(`Investigá el cierre ${shiftId} referencia ${reportHash}`);
    expect(cashCloseInvestigationRequest(command)).toEqual({ shiftId, reportHash });
    expect(shouldUseOperationalRun(command, true)).toBe(true);
    expect(cashCloseInvestigationRequest(cashCloseInvestigationMessage(shiftId))).toEqual({ shiftId });
  });
  it('conserva el ID y permite el límite exacto y hash hexadecimal en mayúsculas', () => {
    const id = `Q_${'x'.repeat(62)}`;
    expect(cashCloseInvestigationRequest(`Explicame el cierre ${id} referencia ${reportHash.toUpperCase()}!`)).toEqual({ shiftId: id, reportHash });
  });
  it.each(malformedCommands)('rechaza la referencia alterada sin reinterpretarla: %s', text => {
    expect(cashCloseInvestigationRequest(text)).toBeNull();
    expect(shouldUseOperationalRun(text, true)).toBe(true);
  });
  it.each(['Compré 50 bolsas de cemento', 'son 60 cajas', 'el precio de caja es 500', 'son las cajas grandes', 'retomemos la compra', 'confirmo'])('preserva la captura de compra: %s', text => {
    expect(cashCloseInvestigationRequest(text)).toBeUndefined();
    expect(shouldUseOperationalRun(text, true)).toBe(false);
  });
});

describe('investigación determinista con proveedor configurado', () => {
  it('ejecuta una sola lectura con identidad y referencia exactas sin reservar ni llamar al modelo', async () => {
    const h = harness();
    const result = await runAssistantOrchestrator(query, h.deps);
    expect(h.execute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ principal, conversationId: query.conversationId, runId: query.runId, toolCallId: 'step1', assertActive: expect.any(Function) }), { shiftId, reportHash });
    expect(h.otherRead).not.toHaveBeenCalled();
    expectNoPaidCalls(h);
    expect(result).toMatchObject({ degraded: true, actionProposalIds: [], evidence: [{ id: 'e1', tool: 'inspect_cash_close', data }] });
    expect(result.text).toContain('no determina la causa');
    expect(h.snapshots.at(-1)).toMatchObject({ iterations: 0, steps: [{ tool: 'inspect_cash_close', status: 'SUCCEEDED', evidenceId: 'e1' }] });
  });
  it.each(malformedCommands)('una referencia inválida no consulta ni consume IA: %s', async text => {
    const h = harness();
    const result = await runAssistantOrchestrator({ ...query, text }, h.deps);
    expect(result.evidence).toEqual([]);
    expect(result.actionProposalIds).toEqual([]);
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.otherRead).not.toHaveBeenCalled();
    expect(h.onCheckpoint).not.toHaveBeenCalled();
    expectNoPaidCalls(h);
  });
  it('conserva SOURCE_CHANGED y exige renovar la revisión sin exponer el error interno', async () => {
    const h = harness();
    h.execute.mockRejectedValue(new AssistantRunError(409, 'CASH_CLOSE_SOURCE_CHANGED', 'PRIVATE_ERROR_CANARY'));
    const result = await runAssistantOrchestrator(query, h.deps);
    expect(result.evidence).toEqual([]);
    expect(result.text).toContain('El reporte cambió desde la revisión seleccionada');
    expect(result.text).toContain('Pedí una nueva revisión');
    expect(result.text).not.toContain('PRIVATE_ERROR_CANARY');
    expect(h.snapshots.at(-1)?.steps[0]).toMatchObject({ status: 'FAILED', errorCode: 'CASH_CLOSE_SOURCE_CHANGED' });
    expectNoPaidCalls(h);
  });
  it('un fallo de consulta no inventa resultados ni filtra el mensaje interno', async () => {
    const h = harness();
    h.execute.mockRejectedValue(new Error('PRIVATE_DATABASE_CANARY'));
    const result = await runAssistantOrchestrator(query, h.deps);
    expect(result.evidence).toEqual([]);
    expect(result.text).toContain('No pude obtener un cierre autorizado');
    expect(result.text).not.toContain('PRIVATE_DATABASE_CANARY');
    expect(h.snapshots.at(-1)?.steps[0]).toMatchObject({ status: 'FAILED', errorCode: 'TOOL_UNAVAILABLE' });
    expectNoPaidCalls(h);
  });
  it('revocación previa impide consultar o publicar resultados', async () => {
    const h = harness();
    h.assertActive.mockRejectedValue(new AssistantRunError(403, 'SESSION_REVOKED', 'Acceso revocado'));
    await expect(runAssistantOrchestrator(query, h.deps)).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.snapshots).toEqual([]);
    expectNoPaidCalls(h);
  });
  it('revocación durante la lectura impide guardar su resultado', async () => {
    const h = harness();
    let active = true;
    h.assertActive.mockImplementation(async () => { if (!active) throw new AssistantRunError(403, 'SESSION_REVOKED', 'Acceso revocado'); });
    h.execute.mockImplementation(async () => { active = false; return { data }; });
    await expect(runAssistantOrchestrator(query, h.deps)).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
    expect(h.execute).toHaveBeenCalledOnce();
    expect(h.snapshots.every(checkpoint => checkpoint.evidence.length === 0)).toBe(true);
    expectNoPaidCalls(h);
  });
  it('plazo vencido impide iniciar la lectura y deja la respuesta sin evidencia', async () => {
    const h = harness();
    const result = await runAssistantOrchestrator({ ...query, deadlineAt: now }, h.deps);
    expect(result.evidence).toEqual([]);
    expect(h.execute).not.toHaveBeenCalled();
    expectNoPaidCalls(h);
  });
  it('revalida el plazo después de una herramienta que devuelve al agotarlo', async () => {
    const h = harness();
    let clock = now;
    h.execute.mockImplementation(async () => {
      clock = new Date(now.getTime() + 60_001);
      return { data };
    });
    const result = await runAssistantOrchestrator(query, { ...h.deps, now: () => clock });
    expect(result.evidence).toEqual([]);
    expect(h.snapshots.every(checkpoint => checkpoint.evidence.length === 0)).toBe(true);
    expectNoPaidCalls(h);
  });
  it('una lectura bloqueada no publica resultados después del límite', async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      h.execute.mockImplementation(() => new Promise(() => undefined));
      const pending = runAssistantOrchestrator(query, h.deps);
      await vi.advanceTimersByTimeAsync(60_001);
      const result = await pending;
      expect(result.evidence).toEqual([]);
      expect(h.snapshots.at(-1)?.steps[0].status).toBe('FAILED');
      expectNoPaidCalls(h);
    } finally { vi.useRealTimers(); }
  });
  it('capacidad apagada bloquea incluso el enlace determinista', async () => {
    const h = harness();
    await expect(runAssistantOrchestrator(query, { ...h.deps, enabled: () => false })).rejects.toMatchObject({ code: 'OPERATIONS_DISABLED' });
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.snapshots).toEqual([]);
    expectNoPaidCalls(h);
  });
});

describe('fallback cerrado de investigación', () => {
  it.each(['ausente', 'PREPARE'] as const)('sin una herramienta READ registrada (%s) no improvisa otra consulta', async kind => {
    const h = harness();
    const checkpoint = emptyCheckpoint();
    const execute = vi.fn(async () => ({ data }));
    const tools = new Map<string, OperationTool>(h.deps.tools.filter(tool => tool.name !== 'inspect_cash_close').map(tool => [tool.name, tool]));
    if (kind === 'PREPARE') tools.set(h.read.name, { ...h.read, kind: 'PREPARE' });
    const result = await deterministicRunFallback(command, now, checkpoint, tools, { execute, assertActive: h.assertActive, onCheckpoint: h.onCheckpoint });
    expect(result.evidence).toEqual([]);
    expect(result.actionProposalIds).toEqual([]);
    expect(result.text).toContain('No pude obtener un cierre autorizado');
    expect(execute).not.toHaveBeenCalled();
    expect(checkpoint.steps).toEqual([]);
  });
  it('el fallback directo prioriza la referencia del cierre y conserva su evidencia', async () => {
    const h = harness();
    const checkpoint = emptyCheckpoint();
    const execute = vi.fn(async () => ({ data }));
    const result = await deterministicRunFallback(command, now, checkpoint, new Map(h.deps.tools.map(tool => [tool.name, tool])), { execute, assertActive: h.assertActive, onCheckpoint: h.onCheckpoint });
    expect(execute).toHaveBeenCalledExactlyOnceWith(h.read, { shiftId, reportHash }, 'step1');
    expect(result.evidence).toEqual([{ id: 'e1', tool: 'inspect_cash_close', label: h.read.label, data }]);
    expect(checkpoint.steps).toEqual([{ id: 'step1', tool: 'inspect_cash_close', label: h.read.label, status: 'SUCCEEDED', evidenceId: 'e1' }]);
  });
});
