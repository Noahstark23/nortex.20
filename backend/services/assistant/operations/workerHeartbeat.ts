import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath, rename, stat, unlink } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const FILE = 'worker-heartbeat.json';
const STALE_MS = 90_000;
type WorkerState = 'disabled' | 'idle' | 'working' | 'error';
const outsideProject = (path: string) => path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path);

/** Mantiene el latido durante una tarea larga, sin solapar escrituras. */
export async function withAssistantWorkerHeartbeat<T>(
  work: () => Promise<T>, beat: () => Promise<unknown>,
  options: { intervalMs?: number; onError?: () => void } = {},
): Promise<T> {
  let pending: Promise<unknown> = Promise.resolve();
  const timer = setInterval(() => {
    pending = pending.catch(() => undefined).then(beat).catch(() => { options.onError?.(); });
  }, options.intervalMs ?? 30_000);
  try { return await work(); }
  finally { clearInterval(timer); await pending; }
}

async function privateRoot(configured = process.env.NORTEX_ASSISTANT_STORAGE_DIR, create = false): Promise<string | null> {
  if (!configured || !isAbsolute(configured)) return null;
  const root = resolve(configured);
  const within = relative(resolve(process.cwd()), root);
  if (!outsideProject(within)) return null;
  if (create) await mkdir(root, { recursive: true, mode: 0o700 });
  const actual = await realpath(root);
  const actualWithin = relative(resolve(process.cwd()), actual);
  if (!outsideProject(actualWithin)) return null;
  if (((await stat(actual)).mode & 0o077) !== 0) return null;
  return actual;
}

export async function recordAssistantWorkerHeartbeat(state: WorkerState, options: { root?: string; now?: Date; sha?: string } = {}): Promise<boolean> {
  const root = await privateRoot(options.root, true);
  if (!root) return false;
  const temp = join(root, `${FILE}.${randomUUID()}.tmp`);
  const body = JSON.stringify({ state, updatedAt: (options.now ?? new Date()).toISOString(), sha: options.sha ?? process.env.SOURCE_COMMIT ?? null });
  try {
    const file = await open(temp, 'wx', 0o600);
    try { await file.writeFile(body); await file.sync(); }
    finally { await file.close(); }
    await rename(temp, join(root, FILE));
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
  return true;
}

export async function readAssistantWorkerHeartbeat(options: { root?: string; now?: Date; expectedSha?: string } = {}) {
  try {
    const root = await privateRoot(options.root);
    if (!root) return { status: 'unavailable' as const, updatedAt: null, ageSeconds: null };
    const raw = JSON.parse(await readFile(join(root, FILE), 'utf8')) as Record<string, unknown>;
    const time = typeof raw.updatedAt === 'string' ? new Date(raw.updatedAt) : new Date(NaN);
    const ageMs = (options.now ?? new Date()).getTime() - time.getTime();
    if (!Number.isFinite(ageMs) || ageMs < 0) return { status: 'unavailable' as const, updatedAt: null, ageSeconds: null };
    const updatedAt = time.toISOString(), ageSeconds = Math.floor(ageMs / 1000);
    const expectedSha = options.expectedSha ?? process.env.SOURCE_COMMIT;
    if (!expectedSha || !/^[0-9a-f]{40}$/i.test(expectedSha) || raw.sha !== expectedSha)
      return { status: 'version_mismatch' as const, updatedAt, ageSeconds };
    if (ageMs > STALE_MS) return { status: 'stale' as const, updatedAt, ageSeconds };
    if (raw.state === 'error') return { status: 'error' as const, updatedAt, ageSeconds };
    if (raw.state === 'disabled') return { status: 'disabled' as const, updatedAt, ageSeconds };
    if (raw.state !== 'idle' && raw.state !== 'working') return { status: 'unavailable' as const, updatedAt: null, ageSeconds: null };
    return { status: 'ok' as const, updatedAt, ageSeconds };
  } catch {
    return { status: 'unavailable' as const, updatedAt: null, ageSeconds: null };
  }
}
