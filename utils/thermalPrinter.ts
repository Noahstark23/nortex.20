// utils/thermalPrinter.ts
// Motor de Hardware ESC/POS usando Web Serial API
// Dependencia cero, latencia cero.

import Decimal from 'decimal.js';
import {
    FISCAL_REGIME_CUOTA_FIJA,
    normalizeFiscalRegime,
    type FiscalRegime,
} from './fiscalRegime';
import { formatQuantityValue } from './quantity';

class ESCPOS {
    private buffer: number[] = [];

    init() {
        this.buffer.push(0x1B, 0x40); // Inicializar 
        return this;
    }

    align(align: 'L' | 'C' | 'R') {
        const val = align === 'L' ? 0 : align === 'C' ? 1 : 2;
        this.buffer.push(0x1B, 0x61, val);
        return this;
    }

    bold(on: boolean) {
        this.buffer.push(0x1B, 0x45, on ? 1 : 0);
        return this;
    }

    text(str: string) {
        // Normalizamos los caracteres para evitar enviar unicode/UTF-8 extraño a la térmica
        // Strip diacritics para ser compatibles con página de códigos base.
        // También se eliminan controles: un nombre de producto nunca debe
        // inyectar ESC/POS, saltos de línea o un corte de papel.
        const printable = str.normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
            .replace(/[^\u0020-\u00ff]/g, '?');
        for (let i = 0; i < printable.length; i++) {
            this.buffer.push(printable.charCodeAt(i));
        }
        return this;
    }

    textLine(str: string) {
        this.text(str);
        this.buffer.push(0x0A); // Line feed
        return this;
    }

    feed(lines = 1) {
        for (let i = 0; i < lines; i++) {
            this.buffer.push(0x0A);
        }
        return this;
    }

    cut() {
        // Full cut y margin
        this.buffer.push(0x1D, 0x56, 0x41, 0x10);
        return this;
    }

    build(): Uint8Array {
        return new Uint8Array(this.buffer);
    }
}

/**
 * Contrato único para el ticket térmico. El POS y las plantillas de impresión
 * usan `grandTotal`; mantener ese mismo nombre aquí evita que la ruta Web
 * Serial se desincronice de la venta recién cobrada.
 */
export interface ThermalReceiptData {
    tenantName: string;
    ruc?: string;
    address?: string;
    phone?: string;
    dgiAuthCode?: string;
    date: string;
    saleId?: string;
    invoiceNumber?: number;
    invoiceSeries?: string;
    customerName: string;
    items: Array<{
        name: string;
        quantity: Decimal.Value;
        price: Decimal.Value;
        unit?: string | null;
        saleMode?: 'COUNTED' | 'MEASURED' | string | null;
        presentation?: string | { quantity: Decimal.Value; unit: string } | null;
        presentationQuantity?: Decimal.Value | null;
        presentationUnit?: string | null;
        packUnit?: string | null;
    }>;
    subtotal: number;
    discount?: number;
    tax: number;
    grandTotal: number;
    paymentMethod: string;
    cashReceived?: number;
    change?: number;
    user?: string;
    fiscalRegime?: FiscalRegime;
}

// 80 mm suele ofrecer 576 dots imprimibles: 48 columnas con la fuente A
// ESC/POS. Antes se maquetaba a 32 columnas, que corresponde a papel de 58 mm.
export const TICKET_80MM_COLUMNS = 48;

const finiteDecimal = (value: Decimal.Value, field: string): Decimal => {
    let parsed: Decimal;
    try {
        parsed = new Decimal(value);
    } catch {
        throw new Error(`Monto invalido en ${field}`);
    }
    if (!parsed.isFinite()) throw new Error(`Monto invalido en ${field}`);
    return parsed;
};

const money = (value: Decimal.Value, field: string): string =>
    finiteDecimal(value, field).toDecimalPlaces(2).toFixed(2);

type ThermalItem = ThermalReceiptData['items'][number];

