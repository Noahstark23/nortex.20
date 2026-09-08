import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate,type AuthRequest } from '../middleware/auth.js';
import type { AssistantPrincipal } from '../../shared/assistant.js';
import { createAssistantRun,processAssistantRun,getAssistantRun,listAssistantRuns,cancelAssistantRun,recoverAssistantRun,type RunDependencies } from '../services/assistant/operations/runService.js';
import { getDailyBrief,dismissDailyBriefItem } from '../services/assistant/operations/briefing.js';

const idSchema=z.string().min(1).max(191);
const actor=(req:Request&AuthRequest):AssistantPrincipal=>({tenantId:req.tenantId??'',userId:req.userId??'',role:req.role??''});
function errorResponse(error:unknown,res:Response) {
  if(error instanceof z.ZodError){res.status(400).json({code:'OPERATIONS_INPUT',error:'Revisá los datos enviados.'});return;}
  const entry=error as {statusCode?:number;code?:string;message?:string};
  if(entry.statusCode&&entry.statusCode>=400&&entry.statusCode<500){res.status(entry.statusCode).json({code:entry.code,error:entry.message});return;}
  res.status(503).json({code:'OPERATIONS_UNAVAILABLE',error:'No pudimos completar la consulta. Conservá su referencia y volvé a comprobar el estado.'});
}
export function createAssistantOperationsRouter(deps:RunDependencies={}) {
  const router=Router();router.use(authenticate);router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
  router.post('/conversations/:id/runs',async(req,res)=>{try{
    const principal=actor(req),run=await createAssistantRun(principal,idSchema.parse(req.params.id),req.body,deps);
    res.status(run.status==='PENDING'?202:200).json(run);
    if(run.status==='PENDING')void processAssistantRun(principal,run.id,deps).catch(()=>undefined);
  }catch(error){errorResponse(error,res);}});
  router.get('/conversations/:id/runs',async(req,res)=>{try{res.json({runs:await listAssistantRuns(actor(req),idSchema.parse(req.params.id),deps)});}catch(error){errorResponse(error,res);}});
  router.get('/runs/:id',async(req,res)=>{try{res.json(await getAssistantRun(actor(req),idSchema.parse(req.params.id),deps));}catch(error){errorResponse(error,res);}});
  router.post('/runs/:id/cancel',async(req,res)=>{try{const {version}=z.object({version:z.number().int().nonnegative()}).strict().parse(req.body);res.json(await cancelAssistantRun(actor(req),idSchema.parse(req.params.id),version,deps));}catch(error){errorResponse(error,res);}});
  router.post('/runs/:id/recover',async(req,res)=>{try{z.object({}).strict().parse(req.body??{});res.json(await recoverAssistantRun(actor(req),idSchema.parse(req.params.id),deps));}catch(error){errorResponse(error,res);}});
  router.get('/daily-brief',async(req,res)=>{try{res.json(await getDailyBrief(actor(req),deps));}catch(error){errorResponse(error,res);}});
  router.post('/daily-brief/:id/dismiss',async(req,res)=>{try{const {itemId}=z.object({itemId:idSchema}).strict().parse(req.body);res.json(await dismissDailyBriefItem(actor(req),idSchema.parse(req.params.id),itemId,deps));}catch(error){errorResponse(error,res);}});
  return router;
}
