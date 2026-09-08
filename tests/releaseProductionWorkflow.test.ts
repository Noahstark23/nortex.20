// @vitest-environment node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

type Workflow = Record<string, any>;

const inputSha = '$' + '{{ inputs.candidate_sha }}';
const inputConfirmation = '$' + '{{ inputs.confirmation }}';
const githubToken = '$' + '{{ github.token }}';
const stagingWebhook = '$' + '{{ secrets.COOLIFY_STAGING_WEBHOOK }}';
const stagingReadToken = '$' + '{{ secrets.COOLIFY_STAGING_READ_TOKEN }}';
const stagingApiOrigin = '$' + '{{ vars.COOLIFY_STAGING_API_ORIGIN }}';
const stagingApplicationUuid = '$' + '{{ vars.COOLIFY_STAGING_APPLICATION_UUID }}';
const productionWebhook = '$' + '{{ secrets.COOLIFY_PROD_WEBHOOK }}';
const productionReadToken = '$' + '{{ secrets.COOLIFY_PROD_READ_TOKEN }}';
const productionApiOrigin = '$' + '{{ vars.COOLIFY_PROD_API_ORIGIN }}';
const productionApplicationUuid = '$' + '{{ vars.COOLIFY_PROD_APPLICATION_UUID }}';

const parse = (source: string): Workflow => {
    const document = parseDocument(source, { uniqueKeys: true });
    assert.deepEqual(document.errors, [], 'YAML válido, sin claves duplicadas');
    return document.toJS() as Workflow;
};

const ciSource = readFileSync('.github/workflows/ci.yml', 'utf8');
const stagingSource = readFileSync('.github/workflows/release-staging.yml', 'utf8');
const productionSource = readFileSync('.github/workflows/release-production.yml', 'utf8');

const step = (steps: Workflow[], name: string): Workflow => {
    const found = steps.find((candidate) => candidate.name === name);
    assert.ok(found, 'Paso requerido: ' + name);
    return found;
};

const rootOriginValidator = (config: Workflow): string => {
    const match = /node -e '\n([\s\S]*?)\n' \|\|/.exec(config.run);
    const script = match?.[1];
    assert.equal(typeof script, 'string', 'validador de origen requerido');
    return script;
};

const validateRootOrigin = (validator: string, appUrl: string) => spawnSync(
    process.execPath,
    ['-e', validator],
    {
        encoding: 'utf8',
        env: { APP_URL: appUrl },
        timeout: 1_000,
    },
);

const assertManualStagingGate = (gate: Workflow, scope: string) => {
    assert.equal(gate.if, undefined, scope + ': gate opcional');
    assert.equal(gate['continue-on-error'], undefined, scope + ': gate ignora errores');
    assert.deepEqual(gate.env, {
        CANDIDATE_SHA: inputSha,
        STAGING_CONFIRMATION: inputConfirmation,
        NORTEX_DEPLOY_ENABLED: '$' + '{{ vars.NORTEX_DEPLOY_ENABLED }}',
    });
    for (const required of [
        'set -euo pipefail',
        '[ "$GITHUB_EVENT_NAME" = "workflow_dispatch" ]',
        '[ "$GITHUB_REF" = "refs/heads/main" ]',
        '[ "$NORTEX_DEPLOY_ENABLED" = "true" ]',
        '[[ "$CANDIDATE_SHA" =~ ^[a-f0-9]{40}$ ]]',
        '[ "$CANDIDATE_SHA" = "$GITHUB_SHA" ]',
        '[ "$STAGING_CONFIRMATION" = "STAGE $CANDIDATE_SHA" ]',
        'git fetch --no-tags origin main',
        'git rev-parse origin/main',
        '[ "$CURRENT_MAIN" = "$CANDIDATE_SHA" ]',
    ]) {
        assert.ok(gate.run.includes(required), scope + ': falta ' + required);
    }
};

const assertTerminalCiGate = (gate: Workflow, scope: string) => {
    assert.equal(gate.uses, 'actions/github-script@v9', scope + ': usa el cliente GitHub oficial');
    assert.equal(gate.if, undefined, scope + ': gate opcional');
    assert.equal(gate['continue-on-error'], undefined, scope + ': gate ignora errores');
    assert.deepEqual(gate.env, { CANDIDATE_SHA: inputSha });
    assert.equal(gate.with['github-token'], githubToken);
    assert.ok(!JSON.stringify(gate).includes('secrets.'), scope + ': no debe leer secretos');
    const script = gate.with.script;
    for (const required of [
        'github.rest.actions.listWorkflowRuns',
        "workflow_id: 'ci.yml'",
        'head_sha: candidate',
        "branch: 'main'",
        "event: 'push'",
        'run.head_sha === candidate',
        "run.head_branch === 'main'",
        "run.event === 'push'",
        "const expectedPath = '.github/workflows/ci.yml';",
        'run.path === expectedPath',
        'runs.every((run) =>',
        "run.status === 'completed'",
        "run.conclusion === 'success'",
        "throw new Error('CI_TERMINAL_SUCCESS_REQUIRED')",
    ]) {
        assert.ok(script.includes(required), scope + ': falta ' + required);
    }
    assert.ok(!script.includes("status: 'completed'"), scope + ': no debe ocultar runs pendientes');
    assert.ok(!script.includes('runs.some'), scope + ': un único CI verde no puede ocultar otro fallido o pendiente');
    assert.ok(!script.includes('console.log'), scope + ': no debe imprimir respuesta de API');
};

