import { beforeEach, describe, expect, it, vi } from 'vitest';
const injected = vi.hoisted(() => ({enabled: true, actionsEnabled: true, executionEnabled: true, effectFailure: false, domainValue: '10.00'}));
vi.mock('../backend/services/assistant/config', () => ({getAssistantFlags: () => ({...injected, operationsEnabled: true})}));
vi.mock('../backend/services/assistant/actions/adapters', async importOriginal => {
  const actual = await importOriginal<any>();
  const create = (real: any, kind: string) => ({...real,
    prepare: vi.fn(async (_principal: any, draft: any) => ({hash: injected.domainValue, issues: kind === 'BATCH_WRITEOFF' && !draft.physicalRemovalConfirmed ? ['Confirmá el retiro físico.'] : [], preview: {summary: 'Efecto revisado', lines: [], effects: [{label: 'Total', value: injected.domainValue}], warnings: [], confirmLabel: 'Confirmar'}})),
    execute: vi.fn(async (_principal: any, _draft: any, {tx}: any) => {tx.effects.push(kind); if (injected.effectFailure) throw new Error('domain failed'); return {resourceId: 'resource-1', message: 'Registrado'};}),
  });
  return {...actual, purchaseOrderAdapter: create(actual.purchaseOrderAdapter, 'PURCHASE_ORDER_DRAFT'), batchWriteoffAdapter: create(actual.batchWriteoffAdapter, 'BATCH_WRITEOFF'), supplierReturnAdapter: create(actual.supplierReturnAdapter, 'SUPPLIER_RETURN')};
});
import { prepareAssistantAction, reviseAssistantAction, previewAssistantAction, confirmAssistantAction, getAssistantAction } from '../backend/services/assistant/actions/service';
import { actionOrderDraftSchema, actionWriteoffDraftSchema, actionSupplierReturnDraftSchema } from '../backend/services/assistant/actions/adapters';

const principal = {tenantId: 't', userId: 'u', role: 'OWNER'};
const draft = {supplierId: 'supplier-1', items: [{productId: 'p', quantity: '2.5', unitCost: '4'}]};
const clone = (value: any): any => value == null ? value : structuredClone(value);
const match = (row: any, where: any): boolean => Object.entries(where).every(([field, expected]: [string, any]) => {
  if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
    if ('in' in expected) return expected.in.includes(row[field]);
    if ('gt' in expected) return row[field] > expected.gt;
  }
  return row[field] === expected;
});
function fixture() {
  const state = {proposals: [] as any[], commands: [] as any[], audits: [] as any[], effects: [] as string[]};
  const actor = {...principal, id: principal.userId, status: 'ACTIVE'};
  const config = {enabled: true, actionsEnabled: true, executionEnabled: true, operationsEnabled: true};
  let failAudit = false, failReceipt = false, queue = Promise.resolve();
  const collection = (name: 'proposals' | 'commands') => ({
    findFirst: vi.fn(async ({where}: any) => clone(state[name].find(row => match(row, where)) ?? null)),
    create: vi.fn(async ({data}: any) => {
      const duplicate = state[name].find(row => row.tenantId === data.tenantId && row.requestKey === data.requestKey && (name === 'commands' || row.userId === data.userId));
      if (duplicate) throw Object.assign(new Error('duplicate'), {code: 'P2002'});
      const row = {status: 'DRAFT', version: 1, previewJson: null, previewHash: null, operationId: null, createdAt: new Date(), updatedAt: new Date(), ...clone(data)};
      state[name].push(row); return clone(row);
    }),
    updateMany: vi.fn(async ({where, data}: any) => {
      if (name === 'commands' && failReceipt) throw new Error('receipt failed');
      const rows = state[name].filter(row => match(row, where));
      for (const row of rows) for (const [field, value] of Object.entries(data) as [string, any][]) row[field] = value && typeof value === 'object' && 'increment' in value ? row[field] + value.increment : clone(value);
      return {count: rows.length};
    }),
  });
  const db: any = {
    user: {findFirst: vi.fn(async ({where}: any) => where.id === actor.id && where.tenantId === actor.tenantId ? clone(actor) : null)},
    assistantTenantConfig: {findUnique: vi.fn(async () => clone(config))},
    assistantActionProposal: collection('proposals'), assistantActionCommand: collection('commands'),
    auditLog: {create: vi.fn(async ({data}: any) => {if (failAudit) throw new Error('audit failed'); state.audits.push(clone(data)); return data;})},
    $queryRaw: vi.fn(async (sql: TemplateStringsArray) => sql.join('?').includes('FROM `User`') ? [clone(actor)] : []),
    get effects() {return state.effects;},
    $transaction: vi.fn(async (run: any) => {
      const operation = queue.then(async () => {
        const snapshot = clone(state);
        try {return await run(db);} catch (error) {Object.assign(state, snapshot); throw error;}
      });
      queue = operation.then(() => undefined, () => undefined);
      return operation;
    }),
  };
  return {state, actor, config, db, auditFails: () => {failAudit = true;}, receiptFails: () => {failReceipt = true;}};
}
async function ready(f: ReturnType<typeof fixture>) {
  const prepared = await prepareAssistantAction(principal, 'PURCHASE_ORDER_DRAFT', draft, 'prepare-0001', f.db);
  return previewAssistantAction(principal, prepared.id, prepared.version, f.db);
}

