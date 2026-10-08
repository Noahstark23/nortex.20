import { createHash } from 'node:crypto';
import { MAX_ATTACHMENT_BYTES,validateAttachmentEnvelope } from '../attachments.js';
import { PrivateWhatsappError,requirePrivateWhatsapp,type PrivateWhatsappConfig } from './config.js';

type Fetch=typeof fetch;
function credentials(config:PrivateWhatsappConfig) {
  requirePrivateWhatsapp(config);
  if(!config.accessToken||!/^v\d{1,3}\.\d{1,2}$/.test(config.apiVersion))throw new PrivateWhatsappError('PRIVATE_WA_CONFIGURATION','Falta configurar el transporte privado.',503);
  return {Authorization:`Bearer ${config.accessToken}`};
}
async function limitedBody(response:Response,limit:number) {
  if(!response.ok||!response.body)throw new PrivateWhatsappError('PRIVATE_WA_PROVIDER','El proveedor no entregó el documento.',503);
  const size=Number(response.headers.get('content-length')??0);
  if(!Number.isFinite(size)||size>limit)throw new PrivateWhatsappError('PRIVATE_WA_MEDIA_SIZE','El documento excede el tamaño permitido.',413);
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let total=0;
  try {while(true){const part=await reader.read();if(part.done)break;total+=part.value.length;if(total>limit)throw new PrivateWhatsappError('PRIVATE_WA_MEDIA_SIZE','El documento excede el tamaño permitido.',413);chunks.push(part.value);}}
  finally {await reader.cancel().catch(()=>undefined);reader.releaseLock();}
  return Buffer.concat(chunks,total);
}

export function assertMetaMediaUrl(raw:string):URL {
  let url:URL;try{url=new URL(raw);}catch{throw new PrivateWhatsappError('PRIVATE_WA_MEDIA_URL','La dirección del documento no es válida.',422);}
  if(url.protocol!=='https:'||url.hostname!=='lookaside.fbsbx.com'||url.port||url.username||url.password||url.hash||!url.pathname.startsWith('/whatsapp_business/attachments/'))throw new PrivateWhatsappError('PRIVATE_WA_MEDIA_URL','El documento no proviene del almacenamiento permitido de Meta.',422);
  return url;
}

/** Sólo acepta ID de Meta. Nunca descarga una URL enviada por el usuario/documento ni sigue redirecciones. */
export function createPrivateWaMediaDownloader(config:PrivateWhatsappConfig,request:Fetch=fetch) {
  return async(mediaId:string)=>{
    if(!/^\d{1,40}$/.test(mediaId))throw new PrivateWhatsappError('PRIVATE_WA_MEDIA_ID','Referencia de documento inválida.',422);
    const headers=credentials(config),signal=AbortSignal.timeout(20_000);
    const metadataResponse=await request(`https://graph.facebook.com/${config.apiVersion}/${mediaId}?phone_number_id=${config.phoneNumberId}`,{headers,redirect:'error',signal});
    let metadata:{url?:string;id?:string;mime_type?:string;file_size?:number;sha256?:string};
    try{metadata=JSON.parse((await limitedBody(metadataResponse,16*1024)).toString('utf8'));}catch(error){if(error instanceof PrivateWhatsappError)throw error;throw new PrivateWhatsappError('PRIVATE_WA_MEDIA_METADATA','No se pudo verificar el documento.',422);}
    if(metadata.id!==mediaId||!metadata.url||!metadata.mime_type||!Number.isInteger(metadata.file_size)||metadata.file_size!<=0||metadata.file_size!>MAX_ATTACHMENT_BYTES)throw new PrivateWhatsappError('PRIVATE_WA_MEDIA_METADATA','Los metadatos del documento son inválidos.',422);
    const response=await request(assertMetaMediaUrl(metadata.url),{headers,redirect:'error',signal});
    const bytes=await limitedBody(response,MAX_ATTACHMENT_BYTES);
    if(bytes.length!==metadata.file_size)throw new PrivateWhatsappError('PRIVATE_WA_MEDIA_METADATA','El documento está incompleto.',422);
    if(metadata.sha256){const sha=createHash('sha256').update(bytes);const expected=/^[a-f0-9]{64}$/i.test(metadata.sha256)?Buffer.from(metadata.sha256,'hex'):Buffer.from(metadata.sha256,'base64');if(!sha.digest().equals(expected))throw new PrivateWhatsappError('PRIVATE_WA_MEDIA_METADATA','El documento no coincide con el original.',422);}
    return {bytes,mediaType:validateAttachmentEnvelope(bytes,metadata.mime_type),name:metadata.mime_type==='application/pdf'?'factura.pdf':'factura-imagen'};
  };
}

/** No reintenta: cualquier resultado incierto lo decide la outbox durable. */
export function createPrivateWaSender(config:PrivateWhatsappConfig,request:Fetch=fetch) {
  return {async send(to:string,text:string) {
    if(!config.sendingEnabled)throw new PrivateWhatsappError('PRIVATE_WA_SENDING_DISABLED','Los envíos privados están pausados.',403);
    if(!/^[1-9]\d{7,14}$/.test(to)||text.length>4096)throw new PrivateWhatsappError('PRIVATE_WA_OUTPUT','La salida no es válida.',422);
    const response=await request(`https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`,{method:'POST',headers:{...credentials(config),'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(20_000),body:JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',to,type:'text',text:{body:text,preview_url:false}})});
    const value=JSON.parse((await limitedBody(response,16*1024)).toString('utf8')) as {messages?:{id?:string}[]};
    const messageId=value.messages?.[0]?.id;
    if(!messageId||messageId.length>191)throw new PrivateWhatsappError('PRIVATE_WA_SEND_UNKNOWN','No se recibió una referencia verificable del envío.',503);
    return {messageId};
  }};
}
