import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkCommittedProposalReferences, disposableRestoreUrl, verifyRestoredAssistantOriginals,
  type RestoredOriginal } from '../scripts/qa/verify-assistant-originals-restore.js';

describe('restauración de originales permanentes del asistente', () => {
  let root: string;
  const key = randomUUID();
  const contents = Buffer.from('factura sintética de QA');
  const row = (): RestoredOriginal => ({
    storageKey: key, sha256: createHash('sha256').update(contents).digest('hex'),
    bytes: contents.length, status: 'ATTACHED', expiresAt: null, purchaseValid: true,
  });

  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'nortex-originals-restore-')); await chmod(root, 0o700); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('acredita archivo privado, hash y compra vinculada', async () => {
    await writeFile(join(root, key), contents, { mode: 0o600 });
    expect(await verifyRestoredAssistantOriginals([row()], root)).toMatchObject({ status: 'ok', checked: 1, altered: 0, missing: 0 });
  });

  it('falla si falta o cambia el original', async () => {
    expect(await verifyRestoredAssistantOriginals([row()], root)).toMatchObject({ status: 'failed', missing: 1 });
    await writeFile(join(root, key), Buffer.from('contenido alterado de QA'), { mode: 0o600 });
    expect(await verifyRestoredAssistantOriginals([row()], root)).toMatchObject({ status: 'failed', altered: 1 });
  });

  it('rechaza permisos amplios y symlinks sin leerlos', async () => {
    await writeFile(join(root, key), contents, { mode: 0o600 });
    await chmod(join(root, key), 0o644);
    expect(await verifyRestoredAssistantOriginals([row()], root)).toMatchObject({ status: 'failed', unsafePermissions: 1 });
    await rm(join(root, key));
    const external = join(root, 'otro-original');
    await writeFile(external, contents, { mode: 0o600 });
    await symlink(external, join(root, key));
    expect(await verifyRestoredAssistantOriginals([row()], root)).toMatchObject({ status: 'failed', unsafePermissions: 1 });
  });

  it('rechaza una referencia de compra inválida o duplicada', async () => {
    await writeFile(join(root, key), contents, { mode: 0o600 });
    expect(await verifyRestoredAssistantOriginals([{ ...row(), purchaseValid: false }], root)).toMatchObject({ status: 'failed', invalidPurchase: 1 });
    expect(await verifyRestoredAssistantOriginals([row(), row()], root)).toMatchObject({ status: 'failed', duplicateKeys: 1 });
  });

  it('no confunde una base sin originales confirmados con recuperación acreditada', async () => {
    expect(await verifyRestoredAssistantOriginals([], root)).toMatchObject({ status: 'empty', checked: 0 });
  });

  it('exige un nombre de base descartable y URL MySQL para el CLI', () => {
    expect(disposableRestoreUrl('mysql://qa:qa@127.0.0.1:3306/nortex_restore_test')).toContain('nortex_restore_test');
    expect(() => disposableRestoreUrl('mysql://qa:qa@127.0.0.1:3306/nortex_db')).toThrow('ASSISTANT_RESTORE_DATABASE_UNSAFE');
    expect(() => disposableRestoreUrl('postgres://qa:qa@127.0.0.1:5432/nortex_restore_test')).toThrow('ASSISTANT_RESTORE_DATABASE_UNSAFE');
  });

  it('reconcilia cada referencia de propuesta confirmada con compra, tenant y usuario', () => {
    const proposal = { tenantId: 'qa-ferreteria', userId: 'owner', attachmentIds: ['adjunto-1'], result: { purchaseId: 'compra-1' } };
    const good = new Map([['adjunto-1', { tenantId: 'qa-ferreteria', userId: 'owner', purchaseId: 'compra-1', status: 'ATTACHED' }]]);
    expect(checkCommittedProposalReferences(proposal, good)).toEqual({ checked: 1, broken: 0 });
    expect(checkCommittedProposalReferences(proposal, new Map())).toEqual({ checked: 1, broken: 1 });
    expect(checkCommittedProposalReferences(proposal, new Map([['adjunto-1', { ...good.get('adjunto-1')!, tenantId: 'otro' }]])))
      .toEqual({ checked: 1, broken: 1 });
    expect(checkCommittedProposalReferences({ ...proposal, attachmentIds: ['adjunto-1', 'adjunto-1'] }, good))
      .toEqual({ checked: 2, broken: 1 });
  });
});
