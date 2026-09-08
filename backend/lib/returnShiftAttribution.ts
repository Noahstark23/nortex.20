export interface ReturnOpenShiftCandidate {
    id: string;
}

export type ReturnShiftAttributionErrorCode =
    | 'RETURN_OPEN_SHIFT_REQUIRED'
    | 'RETURN_OPEN_SHIFT_AMBIGUOUS';

export class ReturnShiftAttributionError extends Error {
    readonly httpStatus = 409;

    constructor(
        readonly code: ReturnShiftAttributionErrorCode,
        message: string,
    ) {
        super(message);
        this.name = 'ReturnShiftAttributionError';
    }
}

export interface ReturnShiftAttribution<TShift extends ReturnOpenShiftCandidate> {
    processingShift: TShift;
    processedShiftId: string;
    refundShiftId: string | null;
    source: 'OWN' | 'TENANT_FALLBACK';
}

/**
 * Decide qué cierre Z recibirá una devolución usando exclusivamente turnos ya
 * leídos y bloqueados por el endpoint. Una devolución no efectiva siempre es
 * responsabilidad del turno propio del operador. El fallback del tenant existe
 * únicamente cuando hay efectivo físico y solo si el cajón es inequívoco.
 */
export const resolveReturnShiftAttribution = <TShift extends ReturnOpenShiftCandidate>(params: {
    ownOpenShifts: readonly TShift[];
    tenantOpenShifts: readonly TShift[];
    requiresCashDrawer: boolean;
}): ReturnShiftAttribution<TShift> => {
    if (params.ownOpenShifts.length > 1) {
        throw new ReturnShiftAttributionError(
            'RETURN_OPEN_SHIFT_AMBIGUOUS',
            'Tenés varias cajas propias abiertas. Cerrá las duplicadas antes de procesar la devolución',
        );
    }

    const ownShift = params.ownOpenShifts[0];
    if (ownShift) {
        return {
            processingShift: ownShift,
            processedShiftId: ownShift.id,
            refundShiftId: params.requiresCashDrawer ? ownShift.id : null,
            source: 'OWN',
        };
    }

    if (!params.requiresCashDrawer) {
        throw new ReturnShiftAttributionError(
            'RETURN_OPEN_SHIFT_REQUIRED',
            'Abrí tu propia caja antes de procesar la devolución',
        );
    }

    if (params.tenantOpenShifts.length > 1) {
        throw new ReturnShiftAttributionError(
            'RETURN_OPEN_SHIFT_AMBIGUOUS',
            'Hay varias cajas abiertas. Abrí tu propia caja o cerrá las demás antes de reembolsar efectivo',
        );
    }

    const fallbackShift = params.tenantOpenShifts[0];
    if (!fallbackShift) {
        throw new ReturnShiftAttributionError(
            'RETURN_OPEN_SHIFT_REQUIRED',
            'Abrí una caja antes de reembolsar efectivo',
        );
    }

    return {
        processingShift: fallbackShift,
        processedShiftId: fallbackShift.id,
        refundShiftId: fallbackShift.id,
        source: 'TENANT_FALLBACK',
    };
};
