import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const job = (name: string, source = workflow) => source.split(`  ${name}:\n`)[1]?.split(/\n  [a-z][a-z-]+:\n/)[0] ?? '';
const protectsStaging = (source: string) => /needs: \[[^\]\n]*\bintegration-required\b[^\]\n]*\]/.test(job('deploy-staging', source));
describe('CI exige integración antes de promover', () => {
  it('la suite real es obligatoria y usa solo el servicio MySQL de QA', () => {
    const integration = job('integration-required');
    expect(integration).toContain('image: mysql:8.0');
    expect(integration).toContain('NORTEX_QA_DATABASE_ACK: disposable-database');
    expect(integration).toContain('run: npm run test:integration:required');
    expect(integration).not.toMatch(/continue-on-error:\s*true|NORTEX_QA_BASE_URL:\s*https/);
    expect(protectsStaging(workflow)).toBe(true);
  });
  it('quitar la dependencia produce una compuerta inválida', () => {
    expect(protectsStaging(workflow.replace('verify, integration-required,', 'verify,'))).toBe(false);
  });
});