beforeEach(() => {Object.assign(injected, {enabled: true, actionsEnabled: true, executionEnabled: true, effectFailure: false, domainValue: '10.00'}); vi.clearAllMocks();});
describe('propuestas operativas: versiones, autorización y transacción del dominio', () => {
  it('preparar y revisar no ejecutan el dominio; mismo intento recupera el borrador', async () => {
    const f = fixture(); const first = await prepareAssistantAction(principal, 'PURCHASE_ORDER_DRAFT', draft, 'prepare-0001', f.db);
    expect(first).toMatchObject({status: 'DRAFT', version: 1, draft});
    const second = await prepareAssistantAction(principal, 'PURCHASE_ORDER_DRAFT', draft, 'prepare-0001', f.db);
    expect(second.id).toBe(first.id); expect(f.state.proposals).toHaveLength(1);
    expect(f.state.commands).toEqual([]); expect(f.state.effects).toEqual([]);
  });
  it('la misma clave con otro contenido no reemplaza el borrador', async () => {
    const f = fixture(); await prepareAssistantAction(principal, 'PURCHASE_ORDER_DRAFT', draft, 'prepare-0001', f.db);
    await expect(prepareAssistantAction(principal, 'PURCHASE_ORDER_DRAFT', {...draft, supplierId: 'other'}, 'prepare-0001', f.db)).rejects.toMatchObject({code: 'ACTION_IDEMPOTENCY_CONFLICT'});
    expect(f.state.proposals[0].draftJson.supplierId).toBe('supplier-1');
  });
  it('cada edición invalida la revisión y rechaza la edición de una versión antigua', async () => {
    const f = fixture(); const proposal = await ready(f);
    const updated = await reviseAssistantAction(principal, proposal.id, proposal.version, {...draft, notes: 'Nueva nota'}, f.db);
    expect(updated).toMatchObject({version: proposal.version + 1, status: 'DRAFT', preview: null});
    await expect(reviseAssistantAction(principal, proposal.id, proposal.version, draft, f.db)).rejects.toMatchObject({code: 'ACTION_CHANGED'});
    await expect(confirmAssistantAction(principal, proposal.id, updated.version, 'confirm-0001', f.db)).rejects.toMatchObject({code: 'ACTION_CHANGED'});
    expect(f.state.effects).toEqual([]);
  });
  it('doble confirmación y nueva clave sobre la misma versión recuperan un único comprobante', async () => {
    const f = fixture(); const proposal = await ready(f);
    const results = await Promise.all([confirmAssistantAction(principal, proposal.id, proposal.version, 'confirm-0001', f.db), confirmAssistantAction(principal, proposal.id, proposal.version, 'confirm-0001', f.db)]);
    expect(results[0].id).toBe(results[1].id); expect(results.map(r => r.replayed)).toEqual([false, true]);
    expect(f.state.effects).toEqual(['PURCHASE_ORDER_DRAFT']); expect(f.state.commands).toHaveLength(1); expect(f.state.audits).toHaveLength(1);
    expect((await confirmAssistantAction(principal, proposal.id, proposal.version, 'confirm-0002', f.db)).id).toBe(results[0].id);
    const recovered = await getAssistantAction(principal, proposal.id, f.db);
    expect(recovered.result).toMatchObject({id: results[0].id, resourceId: 'resource-1', replayed: true});
  });
  it.each(['audit', 'receipt', 'domain'])('fallo de %s revierte propuesta, comando y efecto', async failure => {
    const f = fixture(); const proposal = await ready(f);
    if (failure === 'audit') f.auditFails(); if (failure === 'receipt') f.receiptFails(); if (failure === 'domain') injected.effectFailure = true;
    await expect(confirmAssistantAction(principal, proposal.id, proposal.version, 'confirm-0001', f.db)).rejects.toThrow();
    expect(f.state.effects).toEqual([]); expect(f.state.commands).toEqual([]); expect(f.state.audits).toEqual([]); expect(f.state.proposals[0].status).toBe('READY');
  });
  it('una condición material diferente impide registrar los efectos revisados', async () => {
    const f = fixture(); const proposal = await ready(f); injected.domainValue = '11.00';
    await expect(confirmAssistantAction(principal, proposal.id, proposal.version, 'confirm-0001', f.db)).rejects.toMatchObject({code: 'ACTION_REVIEW_STALE'});
    expect(f.state.effects).toEqual([]); expect(f.state.commands).toEqual([]);
  });
  it('no confirma versiones alteradas, propuestas vencidas ni borradores sin revisión', async () => {
    const f = fixture(); const proposal = await ready(f);
    await expect(confirmAssistantAction(principal, proposal.id, proposal.version + 1, 'confirm-0001', f.db)).rejects.toMatchObject({code: 'ACTION_CHANGED'});
    f.state.proposals[0].expiresAt = new Date(0);
    await expect(confirmAssistantAction(principal, proposal.id, proposal.version, 'confirm-0001', f.db)).rejects.toMatchObject({code: 'ACTION_CHANGED'});
    expect((await getAssistantAction(principal, proposal.id, f.db)).status).toBe('EXPIRED'); expect(f.state.effects).toEqual([]);
  });
  it.each([{tenantId: 'other'}, {userId: 'other'}, {role: 'MANAGER'}])('no recupera historial ajeno o de otro alcance %j', async change => {
    const f = fixture(); const proposal = await ready(f);
    await expect(getAssistantAction({...principal, ...change}, proposal.id, f.db)).rejects.toMatchObject({code: 'ACTION_NOT_FOUND'});
  });
  it.each(['revoked', 'execution', 'actions'])('revalida %s después de preparar', async condition => {
    const f = fixture(); const proposal = await ready(f);
    if (condition === 'revoked') f.actor.status = 'DISABLED'; if (condition === 'execution') injected.executionEnabled = false; if (condition === 'actions') f.config.actionsEnabled = false;
    await expect(confirmAssistantAction(principal, proposal.id, proposal.version, 'confirm-0001', f.db)).rejects.toThrow(); expect(f.state.effects).toEqual([]);
  });
  it('el modelo no puede certificar un retiro físico al preparar', async () => {
    const f = fixture(); const raw = {batchId: 'b', warehouseId: 'w', quantity: '1', reason: 'Vencido', physicalRemovalConfirmed: true};
    const proposal = await prepareAssistantAction(principal, 'BATCH_WRITEOFF', raw, 'prepare-0001', f.db);
    expect(proposal.draft.physicalRemovalConfirmed).toBe(false);
    const reviewed = await previewAssistantAction(principal, proposal.id, proposal.version, f.db);
    expect(reviewed.status).toBe('DRAFT'); expect(reviewed.issues).toEqual(['Confirmá el retiro físico.']);
    const revised = await reviseAssistantAction(principal, proposal.id, reviewed.version, raw, f.db);
    expect((await previewAssistantAction(principal, revised.id, revised.version, f.db)).status).toBe('READY');
  });
  it('bodega puede preparar devolución física pero no merma ni órdenes', async () => {
    const f = fixture(); f.actor.role = 'BODEGUERO'; const warehousePrincipal = {...principal, role: 'BODEGUERO'};
    await expect(prepareAssistantAction(warehousePrincipal, 'PURCHASE_ORDER_DRAFT', draft, 'prepare-0001', f.db)).rejects.toMatchObject({code: 'ACTION_FORBIDDEN'});
    await expect(prepareAssistantAction(warehousePrincipal, 'BATCH_WRITEOFF', {}, 'prepare-0002', f.db)).rejects.toMatchObject({code: 'ACTION_FORBIDDEN'});
    expect((await prepareAssistantAction(warehousePrincipal, 'SUPPLIER_RETURN', {}, 'prepare-0003', f.db)).status).toBe('DRAFT');
  });
  it('una clave de confirmación no puede usarse con una segunda propuesta', async () => {
    const f = fixture(); const first = await ready(f); await confirmAssistantAction(principal, first.id, first.version, 'confirm-0001', f.db);
    const next = await prepareAssistantAction(principal, 'PURCHASE_ORDER_DRAFT', draft, 'prepare-0002', f.db);
    const second = await previewAssistantAction(principal, next.id, next.version, f.db);
    await expect(confirmAssistantAction(principal, second.id, second.version, 'confirm-0001', f.db)).rejects.toMatchObject({code: 'ACTION_IDEMPOTENCY_CONFLICT'});
    expect(f.state.effects).toHaveLength(1);
  });
  it.each([{id: 'other-operation'}, {kind: 'BATCH_WRITEOFF'}, {message: null}, {resourceId: 123}])('rechaza comprobantes corruptos %j sin volver a ejecutar', async corruption => {
    const f = fixture(); const proposal = await ready(f);
    await confirmAssistantAction(principal, proposal.id, proposal.version, 'confirm-0001', f.db);
    Object.assign(f.state.commands[0].resultJson, corruption);
    await expect(getAssistantAction(principal, proposal.id, f.db)).rejects.toMatchObject({code: 'ACTION_RESULT_UNAVAILABLE'});
    await expect(confirmAssistantAction(principal, proposal.id, proposal.version, 'confirm-0001', f.db)).rejects.toMatchObject({code: 'ACTION_RESULT_UNAVAILABLE'});
    expect(f.state.effects).toHaveLength(1);
  });
});

describe('schemas operativos sin autoridad desde texto libre', () => {
  it('rechazan tenant, roles y campos de ejecución dentro del borrador', () => {
    expect(actionOrderDraftSchema.safeParse({...draft, status: 'APPROVED'}).success).toBe(false);
    expect(actionOrderDraftSchema.safeParse({...draft, items: [{...draft.items[0], productName: 'Nombre forjado'}]}).success).toBe(false);
    expect(actionWriteoffDraftSchema.safeParse({tenantId: 'other'}).success).toBe(false);
    expect(actionSupplierReturnDraftSchema.safeParse({lines: [{sourceType: 'SQL', query: 'DELETE'}]}).success).toBe(false);
    expect(actionSupplierReturnDraftSchema.safeParse({clientEventId: 'inventado'}).success).toBe(false);
  });
  it('permiten borrador parcial pero no números que pierdan representación decimal', () => {
    expect(actionOrderDraftSchema.parse({})).toEqual({items: []});
    expect(actionOrderDraftSchema.safeParse({items: [{quantity: 1.25}]}).success).toBe(false);
    expect(actionWriteoffDraftSchema.safeParse({quantity: Infinity}).success).toBe(false);
  });
});
