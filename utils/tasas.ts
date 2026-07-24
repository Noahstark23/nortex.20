/**
 * NORTEX — Tasas fiscales y laborales de Nicaragua (fuente única, versionada por año).
 *
 * ⚠️ VERIFICACIÓN OBLIGATORIA ANTES DE PUBLICAR ⚠️
 * Estos valores están copiados del motor del ERP (backend/services/nicaLabor.ts y
 * nicaTax.ts) — NO son inventados —, pero varios cambian por año/reforma y algunos
 * ya podrían estar desactualizados. Antes de mergear una calculadora pública que los
 * muestre, cotejar CADA número marcado `VERIFICAR` contra la fuente oficial:
 *   - INSS / techo salarial → www.inss.gob.ni (Ley 539 y reformas)
 *   - Tabla IR rentas del trabajo → www.dgi.gob.ni (reforma vigente)
 *   - Salario mínimo → MITRAB (comisión tripartita, por sector; NO se hardcodea acá)
 * Publicar una cifra fiscal errada daña la autoridad SEO que buscamos.
 *
 * Nota: las mismas tasas viven hoy dispersas en el backend. Consolidarlas hacia este
 * módulo (y que el ERP también lo importe) es deuda pendiente; por ahora este archivo
 * es la fuente para las calculadoras del blog y debe mantenerse en sync con el ERP.
 */

export const TASAS_ANIO = 2026;
/** Fecha de la última verificación manual contra fuentes oficiales (actualizar al verificar). */
export const TASAS_VERIFICADAS_AL: string | null = null; // null = SIN verificar aún → no publicar

// ── Seguridad social (Ley 539) ──────────────────────────────────────────────
export const INSS_LABORAL_RATE = 0.07;          // 7% al trabajador — estable, confirmar
export const INSS_PATRONAL_RATE_DEFAULT = 0.225; // 22.5% (≥50 empleados). <50 empleados = 0.215. VERIFICAR
export const INSS_PATRONAL_RATE_PYME = 0.215;    // 21.5% (<50 empleados). VERIFICAR
export const INATEC_RATE = 0.02;                 // 2% (Ley 40) — estable, confirmar
/** ⚠️ VERIFICAR: el comentario del ERP lo marca "2024" — casi seguro desactualizado. */
export const TECHO_INSS_MENSUAL = 132071.43;

// ── IR rentas del trabajo (tabla progresiva anual DGI) ──────────────────────
// ⚠️ VERIFICAR contra la tabla DGI vigente del año (el ERP la marca "reformas 2025").
export interface TramoIR { from: number; to: number; rate: number; base: number; }
export const IR_TABLE: TramoIR[] = [
  { from: 0,          to: 100000,   rate: 0,    base: 0 },
  { from: 100000.01,  to: 200000,   rate: 0.15, base: 0 },
  { from: 200000.01,  to: 350000,   rate: 0.20, base: 15000 },
  { from: 350000.01,  to: 500000,   rate: 0.25, base: 45000 },
  { from: 500000.01,  to: Infinity, rate: 0.30, base: 82500 },
];

// ── Impuestos (DGI / Alcaldía) ──────────────────────────────────────────────
export const IVA_RATE = 0.15;          // 15% — estable, confirmar
export const ANTICIPO_IR_RATE = 0.01;  // 1% — varía por régimen; VERIFICAR
export const IMI_ALCALDIA_RATE = 0.01; // 1% — varía por municipio; VERIFICAR

// ── Constantes laborales (Ley 185, Código del Trabajo) ──────────────────────
export const VACACIONES_DIAS_POR_MES = 2.5;   // Art. 76 — 15 días por 6 meses
export const VACACIONES_TOPE_DIAS = 30;
export const AGUINALDO_MESES = 12;            // 13º mes = 1/12 del salario por mes
export const HORAS_MES_ORDINARIAS = 240;      // 30 días · 8 h → hora ordinaria = salario/240
export const HORA_EXTRA_RECARGO = 2;          // Art. 62 — al doble
export const INDEMNIZACION_TOPE_MESES = 5;    // Art. 45 — techo 5 meses

/** true si las tasas fueron verificadas contra fuente oficial y se pueden publicar. */
export function tasasVerificadas(): boolean {
  return TASAS_VERIFICADAS_AL !== null;
}
