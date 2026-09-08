import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { mkdtemp,readFile,rm,stat,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PDFDocument } from 'pdf-lib';
vi.mock('../backend/services/assistant/access.js',()=>({assertAssistantAccess:vi.fn().mockResolvedValue(undefined)}));
import { assertAssistantAccess } from '../backend/services/assistant/access.js';
import { saveAssistantAttachment,getAssistantAttachment,readAssistantAttachment,cleanupExpiredAttachments,cleanupAssistantHistory,validateAttachmentEnvelope,MAX_ATTACHMENT_BYTES } from '../backend/services/assistant/attachments.js';
const principal={tenantId:'tenant-a',userId:'user-a',role:'OWNER'};
let root:string,bytes:Buffer,row:any;
beforeEach(async()=>{
  vi.mocked(assertAssistantAccess).mockReset().mockResolvedValue(undefined);
  root=await mkdtemp(join(tmpdir(),'assistant-files-test-'));const doc=await PDFDocument.create();doc.addPage();bytes=Buffer.from(await doc.save());row=null;
});
afterEach(async()=>{await rm(root,{recursive:true,force:true});});
function fixture(){
  const db={assistantAttachment:{create:vi.fn(async({data}:any)=>(row={...data,id:'attachment',purchaseId:null})),findFirst:vi.fn(async({where}:any)=>row?.tenantId===where.tenantId&&row?.userId===where.userId&&row?.roleAtCreation===where.roleAtCreation?row:null),findMany:vi.fn(async()=>row?[row]:[]),updateMany:vi.fn(async({data}:any)=>{Object.assign(row,data);return{count:1};})}};
  return{db,deps:{db:db as any,storageRoot:root,now:()=>new Date('2026-09-05T12:00:00Z')}};
}
describe('original privado de factura',()=>{
  it('guarda bytes privados, nombre saneado e IDs opacos; no publica path',async()=>{
    const {deps}=fixture();const dto=await saveAssistantAttachment(principal,bytes,'application/pdf','../../Factura\nsecreta.pdf',deps);
    expect(dto).not.toHaveProperty('storageKey');expect(row.storageKey).toMatch(/^[a-f0-9-]{36}$/);expect(row.name).not.toMatch(/[\/\n]/);
    expect((await stat(join(root,row.storageKey))).mode&0o777).toBe(0o600);
    expect((await readAssistantAttachment(principal,dto.id,deps)).bytes).toEqual(bytes);
    expect(row.expiresAt).toEqual(new Date('2026-09-12T12:00:00Z'));
  });
  it('rechaza lectura de otro negocio, usuario o rol',async()=>{
    const {deps}=fixture();await saveAssistantAttachment(principal,bytes,'application/pdf','f.pdf',deps);
    for(const actor of [{...principal,tenantId:'b'},{...principal,userId:'b'},{...principal,role:'MANAGER'}]) await expect(readAssistantAttachment(actor,'attachment',deps)).rejects.toMatchObject({code:'ATTACHMENT_NOT_FOUND'});
  });
  it('recupera metadata privada sin publicar original ni rutas y rechaza datos vencidos',async()=>{
    const {deps}=fixture();await saveAssistantAttachment(principal,bytes,'application/pdf','f.pdf',deps);
    const dto=await getAssistantAttachment(principal,'attachment',deps);expect(dto).toEqual({id:'attachment',name:'f.pdf',mediaType:'application/pdf',bytes:bytes.length,pages:0,status:'UPLOADED'});
    for(const actor of [{...principal,tenantId:'b'},{...principal,userId:'b'},{...principal,role:'MANAGER'}]) await expect(getAssistantAttachment(actor,'attachment',deps)).rejects.toMatchObject({code:'ATTACHMENT_NOT_FOUND'});
    row.status='DELETING';await expect(getAssistantAttachment(principal,'attachment',deps)).rejects.toMatchObject({code:'ATTACHMENT_NOT_FOUND'});
    row.status='UPLOADED';row.expiresAt=new Date('2026-08-01');await expect(getAssistantAttachment(principal,'attachment',deps)).rejects.toMatchObject({code:'ATTACHMENT_NOT_FOUND'});
    row.purchaseId='purchase';row.status='ATTACHED';expect((await getAssistantAttachment(principal,'attachment',deps)).status).toBe('ATTACHED');
  });
  it('revalida permisos al subir y leer, incluida revocación',async()=>{
    const {deps,db}=fixture();vi.mocked(assertAssistantAccess).mockRejectedValueOnce(new Error('revoked'));
    await expect(saveAssistantAttachment(principal,bytes,'application/pdf','f.pdf',deps)).rejects.toThrow('revoked');expect(db.assistantAttachment.create).not.toHaveBeenCalled();
    await saveAssistantAttachment(principal,bytes,'application/pdf','f.pdf',deps);
    vi.mocked(assertAssistantAccess).mockRejectedValueOnce(new Error('revoked'));await expect(readAssistantAttachment(principal,'attachment',deps)).rejects.toThrow('revoked');
  });
  it('detecta alteración y no resuelve rutas manipuladas',async()=>{
    const {deps}=fixture();await saveAssistantAttachment(principal,bytes,'application/pdf','f.pdf',deps);const modified=Buffer.from(bytes);modified[20]^=1;await writeFile(join(root,row.storageKey),modified);
    await expect(readAssistantAttachment(principal,'attachment',deps)).rejects.toMatchObject({code:'FILE_INTEGRITY'});
    row.storageKey='../../secrets';await expect(readAssistantAttachment(principal,'attachment',deps)).rejects.toMatchObject({code:'STORAGE_UNAVAILABLE'});
  });
  it('rechaza archivo público, vacío, tamaño excesivo y MIME falso',async()=>{
    const {deps}=fixture();await expect(saveAssistantAttachment(principal,bytes,'application/pdf','f.pdf',{...deps,storageRoot:join(process.cwd(),'public')})).rejects.toMatchObject({code:'STORAGE_UNAVAILABLE'});
    expect(()=>validateAttachmentEnvelope(Buffer.alloc(0),'application/pdf')).toThrow();expect(()=>validateAttachmentEnvelope(Buffer.alloc(MAX_ATTACHMENT_BYTES+1),'image/png')).toThrow();expect(()=>validateAttachmentEnvelope(bytes,'image/png')).toThrow();
  });
  it('limpia efímeros vencidos y reintenta eliminación, preservando evidencia confirmada',async()=>{
    const {deps,db}=fixture();await saveAssistantAttachment(principal,bytes,'application/pdf','f.pdf',deps);row.expiresAt=new Date('2026-09-01');
    expect(await cleanupExpiredAttachments(deps)).toBe(1);expect(row.status).toBe('DELETED');await expect(readFile(join(root,row.storageKey))).rejects.toMatchObject({code:'ENOENT'});
    expect(db.assistantAttachment.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({purchaseId:null,expiresAt:{lte:deps.now()}})}));
    await saveAssistantAttachment(principal,bytes,'application/pdf','f.pdf',deps);db.assistantAttachment.updateMany.mockResolvedValueOnce({count:0});
    expect(await cleanupExpiredAttachments(deps)).toBe(0);expect(await readFile(join(root,row.storageKey))).toEqual(bytes);
  });
  it('retención de historial usa lotes y filtros tenant sin borrar trabajos pendientes',async()=>{
    const conversationFind=vi.fn().mockResolvedValue([{id:'c',tenantId:'t'}]),conversationDelete=vi.fn().mockResolvedValue({count:1});
    const jobFind=vi.fn().mockResolvedValue([{id:'j',tenantId:'t'}]),jobDelete=vi.fn().mockResolvedValue({count:1});
    const now=new Date('2026-09-05T12:00:00Z');
    expect(await cleanupAssistantHistory({db:{assistantConversation:{findMany:conversationFind,deleteMany:conversationDelete},assistantJob:{findMany:jobFind,deleteMany:jobDelete},assistantProposal:{findMany:vi.fn().mockResolvedValue([]),deleteMany:vi.fn()}} as any,now:()=>now})).toEqual({conversations:1,jobs:1,proposals:0});
    expect(conversationFind).toHaveBeenCalledWith(expect.objectContaining({take:100}));expect(jobFind).toHaveBeenCalledWith(expect.objectContaining({take:100}));
    expect(conversationDelete).toHaveBeenCalledWith({where:{id:'c',tenantId:'t',expiresAt:{lte:now}}});
    expect(jobDelete).toHaveBeenCalledWith({where:{id:'j',tenantId:'t',status:{in:['SUCCEEDED','FAILED']},updatedAt:{lte:new Date('2026-08-29T12:00:00Z')}}});
  });
});

