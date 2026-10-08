import type { PrismaClient } from '@prisma/client';
import { vi } from 'vitest';

type Row = Record<string, any>;
type Query = { where?: Row; data?: Row; select?: Row; orderBy?: Row | Row[]; take?: number; skip?: number; cursor?: Row };
const clone = <T>(value: T): T => structuredClone(value);
const comparable = (value: unknown): any => value instanceof Date ? value.getTime() : value;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([field, expected]) => {
    if (field === 'AND') return (Array.isArray(expected) ? expected : [expected]).every(value => matches(row, value));
    if (field === 'OR') return expected.some((value: Row) => matches(row, value));
    if (field === 'NOT') return !(Array.isArray(expected) ? expected : [expected]).some(value => matches(row, value));
    const actual = comparable(row[field]);
    if (expected && typeof expected === 'object' && !(expected instanceof Date) && !Array.isArray(expected)) {
      return Object.entries(expected).every(([operator, value]) => {
        const target = comparable(value);
        if (operator === 'equals') return actual === target;
        if (operator === 'not') return actual !== target;
        if (operator === 'in') return (value as unknown[]).map(comparable).includes(actual);
        if (operator === 'gt') return actual > target;
        if (operator === 'gte') return actual >= target;
        if (operator === 'lt') return actual < target;
        if (operator === 'lte') return actual <= target;
        throw new Error(`Unsupported fake predicate: ${operator}`);
      });
    }
    return actual === comparable(expected);
  });
}

function project(row: Row | undefined, select?: Row): Row | null {
  if (!row) return null;
  return clone(select ? Object.fromEntries(Object.keys(select).filter(key => select[key]).map(key => [key, row[key]])) : row);
}

