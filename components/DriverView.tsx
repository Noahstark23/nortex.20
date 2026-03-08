import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Truck, MapPin, Phone, CheckCircle, Package, Clock, Loader2, Navigation } from 'lucide-react';

interface OrderItem {
    id: string;
    cantidad: number;
    producto: {
        name: string;
    };
}

interface Order {
    id: string;
    clienteNombre: string;
    clienteTelefono: string;
    direccionEntrega: string;
    referenciaDireccion?: string;
    notas?: string;
    estado: string;
    total: number;
    items: OrderItem[];
}

interface Driver {
    id: string;
    nombre: string;
    tipoFlota: string;
}

const DriverView: React.FC = () => {
    const { id: driverId } = useParams<{ id: string }>();
    const [driver, setDriver] = useState<Driver | null>(null);
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [error, setError] = useState('');

    useEffect(() => {
        fetchOrders();
        // Polling para nuevos pedidos
        const intv = setInterval(fetchOrders, 10000);
        return () => clearInterval(intv);
    }, [driverId]);

    const fetchOrders = async () => {
        try {
            const res = await fetch(`/api/public/driver/${driverId}/orders`);
            if (res.ok) {
                const data = await res.json();
                setDriver(data.driver);
                setOrders(data.orders);
            } else {
                setError('Enlace inválido o motorizado inactivo.');
            }
        } catch (err) {
            setError('Error de conexión.');
        } finally {
            setLoading(false);
        }
    };

    const markAsDelivered = async (orderId: string) => {
        const confirmResult = window.confirm("¿Confirmas que entregaste este pedido y recibiste el pago?");
        if (!confirmResult) return;

        setProcessingId(orderId);
        try {
            const res = await fetch(`/api/public/driver/${driverId}/orders/${orderId}/deliver`, {
                method: 'PATCH'
            });
            if (res.ok) {
                // Quitar de la lista
                setOrders(prev => prev.filter(o => o.id !== orderId));
            } else {
                const data = await res.json();
                alert(data.error || 'Error al procesar la entrega');
            }
        } catch (error) {
            alert('Error de conexión');
        } finally {
            setProcessingId(null);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <Loader2 className="animate-spin text-blue-500" size={40} />
            </div>
        );
    }

    if (error || !driver) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 text-center">
                <div className="bg-white p-6 rounded-3xl shadow-lg w-full max-w-sm">
                    <Truck className="text-slate-300 mx-auto mb-4" size={48} />
                    <h2 className="text-xl font-bold text-slate-800 mb-2">Acceso Denegado</h2>
                    <p className="text-slate-500">{error}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-100 pb-20">
            {/* Header Flotante */}
            <div className="bg-blue-600 text-white p-5 rounded-b-3xl shadow-md sticky top-0 z-10">
                <div className="flex items-center gap-3">
                    <div className="bg-white/20 p-2.5 rounded-2xl backdrop-blur-sm">
                        <Truck size={24} />
                    </div>
                    <div>
                        <h1 className="font-bold text-xl leading-tight">{driver.nombre}</h1>
                        <p className="text-blue-100 text-sm font-medium">
                            {driver.tipoFlota === 'NORTEX' ? '⚡ Freelance Nortex' : 'Flota Propia'}
                        </p>
                    </div>
                </div>
            </div>

            <div className="p-4 space-y-4 max-w-md mx-auto mt-2">
                <h2 className="font-bold text-slate-600 text-sm uppercase tracking-wider flex items-center gap-2">
                    <Package size={16} /> Entregas Pendientes ({orders.length})
                </h2>

                {orders.length === 0 ? (
                    <div className="bg-white rounded-3xl p-8 text-center shadow-sm border border-slate-200">
                        <Clock className="text-slate-300 mx-auto mb-3" size={40} />
                        <p className="text-slate-500 font-medium text-lg">Estás al día</p>
                        <p className="text-slate-400 text-sm">No tienes entregas asignadas en este momento.</p>
                    </div>
                ) : (
                    orders.map(order => (
                        <div key={order.id} className="bg-white rounded-3xl overflow-hidden shadow-sm border border-slate-200">
                            {/* Card Header (Estado + Total) */}
                            <div className={`px-5 py-3 flex justify-between items-center ${order.estado === 'preparando' ? 'bg-blue-50/50' : 'bg-purple-50/50'}`}>
                                <span className={`text-xs font-bold uppercase tracking-wider ${order.estado === 'preparando' ? 'text-blue-600' : 'text-purple-600'}`}>
                                    {order.estado === 'preparando' ? 'En Ferretería' : 'En Camino'}
                                </span>
                                <span className="font-bold text-slate-800 text-lg">C${Number(order.total).toFixed(2)}</span>
                            </div>

                            <div className="p-5 space-y-4">
                                {/* Cliente Info */}
                                <div>
                                    <h3 className="font-bold text-slate-900 text-lg">{order.clienteNombre}</h3>

                                    {/* Action Buttons: Call & WA */}
                                    <div className="flex gap-2 mt-3">
                                        <a
                                            href={`tel:${order.clienteTelefono}`}
                                            className="flex-1 bg-slate-100 text-slate-700 py-2.5 rounded-xl flex items-center justify-center gap-2 font-semibold text-sm hover:bg-slate-200 transition-colors"
                                        >
                                            <Phone size={16} /> Llamar
                                        </a>
                                        <a
                                            href={`https://wa.me/505${order.clienteTelefono.replace(/\D/g, '')}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex-1 bg-green-50 text-green-700 py-2.5 rounded-xl flex items-center justify-center gap-2 font-semibold text-sm hover:bg-green-100 transition-colors"
                                        >
                                            WhatsApp
                                        </a>
                                    </div>
                                </div>

                                {/* Dirección */}
                                <div className="bg-slate-50 p-4 rounded-2xl flex items-start gap-3">
                                    <MapPin className="text-blue-500 shrink-0 mt-0.5" size={18} />
                                    <div>
                                        <p className="text-sm text-slate-800 font-medium leading-relaxed">{order.direccionEntrega}</p>
                                        {order.referenciaDireccion && (
                                            <p className="text-xs text-slate-500 mt-1 italic">Ref: {order.referenciaDireccion}</p>
                                        )}
                                        {order.notas && (
                                            <p className="text-xs text-amber-600 mt-2 bg-amber-50 px-2 py-1 rounded inline-block font-medium">
                                                Nota: {order.notas}
                                            </p>
                                        )}
                                    </div>
                                </div>

                                {/* Items Compactos */}
                                <div className="border-t border-slate-100 pt-3">
                                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Artículos</p>
                                    <ul className="text-sm text-slate-600 space-y-1">
                                        {order.items.slice(0, 2).map((item, idx) => (
                                            <li key={idx} className="flex justify-between">
                                                <span className="truncate pr-2">{item.producto.name}</span>
                                                <span className="font-semibold text-slate-800 shrink-0">x{item.cantidad}</span>
                                            </li>
                                        ))}
                                        {order.items.length > 2 && (
                                            <li className="text-xs text-slate-400 italic">...y {order.items.length - 2} más</li>
                                        )}
                                    </ul>
                                </div>
                            </div>

                            {/* Botón de Entrega */}
                            <div className="p-4 pt-0">
                                {order.estado === 'preparando' ? (
                                    <button
                                        disabled
                                        className="w-full py-4 rounded-2xl font-bold flex items-center justify-center gap-2 bg-slate-100 text-slate-400 uppercase tracking-wide cursor-not-allowed"
                                    >
                                        Esperando en Ferretería
                                    </button>
                                ) : (
                                    <button
                                        onClick={() => markAsDelivered(order.id)}
                                        disabled={processingId === order.id}
                                        className="w-full py-4 rounded-2xl font-bold flex items-center justify-center gap-2 bg-emerald-500 text-white shadow-lg shadow-emerald-200 hover:bg-emerald-600 active:scale-[0.98] transition-all uppercase tracking-wide text-lg"
                                    >
                                        {processingId === order.id ? (
                                            <Loader2 className="animate-spin" size={24} />
                                        ) : (
                                            <>
                                                <CheckCircle size={24} /> Entregar Pedido
                                            </>
                                        )}
                                    </button>
                                )}
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

export default DriverView;