const assertSuccessfulManualStagingGate = (gate: Workflow, scope: string) => {
    assert.equal(gate.uses, 'actions/github-script@v9', scope + ': usa el cliente GitHub oficial');
    assert.equal(gate.if, undefined, scope + ': gate opcional');
    assert.equal(gate['continue-on-error'], undefined, scope + ': gate ignora errores');
    assert.deepEqual(gate.env, { CANDIDATE_SHA: inputSha });
    assert.equal(gate.with['github-token'], githubToken);
    assert.ok(!JSON.stringify(gate).includes('secrets.'), scope + ': no debe leer secretos');
    const script = gate.with.script;
    for (const required of [
        'github.rest.actions.listWorkflowRuns',
        "workflow_id: 'release-staging.yml'",
        'head_sha: candidate',
        "branch: 'main'",
        "event: 'workflow_dispatch'",
        'run.head_sha === candidate',
        "run.head_branch === 'main'",
        "run.event === 'workflow_dispatch'",
        "const expectedPath = '.github/workflows/release-staging.yml';",
        'run.path === expectedPath',
        'runs.some',
        "run.status === 'completed'",
        "run.conclusion === 'success'",
        "throw new Error('MANUAL_STAGING_SUCCESS_REQUIRED')",
    ]) {
        assert.ok(script.includes(required), scope + ': falta ' + required);
    }
    assert.ok(!script.includes('console.log'), scope + ': no debe imprimir respuesta de API');
};

const assertCi = (workflow: Workflow) => {
    assert.ok(workflow.on.workflow_dispatch !== undefined, 'CI conserva dispatch de verificación');
    assert.equal(workflow.jobs['deploy-production'], undefined, 'CI no puede contener producción');
    assert.equal(workflow.jobs['deploy-staging'], undefined, 'CI no puede contener staging');
    const integration = workflow.jobs['integration-required'];
    assert.ok(integration, 'CI requiere integración aislada');
    assert.deepEqual(integration.needs, ['verify']);
    assert.equal(integration.if, undefined, 'integración no puede ser opcional');
    assert.equal(integration['continue-on-error'], undefined, 'integración no puede ignorar errores');
    assert.equal(
        integration.steps.find((item: Workflow) => item.uses === 'jdx/mise-action@v4')?.uses,
        'jdx/mise-action@v4',
        'mise debe fijar el runtime canónico',
    );
    const mysqlPull = integration.steps
        .find((item: Workflow) => item.name === 'Preparar MySQL 8 solo para la compuerta CI');
    const requiredIntegration = integration.steps
        .find((item: Workflow) => item.name === 'Integración obligatoria de dinero e inventario');
    assert.equal(
        mysqlPull?.run,
        'docker pull mysql:8.0',
    );
    assert.equal(
        requiredIntegration?.run,
        'npm run test:integration:required',
    );
    assert.equal(mysqlPull?.if, undefined);
    assert.equal(mysqlPull?.['continue-on-error'], undefined);
    assert.equal(requiredIntegration?.if, undefined);
    assert.equal(requiredIntegration?.['continue-on-error'], undefined);
    for (const [name, job] of Object.entries(workflow.jobs) as [string, Workflow][]) {
        const text = JSON.stringify(job);
        assert.notEqual(job.environment?.name ?? job.environment, 'production', 'producción en CI: ' + name);
        assert.notEqual(job.environment?.name ?? job.environment, 'staging', 'staging en CI: ' + name);
        assert.ok(!text.includes('COOLIFY_PROD_WEBHOOK'), 'webhook de producción en CI: ' + name);
        assert.ok(!text.includes('COOLIFY_PROD_READ_TOKEN'), 'lectura de producción en CI: ' + name);
        assert.ok(!text.includes('COOLIFY_STAGING_WEBHOOK'), 'webhook de staging en CI: ' + name);
        assert.ok(!text.includes('COOLIFY_STAGING_READ_TOKEN'), 'lectura de staging en CI: ' + name);
    }
};

