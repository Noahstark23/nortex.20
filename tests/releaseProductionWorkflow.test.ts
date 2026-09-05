// @vitest-environment node
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

type Workflow = Record<string, any>;

const parseWorkflow = (source: string): Workflow => {
    const document = parseDocument(source, { uniqueKeys: true });
    assert.deepEqual(document.errors, [], 'YAML válido, sin claves duplicadas');
    return document.toJS() as Workflow;
};

const normalize = (value: unknown) => String(value).replace(/\s+/g, ' ').trim();
const ciSource = readFileSync('.github/workflows/ci.yml', 'utf8');
const productionSource = readFileSync('.github/workflows/release-production.yml', 'utf8');
const candidateGate = 'node scripts/authorize-production-release.mjs';
const stagingCondition = "github.ref == 'refs/heads/main' && github.event_name == 'push' && vars.NORTEX_DEPLOY_ENABLED == 'true'";

const findStep = (steps: Workflow[], name: string) => {
    const step = steps.find((candidate) => candidate.name === name);
    assert.ok(step, `Paso requerido: ${name}`);
    return step;
};

const assertCiWiring = (workflow: Workflow) => {
    assert.ok(workflow.on.workflow_dispatch !== undefined, 'CI mantiene la compuerta manual de verificación');
    assert.equal(workflow.jobs['deploy-production'], undefined, 'CI no puede contener producción');

    const staging = workflow.jobs['deploy-staging'];
    assert.equal(normalize(staging.if), stagingCondition);
    assert.deepEqual(staging.needs, ['verify', 'deploy-schema-smoke', 'backup-restore-smoke']);
    assert.equal(staging.environment.name, 'staging');
    assert.ok(!normalize(staging.if).includes('workflow_dispatch'));

    for (const [name, job] of Object.entries(workflow.jobs) as [string, Workflow][]) {
        assert.notEqual(job.environment?.name ?? job.environment, 'production', `environment de producción en CI: ${name}`);
        assert.ok(!JSON.stringify(job).includes('COOLIFY_PROD_WEBHOOK'), `webhook de producción en CI: ${name}`);
    }
};

