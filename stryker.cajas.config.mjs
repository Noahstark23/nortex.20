// Ronda dirigida: no sustituye ni modifica el alcance/umbral global.
export default {
    packageManager: 'npm',
    plugins: ['@stryker-mutator/vitest-runner'],
    testRunner: 'vitest',
    vitest: { configFile: 'vitest.cajas-mutation.config.ts' },
    mutate: ['utils/legacySaleMode.ts', 'utils/posActivation.ts'],
    ignorePatterns: ['reports/**', 'dist/**', '.git/**', '.env*'],
    reporters: ['clear-text', 'json'],
    jsonReporter: { fileName: 'reports/cajas-mutation.json' },
    coverageAnalysis: 'perTest',
    concurrency: 2,
    timeoutMS: 15000,
    thresholds: { high: 100, low: 100, break: 100 },
};
