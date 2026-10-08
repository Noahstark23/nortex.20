import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
    PURCHASE_PAYMENT_ROLES,
    PURCHASE_ORDER_READ_ROLES,
    PURCHASE_ORDER_RECEIVE_ROLES,
    PURCHASE_READ_ROLES,
    PURCHASE_WRITE_ROLES,
    SUPPLIER_CREDIT_NOTE_READ_ROLES,
    SUPPLIER_CREDIT_NOTE_WRITE_ROLES,
    SUPPLIER_READ_ROLES,
    SUPPLIER_RETURN_READ_ROLES,
    SUPPLIER_RETURN_WRITE_ROLES,
    SUPPLIER_WRITE_ROLES,
} from '../backend/middleware/accessPolicies';
import { checkRole } from '../backend/middleware/checkRole';
import { buildNavigation } from '../utils/navigation';

const server = readFileSync(resolve(process.cwd(), 'backend/server.ts'), 'utf8');
const purchaseOrdersRoute = readFileSync(resolve(process.cwd(), 'backend/routes/purchaseOrders.ts'), 'utf8');

function authorize(roles: string[], role: string) {
    const next = vi.fn();
    const res: any = {
        statusCode: 200,
        status: vi.fn((statusCode: number) => {
            res.statusCode = statusCode;
            return res;
        }),
        json: vi.fn(),
    };
    checkRole(roles)({ role }, res, next);
    return { next, res };
}

