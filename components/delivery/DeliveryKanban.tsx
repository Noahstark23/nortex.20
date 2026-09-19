import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import {
    CheckCircle,
    ChevronRight,
    Clock,
    GripVertical,
    Loader2,
    MapPin,
    Package,
    Phone,
    Truck,
} from 'lucide-react';
import { formatMoney } from '../../utils/money';
import { prefersReducedMotion } from '../../utils/fluidMotion';
import FluidSegmentedControl from '../ui/FluidSegmentedControl';
import { useDeliveryKanbanDrag } from './useDeliveryKanbanDrag';

export type DeliveryVisibleState = 'pendiente' | 'preparando' | 'en_camino' | 'entregado';
export type DeliveryState = DeliveryVisibleState;

export const DELIVERY_VISIBLE_STATES: readonly DeliveryVisibleState[] = [
    'pendiente',
    'preparando',
    'en_camino',
    'entregado',
] as const;

/**
 * Unica politica de avance que puede iniciar este tablero. Los estados de ruta
 * y entrega son deliberadamente terminales para esta superficie.
 */
export const DELIVERY_NEXT_STATE: Readonly<Partial<Record<DeliveryVisibleState, DeliveryVisibleState>>> =
    Object.freeze({
        pendiente: 'preparando',
        preparando: 'en_camino',
    });

export const getNextDeliveryState = (estado: string): DeliveryVisibleState | null =>
    DELIVERY_NEXT_STATE[estado as DeliveryVisibleState] ?? null;

export interface DeliveryRider {
    id: string;
    nombre: string;
    telefono?: string;
    tipoFlota?: string;
    activo?: boolean;
}

export interface DeliveryOrder {
    id: string;
    clienteNombre: string;
    clienteTelefono?: string;
    direccionEntrega?: string;
    estado: string;
    total: number;
    createdAt?: string;
    motorizadoId?: string | null;
    motorizado?: {
        id: string;
        nombre: string;
        telefono?: string;
        tipoFlota?: string;
    } | null;
    items?: Array<{
        cantidad: number;
        producto?: { name?: string | null } | null;
    }>;
}

export interface DeliveryKanbanProps {
    pedidos: DeliveryOrder[];
    activeRiders: DeliveryRider[];
    assigningId: string | null;
    movingId: string | null;
    onAssign: (pedidoId: string, motorizadoId: string) => void | Promise<void>;
    onMove: (
        pedidoId: string,
        nextEstado: DeliveryVisibleState,
    ) => Promise<boolean> | boolean;
    announce?: (message: string) => void;
}

const COLUMNAS = [
    {
        id: 'pendiente',
        title: 'Nuevos',
        shortTitle: 'Nuevos',
        action: 'Iniciar preparación',
        icon: Clock,
        color: 'border-amber-200 bg-amber-50',
        badge: 'bg-amber-100 text-amber-800',
    },
    {
        id: 'preparando',
        title: 'Preparando',
        shortTitle: 'Prep.',
        action: 'Despachar',
        icon: Package,
        color: 'border-slate-200 bg-white',
        badge: 'bg-slate-100 text-slate-700',
    },
    {
        id: 'en_camino',
        title: 'En camino',
        shortTitle: 'Ruta',
        action: null,
        icon: Truck,
        color: 'border-brand/20 bg-brand-soft',
        badge: 'bg-brand-soft text-brand',
    },
    {
        id: 'entregado',
        title: 'Entregados',
        shortTitle: 'Entreg.',
        action: null,
        icon: CheckCircle,
        color: 'border-slate-200 bg-slate-50',
        badge: 'bg-white text-brand',
    },
] as const satisfies ReadonlyArray<{
    id: DeliveryVisibleState;
    title: string;
    shortTitle: string;
    action: string | null;
    icon: typeof Clock;
    color: string;
    badge: string;
}>;

const labelForState = (state: DeliveryVisibleState): string =>
    COLUMNAS.find((column) => column.id === state)?.title ?? state;

const BOARD_CLASS_NAME = [
    'no-scrollbar flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain p-4',
    'lg:grid lg:grid-cols-4 lg:items-start lg:overflow-x-visible lg:snap-none lg:p-6',
].join(' ');

const COLUMN_CLASS_NAME = [
    'flex min-h-72 min-w-0 basis-full shrink-0 snap-start flex-col rounded-card border',
    'lg:max-h-[calc(100dvh-260px)] lg:basis-auto lg:shrink',
].join(' ');

