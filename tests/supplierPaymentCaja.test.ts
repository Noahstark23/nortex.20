import { describe, expect, it, vi } from 'vitest';
import Decimal from 'decimal.js';
import {
    evaluarPagoContraCaja,
    efectivoDisponibleDelTurno,
    pagarFacturaProveedorEnCaja,
    registrarSalidaDeCajaPorCompra,
    SupplierPaymentError,
    MENSAJE_SIN_CAJA_ABIERTA,
    CATEGORIA_PAGO_PROVEEDOR,
    CATEGORIA_COMPRA_CONTADO,
    PagoProveedorDeps,
} from '../backend/services/supplierPayment';

/**
 * REGRESIÓN — "SALDO_INSUFICIENTE: disponible C$ 0.00 … Recarga tu billetera".
 *
 * Pagar una factura de proveedor debitaba `Tenant.walletBalance` (la billetera
 * FINTECH del marketplace B2B, que ninguna PyME tiene fondeada) en vez de la
 * gaveta del turno abierto — con el modal prometiendo "se descontará de tu
 * caja". Y el pago no posteaba asiento: la CxP (2.1.1) abierta por la compra a
 * crédito quedaba viva para siempre en el mayor.
 *
 * Lo que estos casos defienden:
 *   · el débito va a la CAJA del turno y NUNCA toca `tenant.walletBalance`;
 *   · sin caja abierta el mensaje DICE que falta abrir caja;
 *   · factura PAID + movimiento de caja + asiento salen en la MISMA tx;
 *   · doble-click no debita dos veces;
 *   · la compra de contado NO postea el asiento genérico de salida de caja
 *     (`recordPurchase` ya acredita Caja: sería doble crédito + CxP fantasma).
 *
 * Los casos se arman DENTRO de cada `it`: Stryker activa el mutante en runtime.
 */

type FilaMovimiento = { type: string; amount: string; currency: string | null; category: string };

/** Doble de `Prisma.TransactionClient` con el mínimo que toca el servicio. */
function txFalso(estado: {
    turno?: { id: string; initialCash: string } | null;
    ventasEfectivo?: string[];
    movimientos?: FilaMovimiento[];
    facturasMarcadas?: number;
}) {
    const registro = {
        expenses: [] as any[],
        movimientos: [] as any[],
        auditLogs: [] as any[],
        purchaseUpdates: [] as any[],
        tenantEscrituras: [] as any[],
        locks: [] as string[],
    };
    let restantes = estado.facturasMarcadas ?? 1;

    const tx: any = {
        $queryRaw: vi.fn(async (partes: TemplateStringsArray, ...valores: unknown[]) => {
            registro.locks.push(partes.join('?'));
            return [];
        }),
        shift: {
            findFirst: vi.fn(async ({ where }: any) => {
                const t = estado.turno;
                if (!t) return null;
                if (where.id !== t.id || where.status !== 'OPEN') return null;
                return { id: t.id, initialCash: t.initialCash };
            }),
        },
        sale: {
            findMany: vi.fn(async () => (estado.ventasEfectivo ?? []).map((total) => ({ total }))),
        },
        cashMovement: {
            findMany: vi.fn(async () => estado.movimientos ?? []),
            create: vi.fn(async ({ data }: any) => {
                const fila = { id: `mov-${registro.movimientos.length + 1}`, ...data };
                registro.movimientos.push(fila);
                return fila;
            }),
        },
        purchase: {
            updateMany: vi.fn(async (args: any) => {
                registro.purchaseUpdates.push(args);
                if (restantes <= 0) return { count: 0 };
                restantes -= 1;
                return { count: 1 };
            }),
        },
        expense: {
            create: vi.fn(async ({ data }: any) => {
                const fila = { id: `exp-${registro.expenses.length + 1}`, ...data };
                registro.expenses.push(fila);
                return fila;
            }),
        },
        auditLog: {
            create: vi.fn(async ({ data }: any) => {
                registro.auditLogs.push(data);
                return data;
            }),
        },
        // Trampa: si el servicio vuelve a tocar la billetera, el test lo grita.
        tenant: {
            update: vi.fn(async (args: any) => { registro.tenantEscrituras.push(args); return {}; }),
            updateMany: vi.fn(async (args: any) => { registro.tenantEscrituras.push(args); return { count: 1 }; }),
            findUnique: vi.fn(async () => { registro.tenantEscrituras.push({ lectura: true }); return null; }),
        },
    };
    return { tx, registro };
}

