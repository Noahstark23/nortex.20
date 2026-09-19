import express from 'express';
import { z } from 'zod';
import { authenticate, type AuthRequest } from '../middleware/auth.js';
import { AssistantDocumentError, DOCUMENT_MEDIA_TYPES, MAX_ATTACHMENT_BYTES, getAssistantAttachment, readAssistantAttachment, saveAssistantAttachment } from '../services/assistant/attachments.js';
import { enqueueInvoiceExtraction, getInvoiceExtraction } from '../services/assistant/worker.js';
import type { AssistantPrincipal } from '../../shared/assistant.js';

function principal(req:AuthRequest):AssistantPrincipal {
  if(!req.tenantId||!req.userId||!req.role) throw new AssistantDocumentError('UNAUTHENTICATED','Iniciá sesión para usar NortexGPT.',401);
  return {tenantId:req.tenantId,userId:req.userId,role:req.role};
}
const extractionRequest=z.object({attachmentIds:z.array(z.string().min(1).max(191)).min(1).max(10),conversationId:z.string().min(1).max(191).optional()}).strict();
export function buildAssistantDocumentsRouter() {
  const router=express.Router();
  router.use(authenticate);
  router.post('/attachments',express.raw({type:[...DOCUMENT_MEDIA_TYPES],limit:MAX_ATTACHMENT_BYTES}),async(req,res,next)=>{
    try {
      if(!Buffer.isBuffer(req.body)) throw new AssistantDocumentError('FILE_FORMAT','Subí el PDF o la imagen original.',415);
      let name='factura';
      try {name=decodeURIComponent(req.header('X-File-Name')??'factura');} catch {throw new AssistantDocumentError('FILE_NAME','El nombre del archivo no es válido.',400);}
      const row=await saveAssistantAttachment(principal(req),req.body,(req.header('Content-Type')??'').split(';')[0].trim().toLowerCase(),name);
      res.status(201).json(row);
    } catch(error) {next(error);}
  });
  router.get('/attachments/:id/download',async(req,res,next)=>{
    try {
      const {row,bytes}=await readAssistantAttachment(principal(req),String(req.params.id));
      res.set({'Content-Type':row.mediaType,'Content-Length':String(bytes.length),'Content-Disposition':`attachment; filename="factura"; filename*=UTF-8''${encodeURIComponent(row.name)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}).send(bytes);
    } catch(error) {next(error);}
  });
  router.get('/attachments/:id',async(req,res,next)=>{
    try {res.set('Cache-Control','private, no-store').json(await getAssistantAttachment(principal(req),String(req.params.id)));} catch(error) {next(error);}
  });
  router.post('/extractions',async(req,res,next)=>{
    try { const parsed=extractionRequest.safeParse(req.body); if(!parsed.success) throw new AssistantDocumentError('DOCUMENT_IDS','Seleccioná los archivos de la factura.',400); res.status(202).json(await enqueueInvoiceExtraction(principal(req),parsed.data.attachmentIds,{},parsed.data.conversationId)); }
    catch(error) {next(error);}
  });
  router.get('/extractions/:id',async(req,res,next)=>{
    try {res.json(await getInvoiceExtraction(principal(req),String(req.params.id)));} catch(error) {next(error);}
  });
  router.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
    const e=error as {status?:number;statusCode?:number;code?:string;type?:string;message?:string};
    if(e.type==='entity.too.large') {res.status(413).json({code:'FILE_SIZE',error:'La factura admite hasta 10 MB.'});return;}
    const status=e.statusCode??e.status;
    if(status&&status>=400&&status<500) {res.status(status).json({code:e.code??'DOCUMENT_REQUEST',error:e.message??'No se pudo procesar la factura.'});return;}
    res.status(status===503?503:500).json({code:'DOCUMENT_UNAVAILABLE',error:'No se pudo procesar la factura. Intentá de nuevo.'});
  });
  return router;
}
export default buildAssistantDocumentsRouter;
