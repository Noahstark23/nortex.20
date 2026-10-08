import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import {
    ESTADO_ANULADA,
    puedeAnularse,
    textoUtil,
    planDeReversion,
    VentaParaAnular,
} from '../backend/services/saleCancellation';

/**
 * Anulación de comprobantes — números oro.
 *
 * Lo que se defiende: que anular NUNCA cuente dos veces la misma mercadería ni
 * el mismo dinero, y que la reversión use los importes CONGELADOS de la venta y
 * no los de hoy. Una anulación mal revertida no es un bug de pantalla: deja el
 * inventario y los libros mintiendo, y se descubre en el arqueo.
 *
 * Los casos se arman DENTRO de cada `it`: Stryker activa el mutante en runtime,
 * así que lo calculado en el cuerpo del `describe` correría sin mutante.
 */

const MOTIVO_OK = 'Cobro duplicado al mismo cliente';

const venta = (p: Partial<VentaParaAnular> = {}): VentaParaAnular => ({
    status: 'COMPLETED',
    cancelledAt: null,
    devoluciones: 0,
    pagos: 0,
    periodoCerrado: false,
    ...p,
});

describe('ESTADO_ANULADA', () => {
    it('es exactamente "VOIDED", que es lo que los reportes ya excluyen', () => {
        // Se asevera contra el LITERAL, no contra la constante importada: eso
        // último compararía la mutación consigo misma y no mataría nada. El
        // valor viaja a la base de datos y a los OCHO filtros que ya existían
        // (declaración de IVA, Libro de Ventas, dashboard, margen). Cambiarlo
        // sin darse cuenta dejaría las ventas anuladas contando como ingreso en
        // la declaración a la DGI.
        expect(ESTADO_ANULADA).toBe('VOIDED');
    });
});

describe('puedeAnularse — cuándo SÍ', () => {
    it('una venta normal con motivo suficiente se puede anular', () => {
        expect(puedeAnularse(venta(), MOTIVO_OK)).toEqual({ ok: true });
    });

    it('una venta pendiente de cobro también', () => {
        expect(puedeAnularse(venta({ status: 'PENDING' }), MOTIVO_OK).ok).toBe(true);
    });
});

describe('puedeAnularse — no se anula dos veces', () => {
    it('rechaza si el estado ya es el de anulada', () => {
        const v = puedeAnularse(venta({ status: ESTADO_ANULADA }), MOTIVO_OK);
        expect(v.ok).toBe(false);
        expect(v.codigo).toBe('YA_ANULADA');
    });

    it('rechaza si tiene fecha de anulación, aunque el estado diga otra cosa', () => {
        // Cinturón y tirantes: si por un camino raro quedó la fecha sin el
        // estado, anular de nuevo revertiría el stock por segunda vez.
        const v = puedeAnularse(venta({ status: 'COMPLETED', cancelledAt: new Date() }), MOTIVO_OK);
        expect(v.ok).toBe(false);
        expect(v.codigo).toBe('YA_ANULADA');
    });
});

describe('puedeAnularse — no se revierte lo ya revertido', () => {
    it('rechaza si la venta tiene devoluciones', () => {
        const v = puedeAnularse(venta({ devoluciones: 1 }), MOTIVO_OK);
        expect(v.codigo).toBe('TIENE_DEVOLUCIONES');
        expect(v.mensaje).toContain('dos veces');
    });

    it('rechaza si la venta tiene abonos', () => {
        const v = puedeAnularse(venta({ pagos: 1 }), MOTIVO_OK);
        expect(v.codigo).toBe('TIENE_PAGOS');
    });

    it('rechaza si el período contable está cerrado', () => {
        const v = puedeAnularse(venta({ periodoCerrado: true }), MOTIVO_OK);
        expect(v.codigo).toBe('PERIODO_CERRADO');
        expect(v.mensaje).toContain('nota de crédito');
    });
});

describe('puedeAnularse — el motivo', () => {
    it('rechaza un motivo corto', () => {
        expect(puedeAnularse(venta(), 'error').codigo).toBe('MOTIVO_INSUFICIENTE');
    });

    it('rechaza un motivo de puros espacios', () => {
        expect(puedeAnularse(venta(), '              ').codigo).toBe('MOTIVO_INSUFICIENTE');
    });

    it('rechaza vacío, null y undefined', () => {
        expect(puedeAnularse(venta(), '').codigo).toBe('MOTIVO_INSUFICIENTE');
        expect(puedeAnularse(venta(), null as never).codigo).toBe('MOTIVO_INSUFICIENTE');
        expect(puedeAnularse(venta(), undefined as never).codigo).toBe('MOTIVO_INSUFICIENTE');
    });

    it('acepta exactamente 10 caracteres, rechaza 9', () => {
        expect(puedeAnularse(venta(), '1234567890').ok).toBe(true);
        expect(puedeAnularse(venta(), '123456789').ok).toBe(false);
    });

    it('el motivo se mide DESPUÉS de colapsar espacios', () => {
        // "a         b" son 11 caracteres crudos pero 3 útiles.
        expect(puedeAnularse(venta(), 'a         b').codigo).toBe('MOTIVO_INSUFICIENTE');
    });
});

