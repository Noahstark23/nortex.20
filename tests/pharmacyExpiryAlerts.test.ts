import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPharmacyExpiryAlert } from '../backend/lib/pharmacyExpiryAlerts';

const batch = (expiryDate: string, stock = '10.0000') => ({
    id: 'batch-a',
    productId: 'product-a',
    batchNumber: 'LOT-01',
    expiryDate: new Date(expiryDate),
    stock,
    product: { name: 'Amoxicilina 500 mg', sku: 'AMX-500' },
});

describe('alertas farmacéuticas de vencimiento', () => {
    const asOf = new Date('2026-08-22T18:00:00.000Z');

    it.each([
        '2026-08-22T00:00:00.000Z',
        '2026-08-22T12:00:00.000Z',
    ])('mantiene vendible el lote que vence hoy aunque esté guardado en %s', (expiryDate) => {
        expect(buildPharmacyExpiryAlert({
            batch: batch(expiryDate),
            exactBalance: { stock: '10.0000', heldStock: '3.2500' },
            pharmacyEnforced: true,
            asOf,
        })).toMatchObject({
            productName: 'Amoxicilina 500 mg',
            daysUntilExpiry: 0,
            status: 'CRITICAL',
            physicalStock: 10,
            heldStock: 3.25,
            sellableStock: 6.75,
            readinessMismatch: false,
        });
    });

    it('marca vencido y fuerza disponibilidad cero sin borrar el stock físico', () => {
        expect(buildPharmacyExpiryAlert({
            batch: batch('2026-08-21T12:00:00.000Z'),
            exactBalance: { stock: '10.0000', heldStock: '2.0000' },
            pharmacyEnforced: true,
            asOf,
        })).toMatchObject({
            daysUntilExpiry: -1,
            status: 'EXPIRED',
            physicalStock: 10,
            heldStock: 2,
            sellableStock: 0,
        });
    });

    it('falla cerrado en el DTO si ENFORCED no tiene proyección exacta', () => {
        expect(buildPharmacyExpiryAlert({
            batch: batch('2026-09-10T12:00:00.000Z'),
            pharmacyEnforced: true,
            asOf,
        })).toMatchObject({
            physicalStock: 0,
            sellableStock: 0,
            readinessMismatch: true,
        });
    });

    it('en OFF conserva el alias stock histórico y no inventa retenciones', () => {
        expect(buildPharmacyExpiryAlert({
            batch: batch('2026-09-10T12:00:00.000Z', '4.5000'),
            pharmacyEnforced: false,
            asOf,
        })).toMatchObject({
            stock: 4.5,
            physicalStock: 4.5,
            heldStock: 0,
            sellableStock: 4.5,
            readinessMismatch: false,
        });
    });

    it('clasifica UPCOMING cuando faltan más de 30 días exactos', () => {
        expect(buildPharmacyExpiryAlert({
            batch: batch('2026-09-22T12:00:00.000Z', '4.5000'),
            pharmacyEnforced: false,
            asOf,
        })).toMatchObject({
            daysUntilExpiry: 31,
            status: 'UPCOMING',
            sellableStock: 4.5,
        });
    });

    it('mantiene CRITICAL en el borde exacto de 30 días', () => {
        expect(buildPharmacyExpiryAlert({
            batch: batch('2026-09-21T12:00:00.000Z', '4.5000'),
            pharmacyEnforced: false,
            asOf,
        })).toMatchObject({
            daysUntilExpiry: 30,
            status: 'CRITICAL',
            sellableStock: 4.5,
        });
    });

    it('falla cerrado por campo exacto ausente sin lanzar al calcular físico y retenido', () => {
        expect(buildPharmacyExpiryAlert({
            batch: batch('2026-09-10T12:00:00.000Z'),
            exactBalance: { heldStock: '2.0000' } as any,
            pharmacyEnforced: true,
            asOf,
        })).toMatchObject({
            physicalStock: 0,
            heldStock: 2,
            sellableStock: 0,
            readinessMismatch: true,
        });

        expect(buildPharmacyExpiryAlert({
            batch: batch('2026-09-10T12:00:00.000Z'),
            exactBalance: { stock: '7.0000' } as any,
            pharmacyEnforced: true,
            asOf,
        })).toMatchObject({
            physicalStock: 7,
            heldStock: 0,
            sellableStock: 7,
            readinessMismatch: true,
        });
    });

    it('marca mismatch cuando el balance exacto discrepa del legado aunque exista proyección', () => {
        expect(buildPharmacyExpiryAlert({
            batch: batch('2026-09-10T12:00:00.000Z', '10.0000'),
            exactBalance: { stock: '9.5000', heldStock: '1.2500' },
            pharmacyEnforced: true,
            asOf,
        })).toMatchObject({
            physicalStock: 9.5,
            heldStock: 1.25,
            sellableStock: 8.25,
            readinessMismatch: true,
        });
    });

    it('mantiene contrato tenant-scoped y UI libre de drift horario', () => {
        const server = readFileSync(resolve(process.cwd(), 'backend/server.ts'), 'utf8');
        const dashboard = readFileSync(resolve(process.cwd(), 'components/Dashboard.tsx'), 'utf8');
        const start = server.indexOf("app.get('/api/inventory/expiring-soon'");
        const end = server.indexOf("app.get('/api/inventory/low-stock'", start);
        const route = server.slice(start, end);

        expect(route).toContain('tenantId: authReq.tenantId');
        expect(route).toContain('expiryDate: { lt: horizonExclusive }');
        expect(route).toContain("_sum: { stock: true, heldStock: true }");
        expect(route).toContain('buildPharmacyExpiryAlert({');
        expect(dashboard).toContain("batch.status === 'EXPIRED'");
        expect(dashboard).toContain('batch.productName');
        expect(dashboard).toContain("timeZone: 'UTC'");
    });
});