const assertStaging = (workflow: Workflow) => {
    assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
    const inputs = workflow.on.workflow_dispatch.inputs;
    assert.equal(inputs.candidate_sha.required, true);
    assert.equal(inputs.candidate_sha.type, 'string');
    assert.equal(inputs.confirmation.required, true);
    assert.equal(inputs.confirmation.type, 'string');
    assert.deepEqual(workflow.permissions, { contents: 'read', actions: 'read' });
    assert.deepEqual(workflow.concurrency, {
        group: 'nortex-staging-promotion',
        'cancel-in-progress': false,
    });

    const preflight = workflow.jobs.preflight;
    assert.equal(preflight.environment, undefined, 'preflight no toca environment');
    assert.equal(preflight.if, undefined);
    assert.equal(preflight['continue-on-error'], undefined);
    assert.ok(!JSON.stringify(preflight).includes('secrets.'), 'preflight no puede leer secretos');
    const candidateGate = step(preflight.steps, 'Verificar intención, main y SHA del candidato');
    const preflightCi = step(preflight.steps, 'Verificar CI terminal y exitoso del candidato');
    assertManualStagingGate(candidateGate, 'preflight');
    assertTerminalCiGate(preflightCi, 'preflight CI');
    assert.ok(preflight.steps.indexOf(preflightCi) > preflight.steps.indexOf(candidateGate));

    const deploy = workflow.jobs['deploy-staging'];
    assert.deepEqual(deploy.needs, ['preflight']);
    assert.equal(deploy.if, undefined, 'staging no puede forzarse');
    assert.equal(deploy['continue-on-error'], undefined);
    assert.deepEqual(deploy.environment, {
        name: 'staging',
        url: '$' + '{{ vars.STAGING_URL }}',
    });
    const checkout = deploy.steps.find((item: Workflow) => item.uses === 'actions/checkout@v4');
    assert.ok(checkout, 'checkout de candidato requerido');
    assert.equal(checkout.with.ref, inputSha);
    assert.equal(checkout.with['fetch-depth'], 0);

    const postApproval = step(deploy.steps, 'Revalidar candidato después de la aprobación');
    const postApprovalCi = step(deploy.steps, 'Verificar CI terminal y exitoso del candidato');
    const coolifyTarget = step(deploy.steps, 'Verificar destino Coolify de staging fijado al candidato');
    const config = step(deploy.steps, 'Validar configuración de STAGING');
    const webhook = step(deploy.steps, 'Desplegar STAGING (webhook de Coolify)');
    const health = step(deploy.steps, 'Verificar STAGING sano y en el candidato esperado');
    assertManualStagingGate(postApproval, 'post-aprobación');
    assertTerminalCiGate(postApprovalCi, 'post-aprobación CI');
    assert.ok(deploy.steps.indexOf(postApprovalCi) > deploy.steps.indexOf(postApproval));
    assert.equal(coolifyTarget.run, 'node scripts/verify-coolify-staging-target.mjs');
    assert.equal(coolifyTarget.if, undefined);
    assert.equal(coolifyTarget['continue-on-error'], undefined);
    assert.deepEqual(coolifyTarget.env, {
        CANDIDATE_SHA: inputSha,
        COOLIFY_STAGING_WEBHOOK: stagingWebhook,
        COOLIFY_STAGING_API_ORIGIN: stagingApiOrigin,
        COOLIFY_STAGING_APPLICATION_UUID: stagingApplicationUuid,
        COOLIFY_STAGING_READ_TOKEN: stagingReadToken,
    });
    assert.ok(deploy.steps.indexOf(config) > deploy.steps.indexOf(postApprovalCi), 'configuración posterior a los checks');
    assert.ok(deploy.steps.indexOf(coolifyTarget) > deploy.steps.indexOf(config), 'destino después de validar configuración');
    assert.ok(deploy.steps.indexOf(webhook) > deploy.steps.indexOf(coolifyTarget), 'webhook después de validar destino');
    assert.ok(deploy.steps.indexOf(health) > deploy.steps.indexOf(webhook), 'health debe ser posterior');
    assert.deepEqual(config.env, {
        WEBHOOK: stagingWebhook,
        APP_URL: '$' + '{{ vars.STAGING_URL }}',
    });
    const stagingValidator = rootOriginValidator(config);
    assert.equal(validateRootOrigin(stagingValidator, 'https://staging.example.test').status, 0);
    for (const unsafeUrl of [
        'https://staging.example.test/app',
        'https://staging.example.test/.',
        'https://staging.example.test?candidate=other',
        'https://@staging.example.test',
        ' https://staging.example.test',
    ]) {
        assert.notEqual(validateRootOrigin(stagingValidator, unsafeUrl).status, 0,
            'STAGING_URL ambigua no puede llegar al webhook: ' + unsafeUrl);
    }
    assert.deepEqual(webhook.env, {
        WEBHOOK: stagingWebhook,
        TOKEN: '$' + '{{ secrets.COOLIFY_TOKEN }}',
    });
    assert.ok(webhook.run.includes('--output /dev/null'));
    assert.ok(webhook.run.includes('--max-time 30'));
    assert.ok(!webhook.run.includes('--retry'), 'webhook de staging no puede reintentarse sin idempotencia');
    assert.ok(!webhook.run.includes('--show-error'));
    assert.equal(config['continue-on-error'], undefined);
    assert.equal(coolifyTarget['continue-on-error'], undefined);
    assert.equal(webhook['continue-on-error'], undefined);
    assert.equal(health['continue-on-error'], undefined);
    assert.deepEqual(health.env, {
        APP_URL: '$' + '{{ vars.STAGING_URL }}',
        EXPECTED_COMMIT: inputSha,
    });
    assert.equal(health.run, 'node scripts/verify-deployed-release.mjs "$APP_URL" "$EXPECTED_COMMIT"');

    for (const [name, job] of Object.entries(workflow.jobs) as [string, Workflow][]) {
        const text = JSON.stringify(job);
        assert.ok(!text.includes('COOLIFY_PROD_WEBHOOK'), 'webhook de producción en staging: ' + name);
        assert.ok(!text.includes('COOLIFY_PROD_READ_TOKEN'), 'lectura de producción en staging: ' + name);
        assert.notEqual(job.environment?.name ?? job.environment, 'production', 'producción en staging: ' + name);
        if (name !== 'deploy-staging') {
            assert.ok(!text.includes('COOLIFY_STAGING_WEBHOOK'), 'webhook fuera del job protegido: ' + name);
            assert.ok(!text.includes('COOLIFY_STAGING_READ_TOKEN'), 'lectura fuera del job protegido: ' + name);
            assert.notEqual(job.environment?.name ?? job.environment, 'staging', 'environment fuera del job: ' + name);
        }
    }
};

