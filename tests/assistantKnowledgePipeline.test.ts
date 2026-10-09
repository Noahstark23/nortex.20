import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { OperationTool, RunCheckpoint, RunResult } from '../backend/services/assistant/operations/contracts';
import { runAssistantOrchestrator } from '../backend/services/assistant/operations/orchestrator';
import { collectRunKnowledgeReferences, presentRunKnowledge } from '../backend/services/assistant/operations/knowledgeProvenance';
import { runResultSchema, readRunCheckpoint } from '../backend/services/assistant/operations/runValidation';

const principal = { tenantId: 'tenant-help-a', userId: 'user-help-a', role: 'OWNER' };
const reference = { documentId: 'document-help', version: 'v1', sectionId: 'main', contentHash: 'a'.repeat(64) };
const citation = { id: reference.documentId, title: 'Ayuda', section: 'Procedimiento', version: reference.version, path: 'nortex-help:document-help', sectionId: reference.sectionId, contentHash: reference.contentHash };
const helpEvidence = { id: 'e1', tool: 'search_help', label: 'Ayuda', data: { text: 'Contenido de ayuda reservado', citations: [citation] } };
const operationalEvidence = { id: 'e2', tool: 'read_sample', label: 'Dato independiente', data: { status: 'ok' } };
const result: RunResult = { text: 'Explicación derivada reservada', evidence: [operationalEvidence], actionProposalIds: ['draft-preserved'], degraded: false, knowledgeReferences: [reference] };
const checkpoint: RunCheckpoint = { iterations: 1, messages: [], steps: [], evidence: [helpEvidence, operationalEvidence], actionProposalIds: ['draft-preserved'], knowledgeReferences: [reference] };
const query = { principal, conversationId: 'conversation-help', runId: 'run-help', text: 'Explicame esta ayuda' };
const response = (name: string, input: unknown) => ({ id: 'provider-mock', stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: 'tool_use', id: 'call-help', name, input }] });
function harness() {
  let valid = true;
  const help: OperationTool = { name: 'search_help', description: 'Ayuda', label: 'Ayuda', kind: 'READ', schema: z.object({}).strict(), execute: vi.fn(async () => ({ data: helpEvidence.data, knowledgeReferences: [reference] })) };
  const read: OperationTool = { name: 'read_sample', description: 'Dato independiente', label: 'Dato independiente', kind: 'READ', schema: z.object({}).strict(), execute: vi.fn(async () => ({ data: operationalEvidence.data })) };
  const create = vi.fn().mockResolvedValueOnce(response('search_help', {})).mockResolvedValueOnce(response('read_sample', {})).mockResolvedValueOnce(response('respond_with_evidence', { text: 'Respuesta revisada', evidenceIds: ['e2'] }));
  const snapshots: RunCheckpoint[] = [];
  const validateKnowledge = vi.fn(async () => valid);
  const deps = { tools: [help, read], create, validateKnowledge, reserve: vi.fn(async () => ({ id: 'reservation-mock' })), settle: vi.fn(async () => undefined), assertActive: vi.fn(async () => undefined), onCheckpoint: vi.fn(async (value: RunCheckpoint) => { snapshots.push(structuredClone(value)); }), enabled: () => true };
  return { deps, help, read, snapshots, retire: () => { valid = false; } };
}

