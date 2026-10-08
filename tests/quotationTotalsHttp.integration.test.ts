// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import prisma from '../backend/lib/prisma';
const base=process.env.NORTEX_QA_BASE_URL;
const qa=base?describe.sequential:describe.skip;
qa('Caracterización HTTP de totales de proforma',()=>{
 afterAll(async()=>{await prisma.$disconnect();});
 it('conserva IVA incluido, exención y cuota fija con redondeo por línea',async()=>{
  const email=`qa-quote-totals-${randomUUID()}@example.invalid`;
  const response=await fetch(`${base}/api/auth/register`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({companyName:'QA Totales',email,password:'Qa-Only-Http-2026!',type:'FERRETERIA'})});
  const auth=await response.json();expect(response.status).toBe(200);
  const user=await prisma.user.findUniqueOrThrow({where:{email}});
  const taxable=await prisma.product.create({data:{tenantId:user.tenantId,name:'Gravado',sku:randomUUID(),price:115,cost:50,stock:10,unit:'unidad',createdBy:user.id}});
  const exempt=await prisma.product.create({data:{tenantId:user.tenantId,name:'Exento',sku:randomUUID(),price:12.34,cost:5,stock:10,unit:'unidad',createdBy:user.id,ivaExento:true}});
  const make=async()=>{const result=await fetch(`${base}/api/quotations`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${auth.token}`},body:JSON.stringify({customerName:'QA',expiresAt:new Date(Date.now()+86400000).toISOString(),items:[{productId:taxable.id,quantity:'2'},{productId:exempt.id,quantity:'3'}]})}); const body=await result.json();expect(result.status,JSON.stringify(body)).toBe(200);return body;};
  expect(await make()).toMatchObject({subtotal:237.02,tax:30,total:267.02});
  await prisma.tenant.update({where:{id:user.tenantId},data:{fiscalRegime:'CUOTA_FIJA'}});
  expect(await make()).toMatchObject({subtotal:267.02,tax:0,total:267.02});
 });
});