const EMPTY_ICON_CLASS_NAME = [
    'mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-card border',
    'border-slate-200 bg-white text-slate-500',
].join(' ');

const CARD_CLASS_NAME = 'overflow-hidden rounded-card border border-slate-200 bg-white shadow-sm';
const CARD_HEADER_CLASS_NAME = 'flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5';
const CARD_TITLE_CLASS_NAME = 'min-w-0 flex-1 truncate text-sm font-bold text-slate-950';

const DRAG_HANDLE_CLASS_NAME = [
    'hidden min-h-11 min-w-11 shrink-0 touch-none items-center justify-center rounded-control',
    'lg:inline-flex',
].join(' ');

const PHONE_LINK_CLASS_NAME = [
    'nx-fluid-press inline-flex min-h-tap items-center gap-1.5 text-xs text-slate-600',
    'transition-colors hover:text-brand',
].join(' ');

const RIDER_SELECT_CLASS_NAME = [
    'min-h-tap w-full appearance-none rounded-control border border-slate-300 bg-white px-3 py-2 pr-8',
    'text-xs text-slate-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-ring',
    'disabled:opacity-60',
].join(' ');

const ACTION_BUTTON_CLASS_NAME = [
    'flex min-h-tap w-full items-center justify-center gap-1.5 rounded-control py-2',
    'text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
].join(' ');

const useReducedMotion = (): boolean => {
    const [reduced, setReduced] = useState(prefersReducedMotion);

    useEffect(() => {
        if (typeof globalThis.matchMedia !== 'function') return;
        const query = globalThis.matchMedia('(prefers-reduced-motion: reduce)');
        const update = () => setReduced(query.matches);
        update();
        query.addEventListener?.('change', update);
        return () => query.removeEventListener?.('change', update);
    }, []);

    return reduced;
};

/**
 * Capa presentacional del tablero. No conoce rutas ni hace fetch: una mutacion
 * solo puede salir por `onMove`, despues de un click accesible o pointerup valido.
 */