describe('retención de propuestas y texto de captura',()=>{
  const now=new Date('2026-09-20T12:00:00Z');
  const expired=new Date('2026-09-19T12:00:00Z');
  const future=new Date('2026-09-21T12:00:00Z');
  type Proposal={id:string;tenantId:string;status:string;expiresAt:Date};
  function setupHistory(initial:Proposal[],afterRead?:(rows:Map<string,Proposal>)=>void) {
    const rows=new Map(initial.map(row=>[row.id,{...row}]));
    const findMany=vi.fn(async({where,take}:any)=>{
      const candidates=[...rows.values()].filter(row=>where.status.in.includes(row.status)&&row.expiresAt<=where.expiresAt.lte).sort((a,b)=>a.expiresAt.getTime()-b.expiresAt.getTime()).slice(0,take).map(({id,tenantId,status})=>({id,tenantId,status}));
      afterRead?.(rows);
      return candidates;
    });
    const deleteMany=vi.fn(async({where}:any)=>{
      const row=rows.get(where.id);
      if(!row||row.tenantId!==where.tenantId||row.status!==where.status||row.expiresAt>where.expiresAt.lte)return{count:0};
      rows.delete(row.id);return{count:1};
    });
    const db={assistantConversation:{findMany:vi.fn().mockResolvedValue([])},assistantJob:{findMany:vi.fn().mockResolvedValue([])},assistantProposal:{findMany,deleteMany}};
    return{rows,findMany,deleteMany,deps:{db:db as any,now:()=>now}};
  }
  it('borra sólo estados no confirmados vencidos y conserva COMMITTED aunque haya vencido',async()=>{
    const s=setupHistory([
      ...['DRAFT','READY','CANCELLED','EXPIRED'].map(status=>({id:status,tenantId:'t',status,expiresAt:expired})),
      {id:'committed',tenantId:'t',status:'COMMITTED',expiresAt:expired},
      {id:'active',tenantId:'t',status:'DRAFT',expiresAt:future},
    ]);
    expect(await cleanupAssistantHistory(s.deps)).toEqual({conversations:0,jobs:0,proposals:4});
    expect([...s.rows.keys()]).toEqual(['committed','active']);
    expect(s.deleteMany.mock.calls.every(([call])=>call.where.status!=='COMMITTED')).toBe(true);
    expect(s.findMany).toHaveBeenCalledWith({where:{expiresAt:{lte:now},status:{in:['DRAFT','READY','CANCELLED','EXPIRED']}},orderBy:{expiresAt:'asc'},select:{id:true,tenantId:true,status:true},take:100});
  });
  it('una confirmación, renovación o cambio de tenant entre selección y borrado conserva la fila',async()=>{
    const s=setupHistory(['commit','renew','tenant'].map(id=>({id,tenantId:'t',status:'READY',expiresAt:expired})),rows=>{
      rows.get('commit')!.status='COMMITTED';rows.get('renew')!.expiresAt=future;rows.get('tenant')!.tenantId='other';
    });
    expect(await cleanupAssistantHistory(s.deps)).toEqual({conversations:0,jobs:0,proposals:0});
    expect(s.rows.size).toBe(3);expect(s.rows.get('commit')!.status).toBe('COMMITTED');
    expect(s.deleteMany).toHaveBeenCalledWith({where:{id:'commit',tenantId:'t',status:'READY',expiresAt:{lte:now}}});
  });
  it('limita cada pasada a 100 propuestas y no repite el texto indefinidamente',async()=>{
    const s=setupHistory(Array.from({length:101},(_,i)=>({id:`draft-${i}`,tenantId:'t',status:'DRAFT',expiresAt:expired})));
    expect((await cleanupAssistantHistory(s.deps)).proposals).toBe(100);expect(s.rows.size).toBe(1);
    expect((await cleanupAssistantHistory(s.deps)).proposals).toBe(1);expect(s.rows.size).toBe(0);
  });
});
