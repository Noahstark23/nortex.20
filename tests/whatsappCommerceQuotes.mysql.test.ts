import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import prisma from '../backend/lib/prisma';
import { autoIssueCommerceQuote, createCommerceQuoteDraft, issueCommerceQuote, reviewCommerceQuote, updateCommerceQuote } from '../backend/services/whatsapp/commerce/quotes';
import { dispatchCommerceOutboxOnce } from '../backend/services/whatsapp/commerce/outbox';
import { handleCommerceMessage } from '../backend/services/whatsapp/commerce/conversation';

const qa=process.env.NORTEX_MYSQL_INTEGRATION==='1' ? describe.sequential : describe.skip;
const now=new Date('2026-09-29T15:00:00Z');
let fetchSpy:ReturnType<typeof vi.spyOn>;
const testTenantIds:string[]=[];

qa('WhatsApp comercial: cotización real MySQL 8',()=>{
  beforeAll(()=>{
    const url=new URL(process.env.DATABASE_URL!);
    expect(url.protocol).toBe('mysql:');
    expect(['127.0.0.1','localhost','[::1]']).toContain(url.hostname);
    expect(url.pathname).toMatch(/^\/nortex_(qa|quality|test)(_[a-z0-9_]+)?$/);
    fetchSpy=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('Red externa prohibida en QA'));
  });
  afterAll(async()=>{
    try {
      for (const tenantId of testTenantIds) {
        const quotes=await prisma.quotation.findMany({where:{tenantId},select:{id:true},take:100});
        await prisma.quotationItem.deleteMany({where:{quotationId:{in:quotes.map(q=>q.id)}}});
        await prisma.waCommerceOutbox.deleteMany({where:{tenantId}});
        await prisma.waCommerceQuoteDraft.deleteMany({where:{tenantId}});
        await prisma.waCommerceConsentEvent.deleteMany({where:{tenantId}});
        await prisma.waCommerceInbox.deleteMany({where:{tenantId}});
        await prisma.waCommerceReceipt.deleteMany({where:{tenantId}});
        await prisma.waCommerceConversation.deleteMany({where:{tenantId}});
        await prisma.quotation.deleteMany({where:{tenantId}});
        await prisma.auditLog.deleteMany({where:{tenantId}});
        await prisma.product.deleteMany({where:{tenantId}});
        await prisma.whatsAppChannel.deleteMany({where:{tenantId}});
        await prisma.user.deleteMany({where:{tenantId}});
        await prisma.tenant.deleteMany({where:{id:tenantId}});
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {fetchSpy?.mockRestore();await prisma.$disconnect();}
  });

  it('serializa ediciones de la misma versión y devuelve una emisión concurrente idempotente',async()=>{
    const tenantId=`qa-commerce-race-${randomUUID()}`;
    testTenantIds.push(tenantId);
    await prisma.tenant.create({data:{id:tenantId,businessName:'QA Carrera proforma',taxId:tenantId,type:'FERRETERIA'}});
    const user=await prisma.user.create({data:{tenantId,email:`qa-${randomUUID()}@example.invalid`,password:'QA-NOT-REAL',name:'Operador QA',role:'OWNER'}});
    const product=await prisma.product.create({data:{tenantId,name:'Martillo carrera',sku:randomUUID(),price:115,cost:50,stock:10,unit:'unidad',createdBy:user.id,isPublished:true}});
    const channel=await prisma.whatsAppChannel.create({data:{tenantId,phoneNumberId:`qa-${randomUUID()}`,accessTokenEnc:'QA-NO-TOKEN',active:true,commerceEnabled:true,commercePolicyVersion:1,commercePolicy:{eligibleProductIds:[product.id],autoQuote:false,ttlHours:24,maxTotal:'999.00',maxLines:2,eligibilityAttested:true}}});
    const conversation=await prisma.waCommerceConversation.create({data:{tenantId,channelId:channel.id,waId:'50588889999',lastInboundAt:now}});
    const ctx={tenantId,channelId:channel.id,conversationId:conversation.id,waId:conversation.waId,policyVersion:1};
    const draft=await prisma.$transaction(tx=>createCommerceQuoteDraft(tx,ctx,[{productId:product.id,quantity:'1'}],'edit-race',now));
    const principal={tenantId,userId:user.id,role:'OWNER'};
    // Both real MySQL transactions finish the initial consistent reads before
    // either acquires the channel lock. No financial/domain operation is mocked.
    const concurrentDb=()=>{
      let arrived=0;
      let release!:()=>void;
      const barrier=new Promise<void>(resolve=>{release=resolve;});
      return new Proxy(prisma,{get(target,property){
        if(property!=='$transaction') return Reflect.get(target,property,target);
        return (callback:any,options:any)=>target.$transaction(async tx=>{
          let waiting=true;
          const wrapped=new Proxy(tx,{get(client,key){
            if(key!=='$queryRaw') return Reflect.get(client,key,client);
            return async (...args:any[])=>{
              if(waiting && String(args[0]).includes('WhatsAppChannel')) {
                waiting=false;if(++arrived===2)release();await barrier;
              }
              return (client.$queryRaw as any)(...args);
            };
          }});
          return callback(wrapped);
        },options);
      }});
    };
    const editDb=concurrentDb();
    const edits=await Promise.allSettled([
      updateCommerceQuote(principal,draft.id,1,[{productId:product.id,quantity:'2'}],editDb,now),
      updateCommerceQuote(principal,draft.id,1,[{productId:product.id,quantity:'3'}],editDb,now),
    ]);
    expect(edits.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    expect(edits.filter(result=>result.status==='rejected')).toHaveLength(1);
    expect((edits.find(result=>result.status==='rejected') as PromiseRejectedResult).reason).toMatchObject({code:'VERSION_CHANGED'});
    const saved=await prisma.waCommerceQuoteDraft.findFirstOrThrow({where:{id:draft.id,tenantId}});
    expect(saved.version).toBe(2);
    expect(saved.items).toEqual((edits.find(result=>result.status==='fulfilled') as PromiseFulfilledResult<any>).value.items);
    const review=await reviewCommerceQuote(principal,draft.id,2,prisma,now);
    const issueDb=concurrentDb();
    const issued=await Promise.all([
      issueCommerceQuote(principal,draft.id,2,review.reviewHash,issueDb,now),
      issueCommerceQuote(principal,draft.id,2,review.reviewHash,issueDb,now),
    ]);
    expect(issued[0]).toEqual(issued[1]);
    expect(await prisma.quotation.count({where:{tenantId}})).toBe(1);
    expect(await prisma.waCommerceOutbox.count({where:{tenantId,quoteDraftId:draft.id}})).toBe(1);
    expect(await prisma.auditLog.count({where:{tenantId,action:'WHATSAPP_COMMERCE_QUOTE_ISSUED'}})).toBe(1);
    expect((await prisma.product.findFirstOrThrow({where:{tenantId,id:product.id}})).stock).toBe(10);
    // This suite also dispatches globally below; leave no unrelated pending output.
    await prisma.waCommerceOutbox.updateMany({where:{tenantId,status:'PENDING'},data:{status:'CANCELLED'}});
    for(const status of ['CANCELLED','EXPIRED']) {
      const closed=await prisma.$transaction(tx=>createCommerceQuoteDraft(tx,ctx,[{productId:product.id,quantity:'1'}],`closed-${status}`,now));
      const oldReview=await reviewCommerceQuote(principal,closed.id,1,prisma,now);
      if(status==='CANCELLED') {
        await prisma.waCommerceConversation.update({where:{id:conversation.id},data:{draftState:{stage:'READY',draftId:closed.id}}});
        await prisma.$transaction(async tx=>{
          await tx.$queryRaw`SELECT id FROM \`WhatsAppChannel\` WHERE id=${channel.id} AND tenantId=${tenantId} FOR UPDATE`;
          await tx.$queryRaw`SELECT id FROM \`WaCommerceConversation\` WHERE id=${conversation.id} AND tenantId=${tenantId} FOR UPDATE`;
          const current=await tx.waCommerceConversation.findFirstOrThrow({where:{id:conversation.id,tenantId}});
          const response=await handleCommerceMessage(tx,{id:randomUUID(),tenantId,channelId:channel.id,conversationId:conversation.id,waId:conversation.waId,body:'CANCELAR'} as any,current,channel,now);
          expect(response.text).toContain('Cancelé');
        });
        expect((await prisma.waCommerceQuoteDraft.findFirstOrThrow({where:{id:closed.id,tenantId}})).status).toBe('CANCELLED');
      } else await prisma.waCommerceQuoteDraft.update({where:{id:closed.id},data:{status,version:{increment:1}}});
      await expect(updateCommerceQuote(principal,closed.id,2,[{productId:product.id,quantity:'2'}],prisma,now)).rejects.toMatchObject({code:'DRAFT_UNAVAILABLE'});
      await expect(reviewCommerceQuote(principal,closed.id,2,prisma,now)).rejects.toMatchObject({code:'DRAFT_UNAVAILABLE'});
      await expect(issueCommerceQuote(principal,closed.id,2,oldReview.reviewHash,prisma,now)).rejects.toMatchObject({code:'DRAFT_UNAVAILABLE'});
      expect(await prisma.quotation.count({where:{tenantId}})).toBe(1);
      expect(await prisma.waCommerceOutbox.count({where:{tenantId,quoteDraftId:closed.id}})).toBe(0);
    }
  });

  it('revisa precio/tenant y emite una sola Quotation + outbox sin mover dinero o stock',async()=>{
    const tenantId=`qa-commerce-${randomUUID()}`, otherTenantId=`qa-commerce-${randomUUID()}`;
    testTenantIds.push(tenantId,otherTenantId);
    await prisma.tenant.createMany({data:[{id:tenantId,businessName:'QA Ferretería A',taxId:tenantId,type:'FERRETERIA'},{id:otherTenantId,businessName:'QA Ferretería B',taxId:otherTenantId,type:'FERRETERIA'}]});
    const user=await prisma.user.create({data:{tenantId,email:`qa-${randomUUID()}@example.invalid`,password:'QA-NOT-REAL',name:'Operador QA',role:'OWNER'}});
    const product=await prisma.product.create({data:{tenantId,name:'Martillo QA',sku:`QA-${randomUUID()}`,price:115,cost:50,stock:10,unit:'unidad',createdBy:user.id,isPublished:true}});
    const channel=await prisma.whatsAppChannel.create({data:{tenantId,phoneNumberId:`qa-${randomUUID()}`,accessTokenEnc:'QA-NO-TOKEN',active:true,commerceEnabled:true,commercePolicyVersion:1,commercePolicy:{eligibleProductIds:[product.id],autoQuote:false,ttlHours:24,maxTotal:'999.00',maxLines:2,eligibilityAttested:true}}});
    const conversation=await prisma.waCommerceConversation.create({data:{tenantId,channelId:channel.id,waId:'50588889999',lastInboundAt:now}});
    const ctx={tenantId,channelId:channel.id,conversationId:conversation.id,waId:conversation.waId,policyVersion:1};
    const draft=await prisma.$transaction(tx=>createCommerceQuoteDraft(tx,ctx,[{productId:product.id,quantity:'2'}],'incoming-1',now));
    const repeated=await prisma.$transaction(tx=>createCommerceQuoteDraft(tx,ctx,[{productId:product.id,quantity:'2'}],'incoming-1',now));
    expect(repeated.id).toBe(draft.id);
    const [raceA,raceB]=await Promise.all([
      prisma.$transaction(tx=>createCommerceQuoteDraft(tx,ctx,[{productId:product.id,quantity:'1'}],'incoming-race',now)),
      prisma.$transaction(tx=>createCommerceQuoteDraft(tx,ctx,[{productId:product.id,quantity:'1'}],'incoming-race',now)),
    ]);
    expect(raceA.id).toBe(raceB.id);
    const longKey=await prisma.$transaction(tx=>createCommerceQuoteDraft(tx,ctx,[{productId:product.id,quantity:'1'}],'x'.repeat(191),now));
    expect(longKey.requestKey).toHaveLength(64);
    await expect(prisma.$transaction(tx=>createCommerceQuoteDraft(tx,ctx,[{productId:product.id,quantity:'3'}],'incoming-1',now))).rejects.toMatchObject({code:'REQUEST_CONFLICT'});
    await expect(prisma.$transaction(tx=>createCommerceQuoteDraft(tx,ctx,[{productId:product.id,quantity:'0'}],'invalid-zero',now))).rejects.toMatchObject({code:'INVALID_QUANTITY'});
    const principal={tenantId,userId:user.id,role:'OWNER'};
    await expect(reviewCommerceQuote({...principal,tenantId:otherTenantId},draft.id,1,prisma,now)).rejects.toMatchObject({code:'COMMERCE_FORBIDDEN'});
    const first=await reviewCommerceQuote(principal,draft.id,1,prisma,now);
    expect(first.snapshot).toMatchObject({subtotal:'200.00',tax:'30.00',total:'230.00'});
    await prisma.product.update({where:{id:product.id},data:{price:120,promotionPriceVersion:{increment:1}}});
    await expect(issueCommerceQuote(principal,draft.id,1,first.reviewHash,prisma,now)).rejects.toMatchObject({code:'REVIEW_CHANGED'});
    const second=await reviewCommerceQuote(principal,draft.id,1,prisma,now);
    const issued=await issueCommerceQuote(principal,draft.id,1,second.reviewHash,prisma,now);
    expect(await issueCommerceQuote(principal,draft.id,1,second.reviewHash,prisma,now)).toEqual(issued);
    await expect(issueCommerceQuote(principal,draft.id,2,second.reviewHash,prisma,now)).rejects.toMatchObject({code:'VERSION_CHANGED'});
    expect(await prisma.quotation.count({where:{id:issued.quotationId,tenantId}})).toBe(1);
    expect(await prisma.waCommerceOutbox.count({where:{id:issued.outboxId,tenantId,quoteDraftId:draft.id}})).toBe(1);
    expect((await prisma.product.findFirstOrThrow({where:{id:product.id,tenantId},select:{stock:true}})).stock).toBe(10);
    expect((await prisma.tenant.findFirstOrThrow({where:{id:tenantId},select:{walletBalance:true}})).walletBalance.toString()).toBe('0');
    const sent=vi.fn().mockResolvedValue('wamid-qa-manual');
    expect(await dispatchCommerceOutboxOnce({db:prisma,now:()=>now,sendingEnabled:true,sender:sent})).toBe(true);
    expect(sent).toHaveBeenCalledTimes(1);
    expect((await prisma.waCommerceOutbox.findFirstOrThrow({where:{id:issued.outboxId}})).status).toBe('SENT');
    await prisma.whatsAppChannel.update({where:{id:channel.id},data:{commercePolicyVersion:2,commercePolicy:{eligibleProductIds:[product.id],autoQuote:true,ttlHours:24,maxTotal:'999.00',maxLines:2,eligibilityAttested:true}}});
    const autoCtx={...ctx,policyVersion:2};
    const auto=await prisma.$transaction(async tx=>{
      const pending=await createCommerceQuoteDraft(tx,autoCtx,[{productId:product.id,quantity:'1'}],'incoming-auto',now);
      return autoIssueCommerceQuote(tx,autoCtx,pending.id,now);
    });
    const autoDraft=await prisma.waCommerceQuoteDraft.findFirstOrThrow({where:{quotationId:auto.quotationId,tenantId}});
    expect(await prisma.$transaction(tx=>autoIssueCommerceQuote(tx,autoCtx,autoDraft.id,now))).toEqual(auto);
    expect(await prisma.waCommerceOutbox.count({where:{quoteDraftId:autoDraft.id,tenantId,actorUserId:null}})).toBe(1);
    expect(await prisma.quotation.count({where:{id:auto.quotationId,tenantId}})).toBe(1);
    const unknown=vi.fn().mockRejectedValue(new Error('response lost after provider acceptance'));
    expect(await dispatchCommerceOutboxOnce({db:prisma,now:()=>now,sendingEnabled:true,sender:unknown})).toBe(true);
    expect(unknown).toHaveBeenCalledTimes(1);
    expect((await prisma.waCommerceOutbox.findFirstOrThrow({where:{id:auto.outboxId}})).status).toBe('UNKNOWN');
    expect(await dispatchCommerceOutboxOnce({db:prisma,now:()=>now,sendingEnabled:true,sender:unknown})).toBe(false);
    expect(unknown).toHaveBeenCalledTimes(1);
    await prisma.waCommerceConversation.update({where:{id:conversation.id},data:{lastInboundAt:new Date(now.getTime()-24*3600000)}});
    const stale=await prisma.$transaction(tx=>createCommerceQuoteDraft(tx,autoCtx,[{productId:product.id,quantity:'1'}],'incoming-stale',now));
    await expect(prisma.$transaction(tx=>autoIssueCommerceQuote(tx,autoCtx,stale.id,now))).rejects.toMatchObject({code:'RECIPIENT_UNAVAILABLE'});
    await prisma.waCommerceConversation.update({where:{id:conversation.id},data:{lastInboundAt:now,status:'HUMAN',assignedUserId:null}});
    const human=await prisma.$transaction(tx=>createCommerceQuoteDraft(tx,autoCtx,[{productId:product.id,quantity:'1'}],'incoming-human',now));
    const humanReview=await reviewCommerceQuote(principal,human.id,1,prisma,now);
    await expect(issueCommerceQuote(principal,human.id,1,humanReview.reviewHash,prisma,now)).rejects.toMatchObject({code:'HANDOFF_OWNER'});
    await prisma.waCommerceConversation.update({where:{id:conversation.id},data:{assignedUserId:user.id}});
    const humanIssued=await issueCommerceQuote(principal,human.id,1,humanReview.reviewHash,prisma,now);
    expect(await prisma.waCommerceOutbox.count({where:{id:humanIssued.outboxId,actorUserId:user.id,tenantId}})).toBe(1);
    expect(await prisma.sale.count({where:{tenantId}})).toBe(0);expect(await prisma.payment.count({where:{sale:{tenantId}}})).toBe(0);
    expect(await prisma.kardexMovement.count({where:{tenantId}})).toBe(0);expect(await prisma.journalEntry.count({where:{tenantId}})).toBe(0);
  });
  it('catálogo real rechaza ocultamiento tras elección y cantidades incompatibles con unidad base',async()=>{
    const tenantId=`qa-commerce-catalog-${randomUUID()}`;testTenantIds.push(tenantId);
    await prisma.tenant.create({data:{id:tenantId,businessName:'QA Catálogo',taxId:tenantId,type:'FERRETERIA'}});
    const user=await prisma.user.create({data:{tenantId,email:`qa-${randomUUID()}@example.invalid`,password:'QA-NOT-REAL',name:'Operador QA',role:'OWNER'}});
    const product=await prisma.product.create({data:{tenantId,name:'Tornillo catálogo',sku:randomUUID(),price:115,cost:50,stock:10,unit:'unidad',saleMode:'COUNTED',quantityStep:'1',createdBy:user.id,isPublished:true}});
    const channel=await prisma.whatsAppChannel.create({data:{tenantId,phoneNumberId:randomUUID(),accessTokenEnc:'QA-NO-TOKEN',active:true,commerceEnabled:true,commercePolicyVersion:1,commercePolicy:{eligibleProductIds:[product.id],autoQuote:false,ttlHours:24,maxTotal:'999.00',maxLines:2,eligibilityAttested:true}}});
    const conversation=await prisma.waCommerceConversation.create({data:{tenantId,channelId:channel.id,waId:'50588889999',lastInboundAt:now}});
    const ctx={tenantId,channelId:channel.id,conversationId:conversation.id,waId:conversation.waId,policyVersion:1};
    const message=(body:string)=>prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM \`WhatsAppChannel\` WHERE id=${channel.id} AND tenantId=${tenantId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM \`WaCommerceConversation\` WHERE id=${conversation.id} AND tenantId=${tenantId} FOR UPDATE`;
      const current=await tx.waCommerceConversation.findFirstOrThrow({where:{id:conversation.id,tenantId}});
      return handleCommerceMessage(tx,{id:randomUUID(),providerMessageId:randomUUID(),tenantId,channelId:channel.id,conversationId:conversation.id,waId:conversation.waId,body} as any,current,channel,now);
    });
    expect((await message('Tornillo')).text).toContain('1. Tornillo catálogo');
    expect((await message('1')).text).toContain('¿Cuántas');
    await prisma.product.update({where:{id:product.id},data:{isPublished:false}});
    expect((await message('2')).text).toContain('ya no está disponible');
    expect((await prisma.waCommerceConversation.findFirstOrThrow({where:{id:conversation.id,tenantId}})).draftState).toBeNull();
    expect(await prisma.waCommerceQuoteDraft.count({where:{tenantId}})).toBe(0);
    await prisma.product.update({where:{id:product.id},data:{isPublished:true}});
    await expect(prisma.$transaction(tx=>createCommerceQuoteDraft(tx,ctx,[{productId:product.id,quantity:'0.5'}],'counted-fraction',now))).rejects.toMatchObject({code:'INVALID_QUANTITY'});
    await prisma.product.update({where:{id:product.id},data:{unit:'metro',saleMode:'MEASURED',quantityStep:'0.25'}});
    await expect(prisma.$transaction(tx=>createCommerceQuoteDraft(tx,ctx,[{productId:product.id,quantity:'0.3'}],'measured-step',now))).rejects.toMatchObject({code:'INVALID_QUANTITY'});
    const valid=await prisma.$transaction(tx=>createCommerceQuoteDraft(tx,ctx,[{productId:product.id,quantity:'0.5'}],'measured-valid',now));
    const review=await reviewCommerceQuote({tenantId,userId:user.id,role:'OWNER'},valid.id,1,prisma,now);
    expect(review.snapshot.lines[0]).toMatchObject({quantity:'0.5000',unit:'metro',saleMode:'MEASURED',quantityStep:'0.25'});
    expect(review.snapshot.total).toBe('57.50');
    expect(await prisma.sale.count({where:{tenantId}})).toBe(0);expect(await prisma.payment.count({where:{sale:{tenantId}}})).toBe(0);
    expect(await prisma.kardexMovement.count({where:{tenantId}})).toBe(0);expect(await prisma.journalEntry.count({where:{tenantId}})).toBe(0);
    expect((await prisma.product.findFirstOrThrow({where:{id:product.id,tenantId}})).stock).toBe(10);
  });
  it('actor ajeno válido y cambios de vigencia/política/fiscal/unidad/stock bloquean emitir sin efectos',async()=>{
    const tenantId=`qa-commerce-guards-${randomUUID()}`,otherTenantId=`qa-commerce-guards-${randomUUID()}`;testTenantIds.push(tenantId,otherTenantId);
    await prisma.tenant.createMany({data:[{id:tenantId,businessName:'QA Guard A',taxId:tenantId,type:'FERRETERIA'},{id:otherTenantId,businessName:'QA Guard B',taxId:otherTenantId,type:'FERRETERIA'}]});
    const user=await prisma.user.create({data:{tenantId,email:`qa-${randomUUID()}@example.invalid`,password:'QA-NOT-REAL',name:'Operador A',role:'OWNER'}});
    const foreignUser=await prisma.user.create({data:{tenantId:otherTenantId,email:`qa-${randomUUID()}@example.invalid`,password:'QA-NOT-REAL',name:'Operador B',role:'OWNER'}});
    const product=await prisma.product.create({data:{tenantId,name:'Martillo guard',sku:randomUUID(),price:115,cost:50,stock:10,unit:'unidad',createdBy:user.id,isPublished:true}});
    const channel=await prisma.whatsAppChannel.create({data:{tenantId,phoneNumberId:randomUUID(),accessTokenEnc:'QA-NO-TOKEN',active:true,commerceEnabled:true,commercePolicyVersion:1,commercePolicy:{eligibleProductIds:[product.id],autoQuote:false,ttlHours:24,maxTotal:'999.00',maxLines:2,eligibilityAttested:true}}});
    const conversation=await prisma.waCommerceConversation.create({data:{tenantId,channelId:channel.id,waId:'50588889999',lastInboundAt:now}});
    const ctx={tenantId,channelId:channel.id,conversationId:conversation.id,waId:conversation.waId,policyVersion:1};
    const principal={tenantId,userId:user.id,role:'OWNER'},foreign={tenantId:otherTenantId,userId:foreignUser.id,role:'OWNER'};
    const prepare=async()=>{
      const draft=await prisma.$transaction(tx=>createCommerceQuoteDraft(tx,ctx,[{productId:product.id,quantity:'2'}],randomUUID(),now));
      const review=await reviewCommerceQuote(principal,draft.id,1,prisma,now);return {draft,review};
    };
    const first=await prepare();
    await expect(reviewCommerceQuote(foreign,first.draft.id,1,prisma,now)).rejects.toMatchObject({code:'DRAFT_NOT_FOUND'});
    await expect(updateCommerceQuote(foreign,first.draft.id,1,[{productId:product.id,quantity:'3'}],prisma,now)).rejects.toMatchObject({code:'DRAFT_NOT_FOUND'});
    await expect(issueCommerceQuote(foreign,first.draft.id,1,first.review.reviewHash,prisma,now)).rejects.toMatchObject({code:'DRAFT_NOT_FOUND'});
    await expect(issueCommerceQuote(principal,first.draft.id,1,first.review.reviewHash,prisma,new Date(now.getTime()+25*3600000))).rejects.toMatchObject({code:'EXPIRED'});
    const scenarios=[
      {mutate:()=>prisma.product.update({where:{id:product.id},data:{isPublished:false}}),restore:()=>prisma.product.update({where:{id:product.id},data:{isPublished:true}}),code:'PRODUCT_UNAVAILABLE'},
      {mutate:()=>prisma.product.update({where:{id:product.id},data:{unit:'caja'}}),restore:()=>prisma.product.update({where:{id:product.id},data:{unit:'unidad'}}),code:'REVIEW_CHANGED'},
      {mutate:()=>prisma.product.update({where:{id:product.id},data:{stock:1}}),restore:()=>prisma.product.update({where:{id:product.id},data:{stock:10}}),code:'INSUFFICIENT_STOCK'},
      {mutate:()=>prisma.whatsAppChannel.update({where:{id:channel.id},data:{commercePolicyVersion:2}}),restore:()=>prisma.whatsAppChannel.update({where:{id:channel.id},data:{commercePolicyVersion:1}}),code:'REVIEW_CHANGED'},
      {mutate:()=>prisma.tenant.update({where:{id:tenantId},data:{fiscalRegime:'CUOTA_FIJA',fiscalRegimeVersion:2}}),restore:()=>prisma.tenant.update({where:{id:tenantId},data:{fiscalRegime:'GENERAL',fiscalRegimeVersion:1}}),code:'REVIEW_CHANGED'},
    ];
    for(const scenario of scenarios){
      const {draft,review}=await prepare();await scenario.mutate();
      try {await expect(issueCommerceQuote(principal,draft.id,1,review.reviewHash,prisma,now)).rejects.toMatchObject({code:scenario.code});}
      finally {await scenario.restore();}
    }
    expect(await prisma.quotation.count({where:{tenantId}})).toBe(0);expect(await prisma.waCommerceOutbox.count({where:{tenantId}})).toBe(0);
    expect(await prisma.sale.count({where:{tenantId}})).toBe(0);expect(await prisma.payment.count({where:{sale:{tenantId}}})).toBe(0);
    expect(await prisma.kardexMovement.count({where:{tenantId}})).toBe(0);expect(await prisma.journalEntry.count({where:{tenantId}})).toBe(0);
    expect((await prisma.product.findFirstOrThrow({where:{id:product.id,tenantId}})).stock).toBe(10);
    expect((await prisma.tenant.findFirstOrThrow({where:{id:tenantId}})).walletBalance.toString()).toBe('0');
  });
});
