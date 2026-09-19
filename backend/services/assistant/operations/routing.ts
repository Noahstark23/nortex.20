import { normalizeAssistantText } from '../knowledge.js';
import { isCancelIntake,isManualChoice,isPurchaseNarration } from '../purchaseIntakeParsing.js';

/** Decide el transporte, nunca interpreta importes, permisos ni confirmaciones. */
export function shouldUseOperationalRun(text:string,hasIntake:boolean,lastExchangeOperational=false):boolean {
  const normalized=normalizeAssistantText(text);
  if(isPurchaseNarration(text)||isManualChoice(text)||isCancelIntake(text))return false;
  if(/^(si|no|ok|dale|confirmo|confirmar|confirma|confirmalo|registralo|ejecutalo)[.!\s]*$/.test(normalized))return false;
  if(/\b(retomar|retomemos|volver a|sigamos con|continuar con)\s+(?:la\s+)?compra\b/.test(normalized))return false;
  if(/\b(orden(?:es)? de compra|reposicion|reponer|cobertura|rotacion|promocion(?:es)?|descuento|merma|baja de lote|devolucion al proveedor|devolver al proveedor|aviso|comparalo|comparala|comparar|compara|comparacion|tendencia|por que|busca|buscar)\b/.test(normalized))return true;
  if(/\b(ventas|vendimos|gastos|egresos|cuentas pendientes|cuentas por cobrar|cuentas por pagar|inventario|existencias|stock|lotes|vencimientos|vencidos|negocio|utilidad|ganancia|resumen)\b/.test(normalized))return true;
  // Una respuesta a una pregunta de la compra se mantiene en la captura, aunque sea corta.
  if(hasIntake)return lastExchangeOperational&&/\b(mostra(?:me|melos|mela)?|cuales|prepara(?:la|lo|me)?|explica(?:lo|me)?|detalla(?:lo|me)?|y ayer|y hoy|y la semana|esos productos|ese lote|esa accion)\b/.test(normalized);
  return true;
}
