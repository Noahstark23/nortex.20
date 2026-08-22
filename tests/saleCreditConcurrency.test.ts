import { describe, expect, it, vi } from 'vitest';
import { reserveCustomerCredit } from '../backend/services/salesService';

describe('reserva atomica de credito', () => {
    it('solo aprueba una de dos cajas si juntas excederian el limite', async () => {
        let currentDebt = 0;
        const updateMany = vi.fn(async ({ where, data }: any) => {
            const eligible = where.tenantId === 'tenant-a'
                && where.id === 'customer-a'
                && currentDebt <= where.currentDebt.lte;
            if (!eligible) return { count: 0 };
            currentDebt += data.currentDebt.increment;
            return { count: 1 };
        });
        const tx = { customer: { updateMany } } as any;
        const reserve = () => reserveCustomerCredit(tx, {
            tenantId: 'tenant-a',
            customerId: 'customer-a',
            creditLimit: '100',
            amount: '60',
        });

        const results = await Promise.allSettled([reserve(), reserve()]);

        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
        expect(results.find((result) => result.status === 'rejected')).toMatchObject({
            reason: { code: 'CREDIT_LIMIT_EXCEEDED', httpStatus: 409 },
        });
        expect(currentDebt).toBe(60);
        expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                tenantId: 'tenant-a',
                id: 'customer-a',
                currentDebt: { lte: 40 },
            }),
        }));
    });
});
