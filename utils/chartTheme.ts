/**
 * NORTEX — tema único de gráficos (recharts).
 *
 * PROBLEMA QUE RESUELVE: cada gráfico redeclaraba grid, ticks y tooltip con
 * hex sueltos, y esos hex eran del tema CLARO anterior: la grilla iba en
 * #e2e8f0 (casi blanco) y el cursor de hover en #f1f5f9 sobre tarjetas
 * oscuras. Además los hex evadían el remapeo de marca, así que las barras
 * seguían pintando el azul genérico que el sistema ya había dado de baja.
 *
 * Los colores se leen de los tokens en runtime (no se duplican hex acá):
 * recharts necesita un string de color resuelto, no una var CSS, para el
 * canvas de SVG.
 */

/** Lee un token del :root y lo devuelve como color usable por recharts. */
const token = (name: string, fallback: string): string => {
    if (typeof window === 'undefined') return fallback;
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
};

export const chartColors = {
    /** Serie principal: dinero que entra. */
    get brand() { return token('--nx-brand', '#16C784'); },
    /** Gastos / dinero que sale — neutro cálido, no rojo de alarma. */
    get expense() { return token('--nx-text-muted', '#98A1AE'); },
    get danger() { return token('--nx-danger', '#F0483E'); },
    get warning() { return token('--nx-warning', '#F5A524'); },
    get text() { return token('--nx-text', '#E8EBF0'); },
    get muted() { return token('--nx-text-faint', '#69727F'); },
    get surface() { return token('--nx-surface-2', '#1B1F26'); },
    get border() { return token('--nx-border', '#262B33'); },
};

/** Grilla: solo horizontales, al 8% de opacidad. Sin verticales. */
export const gridProps = {
    strokeDasharray: '0',
    vertical: false,
    stroke: 'rgba(255,255,255,0.08)',
} as const;

export const axisProps = {
    axisLine: false as const,
    tickLine: false as const,
    tick: { fill: chartColors.muted, fontSize: 12 },
};

/** Tooltip oscuro, alineado a las superficies elevadas del sistema. */
export const tooltipProps = () => ({
    cursor: { fill: 'rgba(255,255,255,0.04)' },
    contentStyle: {
        backgroundColor: chartColors.surface,
        border: `1px solid ${chartColors.border}`,
        borderRadius: '12px',
        color: chartColors.text,
        boxShadow: '0 4px 24px -6px rgba(0,0,0,0.45)',
    },
    labelStyle: { color: chartColors.muted, fontSize: 12 },
    itemStyle: { color: chartColors.text },
});
