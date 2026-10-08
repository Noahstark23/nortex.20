import { describe, expect, it, vi } from 'vitest';
import Decimal from 'decimal.js';
vi.mock('../backend/services/assistant/access.js', () => ({ assertAssistantAccess: vi.fn().mockResolvedValue(undefined) }));
import { reserveAssistantBudget, settleAssistantBudget, USAGE_SUPPORTS_RUN_LINK } from '../backend/services/assistant/budget.js';

const principal = { tenantId: 'tenant', userId: 'user', role: 'OWNER' };
const RUN = 'run-42';

function database() {
  const buckets = new Map<string, any>(), usages = new Map<string, any>();
  const tx = {
    $executeRaw: vi.fn(async (query: any) => { const [id, scope, month, limitUsd] = query.values; if (!buckets.has(id)) buckets.set(id, { id, scope, month, limitUsd, reservedUsd: new Decimal(0), spentUsd: new Decimal(0), blocked: false }); return 1; }),
    $queryRaw: vi.fn(async (query: any) => { const row = buckets.get(query.values[0]); return row ? [row] : []; }),
    assistantTenantConfig: { findUnique: vi.fn().mockResolvedValue({ monthlyBudgetUsd: new Decimal(10) }) },
    assistantBudget: { updateMany: vi.fn(async ({ where, data }: any) => { const row = buckets.get(where.id); if (!row) return { count: 0 };
      if (data.reservedUsd?.increment) row.reservedUsd = new Decimal(row.reservedUsd).add(data.reservedUsd.increment);
      else if (data.reservedUsd?.decrement) { row.reservedUsd = new Decimal(row.reservedUsd).sub(data.reservedUsd.decrement); row.spentUsd = new Decimal(row.spentUsd).add(data.spentUsd.increment); }
      if (data.blocked) row.blocked = true; return { count: 1 }; }) },
    assistantUsage: {
      create: vi.fn(async ({ data }: any) => { const row = { ...data }; usages.set(data.id, row); return row; }),
      findFirst: vi.fn(async ({ where }: any) => { const row = usages.get(where.id); return row?.tenantId === where.tenantId && row?.userId === where.userId ? row : null; }),
      updateMany: vi.fn(async ({ where, data }: any) => { Object.assign(usages.get(where.id), data); return { count: 1 }; }),
    },
  };
  return { db: { ...tx, $transaction: async (fn: any) => fn(tx) } as any, buckets, usages };
}
const at = () => new Date('2026-09-05');

describe('vínculo entre el consumo de IA y su ejecución', () => {
  it('escribe el vínculo al CREAR la reserva, antes de llamar al proveedor', async () => {
    const { db, usages } = database();
    const row = await reserveAssistantBudget(principal, '0.25', { db, now: at, runId: RUN });
    const stored = usages.get(row.id);
    // La fila nace RESERVED: existe antes de que haya respuesta del proveedor.
    expect(stored.status).toBe('RESERVED');
    // Antes de la migración y `prisma generate` el campo no se manda, para no romper la reserva.
    expect(stored.runId).toBe(USAGE_SUPPORTS_RUN_LINK ? RUN : undefined);
  });

  it('un costo incierto conserva el vínculo: por eso no alcanza con liquidar', async () => {
    const { db, usages } = database();
    const row = await reserveAssistantBudget(principal, '0.25', { db, now: at, runId: RUN });
    await settleAssistantBudget(principal, row.id, null, { db });
    expect(usages.get(row.id).status).toBe('UNKNOWN');
    expect(usages.get(row.id).runId).toBe(USAGE_SUPPORTS_RUN_LINK ? RUN : undefined);
  });

  it('la liquidación conserva el vínculo y el identificador del proveedor', async () => {
    const { db, usages } = database();
    const row = await reserveAssistantBudget(principal, '0.25', { db, now: at, runId: RUN });
    await settleAssistantBudget(principal, row.id, { inputTokens: 1000, outputTokens: 1000, requestId: 'msg_x' }, { db });
    const stored = usages.get(row.id);
    expect(stored.status).toBe('SETTLED');
    expect(stored.providerRequestId).toBe('msg_x');
    expect(stored.runId).toBe(USAGE_SUPPORTS_RUN_LINK ? RUN : undefined);
  });

  it('sin ejecución asociada no se inventa un vínculo', async () => {
    const { db, usages } = database();
    const row = await reserveAssistantBudget(principal, '0.25', { db, now: at });
    expect(usages.get(row.id).runId).toBeUndefined();
  });

  it('la contabilidad del presupuesto no cambia por el vínculo', async () => {
    const { db, buckets } = database();
    const row = await reserveAssistantBudget(principal, '0.25', { db, now: at, runId: RUN });
    expect(buckets.get('global:2026-09').reservedUsd.toString()).toBe('0.25');
    expect(buckets.get('tenant:tenant:2026-09').reservedUsd.toString()).toBe('0.25');
    await settleAssistantBudget(principal, row.id, { inputTokens: 1000, outputTokens: 1000 }, { db });
    expect(buckets.get('global:2026-09').spentUsd.toString()).toBe('0.006');
    expect(buckets.get('global:2026-09').reservedUsd.toString()).toBe('0');
  });
});
