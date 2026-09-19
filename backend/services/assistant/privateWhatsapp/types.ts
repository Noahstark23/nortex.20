import type { PrismaClient,Prisma } from '@prisma/client';
import type { AssistantPrincipal,AssistantMessageDTO } from '../../../../shared/assistant.js';
import type { AssistantRunDTO } from '../../../../shared/assistantOperations.js';
import type { PrivateWhatsappConfig } from './config.js';
export type WaDatabase=PrismaClient|Prisma.TransactionClient;
export interface PrivateWaDependencies {
  db?:PrismaClient;config?:PrivateWhatsappConfig;now?:()=>Date;
  answer?:(principal:AssistantPrincipal,conversationId:string,input:{text:string;requestId:string},db:PrismaClient)=>Promise<AssistantMessageDTO>;
  resolveRun?:(principal:AssistantPrincipal,id:string,db:PrismaClient)=>Promise<AssistantRunDTO>;
  sender?:{send:(to:string,text:string)=>Promise<{messageId:string}>};
  download?:(mediaId:string)=>Promise<{bytes:Buffer;mediaType:string;name:string}>;
  storageRoot?:string;
}
export interface WaMessagePayload {text?:string;mediaId?:string;mediaType?:string;name?:string;timestamp:string;codeHash?:string}
