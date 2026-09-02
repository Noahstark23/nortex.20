import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Truck, Phone, Plus, X, Check, Link2, Loader2, User, AlertCircle
} from 'lucide-react';
import DeliveryKanban, {
    getNextDeliveryState,
    type DeliveryOrder,
    type DeliveryRider,
    type DeliveryVisibleState,
} from './delivery/DeliveryKanban';
import FluidSheet from './ui/FluidSheet';

type Pedido = DeliveryOrder;
type Motorizado = DeliveryRider;

interface RiderForm {
    nombre: string;
    telefono: string;
    zonaCobertura: string;
    vehiculoPlaca: string;
}

const EMPTY_RIDER_FORM: RiderForm = {
    nombre: '',
    telefono: '',
    zonaCobertura: '',
    vehiculoPlaca: '',
};

const getRiderFormError = (form: RiderForm): string | null => {
    const nombre = form.nombre.trim();
    const telefono = form.telefono.trim();
    const zonaCobertura = form.zonaCobertura.trim();
    const phoneDigits = telefono.replace(/\D/g, '');

    if (nombre.length < 3) return 'Ingresá el nombre completo del motorizado.';
    if (nombre.length > 100) return 'El nombre no puede superar 100 caracteres.';
    if (phoneDigits.length < 8 || phoneDigits.length > 15) {
        return 'Ingresá un teléfono o WhatsApp válido de 8 a 15 dígitos.';
    }
    if (telefono.length > 32) return 'El teléfono no puede superar 32 caracteres.';
    if (zonaCobertura.length < 2) return 'Ingresá la zona de cobertura del motorizado.';
    if (zonaCobertura.length > 100) return 'La zona de cobertura no puede superar 100 caracteres.';
    if (form.vehiculoPlaca.trim().length > 20) {
        return 'La placa o descripción del vehículo no puede superar 20 caracteres.';
    }
    return null;
};

interface PedidoListResponse {
    pedidos?: Pedido[];
};

interface PedidoResponse {
    pedido?: Pedido;
    error?: string;
}

const readResponseBody = async (response: Response): Promise<PedidoResponse> => {
    try {
        return await response.json() as PedidoResponse;
    } catch {
        return {};
    }
};

export const mergePendingOrders = (
    serverOrders: Pedido[],
    currentOrders: Pedido[],
    pendingIds: ReadonlySet<string>,
): Pedido[] => {
    if (pendingIds.size === 0) return serverOrders;

    const currentById = new Map(currentOrders.map((pedido) => [pedido.id, pedido]));
    const serverIds = new Set(serverOrders.map((pedido) => pedido.id));
    const merged = serverOrders.map((pedido) => (
        pendingIds.has(pedido.id) ? currentById.get(pedido.id) ?? pedido : pedido
    ));

    currentOrders.forEach((pedido) => {
        if (pendingIds.has(pedido.id) && !serverIds.has(pedido.id)) merged.push(pedido);
    });
    return merged;
};

