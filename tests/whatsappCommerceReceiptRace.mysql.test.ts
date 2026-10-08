import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import prisma from '../backend/lib/prisma';
import { acceptCommerceWebhook } from '../backend/services/whatsapp/commerce/inbox';

const qa=process.env.NORTEX_MYSQL_INTEGRATION==='1'?describe.sequential:describe.skip;
const tenantId=`qa-receipt-race-${randomUUID()}`;
const now=new Date('2026-09-29T15:00:00Z');
let fetchSpy:ReturnType<typeof vi.spyOn>;
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};};

qa('WhatsApp receipts concurrentes reales MySQL',()=>{
  beforeAll(()=>{
    const url=new URL(process.env.DATABASE_URL!);
    expect(url.protocol).toBe('mysql:');
    expect(['127.0.0.1','localhost','[::1]']).toContain(url.hostname);
    expect(url.pathname).toMatch(/^\/nortex_(qa|quality|test)(_[a-z0-9_]+)?$/);
    expect(process.env.NORTEX_QA_DATABASE_ACK).toBe('disposable-database');
    fetchSpy=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('Red externa prohibida'));
  });
  afterAll(async()=>{
    await prisma.waCommerceReceipt.deleteMany({where:{tenantId}});
    await prisma.waCommerceOutbox.deleteMany({where:{tenantId}});
    await prisma.waCommerceConversation.deleteMany({where:{tenantId}});
    await prisma.whatsAppChannel.deleteMany({where:{tenantId}});
    await prisma.tenant.deleteMany({where:{id:tenantId}});
    expect(fetchSpy).not.toHaveBeenCalled();fetchSpy.mockRestore();await prisma.$disconnect();
  });
  it('READ prevalece cuando ambos callbacks leen SENT y DELIVERED confirma primero',async()=>{
    await prisma.tenant.create({data:{id:tenantId,businessName:'QA Race Receipts',taxId:tenantId,type:'FERRETERIA'}});
    const channel=await prisma.whatsAppChannel.create({data:{tenantId,phoneNumberId:`98${randomUUID().replace(/[^0-9]/g,'').padEnd(30,'0')}`,accessTokenEnc:'QA-NO-TOKEN',commerceEnabled:true,commercePolicyVersion:1}});
    const waId='50588889999';
    const conversation=await prisma.waCommerceConversation.create({data:{tenantId,channelId:channel.id,waId,lastInboundAt:now}});
    const providerMessageId=`wamid.qa-race-${randomUUID()}`;
    const output=await prisma.waCommerceOutbox.create({data:{tenantId,channelId:channel.id,conversationId:conversation.id,waId,idempotencyKey:randomUUID(),body:'Respuesta QA',policyVersion:1,expiresAt:new Date(now.getTime()+3600000),status:'SENT',providerMessageId}});
    const snapshots:string[]=[];
    const bothSnapshots=deferred(),deliveredCommitted=deferred();
    // Only timing is controlled. All reads, inserts, updates and commits use MySQL.
    const dbFor=(callbackStatus:'delivered'|'read')=>new Proxy(prisma,{get(target,key){
      if(key!=='$transaction')return Reflect.get(target,key,target);
      return async(callback:any,options:any)=>{
        const result=await target.$transaction(async tx=>callback(new Proxy(tx,{get(client,property){
          if(property!=='waCommerceOutbox')return Reflect.get(client,property,client);
          return new Proxy(client.waCommerceOutbox,{get(model,operation){
            if(operation==='findFirst')return async(input:any)=>{
              const row=await model.findFirst(input);
              if(row?.id===output.id){snapshots.push(row.status);if(snapshots.length===2)bothSnapshots.resolve();await bothSnapshots.promise;if(callbackStatus==='read')await deliveredCommitted.promise;}
              return row;
            };
            if(operation==='updateMany')return async(input:any)=>{
              return model.updateMany(input);
            };
            return Reflect.get(model,operation,model);
          }});
        }})),{...options,timeout:10000});
        if(callbackStatus==='delivered')deliveredCommitted.resolve();
        return result;
      };
    }});
    const secret='QA-fictitious-race-signature';
    const callback=async(status:'delivered'|'read')=>{
      const bytes=Buffer.from(JSON.stringify({object:'whatsapp_business_account',entry:[{changes:[{value:{metadata:{phone_number_id:channel.phoneNumberId},statuses:[{id:providerMessageId,recipient_id:waId,status}]}}]}]}));
      const signature='sha256='+createHmac('sha256',secret).update(bytes).digest('hex');
      return acceptCommerceWebhook(bytes,signature,{db:dbFor(status),now:()=>now,appSecret:secret});
    };
    const results=await Promise.all([callback('delivered'),callback('read')]);
    expect(snapshots).toEqual(['SENT','SENT']);
    expect(results.map(r=>r.receipts)).toEqual([1,1]);
    const receipts=await prisma.waCommerceReceipt.findMany({where:{tenantId,channelId:channel.id,waId,providerMessageId},orderBy:{status:'asc'}});
    expect(receipts.map(r=>r.status)).toEqual(['delivered','read']);
    const saved=await prisma.waCommerceOutbox.findFirstOrThrow({where:{id:output.id,tenantId}});
    expect(saved.providerMessageId).toBe(providerMessageId);
    expect(saved.status).toBe('READ');
  },15000);
});
