// @vitest-environment node
import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import prisma from '../backend/lib/prisma';
import { processCommerceInboxOnce } from '../backend/services/whatsapp/commerce/worker';
const base=process.env.NORTEX_QA_BASE_URL;
const qa=base && process.env.WHATSAPP_COMMERCE_ENABLED==='true'?describe.sequential:describe.skip;
const testTenants:string[]=[];
qa('WhatsApp comercio HTTP real y MySQL',()=>{
 afterAll(async()=>{
  for(const tenantId of testTenants){
   await prisma.waCommerceOutbox.deleteMany({where:{tenantId}});await prisma.waCommerceInbox.deleteMany({where:{tenantId}});
   await prisma.waCommerceConsentEvent.deleteMany({where:{tenantId}});await prisma.waCommerceQuoteDraft.deleteMany({where:{tenantId}});
   await prisma.waCommerceConversation.deleteMany({where:{tenantId}});
  }
  await prisma.$disconnect();
 });
 it('JWT real, activación, firma raw, dedupe y conversación durable hasta bandeja',async()=>{
  const email=`qa-wa-http-${randomUUID()}@example.invalid`;
  const registered=await fetch(`${base}/api/auth/register`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({companyName:'QA WhatsApp HTTP',email,password:'Qa-Only-Http-2026!',type:'FERRETERIA'})});
  const auth=await registered.json();expect(registered.status,JSON.stringify(auth)).toBe(200);
  const user=await prisma.user.findUniqueOrThrow({where:{email}});testTenants.push(user.tenantId);
  const product=await prisma.product.create({data:{tenantId:user.tenantId,name:'Martillo HTTP',sku:randomUUID(),price:115,cost:50,stock:10,unit:'unidad',isPublished:true,createdBy:user.id}});
  const channel=await prisma.whatsAppChannel.create({data:{tenantId:user.tenantId,phoneNumberId:String(Date.now())+String(Math.floor(Math.random()*1000)),accessTokenEnc:'QA-NEVER-REAL',active:true}});
  const headers={'content-type':'application/json',authorization:`Bearer ${auth.token}`};
  expect((await fetch(`${base}/api/whatsapp-commerce/channels`)).status).toBe(401);
  const policy={expectedVersion:0,enabled:true,policy:{eligibleProductIds:[product.id],autoQuote:false,ttlHours:24,maxTotal:'1000',maxLines:5,eligibilityAttested:true}};
  const enabled=await fetch(`${base}/api/whatsapp-commerce/channels/${channel.id}/policy`,{method:'PUT',headers,body:JSON.stringify(policy)});
  expect(enabled.status,await enabled.text()).toBe(200);
  const bytes=JSON.stringify({object:'whatsapp_business_account',entry:[{changes:[{value:{metadata:{phone_number_id:channel.phoneNumberId},messages:[{id:randomUUID(),from:'50588887777',timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'Martillo HTTP'}}]}}]}]});
  const sign='sha256='+createHmac('sha256',process.env.WHATSAPP_APP_SECRET!).update(bytes).digest('hex');
  const inbound=()=>fetch(`${base}/api/whatsapp/webhook`,{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':sign},body:bytes});
  expect((await fetch(`${base}/api/whatsapp/webhook`,{method:'POST',headers:{'content-type':'application/json'},body:bytes})).status).toBe(401);
  const accepted=await inbound(); expect(accepted.status,await accepted.text()).toBe(200);
  expect(await prisma.waCommerceInbox.count({where:{tenantId:user.tenantId}})).toBe(1);
  expect((await inbound()).status).toBe(200);
  expect(await prisma.waCommerceInbox.count({where:{tenantId:user.tenantId}})).toBe(1);
  await processCommerceInboxOnce({db:prisma});
  const list=await fetch(`${base}/api/whatsapp-commerce/conversations?channelId=${channel.id}`,{headers});
  const conversations=await list.json();expect(list.status).toBe(200);expect(conversations.items).toHaveLength(1);
  expect(conversations.items[0].status).toBe('BOT');
  for(const body of ['1','2','LISTO']) {
    const event=JSON.parse(bytes);event.entry[0].changes[0].value.messages[0].id=randomUUID();event.entry[0].changes[0].value.messages[0].text.body=body;
    const raw=JSON.stringify(event);const signature='sha256='+createHmac('sha256',process.env.WHATSAPP_APP_SECRET!).update(raw).digest('hex');
    const result=await fetch(`${base}/api/whatsapp/webhook`,{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':signature},body:raw});
    expect(result.status,await result.text()).toBe(200); await processCommerceInboxOnce({db:prisma});
  }
  const detail=await fetch(`${base}/api/whatsapp-commerce/conversations/${conversations.items[0].id}`,{headers});
  expect(detail.status).toBe(200);
  const view=await detail.json();expect(view.drafts).toHaveLength(1);expect(view.drafts[0].status).toBe('PENDING_REVIEW');
  const draft=view.drafts[0];
  const reviewed=await fetch(`${base}/api/whatsapp-commerce/drafts/${draft.id}/review`,{method:'POST',headers,body:JSON.stringify({version:draft.version})});
  const review=await reviewed.json();expect(reviewed.status,JSON.stringify(review)).toBe(200);expect(review.snapshot.total).toBe('230.00');
  const issued=await fetch(`${base}/api/whatsapp-commerce/drafts/${draft.id}/issue`,{method:'POST',headers,body:JSON.stringify({version:review.version,reviewHash:review.reviewHash})});
  const receipt=await issued.json();expect(issued.status,JSON.stringify(receipt)).toBe(201);
  expect(await prisma.waCommerceOutbox.count({where:{tenantId:user.tenantId,status:'PENDING',quoteDraftId:draft.id}})).toBe(1);
  expect((await prisma.product.findUniqueOrThrow({where:{id:product.id}})).stock).toBe(10);
  // Sin worker de envío, ninguna salida se presenta como entregada.
 });
});
