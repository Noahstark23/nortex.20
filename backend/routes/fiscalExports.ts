import type { Express } from 'express';
import { prisma as sharedPrisma } from '../lib/prisma';
import { authenticate, type AuthRequest } from '../middleware/auth';
import { checkRole } from '../middleware/checkRole';
import Decimal from 'decimal.js';
import { FISCAL_REPORT_ROLES, fiscalCivilDate, fiscalPurchaseScope, fiscalRetentionScope, parseFiscalPeriod } from '../lib/fiscalAccess';
import { fiscalMonthRange, desglosarVentaConExoneracion } from '../services/nicaTax';
import { normalizeFiscalRegime, FISCAL_REGIME_CUOTA_FIJA } from '../../utils/fiscalRegime';
import { PURCHASE_FISCAL_STATUSES } from '../lib/supplierPayments';
import { ESTADO_ANULADA } from '../services/saleCancellation';

/** Exportaciones fiscales: mismos snapshots, permisos, formatos y cortes Managua. */
export function registerFiscalExports(app: Pick<Express, 'get'>, prisma = sharedPrisma) {
// ==========================================
// 📊 SPRINT A — EXPORTACIONES FISCALES DGI
// ==========================================

// El rango fiscal del mes vive en services/nicaTax.ts (fuente única): los libros,
// el resumen VET y la declaración mensual TIENEN que recortar las mismas ventas.
// Antes había una copia acá y otra fórmula distinta en generateMonthlyReport.

const fiscalSaleSnapshotBreakdown = (sale: {
    total: { toString(): string } | string | number;
    exemptTotal?: { toString(): string } | string | number | null;
    fiscalRegimeAtSale?: unknown;
    vatAmountAtSale?: { toString(): string } | string | number | null;
}) => {
    const total = new Decimal(sale.total.toString()).toDecimalPlaces(4);
    const fiscalRegime = normalizeFiscalRegime(sale.fiscalRegimeAtSale);
    if (fiscalRegime === FISCAL_REGIME_CUOTA_FIJA) {
        return {
            fiscalRegime,
            exonerado: new Decimal(0),
            netoGravado: new Decimal(0),
            iva: new Decimal(0),
            cuotaFija: total,
            total,
        };
    }

    const legacy = desglosarVentaConExoneracion(
        total,
        sale.exemptTotal?.toString() ?? '0',
    );
    let iva = legacy.iva;
    if (sale.vatAmountAtSale != null) {
        const snapshot = new Decimal(sale.vatAmountAtSale.toString());
        const maxVat = total.minus(legacy.exonerado);
        if (snapshot.isFinite() && snapshot.greaterThanOrEqualTo(0) && snapshot.lessThanOrEqualTo(maxVat)) {
            iva = snapshot.toDecimalPlaces(4);
        }
    }
    return {
        fiscalRegime,
        exonerado: legacy.exonerado,
        netoGravado: total.minus(legacy.exonerado).minus(iva).toDecimalPlaces(4),
        iva,
        cuotaFija: new Decimal(0),
        total,
    };
};

// ── A1: LIBRO DE VENTAS (Excel) ─────────────────────────────────────────────
// GET /api/fiscal/libro-ventas/:month/:year
app.get('/api/fiscal/libro-ventas/:month/:year', authenticate, checkRole(FISCAL_REPORT_ROLES), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const fiscalPeriod = parseFiscalPeriod(req.params.month, req.params.year);
    if (!fiscalPeriod) return res.status(400).json({ error: 'Mes o año inválido.' });
    const { month, year } = fiscalPeriod;

    try {
        const { start, end } = fiscalMonthRange(month, year);
        const XLSX = await import('xlsx');

        const sales = await prisma.sale.findMany({
            where: { tenantId: authReq.tenantId!, createdAt: { gte: start, lt: end }, status: { not: ESTADO_ANULADA } },
            include: { customer: true },
            orderBy: { createdAt: 'asc' },
        });

        // Precisión fiscal: el desglose sale de `desglosarVentaConExoneracion`, la
        // MISMA función que usan el asiento contable y la declaración mensual.
        // Antes acá se hacía `total / 1.15` sobre la venta ENTERA, ignorando
        // `Sale.exemptTotal`: en un negocio que marca productos de canasta básica
        // como exentos (Inventory.tsx tiene el toggle), este libro declaraba IVA
        // por ventas exoneradas que nunca se le cobraron al cliente — y no cuadraba
        // con la declaración del mismo mes, que sí las respetaba.
        const rows = sales.map((s, i) => {
            const fiscalSaleDate = fiscalCivilDate(s.createdAt);
            const d = fiscalSaleSnapshotBreakdown(s);
            return {
                'N°':            i + 1,
                'Fecha':         fiscalSaleDate.shortLabel,
                'N° Factura':    s.invoiceNumber ? `${s.invoiceSeries || 'A'}-${String(s.invoiceNumber).padStart(6, '0')}` : 'CF',
                'Cliente':       s.customerName || s.customer?.name || 'Consumidor Final',
                'RUC/Cédula':    s.customer?.taxId || '---',
                'Método Pago':   s.paymentMethod,
                'Régimen':       d.fiscalRegime,
                'Exento C$':     d.exonerado.toDecimalPlaces(2).toNumber(),
                'Subtotal C$':   d.netoGravado.toDecimalPlaces(2).toNumber(),
                'IVA 15% C$':    d.iva.toDecimalPlaces(2).toNumber(),
                'Cuota Fija C$': d.cuotaFija.toDecimalPlaces(2).toNumber(),
                'Total C$':      d.total.toDecimalPlaces(2).toNumber(),
            };
        });

        // Totales (acumulados con Decimal; se convierten a number solo al escribir la celda)
        const totals = {
            'N°': '', 'Fecha': '', 'N° Factura': '', 'Cliente': 'TOTALES',
            'RUC/Cédula': '', 'Método Pago': '', 'Régimen': '',
            'Exento C$':   rows.reduce((s, r) => s.plus(r['Exento C$']), new Decimal(0)).toNumber(),
            'Subtotal C$': rows.reduce((s, r) => s.plus(r['Subtotal C$']), new Decimal(0)).toNumber(),
            'IVA 15% C$':  rows.reduce((s, r) => s.plus(r['IVA 15% C$']), new Decimal(0)).toNumber(),
            'Cuota Fija C$': rows.reduce((s, r) => s.plus(r['Cuota Fija C$']), new Decimal(0)).toNumber(),
            'Total C$':    rows.reduce((s, r) => s.plus(r['Total C$']), new Decimal(0)).toNumber(),
        };
        rows.push(totals as any);

        const ws = XLSX.utils.json_to_sheet(rows);
        ws['!cols'] = [4, 12, 14, 28, 16, 12, 14, 14, 14, 14, 14, 14].map(w => ({ wch: w }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, `Ventas ${month}-${year}`);

        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="libro-ventas-${year}-${String(month).padStart(2,'0')}.xlsx"`);
        res.send(buf);

    } catch (error) {
        console.error('Libro ventas error:', error);
        res.status(500).json({ error: 'Error generando Libro de Ventas.' });
    }
});

// ── A2: LIBRO DE COMPRAS (Excel) ─────────────────────────────────────────────
// GET /api/fiscal/libro-compras/:month/:year
app.get('/api/fiscal/libro-compras/:month/:year', authenticate, checkRole(FISCAL_REPORT_ROLES), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const fiscalPeriod = parseFiscalPeriod(req.params.month, req.params.year);
    if (!fiscalPeriod) return res.status(400).json({ error: 'Mes o año inválido.' });
    const { month, year } = fiscalPeriod;

    try {
        const { start, end } = fiscalMonthRange(month, year);
        const XLSX = await import('xlsx');

        // Mismo criterio que generateMonthlyReport (nicaTax.ts): filtrar por `date` y por
        // estado válido de compra, para que el Libro reconcilie con el crédito fiscal del
        // reporte mensual y no infle el IVA acreditable con compras no válidas.
        const purchases = await prisma.purchase.findMany({
            where: {
                tenantId: authReq.tenantId!,
                date: { gte: start, lt: end },
                documentStatus: 'POSTED',
                status: { in: [...PURCHASE_FISCAL_STATUSES] },
            },
            include: { supplier: true },
            orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        });

        // Retenciones del período para cruzar con compras (acumuladas con Decimal).
        const retentions = await prisma.fiscalRetention.findMany({
            where: { tenantId: authReq.tenantId!, period: `${year}-${String(month).padStart(2,'0')}` },
        });
        const irByPurchase = new Map<string, Decimal>();
        const imiByPurchase = new Map<string, Decimal>();
        retentions.forEach(r => {
            if (!r.purchaseId) return;
            if (r.type === 'IR_2PCT')  irByPurchase.set(r.purchaseId,  (irByPurchase.get(r.purchaseId)  || new Decimal(0)).plus(r.amount.toString()));
            if (r.type === 'IMI_1PCT') imiByPurchase.set(r.purchaseId, (imiByPurchase.get(r.purchaseId) || new Decimal(0)).plus(r.amount.toString()));
        });

        const rows = purchases.map((p, i) => {
            const fiscalInvoiceDate = fiscalCivilDate(p.date);
            const subtotalD = new Decimal(p.subtotal.toString());
            const ivaFacturadoD = new Decimal(p.tax.toString());
            const ivaD = new Decimal(p.creditableTax?.toString() ?? p.tax.toString());
            const ivaNoAcreditableD = Decimal.max(0, ivaFacturadoD.minus(ivaD)).toDecimalPlaces(2);
            const totalD    = new Decimal(p.total.toString());
            const irD       = irByPurchase.get(p.id)  || new Decimal(0);
            const imiD      = imiByPurchase.get(p.id) || new Decimal(0);
            const netoD     = totalD.minus(irD).minus(imiD).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
            return {
                'N°':              i + 1,
                'Fecha':           fiscalInvoiceDate.shortLabel,
                'N° Factura Prov.': p.invoiceNumber,
                'Proveedor':       p.supplier.name,
                'RUC Proveedor':   (p.supplier as any).ruc || '---',
                'Régimen':         normalizeFiscalRegime(p.fiscalRegimeAtPurchase),
                'Subtotal C$':     subtotalD.toNumber(),
                'IVA Facturado C$': ivaFacturadoD.toNumber(),
                'IVA Crédito C$':  ivaD.toNumber(),
                'IVA no acreditable C$': ivaNoAcreditableD.toNumber(),
                'IR Ret. 2% C$':   irD.toNumber(),
                'IMI Ret. 1% C$':  imiD.toNumber(),
                'Neto Pagado C$':  netoD.toNumber(),
                'Total Factura C$': totalD.toNumber(),
            };
        });

        const totals: any = {
            'N°': '', 'Fecha': '', 'N° Factura Prov.': '', 'Proveedor': 'TOTALES', 'RUC Proveedor': '', 'Régimen': '',
            'Subtotal C$':     rows.reduce((s, r) => s.plus(r['Subtotal C$']), new Decimal(0)).toNumber(),
            'IVA Facturado C$': rows.reduce((s, r) => s.plus(r['IVA Facturado C$']), new Decimal(0)).toNumber(),
            'IVA Crédito C$':  rows.reduce((s, r) => s.plus(r['IVA Crédito C$']), new Decimal(0)).toNumber(),
            'IVA no acreditable C$': rows.reduce((s, r) => s.plus(r['IVA no acreditable C$']), new Decimal(0)).toNumber(),
            'IR Ret. 2% C$':   rows.reduce((s, r) => s.plus(r['IR Ret. 2% C$']), new Decimal(0)).toNumber(),
            'IMI Ret. 1% C$':  rows.reduce((s, r) => s.plus(r['IMI Ret. 1% C$']), new Decimal(0)).toNumber(),
            'Neto Pagado C$':  rows.reduce((s, r) => s.plus(r['Neto Pagado C$']), new Decimal(0)).toNumber(),
            'Total Factura C$': rows.reduce((s, r) => s.plus(r['Total Factura C$']), new Decimal(0)).toNumber(),
        };
        rows.push(totals);

        const ws = XLSX.utils.json_to_sheet(rows);
        ws['!cols'] = [4, 12, 16, 28, 16, 14, 14, 14, 14, 14, 14, 14, 14, 14].map(w => ({ wch: w }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, `Compras ${month}-${year}`);

        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="libro-compras-${year}-${String(month).padStart(2,'0')}.xlsx"`);
        res.send(buf);

    } catch (error) {
        console.error('Libro compras error:', error);
        res.status(500).json({ error: 'Error generando Libro de Compras.' });
    }
});

