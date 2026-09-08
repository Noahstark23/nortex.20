import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import type { AssistantPrincipal, AssistantMessageDTO, InvoiceDraft } from '../../../shared/assistant.js';
import { assertAssistantAccess, AssistantAccessError } from './access.js';
import { normalizeAssistantText } from './knowledge.js';
import { readPurchaseIntake, purchaseIntakeSchema, type PurchaseIntake, type PurchaseIntakeFact } from './purchaseIntakeTypes.js';
import { parseInitialPurchase, parseExplicitAmount, parseCivilAnswer, explicitBoolean, isManualChoice, isPhotoChoice, isCancelIntake, acceptLanguageFacts,parseNamedAmount } from './purchaseIntakeParsing.js';

type Database = PrismaClient | Prisma.TransactionClient;
type Content = Pick<AssistantMessageDTO,'text'|'actions'|'purchaseIntake'|'proposalId'>;
export interface PurchaseIntakeTurn { metadata: unknown; content: Content; state: PurchaseIntake | null; draft?: InvoiceDraft; reviseProposalId?: string;correctedFields?:string[] }
const positive = (value?: string) => !!value && /[1-9]/.test(value);
const metadataFor = (state: PurchaseIntake | null) => ({schemaVersion:1,purchaseIntake:state});

export function missingPurchaseFacts(state: PurchaseIntake): string[] {
  const result:string[]=[];
  state.facts.items.forEach((line,index)=>{
    for(const field of ['productId','quantity','purchaseUnit','unitCost'] as const) if(!line[field] || (field==='quantity'&&!positive(line.quantity)))result.push(`items.${index}.${field}`);
    if(line.requiresBatchTracking)for(const field of ['batchNumber','expiryDate'] as const)if(!line[field])result.push(`items.${index}.${field}`);
  });
  for(const field of ['supplierId','invoiceNumber','date','currency','documentTotal','paymentMethod'] as const)if(!state.facts[field])result.push(field);
  if(state.facts.paymentMethod==='CREDIT'&&!state.facts.dueDate)result.push('dueDate');
  if(state.facts.receivedConfirmed===undefined)result.push('receivedConfirmed');
  if(state.facts.paymentMethod==='CASH'&&state.facts.paymentConfirmed===undefined)result.push('paymentConfirmed');
  if(!state.facts.warehouseId)result.push('warehouseId');
  return result;
}

export function intakeToDraft(state:PurchaseIntake):InvoiceDraft {
  const f=state.facts;
  return {
    currency:f.currency??'',supplierId:f.supplierId,supplierName:f.supplierName,invoiceNumber:f.invoiceNumber??'',date:f.date??'',
    dueDate:f.dueDate,warehouseId:f.warehouseId,paymentMethod:f.paymentMethod,
    receivedConfirmed:f.receivedConfirmed??false,paymentConfirmed:f.paymentConfirmed??false,documentTotal:f.documentTotal??'',
    items:f.items.map(line=>({productId:line.productId,description:line.productName??line.description,quantity:line.quantity??'',unitCost:line.unitCost??'',
      purchaseUnit:line.purchaseUnit??'BASE',batchNumber:line.batchNumber,expiryDate:line.expiryDate})),
    warnings:missingPurchaseFacts(state).map(field=>`Dato pendiente declarado por conversación: ${field}`),
  };
}

/** Corrige sólo el campo declarado; conserva cargos incompatibles, advertencias y demás evidencia revisada. */
export function applyIntakeDraftCorrection(original:InvoiceDraft,turn:PurchaseIntakeTurn):InvoiceDraft {
  const draft=structuredClone(original);
  if(!turn.draft)return draft;
  for(const field of turn.correctedFields??[]) {
    if(field==='invoiceNumber'||field==='date'||field==='documentTotal')draft[field]=turn.draft[field];
    else if((field==='items.0.quantity'||field==='items.0.unitCost')&&draft.items.length===1) {
      const key=field.endsWith('quantity')?'quantity':'unitCost';draft.items[0][key]=turn.draft.items[0][key];
    }
  }
  return draft;
}

