import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
    FISCAL_DGI_ROLES,
    PEDIDO_READ_ROLES,
    PEDIDO_WRITE_ROLES,
    POS_SALE_ROLES,
    QUOTATION_READ_ROLES,
    QUOTATION_WRITE_ROLES,
    RETURN_SEARCH_ROLES,
} from '../backend/middleware/accessPolicies';
import { checkRole } from '../backend/middleware/checkRole';

const server = readFileSync(resolve(process.cwd(), 'backend/server.ts'), 'utf8');
const pedidos = readFileSync(resolve(process.cwd(), 'backend/routes/pedidos.ts'), 'utf8');
const sync = readFileSync(resolve(process.cwd(), 'backend/routes/sync.ts'), 'utf8');

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
    checkRole(roles)({ role }, res, next);
    return { next, res };
};

describe('matriz de autorizacion de ventas medidas y operaciones relacionadas', () => {
    it('mantiene al cajero en sync, pedidos y cotizaciones operativas', () => {
        for (const roles of [POS_SALE_ROLES, PEDIDO_READ_ROLES, PEDIDO_WRITE_ROLES, QUOTATION_READ_ROLES, QUOTATION_WRITE_ROLES]) {
            const { next, res } = runGuard(roles, 'CASHIER');
            expect(next).toHaveBeenCalledOnce();
            expect(res.status).not.toHaveBeenCalled();
        }
    });

    it('VIEWER solo lee pedidos/cotizaciones y no sincroniza ni muta', () => {
        expect(runGuard(PEDIDO_READ_ROLES, 'VIEWER').next).toHaveBeenCalledOnce();
        expect(runGuard(QUOTATION_READ_ROLES, 'VIEWER').next).toHaveBeenCalledOnce();

        for (const roles of [POS_SALE_ROLES, PEDIDO_WRITE_ROLES, QUOTATION_WRITE_ROLES, RETURN_SEARCH_ROLES]) {
            const { next, res } = runGuard(roles, 'VIEWER');
            expect(next).not.toHaveBeenCalled();
            expect(res.statusCode).toBe(403);
        }
    });

    it('la busqueda de devolucion conserva el mismo minimo privilegio que crearla', () => {
        expect(runGuard(RETURN_SEARCH_ROLES, 'OWNER').next).toHaveBeenCalledOnce();
        expect(runGuard(RETURN_SEARCH_ROLES, 'ADMIN').next).toHaveBeenCalledOnce();
        for (const role of ['MANAGER', 'CASHIER', 'EMPLOYEE', 'VENDEDOR', 'VIEWER', 'ACCOUNTANT']) {
            expect(runGuard(RETURN_SEARCH_ROLES, role).res.statusCode).toBe(403);
        }
    });

    it('carga la politica fiscal desde el modulo compartido sin declaracion tardia', () => {
        expect(runGuard(FISCAL_DGI_ROLES, 'ACCOUNTANT').next).toHaveBeenCalledOnce();
        expect(runGuard(FISCAL_DGI_ROLES, 'VIEWER').res.statusCode).toBe(403);
    });

    it('conecta los guards en las rutas protegidas sin cerrar endpoints publicos', () => {
        expect(sync).toContain("router.post('/', authenticate, checkRole(POS_SALE_ROLES)");
        expect(server).toContain("app.post('/api/sales', authenticate, checkRole(POS_SALE_ROLES)");
        expect(pedidos).toContain("router.get('/', authenticate, checkRole(PEDIDO_READ_ROLES)");
        expect(pedidos).toContain("router.get('/:id', authenticate, checkRole(PEDIDO_READ_ROLES)");
        expect(pedidos).toContain("router.patch('/:id/estado', authenticate, checkRole(PEDIDO_WRITE_ROLES)");
        expect(pedidos).toContain("router.patch('/:id/motorizado', authenticate, checkRole(PEDIDO_WRITE_ROLES)");
        expect(pedidos).toContain("router.post('/', createPedidoLimiter, async");
        expect(pedidos).toContain("router.get('/:id/tracking', async");
        expect(pedidos).not.toContain("router.post('/', createPedidoLimiter, authenticate");
        expect(pedidos).not.toContain("router.get('/:id/tracking', authenticate");

        expect(server).toContain("app.get('/api/sales/search', authenticate, checkRole(RETURN_SEARCH_ROLES)");
        expect(server).toContain("app.get('/api/quotations', authenticate, checkRole(QUOTATION_READ_ROLES)");
        expect(server).toContain("app.post('/api/quotations', authenticate, checkRole(QUOTATION_WRITE_ROLES)");
        expect(server).toContain("app.get('/api/public-orders', authenticate, checkRole(QUOTATION_READ_ROLES)");
        expect(server).toContain("app.patch('/api/public-orders/:id/convert', authenticate, checkRole(QUOTATION_WRITE_ROLES)");
        expect(server).toContain('employeeId: currentShift?.employeeId ?? null');
    });
});
