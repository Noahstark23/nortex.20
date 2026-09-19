import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Single local writer; a crash leaves a lock for deliberate operator inspection. */
export async function withEvaluationReport(output, resume, run) {
  await mkdir(path.dirname(output), { recursive: true });
  const lockPath = output + '.lock';
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Informe bloqueado por otro proceso o una interrupción; verificá el proceso antes de retirar su .lock.'); throw error; }
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    await lock.sync();
    let existing = null, exists = false;
    try { const bytes = await readFile(output, 'utf8'); exists = true; existing = JSON.parse(bytes); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (exists && !resume) throw new Error('El informe ya existe. Usá --resume para recuperar mediante lecturas o un archivo nuevo para un ensayo distinto.');
    if (!exists && resume) throw new Error('No existe un informe que reanudar.');
    if (exists && (!existing || typeof existing !== 'object' || Array.isArray(existing))) throw new Error('El informe existente no tiene un formato recuperable; se conserva intacto.');
    const save = async report => {
      const temporary = output + '.' + randomUUID() + '.tmp';
      const file = await open(temporary, 'wx', 0o600);
      try {
        await file.writeFile(JSON.stringify(report, null, 2) + '\n'); await file.sync(); await file.close();
        await rename(temporary, output);
        const directory = await open(path.dirname(output), 'r');
        try { await directory.sync(); } finally { await directory.close(); }
      } finally { await file.close(); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    };
    return await run(existing, save);
  } finally { await lock.close(); await unlink(lockPath); }
}
