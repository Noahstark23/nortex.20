import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const applicationRoot = fileURLToPath(new URL('../../', import.meta.url));

/** El marker del build prevalece; uno inválido nunca recurre al entorno. */
export function resolveReleaseCommit(options: { rootDir: string; sourceCommit?: string }): string | null {
  let raw: string;
  try {
    raw = readFileSync(resolve(options.rootDir, '.nortex-release.json'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return options.sourceCommit ?? null;
    }
    return null;
  }
  try {
    const marker = JSON.parse(raw);
    if (marker?.version !== 1 || typeof marker.commit !== 'string' || !SHA.test(marker.commit)
      || typeof marker.serverSha256 !== 'string' || !SHA256.test(marker.serverSha256)) return null;
    const actualHash = createHash('sha256')
      .update(readFileSync(resolve(options.rootDir, 'backend/server.ts'))).digest('hex');
    return actualHash === marker.serverSha256 ? marker.commit : null;
  } catch {
    return null;
  }
}

// La imagen es inmutable durante el proceso. Se calcula una vez, fuera de cada request.
export function createReleaseCommitResolver(options: { rootDir: string; sourceCommit?: string }): () => string | null {
  let resolved = false;
  let releaseCommit: string | null = null;
  return () => {
    if (!resolved) {
      releaseCommit = resolveReleaseCommit(options);
      resolved = true;
    }
    return releaseCommit;
  };
}

export const getReleaseCommit = createReleaseCommitResolver({
  rootDir: applicationRoot, sourceCommit: process.env.SOURCE_COMMIT,
});