export function purchaseIntakePresentation(metadata:unknown): Omit<Content,'text'> {
  const state=readPurchaseIntake(metadata);
  if(!state)return {purchaseIntake:null,actions:[]};
  const summary=state.facts.items.map(item=>{
    const unit=item.purchaseUnit==='PACK'?item.packUnit:item.purchaseUnit==='BASE'?item.baseUnit:item.unitText;
    return `${item.quantity??'Cantidad pendiente'} ${unit??'unidades por precisar'} de ${(item.productName??item.description)||'producto pendiente'}`;
  }).join('; ');
  return {
    purchaseIntake:{id:state.id,summary,phase:state.phase,missing:missingPurchaseFacts(state)},
    ...(state.proposalId?{proposalId:state.proposalId}:{}),
    actions:state.phase==='REVIEW'&&state.proposalId?[{type:'REVIEW_PURCHASE',label:'Revisar compra',proposalId:state.proposalId}]
      :state.mode==='MANUAL'?[{type:'UPLOAD_INVOICE',label:'Adjuntar factura'}]
        :[{type:'UPLOAD_INVOICE',label:'Adjuntar factura'},{type:'CONTINUE_PURCHASE',label:'Completar por aquí'}],
  };
}

const candidateChoice=(text:string,candidates:Array<{id:string;label:string}>)=>{
  const value=normalizeAssistantText(text.trim());
  const index=/^(?:opcion\s+)?[1-6]$/.test(value)?Number(value.replace('opcion ',''))-1:-1;
  return candidates[index]??candidates.find(item=>normalizeAssistantText(item.label)===value);
};
const listChoices=(rows:Array<{id:string;label:string}>)=>rows.map((row,index)=>`${index+1}. ${row.label}`).join('\n');

