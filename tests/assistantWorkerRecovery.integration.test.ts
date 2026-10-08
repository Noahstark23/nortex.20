import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import prisma from '../backend/lib/prisma';
import { enqueueInvoiceExtraction } from '../backend/services/assistant/worker';
import { saveAssistantAttachment } from '../backend/services/assistant/attachments';
import { assertDisposableDatabase, baseUrl } from './fixtures/assistant/integrationHelpers';

// La compuerta MySQL invoca explícitamente esta suite con backend y DB descartables.
// Una ejecución unitaria sin ese entorno no acredita recuperación de procesos.
const qa = baseUrl || process.env.NORTEX_QA_ASSISTANT_WORKER_RECOVERY === 'true' ? describe.sequential : describe.skip;

const workerProgram = `
import { readFileSync } from 'node:fs';
const control = JSON.parse(readFileSync(0, 'utf8'));
const { runAssistantWorkerOnce } = await import('./backend/services/assistant/worker.ts');
const { default: prisma } = await import('./backend/lib/prisma.ts');
const keepAlive = setInterval(() => {}, 1000);
try {
  const processed = await runAssistantWorkerOnce({ storageRoot: control.storageRoot, provider: { extract: async (principal, files) => {
    if (principal.tenantId !== control.tenantId || files.length !== 1 || files[0].mediaType !== 'application/pdf') {
      throw new Error('QA_WORKER_UNEXPECTED_INPUT');
    }
    process.stdout.write(JSON.stringify({ event: 'provider-entered', pid: process.pid }) + '\\n');
    if (control.mode === 'interrupt') await new Promise(() => {});
    return control.draft;
  } } });
  process.stdout.write(JSON.stringify({ event: 'worker-finished', pid: process.pid, processed }) + '\\n');
} finally { clearInterval(keepAlive); await prisma.$disconnect(); }
`;

function launchWorker(control: { tenantId: string; storageRoot: string; mode: 'interrupt' | 'recover'; draft: unknown }) {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', workerProgram], {
        cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'], env: process.env,
    });
    const events: Array<{ event: string; pid: number; processed?: boolean }> = [];
    let remaining = '';
    let wake: (() => void) | undefined;
    child.stdout.on('data', chunk => {
        remaining += chunk.toString();
        const lines = remaining.split('\n'); remaining = lines.pop() ?? '';
        for (const line of lines) {
            try { const parsed = JSON.parse(line); if (typeof parsed?.event === 'string') events.push(parsed); } catch { /* Sólo se observan marcadores de QA. */ }
        }
        wake?.();
    });
    // No incorporar stderr de procesos con configuración de BD a mensajes o reportes.
    child.stderr.resume();
    child.stdin.end(JSON.stringify(control));
    const closed = once(child, 'close');
    return {
        child, closed,
        async event(name: string) {
            const deadline = Date.now() + 20_000;
            while (!events.some(item => item.event === name)) {
                if (child.exitCode !== null || child.signalCode !== null) throw new Error('El worker de QA terminó antes del marcador esperado.');
                if (Date.now() >= deadline) throw new Error('El worker de QA no alcanzó el marcador dentro del plazo.');
                await new Promise<void>(resolve => {
                    const timer = setTimeout(resolve, 100);
                    wake = () => { clearTimeout(timer); resolve(); };
                });
            }
            return events.find(item => item.event === name)!;
        },
    };
}

