import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
    CUSTOMER_CONTACT_UPDATE_ROLES,
    CUSTOMER_CONTROL_ROLES,
    CUSTOMER_CREATE_ROLES,
    CUSTOMER_HUB_READ_ROLES,
    CUSTOMER_IDENTITY_UPDATE_ROLES,
    CUSTOMER_READ_ROLES,
    CUSTOMER_UPDATE_ROLES,
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

    it('separa el lookup básico del POS de la lectura rica de cartera', () => {
        expect(CUSTOMER_HUB_READ_ROLES).toEqual([
            'OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER', 'CASHIER', 'VIEWER', 'VENDEDOR', 'ACCOUNTANT',
        ]);
        for (const role of CUSTOMER_HUB_READ_ROLES) {
            expect(runGuard(CUSTOMER_HUB_READ_ROLES, role).next).toHaveBeenCalledOnce();
        }

        expect(runGuard(CUSTOMER_READ_ROLES, 'EMPLOYEE').next).toHaveBeenCalledOnce();
        const employeeHub = runGuard(CUSTOMER_HUB_READ_ROLES, 'EMPLOYEE');
        expect(employeeHub.next).not.toHaveBeenCalled();
        expect(employeeHub.res.statusCode).toBe(403);
    });

    it('ACCOUNTANT puede leer la CxC para conciliar retenciones sin poder crear ni mutar clientes', () => {
        expect(runGuard(CUSTOMER_HUB_READ_ROLES, 'ACCOUNTANT').next).toHaveBeenCalledOnce();

        const create = runGuard(CUSTOMER_CREATE_ROLES, 'ACCOUNTANT');
        expect(create.next).not.toHaveBeenCalled();
        expect(create.res.statusCode).toBe(403);

        const update = runGuard(CUSTOMER_UPDATE_ROLES, 'ACCOUNTANT');
        expect(update.next).not.toHaveBeenCalled();
        expect(update.res.statusCode).toBe(403);
    });

    it('EMPLOYEE conserva el selector POS pero no accede a cartera ni historiales enriquecidos', () => {
        expect(runGuard(CUSTOMER_READ_ROLES, 'EMPLOYEE').next).toHaveBeenCalledOnce();
        const portfolio = runGuard(CUSTOMER_HUB_READ_ROLES, 'EMPLOYEE');
        expect(portfolio.next).not.toHaveBeenCalled();
        expect(portfolio.res.statusCode).toBe(403);
    });

    it('preserva los lectores autorizados de cartera y rechaza bodega o roles desconocidos', () => {
        for (const role of ['OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER', 'CASHIER', 'VIEWER', 'VENDEDOR', 'ACCOUNTANT']) {
            expect(runGuard(CUSTOMER_HUB_READ_ROLES, role).next).toHaveBeenCalledOnce();
        }
        for (const role of ['BODEGUERO', 'UNKNOWN']) {
            const portfolio = runGuard(CUSTOMER_HUB_READ_ROLES, role);
            expect(portfolio.next).not.toHaveBeenCalled();
            expect(portfolio.res.statusCode).toBe(403);
        }
        const unauthenticated = runGuard(CUSTOMER_HUB_READ_ROLES, '');
        expect(unauthenticated.next).not.toHaveBeenCalled();
        expect(unauthenticated.res.statusCode).toBe(401);
    });

    it('reserva nombre y documento legal para roles administrativos', () => {
        expect(CUSTOMER_IDENTITY_UPDATE_ROLES).toEqual(['OWNER', 'ADMIN', 'SUPER_ADMIN']);
        expect(CUSTOMER_CONTACT_UPDATE_ROLES).toEqual([
            'OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER', 'VENDEDOR',
        ]);
        expect(CUSTOMER_CONTROL_ROLES).toEqual(['OWNER', 'ADMIN', 'SUPER_ADMIN']);
        expect(CUSTOMER_UPDATE_ROLES).toEqual([
            'OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER', 'VENDEDOR',
        ]);

        for (const role of ['OWNER', 'ADMIN', 'SUPER_ADMIN']) {
            expect(isCustomerUpdateAuthorized(role, {
                identity: true,
                contact: true,
                controls: true,
            })).toBe(true);
        }

        for (const role of CUSTOMER_UPDATE_ROLES) {
            expect(runGuard(CUSTOMER_UPDATE_ROLES, role).next).toHaveBeenCalledOnce();
        }
        for (const role of ['CASHIER', 'VIEWER', 'EMPLOYEE', 'ACCOUNTANT']) {
            const update = runGuard(CUSTOMER_UPDATE_ROLES, role);
            expect(update.next).not.toHaveBeenCalled();
            expect(update.res.statusCode).toBe(403);
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
        for (const path of [
            '/api/customers/hub',
            '/api/customers/:id/hub',
            '/api/credits/debtors',
            '/api/collections/worklist',
            '/api/customers/:id/statement',
        ]) {
            expect(server).toContain(`app.get('${path}', authenticate, checkRole(CUSTOMER_HUB_READ_ROLES), async`);
        }
        expect(server).toContain('function applySellerCustomerScope(authReq: AuthRequest, whereClause: Record<string, unknown>)');
        expect(server).toContain('function receivableCustomerScope(authReq: AuthRequest)');
        expect(server).toContain("where: applySellerCustomerScope(authReq, { id, tenantId })");
        expect(server).toContain('...receivableCustomerScope(authReq),');
        expect(server).toContain('const existingWhere = applySellerCustomerScope(authReq, { id, tenantId: authReq.tenantId });');

        const debtorsStart = server.indexOf("app.get('/api/credits/debtors'");
        const debtorsEnd = server.indexOf("app.get('/api/collections/worklist'", debtorsStart);
        const debtors = server.slice(debtorsStart, debtorsEnd);
        expect(debtors).toContain(
            "app.get('/api/credits/debtors', authenticate, checkRole(CUSTOMER_HUB_READ_ROLES), async",
        );
        expect(debtors).toContain('...receivableCustomerScope(authReq),');
    });

    it('falla cerrado si una cartera se reasigna durante el detalle o estado de cuenta', () => {
        const hubStart = server.indexOf("app.get('/api/customers/:id/hub'");
        const hubEnd = server.indexOf("'/api/customers/:id/interactions'", hubStart);
        const hub = server.slice(hubStart, hubEnd);
        expect(hub).toContain("authReq.role === 'VENDEDOR' ? Promise.resolve([]) : prisma.auditLog.findMany");
        expect(hub).toContain("? { customer: { sellerId: authReq.userId! } }");
        expect(hub).toContain('const stillAuthorized = await prisma.customer.findFirst({');
        expect(hub).toContain('where: customerWhere,');

        const statementStart = server.indexOf("app.get('/api/customers/:id/statement'");
        const statementEnd = server.indexOf('// POST /api/credits/payment', statementStart);
        const statement = server.slice(statementStart, statementEnd);
        expect(statement).toContain('...receivableCustomerScope(authReq),');
        expect(statement).toContain('const stillAuthorized = await prisma.customer.findFirst({');
        expect(statement).toContain('where: applySellerCustomerScope(authReq, { id, tenantId }),');
    });

    it('clasifica el payload completo y devuelve 403 antes de abrir la transaccion', () => {
        const schemaStart = server.indexOf('const UpdateCustomerSchema = z.object({');
        const schemaEnd = server.indexOf('const CreateCustomerInteractionSchema', schemaStart);
        const schema = server.slice(schemaStart, schemaEnd);
        const routeStart = server.indexOf("app.put('/api/customers/:id'");
        const routeEnd = server.indexOf("app.get('/api/sellers/:sellerId/catalog", routeStart);
        const route = server.slice(routeStart, routeEnd);
        const roleGuard = route.indexOf('checkRole(CUSTOMER_UPDATE_ROLES)');
        const validation = route.indexOf('validate(UpdateCustomerSchema)');
        const handlerBody = route.indexOf('const authReq = req as AuthRequest;');
        const permissionGuard = route.indexOf('if (!isCustomerUpdateAuthorized(authReq.role');
        const transaction = route.indexOf('await prisma.$transaction');
        const lookup = route.indexOf('await tx.customer.findFirst({ where: existingWhere })');

        expect(schema).toContain('}).refine((value) => Object.values(value).some((field) => field !== undefined), {');
        expect(schema).toContain("message: 'Indicá al menos un cambio'");
        expect(schema).toContain("path: ['_form']");
        expect(roleGuard).toBeGreaterThan(-1);
        expect(validation).toBeGreaterThan(roleGuard);
        expect(handlerBody).toBeGreaterThan(validation);
        expect(route).toContain('const wantsIdentityChange = [name, taxId].some((value) => value !== undefined);');
        expect(route).toContain('const wantsContactChange = [phone, email, address].some((value) => value !== undefined);');
        expect(route).toContain('const wantsControlChange = [creditLimit, isBlocked, isWholesale, sellerId].some((value) => value !== undefined);');
        expect(permissionGuard).toBeGreaterThan(-1);
        expect(transaction).toBeGreaterThan(permissionGuard);
        expect(lookup).toBeGreaterThan(handlerBody);
        expect(route.slice(permissionGuard, transaction)).toContain("return res.status(403).json({ error: 'No tenés permiso para actualizar este cliente' });");
        expect(route).toContain('const existingWhere = applySellerCustomerScope(authReq, { id, tenantId: authReq.tenantId });');
        expect(route).toContain('const updateResult = await tx.customer.updateMany({ where: existingWhere, data });');
        expect(route).toContain("if (updateResult.count !== 1) throw new Error('CUSTOMER_NOT_FOUND');");
        expect(route).not.toContain('tx.customer.update({ where: { id }, data });');
        expect(route).not.toContain('if (Object.keys(data).length === 0) return;');
    });
});
