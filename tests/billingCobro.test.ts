/**
 * NORTEX — Red de las reglas de COBRO manual.
 *
 * En Nicaragua el rail de cobro no es Stripe (no soporta el país como comercio):
 * es depósito con comprobante y activación a mano. Estas dos reglas deciden si
 * entra dinero y por cuánto tiempo, así que van con red propia.
 */
import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import {
    PLAN_PRICE_USD,
    requiereConfirmacionDePagoCorto,
    calcularNuevoVencimiento,
} from '../backend/services/stripe';

describe('Pago corto — requiereConfirmacionDePagoCorto', () => {
    it('el precio del plan es el que muestran la landing y la pantalla de cobro', () => {
        expect(PLAN_PRICE_USD).toBe(20);
    });

    it('un pago en dólares por debajo del plan exige confirmación', () => {
        // El caso que motivó la regla: aprobar daba 30 días con cualquier monto.
        expect(requiereConfirmacionDePagoCorto(1, 'USD')).toBe(true);
        expect(requiereConfirmacionDePagoCorto(19.99, 'USD')).toBe(true);
        expect(requiereConfirmacionDePagoCorto(0, 'USD')).toBe(true);
    });

    it('el pago exacto NO exige confirmación', () => {
        expect(requiereConfirmacionDePagoCorto(20, 'USD')).toBe(false);
        expect(requiereConfirmacionDePagoCorto('20.00', 'USD')).toBe(false);
    });

    it('pagar de más tampoco la exige', () => {
        expect(requiereConfirmacionDePagoCorto(25, 'USD')).toBe(false);
        expect(requiereConfirmacionDePagoCorto(240, 'USD')).toBe(false);
    });

    it('los córdobas los juzga el humano: nunca frena por monto', () => {
        // El tipo de cambio varía; comparar C$ contra un precio en USD daría
        // siempre "corto" y el aviso se volvería ruido que se aprende a ignorar.
        expect(requiereConfirmacionDePagoCorto(1, 'NIO')).toBe(false);
        expect(requiereConfirmacionDePagoCorto(740, 'NIO')).toBe(false);
    });

    it('un monto corrupto se manda a revisión humana', () => {
        expect(requiereConfirmacionDePagoCorto(new Decimal(NaN), 'USD')).toBe(true);
        expect(requiereConfirmacionDePagoCorto(Infinity, 'USD')).toBe(true);
    });

    it('acepta un precio de plan distinto (para cuando haya más de un plan)', () => {
        expect(requiereConfirmacionDePagoCorto(20, 'USD', 40)).toBe(true);
        expect(requiereConfirmacionDePagoCorto(40, 'USD', 40)).toBe(false);
    });
});

describe('Vencimiento — calcularNuevoVencimiento', () => {
    const ahora = new Date('2026-08-17T12:00:00.000Z');

    it('sin suscripción previa cuenta 30 días desde hoy', () => {
        const r = calcularNuevoVencimiento(null, ahora);
        expect(r.toISOString()).toBe('2026-09-16T12:00:00.000Z');
    });

    it('quien renueva ANTICIPADO conserva los días que le quedaban', () => {
        // Vence el 27-ago y paga el 17: tiene que terminar el 26-sep, no el 16.
        // Antes se sumaban 30 días a `now` y esos 10 días se perdían — un castigo
        // por pagar temprano, justo al cliente que uno quiere.
        const vence = new Date('2026-08-27T12:00:00.000Z');
        const r = calcularNuevoVencimiento(vence, ahora);
        expect(r.toISOString()).toBe('2026-09-26T12:00:00.000Z');
    });

    it('si ya venció, cuenta desde hoy y no desde la fecha vieja', () => {
        // Una suscripción caída hace meses no arrastra el atraso como crédito.
        const vencido = new Date('2026-03-01T12:00:00.000Z');
        const r = calcularNuevoVencimiento(vencido, ahora);
        expect(r.toISOString()).toBe('2026-09-16T12:00:00.000Z');
    });

    it('en el borde exacto del vencimiento cuenta desde ahora', () => {
        const r = calcularNuevoVencimiento(new Date(ahora), ahora);
        expect(r.toISOString()).toBe('2026-09-16T12:00:00.000Z');
    });

    it('una fecha de vencimiento corrupta no produce un Invalid Date', () => {
        // Un dato roto en la BD no puede dejar la suscripción sin vencimiento
        // calculable: se ignora y se cuenta desde hoy.
        const r = calcularNuevoVencimiento(new Date('no-es-fecha'), ahora);
        expect(Number.isNaN(r.getTime())).toBe(false);
        expect(r.toISOString()).toBe('2026-09-16T12:00:00.000Z');
    });

    it('no muta la fecha de vencimiento que recibe', () => {
        const vence = new Date('2026-08-27T12:00:00.000Z');
        calcularNuevoVencimiento(vence, ahora);
        expect(vence.toISOString()).toBe('2026-08-27T12:00:00.000Z');
    });

    it('acepta una cantidad de días distinta (plan anual, cortesías)', () => {
        expect(calcularNuevoVencimiento(null, ahora, 365).toISOString())
            .toBe('2027-08-17T12:00:00.000Z');
        expect(calcularNuevoVencimiento(null, ahora, 7).toISOString())
            .toBe('2026-08-24T12:00:00.000Z');
    });

    it('cruza el fin de mes y el fin de año sin corrimientos', () => {
        const dic = new Date('2026-12-20T12:00:00.000Z');
        expect(calcularNuevoVencimiento(null, dic).toISOString())
            .toBe('2027-01-19T12:00:00.000Z');
    });
});
