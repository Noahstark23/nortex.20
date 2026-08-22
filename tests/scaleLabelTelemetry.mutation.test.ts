import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildScaleLabelRejectionTelemetry } from '../backend/lib/scaleLabelTelemetry';

describe('buildScaleLabelRejectionTelemetry — frontera privada exhaustiva', () => {
    it('normaliza antes de hashear y expone únicamente campos permitidos', () => {
        const telemetry = buildScaleLabelRejectionTelemetry({
            rawCode: ' \r\n2012345125008\n ',
            errorCode: 'INVALID_CHECKSUM',
            profileVersionId: '  version-1  ',
            recognized: true,
        });
        const expectedHash = createHash('sha256').update('2012345125008').digest('hex');

        expect(telemetry).toEqual({
            source: 'PREVIEW',
            errorCode: 'INVALID_CHECKSUM',
            recognized: true,
            profileVersionId: 'version-1',
            codeHash: expectedHash,
        });
        expect(Object.keys(telemetry).sort()).toEqual([
            'codeHash',
            'errorCode',
            'profileVersionId',
            'recognized',
            'source',
        ]);
    });

    it.each([null, undefined, 123, {}, '', '   '])(
        'no genera hash para rawCode ausente/no string/vacío: %o',
        (rawCode) => {
            const telemetry = buildScaleLabelRejectionTelemetry({
                rawCode,
                errorCode: 'INVALID_INPUT',
            });
            expect(telemetry.codeHash).toBeNull();
            expect(telemetry.recognized).toBe(false);
        },
    );

    it('recognized solo admite el booleano true literal', () => {
        for (const recognized of [false, undefined, 1, 'true', null] as unknown[]) {
            expect(buildScaleLabelRejectionTelemetry({
                rawCode: '1',
                errorCode: 'E',
                recognized: recognized as boolean,
            }).recognized).toBe(false);
        }
        expect(buildScaleLabelRejectionTelemetry({
            rawCode: '1',
            errorCode: 'E',
            recognized: true,
        }).recognized).toBe(true);
    });

    it.each([
        [undefined, null],
        [null, null],
        [7, null],
        ['', null],
        ['   ', null],
        [' x ', 'x'],
        ['x'.repeat(191), 'x'.repeat(191)],
        [` ${'x'.repeat(191)} `, 'x'.repeat(191)],
        ['x'.repeat(192), null],
    ] as const)('acota y normaliza profileVersionId %o', (profileVersionId, expected) => {
        expect(buildScaleLabelRejectionTelemetry({
            rawCode: '1',
            errorCode: 'E',
            profileVersionId,
        }).profileVersionId).toBe(expected);
    });

    it('conserva el código de error exacto sin derivarlo del barcode', () => {
        expect(buildScaleLabelRejectionTelemetry({
            rawCode: 'abc',
            errorCode: '',
        }).errorCode).toBe('');
        expect(buildScaleLabelRejectionTelemetry({
            rawCode: 'abc',
            errorCode: 'VALUE_OUT_OF_RANGE',
        }).errorCode).toBe('VALUE_OUT_OF_RANGE');
    });
});
