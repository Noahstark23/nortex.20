import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    FISCAL_REPORT_ROLES,
    fiscalCivilDate,
    fiscalPurchaseScope,
    fiscalRetentionScope,
    isFiscalReportRole,
    parseFiscalPeriod,
} from '../backend/lib/fiscalAccess';

const serverSource = readFileSync(resolve(process.cwd(), 'backend/server.ts'), 'utf8');

function sourceBetween(start: string, end: string): string {
    const from = serverSource.indexOf(start);
    const to = serverSource.indexOf(end, from + start.length);
    expect(from, `No se encontró el inicio ${start}`).toBeGreaterThanOrEqual(0);
    expect(to, `No se encontró el final ${end}`).toBeGreaterThan(from);
    return serverSource.slice(from, to);
}

describe('acceso a documentos fiscales', () => {
    it('autoriza exactamente a dueño, administrador y contador', () => {
        expect(FISCAL_REPORT_ROLES).toEqual(['OWNER', 'ADMIN', 'ACCOUNTANT']);

        for (const role of FISCAL_REPORT_ROLES) {
            expect(isFiscalReportRole(role)).toBe(true);
        }

        for (const role of ['MANAGER', 'CASHIER', 'VIEWER', 'EMPLOYEE', 'VENDEDOR', 'BODEGUERO', '', undefined]) {
            expect(isFiscalReportRole(role)).toBe(false);
        }
    });

    it('siempre combina purchaseId y tenantId en las consultas de constancia', () => {
        expect(fiscalPurchaseScope('tenant-a', 'purchase-1')).toEqual({
            id: 'purchase-1',
            tenantId: 'tenant-a',
        });
        expect(fiscalRetentionScope('tenant-a', 'purchase-1')).toEqual({
            purchaseId: 'purchase-1',
            tenantId: 'tenant-a',
        });

        expect(fiscalPurchaseScope('tenant-b', 'purchase-1')).not.toEqual(
            fiscalPurchaseScope('tenant-a', 'purchase-1'),
        );
    });

    it('acepta períodos fiscales completos dentro del rango soportado', () => {
        expect(parseFiscalPeriod('8', '2026')).toEqual({ month: 8, year: 2026 });
        expect(parseFiscalPeriod('08', '2020')).toEqual({ month: 8, year: 2020 });
        expect(parseFiscalPeriod('12', '2100')).toEqual({ month: 12, year: 2100 });
    });

    it('deriva día, período y etiquetas fiscales solo de Purchase.date', () => {
        const purchase = {
            date: new Date('2026-07-31T12:00:00.000Z'),
            createdAt: new Date('2026-08-22T23:59:59.000Z'),
        };

        expect(purchase.date.toISOString()).not.toBe(purchase.createdAt.toISOString());
        expect(fiscalCivilDate(purchase.date)).toEqual({
            isoDay: '2026-07-31',
            period: '2026-07',
            compact: '20260731',
            shortLabel: '31/07/2026',
            longLabel: '31 de julio de 2026',
        });
        expect(fiscalCivilDate(purchase.date).period).not.toBe('2026-08');
        expect(fiscalCivilDate(purchase.createdAt).period).toBe('2026-08');
    });

    it('mantiene en julio una venta del 1 de agosto UTC que aún es julio en Managua', () => {
        expect(fiscalCivilDate('2026-08-01T01:00:00.000Z')).toEqual({
            isoDay: '2026-07-31',
            period: '2026-07',
            compact: '20260731',
            shortLabel: '31/07/2026',
            longLabel: '31 de julio de 2026',
        });
    });

    it('rechaza una fecha fiscal inválida en vez de emitir un período corrupto', () => {
        expect(() => fiscalCivilDate('no-es-fecha')).toThrow(
            new RangeError('Fecha civil fiscal inválida.'),
        );
    });

    it('conecta constancia, Libro de Compras y VET a Purchase.date sin fuga a createdAt', () => {
        const constancia = sourceBetween(
            "app.get('/api/fiscal/constancia-retencion/:purchaseId'",
            '// ==========================================\n// 📊 SPRINT A',
        );
        expect(constancia).toContain('fiscalCivilDate(purchase.date)');
        expect(constancia).not.toContain('purchase.createdAt');

        const libroVentas = sourceBetween(
            "app.get('/api/fiscal/libro-ventas/:month/:year'",
            '// ── A2: LIBRO DE COMPRAS',
        );
        expect(libroVentas).toContain('createdAt: { gte: start, lt: end }');
        expect(libroVentas).toContain('fiscalCivilDate(s.createdAt)');
        expect(libroVentas).not.toContain('fiscalCivilDate(s.date)');

        const libroCompras = sourceBetween(
            "app.get('/api/fiscal/libro-compras/:month/:year'",
            '// ── A3: ARCHIVO VET DGI',
        );
        expect(libroCompras).toContain('date: { gte: start, lt: end }');
        expect(libroCompras).toContain(
            "orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]",
        );
        expect(libroCompras).toContain('fiscalCivilDate(p.date)');
        expect(libroCompras).not.toContain('p.createdAt');

        const vet = sourceBetween(
            "app.get('/api/fiscal/vet-export/:month/:year'",
            '// ==========================================\n// 🚀 SERVE FRONTEND',
        );
        expect(vet).toContain('date: { gte: start, lt: end }');
        expect(vet).toContain(
            "orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]",
        );
        expect(vet).toContain('fiscalCivilDate(s.createdAt).compact');
        expect(vet).toContain('fiscalCivilDate(p.date).compact');
        expect(vet).not.toContain('p.createdAt');
    });

    it('calcula también el IVA retenido cuando la constancia se genera sin filas persistidas', () => {
        const constancia = sourceBetween(
            "app.get('/api/fiscal/constancia-retencion/:purchaseId'",
            '// ==========================================\n// 📊 SPRINT A',
        );
        expect(constancia).toContain("type: 'IVA_RETENIDO'");
        expect(constancia).toContain("new Decimal(purchase.tax.toString()).greaterThan(0)");
    });

    it('recorta retenciones sufridas por mes fiscal sin depender del timezone del proceso', () => {
        const retenciones = sourceBetween(
            "app.get('/api/accounting/retenciones-sufridas'",
            '// ── B2 — Activos fijos + depreciación',
        );
        expect(retenciones).toContain('const fiscalPeriod = parseFiscalPeriod(req.query.month, req.query.year);');
        expect(retenciones).toContain("return res.status(400).json({ error: 'Periodo inválido. Usa month=1-12 y year=YYYY.' });");
        expect(retenciones).toContain('const start = normalizeCalendarDateInput(');
        expect(retenciones).toContain('where.fecha = { gte: start, lt: endExclusive }');
        expect(retenciones).not.toContain('new Date(parseInt(year), parseInt(month) - 1, 1)');
        expect(retenciones).not.toContain('new Date(parseInt(year), parseInt(month), 0, 23, 59, 59)');
    });

    it.each([
        [undefined, '2026'],
        ['8', undefined],
        ['', '2026'],
        [' 8 ', '2026'],
        ['8foo', '2026'],
        ['8.5', '2026'],
        ['0', '2026'],
        ['13', '2026'],
        ['8', '2019'],
        ['8', '2101'],
        [['8'], '2026'],
        ['8', ['2026']],
    ])('rechaza month=%j y year=%j sin aplicar defaults', (month, year) => {
        expect(parseFiscalPeriod(month, year)).toBeNull();
    });
});
