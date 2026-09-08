import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const gate = readFileSync(
    resolve(process.cwd(), 'scripts/qa-integration-required.sh'),
    'utf8',
);
const qaBaseUrlMarker = ['NORTEX_QA', 'BASE_URL'].join('_');
const mysqlMarker = ['NORTEX_MYSQL', 'INTEGRATION'].join('_');

describe('compuerta de integración requerida', () => {
    it('incluye la ronda HTTP lote+bodega que no sigue el sufijo histórico', () => {
        expect(gate).toContain("'tests/batchWarehouseManualMovements.test.ts'");
    });

    it('descubre pruebas QA/MySQL por contrato, no solo por nombre de archivo', () => {
        expect(gate).toContain(`rg -l 'process\\.env\\.(${qaBaseUrlMarker}|${mysqlMarker})' tests --glob '*.test.ts' || true`);
        expect(gate).toContain(`grep -El 'process\\.env\\.(${qaBaseUrlMarker}|${mysqlMarker})' tests/*.test.ts 2>/dev/null || true`);
    });

    it('genera el cliente Prisma dentro del entorno aislado antes de arrancar el backend', () => {
        expect(gate).toContain('./node_modules/.bin/prisma generate --schema backend/prisma/schema.prisma');
        expect(gate).toContain('./node_modules/.bin/prisma db push --schema backend/prisma/schema.prisma --skip-generate');
    });
});
