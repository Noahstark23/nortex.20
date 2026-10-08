/**
 * NORTEX — Skeletons de carga.
 *
 * PROBLEMA QUE RESUELVE: no había ni uno en todo el repo. Cada pantalla hacía
 * `if (loading) return <spinner a pantalla completa>`, así que nada se pintaba
 * hasta que respondía el endpoint más lento (en Reportes son 3 en paralelo: el
 * más lento manda). Un spinner centrado no dice qué está por venir; el skeleton
 * mantiene la forma de la página y hace que la espera se sienta más corta.
 *
 * El shimmer respeta prefers-reduced-motion vía la utilidad `motion-safe` de
 * Tailwind: con movimiento reducido queda el bloque estático, sin animación.
 */
import React from 'react';

/** Bloque base. `className` define tamaño y forma. */
export const Skeleton: React.FC<{ className?: string }> = ({ className = '' }) => (
    <div className={`relative overflow-hidden bg-white/[0.05] rounded-control ${className}`}>
        <div className="absolute inset-0 -translate-x-full motion-safe:animate-nx-shimmer bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
    </div>
);

/** Filas de tabla: mantiene la grilla mientras llegan los datos. */
export const SkeletonTableRows: React.FC<{ rows?: number; cols: number }> = ({ rows = 6, cols }) => (
    <>
        {Array.from({ length: rows }).map((_, r) => (
            <tr key={r} className="border-b border-white/[0.04]">
                {Array.from({ length: cols }).map((_, c) => (
                    <td key={c} className="px-4 py-3">
                        {/* La primera columna suele ser el nombre: más ancha. */}
                        <Skeleton className={`h-4 ${c === 0 ? 'w-40' : 'w-20'}`} />
                    </td>
                ))}
            </tr>
        ))}
    </>
);

/** Fila de tarjetas KPI. */
export const SkeletonKpiRow: React.FC<{ count?: number }> = ({ count = 4 }) => (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: count }).map((_, i) => (
            <div key={i} className="bg-surface-900 border border-white/[0.06] rounded-card p-4">
                <Skeleton className="h-3 w-24 mb-3" />
                <Skeleton className="h-7 w-32" />
            </div>
        ))}
    </div>
);

/** Panel genérico (gráfico, bloque de detalle). */
export const SkeletonPanel: React.FC<{ className?: string }> = ({ className = 'h-64' }) => (
    <div className={`bg-surface-900 border border-white/[0.06] rounded-card p-4 ${className}`}>
        <Skeleton className="h-3 w-40 mb-4" />
        <Skeleton className="h-[calc(100%-2rem)] w-full" />
    </div>
);

export default Skeleton;