export const DeliveryKanban: React.FC<DeliveryKanbanProps> = ({
    pedidos,
    activeRiders,
    assigningId,
    movingId,
    onAssign,
    onMove,
    announce,
}) => {
    const reducedMotion = useReducedMotion();
    const [activeColumn, setActiveColumn] = useState<DeliveryVisibleState>('pendiente');
    const [localMovingId, setLocalMovingId] = useState<string | null>(null);
    const [liveAnnouncement, setLiveAnnouncement] = useState({ id: 0, message: '' });

    const boardRef = useRef<HTMLDivElement | null>(null);
    const columnRefs = useRef(new Map<DeliveryVisibleState, HTMLElement>());
    const inFlightRef = useRef(new Set<string>());
    const scrollFrameRef = useRef<number | null>(null);

    const say = useCallback((message: string) => {
        setLiveAnnouncement((current) => ({ id: current.id + 1, message }));
        announce?.(message);
    }, [announce]);

    const pedidosPorEstado = useMemo(() => {
        const grouped: Record<DeliveryVisibleState, DeliveryOrder[]> = {
            pendiente: [],
            preparando: [],
            en_camino: [],
            entregado: [],
        };

        pedidos.forEach((pedido) => {
            if (DELIVERY_VISIBLE_STATES.includes(pedido.estado as DeliveryVisibleState)) {
                grouped[pedido.estado as DeliveryVisibleState].push(pedido);
            }
        });
        return grouped;
    }, [pedidos]);

    const segmentedItems = useMemo(() => COLUMNAS.map((column) => ({
        id: column.id,
        label: column.title,
        shortLabel: column.shortTitle,
        count: pedidosPorEstado[column.id].length,
    })), [pedidosPorEstado]);

    const handleMobileColumnChange = useCallback((id: string) => {
        if (!DELIVERY_VISIBLE_STATES.includes(id as DeliveryVisibleState)) return;
        const state = id as DeliveryVisibleState;
        setActiveColumn(state);
        columnRefs.current.get(state)?.scrollIntoView?.({
            behavior: 'auto',
            block: 'nearest',
            inline: 'start',
        });
    }, []);

    const focusMovedColumn = useCallback((state: DeliveryVisibleState) => {
        setActiveColumn(state);

        // En escritorio las cuatro columnas ya están visibles. En móvil,
        // mantener selector y carrusel en el mismo estado evita que una
        // mutación exitosa deje al usuario mirando una columna vacía.
        if (typeof globalThis.innerWidth !== 'number' || globalThis.innerWidth >= 1024) return;
        globalThis.requestAnimationFrame?.(() => {
            columnRefs.current.get(state)?.scrollIntoView?.({
                behavior: 'auto',
                block: 'nearest',
                inline: 'start',
            });
        });
    }, []);

    const performMove = useCallback(async (
        pedido: DeliveryOrder,
        nextState: DeliveryVisibleState,
    ): Promise<boolean> => {
        if (inFlightRef.current.has(pedido.id) || movingId === pedido.id) return false;
        if (pedido.estado === 'preparando' && !pedido.motorizadoId) {
            say('Asigná un motorizado para despachar');
            return false;
        }
        if (getNextDeliveryState(pedido.estado) !== nextState) return false;

        inFlightRef.current.add(pedido.id);
        setLocalMovingId(pedido.id);
        let result: boolean | Promise<boolean>;
        try {
            // La llamada ocurre sincronicamente aqui; en drag, este punto solo
            // se alcanza desde pointerup despues de validar el destino.
            result = onMove(pedido.id, nextState);
        } catch {
            result = false;
        }

        try {
            const moved = await result;
            if (moved) {
                focusMovedColumn(nextState);
                say(`Pedido de ${pedido.clienteNombre} movido a ${labelForState(nextState)}.`);
                return true;
            }
            say(`No se pudo mover el pedido de ${pedido.clienteNombre}.`);
            return false;
        } catch {
            say(`No se pudo mover el pedido de ${pedido.clienteNombre}.`);
            return false;
        } finally {
            inFlightRef.current.delete(pedido.id);
            setLocalMovingId((current) => current === pedido.id ? null : current);
        }
    }, [focusMovedColumn, movingId, onMove, say]);

    const {
        draggingId,
        dropTarget,
        handlePointerDown,
        handlePointerMove,
        handlePointerUp,
        handlePointerCancel,
        handleLostPointerCapture,
    } = useDeliveryKanbanDrag({
        reducedMotion,
        movingId,
        localMovingId,
        columnRefs,
        performMove,
        say,
        labelForState,
    });

    const handleBoardScroll = useCallback(() => {
        if (typeof requestAnimationFrame !== 'function' || scrollFrameRef.current !== null) return;
        scrollFrameRef.current = requestAnimationFrame(() => {
            scrollFrameRef.current = null;
            const board = boardRef.current;
            if (!board) return;
            const boardRect = board.getBoundingClientRect();
            const viewportCenter = (boardRect.left + boardRect.right) / 2;
            let nearest: DeliveryVisibleState | null = null;
            let nearestDistance = Number.POSITIVE_INFINITY;
            columnRefs.current.forEach((column, state) => {
                const rect = column.getBoundingClientRect();
                const distance = Math.abs((rect.left + rect.right) / 2 - viewportCenter);
                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearest = state;
                }
            });
            if (nearest) setActiveColumn(nearest);
        });
    }, []);

    const handleAssign = useCallback((pedido: DeliveryOrder, motorizadoId: string) => {
        try {
            const result = onAssign(pedido.id, motorizadoId);
            if (result && typeof result.then === 'function') {
                void result.catch(() => say(`No se pudo asignar el motorizado al pedido de ${pedido.clienteNombre}.`));
            }
        } catch {
            say(`No se pudo asignar el motorizado al pedido de ${pedido.clienteNombre}.`);
        }
    }, [onAssign, say]);

    useEffect(() => () => {
        if (scrollFrameRef.current !== null && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(scrollFrameRef.current);
        }
    }, []);

    return (
        <section aria-label="Tablero de pedidos" className="min-w-0">
            <p
                key={liveAnnouncement.id}
                role="status"
                aria-live="polite"
                aria-atomic="true"
                className="sr-only"
            >
                {liveAnnouncement.message}
            </p>

            <div className="bg-[var(--nx-canvas)] px-4 pb-2 pt-3 lg:hidden">
                <FluidSegmentedControl
                    items={segmentedItems}
                    activeId={activeColumn}
                    onChange={handleMobileColumnChange}
                    ariaLabel="Estado de los pedidos"
                />
            </div>

            <div
                ref={boardRef}
                role="region"
                aria-label="Columnas de pedidos"
                onScroll={handleBoardScroll}
                className={BOARD_CLASS_NAME}
            >
                {COLUMNAS.map((column) => {
                    const columnOrders = pedidosPorEstado[column.id];
                    const Icon = column.icon;
                    const highlighted = dropTarget === column.id;

                    return (
                        <section
                            key={column.id}
                            ref={(element) => {
                                if (element) columnRefs.current.set(column.id, element);
                                else columnRefs.current.delete(column.id);
                            }}
                            data-delivery-column={column.id}
                            data-drop-target={highlighted ? 'active' : undefined}
                            aria-label={`${column.title}, ${columnOrders.length} pedidos`}
                            className={`${COLUMN_CLASS_NAME} ${column.color} ${highlighted
                                ? 'border-brand bg-brand-soft/70 ring-4 ring-brand/20'
                                : ''}`}
                        >
                            <div className="flex items-center justify-between border-b border-slate-200/80 p-4">
                                <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                                    <Icon size={16} aria-hidden="true" /> {column.title}
                                </h3>
                                <span className={`rounded-pill px-2 py-0.5 text-xs font-bold ${column.badge}`}>
                                    {columnOrders.length}
                                </span>
                            </div>

                            <div className="no-scrollbar flex-1 space-y-3 overflow-y-auto p-3">
                                {columnOrders.length === 0 ? (
                                    <div className="py-10 text-center text-slate-500">
                                        <div className={EMPTY_ICON_CLASS_NAME}>
                                            <Icon size={18} aria-hidden="true" />
                                        </div>
                                        <p className="text-xs font-medium">Sin pedidos aquí</p>
                                    </div>
                                ) : columnOrders.map((pedido) => {
                                    const nextState = getNextDeliveryState(column.id);
                                    const needsRider = column.id === 'preparando' && !pedido.motorizadoId;
                                    const busy = movingId === pedido.id || localMovingId === pedido.id;
                                    const assigning = assigningId === pedido.id;
                                    const interactionBusy = busy || assigning;
                                    const helpId = `delivery-dispatch-help-${pedido.id}`;
                                    const selectId = `delivery-rider-${pedido.id}`;
                                    const cardTitleId = `delivery-order-${pedido.id}`;
                                    const canDrag = Boolean(nextState) && !needsRider && !interactionBusy;

                                    return (
                                        <article
                                            key={pedido.id}
                                            data-delivery-card={pedido.id}
                                            aria-labelledby={cardTitleId}
                                            aria-busy={busy || assigning}
                                            className={[
                                                CARD_CLASS_NAME,
                                                draggingId === pedido.id ? 'select-none' : '',
                                            ].join(' ')}
                                        >
                                            <div className={CARD_HEADER_CLASS_NAME}>
                                                <span id={cardTitleId} className={CARD_TITLE_CLASS_NAME}>
                                                    {pedido.clienteNombre}
                                                </span>
                                                <span className="nx-num shrink-0 text-sm font-black text-slate-950">
                                                    {formatMoney(Number(pedido.total))}
                                                </span>
                                                {nextState && (
                                                    <span
                                                        data-delivery-drag-handle={pedido.id}
                                                        data-drag-disabled={!canDrag ? 'true' : undefined}
                                                        aria-hidden="true"
                                                        title={needsRider
                                                            ? 'Asigná un motorizado para despachar'
                                                            : `Arrastrar a ${labelForState(nextState)}`}
                                                        onPointerDown={canDrag
                                                            ? (event) => handlePointerDown(event, pedido, nextState)
                                                            : undefined}
                                                        onPointerMove={canDrag ? handlePointerMove : undefined}
                                                        onPointerUp={canDrag ? handlePointerUp : undefined}
                                                        onPointerCancel={canDrag ? handlePointerCancel : undefined}
                                                        onLostPointerCapture={canDrag
                                                            ? handleLostPointerCapture
                                                            : undefined}
                                                        className={`${DRAG_HANDLE_CLASS_NAME} ${canDrag
                                                            ? [
                                                                'cursor-grab text-slate-500 hover:bg-slate-200',
                                                                'hover:text-slate-800 active:cursor-grabbing',
                                                            ].join(' ')
                                                            : 'cursor-not-allowed text-slate-300'}`}
                                                    >
                                                        <GripVertical size={18} aria-hidden="true" />
                                                    </span>
                                                )}
                                            </div>

                                            <div className="space-y-3 p-4">
                                                {pedido.clienteTelefono && (
                                                    <a
                                                        href={`tel:${pedido.clienteTelefono}`}
                                                        data-no-drag
                                                        className={PHONE_LINK_CLASS_NAME}
                                                    >
                                                        <Phone size={12} aria-hidden="true" />
                                                        {pedido.clienteTelefono}
                                                    </a>
                                                )}

                                                {pedido.direccionEntrega && (
                                                    <div className="flex items-start gap-1.5 text-xs text-slate-600">
                                                        <MapPin
                                                            size={12}
                                                            className="mt-0.5 shrink-0 text-slate-500"
                                                            aria-hidden="true"
                                                        />
                                                        <span className="line-clamp-2 leading-relaxed">
                                                            {pedido.direccionEntrega}
                                                        </span>
                                                    </div>
                                                )}

                                                {pedido.items && pedido.items.length > 0 && (
                                                    <div className="space-y-0.5 text-[11px] text-slate-500">
                                                        {pedido.items.slice(0, 2).map((item, index) => (
                                                            <div key={`${pedido.id}-item-${index}`}>
                                                                · {item.cantidad}× {item.producto?.name ?? 'Producto'}
                                                            </div>
                                                        ))}
                                                        {pedido.items.length > 2 && (
                                                            <div className="italic">
                                                                +{pedido.items.length - 2} más
                                                            </div>
                                                        )}
                                                    </div>
                                                )}

                                                {(column.id === 'pendiente' || column.id === 'preparando') && (
                                                    <div>
                                                        <label
                                                            htmlFor={selectId}
                                                            className={[
                                                                'mb-1 block text-[10px] font-bold uppercase',
                                                                'tracking-wider text-slate-500',
                                                            ].join(' ')}
                                                        >
                                                            Motorizado
                                                        </label>
                                                        <div className="relative">
                                                            <select
                                                                id={selectId}
                                                                data-no-drag
                                                                value={pedido.motorizadoId ?? ''}
                                                                onChange={(event) => {
                                                                    handleAssign(pedido, event.target.value);
                                                                }}
                                                                disabled={assigning || busy}
                                                                className={RIDER_SELECT_CLASS_NAME}
                                                            >
                                                                <option value="">— Sin asignar —</option>
                                                                {activeRiders.map((rider) => (
                                                                    <option key={rider.id} value={rider.id}>
                                                                        {rider.nombre}
                                                                    </option>
                                                                ))}
                                                            </select>
                                                            {assigning && (
                                                                <Loader2
                                                                    size={12}
                                                                    aria-label="Asignando motorizado"
                                                                    className={[
                                                                        'absolute right-2 top-1/2 -translate-y-1/2',
                                                                        'animate-spin text-brand',
                                                                    ].join(' ')}
                                                                />
                                                            )}
                                                        </div>
                                                    </div>
                                                )}

                                                {pedido.motorizado && (
                                                    <div className={[
                                                        'flex items-center gap-1.5 rounded-control bg-brand-soft',
                                                        'px-2.5 py-1.5 text-[11px] font-semibold text-brand',
                                                    ].join(' ')}>
                                                        <Truck size={11} aria-hidden="true" />
                                                        {pedido.motorizado.nombre}
                                                    </div>
                                                )}

                                                {needsRider && (
                                                    <p id={helpId} className="text-xs font-medium text-amber-700">
                                                        Asigná un motorizado para despachar
                                                    </p>
                                                )}
                                            </div>

                                            {nextState && (
                                                <div className="px-4 pb-4">
                                                    <button
                                                        type="button"
                                                        data-no-drag
                                                        aria-describedby={needsRider ? helpId : undefined}
                                                        onClick={() => void performMove(pedido, nextState)}
                                                        disabled={interactionBusy || needsRider}
                                                        className={[
                                                            'nx-fluid-press',
                                                            ACTION_BUTTON_CLASS_NAME,
                                                            column.id === 'pendiente'
                                                                ? 'bg-brand-soft text-brand hover:bg-brand/15'
                                                                : 'bg-brand text-brand-on hover:bg-brand-hover',
                                                        ].join(' ')}
                                                    >
                                                        {busy ? 'Moviendo…' : column.action}
                                                        {busy
                                                            ? (
                                                                <Loader2
                                                                    size={14}
                                                                    className="animate-spin"
                                                                    aria-hidden="true"
                                                                />
                                                            )
                                                            : <ChevronRight size={14} aria-hidden="true" />}
                                                    </button>
                                                </div>
                                            )}
                                        </article>
                                    );
                                })}
                            </div>
                        </section>
                    );
                })}
            </div>
        </section>
    );
};

export default DeliveryKanban;