const DeliveryManager: React.FC = () => {
    const token = localStorage.getItem('nortex_token');

    const [pedidos, setPedidos]           = useState<Pedido[]>([]);
    const [motorizados, setMotorizados]   = useState<Motorizado[]>([]);
    const [loading, setLoading]           = useState(true);

    // Modal: nuevo motorizado
    const [showNewRider, setShowNewRider] = useState(false);
    const [riderForm, setRiderForm]       = useState<RiderForm>(EMPTY_RIDER_FORM);
    const [savingRider, setSavingRider]   = useState(false);
    const [riderError, setRiderError]     = useState('');

    // UI feedback
    const [copiedId, setCopiedId]         = useState<string | null>(null);
    const [assigningId, setAssigningId]   = useState<string | null>(null);
    const [movingId, setMovingId]         = useState<string | null>(null);
    const [deliveryError, setDeliveryError] = useState('');
    const [deliveryMessage, setDeliveryMessage] = useState('');

    const pedidosRef = useRef<Pedido[]>([]);
    const pendingTransitionsRef = useRef(new Set<string>());
    const assignmentInFlightRef = useRef<string | null>(null);
    const dataEpochRef = useRef(0);

    const updatePedidos = useCallback((updater: (current: Pedido[]) => Pedido[]) => {
        setPedidos((current) => {
            const next = updater(current);
            pedidosRef.current = next;
            return next;
        });
    }, []);

    const fetchData = useCallback(async () => {
        const requestEpoch = dataEpochRef.current;
        try {
            const [pRes, mRes] = await Promise.all([
                fetch('/api/v1/pedidos', { headers: { Authorization: `Bearer ${token}` } }),
                fetch('/api/v1/motorizados', { headers: { Authorization: `Bearer ${token}` } }),
            ]);
            if (pRes.ok) {
                const body = await pRes.json() as PedidoListResponse;
                if (requestEpoch !== dataEpochRef.current) return;
                updatePedidos((current) => mergePendingOrders(
                    Array.isArray(body.pedidos) ? body.pedidos : [],
                    current,
                    pendingTransitionsRef.current,
                ));
            }
            if (mRes.ok) {
                const d = await mRes.json() as { motorizados?: Motorizado[] };
                if (requestEpoch !== dataEpochRef.current) return;
                setMotorizados(Array.isArray(d.motorizados) ? d.motorizados : []);
            }
        } catch (e) {
            console.error('DeliveryManager fetch error:', e);
        } finally {
            setLoading(false);
        }
    }, [token, updatePedidos]);

    useEffect(() => {
        void fetchData();
        const interval = setInterval(() => void fetchData(), 15_000);
        return () => clearInterval(interval);
    }, [fetchData]);

    const updateEstado = async (
        id: string,
        nuevoEstado: DeliveryVisibleState,
    ): Promise<boolean> => {
        const current = pedidosRef.current.find((pedido) => pedido.id === id);
        if (!current || getNextDeliveryState(current.estado) !== nuevoEstado) {
            setDeliveryError('Ese cambio ya no está disponible. Actualizamos el tablero para evitar un estado incorrecto.');
            void fetchData();
            return false;
        }
        if (current.estado === 'preparando' && !current.motorizadoId) {
            setDeliveryError('Asigná un motorizado antes de despachar el pedido.');
            return false;
        }
        if (pendingTransitionsRef.current.size > 0 || assignmentInFlightRef.current) {
            setDeliveryError('Esperá a que termine el cambio anterior antes de mover otro pedido.');
            return false;
        }

        dataEpochRef.current += 1;
        pendingTransitionsRef.current.add(id);
        setMovingId(id);
        setDeliveryError('');
        setDeliveryMessage(`Moviendo el pedido de ${current.clienteNombre}…`);
        updatePedidos((orders) => orders.map((pedido) => (
            pedido.id === id ? { ...pedido, estado: nuevoEstado } : pedido
        )));

        let receivedResponse = false;
        try {
            const response = await fetch(`/api/v1/pedidos/${id}/estado`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    estado: nuevoEstado,
                    nota: `Movido a ${nuevoEstado} desde Torre de Control`,
                }),
            });
            receivedResponse = true;
            const body = await readResponseBody(response);
            if (!response.ok) {
                throw new Error(body.error || 'El servidor rechazó el cambio de estado.');
            }
            if (!body.pedido || body.pedido.estado !== nuevoEstado) {
                throw new Error('El servidor respondió sin confirmar el nuevo estado.');
            }

            updatePedidos((orders) => orders.map((pedido) => (
                pedido.id === id
                    ? {
                        ...pedido,
                        ...body.pedido,
                        motorizado: body.pedido?.motorizado ?? pedido.motorizado,
                        items: body.pedido?.items ?? pedido.items,
                    }
                    : pedido
            )));
            setDeliveryMessage(`Pedido de ${current.clienteNombre} actualizado correctamente.`);
            return true;
        } catch (error) {
            updatePedidos((orders) => orders.map((pedido) => (
                pedido.id === id ? { ...pedido, estado: current.estado } : pedido
            )));
            const detail = error instanceof Error ? error.message : 'No se pudo actualizar el pedido.';
            setDeliveryError(receivedResponse
                ? detail
                : 'No pudimos confirmar el cambio. Restauramos la vista y estamos sincronizando con el servidor.');
            setDeliveryMessage('');
            return false;
        } finally {
            pendingTransitionsRef.current.delete(id);
            setMovingId((activeId) => activeId === id ? null : activeId);
            dataEpochRef.current += 1;
            void fetchData();
        }
    };

    const assignMotorizado = async (pedidoId: string, motorizadoId: string) => {
        if (assignmentInFlightRef.current || pendingTransitionsRef.current.size > 0) {
            setDeliveryError('Esperá a que termine el cambio anterior antes de asignar un motorizado.');
            return;
        }

        assignmentInFlightRef.current = pedidoId;
        dataEpochRef.current += 1;
        setAssigningId(pedidoId);
        setDeliveryError('');
        setDeliveryMessage('Asignando motorizado…');
        let assignmentConfirmed = false;
        try {
            const res = await fetch(`/api/v1/pedidos/${pedidoId}/motorizado`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ motorizadoId: motorizadoId || null }),
            });
            const body = await readResponseBody(res);
            if (!res.ok || !body.pedido) {
                throw new Error(body.error || 'No se pudo asignar el motorizado.');
            }
            if (!Object.prototype.hasOwnProperty.call(body.pedido, 'motorizadoId')) {
                throw new Error('El servidor respondió sin confirmar la asignación.');
            }

            const canonicalRiderId = body.pedido.motorizadoId ?? null;
            assignmentConfirmed = true;
            const canonicalRider = body.pedido.motorizado ?? (canonicalRiderId
                ? motorizados.find((candidate) => candidate.id === canonicalRiderId)
                : undefined);
            updatePedidos((orders) => orders.map((pedido) => (
                pedido.id === pedidoId
                    ? {
                        ...pedido,
                        ...body.pedido,
                        motorizadoId: canonicalRiderId,
                        motorizado: canonicalRider
                            ? {
                                id: canonicalRider.id,
                                nombre: canonicalRider.nombre,
                                telefono: canonicalRider.telefono,
                                tipoFlota: canonicalRider.tipoFlota,
                            }
                            : null,
                        items: body.pedido?.items ?? pedido.items,
                    }
                    : pedido
            )));
            if (
                canonicalRiderId
                && !['en_camino', 'entregado', 'cancelado'].includes(body.pedido.estado)
            ) {
                setDeliveryMessage('Motorizado asignado; confirmando despacho…');
                const dispatchResponse = await fetch(`/api/v1/pedidos/${pedidoId}/estado`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({
                        estado: 'en_camino',
                        nota: 'Motorizado asignado — pedido despachado.',
                    }),
                });
                const dispatchBody = await readResponseBody(dispatchResponse);
                if (!dispatchResponse.ok) {
                    throw new Error(dispatchBody.error || 'El servidor rechazó el despacho.');
                }
                if (!dispatchBody.pedido || dispatchBody.pedido.estado !== 'en_camino') {
                    throw new Error('El servidor respondió sin confirmar el despacho.');
                }

                updatePedidos((orders) => orders.map((pedido) => (
                    pedido.id === pedidoId
                        ? {
                            ...pedido,
                            ...dispatchBody.pedido,
                            motorizadoId: canonicalRiderId,
                            motorizado: dispatchBody.pedido?.motorizado
                                ?? canonicalRider
                                ?? pedido.motorizado,
                            items: dispatchBody.pedido?.items ?? pedido.items,
                        }
                        : pedido
                )));
                setDeliveryMessage('Motorizado asignado y pedido despachado correctamente.');
            } else {
                setDeliveryMessage(canonicalRiderId
                    ? 'Motorizado asignado correctamente.'
                    : 'El servidor dejó el pedido sin motorizado.');
            }
        } catch (error) {
            const detail = error instanceof Error ? error.message : 'No se pudo asignar el motorizado.';
            setDeliveryError(assignmentConfirmed
                ? `El motorizado quedó asignado, pero no pudimos confirmar el despacho: ${detail}`
                : detail);
            setDeliveryMessage('');
        } finally {
            assignmentInFlightRef.current = null;
            setAssigningId((activeId) => activeId === pedidoId ? null : activeId);
            dataEpochRef.current += 1;
            void fetchData();
        }
    };

    const createMotorizado = async () => {
        const validationError = getRiderFormError(riderForm);
        if (validationError) {
            setRiderError(validationError);
            return;
        }

        const vehiculoPlaca = riderForm.vehiculoPlaca.trim();
        const payload: {
            nombre: string;
            telefono: string;
            zonaCobertura: string;
            vehiculoPlaca?: string;
        } = {
            nombre: riderForm.nombre.trim(),
            telefono: riderForm.telefono.trim(),
            zonaCobertura: riderForm.zonaCobertura.trim(),
        };
        if (vehiculoPlaca) payload.vehiculoPlaca = vehiculoPlaca;

        setSavingRider(true);
        setRiderError('');
        try {
            const res = await fetch('/api/v1/motorizados', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify(payload),
            });
            if (res.ok) {
                setShowNewRider(false);
                setRiderForm(EMPTY_RIDER_FORM);
                setRiderError('');
                setDeliveryError('');
                setDeliveryMessage('Motorizado registrado correctamente.');
                void fetchData();
            } else {
                const body = await readResponseBody(res);
                setRiderError(body.error || 'No se pudo registrar el motorizado. Intentá nuevamente.');
            }
        } catch {
            setRiderError('No pudimos conectar con el servidor. Revisá tu conexión e intentá nuevamente.');
        } finally {
            setSavingRider(false);
        }
    };

    const copyDriverLogin = (id: string) => {
        // El acceso ya no es un magic-link por motorizado. Compartimos solo la
        // pantalla general y el servidor autentica con teléfono + PIN.
        const url = `${window.location.origin}/driver`;
        void navigator.clipboard.writeText(url).then(() => {
            setCopiedId(id);
            setTimeout(() => setCopiedId(null), 2500);
        }).catch(() => {
            setDeliveryError('No se pudo copiar el enlace. Revisá el permiso del portapapeles.');
        });
    };

    const closeNewRider = () => {
        if (savingRider) return;
        setShowNewRider(false);
        setRiderForm(EMPTY_RIDER_FORM);
        setRiderError('');
    };

    const updateRiderField = (field: keyof RiderForm, value: string) => {
        setRiderForm((current) => ({ ...current, [field]: value }));
        if (riderError) setRiderError('');
    };

    const riderFormIsValid = getRiderFormError(riderForm) === null;

    const activeRiders  = motorizados.filter(m => m.activo !== false);
    const pendingCount  = pedidos.filter(p => p.estado === 'pendiente').length;
    const inRouteCount  = pedidos.filter(p => p.estado === 'en_camino').length;
    const deliveredCount = pedidos.filter(p => p.estado === 'entregado').length;

    if (loading) {
        return (
            <div className="nx-light-context nx-workspace flex h-full items-center justify-center bg-slate-50">
                <Loader2 className="animate-spin text-brand" size={36} aria-label="Cargando entregas" />
            </div>
        );
    }

    return (
        <div className="nx-light-context nx-workspace h-full overflow-x-hidden overflow-y-auto bg-slate-50 text-slate-950">

            {/* ── Top Bar ─────────────────────────────────────────── */}
            <div className="nx-module-header sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white/80 px-4 py-4 backdrop-blur-xl sm:px-6">
                <div className="min-w-0">
                    <h2 className="flex items-center gap-2 text-xl font-bold text-slate-950">
                        <Truck className="text-brand" size={22} aria-hidden="true" /> Torre de Control · Logística
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-600">
                        <span className="font-semibold text-amber-700">{pendingCount} nuevos</span>
                        &nbsp;·&nbsp;
                        <span className="font-semibold text-slate-700">{inRouteCount} en ruta</span>
                        &nbsp;·&nbsp;
                        <span className="font-semibold text-brand">{deliveredCount} entregados</span>
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => {
                        setRiderForm(EMPTY_RIDER_FORM);
                        setRiderError('');
                        setShowNewRider(true);
                    }}
                    className="nx-fluid-press flex min-h-tap items-center gap-2 rounded-control bg-brand px-4 py-2.5 text-sm font-semibold text-brand-on shadow-sm transition-colors hover:bg-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ring"
                >
                    <Plus size={16} aria-hidden="true" /> Agregar Motorizado
                </button>
            </div>

            {/* ── Flota Activa (horizontal strip) ─────────────────── */}
            {activeRiders.length > 0 && (
                <section aria-label="Flota activa" className="border-b border-slate-200 bg-white/60 px-4 py-3 sm:px-6">
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                        Flota Activa ({activeRiders.length})
                    </p>
                    <div className="flex flex-wrap gap-2 pb-1">
                        {activeRiders.map(m => (
                            <div key={m.id} className="flex min-w-0 flex-none items-center gap-2.5 rounded-card border border-slate-200 bg-white px-3 py-2 shadow-sm">
                                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-control bg-brand-soft">
                                    <User size={16} className="text-brand" aria-hidden="true" />
                                </div>
                                <div className="min-w-0">
                                    <p className="max-w-[120px] truncate text-sm font-bold text-slate-950">{m.nombre}</p>
                                    {m.telefono && (
                                        <p className="truncate text-[11px] text-slate-500">{m.telefono}</p>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => copyDriverLogin(m.id)}
                                    title="Copiar login general de repartidores"
                                    aria-label={`Copiar login de repartidores para ${m.nombre}`}
                                    className={`nx-fluid-press ml-1 flex min-h-tap flex-shrink-0 items-center gap-1 rounded-control px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                                        copiedId === m.id
                                            ? 'bg-brand-soft text-brand'
                                            : 'bg-slate-100 text-slate-700 hover:bg-brand-soft hover:text-brand'
                                    }`}
                                >
                                    {copiedId === m.id ? <><Check size={12} aria-hidden="true" /> ¡Copiado!</> : <><Link2 size={12} aria-hidden="true" /> Login</>}
                                </button>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {(deliveryError || deliveryMessage) && (
                <div className="px-4 pt-4 sm:px-6">
                    <div
                        role={deliveryError ? 'alert' : 'status'}
                        aria-live={deliveryError ? 'assertive' : 'polite'}
                        aria-atomic="true"
                        className={`rounded-control border px-4 py-3 text-sm font-medium ${deliveryError
                            ? 'border-red-200 bg-red-50 text-red-700'
                            : 'border-brand/20 bg-brand-soft text-brand'}`}
                    >
                        {deliveryError || deliveryMessage}
                    </div>
                </div>
            )}

            {/* ── Kanban Board ─────────────────────────────────────── */}
            <main className="min-w-0">
                <DeliveryKanban
                    pedidos={pedidos}
                    activeRiders={activeRiders}
                    assigningId={assigningId}
                    movingId={movingId}
                    onAssign={assignMotorizado}
                    onMove={updateEstado}
                />
            </main>

            {/* ── Hoja: Nuevo Motorizado ───────────────────────────── */}
            <FluidSheet
                open={showNewRider}
                onClose={closeNewRider}
                labelledBy="new-rider-title"
                className="nx-delivery-rider-sheet-root"
                panelClassName="nx-delivery-rider-sheet nx-light-context"
                closeOnBackdrop={!savingRider}
                closeOnEscape={!savingRider}
                dragToDismiss={!savingRider}
            >
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        void createMotorizado();
                    }}
                    className="nx-delivery-rider-sheet-content overflow-y-auto px-5 pb-5 sm:p-6"
                >
                    <div className="mb-5 flex items-center justify-between gap-4">
                        <div>
                            <h3 id="new-rider-title" className="text-lg font-bold text-slate-950">Registrar Motorizado</h3>
                            <p className="mt-0.5 text-xs text-slate-500">Flota Propia del negocio</p>
                        </div>
                        <button
                            type="button"
                            aria-label="Cerrar"
                            onClick={closeNewRider}
                            disabled={savingRider}
                            className="nx-fluid-press inline-flex min-h-tap min-w-tap items-center justify-center rounded-control p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
                        >
                            <X size={18} aria-hidden="true" />
                        </button>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label htmlFor="new-rider-name" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-600">
                                Nombre completo *
                            </label>
                            <input
                                id="new-rider-name"
                                data-fluid-sheet-initial-focus
                                type="text"
                                placeholder="Ej: Juan Pérez"
                                value={riderForm.nombre}
                                onChange={event => updateRiderField('nombre', event.target.value)}
                                disabled={savingRider}
                                required
                                minLength={3}
                                maxLength={100}
                                className="min-h-tap w-full rounded-control border border-slate-300 bg-white px-4 py-3 text-slate-950 placeholder:text-slate-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-ring disabled:opacity-60"
                            />
                        </div>

                        <div>
                            <label htmlFor="new-rider-phone" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-600">
                                Teléfono / WhatsApp *
                            </label>
                            <div className="relative">
                                <Phone size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                                <input
                                    id="new-rider-phone"
                                    type="tel"
                                    inputMode="tel"
                                    placeholder="8888-0000"
                                    value={riderForm.telefono}
                                    onChange={event => updateRiderField('telefono', event.target.value)}
                                    aria-describedby="new-rider-phone-help"
                                    disabled={savingRider}
                                    required
                                    maxLength={32}
                                    className="min-h-tap w-full rounded-control border border-slate-300 bg-white py-3 pl-9 pr-4 text-slate-950 placeholder:text-slate-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-ring disabled:opacity-60"
                                />
                            </div>
                            <p id="new-rider-phone-help" className="mt-1.5 text-xs text-slate-500">
                                Usá de 8 a 15 dígitos; podés incluir +505, espacios o guiones.
                            </p>
                        </div>

                        <div>
                            <label htmlFor="new-rider-zone" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-600">
                                Zona de cobertura *
                            </label>
                            <input
                                id="new-rider-zone"
                                type="text"
                                placeholder="Ej: Managua sur"
                                value={riderForm.zonaCobertura}
                                onChange={event => updateRiderField('zonaCobertura', event.target.value)}
                                disabled={savingRider}
                                required
                                minLength={2}
                                maxLength={100}
                                className="min-h-tap w-full rounded-control border border-slate-300 bg-white px-4 py-3 text-slate-950 placeholder:text-slate-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-ring disabled:opacity-60"
                            />
                        </div>

                        <div>
                            <label htmlFor="new-rider-vehicle" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-600">
                                Placa / vehículo (opcional)
                            </label>
                            <input
                                id="new-rider-vehicle"
                                type="text"
                                placeholder="Ej: M 123456 · Moto Honda"
                                value={riderForm.vehiculoPlaca}
                                onChange={event => updateRiderField('vehiculoPlaca', event.target.value)}
                                disabled={savingRider}
                                maxLength={20}
                                className="min-h-tap w-full rounded-control border border-slate-300 bg-white px-4 py-3 font-mono uppercase text-slate-950 placeholder:font-sans placeholder:normal-case placeholder:text-slate-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-ring disabled:opacity-60"
                            />
                        </div>

                        {riderError && (
                            <div role="alert" className="flex items-center gap-2 rounded-control border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                                <AlertCircle size={16} className="flex-shrink-0" aria-hidden="true" />
                                {riderError}
                            </div>
                        )}

                        <div className="flex gap-3 pt-1">
                            <button
                                type="button"
                                onClick={closeNewRider}
                                disabled={savingRider}
                                className="nx-fluid-press min-h-tap flex-1 rounded-control border border-slate-300 py-3 font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50"
                            >
                                Cancelar
                            </button>
                            <button
                                type="submit"
                                disabled={savingRider || !riderFormIsValid}
                                className="nx-fluid-press flex min-h-tap flex-1 items-center justify-center gap-2 rounded-control bg-brand py-3 font-bold text-brand-on shadow-sm transition-colors hover:bg-brand-hover disabled:opacity-50"
                            >
                                {savingRider ? <Loader2 className="animate-spin" size={18} aria-hidden="true" /> : <Plus size={18} aria-hidden="true" />}
                                {savingRider ? 'Guardando...' : 'Registrar'}
                            </button>
                        </div>

                        <p className="text-center text-[11px] text-slate-500">
                            La flota propia se registra con la zona donde realmente puede entregar.
                            El conductor entra al login general con su teléfono y un PIN configurado;
                            no existe un enlace privado por motorizado.
                        </p>
                    </div>
                </form>
            </FluidSheet>

            <style>{`
                .no-scrollbar::-webkit-scrollbar { display: none; }
                .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
            `}</style>
        </div>
    );
};

export default DeliveryManager;
