import { describe, expect, it } from 'vitest';
import {
  CLASS_CALLS_UNKNOWN, CLASS_FALLBACK_NO_CALLS, CLASS_INCOMPLETE_WITH_CALLS, CLASS_MODEL_ANSWERED,
  COST_ATTRIBUTED, COST_NOT_ATTRIBUTED, COST_PARTIAL, USAGE_RUN_LINK_FIELD,
  attributeUsageToRun, buildRunFinding, classifyRun, modelHasField, monthWindowForRun,
  providerCallAttempted, runAnsweredByModel, usageMonthForRun,
  type VerifiableRun, type VerifiableUsage,
} from '../scripts/qa/nortexgpt-verify-run.js';

const TENANT = 'operativo-demo-20260905-ferreteria';
const USER = 'owner-1';
const answered = { text: 'ok', evidence: [{ id: 'e1', tool: 'check_inventory_burn_rate' }], actionProposalIds: [], degraded: false };
const fellBack = { ...answered, degraded: true };

const run = (id: string, createdAt: string, result: unknown = answered, extra: Partial<VerifiableRun> = {}): VerifiableRun =>
  ({ id, tenantId: TENANT, userId: USER, status: 'SUCCEEDED', iterations: 2, result, errorCode: null, createdAt: new Date(createdAt), ...extra });

const usage = (id: string, createdAt: string, extra: Partial<VerifiableUsage> = {}): VerifiableUsage =>
  ({ id, tenantId: TENANT, userId: USER, month: '2026-09', status: 'SETTLED', reservedUsd: '1.127680', actualUsd: '0.004120', providerRequestId: `msg_${id}`, createdAt: new Date(createdAt), ...extra });

