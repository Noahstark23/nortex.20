import { createHash } from 'node:crypto';

export interface ScaleLabelRejectionTelemetryInput {
    rawCode: unknown;
    errorCode: string;
    profileVersionId?: unknown;
    recognized?: boolean;
}

/**
 * Construye telemetría apta para persistencia. El barcode jamás forma parte
 * del objeto: solo una huella SHA-256 permite correlacionar recurrencias.
 */
export const buildScaleLabelRejectionTelemetry = (
    input: ScaleLabelRejectionTelemetryInput,
) => {
    const rawCode = typeof input.rawCode === 'string' ? input.rawCode.trim() : '';
    const profileVersionId = typeof input.profileVersionId === 'string'
        && input.profileVersionId.trim().length > 0
        && input.profileVersionId.trim().length <= 191
        ? input.profileVersionId.trim()
        : null;

    return {
        source: 'PREVIEW' as const,
        errorCode: input.errorCode,
        recognized: input.recognized === true,
        profileVersionId,
        codeHash: rawCode
            ? createHash('sha256').update(rawCode).digest('hex')
            : null,
    };
};