const thermalLine = (item: ThermalItem, index: number) => {
    const baseQuantity = finiteDecimal(item.quantity, `items[${index}].quantity`);
    const baseUnitPrice = finiteDecimal(item.price, `items[${index}].price`);
    const total = baseQuantity.times(baseUnitPrice);
    const presentationObject = item.presentation && typeof item.presentation === 'object'
        ? item.presentation
        : null;
    const presentationCode = typeof item.presentation === 'string'
        ? item.presentation.trim()
        : '';
    const isPack = presentationCode.toUpperCase() === 'PACK';
    const namedPresentation = presentationCode !== ''
        && presentationCode.toUpperCase() !== 'BASE'
        && !isPack;
    const hasPresentation = Boolean(
        presentationObject
        || isPack
        || item.presentationQuantity !== undefined && item.presentationQuantity !== null,
    );
    const visibleQuantity = presentationObject
        ? finiteDecimal(presentationObject.quantity, `items[${index}].presentation.quantity`)
        : item.presentationQuantity !== undefined && item.presentationQuantity !== null
            ? finiteDecimal(item.presentationQuantity, `items[${index}].presentationQuantity`)
            : baseQuantity;
    if (!visibleQuantity.greaterThan(0)) throw new Error(`Linea de ticket invalida en items[${index}]`);

    const unit = String(
        presentationObject?.unit
        || item.presentationUnit
        || isPack && item.packUnit
        || namedPresentation && presentationCode
        || item.unit
        || '',
    ).trim();
    const quantity = formatQuantityValue(visibleQuantity);
    const visibleUnitPrice = hasPresentation ? total.dividedBy(visibleQuantity) : baseUnitPrice;
    const quantityLabel = unit ? `${quantity} ${unit}` : `${quantity}x`;
    const equation = unit
        ? `${quantityLabel} × C$${money(visibleUnitPrice, `items[${index}].unitPrice`)}/${unit}`
        : `${quantityLabel} C$${money(visibleUnitPrice, `items[${index}].unitPrice`)}`;

    return {
        name: String(item.name || 'Articulo'),
        equation,
        total: `C$${money(total, `items[${index}].total`)}`,
    };
};

/** Genera bytes ESC/POS puros; se exporta para poder probar el ticket sin USB. */
export function build80mmReceiptPayload(data: ThermalReceiptData): Uint8Array {
    const isFixedQuota = normalizeFiscalRegime(data.fiscalRegime) === FISCAL_REGIME_CUOTA_FIJA;
    const cmd = new ESCPOS();
    const divider = '-'.repeat(TICKET_80MM_COLUMNS);
    const totalWidth = 14;
    const detailWidth = TICKET_80MM_COLUMNS - totalWidth;

    cmd.init();

    // --- HEADER ---
    cmd.align('C').bold(true).textLine(data.tenantName || 'Nortex');
    cmd.bold(false);
    if (data.ruc) cmd.textLine(`RUC: ${data.ruc}`);
    if (data.address) cmd.textLine(data.address);
    if (data.phone) cmd.textLine(`Tel: ${data.phone}`);
    if (data.dgiAuthCode) cmd.textLine(`Aut. DGI: ${data.dgiAuthCode}`);
    cmd.textLine(divider);

    // --- TRANSACCION ---
    cmd.align('L');
    if (isFixedQuota) {
        cmd.bold(true).textLine('FACTURA SIMPLIFICADA').bold(false);
        if (data.invoiceNumber) {
            const series = data.invoiceSeries ? `${data.invoiceSeries}-` : '';
            cmd.textLine(`No. ${series}${String(data.invoiceNumber).padStart(6, '0')}`);
        }
        cmd.textLine('Régimen de Cuota Fija');
    } else if (data.invoiceNumber) {
        const series = data.invoiceSeries ? `${data.invoiceSeries}-` : '';
        cmd.bold(true).textLine(`FACTURA ${series}${String(data.invoiceNumber).padStart(6, '0')}`).bold(false);
    }
    cmd.textLine(`Fecha:   ${data.date}`);
    if (data.saleId) cmd.textLine(`Ticket:  ${data.saleId.slice(-6)}`);
    cmd.textLine(`Cajero:  ${data.user || 'Cajero'}`);
    cmd.textLine(`Cliente: ${data.customerName || 'Cliente General'}`);
    cmd.textLine(divider);

    // --- ARTICULOS ---
    cmd.bold(true).textLine(
        'ARTICULO / CANT. / P. UNIT.'.padEnd(detailWidth) +
        'TOTAL'.padStart(totalWidth),
    ).bold(false);

    data.items.forEach((item, index) => {
        const line = thermalLine(item, index);
        cmd.bold(true).textLine(line.name.slice(0, TICKET_80MM_COLUMNS)).bold(false);
        cmd.textLine(
            line.equation.slice(0, detailWidth).padEnd(detailWidth)
            + line.total.slice(-totalWidth).padStart(totalWidth),
        );
    });

    cmd.textLine(divider);

    // --- TOTALES ---
    cmd.align('R');
    cmd.textLine(`Subtotal: C$ ${money(data.subtotal, 'subtotal')}`);
    if (data.discount && data.discount > 0) {
        cmd.textLine(`Descuento: -C$ ${money(data.discount, 'discount')}`);
    }
    if (!isFixedQuota) cmd.textLine(`IVA incl. 15%: C$ ${money(data.tax, 'tax')}`);
    cmd.bold(true).textLine(`TOTAL: C$ ${money(data.grandTotal, 'grandTotal')}`).bold(false);
    if (typeof data.cashReceived === 'number') {
        cmd.textLine(`Recibido: C$ ${money(data.cashReceived, 'cashReceived')}`);
    }
    if (typeof data.change === 'number') {
        cmd.textLine(`Vuelto: C$ ${money(data.change, 'change')}`);
    }

    cmd.align('C');
    cmd.textLine(divider);
    cmd.textLine(`Metodo de Pago: ${data.paymentMethod}`);
    cmd.feed(1);
    cmd.textLine('Gracias por su compra');
    cmd.feed(4);
    cmd.cut();

    return cmd.build();
}

