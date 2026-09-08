// Sesión visual local separada del smoke. Sin credenciales heredadas o persistidas.
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createServer as createProxy, request as forwardRequest } from 'node:http';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../../', import.meta.url));
const random = () => randomBytes(24).toString('hex');
const minimal = { PATH: process.env.PATH, HOME: process.env.HOME };
const name = 'nortex-visual-box-' + randomBytes(6).toString('hex');
let owned = false;
let backend;
let proxy;
let stopping = false;
function command(bin, args, env = {}) {
    const result = spawnSync(bin, args, { cwd, env: { ...minimal, ...env }, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`Falló ${bin}; salida ${result.status}`);
    return result.stdout.trim();
}
async function stop() {
    if (stopping) return;
    stopping = true;
    proxy?.close();
    if (backend && backend.exitCode === null) {
        backend.kill('SIGTERM');
        await Promise.race([new Promise(resolve => backend.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 3000))]);
        if (backend.exitCode === null) backend.kill('SIGKILL');
    }
    if (owned) command('docker', ['rm', '-f', name]);
    console.log('Sesión visual detenida; base sintética eliminada.');
}
process.on('SIGINT', () => void stop().finally(() => process.exit(0)));
process.on('SIGTERM', () => void stop().finally(() => process.exit(0)));
try {
    const context = JSON.parse(command('docker', ['context', 'inspect']));
    if (!context[0]?.Endpoints?.docker?.Host?.startsWith('unix://')) throw new Error('Docker debe ser local');
    command('docker', ['image', 'inspect', 'mysql:8.0']);
    const password = random();
    command('docker', ['run', '-d', '--name', name, '--label', 'nortex.qa=visual-box', '--tmpfs', '/var/lib/mysql',
        '-p', '127.0.0.1::3306', '-e', `MYSQL_ROOT_PASSWORD=${password}`, '-e', 'MYSQL_DATABASE=nortex_qa_visual', 'mysql:8.0']);
    owned = true;
    const dbPort = command('docker', ['port', name, '3306/tcp']).split(':').at(-1);
    let ready = false;
    for (let n = 0; n < 90; n++) {
        const r = spawnSync('docker', ['exec', '-e', `MYSQL_PWD=${password}`, name,
            'mysql', '-h127.0.0.1', '-uroot', 'nortex_qa_visual', '-e', 'SELECT 1'], { env: minimal, stdio: 'ignore' });
        if (r.status === 0) { ready = true; break; }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (!ready) throw new Error('MySQL local no inició');
    const databaseUrl = `mysql://root:${password}@127.0.0.1:${dbPort}/nortex_qa_visual`;
    command(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--schema=backend/prisma/schema.prisma', '--skip-generate'], { DATABASE_URL: databaseUrl });
    const socket = createServer();
    await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
    const port = socket.address().port;
    await new Promise(resolve => socket.close(resolve));
    const url = `http://127.0.0.1:${port}`;
    const env = { ...minimal, DATABASE_URL: databaseUrl, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port),
        FRONTEND_URL: url, SOURCE_COMMIT: 'cajas-visual-local-v2', JWT_SECRET: random(),
        NORTEX_DATA_KEYS: 'qa:' + randomBytes(32).toString('base64'), NORTEX_LEDGER_KEYS: 'qa:' + randomBytes(32).toString('base64'),
        NORTEX_INDEX_KEY: randomBytes(32).toString('base64'), WHATSAPP_ENABLED: 'false', WHATSAPP_LLM: 'disabled',
        RESEND_API_KEY: '', ANTHROPIC_API_KEY: '', STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '', SENTRY_DSN: '' };
    backend = spawn(process.execPath, ['--import', 'tsx', 'backend/server.ts'], { cwd, env, stdio: 'ignore' });
    ready = false;
    for (let n = 0; n < 60; n++) {
        if (backend.exitCode !== null) throw new Error('El backend local terminó');
        try {
            const response = await fetch(url + '/api/health');
            const health = await response.json();
            if (response.ok && health.ok && health.db === 'up') { ready = true; break; }
        } catch { /* espera acotada */ }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (!ready) throw new Error('No hubo salud local');
    // Interceptar únicamente telemetría del frontend local. No tocar el bundle
    // ni la política de CORS del producto; el proxy es exclusivo de esta sesión.
    proxy = createProxy((request, response) => {
        if (request.url?.split('?')[0] === '/analytics.js') {
            response.writeHead(200, { 'content-type': 'application/javascript' });
            response.end('// Telemetría desactivada en QA local');
            return;
        }
        const upstream = forwardRequest(url + request.url, {
            method: request.method, headers: { ...request.headers, origin: url },
        }, remote => {
            response.writeHead(remote.statusCode ?? 502, remote.headers);
            remote.pipe(response);
        });
        upstream.on('error', () => { response.writeHead(502); response.end('Backend local no disponible'); });
        request.pipe(upstream);
    });
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
    console.log(`PREVIEW_URL=http://127.0.0.1:${proxy.address().port}`);
    console.log('Usá solo cuentas sintéticas; Ctrl-C elimina exclusivamente esta base.');
    await new Promise(resolve => backend.once('exit', resolve));
    await stop();
} catch (error) {
    console.error(error.message);
    await stop();
    process.exitCode = 1;
}
