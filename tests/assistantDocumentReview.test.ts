import { describe, expect, it } from 'vitest';
import type { InvoiceDraft } from '../shared/assistant';
import { createPurchaseDocumentContext, mergePurchaseDocumentContext } from '../backend/services/assistant/purchaseDocumentContext';
import { createDocumentPurchaseSource, documentReviewDTO, readDocumentPurchaseSource, reconcileDocumentReview } from '../backend/services/assistant/purchaseDocumentReview';

const invoice = (quantity: string): InvoiceDraft => ({currency:'NIO',invoiceNumber:'SINTETICA-1',date:'2026-09-19',documentTotal:'',
  items:[{description:'Cemento',quantity,unitCost:'',purchaseUnit:'BASE'}],warnings:[],receivedConfirmed:false,paymentConfirmed:false});
const actor={tenantId:'tenant',userId:'user',role:'OWNER'};
const original=()=>createDocumentPurchaseSource(invoice('40'),createPurchaseDocumentContext('conversation',{
  intakeId:'intake',stateVersion:1,draft:invoice('50'),evidence:['Compré 50 bolsas de cemento']}));

describe('H01-2: fuentes documentales y declaradas',()=>{
  it('conserva 50 declarado frente a 40 facturado antes de una decisión humana',()=>{
    const context=createPurchaseDocumentContext('conversation',{intakeId:'intake',stateVersion:1,draft:invoice('50'),evidence:['Compré 50 bolsas de cemento']});
    const document=invoice('40'),beforeContext=structuredClone(context),beforeDocument=structuredClone(document);
    const result=mergePurchaseDocumentContext(document,context);
    expect(result.items[0].quantity).toBe('50');
    expect(result.warnings.join(' ')).toContain('conversación «50»; documento «40»');
    expect(context).toEqual(beforeContext);expect(document).toEqual(beforeDocument);
    expect(result.receivedConfirmed).toBe(false);expect(result.paymentConfirmed).toBe(false);
  });
  it('expone ambas fuentes y un conflicto estable, sin confundir recepción y pago',()=>{
    const source=original(),draft=mergePurchaseDocumentContext(source.document,source.context),review=documentReviewDTO(source,draft);
    expect(review).toMatchObject({hasUnresolved:true,declared:{items:[{quantity:'50'}]},document:{items:[{quantity:'40'}]},
      conflicts:[{id:'value:items.0.quantity',path:'items.0.quantity',declaredValue:'50',documentValue:'40',status:'PENDING'}]});
    expect(source.document.receivedConfirmed).toBe(false);expect(draft.paymentConfirmed).toBe(false);
  });
  it.each(['DECLARED','DOCUMENT'] as const)('aplica elección %s y atribución sin alterar fuentes',choice=>{
    const source=original(),before=structuredClone(source),draft=mergePurchaseDocumentContext(source.document,source.context);
    const result=reconcileDocumentReview(source,draft,[{conflictId:'value:items.0.quantity',choice,reason:'Contrasté el documento y la declaración.'}],actor,2,new Date('2026-09-19T12:00:00Z'));
    expect(result.draft.items[0].quantity).toBe(choice==='DECLARED'?'50':'40');expect(result.requiresFreshReview).toBe(true);
    expect(result.issues).toEqual([]);expect(result.source.document).toEqual(before.document);expect(result.source.context).toEqual(before.context);
    expect(result.source.conflicts[0].resolution).toMatchObject({choice,reason:'Contrasté el documento y la declaración.',resolvedBy:'user',proposalVersion:2,resolvedAt:'2026-09-19T12:00:00.000Z'});
    expect(readDocumentPurchaseSource(result.source)).toEqual(result.source);expect(source).toEqual(before);
  });
  it('borrar warnings y editar cantidad no constituye una decisión',()=>{
    const source=original(),draft={...invoice('40'),warnings:[]};
    const result=reconcileDocumentReview(source,draft,[],actor,2);
    expect(result.issues).toHaveLength(1);expect(result.source.conflicts[0].status).toBe('PENDING');
    expect(result.source.context?.draft.items[0].quantity).toBe('50');expect(result.source.document.items[0].quantity).toBe('40');
  });
  it('editar un campo resuelto invalida su decisión y la revisión anterior',()=>{
    const source=original(),resolved=reconcileDocumentReview(source,invoice('50'),[{conflictId:'value:items.0.quantity',choice:'DOCUMENT',reason:'Factura comprobada'}],actor,2);
    const edited={...resolved.draft,items:[{...resolved.draft.items[0],quantity:'45'}]};
    expect(documentReviewDTO(resolved.source,edited).hasUnresolved).toBe(true);
    const result=reconcileDocumentReview(resolved.source,edited,[],actor,3);
    expect(result.source.conflicts[0]).toMatchObject({status:'PENDING'});expect(result.source.conflicts[0].resolution).toBeUndefined();
    expect(result.requiresFreshReview).toBe(true);expect(result.issues).toHaveLength(1);expect(result.draft.items[0].quantity).toBe('45');
  });
  it.each([['','',false],['','0',false],['0','',false],['50','0',true],['50','50.000',false]])('desconocido %j y documento %j mantienen su significado', (declared,document,conflict)=>{
    const context=createPurchaseDocumentContext('c',{intakeId:'i',stateVersion:1,draft:invoice(declared),evidence:[]});
    const source=createDocumentPurchaseSource(invoice(document),context),merged=mergePurchaseDocumentContext(source.document,source.context);
    expect(merged.items[0].quantity).toBe(conflict?declared:(document||declared));
    expect(documentReviewDTO(source,merged).hasUnresolved).toBe(conflict);
    expect(source.context?.draft.items[0].quantity).toBe(declared);expect(source.document.items[0].quantity).toBe(document);
  });
  it('descripción ambigua no admite elegir cantidades ni borrar el bloqueo',()=>{
    const source=createDocumentPurchaseSource({...invoice('40'),items:[{...invoice('40').items[0],description:'Cemento especial'}]},original().context);
    const result=reconcileDocumentReview(source,{...source.document,warnings:[]},[],actor,2);
    expect(result.source.conflicts[0]).toMatchObject({kind:'LINE_MATCH',status:'BLOCKED'});expect(result.issues).toHaveLength(1);
    expect(()=>reconcileDocumentReview(source,result.draft,[{conflictId:source.conflicts[0].id,choice:'DOCUMENT',reason:'Elegí el documento'}],actor,3)).toThrow();
  });
  it('quitar, agregar o intercambiar el renglón no elude el conflicto',()=>{
    const source=original();
    for(const draft of [{...invoice('50'),items:[]},{...invoice('50'),items:[...invoice('50').items,...invoice('50').items]},
      {...invoice('50'),items:[{...invoice('50').items[0],description:'Otro producto'}]}]) {
      expect(documentReviewDTO(source,draft).conflicts).toContainEqual(expect.objectContaining({id:'mapping:edited-lines',status:'BLOCKED'}));
      expect(()=>reconcileDocumentReview(source,draft,[{conflictId:'value:items.0.quantity',choice:'DOCUMENT',reason:'Decisión'}],actor,2)).toThrow();
    }
  });
  it.each([
    {decisions:[{conflictId:'missing',choice:'DOCUMENT',reason:'Motivo'}]},
    {decisions:[{conflictId:'value:items.0.quantity',choice:'DOCUMENT',reason:' '}]},
    {decisions:[{conflictId:'value:items.0.quantity',choice:'DOCUMENT',reason:'Motivo',value:'1'}]},
    {decisions:[{conflictId:'value:items.0.quantity',choice:'DOCUMENT',reason:'A'},{conflictId:'value:items.0.quantity',choice:'DECLARED',reason:'B'}]},
  ])('rechaza decisiones inválidas sin modificar las fuentes: %j',({decisions})=>{
    const source=original(),before=structuredClone(source);
    expect(()=>reconcileDocumentReview(source,invoice('50'),decisions,actor,2)).toThrow();expect(source).toEqual(before);
  });
  it('rechaza fuente persistida sin un conflicto original o con valores sustituidos',()=>{
    const source=original();expect(()=>readDocumentPurchaseSource({...source,conflicts:[]})).toThrow();
    expect(()=>readDocumentPurchaseSource({...source,conflicts:[{...source.conflicts[0],declaredValue:'1'}]})).toThrow();
  });
});
