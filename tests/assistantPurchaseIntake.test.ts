import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { afterEach,beforeEach,describe, expect, it,vi } from 'vitest';
import { getAssistantIntent } from '../backend/services/assistant/conversations';
import { advancePurchaseIntake,readPurchaseIntakeForDocument,attachDocumentProposalToIntake,missingPurchaseFacts,applyIntakeDraftCorrection } from '../backend/services/assistant/purchaseIntake';
import { readPurchaseIntake } from '../backend/services/assistant/purchaseIntakeTypes';
import { acceptLanguageFacts } from '../backend/services/assistant/purchaseIntakeParsing';

const principal={tenantId:'tenant-a',userId:'user-a',role:'OWNER'};
const product={id:'product-a',name:'Cemento Holcim 42.5',sku:'CEM-01',unit:'bolsa',packUnit:'pallet',packSize:20,requiresBatchTracking:false};
function harness() {
  const mocks={
    user:{findFirst:vi.fn().mockResolvedValue({id:'user-a',role:'OWNER',status:'ACTIVE'})},
    assistantTenantConfig:{findUnique:vi.fn().mockResolvedValue({enabled:true})},
    product:{findMany:vi.fn().mockResolvedValue([product]),findFirst:vi.fn().mockResolvedValue(product)},
    supplier:{findMany:vi.fn().mockResolvedValue([{id:'supplier-a',name:'Cementos Alfa'}]),findFirst:vi.fn().mockResolvedValue({id:'supplier-a',name:'Cementos Alfa'})},
    warehouse:{findMany:vi.fn().mockResolvedValue([{id:'warehouse-a',name:'Principal'}]),findFirst:vi.fn().mockResolvedValue({id:'warehouse-a',name:'Principal'})},
    assistantConversation:{findFirst:vi.fn(),updateMany:vi.fn().mockResolvedValue({count:1})},
  };
  let metadata:unknown=null;
  const db=mocks as unknown as PrismaClient;
  const say=async(text:string)=>{const result=await advancePurchaseIntake({principal,text,requestId:randomUUID(),metadata},db);metadata=JSON.parse(JSON.stringify(result.metadata));return result;};
  return {db,mocks,say,metadata:()=>metadata};
}
beforeEach(()=>vi.stubEnv('NORTEX_ASSISTANT_ENABLED','true'));
afterEach(()=>vi.unstubAllEnvs());

async function complete(h:ReturnType<typeof harness>) {
  let result=await h.say('Nortex, compré 50 bolsas de cemento');
  for(const answer of ['Completar por aquí','1','1','C$ 230','Cementos Alfa','1','F-123','2026-09-05','13225','a crédito','2026-10-05','sí','1'])result=await h.say(answer);
  return result;
}

