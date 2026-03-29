import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
    Truck, MapPin, Phone, CheckCircle, Package, Clock,
    Loader2, Navigation, MessageCircle, X, Wallet, AlertTriangle
} from 'lucide-react';

// ─── Interfaces ────────────────────────────────────────────────────────────

interface OrderItem {
    id: string;
    cantidad: number;
    producto: { name: string };
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

interface Liquidacion {
    pedidosEntregados: number;
    totalCobrado: number;
    comisionesGanadas: number;
    netoADepositarA_Tienda: number;
}

// ─── Confirm Modal ─────────────────────────────────────────────────────────

interface ConfirmDeliveryModalProps {
    order: Order;
    onConfirm: () => void;
    onCancel: () => void;
    isProcessing: boolean;
}

const ConfirmDeliveryModal: React.FC<ConfirmDeliveryModalProps> = ({
    order, onConfirm, onCancel, isProcessing
}) => (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onCancel} />

        {/* Sheet */}
        <div className="relative w-full sm:max-w-sm bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-700 overflow-hidden animate-in slide-in-from-bottom duration-300">

            {/* Warning strip */}
            <div className="bg-emerald-500 px-6 py-3 flex items-center gap-2">
                <CheckCircle size={18} className="text-emerald-900" />
                <span className="font-black text-emerald-900 text-sm uppercase tracking-widest">
                    Confirmar Entrega
                </span>
            </div>

            <div className="px-6 pt-6 pb-4 text-center space-y-2">
                <p className="text-slate-400 text-sm">Pedido de</p>
                <p className="text-white font-black text-xl">{order.clienteNombre}</p>

                {/* ── MONTO GIGANTE ── */}
                <div className="py-5">
                    <p className="text-slate-400 text-xs uppercase tracking-widest mb-1">
                        Efectivo a cobrar
                    </p>
                    <p className="text-6xl font-black text-emerald-400 tracking-tight leading-none">
                        C${Number(order.total).toFixed(2)}
                    </p>
                </div>

                <p className="text-slate-400 text-sm leading-relaxed">
                    ¿Confirmas que <strong className="text-white">recibiste este efectivo</strong>{' '}
                    y el cliente firmó de recibido?
                </p>
            </div>

            {/* Items compactos */}
            <div className="mx-6 mb-5 bg-slate-800 rounded-2xl p-3 border border-slate-700">
                {order.items.slice(0, 3).map((item, i) => (
                    <div key={i} className="flex justify-between text-xs text-slate-400 py-0.5">
                        <span className="truncate pr-2">{item.producto.name}</span>
                        <span className="font-bold text-slate-300 flex-shrink-0">×{item.cantidad}</span>
                    </div>
                ))}
                {order.items.length > 3 && (
                    <p className="text-[11px] text-slate-500 mt-1 italic">
                        +{order.items.length - 3} artículos más
                    </p>
                )}
            </div>

            {/* Botones */}
            <div className="px-6 pb-8 flex flex-col gap-3">
                <button
                    onClick={onConfirm}
                    disabled={isProcessing}
                    className="w-full py-4 bg-emerald-500 text-white rounded-2xl font-black text-lg uppercase tracking-wide shadow-lg shadow-emerald-900/50 hover:bg-emerald-400 active:scale-[0.97] transition-all disabled:opacity-60 flex items-center justify-center gap-2"
                >
                    {isProcessing
                        ? <><Loader2 className="animate-spin" size={22} /> Procesando...</>
                        : <><CheckCircle size={22} /> Sí, cobré C${Number(order.total).toFixed(2)}</>
                    }
                </button>
                <button
                    onClick={onCancel}
                    disabled={isProcessing}
                    className="w-full py-3 border border-slate-600 text-slate-400 rounded-2xl font-semibold hover:bg-slate-800 transition-colors"
                >
                    Cancelar
                </button>
            </div>
        </div>
    </div>
);

// ─── Main Component ────────────────────────────────────────────────────────

