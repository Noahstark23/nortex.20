import type { PrismaClient } from '@prisma/client';
import type { AssistantPrincipal,AssistantMessageDTO } from '../../../../shared/assistant.js';
import type { AssistantRunDTO } from '../../../../shared/assistantOperations.js';
import { processAssistantRun } from '../operations/runService.js';

export function renderPrivateWaReply(reply:AssistantMessageDTO,link:string) {
  const metrics=reply.overview?`\nPeríodo: ${reply.overview.startDate} a ${reply.overview.endDate}. Consulta: ${reply.overview.checkedAt}.\n${reply.overview.metrics.map(metric=>`${metric.label}: ${metric.status==='ok'?metric.value:'no disponible'} (${metric.source})`).join('\n')}`:'';
  const citations=reply.citations?.length?`\nFuentes: ${reply.citations.map(source=>`${source.title}, ${source.section}, versión ${source.version}`).join('; ')}`:'';
  const footer=`\n\nAbrí tu sesión de Nortex para revisar los detalles y confirmar cualquier operación: ${link}`;
  const evidence=(metrics+citations).slice(0,2000);
  return `${reply.text.slice(0,Math.max(0,4096-footer.length-evidence.length))}${evidence}${footer}`;
}

/** The core claims PENDING once and recovers abandoned RUNNING as interrupted, without replaying tools. */
export function resolvePrivateWaOperationalRun(principal:AssistantPrincipal,id:string,db:PrismaClient) {
  return processAssistantRun(principal,id,{db});
}
export function renderPrivateWaOperationalReply(run:AssistantRunDTO,link:string):string {
  if(run.status==='PENDING'||run.status==='RUNNING')throw new Error('An unfinished run cannot produce a final WhatsApp reply.');
  let text=run.status==='CANCELLED'?'La consulta fue cancelada. No se confirmó ninguna operación.':
    run.status==='FAILED'?'No pude completar la consulta. Conservé su referencia para revisarla en Nortex. No se confirmó ninguna operación.':
      run.result?.text??'La consulta no entregó un resultado verificable. Revisala en Nortex antes de continuar.';
  if(run.status==='SUCCEEDED'&&run.result) {
    if(run.result.degraded)text=`Consulta incompleta. ${text}`;
    // Preserve source dates and the authenticated link even when the model uses its full text limit.
    text=text.slice(0,1700);
    const sources=run.result.evidence.map(evidence=>{
      const data=evidence.data&&typeof evidence.data==='object'&&!Array.isArray(evidence.data)?evidence.data:null;
      const period=data?.period&&typeof data.period==='object'&&!Array.isArray(data.period)?data.period:null;
      const dates=period&&typeof period.startDate==='string'&&typeof period.endDate==='string'?` (${period.startDate} a ${period.endDate}; corte ${String(period.cutoff??'no disponible')})`:'';
      return `${evidence.label} [${evidence.id}]${dates}`;
    });
    text+=`\nConsulta: ${run.updatedAt}.`;
    if(sources.length)text+=`\nFuentes: ${sources.join('; ').slice(0,1600)}.`;
  }
  return renderPrivateWaReply({id:run.id,role:'assistant',createdAt:run.updatedAt,text},link);
}