// ── A3: ARCHIVO VET DGI (.TXT pipe-delimitado) ──────────────────────────────
// GET /api/fiscal/vet-export/:month/:year
// Formato: TIPO|FECHA|N_FACTURA|RUC_CLIENTE|NOMBRE|SUBTOTAL|IVA|TOTAL
app.get('/api/fiscal/vet-export/:month/:year', authenticate, checkRole(FISCAL_REPORT_ROLES), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const fiscalPeriod = parseFiscalPeriod(req.params.month, req.params.year);
    if (!fiscalPeriod) return res.status(400).json({ error: 'Mes o año inválido.' });
    const { month, year } = fiscalPeriod;

    try {
        const { start, end } = fiscalMonthRange(month, year);
        const period = `${year}${String(month).padStart(2, '0')}`;

        // Ventas
        const sales = await prisma.sale.findMany({
            where: { tenantId: authReq.tenantId!, createdAt: { gte: start, lt: end }, status: { not: ESTADO_ANULADA } },
            include: { customer: true },
            orderBy: { createdAt: 'asc' },
        });

        // Compras — mismo criterio que generateMonthlyReport (nicaTax.ts): `date` + estado válido.
        const purchases = await prisma.purchase.findMany({
            where: {
                tenantId: authReq.tenantId!,
                date: { gte: start, lt: end },
                documentStatus: 'POSTED',
                status: { in: [...PURCHASE_FISCAL_STATUSES] },
            },
            include: { supplier: true },
            orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        });

        const lines: string[] = [];
        // OJO: este NO es un archivo cargable en la Ventanilla Electrónica
        // Tributaria. El formato de abajo es propio de Nortex — no hay en el repo
        // ninguna referencia a una especificación publicada por la DGI. Sirve para
        // TRANSCRIBIR los montos a la VET, no para subirlos. Mientras no se
        // incorpore la spec oficial, el nombre tiene que decir la verdad: prometer
        // un archivo que la DGI rechaza quema al contador en su primer intento.
        lines.push(`# RESUMEN PARA TRANSCRIBIR A LA VET | PERIODO: ${period} | GENERADO: ${new Date().toISOString()}`);
        lines.push(`# NO es un archivo cargable en la VET: formato propio de Nortex, para transcripcion manual.`);
        lines.push(`# FORMATO: TIPO|FECHA(YYYYMMDD)|N_FACTURA|RUC|NOMBRE|EXENTO|SUBTOTAL|IVA|TOTAL`);
        lines.push('');
        lines.push('## LIBRO DE VENTAS');

        for (const s of sales) {
            // Mismo desglose que el Libro de Ventas y la declaración mensual.
            const d = fiscalSaleSnapshotBreakdown(s);
            const exentoD   = d.exonerado.toDecimalPlaces(2);
            const subtotalD = (d.fiscalRegime === FISCAL_REGIME_CUOTA_FIJA
                ? d.cuotaFija
                : d.netoGravado).toDecimalPlaces(2);
            const ivaD      = d.iva.toDecimalPlaces(2);
            const totalD    = d.total.toDecimalPlaces(2);
            const fecha    = fiscalCivilDate(s.createdAt).compact;
            const factura  = s.invoiceNumber
                ? `${s.invoiceSeries || 'A'}${String(s.invoiceNumber).padStart(6,'0')}`
                : 'CF';
            const nombre   = (s.customerName || s.customer?.name || 'CONSUMIDOR FINAL').toUpperCase().substring(0, 60);
            const rucV     = s.customer?.taxId || '000-000000-0000X';
            if (d.fiscalRegime === FISCAL_REGIME_CUOTA_FIJA) {
                lines.push(`# REGIMEN CUOTA_FIJA | FACTURA ${factura} | IVA TRASLADADO 0.00`);
            }
            lines.push(`V|${fecha}|${factura}|${rucV}|${nombre}|${exentoD.toFixed(2)}|${subtotalD.toFixed(2)}|${ivaD.toFixed(2)}|${totalD.toFixed(2)}`);
        }

        lines.push('');
        lines.push('## LIBRO DE COMPRAS');

        for (const p of purchases) {
            const totalD    = new Decimal(p.total.toString()).toDecimalPlaces(2);
            const ivaD      = new Decimal(p.creditableTax?.toString() ?? p.tax.toString()).toDecimalPlaces(2);
            // El IVA no acreditable se capitaliza; por eso el subtotal contable
            // de cuota fija es el total completo y el crédito mostrado queda en 0.
            const subtotalD = totalD.minus(ivaD).toDecimalPlaces(2);
            // La compra guarda subtotal/IVA/total por separado; lo que no cuadra
            // contra el total es la parte exenta (proveedor exonerado, canasta
            // básica). Se acota a ≥0 para que un dato inconsistente no salga en
            // negativo. Misma columna que las ventas, para que el archivo alinee.
            const exentoD = Decimal.max(0, totalD.minus(subtotalD).minus(ivaD)).toDecimalPlaces(2);
            const fecha    = fiscalCivilDate(p.date).compact;
            const nombre   = p.supplier.name.toUpperCase().substring(0, 60);
            const rucC     = (p.supplier as any).ruc || '000-000000-0000X';
            if (normalizeFiscalRegime(p.fiscalRegimeAtPurchase) === FISCAL_REGIME_CUOTA_FIJA) {
                lines.push(`# COMPRA CUOTA_FIJA | FACTURA ${p.invoiceNumber} | IVA ACREDITABLE 0.00`);
            }
            lines.push(`C|${fecha}|${p.invoiceNumber}|${rucC}|${nombre}|${exentoD.toFixed(2)}|${subtotalD.toFixed(2)}|${ivaD.toFixed(2)}|${totalD.toFixed(2)}`);
        }

        const content = lines.join('\r\n'); // CRLF como exige la VET
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="VET-${period}.txt"`);
        res.send(content);

    } catch (error) {
        console.error('VET export error:', error);
        res.status(500).json({ error: 'Error generando archivo VET.' });
    }
});

}
