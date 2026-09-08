import { createHmac } from 'node:crypto';
import { describe,it,expect,vi } from 'vitest';
import express from 'express';
import { once } from 'node:events';
// Esta suite ejerce el webhook HMAC; las rutas JWT se verifican en integración.
vi.mock('../backend/middleware/auth.js',()=>({authenticate:(_req:unknown,_res:unknown,next:()=>void)=>next()}));
import { verifyPrivateWaSignature,acceptPrivateWaWebhook,claimPrivateWaInbox } from '../backend/services/assistant/privateWhatsapp/inbox.js';
import { assertMetaMediaUrl,createPrivateWaMediaDownloader,createPrivateWaSender } from '../backend/services/assistant/privateWhatsapp/transport.js';
import { authenticatedReviewLink,type PrivateWhatsappConfig } from '../backend/services/assistant/privateWhatsapp/config.js';
import { renderPrivateWaReply } from '../backend/services/assistant/privateWhatsapp/processor.js';
import { renderPrivateWaOperationalReply } from '../backend/services/assistant/privateWhatsapp/operations.js';
import { recoverPrivateWaSending,dispatchPrivateWaOutboxOnce } from '../backend/services/assistant/privateWhatsapp/outbox.js';
import { cleanupPrivateWaHistory } from '../backend/services/assistant/privateWhatsapp/retention.js';
import { hashLinkCode } from '../backend/services/assistant/privateWhatsapp/identity.js';
import { buildAssistantPrivateWhatsappWebhookRouter } from '../backend/routes/assistantPrivateWhatsapp.js';

const config:PrivateWhatsappConfig={enabled:true,sendingEnabled:false,phoneNumberId:'123456789',appSecret:'SYNTHETIC_TEST_SECRET',verifyToken:'SYNTHETIC_VERIFY',accessToken:'SYNTHETIC_NO_TRANSPORT',apiVersion:'v21.0',appOrigin:'https://nortex.example/'};
const now=new Date('2026-09-05T12:00:00Z');
const webhook=(text='hola',id='wamid.test')=>Buffer.from(JSON.stringify({object:'whatsapp_business_account',entry:[{changes:[{value:{metadata:{phone_number_id:config.phoneNumberId},messages:[{id,from:'50588889999',type:'text',timestamp:String(now.getTime()/1000),text:{body:text}}]}}]}]}));
const sign=(bytes:Buffer)=>`sha256=${createHmac('sha256',config.appSecret).update(bytes).digest('hex')}`;
function inboxDb() {
  const rows:any[]=[];
  const db:any={assistantWaBinding:{findFirst:vi.fn(async()=>null)},assistantWaInbox:{
    createMany:vi.fn(async({data}:any)=>{for(const row of data)if(!rows.some(old=>old.providerMessageId===row.providerMessageId))rows.push({...row,payload:Object.fromEntries(Object.entries(row.payload).reverse())});}),
    findUnique:vi.fn(async({where}:any)=>rows.find(row=>row.providerMessageId===where.providerMessageId)),
  },assistantWaOutbox:{updateMany:vi.fn(async()=>({count:0}))}};
  db.$transaction=vi.fn((fn:any)=>fn(db));return {db,rows};
}

