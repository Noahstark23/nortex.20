import express from 'express';
import type {Request,Response} from 'express';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { authenticate,type AuthRequest } from '../middleware/auth.js';
import { assertAssistantAccess } from '../services/assistant/access.js';
import { issuePrivateWaChallenge,getPrivateWaBinding,revokePrivateWaBinding } from '../services/assistant/privateWhatsapp/identity.js';
import { acceptPrivateWaWebhook } from '../services/assistant/privateWhatsapp/inbox.js';
import { privateWhatsappConfig,requirePrivateWhatsapp } from '../services/assistant/privateWhatsapp/config.js';
import type { PrivateWaDependencies } from '../services/assistant/privateWhatsapp/types.js';

const principal=(req:Request&AuthRequest)=>({tenantId:req.tenantId??'',userId:req.userId??'',role:req.role??''});
function failure(error:unknown,res:Response) {
  const status=error&&typeof error==='object'&&'statusCode'in error?Number(error.statusCode):error instanceof z.ZodError?400:503;
  const code=error&&typeof error==='object'&&'code'in error?String(error.code):'PRIVATE_WA_UNAVAILABLE';
  res.status(status>=400&&status<500?status:503).json({code,error:status>=400&&status<500&&error instanceof Error?error.message:'El canal privado no está disponible. Intentá de nuevo.'});
}
/** Componer ANTES de express.json; conserva bytes exactos de la firma. */
export function buildAssistantPrivateWhatsappWebhookRouter(deps:PrivateWaDependencies={}) {
  const router=express.Router();
  router.get('/webhook',(req,res)=>{
    try {const config=deps.config??privateWhatsappConfig();requirePrivateWhatsapp(config);const token=typeof req.query['hub.verify_token']==='string'?req.query['hub.verify_token']:'';
      const expected=Buffer.from(config.verifyToken),actual=Buffer.from(token);
      if(!expected.length||expected.length!==actual.length||!timingSafeEqual(expected,actual)||req.query['hub.mode']!=='subscribe')return res.sendStatus(403);
      return res.status(200).send(String(req.query['hub.challenge']??'').slice(0,1024));
    }catch(error){failure(error,res);}
  });
  router.post('/webhook',express.raw({type:'application/json',limit:'256kb'}),async(req,res)=>{
    try {if(!Buffer.isBuffer(req.body))return res.sendStatus(400);await acceptPrivateWaWebhook(req.body,req.get('x-hub-signature-256'),deps);res.sendStatus(200);}catch(error){failure(error,res);}
  });
  return router;
}
export function buildAssistantPrivateWhatsappRouter(deps:PrivateWaDependencies={}) {
  const router=express.Router();router.use(authenticate);router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
  router.get('/binding',async(req,res)=>{try{res.json(await getPrivateWaBinding(principal(req),deps));}catch(error){failure(error,res);}});
  router.post('/challenge',async(req,res)=>{try{z.object({}).strict().parse(req.body??{});res.status(201).json(await issuePrivateWaChallenge(principal(req),deps));}catch(error){failure(error,res);}});
  router.delete('/binding',async(req,res)=>{try{z.object({}).strict().parse(req.body??{});res.json(await revokePrivateWaBinding(principal(req),deps));}catch(error){failure(error,res);}});
  router.get('/deliveries',async(req,res)=>{try{const actor=principal(req),db=deps.db??prisma;await assertAssistantAccess(actor,'help',db);const rows=await db.assistantWaOutbox.findMany({where:{tenantId:actor.tenantId,userId:actor.userId,roleAtCreation:actor.role},orderBy:{createdAt:'desc'},take:20,select:{id:true,status:true,createdAt:true,errorCode:true}});res.json({items:rows});}catch(error){failure(error,res);}});
  return router;
}
