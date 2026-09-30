import express from 'express';
import { getCommerceOperations } from '../services/whatsapp/commerce/operations.js';
import { listSupportActivationRequests, getSupportActivationRequest, transitionSupportActivationRequest } from '../services/whatsapp/commerce/activationSupport.js';
import { getCommerceActivationRequest, requestCommerceActivation } from '../services/whatsapp/commerce/activation.js';
import type { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { authenticate, type AuthRequest } from '../middleware/auth.js';
import { CommerceError, type CommerceDb, type CommercePrincipal } from '../services/whatsapp/commerce/types.js';
import { listCommerceChannels, requireCommercePrincipal, updateCommercePolicy } from '../services/whatsapp/commerce/policy.js';
import { issueCommerceQuote, reviewCommerceQuote, updateCommerceQuote } from '../services/whatsapp/commerce/quotes.js';

const id = z.string().trim().min(1).max(191);
const version = z.number().int().positive();
const policyBody = z.object({ expectedVersion: z.number().int().nonnegative(), enabled: z.boolean(), policy: z.object({
  eligibleProductIds: z.array(id).max(500), autoQuote: z.boolean(), ttlHours: z.number().int().min(1).max(168),
  maxTotal: z.string().trim().min(1).max(30), maxLines: z.number().int().min(1).max(20), eligibilityAttested: z.boolean(),
}).strict() }).strict();
const replyBody = z.object({ version, body: z.string().trim().min(1).max(4096), idempotencyKey: z.string().uuid() }).strict();
const itemsBody = z.object({ version, items: z.array(z.object({productId:id,quantity:z.string().trim().min(1).max(30),presentation:z.literal('BASE').optional()}).strict()).min(1).max(20) }).strict();
const reviewBody = z.object({version}).strict();
const issueBody = z.object({version,reviewHash:z.string().min(1).max(128)}).strict();

function actor(req: Request & AuthRequest): CommercePrincipal {
  return {tenantId:req.tenantId??'',userId:req.userId??'',role:req.role??''};
}
function fail(error: unknown, res: Response) {
  const status = error instanceof z.ZodError ? 400 : error instanceof CommerceError ? error.statusCode : 503;
  const code = error instanceof z.ZodError ? 'COMMERCE_INPUT' : error instanceof CommerceError ? error.code : 'COMMERCE_UNAVAILABLE';
  const message = status < 500 && error instanceof Error ? error.message : 'El canal comercial no está disponible. Volvé a comprobar su estado.';
  res.status(status >= 400 && status < 600 ? status : 503).json({code,error:message});
}
function route(fn: (req:Request&AuthRequest,res:Response)=>Promise<unknown>) {
  return (req:Request,res:Response)=>{ void fn(req as Request&AuthRequest,res).catch(error=>fail(error,res)); };
}
function configuredRole(principal:CommercePrincipal) {
  if(!['OWNER','ADMIN'].includes(principal.role)) throw new CommerceError('COMMERCE_ROLE','Sólo la administración puede configurar el canal.',403);
}
async function conversation(db:CommerceDb,principal:CommercePrincipal,conversationId:string) {
  const row=await db.waCommerceConversation.findFirst({where:{id:conversationId,tenantId:principal.tenantId}});
  if(!row) throw new CommerceError('COMMERCE_CONVERSATION_NOT_FOUND','Conversación no encontrada.',404);
  return row;
}

/** Montar bajo /api/whatsapp-commerce; autenticación JWT y controles de rol por petición. */
export function buildWhatsappCommerceRouter(deps:{db?:CommerceDb;now?:()=>Date}={}) {
  const db=deps.db??prisma, clock=deps.now??(()=>new Date());
  const router=express.Router();
  router.use(authenticate);
  router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
  router.get('/operations',route(async(req,res)=>{res.json(await getCommerceOperations(actor(req),db,clock()));}));
  router.get('/support/activation-requests',route(async(req,res)=>{
    const input=z.object({cursor:id.optional(),status:z.enum(['ALL','REQUESTED','IN_PROGRESS','WAITING_OWNER','PREPARED','CANCELLED']).optional()}).strict().parse(req.query);
    res.json(await listSupportActivationRequests(actor(req),input,db));
  }));
  router.get('/support/activation-requests/:id',route(async(req,res)=>{res.json({request:await getSupportActivationRequest(actor(req),id.parse(req.params.id),db)});}));
  router.post('/support/activation-requests/:id/transition',route(async(req,res)=>{
    const input=z.object({version,status:z.enum(['IN_PROGRESS','WAITING_OWNER','PREPARED','CANCELLED'])}).strict().parse(req.body);
    res.json({request:await transitionSupportActivationRequest(actor(req),id.parse(req.params.id),input,db)});
  }));
  router.get('/activation-request',route(async(req,res)=>{
    res.json({request:await getCommerceActivationRequest(actor(req),db)});
  }));
  router.post('/activation-request',route(async(req,res)=>{
    const input=z.object({phone:z.string().trim().min(1).max(32)}).strict().parse(req.body);
    const result=await requestCommerceActivation(actor(req),input,db,clock());
    res.status(result.replayed?200:201).json(result);
  }));
  router.get('/channels',route(async(req,res)=>{const principal=actor(req);await requireCommercePrincipal(principal,db);res.json({items:await listCommerceChannels(principal,db)});}));
  router.put('/channels/:id/policy',route(async(req,res)=>{const principal=actor(req);await requireCommercePrincipal(principal,db);configuredRole(principal);
    const input=policyBody.parse(req.body);res.json(await updateCommercePolicy(principal,id.parse(req.params.id),input,db,clock()));
  }));
  router.get('/channels/:id/products',route(async(req,res)=>{const principal=actor(req);await requireCommercePrincipal(principal,db);configuredRole(principal);
    const channelId=id.parse(req.params.id);const channel=await db.whatsAppChannel.findFirst({where:{id:channelId,tenantId:principal.tenantId},select:{id:true}});
    if(!channel)throw new CommerceError('COMMERCE_CHANNEL_NOT_FOUND','Canal no encontrado.',404);
    const products=await db.product.findMany({where:{tenantId:principal.tenantId,isPublished:true,requiresBatchTracking:false,requiresSerialTracking:false},orderBy:{name:'asc'},take:200,select:{id:true,name:true,sku:true,unit:true,price:true,stock:true}});
    res.json({items:products});
  }));
  router.get('/conversations',route(async(req,res)=>{const principal=actor(req);await requireCommercePrincipal(principal,db);
    const channelId=typeof req.query.channelId==='string'?id.parse(req.query.channelId):undefined;
    const status=typeof req.query.status==='string'?z.enum(['BOT','HUMAN','CLOSED']).parse(req.query.status):undefined;
    const rows=await db.waCommerceConversation.findMany({where:{tenantId:principal.tenantId,...(channelId?{channelId}:{}),...(status?{status}:{})},orderBy:{updatedAt:'desc'},take:50,
      select:{id:true,channelId:true,waId:true,status:true,version:true,assignedUserId:true,optedOutAt:true,lastInboundAt:true,updatedAt:true}});
    res.json({items:rows});
  }));
  router.get('/conversations/:id',route(async(req,res)=>{const principal=actor(req);await requireCommercePrincipal(principal,db);const row=await conversation(db,principal,id.parse(req.params.id));
    const [inbox,outbox,drafts]=await Promise.all([
      db.waCommerceInbox.findMany({where:{tenantId:principal.tenantId,conversationId:row.id},orderBy:{sequence:'desc'},take:50,select:{id:true,body:true,status:true,eventAt:true,createdAt:true,errorCode:true}}),
      db.waCommerceOutbox.findMany({where:{tenantId:principal.tenantId,conversationId:row.id},orderBy:{sequence:'desc'},take:50,select:{id:true,body:true,status:true,createdAt:true,updatedAt:true,errorCode:true,actorUserId:true,quoteDraftId:true,providerMessageId:true}}),
      db.waCommerceQuoteDraft.findMany({where:{tenantId:principal.tenantId,conversationId:row.id},orderBy:{createdAt:'desc'},take:50,select:{id:true,version:true,status:true,items:true,snapshot:true,reviewHash:true,quotationId:true,createdAt:true,updatedAt:true}}),
    ]);
    const attempts=outbox.length ? await db.waCommerceOutboxAttempt.findMany({where:{tenantId:principal.tenantId,outboxId:{in:outbox.map(o=>o.id)}},orderBy:{claimedAt:'desc'},take:100,select:{id:true,outboxId:true,claimedAt:true,invokedAt:true,settledAt:true,status:true,providerMessageId:true,errorCode:true}}) : [];
    res.json({conversation:row,inbox:inbox.reverse(),outbox:outbox.reverse(),drafts,attempts});
  }));
  router.post('/conversations/:id/claim',route(async(req,res)=>{const principal=actor(req);await requireCommercePrincipal(principal,db);
    const {version:expected}=reviewBody.parse(req.body);const row=await conversation(db,principal,id.parse(req.params.id));
    if(row.optedOutAt)throw new CommerceError('COMMERCE_OPT_OUT','El comprador no acepta mensajes.',409);
    const changed=await db.waCommerceConversation.updateMany({where:{id:row.id,tenantId:principal.tenantId,version:expected,status:{in:['BOT','HUMAN']},OR:[{assignedUserId:null},{assignedUserId:principal.userId}]},data:{status:'HUMAN',assignedUserId:principal.userId,version:{increment:1}}});
    if(changed.count!==1)throw new CommerceError('COMMERCE_VERSION','La conversación cambió. Actualizá antes de tomarla.',409);
    res.json({conversation:await conversation(db,principal,row.id)});
  }));
  router.post('/conversations/:id/release',route(async(req,res)=>{const principal=actor(req);await requireCommercePrincipal(principal,db);
    const {version:expected}=reviewBody.parse(req.body);const row=await conversation(db,principal,id.parse(req.params.id));
    const changed=await db.waCommerceConversation.updateMany({where:{id:row.id,tenantId:principal.tenantId,version:expected,status:'HUMAN',assignedUserId:principal.userId},data:{status:'BOT',assignedUserId:null,version:{increment:1}}});
    if(changed.count!==1)throw new CommerceError('COMMERCE_VERSION','La conversación cambió. Actualizá antes de liberarla.',409);
    res.json({conversation:await conversation(db,principal,row.id)});
  }));
  router.post('/conversations/:id/reply',route(async(req,res)=>{const principal=actor(req);await requireCommercePrincipal(principal,db);
    const input=replyBody.parse(req.body),conversationId=id.parse(req.params.id),pre=await conversation(db,principal,conversationId),now=clock();
    const result=await db.$transaction(async tx=>{
      // Mismo orden de locks que las otras mutaciones del canal: canal y luego conversación.
      await tx.$queryRaw`SELECT id FROM WhatsAppChannel WHERE id = ${pre.channelId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM WaCommerceConversation WHERE id = ${conversationId} FOR UPDATE`;
      await requireCommercePrincipal(principal,tx as CommerceDb);
      const row=await conversation(tx as CommerceDb,principal,conversationId);
      const existing=await tx.waCommerceOutbox.findUnique({where:{idempotencyKey:input.idempotencyKey},select:{id:true,tenantId:true,conversationId:true,body:true,actorUserId:true,status:true}});
      if(existing){
        if(existing.tenantId!==principal.tenantId||existing.conversationId!==row.id||existing.actorUserId!==principal.userId||existing.body!==input.body)throw new CommerceError('COMMERCE_IDEMPOTENCY','La clave ya pertenece a otra respuesta.',409);
        return {id:existing.id,status:existing.status,replayed:true};
      }
      if(row.optedOutAt)throw new CommerceError('COMMERCE_OPT_OUT','El comprador no acepta mensajes.',409);
      if(row.status!=='HUMAN'||row.assignedUserId!==principal.userId)throw new CommerceError('COMMERCE_ASSIGNMENT','Tomá la conversación antes de responder.',409);
      if(row.version!==input.version)throw new CommerceError('COMMERCE_VERSION','La conversación cambió. Actualizá antes de responder.',409);
      const expiry=new Date(row.lastInboundAt.getTime()+23*60*60*1000);
      if(expiry<=now)throw new CommerceError('COMMERCE_WINDOW','La ventana de respuesta venció.',409);
      const channel=await tx.whatsAppChannel.findFirst({where:{id:row.channelId,tenantId:principal.tenantId,active:true,commerceEnabled:true},select:{commercePolicyVersion:true}});
      if(!channel)throw new CommerceError('COMMERCE_CHANNEL_DISABLED','El canal está deshabilitado.',409);
      const created=await tx.waCommerceOutbox.create({data:{idempotencyKey:input.idempotencyKey,tenantId:principal.tenantId,channelId:row.channelId,conversationId:row.id,waId:row.waId,body:input.body,status:'PENDING',policyVersion:channel.commercePolicyVersion,actorUserId:principal.userId,expiresAt:expiry},select:{id:true,status:true}});
      return {...created,replayed:false};
    });
    res.status(result.replayed?200:201).json({outboxId:result.id,status:result.status});
  }));
  router.post('/drafts/:id/update',route(async(req,res)=>{const principal=actor(req);await requireCommercePrincipal(principal,db);const input=itemsBody.parse(req.body);
    res.json(await updateCommerceQuote(principal,id.parse(req.params.id),input.version,input.items,db,clock()));
  }));
  router.post('/drafts/:id/review',route(async(req,res)=>{const principal=actor(req);await requireCommercePrincipal(principal,db);const input=reviewBody.parse(req.body);
    res.json(await reviewCommerceQuote(principal,id.parse(req.params.id),input.version,db,clock()));
  }));
  router.post('/drafts/:id/issue',route(async(req,res)=>{const principal=actor(req);await requireCommercePrincipal(principal,db);const input=issueBody.parse(req.body);
    const result=await issueCommerceQuote(principal,id.parse(req.params.id),input.version,input.reviewHash,db,clock());res.status(201).json(result);
  }));
  return router;
}
