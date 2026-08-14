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
        onClick={action.onClick}
        disabled={action.loading}
        className={
            variant === 'primary'
                ? 'h-touch inline-flex items-center justify-center gap-2 px-5 rounded-control bg-brand text-[#06231A] font-semibold hover:bg-brand-hover transition-colors disabled:opacity-45 disabled:cursor-not-allowed'
                : 'h-touch inline-flex items-center justify-center gap-2 px-5 rounded-control bg-transparent text-slate-100 border border-slate-700 font-semibold hover:bg-white/[0.04] transition-colors disabled:opacity-45'
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
    <div className={`flex flex-col items-center justify-center text-center max-w-md mx-auto py-14 px-4 ${className}`}>
        <div
            className={`w-16 h-16 rounded-pill flex items-center justify-center mb-5 border ${
                mode === 'error'
                    ? 'bg-danger-soft text-danger border-danger/20'
                    : 'bg-brand-soft text-brand border-brand/20'
            }`}
        >
            {icon ?? DEFAULT_ICON[mode]}
        </div>

        <h3 className="text-title font-bold text-slate-100 mb-2">{title}</h3>
        {description && <p className="text-slate-400 mb-6 leading-relaxed">{description}</p>}

        {(action || secondaryAction) && (
            <div className="flex flex-wrap items-center justify-center gap-3">
                {action && <ActionButton action={action} variant="primary" />}
                {secondaryAction && <ActionButton action={secondaryAction} variant="secondary" />}
            </div>
        )}

        {linkAction && (
            <button
                onClick={linkAction.onClick}
                disabled={linkAction.loading}
                className="mt-4 text-sm text-slate-400 hover:text-slate-200 underline underline-offset-4 disabled:opacity-50 disabled:no-underline transition-colors"
            >
                {linkAction.loading ? (linkAction.loadingLabel ?? 'Cargando…') : linkAction.label}
            </button>
        )}

        {errorText && <p className="text-danger text-sm mt-3">{errorText}</p>}
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
