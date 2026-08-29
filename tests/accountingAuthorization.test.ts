import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
    ACCOUNTING_READ_ROLES,
    FISCAL_DGI_ROLES,
} from '../backend/middleware/accessPolicies';
import { checkRole } from '../backend/middleware/checkRole';

const server = readFileSync(resolve(process.cwd(), 'backend/server.ts'), 'utf8');

function runGuard(role: string) {
    const next = vi.fn();
    const res: any = {
        statusCode: 200,
        status: vi.fn((statusCode: number) => {
            res.statusCode = statusCode;
            return res;
        }),
        json: vi.fn(),
    };
    checkRole(ACCOUNTING_READ_ROLES)({ role } as any, res, next);
    return { next, res };
}

describe('autorizacion de lecturas contables y fiscales', () => {
    it('conserva acceso a dueño, administración, superadmin y contador', () => {
        expect(ACCOUNTING_READ_ROLES).toEqual([
            'OWNER', 'ADMIN', 'SUPER_ADMIN', 'ACCOUNTANT',
        ]);
        expect(FISCAL_DGI_ROLES).toBe(ACCOUNTING_READ_ROLES);

        for (const role of ACCOUNTING_READ_ROLES) {
            const { next, res } = runGuard(role);
            expect(next).toHaveBeenCalledOnce();
            expect(res.status).not.toHaveBeenCalled();
        }
    });

    it('rechaza roles operativos aunque tengan una sesión válida', () => {
        for (const role of ['MANAGER', 'CASHIER', 'VIEWER', 'EMPLOYEE', 'VENDEDOR', 'BODEGUERO']) {
            const { next, res } = runGuard(role);
            expect(next).not.toHaveBeenCalled();
            expect(res.statusCode).toBe(403);
        }
    });

    it.each([
        '/api/accounting/balance-general',
        '/api/accounting/estado-resultados',
        '/api/accounting/chart',
        '/api/accounting/journal',
        '/api/accounting/libro-diario/:year/:month',
        '/api/accounting/libro-mayor/:year/:month',
        '/api/accounting/periods',
        '/api/accounting/tax-config',
        '/api/accounting/retenciones-sufridas',
        '/api/accounting/fixed-assets',
        '/api/accounting/cierre-mensual/:year/:month',
        '/api/accounting/aging',
        '/api/accounting/flujo-efectivo/:year/:month',
        '/api/accounting/retentions/:period',
        '/api/fiscal/renta-anual/:year',
    ])('conecta la política central antes del handler GET %s', (path) => {
        expect(server).toContain(
            `app.get('${path}', authenticate, checkRole(ACCOUNTING_READ_ROLES), async`,
        );
    });

    it('mantiene el tipo de cambio operativo disponible para el POS', () => {
        expect(server).toContain(
            "app.get('/api/accounting/exchange-rate/latest', authenticate, async",
        );
    });

    it('expone conflicto de período cerrado sin regenerar retenciones por otra ruta', () => {
        const retentionStart = server.indexOf("app.post('/api/accounting/retentions'");
        const retentionEnd = server.indexOf("app.get('/api/accounting/retentions/:period'", retentionStart);
        const retentionRoute = server.slice(retentionStart, retentionEnd);
        expect(retentionRoute).toContain('error instanceof PeriodLockedError');
        expect(retentionRoute).toContain("code: 'PERIOD_LOCKED'");
        expect(retentionRoute).toContain('res.status(409)');

        const closeStart = server.indexOf("app.post('/api/accounting/fiscal-close'");
        const closeEnd = server.indexOf("app.post('/api/accounting/annual-close'", closeStart);
        const closeRoute = server.slice(closeStart, closeEnd);
        expect(closeRoute).toContain('error instanceof PeriodLockedError');
        expect(closeRoute).toContain("code: 'PERIOD_LOCKED'");
        expect(closeRoute).toContain('res.status(409)');
    });
});
