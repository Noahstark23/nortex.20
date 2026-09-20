import {randomUUID} from 'node:crypto';
import {beforeAll,describe,expect,it} from 'vitest';
import prisma from '../backend/lib/prisma';
import {assertDisposableDatabase} from './fixtures/assistant/integrationHelpers';
const base=process.env.NORTEX_QA_BASE_URL;
const qa=base && process.env.NORTEX_MYSQL_INTEGRATION==='1' ? describe.sequential : describe.skip;
let token='', foreign='';
async function api(path:string,body?:unknown,session=token) {
    const response=await fetch(`${base}${path}`,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${session}`,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:response.status,body:await response.json()};
}
const input=()=>({operationId:randomUUID(),product:{name:'Leche entera 500 ml',brand:'Marca QA',sku:`CAM-${randomUUID()}`,price:'25.50',stock:'0',minStock:'0',saleMode:'COUNTED',quantityStep:'1',unit:'unidad'}});
qa('alta con cámara: operación durable HTTP y MySQL',()=>{
    beforeAll(async()=>{
        assertDisposableDatabase();expect(['127.0.0.1','localhost']).toContain(new URL(base!).hostname);
        async function register(){const result=await api('/api/auth/register',{companyName:'QA Cámara',email:`camera-${randomUUID()}@example.invalid`,password:`QA-${randomUUID()}!`,type:'FERRETERIA'},'');expect(result.status).toBe(200);return result.body.token;}
        token=await register();foreign=await register();
    },60000);
    it('replay simultáneo confirma una sola ficha y una auditoría sin stock ni Kardex',async()=>{
        const command=input();const results=await Promise.all(Array.from({length:4},()=>api('/api/products/enrollment',command)));
        for(const result of results){expect(result.status).toBe(200);expect(result.body.outcome).toBe('APPLIED');expect(result.body.product.id).toBe(results[0].body.product.id);}
        const product=results[0].body.product;expect(product).toMatchObject({stock:0,brand:'Marca QA',price:25.5});
        expect(await prisma.product.count({where:{tenantId:product.tenantId,sku:product.sku}})).toBe(1);
        expect(await prisma.auditLog.count({where:{tenantId:product.tenantId,action:'PRODUCT_CREATED'}})).toBe(1);
        expect(await prisma.kardexMovement.count({where:{tenantId:product.tenantId,productId:product.id}})).toBe(0);
        expect((await api(`/api/products/enrollment/${command.operationId}`)).body).toEqual(results[0].body);
    });
    it('no confunde SKU existente con nuestro intento y conserva rechazo durable',async()=>{
        const command=input();const first=await api('/api/products/enrollment',command);
        const duplicate={...command,operationId:randomUUID()};const rejected=await api('/api/products/enrollment',duplicate);
        expect(rejected.body).toMatchObject({outcome:'REJECTED',code:'PRODUCT_EXISTS',productId:first.body.product.id});
        expect((await api('/api/products/enrollment',duplicate)).body).toEqual(rejected.body);
        expect((await api('/api/products/enrollment',{...command,product:{...command.product,name:'Otro nombre'}})).status).toBe(409);
    });
    it('tenant se toma del JWT; la consulta ajena no descubre una operación',async()=>{
        const command=input();const own=await api('/api/products/enrollment',command);
        expect((await api(`/api/products/enrollment/${command.operationId}`,undefined,foreign)).body.outcome).toBe('NOT_OBSERVED');
        const other=await api('/api/products/enrollment',command,foreign);
        expect(other.body.outcome).toBe('APPLIED');expect(other.body.product.tenantId).not.toBe(own.body.product.tenantId);
        expect((await api('/api/products/enrollment',{...input(),tenantId:own.body.product.tenantId},foreign)).status).toBe(400);
    });
    it('rechaza existencias y datos inválidos sin ficha ni intento aplicado',async()=>{
        const command=input();expect((await api('/api/products/enrollment',{...command,product:{...command.product,stock:'3'}})).status).toBe(400);
        expect((await api('/api/products/enrollment',{...command,product:{...command.product,price:'1,2,3'}})).status).toBe(400);
        expect((await api(`/api/products/by-barcode/${command.product.sku}`)).status).toBe(404);
        expect((await api(`/api/products/enrollment/${command.operationId}`)).body.outcome).toBe('NOT_OBSERVED');
    });
    it('revocar el rol bloquea tanto alta como recuperación de resultados',async()=>{
        const result=await api('/api/auth/register',{companyName:'QA Rol Cámara',email:`role-${randomUUID()}@example.invalid`,password:`QA-${randomUUID()}!`,type:'FERRETERIA'},'');
        expect(result.status).toBe(200);const scoped=result.body.token;
        const created=await api('/api/products/enrollment',input(),scoped);expect(created.body.outcome).toBe('APPLIED');
        const product=created.body.product;
        await prisma.user.updateMany({where:{id:product.createdBy,tenantId:product.tenantId},data:{role:'CASHIER'}});
        expect((await api('/api/products/enrollment',input(),scoped)).status).toBe(403);
        expect((await api(`/api/products/enrollment/${created.body.operationId}`,undefined,scoped)).status).toBe(403);
    });
    it('conserva modo medido y lotes sin recepción implícita',async()=>{
        const command=input();const result=await api('/api/products/enrollment',{...command,product:{...command.product,unit:'kg',saleMode:'MEASURED',quantityStep:'0.001',requiresBatchTracking:true}});
        expect(result.body.product).toMatchObject({stock:0,saleMode:'MEASURED',requiresBatchTracking:true,unit:'kg'});
        expect(Number(result.body.product.quantityStep)).toBe(.001);
    });
    it('caracteriza la ruta clásica después de extraer: stock, desglose y auditoría atómicos',async()=>{
        const command=input();const created=await api('/api/products',{...command.product,stock:'3',cost:'5'});
        expect(created.status).toBe(200);expect(created.body.stock).toBe(3);
        const product=created.body;
        expect(await prisma.productStock.findFirst({where:{tenantId:product.tenantId,productId:product.id}})).toMatchObject({stock:3});
        expect(await prisma.kardexMovement.findFirst({where:{tenantId:product.tenantId,productId:product.id}})).toMatchObject({quantity:3,stockBefore:0,stockAfter:3});
        const invalid=input();expect((await api('/api/products',{...invalid.product,defaultSupplierId:randomUUID()})).status).toBe(400);
        expect((await api(`/api/products/by-barcode/${invalid.product.sku}`)).status).toBe(404);
    });
});
