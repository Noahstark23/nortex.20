// @vitest-environment node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

const source = readFileSync('.github/workflows/ci.yml', 'utf8');
const document = parseDocument(source, { uniqueKeys: true });
assert.deepEqual(document.errors, [], 'CI debe ser YAML válido y sin claves duplicadas');
const workflow = document.toJS() as Record<string, any>;

describe('CI: mínimo privilegio y toolchain fijado', () => {
    it('declara un token de solo lectura para CI', () => {
        expect(workflow.permissions).toEqual({ contents: 'read' });
    });

    it('usa exactamente el Node fijado y nunca permite que npx descargue Prisma/TypeScript', () => {
        const setupNodes = JSON.stringify(workflow).match(/actions\/setup-node@v4/g) ?? [];
        expect(setupNodes).toHaveLength(3);
        expect(source).toContain('node-version: 22.23.2');
        expect(source.match(/node-version: 22\.23\.2/g)).toHaveLength(3);
        expect(source).not.toMatch(/\bnpx prisma\b|\bnpx tsc\b/);
        expect(source.match(/npx --no-install prisma/g)?.length).toBeGreaterThanOrEqual(4);
        expect(source).toContain('npx --no-install tsc --noEmit');
    });
});