const assertProduction = (workflow: Workflow) => {
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
    assert.deepEqual(workflow.permissions, { contents: 'read', actions: 'read' });
    assert.deepEqual(workflow.concurrency, {
        group: 'nortex-production-promotion',
        'cancel-in-progress': false,
    });

    const preflight = workflow.jobs.preflight;
    assert.equal(preflight.environment, undefined, 'preflight no puede acceder a producción');
    assert.equal(preflight.if, undefined);
    assert.equal(preflight['continue-on-error'], undefined);
    assert.ok(!JSON.stringify(preflight).includes('secrets.'), 'preflight no puede leer secretos');
    const preflightGate = step(preflight.steps, 'Verificar intención, main y staging del candidato');
    const preflightCi = step(preflight.steps, 'Verificar CI terminal y exitoso del candidato');
    const preflightStagingProvenance = step(preflight.steps, 'Verificar staging manual exitoso del candidato');
    assert.equal(preflightGate.run,
        'node scripts/authorize-production-release.mjs');
    assert.equal(preflightGate.if, undefined);
    assert.deepEqual(preflightGate.env, {
        CANDIDATE_SHA: inputSha,
        PRODUCTION_CONFIRMATION: inputConfirmation,
        NORTEX_PRODUCTION_DEPLOY_ENABLED: '$' + '{{ vars.NORTEX_PRODUCTION_DEPLOY_ENABLED }}',
        STAGING_URL: '$' + '{{ vars.STAGING_URL }}',
    });
    assertTerminalCiGate(preflightCi, 'preflight CI de producción');
    assertSuccessfulManualStagingGate(preflightStagingProvenance, 'preflight de procedencia staging');
    assert.ok(preflight.steps.indexOf(preflightCi) > preflight.steps.indexOf(preflightGate));
    assert.ok(preflight.steps.indexOf(preflightStagingProvenance) > preflight.steps.indexOf(preflightCi));

    const deploy = workflow.jobs['deploy-production'];
    assert.deepEqual(deploy.needs, ['preflight']);
    assert.equal(deploy.if, undefined, 'producción no puede forzarse');
    assert.equal(deploy['continue-on-error'], undefined, 'producción no puede ignorar un fallo del job');
    assert.deepEqual(deploy.environment, {
        name: 'production',
        url: '$' + '{{ vars.PROD_URL }}',
    });
    const checkout = deploy.steps.find((item: Workflow) => item.uses === 'actions/checkout@v4');
    assert.ok(checkout, 'checkout de candidato requerido');
    assert.equal(checkout.with.ref, inputSha);
    const postApproval = step(deploy.steps, 'Revalidar candidato después de la aprobación');
    const postApprovalCi = step(deploy.steps, 'Verificar CI terminal y exitoso del candidato');
    const postApprovalStagingProvenance = step(deploy.steps, 'Revalidar staging manual exitoso del candidato');
    assert.equal(postApproval.run,
        'node scripts/authorize-production-release.mjs');
    assert.equal(postApproval.if, undefined);
    assert.deepEqual(postApproval.env, preflightGate.env);
    assertTerminalCiGate(postApprovalCi, 'post-aprobación CI de producción');
    assertSuccessfulManualStagingGate(postApprovalStagingProvenance, 'post-aprobación de procedencia staging');
    const coolifyTarget = step(deploy.steps, 'Verificar destino Coolify fijado al candidato');
    assert.equal(coolifyTarget.run, 'node scripts/verify-coolify-production-target.mjs');
    assert.equal(coolifyTarget.if, undefined);
    assert.deepEqual(coolifyTarget.env, {
        CANDIDATE_SHA: inputSha,
        COOLIFY_PROD_WEBHOOK: productionWebhook,
        COOLIFY_PROD_API_ORIGIN: productionApiOrigin,
        COOLIFY_PROD_APPLICATION_UUID: productionApplicationUuid,
        COOLIFY_PROD_READ_TOKEN: productionReadToken,
    });
    const config = step(deploy.steps, 'Validar configuración de PROD');
    const webhook = step(deploy.steps, 'Desplegar PROD (webhook de Coolify)');
    const health = step(deploy.steps, 'Verificar PROD sano y en el candidato esperado');
    assert.ok(deploy.steps.indexOf(postApprovalCi) > deploy.steps.indexOf(postApproval));
    assert.ok(deploy.steps.indexOf(postApprovalStagingProvenance) > deploy.steps.indexOf(postApprovalCi));
    assert.ok(deploy.steps.indexOf(coolifyTarget) > deploy.steps.indexOf(postApprovalStagingProvenance));
    assert.ok(deploy.steps.indexOf(config) > deploy.steps.indexOf(coolifyTarget));
    assert.ok(deploy.steps.indexOf(webhook) > deploy.steps.indexOf(config));
    assert.equal(webhook.env.WEBHOOK, productionWebhook);
    assert.equal(health.env.EXPECTED_COMMIT, inputSha);
    assert.equal(health.run, 'node scripts/verify-deployed-release.mjs "$APP_URL" "$EXPECTED_COMMIT"');
    assert.ok(deploy.steps.indexOf(health) > deploy.steps.indexOf(webhook));
    assert.equal(postApproval['continue-on-error'], undefined);
    assert.equal(postApprovalStagingProvenance['continue-on-error'], undefined);
    assert.equal(coolifyTarget['continue-on-error'], undefined);
    assert.equal(config['continue-on-error'], undefined);
    assert.equal(webhook['continue-on-error'], undefined);
    assert.equal(health['continue-on-error'], undefined);
    assert.equal(config.if, undefined);
    assert.equal(webhook.if, undefined);
    assert.equal(health.if, undefined);
    assert.deepEqual(config.env, {
        WEBHOOK: productionWebhook,
        APP_URL: '$' + '{{ vars.PROD_URL }}',
        READ_TOKEN: '$' + '{{ secrets.COOLIFY_PROD_READ_TOKEN }}',
    });
    for (const required of [
        'set -euo pipefail',
        '[ -n "$APP_URL" ]',
        'const value = process.env.APP_URL;',
        'value.trim() !== value',
        '/[\\x00-\\x20\\x7f]/.test(value)',
        'value.includes("?")',
        'value.includes("#")',
        'rawAuthority.includes("@")',
        'const url = new URL(value);',
        'url.protocol !== "https:"',
        'url.pathname !== "/"',
    ]) {
        assert.ok(config.run.includes(required), 'validación PROD: falta ' + required);
    }
    assert.ok(!config.run.includes('case "$APP_URL"'), 'PROD_URL no puede validarse solo por prefijo');
    rootOriginValidator(config);
    assert.equal(webhook.env.TOKEN, '$' + '{{ secrets.COOLIFY_PROD_DEPLOY_TOKEN }}');
    assert.ok(webhook.run.includes('--output /dev/null'));
    assert.ok(webhook.run.includes('--max-time 30'));
    assert.ok(!webhook.run.includes('--retry'), 'webhook de producción no puede reintentarse sin idempotencia');
    assert.ok(!webhook.run.includes('--show-error'));

    for (const [name, job] of Object.entries(workflow.jobs) as [string, Workflow][]) {
        const text = JSON.stringify(job);
        assert.ok(!text.includes('COOLIFY_STAGING_WEBHOOK'), 'webhook de staging en producción: ' + name);
        assert.ok(!text.includes('COOLIFY_STAGING_READ_TOKEN'), 'lectura de staging en producción: ' + name);
        if (name !== 'deploy-production') {
            assert.ok(!text.includes('COOLIFY_PROD_WEBHOOK'), 'webhook fuera del job protegido: ' + name);
            assert.ok(!text.includes('COOLIFY_PROD_READ_TOKEN'), 'lectura fuera del job protegido: ' + name);
            assert.notEqual(job.environment?.name ?? job.environment, 'production', 'environment fuera del job: ' + name);
        }
    }
};

