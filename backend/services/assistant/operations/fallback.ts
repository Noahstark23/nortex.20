import { z } from 'zod';
import { normalizeAssistantText } from '../knowledge.js';
import { managuaDay,shiftCivilDay } from './analyticsPeriod.js';
import type { OperationTool,RunCheckpoint,RunResult,ToolOutput } from './contracts.js';

function requests(text:string,now:Date):Array<{name:string;args:unknown}> {
  const normalized=normalizeAssistantText(text),dates=text.match(/\d{4}-\d{2}-\d{2}/g)??[];
  const unparsedPeriod=/\b(semana|mes|mensual|anual|ano|ultimos|ultimas)\b/.test(normalized)&&!dates.length;
  if(unparsedPeriod||dates.length>2||dates.some(date=>!z.iso.date().safeParse(date).success))return [];
  const day=/\bayer\b/.test(normalized)?shiftCivilDay(managuaDay(now),-1):managuaDay(now);
  const period=dates.length?{startDate:dates[0],endDate:dates.at(-1)}:{startDate:day,endDate:day};
  const result:Array<{name:string;args:unknown}>=[];
  if(/\b(ventas|gastos|negocio|utilidad|ganancia|resumen|vendimos|cuentas|saldo|saldos)\b/.test(normalized))result.push({name:'audit_business_health',args:period});
  if(/\b(venci(?:dos|mientos|miento|do)?|vencer|caduca(?:dos|r)?)\b/.test(normalized))result.push({name:'inspect_batch_expiry',args:{limit:10}});
  if(/\b(inventario|existencias|stock|reposicion|reponer|cobertura|rotacion)\b/.test(normalized))result.push({name:'check_inventory_burn_rate',args:dates.length?{...period,limit:10}:{limit:10}});
  if(!result.length)result.push({name:'search_help',args:{query:text.slice(0,500)}});
  return result.slice(0,3);
}

/** Degradación sin proveedor: sólo lecturas cerradas, nunca preparación ni efectos. */
export async function deterministicRunFallback(text:string,now:Date,checkpoint:RunCheckpoint,tools:Map<string,OperationTool>,deps:{
  execute:(tool:OperationTool,args:unknown,stepId:string)=>Promise<ToolOutput>;
  assertActive:()=>Promise<void>;onCheckpoint:(checkpoint:RunCheckpoint)=>Promise<void>;
}):Promise<RunResult> {
  for(const request of requests(text,now)) {
    if(checkpoint.steps.length>=4)break;
    const tool=tools.get(request.name);
    if(!tool||tool.kind!=='READ'||checkpoint.evidence.some(item=>item.tool===tool.name))continue;
    await deps.assertActive();
    const step={id:`step${checkpoint.steps.length+1}`,tool:tool.name,label:tool.label,status:'RUNNING' as const};
    checkpoint.steps.push(step);await deps.onCheckpoint(checkpoint);
    try {
      const output=await deps.execute(tool,tool.schema.parse(request.args),step.id);
      await deps.assertActive();
      const data=z.json().parse(output.data);
      if(JSON.stringify(data).length>18000)throw new Error('Fallback output limit');
      const evidence={id:`e${checkpoint.evidence.length+1}`,tool:tool.name,label:tool.label,data};
      checkpoint.evidence.push(evidence);checkpoint.steps[checkpoint.steps.length-1]={...step,status:'SUCCEEDED',evidenceId:evidence.id};
    } catch {
      await deps.assertActive();checkpoint.steps[checkpoint.steps.length-1]={...step,status:'FAILED',errorCode:'TOOL_UNAVAILABLE'};
    }
    await deps.onCheckpoint(checkpoint);
  }
  return {text:checkpoint.evidence.length?'El análisis de IA no está disponible. Conservé las consultas verificadas y sus fuentes para que las revisés. Los datos no disponibles siguen señalados; no se confirmó ninguna acción.':'El análisis de IA no está disponible y no pude obtener fuentes para esta pregunta. Podés indicar el tema y fechas AAAA-MM-DD, o continuar en los módulos habituales de Nortex.',evidence:checkpoint.evidence,actionProposalIds:checkpoint.actionProposalIds,degraded:true};
}
