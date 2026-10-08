import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import prisma from '../lib/prisma.js';
import { processCommerceInboxOnce } from '../services/whatsapp/commerce/worker.js';
import { dispatchCommerceOutboxOnce, recoverCommerceSending } from '../services/whatsapp/commerce/outbox.js';
import { COMMERCE_HEARTBEAT_INTERVAL_MS, publishCommerceHeartbeat, type CommerceWorkerStatus } from '../services/whatsapp/commerce/operations.js';
import type { CommerceDb } from '../services/whatsapp/commerce/types.js';

interface WorkerDependencies {
  db?: CommerceDb; now?: () => Date; instanceId?: string;
  flags?: () => { processingEnabled: boolean; sendingEnabled: boolean };
  recover?: () => Promise<number>; processInbox?: () => Promise<boolean>; dispatch?: () => Promise<boolean>;
}
/** A tick is injectable and import has no signal handlers or process side effects. */
export function createCommerceWorkerRuntime(deps: WorkerDependencies = {}) {
  const db = deps.db ?? prisma, clock = deps.now ?? (() => new Date());
  const id = deps.instanceId ?? randomUUID(), startedAt = clock();
  const flags = deps.flags ?? (() => ({ processingEnabled: process.env.WHATSAPP_COMMERCE_ENABLED === 'true' && process.env.WHATSAPP_COMMERCE_WORKER_ENABLED === 'true', sendingEnabled: process.env.WHATSAPP_COMMERCE_SENDING_ENABLED === 'true' }));
  let lastProgressAt: Date | null = null, lastPublishedAt: Date | null = null, previousStatus: CommerceWorkerStatus | null = null;
  let previousFlags = '';
  async function publish(status: CommerceWorkerStatus, force = false) {
    const now = clock(), current = flags(), flagKey = `${current.processingEnabled}:${current.sendingEnabled}`;
    if (!force && status === previousStatus && flagKey === previousFlags && lastPublishedAt && now.getTime() - lastPublishedAt.getTime() < COMMERCE_HEARTBEAT_INTERVAL_MS) return;
    await publishCommerceHeartbeat({ id, startedAt, now, lastProgressAt, ...current, status }, db);
    lastPublishedAt = now; previousStatus = status; previousFlags = flagKey;
  }
  return {
    async tick(): Promise<{ progress: boolean; status: CommerceWorkerStatus }> {
      if (!flags().processingEnabled) { await publish('PAUSED'); return { progress: false, status: 'PAUSED' }; }
      try {
        await publish('RUNNING');
        const recovered = await (deps.recover ?? (() => recoverCommerceSending({ db, now: clock })))();
        const processed = await (deps.processInbox ?? (() => processCommerceInboxOnce({ db, now: clock })))();
        const sent = await (deps.dispatch ?? (() => dispatchCommerceOutboxOnce({ db, now: clock, sendingEnabled: flags().sendingEnabled })))();
        const progress = recovered > 0 || processed || sent;
        if (progress) lastProgressAt = clock();
        await publish('RUNNING');
        return { progress, status: 'RUNNING' };
      } catch {
        await publish('ERROR', true);
        return { progress: false, status: 'ERROR' };
      }
    },
    async stop() { await publish('STOPPED', true); },
  };
}

export async function runCommerceWorker(): Promise<void> {
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  const runtime = createCommerceWorkerRuntime();
  try {
    while (!stopping) {
      try {
        const result = await runtime.tick();
        if (!result.progress) await new Promise(resolve => setTimeout(resolve, result.status === 'RUNNING' ? 1000 : 5000));
      } catch {
        console.error('WhatsApp comercial: worker temporalmente no disponible.');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  } finally {
    process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
    await runtime.stop();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runCommerceWorker().finally(() => prisma.$disconnect());
}