export class ThermalPrinterService {
    private port: any = null;

    // Detectar si el navegador soporta Web Serial
    isSupported() {
        return 'serial' in navigator;
    }

    // Intentar auto-conectar a un puerto previamente autorizado
    async autoConnect(): Promise<boolean> {
        if (!this.isSupported()) return false;
        try {
            const ports = await (navigator as any).serial.getPorts();
            if (ports && ports.length > 0) {
                this.port = ports[0];
                return true;
            }
        } catch (e) {
            console.warn("Error auto-conectando a puerto serial:", e);
        }
        return false;
    }

    // Interacción manual (botón UI) para solicitar y guardar un puerto
    async connect(): Promise<boolean> {
        if (!this.isSupported()) {
            alert("Tu navegador no soporta conexión a impresoras (Usa Chrome o Edge en PC).");
            return false;
        }
        try {
            // El navegador levanta un popup tipo nativo pidiendo al cajero que escoja COM
            const selectedPort = await (navigator as any).serial.requestPort();
            this.port = selectedPort;
            return true;
        } catch (e) {
            console.error("Selección de puerto cancelada o fallida", e);
            return false;
        }
    }

    disconnect() {
        if (this.port) {
            // Se debe cerrar si estuviese abierto, pero aquí manejamos sesión atómica por pintada
            this.port = null;
        }
    }

    isConnected() {
        return this.port !== null;
    }

    // Traducir la venta al buffer de ESC/POS y enviarlo a la tiquetera.
    async printReceipt(data: ThermalReceiptData): Promise<boolean> {
        if (!this.port) return false;
        let writer: any = null;
        try {
            // Construir también queda dentro del try: un dato corrupto nunca
            // debe dejar el botón en una Promise rechazada sin feedback.
            const payload = build80mmReceiptPayload(data);
            await this.port.open({ baudRate: 9600 }); // Impresoras térmicas típicas operan a 9600 o 115200

            writer = this.port.writable.getWriter();
            await writer.write(payload);
            return true;
        } catch (e) {
            console.error("Error transmitiendo a la tiquetera:", e);
            return false;
        } finally {
            try { writer?.releaseLock(); } catch (_) { }
            // Asegurar cierre tanto en éxito como si falló a mitad del write.
            try { await this.port.close(); } catch (_) { }
        }
    }
}

export const thermalPrinter = new ThermalPrinterService();
