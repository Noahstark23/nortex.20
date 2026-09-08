import { describe, expect, it } from 'vitest';
import { analyzePilot, createPilotWorksheet } from '../scripts/assistant-evaluation/pilot-analyze.mjs';
function measured() {
  const input: any = createPilotWorksheet();
  Object.assign(input, { synthetic: false, candidateSha: 'a'.repeat(40), reviewer: 'Synthetic reviewer', reviewedAt: '2026-09-07T19:00:00Z', humanReview: 'approved' });
  input.tasks.forEach((row: any) => Object.assign(row, { status: 'completed', operator: 'operator-1', baselineSeconds: 100, assistantSeconds: 80,
    baselineErrors: 1, assistantErrors: 0, baselineCorrections: 1, assistantCorrections: 1, criticalIncidents: 0, success: true, evidence: ['synthetic-fixture'], recordedAt: '2026-09-07T18:00:00Z' }));
  return input;
}
describe('medición del piloto: pares comparables, seis grupos y resultados verificables', () => {
  it('conserva ausencias como pendientes sin dar por ejecutado el piloto', () => {
    const result = analyzePilot(createPilotWorksheet());
    expect(result).toMatchObject({ status: 'not_run', completed: 0, criteriaMet: false });
    expect(result.groups.every((group: any) => group.improvementPercent === null)).toBe(true);
  });
  it('calcula medianas independientes y exige 20% en cada área y vertical', () => {
    const input = measured();
    input.tasks[0].baselineSeconds = 10000; input.tasks[0].assistantSeconds = 10000;
    const result = analyzePilot(input);
    expect(result.status).toBe('criteria_met');
    expect(result.groups).toHaveLength(6);
    expect(result.groups.every((group: any) => group.baselineMedianSeconds === '100' && group.assistantMedianSeconds === '80' && group.improvementPercent === '20')).toBe(true);
    input.tasks.filter((row: any) => row.area === 'reposicion' && row.vertical === 'farmacia').forEach((row: any) => { row.assistantSeconds = 81; });
    expect(analyzePilot(input).criteriaMet).toBe(false);
  });
  it.each(['assistantErrors', 'assistantCorrections', 'criticalIncidents'])('no compensa %s con más velocidad', field => {
    const input = measured(); input.tasks[0][field] = 50;
    expect(analyzePilot(input).criteriaMet).toBe(false);
  });
  it('exige éxito además de velocidad y revisión de datos', () => {
    const input = measured(); input.tasks[0].success = false;
    expect(analyzePilot(input).status).toBe('criteria_not_met');
    input.tasks[0].success = true; input.humanReview = 'pending';
    expect(analyzePilot(input).status).toBe('pending_human_review');
    input.humanReview = 'approved'; input.reviewedAt = '2026-09-06T00:00:00Z';
    expect(analyzePilot(input).status).toBe('pending_human_review');
    input.synthetic = true;
    expect(analyzePilot(input).status).toBe('simulation_only');
  });
  it.each([null, -1, NaN, Infinity, 0])('rechaza duración ausente o inválida %s', seconds => {
    const input = measured(); input.tasks[0].assistantSeconds = seconds;
    expect(() => analyzePilot(input)).toThrow('Medición incompleta');
  });
  it('no admite borrar pares, duplicarlos, reordenar el cruce ni ocultar fallos', () => {
    const input = measured(); input.tasks.pop(); expect(() => analyzePilot(input)).toThrow('60 tareas');
    const duplicate = measured(); duplicate.tasks[1] = duplicate.tasks[0]; expect(() => analyzePilot(duplicate)).toThrow('60 tareas');
    const changed = measured(); changed.tasks[0].order = 'assistant-first'; expect(() => analyzePilot(changed)).toThrow('orden alternado');
    const hidden = measured(); hidden.tasks[0].status = 'not_run'; expect(() => analyzePilot(hidden)).toThrow('ocultarse');
  });
  it('no alcanza el umbral con nueve tareas de un área aunque el resto termine', () => {
    const input = measured(); input.tasks[0] = createPilotWorksheet().tasks[0];
    expect(analyzePilot(input)).toMatchObject({ completed: 59, criteriaMet: false });
  });
});
