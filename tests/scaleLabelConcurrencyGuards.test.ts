import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../backend/services/scaleLabelService.ts', import.meta.url), 'utf8');

const functionBody = (name: string, nextName: string): string => {
    const start = source.indexOf(`export async function ${name}`);
    const end = source.indexOf(`export async function ${nextName}`, start + 1);
    expect(start, `${name} debe existir`).toBeGreaterThan(-1);
    expect(end, `${nextName} debe delimitar ${name}`).toBeGreaterThan(start);
    return source.slice(start, end);
};

describe('serialización de borradores de etiquetas', () => {
    it.each([
        ['updateScaleLabelDraftVersion', 'replaceScaleProductMappings'],
        ['replaceScaleProductMappings', 'deleteScaleLabelDraftVersion'],
        ['deleteScaleLabelDraftVersion', 'publishScaleLabelVersion'],
    ])('%s bloquea el tenant antes de consultar el estado DRAFT', (name, nextName) => {
        const body = functionBody(name, nextName);
        const transaction = body.indexOf('db.$transaction');
        const lock = body.indexOf('await lockTenantConfiguration(tx, tenantId)');
        const versionRead = body.indexOf('tx.scaleLabelProfileVersion.findFirst');

        expect(transaction).toBeGreaterThan(-1);
        expect(lock).toBeGreaterThan(transaction);
        expect(versionRead).toBeGreaterThan(lock);
        expect(body.match(/await lockTenantConfiguration\(tx, tenantId\)/g)).toHaveLength(1);
    });
});
