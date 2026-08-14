/**
 * NORTEX — Botón de ícono con objetivo táctil garantizado.
 *
 * PROBLEMA QUE RESUELVE: las acciones por fila del inventario (publicar,
 * kardex, editar, lotes, ajustar) eran `p-2` sobre un ícono de 14-16px → ~30px
 * de área tocable. En una tablet de mostrador, con el dedo y con prisa, eso
 * significa tocar "eliminar" cuando se quería "editar". El mínimo de 44×44
 * (--nx-tap-min) no es cosmético: es la diferencia entre un ajuste de stock
 * correcto y uno equivocado.
 *
 * REGLA: ningún ícono accionable se renderiza con padding suelto. O usa este
 * componente, o va dentro de un ActionMenu. El área crece sin agrandar el
 * ícono — el glifo sigue siendo de 16px, lo que crece es la zona de toque.
 */
import React from 'react';

export type IconButtonTone = 'neutral' | 'brand' | 'danger' | 'warning';

export interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
    /** Ícono lucide ya instanciado (usar size={16}). */
    icon: React.ReactNode;
    /** Obligatorio: va al title y al aria-label. Un ícono sin nombre no es accesible. */
    label: string;
    tone?: IconButtonTone;
    /** Estado "encendido" (p. ej. producto publicado): pinta el fondo del tono. */
    active?: boolean;
    /** Densa (36px) para barras de herramientas de escritorio. El default es táctil. */
    compact?: boolean;
}

const TONE: Record<IconButtonTone, { idle: string; active: string }> = {
    neutral: {
        idle: 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.06]',
        active: 'text-slate-100 bg-white/[0.10]',
    },
    brand: {
        idle: 'text-slate-400 hover:text-brand hover:bg-brand-soft',
        active: 'text-brand bg-brand-soft',
    },
    danger: {
        idle: 'text-slate-400 hover:text-danger hover:bg-danger-soft',
        active: 'text-danger bg-danger-soft',
    },
    warning: {
        idle: 'text-slate-400 hover:text-warning hover:bg-warning-soft',
        active: 'text-warning bg-warning-soft',
    },
};

export const IconButton: React.FC<IconButtonProps> = ({
    icon,
    label,
    tone = 'neutral',
    active = false,
    compact = false,
    className = '',
    ...rest
}) => {
    const size = compact ? 'h-compact w-compact min-w-[36px]' : 'h-touch w-touch min-w-tap min-h-tap';
    const palette = TONE[tone];

    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={active || undefined}
            className={`${size} inline-flex items-center justify-center rounded-control transition-colors ${
                active ? palette.active : palette.idle
            } focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ring disabled:opacity-45 disabled:cursor-not-allowed ${className}`}
            {...rest}
        >
            {icon}
        </button>
    );
};

export default IconButton;