describe('autorización de compras y proveedores', () => {
    it('permite lectura a gestión, auditoría y contabilidad, pero no al POS básico', () => {
        for (const roles of [SUPPLIER_READ_ROLES, PURCHASE_READ_ROLES]) {
            for (const role of ['OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER', 'VIEWER', 'ACCOUNTANT']) {
                expect(authorize(roles, role).next).toHaveBeenCalledOnce();
            }
            for (const role of ['CASHIER', 'EMPLOYEE', 'VENDEDOR', 'BODEGUERO']) {
                expect(authorize(roles, role).res.statusCode).toBe(403);
            }
        }
    });

    it('reserva cambios de proveedor a administración', () => {
        for (const role of ['OWNER', 'ADMIN', 'SUPER_ADMIN']) {
            expect(authorize(SUPPLIER_WRITE_ROLES, role).next).toHaveBeenCalledOnce();
        }
        for (const role of ['MANAGER', 'VIEWER', 'ACCOUNTANT', 'CASHIER', 'EMPLOYEE', 'VENDEDOR']) {
            expect(authorize(SUPPLIER_WRITE_ROLES, role).res.statusCode).toBe(403);
        }
    });

    it('permite pagar CxP a gestión y contabilidad, nunca a roles de solo lectura o caja POS', () => {
        for (const role of ['OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER', 'ACCOUNTANT']) {
            expect(authorize(PURCHASE_PAYMENT_ROLES, role).next).toHaveBeenCalledOnce();
        }
        for (const role of ['VIEWER', 'CASHIER', 'EMPLOYEE', 'VENDEDOR', 'BODEGUERO']) {
            expect(authorize(PURCHASE_PAYMENT_ROLES, role).res.statusCode).toBe(403);
        }
    });

    it('reserva el ingreso de inventario de una compra a gestión', () => {
        for (const role of ['OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER']) {
            expect(authorize(PURCHASE_WRITE_ROLES, role).next).toHaveBeenCalledOnce();
        }
        for (const role of ['VIEWER', 'ACCOUNTANT', 'CASHIER', 'EMPLOYEE', 'VENDEDOR', 'BODEGUERO']) {
            expect(authorize(PURCHASE_WRITE_ROLES, role).res.statusCode).toBe(403);
        }
    });

    it('órdenes de compra permiten lectura/recepción de bodega sin abrirse al POS ni a vendedores', () => {
        for (const role of ['OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER', 'VIEWER', 'ACCOUNTANT', 'BODEGUERO']) {
            expect(authorize(PURCHASE_ORDER_READ_ROLES, role).next).toHaveBeenCalledOnce();
        }
        for (const role of ['CASHIER', 'EMPLOYEE', 'VENDEDOR']) {
            expect(authorize(PURCHASE_ORDER_READ_ROLES, role).res.statusCode).toBe(403);
            expect(authorize(PURCHASE_ORDER_RECEIVE_ROLES, role).res.statusCode).toBe(403);
        }
        for (const role of ['OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER', 'BODEGUERO']) {
            expect(authorize(PURCHASE_ORDER_RECEIVE_ROLES, role).next).toHaveBeenCalledOnce();
        }

        expect(purchaseOrdersRoute).toContain(
            "router.get('/', authenticate, checkRole(PURCHASE_ORDER_READ_ROLES)",
        );
        expect(purchaseOrdersRoute).toContain(
            "router.get('/:id', authenticate, checkRole(PURCHASE_ORDER_READ_ROLES)",
        );
        expect(purchaseOrdersRoute).toContain("supplier: { select: { id: true, name: true } }");
    });

    it('separa devolucion fisica de nota de credito financiera', () => {
        expect(SUPPLIER_CREDIT_NOTE_READ_ROLES).toBe(SUPPLIER_READ_ROLES);
        expect(SUPPLIER_RETURN_WRITE_ROLES).toBe(PURCHASE_ORDER_RECEIVE_ROLES);

        for (const role of ['OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER', 'VIEWER', 'ACCOUNTANT', 'BODEGUERO']) {
            expect(authorize(SUPPLIER_RETURN_READ_ROLES, role).next).toHaveBeenCalledOnce();
        }
        for (const role of ['CASHIER', 'EMPLOYEE', 'VENDEDOR']) {
            expect(authorize(SUPPLIER_RETURN_READ_ROLES, role).res.statusCode).toBe(403);
        }

        for (const role of ['OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER', 'BODEGUERO']) {
            expect(authorize(SUPPLIER_RETURN_WRITE_ROLES, role).next).toHaveBeenCalledOnce();
        }
        for (const role of ['VIEWER', 'ACCOUNTANT', 'CASHIER', 'EMPLOYEE', 'VENDEDOR']) {
            expect(authorize(SUPPLIER_RETURN_WRITE_ROLES, role).res.statusCode).toBe(403);
        }

        for (const role of ['OWNER', 'ADMIN', 'SUPER_ADMIN', 'ACCOUNTANT']) {
            expect(authorize(SUPPLIER_CREDIT_NOTE_WRITE_ROLES, role).next).toHaveBeenCalledOnce();
        }
        for (const role of ['MANAGER', 'VIEWER', 'BODEGUERO', 'CASHIER', 'EMPLOYEE', 'VENDEDOR']) {
            expect(authorize(SUPPLIER_CREDIT_NOTE_WRITE_ROLES, role).res.statusCode).toBe(403);
        }
    });

    it('no muestra compras ni proveedores a roles sin endpoint autorizado', () => {
        for (const role of ['CASHIER', 'EMPLOYEE']) {
            const navigation = buildNavigation({ tenantType: 'RETAIL', role, simple: false });
            const paths = [...navigation.primary, ...navigation.more].map((item) => item.path);
            expect(paths).not.toContain('/app/purchases');
            expect(paths).not.toContain('/app/purchase-orders');
            expect(paths).not.toContain('/app/suppliers');
        }

        for (const role of ['OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER', 'VIEWER', 'ACCOUNTANT']) {
            const navigation = buildNavigation({ tenantType: 'RETAIL', role, simple: false });
            const paths = [...navigation.primary, ...navigation.more].map((item) => item.path);
            expect(paths).toContain('/app/purchases');
            expect(paths).toContain('/app/purchase-orders');
            expect(paths).toContain('/app/suppliers');
        }
    });

    it('conecta las políticas a compras y deja Capital bloqueado antes de cualquier efecto', () => {
        expect(server).toContain("'/api/purchases',\n    authenticate,\n    checkRole(PURCHASE_READ_ROLES)");
        expect(server).toContain("'/api/purchases/:id/pay',\n    authenticate,\n    checkRole(PURCHASE_PAYMENT_ROLES)");
        expect(server).toContain("app.post('/api/purchases', authenticate, checkRole(PURCHASE_WRITE_ROLES)");
        expect(server).toContain("app.get('/api/purchases/pending', authenticate, checkRole(PURCHASE_PAYMENT_ROLES)");

        const capitalStart = server.indexOf("'/api/capital/finance-purchase'");
        const capitalEnd = server.indexOf('// ==========================================\n// 📊 SALUD FINANCIERA', capitalStart);
        expect(capitalStart).toBeGreaterThan(-1);
        expect(capitalEnd).toBeGreaterThan(capitalStart);
        const capitalRoute = server.slice(capitalStart, capitalEnd);
        expect(capitalRoute).toContain("checkRole(['OWNER', 'ADMIN', 'SUPER_ADMIN'])");
        expect(capitalRoute).toContain("return res.status(409).json({");
        expect(capitalRoute).toContain("code: 'CAPITAL_PURCHASE_REQUIRES_RECEIPT_WORKFLOW'");
        expect(capitalRoute).not.toContain('prisma.$transaction');
        expect(capitalRoute).not.toContain('purchase.create');
        expect(capitalRoute).not.toContain('capitalLoan.create');
    });
});
