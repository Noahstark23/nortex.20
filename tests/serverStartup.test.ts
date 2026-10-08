import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const waitForExit = (child: ChildProcessWithoutNullStreams): Promise<void> => new Promise((done) => {
    if (child.exitCode !== null || child.signalCode !== null) return done();
    child.once('exit', () => done());
});

describe('arranque real del servidor', () => {
    it('registra todas las rutas sin errores TDZ de politicas', async () => {
        const tsxCli = resolve(process.cwd(), 'node_modules/tsx/dist/cli.mjs');
        const server = resolve(process.cwd(), 'backend/server.ts');
        const child = spawn(process.execPath, [tsxCli, server], {
            cwd: process.cwd(),
            env: {
                ...process.env,
                NODE_ENV: 'test',
                PORT: '0',
                JWT_SECRET: 'nortex-runtime-smoke-test-secret',
                // El smoke solo importa/registra rutas. Un puerto cerrado hace
                // que los cron de arranque fallen rapido sin tocar una BD real.
                DATABASE_URL: 'mysql://nortex:nortex@127.0.0.1:1/nortex?connect_timeout=1',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let output = '';
        let ready = false;
        try {
            await new Promise<void>((done, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error(`El servidor no completo el arranque:\n${output}`));
                }, 15_000);

                const inspect = (chunk: Buffer) => {
                    output += chunk.toString();
                    if (/ReferenceError: Cannot access .* before initialization/.test(output)) {
                        clearTimeout(timeout);
                        reject(new Error(`TDZ durante el arranque:\n${output}`));
                        return;
                    }
                    if (output.includes('Nortex Banking Core Ready')) {
                        ready = true;
                        clearTimeout(timeout);
                        done();
                    }
                };

                child.stdout.on('data', inspect);
                child.stderr.on('data', inspect);
                child.once('error', (error) => {
                    clearTimeout(timeout);
                    reject(error);
                });
                child.once('exit', (code, signal) => {
                    if (ready) return;
                    clearTimeout(timeout);
                    reject(new Error(`Servidor termino antes de escuchar (code=${code}, signal=${signal}):\n${output}`));
                });
            });
        } finally {
            if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
            await waitForExit(child);
        }

        expect(ready).toBe(true);
        expect(output).not.toMatch(/ReferenceError: Cannot access .* before initialization/);
    }, 20_000);
});
