import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildPromotionSaleIntent } from '../components/pos/PromotionSaleIntent';
import { resolvePosCartTotals } from '../components/pos/PromotionTotals';
import type { CartItem } from '../types';

const quotedLine = { id: 'p1', name: 'Cotizado QA', price: 100, quantity: 0.125, quantityExact: '0.125000', quotationItemId: 'quote-line1', costPrice: 60, discount: 30, unit: 'metro' } as CartItem & { discount: number };
const saleIntent = (cart = [quotedLine]) => buildPromotionSaleIntent({ cart, shiftId: 'shift1', paymentMethod: 'CASH', customerName: 'Cliente QA', globalDiscount: 0, fiscalRegimeVersion: 7, storeCreditAmount: '0.00', total: 12.5 });

const posSource = readFileSync(new URL('../components/POS.tsx', import.meta.url), 'utf8');
const quotationSource = readFileSync(new URL('../components/QuotationManager.tsx', import.meta.url), 'utf8');

describe('puente cotización → POS', () => {
    it('usa contrato versionado y namespaceado sin consumir el canal global legacy', () => {
        expect(quotationSource).toContain('serializarTraspasoCarrito({');
        expect(quotationSource).toContain('claveTraspasoCarrito(identidad.tenantId, identidad.userId)');
        expect(posSource).toContain('leerTraspasoCarrito(crudo, identidad, Date.now())');
        expect(posSource).not.toContain("localStorage.getItem('nortex_pending_cart')");
        expect(posSource).toContain("localStorage.removeItem('nortex_pending_cart')");
        expect(quotationSource).not.toContain("localStorage.setItem('nortex_pending_cart'");
    });

    it('no reatribuye una cotización si la sesión cambió en otra pestaña', () => {
        const inicio = quotationSource.indexOf('const convertToSale =');
        const fin = quotationSource.indexOf('const convertWebOrder =', inicio);
        const conversion = quotationSource.slice(inicio, fin);
        expect(quotationSource).toContain('const [identidadSesion] = useState');
        expect(conversion).toContain('identidadSesion.tenantId !== identidadActual.tenantId');
        expect(conversion).toContain('identidadSesion.userId !== identidadActual.userId');
        expect(conversion.indexOf('identidadSesion.userId !== identidadActual.userId')).toBeLessThan(
            conversion.indexOf('serializarTraspasoCarrito({'),
        );
        expect(conversion).toContain('const identidad = identidadSesion;');
    });

    it('consume la clave antes de hidratar el carrito y conserva la venta activa', () => {
        const inicio = posSource.indexOf('// Cotización → POS: se consume una sola vez');
        const fin = posSource.indexOf('// Cerrar la pestaña con una venta a medias', inicio);
        const efecto = posSource.slice(inicio, fin);
        expect(inicio).toBeGreaterThan(-1);
        expect(efecto.indexOf('localStorage.removeItem(clave);')).toBeGreaterThan(-1);
        expect(efecto.indexOf('setCart(traspaso.lineas as unknown as CartItem[])')).toBeGreaterThan(
            efecto.indexOf('localStorage.removeItem(clave);'),
        );
        expect(efecto).toContain('if (cart.length > 0 && !currentShift)');
        expect(efecto).toContain('if (cart.length > 0 && heldCarts.length >= 5)');
        expect(efecto).toContain('items: [...cart]');
        expect(efecto).toContain('shiftId: currentShift.id');
    });

    it('no consume la cotización mientras exista una venta pendiente de resolver', () => {
        const inicio = posSource.indexOf('// Cotización → POS: se consume una sola vez');
        const fin = posSource.indexOf('// Cerrar la pestaña con una venta a medias', inicio);
        const efecto = posSource.slice(inicio, fin);
        const guardPendiente = efecto.indexOf('if (ventaPendiente)');
        const consumo = efecto.indexOf('localStorage.removeItem(clave);');
        const carga = efecto.indexOf('setCart(traspaso.lineas as unknown as CartItem[])');
        expect(guardPendiente).toBeGreaterThan(-1);
        expect(guardPendiente).toBeLessThan(consumo);
        expect(guardPendiente).toBeLessThan(carga);
        expect(efecto).toContain('ventaPendiente,');
        expect(efecto).toContain('La cotización seguirá esperando sin perderse.');
    });

    it('conserva quotationItemId y cantidad exacta en el payload online/offline', () => {
        expect(saleIntent().items[0]).toMatchObject({ quotationItemId: 'quote-line1', quantity: '0.125000', price: 100 });
        const unquoted = { ...quotedLine, quotationItemId: undefined, quantityExact: undefined, quantity: 2 };
        expect(saleIntent([unquoted]).items[0]).not.toHaveProperty('quotationItemId');
        expect(saleIntent([unquoted]).items[0].quantity).toBe('2');
    });

    it('no fusiona, reprecifica ni edita una línea cotizada', () => {
        expect(posSource).toContain('&& !isQuotationCartLine(item)');
        expect(posSource).toContain('if (isQuotationCartLine(item)) return item;');
        expect(posSource).toContain('La cantidad está fijada por la cotización original.');
        expect(posSource).toContain("isQuotationLine ? 'fijado por cotización' : 'fijado por etiqueta'");
    });

    it('impide descuentos y mezcla con líneas libres antes de cobrar', () => {
        const quotedTotals = resolvePosCartTotals([quotedLine], '15', 'GENERAL');
        expect(quotedTotals.globalDiscountNum).toBe(0);
        expect(quotedTotals.grandTotal).toBe(12.5);
        expect(saleIntent().items[0].discount).toBe(0);
        const freeLine = { ...quotedLine, quotationItemId: undefined, quantityExact: undefined };
        expect(saleIntent([freeLine]).items[0].discount).toBe(30);
        expect(resolvePosCartTotals([freeLine], '15', 'GENERAL').globalDiscountNum).toBe(15);
        expect(posSource).toContain('hasQuotationLines && quotationLineCount !== cart.length');
        expect(posSource).toContain('disabled={hasQuotationLines}');
    });
});

