import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
    ArrowRight, CheckCircle, Users, Calculator, ScanBarcode,
    Building2, XCircle, Zap, Building, Clock, Shield, TrendingUp,
    Package, BarChart3, FileText, Smartphone
} from 'lucide-react';

// Dynamic niche content for SEO long-tail pages
type NicheContent = {
    badge: string;
    headline: string;
    focusWord: string;
    subtitle: string;
    gradient: string;
};

const NICHES: Record<string, NicheContent> = {
    ferreterias: {
        badge: '🔩 Para Ferreterías',
        headline: 'El Sistema Exacto para tu',
        focusWord: 'Ferretería.',
        subtitle: 'Controla miles de códigos, vende al contado y crédito, y genera reportes DGI. De Managua a Estelí.',
        gradient: 'from-orange-500 via-red-500 to-pink-500',
    },
    farmacias: {
        badge: '💊 Para Farmacias',
        headline: 'Control de Lotes y Vencimientos para',
        focusWord: 'Farmacias.',
        subtitle: 'El único POS que alerta vencimientos, controla lotes y automatiza tu facturación DGI.',
        gradient: 'from-emerald-400 via-teal-500 to-cyan-500',
    },
    'contabilidad-dgi': {
        badge: '📊 Contabilidad DGI',
        headline: 'Retenciones 2% y 1% en Piloto Automático.',
        focusWord: 'Facturación DGI.',
        subtitle: 'Deja de calcular impuestos a mano. Nortex deduce IVA, IR e IMI automáticamente.',
        gradient: 'from-blue-500 via-indigo-500 to-violet-500',
    },
    default: {
        badge: '🇳🇮 Hecho en Nicaragua',
        headline: 'No uses Excel. No uses libretas. Usa el sistema de los negocios que',
        focusWord: 'sí están creciendo.',
        subtitle: 'Nortex es el Punto de Venta, Control de Inventario y Cierre Fiscal (DGI) más fácil de Nicaragua.',
        gradient: 'from-blue-500 via-cyan-400 to-emerald-400',
    },
};

