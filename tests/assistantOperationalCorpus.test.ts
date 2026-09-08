import { readFileSync } from 'node:fs';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
// MJS is also the standalone CLI harness: both runners exercise the same product imports.
import { evaluateOperationalScenario, assertOperationalExpected } from '../scripts/assistant-evaluation/operations-product.mjs';
import { buildOperationalCorpus, buildReservedModelCorpus, buildPilotTasks } from '../scripts/assistant-evaluation/operations-corpus.mjs';
import { MAX_OPERATION_RESERVATION_USD, selectPaidOperationCases, runOperationsModelEvaluation } from '../scripts/assistant-evaluation/operations-model.mjs';
const corpus = JSON.parse(readFileSync(new URL('./fixtures/assistant/operations/deterministic.json', import.meta.url), 'utf8'));
const flags = ['NORTEX_ASSISTANT_ENABLED', 'NORTEX_ASSISTANT_ACTIONS_ENABLED', 'NORTEX_ASSISTANT_EXECUTION_ENABLED', 'NORTEX_PROMOTIONS_ENABLED'];
const before = flags.map(key => [key, process.env[key]]);
beforeAll(() => flags.forEach(key => { process.env[key] = 'true'; }));
afterAll(() => before.forEach(([key, value]) => { if (value === undefined) delete process.env[key!]; else process.env[key!] = value; }));
describe('corpus operativo: servicios reales y expectativas independientes', () => {
  it.each(corpus.cases)('$id', async scenario => {
    assertOperationalExpected(await evaluateOperationalScenario(scenario), scenario.expected);
  });
  it('conserva la matriz de acciones, roles, verticales y contratos reproducible', () => {
    expect(corpus.cases).toEqual(buildOperationalCorpus());
    expect(new Set(corpus.cases.map((row: any) => row.id)).size).toBe(120);
    for (const area of ['reposicion', 'vencimientos', 'ventas-promociones']) for (const vertical of ['ferreteria', 'farmacia']) {
      const cases = corpus.cases.filter((row: any) => row.area === area && row.vertical === vertical);
      expect(cases).toHaveLength(20);
      expect(cases.some((row: any) => ['action', 'promotion-checkout'].includes(row.target))).toBe(true);
      expect(cases.some((row: any) => row.tags.includes('role'))).toBe(true);
      expect(cases.some((row: any) => row.tags.includes('date'))).toBe(true);
      expect(cases.every((row: any) => row.humanReview === 'pending')).toBe(true);
    }
  });
  it('reserva consultas del modelo y tareas manuales sin contar ninguna como ejecutada', () => {
    expect(buildReservedModelCorpus()).toHaveLength(60);
    expect(buildReservedModelCorpus().every((row: any) => row.status === 'not_run' && row.humanReview === 'pending')).toBe(true);
    expect(buildPilotTasks()).toHaveLength(60);
    expect(buildPilotTasks().every((row: any) => row.success === null && row.baselineSeconds === null && row.improvementTargetPercent === 20)).toBe(true);
  });
  it('limita lotes de IA por reserva real del servidor y revisión humana explícita', () => {
    const cases = buildReservedModelCorpus();
    const review = { synthetic: true, expectedOutcomesReviewed: true, reviewer: 'Synthetic test reviewer', reviewedAt: '2026-09-05T18:00:00Z', vertical: 'ferreteria', role: 'OWNER', scenarioIds: cases.map((row: any) => row.id) };
    expect(MAX_OPERATION_RESERVATION_USD).toBe('1.127680');
    const options = { vertical: 'ferreteria', role: 'OWNER', review };
    expect(selectPaidOperationCases(cases, options).selected).toHaveLength(1);
    expect(() => selectPaidOperationCases(cases, { ...options, limit: 2 })).toThrow('supera el tope');
    expect(() => selectPaidOperationCases(cases, { ...options, review: { ...review, expectedOutcomesReviewed: false } })).toThrow('revisión humana');
    expect(() => selectPaidOperationCases(cases, { ...options, maxReservedUsd: '21' })).toThrow('presupuesto global');
    expect(() => selectPaidOperationCases(cases, { ...options, limit: 60 })).toThrow('1 a 5');
    expect(() => selectPaidOperationCases(cases, { ...options, role: 'CASHIER' })).toThrow('revisión humana');
  });
  it('no inicia proveedor con opt-in sin el montaje sintético requerido', async () => {
    await expect(runOperationsModelEvaluation(['--allow-paid-model'])).rejects.toThrow('negocio sintético local');
    await expect(runOperationsModelEvaluation(['--allow-paid-model', '--synthetic-tenant', '--base-url', 'https://example.com'])).rejects.toThrow('backend local');
  });
});
