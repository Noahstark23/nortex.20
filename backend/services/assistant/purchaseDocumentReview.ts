import { z } from 'zod';
import type { AssistantPrincipal, InvoiceDraft } from '../../../shared/assistant.js';
import type { AssistantDocumentConflict, AssistantDocumentDecision, AssistantDocumentReview } from '../../../shared/assistantDocumentReview.js';
import { invoiceDraftSchema } from './proposalValidation.js';
import { mergePurchaseDocumentContext, purchaseDocumentContextSchema, type PurchaseDocumentContext } from './purchaseDocumentContext.js';
import { AssistantAccessError } from './access.js';

export const documentDecisionsSchema = z.array(z.object({conflictId:z.string().min(1).max(191),
  choice:z.enum(['DECLARED','DOCUMENT']),reason:z.string().trim().min(1).max(500)}).strict()).max(200)
  .refine(rows=>new Set(rows.map(row=>row.conflictId)).size===rows.length,'No repitás una decisión.');
const resolutionSchema=documentDecisionsSchema.element.extend({resolvedBy:z.string().min(1).max(191),
  resolvedAt:z.string().datetime(),proposalVersion:z.number().int().positive()}).strict();
const conflictSchema=z.object({id:z.string().min(1).max(191),kind:z.enum(['VALUE','LINE_MATCH']),path:z.string().min(1).max(191),
  label:z.string().max(191),declaredValue:z.string().nullable(),documentValue:z.string().nullable(),
  status:z.enum(['PENDING','RESOLVED','BLOCKED']),resolution:resolutionSchema.optional()}).strict();
const documentSourceSchema=z.object({kind:z.literal('DOCUMENT'),version:z.literal(1),
  context:purchaseDocumentContextSchema.nullable(),document:invoiceDraftSchema,conflicts:z.array(conflictSchema).max(1800)}).strict();
export interface DocumentPurchaseSource {kind:'DOCUMENT';version:1;context:PurchaseDocumentContext|null;document:InvoiceDraft;conflicts:AssistantDocumentConflict[]}
const invalid=()=>new AssistantAccessError(409,'DOCUMENT_SOURCE_INVALID','No pudimos verificar las fuentes de esta propuesta. Volvé a leer la factura.');

