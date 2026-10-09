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
  proposalReferencesChecked: number;
  brokenProposalReferences: number;
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
    proposalReferencesChecked: 0, brokenProposalReferences: 0,
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

interface CommittedProposal {
  tenantId: string;
  userId: string;
  attachmentIds: unknown;
  result: unknown;
}
interface LinkedAttachment { tenantId: string; userId: string; purchaseId: string | null; status: string }

export function checkCommittedProposalReferences(
  proposal: CommittedProposal, attachments: ReadonlyMap<string, LinkedAttachment>,
): { checked: number; broken: number } {
  if (!Array.isArray(proposal.attachmentIds)) return { checked: 0, broken: 1 };
  const ids = proposal.attachmentIds;
  if (!ids.every((id): id is string => typeof id === 'string' && id.length > 0))
    return { checked: ids.length, broken: Math.max(ids.length, 1) };
  if (!ids.length) return { checked: 0, broken: 0 };
  const result = proposal.result;
  const purchaseId = result && typeof result === 'object' && !Array.isArray(result)
    && 'purchaseId' in result && typeof result.purchaseId === 'string' ? result.purchaseId : null;
  let broken = 0;
  const within = new Set<string>();
  for (const id of ids) {
    const row = attachments.get(id);
    if (within.has(id) || !purchaseId || !row || row.tenantId !== proposal.tenantId
      || row.userId !== proposal.userId || row.purchaseId !== purchaseId || row.status !== 'ATTACHED') broken++;
    within.add(id);
  }
  return { checked: ids.length, broken };
}

async function verifyCommittedProposalReferences(db: PrismaClient): Promise<{ checked: number; broken: number }> {
  let cursor: string | undefined, checked = 0, broken = 0;
  const seen = new Set<string>();
  for (;;) {
    const proposals = await db.assistantProposal.findMany({
      where: { status: 'COMMITTED' }, orderBy: { id: 'asc' }, take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, tenantId: true, userId: true, attachmentIds: true, result: true },
    });
    if (!proposals.length) return { checked, broken };
    const ids = proposals.flatMap(row => Array.isArray(row.attachmentIds)
      ? row.attachmentIds.filter((id): id is string => typeof id === 'string') : []);
    const rows = ids.length ? await db.assistantAttachment.findMany({
      where: { id: { in: ids } },
      select: { id: true, tenantId: true, userId: true, purchaseId: true, status: true },
    }) : [];
    const attachments = new Map(rows.map(row => [row.id, row]));
    for (const proposal of proposals) {
      const result = checkCommittedProposalReferences(proposal, attachments);
      checked += result.checked;
      broken += result.broken;
      if (Array.isArray(proposal.attachmentIds)) for (const id of proposal.attachmentIds) {
        if (typeof id !== 'string') continue;
        if (seen.has(id)) broken++;
        seen.add(id);
      }
    }
    cursor = proposals.at(-1)?.id;
  }
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
      where: { OR: [{ purchaseId: { not: null } }, { status: 'ATTACHED' }] },
      orderBy: { id: 'asc' }, take: 100,
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
    const proposals = await verifyCommittedProposalReferences(db);
    result.proposalReferencesChecked = proposals.checked;
    result.brokenProposalReferences = proposals.broken;
    if (proposals.broken) result.status = 'failed';
    console.log(JSON.stringify(result));
    if (result.status !== 'ok') process.exitCode = 2;
  } finally { await db.$disconnect(); }
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  main().catch(() => { console.error('No se pudo verificar SQL y originales restaurados.'); process.exitCode = 1; });
}
