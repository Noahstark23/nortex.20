import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const job = (name: string, source = workflow) => source.split(`  ${name}:\n`)[1]?.split(/\n  [a-z][a-z-]+:\n/)[0] ?? '';
describe('CI exige integración aislada', () => {
  it('la suite real es obligatoria y usa solo el servicio MySQL de QA', () => {
    const integration = job('integration-required');
    expect(integration).toContain('docker pull mysql:8.0');
    expect(integration).toContain('run: npm run test:integration:required');
    expect(integration).not.toMatch(/continue-on-error:\s*true|NORTEX_QA_BASE_URL:\s*https|secrets\./);
  });
  it('no vuelve a mezclar promoción con CI', () => {
    expect(job('deploy-staging')).toBe('');
    expect(job('deploy-production')).toBe('');
  });
});
