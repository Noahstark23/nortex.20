import { describe, expect, it, vi } from 'vitest';
import { checkRole, ROLE_PERMISSIONS } from '../backend/middleware/checkRole';

function responseDouble() {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    return { status, json };
}

describe('checkRole — BODEGUERO no es un superusuario', () => {
    it('pasa solo cuando la operación lo incluye explícitamente', () => {
        const next = vi.fn();
        const res = responseDouble();

        checkRole(['OWNER', 'ADMIN', 'BODEGUERO'])({ role: 'BODEGUERO' } as any, res, next);

        expect(next).toHaveBeenCalledOnce();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('recibe 403 en una operación reservada al dueño', () => {
        const next = vi.fn();
        const res = responseDouble();

        checkRole(['OWNER', 'ADMIN'])({ role: 'BODEGUERO' } as any, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
    });

    it('no hereda permisos financieros ni administrativos', () => {
        const permissions = ROLE_PERMISSIONS.BODEGUERO;
        expect(permissions).toContain('inventory:write');
        expect(permissions).toContain('purchase-orders:receive');
        expect(permissions).not.toContain('*');
        expect(permissions).not.toContain('purchases:read');
        expect(permissions).not.toContain('reports:read');
        expect(permissions).not.toContain('pos:write');
    });
});