async function askNext(state:PurchaseIntake,db:Database,tenantId:string):Promise<string> {
  const field=missingPurchaseFacts(state)[0];
  if(!field)return 'Ya tengo los datos declarados. Preparé un borrador para que revisés sus efectos antes de confirmar.';
  const match=field.match(/^items\.(\d+)\.(.+)$/),index=match?Number(match[1]):undefined,key=match?.[2]??field;
  state.pendingQuestion={id:randomUUID(),field,...(index===undefined?{}:{lineIndex:index})};
  const line=index===undefined?undefined:state.facts.items[index];
  if(key==='productId') {
    const query=line!.description.trim();
    const rows=query.length>=2?await db.product.findMany({where:{tenantId,OR:[{name:{contains:query}},{sku:{contains:query}}]},select:{id:true,name:true,sku:true},orderBy:[{name:'asc'},{id:'asc'}],take:6}):[];
    state.pendingQuestion.candidates=rows.map(row=>({id:row.id,label:`${row.name} (${row.sku})`}));
    return rows.length?`Para ${line!.quantity??'la cantidad indicada'} de ${line!.description}, elegí el producto del catálogo:\n${listChoices(state.pendingQuestion.candidates)}\nRespondé con su número.`:'¿Cuál es el nombre o código exacto del producto en tu catálogo? Si todavía no existe, crealo en Inventario y después seguimos.';
  }
  if(key==='quantity')return `¿Cuántas unidades compraste de ${line!.productName??line!.description}? Escribí la cantidad exacta.`;
  if(key==='purchaseUnit')return `¿Cómo se cuentan las ${line!.quantity} de ${line!.productName}?\n1. Unidad del catálogo (${line!.baseUnit})${line!.packUnit&&line!.packSize?`\n2. Paquete ${line!.packUnit} de ${line!.packSize} unidades. Respondé 1 o 2.`:'\nRespondé 1 si corresponde; si la presentación es distinta, revisá el producto en Inventario antes de continuar.'}`;
  if(key==='unitCost')return `¿Cuánto costó cada ${line!.purchaseUnit==='PACK'?line!.packUnit:line!.baseUnit} de ${line!.productName}, antes de impuestos? Escribí el costo exacto, por ejemplo C$ 230.`;
  if(key==='supplierId') {
    const query=state.facts.supplierName;
    const rows=query?await db.supplier.findMany({where:{tenantId,status:'ACTIVE',deletedAt:null,name:{contains:query}},select:{id:true,name:true},orderBy:[{name:'asc'},{id:'asc'}],take:6}):[];
    state.pendingQuestion.candidates=rows.map(row=>({id:row.id,label:row.name}));
    return rows.length?`Elegí el proveedor registrado:\n${listChoices(state.pendingQuestion.candidates)}`:'¿A qué proveedor le compraste? Decime su nombre registrado en Nortex.';
  }
  if(key==='warehouseId') {
    const rows=await db.warehouse.findMany({where:{tenantId,isActive:true},select:{id:true,name:true},orderBy:[{name:'asc'},{id:'asc'}],take:6});
    state.pendingQuestion.candidates=rows.map(row=>({id:row.id,label:row.name}));
    return rows.length?`¿En qué bodega recibiste la mercadería?\n${listChoices(state.pendingQuestion.candidates)}`:'No encontré una bodega activa. Creala en Nortex y después seguimos.';
  }
  const questions:Record<string,string>={
    invoiceNumber:'¿Cuál es el número real de la factura del proveedor? No puedo generar uno ni sustituirlo.',
    date:'¿Qué fecha tiene la factura? Podés escribir AAAA-MM-DD, hoy o ayer.',currency:'¿La factura está en córdobas (NIO) o dólares (USD)?',
    documentTotal:'¿Cuál es el total real que aparece en la factura, incluyendo impuestos? No lo voy a completar a partir de una suposición.',
    paymentMethod:'¿La compra fue de contado en efectivo o a crédito? Otros medios requieren revisión en Compras.',
    dueDate:'¿Qué fecha vence el crédito? Escribí AAAA-MM-DD.',
    receivedConfirmed:'¿Recibiste físicamente esta mercadería? Respondé sí o no; tener una factura no demuestra recepción.',
    paymentConfirmed:'¿Ya pagaste esta compra en efectivo? Respondé sí o no. Al confirmar se registrará la salida en la caja indicada.',
    batchNumber:`¿Qué número de lote tiene ${line?.productName??'el producto'}?`,expiryDate:`¿Qué fecha de vencimiento tiene ese lote? Escribí AAAA-MM-DD.`,
  };
  return questions[key]??'Revisemos el dato pendiente antes de seguir.';
}