function depsFalsas(): PagoProveedorDeps & { asientos: any[] } {
    const asientos: any[] = [];
    return {
        asientos,
        appendCashMovement: (async (tx: any, data: any) => tx.cashMovement.create({ data })) as any,
        recordCashMovement: (async (
            _tx: any, tenantId: string, userId: string, movementId: string,
            type: string, category: string, amount: number, description: string
        ) => {
            asientos.push({ tenantId, userId, movementId, type, category, amount, description });
        }) as any,
    };
}

const PAGO = {
    tenantId: 'tenant-a',
    userId: 'user-a',
    purchaseId: 'compra-1',
    shiftId: 'turno-1',
    invoiceNumber: '001',
    supplierName: 'Pollos Motiva',
    total: '162.00',
};

describe('evaluarPagoContraCaja', () => {
    it('sin caja abierta NO dice "saldo insuficiente": dice que falta abrir caja', () => {
        const veredicto = evaluarPagoContraCaja({ hayCajaAbierta: false, disponible: 5000, monto: 162 });

        expect(veredicto.ok).toBe(false);
        expect(veredicto.code).toBe('SIN_CAJA_ABIERTA');
        // Contra el LITERAL, no contra la constante importada: aseverar la
        // constante compara la mutación consigo misma y no mata nada.
        expect(veredicto.message).toBe('No hay caja abierta. Abrí una caja para registrar el pago al proveedor.');
        expect(MENSAJE_SIN_CAJA_ABIERTA).toBe(veredicto.message);
        expect(veredicto.message).not.toMatch(/billetera/i);
    });

    it('acepta cuando la gaveta alcanza', () => {
        expect(evaluarPagoContraCaja({ hayCajaAbierta: true, disponible: '1000.00', monto: '162.00' }))
            .toEqual({ ok: true, code: null, message: null });
    });

    it('acepta el pago EXACTO (deja la gaveta en cero, no es sobregiro)', () => {
        expect(evaluarPagoContraCaja({ hayCajaAbierta: true, disponible: '162.00', monto: '162.00' }))
            .toEqual({ ok: true, code: null, message: null });
    });

    it('rechaza por un centavo y el mensaje trae ambos montos', () => {
        const veredicto = evaluarPagoContraCaja({ hayCajaAbierta: true, disponible: '161.99', monto: '162.00' });

        expect(veredicto.ok).toBe(false);
        expect(veredicto.code).toBe('EFECTIVO_INSUFICIENTE');
        expect(veredicto.message).toContain('C$ 161.99');
        expect(veredicto.message).toContain('C$ 162.00');
        expect(veredicto.message).not.toMatch(/billetera/i);
    });

    it('no arrastra error binario: 0.1 + 0.2 en la gaveta paga 0.30', () => {
        const disponible = new Decimal('0.1').plus('0.2');
        expect(evaluarPagoContraCaja({ hayCajaAbierta: true, disponible, monto: '0.30' }))
            .toEqual({ ok: true, code: null, message: null });
    });
});

describe('efectivoDisponibleDelTurno', () => {
    it('fondo + ventas en efectivo + entradas − salidas', () => {
        const efectivo = efectivoDisponibleDelTurno({
            initialCash: '500.00',
            ventasEfectivo: '1200.50',
            movimientos: [
                { type: 'IN', amount: '100.00', currency: 'NIO', category: 'INYECCION_CAPITAL' },
                { type: 'OUT', amount: '300.00', currency: 'NIO', category: 'GASTO_OPERATIVO' },
                // Los dólares NO se suman a los córdobas (gaveta separada).
                { type: 'IN', amount: '50.00', currency: 'USD', category: 'CAMBIO' },
            ],
        });

        expect(efectivo.toFixed(2)).toBe('1500.50');
    });
});

