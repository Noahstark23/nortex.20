import { Prisma, type WaCommerceConversation, type WaCommerceInbox, type WhatsAppChannel } from '@prisma/client';
import Decimal from 'decimal.js';
import { COMMERCE_HANDOFF_ACK, COMMERCE_OPTOUT_ACK, CommerceError } from './types';
import { parseCommercePolicy } from './policy';
import { autoIssueCommerceQuote, createCommerceQuoteDraft } from './quotes';

interface SearchState { stage:'CHOOSE'|'QUANTITY'|'READY'; options?:Array<{id:string;name:string;unit:string;price:string}>; selectedId?:string; selectedName?:string; quantity?:string; draftId?:string }
const stateOf=(value:Prisma.JsonValue|null):SearchState|null => {
  if (!value || typeof value!=='object' || Array.isArray(value)) return null;
  const state=value as Record<string,unknown>;
  return state.stage==='CHOOSE'||state.stage==='QUANTITY'||state.stage==='READY' ? state as unknown as SearchState : null;
};
const save=async(tx:Prisma.TransactionClient,conversation:WaCommerceConversation,state:SearchState|null,now:Date)=>{
  await tx.waCommerceConversation.update({where:{id:conversation.id},data:{draftState:state ? state as unknown as Prisma.InputJsonValue : Prisma.JsonNull,version:{increment:1},updatedAt:now}});
};
const quantityText=(value:string)=>/^(?:\d{1,12})(?:[.,]\d{1,4})?$/.test(value);
const safeLabel=(value:string,max=90)=>value.replace(/[\r\n\t\u0000-\u001f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);

/** Deterministic conversational catalog path; called under the worker's channel and conversation locks. */
export async function handleCommerceMessage(tx:Prisma.TransactionClient,inbox:WaCommerceInbox,conversation:WaCommerceConversation,channel:WhatsAppChannel,now:Date):Promise<{text:string|null}> {
  if (inbox.tenantId!==channel.tenantId || inbox.channelId!==channel.id || conversation.tenantId!==channel.tenantId || conversation.id!==inbox.conversationId || conversation.channelId!==channel.id || conversation.waId!==inbox.waId) throw new CommerceError('IDENTITY_MISMATCH','Contexto de conversación inválido.',403);
  const policy=parseCommercePolicy(channel);
  const body=inbox.body.trim();
  if (inbox.body.startsWith('\u0000UNSUPPORTED:')) return {text:'Por ahora puedo ayudarte con mensajes de texto. Escribí el nombre del producto o ASESOR.'};
  const command=body.toLocaleLowerCase('es-NI');
  if (!body) return {text:'Escribí el producto que buscás.'};
  if (command==='baja') {
    await tx.waCommerceConsentEvent.createMany({data:[{tenantId:inbox.tenantId,channelId:inbox.channelId,conversationId:conversation.id,sourceId:`${inbox.id}:BAJA`,action:'OPT_OUT',noticeVersion:'v1'}],skipDuplicates:true});
    await tx.waCommerceConversation.update({where:{id:conversation.id},data:{optedOutAt:now,optedInAt:null,draftState:Prisma.JsonNull,version:{increment:1}}});
    return {text:COMMERCE_OPTOUT_ACK};
  }
  if (command==='alta') {
    await tx.waCommerceConsentEvent.createMany({data:[{tenantId:inbox.tenantId,channelId:inbox.channelId,conversationId:conversation.id,sourceId:`${inbox.id}:ALTA`,action:'OPT_IN',noticeVersion:'v1'}],skipDuplicates:true});
    await tx.waCommerceConversation.update({where:{id:conversation.id},data:{optedOutAt:null,optedInAt:now,version:{increment:1}}});
    return {text:'Podés consultar nuestro catálogo. Escribí el producto que buscás.'};
  }
  if (conversation.optedOutAt) return {text:null};
  if (command==='asesor') {
    await tx.waCommerceConversation.update({where:{id:conversation.id},data:{status:'HUMAN',draftState:Prisma.JsonNull,version:{increment:1}}});
    return {text:COMMERCE_HANDOFF_ACK};
  }
  if (command==='cancelar') {
    const state=stateOf(conversation.draftState);
    const draft=await tx.waCommerceQuoteDraft.findFirst({where:{tenantId:inbox.tenantId,channelId:channel.id,conversationId:conversation.id,status:{in:['DRAFT','PENDING_REVIEW','REVIEWED']},...(state?.draftId ? {id:state.draftId} : {})},orderBy:[{createdAt:'desc'},{id:'desc'}]});
    if (draft) {
      await tx.waCommerceQuoteDraft.updateMany({where:{id:draft.id,tenantId:inbox.tenantId,channelId:channel.id,conversationId:conversation.id,version:draft.version,status:{in:['DRAFT','PENDING_REVIEW','REVIEWED']}},data:{status:'CANCELLED',version:{increment:1},reviewHash:null,reviewedBy:null,snapshot:Prisma.JsonNull,updatedAt:now}});
    }
    await save(tx,conversation,null,now);
    return {text:'Cancelé esta consulta. Podés buscar otro producto.'};
  }
  if (conversation.status==='HUMAN') return {text:null};
  const state=stateOf(conversation.draftState);
  if (state?.stage==='CHOOSE' && /^\d{1,2}$/.test(body)) {
    const option=state.options?.[Number(body)-1];
    if (!option) return {text:'Elegí el número exacto de una de las opciones.'};
    await save(tx,conversation,{stage:'QUANTITY',selectedId:option.id,selectedName:option.name},now);
    return {text:`¿Cuántas ${option.unit} de ${option.name} necesitás? Escribí la cantidad.`};
  }
  if (state?.stage==='QUANTITY') {
    if (!quantityText(body)) return {text:'Escribí una cantidad positiva, con hasta cuatro decimales. También podés escribir cancelar.'};
    const quantity=body.replace(',','.');
    if (new Decimal(quantity).lessThanOrEqualTo(0)) return {text:'La cantidad debe ser mayor que cero.'};
    const selected=await tx.product.findFirst({where:{id:state.selectedId,tenantId:inbox.tenantId,isPublished:true,requiresBatchTracking:false,requiresSerialTracking:false},select:{id:true,name:true}});
    if (!selected || !policy.eligibleProductIds.includes(selected.id)) {await save(tx,conversation,null,now); return {text:'Ese producto ya no está disponible para cotizar por WhatsApp. Buscá otro.'};}
    let draft;
    try { draft=await createCommerceQuoteDraft(tx,{tenantId:inbox.tenantId,channelId:inbox.channelId,conversationId:conversation.id,waId:inbox.waId,policyVersion:channel.commercePolicyVersion},[{productId:selected.id,quantity,presentation:'BASE'}],inbox.providerMessageId,now); }
    catch (error) { if (error instanceof CommerceError && error.statusCode<500) return {text:`No puedo usar esa cantidad para ${safeLabel(selected.name)}. Revisá la unidad y el paso del producto.`}; throw error; }
    if (policy.autoQuote) {
      await autoIssueCommerceQuote(tx,{tenantId:inbox.tenantId,channelId:inbox.channelId,conversationId:conversation.id,waId:inbox.waId,policyVersion:channel.commercePolicyVersion},draft.id,now);
      await save(tx,conversation,null,now);
      return {text:null};
    }
    await save(tx,conversation,{stage:'READY',selectedId:selected.id,selectedName:selected.name,quantity,draftId:draft.id},now);
    return {text:`Preparé una solicitud de ${quantity} de ${safeLabel(selected.name)}. Escribí LISTO para enviarla a revisión o CANCELAR para empezar de nuevo.`};
  }
  if (command==='listo'||command==='cotizar') {
    if (state?.stage!=='READY' || !state.draftId) return {text:'Primero buscá un producto, elegí una opción y decime la cantidad.'};
    const changed=await tx.waCommerceQuoteDraft.updateMany({where:{id:state.draftId,tenantId:inbox.tenantId,conversationId:conversation.id,status:'DRAFT'},data:{status:'PENDING_REVIEW'}});
    if (!changed.count) return {text:'Esta solicitud ya fue enviada a revisión. Un asesor te responderá.'};
    await save(tx,conversation,null,now);
    return {text:'Recibimos tu solicitud. Una persona del negocio revisará precio y disponibilidad antes de enviarte la proforma.'};
  }
  if (body.length>100) return {text:'Buscá un producto por nombre o código en hasta 100 caracteres.'};
  const eligible=policy.eligibleProductIds;
  if (!eligible.length) return {text:'El catálogo por WhatsApp aún no está disponible. Escribí ASESOR para atención humana.'};
  const products=await tx.product.findMany({where:{tenantId:inbox.tenantId,id:{in:eligible},isPublished:true,requiresBatchTracking:false,requiresSerialTracking:false,OR:[{name:{contains:body}},{sku:{contains:body}},{brand:{contains:body}}]},select:{id:true,name:true,sku:true,unit:true,price:true},orderBy:[{name:'asc'},{id:'asc'}],take:6});
  if (!products.length) return {text:'No encontré ese producto en el catálogo habilitado. Probá otro nombre o escribí ASESOR.'};
  const options=products.map(product=>({id:product.id,name:safeLabel(product.name),unit:safeLabel(product.unit,24),price:new Decimal(product.price.toString()).toFixed(2)}));
  await save(tx,conversation,{stage:'CHOOSE',options},now);
  return {text:`Encontré estas opciones:\n${products.map((product,index)=>`${index+1}. ${options[index].name} (${safeLabel(product.sku,32)}) — C$${options[index].price}/${options[index].unit}`).join('\n')}\nRespondé con el número exacto de la opción.`};
}
