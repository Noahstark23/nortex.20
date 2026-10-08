import { runPhase0SoftwareSimulation } from './simulation';

function passMark(passed: boolean): string {
  return passed ? 'PASS' : 'FAIL';
}

const report = await runPhase0SoftwareSimulation();

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  const lines = [
    'NORTEX FASE 0 — SIMULACION SOFTWARE',
    'NO ES EVIDENCIA FISICA Y NO AUTORIZA UN GO DE DISPOSITIVO',
    '',
    'Lifecycle de captura:',
    ...report.captureLifecycle.map((entry) =>
      `- ${entry.scenario}: ${passMark(entry.passed)} (${entry.actualCloseReason})`,
    ),
    '',
    'Matriz de decisiones:',
    ...report.decisionMatrix.map((entry) =>
      `- ${entry.scenario}: ${passMark(entry.passed)} (${entry.actualDecision})`,
    ),
    '',
    `RESULTADO SOFTWARE: ${passMark(report.summary.allPassed)}`,
    'PENDIENTE: camara, optica, permisos y lifecycle en dispositivo real.',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

if (!report.summary.allPassed) process.exitCode = 1;
