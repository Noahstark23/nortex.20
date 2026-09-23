/** Verifica originales permanentes contra una base MySQL 8 restaurada y descartable. */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { MAX_ATTACHMENT_BYTES } from '../../backend/services/assistant/attachments.js';

export interface RestoredOriginal {
  storageKey: string;
  sha256: string;
  bytes: number;
  status: string;
  expiresAt: Date | null;
  purchaseValid: boolean;
}

export interface OriginalsRestoreResult {
  status: 'ok' | 'empty' | 'failed';
  checked: number;
  missing: number;
  altered: number;
  unsafePermissions: number;
  invalidMetadata: number;
  invalidPurchase: number;
  duplicateKeys: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const outsideProject = (value: string) => value === '..' || value.startsWith(`..${sep}`) || isAbsolute(value);

async function validatedRoot(configured: string): Promise<string> {
  if (!isAbsolute(configured)) throw new Error('ASSISTANT_ORIGINALS_ROOT_UNSAFE');
  const requested = resolve(configured);
  if (!outsideProject(relative(resolve(process.cwd()), requested))) throw new Error('ASSISTANT_ORIGINALS_ROOT_UNSAFE');
  const info = await lstat(requested);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o700)
    throw new Error('ASSISTANT_ORIGINALS_ROOT_UNSAFE');
  const actual = await realpath(requested);
  if (!outsideProject(relative(resolve(process.cwd()), actual))) throw new Error('ASSISTANT_ORIGINALS_ROOT_UNSAFE');
  return actual;
}

export async function verifyRestoredAssistantOriginals(
  rows: AsyncIterable<RestoredOriginal> | Iterable<RestoredOriginal>, configuredRoot: string,
): Promise<OriginalsRestoreResult> {
  const root = await validatedRoot(configuredRoot);
  const result: OriginalsRestoreResult = {
    status: 'empty', checked: 0, missing: 0, altered: 0, unsafePermissions: 0,
    invalidMetadata: 0, invalidPurchase: 0, duplicateKeys: 0,
  };
  const keys = new Set<string>();
  for await (const row of rows) {
    result.checked++;
    if (!row.purchaseValid) result.invalidPurchase++;
    if (row.status !== 'ATTACHED' || row.expiresAt !== null || !UUID.test(row.storageKey)
      || !SHA256.test(row.sha256) || !Number.isSafeInteger(row.bytes)
      || row.bytes < 1 || row.bytes > MAX_ATTACHMENT_BYTES) {
      result.invalidMetadata++;
      continue;
    }
    if (keys.has(row.storageKey)) result.duplicateKeys++;
    keys.add(row.storageKey);
    let file;
    try { file = await open(join(root, row.storageKey), constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') result.missing++;
      else result.unsafePermissions++;
      continue;
    }
    try {
      const info = await file.stat();
      if (!info.isFile() || (info.mode & 0o777) !== 0o600) {
        result.unsafePermissions++;
        continue;
      }
      if (info.size !== row.bytes) {
        result.altered++;
        continue;
      }
      const contents = await file.readFile();
      if (createHash('sha256').update(contents).digest('hex') !== row.sha256.toLowerCase()) result.altered++;
    } finally { await file.close(); }
  }
  const failures = result.missing + result.altered + result.unsafePermissions + result.invalidMetadata
    + result.invalidPurchase + result.duplicateKeys;
  result.status = failures ? 'failed' : result.checked ? 'ok' : 'empty';
  return result;
}

export function disposableRestoreUrl(input: string | undefined): string {
  if (!input) throw new Error('ASSISTANT_RESTORE_DATABASE_REQUIRED');
  const url = new URL(input);
  const name = decodeURIComponent(url.pathname.slice(1));
  if (url.protocol !== 'mysql:' || !/^[a-zA-Z0-9_]+$/.test(name)
    || !/(restore|test|tmp|scratch)/i.test(name)) throw new Error('ASSISTANT_RESTORE_DATABASE_UNSAFE');
  return input;
}

async function* restoredRows(db: PrismaClient): AsyncGenerator<RestoredOriginal> {
  let cursor: string | undefined;
  for (;;) {
    const rows = await db.assistantAttachment.findMany({
      where: { purchaseId: { not: null } }, orderBy: { id: 'asc' }, take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, tenantId: true, purchaseId: true, storageKey: true, sha256: true,
        bytes: true, status: true, expiresAt: true },
    });
    if (!rows.length) return;
    const purchases = await db.purchase.findMany({
      where: { id: { in: rows.map(row => row.purchaseId).filter((id): id is string => id !== null) } },
      select: { id: true, tenantId: true },
    });
    const tenants = new Map(purchases.map(row => [row.id, row.tenantId]));
    for (const row of rows) yield {
      storageKey: row.storageKey, sha256: row.sha256, bytes: row.bytes,
      status: row.status, expiresAt: row.expiresAt,
      purchaseValid: row.purchaseId !== null && tenants.get(row.purchaseId) === row.tenantId,
    };
    cursor = rows.at(-1)?.id;
  }
}

async function main() {
  const url = disposableRestoreUrl(process.env.RESTORE_DATABASE_URL);
  const root = process.env.NORTEX_ASSISTANT_STORAGE_DIR;
  if (!root) throw new Error('ASSISTANT_ORIGINALS_ROOT_REQUIRED');
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    const result = await verifyRestoredAssistantOriginals(restoredRows(db), root);
    console.log(JSON.stringify(result));
    if (result.status !== 'ok') process.exitCode = 2;
  } finally { await db.$disconnect(); }
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  main().catch(() => { console.error('No se pudo verificar SQL y originales restaurados.'); process.exitCode = 1; });
}
