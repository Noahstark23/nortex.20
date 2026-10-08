import type { Prisma, PrismaClient, WaCommerceInbox, WaCommerceConversation, WhatsAppChannel } from '@prisma/client';
export type CommerceDb = PrismaClient;
export type CommerceTx = Prisma.TransactionClient;
export interface CommercePrincipal { tenantId: string; userId: string; role: string }
export class CommerceError extends Error {
  constructor(public code: string, message: string, public statusCode = 400) { super(message); }
}
export interface CommercePolicy {
  eligibleProductIds: string[];
  autoQuote: boolean;
  ttlHours: number;
  maxTotal: string;
  maxLines: number;
  eligibilityAttested: boolean;
}
export interface CommerceDependencies {
  db?: CommerceDb;
  now?: () => Date;
  appSecret?: string;
  sendingEnabled?: boolean;
  sender?: (channel: WhatsAppChannel, waId: string, text: string) => Promise<string | null>;
  /** Cómputo local y determinista: no permite red ni LLM dentro de la transacción. */
  answer?: (tx: CommerceTx, inbox: WaCommerceInbox, conversation: WaCommerceConversation, channel: WhatsAppChannel, now: Date) => Promise<{ text: string | null }>;
}
export const COMMERCE_OPTOUT_ACK = 'Dejé de enviarte respuestas. Escribí ALTA si querés volver a consultar el catálogo.';
export const COMMERCE_HANDOFF_ACK = 'Tu consulta quedó pendiente para una persona de la tienda. El equipo la verá en su bandeja.';
