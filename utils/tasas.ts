/**
 * NORTEX — Tasas fiscales y laborales de Nicaragua (fuente única, versionada por año).
 *
 * ⚠️ VERIFICACIÓN OBLIGATORIA ANTES DE PUBLICAR ⚠️
 * Estos valores están copiados del motor del ERP (backend/services/nicaLabor.ts y
 * nicaTax.ts) — NO son inventados —, pero varios cambian por año/reforma y algunos
 * ya podrían estar desactualizados. Antes de mergear una calculadora pública que los
 * muestre, cotejar CADA número marcado `VERIFICAR` contra la fuente oficial:
 *   - INSS (tasas; el techo cotizable ya NO existe) → www.inss.gob.ni (Ley 539 y reformas)
 *   - Tabla IR rentas del trabajo → www.dgi.gob.ni (reforma vigente)
 *   - Salario mínimo → MITRAB (comisión tripartita, por sector; NO se hardcodea acá)
 * Publicar una cifra fiscal errada daña la autoridad SEO que buscamos.
 *
 * Nota: las mismas tasas viven hoy dispersas en el backend. Consolidarlas hacia este
 * módulo (y que el ERP también lo importe) es deuda pendiente; por ahora este archivo
 * es la fuente para las calculadoras del blog y debe mantenerse en sync con el ERP.
 */

export const TASAS_ANIO = 2026;
/**
 * Fecha de la última verificación manual contra FUENTE OFICIAL.
 *
 * Sigue en null a propósito. Estado del barrido de agosto 2026 — importa la
 * distinción entre "concordante en fuentes secundarias" y "verificado":
 *
 *   CONFIRMADO por varias fuentes secundarias concordantes (NO por la fuente
 *   primaria: inss.gob.ni y dgi.gob.ni no son alcanzables desde el entorno de
 *   desarrollo):
 *     · INSS laboral 7% (subió de 6,25% con el Decreto 06-2019)
 *     · INSS patronal 21,5% (<50 trabajadores) y 22,5% (≥50)
 *     · INATEC 2% sobre la planilla bruta, a cargo exclusivo del patrono
 *     · Primer tramo del IR de rentas del trabajo exento hasta C$100.000 anuales
 *     · Techo cotizable: DEROGADO (Decreto 06-2019) — ya se borró del código
 *
 *   SIN CONFIRMAR, no tocar sin fuente:
 *     · Los tramos 15/20/25/30% con sus bases (15.000 / 45.000 / 82.500)
 *     · IVA 15% · anticipo IR 1% · IMI municipal 1%
 *
 * Para sellar esto hace falta abrir la fuente primaria (o que lo firme un
 * contador) y poner acá la fecha. Mientras siga en null, las calculadoras
 * públicas muestran el aviso de Calculator.tsx.
 */
export const TASAS_VERIFICADAS_AL: string | null = null;

// ── Seguridad social (Ley 539) ──────────────────────────────────────────────
export const INSS_LABORAL_RATE = 0.07;          // 7% al trabajador — estable, confirmar
export const INSS_PATRONAL_RATE_DEFAULT = 0.225; // 22.5% (≥50 empleados). <50 empleados = 0.215. VERIFICAR
export const INSS_PATRONAL_RATE_PYME = 0.215;    // 21.5% (<50 empleados). VERIFICAR
export const INATEC_RATE = 0.02;                 // 2% (Ley 40) — estable, confirmar
/**
 * ⛔ NO REINTRODUCIR UN TECHO COTIZABLE.
 * El Decreto Presidencial 06-2019 (1-feb-2019, reforma al Decreto 975) ELIMINÓ el
 * tope máximo de la remuneración cotizable: cada córdoba del salario cotiza, sin
 * límite superior. Hasta este cambio el repo aplicaba base = min(bruto, 132071.43)
 * —una cifra sin fuente, que no corresponde a ningún techo nicaragüense documentado—
 * tanto acá como en el motor del ERP. El error iba en dos direcciones: sub-retenía
 * INSS (laboral y patronal, subestimando el costo real del empleado) y, al inflar la
 * renta neta de INSS, sobre-retenía IR.
 */

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
export const INDEMNIZACION_PISO_MESES = 1;    // Art. 45 — piso 1 mes
/** Art. 45: un "mes" de indemnización son 30 días de salario. */
export const DIAS_POR_MES_INDEMNIZACION = 30;

/** true si las tasas fueron verificadas contra fuente oficial y se pueden publicar. */
export function tasasVerificadas(): boolean {
  return TASAS_VERIFICADAS_AL !== null;
}
