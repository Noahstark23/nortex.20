import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    buildA4Html,
    buildTicket80mmHtml,
    buildWhatsAppReceiptMessage,
    InvoiceData,
    printTicket,
} from '../components/InvoiceTemplate';

const invoice: InvoiceData = {
    tenantName: 'Ferretería El Roble',
    ruc: 'J031000000001',
    customerName: 'Cliente General',
    items: [{ name: 'Martillo', quantity: 1, price: 100, lineTotal: 100 }],
    subtotal: 100,
    discount: 0,
    tax: 13.04,
    grandTotal: 100,
    paymentMethod: 'CASH',
    date: '21/08/2026 10:30',
    saleId: 'sale-123456',
    invoiceNumber: 42,
    invoiceSeries: 'A',
    user: 'Caja Uno',
};

describe('plantilla del ticket 80 mm', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('genera un documento aislado con tamaño de papel y datos de la venta', () => {
        const html = buildTicket80mmHtml(invoice);

        expect(html).toContain('@page { size: 80mm 200mm; margin: 0; }');
        expect(html).not.toContain('size: 80mm auto');
        expect(html).toContain('<title>Ticket 80 mm</title>');
        expect(html).toContain('FACTURA A-000042');
        expect(html).toContain('TOTAL</td><td class="right">C$ 100.00');
        expect(html).toContain('Ferretería El Roble');
    });

    it('escapa nombres controlados por usuario antes de escribir el popup', () => {
        const html = buildTicket80mmHtml({
            ...invoice,
            customerName: '<img src=x onerror=alert(1)>',
            items: [{ ...invoice.items[0], name: '<script>alert(1)</script>' }],
        });

        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).not.toContain('<img src=x onerror=alert(1)>');
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    });

    it('imprime peso decimal, unidad, precio por unidad y total sin perder precision', () => {
        const data: InvoiceData = {
            ...invoice,
            items: [
                {
                    name: 'Carne molida',
                    quantity: '1.2500',
                    price: '48',
                    lineTotal: '60',
                    unit: 'lb',
                    saleMode: 'MEASURED',
                },
                {
                    name: 'Muestra',
                    quantity: '0.0001',
                    price: '1000',
                    lineTotal: '0.10',
                    unit: 'kg',
                    saleMode: 'MEASURED',
                },
            ],
        };

        const ticket = buildTicket80mmHtml(data);
        const a4 = buildA4Html(data);
        const whatsapp = buildWhatsAppReceiptMessage(data);

        for (const output of [ticket, a4, whatsapp]) {
            expect(output).toContain('1.25 lb');
            expect(output).toContain('48.00/lb');
            expect(output).toContain('0.0001 kg');
            expect(output).toContain('1000.00/kg');
        }
        expect(ticket).toContain('C$ 60.00');
        expect(whatsapp).toContain('1.25 lb × C$ 48.00/lb = C$ 60.00');
    });

    it('mantiene el formato familiar de una linea legacy sin unidad', () => {
        const ticket = buildTicket80mmHtml({
            ...invoice,
            items: [{ name: 'Martillo', quantity: 2, price: 50, lineTotal: 100 }],
        });

        expect(ticket).toContain('2 x C$ 50.00');
        expect(ticket).toContain('C$ 100.00');
    });

    it('imprime la presentacion PACK y no expone la cantidad base como venta visible', () => {
        const data: InvoiceData = {
            ...invoice,
            items: [{
                name: 'Concentrado bovino',
                quantity: 100,
                price: '0.80',
                lineTotal: 80,
                unit: 'lb',
                saleMode: 'MEASURED',
                presentation: 'PACK',
                presentationQuantity: 1,
                packUnit: 'saco',
            }],
        };

        for (const output of [
            buildTicket80mmHtml(data),
            buildA4Html(data),
            buildWhatsAppReceiptMessage(data),
        ]) {
            expect(output).toContain('1 saco');
            expect(output).toContain('80.00/saco');
            expect(output).not.toContain('100 lb');
        }
    });

    it('escapa tambien los campos y renglones de la factura A4', () => {
        const html = buildA4Html({
            ...invoice,
            tenantName: '<svg onload=alert(1)>',
            customerName: '<img src=x onerror=alert(1)>',
            items: [{ ...invoice.items[0], name: '<script>alert(1)</script>' }],
        });

        expect(html).not.toContain('<svg onload=alert(1)>');
        expect(html).not.toContain('<img src=x onerror=alert(1)>');
        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).toContain('&lt;svg onload=alert(1)&gt;');
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    });

    it('usa el documento actual y fija un papel 80 mm con alto medido', () => {
        const print = vi.fn();
        const addEventListener = vi.fn();
        const pageStyle = { id: '', textContent: '', remove: vi.fn() };
        const ticketContent = {
            scrollHeight: 378,
            getBoundingClientRect: () => ({ height: 378 }),
        };
        const receipt = { firstElementChild: ticketContent };
        const appendChild = vi.fn();
        vi.stubGlobal('document', {
            getElementById: vi.fn((id: string) => id === 'receipt-area' ? receipt : null),
            createElement: vi.fn(() => pageStyle),
            head: { appendChild },
        });
        vi.stubGlobal('window', { print, addEventListener } as Pick<Window, 'print' | 'addEventListener'>);

        expect(printTicket(invoice)).toBe(true);
        expect(appendChild).toHaveBeenCalledWith(pageStyle);
        expect(pageStyle.textContent).toBe('@media print { @page { size: 80mm 111mm; margin: 0; } }');
        expect(addEventListener).toHaveBeenCalledWith('afterprint', expect.any(Function), { once: true });
        expect(print).toHaveBeenCalledOnce();
    });
});
