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
 * Cierra con click afuera, con Escape y al elegir una opción.
 *
 * SE MONTA EN UN PORTAL, y no es cosmético. Vivía dentro de la fila, anclado
 * con `absolute`, y un cliente reportó (2026-09-14) que en la ficha de producto
 * sólo se veía su franja superior. La ficha —`.nx-stock-pane`— lleva
 * `overflow: hidden` para que sus hijos respeten el `border-radius: 22px`
 * (components/inventory/stockWorkspace.css:4), y el "⋮" es el ÚLTIMO elemento
 * del panel: el menú abría hacia abajo, contra el borde, y quedaba decapitado.
 * Por eso fallaba igual en laptop, tablet y celular — no era el viewport, era
 * el contenedor. En móvil la ficha viaja además dentro de
 * `.nx-fluid-sheet-panel`, que suma `overflow: hidden` y `will-change:
 * transform`; ese `will-change` crea containing block, así que ni un
 * `position: fixed` sin portal escaparía.
 *
 * Dos cosas que hay que conservar al tocar este archivo:
 *  1. El guard de "click afuera" mira el disparador Y el menú. Con portal ya no
 *     son parientes; si sólo mirara el disparador, cerraría el menú antes de
 *     que el botón reciba su click y la opción quedaría inelegible.
 *  2. El menú se voltea hacia arriba cuando no hay lugar abajo — que en esta
 *     ficha es el caso normal, no el borde.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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

/** Alto de un ítem táctil (min-h-tap = 44px) más el respiro vertical del menú. */
const ITEM_HEIGHT = 44;
const MENU_PADDING = 8;
const GAP = 4;

interface MenuPosition {
    placement: 'top' | 'bottom';
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
}

export const ActionMenu: React.FC<ActionMenuProps> = ({
    items,
    label = 'Más acciones',
    align = 'right',
    compact = false,
}) => {
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState<MenuPosition | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    const visible = items.filter((item) => !item.hidden);

    /**
     * Decide arriba o abajo con la altura ESTIMADA, no medida: medir exigiría
     * un segundo render y en la ficha el disparador está siempre contra el
     * borde inferior, donde la estimación y la medición coinciden.
     */
    const place = useCallback(() => {
        const trigger = containerRef.current;
        if (!trigger) return;
        const rect = trigger.getBoundingClientRect();
        const viewportHeight = window.innerHeight;

        // El disparador salió de vista al hacer scroll: un menú anclado a algo
        // que ya no se ve confunde más de lo que ayuda.
        if (rect.bottom < 0 || rect.top > viewportHeight) {
            setOpen(false);
            return;
        }

        const estimated = visible.length * ITEM_HEIGHT + MENU_PADDING;
        const spaceBelow = viewportHeight - rect.bottom;
        const spaceAbove = rect.top;
        const flip = spaceBelow < estimated && spaceAbove > spaceBelow;

        setPosition({
            placement: flip ? 'top' : 'bottom',
            ...(flip
                ? { bottom: viewportHeight - rect.top + GAP }
                : { top: rect.bottom + GAP }),
            ...(align === 'right'
                ? { right: window.innerWidth - rect.right }
                : { left: rect.left }),
        });
    }, [align, visible.length]);

    useLayoutEffect(() => {
        if (!open) {
            setPosition(null);
            return;
        }
        place();
    }, [open, place]);

    useEffect(() => {
        if (!open) return;

        const onPointerDown = (event: MouseEvent | TouchEvent) => {
            const target = event.target as Node;
            // Con portal el menú NO es descendiente del disparador: hay que
            // mirar los dos, o un click en una opción cerraría antes de elegir.
            if (containerRef.current?.contains(target)) return;
            if (menuRef.current?.contains(target)) return;
            setOpen(false);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false);
        };
        const onReflow = () => place();

        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('touchstart', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        // `capture` para que también lleguen los scrolls de contenedores
        // internos, que son justamente los que mueven esta ficha.
        window.addEventListener('scroll', onReflow, true);
        window.addEventListener('resize', onReflow);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('touchstart', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('scroll', onReflow, true);
            window.removeEventListener('resize', onReflow);
        };
    }, [open, place]);

    if (visible.length === 0) return null;

    return (
        // Sin `relative`: el menú ya no se ancla a este contenedor sino al
        // viewport. Dejarlo sugeriría un anclaje que no existe.
        <div className="inline-block" ref={containerRef}>
            <IconButton
                icon={<MoreVertical size={16} />}
                label={label}
                compact={compact}
                active={open}
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen((value) => !value)}
            />

            {open && position && createPortal(
                <div
                    ref={menuRef}
                    role="menu"
                    data-placement={position.placement}
                    style={{
                        position: 'fixed',
                        top: position.top,
                        bottom: position.bottom,
                        left: position.left,
                        right: position.right,
                    }}
                    // z-modal (50) y no z-sticky (10): el menú vive en el body
                    // y tiene que quedar sobre la hoja móvil. `z-toast` (60)
                    // NO es opción: los tokens la reservan para avisos
                    // transitorios que no capturan el puntero, y un menú es
                    // persistente y sí lo captura (nortex-tokens.css:194-199).
                    //
                    // Queda empatado en 50 con `.nx-fluid-sheet-root`, así que
                    // decide el orden del DOM. Gana el menú, y no por azar: su
                    // disparador vive DENTRO de la hoja, o sea que la hoja ya
                    // estaba montada cuando este portal se agrega al body.
                    className="z-modal min-w-[13rem] rounded-card border border-slate-700 bg-slate-800 py-1 shadow-premium animate-fade-in-up"
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
                </div>,
                document.body,
            )}
        </div>
    );
};

export default ActionMenu;
