/**
 * Cobros manuales ya confirmados: efectivo a Caja, canales electrónicos a Bancos.
 * La liquidación pendiente de una pasarela requiere su propio contrato; no se
 * presenta como dinero cobrado a través de este helper.
 */
export function settledPaymentAccount(method: string): '1.1.1' | '1.1.2' {
    switch (method) {
        case 'CASH': return '1.1.1';
        case 'CARD':
        case 'TRANSFER':
        case 'QR': return '1.1.2';
        default: throw new Error('El medio de pago no tiene una cuenta de liquidación definida.');
    }
}
