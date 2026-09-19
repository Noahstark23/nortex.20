import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { assertAssistantAccess } from './access.js';
import { AssistantDocumentError } from './attachments.js';
import type { AssistantPrincipal } from '../../../shared/assistant.js';

export const GLOBAL_BUDGET_USD = '20';
export const TENANT_BUDGET_USD = '10';
// Haiku 4.5 estándar global, sin cache ni tools facturables. Fuente: docs oficiales, 2026-09-05.
export const INPUT_USD_PER_MILLION = '1';
export const OUTPUT_USD_PER_MILLION = '5';
export const MAX_EXTRACTION_INPUT_TOKENS = 200_000;
export const MAX_EXTRACTION_OUTPUT_TOKENS = 16_384;
export function tokenCostUsd(input: number, output: number): string {
  if (![input,output].every(n=>Number.isSafeInteger(n)&&n>=0)) throw new AssistantDocumentError('USAGE_INVALID','El consumo recibido no es válido.',503);
  return new Decimal(input).mul(INPUT_USD_PER_MILLION).add(new Decimal(output).mul(OUTPUT_USD_PER_MILLION)).div(1_000_000).toFixed(6,Decimal.ROUND_UP);
}
// Reserva del contexto completo: incluye PDF/imágenes, prompt, schema y salida; cada retry reserva aparte.
export const MAX_EXTRACTION_RESERVATION_USD = tokenCostUsd(MAX_EXTRACTION_INPUT_TOKENS,MAX_EXTRACTION_OUTPUT_TOKENS);
export function budgetMonth(now: Date): string {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Managua',year:'numeric',month:'2-digit'}).formatToParts(now);
  return `${parts.find(p=>p.type==='year')!.value}-${parts.find(p=>p.type==='month')!.value}`;
}
// `runId` vincula el consumo con la ejecución que lo originó. Se pasa en la RESERVA,
// antes de llamar al proveedor: una liquidación posterior no alcanza, porque los
// fallos, reinicios y costos inciertos nunca llegan a liquidar.
export interface BudgetDependencies { db?:typeof prisma; now?:()=>Date; capability?:'help'|'invoicePrepare'; runId?:string }

async function lockBudget(tx: Prisma.TransactionClient, scope: string, month: string, limit: string) {
  const id=`${scope}:${month}`;
  // Upsert nativo: adquiere lock exclusivo sin upgrade del shared lock de INSERT IGNORE.
  await tx.$executeRaw(Prisma.sql`INSERT INTO AssistantBudget (id, scope, month, limitUsd, reservedUsd, spentUsd, blocked, updatedAt)
    VALUES (${id}, ${scope}, ${month}, ${limit}, 0, 0, false, UTC_TIMESTAMP(3))
    ON DUPLICATE KEY UPDATE limitUsd = VALUES(limitUsd), updatedAt = UTC_TIMESTAMP(3)`);
  const rows=await tx.$queryRaw<Array<{id:string;limitUsd:Prisma.Decimal;reservedUsd:Prisma.Decimal;spentUsd:Prisma.Decimal;blocked:boolean}>>(Prisma.sql`SELECT id, limitUsd, reservedUsd, spentUsd, blocked FROM AssistantBudget WHERE id = ${id} FOR UPDATE`);
  if(!rows[0]) throw new AssistantDocumentError('BUDGET_INCONSISTENT','No se pudo reservar el presupuesto.',503);
  return rows[0];
}

// El vínculo sólo se escribe si el cliente generado ya conoce el campo. Antes de
// correr la migración y `prisma generate`, mandarlo haría fallar la reserva; el
// orquestador trata un fallo de reserva como respaldo y la consulta caería al
// respaldo determinista sin avisar. Se degrada a no acreditar, no a no responder.
export const USAGE_SUPPORTS_RUN_LINK = Prisma.dmmf.datamodel.models
  .find(model => model.name === 'AssistantUsage')?.fields.some(field => field.name === 'runId') ?? false;

