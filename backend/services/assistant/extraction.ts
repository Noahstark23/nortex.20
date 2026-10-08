import { z } from 'zod';
import { inflate } from 'node:zlib';
import { promisify } from 'node:util';
import type { InvoiceDraft } from '../../../shared/assistant.js';
import { AssistantDocumentError, MAX_INVOICE_PAGES, validateAttachmentEnvelope, type DocumentMediaType } from './attachments.js';

const text = z.string().max(500);
const decimal = z.string().regex(/^\d{1,12}(?:\.\d{1,6})?$/);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** El modelo extrae texto, nunca IDs, permisos, confirmaciones o instrucciones. */
export const invoiceExtractionSchema = z.object({
  oneInvoice:z.boolean(), complete:z.boolean(),
  draft:z.object({
    currency:z.string().max(8), supplierName:text.optional(), invoiceNumber:z.string().max(100),
    date:day, dueDate:day.optional(), documentSubtotal:decimal.optional(), documentTax:decimal.optional(), documentTotal:decimal,
    discount:decimal.optional(), freight:decimal.optional(), otherCharges:decimal.optional(),
    items:z.array(z.object({description:text,quantity:decimal,unitCost:decimal,purchaseUnit:z.enum(['BASE','PACK']),batchNumber:z.string().max(100).optional(),expiryDate:day.optional()}).strict()).min(1).max(200),
    warnings:z.array(z.string().max(500)).max(100),
  }).strict(),
}).strict();

export function parseInvoiceExtraction(value: unknown): InvoiceDraft {
  const parsed = invoiceExtractionSchema.safeParse(value);
  if (!parsed.success) throw new AssistantDocumentError('EXTRACTION_INVALID', 'No se pudo leer una factura completa con campos válidos. Revisá el documento en Compras.');
  if (!parsed.data.oneInvoice) throw new AssistantDocumentError('MULTIPLE_INVOICES', 'Adjuntá una sola factura por lectura, sin páginas duplicadas.');
  if (!parsed.data.complete) throw new AssistantDocumentError('INCOMPLETE_INVOICE', 'La factura está incompleta o ilegible. Adjuntá una copia completa.');
  return {...parsed.data.draft, receivedConfirmed:false,paymentConfirmed:false};
}

export interface VerifiedInvoiceFile { mediaType:DocumentMediaType; bytes:Buffer; pages:number }

async function validatePngPayload(bytes:Buffer) {
  if(bytes.readUInt32BE(8)!==13 || bytes.subarray(12,16).toString('ascii')!=='IHDR') throw new Error('png header');
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20),depth=bytes[24],color=bytes[25],interlace=bytes[28];
  const channels=({0:1,2:3,3:1,4:2,6:4} as Record<number,number>)[color];
  if(!width||!height||width*height>25_000_000||!channels||![1,2,4,8,16].includes(depth)||bytes[26]!==0||bytes[27]!==0||interlace>1) throw new Error('png dimensions');
  if(([2,4,6].includes(color)&&depth<8)||(color===3&&depth===16)) throw new Error('png depth');
  let cursor=8,header=false,ended=false;
  const chunks:Buffer[]=[];
  while(cursor+12<=bytes.length) {
    const length=bytes.readUInt32BE(cursor),type=bytes.subarray(cursor+4,cursor+8).toString('ascii');
    if(cursor+12+length>bytes.length||ended||['acTL','fcTL','fdAT'].includes(type)) throw new Error('png chunk');
    // CRC verifica tanto metadatos como el stream comprimido del original.
    let crc=0xffffffff;
    for(let i=cursor+4;i<cursor+8+length;i++) {
      crc^=bytes[i];for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
    }
    if(((crc^0xffffffff)>>>0)!==bytes.readUInt32BE(cursor+8+length)) throw new Error('png crc');
    if(type==='IHDR') {if(header||cursor!==8)throw new Error('png header');header=true;}
    if(type==='IDAT')chunks.push(bytes.subarray(cursor+8,cursor+8+length));
    if(type==='IEND') {if(length!==0)throw new Error('png end');ended=true;}
    cursor+=12+length;
  }
  if(cursor!==bytes.length||!ended||!chunks.length)throw new Error('png incomplete');
  const passes=interlace?[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]]:[[0,0,1,1]];
  let expected=0;
  for(const [x,y,dx,dy] of passes) {
    const w=Math.max(0,Math.ceil((width-x)/dx)),h=Math.max(0,Math.ceil((height-y)/dy));
    if(w&&h)expected+=(Math.ceil(w*channels*depth/8)+1)*h;
  }
  if(expected>128*1024*1024)throw new Error('png memory');
  // La descompresión acotada precede al decoder: dimensiones falsas no habilitan un zip bomb.
  const pixels=await promisify(inflate)(Buffer.concat(chunks),{maxOutputLength:expected});
  if(pixels.length!==expected)throw new Error('png truncated pixels');
}

/** Se ejecuta en el worker; el handler web solamente valida el sobre y persiste. */
export async function validateInvoiceFile(bytes: Buffer, mediaType: string): Promise<VerifiedInvoiceFile> {
  const type = validateAttachmentEnvelope(bytes,mediaType);
  if (type === 'application/pdf') {
    if (!/%%EOF\s*$/.test(bytes.subarray(-1024).toString('latin1'))) throw new AssistantDocumentError('INCOMPLETE_PDF','El PDF está incompleto.');
    try {
      const {PDFDocument} = await import('pdf-lib');
      const document = await PDFDocument.load(bytes,{ignoreEncryption:false,throwOnInvalidObject:true,updateMetadata:false});
      if (document.isEncrypted) throw new AssistantDocumentError('ENCRYPTED_PDF','El PDF está protegido. Adjuntá una copia sin contraseña.');
      const pages = document.getPageCount();
      if (pages < 1 || pages > MAX_INVOICE_PAGES) throw new AssistantDocumentError('PAGE_LIMIT','La factura admite hasta 10 páginas.');
      for (const page of document.getPages()) {
        const {width,height} = page.getSize();
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width > 14400 || height > 14400) throw new AssistantDocumentError('FILE_FORMAT','El PDF contiene una página inválida.');
      }
      return {mediaType:type,bytes,pages};
    } catch (error) {
      if (error instanceof AssistantDocumentError) throw error;
      throw new AssistantDocumentError('INVALID_PDF','No se pudo abrir el PDF: puede estar incompleto o protegido.');
    }
  }
  try {
    if (type === 'image/png') {
      await validatePngPayload(bytes);
      const {PDFDocument} = await import('pdf-lib');
      const document = await PDFDocument.create();
      await document.embedPng(bytes);
    } else if (type === 'image/jpeg') {
      const {decode} = await import('jpeg-js');
      const image = decode(bytes,{useTArray:true,maxResolutionInMP:25,maxMemoryUsageInMB:128,tolerantDecoding:false});
      if (!image.width || !image.height || image.width * image.height > 25_000_000) throw new Error('dimensions');
    }
    return {mediaType:type,bytes,pages:1};
  } catch { throw new AssistantDocumentError('INVALID_IMAGE','No se pudo validar la imagen. Adjuntá una imagen estática completa de hasta 25 megapíxeles.'); }
}