function stop(child?: ChildProcessWithoutNullStreams) {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

qa('worker durable: interrupción de proceso y recuperación con MySQL real', () => {
    afterAll(async () => { vi.unstubAllEnvs(); await prisma.$disconnect(); });

    it('otro proceso recupera el mismo job vencido y deja una propuesta y cero compras', async () => {
        assertDisposableDatabase();
        vi.stubEnv('NORTEX_ASSISTANT_ENABLED', 'true');
        vi.stubEnv('NORTEX_ASSISTANT_EXTRACTION_ENABLED', 'true');
        vi.stubEnv('NORTEX_ASSISTANT_EXECUTION_ENABLED', 'true');
        const nonce = randomUUID();
        const tenant = await prisma.tenant.create({ data: { businessName: 'QA reinicio de worker', taxId: `QA-${nonce}`, type: 'FERRETERIA' } });
        const user = await prisma.user.create({ data: { tenantId: tenant.id, name: 'Dueño sintético QA', password: 'no-login-synthetic-fixture', role: 'OWNER' } });
        await prisma.assistantTenantConfig.create({ data: { tenantId: tenant.id, enabled: true, extractionEnabled: true, executionEnabled: true, monthlyBudgetUsd: '10' } });
        const actor = { tenantId: tenant.id, userId: user.id, role: user.role };
        const storageRoot = await mkdtemp(join(tmpdir(), 'nortex-worker-recovery-'));
        const bytes = await readFile('tests/fixtures/assistant/corpus/ferreteria-001.pdf');
        const attachment = await saveAssistantAttachment(actor, bytes, 'application/pdf', 'reinicio-worker-sintetico.pdf', { storageRoot });
        const queued = await enqueueInvoiceExtraction(actor, [attachment.id]);
        // Sólo adelanta la disponibilidad de esta fixture para preceder otros jobs de QA.
        await prisma.assistantJob.updateMany({ where: { id: queued.id, tenantId: actor.tenantId }, data: { availableAt: new Date(0) } });
        const draft = { currency: 'NIO', invoiceNumber: 'RECOVERY-QA', date: '2026-09-05',
            receivedConfirmed: true, paymentConfirmed: true, paymentMethod: 'CASH', documentTotal: '23.00',
            items: [{ description: 'Producto sintético', quantity: '2', unitCost: '10', purchaseUnit: 'BASE' }], warnings: [] };
        let first: ReturnType<typeof launchWorker> | undefined;
        let second: ReturnType<typeof launchWorker> | undefined;
        try {
            first = launchWorker({ tenantId: actor.tenantId, storageRoot, mode: 'interrupt', draft });
            const enteredFirst = await first.event('provider-entered');
            const claimed = await prisma.assistantJob.findFirstOrThrow({ where: { id: queued.id, tenantId: actor.tenantId } });
            expect(claimed).toMatchObject({ status: 'PROCESSING', attempts: 1, proposalId: null });
            expect(claimed.leaseUntil!.getTime()).toBeGreaterThan(Date.now());
            expect(claimed.leaseToken).toBeTruthy();
            expect(await prisma.assistantProposal.count({ where: { tenantId: actor.tenantId } })).toBe(0);
            expect(await prisma.purchase.count({ where: { tenantId: actor.tenantId } })).toBe(0);

            first.child.kill('SIGKILL');
            const [code, signal] = await first.closed;
            expect(code).toBe(null); expect(signal).toBe('SIGKILL');
            const abandoned = await prisma.assistantJob.findFirstOrThrow({ where: { id: queued.id, tenantId: actor.tenantId } });
            expect(abandoned).toMatchObject({ status: 'PROCESSING', attempts: 1, proposalId: null });
            expect(abandoned.leaseToken).toBe(claimed.leaseToken);

            // Vencimiento explícito y verificable: no se presenta como espera física de 180s.
            await prisma.assistantJob.updateMany({ where: { id: queued.id, tenantId: actor.tenantId, status: 'PROCESSING' }, data: { leaseUntil: new Date(0) } });
            second = launchWorker({ tenantId: actor.tenantId, storageRoot, mode: 'recover', draft });
            const enteredSecond = await second.event('provider-entered');
            expect(enteredSecond.pid).not.toBe(enteredFirst.pid);
            expect(await second.event('worker-finished')).toMatchObject({ processed: true });
            const [secondCode, secondSignal] = await second.closed;
            expect(secondCode).toBe(0); expect(secondSignal).toBe(null);

            const recovered = await prisma.assistantJob.findFirstOrThrow({ where: { id: queued.id, tenantId: actor.tenantId } });
            expect(recovered).toMatchObject({ status: 'SUCCEEDED', attempts: 2, proposalId: queued.id, leaseToken: null, leaseUntil: null, errorCode: null });
            const proposals = await prisma.assistantProposal.findMany({ where: { tenantId: actor.tenantId }, take: 2 });
            expect(proposals).toHaveLength(1);
            expect(proposals[0]).toMatchObject({ id: queued.id, status: 'DRAFT', userId: actor.userId });
            expect(proposals[0].draft).toMatchObject({ receivedConfirmed: false, paymentConfirmed: false });
            expect(await prisma.purchase.count({ where: { tenantId: actor.tenantId } })).toBe(0);
            expect(await prisma.purchaseCommand.count({ where: { tenantId: actor.tenantId } })).toBe(0);
            expect(await prisma.assistantUsage.count({ where: { tenantId: actor.tenantId } })).toBe(0);
        } finally {
            stop(first?.child); stop(second?.child);
            await Promise.all([first?.closed, second?.closed].filter(Boolean));
            await rm(storageRoot, { recursive: true, force: true });
        }
    }, 55_000);
});
