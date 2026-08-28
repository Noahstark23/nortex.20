// InvoiceTemplate.tsx - Print utilities for Ticket 80mm & Factura A4
// Opens a new window with formatted HTML and triggers window.print()

import Decimal from 'decimal.js';
import {
    FISCAL_REGIME_CUOTA_FIJA,
    normalizeFiscalRegime,
    type FiscalRegime,
} from '../utils/fiscalRegime';
import { formatQuantityValue } from '../utils/quantity';

export type PrintablePresentation =
    | string
    | {
        quantity: Decimal.Value;
        unit: string;
    };

export interface InvoiceLineItem {
    name: string;
    quantity: Decimal.Value;
    price: Decimal.Value;
    lineTotal: Decimal.Value;
    unit?: string | null;
    saleMode?: 'COUNTED' | 'MEASURED' | string | null;
    presentation?: PrintablePresentation | null;
    presentationQuantity?: Decimal.Value | null;
    /** Compatibilidad con el producto/carrito mientras el snapshot se aplana. */
    presentationUnit?: string | null;
    packUnit?: string | null;
}

export interface InvoiceData {
    tenantName: string;
    ruc?: string;
    address?: string;
    phone?: string;
    dgiAuthCode?: string;
    customerName: string;
    customerPhone?: string;
    customerRuc?: string;
    items: InvoiceLineItem[];
    subtotal: number;
    discount?: number; // monto rebajado; el IVA va INCLUIDO en los precios (desglose)
    tax: number;
    grandTotal: number;
    paymentMethod: string;
    date: string;
    saleId?: string;
    invoiceNumber?: number;
    invoiceSeries?: string;
    cashReceived?: number;
    change?: number;
    user?: string;
    fiscalRegime?: FiscalRegime;
}

const SHARED_STYLES = `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Courier New', monospace; color: #111; }
    .divider { border-top: 1px dashed #999; margin: 6px 0; }
    .bold { font-weight: bold; }
    .center { text-align: center; }
    .right { text-align: right; }
    @media print {
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .no-print { display: none !important; }
    }
`;

const decimal = (value: Decimal.Value, field: string): Decimal => {
    let parsed: Decimal;
    try {
        parsed = new Decimal(value);
    } catch {
        throw new Error(`Valor decimal invalido en ${field}`);
    }
    if (!parsed.isFinite()) throw new Error(`Valor decimal invalido en ${field}`);
    return parsed;
};

const formatMoney = (value: Decimal.Value, field: string): string =>
    decimal(value, field).toDecimalPlaces(2).toFixed(2);

interface PrintableLine {
    name: string;
    quantity: string;
    unit: string;
    unitPrice: string;
    total: string;
    equation: string;
}

/**
 * El inventario siempre conserva cantidad base, pero una venta por empaque debe
 * imprimir la presentación que realmente eligió el cliente. El precio visible
 * se deriva del total de la línea y de esa cantidad presentada: así `1 saco`
 * no aparece como `100 lb` ni como un precio por libra engañoso.
 */
const printableLine = (item: InvoiceLineItem, index: number): PrintableLine => {
    const baseQuantity = decimal(item.quantity, `items[${index}].quantity`);
    const total = decimal(item.lineTotal, `items[${index}].lineTotal`);
    const presentationObject = item.presentation && typeof item.presentation === 'object'
        ? item.presentation
        : null;
    const presentationCode = typeof item.presentation === 'string'
        ? item.presentation.trim()
        : '';
    const isNamedPresentation = presentationCode !== ''
        && presentationCode.toUpperCase() !== 'BASE'
        && presentationCode.toUpperCase() !== 'PACK';
    const hasPresentation = Boolean(
        presentationObject
        || presentationCode.toUpperCase() === 'PACK'
        || item.presentationQuantity !== undefined && item.presentationQuantity !== null,
    );

    const visibleQuantity = presentationObject
        ? decimal(presentationObject.quantity, `items[${index}].presentation.quantity`)
        : item.presentationQuantity !== undefined && item.presentationQuantity !== null
            ? decimal(item.presentationQuantity, `items[${index}].presentationQuantity`)
            : baseQuantity;
    if (!visibleQuantity.greaterThan(0)) {
        throw new Error(`Cantidad visible invalida en items[${index}]`);
    }

    const unit = String(
        presentationObject?.unit
        || item.presentationUnit
        || item.packUnit && presentationCode.toUpperCase() === 'PACK' && item.packUnit
        || isNamedPresentation && presentationCode
        || item.unit
        || '',
    ).trim();
    const quantity = formatQuantityValue(visibleQuantity);
    const unitPrice = hasPresentation
        ? total.dividedBy(visibleQuantity)
        : decimal(item.price, `items[${index}].price`);
    const formattedUnitPrice = formatMoney(unitPrice, `items[${index}].unitPrice`);
    const formattedTotal = formatMoney(total, `items[${index}].total`);
    const quantityLabel = unit ? `${quantity} ${unit}` : `${quantity} x`;
    const equation = unit
        ? `${quantityLabel} × C$ ${formattedUnitPrice}/${unit}`
        : `${quantityLabel} C$ ${formattedUnitPrice}`;

    return {
        name: String(item.name || 'Articulo'),
        quantity: quantityLabel,
        unit,
        unitPrice: formattedUnitPrice,
        total: formattedTotal,
        equation,
    };
};

