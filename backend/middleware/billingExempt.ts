/**
 * NORTEX — Política de exención de billing (P1 retención), PURA y testeable.
 *
 * Decisión de producto (CEO): NUNCA bloquear el acto de vender por billing. Al
 * vencer el trial/suscripción se degrada lo ACCESORIO, pero el POS sigue
 * operando y el dueño siempre puede LEER sus propios datos. Vive aparte de
 * `auth.ts` (que importa Prisma/secrets) para poder fijarla con tests en CI.
 */

// Rutas que pasan siempre, sin importar el estado de suscripción.
export const ALWAYS_ALLOWED_PREFIXES = ['/api/billing', '/api/auth', '/api/admin'];

// Camino OPERATIVO de venta: nunca se bloquea (seguir vendiendo, caja, cobros,
// devoluciones, clientes de crédito, productos).
// ⚠️ Estos prefijos deben ser RUTAS REALES del backend. Acá vivió el bug UX-1:
// se eximía '/api/cash-registers' — una ruta del FRONTEND que no existe en la
// API — mientras las rutas reales de caja (/api/shifts, /api/cash-movements)
// quedaban tras el paywall: al vencer el trial, abrir caja daba 402 → sin turno
// no hay venta → el POS SÍ se bloqueaba, rompiendo la promesa de esta política
// (y la textual de los emails de trial). El test fija las rutas reales.
export const OPERATIONAL_PREFIXES = [
    '/api/sales',          // ejecutar venta + sync offline (/api/sales/sync)
    '/api/shifts',         // abrir/cerrar/tomar caja (requisito para vender)
    '/api/cash-movements', // entradas/salidas de la gaveta (arqueo)
    '/api/payments',       // abonos a crédito (ruta legacy)
    '/api/credits',        // cobrar el fiado (/api/credits/payment) — la plata del dueño
    '/api/returns',        // devoluciones
    '/api/customers',      // ventas a crédito necesitan el cliente
    '/api/products',       // alta/edición de productos para seguir operando
];

/**
 * true = la request NO se bloquea por billing. Se exime:
 *  - billing/auth/admin (siempre),
 *  - cualquier GET (lectura de datos propios — el dueño nunca pierde su historial),
 *  - el camino operativo de venta (para nunca cortar el POS).
 * Todo lo demás (escrituras accesorias: reportes/exportes, préstamos, etc.) sí
 * queda tras el paywall cuando la suscripción está vencida.
 */
export function isBillingExempt(method: string, url: string): boolean {
    const u = url || '';
    if (ALWAYS_ALLOWED_PREFIXES.some(prefix => u.startsWith(prefix))) return true;
    if ((method || '').toUpperCase() === 'GET') return true;
    if (OPERATIONAL_PREFIXES.some(prefix => u.startsWith(prefix))) return true;
    return false;
}
