export class PrivateWhatsappError extends Error {
  constructor(public code:string, message:string, public statusCode=409) { super(message); }
}
export interface PrivateWhatsappConfig {
  enabled:boolean; sendingEnabled:boolean; phoneNumberId:string; appSecret:string;
  verifyToken:string; accessToken:string; apiVersion:string; appOrigin:string;
  displayPhone?:string;
}
/** Sólo lee configuración al usar el canal; no hereda credenciales del canal comercial. */
export function privateWhatsappConfig():PrivateWhatsappConfig {
  return {enabled:process.env.NORTEX_ASSISTANT_PRIVATE_WHATSAPP_ENABLED==='true',sendingEnabled:process.env.NORTEX_PRIVATE_WA_SENDING_ENABLED==='true',
    phoneNumberId:process.env.NORTEX_PRIVATE_WA_PHONE_NUMBER_ID??'',appSecret:process.env.NORTEX_PRIVATE_WA_APP_SECRET??'',
    verifyToken:process.env.NORTEX_PRIVATE_WA_VERIFY_TOKEN??'',accessToken:process.env.NORTEX_PRIVATE_WA_ACCESS_TOKEN??'',
    apiVersion:process.env.NORTEX_PRIVATE_WA_API_VERSION??'',appOrigin:process.env.NORTEX_PRIVATE_WA_APP_ORIGIN??'',displayPhone:process.env.NORTEX_PRIVATE_WA_DISPLAY_PHONE};
}
export function requirePrivateWhatsapp(config:PrivateWhatsappConfig) {
  if(!config.enabled)throw new PrivateWhatsappError('PRIVATE_WA_DISABLED','El canal privado no está habilitado.',403);
  if(!/^\d{5,30}$/.test(config.phoneNumberId))throw new PrivateWhatsappError('PRIVATE_WA_CONFIGURATION','Falta configurar el canal privado.',503);
}
/** Nunca usa Host/Referer ni una URL elegida por el mensaje para enviar al panel. */
export function authenticatedReviewLink(config:PrivateWhatsappConfig,conversationId:string) {
  const url=new URL(config.appOrigin);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new PrivateWhatsappError('PRIVATE_WA_CONFIGURATION','Falta configurar el enlace privado.',503);
  url.searchParams.set('assistantConversation',conversationId);
  return url.toString();
}