const DriverView: React.FC = () => {
    const { id: driverId } = useParams<{ id: string }>();

    const [driver, setDriver]         = useState<Driver | null>(null);
    const [orders, setOrders]         = useState<Order[]>([]);
    const [liquidacion, setLiquidacion] = useState<Liquidacion | null>(null);
    const [loading, setLoading]       = useState(true);
    const [error, setError]           = useState('');

    // Modal state
    const [confirmOrder, setConfirmOrder] = useState<Order | null>(null);
    const [processingId, setProcessingId] = useState<string | null>(null);

    useEffect(() => {
        fetchOrders();
        const intv = setInterval(fetchOrders, 10_000);
        return () => clearInterval(intv);
    }, [driverId]);

    const fetchOrders = async () => {
        try {
            const res = await fetch(`/api/public/driver/${driverId}/orders`);
            if (res.ok) {
                const data = await res.json();
                setDriver(data.driver);
                setOrders(data.orders ?? []);
                if (data.liquidacionDiaria) setLiquidacion(data.liquidacionDiaria);
            } else {
                setError('Enlace inválido o motorizado inactivo.');
            }
        } catch {
            setError('Error de conexión. Verifica tu internet.');
        } finally {
            setLoading(false);
        }
    };

    // Called when driver taps the big green button
    const handleDeliverTap = (order: Order) => {
        if (processingId) return; // guard: one operation at a time
        setConfirmOrder(order);
    };

    // Called after modal confirmation
    const confirmDelivery = async () => {
        if (!confirmOrder) return;
        const orderId = confirmOrder.id;
        setProcessingId(orderId);

        let lat: number | null = null;
        let lng: number | null = null;

        try {
            const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    timeout: 6000,
                    enableHighAccuracy: true,
                })
            );
            lat = pos.coords.latitude;
            lng = pos.coords.longitude;
        } catch {
            // GPS no disponible — continuar sin coordenadas
        }

        try {
            const res = await fetch(`/api/public/driver/${driverId}/orders/${orderId}/deliver`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lat, lng }),
            });

            if (res.ok) {
                setConfirmOrder(null);
                setOrders(prev => prev.filter(o => o.id !== orderId));
                fetchOrders(); // refresca liquidación
            } else {
                const d = await res.json();
                alert(d.error || 'Error al registrar la entrega');
                setConfirmOrder(null);
            }
        } catch {
            alert('Error de conexión. Intenta de nuevo.');
            setConfirmOrder(null);
        } finally {
            setProcessingId(null);
        }
    };

    // Navigation helpers
    const wazeUrl  = (dir: string) => `https://waze.com/ul?q=${encodeURIComponent(dir)}&navigate=yes`;
    const mapsUrl  = (dir: string) => `https://maps.google.com/?q=${encodeURIComponent(dir)}`;
    const waLink   = (phone: string) => `https://wa.me/505${phone.replace(/\D/g, '')}`;

    // ── Loading ──
    if (loading) {
        return (
            <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center gap-4">
                <div className="w-16 h-16 bg-emerald-500/10 rounded-2xl border border-emerald-500/20 flex items-center justify-center">
                    <Truck size={28} className="text-emerald-400 animate-pulse" />
                </div>
                <Loader2 className="animate-spin text-emerald-400" size={32} />
                <p className="text-slate-500 text-sm">Cargando tus entregas...</p>
            </div>
        );
    }

    // ── Error ──
    if (error || !driver) {
        return (
            <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
                <div className="bg-slate-800 border border-slate-700 rounded-3xl p-8 w-full max-w-sm text-center">
                    <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
                        <AlertTriangle className="text-red-400" size={28} />
                    </div>
                    <h2 className="text-xl font-bold text-white mb-2">Acceso Inválido</h2>
                    <p className="text-slate-400 text-sm">{error || 'Link expirado o motorizado inactivo.'}</p>
                </div>
            </div>
        );
    }

    const pendingCount = orders.length;

    return (
        <div className="min-h-screen bg-slate-100 pb-28">

            {/* ── Sticky Header ─────────────────────────────────────── */}
            <div className="sticky top-0 z-30 bg-slate-900 text-white px-5 pt-5 pb-4 rounded-b-3xl shadow-2xl">
                <div className="flex items-center gap-3">
                    <div className="w-11 h-11 bg-emerald-500/20 border border-emerald-500/30 rounded-2xl flex items-center justify-center">
                        <Truck size={22} className="text-emerald-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h1 className="font-black text-lg leading-tight text-white truncate">{driver.nombre}</h1>
                        <p className="text-slate-400 text-xs">
                            {driver.tipoFlota === 'NORTEX' ? '⚡ Flota Nortex' : '🛵 Flota Propia'}
                            {pendingCount > 0
                                ? <> &nbsp;·&nbsp; <span className="text-amber-400 font-semibold">{pendingCount} entrega{pendingCount !== 1 ? 's' : ''} pendiente{pendingCount !== 1 ? 's' : ''}</span></>
                                : <> &nbsp;·&nbsp; <span className="text-emerald-400 font-semibold">Todo al día ✓</span></>
                            }
                        </p>
                    </div>
                </div>
            </div>

            {/* ── Order Cards ───────────────────────────────────────── */}
            <div className="px-4 pt-4 space-y-4 max-w-lg mx-auto">

                {pendingCount === 0 ? (
                    <div className="bg-white rounded-3xl p-10 text-center shadow-sm border border-slate-200 mt-6">
                        <div className="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                            <CheckCircle className="text-emerald-500" size={32} />
                        </div>
                        <p className="text-slate-800 font-black text-xl mb-1">¡Estás al día!</p>
                        <p className="text-slate-400 text-sm">No hay entregas pendientes.<br />La app se actualiza automáticamente.</p>
                    </div>
                ) : (
                    orders.map(order => (
                        <div key={order.id} className="bg-white rounded-3xl overflow-hidden shadow-md border border-slate-200/60">

                            {/* Card color strip */}
                            <div className={`h-1.5 w-full ${order.estado === 'preparando' ? 'bg-blue-400' : 'bg-purple-500'}`} />

                            {/* ── Total (MUY GRANDE) ── */}
                            <div className="px-5 pt-5 pb-3 flex items-center justify-between border-b border-slate-100">
                                <div>
                                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Cobrar en efectivo</p>
                                    <p className="text-5xl font-black text-slate-900 leading-none mt-1">
                                        C${Number(order.total).toFixed(2)}
                                    </p>
                                </div>
                                <span className={`text-xs font-black uppercase tracking-widest px-3 py-1.5 rounded-xl ${
                                    order.estado === 'preparando'
                                        ? 'bg-blue-100 text-blue-700'
                                        : 'bg-purple-100 text-purple-700'
                                }`}>
                                    {order.estado === 'preparando' ? 'En tienda' : 'En camino'}
                                </span>
                            </div>

                            <div className="p-5 space-y-4">

                                {/* ── Cliente ── */}
                                <div>
                                    <p className="font-black text-slate-900 text-xl leading-tight">{order.clienteNombre}</p>

                                    {/* Contacto: Llamar + WA */}
                                    <div className="flex gap-2 mt-3">
                                        <a
                                            href={`tel:${order.clienteTelefono}`}
                                            className="flex-1 flex items-center justify-center gap-2 bg-slate-900 text-white py-3.5 rounded-2xl font-bold text-sm active:scale-95 transition-transform"
                                        >
                                            <Phone size={17} /> {order.clienteTelefono}
                                        </a>
                                        <a
                                            href={waLink(order.clienteTelefono)}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex-1 flex items-center justify-center gap-2 bg-green-500 text-white py-3.5 rounded-2xl font-bold text-sm active:scale-95 transition-transform"
                                        >
                                            <MessageCircle size={17} /> WhatsApp
                                        </a>
                                    </div>
                                </div>

                                {/* ── Dirección ── */}
                                <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200">
                                    <div className="flex items-start gap-2.5">
                                        <MapPin className="text-blue-500 flex-shrink-0 mt-0.5" size={18} />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-slate-800 font-semibold text-sm leading-relaxed">
                                                {order.direccionEntrega}
                                            </p>
                                            {order.referenciaDireccion && (
                                                <p className="text-xs text-slate-500 mt-1 italic">
                                                    Ref: {order.referenciaDireccion}
                                                </p>
                                            )}
                                            {order.notas && (
                                                <div className="mt-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                                                    <p className="text-xs font-semibold text-amber-700">
                                                        ⚠️ Nota: {order.notas}
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* ── Navegación: Waze + Maps ── */}
                                    <div className="flex gap-2 mt-3">
                                        <a
                                            href={wazeUrl(order.direccionEntrega)}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex-1 flex items-center justify-center gap-1.5 bg-[#00CFFF]/10 border border-[#00CFFF]/30 text-[#0099BB] py-2.5 rounded-xl font-bold text-xs active:scale-95 transition-transform hover:bg-[#00CFFF]/20"
                                        >
                                            <Navigation size={14} /> Waze
                                        </a>
                                        <a
                                            href={mapsUrl(order.direccionEntrega)}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex-1 flex items-center justify-center gap-1.5 bg-blue-50 border border-blue-200 text-blue-700 py-2.5 rounded-xl font-bold text-xs active:scale-95 transition-transform hover:bg-blue-100"
                                        >
                                            <MapPin size={14} /> Maps
                                        </a>
                                    </div>
                                </div>

                                {/* ── Artículos ── */}
                                <div>
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                                        Artículos del pedido
                                    </p>
                                    <div className="space-y-1.5">
                                        {order.items.slice(0, 3).map((item, i) => (
                                            <div key={i} className="flex justify-between text-sm text-slate-600">
                                                <span className="truncate pr-3">{item.producto.name}</span>
                                                <span className="font-bold text-slate-800 flex-shrink-0">×{item.cantidad}</span>
                                            </div>
                                        ))}
                                        {order.items.length > 3 && (
                                            <p className="text-xs text-slate-400 italic">
                                                +{order.items.length - 3} artículos más
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* ── Botón de Entrega ── */}
                            <div className="px-5 pb-5">
                                {order.estado === 'preparando' ? (
                                    <button
                                        disabled
                                        className="w-full py-5 rounded-2xl font-black text-base uppercase tracking-wider bg-slate-100 text-slate-400 cursor-not-allowed flex items-center justify-center gap-2"
                                    >
                                        <Clock size={20} /> Esperando en Ferretería
                                    </button>
                                ) : (
                                    <button
                                        onClick={() => handleDeliverTap(order)}
                                        disabled={!!processingId}
                                        className="w-full py-5 rounded-2xl font-black text-lg uppercase tracking-wider bg-emerald-500 text-white shadow-xl shadow-emerald-200 hover:bg-emerald-400 active:scale-[0.97] transition-all disabled:opacity-60 flex items-center justify-center gap-2"
                                        style={{ WebkitTapHighlightColor: 'transparent' }}
                                    >
                                        <CheckCircle size={24} /> Entregar y Cobrar
                                    </button>
                                )}
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* ── FASE 3: Sticky Footer — Liquidación Diaria ─────────── */}
            {liquidacion && (liquidacion.pedidosEntregados > 0 || liquidacion.netoADepositarA_Tienda > 0) && (
                <div className="fixed bottom-0 left-0 right-0 z-40 px-4 pb-4 pt-2 bg-gradient-to-t from-slate-900 via-slate-900/95 to-transparent">
                    <div className="max-w-lg mx-auto bg-slate-800 border border-slate-700 rounded-3xl px-5 py-4 shadow-2xl">
                        <div className="flex items-center justify-between gap-4">
                            {/* Viajes completados */}
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-emerald-500/15 border border-emerald-500/25 rounded-xl flex items-center justify-center flex-shrink-0">
                                    <CheckCircle size={18} className="text-emerald-400" />
                                </div>
                                <div>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none mb-0.5">
                                        Viajes
                                    </p>
                                    <p className="text-2xl font-black text-white leading-none">
                                        {liquidacion.pedidosEntregados}
                                    </p>
                                </div>
                            </div>

                            {/* Divisor */}
                            <div className="w-px h-10 bg-slate-700 flex-shrink-0" />

                            {/* Efectivo a entregar */}
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                                <div className="w-10 h-10 bg-amber-500/15 border border-amber-500/25 rounded-xl flex items-center justify-center flex-shrink-0">
                                    <Wallet size={18} className="text-amber-400" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none mb-0.5">
                                        Entregar a Caja
                                    </p>
                                    <p className="text-2xl font-black text-amber-400 leading-none truncate">
                                        C${Number(liquidacion.netoADepositarA_Tienda).toFixed(2)}
                                    </p>
                                </div>
                            </div>

                            {/* Ganancia del rider */}
                            {liquidacion.comisionesGanadas > 0 && (
                                <>
                                    <div className="w-px h-10 bg-slate-700 flex-shrink-0" />
                                    <div className="text-right flex-shrink-0">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none mb-0.5">
                                            Tu ganancia
                                        </p>
                                        <p className="text-xl font-black text-emerald-400 leading-none">
                                            C${Number(liquidacion.comisionesGanadas).toFixed(2)}
                                        </p>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Confirmation Modal ─────────────────────────────────── */}
            {confirmOrder && (
                <ConfirmDeliveryModal
                    order={confirmOrder}
                    onConfirm={confirmDelivery}
                    onCancel={() => !processingId && setConfirmOrder(null)}
                    isProcessing={processingId === confirmOrder.id}
                />
            )}
        </div>
    );
};

export default DriverView;
