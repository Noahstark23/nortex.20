import { beforeEach,describe,expect,it,vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
vi.mock('../backend/services/assistant/access.js',async importOriginal=>({...await importOriginal<any>(),assertAssistantAccess:vi.fn().mockResolvedValue(undefined)}));
vi.mock('../backend/services/assistant/attachments.js',async importOriginal=>({...await importOriginal<any>(),readAssistantAttachment:vi.fn()}));
import { assertAssistantAccess } from '../backend/services/assistant/access.js';
import { AssistantDocumentError,readAssistantAttachment } from '../backend/services/assistant/attachments.js';
import { enqueueInvoiceExtraction,getInvoiceExtraction,runAssistantWorkerOnce } from '../backend/services/assistant/worker.js';
import { createPurchaseDocumentContext } from '../backend/services/assistant/purchaseDocumentContext.js';
const now=new Date('2026-09-05T12:00:00Z');
const principal={tenantId:'t',userId:'u',role:'OWNER'};
const draft={currency:'NIO',invoiceNumber:'1',date:'2026-09-05',receivedConfirmed:false,paymentConfirmed:false,documentTotal:'1',items:[{description:'P',quantity:'1',unitCost:'1',purchaseUnit:'BASE' as const}],warnings:[]};
beforeEach(async()=>{
  vi.mocked(assertAssistantAccess).mockReset().mockResolvedValue(undefined);
  const doc=await PDFDocument.create();doc.addPage();
  vi.mocked(readAssistantAttachment).mockReset().mockResolvedValue({bytes:Buffer.from(await doc.save()),row:{mediaType:'application/pdf'}} as any);
});
function setup(overrides:Record<string,unknown>={}) {
  let job:any={id:'job',tenantId:'t',userId:'u',roleAtCreation:'OWNER',attachmentIds:['a'],attempts:0,status:'PENDING',availableAt:now,leaseToken:null,leaseUntil:null,...overrides};
  const calls:any[]=[];
  const assistantJob={
    findFirst:vi.fn(async({where}:any)=>{
      if(where.id) return where.id===job?.id&&where.tenantId===job.tenantId&&where.userId===job.userId&&where.roleAtCreation===job.roleAtCreation?{...job}:null;
      return job&&((job.status==='PENDING'&&job.availableAt<=now)||(job.status==='PROCESSING'&&job.leaseUntil<=now))?{...job}:null;
    }),
    updateMany:vi.fn(async({where,data}:any)=>{
      calls.push({where,data});
      if(where.leaseToken&&where.leaseToken!==job.leaseToken)return{count:0};
      if(where.leaseUntil?.gt&&job.leaseUntil<=where.leaseUntil.gt)return{count:0};
      if(where.status&&where.status!==job.status)return{count:0};
      const {attempts,...rest}=data;Object.assign(job,rest);if(attempts)job.attempts+=attempts.increment;
      return{count:1};
    }),
    create:vi.fn(async({data}:any)=>({id:'job-new',status:'PENDING',...data})),
  };
  const tx={assistantJob,assistantAttachment:{updateMany:vi.fn().mockResolvedValue({count:1}),findMany:vi.fn().mockResolvedValue([{id:'a',bytes:100,pages:1}])}};
  const db={...tx,$transaction:vi.fn(async(fn:any)=>{const before={...job};try{return await fn(tx);}catch(e){job=before;throw e;}})};
  const provider={extract:vi.fn().mockResolvedValue(draft)};
  const createProposal=vi.fn().mockResolvedValue({id:'job'});
  return{db,provider,createProposal,calls,job:()=>job,setJob:(value:any)=>Object.assign(job,value),deps:{db:db as any,provider,createProposal:createProposal as any,now:()=>now}};
}
describe('worker durable de lectura sin efectos financieros',()=>{
  it('una entrega repetida produce una sola propuesta y confirma job en la transacción',async()=>{
    const s=setup();expect(await runAssistantWorkerOnce(s.deps)).toBe(true);expect(s.job().status).toBe('SUCCEEDED');
    expect(s.createProposal).toHaveBeenCalledWith(principal,draft,['a'],expect.objectContaining({id:'job',db:expect.anything()}));
    expect(s.db.$transaction).toHaveBeenCalledTimes(1);expect(await runAssistantWorkerOnce(s.deps)).toBe(false);expect(s.provider.extract).toHaveBeenCalledTimes(1);
  });
  it('recupera lease vencido con una identidad nueva y revalida actor',async()=>{
    const s=setup({status:'PROCESSING',attempts:1,leaseToken:'old',leaseUntil:new Date(now.getTime()-1)});await runAssistantWorkerOnce(s.deps);
    expect(s.job().status).toBe('SUCCEEDED');expect(s.job().attempts).toBe(2);expect(s.calls[0].data.leaseToken).not.toBe('old');expect(assertAssistantAccess).toHaveBeenCalledWith(principal,'invoicePrepare',expect.anything());
  });
  it('no procesa un job ya reclamado por otro worker',async()=>{
    const s=setup();s.db.assistantJob.updateMany.mockResolvedValueOnce({count:0});expect(await runAssistantWorkerOnce(s.deps)).toBe(false);expect(s.provider.extract).not.toHaveBeenCalled();
  });
  it('el permiso revocado bloquea lectura antes del proveedor y queda fallido',async()=>{
    const s=setup();vi.mocked(assertAssistantAccess).mockRejectedValueOnce(Object.assign(new Error('revoked'),{code:'SESSION_REVOKED'}));
    await runAssistantWorkerOnce(s.deps);expect(s.job().status).toBe('FAILED');expect(s.job().errorCode).toBe('SESSION_REVOKED');expect(readAssistantAttachment).not.toHaveBeenCalled();expect(s.provider.extract).not.toHaveBeenCalled();
  });
  it('permiso revocado durante el proveedor impide crear propuesta',async()=>{
    const s=setup();s.provider.extract.mockImplementation(async()=>{vi.mocked(assertAssistantAccess).mockRejectedValueOnce(Object.assign(new Error('revoked'),{code:'SESSION_REVOKED'}));return draft;});
    await runAssistantWorkerOnce(s.deps);expect(s.job().status).toBe('FAILED');expect(s.createProposal).not.toHaveBeenCalled();
  });
  it('el intento viejo que perdió lease no crea propuesta ni sobrescribe al nuevo',async()=>{
    const s=setup();s.provider.extract.mockImplementation(async()=>{s.setJob({leaseToken:'new-owner'});return draft;});
    await runAssistantWorkerOnce(s.deps);expect(s.createProposal).not.toHaveBeenCalled();expect(s.job().leaseToken).toBe('new-owner');expect(s.job().status).toBe('PROCESSING');
  });
  it('proveedor caído reintenta con demora y máximo dos intentos',async()=>{
    const s=setup();s.provider.extract.mockRejectedValue(new AssistantDocumentError('PROVIDER_UNAVAILABLE','Caído',503));
    await runAssistantWorkerOnce(s.deps);expect(s.job()).toMatchObject({status:'PENDING',attempts:1,availableAt:new Date(now.getTime()+30000)});
    s.setJob({availableAt:now});await runAssistantWorkerOnce(s.deps);expect(s.job()).toMatchObject({status:'FAILED',attempts:2});
  });
  it('presupuesto agotado y documento corrupto no se reintentan',async()=>{
    const s=setup();s.provider.extract.mockRejectedValue(new AssistantDocumentError('BUDGET_EXHAUSTED','Agotado',429));await runAssistantWorkerOnce(s.deps);expect(s.job().status).toBe('FAILED');
    const corrupt=setup();vi.mocked(readAssistantAttachment).mockResolvedValue({bytes:Buffer.from('%PDF-bad'),row:{mediaType:'application/pdf'}} as any);await runAssistantWorkerOnce(corrupt.deps);expect(corrupt.job().status).toBe('FAILED');expect(corrupt.provider.extract).not.toHaveBeenCalled();
  });
  it('no consulta el job de otro actor y valida los adjuntos antes de encolar',async()=>{
    const s=setup();await expect(getInvoiceExtraction({...principal,userId:'other'},'job',s.deps)).rejects.toMatchObject({code:'JOB_NOT_FOUND'});
    await expect(enqueueInvoiceExtraction(principal,['a','a'],s.deps)).rejects.toMatchObject({code:'DOCUMENT_IDS'});
    await expect(enqueueInvoiceExtraction(principal,['a','b'],s.deps)).rejects.toMatchObject({code:'ATTACHMENT_NOT_FOUND'});
    expect((await enqueueInvoiceExtraction(principal,['a'],s.deps)).status).toBe('PENDING');
    expect(s.db.assistantAttachment.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({tenantId:'t',userId:'u',roleAtCreation:'OWNER'})}));
  });
  it('archivos idénticos con IDs distintos se bloquean antes de consumir IA',async()=>{
    const s=setup({attachmentIds:['a','b']});
    s.db.assistantAttachment.findMany.mockResolvedValue([{id:'a',bytes:100,pages:1,sha256:'same'},{id:'b',bytes:100,pages:1,sha256:'same'}] as any);
    await expect(enqueueInvoiceExtraction(principal,['a','b'],s.deps)).rejects.toMatchObject({code:'DUPLICATE_PAGE'});
    await runAssistantWorkerOnce(s.deps);expect(s.job()).toMatchObject({status:'FAILED',errorCode:'DUPLICATE_PAGE'});expect(s.provider.extract).not.toHaveBeenCalled();
  });

  it('encola una foto con snapshot leído de la conversación privada y rechaza conversaciones ajenas',async()=>{
    const s=setup();
    const row={id:'conversation',tenantId:'t',userId:'u',roleAtCreation:'OWNER',expiresAt:new Date('2099-01-01'),stateVersion:2,
      metadata:{schemaVersion:1,purchaseIntake:{id:'10000000-0000-4000-8000-000000000001',phase:'CHOOSE_INPUT',mode:'ATTACHMENT',
        facts:{items:[{description:'P',quantity:'50',unitText:'bolsas'}]},evidence:[]}}};
    const conversationFind=vi.fn(async({where}:any)=>where.id===row.id&&where.tenantId===row.tenantId&&where.userId===row.userId&&where.roleAtCreation===row.roleAtCreation?row:null);
    const deps={...s.deps,db:{...s.db,assistantConversation:{findFirst:conversationFind}} as any};
    await enqueueInvoiceExtraction(principal,['a'],deps,'conversation');
    expect(s.db.assistantJob.create).toHaveBeenLastCalledWith({data:expect.objectContaining({intakeContext:expect.objectContaining({version:1,conversationId:'conversation',stateVersion:2,draft:expect.objectContaining({items:[expect.objectContaining({quantity:'50'})]})})})});
    for(const actor of [{...principal,tenantId:'other'},{...principal,userId:'other'},{...principal,role:'MANAGER'}]) {
      await expect(enqueueInvoiceExtraction(actor,['a'],deps,'conversation')).rejects.toMatchObject({code:'ASSISTANT_CONVERSATION_NOT_FOUND'});
    }
    expect(s.db.assistantJob.create).toHaveBeenCalledTimes(1);
    expect(conversationFind).toHaveBeenCalledWith({where:expect.objectContaining({id:'conversation',tenantId:'t',userId:'u',roleAtCreation:'OWNER',expiresAt:expect.anything()})});
    Object.assign(row.metadata.purchaseIntake,{phase:'REVIEW',proposalId:'prior-proposal'});
    await enqueueInvoiceExtraction(principal,['a'],deps,'conversation');
    expect(s.db.assistantJob.create).toHaveBeenLastCalledWith({data:expect.not.objectContaining({intakeContext:expect.anything()})});
  });

  it('contrasta los 50 declarados con 40 de la factura sin entregar al proveedor el contexto privado',async()=>{
    const intake={intakeId:'intake',stateVersion:3,draft:{...draft,paymentMethod:'CASH' as const,items:[{...draft.items[0],quantity:'50'}]},evidence:['compré 50 bolsas']};
    const snapshot=createPurchaseDocumentContext('conversation',intake);
    const s=setup({intakeContext:snapshot});
    s.provider.extract.mockResolvedValue({...draft,items:[{...draft.items[0],quantity:'40'}]});
    const readIntake=vi.fn().mockResolvedValue(intake),attachDocumentProposal=vi.fn().mockResolvedValue(undefined);
    await runAssistantWorkerOnce({...s.deps,readIntake,attachDocumentProposal});
    expect(s.job().status).toBe('SUCCEEDED');
    expect(s.provider.extract.mock.calls[0]).toHaveLength(2);
    expect(s.createProposal).toHaveBeenCalledWith(principal,expect.objectContaining({receivedConfirmed:false,paymentConfirmed:false,items:[expect.objectContaining({quantity:'40'})],warnings:expect.arrayContaining([expect.stringContaining('conversación «50»; documento «40»')])}),['a'],expect.objectContaining({id:'job',declaredPaymentMethod:'CASH'}));
    expect(attachDocumentProposal).toHaveBeenCalledWith(principal,'conversation','intake','job',expect.anything(),3);
    expect(s.job().intakeContext.draft.items[0].quantity).toBe('50');
  });

  it('la misma captura editada antes de llamar al proveedor cancela el trabajo sin gasto',async()=>{
    const intake={intakeId:'intake',stateVersion:1,draft,evidence:[]};
    const s=setup({intakeContext:createPurchaseDocumentContext('conversation',intake)});
    const readIntake=vi.fn().mockResolvedValue({...intake,stateVersion:2,draft:{...draft,items:[{...draft.items[0],quantity:'60'}]}});
    await runAssistantWorkerOnce({...s.deps,readIntake});
    expect(s.job()).toMatchObject({status:'FAILED',errorCode:'DOCUMENT_CONTEXT_CHANGED'});expect(s.provider.extract).not.toHaveBeenCalled();
  });

  it('si la conversación cambia durante lectura no crea ni vincula una propuesta obsoleta',async()=>{
    const intake={intakeId:'intake',stateVersion:1,draft,evidence:[]};
    const s=setup({intakeContext:createPurchaseDocumentContext('conversation',intake)});
    const readIntake=vi.fn().mockResolvedValueOnce(intake).mockResolvedValueOnce({...intake,stateVersion:2,draft:{...draft,documentTotal:'99'}});
    const attachDocumentProposal=vi.fn();
    await runAssistantWorkerOnce({...s.deps,readIntake,attachDocumentProposal});
    expect(s.job()).toMatchObject({status:'FAILED',errorCode:'DOCUMENT_CONTEXT_CHANGED'});expect(s.createProposal).not.toHaveBeenCalled();expect(attachDocumentProposal).not.toHaveBeenCalled();
  });

  it('el vínculo al chat usa la versión comparada y un conflicto revierte el éxito del job',async()=>{
    const intake={intakeId:'intake',stateVersion:8,draft,evidence:[]};
    const s=setup({intakeContext:createPurchaseDocumentContext('conversation',intake)});
    const readIntake=vi.fn().mockResolvedValue(intake),attachDocumentProposal=vi.fn().mockRejectedValue(new AssistantDocumentError('INTAKE_CHANGED','La captura cambió.',409));
    await runAssistantWorkerOnce({...s.deps,readIntake,attachDocumentProposal});
    expect(attachDocumentProposal).toHaveBeenCalledWith(principal,'conversation','intake','job',expect.anything(),8);
    expect(s.job()).toMatchObject({status:'FAILED',errorCode:'INTAKE_CHANGED'});expect(s.job().proposalId).toBeUndefined();
  });

  it('conversación sin captura mantiene el flujo documental anterior',async()=>{
    const s=setup(),readIntake=vi.fn().mockResolvedValue(null);
    await enqueueInvoiceExtraction(principal,['a'],{...s.deps,readIntake},'conversation');
    expect(s.db.assistantJob.create).toHaveBeenCalledWith({data:expect.not.objectContaining({intakeContext:expect.anything()})});
    await runAssistantWorkerOnce({...s.deps,readIntake});expect(s.job().status).toBe('SUCCEEDED');
    expect(readIntake).toHaveBeenCalledTimes(1);
  });

  it('una captura ya cerrada después de encolar no se hereda al procesar otra factura',async()=>{
    const intake={intakeId:'intake',stateVersion:1,draft,evidence:[]};
    const s=setup({intakeContext:createPurchaseDocumentContext('conversation',intake)});
    await runAssistantWorkerOnce({...s.deps,readIntake:vi.fn().mockResolvedValue(null)});
    expect(s.job()).toMatchObject({status:'FAILED',errorCode:'DOCUMENT_CONTEXT_CHANGED'});
    expect(s.provider.extract).not.toHaveBeenCalled();expect(s.createProposal).not.toHaveBeenCalled();
  });
});
