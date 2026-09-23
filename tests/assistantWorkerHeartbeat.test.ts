import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readAssistantWorkerHeartbeat, recordAssistantWorkerHeartbeat, withAssistantWorkerHeartbeat } from '../backend/services/assistant/operations/workerHeartbeat';

const roots: string[] = [];
const sha = 'a'.repeat(40);
async function root() { const path = await mkdtemp(join(tmpdir(), 'nortex-worker-heartbeat-')); roots.push(path); return path; }
afterEach(async () => { for (const path of roots.splice(0)) await rm(path, { recursive:true, force:true }); });

describe('latido privado del worker', () => {
  it('identifica versión, frescura y permisos sin revelar contenido', async () => {
    const path=await root(),now=new Date('2026-09-23T14:00:00Z');
    expect(await recordAssistantWorkerHeartbeat('idle',{root:path,now,sha})).toBe(true);
    expect((await stat(join(path,'worker-heartbeat.json'))).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(join(path,'worker-heartbeat.json'),'utf8'))).toMatchObject({state:'idle',sha});
    expect(await readAssistantWorkerHeartbeat({root:path,now,expectedSha:sha})).toMatchObject({status:'ok',ageSeconds:0});
    expect(await readAssistantWorkerHeartbeat({root:path,now:new Date(now.getTime()+91_000),expectedSha:sha})).toMatchObject({status:'stale'});
    expect(await readAssistantWorkerHeartbeat({root:path,now,expectedSha:'b'.repeat(40)})).toMatchObject({status:'version_mismatch'});
  });
  it('distingue worker apagado y error sin crear rutas durante la lectura', async () => {
    const path=await root(),missing=join(path,'missing'),now=new Date('2026-09-23T14:00:00Z');
    expect((await readAssistantWorkerHeartbeat({root:missing,now,expectedSha:sha})).status).toBe('unavailable');
    await expect(stat(missing)).rejects.toMatchObject({code:'ENOENT'});
    await recordAssistantWorkerHeartbeat('disabled',{root:path,now,sha});
    expect((await readAssistantWorkerHeartbeat({root:path,now,expectedSha:sha})).status).toBe('disabled');
    await recordAssistantWorkerHeartbeat('error',{root:path,now,sha});
    expect((await readAssistantWorkerHeartbeat({root:path,now,expectedSha:sha})).status).toBe('error');
  });
  it('rechaza una ruta del proyecto aunque su nombre comience con dos puntos', async () => {
    const path=resolve(process.cwd(),'..latido-privado');
    expect(await recordAssistantWorkerHeartbeat('idle',{root:path,sha})).toBe(false);
    await expect(stat(path)).rejects.toMatchObject({code:'ENOENT'});
  });
  it('mantiene un latido durante una tarea larga y lo detiene al terminar', async () => {
    vi.useFakeTimers();
    try {
      let finish!: (value: number) => void;
      const beats: number[] = [];
      const task = withAssistantWorkerHeartbeat(
        () => new Promise<number>(resolve => { finish = resolve; }),
        async () => { beats.push(Date.now()); },
      );
      await vi.advanceTimersByTimeAsync(120_000);
      expect(beats).toHaveLength(4);
      finish(7);
      await expect(task).resolves.toBe(7);
      await vi.advanceTimersByTimeAsync(90_000);
      expect(beats).toHaveLength(4);
    } finally { vi.useRealTimers(); }
  });
});
