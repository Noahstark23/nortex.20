import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROVIDER_ENV_VAR, applyProviderCredential, assertNoFrontendSecrets, findSecretOccurrences, fingerprintSecret, readProviderKey } from '../scripts/qa/provider-credential.mjs';

const KEY = 'sk-ant-api03-' + 'a1b2c3d4e5f6g7h8'.repeat(2);

describe('credencial del proveedor en lanzadores de QA', () => {
  it('por defecto retira la clave: la compuerta obligatoria no gasta presupuesto', () => {
    const env: Record<string, string> = { PATH: '/usr/bin', [PROVIDER_ENV_VAR]: KEY };
    expect(applyProviderCredential(env)).toEqual({ propagated: false, reason: 'provider_excluded_by_default' });
    expect(env[PROVIDER_ENV_VAR]).toBeUndefined();
    expect(Object.values(env)).not.toContain(KEY);
  });

  it('propaga sólo con autorización explícita y sin devolver el secreto', () => {
    const env: Record<string, string> = { PATH: '/usr/bin' };
    const result = applyProviderCredential(env, { allow: true, source: { [PROVIDER_ENV_VAR]: KEY } });
    expect(env[PROVIDER_ENV_VAR]).toBe(KEY);
    expect(result.propagated).toBe(true);
    expect(result.length).toBe(KEY.length);
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(result.fingerprint).toBe(fingerprintSecret(KEY));
    expect(result.fingerprint).toHaveLength(12);
  });

  it('falla cerrado ante credencial ausente, vacía o de forma desconocida', () => {
    for (const source of [{}, { [PROVIDER_ENV_VAR]: '   ' }, { [PROVIDER_ENV_VAR]: 'no-es-una-clave' }, { [PROVIDER_ENV_VAR]: 'sk-ant-corta' }]) {
      expect(() => applyProviderCredential({ PATH: '/usr/bin' }, { allow: true, source })).toThrow();
    }
    expect(readProviderKey({})).toBeNull();
    expect(readProviderKey({ [PROVIDER_ENV_VAR]: `  ${KEY}  ` })).toBe(KEY);
  });

  it('rechaza cualquier variable VITE_*, que terminaría en el bundle', () => {
    expect(() => assertNoFrontendSecrets({ VITE_ANTHROPIC_KEY: KEY })).toThrow(/VITE_/);
    for (const allow of [false, true]) {
      expect(() => applyProviderCredential({ VITE_TOKEN: 'x' }, { allow, source: { [PROVIDER_ENV_VAR]: KEY } })).toThrow(/VITE_/);
    }
  });

  it('detecta filtraciones sobre las muestras que reciben las pruebas del lanzador', () => {
    expect(findSecretOccurrences(KEY, [{ label: 'stdout', text: 'ok' }, { label: 'log', text: `Bearer ${KEY}` }])).toEqual(['log']);
    expect(findSecretOccurrences(KEY, [{ label: 'stdout', text: fingerprintSecret(KEY) }])).toEqual([]);
    expect(() => findSecretOccurrences('', [])).toThrow();
  });

  it('la compuerta de integración retira la clave de forma deliberada', () => {
    const source = readFileSync('scripts/run-quality-integration.mjs', 'utf8');
    expect(source).toContain("applyProviderCredential(env, { allow: false })");
    expect(source).not.toMatch(/allow:\s*true/);
    // El lanzador de evaluación es el único que puede propagarla, y sólo con bandera.
    const evaluation = readFileSync('scripts/qa/nortexgpt-eval-server.mjs', 'utf8');
    expect(evaluation).toContain("--allow-provider");
    expect(evaluation).toContain('applyProviderCredential(env, { allow: allowProvider })');
  });

  it('la prueba del lanzador no recorre el repositorio ni abre secretos', () => {
    const selftest = readFileSync('scripts/qa/nortexgpt-launcher-selftest.mjs', 'utf8');
    // Nada de barridos indiscriminados: la búsqueda va sobre una lista explícita.
    expect(selftest).not.toMatch(/grep/);
    expect(selftest).not.toMatch(/-rIl|readdir|walk|glob/);
    expect(selftest).toContain('const scanTargets = [');
    expect(selftest).toContain('FORBIDDEN_TARGET');
    // Un objetivo ilegible hunde la comprobación en vez de aprobarla en vacío.
    expect(selftest).toContain("record('fuga.todos_los_objetivos_legibles', unreadable.length === 0");
    expect(selftest).toContain('unreadable.length === 0 &&');
    // `ps` debe haber respondido de verdad antes de afirmar que no hay fuga en argv.
    expect(selftest).toContain("record('fuga.argv_observado_efectivamente', observed");
    expect(selftest).toContain("observed && !argvView.includes(secret)");
    // Entorno controlado: lista blanca, sin heredar la credencial del operador.
    expect(selftest).toContain('ALLOWED_ENV_KEYS');
    expect(selftest).toContain('delete built[PROVIDER_ENV_VAR]');
    expect(selftest).not.toMatch(/\.\.\.process\.env/);
  });

  it('la verificación de consumo exige correlación inequívoca, no ventanas de tiempo', () => {
    const verify = readFileSync('scripts/qa/nortexgpt-verify-run.ts', 'utf8');
    expect(verify).toContain('USAGE_RUN_LINK_FIELD');
    expect(verify).toContain('consumo_por_ejecucion_no_acreditado');
    // Nunca correlacionar por proximidad temporal a la ejecución.
    expect(verify).not.toMatch(/createdAt:\s*\{\s*gte:\s*run\.createdAt/);
    expect(verify).not.toMatch(/budgetMonth\(new Date\(\)\)/);
    // El mes sale de la ejecución, y los totales se rotulan como del mes.
    expect(verify).toContain('return budgetMonth(run.createdAt)');
    expect(verify).toContain("scope: 'mes_completo_no_por_ejecucion'");
    // Añadir el campo al schema no basta: la consulta tiene que pedirlo.
    expect(verify).toContain('if (hasLink) select[USAGE_RUN_LINK_FIELD] = true');
    expect(verify).toContain('assistantUsageHasRunLink()');
    // Con enlace se consulta por ejecución y SIN filtro de mes, para no perder el borde.
    expect(verify).toContain('where: { [USAGE_RUN_LINK_FIELD]: run.id }, select');
    expect(verify).toContain('monthWindowForRun');
    // Tres clases: una degradada pudo haber pagado iteraciones.
    expect(verify).toContain('CLASS_INCOMPLETE_WITH_CALLS');
    expect(verify).not.toMatch(/respaldo_determinista_o_incompleta/);
  });

  it('el vínculo de consumo se escribe en la reserva y se conserva al liquidar', () => {
    const budget = readFileSync('backend/services/assistant/budget.ts', 'utf8');
    // Escrito al crear la reserva, antes de llamar al proveedor.
    expect(budget).toContain('runId?:string');
    expect(budget).toContain("status:'RESERVED',...(deps.runId&&USAGE_SUPPORTS_RUN_LINK?{runId:deps.runId}:{})");
    // Sin cliente regenerado no se manda el campo: fallar la reserva degradaría la
    // consulta al respaldo determinista en silencio.
    expect(budget).toContain('export const USAGE_SUPPORTS_RUN_LINK');
    // La liquidación no debe tocar runId: se conserva sola.
    const settle = budget.slice(budget.indexOf('export async function settleAssistantBudget'));
    expect(settle).not.toMatch(/runId:/);
    // El orquestador pasa la identidad de la ejecución a la reserva.
    const orchestrator = readFileSync('backend/services/assistant/operations/orchestrator.ts', 'utf8');
    expect(orchestrator).toContain("capability:'help',runId:input.runId");
    // Schema aditivo: columna nullable con índice, y migración presente.
    const schema = readFileSync('backend/prisma/schema.prisma', 'utf8');
    const model = schema.slice(schema.indexOf('model AssistantUsage'), schema.indexOf('model AssistantUsage') + 1200);
    expect(model).toContain('runId             String? @db.VarChar(191)');
    expect(model).toContain('@@index([runId])');
    const migration = readFileSync('backend/prisma/migrations/20260908_assistant_usage_run_link/migration.sql', 'utf8');
    expect(migration).toContain('ADD COLUMN `runId` VARCHAR(191) NULL');
    expect(migration).not.toMatch(/DROP|accept-data-loss|NOT NULL/i);
  });

  it('el lanzador no pone el secreto en argumentos y falla cerrado sin credencial', () => {
    const launcher = readFileSync('scripts/qa/nortexgpt-qa-run.sh', 'utf8');
    expect(launcher).toContain('export ANTHROPIC_API_KEY');
    expect(launcher).toContain('exec "$@"');
    expect(launcher).toContain('exit 3');
    // Nunca `env VAR=valor comando`: eso expondría el secreto en la lista de procesos.
    expect(launcher).not.toMatch(/\benv\s+ANTHROPIC_API_KEY=/);
    expect(launcher).not.toMatch(/echo\s+"?\$ANTHROPIC_API_KEY/);
  });
});
