import { normalizeAssistantText } from './knowledge.js';
import { batchExpiryDayStart } from '../../../utils/batchExpiry.js';
import { z } from 'zod';
import type { IntakeFacts, PurchaseIntakeFact } from './purchaseIntakeTypes.js';

export const isPurchaseNarration = (text: string) => /\b(compre|compramos|comprado|adquiri|adquirimos|registrar (?:una |esta )?compra|registra (?:una |esta )?compra)\b/.test(normalizeAssistantText(text));
export const isManualChoice = (text: string) => /\b(manual|completar por aqui|por aqui|sin foto|sin imagen|no tengo foto|agregalo al inventario|registralo por aqui)\b/.test(normalizeAssistantText(text));
export const isPhotoChoice = (text: string) => /\b(foto|fotografia|imagen|adjuntar|pdf)\b/.test(normalizeAssistantText(text)) && !isManualChoice(text);
export const isCancelIntake = (text: string) => /^(cancelar|cancela|cancelar compra|cancela la compra|olvida esta compra|descartar compra)$/i.test(normalizeAssistantText(text.trim()));

export function parseExplicitAmount(text: string): string | undefined {
  const clean = text.trim().replace(/^(?:C\$|NIO|USD|\$)\s*/i,'').replace(/\s*(?:cada una?|cada bolsa|por unidad|cordobas|córdobas)$/i,'').trim();
  return /^\d{1,12}(?:\.\d{1,6})?$/.test(clean) ? clean : undefined;
}
export function parseCivilAnswer(text: string, now=new Date()): string | undefined {
  const normalized=normalizeAssistantText(text.trim());
  if(normalized==='hoy'||normalized==='ayer') {
    const date=batchExpiryDayStart(now); if(normalized==='ayer')date.setUTCDate(date.getUTCDate()-1);
    return date.toISOString().slice(0,10);
  }
  const match=text.match(/\b\d{4}-\d{2}-\d{2}\b/);
  return match && z.iso.date().safeParse(match[0]).success ? match[0] : undefined;
}
export function explicitBoolean(text: string): boolean | undefined {
  const value=normalizeAssistantText(text.trim().replace(/[.!]+$/,''));
  if(/^(si|si ya|si recibi|si la recibi|si lo recibi|si pague|ya recibi|ya pague)$/.test(value))return true;
  if(/^(no|todavia no|aun no|no recibi|no he recibido|no pague|no he pagado)$/.test(value))return false;
  return undefined;
}

/** Importe y campo están unidos en la declaración: un número aislado no tiene semántica financiera. */
export function parseNamedAmount(text:string,field:'unitCost'|'documentTotal'): {value:string;currency?:string}|undefined {
  const normalized=normalizeAssistantText(text);
  const pattern=field==='unitCost'
    ? /(?:\b(?:a|precio|costo|cuesta|costaron|costo unitario|precio unitario)\s*(?:de\s+|es\s+)?)(c\$|nio|usd|\$)?\s*(\d{1,12}(?:\.\d{1,6})?)\s*(?:cada\b|por unidad\b|c\/u\b)/g
    : /\btotal\s*(?:de\s+(?:la\s+)?factura\s*)?(?:es\s*|de\s*|:\s*)?(c\$|nio|usd|\$)?\s*(\d{1,12}(?:\.\d{1,6})?)(?![\d.])/g;
  const matches=[...normalized.matchAll(pattern)];
  if(matches.length!==1)return;
  const [,currency,value]=matches[0];
  return {value,...(currency==='c$'||currency==='nio'?{currency:'NIO'}:currency==='usd'?{currency:'USD'}:{})};
}

/** Recupera sólo valores expresados; precio, fecha y moneda no se completan por defecto. */
export function parseInitialPurchase(text: string): IntakeFacts {
  const normalized=normalizeAssistantText(text);
  const start=normalized.match(/(?:compre|compramos|comprado|adquiri|adquirimos)\s+(\d{1,12}(?:\.\d{1,6})?)\s+(.+)/);
  if(!start)return {items:[{description:''}]};
  const words=start[2].replace(/[.!]$/,'').split(/\s+(?:a\s+(?:C\$|\$|\d)|por\s+C\$|factura\b|proveedor\b|total\b)/i)[0].trim();
  const unit=words.match(/^([\p{L}]+)\s+de\s+(.+)$/u);
  const facts:IntakeFacts={items:[{description:(unit?.[2]??words).slice(0,500),quantity:start[1],...(unit?{unitText:unit[1]}:{})}]};
  const price=parseNamedAmount(text,'unitCost');
  if(price){facts.items[0].unitCost=price.value;if(price.currency)facts.currency=price.currency;}
  return facts;
}

