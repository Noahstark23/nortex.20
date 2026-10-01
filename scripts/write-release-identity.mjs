import { createHash } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Siempre reemplazar metadatos copiados: la identidad se produce dentro del build.
const marker = join(process.cwd(), '.nortex-release.json');
rmSync(marker, { force: true });
const commit = process.env.NORTEX_BUILD_COMMIT;
if (commit !== undefined && commit !== '') {
  if (!/^[a-f0-9]{40}$/.test(commit)) {
    throw new Error('NORTEX_BUILD_COMMIT debe ser un SHA Git completo de 40 caracteres');
  }
  const serverSha256 = createHash('sha256')
    .update(readFileSync(join(process.cwd(), 'backend/server.ts')))
    .digest('hex');
  writeFileSync(marker, JSON.stringify({ version: 1, commit, serverSha256 }) + '\n');
}
