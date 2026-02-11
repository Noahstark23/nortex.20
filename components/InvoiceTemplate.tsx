// InvoiceTemplate.tsx - Print utilities for Ticket 80mm & Factura A4
// Opens a new window with formatted HTML and triggers window.print()

export interface InvoiceData {
    tenantName: string;
    customerName: string;
    customerPhone?: string;
    items: { name: string; quantity: number; price: number; lineTotal: number }[];
    subtotal: number;
    tax: number;
    grandTotal: number;
    paymentMethod: string;
    date: string;
    saleId?: string;
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

// =============================
// TICKET 80mm (Thermal Printer)
// =============================
export function printTicket(data: InvoiceData) {
    const itemsHTML = data.items.map(item =>
        `<tr>
            <td style="padding:2px 0">${item.quantity}x ${item.name}</td>
            <td style="text-align:right;padding:2px 0">C$ ${item.lineTotal.toFixed(2)}</td>
        </tr>`
    ).join('');

    const payLabel = data.paymentMethod === 'CREDIT' ? 'CREDITO' :
                     data.paymentMethod === 'CASH' ? 'EFECTIVO' :
                     data.paymentMethod === 'CARD' ? 'TARJETA' : data.paymentMethod;

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Ticket</title>
<style>
    ${SHARED_STYLES}
    @page { size: 80mm auto; margin: 0; }
    body { width: 80mm; padding: 4mm; font-size: 11px; line-height: 1.4; }
    table { width: 100%; border-collapse: collapse; }
    .header { font-size: 14px; font-weight: bold; margin-bottom: 2px; }
    .total-row { font-size: 16px; font-weight: bold; padding: 4px 0; }
    .footer { font-size: 9px; color: #666; margin-top: 8px; }
    .print-btn { display: block; width: 100%; padding: 10px; margin-top: 12px; 
        background: #111; color: #fff; border: none; border-radius: 6px; 
        font-size: 14px; font-weight: bold; cursor: pointer; }
</style>
</head><body>

<div class="center">
    <div class="header">${data.tenantName}</div>
    <div style="font-size:9px;color:#666">Sistema Nortex</div>
</div>

<div class="divider"></div>

<div style="font-size:10px;color:#666">${data.date}</div>
${data.saleId ? `<div style="font-size:9px;color:#999">ID: ${data.saleId.slice(0, 12)}</div>` : ''}
<div style="margin:4px 0"><strong>Cliente:</strong> ${data.customerName}</div>

<div class="divider"></div>

<table>${itemsHTML}</table>

<div class="divider"></div>

<table>
    <tr><td>Subtotal</td><td class="right">C$ ${data.subtotal.toFixed(2)}</td></tr>
    <tr><td>IVA (15%)</td><td class="right">C$ ${data.tax.toFixed(2)}</td></tr>
</table>

<div class="divider"></div>

<table>
    <tr class="total-row"><td>TOTAL</td><td class="right">C$ ${data.grandTotal.toFixed(2)}</td></tr>
</table>

<div style="margin-top:4px;font-size:10px">
    <strong>Pago:</strong> ${payLabel}
    ${data.paymentMethod === 'CREDIT' ? ' | Estado: PENDIENTE' : ' | Estado: PAGADO'}
</div>

<div class="divider"></div>

<div class="center footer">
    Gracias por su compra<br>
    Conserve este recibo
</div>

<button class="print-btn no-print" onclick="window.print()">IMPRIMIR TICKET</button>

</body></html>`;

    openPrintWindow(html);
}

// =============================
// FACTURA A4 (Corporate Invoice)
// =============================
export function printA4(data: InvoiceData) {
    const itemsHTML = data.items.map((item, i) =>
        `<tr>
            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#64748b">${i + 1}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-weight:500">${item.name}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:center">${item.quantity}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-family:monospace">C$ ${item.price.toFixed(2)}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:bold;font-family:monospace">C$ ${item.lineTotal.toFixed(2)}</td>
        </tr>`
    ).join('');

    const payLabel = data.paymentMethod === 'CREDIT' ? 'Credito (30 dias)' :
                     data.paymentMethod === 'CASH' ? 'Efectivo' :
                     data.paymentMethod === 'CARD' ? 'Tarjeta' : data.paymentMethod;

    const statusColor = data.paymentMethod === 'CREDIT' ? '#f59e0b' : '#10b981';
    const statusText = data.paymentMethod === 'CREDIT' ? 'PENDIENTE' : 'PAGADO';

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Factura - ${data.tenantName}</title>
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
        <div style="font-size:28px;font-weight:800;color:#0f172a;letter-spacing:-0.5px">${data.tenantName}</div>
        <div style="color:#64748b;font-size:12px;margin-top:4px">Sistema Nortex | Factura Comercial</div>
    </div>
    <div style="text-align:right">
        <div style="font-size:20px;font-weight:700;color:#0f172a">FACTURA</div>
        <div style="color:#64748b;font-size:11px;margin-top:4px">${data.date}</div>
        ${data.saleId ? `<div style="color:#94a3b8;font-size:10px;font-family:monospace;margin-top:2px">#${data.saleId.slice(0, 12)}</div>` : ''}
    </div>
</div>

<!-- CLIENT INFO -->
<div style="display:flex;gap:40px;margin-bottom:32px">
    <div style="flex:1;padding:16px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0">
        <div style="font-size:10px;text-transform:uppercase;color:#94a3b8;font-weight:700;letter-spacing:1px;margin-bottom:8px">Datos del Cliente</div>
        <div style="font-weight:600;font-size:15px">${data.customerName}</div>
        ${data.customerPhone ? `<div style="color:#64748b;margin-top:4px">Tel: ${data.customerPhone}</div>` : ''}
    </div>
    <div style="padding:16px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;min-width:180px">
        <div style="font-size:10px;text-transform:uppercase;color:#94a3b8;font-weight:700;letter-spacing:1px;margin-bottom:8px">Metodo de Pago</div>
        <div style="font-weight:600;font-size:15px">${payLabel}</div>
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
            <span style="font-family:monospace;font-weight:500">C$ ${data.subtotal.toFixed(2)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e2e8f0">
            <span style="color:#64748b">IVA (15%)</span>
            <span style="font-family:monospace;font-weight:500">C$ ${data.tax.toFixed(2)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:12px 0;font-size:18px;font-weight:800;color:#0f172a;border-top:2px solid #0f172a;margin-top:4px">
            <span>TOTAL</span>
            <span style="font-family:monospace">C$ ${data.grandTotal.toFixed(2)}</span>
        </div>
    </div>
</div>

<!-- FOOTER -->
<div style="margin-top:48px;padding-top:16px;border-top:1px solid #e2e8f0;text-align:center;color:#94a3b8;font-size:11px">
    Gracias por su preferencia | ${data.tenantName} | Generado por Nortex
</div>

<button class="print-btn no-print" onclick="window.print()">IMPRIMIR FACTURA A4</button>

</body></html>`;

    openPrintWindow(html);
}

// =============================
// Helper: Open Print Window
// =============================
function openPrintWindow(html: string) {
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    if (!printWindow) {
        alert('Permite ventanas emergentes para imprimir.');
        return;
    }
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    // Auto-trigger print after a short delay for rendering
    printWindow.onload = () => {
        setTimeout(() => printWindow.print(), 300);
    };
}

// =============================
// WhatsApp Receipt Generator
// =============================
export function sendToWhatsApp(data: InvoiceData, phone?: string) {
    const itemLines = data.items.map(item =>
        `${item.quantity}x ${item.name} - C$ ${item.lineTotal.toFixed(2)}`
    ).join('\n');

    const payLabel = data.paymentMethod === 'CREDIT' ? 'PENDIENTE' : 'PAGADO';

    const message = [
        `🧾 *RECIBO NORTEX*`,
        `📅 Fecha: ${data.date}`,
        `📍 *${data.tenantName}*`,
        `--------------------------------`,
        `Cliente: ${data.customerName}`,
        `--------------------------------`,
        itemLines,
        `--------------------------------`,
        `   Subtotal: C$ ${data.subtotal.toFixed(2)}`,
        `   IVA 15%:  C$ ${data.tax.toFixed(2)}`,
        `💰 *TOTAL: C$ ${data.grandTotal.toFixed(2)}*`,
        `✅ Estado: ${payLabel}`,
        `--------------------------------`,
        `¡Gracias por su compra! 🇳🇮`,
    ].join('\n');

    const encoded = encodeURIComponent(message);

    // If customer has phone, send directly. Otherwise open WhatsApp without number.
    const cleanPhone = phone ? phone.replace(/\D/g, '') : '';
    const url = cleanPhone
        ? `https://wa.me/${cleanPhone}?text=${encoded}`
        : `https://wa.me/?text=${encoded}`;

    window.open(url, '_blank');
}
