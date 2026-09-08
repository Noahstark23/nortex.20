// @vitest-environment node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

type Workflow = Record<string, any>;

const parseWorkflow = (source: string): Workflow => {
    const document = parseDocument(source, { uniqueKeys: true });
    assert.deepEqual(document.errors, [], 'YAML válido, sin claves duplicadas');
    return document.toJS() as Workflow;
};

const ciSource = readFileSync('.github/workflows/ci.yml', 'utf8');
const productionSource = readFileSync('.github/workflows/release-production.yml', 'utf8');
const candidateSha = '$' + '{{ inputs.candidate_sha }}';
const confirmation = '$' + '{{ inputs.confirmation }}';
const productionWebhook = '$' + '{{ secrets.COOLIFY_PROD_WEBHOOK }}';

// La verificación detallada vive en releaseProductionWorkflow.test.ts. Esta
// prueba protege el límite de seguridad: CI valida; solo la promoción manual
// puede alcanzar secretos, environment y webhook de producción.
const assertSeparatedPromotion = (ci: Workflow, production: Workflow) => {
    assert.equal(ci.jobs['deploy-production'], undefined, 'CI no despliega producción');
    assert.equal(ci.jobs['deploy-staging'], undefined, 'CI no despliega staging');
    for (const [name, job] of Object.entries(ci.jobs) as [string, Workflow][]) {
        const serialized = JSON.stringify(job);
        assert.notEqual(job.environment?.name ?? job.environment, 'production', 'environment de producción en CI: ' + name);
        assert.ok(!serialized.includes('COOLIFY_PROD_WEBHOOK'), 'webhook de producción en CI: ' + name);
        assert.ok(!serialized.includes('COOLIFY_PROD_READ_TOKEN'), 'token de lectura de producción en CI: ' + name);
    }

    assert.deepEqual(Object.keys(production.on), ['workflow_dispatch']);
    const inputs = production.on.workflow_dispatch.inputs;
    assert.deepEqual(
        { required: inputs.candidate_sha.required, type: inputs.candidate_sha.type },
        { required: true, type: 'string' },
    );
    assert.deepEqual(
        { required: inputs.confirmation.required, type: inputs.confirmation.type },
        { required: true, type: 'string' },
    );
    const deploy = production.jobs['deploy-production'];
    assert.deepEqual(deploy.needs, ['preflight']);
    assert.equal(deploy.environment.name, 'production');
    assert.equal(deploy['continue-on-error'], undefined);
    const authorization = deploy.steps.find((step: Workflow) => step.run === 'node scripts/authorize-production-release.mjs');
    assert.ok(authorization, 'revalidación post-aprobación requerida');
    assert.equal(authorization['continue-on-error'], undefined);
    assert.deepEqual(authorization.env, {
        CANDIDATE_SHA: candidateSha,
        PRODUCTION_CONFIRMATION: confirmation,
        NORTEX_PRODUCTION_DEPLOY_ENABLED: '$' + '{{ vars.NORTEX_PRODUCTION_DEPLOY_ENABLED }}',
        STAGING_URL: '$' + '{{ vars.STAGING_URL }}',
    });
    const webhook = deploy.steps.find((step: Workflow) => step.env?.WEBHOOK === productionWebhook);
    assert.ok(webhook, 'webhook de producción requerido solo después de preflight');
    assert.equal(webhook['continue-on-error'], undefined);
};

describe('separación obligatoria de CI y promoción de producción', () => {
    it('deja producción fuera de CI y exige una promoción manual protegida', () => {
        assertSeparatedPromotion(parseWorkflow(ciSource), parseWorkflow(productionSource));
    });

    it.each([
        ['ruta de despliegue dentro de CI', (ci: Workflow) => { ci.jobs['deploy-production'] = { 'runs-on': 'ubuntu-latest' }; }, () => undefined],
        ['secreto de producción dentro de CI', (ci: Workflow) => { ci.jobs.verify.env = { WEBHOOK: productionWebhook }; }, () => undefined],
        ['trigger push en producción', () => undefined, (production: Workflow) => { production.on.push = { branches: ['main'] }; }],
        ['SHA opcional', () => undefined, (production: Workflow) => { production.on.workflow_dispatch.inputs.candidate_sha.required = false; }],
        ['environment omitido', () => undefined, (production: Workflow) => { delete production.jobs['deploy-production'].environment; }],
        ['preflight saltado', () => undefined, (production: Workflow) => { production.jobs['deploy-production'].needs = []; }],
        ['fallo de revalidación ignorado', () => undefined, (production: Workflow) => { production.jobs['deploy-production'].steps.find((step: Workflow) => step.run === 'node scripts/authorize-production-release.mjs')['continue-on-error'] = true; }],
    ])('rechaza la regresión: %s', (_name, mutateCi, mutateProduction) => {
        const ci = parseWorkflow(ciSource);
        const production = parseWorkflow(productionSource);
        mutateCi(ci);
        mutateProduction(production);
        expect(() => assertSeparatedPromotion(ci, production)).toThrow();
    });

    it('rechaza claves YAML duplicadas que podrían ocultar una segunda condición', () => {
        expect(() => parseWorkflow('jobs:\n  deploy-production:\n    if: false\n    if: true\n')).toThrow();
    });
});