/** Las fuentes provienen del worker; ninguna ruta recibe este objeto del navegador. */
export function createDocumentPurchaseSource(document:InvoiceDraft,context:PurchaseDocumentContext|null):DocumentPurchaseSource {
  const conflicts:AssistantDocumentConflict[]=[];
  const original=invoiceDraftSchema.parse(document),declared=context?purchaseDocumentContextSchema.parse(context) as PurchaseDocumentContext:null;
  mergePurchaseDocumentContext(original,declared,conflicts);
  return structuredClone({kind:'DOCUMENT',version:1,context:declared,document:original,conflicts});
}
export function readDocumentPurchaseSource(raw:unknown):DocumentPurchaseSource|null {
  if(raw===null||raw===undefined||(typeof raw==='object'&&(raw as {kind?:unknown}).kind==='MANUAL'))return null;
  const parsed=documentSourceSchema.safeParse(raw);if(!parsed.success)throw invalid();
  const source=parsed.data as DocumentPurchaseSource,expected=createDocumentPurchaseSource(source.document,source.context).conflicts;
  if(expected.length!==source.conflicts.length)throw invalid();
  for(let i=0;i<expected.length;i++) {
    const current=source.conflicts[i],base=expected[i];
    if(['id','kind','path','label','declaredValue','documentValue'].some(key=>current[key]!==base[key]))throw invalid();
    if(current.kind==='LINE_MATCH'&&(current.status!=='BLOCKED'||current.resolution))throw invalid();
    if(current.kind==='VALUE'&&((current.status==='RESOLVED')!==Boolean(current.resolution)||current.status==='BLOCKED'))throw invalid();
    if(current.resolution?.conflictId!==undefined&&current.resolution.conflictId!==current.id)throw invalid();
  }
  return source;
}
const valueAt=(draft:InvoiceDraft,path:string):string|undefined=>{
  const line=path.match(/^items\.(\d+)\.(quantity|unitCost|purchaseUnit|batchNumber|expiryDate)$/);
  return line ? draft.items[Number(line[1])]?.[line[2]] : draft[path];
};
function setValue(draft:InvoiceDraft,path:string,value:string|null) {
  const line=path.match(/^items\.(\d+)\.(quantity|unitCost|purchaseUnit|batchNumber|expiryDate)$/);
  if(line) {if(!draft.items[Number(line[1])])throw invalid();draft.items[Number(line[1])][line[2]]=value??'';}
  else draft[path]=value??'';
}
const picked=(conflict:AssistantDocumentConflict)=>conflict.resolution?.choice==='DECLARED'?conflict.declaredValue:conflict.documentValue;
function mappingChanged(source:DocumentPurchaseSource,draft:InvoiceDraft) {
  const expected=mergePurchaseDocumentContext(source.document,source.context);
  return expected.items.length!==draft.items.length||expected.items.some((item,index)=>item.description!==draft.items[index]?.description);
}
function pendingConflicts(source:DocumentPurchaseSource,draft:InvoiceDraft):AssistantDocumentConflict[] {
  const conflicts=structuredClone(source.conflicts);
  for(const conflict of conflicts)if(conflict.status==='RESOLVED'&&valueAt(draft,conflict.path)!==picked(conflict)) {
    conflict.status='PENDING';delete conflict.resolution;
  }
  if(source.context&&mappingChanged(source,draft))conflicts.push({id:'mapping:edited-lines',kind:'LINE_MATCH',path:'items',label:'Correspondencia de renglones modificada',
    declaredValue:null,documentValue:null,status:'BLOCKED'});
  return conflicts;
}
export function documentReviewDTO(source:DocumentPurchaseSource,draft:InvoiceDraft):AssistantDocumentReview {
  const conflicts=pendingConflicts(source,draft);
  return {version:1,declared:source.context?structuredClone(source.context.draft):null,document:structuredClone(source.document),conflicts,
    hasUnresolved:conflicts.some(conflict=>conflict.status!=='RESOLVED')};
}
export function documentReviewIssues(source:DocumentPurchaseSource,draft:InvoiceDraft):string[] {
  return documentReviewDTO(source,draft).conflicts.filter(conflict=>conflict.status!=='RESOLVED').map(conflict=>conflict.kind==='LINE_MATCH'
    ?'La correspondencia entre renglones necesita revisión en Compras; no se puede resolver por semejanza.'
    :`Resolvé explícitamente la diferencia en ${conflict.label} entre lo declarado y la factura.`);
}

/** Sólo modifica el estado auxiliar y devuelve una nueva fuente; no calcula ni registra efectos. */
export function reconcileDocumentReview(source:DocumentPurchaseSource,draft:InvoiceDraft,rawDecisions:unknown,
  actor:AssistantPrincipal,nextVersion:number,now=new Date()) {
  const decisions:AssistantDocumentDecision[]=documentDecisionsSchema.parse(rawDecisions??[]);
  const result=invoiceDraftSchema.parse(draft),updated=structuredClone(source);
  let invalidated=false;
  for(const conflict of updated.conflicts)if(conflict.status==='RESOLVED'&&valueAt(result,conflict.path)!==picked(conflict)) {
    conflict.status='PENDING';delete conflict.resolution;invalidated=true;
  }
  if(decisions.length&&source.context&&mappingChanged(source,result))throw new AssistantAccessError(409,'DOCUMENT_LINES_CHANGED','Conservá los renglones originales y revisá su correspondencia en Compras.');
  for(const decision of decisions) {
    const conflict=updated.conflicts.find(item=>item.id===decision.conflictId);
    if(!conflict||conflict.kind!=='VALUE')throw new AssistantAccessError(400,'DOCUMENT_DECISION_INVALID','La decisión no corresponde a un campo que puedas resolver.');
    const value=decision.choice==='DECLARED'?conflict.declaredValue:conflict.documentValue;
    setValue(result,conflict.path,value);
    conflict.status='RESOLVED';conflict.resolution={...decision,resolvedBy:actor.userId,resolvedAt:now.toISOString(),proposalVersion:nextVersion};
  }
  // Las advertencias generadas por conflictos no son decisiones; su bloqueo procede de las fuentes guardadas.
  const generated=new Set(mergePurchaseDocumentContext(source.document,source.context).warnings.filter(warning=>warning.startsWith('Diferencia en ')));
  result.warnings=result.warnings.filter(warning=>!generated.has(warning));
  const issues=documentReviewIssues(updated,result);
  return {source:updated,draft:invoiceDraftSchema.parse(result),issues,requiresFreshReview:invalidated||decisions.length>0};
}