describe('puedeAnularse — orden de los rechazos', () => {
    it('lo que hace la operación IMPOSIBLE gana sobre el motivo', () => {
        // Si el cajero corrige el motivo tres veces para enterarse al final de
        // que la venta ya estaba anulada, el mensaje sirvió de poco.
        expect(puedeAnularse(venta({ status: ESTADO_ANULADA }), 'x').codigo).toBe('YA_ANULADA');
    });

    it('la reversión doble gana sobre el período cerrado', () => {
        expect(puedeAnularse(venta({ devoluciones: 1, periodoCerrado: true }), MOTIVO_OK).codigo)
            .toBe('TIENE_DEVOLUCIONES');
    });

    it('todo rechazo trae código Y mensaje', () => {
        const casos = [
            venta({ status: ESTADO_ANULADA }),
            venta({ devoluciones: 1 }),
            venta({ pagos: 1 }),
            venta({ periodoCerrado: true }),
        ];
        for (const c of casos) {
            const v = puedeAnularse(c, MOTIVO_OK);
            expect(v.ok).toBe(false);
            expect(v.codigo).toBeTruthy();
            expect((v.mensaje ?? '').length).toBeGreaterThan(10);
        }
        // Y el del motivo, que necesita un motivo malo para dispararse.
        const m = puedeAnularse(venta(), 'x');
        expect(m.codigo).toBe('MOTIVO_INSUFICIENTE');
        expect((m.mensaje ?? '').length).toBeGreaterThan(10);
    });
});

describe('textoUtil', () => {
    it('colapsa espacios internos y recorta los bordes', () => {
        expect(textoUtil('  hola    mundo  ')).toBe('hola mundo');
    });

    it('saltos de línea y tabs cuentan como espacio', () => {
        expect(textoUtil('hola\n\tmundo')).toBe('hola mundo');
    });

    it('null y undefined dan cadena vacía, no "null"', () => {
        expect(textoUtil(null)).toBe('');
        expect(textoUtil(undefined)).toBe('');
    });
});

describe('planDeReversion', () => {
    const ventaCredito = () => ({
        total: '1531.80',
        paymentMethod: 'CREDIT',
        items: [
            { productId: 'a', quantity: '2', costAtSale: '300.0000' },
            { productId: 'b', quantity: '10', costAtSale: '2.5000' },
        ],
    });

    it('devuelve una línea por ítem, con cantidad positiva', () => {
        const p = planDeReversion(ventaCredito());
        expect(p.lineas.map(l => l.productId)).toEqual(['a', 'b']);
        expect(p.lineas.every(l => l.cantidad.greaterThan(0))).toBe(true);
    });

    it('el costo a reversar usa el costo CONGELADO en la venta', () => {
        // 2 × 300 + 10 × 2.5 = 625
        expect(planDeReversion(ventaCredito()).costoTotal.toFixed(2)).toBe('625.00');
    });

    it('una venta a CRÉDITO baja la deuda del cliente y no toca la caja', () => {
        const p = planDeReversion(ventaCredito());
        expect(p.deudaAReversar.toFixed(2)).toBe('1531.80');
        expect(p.efectivoAReversar.toFixed(2)).toBe('0.00');
    });

    it('una venta en EFECTIVO saca plata de la caja y no toca la deuda', () => {
        const p = planDeReversion({ ...ventaCredito(), paymentMethod: 'CASH' });
        expect(p.efectivoAReversar.toFixed(2)).toBe('1531.80');
        expect(p.deudaAReversar.toFixed(2)).toBe('0.00');
    });

    it('otro método (tarjeta, transferencia) no mueve ni caja ni deuda', () => {
        const p = planDeReversion({ ...ventaCredito(), paymentMethod: 'CARD' });
        expect(p.efectivoAReversar.toFixed(2)).toBe('0.00');
        expect(p.deudaAReversar.toFixed(2)).toBe('0.00');
        // Pero el inventario y el costo vuelven igual: la mercadería no se fue.
        expect(p.costoTotal.toFixed(2)).toBe('625.00');
    });

    it('una venta sin ítems no revierte inventario pero sí el documento', () => {
        const p = planDeReversion({ total: '100', paymentMethod: 'CASH', items: [] });
        expect(p.lineas).toEqual([]);
        expect(p.costoTotal.toFixed(2)).toBe('0.00');
        expect(p.total.toFixed(2)).toBe('100.00');
    });

    it('trabaja en Decimal: los centavos no se pierden', () => {
        const p = planDeReversion({
            total: '0.30',
            paymentMethod: 'CASH',
            items: [{ productId: 'a', quantity: '3', costAtSale: '0.1' }],
        });
        expect(p.costoTotal).toBeInstanceOf(Decimal);
        expect(p.costoTotal.toFixed(4)).toBe('0.3000');
    });

    it('cantidades fraccionables (kg) se revierten tal cual', () => {
        const p = planDeReversion({
            total: '75',
            paymentMethod: 'CASH',
            items: [{ productId: 'a', quantity: '0.75', costAtSale: '40' }],
        });
        expect(p.lineas[0].cantidad.toString()).toBe('0.75');
        expect(p.costoTotal.toFixed(2)).toBe('30.00');
    });
});
