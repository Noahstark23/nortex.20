import Decimal from 'decimal.js';
import type { MeasurementPricePolicy } from '../types';
import { esReescaneoRapido } from './cartPersistence';

export type ManagerEligibleRole = 'OWNER' | 'ADMIN' | 'MANAGER' | 'SUPER_ADMIN';

export interface ScalePreviewAcceptanceInput {
    rawCode: string;
    pricingPolicy: MeasurementPricePolicy;
    lastScan: { rawCode: string; scannedAt: number } | null;
    nowMs: number;
    duplicateWindowMs: number;
    canApproveExceptionalPrice: boolean;
    skipDuplicateCheck?: boolean;
}

export type ScalePreviewAcceptanceDecision =
    | { kind: 'append'; managerOverride: boolean }
    | { kind: 'prompt_duplicate'; requiresManagerOverride: boolean }
    | { kind: 'prompt_manager_override' }
    | { kind: 'block_manager_session' };

export const canApproveExceptionalScaleLabel = (role: string | null | undefined): role is ManagerEligibleRole =>
    role === 'OWNER'
    || role === 'ADMIN'
    || role === 'MANAGER'
    || role === 'SUPER_ADMIN';

export const decideScalePreviewAcceptance = (
    params: ScalePreviewAcceptanceInput,
): ScalePreviewAcceptanceDecision => {
    const exceptional = params.pricingPolicy === 'ACCEPT_LABEL_TOTAL';
    if (exceptional && !params.canApproveExceptionalPrice) {
        return { kind: 'block_manager_session' };
    }

    if (!params.skipDuplicateCheck && esReescaneoRapido({
        rawCode: params.rawCode,
        ultimo: params.lastScan,
        ahoraMs: params.nowMs,
        ventanaMs: params.duplicateWindowMs,
    })) {
        return {
            kind: 'prompt_duplicate',
            requiresManagerOverride: exceptional,
        };
    }

    if (exceptional) {
        return { kind: 'prompt_manager_override' };
    }

    return { kind: 'append', managerOverride: false };
};

export const acceptedScaleLabelUnitPrice = (
    encodedPrice: Decimal.Value,
    baseQuantity: Decimal.Value,
): string => new Decimal(encodedPrice)
    .dividedBy(baseQuantity)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .toString();
