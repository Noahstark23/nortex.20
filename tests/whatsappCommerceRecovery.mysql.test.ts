// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll,describe,expect,it,vi } from 'vitest';
import prisma from '../backend/lib/prisma';
import { claimCommerceInbox,processCommerceInboxOnce } from '../backend/services/whatsapp/commerce/worker';
import { dispatchCommerceOutboxOnce,recoverCommerceSending } from '../backend/services/whatsapp/commerce/outbox';
const qa=process.env.NORTEX_MYSQL_INTEGRATION==='1'?describe.sequential:describe.skip;
const tenantId=`qa-wa-recovery-${randomUUID()}`;
const pausedTenantId=`${tenantId}-pause`;
const tenants={in:[tenantId,pausedTenantId]};
qa('Recuperación comercial después de caída',()=>{
 afterAll(async()=>{
  await prisma.waCommerceOutbox.deleteMany({where:{tenantId:tenants}});await prisma.waCommerceInbox.deleteMany({where:{tenantId:tenants}});
  await prisma.waCommerceConversation.deleteMany({where:{tenantId:tenants}});await prisma.whatsAppChannel.deleteMany({where:{tenantId:tenants}});await prisma.tenant.deleteMany({where:{id:tenants}});await prisma.$disconnect();
 });
 it('lease perdido se recupera, rollback no pierde entrada y SENDING abandonado nunca se reenvía',async()=>{
  const url=new URL(process.env.DATABASE_URL!);expect(['127.0.0.1','localhost']).toContain(url.hostname);expect(url.pathname).toMatch(/^\/nortex_(qa|quality|test)/);
  const now=new Date();await prisma.tenant.create({data:{id:tenantId,businessName:'QA recovery',taxId:tenantId,type:'FERRETERIA'}});
  const channel=await prisma.whatsAppChannel.create({data:{tenantId,phoneNumberId:randomUUID(),accessTokenEnc:'QA-NO-TOKEN',active:true,commerceEnabled:true,commercePolicyVersion:1,commercePolicy:{eligibleProductIds:[],autoQuote:false,ttlHours:24,maxTotal:'1000',maxLines:5,eligibilityAttested:true}}});
  const conversation=await prisma.waCommerceConversation.create({data:{tenantId,channelId:channel.id,waId:'50588886666',lastInboundAt:now}});
  const inbox=await prisma.waCommerceInbox.create({data:{tenantId,channelId:channel.id,conversationId:conversation.id,waId:conversation.waId,providerMessageId:randomUUID(),body:'hola',payloadHash:'a'.repeat(64),eventAt:now,availableAt:now}});
  expect((await claimCommerceInbox({db:prisma,now:()=>now}))?.id).toBe(inbox.id);
  const resumed=new Date(now.getTime()+301000);
  const answer=vi.fn(async()=>{throw new Error('Caída sintética antes del commit');});
  await processCommerceInboxOnce({db:prisma,now:()=>resumed,answer});
  expect(await prisma.waCommerceOutbox.count({where:{tenantId}})).toBe(0);
  expect((await prisma.waCommerceInbox.findUniqueOrThrow({where:{id:inbox.id}})).status).toBe('PENDING');
  const later=new Date(resumed.getTime()+61000);
  await processCommerceInboxOnce({db:prisma,now:()=>later,answer:async()=>({text:'Respuesta recuperada'})});
  expect((await prisma.waCommerceInbox.findUniqueOrThrow({where:{id:inbox.id}})).status).toBe('DONE');
  const output=await prisma.waCommerceOutbox.findFirstOrThrow({where:{tenantId}});
  await prisma.waCommerceOutbox.update({where:{id:output.id},data:{status:'SENDING',leaseToken:randomUUID(),leaseUntil:new Date(later.getTime()-1)}});
  expect(await recoverCommerceSending({db:prisma,now:()=>later})).toBe(1);
  const sender=vi.fn(async()=>'forbidden');
  expect(await dispatchCommerceOutboxOnce({db:prisma,now:()=>later,sendingEnabled:true,sender})).toBe(false);
  expect(sender).not.toHaveBeenCalled();expect((await prisma.waCommerceOutbox.findUniqueOrThrow({where:{id:output.id}})).status).toBe('UNKNOWN');
 });
 it('pausa conserva las entradas sin consumir intentos y reactivación mantiene orden sin duplicar respuestas',async()=>{
  const url=new URL(process.env.DATABASE_URL!);expect(['127.0.0.1','localhost']).toContain(url.hostname);expect(url.pathname).toMatch(/^\/nortex_(qa|quality|test)/);
  const now=new Date();await prisma.tenant.create({data:{id:pausedTenantId,businessName:'QA pause',taxId:pausedTenantId,type:'FERRETERIA'}});
  const channel=await prisma.whatsAppChannel.create({data:{tenantId:pausedTenantId,phoneNumberId:randomUUID(),accessTokenEnc:'QA-NO-TOKEN',active:true,commerceEnabled:false,commercePolicyVersion:1,commercePolicy:{eligibleProductIds:[],autoQuote:false,ttlHours:24,maxTotal:'1000',maxLines:5,eligibilityAttested:true}}});
  const conversation=await prisma.waCommerceConversation.create({data:{tenantId:pausedTenantId,channelId:channel.id,waId:'50588886667',lastInboundAt:now}});
  const inputs=[];
  for(const body of ['primera consulta','segunda consulta'])inputs.push(await prisma.waCommerceInbox.create({data:{tenantId:pausedTenantId,channelId:channel.id,conversationId:conversation.id,waId:conversation.waId,providerMessageId:randomUUID(),body,payloadHash:'b'.repeat(64),eventAt:now,availableAt:now}}));
  const answer=vi.fn(async(_tx,entry)=>({text:`Respuesta: ${entry.body}`}));
  expect(await processCommerceInboxOnce({db:prisma,now:()=>now,answer})).toBe(false);
  expect(answer).not.toHaveBeenCalled();
  expect(await prisma.waCommerceInbox.findMany({where:{tenantId:pausedTenantId},orderBy:{sequence:'asc'},select:{id:true,status:true,attempts:true,leaseToken:true}})).toEqual(inputs.map(entry=>({id:entry.id,status:'PENDING',attempts:0,leaseToken:null})));
  await prisma.whatsAppChannel.update({where:{id:channel.id},data:{commerceEnabled:true}});
  expect(await processCommerceInboxOnce({db:prisma,now:()=>now,answer})).toBe(true);
  expect(await processCommerceInboxOnce({db:prisma,now:()=>now,answer})).toBe(true);
  expect(await processCommerceInboxOnce({db:prisma,now:()=>now,answer})).toBe(false);
  expect(answer.mock.calls.map(call=>call[1].id)).toEqual(inputs.map(entry=>entry.id));
  expect(await prisma.waCommerceInbox.findMany({where:{tenantId:pausedTenantId},orderBy:{sequence:'asc'},select:{status:true,attempts:true}})).toEqual([{status:'DONE',attempts:1},{status:'DONE',attempts:1}]);
  expect(await prisma.waCommerceOutbox.findMany({where:{tenantId:pausedTenantId},orderBy:{sequence:'asc'},select:{body:true,idempotencyKey:true,status:true}})).toEqual(inputs.map(entry=>({body:`Respuesta: ${entry.body}`,idempotencyKey:entry.id,status:'PENDING'})));
  // Pausa real inmediatamente después del commit del claim, antes de procesar.
  const race=await prisma.waCommerceInbox.create({data:{tenantId:pausedTenantId,channelId:channel.id,conversationId:conversation.id,waId:conversation.waId,providerMessageId:randomUUID(),body:'consulta durante pausa',payloadHash:'c'.repeat(64),eventAt:now,availableAt:now}});
  let pauseAfterClaim=true;
  const pausedDb=new Proxy(prisma,{get(target,key){
   if(key==='$transaction')return async(callback,options)=>{
    const result=await target.$transaction(callback,options);
    if(pauseAfterClaim){pauseAfterClaim=false;await target.whatsAppChannel.update({where:{id:channel.id},data:{commerceEnabled:false}});}
    return result;
   };
   const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
  expect(await processCommerceInboxOnce({db:pausedDb,now:()=>now,answer})).toBe(true);
  expect(answer).toHaveBeenCalledTimes(2);
  expect(await prisma.waCommerceInbox.findUniqueOrThrow({where:{id:race.id},select:{status:true,attempts:true,leaseToken:true,errorCode:true}})).toEqual({status:'PENDING',attempts:0,leaseToken:null,errorCode:'COMMERCE_CHANNEL_DISABLED'});
  await prisma.whatsAppChannel.update({where:{id:channel.id},data:{commerceEnabled:true}});
  const resumed=new Date(now.getTime()+31_000);
  expect(await processCommerceInboxOnce({db:prisma,now:()=>resumed,answer})).toBe(true);
  expect(await processCommerceInboxOnce({db:prisma,now:()=>resumed,answer})).toBe(false);
  expect(answer.mock.calls.map(call=>call[1].id)).toEqual([...inputs.map(entry=>entry.id),race.id]);
  expect(await prisma.waCommerceOutbox.count({where:{tenantId:pausedTenantId,idempotencyKey:race.id}})).toBe(1);

 });

});
