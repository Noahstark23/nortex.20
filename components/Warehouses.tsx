import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Warehouse as WarehouseIcon, Plus, ArrowRightLeft, Star, RefreshCw, X, Search, ChevronLeft, ChevronRight, Loader2, AlertTriangle } from 'lucide-react';
import { ToastViewport, useToast } from './ui/Toast';
import { InventoryTabs } from './ui/InventoryTabs';
import { validateStockTransferQuantity } from '../utils/stockTransferQuantity';
import { currentSessionRole, roleCapabilitiesFor } from '../utils/roleCapabilities';

/** Multi-bodega: lista, stock por bodega y transferencias (Fase 3). */
interface Warehouse {
    id: string; name: string; address?: string | null; isDefault: boolean; isActive: boolean;
    // Carga de ruta: si la bodega es la carga de un vendedor, acá viene su User.
    sellerId?: string | null;
    seller?: { id: string; name: string; status?: string } | null;
}
interface MiembroEquipo { id: string; name: string; status: string; }
interface StockItem {
    productId: string;
    name: string;
    sku: string;
    unit: string;
    stock: number;
    implicit: boolean;
    saleMode?: 'COUNTED' | 'MEASURED' | null;
    quantityStep?: string | number | null;
}
interface TransferDraft {
    /** Se conserva durante un retry idéntico; cambia solo al cambiar la intención. */
    clientEventId: string;
    toId: string;
    productId: string;
    productName: string;
    unit: string;
    available: number;
    qty: string;
    saleMode: 'COUNTED' | 'MEASURED';
    quantityStep: string;
}
type StockLoadState = {
    warehouseId: string | null;
    status: 'idle' | 'loading' | 'success' | 'error';
    items: StockItem[];
    error: string;
};

