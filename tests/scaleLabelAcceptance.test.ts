import { describe, expect, it } from 'vitest';
import {
    acceptedScaleLabelUnitPrice,
    canApproveExceptionalScaleLabel,
    decideScalePreviewAcceptance,
} from '../utils/scaleLabelAcceptance';

describe('scaleLabelAcceptance', () => {
    it('bloquea ACCEPT_LABEL_TOTAL cuando el operador no tiene rol de gerencia', () => {
        expect(decideScalePreviewAcceptance({
            rawCode: '2012345125008',
            pricingPolicy: 'ACCEPT_LABEL_TOTAL',
            lastScan: null,
            nowMs: 1_000,
            duplicateWindowMs: 4_000,
            canApproveExceptionalPrice: false,
        })).toEqual({ kind: 'block_manager_session' });
    });

    it('pide confirmación de gerencia antes de agregar una etiqueta excepcional', () => {
        expect(decideScalePreviewAcceptance({
            rawCode: '2012345125008',
            pricingPolicy: 'ACCEPT_LABEL_TOTAL',
            lastScan: null,
            nowMs: 1_000,
            duplicateWindowMs: 4_000,
            canApproveExceptionalPrice: true,
        })).toEqual({ kind: 'prompt_manager_override' });
    });

    it('mantiene la confirmación por reescaneo rápido y luego pide la autorización excepcional', () => {
        expect(decideScalePreviewAcceptance({
            rawCode: '2012345125008',
            pricingPolicy: 'ACCEPT_LABEL_TOTAL',
            lastScan: { rawCode: '2012345125008', scannedAt: 900 },
            nowMs: 1_000,
            duplicateWindowMs: 4_000,
            canApproveExceptionalPrice: true,
        })).toEqual({ kind: 'prompt_duplicate', requiresManagerOverride: true });

        expect(decideScalePreviewAcceptance({
            rawCode: '2012345125008',
            pricingPolicy: 'ACCEPT_LABEL_TOTAL',
            lastScan: { rawCode: '2012345125008', scannedAt: 900 },
            nowMs: 1_000,
            duplicateWindowMs: 4_000,
            canApproveExceptionalPrice: true,
            skipDuplicateCheck: true,
        })).toEqual({ kind: 'prompt_manager_override' });
    });

    it('agrega etiquetas normales sin override y calcula el precio unitario auditado', () => {
        expect(decideScalePreviewAcceptance({
            rawCode: '2012345125008',
            pricingPolicy: 'RECALCULATE',
            lastScan: null,
            nowMs: 1_000,
            duplicateWindowMs: 4_000,
            canApproveExceptionalPrice: false,
        })).toEqual({ kind: 'append', managerOverride: false });

        expect(acceptedScaleLabelUnitPrice('60.00', '1.25')).toBe('48');
    });

    it('reconoce los roles que sí pueden aprobar un total impreso', () => {
        expect(canApproveExceptionalScaleLabel('OWNER')).toBe(true);
        expect(canApproveExceptionalScaleLabel('MANAGER')).toBe(true);
        expect(canApproveExceptionalScaleLabel('ADMIN')).toBe(true);
        expect(canApproveExceptionalScaleLabel('SUPER_ADMIN')).toBe(true);
        expect(canApproveExceptionalScaleLabel('CASHIER')).toBe(false);
    });
});