export async function reserveAssistantBudget(principal: AssistantPrincipal, requested = MAX_EXTRACTION_RESERVATION_USD, deps:BudgetDependencies={}) {
  const db=deps.db??prisma, now=deps.now?.()??new Date(), month=budgetMonth(now);
  const amount=new Decimal(requested);
  if (!amount.isFinite() || amount.lte(0) || amount.gt(MAX_EXTRACTION_RESERVATION_USD)) throw new AssistantDocumentError('BUDGET_RESERVATION','La reserva de consumo no es válida.',400);
  await assertAssistantAccess(principal,deps.capability??'invoicePrepare',db);
  return db.$transaction(async tx=>{
    const config=await tx.assistantTenantConfig.findUnique({where:{tenantId:principal.tenantId},select:{monthlyBudgetUsd:true}});
    const tenantLimit=Decimal.min(TENANT_BUDGET_USD,config?.monthlyBudgetUsd?.toString()??'0');
    const global=await lockBudget(tx,'global',month,GLOBAL_BUDGET_USD);
    const tenant=await lockBudget(tx,`tenant:${principal.tenantId}`,month,tenantLimit.toString());
    for (const bucket of [global,tenant]) {
      if (bucket.blocked || new Decimal(bucket.spentUsd.toString()).add(bucket.reservedUsd.toString()).add(amount).gt(bucket.limitUsd.toString())) throw new AssistantDocumentError('BUDGET_EXHAUSTED','Se alcanzó el presupuesto mensual de IA. Podés continuar con las funciones habituales.',429);
    }
    for (const bucket of [global,tenant]) await tx.assistantBudget.updateMany({where:{id:bucket.id},data:{reservedUsd:{increment:amount.toString()}}});
    return tx.assistantUsage.create({data:{id:randomUUID(),tenantId:principal.tenantId,userId:principal.userId,month,reservedUsd:amount.toString(),status:'RESERVED',...(deps.runId&&USAGE_SUPPORTS_RUN_LINK?{runId:deps.runId}:{})}});
  },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
}

export async function settleAssistantBudget(principal: AssistantPrincipal, usageId:string, usage:{inputTokens:number;outputTokens:number;requestId?:string}|null, deps:BudgetDependencies={}) {
  const db=deps.db??prisma;
  return db.$transaction(async tx=>{
    await tx.$queryRaw(Prisma.sql`SELECT id FROM AssistantUsage WHERE id = ${usageId} AND tenantId = ${principal.tenantId} AND userId = ${principal.userId} FOR UPDATE`);
    const row=await tx.assistantUsage.findFirst({where:{id:usageId,tenantId:principal.tenantId,userId:principal.userId}});
    if (!row || row.status !== 'RESERVED') return;
    if (!usage) { await tx.assistantUsage.updateMany({where:{id:usageId,tenantId:principal.tenantId,userId:principal.userId,status:'RESERVED'},data:{status:'UNKNOWN'}}); return; }
    const actual=tokenCostUsd(usage.inputTokens,usage.outputTokens);
    // Un consumo real superior al máximo reservado se contabiliza y bloquea nuevas llamadas.
    const exceeded=new Decimal(actual).gt(row.reservedUsd.toString());
    for (const scope of ['global',`tenant:${principal.tenantId}`]) {
      const id=`${scope}:${row.month}`;
      await tx.$queryRaw(Prisma.sql`SELECT id FROM AssistantBudget WHERE id = ${id} FOR UPDATE`);
      const changed=await tx.assistantBudget.updateMany({where:{id,reservedUsd:{gte:row.reservedUsd}},data:{reservedUsd:{decrement:row.reservedUsd},spentUsd:{increment:actual},...(exceeded?{blocked:true}:{})}});
      if(changed.count !== 1) throw new AssistantDocumentError('BUDGET_INCONSISTENT','El consumo requiere revisión antes de continuar.',503);
    }
    // No se toca `runId`: el vínculo escrito en la reserva se conserva al liquidar.
    await tx.assistantUsage.updateMany({where:{id:usageId,tenantId:principal.tenantId,userId:principal.userId,status:'RESERVED'},data:{status:'SETTLED',actualUsd:actual,providerRequestId:usage.requestId?.slice(0,191),usage:{inputTokens:usage.inputTokens,outputTokens:usage.outputTokens}}});
  });
}
