import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeSaleWithResult = vi.hoisted(() => vi.fn());

vi.mock('../backend/middleware/auth', () => ({
    authenticate: (req: any, _res: any, next: () => void) => {
        req.tenantId = 'tenant-a';
        req.userId = 'user-a';
        req.role = 'CASHIER';
        next();
    },
}));

vi.mock('../backend/middleware/checkRole', () => ({
    checkRole: () => (_req: any, _res: any, next: () => void) => next(),
}));

vi.mock('../backend/services/salesService.js', () => ({
    SaleError: class SaleError extends Error {
        constructor(
            public readonly code: string,
            public readonly httpStatus: number,
            message: string,
        ) {
            super(message);
        }
    },
    executeSaleWithResult,
}));

import syncRouter from '../backend/routes/sync';

const sale = (userId: string | undefined) => ({
    offlineId: 'offline-route-identity',
    tenantId: 'tenant-a',
    ...(userId === undefined ? {} : { userId }),
    shiftId: 'shift-a',
    employeeId: null,
    customerName: 'Cliente General',
    customerId: null,
    paymentMethod: 'CASH',
    globalDiscount: '0',
    createdAt: '2026-08-22T12:00:00.000Z',
    items: [{ id: 'product-1', quantity: '1', price: '10' }],
});

const invokeSync = (body: unknown): Promise<{ status: number; body: any }> => new Promise((resolve, reject) => {
    const req: any = {
        method: 'POST',
        url: '/',
        originalUrl: '/',
        headers: {},
        body,
    };
    const res: any = {
        statusCode: 200,
        status(code: number) {
            this.statusCode = code;
            return this;
        },
        json(payload: unknown) {
            resolve({ status: this.statusCode, body: payload });
            return this;
        },
    };
    (syncRouter as any).handle(req, res, (error?: unknown) => {
        reject(error ?? new Error('La ruta terminó sin responder'));
    });
});

describe('identidad HTTP del sync offline', () => {
    beforeEach(() => {
        executeSaleWithResult.mockReset();
        executeSaleWithResult.mockResolvedValue({
            sale: { id: 'sale-created' },
            idempotentReplay: false,
        });
    });

    it('no reatribuye al JWT una fila que declara otro userId', async () => {
        const response = await invokeSync({ sales: [sale('user-atacante')] });

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
            processed: 0,
            reconciliationRequired: 1,
            failed: 0,
            results: [{
                offlineId: 'offline-route-identity',
                status: 'reconciliation_required',
                code: 'RECONCILIATION_REQUIRED',
            }],
        });
        expect(executeSaleWithResult).not.toHaveBeenCalled();
    });

    it.each([
        ['identidad coincidente', 'user-a'],
        ['fila legacy sin userId', undefined],
    ])('usa tenant y usuario autenticados para %s', async (_case, rowUserId) => {
        const response = await invokeSync({ sales: [sale(rowUserId)] });

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({ processed: 1, reconciliationRequired: 0, failed: 0 });
        expect(executeSaleWithResult).toHaveBeenCalledWith(
            'tenant-a',
            'user-a',
            'shift-a',
            expect.objectContaining({
                offlineId: 'offline-route-identity',
                source: 'OFFLINE_SYNC',
            }),
            expect.objectContaining({ offlineSync: true }),
        );
    });
});
