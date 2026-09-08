// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('scripts/run-release-preflight.sh', 'utf8');

describe('preflight local de release', () => {
    it('incluye la integración aislada obligatoria y herramientas locales fijadas', () => {
        expect(source).toContain('set -eu');
        expect(source).toContain('npx --no-install prisma generate');
        expect(source).toContain('npx --no-install tsc --noEmit');
        expect(source).toContain('npm run test:integration:required');
        expect(source.indexOf('npm run test:integration:required')).toBeGreaterThan(source.indexOf('npm test'));
    });

    it('no presenta evidencia local como autorización de promoción', () => {
        expect(source).toContain('Aún falta la evidencia remota del SHA exacto, staging y la autorización manual antes de promover.');
        expect(source).not.toContain('Faltan los smokes CI de MySQL 8');
        expect(source).toContain('La integración usa MySQL 8 efímero local; la salud por SHA');
    });
});
