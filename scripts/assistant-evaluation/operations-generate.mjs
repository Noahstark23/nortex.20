import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildOperationalCorpus, buildReservedModelCorpus, buildPilotTasks } from './operations-corpus.mjs';
const directory = path.resolve('tests/fixtures/assistant/operations');
await mkdir(directory, { recursive: true });
const files = {
  'deterministic.json': { version: 1, humanReview: 'pending', scope: 'Real service functions with synthetic repository boundaries; does not certify SQL, provider quality or production.', cases: buildOperationalCorpus() },
  'model-reserved.json': { version: 1, status: 'not_run', humanReview: 'pending', cases: buildReservedModelCorpus() },
  'pilot-tasks.json': { version: 1, status: 'not_run', improvementTargetPercent: 20, tasks: buildPilotTasks() },
};
for (const [name, content] of Object.entries(files)) await writeFile(path.join(directory, name), JSON.stringify(content, null, 2) + '\n');
console.log('Generados 120 escenarios de contratos, 60 consultas reservadas y 60 tareas de piloto; revisión humana pendiente.');
