/**
 * NORTEX — Estado vacío único.
 *
 * PROBLEMA QUE RESUELVE: había ~55 estados vacíos con 5 anatomías distintas
 * (fila de tabla con texto pelado, <p> suelto, icono+texto, tres "hero" con
 * tres paletas diferentes) y la mayoría no decía qué hacer: "Sin gastos
 * registrados", "Carrito vacío", una tabla en blanco. Un vacío sin salida es
 * una pantalla muerta; el día 0 de un negocio nuevo son casi todas.
 *
 * REGLA: todo vacío tiene ícono, título, UNA frase de valor y un botón
 * primario. El componente no permite construir uno sin salida.
 *
 * Los tres modos son distintos a propósito (fue un hallazgo de auditoría, C8):
 *   empty      → no hay datos todavía  → invita a crear el primero
 *   no-results → hay datos, el filtro no matchea → invita a limpiar la búsqueda
 *   error      → no pudimos cargar     → invita a reintentar
 * Mezclar "está vacío" con "no cargó" hace que el usuario crea que perdió sus
 * datos.
 */
import React from 'react';
import { AlertTriangle, SearchX, Inbox } from 'lucide-react';

export type EmptyStateMode = 'empty' | 'no-results' | 'error';

export interface EmptyStateAction {
    label: string;
    onClick: () => void;
    icon?: React.ReactNode;
    /** Deshabilita y muestra el label alterno (p. ej. mientras importa). */
    loading?: boolean;
    loadingLabel?: string;
}

export interface EmptyStateProps {
    mode?: EmptyStateMode;
    /** Ícono lucide ya instanciado. Si se omite, se usa el del modo. */
    icon?: React.ReactNode;
    title: string;
    /** Una frase. Qué gana el usuario si actúa, no qué falta. */
    description?: string;
    action?: EmptyStateAction;
    secondaryAction?: EmptyStateAction;
    /** Acción terciaria como enlace de texto (p. ej. "cargá un catálogo de ejemplo"). */
    linkAction?: EmptyStateAction;
    /** Mensaje de error bajo las acciones (p. ej. falló el seed). */
    errorText?: string | null;
    className?: string;
}

const DEFAULT_ICON: Record<EmptyStateMode, React.ReactNode> = {
    'empty': <Inbox size={32} />,
    'no-results': <SearchX size={32} />,
    'error': <AlertTriangle size={32} />,
};

const ActionButton: React.FC<{ action: EmptyStateAction; variant: 'primary' | 'secondary' }> = ({ action, variant }) => (
    <button
        type="button"
        onClick={action.onClick}
        disabled={action.loading}
        className={
            variant === 'primary'
                ? 'nx-fluid-press h-touch inline-flex items-center justify-center gap-2 px-5 rounded-control bg-brand text-brand-on font-semibold hover:bg-brand-hover transition-colors disabled:opacity-45 disabled:cursor-not-allowed'
                : 'nx-empty-action-secondary nx-fluid-press h-touch inline-flex items-center justify-center gap-2 px-5 rounded-control border font-semibold transition-colors disabled:opacity-45 disabled:cursor-not-allowed'
        }
    >
        {action.icon}
        {action.loading ? (action.loadingLabel ?? 'Cargando…') : action.label}
    </button>
);

export const EmptyState: React.FC<EmptyStateProps> = ({
    mode = 'empty',
    icon,
    title,
    description,
    action,
    secondaryAction,
    linkAction,
    errorText,
    className = '',
}) => (
    <div className={`nx-empty-state mx-auto flex max-w-md flex-col items-center justify-center px-4 py-14 text-center ${className}`}>
        <div
            className={`mb-5 flex h-16 w-16 items-center justify-center rounded-pill border ${
                mode === 'error'
                    ? 'nx-tone-danger-bg'
                    : 'nx-empty-state-icon'
            }`}
        >
            {icon ?? DEFAULT_ICON[mode]}
        </div>

        <h3 className="nx-canvas-text mb-2 text-title font-bold">{title}</h3>
        {description && <p className="nx-canvas-muted mb-6 leading-relaxed">{description}</p>}

        {(action || secondaryAction) && (
            <div className="flex flex-wrap items-center justify-center gap-3">
                {action && <ActionButton action={action} variant="primary" />}
                {secondaryAction && <ActionButton action={secondaryAction} variant="secondary" />}
            </div>
        )}

        {linkAction && (
            <button
                type="button"
                onClick={linkAction.onClick}
                disabled={linkAction.loading}
                className="nx-empty-link nx-fluid-press mt-4 min-h-tap text-sm underline underline-offset-4 transition-colors disabled:opacity-50 disabled:no-underline"
            >
                {linkAction.loading ? (linkAction.loadingLabel ?? 'Cargando…') : linkAction.label}
            </button>
        )}

        {errorText && <p className="nx-tone-danger mt-3 text-sm">{errorText}</p>}
    </div>
);

/**
 * Variante para usar dentro de un <tbody>: envuelve el estado vacío en la fila
 * que la tabla necesita. Sin esto, cada pantalla reinventa el <tr><td colSpan>.
 */
export const TableEmptyState: React.FC<EmptyStateProps & { colSpan: number }> = ({ colSpan, ...props }) => (
    <tr>
        <td colSpan={colSpan} className="p-0">
            <EmptyState {...props} />
        </td>
    </tr>
);

export default EmptyState;
