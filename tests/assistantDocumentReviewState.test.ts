import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { Prisma,type PrismaClient } from '@prisma/client';
import type { InvoiceDraft } from '../shared/assistant';
import { createProposalFromExtraction,getProposal,reviseProposal } from '../backend/services/assistant/proposals';
import { createPurchaseDocumentContext } from '../backend/services/assistant/purchaseDocumentContext';

const domain=vi.hoisted(()=>({preview:vi.fn(),register:vi.fn()}));
vi.mock('../backend/lib/prisma.js',()=>({default:{}}));
vi.mock('../backend/services/purchaseRegistrationService.js',()=>({preparePurchasePreview:domain.preview,registerPurchase:domain.register}));
const actor={tenantId:'tenant-a',userId:'user-a',role:'OWNER'};
const document=():InvoiceDraft=>({currency:'NIO',supplierId:'supplier',invoiceNumber:'TEST-FACTURA',date:'2026-09-19',
  documentTotal:'',receivedConfirmed:false,paymentConfirmed:false,items:[{description:'Cemento',quantity:'40',unitCost:'',purchaseUnit:'BASE'}],warnings:[]});
const declared=()=>({...document(),items:[{...document().items[0],quantity:'50'}]});
const context=()=>createPurchaseDocumentContext('conversation',{intakeId:'intake',stateVersion:2,draft:declared(),evidence:['Compré 50 bolsas de cemento']});
const decision={conflictId:'value:items.0.quantity',choice:'DOCUMENT' as const,reason:'Comprobé 40 en la factura.'};

function fixture() {
  const state:{row:any;legacyContext:unknown;beforeUpdate?():void;user:any}={row:null,legacyContext:null,
    user:{id:actor.userId,tenantId:actor.tenantId,role:actor.role,status:'ACTIVE'}};
  const matches=(row:any,where:Record<string,any>)=>!!row&&Object.entries(where).every(([key,value])=>
    value&&typeof value==='object'&&'in'in value ? value.in.includes(row[key])
      :value&&typeof value==='object'&&'gt'in value ? row[key]>value.gt :row[key]===value);
  const db={
    user:{findFirst:vi.fn(async({where})=>matches(state.user,where)?state.user:null)},
    assistantTenantConfig:{findUnique:vi.fn(async()=>({enabled:true,extractionEnabled:true,executionEnabled:false}))},
    assistantAttachment:{count:vi.fn(async({where})=>where.tenantId===actor.tenantId&&where.userId===actor.userId&&where.roleAtCreation===actor.role?1:0)},
    assistantJob:{findFirst:vi.fn(async()=>({intakeContext:state.legacyContext}))},
    assistantProposal:{
      create:vi.fn(async({data})=>{state.row={version:1,preview:null,payloadHash:null,result:null,...structuredClone(data)};return structuredClone(state.row);}),
      findFirst:vi.fn(async({where})=>matches(state.row,where)?structuredClone(state.row):null),
      updateMany:vi.fn(async({where,data})=>{
        state.beforeUpdate?.();if(!matches(state.row,where))return{count:0};
        for(const [key,value]of Object.entries(data))state.row[key]=key==='version'?state.row.version+(value as {increment:number}).increment
          :value===Prisma.DbNull?null:structuredClone(value);
        return{count:1};
      }),
    },
  };
  const client=db as unknown as PrismaClient;
  const create=()=>createProposalFromExtraction(actor,document(),['attachment'],{db:client,id:'proposal',documentContext:context(),extractedDraft:document()});
  return{state,db,client,create};
}
beforeEach(()=>{
  vi.clearAllMocks();vi.stubEnv('NORTEX_ASSISTANT_ENABLED','true');vi.stubEnv('NORTEX_ASSISTANT_EXTRACTION_ENABLED','true');
  vi.stubEnv('NORTEX_ASSISTANT_EXECUTION_ENABLED','false');
  domain.preview.mockImplementation(()=>{throw new Error('No se permite calcular efectos en estas pruebas de estado.');});
  domain.register.mockImplementation(()=>{throw new Error('No se permite registrar compras.');});
  vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('No se permite red.');}));
});
afterEach(()=>{expect(domain.preview).not.toHaveBeenCalled();expect(domain.register).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();vi.unstubAllEnvs();});

