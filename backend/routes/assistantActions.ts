import { Router, type Response } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { authenticate, type AuthRequest } from '../middleware/auth.js';
import { prepareAssistantAction, getAssistantAction, reviseAssistantAction, previewAssistantAction, confirmAssistantAction } from '../services/assistant/actions/service.js';
import type { AssistantPrincipal } from '../../shared/assistant.js';

const id = z.string().min(1).max(191);
const version = z.number().int().positive();
const requestKey = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/);
const actor = (req: AuthRequest): AssistantPrincipal => ({tenantId:req.tenantId ?? '',userId:req.userId ?? '',role:req.role ?? ''});
const prepare = z.object({kind:z.enum(['PURCHASE_ORDER_DRAFT','BATCH_WRITEOFF','SUPPLIER_RETURN','PROMOTION']),draft:z.unknown(),requestKey}).strict();
const revision = z.object({version,draft:z.unknown()}).strict();
// La confirmación nunca acepta productos, cantidades, precios ni efectos nuevos.
const confirmation = z.object({version,requestKey}).strict();
function failure(error: unknown, res: Response) {
  if(error instanceof z.ZodError) return res.status(400).json({code:'ACTION_INVALID_INPUT',error:'Revisá los datos enviados.'});
  const value = error as {statusCode?:number;httpStatus?:number;code?:string;message?:string;name?:string};
  const status = value.statusCode ?? value.httpStatus;
  if(status && status >= 400 && status < 500) return res.status(status).json({code:value.code ?? 'ACTION_REJECTED',error:value.message});
  if(value.name === 'PeriodLockedError') return res.status(423).json({code:'PERIOD_LOCKED',error:'El período contable está cerrado.'});
  return res.status(503).json({code:'ACTION_UNAVAILABLE',error:'No pudimos comprobar la operación. Conservá la propuesta y consultá su estado antes de volver a intentarlo.'});
}
export function createAssistantActionsRouter(db: PrismaClient = prisma) {
  const router = Router();
  router.use(authenticate);
  router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
  router.post('/action-proposals',async(req,res)=>{try{
    const body=prepare.parse(req.body);
    res.status(201).json(await prepareAssistantAction(actor(req),body.kind,body.draft,body.requestKey,db));
  }catch(error){failure(error,res);}});
  router.get('/action-proposals/:id',async(req,res)=>{try{
    res.json(await getAssistantAction(actor(req),id.parse(req.params.id),db));
  }catch(error){failure(error,res);}});
  router.patch('/action-proposals/:id',async(req,res)=>{try{
    const body=revision.parse(req.body);
    res.json(await reviseAssistantAction(actor(req),id.parse(req.params.id),body.version,body.draft,db));
  }catch(error){failure(error,res);}});
  router.post('/action-proposals/:id/preview',async(req,res)=>{try{
    const body=z.object({version}).strict().parse(req.body);
    res.json(await previewAssistantAction(actor(req),id.parse(req.params.id),body.version,db));
  }catch(error){failure(error,res);}});
  router.post('/action-proposals/:id/confirm',async(req,res)=>{try{
    const body=confirmation.parse(req.body);
    res.json(await confirmAssistantAction(actor(req),id.parse(req.params.id),body.version,body.requestKey,db));
  }catch(error){failure(error,res);}});
  return router;
}