describe('pagarFacturaProveedorEnCaja', () => {
    it('debita la GAVETA del turno y jamás toca la billetera del tenant', async () => {
        const { tx, registro } = txFalso({
            turno: { id: 'turno-1', initialCash: '500.00' },
            ventasEfectivo: ['1000.00'],
        });
        const deps = depsFalsas();

        const resultado = await pagarFacturaProveedorEnCaja(tx, PAGO, deps);

        // 1. La billetera fintech NO participa.
        expect(registro.tenantEscrituras).toEqual([]);

        // 2. Salida de caja firmada, en el turno abierto, por el monto exacto.
        expect(registro.movimientos).toHaveLength(1);
        expect(registro.movimientos[0]).toMatchObject({
            tenantId: 'tenant-a',
            shiftId: 'turno-1',
            userId: 'user-a',
            type: 'OUT',
            amount: 162,
            currency: 'NIO',
            category: CATEGORIA_PAGO_PROVEEDOR,
            expenseId: 'exp-1',
        });

        // 3. Factura marcada PAID con guard atómico + tenantId en el where.
        expect(registro.purchaseUpdates).toHaveLength(1);
        expect(registro.purchaseUpdates[0]).toEqual({
            where: { id: 'compra-1', tenantId: 'tenant-a', status: 'PENDING_PAYMENT' },
            data: { status: 'COMPLETED' },
        });

        // 4. Asiento: cancela la CxP contra Caja (lo hace `recordCashMovement`
        //    con la categoría PAGO_PROVEEDOR → Debe 2.1.1 / Haber 1.1.1).
        expect(deps.asientos).toHaveLength(1);
        expect(deps.asientos[0]).toMatchObject({
            tenantId: 'tenant-a',
            movementId: 'mov-1',
            type: 'OUT',
            category: CATEGORIA_PAGO_PROVEEDOR,
            amount: 162,
        });

        // 5. Auditoría con before/after de la GAVETA (no de la billetera).
        expect(registro.auditLogs).toHaveLength(1);
        const detalle = JSON.parse(registro.auditLogs[0].details);
        expect(registro.auditLogs[0].action).toBe('PURCHASE_PAID');
        expect(detalle).toMatchObject({
            purchaseId: 'compra-1',
            statusBefore: 'PENDING_PAYMENT',
            statusAfter: 'COMPLETED',
            shiftId: 'turno-1',
            efectivoAntes: 1500,
            efectivoDespues: 1338,
        });
        expect(detalle).not.toHaveProperty('walletBefore');
        expect(detalle).not.toHaveProperty('walletAfter');

        // 6. El turno se bloquea (FOR UPDATE) antes de leer el efectivo.
        expect(registro.locks.some((sql) => sql.includes('FOR UPDATE'))).toBe(true);
        expect(resultado.efectivoDespues.toFixed(2)).toBe('1338.00');
    });

    it('sin efectivo suficiente en la gaveta falla con EFECTIVO_INSUFICIENTE y sin escribir nada', async () => {
        const { tx, registro } = txFalso({
            turno: { id: 'turno-1', initialCash: '100.00' },
            ventasEfectivo: [],
        });
        const deps = depsFalsas();

        await expect(pagarFacturaProveedorEnCaja(tx, PAGO, deps)).rejects.toMatchObject({
            code: 'EFECTIVO_INSUFICIENTE',
            httpStatus: 400,
        });

        expect(registro.movimientos).toEqual([]);
        expect(registro.expenses).toEqual([]);
        expect(registro.auditLogs).toEqual([]);
        expect(deps.asientos).toEqual([]);
        expect(registro.tenantEscrituras).toEqual([]);
    });

    it('si la caja se cerró entre la resolución y la tx, el error habla de CAJA, no de billetera', async () => {
        const { tx } = txFalso({ turno: null });
        const deps = depsFalsas();

        const error = await pagarFacturaProveedorEnCaja(tx, PAGO, deps).catch((e) => e);

        expect(error).toBeInstanceOf(SupplierPaymentError);
        expect(error.code).toBe('SIN_CAJA_ABIERTA');
        expect(error.httpStatus).toBe(409);
        expect(error.message).toMatch(/caja/i);
        expect(error.message).not.toMatch(/billetera/i);
    });

    it('doble-click: el segundo pago aborta y NO vuelve a debitar la gaveta', async () => {
        const { tx, registro } = txFalso({
            turno: { id: 'turno-1', initialCash: '5000.00' },
            facturasMarcadas: 1,
        });
        const deps = depsFalsas();

        await pagarFacturaProveedorEnCaja(tx, PAGO, deps);
        await expect(pagarFacturaProveedorEnCaja(tx, PAGO, deps)).rejects.toMatchObject({
            code: 'PAGO_NO_APLICABLE',
            httpStatus: 409,
        });

        expect(registro.movimientos).toHaveLength(1);
        expect(registro.expenses).toHaveLength(1);
        expect(deps.asientos).toHaveLength(1);
    });
});

