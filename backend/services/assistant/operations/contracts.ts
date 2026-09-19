import type Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';
import type { AssistantPrincipal } from '../../../../shared/assistant.js';
import type { AssistantJson, AssistantRunStep, AssistantRunResult, AssistantToolEvidence } from '../../../../shared/assistantOperations.js';

export type JsonValue = AssistantJson;
export type ToolEvidence = AssistantToolEvidence;
export type RunStep = AssistantRunStep;
export type RunResult = AssistantRunResult;
export interface ToolContext { principal: AssistantPrincipal; conversationId: string; runId: string; toolCallId: string; assertActive: () => Promise<void> }
export interface ToolOutput { data: JsonValue; actionProposalIds?: string[] }
export interface OperationTool {
  name: string; description: string; label: string; kind: 'READ' | 'PREPARE'; schema: z.ZodType;
  execute(context: ToolContext, input: unknown): Promise<ToolOutput>;
}
export interface RunCheckpoint {
  iterations: number; messages: Anthropic.MessageParam[]; steps: RunStep[]; evidence: ToolEvidence[]; actionProposalIds: string[];
}
export class AssistantRunError extends Error {
  constructor(public statusCode: number, public code: string, message: string) { super(message); this.name = 'AssistantRunError'; }
}
