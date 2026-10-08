import { describe, expect, it } from 'vitest';
import { buildScaleLabelRejectionTelemetry } from '../backend/lib/scaleLabelTelemetry';

describe('telemetría privada de etiquetas rechazadas', () => {
    it('persiste una huella estable sin incluir el barcode crudo', () => {
        const rawCode = '2012345125008';
        const first = buildScaleLabelRejectionTelemetry({
            rawCode,
            errorCode: 'INVALID_CHECKSUM',
            profileVersionId: 'version-1',
            recognized: true,
        });
        const second = buildScaleLabelRejectionTelemetry({
            rawCode: `\r${rawCode}\n`,
            errorCode: 'INVALID_CHECKSUM',
            profileVersionId: 'version-1',
            recognized: true,
        });

        expect(first.codeHash).toMatch(/^[a-f0-9]{64}$/);
        expect(second.codeHash).toBe(first.codeHash);
        expect(JSON.stringify(first)).not.toContain(rawCode);
        expect(first).toEqual(expect.objectContaining({
            source: 'PREVIEW',
            errorCode: 'INVALID_CHECKSUM',
            profileVersionId: 'version-1',
            recognized: true,
        }));
    });

    it('descarta una versión no acotada y no inventa una huella sin código', () => {
        expect(buildScaleLabelRejectionTelemetry({
            rawCode: null,
            errorCode: 'INVALID_PROFILE',
            profileVersionId: 'x'.repeat(192),
        })).toEqual({
            source: 'PREVIEW',
            errorCode: 'INVALID_PROFILE',
            recognized: false,
            profileVersionId: null,
            codeHash: null,
        });
    });
});
