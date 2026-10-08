// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({
  operations:vi.fn(),supportList:vi.fn(),supportGet:vi.fn(),supportTransition:vi.fn(),getActivation:vi.fn(),requestActivation:vi.fn(),requirePrincipal:vi.fn(),listChannels:vi.fn(),updatePolicy:vi.fn(),review:vi.fn(),issue:vi.fn(),updateQuote:vi.fn(),
  db:{waCommerceConversation:{findFirst:vi.fn()},waCommerceOutbox:{findUnique:vi.fn(),create:vi.fn()},whatsAppChannel:{findFirst:vi.fn()},$queryRaw:vi.fn(),$transaction:vi.fn()},
}));
vi.mock('../backend/middleware/auth.js',()=>({authenticate:(req:any,_res:any,next:any)=>{req.tenantId=req.get('x-tenant')??'tenant-1';req.userId=req.get('x-user')??'user-1';req.role=req.get('x-role')??'OWNER';next();}}));
vi.mock('../backend/services/whatsapp/commerce/policy.js',()=>({requireCommercePrincipal:mocks.requirePrincipal,listCommerceChannels:mocks.listChannels,updateCommercePolicy:mocks.updatePolicy}));
vi.mock('../backend/services/whatsapp/commerce/activation.js',()=>({getCommerceActivationRequest:mocks.getActivation,requestCommerceActivation:mocks.requestActivation}));
vi.mock('../backend/services/whatsapp/commerce/operations.js',()=>({getCommerceOperations:mocks.operations}));
vi.mock('../backend/services/whatsapp/commerce/activationSupport.js',()=>({listSupportActivationRequests:mocks.supportList,getSupportActivationRequest:mocks.supportGet,transitionSupportActivationRequest:mocks.supportTransition}));
vi.mock('../backend/services/whatsapp/commerce/quotes.js',()=>({reviewCommerceQuote:mocks.review,issueCommerceQuote:mocks.issue,updateCommerceQuote:mocks.updateQuote}));
import {buildWhatsappCommerceRouter} from '../backend/routes/whatsappCommerce';
const router=buildWhatsappCommerceRouter({db:mocks.db as any,now:()=>new Date('2026-09-28T12:00:00Z')});
async function request(path:string,method='GET',body?:unknown,role='OWNER'):Promise<{status:number;body:any}>{
  return new Promise((resolve,reject)=>{
    const req:any={method,url:path,originalUrl:path,headers:{'x-tenant':'tenant-1','x-user':'user-1','x-role':role},body,
      get(name:string){return this.headers[name.toLowerCase()]},query:Object.fromEntries(new URL(path,'http://test.invalid').searchParams)};
    let status=200;
    const res:any={set(){return this},status(value:number){status=value;return this},json(value:unknown){resolve({status,body:value});return this}};
    router(req,res,(error:unknown)=>reject(error??new Error('La ruta no respondió')));
  });
}
beforeEach(()=>{vi.clearAllMocks();mocks.requirePrincipal.mockResolvedValue({id:'user-1'});mocks.listChannels.mockResolvedValue([{id:'channel-1',displayPhone:'+505 2222',active:true,commerceEnabled:false,commercePolicyVersion:0,commercePolicy:null}]);mocks.db.$transaction.mockImplementation(async(fn:any)=>fn(mocks.db));mocks.db.$queryRaw.mockResolvedValue([{id:'ok'}]);mocks.db.waCommerceConversation.findFirst.mockResolvedValue({id:'conversation-1',tenantId:'tenant-1',channelId:'channel-1',waId:'50588889999',status:'HUMAN',version:2,assignedUserId:'user-1',optedOutAt:null,lastInboundAt:new Date('2026-09-28T11:00:00Z')});mocks.db.waCommerceOutbox.findUnique.mockResolvedValue(null);mocks.db.whatsAppChannel.findFirst.mockResolvedValue({commercePolicyVersion:1});mocks.db.waCommerceOutbox.create.mockResolvedValue({id:'out-1',status:'PENDING'});});

