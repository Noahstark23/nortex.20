import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Warehouse as WarehouseIcon, Plus, ArrowRightLeft, Star, RefreshCw, X, Search, ChevronLeft, ChevronRight } from 'lucide-react';

/** Multi-bodega: lista, stock por bodega y transferencias (Fase 3). */
interface Warehouse {
    id: string; name: string; address?: string | null; isDefault: boolean; isActive: boolean;
    // Carga de ruta: si la bodega es la carga de un vendedor, acá viene su User.
    sellerId?: string | null;
    seller?: { id: string; name: string; status?: string } | null;
}
interface MiembroEquipo { id: string; name: string; status: string; }
interface StockItem { productId: string; name: string; sku: string; unit: string; stock: number; implicit: boolean; }

const authHeaders = (): Record<string, string> => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${localStorage.getItem('nortex_token') ?? ''}`,
});

/** Mismo criterio que la búsqueda del inventario: "cafe" encuentra "café". */
const sinTildes = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Igual que en Mis Productos, para que las dos vistas se paginen parejo. */
const POR_PAGINA = 50;

const Warehouses: React.FC = () => {
    const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
    const [selected, setSelected] = useState<Warehouse | null>(null);
    const [stock, setStock] = useState<StockItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [newName, setNewName] = useState('');
    const [transfer, setTransfer] = useState<{ toId: string; productId: string; qty: string } | null>(null);
    const [msg, setMsg] = useState('');

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
        const res = await fetch('/api/warehouses', { headers: authHeaders() });
        if (res.ok) {
            const d = await res.json();
            setWarehouses(d.data);
            if (!selected && d.data.length) setSelected(d.data.find((w: Warehouse) => w.isDefault) ?? d.data[0]);
        }
    }, [selected]);

    const loadStock = useCallback(async (wh: Warehouse) => {
        setLoading(true);
        const res = await fetch(`/api/warehouses/${wh.id}/stock`, { headers: authHeaders() });
        if (res.ok) { const d = await res.json(); setStock(d.data.items); }
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);
    useEffect(() => {
        (async () => {
            try {
                const res = await fetch('/api/team', { headers: authHeaders() });
                if (!res.ok) return; // 403 = rol sin gestión de equipo → select oculto
                const d = await res.json();
                const users = Array.isArray(d) ? d : (d.users ?? []);
                setEquipo(users.filter((u: MiembroEquipo) => u.status !== 'DISABLED'));
            } catch { /* sin red: se oculta la asignación */ }
        })();
    }, []);

    // Asignar / quitar la carga de un vendedor a la bodega seleccionada. El
    // backend re-valida (mismo tenant, activo, no-default, único por vendedor).
    const asignarCarga = async (wh: Warehouse, sellerId: string) => {
        const res = await fetch(`/api/warehouses/${wh.id}`, {
            method: 'PUT', headers: authHeaders(),
            body: JSON.stringify({ sellerId: sellerId || null }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) { setMsg(d.error || 'No se pudo asignar'); return; }
        setMsg(sellerId ? 'Carga asignada' : 'Carga liberada');
        load();
    };
    useEffect(() => { if (selected) loadStock(selected); }, [selected, loadStock]);

    const createWarehouse = async () => {
        if (!newName.trim()) return;
        const res = await fetch('/api/warehouses', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ name: newName.trim() }) });
        const d = await res.json();
        if (res.ok) { setNewName(''); load(); } else alert(d.error);
    };

    const doTransfer = async () => {
        if (!transfer || !selected) return;
        const qty = parseFloat(transfer.qty);
        if (!(qty > 0)) { alert('Cantidad inválida'); return; }
        const res = await fetch('/api/stock-transfers', {
            method: 'POST', headers: authHeaders(),
            body: JSON.stringify({ fromWarehouseId: selected.id, toWarehouseId: transfer.toId, items: [{ productId: transfer.productId, quantity: qty }] }),
        });
        const d = await res.json();
        if (res.ok) { setMsg('Transferencia realizada'); setTransfer(null); loadStock(selected); setTimeout(() => setMsg(''), 3000); }
        else alert(d.error);
    };

    return (
        // `h-full overflow-y-auto` es el contenedor de scroll que esta vista NO tenía:
        // el <main> del layout es `overflow-hidden` a propósito y cada pantalla trae
        // el suyo (Mis Productos, Compras y Series ya lo hacen). Sin él, el contenido
        // se recortaba en la altura del viewport y no había forma de bajar.
        <div className="h-full overflow-y-auto p-6 max-w-6xl mx-auto text-slate-100">
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold flex items-center gap-2"><WarehouseIcon className="text-brand" /> Bodegas</h1>
                {msg && <span className="text-emerald-400 font-bold text-sm">{msg}</span>}
                <button onClick={() => selected && loadStock(selected)} className="p-2 hover:bg-white/[0.06] rounded-lg"><RefreshCw size={16} /></button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                {/* Lista + crear */}
                <div className="space-y-2">
                    {warehouses.map(w => (
                        /* El select vive FUERA del <button> (interactivo dentro de
                           interactivo = HTML inválido — trampa conocida del repo). */
                        <div key={w.id} className={`rounded-lg border transition-colors ${selected?.id === w.id ? 'border-brand bg-brand/5' : 'border-white/[0.06] hover:border-white/10'}`}>
                            <button onClick={() => setSelected(w)} className="w-full text-left p-3">
                                <div className="font-bold text-sm flex items-center gap-1.5">{w.name}{w.isDefault && <Star size={12} className="text-amber-500 fill-amber-500" />}</div>
                                {!w.isActive && <span className="text-[10px] text-red-500">INACTIVA</span>}
                                {w.seller && (
                                    <span className="text-[10px] bg-cyan-500/15 text-cyan-400 px-1.5 py-0.5 rounded font-bold">
                                        CARGA · {w.seller.name}
                                    </span>
                                )}
                            </button>
                            {equipo.length > 0 && !w.isDefault && (
                                <div className="px-3 pb-2">
                                    <select
                                        value={w.sellerId || ''}
                                        onChange={e => asignarCarga(w, e.target.value)}
                                        className="w-full bg-surface-800/60 border border-white/[0.06] rounded text-[11px] text-slate-300 px-1.5 py-1"
                                    >
                                        <option value="">Bodega común (sin vendedor)</option>
                                        {equipo.map(u => <option key={u.id} value={u.id}>Carga de {u.name}</option>)}
                                    </select>
                                </div>
                            )}
                        </div>
                    ))}
                    <div className="flex gap-2 pt-2">
                        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nueva bodega"
                            className="flex-1 px-3 py-2 border border-white/10 rounded-lg text-sm" />
                        <button onClick={createWarehouse} className="p-2 bg-brand text-white rounded-lg"><Plus size={16} /></button>
                    </div>
                </div>

                {/* Stock de la bodega seleccionada */}
                <div className="lg:col-span-3 bg-surface-900 border border-white/[0.06] rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-white/[0.04] space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-bold text-sm">
                                Existencias en {selected?.name ?? '—'} {loading && '…'}
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

                        <div className="flex flex-wrap items-center gap-2">
                            <div className="relative flex-1 min-w-[12rem]">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
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
                                        <X size={14} />
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
                    </div>
                    <table className="w-full text-sm">
                        <thead className="bg-surface-800/40 text-slate-500 text-xs uppercase">
                            <tr><th className="p-3 text-left">Producto</th><th className="p-3 text-left">SKU</th><th className="p-3 text-right">Stock</th><th className="p-3"></th></tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.04]">
                            {/* Solo la página actual: antes se montaban las 1.003 filas de una. */}
                            {visibles.map(it => (
                                <tr key={it.productId}>
                                    <td className="p-3">{it.name}{it.implicit && <span className="ml-2 text-[9px] text-slate-400" title="Stock legado aún no movido en esta bodega">IMPLÍCITO</span>}</td>
                                    <td className="p-3 text-slate-500 font-mono text-xs">{it.sku}</td>
                                    <td className="p-3 text-right font-mono font-bold">{it.stock} {it.unit}</td>
                                    <td className="p-3 text-right">
                                        {warehouses.filter(w => w.isActive).length > 1 && it.stock > 0 && (
                                            <button onClick={() => setTransfer({ toId: warehouses.find(w => w.id !== selected?.id && w.isActive)!.id, productId: it.productId, qty: '' })}
                                                className="text-brand hover:bg-brand/10 p-1.5 rounded" title="Transferir a otra bodega">
                                                <ArrowRightLeft size={14} />
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                            {stock.length === 0 && !loading && <tr><td colSpan={4} className="p-8 text-center text-slate-400">Sin existencias en esta bodega</td></tr>}
                            {stock.length > 0 && filtrados.length === 0 && (
                                <tr><td colSpan={4} className="p-8 text-center text-slate-400">
                                    Ningún producto de esta bodega coincide con “{busqueda}”.
                                    <button onClick={() => setBusqueda('')} className="ml-2 text-brand hover:underline">Limpiar búsqueda</button>
                                </td></tr>
                            )}
                        </tbody>
                    </table>

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
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-surface-900 rounded-xl w-full max-w-sm p-5 space-y-4">
                        <div className="flex justify-between items-center">
                            <h3 className="font-bold flex items-center gap-2"><ArrowRightLeft size={18} className="text-brand" /> Transferir desde {selected.name}</h3>
                            <button onClick={() => setTransfer(null)}><X size={18} /></button>
                        </div>
                        <div>
                            <label className="text-xs font-bold text-slate-500">Bodega destino</label>
                            <select value={transfer.toId} onChange={e => setTransfer({ ...transfer, toId: e.target.value })}
                                className="w-full mt-1 px-3 py-2 border border-white/10 rounded-lg text-sm">
                                {warehouses.filter(w => w.id !== selected.id && w.isActive).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs font-bold text-slate-500">Cantidad</label>
                            <input value={transfer.qty} onChange={e => setTransfer({ ...transfer, qty: e.target.value.replace(/[^\d.]/g, '') })}
                                inputMode="decimal" className="w-full mt-1 px-3 py-2 border border-white/10 rounded-lg text-sm font-mono" autoFocus />
                        </div>
                        <button onClick={doTransfer} className="w-full py-2.5 bg-brand text-white rounded-lg font-bold text-sm">Transferir</button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Warehouses;
