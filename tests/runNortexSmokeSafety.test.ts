// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const scriptPath = '.claude/skills/run-nortex/smoke.sh';
const skillPath = '.claude/skills/run-nortex/SKILL.md';
const script = readFileSync(scriptPath, 'utf8');
const skill = readFileSync(skillPath, 'utf8');

describe('run-nortex smoke aislado', () => {
    it('es sintácticamente válido y rechaza el modo histórico que dejaba recursos activos', () => {
        const syntax = spawnSync('bash', ['-n', scriptPath], { encoding: 'utf8' });
        expect(syntax.status, syntax.stderr).toBe(0);

        const legacyKeep = spawnSync('bash', [scriptPath, '--keep'], { encoding: 'utf8' });
        expect(legacyKeep.status).toBe(64);
        expect(legacyKeep.stdout).toBe('');
        expect(legacyKeep.stderr).toContain('--keep fue retirado');
    });

    it('no puede volver a usar MySQL del sistema, valores compartidos ni matar por nombre', () => {
        expect(script).not.toMatch(/\bapt-get\b|\bbrew install\b|\bservice mysql\b|\bmysqladmin status\b/);
        expect(script).not.toMatch(/\bpkill\b|\bkillall\b|nortex123|localhost:3306/);
        expect(script).not.toContain('PORT="${PORT:-');
        expect(script).not.toContain('DATABASE_URL="${DATABASE_URL');
        expect(script).not.toContain('npm install');
        expect(script).not.toContain('docker pull');
        expect(script).toContain('env -u DOCKER_HOST -u DOCKER_CONTEXT docker');
        expect(script).toContain('unix:///*');
        expect(script).toContain('--pull never');
        expect(script).toContain('--tmpfs /var/lib/mysql');
        expect(script).toContain('-p 127.0.0.1::3306');
        expect(script).toContain('env -i PATH="$PATH"');
        expect(script).toContain('WHATSAPP_ENABLED=\'false\'');
        expect(script).toContain('WHATSAPP_LLM=\'disabled\'');
        expect(script).toContain('RESEND_API_KEY=\'\'');
        expect(script).toContain('ANTHROPIC_API_KEY=\'\'');
        expect(script).toContain('SENTRY_DSN=\'\'');
    });

    it('documenta el límite de datos sintéticos y la limpieza de recursos propios', () => {
        expect(skill).toContain('datos sintéticos');
        expect(skill).toContain('socket Unix local');
        expect(skill).toMatch(/no\s+deja servidor, base, token, capturas ni logs activos/);
        expect(skill).toContain('No sustituye `npm run test:integration:required`');
        expect(script).toContain('com.nortex.smoke.run');
        expect(script).toContain('smoke_stop_owned_server');
        expect(script).toContain('/tmp/nortex-run-smoke.*');
    });
});
