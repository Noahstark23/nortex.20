import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import type { AssistantPrincipal } from '../../shared/assistant.js';
import { getAssistantCatalogOptions, type CatalogOptionsDependencies } from '../services/assistant/operations/catalogOptions.js';
import { approveAssistantCatalogAlias } from '../services/assistant/operations/catalogSearch.js';

export function createAssistantCatalogRouter(deps:CatalogOptionsDependencies={}) {
  const router=Router();
  router.use(authenticate);
  router.use((_req,res,next)=>{res.setHeader('Cache-Control','private, no-store');next();});
  const principal=(req:any):AssistantPrincipal=>({tenantId:req.tenantId,userId:req.userId,role:req.role});
  const respond=(error:any,res:any)=>{
    if (error instanceof z.ZodError) return res.status(400).json({code:'INVALID_REQUEST',error:'Revisá los datos de la búsqueda.'});
    const status=error?.statusCode ?? error?.httpStatus;
    if (status>=400 && status<500) return res.status(status).json({code:error.code??'CATALOG_REJECTED',error:error.message});
    return res.status(503).json({code:'CATALOG_UNAVAILABLE',error:'No pudimos consultar el catálogo. Volvé a intentar.'});
  };
  router.get('/catalog',async(req,res)=>{try{res.json(await getAssistantCatalogOptions(principal(req),req.query,deps));}catch(error){respond(error,res);}});
  router.post('/catalog/aliases',async(req,res)=>{try{res.json(await approveAssistantCatalogAlias(principal(req),req.body,deps.db));}catch(error){respond(error,res);}});
  return router;
}