describe('H01-2: persistencia auxiliar real con fronteras financieras bloqueadas',()=>{
  it('el worker crea DRAFT con fuentes originales y GET recupera 50/40',async()=>{
    const h=fixture(),created=await h.create();
    expect(created).toMatchObject({status:'DRAFT',version:1,preview:null,source:'DOCUMENT',draft:{items:[{quantity:'50'}]},
      documentReview:{hasUnresolved:true,declared:{items:[{quantity:'50'}]},document:{items:[{quantity:'40'}]}}});
    expect(h.state.row.source.context).toEqual(context());expect(h.state.row.source.document).toEqual(document());
    expect(await getProposal(actor,'proposal',h.client)).toEqual(created);
  });
  it('editar a40 y borrar warnings guarda pendiente sin calcular',async()=>{
    const h=fixture(),created=await h.create();
    const updated=await reviseProposal(actor,'proposal',1,{...created.draft,warnings:[],items:[{...created.draft.items[0],quantity:'40'}]},h.client);
    expect(updated).toMatchObject({status:'DRAFT',version:2,preview:null,documentReview:{hasUnresolved:true}});
    expect(h.state.row.payloadHash).toBeNull();expect(h.state.row.source.context).toEqual(context());
    expect(updated.issues.join(' ')).toContain('Resolvé explícitamente');
  });
  it('la decisión aplica fuente con CAS, limpia hash y requiere otra revisión',async()=>{
    const h=fixture(),created=await h.create();h.state.row.preview={total:'antiguo'};h.state.row.payloadHash='hash-antiguo';
    const updated=await reviseProposal(actor,'proposal',1,created.draft,h.client,[decision]);
    expect(updated).toMatchObject({status:'DRAFT',version:2,preview:null,draft:{items:[{quantity:'40'}]},documentReview:{hasUnresolved:false}});
    expect(h.state.row.payloadHash).toBeNull();expect(h.state.row.source.document).toEqual(document());expect(h.state.row.source.context).toEqual(context());
    expect(h.state.row.source.conflicts[0].resolution).toMatchObject({...decision,resolvedBy:actor.userId,proposalVersion:2});
    expect(h.db.assistantProposal.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({id:'proposal',...{tenantId:actor.tenantId,userId:actor.userId,roleAtCreation:actor.role},version:1})}));
  });
  it('otra corrección invalida la decisión y conserva ambas fuentes',async()=>{
    const h=fixture(),created=await h.create(),resolved=await reviseProposal(actor,'proposal',1,created.draft,h.client,[decision]);
    const next=await reviseProposal(actor,'proposal',2,{...resolved.draft,items:[{...resolved.draft.items[0],quantity:'45'}]},h.client);
    expect(next).toMatchObject({version:3,status:'DRAFT',preview:null,documentReview:{hasUnresolved:true}});
    expect(h.state.row.source.conflicts[0].resolution).toBeUndefined();expect(h.state.row.source.document).toEqual(document());
  });
  it('rechaza replay de versión vieja sin sustituir decisión ni fuentes',async()=>{
    const h=fixture(),created=await h.create();await reviseProposal(actor,'proposal',1,created.draft,h.client,[decision]);
    const before=structuredClone(h.state.row);
    await expect(reviseProposal(actor,'proposal',1,created.draft,h.client,[{...decision,choice:'DECLARED'}])).rejects.toMatchObject({code:'PROPOSAL_CHANGED'});
    expect(h.state.row).toEqual(before);
  });
  it('una revisión concurrente gana el CAS y no pierde sus hechos',async()=>{
    const h=fixture(),created=await h.create();h.state.beforeUpdate=()=>{h.state.row.version=2;h.state.row.draft.notes='Otra revisión';};
    await expect(reviseProposal(actor,'proposal',1,created.draft,h.client,[decision])).rejects.toMatchObject({code:'PROPOSAL_CHANGED'});
    expect(h.state.row).toMatchObject({version:2,draft:{notes:'Otra revisión'}});expect(h.state.row.source.conflicts[0].status).toBe('PENDING');
  });
  it.each([{tenantId:'tenant-b'},{userId:'user-b'},{role:'ADMIN'}])('otro alcance no recupera fuentes: %j',async patch=>{
    const h=fixture();await h.create();h.state.user={...h.state.user,...patch};
    await expect(getProposal({...actor,...patch},'proposal',h.client)).rejects.toBeDefined();
    expect(h.db.assistantProposal.updateMany).not.toHaveBeenCalled();
  });
  it('revocar acceso impide recuperar las fuentes guardadas',async()=>{
    const h=fixture();await h.create();h.state.user.status='INACTIVE';
    await expect(getProposal(actor,'proposal',h.client)).rejects.toBeDefined();
  });
  it('una propuesta legacy con contexto y sin original no puede eliminar su bloqueo',async()=>{
    const h=fixture(),created=await h.create();h.state.row.source=null;h.state.legacyContext=context();
    const restored=await getProposal(actor,'proposal',h.client);expect(restored.issues.join(' ')).toContain('propuesta antigua');expect(restored.preview).toBeNull();
    const saved=await reviseProposal(actor,'proposal',1,{...created.draft,warnings:[]},h.client);
    expect(saved).toMatchObject({status:'DRAFT',preview:null});expect(saved.issues.join(' ')).toContain('propuesta antigua');
    expect(h.db.assistantJob.findFirst).toHaveBeenCalledWith({where:{proposalId:'proposal',tenantId:actor.tenantId,userId:actor.userId,roleAtCreation:actor.role},select:{intakeContext:true}});
  });
  it('rechaza procedencia inyectada en draft y mantiene la fuente original',async()=>{
    const h=fixture(),created=await h.create(),before=structuredClone(h.state.row);
    await expect(reviseProposal(actor,'proposal',1,{...created.draft,source:{kind:'MANUAL'}},h.client)).rejects.toMatchObject({name:'ZodError'});
    expect(h.state.row).toEqual(before);
  });
});
