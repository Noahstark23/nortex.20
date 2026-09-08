/**
 * NORTEX — Pestañas del módulo de inventario.
 *
 * PROBLEMA QUE RESUELVE: las pestañas Mis Productos / Bodegas / Series existían
 * SOLO dentro de la vista de inventario. Al entrar a Bodegas o a Series
 * desaparecían, así que no había forma de volver ni de saltar entre las tres sin
 * usar el botón atrás del navegador. Sumado a que el sidebar tampoco marcaba
 * dónde estabas, era un callejón sin salida.
 *
 * Al vivir en un solo componente montado en las tres rutas, la pestaña actual
 * queda marcada con `aria-current="page"` y el camino de vuelta siempre está
 * a un clic.
 */
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { esRutaDe } from '../../utils/navigation';
import { currentSessionRole } from '../../utils/roleCapabilities';

const PESTAÑAS = [
    { to: '/app/inventory', label: 'Mis Productos' },
    { to: '/app/warehouses', label: 'Bodegas' },
    { to: '/app/serials', label: 'Series' },
] as const;

export const inventoryTabsForRole = (role: string) => role === 'BODEGUERO'
    ? PESTAÑAS.filter(p => p.to !== '/app/serials')
    : [...PESTAÑAS];

export const InventoryTabs: React.FC<{ className?: string }> = ({ className = '' }) => {
    const { pathname } = useLocation();
    const pestañas = inventoryTabsForRole(currentSessionRole());

    return (
        <nav aria-label="Secciones de inventario" className={`flex items-center gap-2 ${className}`}>
            {pestañas.map(p => {
                const activa = esRutaDe(p.to, pathname);
                return (
                    <Link
                        key={p.to}
                        to={p.to}
                        aria-current={activa ? 'page' : undefined}
                        className={`nx-module-tab nx-fluid-press inline-flex min-h-tap items-center rounded-control border px-3 text-xs font-semibold transition-colors ${
                            activa ? 'nx-module-tab-active' : ''
                        }`}
                    >
                        {p.label}
                    </Link>
                );
            })}
        </nav>
    );
};

export default InventoryTabs;
