import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const runner = resolve(process.cwd(), 'scripts/run-quality-integration.mjs');

describe('un rechazo temprano invalida el resumen de integración anterior', () => {
    it.each([
        { name: 'URL inválida con confirmación', database: 'not-a-database-url', acknowledgement: 'disposable-database', expectedError: 'Falta una URL MySQL de QA válida.' },
        { name: 'sin confirmación de base descartable', database: 'mysql://qa:qa@127.0.0.1:3319/nortex_quality', acknowledgement: undefined, expectedError: 'Requiere una base descartable explícita.' },
    ])('$name', ({ database, acknowledgement, expectedError }) => {
        const directory = mkdtempSync(join(tmpdir(), 'nortex-quality-validation-'));
        try {
            const output = join(directory, 'reports', 'quality-integration');
            mkdirSync(output, { recursive: true });
            const summaryPath = join(output, 'summary.json');
            writeFileSync(summaryPath, JSON.stringify({ passed: true, suites: [{ suite: 'previous', passed: 113 }], total: 113 }));

            // El script real se ejecuta fuera del checkout. Solo recibe estas
            // variables; ambas configuraciones deben fallar ANTES del backend.
            const result = spawnSync(process.execPath, [runner], {
                cwd: directory,
                env: {
                    PATH: process.env.PATH,
                    NODE_ENV: 'test',
                    DATABASE_URL: database,
                    ...(acknowledgement ? { NORTEX_QA_DATABASE_ACK: acknowledgement } : {}),
                },
                encoding: 'utf8',
                timeout: 5_000,
            });
            expect(result.error).toBeUndefined();
            expect(result.status).not.toBeNull();
            expect(result.status).not.toBe(0);
            expect(result.stderr).toContain(expectedError);
            expect(result.stdout).not.toContain('casos ejecutados');
            expect(JSON.parse(readFileSync(summaryPath, 'utf8'))).toEqual({ passed: false, suites: [], total: 0 });
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });
});
