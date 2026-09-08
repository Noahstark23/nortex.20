import { Prisma, type PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import prisma from '../../../lib/prisma.js';
import type { AssistantPrincipal } from '../../../../shared/assistant.js';
import { AssistantAccessError, getAssistantCapabilities } from '../access.js';
import { getAssistantFlags } from '../config.js';
import { managuaDay } from './analyticsPeriod.js';

type Aggregate = Record<string, string | number | bigint | Prisma.Decimal | Date | null>;
export interface AssistantStatusDependencies { db?:PrismaClient; now?:()=>Date }
const ADMIN_ROLES=['OWNER','ADMIN','SUPER_ADMIN'];
const RUN_STATUSES=['PENDING','RUNNING','SUCCEEDED','FAILED','CANCELLED','OTHER'];
const QUEUE_STATUSES=['PENDING','PROCESSING','SUCCEEDED','FAILED','DONE','SENDING','SENT','UNKNOWN','CANCELLED','OTHER'];
const TERMINAL=Prisma.sql`('SUCCEEDED','FAILED','CANCELLED')`;
const decimal=(value:unknown):Decimal|null=>{
  try {if(value===null || value===undefined)return null;const number=new Decimal(String(value));return number.isFinite() && number.gte(0)?number:null;}catch{return null;}
};
const numeric=(value:unknown)=>decimal(value)?.toFixed()??null;
const iso=(value:unknown)=>value instanceof Date && Number.isFinite(value.getTime())?value.toISOString():null;
const sum=(rows:Aggregate[],key:string)=>rows.reduce((value,row)=>value.add(String(row[key]??0)),new Decimal(0));
const statuses=(rows:Aggregate[]|null,allowed:string[])=>Object.fromEntries(allowed.map(status=>[status,rows===null?null:sum(rows.filter(row=>row.status===status || status==='OTHER' && !allowed.includes(String(row.status))), 'count').toFixed()]));

export function assistantStatusQueries(tenantId:string, start:Date, end:Date, month:string) {
  const runs=Prisma.sql`SELECT status,COUNT(*) AS count,
    SUM(status='SUCCEEDED' AND JSON_UNQUOTE(JSON_EXTRACT(result,'$.degraded'))='true') AS degraded,
    SUM(status='SUCCEEDED' AND (JSON_EXTRACT(result,'$.degraded') IS NULL OR JSON_TYPE(JSON_EXTRACT(result,'$.degraded'))<>'BOOLEAN')) AS degradedUnknown,
    SUM(status IN ${TERMINAL} AND startedAt IS NOT NULL AND updatedAt>=startedAt) AS latencySamples,
    SUM(status IN ${TERMINAL} AND (startedAt IS NULL OR updatedAt<startedAt)) AS latencyUnknown,
    SUM(CASE WHEN status IN ${TERMINAL} AND startedAt IS NOT NULL AND updatedAt>=startedAt THEN TIMESTAMPDIFF(MICROSECOND,startedAt,updatedAt)/1000 ELSE 0 END) AS latencyMs,
    MIN(startedAt) AS firstStartedAt,MAX(CASE WHEN status IN ${TERMINAL} THEN updatedAt ELSE NULL END) AS lastFinishedAt
    FROM AssistantRun WHERE tenantId=${tenantId} AND createdAt>=${start} AND createdAt<${end} GROUP BY status`;
  const budget=Prisma.sql`WITH usage_totals AS (SELECT COUNT(*) AS reservations,
      COALESCE(SUM(status='UNKNOWN'),0) AS unknownCount,COALESCE(SUM(CASE WHEN status='UNKNOWN' THEN reservedUsd ELSE 0 END),0) AS unknownUsd,
      COALESCE(SUM(CASE WHEN status IN ('RESERVED','UNKNOWN') THEN reservedUsd ELSE 0 END),0) AS activeReservationsUsd,
      COALESCE(SUM(CASE WHEN status='SETTLED' THEN actualUsd ELSE 0 END),0) AS settledUsd,
      COALESCE(SUM(status='SETTLED' AND actualUsd IS NULL),0) AS missingSettledCost
      FROM AssistantUsage WHERE tenantId=${tenantId} AND month=${month}),
    bucket AS (SELECT COUNT(*) AS bucketCount,SUM(spentUsd) AS spentUsd,SUM(reservedUsd) AS reservedUsd,MAX(limitUsd) AS limitUsd,MAX(blocked) AS blocked
      FROM AssistantBudget WHERE scope=${`tenant:${tenantId}`} AND month=${month}) SELECT usage_totals.*,bucket.* FROM usage_totals CROSS JOIN bucket`;
  const queuePart=(table:Prisma.Sql,source:string,expiry:boolean)=>Prisma.sql`
    SELECT ${source} AS source,status,COUNT(*) AS count,
      SUM(status='PENDING' AND availableAt<=${end} ${expiry?Prisma.sql`AND expiresAt>${end}`:Prisma.empty}) AS ready,
      ${expiry?Prisma.sql`SUM(status IN ('PENDING','PROCESSING','SENDING') AND expiresAt<=${end})`:Prisma.sql`0`} AS expiredOpen
      FROM ${table} WHERE tenantId=${tenantId} AND createdAt<${end} GROUP BY status`;
  // Outbox no usa availableAt: su programación es por estado y ventana de entrega.
  const outbox=Prisma.sql`SELECT 'whatsappOutbox' AS source,status,COUNT(*) AS count,
    SUM(status='PENDING' AND expiresAt>${end}) AS ready,
    SUM(status IN ('PENDING','SENDING') AND expiresAt<=${end}) AS expiredOpen
    FROM AssistantWaOutbox WHERE tenantId=${tenantId} AND createdAt<${end} GROUP BY status`;
  const queues=Prisma.sql`${queuePart(Prisma.sql`AssistantJob`,'extraction',false)} UNION ALL ${queuePart(Prisma.sql`AssistantWaInbox`,'whatsappInbox',true)} UNION ALL ${outbox}`;
  const commands=Prisma.sql`SELECT kind AS source,COUNT(*) AS count,SUM(resultJson IS NOT NULL) AS completed
      FROM AssistantActionCommand WHERE tenantId=${tenantId} AND createdAt>=${start} AND createdAt<${end} GROUP BY kind
    UNION ALL SELECT 'ASSISTANT_PURCHASE' AS source,COUNT(DISTINCT c.id) AS count,
      COUNT(DISTINCT CASE WHEN c.purchaseId IS NOT NULL AND c.result IS NOT NULL THEN c.id ELSE NULL END) AS completed
      FROM PurchaseCommand c WHERE c.tenantId=${tenantId} AND c.createdAt>=${start} AND c.createdAt<${end}
      AND EXISTS(SELECT 1 FROM AssistantProposal p WHERE p.tenantId=c.tenantId AND p.operationId=c.requestKey)`;
  return {runs,budget,queues,commands};
}

function runStatus(rows:Aggregate[]|null) {
  if(rows===null)return {status:'unavailable' as const,byStatus:statuses(null,RUN_STATUSES),total:null,degraded:null,degradedUnknown:null,averageLatencyMs:null,latencySamples:null,latencyUnknown:null,firstStartedAt:null,lastFinishedAt:null};
  const samples=sum(rows,'latencySamples'),unknown=sum(rows,'latencyUnknown'),degradedUnknown=sum(rows,'degradedUnknown');
  const dates=(key:string)=>rows.map(row=>iso(row[key])).filter((value):value is string=>value!==null).sort();
  return {status:unknown.gt(0)||degradedUnknown.gt(0)?'partial' as const:'ok' as const,byStatus:statuses(rows,RUN_STATUSES),total:sum(rows,'count').toFixed(),
    degraded:sum(rows,'degraded').toFixed(),degradedUnknown:degradedUnknown.toFixed(),averageLatencyMs:samples.gt(0)?sum(rows,'latencyMs').div(samples).toDecimalPlaces(2).toFixed():null,
    latencySamples:samples.toFixed(),latencyUnknown:unknown.toFixed(),firstStartedAt:dates('firstStartedAt')[0]??null,lastFinishedAt:dates('lastFinishedAt').at(-1)??null};
}
function budgetStatus(rows:Aggregate[]|null) {
  const row=rows?.[0]??null,hasBucket=numeric(row?.bucketCount)==='1';
  const settled=numeric(row?.missingSettledCost)==='0'?decimal(row?.settledUsd):null;
  const spent=hasBucket?decimal(row?.spentUsd):null,reserved=hasBucket?decimal(row?.reservedUsd):null,limit=hasBucket?decimal(row?.limitUsd):null;
  const active=decimal(row?.activeReservationsUsd);
  const reconciled=spent && reserved && settled && active?spent.eq(settled)&&reserved.eq(active):null;
  return {status:!row?'unavailable' as const:!hasBucket || limit===null || reconciled!==true?'partial' as const:'ok' as const,
    scope:'TENANT_ONLY' as const,limitUsd:limit?.toFixed()??null,spentUsd:spent?.toFixed()??null,reservedUsd:reserved?.toFixed()??null,
    remainingUsd:limit && spent && reserved?Decimal.max(limit.minus(spent).minus(reserved),0).toFixed():null,blocked:hasBucket?Boolean(row?.blocked):null,
    usageReservations:numeric(row?.reservations),settledUsageUsd:settled?.toFixed()??null,unknownReservations:numeric(row?.unknownCount),unknownReservedUsd:numeric(row?.unknownUsd),reconciled};
}
function queueStatus(rows:Aggregate[]|null,source:string) {
  const scoped=rows?.filter(row=>row.source===source)??null;
  return {status:scoped?'ok' as const:'unavailable' as const,byStatus:statuses(scoped,QUEUE_STATUSES),ready:scoped?sum(scoped,'ready').toFixed():null,expiredOpen:scoped?sum(scoped,'expiredOpen').toFixed():null};
}
function commandStatus(rows:Aggregate[]|null) {
  const kinds=['PURCHASE_ORDER_DRAFT','BATCH_WRITEOFF','SUPPLIER_RETURN','PROMOTION','ASSISTANT_PURCHASE','OTHER'];
  const byKind=Object.fromEntries(kinds.map(kind=>{
    const filtered=rows?.filter(row=>row.source===kind || kind==='OTHER'&&!kinds.includes(String(row.source)))??null;
    return [kind,{recorded:filtered?sum(filtered,'count').toFixed():null,completed:filtered?sum(filtered,'completed').toFixed():null}];
  }));
  return {status:rows?'ok' as const:'unavailable' as const,byKind,replayed:{status:'unavailable' as const,value:null,reason:'Los reintentos recuperados no tienen un contador persistente; no se deducen del número de comandos.'}};
}

export async function getAssistantHealthStatus(principal:AssistantPrincipal,deps:AssistantStatusDependencies={}) {
  if(!ADMIN_ROLES.includes(principal.role))throw new AssistantAccessError(403,'ASSISTANT_STATUS_FORBIDDEN','Sólo administración puede consultar el estado operativo.');
  const db=deps.db??prisma,now=deps.now?.()??new Date();
  let capabilities=await getAssistantCapabilities(principal,db);
  const start=new Date(now.getTime()-86400_000),month=managuaDay(now).slice(0,7);
  const base={checkedAt:now.toISOString(),window:{start:start.toISOString(),end:now.toISOString(),timeZone:'America/Managua'},month,
    runbook:'docs/NORTEXGPT_EVALUACION_OPERATIVA_2026-09-05.md#estado-operativo'};
  const disabled=()=>({...base,status:'disabled' as const,capabilities,switches:getAssistantFlags(),runs:null,budget:null,queues:null,commands:null,warnings:['NortexGPT está deshabilitado; no se consultaron sus indicadores.']});
  if(!capabilities.enabled)return disabled();
  const queries=assistantStatusQueries(principal.tenantId,start,now,month),warnings:string[]=[];
  const read=async(label:string,query:Prisma.Sql):Promise<Aggregate[]|null>=>{
    try{return await db.$queryRaw<Aggregate[]>(query);}catch{warnings.push(`No fue posible verificar ${label}.`);return null;}
  };
  const [runRows,budgetRows,queueRows,commandRows]=await Promise.all([read('ejecuciones',queries.runs),read('consumo',queries.budget),read('colas',queries.queues),read('comandos',queries.commands)]);
  capabilities=await getAssistantCapabilities(principal,db);
  if(!capabilities.enabled)return disabled();
  const runs=runStatus(runRows),budget=budgetStatus(budgetRows),queues={scope:'RETAINED_TENANT_RECORDS' as const,extraction:queueStatus(queueRows,'extraction'),whatsappInbox:queueStatus(queueRows,'whatsappInbox'),whatsappOutbox:queueStatus(queueRows,'whatsappOutbox')},commands=commandStatus(commandRows);
  const verified=[runs,budget,queues.extraction,queues.whatsappInbox,queues.whatsappOutbox,commands];
  if(!budgetRows?.length || budget.reconciled!==true)warnings.push('Sin un presupuesto materializado y conciliado no se informa saldo disponible como cero.');
  warnings.push('La latencia usa startedAt y updatedAt terminal, excluye espera de cola y muestra cuántas muestras tienen evidencia.',
    'UNKNOWN conserva una reserva conservadora; no acredita el costo final del proveedor. Las colas incluyen sólo registros retenidos del negocio.');
  return {...base,status:verified.every(item=>item.status==='unavailable')?'unavailable' as const:verified.every(item=>item.status==='ok')?'ok' as const:'partial' as const,
    capabilities,switches:getAssistantFlags(),runs,budget,queues,commands,warnings};
}
