/**
 * NORTEX — Menú de acciones de desbordamiento (tres puntos).
 *
 * PROBLEMA QUE RESUELVE: las filas del inventario llegaron a tener 5-6 íconos
 * pegados (publicar, kardex, editar, lotes, ajustar, borrar), todos del mismo
 * peso visual y todos por debajo del objetivo táctil. El usuario no puede
 * distinguir la acción cotidiana de la peligrosa, y toca la equivocada.
 *
 * REGLA (Fase 5): en una fila quedan VISIBLES a lo sumo dos acciones —las de
 * uso diario, típicamente Ver y Editar—; todo lo demás entra acá. Las acciones
 * destructivas van con tone="danger" y separadas por un divisor: el rojo se
 * reserva para lo irreversible.
 *
 * Cierra con click afuera, con Escape y al elegir una opción. No usa portal:
 * vive dentro de la fila y se ancla a la derecha, que es donde está el botón.
 */
import React, { useEffect, useRef, useState } from 'react';
import { MoreVertical } from 'lucide-react';
import { IconButton } from './IconButton';

export interface ActionMenuItem {
    label: string;
    icon?: React.ReactNode;
    onClick: () => void;
    /** Destructiva: se pinta en rojo y se separa del resto. */
    danger?: boolean;
    disabled?: boolean;
    /** Oculta el ítem sin obligar al call-site a armar el array condicionalmente. */
    hidden?: boolean;
}

export interface ActionMenuProps {
    items: ActionMenuItem[];
    /** Etiqueta accesible del disparador (p. ej. "Más acciones de Martillo 16oz"). */
    label?: string;
    align?: 'left' | 'right';
    compact?: boolean;
}

export const ActionMenu: React.FC<ActionMenuProps> = ({
    items,
    label = 'Más acciones',
    align = 'right',
    compact = false,
}) => {
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;

        const onPointerDown = (event: MouseEvent | TouchEvent) => {
            if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false);
        };

        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('touchstart', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('touchstart', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    const visible = items.filter((item) => !item.hidden);
    if (visible.length === 0) return null;

    return (
        <div className="relative inline-block" ref={containerRef}>
            <IconButton
                icon={<MoreVertical size={16} />}
                label={label}
                compact={compact}
                active={open}
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen((value) => !value)}
            />

            {open && (
                <div
                    role="menu"
                    className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} top-full mt-1 z-sticky min-w-[13rem] rounded-card border border-slate-700 bg-slate-800 py-1 shadow-premium animate-fade-in-up`}
                >
                    {visible.map((item, index) => {
                        const previous = visible[index - 1];
                        const needsDivider = item.danger && previous && !previous.danger;

                        return (
                            <React.Fragment key={item.label}>
                                {needsDivider && <div className="my-1 h-px bg-slate-700" role="separator" />}
                                <button
                                    type="button"
                                    role="menuitem"
                                    disabled={item.disabled}
                                    onClick={() => {
                                        setOpen(false);
                                        item.onClick();
                                    }}
                                    className={`flex w-full min-h-tap items-center gap-3 px-4 text-left text-sm transition-colors disabled:opacity-45 disabled:cursor-not-allowed ${
                                        item.danger
                                            ? 'text-danger hover:bg-danger-soft'
                                            : 'text-slate-200 hover:bg-white/[0.06]'
                                    }`}
                                >
                                    {item.icon}
                                    {item.label}
                                </button>
                            </React.Fragment>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default ActionMenu;
