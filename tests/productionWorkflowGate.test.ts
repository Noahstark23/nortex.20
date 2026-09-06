// @vitest-environment node
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

const parseWorkflow = (source: string) => {
    const document = parseDocument(source, { uniqueKeys: true });
    assert.deepEqual(document.errors, [], 'YAML válido, sin claves duplicadas');
    return document.toJS();
};
const source = readFileSync('.github/workflows/ci.yml', 'utf8');
const normalize = (value: unknown) => String(value).replace(/\s+/g, ' ').trim();
const productionCondition = "github.ref == 'refs/heads/main' && github.event_name == 'workflow_dispatch' && vars.NORTEX_DEPLOY_ENABLED == 'true' && inputs.production_approved == true && inputs.production_sha == github.sha";
const authorizationCommand = 'node scripts/authorize-production-release.mjs';

// Verifica el grafo y los pasos del YAML real, no comentarios ni una búsqueda
// que podría aceptar controles escritos en un job que nunca se ejecuta.
const assertProductionWiring = (workflow) => {
    const inputs = workflow.on.workflow_dispatch.inputs;
    assert.deepEqual({ type: inputs.production_approved.type, default: inputs.production_approved.default }, { type: 'boolean', default: false });
    assert.equal(inputs.production_sha.type, 'string');
    assert.equal(inputs.production_sha.default, '');
    assert.deepEqual(workflow.concurrency, { group: 'nortex-ci-${{ github.workflow }}-${{ github.ref }}', 'cancel-in-progress': true });

    const jobs = workflow.jobs;
    const production = jobs['deploy-production'];
    assert.equal(normalize(production.if), productionCondition);
    assert.deepEqual(production.needs, ['deploy-staging']);
    assert.equal(production.environment.name, 'production');
    assert.equal(production['continue-on-error'], undefined);
    assert.deepEqual(jobs['deploy-staging'].needs, ['verify', 'integration-required', 'deploy-schema-smoke', 'backup-restore-smoke']);
    assert.equal(jobs['deploy-staging']['continue-on-error'], undefined);
    for (const name of jobs['deploy-staging'].needs) {
        assert.ok(jobs[name], `Compuerta requerida: ${name}`);
        assert.equal(jobs[name]['continue-on-error'], undefined);
        assert.ok(jobs[name].steps.every(step => !step['continue-on-error']));
    }
    const runs = jobs.verify.steps.map(step => step.run);
    for (const command of ['npm test', 'npm run check:design', 'npm run test:mutation', 'npm run build:seo', 'npm audit --omit=dev --audit-level=moderate']) {
        assert.ok(runs.includes(command), command);
    }

    const steps = production.steps;
    const webhookIndex = steps.findIndex(step => step.env?.WEBHOOK === '${{ secrets.COOLIFY_PROD_WEBHOOK }}' && step.run?.includes('curl'));
    assert.ok(webhookIndex > 0, 'Webhook de producción presente');
    const authorization = steps[webhookIndex - 1];
    assert.equal(authorization.run, authorizationCommand);
    assert.deepEqual(authorization.env, {
        NORTEX_DEPLOY_ENABLED: '${{ vars.NORTEX_DEPLOY_ENABLED }}',
        PRODUCTION_APPROVED: '${{ inputs.production_approved }}',
        PRODUCTION_SHA: '${{ inputs.production_sha }}',
        STAGING_URL: '${{ vars.STAGING_URL }}',
        COOLIFY_PROD_WEBHOOK: '${{ secrets.COOLIFY_PROD_WEBHOOK }}',
        COOLIFY_TOKEN: '${{ secrets.COOLIFY_TOKEN }}',
    });
    assert.equal(authorization.if, undefined);
    assert.equal(authorization['continue-on-error'], undefined);
    assert.equal(steps[webhookIndex].if, undefined);
    assert.equal(steps[webhookIndex]['continue-on-error'], undefined);
    assert.ok(steps[webhookIndex].run.includes('test -n "$TOKEN"'));
    assert.ok(steps[webhookIndex].run.includes('--output /dev/null'));
    assert.ok(!steps[webhookIndex].run.includes('--show-error'));
    const verification = steps[webhookIndex + 1];
    assert.equal(verification.run, 'node scripts/verify-deployed-release.mjs "$APP_URL" "$EXPECTED_COMMIT"');
    assert.equal(verification.env.EXPECTED_COMMIT, '${{ github.sha }}');
    assert.equal(verification.if, undefined);
    assert.equal(verification['continue-on-error'], undefined);

    for (const [name, job] of Object.entries(jobs) as [string, any][]) {
        if (name !== 'deploy-production') {
            assert.notEqual(job.environment?.name ?? job.environment, 'production');
            assert.ok(!JSON.stringify(job).includes('COOLIFY_PROD_WEBHOOK'), `Webhook fuera del job protegido: ${name}`);
        }
    }
};

