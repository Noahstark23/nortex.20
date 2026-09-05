import { describe, expect, it } from 'vitest';
import { assertExecutedSuite, validateQualityDatabase, REQUIRED_INTEGRATION_SUITES } from '../scripts/quality-gate-contract.mjs';

const file = 'tests/sample.test.ts';
const report = (status = 'passed', assertions: any[] = [{ status: 'passed' }]) => ({ success: true, testResults: [{ name: `/qa/${file}`, status, assertionResults: assertions }] });
describe('compuerta de integración falla cerrada', () => {
  it('acepta únicamente una suite realmente ejecutada', () => expect(assertExecutedSuite(report(), file)).toBe(1));
  it.each(['pending', 'skipped', 'todo', 'failed'])('rechaza un caso %s aunque el proceso salga exitoso', status => expect(() => assertExecutedSuite(report('passed', [{ status }]), file)).toThrow());
  it('rechaza reporte vacío, suite faltante, cero casos y duplicados', () => {
    for (const value of [{}, { success: true, testResults: [] }, report('passed', []), { ...report(), testResults: [...report().testResults, ...report().testResults] }]) {
      expect(() => assertExecutedSuite(value, file)).toThrow();
    }
  });
  it('rechaza fallo global y fallo de suite', () => {
    expect(() => assertExecutedSuite({ ...report(), success: false }, file)).toThrow();
    expect(() => assertExecutedSuite(report('failed'), file)).toThrow();
  });
  it('exige base explícitamente descartable, local y nombrada para QA', () => {
    expect(validateQualityDatabase('mysql://qa:qa@127.0.0.1:3319/nortex_quality', 'disposable-database').pathname).toBe('/nortex_quality');
    for (const value of [undefined, 'mysql://qa:qa@remote.example/nortex_quality', 'mysql://qa:qa@127.0.0.1/nortex_production', 'postgres://qa:qa@127.0.0.1/nortex_quality']) {
      expect(() => validateQualityDatabase(value, 'disposable-database')).toThrow();
    }
    expect(() => validateQualityDatabase('mysql://qa:qa@localhost/nortex_qa', '')).toThrow();
  });
  it('requiere los escenarios financieros, de farmacia e idempotencia reales', () => {
    expect(REQUIRED_INTEGRATION_SUITES).toEqual(expect.arrayContaining(['tests/posIntegrity.integration.test.ts', 'tests/cashCloseJournal.mysql.test.ts', 'tests/journalSingleConnection.mysql.test.ts', 'tests/returnIdempotency.integration.test.ts', 'tests/procurementPhaseTwoB.integration.test.ts']));
    expect(new Set(REQUIRED_INTEGRATION_SUITES).size).toBe(REQUIRED_INTEGRATION_SUITES.length);
  });
});
