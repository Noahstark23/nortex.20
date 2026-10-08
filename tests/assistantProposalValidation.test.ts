import { describe,it,expect } from 'vitest';
import { draftIssues,invoiceDraftSchema,totalIssues,toPurchaseInput } from '../backend/services/assistant/proposalValidation';
import type { InvoiceDraft } from '../shared/assistant';
const valid=():InvoiceDraft=>({currency:'NIO',supplierId:'s',invoiceNumber:'F1',date:'2026-09-05',paymentMethod:'CREDIT',dueDate:'2026-10-05',
  receivedConfirmed:true,paymentConfirmed:false,documentSubtotal:'20.00',documentTax:'3.00',documentTotal:'23.00',
  items:[{productId:'p',description:'Tornillos',quantity:'2',unitCost:'10',purchaseUnit:'BASE'}],warnings:[]});
describe('Revisión de factura NortexGPT',()=>{
  it('no convierte lectura en recepción o pago confirmado',()=>{const draft=valid();draft.receivedConfirmed=false;expect(draftIssues(draft).join(' ')).toMatch(/recibiste/);draft.paymentMethod='CASH';expect(draftIssues(draft).join(' ')).toMatch(/pago de contado/);});
  it('bloquea monedas y cargos no representables, conserva correcciones humanas',()=>{for(const patch of [{currency:'USD'},{discount:'1.00'},{freight:'10'},{otherCharges:'NaN'},{documentTotal:'23,00'}]) expect(draftIssues({...valid(),...patch}).length).toBeGreaterThan(0);expect(draftIssues(valid())).toEqual([]);});
  it('mantiene diferencias exactas en centavos y no ajusta para cuadrar',()=>{expect(totalIssues(valid(),{subtotal:'20.00',tax:'3.00',total:'23.00'})).toEqual([]);expect(totalIssues(valid(),{subtotal:'20.00',tax:'3.01',total:'23.01'})).toHaveLength(2);});
  it('rechaza identidad y permisos inyectados y un lote arbitrario fuera schema',()=>{expect(invoiceDraftSchema.safeParse({...valid(),tenantId:'other'}).success).toBe(false);expect(invoiceDraftSchema.safeParse({...valid(),role:'OWNER'}).success).toBe(false);});
  it('el transporte sólo conserva campos aceptados de Compras',()=>{const input=toPurchaseInput(valid());expect(input).not.toHaveProperty('receivedConfirmed');expect(input).not.toHaveProperty('documentTotal');expect(input.items[0].quantity).toBe('2');});
  it('mantiene advertencias bloqueantes y no confunde una OC con compra directa',()=>{expect(draftIssues({...valid(),warnings:['Lote ilegible']})).toContain('Lote ilegible');expect(draftIssues({...valid(),purchaseOrderId:'oc',receivedConfirmed:false})).toEqual([]);});
});
