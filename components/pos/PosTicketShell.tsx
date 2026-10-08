import React, { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import FluidSheet from '../ui/FluidSheet';

const DESKTOP_QUERY = '(min-width: 1024px)';

const readsAsDesktop = (): boolean =>
    typeof globalThis.matchMedia !== 'function'
    || globalThis.matchMedia(DESKTOP_QUERY).matches;

export interface PosTicketShellProps {
    open: boolean;
    onOpen: () => void;
    onClose: () => void;
    guidedSimpleMode: boolean;
    labelledBy: string;
    children: ReactNode;
}

/**
 * Carcasa visual del ticket; el estado de venta permanece en POS.
 *
 * En movil compone el motor modal de FluidSheet. En escritorio conserva el
 * ticket lateral persistente, sin backdrop, bloqueo de body ni semantica de
 * dialogo. Solo se monta una rama para no duplicar IDs o formularios.
 */
export const PosTicketShell: React.FC<PosTicketShellProps> = ({
    open,
    onOpen,
    onClose,
    guidedSimpleMode,
    labelledBy,
    children,
}) => {
    const [desktop, setDesktop] = useState(readsAsDesktop);
    const desktopRef = useRef(desktop);
    const openRef = useRef(open);
    const onOpenRef = useRef(onOpen);

    openRef.current = open;
    onOpenRef.current = onOpen;

    useEffect(() => {
        if (typeof globalThis.matchMedia !== 'function') return;
        const query = globalThis.matchMedia(DESKTOP_QUERY);
        const updateMode = () => {
            const nextDesktop = query.matches;
            const wasDesktop = desktopRef.current;
            desktopRef.current = nextDesktop;
            setDesktop(nextDesktop);

            // El sidebar siempre estaba visible. Al reducir la ventana, abrir
            // su equivalente movil conserva el contexto en vez de ocultarlo.
            if (wasDesktop && !nextDesktop && !openRef.current) {
                onOpenRef.current();
            }
        };

        updateMode();
        if (typeof query.addEventListener === 'function') {
            query.addEventListener('change', updateMode);
            return () => query.removeEventListener('change', updateMode);
        }
        query.addListener?.(updateMode);
        return () => query.removeListener?.(updateMode);
    }, []);

    if (desktop) {
        return (
            <aside
                className={`nx-pos-receipt nx-dark-context nx-ticket-surface z-auto flex flex-col border border-white/[0.06] ${
                    guidedSimpleMode
                        ? 'mt-16 mr-3 mb-3 w-[38%] min-w-[420px] max-w-[560px] rounded-card'
                        : 'mt-14 w-96 shadow-xl'
                }`}
                data-pos-ticket-mode="desktop"
                aria-labelledby={labelledBy}
            >
                {children}
            </aside>
        );
    }

    return (
        <FluidSheet
            open={open}
            onClose={onClose}
            labelledBy={labelledBy}
            size="full"
            panelClassName="nx-pos-ticket-sheet nx-dark-context nx-ticket-surface"
        >
            {children}
        </FluidSheet>
    );
};

export default PosTicketShell;
