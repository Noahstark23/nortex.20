/**
 * Superficies oscuras deliberadas dentro del workspace Día.
 *
 * El bridge de `index.css` las reconoce mediante `nx-dark-island` para que la
 * tinta contextual no se vuelva oscura sobre gradientes que intencionalmente
 * conservan un fondo oscuro. Mantenerlas como una primitive pequeña evita
 * fijar strings de implementación dentro de componentes grandes o tests.
 */
export const DAY_DARK_SURFACE = Object.freeze({
    publicCatalog: 'nx-dark-island bg-gradient-to-r from-slate-900 to-slate-800 text-white',
    inventoryValue: 'nx-dark-island bg-gradient-to-br from-nortex-900 to-nortex-800 text-white',
    taxTotal: 'nx-dark-island bg-gradient-to-br from-red-800 to-red-900 text-white',
});

// En los extremos oscuros de los gradientes activo y de prueba, 80 % de la
// tinta semántica deja de alcanzar AA. Estos textos de apoyo se conservan
// opacos; la jerarquía visual viene de tamaño/peso, no de transparencia.
export const BILLING_STATUS_META_CLASS = 'text-sm font-mono';
export const BILLING_STATUS_RENEWAL_CLASS = 'text-right text-sm';

export function billingStatusSurfaceClass(isActive: boolean, isSuspended: boolean): string {
    if (isActive) return 'bg-gradient-to-br from-emerald-500 to-emerald-700 text-brand-on';
    if (isSuspended) return DAY_DARK_SURFACE.taxTotal;
    return 'bg-gradient-to-br from-amber-400 to-amber-600 nx-on-warning-solid';
}