describe('rutas de atención comercial',()=>{
  it('lista canales sin credenciales del proveedor',async()=>{const result=await request('/channels');expect(result.status).toBe(200);expect(JSON.stringify(result.body)).not.toContain('accessToken');expect(result.body.items[0].id).toBe('channel-1');});
  it('restringe la configuración a OWNER/ADMIN',async()=>{const result=await request('/channels/channel-1/policy','PUT',{expectedVersion:0,enabled:false,policy:{eligibleProductIds:[],autoQuote:false,ttlHours:24,maxTotal:'5000.00',maxLines:5,eligibilityAttested:false}},'MANAGER');expect(result.status).toBe(403);expect(mocks.updatePolicy).not.toHaveBeenCalled();});
  it('no encola cuando el comprador pidió salir',async()=>{mocks.db.waCommerceConversation.findFirst.mockResolvedValue({...await mocks.db.waCommerceConversation.findFirst(),optedOutAt:new Date('2026-09-28T11:30:00Z')});const result=await request('/conversations/conversation-1/reply','POST',{version:2,body:'Hola',idempotencyKey:'5fa2e844-8f8c-4a5e-81e8-24906b95fadd'});expect(result.status).toBe(409);expect(mocks.db.waCommerceOutbox.create).not.toHaveBeenCalled();});
  it('un replay exige mismo actor y mismo texto; una respuesta válida queda pendiente',async()=>{
    const body={version:2,body:'Hola',idempotencyKey:'5fa2e844-8f8c-4a5e-81e8-24906b95fadd'};
    const first=await request('/conversations/conversation-1/reply','POST',body);expect(first.status).toBe(201);expect(first.body.status).toBe('PENDING');
    mocks.db.waCommerceOutbox.findUnique.mockResolvedValue({id:'out-1',tenantId:'tenant-1',conversationId:'conversation-1',body:'Hola',actorUserId:'user-1',status:'UNKNOWN'});
    const replay=await request('/conversations/conversation-1/reply','POST',body);expect(replay.status).toBe(200);expect(replay.body.status).toBe('UNKNOWN');
    const conflict=await request('/conversations/conversation-1/reply','POST',{...body,body:'Otro texto'});expect(conflict.status).toBe(409);expect(mocks.db.waCommerceOutbox.create).toHaveBeenCalledTimes(1);
  });
});


describe('entrada comercial asistida por HTTP',()=>{
  it('obtiene negocio y solicitante de la sesión, sin pedir identificadores al dueño',async()=>{
    mocks.requestActivation.mockResolvedValue({request:{id:'request-1',phone:'50588889999',status:'REQUESTED'},replayed:false});
    const result=await request('/activation-request','POST',{phone:'8888 9999'});
    expect(result.status).toBe(201);
    expect(mocks.requestActivation).toHaveBeenCalledWith({tenantId:'tenant-1',userId:'user-1',role:'OWNER'},{phone:'8888 9999'},mocks.db,new Date('2026-09-28T12:00:00Z'));
    expect(result.body.request.status).toBe('REQUESTED');
  });
  it('rechaza autoridad y credenciales del proveedor enviadas en el formulario',async()=>{
    for(const extra of [{tenantId:'other'},{accessToken:'not-a-real-token'},{wabaId:'other'},{status:'CONNECTED'}]){
      const result=await request('/activation-request','POST',{phone:'88889999',...extra});
      expect(result.status).toBe(400);
    }
    expect(mocks.requestActivation).not.toHaveBeenCalled();
  });
  it('la recarga recupera una solicitud, y el replay devuelve 200 sin simular conexión',async()=>{
    const saved={id:'request-1',phone:'50588889999',status:'REQUESTED'};
    mocks.getActivation.mockResolvedValue(saved);
    expect((await request('/activation-request')).body).toEqual({request:saved});
    mocks.requestActivation.mockResolvedValue({request:saved,replayed:true});
    expect((await request('/activation-request','POST',{phone:'88889999'})).status).toBe(200);
  });
  it('operación usa principal JWT; rechazo DB no aparenta cero',async()=>{
    mocks.operations.mockResolvedValue({worker:{state:'STALE'},inbox:{counts:{PENDING:2}}});
    expect((await request('/operations')).body.worker.state).toBe('STALE');
    expect(mocks.operations).toHaveBeenCalledWith({tenantId:'tenant-1',userId:'user-1',role:'OWNER'},mocks.db,new Date('2026-09-28T12:00:00Z'));
    mocks.operations.mockRejectedValue(new Error('QA unavailable'));expect((await request('/operations')).status).toBe(503);
  });
  it('soporte deriva actor de sesión y no acepta tenant o asignación enviados',async()=>{
    mocks.supportTransition.mockResolvedValue({id:'request-1',status:'IN_PROGRESS',version:2});
    const result=await request('/support/activation-requests/request-1/transition','POST',{version:1,status:'IN_PROGRESS'},'SUPER_ADMIN');
    expect(result.body.request.status).toBe('IN_PROGRESS');
    expect(mocks.supportTransition).toHaveBeenCalledWith({tenantId:'tenant-1',userId:'user-1',role:'SUPER_ADMIN'},'request-1',{version:1,status:'IN_PROGRESS'},mocks.db);
    mocks.supportTransition.mockClear();
    for(const extra of [{tenantId:'other'},{assignedTo:'other'},{accessToken:'synthetic'}])expect((await request('/support/activation-requests/request-1/transition','POST',{version:1,status:'IN_PROGRESS',...extra},'SUPER_ADMIN')).status).toBe(400);
    expect(mocks.supportTransition).not.toHaveBeenCalled();
  });

});