const assertNoOtherReleaseRoute = () => {
    for (const path of readdirSync('.github/workflows')
        .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))) {
        if (['ci.yml', 'release-staging.yml', 'release-production.yml'].includes(path)) continue;
        const workflow = parse(readFileSync('.github/workflows/' + path, 'utf8'));
        for (const [name, job] of Object.entries(workflow.jobs ?? {}) as [string, Workflow][]) {
            const text = JSON.stringify(job);
            assert.notEqual(job.environment?.name ?? job.environment, 'production', path + ':' + name);
            assert.notEqual(job.environment?.name ?? job.environment, 'staging', path + ':' + name);
            assert.ok(!text.includes('COOLIFY_PROD_WEBHOOK'), path + ':' + name);
            assert.ok(!text.includes('COOLIFY_PROD_READ_TOKEN'), path + ':' + name);
            assert.ok(!text.includes('COOLIFY_STAGING_WEBHOOK'), path + ':' + name);
            assert.ok(!text.includes('COOLIFY_STAGING_READ_TOKEN'), path + ':' + name);
        }
    }
};

describe('contrato de separación CI, staging y producción', () => {
    it('fija el runtime de Node de las promociones al mismo patch de CI', () => {
        expect(stagingSource.match(/node-version: 22\.23\.2/g)).toHaveLength(1);
        expect(productionSource.match(/node-version: 22\.23\.2/g)).toHaveLength(2);
        expect(stagingSource).not.toMatch(/node-version: 22\s*$/m);
        expect(productionSource).not.toMatch(/node-version: 22\s*$/m);
    });

    it('deja ambos webhooks fuera de CI y exige promociones manuales por SHA exacto', () => {
        assertCi(parse(ciSource));
        assertStaging(parse(stagingSource));
        assertProduction(parse(productionSource));
        assertNoOtherReleaseRoute();
        expect(stagingSource).not.toContain('github.sha');
        expect(productionSource).not.toContain('github.sha');
        expect(productionSource).not.toContain('secrets.COOLIFY_TOKEN');
    });

    it('bloquea antes del webhook un PROD_URL que no es un origen HTTPS raíz', () => {
        const production = parse(productionSource);
        const config = step(
            production.jobs['deploy-production'].steps,
            'Validar configuración de PROD',
        );
        const validator = rootOriginValidator(config);

        for (const appUrl of [
            'https://prod.example.test',
            'https://prod.example.test/',
        ]) {
            expect(validateRootOrigin(validator, appUrl).status).toBe(0);
        }

        for (const appUrl of [
            '',
            'http://prod.example.test',
            'https://@prod.example.test',
            'https://user:password@prod.example.test',
            'https://prod.example.test/app',
            'https://prod.example.test/.',
            'https://prod.example.test/..',
            'https://prod.example.test/release/..',
            'https://prod.example.test/%2e',
            'https://prod.example.test\\',
            'https://prod.example.test?candidate=other',
            'https://prod.example.test#fragment',
            ' https://prod.example.test',
            'https://prod.example.test\n',
            'https:///api/health',
        ]) {
            expect(validateRootOrigin(validator, appUrl).status).not.toBe(0);
        }
    });

    it.each([
        ['staging reintroducido en CI', (ci: Workflow) => {
            ci.jobs['deploy-staging'] = { environment: { name: 'staging' } };
        }],
        ['webhook de staging reintroducido en CI', (ci: Workflow) => {
            ci.jobs.verify.steps.push({ env: { WEBHOOK: stagingWebhook } });
        }],
        ['producción reintroducida en CI', (ci: Workflow) => {
            ci.jobs['deploy-production'] = { environment: { name: 'production' } };
        }],
        ['integración obligatoria eliminada', (ci: Workflow) => {
            delete ci.jobs['integration-required'];
        }],
        ['integración obligatoria ignora errores', (ci: Workflow) => {
            ci.jobs['integration-required']['continue-on-error'] = true;
        }],
        ['paso de integración obligatoria ignora errores', (ci: Workflow) => {
            const integration = ci.jobs['integration-required'].steps
                .find((item: Workflow) => item.name === 'Integración obligatoria de dinero e inventario');
            integration['continue-on-error'] = true;
        }],
    ])('rechaza la regresión de CI: %s', (_name, mutate) => {
        const ci = parse(ciSource);
        mutate(ci);
        expect(() => assertCi(ci)).toThrow();
    });

    it.each([
        ['push en staging', (staging: Workflow) => {
            staging.on.push = { branches: ['main'] };
        }],
        ['SHA opcional', (staging: Workflow) => {
            staging.on.workflow_dispatch.inputs.candidate_sha.required = false;
        }],
        ['confirmación eliminada', (staging: Workflow) => {
            delete staging.on.workflow_dispatch.inputs.confirmation;
        }],
        ['preflight de staging protegido prematuramente', (staging: Workflow) => {
            staging.jobs.preflight.environment = { name: 'staging' };
        }],
        ['permisos Actions de staging ampliados', (staging: Workflow) => {
            staging.permissions.actions = 'write';
        }],
        ['CI de preflight de staging eliminado', (staging: Workflow) => {
            staging.jobs.preflight.steps = staging.jobs.preflight.steps
                .filter((item: Workflow) => item.name !== 'Verificar CI terminal y exitoso del candidato');
        }],
        ['CI de staging acepta runs pendientes', (staging: Workflow) => {
            const ci = staging.jobs['deploy-staging'].steps
                .find((item: Workflow) => item.name === 'Verificar CI terminal y exitoso del candidato');
            ci.with.script = ci.with.script.replace("run.status === 'completed'", 'true');
        }],
        ['CI de staging consulta un workflow distinto', (staging: Workflow) => {
            const ci = staging.jobs.preflight.steps
                .find((item: Workflow) => item.name === 'Verificar CI terminal y exitoso del candidato');
            ci.with.script = ci.with.script.replace("workflow_id: 'ci.yml'", "workflow_id: 'other.yml'");
        }],
        ['CI de staging no limita la API a main', (staging: Workflow) => {
            const ci = staging.jobs.preflight.steps
                .find((item: Workflow) => item.name === 'Verificar CI terminal y exitoso del candidato');
            ci.with.script = ci.with.script.replace("branch: 'main'", "branch: 'release'");
        }],
        ['CI de staging acepta un run de otra rama', (staging: Workflow) => {
            const ci = staging.jobs.preflight.steps
                .find((item: Workflow) => item.name === 'Verificar CI terminal y exitoso del candidato');
            ci.with.script = ci.with.script.replace("run.head_branch === 'main'", 'true');
        }],
        ['CI de staging acepta un solo run verde entre runs no terminales', (staging: Workflow) => {
            const ci = staging.jobs.preflight.steps
                .find((item: Workflow) => item.name === 'Verificar CI terminal y exitoso del candidato');
            ci.with.script = ci.with.script.replace('runs.every((run) =>', 'runs.some((run) =>');
        }],
        ['revalidación posterior eliminada', (staging: Workflow) => {
            staging.jobs['deploy-staging'].steps = staging.jobs['deploy-staging'].steps
                .filter((item: Workflow) => item.name !== 'Revalidar candidato después de la aprobación');
        }],
        ['staging fuerza ejecución', (staging: Workflow) => {
            staging.jobs['deploy-staging'].if = 'always()';
        }],
        ['checkout no usa candidato', (staging: Workflow) => {
            const checkout = staging.jobs['deploy-staging'].steps
                .find((item: Workflow) => item.uses === 'actions/checkout@v4');
            checkout.with.ref = '$' + '{{ github.sha }}';
        }],
        ['gate no compara SHA del workflow', (staging: Workflow) => {
            const gate = staging.jobs.preflight.steps
                .find((item: Workflow) => item.name === 'Verificar intención, main y SHA del candidato');
            gate.run = gate.run.replace('[ "$CANDIDATE_SHA" = "$GITHUB_SHA" ]', 'true');
        }],
        ['gate posterior no compara main remoto', (staging: Workflow) => {
            const gate = staging.jobs['deploy-staging'].steps
                .find((item: Workflow) => item.name === 'Revalidar candidato después de la aprobación');
            gate.run = gate.run.replace('[ "$CURRENT_MAIN" = "$CANDIDATE_SHA" ]', 'true');
        }],
        ['verificación del destino de staging eliminada', (staging: Workflow) => {
            staging.jobs['deploy-staging'].steps = staging.jobs['deploy-staging'].steps
                .filter((item: Workflow) => item.name !== 'Verificar destino Coolify de staging fijado al candidato');
        }],
        ['webhook fuera del job protegido', (staging: Workflow) => {
            staging.jobs.preflight.steps.push({ env: { WEBHOOK: stagingWebhook } });
        }],
        ['webhook de staging reintenta', (staging: Workflow) => {
            const webhook = staging.jobs['deploy-staging'].steps
                .find((item: Workflow) => item.name === 'Desplegar STAGING (webhook de Coolify)');
            webhook.run += ' --retry 3';
        }],
        ['health de staging ignorado', (staging: Workflow) => {
            const health = staging.jobs['deploy-staging'].steps
                .find((item: Workflow) => item.name === 'Verificar STAGING sano y en el candidato esperado');
            health['continue-on-error'] = true;
        }],
        ['health de staging usa otro verificador', (staging: Workflow) => {
            const health = staging.jobs['deploy-staging'].steps
                .find((item: Workflow) => item.name === 'Verificar STAGING sano y en el candidato esperado');
            health.run = 'node scripts/other-health-check.mjs';
        }],
    ])('rechaza la regresión de staging: %s', (_name, mutate) => {
        const staging = parse(stagingSource);
        mutate(staging);
        expect(() => assertStaging(staging)).toThrow();
    });

    it.each([
        ['push en producción', (production: Workflow) => {
            production.on.push = { branches: ['main'] };
        }],
        ['SHA de producción opcional', (production: Workflow) => {
            production.on.workflow_dispatch.inputs.candidate_sha.required = false;
        }],
        ['confirmación de producción eliminada', (production: Workflow) => {
            delete production.on.workflow_dispatch.inputs.confirmation;
        }],
        ['preflight de producción protegido prematuramente', (production: Workflow) => {
            production.jobs.preflight.environment = { name: 'production' };
        }],
        ['permisos Actions de producción ampliados', (production: Workflow) => {
            production.permissions.actions = 'write';
        }],
        ['CI de preflight de producción eliminado', (production: Workflow) => {
            production.jobs.preflight.steps = production.jobs.preflight.steps
                .filter((item: Workflow) => item.name !== 'Verificar CI terminal y exitoso del candidato');
        }],
        ['CI de preflight de producción no limita la API a main', (production: Workflow) => {
            const ci = production.jobs.preflight.steps
                .find((item: Workflow) => item.name === 'Verificar CI terminal y exitoso del candidato');
            ci.with.script = ci.with.script.replace("branch: 'main'", "branch: 'release'");
        }],
        ['CI de preflight de producción acepta otra rama', (production: Workflow) => {
            const ci = production.jobs.preflight.steps
                .find((item: Workflow) => item.name === 'Verificar CI terminal y exitoso del candidato');
            ci.with.script = ci.with.script.replace("run.head_branch === 'main'", 'true');
        }],
        ['procedencia manual de staging eliminada', (production: Workflow) => {
            production.jobs.preflight.steps = production.jobs.preflight.steps
                .filter((item: Workflow) => item.name !== 'Verificar staging manual exitoso del candidato');
        }],
        ['gate posterior de producción eliminado', (production: Workflow) => {
            production.jobs['deploy-production'].steps = production.jobs['deploy-production'].steps
                .filter((item: Workflow) => item.name !== 'Revalidar candidato después de la aprobación');
        }],
        ['gate posterior de producción omitido', (production: Workflow) => {
            const gate = production.jobs['deploy-production'].steps
                .find((item: Workflow) => item.name === 'Revalidar candidato después de la aprobación');
            gate.if = 'false';
        }],
        ['CI posterior de producción ignorado', (production: Workflow) => {
            const ci = production.jobs['deploy-production'].steps
                .find((item: Workflow) => item.name === 'Verificar CI terminal y exitoso del candidato');
            ci['continue-on-error'] = true;
        }],
        ['procedencia posterior de staging eliminada', (production: Workflow) => {
            production.jobs['deploy-production'].steps = production.jobs['deploy-production'].steps
                .filter((item: Workflow) => item.name !== 'Revalidar staging manual exitoso del candidato');
        }],
        ['procedencia de staging consulta workflow distinto', (production: Workflow) => {
            const provenance = production.jobs.preflight.steps
                .find((item: Workflow) => item.name === 'Verificar staging manual exitoso del candidato');
            provenance.with.script = provenance.with.script.replace(
                "workflow_id: 'release-staging.yml'",
                "workflow_id: 'other.yml'",
            );
        }],
        ['procedencia de staging acepta otra rama', (production: Workflow) => {
            const provenance = production.jobs['deploy-production'].steps
                .find((item: Workflow) => item.name === 'Revalidar staging manual exitoso del candidato');
            provenance.with.script = provenance.with.script.replace("run.head_branch === 'main'", 'true');
        }],
        ['producción fuerza ejecución', (production: Workflow) => {
            production.jobs['deploy-production'].if = 'always()';
        }],
        ['producción ignora el fallo completo del job', (production: Workflow) => {
            production.jobs['deploy-production']['continue-on-error'] = true;
        }],
        ['pin de Coolify eliminado', (production: Workflow) => {
            production.jobs['deploy-production'].steps = production.jobs['deploy-production'].steps
                .filter((item: Workflow) => item.name !== 'Verificar destino Coolify fijado al candidato');
        }],
        ['PROD_URL permite una ruta no raíz', (production: Workflow) => {
            const config = production.jobs['deploy-production'].steps
                .find((item: Workflow) => item.name === 'Validar configuración de PROD');
            config.run = config.run.replace('url.pathname !== "/"', 'false');
        }],
        ['PROD_URL omite controles de espacios y caracteres de control', (production: Workflow) => {
            const config = production.jobs['deploy-production'].steps
                .find((item: Workflow) => item.name === 'Validar configuración de PROD');
            config.run = config.run.replace('/[\\x00-\\x20\\x7f]/.test(value)', 'false');
        }],
        ['PROD_URL permite una autoridad con credenciales ambiguas', (production: Workflow) => {
            const config = production.jobs['deploy-production'].steps
                .find((item: Workflow) => item.name === 'Validar configuración de PROD');
            config.run = config.run.replace('rawAuthority.includes("@")', 'false');
        }],
        ['health de producción ignorado', (production: Workflow) => {
            const health = production.jobs['deploy-production'].steps
                .find((item: Workflow) => item.name === 'Verificar PROD sano y en el candidato esperado');
            health['continue-on-error'] = true;
        }],
        ['health de producción usa otro verificador', (production: Workflow) => {
            const health = production.jobs['deploy-production'].steps
                .find((item: Workflow) => item.name === 'Verificar PROD sano y en el candidato esperado');
            health.run = 'node scripts/other-health-check.mjs';
        }],
        ['checkout de producción no usa candidato', (production: Workflow) => {
            const checkout = production.jobs['deploy-production'].steps
                .find((item: Workflow) => item.uses === 'actions/checkout@v4');
            checkout.with.ref = '$' + '{{ github.sha }}';
        }],
        ['webhook de producción fuera del job protegido', (production: Workflow) => {
            production.jobs.preflight.steps.push({
                env: { WEBHOOK: productionWebhook },
                run: 'curl "$WEBHOOK"',
            });
        }],
        ['webhook de producción reintenta', (production: Workflow) => {
            const webhook = production.jobs['deploy-production'].steps
                .find((item: Workflow) => item.name === 'Desplegar PROD (webhook de Coolify)');
            webhook.run += ' --retry 3';
        }],
        ['webhook de producción imprime respuesta', (production: Workflow) => {
            const webhook = production.jobs['deploy-production'].steps
                .find((item: Workflow) => item.name === 'Desplegar PROD (webhook de Coolify)');
            webhook.run = 'curl --show-error "$WEBHOOK"';
        }],
    ])('conserva la separación de producción: %s', (_name, mutate) => {
        const production = parse(productionSource);
        mutate(production);
        expect(() => assertProduction(production)).toThrow();
    });

    it('rechaza claves YAML duplicadas que podrían ocultar una condición', () => {
        const duplicateYaml = [
            'jobs:',
            '  deploy-staging:',
            '    if: false',
            '    if: true',
        ].join(String.fromCharCode(10));
        expect(() => parse(duplicateYaml)).toThrow();
    });
});

