/** Fixture descartable para probar que SQL y originales permanentes viajan juntos. */
import { randomUUID, createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, rm } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { PrismaClient } from '@prisma/client';

async function main() {
  const url = process.env.DATABASE_URL;
  const root = process.env.NORTEX_ASSISTANT_STORAGE_DIR;
  if (process.env.NORTEX_QA_DATABASE_ACK !== 'disposable-database' || !url || !root)
    throw new Error('ASSISTANT_BACKUP_QA_GUARD');
  const parsed = new URL(url);
  if (parsed.protocol !== 'mysql:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname)
    || decodeURIComponent(parsed.pathname) !== '/nortex_backup_test')
    throw new Error('ASSISTANT_BACKUP_QA_DATABASE_UNSAFE');
  if (!isAbsolute(root)) throw new Error('ASSISTANT_BACKUP_QA_STORAGE_UNSAFE');
  const storage = resolve(root);
  const relation = relative(resolve(process.cwd()), storage);
  if (relation !== '..' && !relation.startsWith(`..${sep}`) && !isAbsolute(relation))
    throw new Error('ASSISTANT_BACKUP_QA_STORAGE_UNSAFE');
  await mkdir(storage, { recursive: true, mode: 0o700 });
  const info = await lstat(storage);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o700)
    throw new Error('ASSISTANT_BACKUP_QA_STORAGE_UNSAFE');

  const id = randomUUID();
  const body = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n');
  const file = resolve(storage, id);
  const handle = await open(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(body); } finally { await handle.close(); }
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    await db.$transaction(async tx => {
      const tenant = await tx.tenant.create({ data: { businessName: 'QA Backup Sintético', taxId: `qa-backup-${id}` } });
      const user = await tx.user.create({ data: {
        tenantId: tenant.id, email: `qa-backup-${id}@example.invalid`, password: 'synthetic-no-login',
        name: 'QA Backup', role: 'OWNER',
      } });
      const supplier = await tx.supplier.create({ data: { tenantId: tenant.id, name: 'Proveedor QA' } });
      const purchase = await tx.purchase.create({ data: {
        tenantId: tenant.id, supplierId: supplier.id, invoiceNumber: `QA-${id}`,
        subtotal: '1.00', total: '1.00', paymentMethod: 'CASH', createdBy: user.id,
      } });
      const attachment = await tx.assistantAttachment.create({ data: {
        tenantId: tenant.id, userId: user.id, roleAtCreation: 'OWNER', name: 'qa.pdf',
        mediaType: 'application/pdf', storageKey: id,
        sha256: createHash('sha256').update(body).digest('hex'), bytes: body.length,
        pages: 1, status: 'ATTACHED', purchaseId: purchase.id, expiresAt: null,
      } });
      await tx.assistantProposal.create({ data: {
        tenantId: tenant.id, userId: user.id, roleAtCreation: 'OWNER',
        attachmentIds: [attachment.id], status: 'COMMITTED', draft: { synthetic: true },
        issues: [], result: { purchaseId: purchase.id }, expiresAt: new Date(Date.now() + 86_400_000),
      } });
    });
    console.log('Fixture sintético de original permanente creado.');
  } catch (error) {
    await rm(file, { force: true });
    throw error;
  } finally { await db.$disconnect(); }
}

main().catch(() => { console.error('No se pudo sembrar el fixture descartable.'); process.exitCode = 1; });
