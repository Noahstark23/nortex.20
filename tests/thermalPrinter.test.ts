import { describe, expect, it } from 'vitest';
import {
    build80mmReceiptPayload,
    ThermalPrinterService,
    TICKET_80MM_COLUMNS,
    ThermalReceiptData,
} from '../utils/thermalPrinter';

const venta: ThermalReceiptData = {
    tenantName: 'Ferreteria El Roble',
    date: '21/08/2026 10:30',
    saleId: 'sale-123456',
    invoiceNumber: 42,
    invoiceSeries: 'A',
    customerName: 'Cliente General',
    user: 'Caja Uno',
    items: [{ name: 'Martillo carpintero', quantity: 2, price: 50 }],
    subtotal: 100,
    discount: 0,
    tax: 13.04,
    grandTotal: 100,
    paymentMethod: 'CASH',
};

const asText = (payload: Uint8Array) => String.fromCharCode(...payload);

describe('ticket termico 80 mm', () => {
    it('usa grandTotal, el mismo contrato que entrega el POS', () => {
        const text = asText(build80mmReceiptPayload(venta));

        expect(text).toContain('TOTAL: C$ 100.00');
        expect(text).not.toContain('undefined');
    });

    it('mantiene el ticket general cuando el regimen se omite o se explicita', () => {
        const defaultPayload = build80mmReceiptPayload(venta);
        const generalPayload = build80mmReceiptPayload({ ...venta, fiscalRegime: 'GENERAL' });

        expect(Array.from(generalPayload)).toEqual(Array.from(defaultPayload));
        expect(asText(generalPayload)).toContain('IVA incl. 15%: C$ 13.04');
    });

    it('imprime cuota fija como factura simplificada sin desglose de IVA', () => {
        const text = asText(build80mmReceiptPayload({
            ...venta,
            fiscalRegime: 'CUOTA_FIJA',
            subtotal: 105,
            discount: 5,
            tax: 13.04,
            grandTotal: 100,
        }));

        expect(text).toContain('FACTURA SIMPLIFICADA');
        expect(text).toContain('Regimen de Cuota Fija');
        expect(text).toContain('Subtotal: C$ 105.00');
        expect(text).toContain('Descuento: -C$ 5.00');
        expect(text).toContain('TOTAL: C$ 100.00');
        expect(text).not.toMatch(/IVA/i);
        expect(text).not.toMatch(/Base imponible/i);
    });

    it('maqueta el papel de 80 mm a 48 columnas', () => {
        const text = asText(build80mmReceiptPayload(venta));

        expect(TICKET_80MM_COLUMNS).toBe(48);
        expect(text).toContain('-'.repeat(48));
        expect(text).toContain('2x');
        expect(text).toContain('Martillo carpintero');
    });

    it('imprime cantidades medidas con unidad, precio por unidad y total', () => {
        const text = asText(build80mmReceiptPayload({
            ...venta,
            items: [
                {
                    name: 'Carne molida',
                    quantity: '1.2500',
                    price: '48',
                    unit: 'lb',
                    saleMode: 'MEASURED',
                },
                {
                    name: 'Muestra',
                    quantity: '0.0001',
                    price: '1000',
                    unit: 'kg',
                    saleMode: 'MEASURED',
                },
            ],
        }));

        expect(text).toContain('1.25 lb × C$48.00/lb');
        expect(text).toContain('C$60.00');
        expect(text).toContain('0.0001 kg × C$1000.00/kg');
        expect(text).toContain('C$0.10');
    });

    it('mantiene 2x cuando una linea legacy no tiene unidad', () => {
        const text = asText(build80mmReceiptPayload(venta));

        expect(text).toContain('2x C$50.00');
        expect(text).toContain('C$100.00');
    });

    it('imprime un empaque como 1 saco sin revelar las 100 lb de stock base', () => {
        const text = asText(build80mmReceiptPayload({
            ...venta,
            items: [{
                name: 'Concentrado bovino',
                quantity: 100,
                price: '0.80',
                unit: 'lb',
                presentation: 'PACK',
                presentationQuantity: 1,
                packUnit: 'saco',
            }],
        }));

        expect(text).toContain('1 saco × C$80.00/saco');
        expect(text).toContain('C$80.00');
        expect(text).not.toContain('100 lb');
    });

    it('rechaza montos corruptos antes de hablar con la impresora', () => {
        expect(() => build80mmReceiptPayload({ ...venta, grandTotal: Number.NaN }))
            .toThrow(/grandTotal/);
    });

    it('neutraliza controles inyectados en nombres antes de generar ESC/POS', () => {
        const text = asText(build80mmReceiptPayload({
            ...venta,
            customerName: 'Cliente\u001b@\nCorte',
        }));

        expect(text).toContain('Cliente: Cliente @ Corte');
        expect(text).not.toContain('Cliente\u001b@');
    });

    it('el boton puede enviar la venta completa al puerto serial', async () => {
        let written: Uint8Array | null = null;
        let released = false;
        let closed = false;
        const port = {
            open: async ({ baudRate }: { baudRate: number }) => {
                expect(baudRate).toBe(9600);
            },
            writable: {
                getWriter: () => ({
                    write: async (payload: Uint8Array) => { written = payload; },
                    releaseLock: () => { released = true; },
                }),
            },
            close: async () => { closed = true; },
        };
        const printer = new ThermalPrinterService();
        // Puerto fake: reproduce exactamente el ramal que antes fallaba al
        // intentar leer `data.total` de una venta que trae `grandTotal`.
        (printer as unknown as { port: typeof port }).port = port;

        await expect(printer.printReceipt(venta)).resolves.toBe(true);
        expect(written).not.toBeNull();
        expect(asText(written as unknown as Uint8Array)).toContain('TOTAL: C$ 100.00');
        expect(released).toBe(true);
        expect(closed).toBe(true);
    });
});
