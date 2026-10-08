/** Comprueba las lecturas SQL del evaluador en MySQL 8 descartable, sin modelo. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prisma from '../../backend/lib/prisma.js';
import { captureBusinessState, businessStateChanges } from '../assistant-evaluation/first-cut-model.mjs';
import { validateQualityDatabase } from '../quality-gate-contract.mjs';

validateQualityDatabase(process.env.DATABASE_URL, process.env.NORTEX_QA_DATABASE_ACK);

async function main() {
  const tenant = await prisma.tenant.create({ data: {
    businessName: 'QA primer corte', taxId: `qa-first-cut-${randomUUID()}`,
  } });
  const other = await prisma.tenant.create({ data: {
    businessName: 'QA otro negocio', taxId: `qa-other-${randomUUID()}`,
  } });
  const account = await prisma.account.create({ data: {
    tenantId: tenant.id, code: 'QA-1', name: 'Cuenta QA', type: 'ASSET', balance: '10.0000',
  } });
  const otherAccount = await prisma.account.create({ data: {
    tenantId: other.id, code: 'QA-2', name: 'Otra cuenta QA', type: 'ASSET', balance: '20.0000',
  } });

  const before = await captureBusinessState(prisma, tenant.id);
  assert.equal(before.account.length, 1);
  assert.deepEqual(before.expense, []);
  await prisma.account.update({ where: { id: otherAccount.id }, data: { balance: '21.0000' } });
  assert.deepEqual(businessStateChanges(before, await captureBusinessState(prisma, tenant.id)), []);

  await prisma.account.update({ where: { id: account.id }, data: { balance: '11.0000' } });
  await prisma.expense.create({ data: {
    tenantId: tenant.id, amount: '1.00', description: 'Cambio sintético', category: 'QA',
  } });
  const after = await captureBusinessState(prisma, tenant.id);
  assert.deepEqual(businessStateChanges(before, after), ['expense', 'account']);
  assert.equal(before.account[0].balance, '10');
  assert.equal(after.account[0].balance, '11');
  assert.equal(after.expense.length, 1);
  console.log('QA MySQL primer corte: consultas de 23 modelos, aislamiento tenant y cambios de dinero detectados.');
}

main().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