// =============================
// TICKET 80mm (Thermal Printer)
// =============================
const escapeHtml = (value: unknown): string => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

/** HTML aislado del ticket: es testeable y no depende del DOM de la app. */
export function buildTicket80mmHtml(data: InvoiceData): string {
    const isFixedQuota = normalizeFiscalRegime(data.fiscalRegime) === FISCAL_REGIME_CUOTA_FIJA;
    const itemsHTML = data.items.map((item, index) => {
        const line = printableLine(item, index);
        return `<tr>
            <td colspan="2" style="padding:3px 0 0;font-weight:bold">${escapeHtml(line.name)}</td>
        </tr>
        <tr>
            <td style="padding:0 0 3px;font-size:10px">${escapeHtml(line.equation)}</td>
            <td style="text-align:right;padding:0 0 3px;white-space:nowrap">C$ ${line.total}</td>
        </tr>`;
    }
    ).join('');

    const payLabel = data.paymentMethod === 'CREDIT' ? 'CREDITO' :
                     data.paymentMethod === 'CASH' ? 'EFECTIVO' :
                     data.paymentMethod === 'CARD' ? 'TARJETA' : data.paymentMethod;

    const invoiceLabel = data.invoiceNumber
        ? `FACTURA ${data.invoiceSeries ? `${escapeHtml(data.invoiceSeries)}-` : ''}${escapeHtml(String(data.invoiceNumber).padStart(6, '0'))}`
        : '';
    const simplifiedInvoiceNumber = data.invoiceNumber
        ? `No. ${data.invoiceSeries ? `${escapeHtml(data.invoiceSeries)}-` : ''}${escapeHtml(String(data.invoiceNumber).padStart(6, '0'))}`
        : '';
    const documentHeading = isFixedQuota
        ? `<div class="center invoice">FACTURA SIMPLIFICADA${simplifiedInvoiceNumber ? `<br><span style="font-size:10px">${simplifiedInvoiceNumber}</span>` : ''}</div>
<div class="center" style="font-size:10px;font-weight:bold">Régimen de Cuota Fija</div>`
        : invoiceLabel ? `<div class="center invoice">${invoiceLabel}</div>` : '';

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Ticket 80 mm</title>
<style>
    ${SHARED_STYLES}
    /* Altura inicial válida; openPrintWindow la ajusta al contenido antes de
       imprimir. La mezcla 80mm + auto no es sintaxis estándar de @page. */
    @page { size: 80mm 200mm; margin: 0; }
    html, body { width: 80mm; min-width: 80mm; background: #fff; }
    body { padding: 4mm; font-size: 11px; line-height: 1.4; }
    table { width: 100%; border-collapse: collapse; }
    .header { font-size: 14px; font-weight: bold; margin-bottom: 2px; }
    .invoice { margin: 5px 0; padding: 4px 2px; border: 1px solid #111; font-size: 12px; font-weight: bold; }
    .total-row { font-size: 16px; font-weight: bold; padding: 4px 0; }
    .footer { font-size: 9px; color: #666; margin-top: 8px; }
    .print-btn { display: block; width: 100%; padding: 10px; margin-top: 12px; 
        background: #111; color: #fff; border: none; border-radius: 6px; 
        font-size: 14px; font-weight: bold; cursor: pointer; }
</style>
<style id="ticket-page-size"></style>
</head><body>

<div id="ticket-content">
<div class="center">
    <div class="header">${escapeHtml(data.tenantName)}</div>
    ${data.ruc ? `<div>RUC: ${escapeHtml(data.ruc)}</div>` : ''}
    ${data.address ? `<div>${escapeHtml(data.address)}</div>` : ''}
    ${data.phone ? `<div>Tel: ${escapeHtml(data.phone)}</div>` : ''}
    ${data.dgiAuthCode ? `<div>Aut. DGI: ${escapeHtml(data.dgiAuthCode)}</div>` : ''}
    <div style="font-size:9px;color:#666">Sistema Nortex</div>
</div>

${documentHeading}

<div class="divider"></div>

<div style="font-size:10px;color:#666">${escapeHtml(data.date)}</div>
${data.saleId ? `<div style="font-size:9px;color:#999">ID: ${escapeHtml(data.saleId.slice(0, 12))}</div>` : ''}
${data.user ? `<div style="font-size:10px"><strong>Cajero:</strong> ${escapeHtml(data.user)}</div>` : ''}
<div style="margin:4px 0"><strong>Cliente:</strong> ${escapeHtml(data.customerName)}</div>
${data.customerRuc ? `<div style="font-size:10px"><strong>RUC/Cédula:</strong> ${escapeHtml(data.customerRuc)}</div>` : ''}

<div class="divider"></div>

<table>${itemsHTML}</table>

<div class="divider"></div>

<table>
    <tr><td>Subtotal</td><td class="right">C$ ${formatMoney(data.subtotal, 'subtotal')}</td></tr>
    ${data.discount && data.discount > 0 ? `<tr><td>Descuento</td><td class="right">-C$ ${formatMoney(data.discount, 'discount')}</td></tr>` : ''}
    ${isFixedQuota ? '' : `<tr><td>IVA incluido (15%)</td><td class="right">C$ ${formatMoney(data.tax, 'tax')}</td></tr>`}
</table>

<div class="divider"></div>

<table>
    <tr class="total-row"><td>TOTAL</td><td class="right">C$ ${formatMoney(data.grandTotal, 'grandTotal')}</td></tr>
</table>

<div style="margin-top:4px;font-size:10px">
    <strong>Pago:</strong> ${escapeHtml(payLabel)}
    ${data.paymentMethod === 'CREDIT' ? ' | Estado: PENDIENTE' : ' | Estado: PAGADO'}
</div>
${typeof data.cashReceived === 'number' && data.cashReceived > 0 ? `<div style="font-size:10px"><strong>Recibido:</strong> C$ ${formatMoney(data.cashReceived, 'cashReceived')}</div>` : ''}
${typeof data.change === 'number' && data.change > 0 ? `<div style="font-size:10px"><strong>Vuelto:</strong> C$ ${formatMoney(data.change, 'change')}</div>` : ''}

<div class="divider"></div>

<div class="center footer">
    Gracias por su compra<br>
    Conserve este recibo
</div>
</div>

<button class="print-btn no-print" onclick="window.print()">IMPRIMIR TICKET</button>

</body></html>`;
}

export function printTicket(data: InvoiceData): boolean {
    const prefersPopup = detectThermalTicketPopupMode();
    if (prefersPopup) {
        return openPrintWindow(buildTicket80mmHtml(data), { width: 420, height: 720, thermal: true })
            || printTicketFromCurrentDocument(data);
    }
    return printTicketFromCurrentDocument(data)
        || openPrintWindow(buildTicket80mmHtml(data), { width: 420, height: 720, thermal: true });
}

type TicketPrintEnvironment = {
    userAgent?: string;
    capacitor?: unknown;
};

export function detectThermalTicketPopupMode(environment: TicketPrintEnvironment = {}): boolean {
    const userAgent = environment.userAgent
        ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent ?? '');
    const androidWebView = /Android/i.test(userAgent)
        && /(?:;\s*wv\)|\bwv\b|Version\/\d+\.\d+.*Chrome)/i.test(userAgent);
    if (androidWebView) return true;

    const capacitor = environment.capacitor
        ?? (typeof window === 'undefined' ? undefined : (window as typeof window & { Capacitor?: unknown }).Capacitor);
    if (!capacitor || typeof capacitor !== 'object') return false;
    const maybeCapacitor = capacitor as {
        isNativePlatform?: (() => boolean) | boolean;
        platform?: string;
    };
    if (typeof maybeCapacitor.isNativePlatform === 'function') {
        try {
            if (maybeCapacitor.isNativePlatform()) return true;
        } catch {
            return true;
        }
    } else if (maybeCapacitor.isNativePlatform === true) {
        return true;
    }
    return typeof maybeCapacitor.platform === 'string'
        && maybeCapacitor.platform.toLowerCase() !== 'web';
}

function printTicketFromCurrentDocument(data: InvoiceData): boolean {
    // El ticket 80 mm del POS ya está montado en el DOM actual mediante
    // <ReceiptTicket />. Imprimir desde la misma página evita depender de
    // popups, que fallan en navegadores móviles aunque el click sea real.
    if (typeof document === 'undefined' || typeof window.print !== 'function') return false;
    const receipt = document.getElementById('receipt-area');
    const content = receipt?.firstElementChild as HTMLElement | null;
    if (!receipt || !content) return false;

    // CSS @page acepta dos longitudes, no una longitud mezclada con `auto`.
    // Se calcula el alto del rollo antes de abrir el diálogo para no cortar
    // tickets largos ni caer en una hoja A4 por sintaxis inválida.
    const heightPx = Math.max(content.scrollHeight, content.getBoundingClientRect().height);
    const measuredMm = Math.ceil(heightPx * 25.4 / 96) + 10;
    const estimatedMm = 60 + data.items.length * 7;
    const heightMm = Math.max(60, heightPx > 0 ? measuredMm : estimatedMm);
    let pageStyle = document.getElementById('nortex-ticket-page-size') as HTMLStyleElement | null;
    if (!pageStyle) {
        pageStyle = document.createElement('style');
        pageStyle.id = 'nortex-ticket-page-size';
        document.head.appendChild(pageStyle);
    }
    pageStyle.textContent = `@media print { @page { size: 80mm ${heightMm}mm; margin: 0; } }`;

    try {
        window.addEventListener('afterprint', () => pageStyle?.remove(), { once: true });
        window.print();
        return true;
    } catch {
        pageStyle.remove();
        return false;
    }
}

// =============================
// FACTURA A4 (Corporate Invoice)
// =============================
export function buildA4Html(data: InvoiceData): string {
    const isFixedQuota = normalizeFiscalRegime(data.fiscalRegime) === FISCAL_REGIME_CUOTA_FIJA;
    const itemsHTML = data.items.map((item, i) => {
        const line = printableLine(item, i);
        const unitPrice = line.unit
            ? `C$ ${line.unitPrice}/${escapeHtml(line.unit)}`
            : `C$ ${line.unitPrice}`;
        return (
        `<tr>
            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#64748b">${i + 1}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-weight:500">${escapeHtml(line.name)}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:center">${escapeHtml(line.quantity)}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-family:monospace">${unitPrice}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:bold;font-family:monospace">C$ ${line.total}</td>
        </tr>`
        );
    }).join('');

    const payLabel = data.paymentMethod === 'CREDIT' ? 'Credito (30 dias)' :
                     data.paymentMethod === 'CASH' ? 'Efectivo' :
                     data.paymentMethod === 'CARD' ? 'Tarjeta' : data.paymentMethod;

    const statusColor = data.paymentMethod === 'CREDIT' ? '#f59e0b' : '#10b981';
    const statusText = data.paymentMethod === 'CREDIT' ? 'PENDIENTE' : 'PAGADO';

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Factura - ${escapeHtml(data.tenantName)}</title>
<style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    @page { size: A4; margin: 15mm; }
    body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; color: #1e293b; padding: 40px; font-size: 13px; line-height: 1.5; }
    table { width: 100%; border-collapse: collapse; }
    .print-btn { display: block; width: 200px; margin: 30px auto 0; padding: 12px 24px;
        background: #0f172a; color: #fff; border: none; border-radius: 8px;
        font-size: 14px; font-weight: bold; cursor: pointer; }
    @media print {
        body { padding: 0; }
        .no-print { display: none !important; }
    }
</style>
</head><body>

<!-- HEADER -->
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:40px">
    <div>
        <div style="font-size:28px;font-weight:800;color:#0f172a;letter-spacing:-0.5px">${escapeHtml(data.tenantName)}</div>
        <div style="color:#64748b;font-size:12px;margin-top:4px">Sistema Nortex | ${isFixedQuota ? 'Factura Simplificada' : 'Factura Comercial'}</div>
        ${isFixedQuota ? '<div style="color:#475569;font-size:11px;font-weight:700;margin-top:3px">Régimen de Cuota Fija</div>' : ''}
    </div>
    <div style="text-align:right">
        <div style="font-size:20px;font-weight:700;color:#0f172a">${isFixedQuota ? 'FACTURA SIMPLIFICADA' : 'FACTURA'}</div>
        <div style="color:#64748b;font-size:11px;margin-top:4px">${escapeHtml(data.date)}</div>
        ${data.saleId ? `<div style="color:#94a3b8;font-size:10px;font-family:monospace;margin-top:2px">#${escapeHtml(data.saleId.slice(0, 12))}</div>` : ''}
    </div>
</div>

<!-- CLIENT INFO -->
<div style="display:flex;gap:40px;margin-bottom:32px">
    <div style="flex:1;padding:16px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0">
        <div style="font-size:10px;text-transform:uppercase;color:#94a3b8;font-weight:700;letter-spacing:1px;margin-bottom:8px">Datos del Cliente</div>
        <div style="font-weight:600;font-size:15px">${escapeHtml(data.customerName)}</div>
        ${data.customerPhone ? `<div style="color:#64748b;margin-top:4px">Tel: ${escapeHtml(data.customerPhone)}</div>` : ''}
    </div>
    <div style="padding:16px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;min-width:180px">
        <div style="font-size:10px;text-transform:uppercase;color:#94a3b8;font-weight:700;letter-spacing:1px;margin-bottom:8px">Metodo de Pago</div>
        <div style="font-weight:600;font-size:15px">${escapeHtml(payLabel)}</div>
        <div style="display:inline-block;margin-top:6px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;color:white;background:${statusColor}">${statusText}</div>
    </div>
</div>

<!-- ITEMS TABLE -->
<table style="margin-bottom:24px">
    <thead>
        <tr style="background:#f1f5f9">
            <th style="padding:10px 12px;text-align:left;font-size:10px;text-transform:uppercase;color:#64748b;letter-spacing:0.5px;font-weight:700;width:40px">#</th>
            <th style="padding:10px 12px;text-align:left;font-size:10px;text-transform:uppercase;color:#64748b;letter-spacing:0.5px;font-weight:700">Descripcion</th>
            <th style="padding:10px 12px;text-align:center;font-size:10px;text-transform:uppercase;color:#64748b;letter-spacing:0.5px;font-weight:700;width:60px">Cant.</th>
            <th style="padding:10px 12px;text-align:right;font-size:10px;text-transform:uppercase;color:#64748b;letter-spacing:0.5px;font-weight:700;width:100px">P. Unit.</th>
            <th style="padding:10px 12px;text-align:right;font-size:10px;text-transform:uppercase;color:#64748b;letter-spacing:0.5px;font-weight:700;width:110px">Total</th>
        </tr>
    </thead>
    <tbody>${itemsHTML}</tbody>
</table>

<!-- TOTALS -->
<div style="display:flex;justify-content:flex-end">
    <div style="width:280px">
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e2e8f0">
            <span style="color:#64748b">Subtotal</span>
            <span style="font-family:monospace;font-weight:500">C$ ${formatMoney(data.subtotal, 'subtotal')}</span>
        </div>
        ${data.discount && data.discount > 0 ? `<div style="display:flex;justify-content:space-between;padding:4px 0">
            <span style="color:#64748b">Descuento</span>
            <span style="font-family:monospace;font-weight:500">-C$ ${formatMoney(data.discount, 'discount')}</span>
        </div>` : ''}
        ${isFixedQuota ? '' : `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e2e8f0">
            <span style="color:#64748b">IVA incluido (15%)</span>
            <span style="font-family:monospace;font-weight:500">C$ ${formatMoney(data.tax, 'tax')}</span>
        </div>`}
        <div style="display:flex;justify-content:space-between;padding:12px 0;font-size:18px;font-weight:800;color:#0f172a;border-top:2px solid #0f172a;margin-top:4px">
            <span>TOTAL</span>
            <span style="font-family:monospace">C$ ${formatMoney(data.grandTotal, 'grandTotal')}</span>
        </div>
    </div>
</div>

<!-- FOOTER -->
<div style="margin-top:48px;padding-top:16px;border-top:1px solid #e2e8f0;text-align:center;color:#94a3b8;font-size:11px">
    Gracias por su preferencia | ${escapeHtml(data.tenantName)} | Generado por Nortex
</div>

<button class="print-btn no-print" onclick="window.print()">IMPRIMIR FACTURA A4</button>

</body></html>`;
}

export function printA4(data: InvoiceData) {
    openPrintWindow(buildA4Html(data), { width: 800, height: 600, thermal: false });
}

// =============================
// Helper: Open Print Window
// =============================
type OpenPrintWindowOptions = {
    width: number;
    height: number;
    thermal: boolean;
};

function openPrintWindow(html: string, options: OpenPrintWindowOptions): boolean {
    const printWindow = window.open('', '_blank', `width=${options.width},height=${options.height}`);
    if (!printWindow) {
        alert('Permite ventanas emergentes para imprimir.');
        return false;
    }
    let printScheduled = false;
    const schedulePrint = () => {
        if (printScheduled) return;
        printScheduled = true;
        setTimeout(() => {
            if (options.thermal) {
                // Un rollo térmico no tiene alto fijo. Medimos el contenido ya
                // renderizado y generamos un par <ancho> <alto> válido para @page.
                const ticket = printWindow.document.getElementById('ticket-content');
                const pageStyle = printWindow.document.getElementById('ticket-page-size');
                if (ticket && pageStyle) {
                    const heightPx = Math.max(ticket.scrollHeight, ticket.getBoundingClientRect().height);
                    const heightMm = Math.max(60, Math.ceil(heightPx * 25.4 / 96) + 10);
                    pageStyle.textContent = `@page { size: 80mm ${heightMm}mm; margin: 0; }`;
                }
            }
            printWindow.print();
        }, 300);
    };
    printWindow.addEventListener('load', schedulePrint, { once: true });
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    // Algunos navegadores completan about:blank antes de despachar `load`.
    if (printWindow.document.readyState === 'complete') schedulePrint();
    return true;
}

// =============================
// WhatsApp Receipt Generator
// =============================
const plainText = (value: unknown): string => String(value ?? '')
    .replace(/[\r\n\t\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .trim();

export function buildWhatsAppReceiptMessage(data: InvoiceData): string {
    const isFixedQuota = normalizeFiscalRegime(data.fiscalRegime) === FISCAL_REGIME_CUOTA_FIJA;
    const itemLines = data.items.map((item, index) => {
        const line = printableLine(item, index);
        return `${plainText(line.name)}\n${plainText(line.equation)} = C$ ${line.total}`;
    }).join('\n');

    const payLabel = data.paymentMethod === 'CREDIT' ? 'PENDIENTE' : 'PAGADO';

    return [
        isFixedQuota ? `*FACTURA SIMPLIFICADA*` : `*RECIBO NORTEX*`,
        ...(isFixedQuota ? [`Régimen de Cuota Fija`] : []),
        `Fecha: ${plainText(data.date)}`,
        `*${plainText(data.tenantName)}*`,
        `--------------------------------`,
        `Cliente: ${plainText(data.customerName)}`,
        `--------------------------------`,
        itemLines,
        `--------------------------------`,
        `   Subtotal: C$ ${formatMoney(data.subtotal, 'subtotal')}`,
        ...(data.discount && data.discount > 0 ? [`   Descuento: -C$ ${formatMoney(data.discount, 'discount')}`] : []),
        ...(!isFixedQuota ? [`   IVA incl.: C$ ${formatMoney(data.tax, 'tax')}`] : []),
        `*TOTAL: C$ ${formatMoney(data.grandTotal, 'grandTotal')}*`,
        `Estado: ${payLabel}`,
        `--------------------------------`,
        `¡Gracias por su compra! 🇳🇮`,
    ].join('\n');
}

export function sendToWhatsApp(data: InvoiceData, phone?: string) {
    const message = buildWhatsAppReceiptMessage(data);

    const encoded = encodeURIComponent(message);

    // If customer has phone, send directly. Otherwise open WhatsApp without number.
    const cleanPhone = phone ? phone.replace(/\D/g, '') : '';
    const url = cleanPhone
        ? `https://wa.me/${cleanPhone}?text=${encoded}`
        : `https://wa.me/?text=${encoded}`;

    window.open(url, '_blank');
}
