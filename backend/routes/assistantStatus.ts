import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { getAssistantHealthStatus, type AssistantStatusDependencies } from '../services/assistant/operations/healthStatus.js';

export function createAssistantStatusRouter(deps:AssistantStatusDependencies={}) {
  const router=Router();
  router.use(authenticate);
  router.use((_req,res,next)=>{res.setHeader('Cache-Control','private, no-store');next();});
  router.get('/status',async(req:any,res)=>{
    try {
      z.object({}).strict().parse(req.query);
      res.json(await getAssistantHealthStatus({tenantId:req.tenantId,userId:req.userId,role:req.role},deps));
    } catch(error:any) {
      if(error instanceof z.ZodError)return res.status(400).json({code:'INVALID_REQUEST',error:'La consulta no acepta filtros ni un negocio enviado por el navegador.'});
      if(error?.statusCode>=400 && error.statusCode<500)return res.status(error.statusCode).json({code:error.code,error:error.message});
      return res.status(503).json({code:'ASSISTANT_STATUS_UNAVAILABLE',error:'No pudimos comprobar el estado operativo.'});
    }
  });
  return router;
}
