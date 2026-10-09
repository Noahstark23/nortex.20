import { z } from 'zod';
import { normalizeAssistantText } from '../knowledge.js';
import { managuaDay, shiftCivilDay } from './analyticsPeriod.js';

export function asksForCashReview(text: string): boolean {
  return /\b(cierre|cierres|arqueo|cuadre)\b|\bmi caja (?:hoy|ayer|manana)\b|\bsemana con cuentas claras\b/.test(normalizeAssistantText(text));
}

/** Sólo períodos explícitos conocidos. null pide fechas; undefined deja otro flujo. */
export function weeklyCashReviewRequest(text: string, now: Date): { startDate?: string; endDate?: string } | null | undefined {
  if (!asksForCashReview(text)) return undefined;
  const normalized = normalizeAssistantText(text);
  const dates = text.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
  if (dates.length) {
    if (dates.length > 2 || dates.some(date => !z.iso.date().safeParse(date).success)) return null;
    if (/\b(hoy|ayer|anteayer|manana|semana|mes|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/.test(normalized)
      || (dates.length === 1 && /\b(desde|hasta|entre)\b/.test(normalized))) return null;
    return { startDate: dates[0], endDate: dates.at(-1) };
  }
  if (/\d|\b(mes|mensual|ano|anual|manana|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|anteayer)\b/.test(normalized)) return null;
  const today = managuaDay(now);
  if (/\bsemana\b/.test(normalized) && /\b(hoy|ayer)\b/.test(normalized)) return null;
  if (/\b(desde|hasta|entre|hace|antepasada)\b/.test(normalized)) return null;
  if (/\bhoy\b/.test(normalized) && /\bayer\b/.test(normalized)) return { startDate: shiftCivilDay(today, -1), endDate: today };
  if (/\bhoy\b/.test(normalized)) return { startDate: today, endDate: today };
  if (/\bayer\b/.test(normalized)) {
    const yesterday = shiftCivilDay(today, -1);
    return { startDate: yesterday, endDate: yesterday };
  }
  const mondayOffset = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  const monday = shiftCivilDay(today, -mondayOffset);
  if (/\besta semana\b/.test(normalized) && /\bsemana (pasada|anterior)\b/.test(normalized)) return null;
  if (/\besta semana\b/.test(normalized)) return { startDate: monday, endDate: today };
  if (/\bsemana (pasada|anterior)\b/.test(normalized)) return { startDate: shiftCivilDay(monday, -7), endDate: shiftCivilDay(monday, -1) };
  if (/\b(proxima|siguiente|dias|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/.test(normalized)) return null;
  return {}; // El servicio declara siempre los últimos siete días completos de Managua.
}
