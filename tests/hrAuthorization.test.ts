import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { HR_READ_ROLES } from '../backend/middleware/accessPolicies';
import { checkRole } from '../backend/middleware/checkRole';

const guard = (role: string) => {
    const next = vi.fn();
    const res: any = { statusCode: 200, json: vi.fn() };
    res.status = vi.fn((code: number) => { res.statusCode = code; return res; });
    checkRole(HR_READ_ROLES)({ role } as any, res, next);
    return { next, res };
};

describe('lecturas de expedientes y nómina de terceros', () => {
    it.each(['OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER', 'ACCOUNTANT'])('conserva la lectura gerencial de %s', role => {
        expect(guard(role).next).toHaveBeenCalledOnce();
    });
    it.each(['EMPLOYEE', 'CASHIER', 'VENDEDOR', 'VIEWER', 'BODEGUERO', 'UNKNOWN'])('deniega salarios y cédulas de terceros a %s', role => {
        const result = guard(role);
        expect(result.next).not.toHaveBeenCalled();
        expect(result.res.statusCode).toBe(403);
    });
    it('sin identidad falla con 401', () => {
        const result = guard('');
        expect(result.next).not.toHaveBeenCalled();
        expect(result.res.statusCode).toBe(401);
    });
    it('protege las tres lecturas enriquecidas y conserva el autoservicio propio', () => {
        const server = readFileSync(resolve(process.cwd(), 'backend/server.ts'), 'utf8');
        for (const path of ['/api/payroll/aguinaldo/:year', '/api/hrm/settlement-preview/:employeeId', '/api/hrm/dashboard/:year/:month']) {
            expect(server.includes(`app.get('${path}', authenticate, checkRole(HR_READ_ROLES), async`), `guard de ${path}`).toBe(true);
        }
        expect(server).toContain("app.get('/api/me/payrolls', authenticate, async");
        expect(server).toContain('where: { tenantId: authReq.tenantId!, userId: authReq.userId! }');
    });
});
