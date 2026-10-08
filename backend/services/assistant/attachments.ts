import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, realpath, unlink } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { constants } from 'node:fs';
import prisma from '../../lib/prisma.js';
import { assertAssistantAccess } from './access.js';
import type { AssistantPrincipal, AssistantAttachmentDTO } from '../../../shared/assistant.js';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_INVOICE_PAGES = 10;
export const DOCUMENT_RETENTION_MS = 7 * 86400_000;
export const DOCUMENT_MEDIA_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export type DocumentMediaType = typeof DOCUMENT_MEDIA_TYPES[number];
export class AssistantDocumentError extends Error {
  readonly statusCode:number;
  constructor(public code: string, message: string, public status = 422) { super(message); this.statusCode=status; }
}
export interface AttachmentDependencies { db?: typeof prisma; storageRoot?: string; now?: () => Date }

function storageRoot(configured?: string): string {
  const root = configured ?? process.env.NORTEX_ASSISTANT_STORAGE_DIR;
  if (!root && process.env.NODE_ENV === 'production') throw new AssistantDocumentError('STORAGE_UNAVAILABLE', 'El almacenamiento privado no está configurado.', 503);
  const target = root ?? join(tmpdir(), 'nortex-assistant-private');
  if (!isAbsolute(target)) throw new AssistantDocumentError('STORAGE_UNAVAILABLE', 'El almacenamiento requiere una ruta absoluta.', 503);
  const within = relative(resolve(process.cwd()), resolve(target));
  if (!within.startsWith('..') && !isAbsolute(within)) throw new AssistantDocumentError('STORAGE_UNAVAILABLE', 'El almacenamiento privado debe estar fuera del proyecto.', 503);
  return resolve(target);
}

export function validateAttachmentEnvelope(bytes: Buffer, claimedType: string): DocumentMediaType {
  if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES) throw new AssistantDocumentError('FILE_SIZE', 'La factura debe ocupar entre 1 byte y 10 MB.', 413);
  let detected: DocumentMediaType | undefined;
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') detected = 'application/pdf';
  else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9) detected = 'image/jpeg';
  else if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.length >= 45 && bytes.subarray(-8,-4).toString('ascii') === 'IEND') detected = 'image/png';
  if (!detected || detected !== claimedType) throw new AssistantDocumentError('FILE_FORMAT', 'El contenido no corresponde a un PDF o imagen compatible y completo.');
  return detected;
}

export function attachmentDTO(row: {id:string; name:string; mediaType:string; bytes:number; pages:number; status:string}): AssistantAttachmentDTO {
  return {id:row.id,name:row.name,mediaType:row.mediaType,bytes:row.bytes,pages:row.pages,status:row.status};
}

export async function saveAssistantAttachment(principal: AssistantPrincipal, bytes: Buffer, mediaType: string, name: string, deps: AttachmentDependencies = {}): Promise<AssistantAttachmentDTO> {
  const db = deps.db ?? prisma;
  await assertAssistantAccess(principal, 'invoicePrepare', db);
  const verifiedType = validateAttachmentEnvelope(bytes, mediaType);
  const safeName = Array.from(name.normalize('NFC').replace(/[\x00-\x1f\x7f\\/]/g, '_').trim()).slice(0, 180).join('') || 'factura';
  const root = storageRoot(deps.storageRoot);
  await mkdir(root, { recursive:true, mode:0o700 });
  // El path real tampoco puede volver al proyecto mediante un symlink.
  storageRoot(await realpath(root));
  const storageKey = randomUUID();
  const file = await open(join(root, storageKey), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  let written=false;
  try { await file.writeFile(bytes); await file.sync(); written=true; }
  finally { await file.close(); if(!written)await unlink(join(root,storageKey)).catch(()=>undefined); }
  try {
    const now = deps.now?.() ?? new Date();
    const row = await db.assistantAttachment.create({ data: {
      tenantId:principal.tenantId,userId:principal.userId,roleAtCreation:principal.role,
      name:safeName,mediaType:verifiedType,storageKey,sha256:createHash('sha256').update(bytes).digest('hex'),
      bytes:bytes.length,pages:verifiedType === 'application/pdf' ? 0 : 1,status:'UPLOADED',
      expiresAt:new Date(now.getTime()+DOCUMENT_RETENTION_MS),
    }});
    return attachmentDTO(row);
  } catch (error) { await unlink(join(root, storageKey)).catch(() => undefined); throw error; }
}

async function findReadableAttachment(principal: AssistantPrincipal, id: string, deps: AttachmentDependencies = {}) {
  const db = deps.db ?? prisma;
  await assertAssistantAccess(principal, 'invoiceRead', db);
  const row = await db.assistantAttachment.findFirst({where:{id,tenantId:principal.tenantId,userId:principal.userId,roleAtCreation:principal.role}});
  const now = deps.now?.() ?? new Date();
  if (!row || ['DELETING','DELETED'].includes(row.status) || (!row.purchaseId && row.expiresAt && row.expiresAt <= now)) throw new AssistantDocumentError('ATTACHMENT_NOT_FOUND', 'No se encontró una factura disponible.', 404);
  return row;
}

export async function getAssistantAttachment(principal:AssistantPrincipal,id:string,deps:AttachmentDependencies={}):Promise<AssistantAttachmentDTO> {
  return attachmentDTO(await findReadableAttachment(principal,id,deps));
}

export async function readAssistantAttachment(principal: AssistantPrincipal, id: string, deps: AttachmentDependencies = {}) {
  const row=await findReadableAttachment(principal,id,deps);
  if (!/^[0-9a-f-]{36}$/i.test(row.storageKey)) throw new AssistantDocumentError('STORAGE_UNAVAILABLE','No se pudo abrir la factura.',503);
  const root = storageRoot(deps.storageRoot);
  storageRoot(await realpath(root));
  const handle = await open(join(root,row.storageKey), constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes: Buffer;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== row.bytes || stat.size > MAX_ATTACHMENT_BYTES) throw new AssistantDocumentError('FILE_INTEGRITY', 'La factura almacenada no coincide con el original.');
    bytes = await handle.readFile();
  } finally { await handle.close(); }
  if (createHash('sha256').update(bytes).digest('hex') !== row.sha256) throw new AssistantDocumentError('FILE_INTEGRITY','La factura almacenada no coincide con el original.');
  return { row, bytes };
}

