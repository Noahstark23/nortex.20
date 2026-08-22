import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const purchasesSource = readFileSync(new URL('../components/Purchases.tsx', import.meta.url), 'utf8');
const reportsSource = readFileSync(new URL('../components/Reports.tsx', import.meta.url), 'utf8');
const auditSource = readFileSync(new URL('../components/AuditDashboard.tsx', import.meta.url), 'utf8');

describe('flujos fiscales del frontend', () => {
    it('Compras genera constancias vía fetch autenticado y sin anchors directos al API fiscal', () => {
        expect(purchasesSource).toContain("import { authenticatedDownload } from '../utils/authenticatedDownload'");
        expect(purchasesSource).toContain('const openRetentionCertificate = async');
        expect(purchasesSource).toContain("openInNewTab: true");
        expect(purchasesSource).not.toContain('href={`/api/fiscal/constancia-retencion/');
    });

    it('Reportes exporta libros y VET sin href directos ni alert bloqueante', () => {
        expect(reportsSource).toContain("import { authenticatedDownload } from '../utils/authenticatedDownload'");
        expect(reportsSource).toContain('const runFiscalDownload = async');
        expect(reportsSource).toContain("showToast({");
        expect(reportsSource).not.toContain('href={`/api/fiscal/libro-ventas/');
        expect(reportsSource).not.toContain('href={`/api/fiscal/libro-compras/');
        expect(reportsSource).not.toContain('href={`/api/fiscal/vet-export/');
        expect(reportsSource).not.toMatch(/\balert\s*\(/);
    });

    it('Auditoría reutiliza la descarga autenticada y muestra toast en vez de alert', () => {
        expect(auditSource).toContain("import { authenticatedDownload } from '../utils/authenticatedDownload'");
        expect(auditSource).toContain("title: 'No se pudo generar la descarga'");
        expect(auditSource).toContain('<ToastViewport toast={toast} onDismiss={dismissToast} />');
        expect(auditSource).not.toMatch(/\balert\s*\(/);
    });
});