const assertProductionWiring = (workflow: Workflow) => {
    assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
    const inputs = workflow.on.workflow_dispatch.inputs;
    assert.deepEqual(
        { required: inputs.candidate_sha.required, type: inputs.candidate_sha.type },
        { required: true, type: 'string' },
    );
    assert.deepEqual(
        { required: inputs.confirmation.required, type: inputs.confirmation.type },
        { required: true, type: 'string' },
    );
    assert.deepEqual(workflow.permissions, { contents: 'read' });
    assert.deepEqual(workflow.concurrency, {
        group: 'nortex-production-promotion',
        'cancel-in-progress': false,
    });

    const preflight = workflow.jobs.preflight;
    assert.equal(preflight.environment, undefined, 'preflight no puede acceder al environment de producción');
    assert.equal(preflight['continue-on-error'], undefined);
    assert.equal(preflight.if, undefined);
    assert.ok(!JSON.stringify(preflight).includes('secrets.'), 'preflight no puede leer secretos');
    const preflightGate = findStep(preflight.steps, 'Verificar intención, main y staging del candidato');
    assert.equal(preflightGate.run, candidateGate);
    assert.equal(preflightGate.if, undefined);
    assert.deepEqual(preflightGate.env, {
        CANDIDATE_SHA: '${{ inputs.candidate_sha }}',
        PRODUCTION_CONFIRMATION: '${{ inputs.confirmation }}',
        NORTEX_PRODUCTION_DEPLOY_ENABLED: '${{ vars.NORTEX_PRODUCTION_DEPLOY_ENABLED }}',
        STAGING_URL: '${{ vars.STAGING_URL }}',
    });

    const production = workflow.jobs['deploy-production'];
    assert.deepEqual(production.needs, ['preflight']);
    assert.equal(production.if, undefined);
    assert.deepEqual(production.environment, {
        name: 'production',
        url: '${{ vars.PROD_URL }}',
    });
    const checkout = production.steps.find((step: Workflow) => step.uses === 'actions/checkout@v4');
    assert.ok(checkout, 'checkout de candidato requerido');
    assert.equal(checkout.with.ref, '${{ inputs.candidate_sha }}');

    const postApprovalGate = findStep(production.steps, 'Revalidar candidato después de la aprobación');
    assert.equal(postApprovalGate.run, candidateGate);
    assert.equal(postApprovalGate.if, undefined);
    assert.deepEqual(postApprovalGate.env, preflightGate.env);
    const coolifyTarget = findStep(production.steps, 'Verificar destino Coolify fijado al candidato');
    assert.equal(coolifyTarget.run, 'node scripts/verify-coolify-production-target.mjs');
    assert.equal(coolifyTarget.if, undefined);
    assert.deepEqual(coolifyTarget.env, {
        CANDIDATE_SHA: '${{ inputs.candidate_sha }}',
        COOLIFY_PROD_WEBHOOK: '${{ secrets.COOLIFY_PROD_WEBHOOK }}',
        COOLIFY_TOKEN: '${{ secrets.COOLIFY_PROD_READ_TOKEN }}',
    });
    const config = findStep(production.steps, 'Validar configuración de PROD');
    const webhook = findStep(production.steps, 'Desplegar PROD (webhook de Coolify)');
    const verification = findStep(production.steps, 'Verificar PROD sano y en el candidato esperado');
    const gateIndex = production.steps.indexOf(postApprovalGate);
    assert.ok(production.steps.indexOf(coolifyTarget) > gateIndex, 'destino Coolify después de la revalidación');
    assert.ok(production.steps.indexOf(config) > production.steps.indexOf(coolifyTarget), 'configuración después del destino');
    assert.ok(production.steps.indexOf(webhook) > production.steps.indexOf(config), 'webhook después de validación');
    assert.ok(production.steps.indexOf(verification) > production.steps.indexOf(webhook), 'health después del webhook');
    assert.equal(webhook.env.WEBHOOK, '${{ secrets.COOLIFY_PROD_WEBHOOK }}');
    assert.equal(verification.env.EXPECTED_COMMIT, '${{ inputs.candidate_sha }}');
    assert.equal(postApprovalGate['continue-on-error'], undefined);
    assert.equal(coolifyTarget['continue-on-error'], undefined);
    assert.equal(config['continue-on-error'], undefined);
    assert.equal(webhook['continue-on-error'], undefined);
    assert.equal(verification['continue-on-error'], undefined);
    assert.equal(config.if, undefined);
    assert.equal(webhook.if, undefined);
    assert.equal(verification.if, undefined);
    assert.equal(config.env.READ_TOKEN, '${{ secrets.COOLIFY_PROD_READ_TOKEN }}');
    assert.equal(webhook.env.TOKEN, '${{ secrets.COOLIFY_PROD_DEPLOY_TOKEN }}');
    assert.ok(webhook.run.includes('--output /dev/null'));
    assert.ok(!webhook.run.includes('--show-error'));

    for (const [name, job] of Object.entries(workflow.jobs) as [string, Workflow][]) {
        if (name === 'deploy-production') continue;
        assert.ok(!JSON.stringify(job).includes('COOLIFY_PROD_WEBHOOK'), `webhook fuera del job protegido: ${name}`);
        assert.notEqual(job.environment?.name ?? job.environment, 'production', `environment fuera del job protegido: ${name}`);
    }
};

const assertNoOtherProductionRoute = () => {
    for (const path of readdirSync('.github/workflows').filter((name) => /\.ya?ml$/.test(name))) {
        if (path === 'ci.yml' || path === 'release-production.yml') continue;
        const workflow = parseWorkflow(readFileSync(`.github/workflows/${path}`, 'utf8'));
        for (const [name, job] of Object.entries(workflow.jobs ?? {}) as [string, Workflow][]) {
            assert.notEqual(job.environment?.name ?? job.environment, 'production', `${path}:${name}`);
            assert.ok(!JSON.stringify(job).includes('COOLIFY_PROD_WEBHOOK'), `${path}:${name}`);
        }
    }
};

