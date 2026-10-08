import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const [reportPath, expectedSuite] = process.argv.slice(2);

if (!reportPath || !expectedSuite) {
    console.error('Uso: node scripts/qa-verify-integration-report.mjs <reporte-json> <suite>');
    process.exit(64);
}

let report;
try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'));
} catch (error) {
    console.error(`No se pudo leer el reporte de integración ${basename(reportPath)}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
}

const counters = [
    'numTotalTests',
    'numPassedTests',
    'numFailedTests',
    'numPendingTests',
    'numTodoTests',
    'numTotalTestSuites',
    'numFailedTestSuites',
    'numPendingTestSuites',
];

if (counters.some((counter) => !Number.isInteger(report[counter]) || report[counter] < 0)) {
    console.error(`El reporte de ${expectedSuite} no contiene contadores Vitest válidos.`);
    process.exit(1);
}

const includedSuite = Array.isArray(report.testResults)
    && report.testResults.some((result) => typeof result?.name === 'string' && result.name.endsWith(expectedSuite));

const isComplete = report.success === true
    && includedSuite
    && report.numTotalTests > 0
    && report.numPassedTests === report.numTotalTests
    && report.numFailedTests === 0
    && report.numPendingTests === 0
    && report.numTodoTests === 0
    && report.numFailedTestSuites === 0
    && report.numPendingTestSuites === 0;

if (!isComplete) {
    console.error(
        `Compuerta cerrada para ${expectedSuite}: `
        + `total=${report.numTotalTests}, passed=${report.numPassedTests}, `
        + `failed=${report.numFailedTests}, skipped=${report.numPendingTests}, `
        + `todo=${report.numTodoTests}.`,
    );
    process.exit(1);
}

console.log(`✓ ${expectedSuite}: ${report.numPassedTests}/${report.numTotalTests} casos, sin omitidos.`);
