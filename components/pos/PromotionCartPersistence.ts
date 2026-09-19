import { claveCarrito, claveCarritoLegacy, serializarCarrito, type LineaGuardada } from '../../utils/cartPersistence';
/** La venta online con promoción debe sobrevivir aun si se recarga antes del debounce habitual. */
export function persistPromotionCart(identity: { tenantId: string; userId: string } | null, input: { shiftId: string; lineas: LineaGuardada[]; clienteId: string | null; descuentoGlobal: string }) {
    if (!identity) throw new Error('No pudimos conservar la identidad del carrito. Volvé a abrir la sesión antes de cobrar.');
    const payload = serializarCarrito({ ...input, ahoraMs: Date.now() });
    if (!payload) throw new Error('No pudimos conservar el carrito antes de cobrar.');
    localStorage.setItem(claveCarrito(identity.tenantId, identity.userId), payload);
    localStorage.removeItem(claveCarritoLegacy(identity.tenantId, identity.userId));
}