/** El modelo no puede aportar IDs ni confirmaciones; su respaldo debe existir en el mensaje actual. */
export function acceptLanguageFacts(facts: IntakeFacts, patches: PurchaseIntakeFact[], message: string): string[] {
  const accepted:string[]=[];
  for(const patch of patches.slice(0,20)) {
    if(!patch.suppliedText || !message.includes(patch.suppliedText))continue;
    const normalized=normalizeAssistantText(patch.suppliedText);
    let value=patch.value;
    if(['quantity','unitCost','documentTotal'].includes(patch.field)) {
      if(parseExplicitAmount(value)!==value)continue;
      if(patch.field==='quantity') {
        if(facts.items.length!==1||parseInitialPurchase(message).items[0].quantity!==value||!new RegExp(`(?:^|[^\\d.])${value.replace(/\./g,'\\.')}(?:$|[^\\d.])`).test(patch.suppliedText))continue;
      } else if(parseNamedAmount(patch.suppliedText,patch.field as 'unitCost'|'documentTotal')?.value!==value||(patch.field==='unitCost'&&facts.items.length!==1))continue;
    } else if(['date','dueDate','expiryDate'].includes(patch.field)) {
      const markers:Record<string,RegExp>={date:/^(?:fecha (?:de (?:la )?)?factura|factura (?:de fecha|fechada))\s*(?:es|:)?\s*/,dueDate:/^(?:vence (?:el )?credito|vencimiento (?:del? )?credito|fecha (?:de )?vencimiento (?:del? )?credito)\s*(?:el|es|:)?\s*/,expiryDate:/^(?:vence (?:el )?lote|vencimiento (?:del? )?lote|fecha (?:de )?vencimiento (?:del? )?lote)\s*(?:el|es|:)?\s*/};
      if(!markers[patch.field].test(normalized)||parseCivilAnswer(normalized.replace(markers[patch.field],''))!==value)continue;
    } else if(patch.field==='currency') {
      if(value==='NIO'&&!/(?:c\$|cordoba|\bnio\b)/.test(normalized))continue;
      if(value==='USD'&&!/(?:usd|dolar)/.test(normalized))continue;
      if(!['NIO','USD'].includes(value))continue;
    } else if(patch.field==='paymentMethod') {
      if(value==='CREDIT'&&!/credito/.test(normalized))continue;
      if(value==='CASH'&&!/contado|efectivo/.test(normalized))continue;
      if(!['CREDIT','CASH'].includes(value))continue;
    } else {
      if(!normalized.includes(normalizeAssistantText(value)))continue;
      const named:Partial<Record<PurchaseIntakeFact['field'],RegExp>>={supplierName:/^proveedor\b/,invoiceNumber:/^(?:numero (?:de (?:la )?)?factura|factura(?: numero)?)\b/,batchNumber:/^(?:numero (?:de (?:el )?)?lote|lote)\b/};
      if(named[patch.field]&&!named[patch.field]!.test(normalized))continue;
      if(['description','unitText'].includes(patch.field)&&parseInitialPurchase(message).items[0][patch.field as 'description'|'unitText']!==normalizeAssistantText(value))continue;
    }
    const itemField=['description','quantity','unitText','unitCost','batchNumber','expiryDate'].includes(patch.field);
    const target=itemField?facts.items[0]:facts;
    // Correcciones de valores ya capturados se hacen en revisión, nunca por sugerencia opaca.
    if((target as Record<string,unknown>)[patch.field]!==undefined && (target as Record<string,unknown>)[patch.field]!=='')continue;
    (target as Record<string,unknown>)[patch.field]=value;
    accepted.push(patch.field);
  }
  return accepted;
}