describe('contrato de separación CI, staging y producción', () => {
    it('deja producción fuera de CI y solo la admite por promoción manual de candidato', () => {
        assertCiWiring(parseWorkflow(ciSource));
        assertProductionWiring(parseWorkflow(productionSource));
        assertNoOtherProductionRoute();
        expect(productionSource).not.toContain('github.sha');
        expect(productionSource).not.toContain('secrets.COOLIFY_TOKEN');
    });

    it.each([
        ['producción reintroducida en CI', (ci: Workflow) => {
            ci.jobs['deploy-production'] = { environment: { name: 'production' } };
        }, (_production: Workflow) => {}],
        ['staging manual por CI', (ci: Workflow) => {
            ci.jobs['deploy-staging'].if = `${stagingCondition} || github.event_name == 'workflow_dispatch'`;
        }, (_production: Workflow) => {}],
        ['push en workflow de producción', (_ci: Workflow) => {}, (production: Workflow) => {
            production.on.push = { branches: ['main'] };
        }],
        ['SHA opcional', (_ci: Workflow) => {}, (production: Workflow) => {
            production.on.workflow_dispatch.inputs.candidate_sha.required = false;
        }],
        ['confirmación eliminada', (_ci: Workflow) => {}, (production: Workflow) => {
            delete production.on.workflow_dispatch.inputs.confirmation;
        }],
        ['preflight protegido prematuramente', (_ci: Workflow) => {}, (production: Workflow) => {
            production.jobs.preflight.environment = { name: 'production' };
        }],
        ['gate posterior eliminado', (_ci: Workflow) => {}, (production: Workflow) => {
            production.jobs['deploy-production'].steps = production.jobs['deploy-production'].steps
                .filter((step: Workflow) => step.name !== 'Revalidar candidato después de la aprobación');
        }],
        ['gate posterior omitido', (_ci: Workflow) => {}, (production: Workflow) => {
            const gate = production.jobs['deploy-production'].steps
                .find((step: Workflow) => step.name === 'Revalidar candidato después de la aprobación');
            gate.if = 'false';
        }],
        ['job de producción fuerza ejecución tras preflight fallido', (_ci: Workflow) => {}, (production: Workflow) => {
            production.jobs['deploy-production'].if = 'always()';
        }],
        ['pin de Coolify eliminado', (_ci: Workflow) => {}, (production: Workflow) => {
            production.jobs['deploy-production'].steps = production.jobs['deploy-production'].steps
                .filter((step: Workflow) => step.name !== 'Verificar destino Coolify fijado al candidato');
        }],
        ['verificación final ignorada', (_ci: Workflow) => {}, (production: Workflow) => {
            const verification = production.jobs['deploy-production'].steps
                .find((step: Workflow) => step.name === 'Verificar PROD sano y en el candidato esperado');
            verification['continue-on-error'] = true;
        }],
        ['checkout no usa candidato', (_ci: Workflow) => {}, (production: Workflow) => {
            const checkout = production.jobs['deploy-production'].steps
                .find((step: Workflow) => step.uses === 'actions/checkout@v4');
            checkout.with.ref = '${{ github.sha }}';
        }],
        ['webhook fuera del job protegido', (_ci: Workflow) => {}, (production: Workflow) => {
            production.jobs.preflight.steps.push({
                env: { WEBHOOK: '${{ secrets.COOLIFY_PROD_WEBHOOK }}' },
                run: 'curl "$WEBHOOK"',
            });
        }],
        ['webhook imprime respuesta de Coolify', (_ci: Workflow) => {}, (production: Workflow) => {
            const webhook = production.jobs['deploy-production'].steps
                .find((step: Workflow) => step.name === 'Desplegar PROD (webhook de Coolify)');
            webhook.run = 'curl --show-error "$WEBHOOK"';
        }],
    ])('rechaza la regresión: %s', (_name, mutateCi, mutateProduction) => {
        const ci = parseWorkflow(ciSource);
        const production = parseWorkflow(productionSource);
        mutateCi(ci);
        mutateProduction(production);
        expect(() => {
            assertCiWiring(ci);
            assertProductionWiring(production);
        }).toThrow();
    });

    it('rechaza claves YAML duplicadas que podrían ocultar una condición', () => {
        expect(() => parseWorkflow('jobs:\n  deploy-production:\n    if: false\n    if: true\n')).toThrow();
    });
});
