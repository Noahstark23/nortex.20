import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    buildA4Html,
    buildTicket80mmHtml,
    buildWhatsAppReceiptMessage,
    detectThermalTicketPopupMode,
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

    it('mantiene el documento general sin cambios cuando el regimen se omite o se explicita', () => {
        const general: InvoiceData = { ...invoice, fiscalRegime: 'GENERAL' };

        expect(buildTicket80mmHtml(general)).toBe(buildTicket80mmHtml(invoice));
        expect(buildA4Html(general)).toBe(buildA4Html(invoice));
        expect(buildWhatsAppReceiptMessage(general)).toBe(buildWhatsAppReceiptMessage(invoice));
        expect(buildTicket80mmHtml(general)).toContain('IVA incluido (15%)');
    });

    it('genera factura simplificada de cuota fija sin exponer ningun desglose de IVA', () => {
        const fixedQuota: InvoiceData = {
            ...invoice,
            fiscalRegime: 'CUOTA_FIJA',
            subtotal: 105,
            discount: 5,
            tax: 13.04,
            grandTotal: 100,
        };
        const ticket = buildTicket80mmHtml(fixedQuota);
        const a4 = buildA4Html(fixedQuota);
        const whatsapp = buildWhatsAppReceiptMessage(fixedQuota);

        for (const output of [ticket, a4, whatsapp]) {
            expect(output).toContain('FACTURA SIMPLIFICADA');
            expect(output).toContain('Régimen de Cuota Fija');
            expect(output).toContain('Subtotal');
            expect(output).toContain('Descuento');
            expect(output).not.toMatch(/IVA/i);
            expect(output).not.toMatch(/Base imponible/i);
        }
        expect(ticket).toContain('TOTAL</td><td class="right">C$ 100.00');
        expect(a4).toContain('<span>TOTAL</span>');
        expect(a4).toContain('C$ 100.00');
        expect(whatsapp).toContain('*TOTAL: C$ 100.00*');
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

    it('abre el ticket aislado en Android WebView para no depender de window.print del shell', () => {
        vi.useFakeTimers();
        const print = vi.fn();
        const pageStyle = { textContent: '' };
        const ticketContent = {
            scrollHeight: 260,
            getBoundingClientRect: () => ({ height: 260 }),
        };
        const printWindow = {
            addEventListener: vi.fn((_event: string, listener: () => void) => listener()),
            document: {
                open: vi.fn(),
                write: vi.fn(),
                close: vi.fn(),
                readyState: 'complete',
                getElementById: vi.fn((id: string) => id === 'ticket-content' ? ticketContent : id === 'ticket-page-size' ? pageStyle : null),
            },
            print,
        };
        const open = vi.fn(() => printWindow);
        vi.stubGlobal('window', { open, print: vi.fn(), addEventListener: vi.fn() } as unknown as Window);
        vi.stubGlobal('navigator', {
            userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel Build/UP1A; wv) Version/4.0 Chrome/124 Mobile Safari/537.36',
        } as Navigator);

        expect(printTicket(invoice)).toBe(true);
        vi.runAllTimers();

        expect(open).toHaveBeenCalledWith('', '_blank', 'width=420,height=720');
        expect(printWindow.document.write).toHaveBeenCalledWith(expect.stringContaining('Ticket 80 mm'));
        expect(pageStyle.textContent).toBe('@page { size: 80mm 79mm; margin: 0; }');
        expect(print).toHaveBeenCalledOnce();
    });

    it('cae al popup térmico si el ticket aún no está montado en el DOM actual', () => {
        vi.useFakeTimers();
        const popupPrint = vi.fn();
        const printWindow = {
            addEventListener: vi.fn((_event: string, listener: () => void) => listener()),
            document: {
                open: vi.fn(),
                write: vi.fn(),
                close: vi.fn(),
                readyState: 'complete',
                getElementById: vi.fn(() => null),
            },
            print: popupPrint,
        };
        const open = vi.fn(() => printWindow);
        vi.stubGlobal('document', {
            getElementById: vi.fn(() => null),
        });
        vi.stubGlobal('window', { open, print: vi.fn(), addEventListener: vi.fn() } as unknown as Window);
        vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)' } as Navigator);

        expect(printTicket(invoice)).toBe(true);
        vi.runAllTimers();

        expect(open).toHaveBeenCalledWith('', '_blank', 'width=420,height=720');
        expect(popupPrint).toHaveBeenCalledOnce();
    });
});

describe('detectThermalTicketPopupMode', () => {
    it('detecta Android WebView como ruta de popup térmico', () => {
        expect(detectThermalTicketPopupMode({
            userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel Build/UP1A; wv) Version/4.0 Chrome/124 Mobile Safari/537.36',
        })).toBe(true);
    });

    it('detecta Capacitor nativo aunque el user-agent no delate WebView', () => {
        expect(detectThermalTicketPopupMode({
            userAgent: 'Mozilla/5.0 (Linux; Android 14)',
            capacitor: { isNativePlatform: () => true },
        })).toBe(true);
    });

    it('mantiene misma pestaña en navegadores normales', () => {
        expect(detectThermalTicketPopupMode({
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)',
        })).toBe(false);
    });
});