// REST actions.listWorkflowRuns returns repository paths, without an @ref suffix.
// This sanitized projection reproduces the CI response from run 34290504701.
const restCandidateSha = 'ca8e31da4d49f85a54817d0000d272cfec85bdc2';
const successfulRestCiRun = {
    id: 34290504701,
    path: '.github/workflows/ci.yml',
    head_sha: restCandidateSha,
    head_branch: 'main',
    event: 'push',
    status: 'completed',
    conclusion: 'success',
};

const executableRunGates = [
    { release: 'staging', source: stagingSource, job: 'preflight', name: 'Verificar CI terminal y exitoso del candidato', workflow: 'ci.yml', event: 'push' },
    { release: 'staging', source: stagingSource, job: 'deploy-staging', name: 'Verificar CI terminal y exitoso del candidato', workflow: 'ci.yml', event: 'push' },
    { release: 'production', source: productionSource, job: 'preflight', name: 'Verificar CI terminal y exitoso del candidato', workflow: 'ci.yml', event: 'push' },
    { release: 'production', source: productionSource, job: 'deploy-production', name: 'Verificar CI terminal y exitoso del candidato', workflow: 'ci.yml', event: 'push' },
    { release: 'production', source: productionSource, job: 'preflight', name: 'Verificar staging manual exitoso del candidato', workflow: 'release-staging.yml', event: 'workflow_dispatch' },
    { release: 'production', source: productionSource, job: 'deploy-production', name: 'Revalidar staging manual exitoso del candidato', workflow: 'release-staging.yml', event: 'workflow_dispatch' },
];

