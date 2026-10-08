// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
const m=vi.hoisted(()=>({channels:new Map<string,any>(),rows:new Map<string,any>(),enqueue:vi.fn(),statusUpdate:vi.fn(),commit:vi.fn(),receipt:vi.fn(),lookup:vi.fn()}));
vi.mock('../backend/services/whatsapp/config',()=>({getWhatsAppConfig:()=>({appSecret:'qa-only',verifyToken:'qa-only'})}));
vi.mock('../backend/services/whatsapp/inbound',()=>({inboundQueue:{enqueue:m.enqueue}}));
vi.mock('../backend/services/whatsapp/db',()=>({prisma:{whatsAppMessage:{updateMany:m.statusUpdate}}}));
vi.mock('../backend/lib/prisma',()=>({default:{$transaction:(fn:any)=>m.commit(fn)}}));
import { webhookHandler } from '../backend/services/whatsapp/webhook';
const tx:any={
 whatsAppChannel:{findUnique:(input:any)=>m.lookup(input)},
 waCommerceInbox:{findUnique:async({where}:any)=>m.rows.get(where.providerMessageId),create:async({data}:any)=>{m.rows.set(data.providerMessageId,data);return data;}},
 waCommerceConversation:{upsert:async({create}:any)=>({id:'conversation-'+create.channelId,...create}),updateMany:vi.fn()},
 waCommerceReceipt:{createMany:m.receipt,findMany:vi.fn()},
 waCommerceOutbox:{findFirst:vi.fn()},
};
const channel=(id:string,commerceEnabled:boolean,commercePolicyVersion=0)=>({id:'channel-'+id,tenantId:'tenant-'+id,active:true,commerceEnabled,commercePolicyVersion,defaultMode:'BOT'});
const value=(id:string,msg='message-'+id)=>({messaging_product:'whatsapp',metadata:{phone_number_id:id,display_phone_number:id},contacts:[{wa_id:'50588886666',profile:{name:'QA buyer'}}],messages:[{id:msg,from:'50588886666',timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'hola'}}]});
const req=(values:any[])=>{const body=Buffer.from(JSON.stringify({object:'whatsapp_business_account',entry:[{id:'qa',changes:values.map(value=>({field:'messages',value}))}]}));return {body,headers:{'x-hub-signature-256':'sha256='+createHmac('sha256','qa-only').update(body).digest('hex')}};};
const res=()=>{const r:any={sendStatus:vi.fn(),status:vi.fn(),json:vi.fn()};r.status.mockReturnValue(r);return r;};
beforeEach(()=>{vi.clearAllMocks();m.channels.clear();m.rows.clear();vi.stubEnv('WHATSAPP_COMMERCE_ENABLED','true');m.lookup.mockImplementation(async({where})=>m.channels.get(where.phoneNumberId));m.commit.mockImplementation(async(fn)=>fn(tx));m.statusUpdate.mockResolvedValue({count:1});tx.waCommerceOutbox.findFirst.mockResolvedValue(null);});
afterEach(()=>vi.unstubAllEnvs());
describe('Webhook mixto: contrato de canal y ACK',()=>{
 it('conserva legacy cuando comercio global está activo',async()=>{m.channels.set('10001',channel('10001',false));const r=res();await webhookHandler(req([value('10001')]),r);expect(m.enqueue).toHaveBeenCalledWith(expect.objectContaining({phoneNumberId:'10001',profileName:'QA buyer'}));expect(m.rows.size).toBe(0);expect(r.sendStatus).toHaveBeenCalledWith(200);});
 it('mezcla dos tenants sin enviar entradas comerciales al legacy',async()=>{m.channels.set('10001',channel('10001',false));m.channels.set('20002',channel('20002',true,1));const r=res();await webhookHandler(req([value('10001'),value('20002')]),r);expect(m.enqueue).toHaveBeenCalledTimes(1);expect(m.rows.get('message-20002')).toMatchObject({tenantId:'tenant-20002',channelId:'channel-20002'});expect(r.sendStatus).toHaveBeenCalledTimes(1);});
 it('espera commit comercial antes de ACK y antes de encolar legacy',async()=>{m.channels.set('10001',channel('10001',false));m.channels.set('20002',channel('20002',true,1));let release!:()=>void;m.commit.mockImplementation(async(fn)=>{await fn(tx);await new Promise<void>(resolve=>{release=resolve});});const r=res();const running=webhookHandler(req([value('10001'),value('20002')]),r);await vi.waitFor(()=>expect(release).toBeDefined());expect(r.sendStatus).not.toHaveBeenCalled();expect(m.enqueue).not.toHaveBeenCalled();release();await running;expect(r.sendStatus).toHaveBeenCalledWith(200);expect(m.enqueue).toHaveBeenCalledTimes(1);});
 it('fallo DB en callback mixto no encola legacy antes de reentrega',async()=>{m.channels.set('10001',channel('10001',false));m.lookup.mockImplementation(async({where})=>{if(where.phoneNumberId==='20002')throw new Error('QA DB');return m.channels.get(where.phoneNumberId);});const r=res();await webhookHandler(req([value('10001'),value('20002')]),r);expect(m.enqueue).not.toHaveBeenCalled();expect(r.status).toHaveBeenCalledWith(503);expect(r.sendStatus).not.toHaveBeenCalledWith(200);});
 it.each(['true','false'])('pausa global %s conserva comercial sin fallback',async flag=>{vi.stubEnv('WHATSAPP_COMMERCE_ENABLED',flag);m.channels.set('20002',channel('20002',false,1));const r=res();await webhookHandler(req([value('20002')]),r);expect(m.enqueue).not.toHaveBeenCalled();expect(m.rows.size).toBe(1);expect(r.sendStatus).toHaveBeenCalledWith(200);});
 it('reentrega no crea otro inbox comercial',async()=>{m.channels.set('20002',channel('20002',true,1));const request=req([value('20002')]);await webhookHandler(request,res());await webhookHandler(request,res());expect(m.rows.size).toBe(1);expect(m.enqueue).not.toHaveBeenCalled();});
 it('pausado/inactivo sigue conservando recibos exactos',async()=>{m.channels.set('20002',{...channel('20002',false,1),active:false});const r=res();await webhookHandler(req([{metadata:{phone_number_id:'20002'},statuses:[{id:'provider-1',recipient_id:'50588886666',status:'delivered'}]}]),r);expect(m.receipt).toHaveBeenCalledWith(expect.objectContaining({data:[expect.objectContaining({tenantId:'tenant-20002',channelId:'channel-20002',providerMessageId:'provider-1'})]}));expect(m.enqueue).not.toHaveBeenCalled();});
 it('canal desconocido o legacy inactivo no recibe trabajo',async()=>{m.channels.set('10001',{...channel('10001',false),active:false});const r=res();await webhookHandler(req([value('10001'),value('99999')]),r);expect(m.enqueue).not.toHaveBeenCalled();expect(m.rows.size).toBe(0);expect(r.sendStatus).toHaveBeenCalledWith(200);});
 it('firma inválida no accede a DB ni encola',async()=>{const request=req([value('10001')]);request.headers['x-hub-signature-256']='sha256='+'0'.repeat(64);const r=res();await webhookHandler(request,r);expect(r.status).toHaveBeenCalledWith(401);expect(m.commit).not.toHaveBeenCalled();expect(m.enqueue).not.toHaveBeenCalled();});
});
