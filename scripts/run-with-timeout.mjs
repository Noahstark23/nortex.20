#!/usr/bin/env node
import { spawn } from 'node:child_process';

const [secondsArg, command, ...args] = process.argv.slice(2);
const seconds = Number(secondsArg);

if (!Number.isInteger(seconds) || seconds < 5 || seconds > 1800 || !command) {
    console.error('Uso: run-with-timeout.mjs <5..1800 segundos> <comando> [args...]');
    process.exit(64);
}

const detached = process.platform !== 'win32';
const child = spawn(command, args, { stdio: 'inherit', detached });
let timedOut = false;
let killTimer;

function signalChild(signal) {
    if (!child.pid) return;
    try {
        if (detached) process.kill(-child.pid, signal);
        else child.kill(signal);
    } catch (error) {
        if (error?.code !== 'ESRCH') throw error;
    }
}

const timeout = setTimeout(() => {
    timedOut = true;
    console.error(`❌ Comando de schema excedió ${seconds}s; terminando el grupo de procesos.`);
    signalChild('SIGTERM');
    killTimer = setTimeout(() => signalChild('SIGKILL'), 5000);
}, seconds * 1000);

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => signalChild(signal));
}

const exitCode = await new Promise(resolve => {
    child.once('error', error => {
        console.error(`No se pudo iniciar ${command}:`, error.message);
        resolve(1);
    });
    child.once('exit', code => resolve(timedOut ? 124 : (code ?? 1)));
});

clearTimeout(timeout);
if (killTimer) clearTimeout(killTimer);
process.exit(exitCode);
