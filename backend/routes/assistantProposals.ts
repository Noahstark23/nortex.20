import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { assertAssistantAccess } from '../services/assistant/access.js';
import { getProposal, reviseProposal, confirmProposal, getOperation } from '../services/assistant/proposals.js';
import type { AssistantPrincipal } from '../../shared/assistant';

const principal = (req: any): AssistantPrincipal => ({tenantId:req.tenantId,userId:req.userId,role:req.role});
const idSchema = z.string().min(1).max(191);
const revisionSchema = z.object({version:z.number().int().positive(),draft:z.unknown()}).strict();
const confirmationSchema = z.object({version:z.number().int().positive(),idempotencyKey:z.uuid().transform(value=>value.toLowerCase())}).strict();
function respond(error: any, res: any) {
  if (error instanceof z.ZodError) return res.status(400).json({code:'INVALID_REQUEST',error:'Revisá los datos enviados.'});
  const status = error?.statusCode ?? error?.httpStatus;
  if (status >= 400 && status < 500) return res.status(status).json({code:error.code ?? 'PURCHASE_REJECTED',error:error.message});
  if (error?.message === 'FACTURA_DUPLICADA' || error?.code === 'P2002') return res.status(409).json({code:'PURCHASE_DUPLICATE',error:'La factura ya está registrada. Revisá Compras.'});
  if (error?.name === 'PeriodLockedError') return res.status(423).json({code:'PERIOD_LOCKED',error:'El período contable está cerrado.'});
  return res.status(500).json({code:'ASSISTANT_UNAVAILABLE',error:'No pudimos completar la operación. Conservá la referencia y volvé a comprobar su estado.'});
}
export function createAssistantProposalsRouter() {
  const router = Router();
  router.use(authenticate);
  router.get('/proposals/:id', async(req,res)=> {try {res.json(await getProposal(principal(req),idSchema.parse(req.params.id)));}catch(error){respond(error,res);}});
  router.patch('/proposals/:id',async(req,res)=> {try {const body=revisionSchema.parse(req.body);res.json(await reviseProposal(principal(req),idSchema.parse(req.params.id),body.version,body.draft));}catch(error){respond(error,res);}});
  router.post('/proposals/:id/confirm',async(req,res)=> {try {const body=confirmationSchema.parse(req.body);res.json(await confirmProposal(principal(req),idSchema.parse(req.params.id),body.version,body.idempotencyKey));}catch(error){respond(error,res);}});
  router.get('/operations/:id',async(req,res)=> {try {res.json(await getOperation(principal(req),z.uuid().parse(req.params.id)));}catch(error){respond(error,res);}});
  router.get('/catalog',async(req,res)=> {
    try {
      const actor = principal(req);
      await assertAssistantAccess(actor,'purchasePrepare');
      const {kind,query,supplierId} = z.object({kind:z.enum(['products','suppliers','warehouses','purchaseOrders']),query:z.string().trim().max(100).default(''),supplierId:z.string().max(191).optional()}).parse(req.query);
      const tenantId = actor.tenantId;
      if (kind === 'products') {
        const rows = await prisma.product.findMany({where:{tenantId,...(query ? {OR:[{name:{contains:query}},{sku:{contains:query}}]} : {})},take:20,orderBy:[{name:'asc'},{id:'asc'}],
          select:{id:true,name:true,sku:true,unit:true,packSize:true,requiresBatchTracking:true}});
        return res.json({items:rows.map(row=>({id:row.id,label:row.name,detail:row.sku ?? row.unit,unit:row.unit,packSize:row.packSize,requiresBatchTracking:row.requiresBatchTracking}))});
      }
      if (kind === 'suppliers') {
        const rows = await prisma.supplier.findMany({where:{tenantId,status:'ACTIVE',deletedAt:null,...(query ? {name:{contains:query}} : {})},take:20,orderBy:[{name:'asc'},{id:'asc'}],select:{id:true,name:true}});
        return res.json({items:rows.map(row=>({id:row.id,label:row.name}))});
      }
      if (kind === 'warehouses') {
        const rows = await prisma.warehouse.findMany({where:{tenantId,isActive:true,...(query ? {name:{contains:query}} : {})},take:20,orderBy:[{name:'asc'},{id:'asc'}],select:{id:true,name:true}});
        return res.json({items:rows.map(row=>({id:row.id,label:row.name}))});
      }
      const rows = await prisma.purchaseOrder.findMany({where:{tenantId,status:{in:['RECEIVED','PARTIALLY_RECEIVED']},...(supplierId?{supplierId}:{}),...(query?{orderNumber:{contains:query}}:{})},take:20,orderBy:{createdAt:'desc'},
        select:{id:true,orderNumber:true,supplierId:true,items:{take:200,select:{id:true,productId:true,productName:true}}}});
      return res.json({items:rows.map(row=>({id:row.id,label:row.orderNumber,supplierId:row.supplierId,items:row.items.map(item=>({id:item.id,productId:item.productId,label:item.productName}))}))});
    } catch(error) {respond(error,res);}
  });
  return router;
}
