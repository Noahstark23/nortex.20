import React, { useState, useEffect } from 'react';
import { Package, Truck, CheckCircle, Clock, Search, MapPin, User, ChevronRight, Zap, Phone } from 'lucide-react';

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
        nombre: string;
        telefono: string;
        tipoFlota: string;
    };
    items?: any[];
}

interface Motorizado {
    id: string;
    nombre: string;
    tipoFlota: string;
}

const COLUMNAS = [
    { id: 'pendiente', title: 'Nuevos', icon: <Clock size={18} className="text-amber-500" />, color: 'border-amber-200 bg-amber-50' },
    { id: 'preparando', title: 'Preparando', icon: <Package size={18} className="text-blue-500" />, color: 'border-blue-200 bg-blue-50' },
    { id: 'en_camino', title: 'En Camino', icon: <Truck size={18} className="text-purple-500" />, color: 'border-purple-200 bg-purple-50' },
    { id: 'entregado', title: 'Entregados', icon: <CheckCircle size={18} className="text-emerald-500" />, color: 'border-emerald-200 bg-emerald-50' }
];

const DeliveryManager: React.FC = () => {
    const [pedidos, setPedidos] = useState<Pedido[]>([]);
    const [motorizados, setMotorizados] = useState<Motorizado[]>([]);
    const [loading, setLoading] = useState(true);
    const token = localStorage.getItem('nortex_token');

    useEffect(() => {
        fetchData();
        // Optional: Polling every 15s to get new orders
        const interval = setInterval(fetchData, 15000);
        return () => clearInterval(interval);
    }, []);

    const fetchData = async () => {
        try {
            const [pRes, mRes] = await Promise.all([
                fetch('/api/v1/pedidos', { headers: { 'Authorization': `Bearer ${token}` } }),
                fetch('/api/v1/motorizados', { headers: { 'Authorization': `Bearer ${token}` } })
            ]);

            if (pRes.ok) {
                const pData = await pRes.json();
                setPedidos(pData.pedidos);
            }
            if (mRes.ok) {
                const mData = await mRes.json();
                // We only need active riders for assignment
                setMotorizados(mData.motorizados.filter((m: any) => m.activo));
            }
        } catch (error) {
            console.error('Error fetching delivery data:', error);
        } finally {
            setLoading(false);
        }
    };

    const updateEstado = async (id: string, nuevoEstado: string) => {
        try {
            const res = await fetch(`/api/v1/pedidos/${id}/estado`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ estado: nuevoEstado, nota: `Movido a ${nuevoEstado} desde el tablero` })
            });
            if (res.ok) {
                setPedidos(prev => prev.map(p => p.id === id ? { ...p, estado: nuevoEstado } : p));
            }
        } catch (error) {
            console.error('Error updating state:', error);
        }
    };

    const assignMotorizado = async (pedidoId: string, motorizadoId: string) => {
        try {
            const res = await fetch(`/api/v1/pedidos/${pedidoId}/motorizado`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ motorizadoId })
            });
            if (res.ok) {
                fetchData(); // Refresh to get populated motorizado details
            }
        } catch (error) {
            console.error('Error assigning rider:', error);
        }
    };

    if (loading) return <div className="p-8 text-center text-slate-500">Cargando gestor de entregas...</div>;

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                    <Truck className="text-blue-600" /> Despacho y Entregas (Kanban)
                </h2>
                <p className="text-slate-500">Administra los pedidos en vivo y asigna motorizados.</p>
            </div>

            <div className="flex gap-4 overflow-x-auto pb-4 items-start min-h-[70vh]">
                {COLUMNAS.map(col => {
                    const columnPedidos = pedidos.filter(p => p.estado === col.id);
                    return (
                        <div key={col.id} className={`flex-none w-80 rounded-2xl border ${col.color} flex flex-col max-h-[75vh]`}>
                            <div className="p-4 border-b border-white/40 flex justify-between items-center">
                                <h3 className="font-bold flex items-center gap-2 text-slate-700">
                                    {col.icon} {col.title}
                                </h3>
                                <span className="bg-white/50 text-slate-700 font-bold px-2.5 py-1 rounded-lg text-xs">
                                    {columnPedidos.length}
                                </span>
                            </div>

                            <div className="p-3 overflow-y-auto space-y-3 flex-1 no-scrollbar">
                                {columnPedidos.map(pedido => (
                                    <div key={pedido.id} className="bg-white rounded-xl shadow-sm border border-slate-200/60 p-4 hover:shadow-md transition-shadow">
                                        <div className="flex justify-between items-start mb-2">
                                            <span className="font-bold text-slate-800 text-sm">{pedido.clienteNombre}</span>
                                            <span className="font-bold text-blue-600 text-sm">C${Number(pedido.total).toFixed(2)}</span>
                                        </div>

                                        <div className="text-xs text-slate-500 space-y-1 mt-3">
                                            <p className="flex justify-center items-center gap-1.5 justify-start">
                                                <Phone size={12} className="text-slate-400" /> {pedido.clienteTelefono}
                                            </p>
                                            <p className="flex justify-center items-start gap-1.5 justify-start">
                                                <MapPin size={12} className="mt-0.5 text-slate-400 shrink-0" />
                                                <span className="line-clamp-2">{pedido.direccionEntrega}</span>
                                            </p>
                                        </div>

                                        {/* Motorizado Assignment */}
                                        <div className="mt-4 pt-3 border-t border-slate-100">
                                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">
                                                Motorizado Asignado
                                            </label>
                                            <select
                                                value={pedido.motorizadoId || ""}
                                                onChange={(e) => assignMotorizado(pedido.id, e.target.value)}
                                                className="w-full text-xs p-2 rounded-lg border border-slate-200 focus:outline-none focus:border-blue-500 text-slate-700 bg-slate-50 disabled:opacity-75"
                                                disabled={pedido.estado === 'entregado' || pedido.estado === 'cancelado'}
                                            >
                                                <option value="">-- Sin asignar --</option>
                                                {motorizados.map(m => (
                                                    <option key={m.id} value={m.id}>
                                                        {m.tipoFlota === 'NORTEX' ? '⚡ ' : ''}{m.nombre} ({m.tipoFlota})
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        {/* Actions */}
                                        {col.id !== 'entregado' && (
                                            <div className="mt-3 flex gap-2">
                                                {col.id === 'pendiente' && (
                                                    <button
                                                        onClick={() => updateEstado(pedido.id, 'preparando')}
                                                        className="flex-1 bg-blue-50 text-blue-600 text-xs font-bold py-2 rounded-lg hover:bg-blue-100 flex justify-center items-center gap-1"
                                                    >
                                                        A Preparación <ChevronRight size={14} />
                                                    </button>
                                                )}
                                                {col.id === 'preparando' && (
                                                    <button
                                                        onClick={() => updateEstado(pedido.id, 'en_camino')}
                                                        className="flex-1 bg-purple-50 text-purple-600 text-xs font-bold py-2 rounded-lg hover:bg-purple-100 flex justify-center items-center gap-1"
                                                    >
                                                        Despachar <ChevronRight size={14} />
                                                    </button>
                                                )}
                                                {col.id === 'en_camino' && (
                                                    <button
                                                        onClick={() => updateEstado(pedido.id, 'entregado')}
                                                        className="flex-1 bg-emerald-50 text-emerald-600 text-xs font-bold py-2 rounded-lg hover:bg-emerald-100 flex justify-center items-center gap-1"
                                                    >
                                                        Completar <CheckCircle size={14} />
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ))}
                                {columnPedidos.length === 0 && (
                                    <div className="text-center py-10 px-4">
                                        <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
                                            {col.id === 'pendiente' && <Clock size={28} className="text-slate-300" />}
                                            {col.id === 'preparando' && <Package size={28} className="text-slate-300" />}
                                            {col.id === 'en_camino' && <Truck size={28} className="text-slate-300" />}
                                            {col.id === 'entregado' && <CheckCircle size={28} className="text-slate-300" />}
                                        </div>
                                        <p className="text-sm font-bold text-slate-400 mb-1">
                                            {col.id === 'pendiente' && 'Sin pedidos nuevos'}
                                            {col.id === 'preparando' && 'Nada en preparación'}
                                            {col.id === 'en_camino' && 'Sin entregas en ruta'}
                                            {col.id === 'entregado' && 'Sin entregas completadas'}
                                        </p>
                                        <p className="text-xs text-slate-300 leading-relaxed">
                                            {col.id === 'pendiente' && 'Los pedidos de la tienda en línea aparecerán aquí automáticamente.'}
                                            {col.id === 'preparando' && 'Mueve pedidos aquí cuando los estés empacando.'}
                                            {col.id === 'en_camino' && 'Despacha pedidos preparados para verlos en ruta.'}
                                            {col.id === 'entregado' && 'Los pedidos completados se registran aquí.'}
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default DeliveryManager;
