/**
 * NORTEX — Header único de módulo.
 *
 * PROBLEMA QUE RESUELVE: cada módulo inventaba su propio encabezado. El POS
 * usaba 56px; Inventario armaba un bloque de ~110px con un cuadrado degradado
 * azul→cian de 48px, título, subtítulo y dos enlaces sueltos metidos entre
 * medio. Al navegar, el contenido saltaba varias decenas de píxeles y cada
 * pantalla parecía de un producto distinto.
 *
 * REGLA (Fase 5): una sola altura (--nx-h-module-header), un solo lugar para
 * el título, una sola zona de acciones a la derecha. El ícono va en neutro
 * dentro de la superficie —sin degradados de dos colores, que eran el resto
 * del look genérico— y el subtítulo es opcional y de una línea.
 *
 * Anatomía:
 *   [ícono] Título · píldoras de contexto        [acciones secundarias] [primaria]
 *           subtítulo de una línea
 *   ── barra opcional de filtros/buscador (`toolbar`) ──
 */
import React from 'react';

export interface ModuleHeaderProps {
    /** Ícono lucide ya instanciado (usar size={20}). */
    icon?: React.ReactNode;
    title: string;
    /** Una línea. Qué hace el módulo, no un párrafo de ayuda. */
    subtitle?: string;
    /** Píldoras/enlaces de contexto al lado del título (p. ej. Bodegas, Series). */
    contextLinks?: React.ReactNode;
    /** Acciones de la derecha. La primaria va última y es la única en verde. */
    actions?: React.ReactNode;
    /** Fila inferior opcional: buscador, filtros, chips. No afecta la altura del header. */
    toolbar?: React.ReactNode;
    /** Se pega al tope al hacer scroll. Nunca por encima del bloque de cobro. */
    sticky?: boolean;
    className?: string;
}

export const ModuleHeader: React.FC<ModuleHeaderProps> = ({
    icon,
    title,
    subtitle,
    contextLinks,
    actions,
    toolbar,
    sticky = false,
    className = '',
}) => (
    <header
        className={`nx-module-header ${sticky ? 'nx-module-header-sticky sticky top-0 z-sticky backdrop-blur' : ''} ${className}`}
    >
        {/* En móvil la fila ENVUELVE (las acciones bajan a su propia línea):
            con altura fija + dos bloques shrink-0, en 390px el botón primario
            se imprimía ENCIMA de los enlaces de contexto (auditoría de uso
            real). En md+ conserva la altura única de módulo. */}
        <div className="md:h-module py-3 md:py-0 flex flex-wrap md:flex-nowrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex items-center gap-3 min-w-0">
                {icon && (
                    <div className="nx-module-header-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-control border">
                        {icon}
                    </div>
                )}
                <div className="min-w-0">
                    {/* En móvil el título se lleva su propio renglón (`basis-full`)
                        y las píldoras bajan al siguiente. Sin eso, el h1 competía
                        con tres píldoras `shrink-0` en 390px y se encogía hasta
                        "M…": el header dejaba de decir en qué módulo estás. En md+
                        vuelven a la misma línea, sin cambios. */}
                    <div className="flex flex-wrap md:flex-nowrap items-center gap-x-3 gap-y-2 min-w-0">
                        <h1 className="nx-canvas-text basis-full truncate text-title font-bold md:basis-auto">{title}</h1>
                        {contextLinks && <div className="flex items-center gap-2 flex-wrap md:flex-nowrap md:shrink-0">{contextLinks}</div>}
                    </div>
                    {subtitle && <p className="nx-canvas-muted truncate text-sm">{subtitle}</p>}
                </div>
            </div>

            {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>

        {toolbar && <div className="pb-4">{toolbar}</div>}
    </header>
);

/**
 * Enlace de contexto del header (Bodegas, Series, Lotes…). Existe para que los
 * módulos no vuelvan a escribir a mano un `px-3 py-1.5` que queda por debajo
 * del objetivo táctil.
 */
export const ModuleHeaderLink: React.FC<{ href: string; children: React.ReactNode }> = ({ href, children }) => (
    <a
        href={href}
        className="nx-module-context-link nx-fluid-press inline-flex min-h-tap items-center rounded-control border px-3 text-xs font-semibold transition-colors"
    >
        {children}
    </a>
);

export default ModuleHeader;
