import type { Express } from 'express';
import { prisma as sharedPrisma } from '../lib/prisma';
import { authenticate, type AuthRequest } from '../middleware/auth';
import { checkRole } from '../middleware/checkRole';
import Decimal from 'decimal.js';
import { FISCAL_REPORT_ROLES, fiscalCivilDate, fiscalPurchaseScope, fiscalRetentionScope, parseFiscalPeriod } from '../lib/fiscalAccess';
import crypto from 'node:crypto';
import { escapeHtml, fiscalPreviewCsp } from '../lib/htmlSecurity';

/** Mantiene el contrato fiscal y sus encabezados de privacidad. */
export function registerRetentionCertificate(app: Pick<Express, 'get'>, prisma = sharedPrisma) {
app.get('/api/fiscal/constancia-retencion/:purchaseId', authenticate, checkRole(FISCAL_REPORT_ROLES), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { purchaseId } = req.params;

    try {
        // 1. Obtener la compra + proveedor
        const purchase = await prisma.purchase.findFirst({
            where: {
                ...fiscalPurchaseScope(authReq.tenantId!, purchaseId),
                documentStatus: 'POSTED',
            },
            include: { supplier: true },
        });
        if (!purchase) return res.status(404).json({ error: 'Compra no encontrada.' });

        // 2. Obtener el tenant (datos del retenedor)
        const tenant = await prisma.tenant.findUnique({
            where: { id: authReq.tenantId! },
            select: { businessName: true, taxId: true, address: true, phone: true, dgiAuthCode: true },
        });
        if (!tenant) return res.status(404).json({ error: 'Tenant no encontrado.' });

        // 3. Obtener retenciones de esta compra
        const retentions = await prisma.fiscalRetention.findMany({
            where: fiscalRetentionScope(authReq.tenantId!, purchaseId),
            orderBy: { type: 'asc' },
        });

        // Si no hay retenciones registradas, calcularlas al vuelo (documento fiscal
        // legal → precisión Decimal, sin float ni Math.round sobre montos).
        const baseAmountD = new Decimal(purchase.subtotal.toString());
        const baseAmount = baseAmountD.toNumber();
        const computedRetentions = retentions.length > 0 ? retentions : [
            { type: 'IR_2PCT',  amount: baseAmountD.mul('0.02').toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(), baseAmount },
            { type: 'IMI_1PCT', amount: baseAmountD.mul('0.01').toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(), baseAmount },
            ...(new Decimal(purchase.tax.toString()).greaterThan(0)
                ? [{
                    type: 'IVA_RETENIDO',
                    amount: new Decimal(purchase.tax.toString()).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
                    baseAmount,
                }]
                : []),
        ];

        const totalRetenido = computedRetentions
            .reduce((s, r) => s.plus(r.amount.toString()), new Decimal(0))
            .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        // `Purchase.date` es la fecha de la factura del proveedor. Es un día de
        // calendario civil de Managua, no el instante en que el usuario digitó
        // la compra ni la zona horaria accidental del proceso.
        const fiscalInvoiceDate = fiscalCivilDate(purchase.date);
        const fecha = fiscalInvoiceDate.longLabel;
        const numeroConstancia = `RET-${purchase.id.slice(-8).toUpperCase()}`;
        const period = retentions[0]?.period || fiscalInvoiceDate.period;
        const printNonce = crypto.randomBytes(18).toString('base64url');
        const previewCsp = fiscalPreviewCsp(printNonce);

        // Todos estos campos son persistidos y algunos pueden ser capturados por
        // MANAGER. La constancia se abre como HTML autenticado en un `blob:`;
        // por eso jamás se interpolan sin codificación, aunque el dato pertenezca
        // al mismo tenant.
        const safe = {
            numeroConstancia: escapeHtml(numeroConstancia),
            period: escapeHtml(period),
            fecha: escapeHtml(fecha),
            tenantBusinessName: escapeHtml(tenant.businessName),
            tenantTaxId: escapeHtml(tenant.taxId || 'Por configurar'),
            tenantAddress: escapeHtml(tenant.address || 'Por configurar'),
            tenantPhone: escapeHtml(tenant.phone || '---'),
            tenantDgiAuthCode: escapeHtml(tenant.dgiAuthCode || ''),
            supplierName: escapeHtml(purchase.supplier.name),
            supplierRuc: escapeHtml((purchase.supplier as any).ruc || 'Por registrar'),
            supplierPhone: escapeHtml((purchase.supplier as any).phone || '---'),
            invoiceNumber: escapeHtml(purchase.invoiceNumber),
        };

        const typeLabel: Record<string, string> = {
            IR_2PCT: 'Retención IR (Renta) 2%',
            IMI_1PCT: 'Retención IMI (Municipal) 1%',
            IVA_RETENIDO: 'IVA Retenido',
        };

        const retentionRows = computedRetentions.map(r => `
            <tr>
                <td>${escapeHtml(typeLabel[r.type] || r.type)}</td>
                <td class="num">C$ ${escapeHtml(Number(r.baseAmount || baseAmount).toFixed(2))}</td>
                <td class="num">${escapeHtml(r.type === 'IR_2PCT' ? '2%' : r.type === 'IMI_1PCT' ? '1%' : '15%')}</td>
                <td class="num bold">C$ ${escapeHtml(Number(r.amount).toFixed(2))}</td>
            </tr>
        `).join('');

        const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(previewCsp)}">
<title>Constancia de Retención ${safe.numeroConstancia}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 11px; color: #1a1a1a; padding: 20mm; }
  .header { text-align: center; border-bottom: 2px solid #1a1a1a; padding-bottom: 12px; margin-bottom: 16px; }
  .header h1 { font-size: 16px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; }
  .header h2 { font-size: 12px; margin-top: 4px; color: #444; }
  .numero { font-size: 13px; font-weight: bold; color: #1a56a0; margin-top: 6px; }
  .section { margin-bottom: 14px; }
  .section-title { font-size: 10px; font-weight: bold; text-transform: uppercase; color: #666; border-bottom: 1px solid #ddd; padding-bottom: 3px; margin-bottom: 8px; letter-spacing: 0.5px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; }
  .field { display: flex; flex-direction: column; }
  .field label { font-size: 9px; color: #888; text-transform: uppercase; }
  .field span { font-weight: bold; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { background: #1a56a0; color: white; padding: 6px 8px; text-align: left; font-size: 10px; }
  td { padding: 5px 8px; border-bottom: 1px solid #eee; }
  .num { text-align: right; }
  .bold { font-weight: bold; }
  .total-row td { background: #f0f4ff; font-weight: bold; border-top: 2px solid #1a56a0; }
  .footer { margin-top: 32px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
  .firma { border-top: 1px solid #1a1a1a; padding-top: 6px; text-align: center; }
  .firma p { font-size: 9px; color: #666; margin-top: 2px; }
  .legal { margin-top: 24px; font-size: 9px; color: #888; border-top: 1px solid #eee; padding-top: 8px; text-align: center; }
  .badge { display: inline-block; background: #f0f4ff; border: 1px solid #1a56a0; color: #1a56a0; padding: 2px 8px; border-radius: 4px; font-size: 9px; font-weight: bold; margin-top: 4px; }
  @media print {
    body { padding: 12mm; }
    @page { size: letter; margin: 15mm; }
    .no-print { display: none; }
  }
</style>
</head>
<body>

<div class="no-print" style="background:#1a56a0;color:white;padding:10px 16px;margin:-20mm -20mm 16px;display:flex;justify-content:space-between;align-items:center;">
  <span style="font-weight:bold;">Constancia de Retención — Vista Previa</span>
  <button id="print-document" type="button" style="background:white;color:#1a56a0;border:none;padding:6px 16px;border-radius:4px;font-weight:bold;cursor:pointer;">🖨️ Imprimir / Guardar PDF</button>
</div>

<div class="header">
  <h1>Constancia de Retención en la Fuente</h1>
  <h2>República de Nicaragua — Dirección General de Ingresos (DGI)</h2>
  <div class="numero">N° ${safe.numeroConstancia}</div>
  <div class="badge">Período: ${safe.period}</div>
</div>

<div class="section">
  <div class="section-title">Agente Retenedor (Quien retiene)</div>
  <div class="grid">
    <div class="field"><label>Razón Social</label><span>${safe.tenantBusinessName}</span></div>
    <div class="field"><label>RUC / Cédula</label><span>${safe.tenantTaxId}</span></div>
    <div class="field"><label>Dirección Fiscal</label><span>${safe.tenantAddress}</span></div>
    <div class="field"><label>Teléfono</label><span>${safe.tenantPhone}</span></div>
    ${tenant.dgiAuthCode ? `<div class="field"><label>Código Autorización DGI</label><span>${safe.tenantDgiAuthCode}</span></div>` : ''}
  </div>
</div>

<div class="section">
  <div class="section-title">Sujeto Retenido (Proveedor)</div>
  <div class="grid">
    <div class="field"><label>Razón Social / Nombre</label><span>${safe.supplierName}</span></div>
    <div class="field"><label>RUC / Cédula</label><span>${safe.supplierRuc}</span></div>
    <div class="field"><label>Teléfono</label><span>${safe.supplierPhone}</span></div>
    <div class="field"><label>N° Factura del Proveedor</label><span>${safe.invoiceNumber}</span></div>
  </div>
</div>

<div class="section">
  <div class="section-title">Detalle de la Retención</div>
  <table>
    <thead>
      <tr>
        <th>Concepto</th>
        <th style="text-align:right">Base Gravable</th>
        <th style="text-align:right">Tasa</th>
        <th style="text-align:right">Monto Retenido</th>
      </tr>
    </thead>
    <tbody>
      ${retentionRows}
      <tr class="total-row">
        <td colspan="3">TOTAL RETENIDO</td>
        <td class="num">C$ ${escapeHtml(totalRetenido.toFixed(2))}</td>
      </tr>
    </tbody>
  </table>
</div>

<div class="section">
  <div class="grid">
    <div class="field"><label>Fecha de Emisión</label><span>${safe.fecha}</span></div>
    <div class="field"><label>Monto Total Factura</label><span>C$ ${escapeHtml(Number(purchase.total).toFixed(2))}</span></div>
    <div class="field"><label>Neto a Pagar al Proveedor</label><span style="color:#1a56a0;font-size:13px;">C$ ${escapeHtml(new Decimal(purchase.total.toString()).minus(totalRetenido).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2))}</span></div>
  </div>
</div>

<div class="footer">
  <div class="firma">
    <p>_________________________________</p>
    <p><strong>Firma y Sello del Agente Retenedor</strong></p>
    <p>${safe.tenantBusinessName}</p>
  </div>
  <div class="firma">
    <p>_________________________________</p>
    <p><strong>Firma de Recibido — Proveedor</strong></p>
    <p>${safe.supplierName}</p>
  </div>
</div>

<div class="legal">
  Constancia generada por Nortex ERP. Documento válido conforme Arto. 44 LCT y Arto. 73 RLCT de Nicaragua.
  El agente retenedor está obligado a entregar esta constancia al momento de efectuar el pago.
</div>

<script nonce="${printNonce}">
  document.getElementById('print-document').addEventListener('click', function () { window.print(); });
</script>

</body>
</html>`;

        res.setHeader('Content-Security-Policy', previewCsp);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'private, no-store, max-age=0');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        res.send(html);

    } catch (error) {
        console.error('Constancia error:', error);
        res.status(500).json({ error: 'Error generando constancia.' });
    }
});

}
