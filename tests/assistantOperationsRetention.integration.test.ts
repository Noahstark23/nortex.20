// @vitest-environment node
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import prisma from '../backend/lib/prisma';
import { cleanupAssistantOperations } from '../backend/services/assistant/operations/retention';
import { assertDisposableDatabase } from './fixtures/assistant/integrationHelpers';

const qa = process.env.NORTEX_MYSQL_INTEGRATION === '1' ? describe.sequential : describe.skip;
// Un reloj antiguo aísla estas fixtures de otros escenarios sintéticos en la misma base descartable.
const now = new Date('1900-01-01T00:00:00.000Z');
const past = new Date('1899-12-31T00:00:00.000Z');
const future = new Date('1901-01-01T00:00:00.000Z');
async function fixture() {
  assertDisposableDatabase();
  const tenant = await prisma.tenant.create({data: {businessName: 'QA retención operativa', taxId: randomUUID()}});
  const user = await prisma.user.create({data: {tenantId: tenant.id, role: 'OWNER', name: 'QA retención', password: 'synthetic-no-login'}});
  return {tenantId: tenant.id, userId: user.id, roleAtCreation: user.role};
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const runData = (f: Fixture, extra: Record<string, unknown> = {}) => ({...f, conversationId: randomUUID(), requestId: randomUUID(), payloadHash: 'a'.repeat(64), inputText: 'Consulta sintética', expiresAt: past, ...extra});
const proposalData = (f: Fixture, extra: Record<string, unknown> = {}) => ({...f, kind: 'PURCHASE_ORDER_DRAFT', requestKey: randomUUID(), payloadHash: 'b'.repeat(64), draftJson: {}, expiresAt: past, ...extra});

qa('retención operativa real + MySQL 8', () => {
  it('borra sólo trabajo vencido sin lease vigente y conserva propuestas registradas y comprobantes', async () => {
    const a = await fixture(), b = await fixture();
    const deletedRuns = await Promise.all([
      prisma.assistantRun.create({data: runData(a)}),
      prisma.assistantRun.create({data: runData(b, {leaseUntil: now})}),
    ]);
    const keptRuns = await Promise.all([
      prisma.assistantRun.create({data: runData(a, {leaseUntil: future, leaseToken: 'worker-actual', status: 'RUNNING'})}),
      prisma.assistantRun.create({data: runData(b, {expiresAt: future})}),
    ]);
    const deletedBrief = await prisma.assistantDailyBrief.create({data: {...a, localDay: '1899-12-31', items: [], dismissedIds: [], expiresAt: now}});
    const keptBrief = await prisma.assistantDailyBrief.create({data: {...b, localDay: '1900-01-01', items: [], dismissedIds: [], expiresAt: future}});
    const deletedProposals = await Promise.all(['DRAFT', 'READY', 'CANCELLED', 'EXPIRED'].map(status => prisma.assistantActionProposal.create({data: proposalData(a, {status})})));
    const committed = await prisma.assistantActionProposal.create({data: proposalData(a, {status: 'COMMITTED'})});
    const command = await prisma.assistantActionCommand.create({data: {tenantId: a.tenantId, userId: a.userId, requestKey: randomUUID(), payloadHash: 'c'.repeat(64), proposalId: committed.id, proposalVersion: committed.version, kind: committed.kind, resultJson: {id: 'receipt-preserved', message: 'Orden conservada'}}});
    await prisma.assistantActionProposal.update({where: {id: committed.id}, data: {operationId: command.id}});
    const keptProposals = await Promise.all([
      prisma.assistantActionProposal.create({data: proposalData(a, {status: 'COMMITTED'})}),
      prisma.assistantActionProposal.create({data: proposalData(b, {status: 'READY', operationId: command.id})}),
      prisma.assistantActionProposal.create({data: proposalData(b, {expiresAt: future})}),
    ]);
    await cleanupAssistantOperations(prisma, now);
    expect(await prisma.assistantRun.count({where: {id: {in: deletedRuns.map(row => row.id)}}})).toBe(0);
    expect(await prisma.assistantRun.count({where: {id: {in: keptRuns.map(row => row.id)}}})).toBe(2);
    expect(await prisma.assistantDailyBrief.findUnique({where: {id: deletedBrief.id}})).toBeNull();
    expect(await prisma.assistantDailyBrief.findUnique({where: {id: keptBrief.id}})).not.toBeNull();
    expect(await prisma.assistantActionProposal.count({where: {id: {in: deletedProposals.map(row => row.id)}}})).toBe(0);
    expect(await prisma.assistantActionProposal.count({where: {id: {in: [...keptProposals.map(row => row.id), committed.id]}}})).toBe(4);
    expect(await prisma.assistantActionCommand.findUniqueOrThrow({where: {id: command.id}})).toEqual(command);
  });

  it('vuelve a comprobar estado, lease y vencimiento después de seleccionar candidatos', async () => {
    const f = await fixture();
    const run = await prisma.assistantRun.create({data: runData(f)});
    const brief = await prisma.assistantDailyBrief.create({data: {...f, localDay: '1899-12-31', items: [], dismissedIds: [], expiresAt: past}});
    const proposal = await prisma.assistantActionProposal.create({data: proposalData(f, {status: 'READY'})});
    const command = await prisma.assistantActionCommand.create({data: {tenantId: f.tenantId, userId: f.userId, requestKey: randomUUID(), payloadHash: 'd'.repeat(64), proposalId: proposal.id, proposalVersion: proposal.version, kind: proposal.kind, resultJson: {message: 'Comprobante concurrente'}}});
    const transitions = {
      assistantRun: () => prisma.assistantRun.update({where: {id: run.id}, data: {leaseUntil: future, leaseToken: 'nuevo-worker', status: 'RUNNING'}}),
      assistantDailyBrief: () => prisma.assistantDailyBrief.update({where: {id: brief.id}, data: {expiresAt: future}}),
      assistantActionProposal: () => prisma.assistantActionProposal.update({where: {id: proposal.id}, data: {status: 'COMMITTED', operationId: command.id}}),
    };
    // El proxy sólo coloca la carrera entre SELECT y DELETE; ambos pasos usan MySQL real.
    const concurrentDb = new Proxy(prisma, {get(target, name, receiver) {
      const delegate = Reflect.get(target, name, receiver);
      if (!(name in transitions)) return delegate;
      return new Proxy(delegate, {get(model, operation) {
        if (operation !== 'findMany') return Reflect.get(model, operation);
        return async (args: unknown) => {
          const selected = await model.findMany(args);
          await transitions[name as keyof typeof transitions]();
          return selected;
        };
      }});
    }}) as PrismaClient;
    await cleanupAssistantOperations(concurrentDb, now);
    expect(await prisma.assistantRun.findUniqueOrThrow({where: {id: run.id}})).toMatchObject({status: 'RUNNING', leaseToken: 'nuevo-worker', leaseUntil: future});
    expect(await prisma.assistantDailyBrief.findUniqueOrThrow({where: {id: brief.id}})).toMatchObject({expiresAt: future});
    expect(await prisma.assistantActionProposal.findUniqueOrThrow({where: {id: proposal.id}})).toMatchObject({status: 'COMMITTED', operationId: command.id});
    expect(await prisma.assistantActionCommand.findUniqueOrThrow({where: {id: command.id}})).toEqual(command);
  });

  it('limita cada barrido a cien ejecuciones antiguas sin borrar trabajo vigente', async () => {
    const f = await fixture();
    await prisma.assistantRun.createMany({data: Array.from({length: 201}, () => runData(f, {expiresAt: new Date('1800-01-01T00:00:00.000Z')}))});
    const current = await prisma.assistantRun.create({data: runData(f, {expiresAt: future})});
    const first = await cleanupAssistantOperations(prisma, now);
    expect(first.runs).toBe(100);
    expect(await prisma.assistantRun.count({where: {tenantId: f.tenantId}})).toBe(102);
    const second = await cleanupAssistantOperations(prisma, now);
    expect(second.runs).toBe(100);
    expect(await prisma.assistantRun.count({where: {tenantId: f.tenantId}})).toBe(2);
    await cleanupAssistantOperations(prisma, now);
    expect(await prisma.assistantRun.findMany({where: {tenantId: f.tenantId}, select: {id: true}})).toEqual([{id: current.id}]);
  });
});
