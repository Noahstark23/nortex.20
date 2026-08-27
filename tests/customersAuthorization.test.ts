import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
    CUSTOMER_CONTACT_UPDATE_ROLES,
    CUSTOMER_CONTROL_ROLES,
    CUSTOMER_CREATE_ROLES,
    CUSTOMER_IDENTITY_UPDATE_ROLES,
    CUSTOMER_READ_ROLES,
    isCustomerCreateAuthorized,
    isCustomerUpdateAuthorized,
    resolveCustomerSellerIdForCreate,
} from '../backend/middleware/accessPolicies';
import { checkRole } from '../backend/middleware/checkRole';

const server = readFileSync(resolve(process.cwd(), 'backend/server.ts'), 'utf8');

const runGuard = (roles: string[], role: string) => {
    const next = vi.fn();
    const res: any = {
        statusCode: 200,
        status: vi.fn((statusCode: number) => {
            res.statusCode = statusCode;
            return res;
        }),
        json: vi.fn(),
    };
    checkRole(roles)({ role } as any, res, next);
    return { next, res };
};

describe('autorizacion del modulo de clientes', () => {
    it('VIEWER conserva lectura y nunca alta de clientes', () => {
        expect(runGuard(CUSTOMER_READ_ROLES, 'VIEWER').next).toHaveBeenCalledOnce();
        const create = runGuard(CUSTOMER_CREATE_ROLES, 'VIEWER');
        expect(create.next).not.toHaveBeenCalled();
        expect(create.res.statusCode).toBe(403);
    });

    it('roles operativos del POS mantienen lectura y alta rapida', () => {
        for (const role of ['CASHIER', 'EMPLOYEE', 'VENDEDOR', 'MANAGER']) {
            expect(runGuard(CUSTOMER_READ_ROLES, role).next).toHaveBeenCalledOnce();
            expect(runGuard(CUSTOMER_CREATE_ROLES, role).next).toHaveBeenCalledOnce();
        }
    });

    it('reserva nombre y documento legal para roles administrativos', () => {
        expect(CUSTOMER_IDENTITY_UPDATE_ROLES).toEqual(['OWNER', 'ADMIN', 'SUPER_ADMIN']);
        expect(CUSTOMER_CONTACT_UPDATE_ROLES).toEqual([
            'OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER', 'VENDEDOR',
        ]);
        expect(CUSTOMER_CONTROL_ROLES).toEqual(['OWNER', 'ADMIN', 'SUPER_ADMIN']);

        for (const role of ['OWNER', 'ADMIN', 'SUPER_ADMIN']) {
            expect(isCustomerUpdateAuthorized(role, {
                identity: true,
                contact: true,
                controls: true,
            })).toBe(true);
        }
    });

    it('separa alta basica de cupo, mayoreo y asignacion administrativa', () => {
        for (const role of ['OWNER', 'ADMIN', 'SUPER_ADMIN']) {
            expect(isCustomerCreateAuthorized(role, {
                financialControls: true,
                sellerAssignment: true,
            })).toBe(true);
        }

        for (const role of ['MANAGER', 'CASHIER', 'EMPLOYEE']) {
            expect(isCustomerCreateAuthorized(role, {
                financialControls: false,
                sellerAssignment: false,
            })).toBe(true);
            expect(isCustomerCreateAuthorized(role, {
                financialControls: true,
                sellerAssignment: false,
            })).toBe(false);
            expect(isCustomerCreateAuthorized(role, {
                financialControls: false,
                sellerAssignment: true,
            })).toBe(false);
        }

        expect(isCustomerCreateAuthorized('VENDEDOR', {
            financialControls: false,
            sellerAssignment: true,
        })).toBe(true);
        expect(resolveCustomerSellerIdForCreate('VENDEDOR', 'seller-auth', 'seller-ajeno')).toBe('seller-auth');
        expect(resolveCustomerSellerIdForCreate('MANAGER', 'manager-auth', 'seller-1')).toBeUndefined();
        expect(resolveCustomerSellerIdForCreate('ADMIN', 'admin-auth', 'seller-1')).toBe('seller-1');
    });

    it('rechaza un alta mixta sensible antes de validar o persistir el cliente', () => {
        expect(isCustomerCreateAuthorized('VENDEDOR', {
            financialControls: true,
            sellerAssignment: true,
        })).toBe(false);

        const routeStart = server.indexOf("app.post('/api/customers'");
        const routeEnd = server.indexOf("app.get('/api/customers'", routeStart);
        const route = server.slice(routeStart, routeEnd);
        const permissionGuard = route.indexOf('if (!isCustomerCreateAuthorized(authReq.role');
        const transaction = route.indexOf('await prisma.$transaction');

        expect(permissionGuard).toBeGreaterThan(-1);
        expect(transaction).toBeGreaterThan(permissionGuard);
        expect(route.slice(permissionGuard, transaction)).toContain("return res.status(403).json({ error: 'No tenés permiso para crear clientes con controles administrativos' });");
        expect(route).toContain('const sellerId = resolveCustomerSellerIdForCreate(');
    });

    it('conserva contacto operativo pero rechaza identidad y payloads mixtos sin aplicar parcialmente', () => {
        for (const role of ['MANAGER', 'VENDEDOR']) {
            expect(isCustomerUpdateAuthorized(role, {
                identity: false,
                contact: true,
                controls: false,
            })).toBe(true);
            expect(isCustomerUpdateAuthorized(role, {
                identity: true,
                contact: false,
                controls: false,
            })).toBe(false);
            expect(isCustomerUpdateAuthorized(role, {
                identity: true,
                contact: true,
                controls: false,
            })).toBe(false);
        }

        expect(isCustomerUpdateAuthorized('MANAGER', {
            identity: false,
            contact: true,
            controls: true,
        })).toBe(false);
        expect(isCustomerUpdateAuthorized('EMPLOYEE', {
            identity: false,
            contact: true,
            controls: false,
        })).toBe(false);
    });

    it('protege clientes y cobranza con guards y scope de cartera propia', () => {
        expect(server).toContain("app.post('/api/customers', authenticate, checkRole(CUSTOMER_CREATE_ROLES), validate(CreateCustomerSchema)");
        expect(server).toContain("app.get('/api/customers', authenticate, checkRole(CUSTOMER_READ_ROLES), async");
        expect(server).toContain("app.get('/api/credits/debtors', authenticate, checkRole(CUSTOMER_READ_ROLES), async");
        expect(server).toContain('function applySellerCustomerScope(authReq: AuthRequest, whereClause: Record<string, unknown>)');
        expect(server).toContain('function receivableCustomerScope(authReq: AuthRequest)');
        expect(server).toContain("where: applySellerCustomerScope(authReq, { id, tenantId })");
        expect(server).toContain('...receivableCustomerScope(authReq),');
        expect(server).toContain('const existingWhere = applySellerCustomerScope(authReq, { id, tenantId: authReq.tenantId });');
    });

    it('clasifica el payload completo y devuelve 403 antes de abrir la transaccion', () => {
        const routeStart = server.indexOf("app.put('/api/customers/:id'");
        const routeEnd = server.indexOf("app.get('/api/sellers/:sellerId/catalog", routeStart);
        const route = server.slice(routeStart, routeEnd);
        const permissionGuard = route.indexOf('if (!isCustomerUpdateAuthorized(authReq.role');
        const transaction = route.indexOf('await prisma.$transaction');

        expect(route).toContain('const wantsIdentityChange = [name, taxId].some((value) => value !== undefined);');
        expect(route).toContain('const wantsContactChange = [phone, email, address].some((value) => value !== undefined);');
        expect(route).toContain('const wantsControlChange = [creditLimit, isBlocked, isWholesale, sellerId].some((value) => value !== undefined);');
        expect(permissionGuard).toBeGreaterThan(-1);
        expect(transaction).toBeGreaterThan(permissionGuard);
        expect(route.slice(permissionGuard, transaction)).toContain("return res.status(403).json({ error: 'No tenés permiso para actualizar este cliente' });");
        expect(route).toContain('const existingWhere = applySellerCustomerScope(authReq, { id, tenantId: authReq.tenantId });');
        expect(route).toContain('const updateResult = await tx.customer.updateMany({ where: existingWhere, data });');
        expect(route).toContain("if (updateResult.count !== 1) throw new Error('CUSTOMER_NOT_FOUND');");
        expect(route).not.toContain('tx.customer.update({ where: { id }, data });');
    });
});
