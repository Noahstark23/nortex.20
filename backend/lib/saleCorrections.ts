import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { claveDelDiaManagua } from '../services/pulsoPos';

export const CORRECTION_APPROVAL_ROLES = ['OWNER', 'ADMIN', 'MANAGER'] as const;
export const CORRECTION_REQUEST_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER'] as const;

export type CorrectionKind = 'RETURN' | 'VOID';
export type CorrectionResolution = 'REFUND' | 'EXCHANGE' | 'STORE_CREDIT';
export type ReturnDisposition = 'RESTOCK' | 'QUARANTINE' | 'LOSS';

export type CorrectionLineInput = {
    saleItemId: string;
    quantity: string;
    disposition: ReturnDisposition;
};

export type CorrectionCommand = {
    saleId: string;
    kind: CorrectionKind;
    reason: string;
    resolution?: CorrectionResolution;
    refundMethod?: 'CASH' | 'CARD' | 'QR' | 'TRANSFER';
    lines?: CorrectionLineInput[];
};

function canonicalReason(reason: string): string {
    return reason.normalize('NFC').replace(/\s+/g, ' ').trim();
}

export function canonicalCorrectionCommand(command: CorrectionCommand) {
    return {
        saleId: command.saleId.trim(),
        kind: command.kind,
        reason: canonicalReason(command.reason),
        resolution: command.resolution ?? null,
        refundMethod: command.refundMethod ?? null,
        lines: [...(command.lines ?? [])]
        .map((line) => ({
            saleItemId: line.saleItemId.trim(),
            quantity: new Decimal(line.quantity).toFixed(4),
            disposition: line.disposition,
        }))
        .sort((left, right) => left.saleItemId.localeCompare(right.saleItemId)),
    };
}

export function correctionPayloadHash(command: CorrectionCommand): string {
    return createHash('sha256').update(JSON.stringify(canonicalCorrectionCommand(command))).digest('hex');
}

export function approvalTokenHash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

export function isSameManaguaBusinessDay(left: Date, right: Date = new Date()): boolean {
    return claveDelDiaManagua(left) === claveDelDiaManagua(right);
}

export function isReturnWithinWindow(
    saleDate: Date,
    returnWindowDays: number,
    now: Date = new Date(),
): boolean {
    if (!Number.isInteger(returnWindowDays) || returnWindowDays < 0) return false;
    const start = new Date(`${claveDelDiaManagua(saleDate)}T12:00:00.000Z`).getTime();
    const end = new Date(`${claveDelDiaManagua(now)}T12:00:00.000Z`).getTime();
    return Math.floor((end - start) / 86_400_000) <= returnWindowDays;
}

export function assertUniqueCorrectionLines(lines: readonly CorrectionLineInput[]): void {
    const seen = new Set<string>();
    for (const line of lines) {
        if (seen.has(line.saleItemId)) throw new Error('No repitás una línea de la venta');
        seen.add(line.saleItemId);
    }
}
