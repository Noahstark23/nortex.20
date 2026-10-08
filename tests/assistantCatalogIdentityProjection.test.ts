import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { markCatalogIdentityCollisions, matchesCurrentCatalogIdentity, productCatalogIdentitySelect,
  projectProductCatalogIdentity, projectSupplierCatalogIdentity, supplierCatalogIdentitySelect } from '../backend/services/assistant/catalogIdentity';
import { purchaseIntakeSchema } from '../backend/services/assistant/purchaseIntakeTypes';
const product = {id:'p',name:'Producto registrado',sku:'SKU-1',brand:'Marca',unit:'kg',packUnit:'saco',packSize:20,quantityStep:new Prisma.Decimal('0.25'),saleMode:'MEASURED',requiresBatchTracking:true};
describe('Proyección única de identidad sin inferencia ni datos económicos',()=>{
  it('proyecta sólo campos reales, convierte Decimal a texto y no confunde factor con peso',()=>{
    const row=projectProductCatalogIdentity({...product,cost:900,price:1200,stock:50} as any);
    expect(row).toMatchObject({id:'p',label:product.name,brand:'Marca',sku:'SKU-1',unit:'kg',packUnit:'saco',packSize:'20',quantityStep:'0.25',saleMode:'MEASURED',requiresBatchTracking:true});
    expect(row.detail).toBe('SKU "SKU-1" · Marca "Marca" · Unidad "kg" · Empaque "saco" · Factor 20 unidades base · Modo "MEASURED" · Paso 0.25 · Requiere lote');
    expect(row.detail).toContain('Factor 20 unidades base');expect(row.detail).not.toContain('20 kg');
    expect(row).not.toHaveProperty('cost');expect(row).not.toHaveProperty('price');expect(row).not.toHaveProperty('stock');
  });
  it('faltantes permanecen explícitos sin inventar marca a partir del nombre',()=>{
    const row=projectProductCatalogIdentity({id:'p',name:'Cemento Holcim 42.5'});
    expect(row.brand).toBeNull();expect(row.packSize).toBeNull();expect(row.quantityStep).toBeNull();expect(row.unit).toBeUndefined();expect(row.detail).toBeUndefined();
  });
  it('proveedor muestra nombre RUC y dirección, excluyendo contactos y deuda',()=>{
    const row=projectSupplierCatalogIdentity({id:'s',name:'Proveedor',ruc:'J-001',address:'León',phone:'5555',email:'no@example.test',balance:15} as any);
    expect(row).toEqual({id:'s',label:'Proveedor',ruc:'J-001',address:'León',detail:'RUC "J-001" · Dirección "León"'});
  });
  it('dirección excesiva queda acotada y bloqueada, no se presume identificación completa',()=>{
    const row=projectSupplierCatalogIdentity({id:'s',name:'Proveedor',address:'a'.repeat(2100)});
    expect(row.address).toHaveLength(2000);expect(row.selectionIssue).toBeTruthy();
  });
  it('separa un RUC que contiene delimitadores de una dirección real',()=>{
    const first=projectSupplierCatalogIdentity({id:'s1',name:'Proveedor',ruc:'123 · Dirección Managua',address:null});
    const second=projectSupplierCatalogIdentity({id:'s2',name:'Proveedor',ruc:'123',address:'Managua'});
    expect(first.detail).not.toBe(second.detail);
    expect(first).toMatchObject({label:'Proveedor',ruc:'123 · Dirección Managua',address:null});
    expect(second).toMatchObject({label:'Proveedor',ruc:'123',address:'Managua'});
    expect(markCatalogIdentityCollisions([first,second]).every(row=>!row.selectionIssue)).toBe(true);
  });
  it('separa un SKU que contiene delimitadores de una marca real',()=>{
    const first=projectProductCatalogIdentity({...product,id:'p1',sku:'123 · Marca Acme',brand:null});
    const second=projectProductCatalogIdentity({...product,id:'p2',sku:'123',brand:'Acme'});
    expect(first.detail).not.toBe(second.detail);
    expect(first).toMatchObject({label:product.name,sku:'123 · Marca Acme',brand:null});
    expect(second).toMatchObject({label:product.name,sku:'123',brand:'Acme'});
    expect(markCatalogIdentityCollisions([first,second]).every(row=>!row.selectionIssue)).toBe(true);
  });
  it('expansión de escapes conserva el límite del detalle y bloquea sin alterar el dato',()=>{
    const address='"\\'.repeat(900);
    const row=projectSupplierCatalogIdentity({id:'s',name:'Proveedor',ruc:'J-001',address});
    expect(row.address).toBe(address);expect(row.detail!.length).toBeLessThanOrEqual(3000);expect(row.selectionIssue).toBeTruthy();
  });
  it('dos IDs con identidad visible igual se bloquean sin confundir repetir el mismo ID',()=>{
    const row=projectSupplierCatalogIdentity({id:'s',name:'Proveedor'});
    expect(markCatalogIdentityCollisions([row,{...row,id:'s2'}]).every(r=>r.selectionIssue)).toBe(true);
    expect(markCatalogIdentityCollisions([row,row]).every(r=>!r.selectionIssue)).toBe(true);
  });
  it('el mismo nombre se distingue por RUC o SKU reales',()=>{
    expect(markCatalogIdentityCollisions([projectProductCatalogIdentity(product),projectProductCatalogIdentity({...product,id:'p2',sku:'SKU-2'})]).every(r=>!r.selectionIssue)).toBe(true);
    expect(markCatalogIdentityCollisions([projectSupplierCatalogIdentity({id:'s1',name:'Igual',ruc:'R1'}),projectSupplierCatalogIdentity({id:'s2',name:'Igual',ruc:'R2'})]).every(r=>!r.selectionIssue)).toBe(true);
  });
  it('snapshot exacto permite elección, cambios visibles exigen revisar',()=>{
    const row=projectProductCatalogIdentity(product);
    expect(matchesCurrentCatalogIdentity(row,row)).toBe(true);
    expect(matchesCurrentCatalogIdentity(row,{...row,brand:'Otra'})).toBe(false);
    expect(matchesCurrentCatalogIdentity(row,{...row,label:'Otro'})).toBe(false);
    expect(matchesCurrentCatalogIdentity(row,{...row,id:'otro'})).toBe(false);
  });
  it('compatibilidad metadata admite etiqueta antigua pero no sustituye nombre cambiado',()=>{
    const row=projectProductCatalogIdentity(product);
    expect(matchesCurrentCatalogIdentity({id:'p',label:'Producto registrado (SKU-1)'},row)).toBe(true);
    expect(matchesCurrentCatalogIdentity({id:'p',label:'Nombre anterior (SKU-1)'},row)).toBe(false);
  });
  it('SELECTs comparten los campos mínimos sin contactos/costos',()=>{
    expect(Object.keys(productCatalogIdentitySelect)).toEqual(['id','name','sku','brand','unit','saleMode','quantityStep','packUnit','packSize','requiresBatchTracking']);
    expect(Object.keys(supplierCatalogIdentitySelect)).toEqual(['id','name','ruc','address']);
  });
  it('metadata admite candidatos antiguos y nuevos sin cambiar el borrador financiero',()=>{
    const base={id:'875344db-bcf9-42a5-af9d-8d1b3b5d167d',phase:'COLLECTING',mode:'MANUAL',facts:{items:[{description:'cemento',quantity:'50'}]},evidence:[],pendingQuestion:{id:'242d7c59-e086-4f5a-9704-b76016d6c9dc',field:'items.0.productId',lineIndex:0,candidates:[{id:'p',label:'Producto'}]}};
    expect(purchaseIntakeSchema.parse(base).pendingQuestion?.candidates?.[0]).toEqual({id:'p',label:'Producto'});
    const next=purchaseIntakeSchema.parse({...base,pendingQuestion:{...base.pendingQuestion,candidates:[projectProductCatalogIdentity(product)]}});
    expect(next.pendingQuestion?.candidates?.[0]).toMatchObject({brand:'Marca',quantityStep:'0.25'});expect(next.facts).toEqual(base.facts);
  });
});