describe('simetría del intento online y su replay offline', () => {
    it('comparte una sola versión fiscal en ambos transportes', () => {
        expect(saleIntent().transport.fiscalRegimeVersion).toBe(7);
        const inicio = posSource.indexOf('const intent = buildPromotionSaleIntent({');
        const fin = posSource.indexOf("trackEvent('real_sale_submit_attempted'", inicio);
        const contrato = posSource.slice(inicio, fin);
        expect(inicio).toBeGreaterThan(-1);
        expect(contrato).toContain('fiscalRegimeVersion: fiscalSettings.fiscalRegimeVersion');
        expect(contrato).toContain('const saleTransportPayload = { offlineId, ...intent.transport }');
        const inicioCola = posSource.indexOf('await saveSaleOffline({', fin);
        const finCola = posSource.indexOf('});', inicioCola);
        expect(posSource.slice(inicioCola, finCola)).toContain('...saleTransportPayload');
        const inicioOnline = posSource.indexOf('const preparedPayload = await promotionCheckout.prepare(', finCola);
        const finOnline = posSource.indexOf('const data = await res.json()', inicioOnline);
        expect(inicioOnline).toBeGreaterThan(finCola);
        expect(posSource.slice(inicioOnline, finOnline)).toContain('...saleTransportPayload');
        expect(posSource.slice(inicioOnline, finOnline)).toContain('body: JSON.stringify(preparedPayload)');
    });
});

describe('restauración de ventas aparcadas', () => {
    it('todas las entradas pasan por el gate y otro turno requiere una segunda acción explícita', () => {
        const inicio = posSource.indexOf('const handleRestoreCart = useCallback');
        const fin = posSource.indexOf('// ── P0-1 · Venta a medias de otro turno', inicio);
        const handler = posSource.slice(inicio, fin);
        expect(handler).toContain('decidirRestauracionAparcado({');
        expect(handler).toContain("if (decision === 'OFRECER' && !reatribucionConfirmada)");
        expect(handler.indexOf("if (decision === 'OFRECER' && !reatribucionConfirmada)")).toBeLessThan(
            handler.indexOf('setHeldCarts(prev =>'),
        );
        expect(posSource).toContain('onClick={() => handleRestoreCart(parkingNotice.heldId as string)}');
        expect(posSource).toContain('onClick={() => handleRestoreCart(held.id)}');
        expect(posSource).toContain('onClick={() => handleRestoreCart(held.id, true)}');
        expect(posSource).toContain("{currentShift ? 'Reatribuir y continuar' : 'Abrir caja'}");
    });

    it('sin turno no quita el aparcado ni sustituye la venta actual', () => {
        const inicio = posSource.indexOf('const handleRestoreCart = useCallback');
        const fin = posSource.indexOf('// ── P0-1 · Venta a medias de otro turno', inicio);
        const handler = posSource.slice(inicio, fin);
        const sinTurno = handler.indexOf('if (!currentShift)');
        expect(sinTurno).toBeGreaterThan(-1);
        expect(handler.indexOf('setShowOpenShift(true);', sinTurno)).toBeLessThan(
            handler.indexOf('setHeldCartToRestore(null);', sinTurno),
        );
        expect(handler.indexOf('setHeldCarts(prev =>', sinTurno)).toBeGreaterThan(
            handler.indexOf('setHeldCartToRestore(null);', sinTurno),
        );
    });
});

describe('recuperación de venta anterior', () => {
    it('consulta la defensa pura antes de reemplazar el carrito', () => {
        const inicio = posSource.indexOf('const recuperarVentaPendiente = useCallback');
        const fin = posSource.indexOf('const descartarVentaPendiente', inicio);
        const handler = posSource.slice(inicio, fin);
        const defensa = handler.indexOf("decidirRecuperacionPendiente(cart) === 'CONSERVAR_ACTUAL'");
        const reemplazo = handler.indexOf('setCart(restoredLines)');
        expect(defensa).toBeGreaterThan(-1);
        expect(reemplazo).toBeGreaterThan(defensa);
        expect(handler).toContain('Ningún carrito se modificó.');
        expect(handler).toContain('[ventaPendiente, cart]');
    });
});
