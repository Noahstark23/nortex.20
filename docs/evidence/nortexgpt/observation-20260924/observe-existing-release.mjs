import { writeFile, rename } from 'node:fs/promises';
import { assessReleaseHealth } from './repo/scripts/verify-deployed-release.mjs';

const url = 'https://somosnortex.com/api/health';
const expectedCommit = 'dadc81975811850226a6bd7b560a3522068b995a';
const reportPath = '/private/tmp/nortexgpt-eval.8pZaOw/existing-release-observation.json';
const samples = [];
const start = Date.now();
const save = async status => {
  const report = { status, url, expectedCommit, startedAt: new Date(start).toISOString(),
    finishedAt: status === 'complete' ? new Date().toISOString() : null, samples };
  await writeFile(`${reportPath}.tmp`, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  await rename(`${reportPath}.tmp`, reportPath);
};

for (let index = 0; index < 31; index++) {
  const scheduledAt = start + index * 60_000;
  const pauseMs = scheduledAt - Date.now();
  if (pauseMs > 0) await new Promise(resolve => setTimeout(resolve, pauseMs));
  const checkedAt = new Date().toISOString();
  let sample;
  try {
    const response = await fetch(url, { cache: 'no-store', redirect: 'error',
      headers: { accept: 'application/json', 'cache-control': 'no-cache' },
      signal: AbortSignal.timeout(10_000) });
    const payload = await response.json();
    const assessment = assessReleaseHealth(payload, expectedCommit);
    const noStore = response.headers.get('cache-control')?.toLowerCase().split(',').some(v => v.trim() === 'no-store') === true;
    const previousUptime = samples.at(-1)?.uptimeSeconds;
    const uptimeSeconds = payload.uptimeSeconds;
    const uptimeValid = Number.isFinite(uptimeSeconds) && uptimeSeconds >= 0
      && (previousUptime === undefined || uptimeSeconds >= previousUptime);
    sample = { index: index + 1, checkedAt, http: response.status,
      healthy: response.ok && assessment.ready && noStore && uptimeValid,
      reason: !response.ok ? `HTTP_${response.status}` : !assessment.ready ? assessment.reason
        : !noStore ? 'CACHE_POLICY_MISSING' : !uptimeValid ? 'UPTIME_INVALID' : 'READY',
      commit: payload.commit ?? null, db: payload.db ?? null, uptimeSeconds: uptimeSeconds ?? null };
  } catch (error) {
    sample = { index: index + 1, checkedAt, healthy: false,
      reason: error instanceof Error ? error.name : 'REQUEST_FAILED' };
  }
  samples.push(sample);
  await save(sample.healthy ? 'running' : 'failed');
  console.log(`muestra=${sample.index}/31 estado=${sample.reason}`);
  if (!sample.healthy) process.exit(1);
}
await save('complete');
console.log('observacion=complete muestras=31 duracionMinutos=30');