async function applyAnswer(state:PurchaseIntake,text:string,db:Database,tenantId:string):Promise<string|undefined> {
  const question=state.pendingQuestion;if(!question)return;
  const key=question.field.split('.').at(-1)!,line=question.lineIndex===undefined?undefined:state.facts.items[question.lineIndex];
  const selected=candidateChoice(text,question.candidates??[]),value=normalizeAssistantText(text.trim());
  if(!['receivedConfirmed','paymentConfirmed'].includes(key)&&/^(si|no|ok|dale|listo|confirma|confirmar)$/.test(value))return;
  if(key==='productId') {
    if(!selected){line!.description=text.trim().slice(0,500);return question.field;}
    const product=await db.product.findFirst({where:{id:selected.id,tenantId},select:{id:true,name:true,unit:true,packUnit:true,packSize:true,requiresBatchTracking:true}});
    if(!product)return;
    Object.assign(line,{productId:product.id,productName:product.name,baseUnit:product.unit,packUnit:product.packUnit??undefined,packSize:product.packSize??undefined,requiresBatchTracking:product.requiresBatchTracking});
    return question.field;
  }
  if(key==='supplierId') {
    if(!selected){state.facts.supplierName=text.trim().slice(0,500);return 'supplierName';}
    const supplier=await db.supplier.findFirst({where:{id:selected.id,tenantId,status:'ACTIVE',deletedAt:null},select:{id:true,name:true}});
    if(supplier){state.facts.supplierId=supplier.id;state.facts.supplierName=supplier.name;return question.field;}return;
  }
  if(key==='warehouseId') {
    if(!selected)return;
    const warehouse=await db.warehouse.findFirst({where:{id:selected.id,tenantId,isActive:true},select:{id:true,name:true}});
    if(warehouse){state.facts.warehouseId=warehouse.id;state.facts.warehouseName=warehouse.name;return question.field;}return;
  }
  let answer:string|boolean|undefined;
  if(key==='purchaseUnit')answer=/^(1|base|unidad|unidades|unidad del catalogo)$/.test(value)?'BASE':/^(2|pack|paquete|empaque)$/.test(value)&&line?.packUnit&&line.packSize?'PACK':undefined;
  else if(['quantity','unitCost','documentTotal'].includes(key)){answer=parseExplicitAmount(text);if(key==='quantity'&&!positive(answer))answer=undefined;}
  else if(['date','dueDate','expiryDate'].includes(key))answer=parseCivilAnswer(text);
  else if(key==='currency')answer=/^(nio|c\$|cordobas)$/.test(value)?'NIO':/^(usd|dolares)$/.test(value)?'USD':undefined;
  else if(key==='paymentMethod')answer=/^(credito|a credito)$/.test(value)?'CREDIT':/^(contado|de contado|efectivo|contado en efectivo)$/.test(value)?'CASH':undefined;
  else if(key==='receivedConfirmed'||key==='paymentConfirmed')answer=explicitBoolean(text);
  else if(key==='invoiceNumber')answer=/^(?:factura\s*(?:#|numero)?\s*)?([a-z0-9][a-z0-9._/-]{0,99})$/i.exec(text.trim())?.[1];
  else if(key==='batchNumber')answer=/^[\p{L}\d._/-]{1,100}$/u.test(text.trim())?text.trim():undefined;
  if(answer===undefined)return;
  if(key==='invoiceNumber'&&/^(no|ninguna|pendiente|sin|sinfactura|na|n\/a)$/i.test(String(answer)))return;
  (line??state.facts as Record<string,unknown>)[key]=answer;
  if(['unitCost','documentTotal'].includes(key)&&/^\s*(?:C\$|NIO)/i.test(text))state.facts.currency='NIO';
  if(['unitCost','documentTotal'].includes(key)&&/^\s*USD/i.test(text))state.facts.currency='USD';
  if(key==='paymentMethod'&&answer==='CREDIT')state.facts.paymentConfirmed=false;
  return question.field;
}

export async function advancePurchaseIntake(input:{principal:AssistantPrincipal;text:string;requestId:string;metadata:unknown;languageFacts?:PurchaseIntakeFact[]},db:Database=prisma):Promise<PurchaseIntakeTurn> {
  await assertAssistantAccess(input.principal,'purchasePrepare',db as PrismaClient);
  let state=readPurchaseIntake(input.metadata);
  if(isCancelIntake(input.text))return {metadata:metadataFor(null),state:null,content:{text:'Dejé de completar esta compra. No se registró ninguna operación por este mensaje.',purchaseIntake:null,actions:[]}};
  const initial=!state;
  if(!state)state={id:randomUUID(),phase:'CHOOSE_INPUT',mode:'UNDECIDED',facts:parseInitialPurchase(input.text),evidence:[]};
  if(initial)state.evidence.push({requestId:input.requestId,field:'purchase',suppliedText:input.text.slice(0,500)});
  if(state.phase==='REVIEW'&&state.mode==='ATTACHMENT')return {state,metadata:metadataFor(state),content:{text:'Esta propuesta se preparó desde tu factura. Abrí su revisión para corregir los datos y conservar la evidencia del documento.',...purchaseIntakePresentation(metadataFor(state))}};
  if(state.phase!=='REVIEW'&&input.languageFacts?.length){const accepted=acceptLanguageFacts(state.facts,input.languageFacts,input.text);for(const field of accepted)state.evidence.push({requestId:input.requestId,field,suppliedText:input.languageFacts.find(f=>f.field===field)!.suppliedText});}
  let correction=false;const correctedFields:string[]=[];
  {
    const naturalQuantity=normalizeAssistantText(input.text).match(/^son\s+(\d+(?:\.\d+)?)\s*,?\s*no\s+\d+(?:\.\d+)?[.!]?$/);
    const match=naturalQuantity?['', 'cantidad',naturalQuantity[1]]:input.text.match(/^(?:cambia(?:r)?\s+)?(cantidad|precio|costo|total|factura|fecha)\s+(?:a\s+)?(.+)$/i);
    if(match)match[1]=normalizeAssistantText(match[1]);
    if(match){
      const field:Record<string,string>={cantidad:'items.0.quantity',precio:'items.0.unitCost',costo:'items.0.unitCost',total:'documentTotal',factura:'invoiceNumber',fecha:'date'};
      if(field[match[1]].startsWith('items.')&&state.facts.items.length!==1)return {state,metadata:metadataFor(state),content:{text:'Hay varios productos en este borrador. Abrí la revisión y elegí el renglón que querés corregir para conservar los demás.',...purchaseIntakePresentation(metadataFor(state))}};
      const previousQuestion=state.pendingQuestion;
      state.pendingQuestion={id:randomUUID(),field:field[match[1]],...(field[match[1]].startsWith('items.')?{lineIndex:0}:{})};
      const applied=await applyAnswer(state,match[2],db,input.principal.tenantId);state.pendingQuestion=previousQuestion;
      if(applied){correction=true;correctedFields.push(applied);state.evidence.push({requestId:input.requestId,field:applied,suppliedText:input.text.slice(0,500)});}
    }
    if(state.phase==='REVIEW') {
      if(!correction)return {state,metadata:metadataFor(state),content:{text:'Tu borrador está listo para revisar. Podés corregir por aquí: cantidad 60, precio 240, total 13800, factura F-123 o fecha 2026-09-05. Para registrar, usá la revisión y su botón de confirmación.',...purchaseIntakePresentation(metadataFor(state))}};
      if(state.evidence.length>150)throw new AssistantAccessError(409,'INTAKE_LIMIT','Esta captura alcanzó su límite. Revisá los datos actuales antes de abrir otra.');
      return {state,metadata:metadataFor(state),content:{text:'Actualicé el dato declarado. Revisá nuevamente el borrador y sus efectos antes de confirmar.',...purchaseIntakePresentation(metadataFor(state))},draft:intakeToDraft(state),correctedFields,...(state.proposalId?{reviseProposalId:state.proposalId}:{})};
    }
  }
  let capturedExplicit=false;
  for(const field of ['unitCost','documentTotal'] as const){
    const named=parseNamedAmount(input.text,field),target=field==='unitCost'?state.facts.items[0]:state.facts;
    if(named&&(field!=='unitCost'||state.facts.items.length===1)&&!(target as Record<string,unknown>)[field]){
      (target as Record<string,unknown>)[field]=named.value;if(named.currency)state.facts.currency=named.currency;capturedExplicit=true;
      state.evidence.push({requestId:input.requestId,field:field==='unitCost'?'items.0.unitCost':field,suppliedText:input.text.slice(0,500)});
    }
  }
  if(state.evidence.length>150)throw new AssistantAccessError(409,'INTAKE_LIMIT','Esta captura alcanzó su límite. Revisá los datos actuales antes de abrir otra.');
  if(isPhotoChoice(input.text)){state.mode='ATTACHMENT';state.phase='CHOOSE_INPUT';return {state,metadata:metadataFor(state),content:{text:'Adjuntá la foto o PDF de esa factura. Voy a conservar los datos que ya me contaste y contrastarlos con el documento.',...purchaseIntakePresentation(metadataFor(state))}};}
  if(isManualChoice(input.text)){state.mode='MANUAL';state.phase='COLLECTING';}
  if(state.mode!=='MANUAL')return {state,metadata:metadataFor(state),content:{text:`Entendí: ${purchaseIntakePresentation(metadataFor(state)).purchaseIntake?.summary}. Podés subir una foto de la factura o completar los datos por aquí.`,...purchaseIntakePresentation(metadataFor(state))}};
  if(!initial&&!correction&&!capturedExplicit&&!isManualChoice(input.text)){
    const applied=await applyAnswer(state,input.text,db,input.principal.tenantId);
    if(applied)state.evidence.push({requestId:input.requestId,field:applied,suppliedText:input.text.slice(0,500)});
  }
  if(state.evidence.length>150)throw new AssistantAccessError(409,'INTAKE_LIMIT','Esta captura alcanzó su límite. Revisá los datos actuales antes de abrir otra.');
  const complete=missingPurchaseFacts(state).length===0;
  const text=await askNext(state,db,input.principal.tenantId);
  if(complete){state.phase='REVIEW';delete state.pendingQuestion;}
  state=purchaseIntakeSchema.parse(state);
  return {state,metadata:metadataFor(state),content:{text,...purchaseIntakePresentation(metadataFor(state))},
    ...(complete?{draft:intakeToDraft(state),...(state.proposalId?{reviseProposalId:state.proposalId}:{})}:{})};
}

export async function readPurchaseIntakeForDocument(principal:AssistantPrincipal,conversationId:string,db:Database=prisma) {
  await assertAssistantAccess(principal,'purchasePrepare',db as PrismaClient);
  const conversation=await db.assistantConversation.findFirst({where:{id:conversationId,tenantId:principal.tenantId,userId:principal.userId,roleAtCreation:principal.role,expiresAt:{gt:new Date()}}});
  if(!conversation)throw new AssistantAccessError(404,'ASSISTANT_CONVERSATION_NOT_FOUND','Esta conversación no está disponible.');
  const state=readPurchaseIntake(conversation.metadata);if(!state||state.phase==='REVIEW'||state.proposalId)return null;
  return {intakeId:state.id,stateVersion:conversation.stateVersion,draft:intakeToDraft(state),evidence:state.evidence.map(item=>`${item.field}: ${item.suppliedText}`)};
}

export async function attachDocumentProposalToIntake(principal:AssistantPrincipal,conversationId:string,intakeId:string,proposalId:string,tx:Prisma.TransactionClient,expectedStateVersion?:number) {
  await assertAssistantAccess(principal,'purchasePrepare',tx as PrismaClient);
  const where={id:conversationId,tenantId:principal.tenantId,userId:principal.userId,roleAtCreation:principal.role,expiresAt:{gt:new Date()}};
  const row=await tx.assistantConversation.findFirst({where});
  const state=readPurchaseIntake(row?.metadata);
  if(!row||!state||state.phase==='REVIEW'||state.proposalId||state.id!==intakeId||(expectedStateVersion!==undefined&&row.stateVersion!==expectedStateVersion))throw new AssistantAccessError(409,'INTAKE_CHANGED','La captura cambió o ya tiene una propuesta. Abrí una nueva captura para otra factura.');
  state.phase='REVIEW';state.mode='ATTACHMENT';state.proposalId=proposalId;delete state.pendingQuestion;
  const result=await tx.assistantConversation.updateMany({where:{...where,stateVersion:row.stateVersion},data:{stateVersion:{increment:1},metadata:metadataFor(state) as Prisma.InputJsonValue}});
  if(result.count!==1)throw new AssistantAccessError(409,'INTAKE_CHANGED','La captura cambió durante la lectura.');
}