describe('registrarSalidaDeCajaPorCompra (compra de contado)', () => {
    it('saca el efectivo de la gaveta sin tocar la billetera', async () => {
        const { tx, registro } = txFalso({
            turno: { id: 'turno-1', initialCash: '2000.00' },
            ventasEfectivo: ['500.00'],
        });
        const deps = depsFalsas();

        const salida = await registrarSalidaDeCajaPorCompra(tx, {
            tenantId: 'tenant-a',
            userId: 'user-a',
            shiftId: 'turno-1',
            invoiceNumber: '777',
            supplierName: 'Distribuidora Sur',
            total: '750.00',
        }, deps);

        expect(registro.tenantEscrituras).toEqual([]);
        expect(registro.movimientos[0]).toMatchObject({
            type: 'OUT',
            amount: 750,
            currency: 'NIO',
            category: CATEGORIA_COMPRA_CONTADO,
        });
        expect(registro.expenses[0]).toMatchObject({ category: 'COMPRA_MERCADERIA', amount: 750 });
        expect(salida.efectivoAntes.toFixed(2)).toBe('2500.00');
        expect(salida.efectivoDespues.toFixed(2)).toBe('1750.00');
    });

    it('NO postea el asiento genérico de salida: `recordPurchase` ya acredita Caja', async () => {
        const { tx, registro } = txFalso({ turno: { id: 'turno-1', initialCash: '2000.00' } });
        const deps = depsFalsas();

        await registrarSalidaDeCajaPorCompra(tx, {
            tenantId: 'tenant-a',
            userId: 'user-a',
            shiftId: 'turno-1',
            invoiceNumber: '777',
            supplierName: 'Distribuidora Sur',
            total: '750.00',
        }, deps);

        // Doble crédito a Caja (1.1.1) + una CxP (2.1.1) que nunca existió.
        expect(deps.asientos).toEqual([]);
        // La categoría es la que NO tiene asiento propio en el motor contable.
        expect(registro.movimientos[0].category).not.toBe(CATEGORIA_PAGO_PROVEEDOR);
    });

    it('la compra de contado tampoco pasa sin efectivo en la gaveta', async () => {
        const { tx, registro } = txFalso({ turno: { id: 'turno-1', initialCash: '100.00' } });
        const deps = depsFalsas();

        await expect(registrarSalidaDeCajaPorCompra(tx, {
            tenantId: 'tenant-a',
            userId: 'user-a',
            shiftId: 'turno-1',
            invoiceNumber: '777',
            supplierName: 'Distribuidora Sur',
            total: '750.00',
        }, deps)).rejects.toMatchObject({ code: 'EFECTIVO_INSUFICIENTE' });

        expect(registro.movimientos).toEqual([]);
        expect(registro.expenses).toEqual([]);
    });
});
