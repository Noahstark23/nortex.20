import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import { AssistantRunError, type RunCheckpoint } from './contracts.js';

export const runInputSchema=z.object({requestId:z.uuid().transform(value=>value.toLowerCase()),text:z.string().trim().min(1).max(4000)}).strict();
export const runStepSchema=z.object({id:z.string(),tool:z.string(),label:z.string(),status:z.enum(['RUNNING','SUCCEEDED','FAILED']),evidenceId:z.string().optional(),errorCode:z.string().optional()}).strict();
const evidenceSchema=z.object({id:z.string(),tool:z.string(),label:z.string(),data:z.json()}).strict().transform(value=>({...value,data:value.data??null}));
export const runResultSchema=z.object({text:z.string().max(4000),evidence:z.array(evidenceSchema).max(8),actionProposalIds:z.array(z.string()).max(8),degraded:z.boolean()}).strict();
const checkpointSchema=z.object({iterations:z.number().int().min(0).max(4),messages:z.array(z.object({role:z.enum(['user','assistant']),content:z.union([z.string(),z.array(z.json())])}).strict()).max(9),steps:z.array(runStepSchema).max(4),evidence:z.array(evidenceSchema).max(4),actionProposalIds:z.array(z.string()).max(8)}).strict();
export function readRunCheckpoint(value:unknown):RunCheckpoint {
  if(value===null||value===undefined)return {iterations:0,messages:[],steps:[],evidence:[],actionProposalIds:[]};
  const parsed=checkpointSchema.safeParse(value);
  if(!parsed.success)throw new AssistantRunError(409,'RUN_CHECKPOINT_INVALID','La ejecución necesita una nueva consulta.');
  return {...parsed.data,messages:parsed.data.messages as Anthropic.MessageParam[]};
}