const authHeaders = (): Record<string, string> => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${localStorage.getItem('nortex_token') ?? ''}`,
});

const newTransferClientEventId = (): string => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        crypto.getRandomValues(bytes);
    } else {
        for (let index = 0; index < bytes.length; index += 1) {
            bytes[index] = Math.floor(Math.random() * 256);
        }
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/** Mismo criterio que la búsqueda del inventario: "cafe" encuentra "café". */
const sinTildes = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Igual que en Mis Productos, para que las dos vistas se paginen parejo. */
const POR_PAGINA = 50;

const parseCantidadTransferencia = (
    raw: string,
    saleMode: 'COUNTED' | 'MEASURED',
    quantityStep: string,
): string | null => {
    try {
        return validateStockTransferQuantity(raw.replace(',', '.'), { saleMode, quantityStep }).toFixed(4);
    } catch {
        return null;
    }
};

const Warehouses: React.FC = () => {
    const { isBodeguero, canManageWarehouseTopology, canTransferStock } = roleCapabilitiesFor(currentSessionRole());
    const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
    const [selected, setSelected] = useState<Warehouse | null>(null);
    const [warehousesLoading, setWarehousesLoading] = useState(true);
    const [warehousesError, setWarehousesError] = useState('');
    const [stockLoad, setStockLoad] = useState<StockLoadState>({
        warehouseId: null,
        status: 'idle',
        items: [],
        error: '',
    });
    const stockRequestId = useRef(0);
    const stockAbortController = useRef<AbortController | null>(null);
    const [newName, setNewName] = useState('');
    const [creating, setCreating] = useState(false);
    const [transfer, setTransfer] = useState<TransferDraft | null>(null);
    const [transferError, setTransferError] = useState('');
    const [transferring, setTransferring] = useState(false);
    const transferringRef = useRef(false);
    const transferDialogRef = useRef<HTMLDivElement | null>(null);
    const transferQuantityRef = useRef<HTMLInputElement | null>(null);
    const transferReturnFocusRef = useRef<HTMLElement | null>(null);
    const stockHeadingRef = useRef<HTMLSpanElement | null>(null);
    const { toast, showToast, dismissToast } = useToast();

    // El stock solo es visible cuando la respuesta pertenece a la bodega que
    // encabeza el panel. Este vínculo evita mezclar datos durante cambios rápidos.
    const stockBelongsToSelection = Boolean(selected && stockLoad.warehouseId === selected.id);
    const stock = stockBelongsToSelection && stockLoad.status === 'success' ? stockLoad.items : [];
    const loading = Boolean(selected) && (!stockBelongsToSelection || stockLoad.status === 'loading');
    const stockError = stockBelongsToSelection && stockLoad.status === 'error' ? stockLoad.error : '';
    // Mientras la topología se verifica o está en error, la última lista queda
    // visible como referencia pero ninguna acción puede operar sobre ella.
    const topologyLocked = warehousesLoading || Boolean(warehousesError);
    const validTransferQuantity = transfer
        ? parseCantidadTransferencia(transfer.qty, transfer.saleMode, transfer.quantityStep)
        : null;
    const hasTransferDestination = Boolean(
        selected && warehouses.some(warehouse => warehouse.id !== selected.id && warehouse.isActive),
    );

    // P0-1 — El panel renderizaba TODAS las existencias de la bodega (1.003 filas
    // en un tenant real) dentro de un contenedor sin scroll: el 98% del inventario
    // quedaba fuera de alcance, sin barra, sin paginar y sin forma de buscar.
    const [busqueda, setBusqueda] = useState('');
    // Equipo para asignar la carga (GET /api/team es OWNER/ADMIN: ante 403 la
    // lista queda vacía y el select se oculta — nunca un select vacío mudo).
    const [equipo, setEquipo] = useState<MiembroEquipo[]>([]);
    const [orden, setOrden] = useState<'nombre' | 'stock'>('nombre');
    const [pagina, setPagina] = useState(1);

    const filtrados = useMemo(() => {
        const q = sinTildes(busqueda.trim());
        const base = q
            ? stock.filter(it => sinTildes(it.name).includes(q) || sinTildes(it.sku ?? '').includes(q))
            : stock;
        // Copia antes de ordenar: sort muta, y `stock` es el estado.
        return [...base].sort((a, b) =>
            orden === 'stock'
                ? b.stock - a.stock
                : a.name.localeCompare(b.name, 'es'));
    }, [stock, busqueda, orden]);

    const totalPaginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA));
    const visibles = filtrados.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);

    // Cambiar de bodega, buscar u ordenar deja la página fuera de rango: volver a 1.
    useEffect(() => { setPagina(1); }, [busqueda, orden, selected?.id]);

    const load = useCallback(async () => {
        setWarehousesLoading(true);
        setWarehousesError('');
        try {
            const res = await fetch('/api/warehouses', { headers: authHeaders() });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(d.error || 'No se pudieron cargar las bodegas.');

            const items: Warehouse[] = Array.isArray(d.data) ? d.data : [];
            setWarehouses(items);
            setSelected(current => {
                if (items.length === 0) return null;
                const refreshedSelection = current && items.find(w => w.id === current.id);
                return refreshedSelection ?? items.find(w => w.isDefault) ?? items[0];
            });
        } catch (error) {
            setWarehousesError(error instanceof Error ? error.message : 'No se pudieron cargar las bodegas.');
        } finally {
            setWarehousesLoading(false);
        }
    }, []);

    const loadStock = useCallback(async (wh: Warehouse) => {
        stockAbortController.current?.abort();
        const controller = new AbortController();
        stockAbortController.current = controller;
        const requestId = ++stockRequestId.current;

        // Limpiamos antes de solicitar: ni un frame debe enseñar existencias de
        // la bodega anterior debajo del nombre recién seleccionado.
        setStockLoad({ warehouseId: wh.id, status: 'loading', items: [], error: '' });
        try {
            const res = await fetch(`/api/warehouses/${wh.id}/stock`, {
                headers: authHeaders(),
                signal: controller.signal,
            });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(d.error || 'No se pudieron cargar las existencias.');
            if (requestId !== stockRequestId.current) return;

            setStockLoad({
                warehouseId: wh.id,
                status: 'success',
                items: Array.isArray(d.data?.items) ? d.data.items : [],
                error: '',
            });
        } catch (error) {
            if (requestId !== stockRequestId.current || (error instanceof DOMException && error.name === 'AbortError')) return;
            setStockLoad({
                warehouseId: wh.id,
                status: 'error',
                items: [],
                error: error instanceof Error ? error.message : 'No se pudieron cargar las existencias.',
            });
        }
    }, []);

    useEffect(() => { load(); }, [load]);
    useEffect(() => {
        if (!canManageWarehouseTopology) return;
        (async () => {
            try {
                const res = await fetch('/api/team', { headers: authHeaders() });
                if (!res.ok) return; // 403 = rol sin gestión de equipo → select oculto
                const d = await res.json();
                const users = Array.isArray(d) ? d : (d.users ?? []);
                setEquipo(users.filter((u: MiembroEquipo) => u.status !== 'DISABLED'));
            } catch { /* sin red: se oculta la asignación */ }
        })();
    }, [canManageWarehouseTopology]);

    // Asignar / quitar la carga de un vendedor a la bodega seleccionada. El
    // backend re-valida (mismo tenant, activo, no-default, único por vendedor).
    const asignarCarga = async (wh: Warehouse, sellerId: string) => {
        if (!canManageWarehouseTopology || topologyLocked) return;
        try {
            const res = await fetch(`/api/warehouses/${wh.id}`, {
                method: 'PUT', headers: authHeaders(),
                body: JSON.stringify({ sellerId: sellerId || null }),
            });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(d.error || 'No se pudo actualizar la asignación.');
            showToast({ tone: 'success', title: sellerId ? 'Carga asignada' : 'Carga liberada' });
            await load();
        } catch (error) {
            showToast({
                tone: 'error',
                title: 'No pudimos actualizar la carga',
                message: error instanceof Error ? error.message : 'Revisá tu conexión e intentá de nuevo.',
            });
        }
    };
    useEffect(() => { if (selected) loadStock(selected); }, [selected, loadStock]);

    useEffect(() => () => {
        stockRequestId.current += 1;
        stockAbortController.current?.abort();
    }, []);

    const createWarehouse = async () => {
        const name = newName.trim();
        if (!canManageWarehouseTopology || !name || creating || topologyLocked) return;
        setCreating(true);
        try {
            const res = await fetch('/api/warehouses', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ name }),
            });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(d.error || 'No se pudo crear la bodega.');
            setNewName('');
            showToast({ tone: 'success', title: `Bodega “${name}” creada` });
            await load();
        } catch (error) {
            showToast({
                tone: 'error',
                title: 'No pudimos crear la bodega',
                message: error instanceof Error ? error.message : 'Revisá tu conexión e intentá de nuevo.',
            });
        } finally {
            setCreating(false);
        }
    };

    const doTransfer = async () => {
        if (!transfer || !selected) return;
        if (!canTransferStock) {
            setTransferError('Tu rol no permite transferir existencias.');
            return;
        }
        if (topologyLocked) {
            setTransferError('Reintentá cargar las bodegas antes de transferir.');
            return;
        }
        let qty: string;
        let qtyDisplay: string;
        try {
            const parsed = validateStockTransferQuantity(transfer.qty.replace(',', '.'), {
                saleMode: transfer.saleMode,
                quantityStep: transfer.quantityStep,
            });
            qty = parsed.toFixed(4);
            qtyDisplay = parsed.toString();
            if (parsed.greaterThan(transfer.available.toString())) {
                setTransferError(`Solo hay ${transfer.available} ${transfer.unit} disponibles en ${selected.name}.`);
                return;
            }
        } catch (error) {
            setTransferError(error instanceof Error ? error.message : 'Ingresá una cantidad válida.');
            return;
        }

        setTransferError('');
        transferringRef.current = true;
        setTransferring(true);
        try {
            const res = await fetch('/api/stock-transfers', {
                method: 'POST', headers: authHeaders(),
                body: JSON.stringify({
                    clientEventId: transfer.clientEventId,
                    fromWarehouseId: selected.id,
                    toWarehouseId: transfer.toId,
                    items: [{ productId: transfer.productId, quantity: qty }],
                }),
            });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) {
                if (res.status === 409 && d.code === 'STOCK_TRANSFER_IDEMPOTENCY_CONFLICT') {
                    setTransfer(current => current
                        ? { ...current, clientEventId: newTransferClientEventId() }
                        : current);
                    throw new Error('La intención anterior ya fue usada. Revisá los datos y reintentá.');
                }
                throw new Error(d.error || 'No se pudo completar la transferencia.');
            }

            setTransfer(null);
            showToast({
                tone: 'success',
                title: d.replay ? 'Transferencia confirmada' : 'Transferencia realizada',
                message: `${qtyDisplay} ${transfer.unit} de ${transfer.productName}.`,
            });
            await loadStock(selected);
        } catch (error) {
            setTransferError(error instanceof Error ? error.message : 'Revisá tu conexión e intentá de nuevo.');
        } finally {
            transferringRef.current = false;
            setTransferring(false);
        }
    };

    const closeTransfer = useCallback(() => {
        if (transferringRef.current) return;
        setTransfer(null);
        setTransferError('');
    }, []);

    useEffect(() => {
        if (!transfer) return;

        const dialog = transferDialogRef.current;
        const returnFocus = transferReturnFocusRef.current
            ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
        const focusFrame = window.requestAnimationFrame(() => transferQuantityRef.current?.focus());

        const keepFocusInside = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeTransfer();
                return;
            }
            if (event.key !== 'Tab' || !dialog) return;

            const focusable = (Array.from(dialog.querySelectorAll(
                'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
            )) as HTMLElement[]).filter(element => element.getAttribute('aria-hidden') !== 'true');

            if (focusable.length === 0) {
                event.preventDefault();
                dialog.focus();
                return;
            }

            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const active = document.activeElement;
            if (event.shiftKey && (active === first || !dialog.contains(active))) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', keepFocusInside);
        return () => {
            window.cancelAnimationFrame(focusFrame);
            document.removeEventListener('keydown', keepFocusInside);
            const canRestoreTrigger = Boolean(returnFocus?.isConnected && !returnFocus.hasAttribute('disabled'));
            const focusTarget = canRestoreTrigger ? returnFocus : stockHeadingRef.current;
            focusTarget?.focus();
            transferReturnFocusRef.current = null;
        };
    }, [Boolean(transfer), closeTransfer]);

    const openTransfer = (item: StockItem, trigger: HTMLButtonElement) => {
        if (!canTransferStock || !selected || topologyLocked) return;
        const destination = warehouses.find(w => w.id !== selected.id && w.isActive);
        if (!destination) {
            showToast({ tone: 'warning', title: 'No hay otra bodega activa', message: 'Creá o activá una bodega destino para transferir.' });
            return;
        }
        setTransferError('');
        transferReturnFocusRef.current = trigger;
        setTransfer({
            clientEventId: newTransferClientEventId(),
            toId: destination.id,
            productId: item.productId,
            productName: item.name,
            unit: item.unit,
            available: item.stock,
            qty: '',
            saleMode: item.saleMode === 'COUNTED' ? 'COUNTED' : 'MEASURED',
            quantityStep: item.quantityStep?.toString()
                || (item.saleMode === 'COUNTED' ? '1' : '0.0001'),
        });
    };

    return (
        // `h-full overflow-y-auto` es el contenedor de scroll que esta vista NO tenía:
        // el <main> del layout es `overflow-hidden` a propósito y cada pantalla trae
        // el suyo (Mis Productos, Compras y Series ya lo hacen). Sin él, el contenido
        // se recortaba en la altura del viewport y no había forma de bajar.
        <div className="h-full overflow-y-auto p-6 max-w-6xl mx-auto text-slate-100">
            <ToastViewport toast={toast} onDismiss={dismissToast} />
            <InventoryTabs className="mb-4" />
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2"><WarehouseIcon className="text-brand" /> Bodegas y existencias</h1>
                    {isBodeguero && <p className="mt-1 text-sm text-slate-400">Consultá el stock y mové mercadería entre bodegas.</p>}
                </div>
                <button
                    type="button"
                    onClick={() => selected && loadStock(selected)}
                    disabled={!selected || loading || topologyLocked}
                    aria-label={selected ? `Actualizar existencias de ${selected.name}` : 'Actualizar existencias'}
                    title={topologyLocked ? 'Primero verificá la lista de bodegas' : 'Actualizar existencias'}
                    className="min-h-tap min-w-tap inline-flex items-center justify-center rounded-control text-slate-300 hover:bg-white/[0.06] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    <RefreshCw size={16} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
                </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                {/* Lista + crear */}
                <div className="space-y-2" aria-busy={warehousesLoading}>
                    {warehousesLoading && warehouses.length === 0 && (
                        <div role="status" className="flex items-center gap-2 rounded-lg border border-white/[0.06] p-3 text-sm text-slate-400">
                            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                            Cargando bodegas…
                        </div>
                    )}
                    {warehousesLoading && warehouses.length > 0 && (
                        <div role="status" className="flex items-center gap-2 rounded-lg border border-white/[0.06] p-3 text-sm text-slate-400">
                            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                            Verificando la lista de bodegas… Las acciones están pausadas.
                        </div>
                    )}
                    {warehousesError && (
                        <div id="warehouse-topology-error" role="alert" className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm">
                            <div className="flex items-start gap-2 text-red-300">
                                <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                                <div>
                                    <p>{warehousesError}</p>
                                    {warehouses.length > 0 && (
                                        <p className="mt-1 text-xs leading-5 text-slate-300">
                                            Conservamos la última vista como referencia, pero pausamos cambios y transferencias hasta verificar la lista.
                                        </p>
                                    )}
                                </div>
                            </div>
                            <button type="button" onClick={load} className="mt-2 text-brand font-semibold hover:underline">
                                Reintentar
                            </button>
                        </div>
                    )}
                    {!warehousesLoading && !warehousesError && warehouses.length === 0 && (
                        <div className="rounded-lg border border-dashed border-white/10 p-4 text-sm text-slate-400">
                            Todavía no hay bodegas. Creá la primera para empezar.
                        </div>
                    )}
                    {warehouses.map(w => (
                        /* El select vive FUERA del <button> (interactivo dentro de
                           interactivo = HTML inválido — trampa conocida del repo). */
                        <div key={w.id} className={`rounded-lg border transition-colors ${selected?.id === w.id ? 'border-brand bg-brand/5' : 'border-white/[0.06] hover:border-white/10'}`}>
                            <button
                                type="button"
                                onClick={() => setSelected(w)}
                                disabled={topologyLocked}
                                aria-pressed={selected?.id === w.id}
                                aria-describedby={warehousesError ? 'warehouse-topology-error' : undefined}
                                className="w-full text-left p-3 disabled:cursor-not-allowed disabled:opacity-70"
                            >
                                <div className="font-bold text-sm flex items-center gap-1.5">{w.name}{w.isDefault && <Star size={12} className="text-amber-500 fill-amber-500" />}</div>
                                {!w.isActive && <span className="text-[10px] text-red-500">INACTIVA</span>}
                                {w.seller && (
                                    <span className="text-[10px] bg-cyan-500/15 text-cyan-400 px-1.5 py-0.5 rounded font-bold">
                                        CARGA · {w.seller.name}
                                    </span>
                                )}
                            </button>
                            {canManageWarehouseTopology && equipo.length > 0 && !w.isDefault && (
                                <div className="px-3 pb-2">
                                    <select
                                        value={w.sellerId || ''}
                                        onChange={e => asignarCarga(w, e.target.value)}
                                        disabled={topologyLocked}
                                        aria-label={`Asignación de ${w.name}`}
                                        aria-describedby={warehousesError ? 'warehouse-topology-error' : undefined}
                                        className="w-full bg-surface-800/60 border border-white/[0.06] rounded text-[11px] text-slate-300 px-1.5 py-1 disabled:cursor-not-allowed disabled:opacity-70"
                                    >
                                        <option value="">Bodega común (sin vendedor)</option>
                                        {equipo.map(u => <option key={u.id} value={u.id}>Carga de {u.name}</option>)}
                                    </select>
                                </div>
                            )}
                        </div>
                    ))}
                    {canManageWarehouseTopology && (
                        <form
                            className="flex gap-2 pt-2"
                            onSubmit={event => { event.preventDefault(); createWarehouse(); }}
                        >
                            <label htmlFor="nombre-nueva-bodega" className="sr-only">Nombre de la nueva bodega</label>
                            <input
                                id="nombre-nueva-bodega"
                                value={newName}
                                onChange={e => setNewName(e.target.value)}
                                placeholder="Nueva bodega"
                                disabled={creating || topologyLocked}
                                aria-describedby={warehousesError ? 'warehouse-topology-error' : undefined}
                                className="min-w-0 flex-1 px-3 py-2 border border-white/10 rounded-lg text-sm disabled:opacity-60"
                            />
                            <button
                                type="submit"
                                disabled={!newName.trim() || creating || topologyLocked}
                                aria-label="Crear bodega"
                                aria-describedby={warehousesError ? 'warehouse-topology-error' : undefined}
                                title="Crear bodega"
                                className="min-h-tap min-w-tap inline-flex items-center justify-center bg-brand text-white rounded-control disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                {creating
                                    ? <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                                    : <Plus size={16} aria-hidden="true" />}
                            </button>
                        </form>
                    )}
                </div>

                {/* Stock de la bodega seleccionada */}
                <div className="lg:col-span-3 bg-surface-900 border border-white/[0.06] rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-white/[0.04] space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <span ref={stockHeadingRef} tabIndex={-1} className="font-bold text-sm outline-none" aria-live="polite">
                                Existencias en {selected?.name ?? '—'}
                                {loading && <span className="ml-2 text-slate-400 font-normal">Cargando…</span>}
                            </span>
                            {/* Contador: sin esto no se sabe si la tabla muestra todo
                                el inventario de la bodega o apenas el primer tramo. */}
                            {!loading && stock.length > 0 && (
                                <span className="text-xs text-slate-400 tabular-nums">
                                    Mostrando {visibles.length.toLocaleString('es-NI')} de {filtrados.length.toLocaleString('es-NI')}
                                    {busqueda.trim() && ` (de ${stock.length.toLocaleString('es-NI')} en la bodega)`}
                                </span>
                            )}
                        </div>

                        {stockBelongsToSelection && stockLoad.status === 'success' && stock.length > 0 && (
                            <div className="flex flex-wrap items-center gap-2">
                                <div className="relative flex-1 min-w-[12rem]">
                                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" aria-hidden="true" />
                                    <label htmlFor="buscar-existencias" className="sr-only">Buscar existencias por nombre o SKU</label>
                                    <input
                                        id="buscar-existencias"
                                        value={busqueda}
                                        onChange={e => setBusqueda(e.target.value)}
                                        placeholder="Buscar por nombre o SKU…"
                                        className="w-full h-touch pl-9 pr-9 bg-slate-800 border border-slate-700 rounded-control text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-brand"
                                    />
                                    {busqueda && (
                                        <button
                                            type="button"
                                            onClick={() => setBusqueda('')}
                                            aria-label="Limpiar búsqueda"
                                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-slate-200 rounded-control"
                                        >
                                            <X size={14} aria-hidden="true" />
                                        </button>
                                    )}
                                </div>
                                <label htmlFor="orden-existencias" className="text-xs text-slate-400">Ordenar</label>
                                <select
                                    id="orden-existencias"
                                    value={orden}
                                    onChange={e => setOrden(e.target.value as 'nombre' | 'stock')}
                                    className="h-touch px-3 bg-slate-800 border border-slate-700 rounded-control text-sm text-slate-100 focus:outline-none focus:border-brand"
                                >
                                    <option value="nombre">Nombre (A-Z)</option>
                                    <option value="stock">Stock (mayor primero)</option>
                                </select>
                            </div>
                        )}
                    </div>
                    {/* En móvil cada existencia es una tarjeta: nombre, SKU, stock y
                        acción permanecen visibles sin depender de scroll horizontal. */}
                    <div className="sm:hidden" aria-busy={loading}>
                        {visibles.length > 0 && (
                            <ul className="divide-y divide-white/[0.06]" aria-label={`Existencias en ${selected?.name ?? 'la bodega seleccionada'}`}>
                                {visibles.map(it => {
                                    const transferDisabled = !canTransferStock || topologyLocked || !hasTransferDestination || !(it.stock > 0);
                                    const transferTitle = !canTransferStock
                                        ? 'Tu rol no permite transferir existencias'
                                        : topologyLocked
                                        ? 'Primero verificá la lista de bodegas'
                                        : !hasTransferDestination
                                            ? 'No hay otra bodega activa para recibir el producto'
                                            : !(it.stock > 0)
                                                ? 'Sin stock disponible para transferir'
                                                : `Transferir ${it.name}`;

                                    return (
                                        <li key={it.productId} className="p-4">
                                            <div className="min-w-0">
                                                <p className="break-words text-sm font-semibold text-slate-100">
                                                    {it.name}
                                                    {it.implicit && (
                                                        <span className="ml-2 text-[9px] font-normal text-slate-400" title="Stock legado aún no movido en esta bodega">
                                                            IMPLÍCITO
                                                        </span>
                                                    )}
                                                </p>
                                            </div>

                                            <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4">
                                                <div className="min-w-0">
                                                    <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">SKU</dt>
                                                    <dd className="mt-1 break-all font-mono text-xs text-slate-300">{it.sku || 'Sin SKU'}</dd>
                                                </div>
                                                <div className="text-right">
                                                    <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Stock</dt>
                                                    <dd className="mt-1 whitespace-nowrap font-mono text-base font-bold text-slate-100">
                                                        {it.stock} {it.unit}
                                                    </dd>
                                                </div>
                                            </dl>

                                            <button
                                                type="button"
                                                onClick={(event) => openTransfer(it, event.currentTarget)}
                                                disabled={transferDisabled}
                                                aria-label={transferDisabled
                                                    ? `Transferir ${it.name} no disponible: ${transferTitle}`
                                                    : `Transferir ${it.name} a otra bodega`}
                                                aria-describedby={warehousesError ? 'warehouse-topology-error' : undefined}
                                                title={transferTitle}
                                                className="mt-4 min-h-tap w-full inline-flex items-center justify-center gap-2 rounded-control border border-brand/30 bg-brand/10 px-4 text-sm font-semibold text-brand transition-colors hover:bg-brand/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:cursor-not-allowed disabled:border-white/[0.06] disabled:bg-white/[0.02] disabled:text-slate-500"
                                            >
                                                <ArrowRightLeft size={16} aria-hidden="true" />
                                                Transferir
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}

                        {loading && (
                            <div className="p-8 text-center text-slate-400" role="status">
                                <span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Cargando existencias…</span>
                            </div>
                        )}
                        {!selected && !warehousesLoading && (
                            <div className="p-8 text-center text-sm text-slate-400">Seleccioná o creá una bodega para consultar sus existencias.</div>
                        )}
                        {stockError && selected && (
                            <div className="p-8 text-center">
                                <div role="alert" className="inline-flex max-w-md flex-col items-center gap-2 text-sm text-red-300">
                                    <span className="inline-flex items-center gap-2"><AlertTriangle size={16} aria-hidden="true" /> {stockError}</span>
                                    <button type="button" onClick={() => loadStock(selected)} className="min-h-tap px-3 text-brand font-semibold hover:underline">Reintentar</button>
                                </div>
                            </div>
                        )}
                        {stockBelongsToSelection && stockLoad.status === 'success' && stock.length === 0 && (
                            <div className="p-8 text-center text-sm text-slate-400">Sin existencias en esta bodega.</div>
                        )}
                        {stock.length > 0 && filtrados.length === 0 && (
                            <div className="p-8 text-center text-sm text-slate-400">
                                Ningún producto de esta bodega coincide con “{busqueda}”.
                                <button type="button" onClick={() => setBusqueda('')} className="ml-2 min-h-tap px-1 text-brand hover:underline">Limpiar búsqueda</button>
                            </div>
                        )}
                    </div>

                    <div className="hidden overflow-x-auto sm:block">
                        <table className="w-full min-w-[36rem] text-sm">
                            <thead className="bg-surface-800/40 text-slate-500 text-xs uppercase">
                                <tr><th className="p-3 text-left">Producto</th><th className="p-3 text-left">SKU</th><th className="p-3 text-right">Stock</th><th className="p-3"><span className="sr-only">Acciones</span></th></tr>
                            </thead>
                            <tbody className="divide-y divide-white/[0.04]">
                                {/* Solo la página actual: antes se montaban las 1.003 filas de una. */}
                                {visibles.map(it => (
                                    <tr key={it.productId}>
                                        <td className="p-3">{it.name}{it.implicit && <span className="ml-2 text-[9px] text-slate-400" title="Stock legado aún no movido en esta bodega">IMPLÍCITO</span>}</td>
                                        <td className="p-3 text-slate-500 font-mono text-xs">{it.sku}</td>
                                        <td className="p-3 text-right font-mono font-bold">{it.stock} {it.unit}</td>
                                        <td className="p-3 text-right">
                                            {canTransferStock && warehouses.filter(w => w.isActive).length > 1 && it.stock > 0 && (
                                                <button
                                                    type="button"
                                                    onClick={(event) => openTransfer(it, event.currentTarget)}
                                                    disabled={topologyLocked}
                                                    aria-label={`Transferir ${it.name} a otra bodega`}
                                                    aria-describedby={warehousesError ? 'warehouse-topology-error' : undefined}
                                                    className="min-h-tap min-w-tap inline-flex items-center justify-center text-brand hover:bg-brand/10 rounded-control disabled:cursor-not-allowed disabled:opacity-40"
                                                    title={topologyLocked ? 'Primero verificá la lista de bodegas' : `Transferir ${it.name}`}
                                                >
                                                    <ArrowRightLeft size={14} aria-hidden="true" />
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                                {loading && (
                                    <tr>
                                        <td colSpan={4} className="p-8 text-center text-slate-400" role="status">
                                            <span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Cargando existencias…</span>
                                        </td>
                                    </tr>
                                )}
                                {!selected && !warehousesLoading && (
                                    <tr><td colSpan={4} className="p-8 text-center text-slate-400">Seleccioná o creá una bodega para consultar sus existencias.</td></tr>
                                )}
                                {stockError && selected && (
                                    <tr>
                                        <td colSpan={4} className="p-8 text-center">
                                            <div role="alert" className="inline-flex max-w-md flex-col items-center gap-2 text-red-300">
                                                <span className="inline-flex items-center gap-2"><AlertTriangle size={16} aria-hidden="true" /> {stockError}</span>
                                                <button type="button" onClick={() => loadStock(selected)} className="text-brand font-semibold hover:underline">Reintentar</button>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                                {stockBelongsToSelection && stockLoad.status === 'success' && stock.length === 0 && (
                                    <tr><td colSpan={4} className="p-8 text-center text-slate-400">Sin existencias en esta bodega.</td></tr>
                                )}
                                {stock.length > 0 && filtrados.length === 0 && (
                                    <tr><td colSpan={4} className="p-8 text-center text-slate-400">
                                        Ningún producto de esta bodega coincide con “{busqueda}”.
                                        <button type="button" onClick={() => setBusqueda('')} className="ml-2 text-brand hover:underline">Limpiar búsqueda</button>
                                    </td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {filtrados.length > POR_PAGINA && (
                        <div className="flex items-center justify-between px-4 py-3 border-t border-white/[0.04] text-xs text-slate-400">
                            <span className="tabular-nums">
                                {((pagina - 1) * POR_PAGINA) + 1}–{Math.min(pagina * POR_PAGINA, filtrados.length)} de {filtrados.length.toLocaleString('es-NI')}
                            </span>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setPagina(p => Math.max(1, p - 1))}
                                    disabled={pagina <= 1}
                                    aria-label="Página anterior"
                                    className="min-h-tap min-w-tap inline-flex items-center justify-center rounded-control border border-slate-700 text-slate-300 hover:bg-white/[0.06] disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    <ChevronLeft size={16} />
                                </button>
                                <span className="text-slate-300 font-mono tabular-nums">{pagina} / {totalPaginas}</span>
                                <button
                                    onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))}
                                    disabled={pagina >= totalPaginas}
                                    aria-label="Página siguiente"
                                    className="min-h-tap min-w-tap inline-flex items-center justify-center rounded-control border border-slate-700 text-slate-300 hover:bg-white/[0.06] disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    <ChevronRight size={16} />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Modal de transferencia */}
            {transfer && selected && (
                <div
                    className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
                    onMouseDown={event => { if (event.target === event.currentTarget) closeTransfer(); }}
                >
                    <div
                        ref={transferDialogRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="transfer-title"
                        aria-describedby="transfer-product-summary"
                        tabIndex={-1}
                        className="bg-surface-900 border border-white/10 rounded-xl shadow-2xl w-full max-w-sm p-5 space-y-4"
                    >
                        <div className="flex justify-between items-center">
                            <h3 id="transfer-title" className="font-bold flex items-center gap-2">
                                <ArrowRightLeft size={18} className="text-brand" aria-hidden="true" />
                                Transferir producto
                            </h3>
                            <button
                                type="button"
                                onClick={closeTransfer}
                                disabled={transferring}
                                aria-label="Cerrar transferencia"
                                title="Cerrar"
                                className="min-h-tap min-w-tap inline-flex items-center justify-center rounded-control text-slate-400 hover:bg-white/[0.06] hover:text-white disabled:opacity-40"
                            >
                                <X size={18} aria-hidden="true" />
                            </button>
                        </div>

                        <div id="transfer-product-summary" className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3">
                            <p className="font-semibold text-sm text-slate-100">{transfer.productName}</p>
                            <p className="mt-1 text-xs text-slate-400">
                                Disponible en {selected.name}: <strong className="text-slate-200">{transfer.available} {transfer.unit}</strong>
                            </p>
                        </div>
                        <div>
                            <label htmlFor="transfer-destination" className="text-xs font-bold text-slate-400">Bodega destino</label>
                            <select
                                id="transfer-destination"
                                value={transfer.toId}
                                onChange={e => {
                                    setTransfer({
                                        ...transfer,
                                        clientEventId: newTransferClientEventId(),
                                        toId: e.target.value,
                                    });
                                    setTransferError('');
                                }}
                                disabled={transferring}
                                className="w-full mt-1 px-3 py-2 border border-white/10 rounded-lg text-sm">
                                {warehouses.filter(w => w.id !== selected.id && w.isActive).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="transfer-quantity" className="text-xs font-bold text-slate-400">Cantidad</label>
                            <input
                                ref={transferQuantityRef}
                                id="transfer-quantity"
                                value={transfer.qty}
                                onChange={e => {
                                    setTransfer({
                                        ...transfer,
                                        clientEventId: newTransferClientEventId(),
                                        qty: e.target.value,
                                    });
                                    setTransferError('');
                                }}
                                onBlur={() => {
                                    if (!transfer.qty) return;
                                    try {
                                        validateStockTransferQuantity(transfer.qty.replace(',', '.'), {
                                            saleMode: transfer.saleMode,
                                            quantityStep: transfer.quantityStep,
                                        });
                                    } catch (error) {
                                        setTransferError(error instanceof Error ? error.message : 'Ingresá una cantidad válida.');
                                    }
                                }}
                                inputMode="decimal"
                                disabled={transferring}
                                aria-invalid={Boolean(transferError)}
                                aria-describedby={transferError ? 'transfer-error' : 'transfer-product-summary'}
                                className="w-full mt-1 px-3 py-2 border border-white/10 rounded-lg text-sm font-mono disabled:opacity-60"
                            />
                        </div>
                        {transferError && (
                            <p id="transfer-error" role="alert" className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300">
                                <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                                {transferError}
                            </p>
                        )}
                        <button
                            type="button"
                            onClick={doTransfer}
                            disabled={transferring || topologyLocked || !transfer.toId || validTransferQuantity === null}
                            className="w-full min-h-tap inline-flex items-center justify-center gap-2 bg-brand text-white rounded-control font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            {transferring && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
                            {transferring ? 'Transfiriendo…' : 'Transferir'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Warehouses;