describe('cableado obligatorio de la promoción de producción', () => {
    it('exige intención explícita, todas las compuertas, environment y comprobación después de aprobación', () => {
        assertProductionWiring(parseWorkflow(source));
    });

    it.each([
        ['push autorizado sin intención', workflow => { workflow.jobs['deploy-production'].if = productionCondition.replace("github.event_name == 'workflow_dispatch'", "(github.event_name == 'push' || github.event_name == 'workflow_dispatch')"); }],
        ['dispatch sin aprobación', workflow => { workflow.jobs['deploy-production'].if = productionCondition.replace(' && inputs.production_approved == true', ''); }],
        ['SHA sin vínculo al workflow', workflow => { workflow.jobs['deploy-production'].if = productionCondition.replace(' && inputs.production_sha == github.sha', ''); }],
        ['aprobación predeterminada', workflow => { workflow.on.workflow_dispatch.inputs.production_approved.default = true; }],
        ['salto de staging', workflow => { workflow.jobs['deploy-production'].needs = ['verify']; }],
        ['integración omitida', workflow => { workflow.jobs['deploy-staging'].needs = ['verify', 'deploy-schema-smoke', 'backup-restore-smoke']; }],
        ['aprobación environment omitida', workflow => { delete workflow.jobs['deploy-production'].environment; }],
        ['fallo de gate ignorado', workflow => { workflow.jobs['deploy-production'].steps.find(step => step.run === authorizationCommand)['continue-on-error'] = true; }],
        ['gate saltado', workflow => { workflow.jobs['deploy-production'].steps.find(step => step.run === authorizationCommand).if = 'false'; }],
        ['gate eliminado', workflow => { workflow.jobs['deploy-production'].steps = workflow.jobs['deploy-production'].steps.filter(step => step.run !== authorizationCommand); }],
        ['SHA hardcodeado', workflow => { workflow.jobs['deploy-production'].steps.find(step => step.run === authorizationCommand).env.PRODUCTION_SHA = 'a'.repeat(40); }],
        ['token ausente en comprobación Coolify', workflow => { delete workflow.jobs['deploy-production'].steps.find(step => step.run === authorizationCommand).env.COOLIFY_TOKEN; }],
        ['destino distinto en comprobación Coolify', workflow => { workflow.jobs['deploy-production'].steps.find(step => step.run === authorizationCommand).env.COOLIFY_PROD_WEBHOOK = '${{ secrets.COOLIFY_STAGING_WEBHOOK }}'; }],
        ['respuesta sensible impresa', workflow => { workflow.jobs['deploy-production'].steps.find(step => step.run?.includes('curl') && step.env?.WEBHOOK === '${{ secrets.COOLIFY_PROD_WEBHOOK }}').run = 'curl --show-error "$WEBHOOK"'; }],
        ['webhook alternativo', workflow => { workflow.jobs.bypass = { steps: [{ env: { WEBHOOK: '${{ secrets.COOLIFY_PROD_WEBHOOK }}' }, run: 'curl "$WEBHOOK"' }] }; }],
    ])('rechaza la regresión: %s', (_name, mutate) => {
        const workflow = parseWorkflow(source);
        mutate(workflow);
        expect(() => assertProductionWiring(workflow)).toThrow();
    });

    it('ningún otro workflow del repositorio expone una vía de producción', () => {
        for (const path of readdirSync('.github/workflows').filter(name => /\.ya?ml$/.test(name) && name !== 'ci.yml')) {
            const workflow = parseWorkflow(readFileSync(`.github/workflows/${path}`, 'utf8'));
            expect(JSON.stringify(workflow), path).not.toContain('COOLIFY_PROD_WEBHOOK');
            for (const job of Object.values(workflow.jobs ?? {}) as any[]) {
                expect(job.environment?.name ?? job.environment, path).not.toBe('production');
            }
        }
    });

    it('rechaza claves YAML duplicadas que podrían esconder una segunda condición', () => {
        expect(() => parseWorkflow('jobs:\n  deploy-production:\n    if: false\n    if: true\n')).toThrow();
    });
});
