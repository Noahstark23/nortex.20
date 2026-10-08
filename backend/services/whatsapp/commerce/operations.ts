import prisma from '../../../lib/prisma.js';
import { requireCommercePrincipal } from './policy.js';
import type { CommerceDb, CommercePrincipal } from './types.js';

export const COMMERCE_HEARTBEAT_INTERVAL_MS = 5_000;
export const COMMERCE_HEARTBEAT_STALE_MS = 30_000;
export type CommerceWorkerStatus = 'RUNNING' | 'PAUSED' | 'ERROR' | 'STOPPED';
export interface CommerceHeartbeat {
  id: string; startedAt: Date; now: Date; lastProgressAt: Date | null;
  processingEnabled: boolean; sendingEnabled: boolean; status: CommerceWorkerStatus;
  errorCode?: 'COMMERCE_WORKER_FAILED' | null;
}
/** Persist only an allowlisted code; never write exception text or credentials. */
export async function publishCommerceHeartbeat(input: CommerceHeartbeat, db: CommerceDb = prisma) {
  const data = { lastSeenAt: input.now, lastProgressAt: input.lastProgressAt,
    processingEnabled: input.processingEnabled, sendingEnabled: input.sendingEnabled,
    status: input.status, errorCode: input.status === 'ERROR' ? 'COMMERCE_WORKER_FAILED' : null };
  await db.waCommerceWorkerHeartbeat.upsert({ where: { id: input.id },
    create: { id: input.id, startedAt: input.startedAt, ...data }, update: data });
}

/** Aggregates in MySQL. Failure propagates; unavailable never becomes a zero backlog. */
export async function getCommerceOperations(principal: CommercePrincipal, db: CommerceDb = prisma, now = new Date()) {
  await requireCommercePrincipal(principal, db);
  const tenantId = principal.tenantId;
  const [inboxCounts, outboxCounts, inboxHead, outboxHead, inboxExpired, outboxExpired, workers, workerCount] = await Promise.all([
    db.waCommerceInbox.groupBy({ by: ['status'], where: { tenantId }, _count: { _all: true } }),
    db.waCommerceOutbox.groupBy({ by: ['status'], where: { tenantId }, _count: { _all: true } }),
    db.waCommerceInbox.findFirst({ where: { tenantId, status: { in: ['PENDING', 'PROCESSING'] } }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    db.waCommerceOutbox.findFirst({ where: { tenantId, status: { in: ['PENDING', 'SENDING', 'UNKNOWN'] } }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    db.waCommerceInbox.count({ where: { tenantId, status: 'PROCESSING', leaseUntil: { lte: now } } }),
    db.waCommerceOutbox.count({ where: { tenantId, status: 'SENDING', leaseUntil: { lte: now } } }),
    db.waCommerceWorkerHeartbeat.findMany({ take: 20, orderBy: { lastSeenAt: 'desc' }, select: { startedAt: true, lastSeenAt: true, lastProgressAt: true, processingEnabled: true, sendingEnabled: true, status: true, errorCode: true } }),
    db.waCommerceWorkerHeartbeat.count(),
  ]);
  const summarize = (rows: Array<{ status: string; _count: { _all: number } }>, head: { createdAt: Date } | null, expiredLeases: number) => ({
    counts: Object.fromEntries(rows.map(row => [row.status, row._count._all])),
    oldestPendingAt: head?.createdAt ?? null,
    oldestPendingAgeMs: head ? Math.max(0, now.getTime() - head.createdAt.getTime()) : null,
    expiredLeases,
  });
  const visibleWorkers = workers.map(row => ({ ...row, errorCode: row.errorCode === 'COMMERCE_WORKER_FAILED' ? row.errorCode : null,
    status: row.status === 'STOPPED' ? 'STOPPED' : now.getTime() - row.lastSeenAt.getTime() > COMMERCE_HEARTBEAT_STALE_MS ? 'STALE' : row.status }));
  // A fresh error is actionable even if another process is still running.
  const state = !visibleWorkers.length ? 'MISSING' : ['ERROR', 'RUNNING', 'PAUSED', 'STALE', 'STOPPED'].find(status => visibleWorkers.some(worker => worker.status === status))!;
  return { checkedAt: now, inbox: summarize(inboxCounts, inboxHead, inboxExpired), outbox: summarize(outboxCounts, outboxHead, outboxExpired),
    worker: { state, workers: visibleWorkers, truncated: workerCount > workers.length } };
}
