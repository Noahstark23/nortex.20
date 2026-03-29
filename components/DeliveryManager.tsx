import React, { useState, useEffect } from 'react';
import {
    Package, Truck, CheckCircle, Clock, MapPin, Phone, ChevronRight,
    Plus, X, Copy, Check, Link2, Loader2, User, AlertCircle
} from 'lucide-react';

interface Pedido {
    id: string;
    clienteNombre: string;
    clienteTelefono: string;
    direccionEntrega: string;
    estado: string;
    total: number;
    createdAt: string;
    motorizadoId?: string;
    motorizado?: {
        id: string;
        nombre: string;
        telefono: string;
        tipoFlota: string;
    };
    items?: Array<{ cantidad: number; producto: { name: string } }>;
}

interface Motorizado {
    id: string;
    nombre: string;
    telefono?: string;
    tipoFlota: string;
    activo?: boolean;
}

const COLUMNAS = [
    { id: 'pendiente',  title: 'Nuevos',     icon: <Clock       size={16} />, color: 'border-amber-200   bg-amber-50',   badge: 'bg-amber-100   text-amber-700'   },
    { id: 'preparando', title: 'Preparando', icon: <Package     size={16} />, color: 'border-blue-200    bg-blue-50',    badge: 'bg-blue-100    text-blue-700'    },
    { id: 'en_camino',  title: 'En Camino',  icon: <Truck       size={16} />, color: 'border-purple-200  bg-purple-50',  badge: 'bg-purple-100  text-purple-700'  },
    { id: 'entregado',  title: 'Entregados', icon: <CheckCircle size={16} />, color: 'border-emerald-200 bg-emerald-50', badge: 'bg-emerald-100 text-emerald-700' },
];

const ESTADO_SIGUIENTE: Record<string, string> = {
    pendiente: 'preparando',
    preparando: 'en_camino',
};