describe('WhatsApp privado: entrada firmada y durable',()=>{
  it('rechaza firma inválida sin consultar o persistir',async()=>{
    const {db}=inboxDb(),bytes=webhook();
    expect(verifyPrivateWaSignature(bytes,sign(bytes),config.appSecret)).toBe(true);
    expect(verifyPrivateWaSignature(Buffer.concat([bytes,Buffer.from(' ')]),sign(bytes),config.appSecret)).toBe(false);
    await expect(acceptPrivateWaWebhook(bytes,'sha256=bad',{db,config,now:()=>now})).rejects.toMatchObject({code:'PRIVATE_WA_SIGNATURE'});
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('persiste hash de código de un uso; nunca código crudo ni texto desconocido',async()=>{
    const {db,rows}=inboxDb(),code='A1'.repeat(12),bytes=webhook(`VINCULAR ${code}`);
    await acceptPrivateWaWebhook(bytes,sign(bytes),{db,config,now:()=>now});
    expect(rows[0].payload).toEqual({timestamp:String(now.getTime()/1000),codeHash:hashLinkCode(code)});
    expect(JSON.stringify(rows)).not.toContain(code);expect(rows[0].kind).toBe('LINK');
    const stranger=webhook('información privada de desconocido','other');await acceptPrivateWaWebhook(stranger,sign(stranger),{db,config,now:()=>now});
    expect(rows[1].status).toBe('FAILED');expect(rows[1].payload.text).toBeUndefined();
  });
  it('replay conserva una entrada aunque MySQL reordene claves JSON',async()=>{
    const {db,rows}=inboxDb(),bytes=webhook(`VINCULAR ${'AB'.repeat(12)}`);
    await acceptPrivateWaWebhook(bytes,sign(bytes),{db,config,now:()=>now});await acceptPrivateWaWebhook(bytes,sign(bytes),{db,config,now:()=>now});
    expect(rows).toHaveLength(1);
    const changed=webhook(`VINCULAR ${'CD'.repeat(12)}`);await expect(acceptPrivateWaWebhook(changed,sign(changed),{db,config,now:()=>now})).rejects.toMatchObject({code:'PRIVATE_WA_MESSAGE_CONFLICT'});
  });
  it('no acepta un evento del número comercial en el canal privado',async()=>{
    const {db}=inboxDb(),bytes=Buffer.from(webhook().toString().replace(config.phoneNumberId,'987654321'));
    await expect(acceptPrivateWaWebhook(bytes,sign(bytes),{db,config,now:()=>now})).rejects.toMatchObject({code:'PRIVATE_WA_CHANNEL'});expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('el ACK espera commit y devuelve 503 si la persistencia falla',async()=>{
    const {db}=inboxDb();let release!:()=>void;const block=new Promise<void>(resolve=>{release=resolve;});
    db.$transaction.mockImplementation(async()=>{await block;throw new Error('synthetic database unavailable');});
    const app=express();app.use(buildAssistantPrivateWhatsappWebhookRouter({db,config,now:()=>now}));const server=app.listen(0,'127.0.0.1');await once(server,'listening');
    try{const address=server.address() as {port:number},bytes=webhook();let finished=false;
      const pending=fetch(`http://127.0.0.1:${address.port}/webhook`,{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':sign(bytes)},body:bytes}).then(response=>{finished=true;return response;});
      await vi.waitFor(()=>expect(db.$transaction).toHaveBeenCalled());expect(finished).toBe(false);release();expect((await pending).status).toBe(503);
    }finally{release();server.close();await once(server,'close');}
  });
  it('no adelanta la siguiente entrada de la misma conversación',async()=>{
    const db:any={assistantWaInbox:{updateMany:vi.fn()},$queryRaw:vi.fn().mockResolvedValueOnce([{id:'second',phoneNumberId:'123',waId:'50588889999'}]).mockResolvedValue([{id:'first'}])};db.$transaction=(fn:any)=>fn(db);
    expect(await claimPrivateWaInbox({db,now:()=>now})).toBeNull();expect(db.assistantWaInbox.updateMany).not.toHaveBeenCalled();
  });
});

describe('WhatsApp privado: documentos y salida sin red real',()=>{
  it.each(['http://lookaside.fbsbx.com/whatsapp_business/attachments/','https://127.0.0.1/whatsapp_business/attachments/','https://lookaside.fbsbx.com.evil.test/whatsapp_business/attachments/','https://lookaside.fbsbx.com@evil.test/whatsapp_business/attachments/','https://lookaside.fbsbx.com:444/whatsapp_business/attachments/','https://lookaside.fbsbx.com/not-attachments/'])('rechaza SSRF %s',url=>expect(()=>assertMetaMediaUrl(url)).toThrow());
  it('descarga sólo tras resolver ID, restringe host y no sigue redirects',async()=>{
    const bytes=Buffer.from('%PDF-synthetic'),url='https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=123';
    const request=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({id:'123',url,mime_type:'application/pdf',file_size:bytes.length}))).mockResolvedValueOnce(new Response(bytes));
    const file=await createPrivateWaMediaDownloader(config,request)('123');expect(file.bytes).toEqual(bytes);expect(request).toHaveBeenCalledTimes(2);
    for(const call of request.mock.calls)expect(call[1]?.redirect).toBe('error');
    expect(String(request.mock.calls[0][0])).toContain('phone_number_id=123456789');
  });
  it('una URL maliciosa desde metadata no recibe el token',async()=>{
    const request=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({id:'123',url:'https://evil.test/',mime_type:'application/pdf',file_size:15})));
    await expect(createPrivateWaMediaDownloader(config,request)('123')).rejects.toMatchObject({code:'PRIVATE_WA_MEDIA_URL'});expect(request).toHaveBeenCalledTimes(1);
  });
  it('corta un cuerpo mayor al tamaño declarado y no acepta tipos diferentes',async()=>{
    const request=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({id:'123',url:'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=123',mime_type:'application/pdf',file_size:4}))).mockResolvedValueOnce(new Response('%PDF-longer'));
    await expect(createPrivateWaMediaDownloader(config,request)('123')).rejects.toMatchObject({code:'PRIVATE_WA_MEDIA_METADATA'});
  });
  it('el sender permanece apagado y no invoca fetch',async()=>{
    const request=vi.fn<typeof fetch>();await expect(createPrivateWaSender(config,request).send('50588889999','hola')).rejects.toMatchObject({code:'PRIVATE_WA_SENDING_DISABLED'});expect(request).not.toHaveBeenCalled();
  });
  it('recuperar SENDING expirado lo marca UNKNOWN sin reenviar',async()=>{
    const updateMany=vi.fn(async(_args:unknown)=>({count:1}));const db:any={assistantWaOutbox:{findMany:vi.fn(async()=>[{id:'o1',tenantId:'t1',leaseToken:'lease'}]),updateMany}};
    expect(await recoverPrivateWaSending({db,now:()=>now})).toBe(1);expect(updateMany.mock.calls[0][0]).toMatchObject({where:{id:'o1',status:'SENDING',leaseToken:'lease'},data:{status:'UNKNOWN'}});
    const sender={send:vi.fn()};expect(await dispatchPrivateWaOutboxOnce({db,config,sender})).toBe(false);expect(sender.send).not.toHaveBeenCalled();
  });
  it('la respuesta conserva fuente y período y dirige confirmación sólo a sesión autenticada',()=>{
    const link=authenticatedReviewLink(config,'conversation-1');
    const text=renderPrivateWaReply({id:'m',createdAt:now.toISOString(),role:'assistant',text:'La compra sigue pendiente de revisión.',citations:[{id:'a',path:'nortex-help:a',title:'Ayuda',section:'Compras',version:'1'}]},link);
    expect(text).toContain('versión 1');expect(text).toContain('https://nortex.example/?assistantConversation=conversation-1');expect(()=>authenticatedReviewLink({...config,appOrigin:'https://user:password@evil.test/'},'id')).toThrow();
  });
  it('nunca presenta un run pendiente como respuesta final y distingue cancelación de fallo',()=>{
    const run={id:'run',conversationId:'c',requestId:'r',status:'RUNNING' as const,version:1,iterations:1,steps:[],createdAt:now.toISOString(),updatedAt:now.toISOString()};
    expect(()=>renderPrivateWaOperationalReply(run,'https://nortex.example')).toThrow('unfinished');
    expect(renderPrivateWaOperationalReply({...run,status:'CANCELLED'},'https://nortex.example')).toContain('cancelada');
    expect(renderPrivateWaOperationalReply({...run,status:'FAILED',errorCode:'INTERNAL_DB_ERROR'},'https://nortex.example')).toContain('No pude completar');
    expect(renderPrivateWaOperationalReply({...run,status:'FAILED',errorCode:'INTERNAL_DB_ERROR'},'https://nortex.example')).not.toContain('INTERNAL_DB_ERROR');
    const rendered=renderPrivateWaOperationalReply({...run,status:'SUCCEEDED',result:{text:'x'.repeat(4000),evidence:[{id:'e1',tool:'audit_business_health',label:'Ventas',data:{period:{startDate:'2026-09-01',endDate:'2026-09-04',cutoff:'2026-09-05T06:00:00Z'}}}],actionProposalIds:[],degraded:false}},'https://nortex.example');
    expect(rendered.length).toBeLessThanOrEqual(4096);expect(rendered).toContain('2026-09-01 a 2026-09-04');expect(rendered).toContain('https://nortex.example');
  });
  it('limpieza sólo usa las tablas efímeras del transporte y conserva inbox con salida pendiente',async()=>{
    const db:any={assistantWaChallenge:{findMany:vi.fn(async()=>[]),deleteMany:vi.fn()},assistantWaOutbox:{findMany:vi.fn(async()=>[]),count:vi.fn(async()=>1),deleteMany:vi.fn()},assistantWaInbox:{findMany:vi.fn(async()=>[{id:'in',tenantId:'t',status:'DONE'}]),deleteMany:vi.fn()}};
    expect(await cleanupPrivateWaHistory({db,now:()=>now})).toEqual({challenges:0,inbox:0,outbox:0});expect(db.assistantWaInbox.deleteMany).not.toHaveBeenCalled();expect(db.assistantWaInbox.findMany.mock.calls[0][0].take).toBe(100);
  });
});
