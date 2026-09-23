import type { AssistantCitation, AssistantPrincipal } from '../../../../shared/assistant.js';
import type { AssistantKnowledgeChannel, AssistantKnowledgeReference } from '../../../../shared/assistantKnowledge.js';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { RunCheckpoint, RunResult, ToolEvidence } from './contracts.js';
import { knowledgeReferencesSchema } from './runValidation.js';
import { KNOWLEDGE_UNAVAILABLE_TEXT, referencesFromCitations, validateAssistantKnowledgeReferences } from '../knowledge/service.js';

type Database = PrismaClient | Prisma.TransactionClient;
export type KnowledgeValidator = (references: AssistantKnowledgeReference[]) => Promise<boolean>;
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function mergeKnowledgeReferences(...groups: AssistantKnowledgeReference[][]): AssistantKnowledgeReference[] {
  const unique = new Map<string, AssistantKnowledgeReference>();
  for (const group of groups) for (const reference of group) unique.set(JSON.stringify([reference.documentId, reference.version, reference.sectionId, reference.contentHash]), reference);
  return knowledgeReferencesSchema.parse([...unique.values()]);
}

function evidenceReferences(evidence: ToolEvidence[]): AssistantKnowledgeReference[] | null {
  const groups: AssistantKnowledgeReference[][] = [];
  for (const item of evidence.filter(value => value.tool === 'search_help')) {
    const data = object(item.data);
    if (!data || !Array.isArray(data.citations)) return null;
    const references = referencesFromCitations(data.citations as AssistantCitation[]);
    if (references === null) return null;
    groups.push(references);
  }
  return mergeKnowledgeReferences(...groups);
}

function checkpointMessageReferences(checkpoint: RunCheckpoint): AssistantKnowledgeReference[] | null {
  const calls = new Map<string, string>();
  const blocks = checkpoint.messages.flatMap(message => Array.isArray(message.content) ? message.content : []);
  for (const value of blocks) {
    const block = object(value);
    if (block?.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') calls.set(block.id, block.name);
  }
  const references: AssistantKnowledgeReference[][] = [];
  for (const value of blocks) {
    const block = object(value);
    if (block?.type !== 'tool_result') continue;
    const isHelp = typeof block.tool_use_id === 'string' && calls.get(block.tool_use_id) === 'search_help';
    const texts = typeof block.content === 'string' ? [block.content] : Array.isArray(block.content)
      ? block.content.flatMap(item => { const content = object(item); return content?.type === 'text' && typeof content.text === 'string' ? [content.text] : []; }) : [];
    if (isHelp && !texts.length) return null;
    for (const text of texts) {
      let payload: Record<string, unknown> | null;
      try { payload = object(JSON.parse(text)); } catch { if (isHelp) return null; continue; }
      if (!isHelp && payload?.tool !== 'search_help') continue;
      // Un error tipado sin cuerpo no contiene un pasaje consumido por el modelo.
      if (typeof payload?.error === 'string' && !('data' in payload) && !('citations' in payload)) continue;
      const data = object(payload?.data) ?? payload;
      if (!Array.isArray(data?.citations)) return null;
      const group = referencesFromCitations(data.citations as AssistantCitation[]);
      if (group === null) return null;
      references.push(group);
    }
  }
  return mergeKnowledgeReferences(...references);
}

/** Dependencias completas del servidor, independientes de las citas elegidas por el modelo. */
export function collectRunKnowledgeReferences(result?: RunResult, checkpoint?: RunCheckpoint): AssistantKnowledgeReference[] | null {
  try {
    const evidence = evidenceReferences([...(result?.evidence ?? []), ...(checkpoint?.evidence ?? [])]);
    if (evidence === null) return null;
    const groups = [evidence];
    if (checkpoint) {
      const messages = checkpointMessageReferences(checkpoint);
      if (messages === null) return null;
      groups.push(messages);
    }
    for (const value of [result?.knowledgeReferences, checkpoint?.knowledgeReferences]) {
      if (value !== undefined) groups.push(knowledgeReferencesSchema.parse(value));
    }
    // Una ejecución anterior no guardaba todas sus dependencias. No reconstruir por similitud
    // el texto derivado que llegó como contexto desde otros runs.
    if (checkpoint && checkpoint.knowledgeReferences === undefined) for (const message of checkpoint.messages) {
      if (typeof message.content !== 'string') continue;
      let content: Record<string, unknown> | null;
      try { content = object(JSON.parse(message.content)); } catch { continue; }
      if (Array.isArray(content?.resultadosAnteriores) && content.resultadosAnteriores.length) return null;
    }
    return mergeKnowledgeReferences(...groups);
  } catch { return null; }
}

export function knowledgeUnavailableResult(result: RunResult): RunResult {
  return { ...result, text: KNOWLEDGE_UNAVAILABLE_TEXT, evidence: result.evidence.filter(item => item.tool !== 'search_help'), degraded: true, knowledgeUnavailable: true };
}

export async function presentRunKnowledge(principal: AssistantPrincipal, result: RunResult, checkpoint: RunCheckpoint | undefined, db: Database, channel: AssistantKnowledgeChannel = 'WEB_INTERNAL', validate?: KnowledgeValidator): Promise<RunResult> {
  const references = collectRunKnowledgeReferences(result, checkpoint);
  const valid = references !== null && !result.knowledgeUnavailable && !checkpoint?.knowledgeUnavailable &&
    (!references.length || await (validate ?? (refs => validateAssistantKnowledgeReferences(principal, refs, db as PrismaClient, channel)))(references));
  const annotated = { ...result, ...(references !== null ? { knowledgeReferences: references } : {}) };
  return valid ? annotated : knowledgeUnavailableResult(annotated);
}