const DeliveryManager: React.FC = () => {
    const token = localStorage.getItem('nortex_token');

    const [pedidos, setPedidos]           = useState<Pedido[]>([]);
    const [motorizados, setMotorizados]   = useState<Motorizado[]>([]);
    const [loading, setLoading]           = useState(true);

    // Modal: nuevo motorizado
    const [showNewRider, setShowNewRider] = useState(false);
    const [riderForm, setRiderForm]       = useState({ nombre: '', telefono: '', vehiculo: '' });
    const [savingRider, setSavingRider]   = useState(false);
    const [riderError, setRiderError]     = useState('');

    // UI feedback
    const [copiedId, setCopiedId]         = useState<string | null>(null);
    const [assigningId, setAssigningId]   = useState<string | null>(null);

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 15_000);
        return () => clearInterval(interval);
    }, []);

    const fetchData = async () => {
        try {
            const [pRes, mRes] = await Promise.all([
                fetch('/api/v1/pedidos',     { headers: { Authorization: `Bearer ${token}` } }),
                fetch('/api/v1/motorizados', { headers: { Authorization: `Bearer ${token}` } }),
            ]);
            if (pRes.ok) {
                const d = await pRes.json();
                setPedidos(d.pedidos ?? []);
            }
            if (mRes.ok) {
                const d = await mRes.json();
                setMotorizados(d.motorizados ?? []);
            }
        } catch (e) {
            console.error('DeliveryManager fetch error:', e);
        } finally {
            setLoading(false);
        }
    };

    const updateEstado = async (id: string, nuevoEstado: string) => {
        await fetch(`/api/v1/pedidos/${id}/estado`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ estado: nuevoEstado, nota: `Movido a ${nuevoEstado} desde Torre de Control` }),
        });
        setPedidos(prev => prev.map(p => p.id === id ? { ...p, estado: nuevoEstado } : p));
    };

    const assignMotorizado = async (pedidoId: string, motorizadoId: string) => {
        setAssigningId(pedidoId);
        try {
            const res = await fetch(`/api/v1/pedidos/${pedidoId}/motorizado`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ motorizadoId }),
            });
            if (res.ok && motorizadoId) {
                // Auto-avanzar a en_camino si no estaba ya en ese estado o posterior
                const pedido = pedidos.find(p => p.id === pedidoId);
                if (pedido && !['en_camino', 'entregado', 'cancelado'].includes(pedido.estado)) {
                    await fetch(`/api/v1/pedidos/${pedidoId}/estado`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                        body: JSON.stringify({ estado: 'en_camino', nota: 'Motorizado asignado — pedido despachado.' }),
                    });
                }
                fetchData();
            }
        } finally {
            setAssigningId(null);
        }
    };

    const createMotorizado = async () => {
        if (!riderForm.nombre.trim()) { setRiderError('El nombre es obligatorio.'); return; }
        setSavingRider(true);
        setRiderError('');
        try {
            const res = await fetch('/api/v1/motorizados', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    nombre: riderForm.nombre.trim(),
                    telefono: riderForm.telefono.trim() || undefined,
                    zonaCobertura: riderForm.vehiculo.trim() || undefined,
                    tipoFlota: 'PROPIA',
                }),
            });
            if (res.ok) {
                setShowNewRider(false);
                setRiderForm({ nombre: '', telefono: '', vehiculo: '' });
                fetchData();
            } else {
                const d = await res.json();
                setRiderError(d.error || 'Error al guardar motorizado.');
            }
        } catch {
            setRiderError('Error de conexión.');
        } finally {
            setSavingRider(false);
        }
    };

    const copyDriverLink = (id: string) => {
        const url = `${window.location.origin}/driver/${id}`;
        navigator.clipboard.writeText(url).then(() => {
            setCopiedId(id);
            setTimeout(() => setCopiedId(null), 2500);
        });
    };

    const activeRiders  = motorizados.filter(m => m.activo !== false);
    const pendingCount  = pedidos.filter(p => p.estado === 'pendiente').length;
    const inRouteCount  = pedidos.filter(p => p.estado === 'en_camino').length;
    const todayDelivered = pedidos.filter(p => p.estado === 'entregado').length;

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center">
                <Loader2 className="animate-spin text-blue-500" size={36} />
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col overflow-hidden">

            {/* ── Top Bar ─────────────────────────────────────────── */}
            <div className="flex-none px-6 py-4 border-b border-slate-200 bg-white flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                        <Truck className="text-blue-600" size={22} /> Torre de Control · Logística
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                        <span className="text-amber-600 font-semibold">{pendingCount} nuevos</span>
                        &nbsp;·&nbsp;
                        <span className="text-purple-600 font-semibold">{inRouteCount} en ruta</span>
                        &nbsp;·&nbsp;
                        <span className="text-emerald-600 font-semibold">{todayDelivered} entregados hoy</span>
                    </p>
                </div>
                <button
                    onClick={() => setShowNewRider(true)}
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-xl font-bold text-sm hover:bg-blue-700 transition-all shadow-md shadow-blue-200 active:scale-95"
                >
                    <Plus size={16} /> Agregar Motorizado
                </button>
            </div>

            {/* ── Flota Activa (horizontal strip) ─────────────────── */}
            {activeRiders.length > 0 && (
                <div className="flex-none px-6 py-3 bg-slate-50 border-b border-slate-200">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                        Flota Activa ({activeRiders.length})
                    </p>
                    <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                        {activeRiders.map(m => (
                            <div key={m.id} className="flex-none flex items-center gap-2.5 bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-sm min-w-0">
                                <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                                    <User size={16} className="text-blue-600" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-sm font-bold text-slate-800 truncate max-w-[120px]">{m.nombre}</p>
                                    {m.telefono && (
                                        <p className="text-[11px] text-slate-400 truncate">{m.telefono}</p>
                                    )}
                                </div>
                                <button
                                    onClick={() => copyDriverLink(m.id)}
                                    title="Copiar link del motorizado"
                                    className={`ml-1 flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-all flex-shrink-0 ${
                                        copiedId === m.id
                                            ? 'bg-emerald-100 text-emerald-700'
                                            : 'bg-slate-100 text-slate-600 hover:bg-blue-50 hover:text-blue-600'
                                    }`}
                                >
                                    {copiedId === m.id ? <><Check size={12} /> ¡Copiado!</> : <><Link2 size={12} /> Link</>}
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ── Kanban Board ─────────────────────────────────────── */}
            <div className="flex-1 overflow-x-auto overflow-y-hidden">
                <div className="flex gap-4 p-6 h-full items-start min-w-max">
                    {COLUMNAS.map(col => {
                        const colPedidos = pedidos.filter(p => p.estado === col.id);
                        return (
                            <div key={col.id} className={`w-80 flex-none rounded-2xl border ${col.color} flex flex-col max-h-[calc(100vh-260px)]`}>
                                {/* Column Header */}
                                <div className="p-4 border-b border-white/50 flex justify-between items-center">
                                    <h3 className="font-bold text-sm text-slate-700 flex items-center gap-2">
                                        {col.icon} {col.title}
                                    </h3>
                                    <span className={`text-xs font-bold px-2 py-0.5 rounded-lg ${col.badge}`}>
                                        {colPedidos.length}
                                    </span>
                                </div>

                                {/* Cards */}
                                <div className="flex-1 overflow-y-auto p-3 space-y-3 no-scrollbar">
                                    {colPedidos.length === 0 ? (
                                        <div className="text-center py-10 text-slate-400">
                                            <div className="w-12 h-12 bg-white/60 rounded-2xl flex items-center justify-center mx-auto mb-3 opacity-50">
                                                {col.icon}
                                            </div>
                                            <p className="text-xs font-medium">Sin pedidos aquí</p>
                                        </div>
                                    ) : (
                                        colPedidos.map(pedido => (
                                            <div key={pedido.id} className="bg-white rounded-2xl shadow-sm border border-slate-200/60 overflow-hidden hover:shadow-md transition-shadow">
                                                {/* Card Header */}
                                                <div className="px-4 py-2.5 bg-slate-50/80 border-b border-slate-100 flex justify-between items-center">
                                                    <span className="font-bold text-slate-800 text-sm truncate max-w-[140px]">
                                                        {pedido.clienteNombre}
                                                    </span>
                                                    <span className="font-black text-blue-600 text-sm ml-2 flex-shrink-0">
                                                        C${Number(pedido.total).toFixed(2)}
                                                    </span>
                                                </div>

                                                <div className="p-4 space-y-3">
                                                    {/* Contacto */}
                                                    <div className="flex gap-2">
                                                        <a href={`tel:${pedido.clienteTelefono}`}
                                                            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-blue-600 transition-colors"
                                                        >
                                                            <Phone size={12} className="flex-shrink-0" />
                                                            {pedido.clienteTelefono}
                                                        </a>
                                                    </div>

                                                    {/* Dirección */}
                                                    <div className="flex items-start gap-1.5 text-xs text-slate-500">
                                                        <MapPin size={12} className="mt-0.5 flex-shrink-0 text-slate-400" />
                                                        <span className="line-clamp-2 leading-relaxed">{pedido.direccionEntrega}</span>
                                                    </div>

                                                    {/* Items preview */}
                                                    {pedido.items && pedido.items.length > 0 && (
                                                        <div className="text-[11px] text-slate-400 space-y-0.5">
                                                            {pedido.items.slice(0, 2).map((item, i) => (
                                                                <div key={i}>· {item.cantidad}× {item.producto?.name}</div>
                                                            ))}
                                                            {pedido.items.length > 2 && (
                                                                <div className="italic">+{pedido.items.length - 2} más</div>
                                                            )}
                                                        </div>
                                                    )}

                                                    {/* Asignar Motorizado */}
                                                    {col.id !== 'entregado' && (
                                                        <div>
                                                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                                                                Motorizado
                                                            </label>
                                                            <div className="relative">
                                                                <select
                                                                    value={pedido.motorizadoId || ''}
                                                                    onChange={e => assignMotorizado(pedido.id, e.target.value)}
                                                                    disabled={assigningId === pedido.id || col.id === 'cancelado'}
                                                                    className="w-full text-xs px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 focus:outline-none focus:border-blue-400 appearance-none disabled:opacity-60"
                                                                >
                                                                    <option value="">— Sin asignar —</option>
                                                                    {activeRiders.map(m => (
                                                                        <option key={m.id} value={m.id}>
                                                                            {m.tipoFlota === 'NORTEX' ? '⚡ ' : '🛵 '}{m.nombre}
                                                                        </option>
                                                                    ))}
                                                                </select>
                                                                {assigningId === pedido.id && (
                                                                    <Loader2 size={12} className="absolute right-2 top-1/2 -translate-y-1/2 animate-spin text-blue-500" />
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Motorizado asignado badge */}
                                                    {pedido.motorizado && (
                                                        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-purple-700 bg-purple-50 rounded-lg px-2.5 py-1.5">
                                                            <Truck size={11} /> {pedido.motorizado.nombre}
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Avance de estado */}
                                                {ESTADO_SIGUIENTE[col.id] && (
                                                    <div className="px-4 pb-4">
                                                        <button
                                                            onClick={() => updateEstado(pedido.id, ESTADO_SIGUIENTE[col.id])}
                                                            className={`w-full py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all active:scale-[0.98] ${
                                                                col.id === 'pendiente'
                                                                    ? 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                                                                    : 'bg-purple-50 text-purple-700 hover:bg-purple-100'
                                                            }`}
                                                        >
                                                            {col.id === 'pendiente' ? 'Iniciar Preparación' : 'Despachar'}
                                                            <ChevronRight size={14} />
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* ── Modal: Nuevo Motorizado ──────────────────────────── */}
            {showNewRider && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowNewRider(false)} />
                    <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 animate-in zoom-in-95 duration-200">
                        {/* Modal Header */}
                        <div className="flex items-center justify-between mb-5">
                            <div>
                                <h3 className="text-lg font-bold text-slate-900">Registrar Motorizado</h3>
                                <p className="text-xs text-slate-400 mt-0.5">Flota Propia del negocio</p>
                            </div>
                            <button onClick={() => setShowNewRider(false)} className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-400">
                                <X size={18} />
                            </button>
                        </div>

                        <div className="space-y-4">
                            {/* Nombre */}
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                                    Nombre completo *
                                </label>
                                <input
                                    type="text"
                                    placeholder="Ej: Juan Pérez"
                                    value={riderForm.nombre}
                                    onChange={e => setRiderForm({ ...riderForm, nombre: e.target.value })}
                                    autoFocus
                                    className="w-full px-4 py-3 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                                />
                            </div>

                            {/* Teléfono */}
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                                    Teléfono / WhatsApp
                                </label>
                                <div className="relative">
                                    <Phone size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <input
                                        type="tel"
                                        placeholder="8888-0000"
                                        value={riderForm.telefono}
                                        onChange={e => setRiderForm({ ...riderForm, telefono: e.target.value })}
                                        className="w-full pl-9 pr-4 py-3 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                                    />
                                </div>
                            </div>

                            {/* Vehículo / Placa */}
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                                    Vehículo / Placa
                                </label>
                                <input
                                    type="text"
                                    placeholder="Ej: Moto Honda · M-123456"
                                    value={riderForm.vehiculo}
                                    onChange={e => setRiderForm({ ...riderForm, vehiculo: e.target.value })}
                                    className="w-full px-4 py-3 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                                />
                            </div>

                            {/* Error */}
                            {riderError && (
                                <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                                    <AlertCircle size={16} className="flex-shrink-0" />
                                    {riderError}
                                </div>
                            )}

                            {/* Botones */}
                            <div className="flex gap-3 pt-1">
                                <button
                                    onClick={() => setShowNewRider(false)}
                                    className="flex-1 py-3 border border-slate-200 rounded-xl text-slate-600 font-semibold hover:bg-slate-50 transition-all"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={createMotorizado}
                                    disabled={savingRider || !riderForm.nombre.trim()}
                                    className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50"
                                >
                                    {savingRider ? <Loader2 className="animate-spin" size={18} /> : <Plus size={18} />}
                                    {savingRider ? 'Guardando...' : 'Registrar'}
                                </button>
                            </div>

                            {/* Info tipoFlota */}
                            <p className="text-[11px] text-slate-400 text-center">
                                Se registrará como <strong>Flota Propia</strong> del negocio.
                                Copia el link para enviárselo al conductor.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            <style>{`
                .no-scrollbar::-webkit-scrollbar { display: none; }
                .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
            `}</style>
        </div>
    );
};

export default DeliveryManager;
