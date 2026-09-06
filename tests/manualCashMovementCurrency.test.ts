import { describe, expect, it, vi } from 'vitest';
import { CreateCashMovementSchema, validate } from '../backend/validation/schemas';

const movement = (overrides: Record<string, unknown> = {}) => ({
    type: 'OUT', amount: '10.00', category: 'GASTO_OPERATIVO',
    description: 'Movimiento manual de prueba', ...overrides,
});

function validateRequest(body: unknown) {
    const req = { body };
    const res: any = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    const next = vi.fn();
    validate(CreateCashMovementSchema)(req as any, res, next);
    return { req, res, next };
}

describe('moneda e importe de movimientos manuales de caja', () => {
    it('conserva NIO predeterminado para clientes anteriores que no envían moneda', () => {
        expect(CreateCashMovementSchema.parse(movement())).toMatchObject({ currency: 'NIO', amount: '10.00' });
    });

    it.each(['NIO', 'USD'])('la validación conserva %s para que el handler decida sin cambiar la moneda', currency => {
        const { req, res, next } = validateRequest(movement({ currency }));
        expect(next).toHaveBeenCalledOnce();
        expect(req.body).toMatchObject({ currency, amount: '10.00' });
        expect(res.status).not.toHaveBeenCalled();
    });

    it.each(['EUR', '', null, 1])('rechaza moneda inválida %j antes de llegar al handler', currency => {
        const { res, next } = validateRequest(movement({ currency }));
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            details: expect.objectContaining({ currency: expect.any(Array) }),
        }));
    });

    it.each(['0.01', '10.20', '99999999.99'])('acepta importe persistible de dos decimales: %s', amount => {
        expect(CreateCashMovementSchema.parse(movement({ amount, currency: 'NIO' })).amount).toBe(amount);
    });

    it.each(['0.001', '10.001', '100000000', '99999999.999'])('rechaza %s sin redondearlo al almacenamiento', amount => {
        const { res, next } = validateRequest(movement({ amount, currency: 'NIO' }));
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            details: expect.objectContaining({ amount: expect.any(Array) }),
        }));
    });
});
