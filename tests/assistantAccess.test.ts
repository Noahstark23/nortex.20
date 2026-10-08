import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { assertAssistantAccess, getAssistantCapabilities } from '../backend/services/assistant/access';

const principal = { tenantId: 'tenant-a', userId: 'user-a', role: 'OWNER' };
function database(role = 'OWNER', enabled = true, assistantBudgetOwner = false) {
    const mocks = {
        user: { findFirst: vi.fn().mockResolvedValue({ id: 'user-a', role, status: 'ACTIVE', assistantBudgetOwner }) },
        employee: { findFirst: vi.fn().mockResolvedValue(null) },
        assistantTenantConfig: { findUnique: vi.fn().mockResolvedValue({ enabled, extractionEnabled: true, executionEnabled: true }) },
    };
    return { mocks, db: mocks as unknown as PrismaClient };
}

beforeEach(() => {
    vi.stubEnv('NORTEX_ASSISTANT_ENABLED', 'true');
    vi.stubEnv('NORTEX_ASSISTANT_EXTRACTION_ENABLED', 'true');
    vi.stubEnv('NORTEX_ASSISTANT_EXECUTION_ENABLED', 'true');
});
afterEach(() => vi.unstubAllEnvs());

describe('NortexGPT: acceso vigente y mínimo privilegio', () => {
    it('revocar el permiso explícito de ADMIN cambia el alcance y conserva ayuda', async () => {
        const { db, mocks } = database('ADMIN', true, true);
        const before = await getAssistantCapabilities({ ...principal, role: 'ADMIN' }, db);
        expect(before.budgetManage).toBe(true);
        mocks.user.findFirst.mockResolvedValue({ id: 'user-a', role: 'ADMIN', status: 'ACTIVE', assistantBudgetOwner: false });
        const after = await getAssistantCapabilities({ ...principal, role: 'ADMIN' }, db);
        expect(after).toMatchObject({ budgetManage: false, help: true });
        expect(after.accessScope).not.toBe(before.accessScope);
    });
    it('una ficha Employee OWNER activa o modificada no concede gestión a ADMIN', async () => {
        const { db, mocks } = database('ADMIN');
        for (const employee of [null, { id: 'employee-owner', role: 'OWNER', status: 'ACTIVE' }, { id: 'employee-owner', role: 'ADMIN', status: 'SUSPENDED' }]) {
            mocks.employee.findFirst.mockResolvedValue(employee);
            expect(await getAssistantCapabilities({ ...principal, role: 'ADMIN' }, db)).toMatchObject({ budgetManage: false, help: true, accessScope: 'ADMIN:budget:false' });
        }
        expect(mocks.employee.findFirst).not.toHaveBeenCalled();
    });
    it('ADMIN con permiso explícito no depende de una ficha Employee', async () => {
        const { db, mocks } = database('ADMIN', true, true);
        expect(await getAssistantCapabilities({ ...principal, role: 'ADMIN' }, db)).toMatchObject({ budgetManage: true, accessScope: 'ADMIN:budget:true' });
        expect(mocks.employee.findFirst).not.toHaveBeenCalled();
    });
    it('OWNER conserva gestión aunque la bandera esté apagada', async () => {
        expect(await getAssistantCapabilities(principal, database().db)).toMatchObject({ budgetManage: true, help: true });
    });
    it.each(['MANAGER', 'CASHIER', 'ACCOUNTANT', 'VIEWER'])('la bandera no convierte a %s en dueño presupuestario', async role => {
        expect(await getAssistantCapabilities({ ...principal, role }, database(role, true, true).db)).toMatchObject({ budgetManage: false, help: true });
    });
    it.each(['false', '', undefined])('apagado global %s no consulta tablas nuevas', async flag => {
        vi.stubEnv('NORTEX_ASSISTANT_ENABLED', flag);
        const { db, mocks } = database();
        expect(await getAssistantCapabilities(principal, db)).toMatchObject({ enabled: false, help: false, invoiceConfirm: false });
        expect(mocks.assistantTenantConfig.findUnique).not.toHaveBeenCalled();
    });
    it('tenant sin activación permanece bloqueado', async () => {
        const { db, mocks } = database();
        mocks.assistantTenantConfig.findUnique.mockResolvedValue(null);
        await expect(assertAssistantAccess(principal, 'help', db)).rejects.toMatchObject({ statusCode: 403, code: 'ASSISTANT_DISABLED' });
    });
    it.each(['DISABLED', 'INVITED'])('usuario %s no conserva acceso', async status => {
        const { db, mocks } = database();
        mocks.user.findFirst.mockResolvedValue({ id: 'user-a', role: 'OWNER', status });
        await expect(getAssistantCapabilities(principal, db)).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
        expect(mocks.assistantTenantConfig.findUnique).not.toHaveBeenCalled();
    });
    it('rol cambiado o tenant ajeno revoca el principal antes de consultar configuración', async () => {
        const { db, mocks } = database('CASHIER');
        await expect(getAssistantCapabilities(principal, db)).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
        expect(mocks.user.findFirst.mock.calls[0][0].where).toEqual({ id: 'user-a', tenantId: 'tenant-a' });
        mocks.user.findFirst.mockResolvedValue(null);
        await expect(getAssistantCapabilities(principal, db)).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
    });
    it.each(['OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER'])('%s puede preparar/confirmar con ambos interruptores', async role => {
        expect(await getAssistantCapabilities({ ...principal, role }, database(role).db)).toMatchObject({ help: true, overview: true, invoiceRead: true, purchasePrepare: true, invoicePrepare: true, invoiceConfirm: true });
    });
    it.each(['ACCOUNTANT', 'VIEWER', 'BODEGUERO', 'CASHIER', 'VENDEDOR', 'EMPLOYEE', 'LENDER', 'DRIVER'])('%s nunca hereda escritura de compras', async role => {
        const { db } = database(role);
        expect(await getAssistantCapabilities({ ...principal, role }, db)).toMatchObject({ help: true, invoiceRead: false, purchasePrepare: false, invoicePrepare: false, invoiceConfirm: false });
        await expect(assertAssistantAccess({ ...principal, role }, 'purchasePrepare', db)).rejects.toMatchObject({ code: 'ASSISTANT_FORBIDDEN' });
        await expect(assertAssistantAccess({ ...principal, role }, 'invoiceConfirm', db)).rejects.toMatchObject({ code: 'ASSISTANT_FORBIDDEN' });
    });
    it('rol desconocido falla cerrado', async () => {
        expect(await getAssistantCapabilities({ ...principal, role: 'ROOT' }, database('ROOT').db)).toMatchObject({ enabled: false, help: false });
    });
    it('un cambio de rol invalida datos locales aunque conserve capacidades de compras', async () => {
        const owner = await getAssistantCapabilities(principal, database().db);
        const manager = await getAssistantCapabilities({ ...principal, role: 'MANAGER' }, database('MANAGER').db);
        expect(owner.purchasePrepare).toBe(manager.purchasePrepare);
        expect(owner.accessScope).toBe('OWNER:budget:true');
        expect(manager.accessScope).toBe('MANAGER:budget:false');
    });
    it('pausar extracción conserva evidencia y deja ejecución bajo su propio interruptor', async () => {
        vi.stubEnv('NORTEX_ASSISTANT_EXTRACTION_ENABLED', 'false');
        expect(await getAssistantCapabilities(principal, database().db)).toMatchObject({ invoiceRead: true, purchasePrepare: true, invoicePrepare: false, invoiceConfirm: true });
        vi.stubEnv('NORTEX_ASSISTANT_EXECUTION_ENABLED', 'false');
        expect(await getAssistantCapabilities(principal, database().db)).toMatchObject({ invoiceRead: true, purchasePrepare: true, invoicePrepare: false, invoiceConfirm: false });
    });
    it('captura manual no depende del permiso de lectura automática de documentos del negocio', async () => {
        const { db, mocks } = database();
        mocks.assistantTenantConfig.findUnique.mockResolvedValue({ enabled: true, extractionEnabled: false, executionEnabled: false });
        await expect(assertAssistantAccess(principal, 'purchasePrepare', db)).resolves.toBeUndefined();
        expect(await getAssistantCapabilities(principal, db)).toMatchObject({ purchasePrepare: true, invoicePrepare: false, invoiceConfirm: false });
    });
    it('fallo de revalidación nunca concede capacidades', async () => {
        const { db, mocks } = database();
        mocks.user.findFirst.mockRejectedValue(new Error('DB unavailable'));
        await expect(getAssistantCapabilities(principal, db)).rejects.toThrow('DB unavailable');
        expect(mocks.assistantTenantConfig.findUnique).not.toHaveBeenCalled();
    });
});
