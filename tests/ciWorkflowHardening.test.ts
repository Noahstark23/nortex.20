// @vitest-environment node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

const source = readFileSync('.github/workflows/ci.yml', 'utf8');
const document = parseDocument(source, { uniqueKeys: true });
assert.deepEqual(document.errors, [], 'CI debe ser YAML válido y sin claves duplicadas');
const workflow = document.toJS() as Record<string, any>;

describe('CI: mínimo privilegio y toolchain fijado', () => {
    it('declara un token de solo lectura para CI', () => {
        expect(workflow.permissions).toEqual({ contents: 'read' });
    });

    it('usa exactamente el Node fijado y nunca permite que npx descargue Prisma/TypeScript', () => {
        const setupNodes = JSON.stringify(workflow).match(/actions\/setup-node@v4/g) ?? [];
        expect(setupNodes).toHaveLength(3);
        expect(source).toContain('node-version: 22.23.2');
        expect(source.match(/node-version: 22\.23\.2/g)).toHaveLength(3);
        expect(source).not.toMatch(/\bnpx prisma\b|\bnpx tsc\b/);
        expect(source.match(/npx --no-install prisma/g)?.length).toBeGreaterThanOrEqual(4);
        expect(source).toContain('npx --no-install tsc --noEmit');
    });

    it('solo ejecuta mutación costosa cuando se solicita para lógica monetaria', () => {
        const mutation = workflow.jobs.verify.steps.find((step: Record<string, unknown>) => step.run === 'npm run test:mutation');
        expect(mutation?.if).toBe("github.event_name == 'workflow_dispatch' && vars.NORTEX_CI_MUTATION == 'true'");
    });

    it('exige el espejo SQL y los estados parciales además del smoke de db push', () => {
        const job = workflow.jobs['deploy-schema-smoke'];
        const checkout = job.steps.find((step: Record<string, unknown>) => step.uses === 'actions/checkout@v4');
        const mirror = job.steps.filter((step: Record<string, unknown>) => step.run === 'node scripts/qa/test-assistant-budget-upgrade.mjs');
        expect(checkout?.with?.['fetch-depth']).toBe(0);
        expect(mirror).toHaveLength(1);
        expect(mirror[0].if).toBeUndefined();
        expect(mirror[0]['continue-on-error']).toBeUndefined();
        expect(job['continue-on-error']).toBeUndefined();
        expect(mirror[0].env).toBeUndefined();
    });
});