const LandingPage: React.FC = () => {
    const { niche } = useParams<{ niche: string }>();
    const [scrolled, setScrolled] = useState(false);

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 30);
        window.addEventListener('scroll', onScroll);
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    const c = NICHES[niche?.toLowerCase() || ''] || NICHES.default;

    return (
        <div className="min-h-screen bg-[#070B14] text-white font-sans selection:bg-blue-500/30 overflow-x-hidden">

            {/* === NAVBAR === */}
            <nav className={`fixed top-0 w-full z-50 transition-all duration-500 ${scrolled ? 'bg-[#070B14]/80 backdrop-blur-xl border-b border-white/5 py-3' : 'py-5'}`}>
                <div className="max-w-7xl mx-auto px-6 flex justify-between items-center">
                    <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-emerald-400 flex items-center justify-center shadow-lg shadow-blue-500/20">
                            <span className="font-black text-white text-lg">N</span>
                        </div>
                        <span className="text-xl font-black tracking-tight">NORTEX</span>
                    </div>
                    <div className="hidden md:flex items-center gap-8 text-sm text-slate-400 font-semibold">
                        <a href="#dolor" className="hover:text-white transition-colors">El Problema</a>
                        <a href="#boost" className="hover:text-amber-400 transition-colors flex items-center gap-1"><Zap size={13} /> Capital</a>
                        <a href="#precio" className="hover:text-white transition-colors">Precios</a>
                    </div>
                    <div className="flex items-center gap-3">
                        <Link to="/login" className="hidden sm:block text-sm font-semibold text-slate-400 hover:text-white transition-colors px-4 py-2">
                            Ingresar
                        </Link>
                        <Link to="/register" className="text-sm font-bold bg-white text-slate-900 px-5 py-2.5 rounded-full hover:bg-slate-100 transition-all active:scale-95 shadow-lg shadow-white/10">
                            Crear Cuenta Gratis
                        </Link>
                    </div>
                </div>
            </nav>

            {/* === HERO === */}
            <section className="relative pt-32 pb-24 overflow-hidden">
                {/* Ambient glow */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[600px] bg-gradient-to-b from-blue-600/15 via-transparent to-transparent rounded-full blur-3xl pointer-events-none" />
                <div className="absolute top-20 right-0 w-[400px] h-[400px] bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

                <div className="relative max-w-5xl mx-auto px-6 text-center">
                    {/* Badge */}
                    <div className="inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-4 py-1.5 text-sm font-semibold text-slate-300 mb-8 backdrop-blur-sm">
                        {c.badge}
                    </div>

                    {/* H1 */}
                    <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-black tracking-tight leading-[1.1] mb-6">
                        {c.headline}{' '}
                        <span className={`text-transparent bg-clip-text bg-gradient-to-r ${c.gradient}`}>
                            {c.focusWord}
                        </span>
                    </h1>

                    {/* Subtitle */}
                    <p className="text-lg md:text-xl text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed font-medium">
                        {c.subtitle}
                    </p>

                    {/* CTA */}
                    <div className="flex flex-col sm:flex-row gap-4 justify-center mb-6">
                        <Link
                            to="/register"
                            className={`group inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full font-bold text-lg bg-gradient-to-r ${c.gradient} text-white shadow-2xl shadow-blue-500/25 hover:shadow-blue-500/40 hover:-translate-y-0.5 transition-all active:scale-95`}
                        >
                            Empieza Gratis en 2 Minutos
                            <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                        </Link>
                    </div>
                    <p className="text-slate-500 text-sm font-medium flex items-center justify-center gap-2">
                        <CheckCircle size={14} className="text-emerald-500" />
                        Sin tarjeta de crédito · Configuración en 3 clics
                    </p>

                    {/* Social Proof */}
                    <div className="mt-14 flex flex-col sm:flex-row items-center justify-center gap-4">
                        <div className="flex -space-x-2">
                            {['bg-blue-500', 'bg-emerald-500', 'bg-violet-500', 'bg-amber-500'].map((bg, i) => (
                                <div key={i} className={`w-9 h-9 rounded-full ${bg} border-2 border-[#070B14] flex items-center justify-center text-xs font-bold text-white`}>
                                    {i === 3 ? '+' : ''}
                                </div>
                            ))}
                        </div>
                        <div className="text-left">
                            <p className="text-sm font-bold text-white">+150 negocios creciendo con Nortex</p>
                            <p className="text-xs text-slate-500">Procesando más de C$10M mensuales</p>
                        </div>
                    </div>
                </div>
            </section>

            {/* === TRUSTED-BY BAR === */}
            <section className="border-y border-white/5 py-8">
                <div className="max-w-5xl mx-auto px-6 flex flex-wrap items-center justify-center gap-8 md:gap-16 text-slate-500">
                    {[
                        { icon: <Shield size={18} />, text: 'Cifrado AES-256' },
                        { icon: <TrendingUp size={18} />, text: '99.9% Uptime' },
                        { icon: <Smartphone size={18} />, text: 'Funciona en Cualquier Dispositivo' },
                        { icon: <FileText size={18} />, text: 'Cumple con DGI Nicaragua' },
                    ].map((item, i) => (
                        <div key={i} className="flex items-center gap-2 text-sm font-semibold">
                            <span className="text-emerald-500">{item.icon}</span>
                            {item.text}
                        </div>
                    ))}
                </div>
            </section>

            {/* === DOLOR VS SOLUCIÓN === */}
            <section id="dolor" className="py-24">
                <div className="max-w-6xl mx-auto px-6">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl md:text-5xl font-black tracking-tight mb-4">
                            Sobrevivir vs. <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-400">Crecer de Verdad</span>
                        </h2>
                        <p className="text-slate-400 text-lg max-w-xl mx-auto font-medium">
                            Tu negocio merece tecnología que trabaje para ti.
                        </p>
                    </div>

                    <div className="grid md:grid-cols-2 gap-6">
                        {/* PAIN */}
                        <div className="bg-red-500/5 border border-red-500/10 rounded-2xl p-8">
                            <div className="inline-flex items-center gap-2 bg-red-500/10 text-red-400 text-xs font-bold uppercase tracking-wider rounded-lg px-3 py-1.5 mb-6">
                                <XCircle size={14} /> La Pesadilla Tradicional
                            </div>
                            <ul className="space-y-5">
                                {[
                                    'Cuadres de caja que nunca dan, faltando C$200 diario.',
                                    'Pánico de fin de mes calculando IVA y Retenciones a mano.',
                                    'Robos hormiga de inventario imposibles de detectar.',
                                    'Horas perdidas calculando INSS y liquidaciones Ley 185.',
                                ].map((t, i) => (
                                    <li key={i} className="flex gap-3 text-slate-300 font-medium">
                                        <XCircle className="text-red-500/70 flex-shrink-0 mt-0.5" size={18} />
                                        <span>{t}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {/* SOLUTION */}
                        <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-2xl p-8 shadow-2xl shadow-emerald-500/5">
                            <div className="inline-flex items-center gap-2 bg-emerald-500/10 text-emerald-400 text-xs font-bold uppercase tracking-wider rounded-lg px-3 py-1.5 mb-6">
                                <CheckCircle size={14} /> El Paraíso Nortex
                            </div>
                            <ul className="space-y-5">
                                {[
                                    'Cierres de turno ciegos, automatizados en segundos.',
                                    'Reportes DGI y Retenciones listos a un clic.',
                                    'Auditoría forense de Kardex detectando ajustes sospechosos.',
                                    'Nómina y Aguinaldo calculados en piloto automático.',
                                ].map((t, i) => (
                                    <li key={i} className="flex gap-3 text-white font-medium">
                                        <CheckCircle className="text-emerald-400 flex-shrink-0 mt-0.5" size={18} />
                                        <span>{t}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>
            </section>

            {/* === FEATURES GRID === */}
            <section className="py-24 border-y border-white/5">
                <div className="max-w-6xl mx-auto px-6">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl md:text-4xl font-black tracking-tight mb-4">Un Solo Sistema. Todo el Control.</h2>
                        <p className="text-slate-400 text-lg font-medium max-w-lg mx-auto">Sustituye 5 apps desconectadas por un motor central.</p>
                    </div>
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
                        {[
                            { icon: <ScanBarcode size={24} />, title: 'Punto de Venta', desc: 'Vende en segundos. Código de barras, descuentos, crédito.', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/10' },
                            { icon: <Package size={24} />, title: 'Inventario & Kardex', desc: 'Stock exacto, alertas de agotamiento, auditoría forense.', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/10' },
                            { icon: <Users size={24} />, title: 'RRHH & NicaLabor', desc: 'Nómina Ley 185, aguinaldos, liquidaciones automáticas.', color: 'text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/10' },
                            { icon: <Calculator size={24} />, title: 'DGI Automático', desc: 'Retenciones IR 2%, IMI 1%, IVA deducido por factura.', color: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/10' },
                            { icon: <BarChart3 size={24} />, title: 'Salud Financiera', desc: 'Balance General, P&L, Nortex Score de tu negocio.', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/10' },
                            { icon: <Building2 size={24} />, title: 'Mercado B2B', desc: 'Conecta con proveedores mayoristas directamente.', color: 'text-pink-400', bg: 'bg-pink-500/10', border: 'border-pink-500/10' },
                        ].map((f, i) => (
                            <div key={i} className={`group ${bg(f.bg)} border ${f.border} rounded-2xl p-6 hover:border-white/10 hover:bg-white/[0.03] transition-all duration-300`}>
                                <div className={`w-12 h-12 rounded-xl ${f.bg} ${f.color} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                                    {f.icon}
                                </div>
                                <h3 className="text-white font-bold text-lg mb-2">{f.title}</h3>
                                <p className="text-slate-400 text-sm font-medium leading-relaxed">{f.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* === NORTEX BOOST (EMBEDDED FINANCE) === */}
            <section id="boost" className="py-24 relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-b from-amber-500/5 via-transparent to-transparent pointer-events-none" />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-amber-500/10 rounded-full blur-[120px] pointer-events-none" />

                <div className="relative max-w-4xl mx-auto px-6 text-center">
                    <div className="inline-flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm font-bold rounded-full px-4 py-1.5 mb-8">
                        <Zap size={15} className="fill-amber-400" /> NORTEX BOOST
                    </div>

                    <h2 className="text-3xl md:text-5xl font-black tracking-tight mb-6">
                        Tu data de ventas vale oro. <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-orange-400">Literalmente.</span>
                    </h2>

                    <p className="text-lg text-slate-300 max-w-2xl mx-auto mb-12 font-medium leading-relaxed">
                        ¿Necesitas llenar tus tramos para diciembre? El sistema analiza tus ventas y te ofrece
                        <strong className="text-white"> adelantos de capital al instante.</strong>{' '}
                        Sin bancos, sin fiadores, sin papeleos.
                    </p>

                    <div className="grid sm:grid-cols-3 gap-4 mb-12">
                        {[
                            { icon: <Building size={22} />, title: 'Sin Bancos', desc: 'No pedimos estados financieros sellados.' },
                            { icon: <Users size={22} />, title: 'Sin Fiadores', desc: 'Tus ventas en Nortex son tu garantía.' },
                            { icon: <Clock size={22} />, title: 'Al Instante', desc: 'Crédito pre-aprobado en 24 horas.' },
                        ].map((f, i) => (
                            <div key={i} className="bg-white/[0.03] border border-white/5 rounded-2xl p-6 text-left">
                                <div className="w-10 h-10 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center mb-3">
                                    {f.icon}
                                </div>
                                <h4 className="text-white font-bold mb-1">{f.title}</h4>
                                <p className="text-slate-400 text-sm font-medium">{f.desc}</p>
                            </div>
                        ))}
                    </div>

                    <div className="bg-white/[0.03] backdrop-blur border border-amber-500/20 rounded-2xl p-8 inline-block">
                        <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-2">Línea de Crédito Hasta</p>
                        <p className="text-5xl md:text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-orange-400">
                            C$ 150,000
                        </p>
                        <p className="text-slate-500 text-xs mt-2">*Solo para negocios con Nortex Pro activo 3+ meses.</p>
                    </div>
                </div>
            </section>

            {/* === PRICING === */}
            <section id="precio" className="py-24 border-t border-white/5">
                <div className="max-w-5xl mx-auto px-6">
                    <div className="text-center mb-14">
                        <h2 className="text-3xl md:text-4xl font-black tracking-tight mb-3">Precios Honestos.</h2>
                        <p className="text-slate-400 text-lg font-medium">Diseñado para que crezcas, no para exprimirte.</p>
                    </div>

                    <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
                        {/* Free */}
                        <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-8 flex flex-col">
                            <h3 className="text-xl font-black mb-1">Comienza Hoy</h3>
                            <p className="text-slate-500 text-sm font-medium mb-6">Probá el sistema en tu tienda real.</p>
                            <div className="flex items-end gap-1 mb-8">
                                <span className="text-5xl font-black">$0</span>
                                <span className="text-slate-500 font-bold mb-1.5">/prueba</span>
                            </div>
                            <ul className="space-y-3 mb-8 flex-1">
                                {['POS Web completo', 'Inventario básico', 'Hasta 50 productos', '14 días gratis'].map((t, i) => (
                                    <li key={i} className="flex items-center gap-2 text-sm text-slate-300 font-medium">
                                        <CheckCircle size={16} className="text-slate-500" /> {t}
                                    </li>
                                ))}
                            </ul>
                            <Link to="/register" className="w-full py-3 text-center bg-white/5 border border-white/10 text-white font-bold rounded-xl hover:bg-white/10 transition-colors">
                                Instalar Gratis
                            </Link>
                        </div>

                        {/* Pro */}
                        <div className="relative bg-gradient-to-b from-blue-500/10 to-transparent border border-blue-500/20 rounded-2xl p-8 flex flex-col shadow-2xl shadow-blue-500/10">
                            <div className="absolute top-0 right-6 -translate-y-1/2 bg-gradient-to-r from-blue-500 to-cyan-400 text-white text-[11px] font-bold uppercase tracking-wider px-3 py-1 rounded-full">
                                Popular
                            </div>
                            <h3 className="text-xl font-black mb-1">Nortex Pro</h3>
                            <p className="text-slate-400 text-sm font-medium mb-6">Todo el arsenal. Sin límites.</p>
                            <div className="flex items-end gap-1 mb-8">
                                <span className="text-5xl font-black">$25</span>
                                <span className="text-slate-500 font-bold mb-1.5">/mes</span>
                            </div>
                            <ul className="space-y-3 mb-8 flex-1">
                                {['Usuarios y productos ilimitados', 'Auditoría Forense + Salud Financiera', 'NicaLabor (Nómina y Aguinaldo)', 'Retenciones DGI automáticas', 'Elegible para Nortex Boost'].map((t, i) => (
                                    <li key={i} className="flex items-center gap-2 text-sm text-white font-medium">
                                        <CheckCircle size={16} className="text-blue-400" /> {t}
                                    </li>
                                ))}
                            </ul>
                            <Link to="/register" className="w-full py-3 text-center bg-gradient-to-r from-blue-500 to-cyan-500 text-white font-bold rounded-xl hover:from-blue-600 hover:to-cyan-600 transition-all shadow-lg shadow-blue-500/25">
                                Crear Cuenta Pro
                            </Link>
                        </div>
                    </div>
                </div>
            </section>

            {/* === FOOTER === */}
            <footer className="border-t border-white/5 py-10">
                <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-4">
                    <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-md bg-gradient-to-br from-blue-500 to-emerald-400 flex items-center justify-center">
                            <span className="font-black text-white text-sm">N</span>
                        </div>
                        <span className="font-black text-sm">NORTEX</span>
                    </div>
                    <p className="text-slate-600 text-xs font-medium">© {new Date().getFullYear()} Nortex Technology · Managua, Nicaragua</p>
                    <div className="flex gap-5 text-xs font-semibold text-slate-500">
                        <Link to="/login" className="hover:text-white transition-colors">Login</Link>
                        <Link to="/terms" className="hover:text-white transition-colors">Términos</Link>
                        <Link to="/privacy" className="hover:text-white transition-colors">Privacidad</Link>
                    </div>
                </div>
            </footer>
        </div>
    );
};

// Helper to pass bg class (Tailwind needs full class names for purging)
const bg = (cls: string) => cls;

export default LandingPage;