describe('procedencia completa y retirada de ayuda en el pipeline', () => {
  it('conserva las fuentes consumidas aunque el modelo sólo cite evidencia operativa', async () => {
    const h = harness();
    const actual = await runAssistantOrchestrator(query, h.deps);
    expect(actual.evidence.map(item => item.tool)).toEqual(['read_sample']);
    expect(actual.knowledgeReferences).toEqual([reference]);
    expect(actual.degraded).toBe(false);
    expect(h.snapshots.at(-1)?.knowledgeReferences).toEqual([reference]);
  });
  it('no envía una segunda llamada con ayuda retirada después del checkpoint', async () => {
    const h = harness();
    h.deps.onCheckpoint.mockImplementation(async value => { h.snapshots.push(structuredClone(value)); if (value.evidence.some(item => item.tool === 'search_help')) h.retire(); });
    const actual = await runAssistantOrchestrator(query, h.deps);
    expect(h.deps.create).toHaveBeenCalledTimes(1);
    expect(actual).toMatchObject({ knowledgeUnavailable: true, degraded: true });
    expect(JSON.stringify(actual)).not.toContain('Contenido de ayuda reservado');
  });
  it('suprime la respuesta final si la fuente se retira durante el proveedor', async () => {
    const h = harness();
    h.deps.create.mockReset().mockResolvedValueOnce(response('search_help', {})).mockImplementationOnce(async () => { h.retire(); return response('respond_with_evidence', { text: 'Contenido de ayuda reservado', evidenceIds: ['e1'] }); });
    const actual = await runAssistantOrchestrator(query, h.deps);
    expect(actual.knowledgeUnavailable).toBe(true);
    expect(actual.evidence).toEqual([]);
    expect(actual.text).not.toContain('Contenido de ayuda reservado');
  });
  it('libera una reserva no usada si la fuente se retira al reservar', async () => {
    const h = harness();
    h.deps.reserve.mockImplementation(async () => { h.retire(); return { id: 'unused-reservation' }; });
    const actual = await runAssistantOrchestrator({ ...query, checkpoint }, h.deps);
    expect(h.deps.create).not.toHaveBeenCalled();
    expect(h.deps.settle).toHaveBeenCalledWith(principal, 'unused-reservation', { inputTokens: 0, outputTokens: 0 });
    expect(actual.knowledgeUnavailable).toBe(true);
  });
  it('hereda las dependencias de resultados anteriores aunque no vuelvan a citarse', async () => {
    const h = harness();
    const actual = await runAssistantOrchestrator({ ...query, previousResults: [{ runId: 'old', recordedAt: '2026-09-19T12:00:00Z', stale: true, refreshRequiredBeforePreparation: true, result }] }, h.deps);
    expect(actual.knowledgeReferences).toEqual([reference]);
    expect(h.deps.validateKnowledge.mock.calls.length).toBeGreaterThan(0);
  });
  it('no llama al proveedor con un resultado anterior ya invalidado', async () => {
    const h = harness();
    await runAssistantOrchestrator({ ...query, previousResults: [{ runId: 'old', recordedAt: '2026-09-19T12:00:00Z', stale: true, refreshRequiredBeforePreparation: true, result: { ...result, knowledgeUnavailable: true } }] }, h.deps);
    expect(h.deps.create).not.toHaveBeenCalled();
  });
  it('la lectura determinista también conserva y revalida sus fuentes sin llamar al proveedor', async () => {
    const h = harness();
    h.deps.reserve.mockRejectedValue(new Error('provider disabled for this scenario'));
    h.deps.tools[0] = { ...h.help, schema: z.object({ query: z.string() }).strict() };
    const actual = await runAssistantOrchestrator(query, h.deps);
    expect(h.deps.create).not.toHaveBeenCalled();
    expect(actual.knowledgeReferences).toEqual([reference]);
    expect(actual.evidence[0]?.tool).toBe('search_help');
    expect(actual.degraded).toBe(true);
  });
  it('la presentación del historial oculta toda prosa derivada y conserva evidencia y propuestas independientes', async () => {
    const actual = await presentRunKnowledge(principal, result, checkpoint, {} as never, 'WEB_INTERNAL', async () => false);
    expect(actual).toMatchObject({ degraded: true, knowledgeUnavailable: true, actionProposalIds: ['draft-preserved'], evidence: [operationalEvidence] });
    expect(actual.text).not.toBe(result.text);
  });
  it('lee procedencia legacy desde el checkpoint aunque la respuesta omitiera la cita', () => {
    expect(collectRunKnowledgeReferences({ ...result, knowledgeReferences: undefined }, { ...checkpoint, knowledgeReferences: undefined })).toEqual([reference]);
  });
  it('no acredita contexto legacy heredado cuya procedencia completa no se guardó', () => {
    const legacy = { ...checkpoint, knowledgeReferences: undefined, messages: [{ role: 'user' as const, content: JSON.stringify({ resultadosAnteriores: [{ result }] }) }] };
    expect(collectRunKnowledgeReferences(result, legacy)).toBeNull();
  });
  it('un tool_result conserva su fuente aunque el checkpoint sólo seleccione evidencia independiente', async () => {
    const h = harness(); h.retire();
    const prior: RunCheckpoint = { ...checkpoint, knowledgeReferences: [], evidence: [operationalEvidence], messages: [
      { role: 'assistant', content: [{ type: 'tool_use', id: 'hidden-help', name: 'search_help', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'hidden-help', content: JSON.stringify(helpEvidence) }] },
    ] };
    expect(collectRunKnowledgeReferences(undefined, prior)).toEqual([reference]);
    const actual = await runAssistantOrchestrator({ ...query, checkpoint: prior }, h.deps);
    expect(h.deps.create).not.toHaveBeenCalled();
    expect(actual).toMatchObject({ knowledgeUnavailable: true, evidence: [operationalEvidence] });
  });
  it('un tool_result de ayuda sin identidad demostrable no llega al proveedor', async () => {
    const h = harness();
    const prior: RunCheckpoint = { ...checkpoint, knowledgeReferences: [], evidence: [], messages: [
      { role: 'assistant', content: [{ type: 'tool_use', id: 'unknown-help', name: 'search_help', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'unknown-help', content: 'Texto sin versión' }] },
    ] };
    expect(collectRunKnowledgeReferences(undefined, prior)).toBeNull();
    expect((await runAssistantOrchestrator({ ...query, checkpoint: prior }, h.deps)).knowledgeUnavailable).toBe(true);
    expect(h.deps.create).not.toHaveBeenCalled();
  });
  it('falla cerrado ante evidencia sin identidad y hash verificables', async () => {
    const unknown: RunResult = { ...result, knowledgeReferences: [], evidence: [{ ...helpEvidence, data: { text: 'Secreto retirado', citations: [{ id: 'missing', version: 'v0' }] } }] };
    const actual = await presentRunKnowledge(principal, unknown, undefined, {} as never, 'WEB_INTERNAL', async () => true);
    expect(actual.knowledgeUnavailable).toBe(true);
    expect(JSON.stringify(actual)).not.toContain('Secreto retirado');
  });
  it('acepta runs antiguos sin ayuda y nuevos con dependencia explícita vacía', () => {
    const independent = { ...result, knowledgeReferences: undefined };
    expect(runResultSchema.safeParse(independent).success).toBe(true);
    expect(collectRunKnowledgeReferences(independent)).toEqual([]);
    expect(readRunCheckpoint({ ...checkpoint, knowledgeReferences: [] }).knowledgeReferences).toEqual([]);
  });
  it('rechaza más de 64 fuentes y hashes incompletos al leer JSON persistido', () => {
    expect(runResultSchema.safeParse({ ...result, knowledgeReferences: Array(65).fill(reference) }).success).toBe(false);
    expect(runResultSchema.safeParse({ ...result, knowledgeReferences: [{ ...reference, contentHash: 'bad' }] }).success).toBe(false);
  });
});
