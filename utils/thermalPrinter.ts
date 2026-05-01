// utils/thermalPrinter.ts
// Motor de Hardware ESC/POS usando Web Serial API
// Dependencia cero, latencia cero.

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
        const normalized = str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        for (let i = 0; i < normalized.length; i++) {
            this.buffer.push(normalized.charCodeAt(i));
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

    pad(texto: string, length = 6, num = false) {
        return num ? texto.padStart(length, '0') : texto.padEnd(length, ' ');
    }

    // Traducir el InvoiceData al buffer de ESC/POS
    async printReceipt(data: any): Promise<boolean> {
        if (!this.port) return false;

        const cmd = new ESCPOS();
        cmd.init();
        
        // --- HEADER ---
        cmd.align('C').bold(true).textLine(data.tenantName);
        cmd.bold(false);
        if (data.ruc) cmd.textLine(`RUC: ${data.ruc}`);
        if (data.address) cmd.textLine(data.address);
        if (data.phone) cmd.textLine(`Tel: ${data.phone}`);
        if (data.dgiAuthCode) cmd.textLine(`Aut. DGI: ${data.dgiAuthCode}`);
        
        cmd.textLine("--------------------------------"); // 32 chars genérico 58mm
        
        // --- TRANSACCIÓN ---
        cmd.align('L');
        if (data.invoiceNumber) {
            cmd.bold(true).textLine(`FACTURA No. ${this.pad(String(data.invoiceNumber), 6, true)}`).bold(false);
        }
        cmd.textLine(`Fecha:  ${data.date}`);
        if (data.saleId) cmd.textLine(`Ticket: ${data.saleId.slice(-6)}`);
        cmd.textLine(`Cajero: ${data.user}`);
        cmd.textLine(`Cliente: ${data.customerName}`);
        
        cmd.textLine("--------------------------------");
        
        // --- ARTÍCULOS ---
        // Cant(4) | Desc(18) | Total(8) = 30 + spaces
        cmd.bold(true).textLine("CANT ARTICULO            TOTAL").bold(false);
        
        data.items.forEach((item: any) => {
            const qty = String(item.quantity).padEnd(4, ' ');
            const name = item.name.substring(0, 18).padEnd(19, ' ');
            const total = (item.quantity * item.price).toFixed(2).padStart(8, ' ');
            cmd.textLine(`${qty}${name} ${total}`);
        });

        cmd.textLine("--------------------------------");
        
        // --- TOTALES ---
        cmd.align('R');
        cmd.textLine(`Subtotal: C$ ${data.subtotal.toFixed(2)}`);
        cmd.textLine(`IVA 15%: C$ ${data.tax.toFixed(2)}`);
        cmd.bold(true).textLine(`TOTAL: C$ ${data.total.toFixed(2)}`).bold(false);
        
        cmd.align('C');
        cmd.textLine("--------------------------------");
        cmd.textLine(`Metodo de Pago: ${data.paymentMethod}`);
        cmd.feed(1);
        cmd.textLine("¡Gracias por su compra!");
        cmd.feed(4); // Dar espacio para el corte
        cmd.cut();

        const payload = cmd.build();

        // Enviar al puerto
        try {
            await this.port.open({ baudRate: 9600 }); // Impresoras térmicas típicas operan a 9600 o 115200
            
            const writer = this.port.writable.getWriter();
            await writer.write(payload);
            writer.releaseLock();
            
            await this.port.close();
            return true;
        } catch (e) {
            console.error("Error transmitiendo a la tiquetera:", e);
            // Asegurar que cerremos el puerto si falló a mitad del write
            try { await this.port.close(); } catch (_) { }
            return false;
        }
    }
}

export const thermalPrinter = new ThermalPrinterService();
