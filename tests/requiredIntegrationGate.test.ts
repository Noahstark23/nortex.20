import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REQUIRED_INTEGRATION_SUITES } from '../scripts/quality-gate-contract.mjs';
import { discoverQualitySuites, validateQualitySuiteRegistration } from '../scripts/verify-quality-suite-registration.mjs';

const gate = readFileSync('scripts/qa-integration-required.sh', 'utf8');
const qaBaseUrlMarker = ['NORTEX_QA', 'BASE_URL'].join('_');

describe('compuerta de integración requerida', () => {
  it('conserva los flujos heredados y NortexGPT en el mismo registro', () => {
    expect(REQUIRED_INTEGRATION_SUITES).toContain('tests/batchWarehouseManualMovements.test.ts');
    expect(REQUIRED_INTEGRATION_SUITES).toContain('tests/manualCashMovementVoid.integration.test.ts');
    expect(REQUIRED_INTEGRATION_SUITES).toContain('tests/purchaseSalePrice.integration.test.ts');
    expect(REQUIRED_INTEGRATION_SUITES).toContain('tests/assistantRuns.integration.test.ts');
    expect(gate).toContain('node scripts/verify-quality-suite-registration.mjs');
    expect(gate).toContain('node scripts/run-quality-integration.mjs');
  });
  it('descubre QA por contrato, recorre subdirectorios y propaga fallos de lectura', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nortex-gate-registration-'));
    try {
      await expect(discoverQualitySuites(root)).rejects.toThrow();
      await mkdir(join(root, 'tests/nested'), {recursive:true});
      await writeFile(join(root, 'tests/example.integration.test.ts'), '');
      await writeFile(join(root, 'tests/nested/http.test.ts'), `const url = process.env.${qaBaseUrlMarker};`);
      await writeFile(join(root, 'tests/ordinary.test.ts'), 'it("ordinary",()=>{});');
      expect(await discoverQualitySuites(root)).toEqual(['tests/example.integration.test.ts', 'tests/nested/http.test.ts']);
    } finally { await rm(root, {recursive:true, force:true}); }
  });
  it('rechaza nuevas suites no registradas, faltantes, registros vacíos y duplicados', () => {
    const file='tests/one.integration.test.ts';
    expect(validateQualitySuiteRegistration([file], [file], new Set([file]))).toEqual([file]);
    expect(()=>validateQualitySuiteRegistration([file], [file,'tests/new.integration.test.ts'], new Set([file]))).toThrow();
    expect(()=>validateQualitySuiteRegistration([file], [file], new Set())).toThrow();
    expect(()=>validateQualitySuiteRegistration([], [], new Set())).toThrow();
    expect(()=>validateQualitySuiteRegistration([file,file], [file], new Set([file]))).toThrow();
  });
  it('genera Prisma y prepara solo la base descartable antes de ejecutar el runner', () => {
    expect(gate).toContain('./node_modules/.bin/prisma generate --schema backend/prisma/schema.prisma');
    expect(gate).toContain('./node_modules/.bin/prisma db push --schema backend/prisma/schema.prisma --skip-generate');
    expect(gate).toContain("NORTEX_QA_DATABASE_ACK='disposable-database'");
  });
});
