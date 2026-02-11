import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
    ArrowRight, ShieldCheck, Zap, TrendingUp, X, Smartphone,
    BarChart3, Users, Truck, Globe, CreditCard, ScanBarcode,
    MessageCircle, Receipt, Clock, CheckCircle, ChevronRight
} from 'lucide-react';
import GuestPOS from './GuestPOS';
import RegisterTenant from './RegisterTenant';

// ==========================================
// NICHE DATA
// ==========================================

const NICHES = [
    { emoji: '💊', label: 'Farmacias', color: 'from-red-500 to-pink-500' },
    { emoji: '🛠️', label: 'Ferreterías', color: 'from-amber-500 to-orange-500' },
    { emoji: '👗', label: 'Boutiques', color: 'from-purple-500 to-fuchsia-500' },
    { emoji: '🛒', label: 'Mini-Súpers', color: 'from-emerald-500 to-green-500' },
    { emoji: '🚗', label: 'Repuestos', color: 'from-blue-500 to-cyan-500' },
    { emoji: '📱', label: 'Tecnología', color: 'from-indigo-500 to-violet-500' },
    { emoji: '🍕', label: 'Restaurantes', color: 'from-rose-500 to-red-500' },
    { emoji: '🏪', label: 'Pulperías', color: 'from-teal-500 to-emerald-500' },
];

const ECOSYSTEM = [
    {
        icon: ScanBarcode,
        title: 'Punto de Venta (POS)',
        description: 'Vende rapido con lector de barras. Compatible con tickets termicos, facturas A4 y recibos por WhatsApp.',
        color: 'text-blue-400',
        bg: 'bg-blue-500/10',
        border: 'hover:border-blue-500/50'
    },
    {
        icon: CreditCard,
        title: 'Fintech & Credito',
        description: 'Tu flujo de caja es tu garantia. Lineas de credito basadas en tus ventas reales, sin papeleo bancario.',
        color: 'text-emerald-400',
        bg: 'bg-emerald-500/10',
        border: 'hover:border-emerald-500/50'
    },
    {
        icon: Users,
        title: 'Gestion de Personal',
        description: 'Control de turnos con PIN, comisiones automaticas y nomina completa para tu equipo de ventas.',
        color: 'text-purple-400',
        bg: 'bg-purple-500/10',
        border: 'hover:border-purple-500/50'
    },
    {
        icon: Truck,
        title: 'Compras & Proveedores',
        description: 'Registra facturas de compra, actualiza stock automaticamente y controla tus cuentas por pagar.',
        color: 'text-orange-400',
        bg: 'bg-orange-500/10',
        border: 'hover:border-orange-500/50'
    },
    {
        icon: BarChart3,
        title: 'Reportes e Inteligencia',
        description: 'Dashboard en tiempo real con KPIs, utilidad neta, IVA recaudado y exportacion para la DGI.',
        color: 'text-cyan-400',
        bg: 'bg-cyan-500/10',
        border: 'hover:border-cyan-500/50'
    },
    {
        icon: ShieldCheck,
        title: 'Kardex & Auditoria',
        description: 'Cada movimiento de inventario queda registrado. Trazabilidad total de tu mercaderia.',
        color: 'text-amber-400',
        bg: 'bg-amber-500/10',
        border: 'hover:border-amber-500/50'
    },
];

const LATAM_FEATURES = [
    { icon: Receipt, text: 'Facturacion Electronica lista para la DGI' },
    { icon: Globe, text: 'IVA configurable (15%, 18%, etc.) por pais' },
    { icon: MessageCircle, text: 'Recibos por WhatsApp sin papel' },
    { icon: Smartphone, text: 'Funciona en cualquier dispositivo con navegador' },
    { icon: Clock, text: 'Configuracion en menos de 5 minutos' },
    { icon: CheckCircle, text: 'Soporte en espanol por humanos reales' },
];

// ==========================================
// MAIN COMPONENT
// ==========================================

