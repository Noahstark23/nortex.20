import Decimal from 'decimal.js';
import type { OfflineSale } from '../../lib/db';
import { OfflineSyncTransportError, toOfflineSyncTransport } from '../../utils/offlineSyncTransport';

export interface OfflineRecoveryRow {
    offlineId: string;
    createdAt: string | null;
    total: string | null;
    paymentMethod: string;
    status: 'pending' | 'failed' | 'review';
    code: string | null;
    reason: string;
    lastSyncAt: string | null;
    lineCount: number;
    canRetry: boolean;
}

export type OfflineServerEvidence = {
    offlineId: string; checkedAt: string; status: 'not_found' | 'ambiguous';
} | {
    offlineId: string; checkedAt: string; status: 'recorded';
    record: { saleId: string; createdAt: string; total: string; paymentMethod: string;
        status: string; invoiceNumber: number | null; invoiceSeries: string | null; hasReplayFingerprint: boolean };
};

export interface OfflineRecoveryController {
    /** Identidad opaca sin token; cambia también al renovar la sesión. */
    sessionKey: string;
    status: 'ready' | 'unavailable';
    rows: readonly OfflineRecoveryRow[] | null;
    retry: (offlineId: string) => Promise<void>;
    inspect: (offlineId: string) => Promise<OfflineServerEvidence>;
    exportEvidence: (offlineId: string) => Promise<{ filename: string; content: string }>;
}

const validDate = (value: unknown): value is string => typeof value === 'string'
    && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
export function describeOfflineSale(sale: OfflineSale): OfflineRecoveryRow {
    let code = typeof sale.syncCode === 'string' ? sale.syncCode.slice(0, 128) : null;
    let reason = typeof sale.syncError === 'string' && sale.syncError ? sale.syncError : (sale.syncState === 'RECONCILIATION_REQUIRED'
        ? 'Requiere comparar la venta original con los registros del negocio.'
        : sale.syncState === 'FAILED' ? 'El intento anterior no pudo confirmar la venta.'
            : 'Guardada en este dispositivo. Todavía no hay confirmación del servidor.');
    let status: OfflineRecoveryRow['status'] = sale.syncState === 'RECONCILIATION_REQUIRED' ? 'review'
        : sale.syncState === 'FAILED' ? 'failed' : 'pending';
    if (sale.syncState !== undefined && !['PENDING', 'FAILED', 'RECONCILIATION_REQUIRED'].includes(sale.syncState)) {
        status = 'review'; code = 'OFFLINE_STATE_UNKNOWN'; reason = 'El estado local no es reconocible; conservá la evidencia para revisión.';
    }
    try { toOfflineSyncTransport(sale); } catch (error) {
        status = 'review';
        code = error instanceof OfflineSyncTransportError ? error.code : 'OFFLINE_SNAPSHOT_INCOMPLETE';
        reason = error instanceof OfflineSyncTransportError ? error.message : 'La venta guardada tiene datos incompletos; necesita revisión.';
    }
    let total: string | null = null;
    try {
        if (typeof sale.total === 'number' || typeof sale.total === 'string') {
            const amount = new Decimal(sale.total);
            if (amount.isFinite() && amount.gte(0)) total = amount.toFixed(2);
        }
    } catch { /* Importe desconocido no equivale a cero. */ }
    return {
        offlineId: sale.offlineId, createdAt: validDate(sale.createdAt) ? sale.createdAt : null,
        total, paymentMethod: sale.paymentMethod, status, code, reason: reason.slice(0, 500),
        lastSyncAt: validDate(sale.lastSyncAt) ? sale.lastSyncAt : null,
        lineCount: Array.isArray(sale.items) ? sale.items.length : 0, canRetry: status !== 'review',
    };
}

export function parseOfflineServerEvidence(value: unknown, offlineId: string): OfflineServerEvidence {
    const data = value as OfflineServerEvidence;
    if (!data || data.offlineId !== offlineId || !validDate(data.checkedAt)
        || !['recorded', 'not_found', 'ambiguous'].includes(data.status)) throw new Error('La respuesta del servidor no permite comprobar esta referencia.');
    if (data.status === 'recorded') {
        const record = data.record;
        let validTotal = false;
        try { validTotal = typeof record?.total === 'string' && new Decimal(record.total).isFinite() && new Decimal(record.total).gte(0); } catch { /* invalid */ }
        if (!record || typeof record.saleId !== 'string' || !record.saleId || !validDate(record.createdAt)
            || !validTotal || typeof record.status !== 'string' || typeof record.paymentMethod !== 'string'
            || typeof record.hasReplayFingerprint !== 'boolean'
            || record.invoiceNumber !== null && !Number.isSafeInteger(record.invoiceNumber)
            || record.invoiceSeries !== null && typeof record.invoiceSeries !== 'string') {
            throw new Error('La respuesta del servidor está incompleta. La venta local se conserva.');
        }
    }
    if (data.status === 'recorded') {
        const { saleId, createdAt, total, paymentMethod, status, invoiceNumber, invoiceSeries, hasReplayFingerprint } = data.record;
        return { offlineId, checkedAt: data.checkedAt, status: 'recorded',
            record: { saleId, createdAt, total, paymentMethod, status, invoiceNumber, invoiceSeries, hasReplayFingerprint } };
    }
    return { offlineId, checkedAt: data.checkedAt, status: data.status };
}

/** Informe mínimo local, deliberadamente sin cliente, costos, token ni etiqueta cruda. */
export function buildOfflineEvidence(sale: OfflineSale, serverObservation: OfflineServerEvidence | null) {
    const scalar = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? value : null;
    return {
        format: 'nortex.offline-sale-evidence.v1', exportedAt: new Date().toISOString(),
        actor: { tenantId: sale.tenantId, userId: sale.userId, shiftId: sale.shiftId },
        sale: describeOfflineSale(sale), fiscalRegimeVersion: scalar(sale.fiscalRegimeVersion),
        lines: Array.isArray(sale.items) ? sale.items.map(item => ({
            productId: scalar(item?.id), quantity: scalar(item?.quantity), unitPrice: scalar(item?.price),
            discount: scalar(item?.discount), measurementSource: scalar(item?.measurement?.source),
            measurementCapturedAt: scalar(item?.measurement?.capturedAt),
        })) : [],
        serverObservation,
        note: 'Evidencia para revisión. No es un comprobante fiscal ni prueba de equivalencia entre la venta local y el servidor.',
    };
}
