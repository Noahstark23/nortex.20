// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const guardPath = '.claude/hooks/guard-bash.sh';

function runGuard(command: string) {
    return spawnSync('sh', [guardPath], {
        encoding: 'utf8',
        input: JSON.stringify({ tool_input: { command } }),
    });
}

function runRawGuard(input: string) {
    return spawnSync('sh', [guardPath], {
        encoding: 'utf8',
        input,
    });
}

describe('guard Bash de Claude', () => {
    it('mantiene sintaxis POSIX y permite inspecciones simples, incluso patrones entre comillas', () => {
        const syntax = spawnSync('sh', ['-n', guardPath], { encoding: 'utf8' });
        expect(syntax.status, syntax.stderr).toBe(0);

        expect(runGuard("rg -n 'a > b' docs").status).toBe(0);
        expect(runGuard('git diff -- AGENTS.md').status).toBe(0);
    });

    it('rechaza mutaciones de checkout y escrituras disfrazadas de lectura', () => {
        const blockedCommands = [
            'cat AGENTS.md > /tmp/nortex-guard-bypass',
            'cat <<EOF\ntexto\nEOF\ngit reset --hard',
            'cat <<EOF\ntexto\nEOF\n> /tmp/nortex-guard-heredoc-bypass',
            'cat AGENTS.md\ngit reset --hard',
            ' git reset --hard',
            'true; git reset --hard',
            'true > /tmp/nortex-guard-redirection-bypass',
            'find . -delete',
            'git clean -fd',
            'git reset --hard',
            'git -C /tmp reset --hard',
            'git --git-dir /tmp clean -fd',
            '/usr/bin/git --work-tree /tmp checkout main',
            'Git reset --hard',
            'git -c alias.nuke=reset nuke --hard',
            'git --config-env=alias.nuke=RESET nuke --hard',
            'git config alias.nuke reset',
            'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.nuke GIT_CONFIG_VALUE_0=reset git nuke --hard',
            "sh -c 'git -C /tmp switch main'",
            'git checkout main',
            'git switch main',
            'git restore README.md',
        ];

        for (const command of blockedCommands) {
            const result = runGuard(command);
            expect(result.status, `${command}: ${result.stderr}`).toBe(2);
            expect(result.stderr).toContain('BLOQUEADO');
        }
    });

    it('falla cerrado si el sobre JSON no se puede interpretar', () => {
        const result = runRawGuard('{not-json');
        expect(result.status, result.stderr).toBe(2);
        expect(result.stderr).toContain('BLOQUEADO');
    });
});
