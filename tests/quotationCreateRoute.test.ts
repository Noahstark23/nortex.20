// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../backend/lib/prisma',()=>({default:{}}));
import { createQuotationHandler } from '../backend/routes/quotationCreate';

const product={id:'product-a',name:'Cable real',price:115,unit:'metro',ivaExento:false,saleMode:'MEASURED',quantityStep:'0.125'};
const db={product:{findMany:vi.fn()},tenant:{findUnique:vi.fn()},quotation:{create:vi.fn()}};
const response=()=>{const res:any={status:vi.fn(),json:vi.fn()};res.status.mockReturnValue(res);return res;};
const request=(items:unknown=[{productId:product.id,quantity:'0.5'}])=>({tenantId:'jwt-tenant',userId:'jwt-user',role:'OWNER',body:{tenantId:'forged-tenant',customerName:'Cliente QA',customerRuc:'QA-RUC',expiresAt:'2026-10-01T00:00:00Z',items}});
beforeEach(()=>{
  vi.clearAllMocks();db.product.findMany.mockResolvedValue([product]);db.tenant.findUnique.mockResolvedValue({fiscalRegime:'GENERAL'});
  db.quotation.create.mockImplementation(async({data})=>({id:'quote-a',...data,items:data.items.create.map((item:any,index:number)=>({id:'line-'+index,quantityExact:item.quantityExact,...item}))}));
});
describe('POST quotations: contrato extraído de main',()=>{
  it('tenant JWT, autoridad del catálogo y snapshot exacto prevalecen sobre entrada cliente',async()=>{
    const res=response();await createQuotationHandler({db:db as any})(request([{id:product.id,quantity:'0.5',price:'0.01',name:'Nombre falso'}]),res);
    expect(db.product.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{tenantId:'jwt-tenant',id:{in:[product.id]}}}));
    expect(db.tenant.findUnique).toHaveBeenCalledWith({where:{id:'jwt-tenant'},select:{fiscalRegime:true}});
    const stored=db.quotation.create.mock.calls[0][0];
    expect(stored.data).toMatchObject({tenantId:'jwt-tenant',customerName:'Cliente QA',customerRuc:'QA-RUC',subtotal:50,tax:7.5,total:57.5,fiscalRegimeAtQuote:'GENERAL',expiresAt:new Date('2026-10-01T00:00:00Z')});
    expect(stored.data.items.create).toEqual([{productId:product.id,name:'Cable real',price:115,unitPriceExact:'115.0000',quantity:1,quantityExact:'0.5',unitAtQuote:'metro',saleModeAtQuote:'MEASURED',quantityStepAtQuote:'0.125',presentationAtQuote:'BASE',presentationQuantityAtQuote:'0.5000',ivaExentoAtQuote:false}]);
    expect(stored.include).toEqual({items:{orderBy:{id:'asc'}}});
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0]).toMatchObject({id:'quote-a',subtotal:50,tax:7.5,total:57.5,items:[{name:'Cable real',quantity:0.5,quantityExact:'0.5',unitPriceExact:'115.0000',unit:'metro',saleMode:'MEASURED'}]});
  });
  it('cuota fija y líneas exentas conservan totales de catálogo',async()=>{
    db.tenant.findUnique.mockResolvedValue({fiscalRegime:'CUOTA_FIJA'});
    const fixed=response();await createQuotationHandler({db:db as any})(request(),fixed);
    expect(fixed.json.mock.calls[0][0]).toMatchObject({subtotal:57.5,tax:0,total:57.5,fiscalRegimeAtQuote:'CUOTA_FIJA'});
    db.tenant.findUnique.mockResolvedValue({fiscalRegime:'GENERAL'});db.product.findMany.mockResolvedValue([{...product,ivaExento:true}]);
    const exempt=response();await createQuotationHandler({db:db as any})(request(),exempt);
    expect(exempt.json.mock.calls[0][0]).toMatchObject({subtotal:57.5,tax:0,total:57.5});
    expect(db.quotation.create.mock.calls[1][0].data.items.create[0].ivaExentoAtQuote).toBe(true);
  });
  it('sin items devuelve 400 sin consultar ni crear',async()=>{
    const res=response();await createQuotationHandler({db:db as any})(request([]),res);
    expect(res.status).toHaveBeenCalledWith(400);expect(res.json).toHaveBeenCalledWith({error:'Faltan items'});expect(db.product.findMany).not.toHaveBeenCalled();expect(db.quotation.create).not.toHaveBeenCalled();
  });
  it('negocio inexistente devuelve 404 sin crear',async()=>{
    db.tenant.findUnique.mockResolvedValue(null);const res=response();await createQuotationHandler({db:db as any})(request(),res);
    expect(res.status).toHaveBeenCalledWith(404);expect(res.json).toHaveBeenCalledWith({error:'Negocio no encontrado'});expect(db.quotation.create).not.toHaveBeenCalled();
  });
  it('producto fuera del tenant retorna código PRODUCT_NOT_FOUND sin crear',async()=>{
    const res=response();await createQuotationHandler({db:db as any})(request([{productId:'foreign-product',quantity:'1'}]),res);
    expect(res.status).toHaveBeenCalledWith(404);expect(res.json).toHaveBeenCalledWith(expect.objectContaining({code:'PRODUCT_NOT_FOUND'}));expect(db.quotation.create).not.toHaveBeenCalled();
  });
  it('cajas legacy preservan restricción entera y rechazan fracciones',async()=>{
    db.product.findMany.mockResolvedValue([{...product,unit:'caja',saleMode:null,quantityStep:null}]);const res=response();await createQuotationHandler({db:db as any})(request(),res);
    expect(res.status).toHaveBeenCalledWith(400);expect(res.json).toHaveBeenCalledWith(expect.objectContaining({code:'INVALID_QUANTITY'}));expect(db.quotation.create).not.toHaveBeenCalled();
  });
  it('campos de línea ajenos al contrato son rechazados por Zod',async()=>{
    const res=response();await createQuotationHandler({db:db as any})(request([{productId:product.id,quantity:'1',presentation:'PACK'}]),res);
    expect(res.status).toHaveBeenCalledWith(400);expect(db.product.findMany).not.toHaveBeenCalled();expect(db.quotation.create).not.toHaveBeenCalled();
  });
});
