import { describe,expect,it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { encode } from 'jpeg-js';
import { deflateSync } from 'node:zlib';
import { parseInvoiceExtraction,validateInvoiceFile } from '../backend/services/assistant/extraction.js';

const extracted=()=>({oneInvoice:true,complete:true,draft:{currency:'NIO',supplierName:'Ferretería QA',invoiceNumber:'F1',date:'2026-09-05',documentTotal:'20.00',items:[{description:'Tornillo',quantity:'2',unitCost:'10',purchaseUnit:'BASE'}],warnings:[]}});
describe('extracción de factura no autoriza una compra',()=>{
  it('conserva importes exactos y exige pago/recepción explícitos',()=>{
    const draft=parseInvoiceExtraction(extracted());
    expect(draft.documentTotal).toBe('20.00');expect(draft.receivedConfirmed).toBe(false);expect(draft.paymentConfirmed).toBe(false);expect(draft.supplierId).toBeUndefined();
  });
  it('rechaza múltiples facturas, páginas repetidas o documento incompleto',()=>{
    expect(()=>parseInvoiceExtraction({...extracted(),oneInvoice:false})).toThrow('sola factura');
    expect(()=>parseInvoiceExtraction({...extracted(),complete:false})).toThrow('incompleta');
  });
  it('rechaza IDs, confirmaciones o instrucciones fuera del contrato',()=>{
    expect(()=>parseInvoiceExtraction({...extracted(),tenantId:'otro'})).toThrow('válidos');
    expect(()=>parseInvoiceExtraction({...extracted(),draft:{...extracted().draft,paymentConfirmed:true}})).toThrow('válidos');
  });
  it('no admite cifras exponenciales ni más de 200 renglones',()=>{
    expect(()=>parseInvoiceExtraction({...extracted(),draft:{...extracted().draft,documentTotal:'1e6'}})).toThrow();
    expect(()=>parseInvoiceExtraction({...extracted(),draft:{...extracted().draft,items:Array(201).fill(extracted().draft.items[0])}})).toThrow();
  });
});
describe('validación real del original en worker',()=>{
  it('lee páginas de PDF con streams comprimidos y aplica límite',async()=>{
    const doc=await PDFDocument.create();for(let i=0;i<10;i++)doc.addPage();
    expect((await validateInvoiceFile(Buffer.from(await doc.save()),'application/pdf')).pages).toBe(10);
    doc.addPage();await expect(validateInvoiceFile(Buffer.from(await doc.save()),'application/pdf')).rejects.toMatchObject({code:'PAGE_LIMIT'});
  });
  it('rechaza PDFs truncados y una firma falsa',async()=>{
    const doc=await PDFDocument.create();doc.addPage();const bytes=Buffer.from(await doc.save());
    await expect(validateInvoiceFile(bytes.subarray(0,bytes.length-20),'application/pdf')).rejects.toMatchObject({code:'INCOMPLETE_PDF'});
    await expect(validateInvoiceFile(Buffer.from('%PDF-1.7\nfalse\n%%EOF'),'application/pdf')).rejects.toMatchObject({code:'INVALID_PDF'});
  });
  it('rechaza un PDF cifrado antes del proveedor',async()=>{
    const pdf=Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>\nendobj\n4 0 obj\n<< /Filter /Standard /V 1 /R 2 /Length 40 >>\nendobj\ntrailer\n<< /Root 1 0 R /Encrypt 4 0 R >>\n%%EOF');
    await expect(validateInvoiceFile(pdf,'application/pdf')).rejects.toMatchObject({code:'INVALID_PDF'});
  });
  it('rechaza imagen con encabezado JPEG y cuerpo inválido',async()=>{
    await expect(validateInvoiceFile(Buffer.from([255,216,255,0,0,255,217]),'image/jpeg')).rejects.toMatchObject({code:'INVALID_IMAGE'});
  });
  it('WebP permanece deshabilitado hasta contar con decodificación verificable',async()=>{
    const bytes=Buffer.alloc(22);bytes.write('RIFF',0);bytes.writeUInt32LE(14,4);bytes.write('WEBP',8);bytes.write('VP8L',12);bytes.writeUInt32LE(1,16);
    await expect(validateInvoiceFile(bytes,'image/webp')).rejects.toMatchObject({code:'FILE_FORMAT'});
  });
  it('decodifica JPEG y rechaza stream truncado aunque conserve firma y EOI',async()=>{
    const jpeg=encode({width:20,height:20,data:Buffer.alloc(20*20*4,127)},85).data;
    expect((await validateInvoiceFile(jpeg,'image/jpeg')).pages).toBe(1);
    const scan=jpeg.indexOf(Buffer.from([255,218]));const truncated=Buffer.concat([jpeg.subarray(0,scan+14),Buffer.from([255,217])]);
    await expect(validateInvoiceFile(truncated,'image/jpeg')).rejects.toMatchObject({code:'INVALID_IMAGE'});
  });
  it('valida PNG completo y bloquea expansión mayor a sus dimensiones',async()=>{
    const chunk=(type:string,data:Buffer)=>{
      const bytes=Buffer.alloc(12+data.length);bytes.writeUInt32BE(data.length);bytes.write(type,4);data.copy(bytes,8);let crc=0xffffffff;
      for(const byte of bytes.subarray(4,-4)){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
      bytes.writeUInt32BE((crc^0xffffffff)>>>0,bytes.length-4);return bytes;
    };
    const header=Buffer.alloc(13);header.writeUInt32BE(1);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;
    const png=(pixels:Buffer)=>Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
    expect((await validateInvoiceFile(png(Buffer.from([0,255,255,255,255])),'image/png')).pages).toBe(1);
    await expect(validateInvoiceFile(png(Buffer.alloc(1_000_000)),'image/png')).rejects.toMatchObject({code:'INVALID_IMAGE'});
    const bad=png(Buffer.from([0,255,255,255,255]));bad[33]^=1;
    await expect(validateInvoiceFile(bad,'image/png')).rejects.toMatchObject({code:'INVALID_IMAGE'});
  });
});