const LandingPage: React.FC = () => {
    const [showRegisterModal, setShowRegisterModal] = useState(false);
    const [guestCart, setGuestCart] = useState<any[]>([]);

    const handleGuestHook = (cart: any[]) => {
        if (cart.length === 0) return;
        setGuestCart(cart);
        setShowRegisterModal(true);
    };

    return (
        <div className="min-h-screen bg-nortex-900 text-white font-sans selection:bg-nortex-accent selection:text-nortex-900 overflow-x-hidden">

            {/* ==========================================
                NAVBAR
               ========================================== */}
            <nav className="container mx-auto px-6 py-6 flex justify-between items-center relative z-20">
                <div className="flex items-center gap-2">
                    <div className="w-9 h-9 bg-nortex-accent rounded-lg flex items-center justify-center shadow-[0_0_20px_rgba(16,185,129,0.3)]">
                        <span className="font-bold text-nortex-900 text-lg">N</span>
                    </div>
                    <span className="text-xl font-mono font-bold tracking-widest">NORTEX</span>
                    <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full font-mono ml-1 hidden sm:inline">RETAIL OS</span>
                </div>
                <div className="hidden md:flex gap-8 text-sm font-medium text-slate-400">
                    <a href="#niches" className="hover:text-white transition-colors">Industrias</a>
                    <a href="#ecosystem" className="hover:text-white transition-colors">Ecosistema</a>
                    <a href="#latam" className="hover:text-white transition-colors">LATAM</a>
                </div>
                <div className="flex gap-3">
                    <Link to="/login" className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white transition-colors">
                        Iniciar Sesion
                    </Link>
                    <Link to="/register" className="px-5 py-2 text-sm font-bold bg-nortex-accent text-nortex-900 rounded-lg hover:bg-emerald-400 transition-all shadow-[0_0_20px_rgba(16,185,129,0.3)]">
                        Empezar Gratis
                    </Link>
                </div>
            </nav>

            {/* ==========================================
                HERO SECTION
               ========================================== */}
            <header className="container mx-auto px-6 py-10 md:py-16 relative">
                {/* Glow */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[900px] bg-nortex-500 rounded-full blur-[180px] opacity-[0.07] pointer-events-none"></div>

                <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-16">
                    {/* Left Content */}
                    <div className="flex-1 text-center lg:text-left z-10">
                        <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-nortex-800 border border-nortex-700 rounded-full text-xs font-mono text-nortex-accent mb-6">
                            <span className="w-2 h-2 bg-nortex-accent rounded-full animate-pulse"></span>
                            SISTEMA EN VIVO - v3.0
                        </div>

                        <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold mb-6 tracking-tight leading-[1.1]">
                            Tu Negocio <br className="hidden sm:block" />
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-nortex-accent via-emerald-400 to-blue-500">
                                es tu Banco.
                            </span>
                        </h1>

                        <p className="text-lg text-slate-400 max-w-xl mx-auto lg:mx-0 mb-8 leading-relaxed">
                            Farmacias, tiendas, repuestos o ferreterias.
                            Convierte tu inventario diario en lineas de credito automaticas
                            y gestiona todo desde un solo lugar.
                        </p>

                        <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
                            <Link to="/register" className="group px-8 py-4 bg-white text-nortex-900 font-bold rounded-xl hover:bg-slate-100 transition-all flex items-center justify-center gap-2 shadow-xl shadow-white/5">
                                Crear Cuenta Gratis
                                <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                            </Link>
                            <a href="#ecosystem" className="px-8 py-4 border border-slate-700 text-slate-300 font-medium rounded-xl hover:border-slate-500 hover:text-white transition-all flex items-center justify-center gap-2">
                                Ver Ecosistema
                                <ChevronRight size={18} />
                            </a>
                        </div>

                        {/* Trust Badges */}
                        <div className="flex items-center gap-6 mt-8 justify-center lg:justify-start text-xs text-slate-500">
                            <span className="flex items-center gap-1.5"><CheckCircle size={14} className="text-nortex-accent" /> Sin tarjeta de credito</span>
                            <span className="flex items-center gap-1.5"><CheckCircle size={14} className="text-nortex-accent" /> Listo en 5 minutos</span>
                            <span className="flex items-center gap-1.5"><CheckCircle size={14} className="text-nortex-accent" /> Soporte humano</span>
                        </div>
                    </div>

                    {/* Right Content: THE GUEST POS */}
                    <div className="flex-1 w-full z-10">
                        <div className="relative">
                            <div className="absolute -inset-3 bg-gradient-to-r from-nortex-accent/30 to-blue-600/30 rounded-2xl blur-xl opacity-40"></div>
                            <div className="relative">
                                <GuestPOS onHook={handleGuestHook} />
                            </div>
                            {/* Badge */}
                            <div className="absolute -top-5 -right-5 bg-gradient-to-r from-yellow-400 to-amber-500 text-nortex-900 font-bold px-4 py-2 rounded-xl shadow-xl transform rotate-6 z-20 hidden md:block text-sm">
                                PRUEBALO AHORA
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            {/* ==========================================
                SECTION: PARA QUIEN ES NORTEX
               ========================================== */}
            <section id="niches" className="py-20 relative">
                <div className="container mx-auto px-6">
                    <div className="text-center mb-12">
                        <p className="text-sm font-mono text-nortex-accent uppercase tracking-widest mb-3">Multi-Industria</p>
                        <h2 className="text-3xl md:text-4xl font-bold mb-4">
                            Potenciando miles de comercios en <span className="text-transparent bg-clip-text bg-gradient-to-r from-nortex-accent to-blue-400">LATAM</span>
                        </h2>
                        <p className="text-slate-400 max-w-2xl mx-auto">
                            No importa que vendas. Si tienes inventario, clientes y proveedores, Nortex es para ti.
                        </p>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                        {NICHES.map((niche, i) => (
                            <div
                                key={i}
                                className="group bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 text-center hover:bg-slate-800 hover:border-slate-600 transition-all cursor-default"
                            >
                                <div className="text-3xl mb-2">{niche.emoji}</div>
                                <p className="text-xs font-semibold text-slate-300 group-hover:text-white transition-colors">{niche.label}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ==========================================
                SECTION: EL ECOSISTEMA
               ========================================== */}
            <section id="ecosystem" className="py-20 bg-slate-950/50 border-y border-slate-800">
                <div className="container mx-auto px-6">
                    <div className="text-center mb-14">
                        <p className="text-sm font-mono text-nortex-accent uppercase tracking-widest mb-3">Ecosistema Completo</p>
                        <h2 className="text-3xl md:text-4xl font-bold mb-4">
                            Todo lo que necesitas. <span className="text-slate-500">Nada que no.</span>
                        </h2>
                        <p className="text-slate-400 max-w-2xl mx-auto">
                            Desde el momento en que abres la caja hasta que cuadras al final del dia.
                            Un solo sistema para toda tu operacion.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                        {ECOSYSTEM.map((item, i) => {
                            const Icon = item.icon;
                            return (
                                <div
                                    key={i}
                                    className={`p-6 rounded-2xl bg-slate-800/30 border border-slate-800 ${item.border} transition-all duration-300 group`}
                                >
                                    <div className={`w-12 h-12 ${item.bg} ${item.color} rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                                        <Icon size={24} />
                                    </div>
                                    <h3 className="text-lg font-bold mb-2 text-white">{item.title}</h3>
                                    <p className="text-sm text-slate-400 leading-relaxed">{item.description}</p>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </section>

            {/* ==========================================
                SECTION: LATAM READY
               ========================================== */}
            <section id="latam" className="py-20">
                <div className="container mx-auto px-6">
                    <div className="max-w-4xl mx-auto">
                        <div className="text-center mb-12">
                            <p className="text-sm font-mono text-nortex-accent uppercase tracking-widest mb-3">Hecho para LATAM</p>
                            <h2 className="text-3xl md:text-4xl font-bold mb-4">
                                Disenado para la realidad de <span className="text-transparent bg-clip-text bg-gradient-to-r from-nortex-accent to-blue-400">nuestros negocios</span>
                            </h2>
                            <p className="text-slate-400 max-w-xl mx-auto">
                                No es un software gringo traducido. Fue construido desde cero pensando en como funciona un comercio en Centroamerica y Latinoamerica.
                            </p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {LATAM_FEATURES.map((feat, i) => {
                                const Icon = feat.icon;
                                return (
                                    <div key={i} className="flex items-center gap-4 bg-slate-800/40 border border-slate-700/50 rounded-xl px-5 py-4 hover:bg-slate-800/60 transition-colors">
                                        <div className="w-10 h-10 bg-nortex-accent/10 rounded-lg flex items-center justify-center shrink-0">
                                            <Icon size={20} className="text-nortex-accent" />
                                        </div>
                                        <p className="text-sm text-slate-300 font-medium">{feat.text}</p>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </section>

            {/* ==========================================
                CTA SECTION
               ========================================== */}
            <section className="py-20 border-t border-slate-800">
                <div className="container mx-auto px-6 text-center">
                    <div className="max-w-2xl mx-auto">
                        <h2 className="text-3xl md:text-4xl font-bold mb-4">
                            Tu competencia ya lo esta usando.
                        </h2>
                        <p className="text-slate-400 mb-8 text-lg">
                            Empieza gratis hoy. Sin tarjeta. Sin contratos. Sin excusas.
                        </p>
                        <Link to="/register" className="group inline-flex items-center gap-2 px-10 py-4 bg-nortex-accent text-nortex-900 font-bold rounded-xl text-lg hover:bg-emerald-400 transition-all shadow-[0_0_40px_rgba(16,185,129,0.3)]">
                            Crear Mi Cuenta Gratis
                            <ArrowRight size={22} className="group-hover:translate-x-1 transition-transform" />
                        </Link>
                        <p className="text-xs text-slate-600 mt-4">Configuracion en menos de 5 minutos. Soporte incluido.</p>
                    </div>
                </div>
            </section>

            {/* ==========================================
                FOOTER
               ========================================== */}
            <footer className="py-10 border-t border-slate-800">
                <div className="container mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                        <div className="w-7 h-7 bg-nortex-accent rounded flex items-center justify-center">
                            <span className="font-bold text-nortex-900 text-sm">N</span>
                        </div>
                        <span className="text-sm font-mono font-bold tracking-widest text-slate-500">NORTEX</span>
                    </div>
                    <p className="text-slate-600 text-sm">&copy; 2026 Nortex Inc. El Sistema Operativo del Comercio en LATAM.</p>
                    <div className="flex gap-6 text-sm text-slate-500">
                        <Link to="/login" className="hover:text-white transition-colors">Iniciar Sesion</Link>
                        <Link to="/register" className="hover:text-white transition-colors">Registrarse</Link>
                    </div>
                </div>
            </footer>

            {/* ==========================================
                REGISTRATION MODAL (HOOK FROM GUEST POS)
               ========================================== */}
            {showRegisterModal && (
                <div className="fixed inset-0 z-50 bg-nortex-900/90 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="relative w-full max-w-md">
                        <button
                            onClick={() => setShowRegisterModal(false)}
                            className="absolute -top-12 right-0 text-slate-400 hover:text-white transition-colors"
                        >
                            <X size={32} />
                        </button>
                        <div className="bg-gradient-to-b from-nortex-800 to-nortex-900 rounded-2xl shadow-2xl border border-nortex-700 overflow-hidden">
                            <RegisterTenant isModal={true} initialCart={guestCart} />
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
};

export default LandingPage;