/** Solo datos efímeros: los originales de compras confirmadas nunca se eliminan. */
export async function cleanupExpiredAttachments(deps: AttachmentDependencies = {}): Promise<number> {
  const db = deps.db ?? prisma;
  const now = deps.now?.() ?? new Date();
  const rows = await db.assistantAttachment.findMany({where:{purchaseId:null,expiresAt:{lte:now},status:{in:['UPLOADED','VALIDATED','DELETING']}},orderBy:{expiresAt:'asc'},take:100});
  if (!rows.length) return 0;
  const root = storageRoot(deps.storageRoot);
  let deleted = 0;
  for (const row of rows) {
    const claimed = await db.assistantAttachment.updateMany({where:{id:row.id,tenantId:row.tenantId,purchaseId:null,expiresAt:{lte:now}},data:{status:'DELETING'}});
    if (!claimed.count) continue;
    if (!/^[0-9a-f-]{36}$/i.test(row.storageKey)) continue;
    try { await unlink(join(root,row.storageKey)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') continue; }
    await db.assistantAttachment.updateMany({where:{id:row.id,tenantId:row.tenantId,purchaseId:null,status:'DELETING'},data:{status:'DELETED'}});
    deleted++;
  }
  return deleted;
}

/** La captura vencida es efímera; las propuestas COMMITTED conservan siempre su evidencia. */
export async function cleanupAssistantHistory(deps:AttachmentDependencies={}):Promise<{conversations:number;jobs:number;proposals:number}> {
  const db=deps.db??prisma,now=deps.now?.()??new Date();
  const conversations=await db.assistantConversation.findMany({where:{expiresAt:{lte:now}},orderBy:{expiresAt:'asc'},select:{id:true,tenantId:true},take:100});
  let removedConversations=0,removedJobs=0,removedProposals=0;
  for(const row of conversations) {
    const result=await db.assistantConversation.deleteMany({where:{id:row.id,tenantId:row.tenantId,expiresAt:{lte:now}}});
    removedConversations+=result.count;
  }
  const before=new Date(now.getTime()-DOCUMENT_RETENTION_MS);
  const jobs=await db.assistantJob.findMany({where:{status:{in:['SUCCEEDED','FAILED']},updatedAt:{lte:before}},orderBy:{updatedAt:'asc'},select:{id:true,tenantId:true},take:100});
  for(const row of jobs) {
    const result=await db.assistantJob.deleteMany({where:{id:row.id,tenantId:row.tenantId,status:{in:['SUCCEEDED','FAILED']},updatedAt:{lte:before}}});
    removedJobs+=result.count;
  }
  const proposals=await db.assistantProposal.findMany({
    where:{expiresAt:{lte:now},status:{in:['DRAFT','READY','CANCELLED','EXPIRED']}},
    orderBy:{expiresAt:'asc'},select:{id:true,tenantId:true,status:true},take:100,
  });
  for(const row of proposals) {
    // Revalidar estado y vencimiento en el DELETE evita competir con una confirmación o renovación.
    const result=await db.assistantProposal.deleteMany({where:{id:row.id,tenantId:row.tenantId,status:row.status,expiresAt:{lte:now}}});
    removedProposals+=result.count;
  }
  return{conversations:removedConversations,jobs:removedJobs,proposals:removedProposals};
}
