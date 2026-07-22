import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, MapPin, Phone, PackageCheck, ChefHat, Bike, CheckCircle2, XCircle, Clock } from 'lucide-react';

/**
 * Seguimiento público de un Pedido a domicilio (/track/:pedidoId).
 * Consume GET /api/v1/pedidos/:id/tracking (sin JWT) y refresca cada 30 s.
 * Es la página que el cliente recibe por WhatsApp al confirmar su pedido.
 */

interface TrackingEvento {
    id: string;
    estado: string;
    nota?: string | null;
    createdAt: string;
}

interface TrackingData {
    id: string;
    estado: string;
    createdAt: string;
    clienteNombre: string;
    eventos: TrackingEvento[];
    motorizado: { nombre: string; telefono: string } | null;
}

const PASOS: { estado: string; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
    { estado: 'pendiente', label: 'Pedido recibido', icon: PackageCheck },
    { estado: 'preparando', label: 'Preparando tu pedido', icon: ChefHat },
    { estado: 'en_camino', label: 'En camino', icon: Bike },
    { estado: 'entregado', label: 'Entregado', icon: CheckCircle2 },
];

const TrackPedido: React.FC = () => {
    const { pedidoId } = useParams<{ pedidoId: string }>();
    const [data, setData] = useState<TrackingData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const fetchTracking = useCallback(async () => {
        if (!pedidoId) return;
        try {
            const res = await fetch(`/api/v1/pedidos/${pedidoId}/tracking`);
            if (!res.ok) {
                setError('Pedido no encontrado. Verifica el enlace.');
                return;
            }
            const json = await res.json();
            setData(json.tracking);
            setError('');
        } catch {
            // Red caída: conservamos el último estado conocido sin alarmar.
        } finally {
            setLoading(false);
        }
    }, [pedidoId]);

    useEffect(() => {
        fetchTracking();
        const interval = setInterval(fetchTracking, 30_000);
        return () => clearInterval(interval);
    }, [fetchTracking]);

    if (loading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50 flex items-center justify-center">
                <Loader2 className="animate-spin text-emerald-500" size={40} />
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-3xl shadow-xl p-8 max-w-md w-full text-center">
                    <XCircle className="text-red-400 mx-auto mb-4" size={48} />
                    <h1 className="text-xl font-bold text-slate-900 mb-2">No encontramos tu pedido</h1>
                    <p className="text-slate-500 text-sm">{error || 'Verifica el enlace de seguimiento.'}</p>
                </div>
            </div>
        );
    }

    const cancelado = data.estado === 'cancelado';
    const pasoActual = PASOS.findIndex(p => p.estado === data.estado);
    const orderNum = data.id.slice(-8).toUpperCase();

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl shadow-xl p-6 sm:p-8 max-w-md w-full">
                {/* Header */}
                <div className="text-center mb-6">
                    <p className="text-xs font-mono text-slate-400 uppercase tracking-widest mb-1">Pedido #{orderNum}</p>
                    <h1 className="text-2xl font-bold text-slate-900">
                        {cancelado ? 'Pedido cancelado' : `¡Hola, ${data.clienteNombre.split(' ')[0]}!`}
                    </h1>
                    {!cancelado && (
                        <p className="text-slate-500 text-sm mt-1">
                            {data.estado === 'entregado' ? 'Tu pedido fue entregado. ¡Gracias por tu compra! ' : 'Aquí podés seguir tu pedido en tiempo real.'}
                        </p>
                    )}
                </div>

                {cancelado ? (
                    <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center text-red-600 font-medium">
                        Este pedido fue cancelado. Contactá al comercio para más detalles.
                    </div>
                ) : (
                    <>
                        {/* Timeline de pasos */}
                        <div className="space-y-0 mb-6">
                            {PASOS.map((paso, i) => {
                                const Icon = paso.icon;
                                const done = i <= pasoActual;
                                const current = i === pasoActual;
                                return (
                                    <div key={paso.estado} className="flex items-start gap-3">
                                        <div className="flex flex-col items-center">
                                            <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors ${done ? 'bg-emerald-500 border-emerald-500 text-white' : 'bg-white border-slate-200 text-slate-300'}`}>
                                                <Icon size={18} />
                                            </div>
                                            {i < PASOS.length - 1 && (
                                                <div className={`w-0.5 h-8 ${i < pasoActual ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                                            )}
                                        </div>
                                        <div className="pt-2">
                                            <p className={`text-sm font-bold ${done ? 'text-slate-900' : 'text-slate-400'}`}>
                                                {paso.label}
                                                {current && data.estado !== 'entregado' && (
                                                    <span className="ml-2 inline-block w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                                                )}
                                            </p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Motorizado asignado */}
                        {data.motorizado && data.estado !== 'entregado' && (
                            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 mb-4 flex items-center gap-3">
                                <div className="w-11 h-11 bg-emerald-500 rounded-full flex items-center justify-center text-white">
                                    <Bike size={22} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-bold text-emerald-900 truncate">{data.motorizado.nombre}</p>
                                    <p className="text-xs text-emerald-600">Tu repartidor asignado</p>
                                </div>
                                <a
                                    href={`tel:${data.motorizado.telefono}`}
                                    className="p-2.5 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 transition-colors"
                                >
                                    <Phone size={18} />
                                </a>
                            </div>
                        )}
                    </>
                )}

                {/* Historial de eventos */}
                {data.eventos.length > 0 && (
                    <div className="border-t border-slate-100 pt-4">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                            <Clock size={12} /> Historial
                        </p>
                        <div className="space-y-1.5 max-h-40 overflow-y-auto">
                            {data.eventos.map(ev => (
                                <div key={ev.id} className="flex justify-between items-baseline text-xs gap-2">
                                    <span className="text-slate-600 truncate">{ev.nota || ev.estado.replace('_', ' ')}</span>
                                    <span className="text-slate-400 font-mono tabular-nums flex-shrink-0">
                                        {new Date(ev.createdAt).toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <p className="text-center text-[10px] text-slate-300 mt-6 flex items-center justify-center gap-1">
                    <MapPin size={10} /> Se actualiza automáticamente · Nortex Delivery
                </p>
            </div>
        </div>
    );
};

export default TrackPedido;
