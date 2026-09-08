import { describe, it, expect, vi } from 'vitest';
vi.mock('../backend/middleware/auth', () => ({authenticate: (_req: any, _res: any, next: any) => next()}));
import { registerRetentionCertificate } from '../backend/routes/retentionCertificate';
import { registerFiscalExports } from '../backend/routes/fiscalExports';

function handlers(prisma: any) {
 const routes = new Map<string, any[]>();
 const app: any = {get: (path: string, ...handlers: any[]) => routes.set(path, handlers)};
 registerRetentionCertificate(app, prisma);registerFiscalExports(app, prisma);return routes;
}
function response() {
 const res: any = {statusCode:200, headers:{}, body:undefined};
 res.status=(code:number)=>{res.statusCode=code;return res};
 res.json=res.send=(body:any)=>{res.body=body;return res};
 res.setHeader=(name:string,value:string)=>{res.headers[name]=value;return res};return res;
}
const paths = ['/api/fiscal/libro-ventas/:month/:year','/api/fiscal/libro-compras/:month/:year','/api/fiscal/vet-export/:month/:year'];
describe('contrato conductual de documentos fiscales',()=>{
 for (const path of paths) {
  it(`${path}: rechaza período inválido antes de consultar`, async()=>{
   const prisma=new Proxy({}, {get(){throw new Error('Unexpected database access')}}); const res=response();
   await handlers(prisma).get(path)!.at(-1)({params:{month:'13',year:'2026'},tenantId:'tenant-a'},res);
   expect(res.statusCode).toBe(400);expect(res.body).toEqual({error:'Mes o año inválido.'});
  });
  it(`${path}: conserva permiso fiscal`,()=>{
   const guard=handlers({}).get(path)![1];const res=response();const next=vi.fn();
   guard({role:'CASHIER'},res,next);expect(res.statusCode).toBe(403);expect(next).not.toHaveBeenCalled();
  });
 }
 it('constancia: un ID ajeno devuelve 404 y busca exclusivamente dentro del JWT',async()=>{
  const findFirst=vi.fn().mockResolvedValue(null); const res=response();
  await handlers({purchase:{findFirst}}).get('/api/fiscal/constancia-retencion/:purchaseId')!.at(-1)({params:{purchaseId:'foreign'},tenantId:'tenant-a',query:{tenantId:'tenant-b'}},res);
  expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({where:{id:'foreign',tenantId:'tenant-a',documentStatus:'POSTED'}}));expect(res.statusCode).toBe(404);
 });
 it('VET conserva snapshots, corte Managua y procedencia, sin mutaciones',async()=>{
  const saleFind=vi.fn().mockResolvedValue([{total:'115',exemptTotal:'0',vatAmountAtSale:'15',fiscalRegimeAtSale:'GENERAL',createdAt:new Date('2026-08-01T01:00:00Z'),invoiceNumber:1,invoiceSeries:'A',customerName:'Cliente sintético',paymentMethod:'CASH'}]);
  const purchaseFind=vi.fn().mockResolvedValue([]);const res=response();
  await handlers({sale:{findMany:saleFind},purchase:{findMany:purchaseFind}}).get(paths[2])!.at(-1)({params:{month:'7',year:'2026'},tenantId:'tenant-a'},res);
  expect(res.statusCode).toBe(200);expect(res.body).toContain('20260731');expect(res.body).toContain('|0.00|100.00|15.00|115.00');
  expect(saleFind.mock.calls[0][0].where).toMatchObject({tenantId:'tenant-a',createdAt:{gte:new Date('2026-07-01T06:00:00Z'),lt:new Date('2026-08-01T06:00:00Z')}});
  expect(purchaseFind.mock.calls[0][0].where).toMatchObject({tenantId:'tenant-a',documentStatus:'POSTED'});
 });
});