describe('captura conversacional de compras', () => {
  it('reconoce una compra narrada sin exigir la palabra registrar', () => {
    expect(getAssistantIntent('Nortex, compré 50 bolsas de cemento')).toBe('purchase_intake');
  });
  it('conserva cantidad/producto y ofrece foto/manual sin inferir costo, moneda o empaque',async()=>{
    const h=harness(),turn=await h.say('Nortex, compré 50 bolsas de cemento');
    expect(turn.state?.facts.items[0]).toEqual({description:'cemento',quantity:'50',unitText:'bolsas'});
    expect(turn.state?.facts).not.toHaveProperty('currency');
    expect(turn.content.actions?.map(action=>action.type)).toEqual(['UPLOAD_INVOICE','CONTINUE_PURCHASE']);
    expect(turn.content.purchaseIntake?.phase).toBe('CHOOSE_INPUT');
    expect(h.mocks.product.findMany).not.toHaveBeenCalled();
    expect(turn.draft).toBeUndefined();
  });
  it('recorrido completo recopila hechos y devuelve DRAFTpreparable sin registrar una compra',async()=>{
    const h=harness(),turn=await complete(h);
    expect(turn.state?.phase).toBe('REVIEW');
    expect(missingPurchaseFacts(turn.state!)).toEqual([]);
    expect(turn.draft).toMatchObject({supplierId:'supplier-a',invoiceNumber:'F-123',date:'2026-09-05',documentTotal:'13225',currency:'NIO',paymentMethod:'CREDIT',dueDate:'2026-10-05',receivedConfirmed:true,paymentConfirmed:false,warehouseId:'warehouse-a',warnings:[]});
    expect(turn.draft?.items[0]).toMatchObject({productId:'product-a',quantity:'50',unitCost:'230',purchaseUnit:'BASE'});
    expect(turn.state?.evidence.every(e=>e.requestId&&e.field&&e.suppliedText)).toBe(true);
    expect(Object.keys(h.mocks)).not.toContain('purchase');
    for(const mock of [h.mocks.product.findMany,h.mocks.product.findFirst,h.mocks.supplier.findMany,h.mocks.supplier.findFirst,h.mocks.warehouse.findMany,h.mocks.warehouse.findFirst]) {
      expect(mock).toHaveBeenCalled();for(const [args] of mock.mock.calls)expect(args.where.tenantId).toBe('tenant-a');
    }
    for(const mock of [h.mocks.product.findMany,h.mocks.supplier.findMany,h.mocks.warehouse.findMany])expect(mock.mock.calls[0][0].take).toBeLessThanOrEqual(6);
  });
  it('no interpreta bolsas como paquete y pregunta presentación aun con un único producto',async()=>{
    const h=harness();await h.say('compré 50 bolsas de cemento');await h.say('Completar por aquí');
    const productTurn=await h.say('1');
    expect(productTurn.state?.facts.items[0].purchaseUnit).toBeUndefined();
    expect(productTurn.content.text).toContain('Unidad del catálogo');
    expect(productTurn.content.text).not.toContain('BASE');
    const unitTurn=await h.say('2');expect(unitTurn.state?.facts.items[0]).toMatchObject({quantity:'50',purchaseUnit:'PACK'});
    expect(unitTurn.content.purchaseIntake?.summary).toBe('50 pallet de Cemento Holcim 42.5');
  });
  it('un sí fuera de pregunta booleana no cambia producto, factura ni confirma',async()=>{
    const h=harness();await h.say('compré 50 bolsas de cemento');await h.say('Completar por aquí');
    const turn=await h.say('sí');expect(turn.state?.facts.items[0].description).toBe('cemento');expect(turn.state?.facts.items[0].productId).toBeUndefined();
    expect(turn.draft).toBeUndefined();
  });
  it('sin costo ni total explícito continúa preguntando, aunque tenga cantidad',async()=>{
    const h=harness();await h.say('compré 50 bolsas de cemento');await h.say('Completar por aquí');await h.say('1');
    const turn=await h.say('BASE');expect(turn.state?.pendingQuestion?.field).toBe('items.0.unitCost');
    expect(turn.state?.facts.items[0].unitCost).toBeUndefined();expect(turn.state?.facts.documentTotal).toBeUndefined();
  });
  it('farmacia exige lote y vencimiento sin producir borrador mientras falten',async()=>{
    const h=harness();h.mocks.product.findFirst.mockResolvedValue({...product,name:'Acetaminofén 500 mg',requiresBatchTracking:true});
    let turn=await h.say('compré 50 cajas de acetaminofén');
    for(const answer of ['Completar por aquí','1','1','C$ 230'])turn=await h.say(answer);
    expect(turn.state?.pendingQuestion?.field).toBe('items.0.batchNumber');
    expect(missingPurchaseFacts(turn.state!)).toEqual(expect.arrayContaining(['items.0.batchNumber','items.0.expiryDate']));
    expect(turn.draft).toBeUndefined();
    turn=await h.say('LOT-2026');
    expect(turn.state?.facts.items[0].batchNumber).toBe('LOT-2026');expect(turn.state?.pendingQuestion?.field).toBe('items.0.expiryDate');
    expect(turn.state?.facts.items[0].expiryDate).toBeUndefined();expect(turn.draft).toBeUndefined();
    turn=await h.say('2026-02-30');
    expect(turn.state?.pendingQuestion?.field).toBe('items.0.expiryDate');expect(turn.draft).toBeUndefined();
    turn=await h.say('2028-09-05');
    expect(turn.state?.facts.items[0]).toMatchObject({batchNumber:'LOT-2026',expiryDate:'2028-09-05'});
    expect(missingPurchaseFacts(turn.state!)).not.toEqual(expect.arrayContaining(['items.0.batchNumber','items.0.expiryDate']));
    expect(turn.draft).toBeUndefined();
  });
  it('contado pregunta recepción y pago por separado sin inferirlos del medio declarado',async()=>{
    const h=harness();let turn=await h.say('compré 50 bolsas de cemento');
    for(const answer of ['Completar por aquí','1','1','C$ 230','Cementos Alfa','1','F-123','2026-09-05','13225','contado'])turn=await h.say(answer);
    expect(turn.state?.facts.paymentMethod).toBe('CASH');expect(turn.state?.facts.receivedConfirmed).toBeUndefined();expect(turn.state?.facts.paymentConfirmed).toBeUndefined();
    expect(turn.state?.pendingQuestion?.field).toBe('receivedConfirmed');expect(turn.draft).toBeUndefined();
    turn=await h.say('sí');
    expect(turn.state?.facts.receivedConfirmed).toBe(true);expect(turn.state?.facts.paymentConfirmed).toBeUndefined();
    expect(turn.state?.pendingQuestion?.field).toBe('paymentConfirmed');expect(turn.draft).toBeUndefined();
    turn=await h.say('no');
    expect(turn.state?.facts).toMatchObject({receivedConfirmed:true,paymentConfirmed:false});expect(turn.draft).toBeUndefined();
    turn=await h.say('1');
    expect(turn.draft).toMatchObject({paymentMethod:'CASH',receivedConfirmed:true,paymentConfirmed:false});
  });
  it('no inventa número de factura ante una respuesta sin factura',async()=>{
    const h=harness();for(const text of ['compré 50 bolsas de cemento','Completar por aquí','1','BASE','C$ 230','Cementos Alfa','1'])await h.say(text);
    const turn=await h.say('no tengo factura');expect(turn.state?.pendingQuestion?.field).toBe('invoiceNumber');expect(turn.state?.facts.invoiceNumber).toBeUndefined();
  });
  it('cambiar a foto conserva los hechos y su evidencia',async()=>{
    const h=harness();const first=await h.say('compré 50 bolsas de cemento');
    const photo=await h.say('voy a adjuntar una foto');expect(photo.state?.id).toBe(first.state?.id);expect(photo.state?.facts.items[0].quantity).toBe('50');
    h.mocks.assistantConversation.findFirst.mockResolvedValue({metadata:h.metadata(),stateVersion:2});
    const snapshot=await readPurchaseIntakeForDocument(principal,'conversation-a',h.db);
    expect(snapshot).toMatchObject({intakeId:first.state?.id,stateVersion:2,draft:{documentTotal:'',currency:'',receivedConfirmed:false}});
    expect(snapshot?.evidence[0]).toContain('50 bolsas');expect(snapshot?.draft.warnings.length).toBeGreaterThan(0);
  });
  it('corrige una sola cantidad sin recalcular precio ni total',async()=>{
    const h=harness();await complete(h);
    const turn=await h.say('son 60, no 50');expect(turn.draft?.items[0]).toMatchObject({quantity:'60',unitCost:'230'});
    expect(turn.draft?.documentTotal).toBe('13225');expect(turn.state?.phase).toBe('REVIEW');
  });
  it.each(['CHOOSE_INPUT','COLLECTING'])('corrige cantidad en %s sin perder el producto',async phase=>{
    const h=harness();await h.say('compré 50 bolsas de cemento');if(phase==='COLLECTING')await h.say('Completar por aquí');
    const turn=await h.say('son 60, no 50');expect(turn.state?.facts.items[0]).toMatchObject({description:'cemento',quantity:'60'});
    expect((await h.say('registralo por aquí')).state?.facts.items[0]).toMatchObject({description:'cemento',quantity:'60'});
  });
  it('retiene un costo explícito antes de elegir foto o manual',async()=>{
    const h=harness();await h.say('compré 50 bolsas de cemento');const turn=await h.say('me costaron C$230 cada una');
    expect(turn.state?.facts.items[0]).toMatchObject({description:'cemento',quantity:'50',unitCost:'230'});expect(turn.state?.facts.currency).toBe('NIO');expect(turn.state?.phase).toBe('CHOOSE_INPUT');
    expect((await h.say('agregalo al inventario')).state?.mode).toBe('MANUAL');
  });
  it('no aplica un precio ambiguo a la primera de varias líneas',async()=>{
    const h=harness(),full=await complete(h);full.state!.facts.items.push({...full.state!.facts.items[0],description:'clavos',productId:'product-b',unitCost:'20'});
    const turn=await advancePurchaseIntake({principal,text:'precio 99',requestId:randomUUID(),metadata:{purchaseIntake:full.state}},h.db);
    expect(turn.state?.facts.items.map(line=>line.unitCost)).toEqual(['230','20']);expect(turn.draft).toBeUndefined();expect(turn.content.text).toContain('varios productos');
  });
  it('corregir factura conserva cargos, fechas, totales y advertencias del borrador completo',async()=>{
    const h=harness(),full=await complete(h);const turn=await h.say('factura F-CORREGIDA');
    const original={...full.draft!,freight:'5',postingDate:'2026-09-04',notes:'revisar cargo',documentSubtotal:'11500',documentTax:'1725',warnings:['Flete no compatible']};
    expect(applyIntakeDraftCorrection(original,turn)).toEqual({...original,invoiceNumber:'F-CORREGIDA'});
  });
  it('cancelar limpia la captura y un sí posterior no es ejecución',async()=>{
    const h=harness();await complete(h);const turn=await h.say('cancelar compra');expect(turn.content.purchaseIntake).toBeNull();expect(readPurchaseIntake(h.metadata())).toBeNull();
  });
  it('no reutiliza contexto de una captura que ya tiene propuesta',async()=>{
    const h=harness(),turn=await complete(h);
    h.mocks.assistantConversation.findFirst.mockResolvedValue({metadata:turn.metadata,stateVersion:10});
    expect(await readPurchaseIntakeForDocument(principal,'conversation-a',h.db)).toBeNull();
    await expect(attachDocumentProposalToIntake(principal,'conversation-a',turn.state!.id,'proposal-new',h.db as any,10)).rejects.toMatchObject({code:'INTAKE_CHANGED'});
    expect(h.mocks.assistantConversation.updateMany).not.toHaveBeenCalled();
  });
  it('foto final se adjunta sólo a la versión vigente de la captura',async()=>{
    const h=harness(),turn=await h.say('compré 50 bolsas de cemento');
    h.mocks.assistantConversation.findFirst.mockResolvedValue({metadata:turn.metadata,stateVersion:3});
    await expect(attachDocumentProposalToIntake(principal,'conversation-a',turn.state!.id,'proposal-doc',h.db as any,2)).rejects.toMatchObject({code:'INTAKE_CHANGED'});
    await attachDocumentProposalToIntake(principal,'conversation-a',turn.state!.id,'proposal-doc',h.db as any,3);
    expect(h.mocks.assistantConversation.updateMany.mock.calls[0][0]).toMatchObject({where:{stateVersion:3,tenantId:'tenant-a',userId:'user-a'},data:{metadata:{purchaseIntake:{mode:'ATTACHMENT',phase:'REVIEW',proposalId:'proposal-doc'}}}});
  });
  it('helper de documentos rechaza conversación ajena o vencida',async()=>{
    const h=harness();h.mocks.assistantConversation.findFirst.mockResolvedValue(null);
    await expect(readPurchaseIntakeForDocument(principal,'foreign',h.db)).rejects.toMatchObject({statusCode:404});
    expect(h.mocks.assistantConversation.findFirst.mock.calls[0][0].where).toMatchObject({id:'foreign',tenantId:'tenant-a',userId:'user-a',roleAtCreation:'OWNER',expiresAt:{gt:expect.any(Date)}});
  });
  it('no acepta hechos del modelo sin respaldo actual ni importes calculados',()=>{
    const facts={items:[{description:'cemento'}]};
    expect(acceptLanguageFacts(facts,[{field:'unitCost',value:'230',suppliedText:'cuestan 230'},{field:'quantity',value:'50',suppliedText:'compré cemento'}],'compré cemento')).toEqual([]);
    expect(facts.items[0]).not.toHaveProperty('unitCost');
    expect(acceptLanguageFacts(facts,[{field:'quantity',value:'50',suppliedText:'50 bolsas'}],'compré 50 bolsas')).toEqual(['quantity']);
  });
  it.each([
    ['unitCost','2','2','Compré 2 cajas de tornillos'],['unitCost','230','230','La factura es F-230'],
    ['documentTotal','230','precio 230 cada una','precio 230 cada una'],
    ['dueDate','2026-09-05','2026-09-05','fecha de factura 2026-09-05'],
    ['expiryDate','2026-09-05','2026-09-05','fecha de factura 2026-09-05'],
  ] as const)('no atribuye %s por presencia literal de otro campo', (field,value,suppliedText,message)=>{
    const facts={items:[{description:'cemento'}]};expect(acceptLanguageFacts(facts,[{field,value,suppliedText}],message)).toEqual([]);
  });
  it('acepta importes y fechas sólo con atribución humana de ese campo',()=>{
    const facts={items:[{description:'cemento'}]};
    const message='Compré 50 bolsas a C$230 cada una; total C$13225; fecha de factura 2026-09-05; vence el crédito 2026-10-05';
    expect(acceptLanguageFacts(facts,[{field:'quantity',value:'50',suppliedText:'50 bolsas'},{field:'unitCost',value:'230',suppliedText:'a C$230 cada una'},{field:'documentTotal',value:'13225',suppliedText:'total C$13225'},{field:'date',value:'2026-09-05',suppliedText:'fecha de factura 2026-09-05'},{field:'dueDate',value:'2026-10-05',suppliedText:'vence el crédito 2026-10-05'}],message)).toEqual(['quantity','unitCost','documentTotal','date','dueDate']);
  });
});
