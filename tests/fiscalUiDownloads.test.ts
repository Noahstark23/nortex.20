import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');
const purchases = source('components/Purchases.tsx');
const reports = source('components/Reports.tsx');
const audit = source('components/AuditDashboard.tsx');

describe('contrato UI de documentos fiscales protegidos', () => {
    it('nunca navega directamente a endpoints Bearer con anchors', () => {
        for (const component of [purchases, reports, audit]) {
            expect(component).not.toMatch(/href=\{`\/api\/fiscal\//);
            expect(component).not.toMatch(/href=["']\/api\/fiscal\//);
            expect(component).not.toMatch(/\balert\s*\(/);
        }
    });

    it('abre la constancia autenticada con preview, loading y toast', () => {
        expect(purchases).toContain('openAuthenticatedPreview(`/api/fiscal/constancia-retencion/${purchaseId}`');
        expect(purchases).toContain('openingRetentionId');
        expect(purchases).toContain('No se pudo abrir la constancia');
        expect(purchases).toContain('<ToastViewport toast={toast} onDismiss={dismissToast} />');
    });

    it('implementa el DMI real para el período del dashboard y el selector de Contador', () => {
        expect(reports).toContain('fiscalPeriodFromDate(dates.endDate)');
        expect(reports).toContain('`/api/tax-report/dmi?month=${month}&year=${year}`');
        expect(reports).toContain('report.dmiReport');
        expect(reports).toContain('new Blob([report.dmiReport]');
        expect(reports).toContain('Descargar DMI (.txt)');
        expect(reports).not.toContain('Esta funcionalidad se conectara a un generador de XLSX');
    });

    it('conserva el Excel de cantidades medidas junto a las descargas DGI', () => {
        expect(reports).toContain("buildMeasuredReportExportRows(salesData.quantityBreakdown)");
        expect(reports).toContain("XLSX.writeFile(workbook, `Cantidades_vendidas_${dates.startDate}_${dates.endDate}.xlsx`)");
        expect(reports).toContain('Descargar cantidades (.xlsx)');
        expect(reports).toContain('Cantidad exacta');
    });

    it('no expone controles fiscales a cajeros ni vendedores', () => {
        expect(reports).toContain("new Set(['OWNER', 'ADMIN', 'ACCOUNTANT'])");
        expect(reports).toContain('FISCAL_REPORT_ROLES.has(currentSessionRole())');
        expect(reports).toContain("activeTab === 'CONTADOR' && canAccessFiscalDocuments");
        expect(reports.match(/\{canAccessFiscalDocuments && \(/g)?.length).toBeGreaterThanOrEqual(3);
        expect(reports).not.toMatch(/FISCAL_REPORT_ROLES[^\n]+CASHIER/);
        expect(reports).not.toMatch(/FISCAL_REPORT_ROLES[^\n]+SELLER/);

        expect(purchases).toContain("new Set(['OWNER', 'ADMIN', 'ACCOUNTANT'])");
        expect(purchases).toContain('const currentRole = currentSessionRole()');
        expect(purchases).toContain('FISCAL_DOCUMENT_ROLES.has(currentRole)');
        expect(purchases.match(/\{canAccessFiscalDocuments && \(/g)?.length).toBeGreaterThanOrEqual(3);

        expect(audit).toContain("new Set(['OWNER', 'ADMIN', 'ACCOUNTANT'])");
        expect(audit).toContain('FISCAL_DOCUMENT_ROLES.has(userRole)');
        expect(audit).toContain("canAccessFiscalDocuments && userRole === 'ACCOUNTANT' ? 'fiscal' : 'feed'");
        expect(audit).toContain("tab === 'fiscal' && canAccessFiscalDocuments");
    });

    it('descarga libros y VET con el helper y reemplaza alertas fiscales por Toast', () => {
        expect(reports).toContain('downloadAuthenticatedFile(url, filename, { token })');
        expect(audit).toContain('downloadAuthenticatedFile(url, filename, { token })');
        expect(reports).not.toMatch(/\balert\s*\(/);
        expect(audit).not.toMatch(/\balert\s*\(/);
        expect(reports).toContain('fiscalDownloading');
        expect(audit).toContain('downloading !== null');
        expect(reports).toContain('<ToastViewport toast={toast} onDismiss={dismissToast} />');
        expect(audit).toContain('<ToastViewport toast={toast} onDismiss={dismissToast} />');
    });
});