// Execute the actual github-script body extracted from YAML. The only injected
// boundaries are the GitHub REST client, context and a synthetic environment.
function executeRestGate(target: typeof executableRunGates[number], runs: unknown) {
    const gate = step(parse(target.source).jobs[target.job].steps, target.name);
    const execute = new Function('github', 'context', 'process',
        `return (async () => {\n${gate.with.script}\n})();`) as (...args: unknown[]) => Promise<void>;
    const github = {
        rest: { actions: { listWorkflowRuns: async (query: Workflow) => {
            expect(query).toEqual({
                owner: 'qa-owner', repo: 'qa-repo', workflow_id: target.workflow,
                head_sha: restCandidateSha, branch: 'main', event: target.event, per_page: 100,
            });
            return { data: { workflow_runs: runs } };
        } } },
    };
    return execute(github, { repo: { owner: 'qa-owner', repo: 'qa-repo' } },
        { env: { CANDIDATE_SHA: restCandidateSha } });
}

describe.each(executableRunGates)('REST gate $release / $workflow / $job / $name', (target) => {
    const validRun = { ...successfulRestCiRun, path: `.github/workflows/${target.workflow}`, event: target.event };
    const rejection = target.workflow === 'ci.yml' ? 'CI_TERMINAL_SUCCESS_REQUIRED' : 'MANUAL_STAGING_SUCCESS_REQUIRED';

    it('acepta la ruta REST exacta sin sufijo de referencia', async () => {
        await expect(executeRestGate(target, [validRun])).resolves.toBeUndefined();
    });

    it.each([
        ['ruta parecida', { path: `.github/workflows/${target.workflow}.other` }],
        ['ruta con otro ref', { path: `.github/workflows/${target.workflow}@refs/heads/other` }],
        ['ruta con ref main tampoco es el contrato REST', { path: `.github/workflows/${target.workflow}@refs/heads/main` }],
        ['ruta con prefijo ajeno', { path: `other/.github/workflows/${target.workflow}` }],
        ['ruta ausente', { path: undefined }],
        ['ruta de tipo inesperado', { path: 123 }],
        ['otro SHA', { head_sha: '1'.repeat(40) }],
        ['otra rama', { head_branch: 'release' }],
        ['otro evento', { event: 'pull_request' }],
        ['fallo terminal', { conclusion: 'failure' }],
        ['pendiente', { status: 'in_progress', conclusion: null }],
        ['cancelado', { conclusion: 'cancelled' }],
    ])('rechaza %s', async (_label, difference) => {
        await expect(executeRestGate(target, [{ ...validRun, ...difference }])).rejects.toThrow(rejection);
    });

    it.each([{ label: 'lista vacía', runs: [] }, { label: 'null', runs: null }, { label: 'objeto inesperado', runs: { unexpected: true } }])('rechaza ausencia de evidencia: $label', async ({ runs }) => {
        await expect(executeRestGate(target, runs)).rejects.toThrow(rejection);
    });

    if (target.workflow === 'ci.yml') {
        it.each([
            { status: 'in_progress', conclusion: null },
            { status: 'completed', conclusion: 'failure' },
        ])('un CI verde no oculta otro run del candidato: %j', async (other) => {
            await expect(executeRestGate(target, [validRun, { ...validRun, id: 34290504702, ...other }])).rejects.toThrow(rejection);
        });
    } else {
        it('conserva la procedencia de staging con un run manual exitoso aunque exista un intento anterior fallido', async () => {
            await expect(executeRestGate(target, [{ ...validRun, conclusion: 'failure' }, validRun])).resolves.toBeUndefined();
        });
    }
});