describe('acreditación de consumo por ejecución', () => {
  it('sin enlace explícito declara consumo por ejecución no acreditado', () => {
    const target = run('run-a', '2026-09-08T15:00:00Z');
    const result = attributeUsageToRun(target, [usage('u1', '2026-09-08T15:00:04Z'), usage('u2', '2026-09-08T15:00:09Z')]);
    expect(result.attributable).toBe(false);
    expect(result.status).toBe(COST_NOT_ATTRIBUTED);
    expect(result.basis).toBe('ninguno');
    expect(result.observedUsd).toBeNull();
    expect(result.reservedUsd).toBeNull();
    expect(result.rows).toEqual([]);
    expect(result.reason).toMatch(/runId ausente o vacío/);
  });

  it('dos consultas del mismo usuario no se atribuyen consumo entre sí', () => {
    const first = run('run-a', '2026-09-08T15:00:00Z');
    const second = run('run-b', '2026-09-08T15:10:00Z');
    // Cuatro liquidaciones del mismo usuario en el mismo mes: dos por consulta.
    const rows = [
      usage('u1', '2026-09-08T15:00:04Z'), usage('u2', '2026-09-08T15:00:09Z'),
      usage('u3', '2026-09-08T15:10:03Z'), usage('u4', '2026-09-08T15:10:08Z'),
    ];
    for (const target of [first, second]) {
      const finding = buildRunFinding({ run: target, usageRows: rows });
      expect(finding.costAttribution).toBe(COST_NOT_ATTRIBUTED);
      expect(finding.observedUsdForThisRun).toBeNull();
      expect(finding.providerRequestsForThisRun).toEqual([]);
    }
    // Una correlación por ventana de tiempo habría dado las cuatro filas a la primera.
    expect(attributeUsageToRun(first, rows).rows).toHaveLength(0);
  });

  it('con concurrencia no atribuye el consumo de la ejecución solapada', () => {
    // run-b arranca antes de que run-a termine; sus liquidaciones se intercalan.
    const first = run('run-a', '2026-09-08T15:00:00Z');
    const second = run('run-b', '2026-09-08T15:00:02Z');
    const interleaved = [
      usage('u1', '2026-09-08T15:00:05Z'), usage('u2', '2026-09-08T15:00:06Z'),
      usage('u3', '2026-09-08T15:00:07Z'), usage('u4', '2026-09-08T15:00:08Z'),
    ];
    const findings = [first, second].map(target => buildRunFinding({ run: target, usageRows: interleaved }));
    expect(findings.map(f => f.costAttribution)).toEqual([COST_NOT_ATTRIBUTED, COST_NOT_ATTRIBUTED]);
    expect(findings.every(f => f.observedUsdForThisRun === null)).toBe(true);
    // Y el veredicto del modelo no depende de esas filas.
    expect(findings.every(f => f.modelAnswered)).toBe(true);
  });

  it('usa el mes de la ejecución, no el mes corriente', () => {
    expect(usageMonthForRun(run('run-viejo', '2026-07-15T12:00:00Z'))).toBe('2026-07');
    expect(usageMonthForRun(run('run-nuevo', '2026-09-08T12:00:00Z'))).toBe('2026-09');
    // Managua es UTC−6: la medianoche civil del 1 cae a las 06:00Z.
    expect(usageMonthForRun(run('run-borde', '2026-09-01T03:00:00Z'))).toBe('2026-08');
  });

  it('una ejecución de un mes anterior sigue acreditando que respondió el modelo', () => {
    const previous = run('run-julio', '2026-07-15T12:00:00Z');
    // Sin filas del mes corriente: eso no es prueba de respaldo determinista.
    const finding = buildRunFinding({ run: previous, usageRows: [] });
    expect(finding.month).toBe('2026-07');
    expect(finding.modelAnswered).toBe(true);
    expect(finding.verdict).toBe(CLASS_MODEL_ANSWERED);
    expect(finding.costAttribution).toBe(COST_NOT_ATTRIBUTED);
  });

  it('acredita sólo cuando la fila enlaza con la ejecución', () => {
    const target = run('run-a', '2026-09-08T15:00:00Z');
    const rows = [
      usage('u1', '2026-09-08T15:00:04Z', { [USAGE_RUN_LINK_FIELD]: 'run-a', actualUsd: '0.001000' }),
      usage('u2', '2026-09-08T15:00:09Z', { [USAGE_RUN_LINK_FIELD]: 'run-a', actualUsd: '0.002000' }),
      usage('u3', '2026-09-08T15:10:03Z', { [USAGE_RUN_LINK_FIELD]: 'run-b', actualUsd: '9.000000' }),
    ];
    const result = attributeUsageToRun(target, rows);
    expect(result.attributable).toBe(true);
    expect(result.status).toBe(COST_ATTRIBUTED);
    expect(result.basis).toBe(USAGE_RUN_LINK_FIELD);
    expect(result.observedUsd).toBe('0.003000');
    expect(result.providerRequests).toEqual(['msg_u1', 'msg_u2']);
  });

  it('una reserva sin liquidar deja el consumo incompleto, no en cero', () => {
    const target = run('run-a', '2026-09-08T15:00:00Z');
    const result = attributeUsageToRun(target, [
      usage('u1', '2026-09-08T15:00:04Z', { [USAGE_RUN_LINK_FIELD]: 'run-a', actualUsd: '0.001000' }),
      usage('u2', '2026-09-08T15:00:09Z', { [USAGE_RUN_LINK_FIELD]: 'run-a', status: 'UNKNOWN', actualUsd: null }),
    ]);
    expect(result.status).toBe(COST_PARTIAL);
    expect(result.observedUsd).toBe('0.001000');
    expect(result.reason).toMatch(/UNKNOWN/);
  });

  it('un enlace hacia otro tenant o usuario es incoherente y no acredita', () => {
    const target = run('run-a', '2026-09-08T15:00:00Z');
    const result = attributeUsageToRun(target, [
      usage('u1', '2026-09-08T15:00:04Z', { [USAGE_RUN_LINK_FIELD]: 'run-a', tenantId: 'otro-negocio' }),
    ]);
    expect(result.attributable).toBe(false);
    expect(result.status).toBe(COST_NOT_ATTRIBUTED);
    expect(result.reason).toMatch(/otro tenant o usuario/);
  });

  it('separa "respondió el modelo" de "cuánto consumió"', () => {
    expect(runAnsweredByModel(run('a', '2026-09-08T15:00:00Z', answered))).toBe(true);
    expect(runAnsweredByModel(run('b', '2026-09-08T15:00:00Z', fellBack))).toBe(false);
    expect(runAnsweredByModel(run('c', '2026-09-08T15:00:00Z', answered, { status: 'FAILED' }))).toBe(false);
    expect(runAnsweredByModel(run('d', '2026-09-08T15:00:00Z', null))).toBe(false);
    // Consumo liquidado y enlazado no convierte un respaldo determinista en respuesta del modelo.
    const degraded = buildRunFinding({
      run: run('e', '2026-09-08T15:00:00Z', fellBack),
      usageRows: [usage('u1', '2026-09-08T15:00:04Z', { [USAGE_RUN_LINK_FIELD]: 'e' })],
    });
    expect(degraded.costAttribution).toBe(COST_ATTRIBUTED);
    expect(degraded.modelAnswered).toBe(false);
    expect(degraded.verdict).toBe(CLASS_INCOMPLETE_WITH_CALLS);
  });

  it('degraded:true no equivale a "no se llamó al modelo"', () => {
    // El contador se incrementa antes de reservar: no demuestra contacto con el proveedor.
    const paidButIncomplete = run('run-parcial', '2026-09-08T15:00:00Z', fellBack, { iterations: 3 });
    const neverCalled = run('run-respaldo', '2026-09-08T15:00:00Z', fellBack, { iterations: 0 });
    expect(providerCallAttempted(paidButIncomplete)).toBeNull();
    expect(providerCallAttempted(neverCalled)).toBe(false);
    expect(classifyRun(paidButIncomplete)).toBe(CLASS_CALLS_UNKNOWN);
    expect(classifyRun(neverCalled)).toBe(CLASS_FALLBACK_NO_CALLS);
    expect(classifyRun(run('run-ok', '2026-09-08T15:00:00Z', answered))).toBe(CLASS_MODEL_ANSWERED);
    // La nota no inventa llamadas ni gasto a partir del contador.
    const finding = buildRunFinding({ run: paidButIncomplete, usageRows: [] });
    expect(finding.note).toMatch(/No se presume gasto cero/);
    expect(buildRunFinding({ run: neverCalled, usageRows: [] }).note).toMatch(/sin iteraciones del proveedor/);
  });

  it('una reserva incierta o liberada no acredita envío ni una liquidación sin importe', () => {
    const target = run('a', '2026-09-08T15:00:00Z', fellBack);
    for (const status of ['RESERVED', 'UNKNOWN', 'SETTLED']) {
      const rows = [usage('u', '2026-09-08T15:00:01Z', { runId: 'a', status, actualUsd: status === 'SETTLED' ? '0' : null, providerRequestId: null })];
      expect(providerCallAttempted(target, rows)).toBeNull();
      expect(providerCallAttempted({...target,iterations:0}, rows)).toBeNull();
    }
    for (const actualUsd of [null, undefined, 'NaN', '-1', 'Infinity']) {
      const finding = buildRunFinding({ run: target, usageRows: [usage('u', '2026-09-08T15:00:01Z', { runId: 'a', actualUsd })] });
      expect(finding.costAttribution).toBe(COST_NOT_ATTRIBUTED);
      expect(finding.observedUsdForThisRun).toBeNull();
    }
    expect(providerCallAttempted(target, [usage('u', '2026-09-08T15:00:01Z', { runId: 'a', tenantId: 'foreign' })])).toBeNull();
  });

  it('la ventana de meses cubre el borde: reservar de un lado y liquidar del otro', () => {
    expect(monthWindowForRun(run('a', '2026-09-08T12:00:00Z'))).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(monthWindowForRun(run('b', '2026-01-10T12:00:00Z'))).toEqual(['2025-12', '2026-01', '2026-02']);
    expect(monthWindowForRun(run('c', '2026-12-20T12:00:00Z'))).toEqual(['2026-11', '2026-12', '2027-01']);
  });

  it('detecta si el cliente Prisma conoce el campo de enlace', () => {
    const withLink = [{ name: 'AssistantUsage', fields: [{ name: 'id' }, { name: USAGE_RUN_LINK_FIELD }] }];
    const without = [{ name: 'AssistantUsage', fields: [{ name: 'id' }] }];
    expect(modelHasField(withLink, 'AssistantUsage', USAGE_RUN_LINK_FIELD)).toBe(true);
    expect(modelHasField(without, 'AssistantUsage', USAGE_RUN_LINK_FIELD)).toBe(false);
    expect(modelHasField(withLink, 'OtroModelo', USAGE_RUN_LINK_FIELD)).toBe(false);
  });

  it('rechaza entradas que no permiten decidir', () => {
    expect(() => attributeUsageToRun({ ...run('a', '2026-09-08T15:00:00Z'), id: '' }, [])).toThrow();
    expect(() => attributeUsageToRun(run('a', '2026-09-08T15:00:00Z'), null as unknown as VerifiableUsage[])).toThrow();
  });
});
