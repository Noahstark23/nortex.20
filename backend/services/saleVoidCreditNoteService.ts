/**
 * H6 — Nota de crédito por ANULACIÓN como documento propio.
 *
 * Antes la anulación solo modificaba la venta original y no quedaba ningún
 * comprobante numerado que la respaldara. Ahora, dentro de la MISMA
 * transacción de la anulación, se emite una SaleCreditNote con:
 *  - su propio número (serie 'NC', correlativo separado de las series A/B);
 *  - total e IVA tomados del snapshot fiscal de la venta (no se recalcula con
 *    la configuración actual);
 *  - quién AUTORIZÓ (aprobador de la solicitud) y quién EJECUTÓ.
 *
 * La venta original conserva total, IVA, líneas, serie y número: solo queda
 * marcada como anulada (status/cancelled*), que es lo que la excluye de los
 * reportes. Regla existente preservada: mismo día hábil y caja abierta.
 */
import Decimal from 'decimal.js';
import { vatCollectedFromSale } from '../../utils/fiscalRegime';
import { allocateSaleCreditNoteNumber } from './invoiceNumberingService';

export interface SaleVoidCreditNoteInput {
    tenantId: string;
    issuedById: string;
    motivo: string;
    sale: {
        id: string;
        total: Decimal.Value | { toString(): string };
        exemptTotal?: Decimal.Value | { toString(): string } | null;
        fiscalRegimeAtSale?: unknown;
        vatAmountAtSale?: Decimal.Value | { toString(): string } | null;
    };
    correctionRequest: { id: string; approvedBy: string | null };
}

export class SaleVoidCreditNoteError extends Error {
    constructor(public readonly code: string, public readonly httpStatus: number, message: string) {
        super(message);
        this.name = 'SaleVoidCreditNoteError';
    }
}

/** Texto de Kardex: motivo + documento que respalda el movimiento + quién autorizó. */
export function voidKardexReason(motivo: string, note: { series: string; number: number; authorizedById: string }): string {
    return `Anulación de factura: ${motivo} · NC ${note.series}-${String(note.number).padStart(6, '0')} · autorizó ${note.authorizedById}`;
}

export async function issueSaleVoidCreditNote(tx: any, input: SaleVoidCreditNoteInput) {
    const authorizedById = input.correctionRequest.approvedBy;
    if (!authorizedById) {
        throw new SaleVoidCreditNoteError('APPROVED_CORRECTION_REQUIRED', 409, 'La anulación requiere un aprobador registrado');
    }
    const total = new Decimal(input.sale.total.toString()).toDecimalPlaces(4);
    const vatAmount = vatCollectedFromSale({
        total,
        exemptTotal: input.sale.exemptTotal == null ? null : input.sale.exemptTotal.toString(),
        fiscalRegimeAtSale: input.sale.fiscalRegimeAtSale,
        vatAmountAtSale: input.sale.vatAmountAtSale == null ? null : input.sale.vatAmountAtSale.toString(),
    });
    const number = await allocateSaleCreditNoteNumber(tx, input.tenantId);
    return tx.saleCreditNote.create({
        data: {
            tenantId: input.tenantId,
            saleId: input.sale.id,
            correctionRequestId: input.correctionRequest.id,
            series: number.series,
            number: number.number,
            total: total.toFixed(4),
            vatAmount: vatAmount.toFixed(4),
            reason: input.motivo,
            authorizedById,
            issuedById: input.issuedById,
        },
    });
}
