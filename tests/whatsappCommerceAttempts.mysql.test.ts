import { randomUUID, createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import prisma from '../backend/lib/prisma';
import { dispatchCommerceOutboxOnce, recoverCommerceSending } from '../backend/services/whatsapp/commerce/outbox';
import { acceptCommerceWebhook } from '../backend/services/whatsapp/commerce/inbox';

const qa=process.env.NORTEX_MYSQL_INTEGRATION==='1'?describe.sequential:describe.skip;
const now=new Date('2026-09-29T15:00:00Z');
const tenants:string[]=[];
let fetchSpy:ReturnType<typeof vi.spyOn>;
async function seed() {
  const tenantId=`qa-attempt-${randomUUID()}`;tenants.push(tenantId);
  await prisma.tenant.create({data:{id:tenantId,businessName:'QA Intentos',taxId:tenantId,type:'FERRETERIA'}});
  const channel=await prisma.whatsAppChannel.create({data:{tenantId,phoneNumberId:`99${randomUUID().replace(/[^0-9]/g,'').padEnd(30,'0')}`,accessTokenEnc:'QA-NO-TOKEN',active:true,commerceEnabled:true,commercePolicyVersion:1,commercePolicy:{eligibleProductIds:[],autoQuote:false,ttlHours:24,maxTotal:'999.00',maxLines:2,eligibilityAttested:true}}});
  const conversation=await prisma.waCommerceConversation.create({data:{tenantId,channelId:channel.id,waId:'50588889999',lastInboundAt:now}});
  const output=await prisma.waCommerceOutbox.create({data:{tenantId,channelId:channel.id,conversationId:conversation.id,waId:conversation.waId,idempotencyKey:randomUUID(),body:'Respuesta QA',policyVersion:1,expiresAt:new Date(now.getTime()+3600000)}});
  return {tenantId,channel,conversation,output};
}
async function earlyRead(channel:{phoneNumberId:string}, waId:string, messageId:string) {
  const secret='QA-fictitious-attempt-receipt';
  const bytes=Buffer.from(JSON.stringify({object:'whatsapp_business_account',entry:[{changes:[{value:{metadata:{phone_number_id:channel.phoneNumberId},statuses:[{id:messageId,recipient_id:waId,status:'read'}]}}]}]}));
  const signature='sha256='+createHmac('sha256',secret).update(bytes).digest('hex');
  await acceptCommerceWebhook(bytes,signature,{db:prisma,now:()=>now,appSecret:secret});
}
function failAcceptedCommit(failAllAfter=false) {
  let failed=false;
  return new Proxy(prisma,{get(target,key){
    if(key!=='$transaction')return Reflect.get(target,key,target);
    return (callback:any,options:any)=>{
      if(failed && failAllAfter)throw new Error('QA DB unavailable');
      return target.$transaction(async tx=>callback(new Proxy(tx,{get(client,property){
        if(property!=='waCommerceOutbox')return Reflect.get(client,property,client);
        return new Proxy(client.waCommerceOutbox,{get(model,operation){
          if(operation!=='updateMany')return Reflect.get(model,operation,model);
          return (input:any)=>{
            if(!failed && input.data.status==='SENT'){failed=true;throw new Error('QA commit lost after provider ID');}
            return model.updateMany(input);
          };
        }});
      }})),options);
    };
  }});
}
qa('WhatsApp ledger de intentos reales MySQL',()=>{
  beforeAll(()=>{
    const url=new URL(process.env.DATABASE_URL!);
    expect(url.protocol).toBe('mysql:');expect(['127.0.0.1','localhost','[::1]']).toContain(url.hostname);
    expect(url.pathname).toMatch(/^\/nortex_(qa|quality|test)(_[a-z0-9_]+)?$/);
    fetchSpy=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('Red externa prohibida'));
  });
  afterAll(async()=>{
    for(const tenantId of tenants){
      await prisma.waCommerceReceipt.deleteMany({where:{tenantId}});
      await prisma.waCommerceOutboxAttempt.deleteMany({where:{tenantId}});
      await prisma.waCommerceOutbox.deleteMany({where:{tenantId}});
      await prisma.waCommerceConversation.deleteMany({where:{tenantId}});
      await prisma.whatsAppChannel.deleteMany({where:{tenantId}});
      await prisma.tenant.deleteMany({where:{id:tenantId}});
    }
    expect(fetchSpy).not.toHaveBeenCalled();fetchSpy.mockRestore();await prisma.$disconnect();
  });
  it('receipt READ firmado anticipado concilia ID tardío después de recovery de lease sin reenviar',async()=>{
    const {tenantId,channel,conversation,output}=await seed();
    const messageId=`wamid.qa-recovered-${randomUUID()}`;
    const sender=vi.fn(async()=>{
      await earlyRead(channel,conversation.waId,messageId);
      expect(await recoverCommerceSending({db:prisma,now:()=>new Date(now.getTime()+61000)})).toBe(1);
      return messageId;
    });
    await dispatchCommerceOutboxOnce({db:prisma,now:()=>now,sendingEnabled:true,sender});
    const receipt=await prisma.waCommerceReceipt.findFirstOrThrow({where:{tenantId,channelId:channel.id,waId:conversation.waId,providerMessageId:messageId}});
    expect(receipt.status).toBe('read');
    const saved=await prisma.waCommerceOutbox.findFirstOrThrow({where:{id:output.id,tenantId}});
    expect(saved.providerMessageId).toBe(messageId);
    expect(await dispatchCommerceOutboxOnce({db:prisma,now:()=>now,sendingEnabled:true,sender})).toBe(false);
    expect(sender).toHaveBeenCalledOnce();
    expect(saved.status).toBe('READ');
  });
  it('receipt READ firmado anticipado concilia ID conservado tras fallo del primer commit',async()=>{
    const {tenantId,channel,conversation,output}=await seed();
    const messageId=`wamid.qa-failed-commit-${randomUUID()}`;
    const sender=vi.fn(async()=>{await earlyRead(channel,conversation.waId,messageId);return messageId;});
    await dispatchCommerceOutboxOnce({db:failAcceptedCommit(),now:()=>now,sendingEnabled:true,sender});
    const receipt=await prisma.waCommerceReceipt.findFirstOrThrow({where:{tenantId,channelId:channel.id,waId:conversation.waId,providerMessageId:messageId}});
    expect(receipt.status).toBe('read');
    const saved=await prisma.waCommerceOutbox.findFirstOrThrow({where:{id:output.id,tenantId}});
    expect(saved.providerMessageId).toBe(messageId);
    expect(await dispatchCommerceOutboxOnce({db:prisma,now:()=>now,sendingEnabled:true,sender})).toBe(false);
    expect(sender).toHaveBeenCalledOnce();
    expect(saved.status).toBe('READ');
  });
  it('conserva el ID conocido cuando falla el primer commit y nunca repite UNKNOWN',async()=>{
    const {tenantId,output}=await seed();
    const sender=vi.fn().mockResolvedValue('wamid.qa-known');
    await dispatchCommerceOutboxOnce({db:failAcceptedCommit(),now:()=>now,sendingEnabled:true,sender});
    const saved=await prisma.waCommerceOutbox.findFirstOrThrow({where:{id:output.id,tenantId}});
    expect(saved).toMatchObject({status:'UNKNOWN',providerMessageId:'wamid.qa-known',errorCode:'COMMERCE_SEND_FAILED'});
    const attempt=await prisma.waCommerceOutboxAttempt.findFirstOrThrow({where:{outboxId:output.id,tenantId}});
    expect(attempt).toMatchObject({status:'UNKNOWN',providerMessageId:'wamid.qa-known'});
    expect(attempt.invokedAt).toEqual(now);expect(attempt.settledAt).toEqual(now);
    expect(await dispatchCommerceOutboxOnce({now:()=>now,sendingEnabled:true,sender})).toBe(false);
    expect(sender).toHaveBeenCalledOnce();
  });
  it('la invocación tiene evidencia durable antes del sender y no guarda códigos arbitrarios',async()=>{
    const {tenantId,output}=await seed();
    const sender=vi.fn(async()=>{
      const attempt=await prisma.waCommerceOutboxAttempt.findFirstOrThrow({where:{outboxId:output.id,tenantId}});
      expect(attempt).toMatchObject({status:'SENDING',invokedAt:now,settledAt:null});
      throw Object.assign(new Error('QA uncertain'),{code:'fake-secret-value-never-save'});
    });
    await dispatchCommerceOutboxOnce({now:()=>now,sendingEnabled:true,sender});
    const attempt=await prisma.waCommerceOutboxAttempt.findFirstOrThrow({where:{outboxId:output.id,tenantId}});
    expect(attempt).toMatchObject({status:'UNKNOWN',errorCode:'COMMERCE_SEND_FAILED',providerMessageId:null});
    expect((await prisma.waCommerceOutbox.findFirstOrThrow({where:{id:output.id,tenantId}})).errorCode).toBe('COMMERCE_SEND_FAILED');
  });
  it('rechazo antes de red conserva intento CANCELLED sin invokedAt',async()=>{
    const {tenantId,channel,output}=await seed();
    await prisma.whatsAppChannel.update({where:{id:channel.id},data:{commerceEnabled:false}});
    const sender=vi.fn();
    await dispatchCommerceOutboxOnce({now:()=>now,sendingEnabled:true,sender});
    expect(sender).not.toHaveBeenCalled();
    expect(await prisma.waCommerceOutboxAttempt.findFirstOrThrow({where:{outboxId:output.id,tenantId}})).toMatchObject({status:'CANCELLED',invokedAt:null,errorCode:'COMMERCE_CHANNEL'});
  });
  it('caída total tras retorno de ID conserva SENDING y lease vencido recupera ambas evidencias',async()=>{
    const {tenantId,output}=await seed();const sender=vi.fn().mockResolvedValue('wamid.qa-db-down');
    await expect(dispatchCommerceOutboxOnce({db:failAcceptedCommit(true),now:()=>now,sendingEnabled:true,sender})).rejects.toThrow();
    expect((await prisma.waCommerceOutbox.findFirstOrThrow({where:{id:output.id,tenantId}})).status).toBe('SENDING');
    expect((await prisma.waCommerceOutboxAttempt.findFirstOrThrow({where:{outboxId:output.id,tenantId}})).status).toBe('SENDING');
    const later=new Date(now.getTime()+61000);
    expect(await recoverCommerceSending({now:()=>later})).toBe(1);
    expect((await prisma.waCommerceOutbox.findFirstOrThrow({where:{id:output.id,tenantId}})).status).toBe('UNKNOWN');
    expect(await prisma.waCommerceOutboxAttempt.findFirstOrThrow({where:{outboxId:output.id,tenantId}})).toMatchObject({status:'UNKNOWN',settledAt:later,errorCode:'SEND_INTERRUPTED'});
    expect(await dispatchCommerceOutboxOnce({now:()=>later,sendingEnabled:true,sender})).toBe(false);expect(sender).toHaveBeenCalledOnce();
  });
  it('aceptación confirmada conserva ID e intento único sin afirmar entrega',async()=>{
    const {tenantId,output}=await seed();const sender=vi.fn().mockResolvedValue('wamid.qa-accepted');
    await dispatchCommerceOutboxOnce({now:()=>now,sendingEnabled:true,sender});
    expect(await prisma.waCommerceOutbox.findFirstOrThrow({where:{id:output.id,tenantId}})).toMatchObject({status:'SENT',providerMessageId:'wamid.qa-accepted'});
    const attempts=await prisma.waCommerceOutboxAttempt.findMany({where:{outboxId:output.id,tenantId},take:10});
    expect(attempts).toHaveLength(1);expect(attempts[0]).toMatchObject({status:'ACCEPTED',claimedAt:now,invokedAt:now,settledAt:now,providerMessageId:'wamid.qa-accepted',errorCode:null});
    expect(await dispatchCommerceOutboxOnce({now:()=>now,sendingEnabled:true,sender})).toBe(false);expect(sender).toHaveBeenCalledOnce();
  });
  it('recupera leases anteriores sin ledger sin crear un intento inventado',async()=>{
    const {tenantId,output}=await seed();
    await prisma.waCommerceOutbox.update({where:{id:output.id},data:{status:'SENDING',leaseToken:randomUUID(),leaseUntil:now}});
    expect(await recoverCommerceSending({now:()=>now})).toBe(1);
    expect((await prisma.waCommerceOutbox.findFirstOrThrow({where:{id:output.id,tenantId}})).status).toBe('UNKNOWN');
    expect(await prisma.waCommerceOutboxAttempt.count({where:{tenantId,outboxId:output.id}})).toBe(0);
  });
  it('respuesta perdida después del commit no degrada ACCEPTED ni vuelve a enviar',async()=>{
    const {tenantId,output}=await seed();let lost=false;
    const db=new Proxy(prisma,{get(target,key){
      if(key!=='$transaction')return Reflect.get(target,key,target);
      return async(callback:any,options:any)=>{
        let accepted=false;
        const result=await target.$transaction(async tx=>callback(new Proxy(tx,{get(client,property){
          if(property!=='waCommerceOutbox')return Reflect.get(client,property,client);
          return new Proxy(client.waCommerceOutbox,{get(model,operation){
            if(operation!=='updateMany')return Reflect.get(model,operation,model);
            return(input:any)=>{if(input.data.status==='SENT')accepted=true;return model.updateMany(input);};
          }});
        }})),options);
        if(accepted && !lost){lost=true;throw new Error('QA transaction response lost');}
        return result;
      };
    }});
    const sender=vi.fn().mockResolvedValue('wamid.qa-committed');
    await dispatchCommerceOutboxOnce({db,now:()=>now,sendingEnabled:true,sender});
    expect(await prisma.waCommerceOutbox.findFirstOrThrow({where:{id:output.id,tenantId}})).toMatchObject({status:'SENT',providerMessageId:'wamid.qa-committed'});
    expect(await prisma.waCommerceOutboxAttempt.findFirstOrThrow({where:{outboxId:output.id,tenantId}})).toMatchObject({status:'ACCEPTED',providerMessageId:'wamid.qa-committed',errorCode:null});
    expect(await dispatchCommerceOutboxOnce({now:()=>now,sendingEnabled:true,sender})).toBe(false);expect(sender).toHaveBeenCalledOnce();
  });
});