/** Doble deliberadamente cerrado: no representa MySQL, aislamiento real ni permisos reales. */
export function createWorkItemsFake() {
  const items: Row[] = [], events: Row[] = [], runs: Row[] = [];
  const forbiddenAccesses: string[] = [];
  let sequence = 0, rejectCas = false, rejectEvent = false;
  let queue = Promise.resolve();
  const deny = (key: string): never => { forbiddenAccesses.push(key); throw new Error(`Forbidden work-item dependency: ${key}`); };
  const closed = <T extends object>(object: T, prefix: string): T => new Proxy(object, {
    get(target, key, receiver) {
      if (typeof key === 'symbol') return Reflect.get(target, key, receiver);
      if (!(key in target)) return deny(`${prefix}.${key}`);
      return Reflect.get(target, key, receiver);
    },
  });
  const delegate = (name: string, rows: Row[]) => {
    const findMany = vi.fn(async ({ where, select, orderBy, take, skip = 0, cursor }: Query = {}) => {
      let result = rows.filter(row => matches(row, where));
      for (const ordering of (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []).slice().reverse()) {
        for (const [field, direction] of Object.entries(ordering)) {
          result = result.slice().sort((a, b) => (comparable(a[field]) < comparable(b[field]) ? -1 : comparable(a[field]) > comparable(b[field]) ? 1 : 0) * (direction === 'desc' ? -1 : 1));
        }
      }
      if (cursor) { const index = result.findIndex(row => matches(row, cursor)); result = index < 0 ? [] : result.slice(index); }
      return result.slice(skip, take === undefined ? undefined : skip + take).map(row => project(row, select)!);
    });
    return closed({
      findFirst: vi.fn(async (query: Query = {}) => (await findMany({ ...query, take: 1 }))[0] ?? null),
      findUnique: vi.fn(async (query: Query = {}) => project(rows.find(row => matches(row, query.where)), query.select)),
      findMany,
      count: vi.fn(async ({ where }: Query = {}) => rows.filter(row => matches(row, where)).length),
      create: vi.fn(async ({ data = {}, select }: Query) => {
        if (name === 'assistantWorkEvent' && rejectEvent) { rejectEvent = false; throw new Error('INJECTED_EVENT_WRITE_FAILURE'); }
        const keys = name === 'assistantWorkItem' ? ['tenantId', 'userId', 'runId'] : ['workItemId', 'eventId'];
        if (keys.every(key => data[key] !== undefined) && rows.some(row => keys.every(key => row[key] === data[key]))) throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
        const row = { id: `${name}-${++sequence}`, version: 0, status: 'IN_REVIEW', ...(name === 'assistantWorkItem' ? { kind: 'W01_CASH_REVIEW', eventCount: 1 } : {}), createdAt: new Date('2026-09-19T18:00:00Z'), updatedAt: new Date('2026-09-19T18:00:00Z'), ...clone(data) };
        rows.push(row); return project(row, select)!;
      }),
      updateMany: vi.fn(async ({ where, data = {} }: Query) => {
        if (name === 'assistantWorkItem' && rejectCas) { rejectCas = false; return { count: 0 }; }
        const found = rows.filter(row => matches(row, where));
        for (const row of found) for (const [field, value] of Object.entries(data)) {
          row[field] = value && typeof value === 'object' && 'increment' in value ? row[field] + value.increment : clone(value);
        }
        return { count: found.length };
      }),
      deleteMany: vi.fn(async ({ where }: Query = {}) => {
        const kept = rows.filter(row => !matches(row, where)), count = rows.length - kept.length;
        rows.splice(0, rows.length, ...kept); return { count };
      }),
    }, name);
  };
  const mocks = {
    assistantWorkItem: delegate('assistantWorkItem', items),
    assistantWorkEvent: delegate('assistantWorkEvent', events),
    assistantRun: delegate('assistantRun', runs),
    $queryRaw: vi.fn(async (query: { strings: readonly string[]; values: unknown[] } | TemplateStringsArray, ...values: unknown[]) => {
      const strings: readonly string[] = Array.isArray(query) ? query : (query as { strings: readonly string[] }).strings;
      const parameters: unknown[] = Array.isArray(query) ? values : (query as { values: unknown[] }).values;
      const sql = strings.reduce((text, part, index) => text + part + (index < parameters.length ? `__value${index}__` : ''), '');
      if (!/^\s*SELECT\b/i.test(sql) || /\b(INSERT|DELETE|UPDATE)\b/i.test(sql.replace(/FOR\s+UPDATE/ig, ''))) return deny('raw.non-read');
      const table = /\bFROM\s+`?(AssistantWorkItem|AssistantRun|User|AssistantTenantConfig)`?\b/i.exec(sql)?.[1];
      if (!table || /\bJOIN\b/i.test(sql)) return deny('raw.table');
      // Sólo representa adquisición de locks; la autorización se prueba con un mock explícito.
      if (table === 'User' || table === 'AssistantTenantConfig') {
        if (!/FOR\s+UPDATE\s*$/i.test(sql) || !/tenantId\s*=/.test(sql)) return deny('raw.authority');
        return [{ id: parameters[0], tenantId: parameters[table === 'User' ? 1 : 0] }];
      }
      const where: Row = {};
      for (const match of sql.matchAll(/`?(\w+)`?\s+IN\s*\(([^)]+)\)/gi)) {
        where[match[1]] = { in: [...match[2].matchAll(/__value(\d+)__/g)].map(value => parameters[Number(value[1])]) };
      }
      for (const match of sql.matchAll(/`?(\w+)`?\s*(=|>=|<=|>|<)\s*__value(\d+)__/g)) {
        const [, field, operator, index] = match;
        where[field] = operator === '=' ? parameters[Number(index)] : { [{ '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte' }[operator]!]: parameters[Number(index)] };
      }
      return clone((table === 'AssistantRun' ? runs : items).filter(row => matches(row, where)));
    }),
    $transaction: vi.fn(),
  };
  const db = closed(mocks, 'db') as unknown as PrismaClient;
  mocks.$transaction.mockImplementation(async (action: (tx: PrismaClient) => Promise<unknown>) => {
    const previous = queue;
    let release!: () => void;
    queue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    const before = clone({ items, events, runs });
    try { return await action(db); }
    catch (error) {
      items.splice(0, items.length, ...before.items);
      events.splice(0, events.length, ...before.events);
      runs.splice(0, runs.length, ...before.runs);
      throw error;
    } finally { release(); }
  });
  return { db, items, events, runs, mocks, forbiddenAccesses, failNextCas: () => { rejectCas = true; }, failNextEventCreate: () => { rejectEvent = true; } };
}
