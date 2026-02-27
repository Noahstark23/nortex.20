import React from 'react';
import { Link } from 'react-router-dom';
import {
    ArrowRight, ShieldCheck, Lock, Cloud, Server,
    CheckCircle, BarChart3, Users, Calculator, ScanBarcode, ChevronRight,
    Building2, FileText, Smartphone, Globe, AlertCircle, Building, HeadphonesIcon
} from 'lucide-react';

const LandingPage: React.FC = () => {
    return (
        <div className="min-h-screen bg-slate-50 text-slate-800 font-sans selection:bg-blue-600 selection:text-white overflow-x-hidden">

            {/* ==========================================
                NAVBAR CORPORATIVA
               ========================================== */}
            <nav className="container mx-auto px-6 py-5 flex justify-between items-center bg-transparent relative z-50">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-900 rounded-xl flex items-center justify-center shadow-lg shadow-blue-900/20">
                        <span className="font-bold text-white text-xl">N</span>
                    </div>
                    <div>
                        <span className="text-2xl font-bold tracking-tight text-blue-950 block leading-none">NORTEX</span>
                    </div>
                </div>
                <div className="hidden md:flex gap-10 text-sm font-bold text-slate-500">
                    <a href="#features" className="hover:text-blue-700 transition-colors">Infraestructura</a>
                    <a href="#pricing" className="hover:text-blue-700 transition-colors">Precios</a>
                    <a href="#security" className="hover:text-blue-700 transition-colors">Seguridad</a>
                </div>
                <div className="flex gap-4">
                    <Link to="/login" className="px-5 py-2.5 text-sm font-bold text-slate-600 hover:text-blue-800 transition-colors">
                        Portal de Clientes
                    </Link>
                    <Link to="/register" className="px-6 py-2.5 text-sm font-bold bg-blue-700 text-white rounded-xl hover:bg-blue-800 transition-all shadow-lg shadow-blue-700/30 active:scale-95">
                        Crear Cuenta
                    </Link>
                </div>
            </nav>

            {/* ==========================================
                HERO SECTION (DICTADOR/FINTECH)
               ========================================== */}
            <header className="container mx-auto px-6 pt-20 pb-20 relative text-center">
                {/* Iluminación de fondo */}
                <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-blue-500 rounded-full blur-[180px] opacity-[0.07] pointer-events-none"></div>
                <div className="absolute top-1/2 right-0 -translate-y-1/2 w-[600px] h-[600px] bg-emerald-500 rounded-full blur-[180px] opacity-[0.05] pointer-events-none"></div>

                <h1 className="text-5xl md:text-7xl lg:text-[5.5rem] font-black text-blue-950 mb-8 tracking-tighter leading-[1.05] max-w-5xl mx-auto">
                    El Sistema Operativo Financiero para <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-700 to-emerald-600">tu Empresa.</span>
                </h1>

                <p className="text-xl md:text-2xl text-slate-500 max-w-4xl mx-auto mb-12 leading-relaxed font-medium">
                    Mucho más que un POS. Controla tu inventario, automatiza tu nómina (NicaLabor) y asegura tu liquidez en una sola plataforma blindada.
                </p>

                <div className="flex flex-col sm:flex-row gap-5 justify-center z-20 relative mb-24">
                    <Link to="/register" className="group px-10 py-5 bg-blue-700 text-white font-bold rounded-2xl hover:bg-blue-800 transition-all flex items-center justify-center gap-3 shadow-2xl shadow-blue-700/30 text-lg hover:-translate-y-1">
                        EMPEZAR A VENDER HOY
                        <ArrowRight size={24} className="group-hover:translate-x-1 transition-transform" />
                    </Link>
                    <a href="#demo" className="px-10 py-5 bg-white border-2 border-slate-200 text-slate-700 font-bold rounded-2xl hover:border-slate-300 hover:text-blue-900 transition-all flex items-center justify-center gap-3 text-lg shadow-sm hover:-translate-y-1">
                        Ver Demo Técnica <ChevronRight size={22} className="text-slate-400" />
                    </a>
                </div>

                {/* ==========================================
                    MOCKUP VISUAL (DASHBOARD FINANCIERO)
                   ========================================== */}
                <div className="relative max-w-6xl mx-auto z-20 perspective-1000">
                    <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 to-emerald-500 rounded-[2.5rem] blur-xl opacity-20 translate-y-4"></div>
                    <div className="relative bg-white rounded-[2rem] border border-slate-200 shadow-2xl overflow-hidden flex flex-col transform hover:-translate-y-2 transition-transform duration-500">

                        {/* Mockup TOPBAR */}
                        <div className="h-14 bg-slate-50 border-b border-slate-200 flex items-center px-6 gap-3">
                            <div className="flex gap-2">
                                <div className="w-3.5 h-3.5 rounded-full bg-slate-200"></div>
                                <div className="w-3.5 h-3.5 rounded-full bg-slate-200"></div>
                                <div className="w-3.5 h-3.5 rounded-full bg-slate-200"></div>
                            </div>
                            <div className="w-full flex justify-center">
                                <div className="h-6 w-64 bg-slate-100 rounded-md border border-slate-200 flex items-center justify-center">
                                    <Lock size={12} className="text-slate-400 mr-2" />
                                    <div className="h-2 w-32 bg-slate-200 rounded"></div>
                                </div>
                            </div>
                        </div>

                        {/* Mockup DATA */}
                        <div className="flex-1 p-8 grid grid-cols-1 md:grid-cols-4 gap-8 bg-slate-50/50">

                            {/* SIDEBAR */}
                            <div className="col-span-1 border-r border-slate-200 pr-8 hidden md:flex flex-col gap-6">
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="w-8 h-8 bg-blue-900 rounded-lg"></div>
                                    <div className="h-4 bg-slate-200 rounded w-24"></div>
                                </div>
                                <div className="space-y-4">
                                    <div className="h-10 bg-blue-50 border border-blue-100 rounded-xl w-full flex items-center px-4">
                                        <div className="h-2 w-16 bg-blue-300 rounded"></div>
                                    </div>
                                    <div className="h-10 bg-transparent rounded-xl w-full flex items-center px-4">
                                        <div className="h-2 w-20 bg-slate-200 rounded"></div>
                                    </div>
                                    <div className="h-10 bg-transparent rounded-xl w-full flex items-center px-4">
                                        <div className="h-2 w-12 bg-slate-200 rounded"></div>
                                    </div>
                                </div>
                            </div>

                            {/* MAIN CONTENT */}
                            <div className="col-span-4 md:col-span-3 flex flex-col gap-8">
                                <div className="flex justify-between items-end">
                                    <div>
                                        <div className="h-4 bg-slate-200 rounded w-32 mb-2"></div>
                                        <div className="h-10 bg-slate-300 rounded-lg w-64"></div>
                                    </div>
                                    <div className="h-12 bg-blue-600 rounded-xl w-40 shadow-lg shadow-blue-600/20"></div>
                                </div>
                                <div className="grid grid-cols-3 gap-6">
                                    <div className="h-32 bg-white border border-slate-200 rounded-2xl shadow-sm p-5 flex flex-col justify-between relative overflow-hidden">
                                        <div className="h-4 bg-slate-100 rounded w-20"></div>
                                        <div className="h-10 bg-emerald-100 rounded w-32"></div>
                                        <div className="absolute right-0 bottom-0 w-24 h-24 bg-emerald-50 rounded-tl-full -z-10"></div>
                                    </div>
                                    <div className="h-32 bg-white border border-slate-200 rounded-2xl shadow-sm p-5 flex flex-col justify-between relative overflow-hidden">
                                        <div className="h-4 bg-slate-100 rounded w-20"></div>
                                        <div className="h-10 bg-blue-100 rounded w-40"></div>
                                        <div className="absolute right-0 bottom-0 w-24 h-24 bg-blue-50 rounded-tl-full -z-10"></div>
                                    </div>
                                    <div className="h-32 bg-white border border-slate-200 rounded-2xl shadow-sm p-5 flex flex-col justify-between relative overflow-hidden">
                                        <div className="h-4 bg-slate-100 rounded w-24"></div>
                                        <div className="h-10 bg-amber-100 rounded w-24"></div>
                                        <div className="absolute right-0 bottom-0 w-24 h-24 bg-amber-50 rounded-tl-full -z-10"></div>
                                    </div>
                                </div>
                                <div className="h-64 bg-white border border-slate-200 rounded-2xl shadow-sm w-full p-6">
                                    {/* Table Mockup */}
                                    <div className="h-8 bg-slate-50 border-b border-slate-100 mb-4 flex items-center justify-between px-4">
                                        <div className="h-2 w-16 bg-slate-200 rounded"></div>
                                        <div className="h-2 w-24 bg-slate-200 rounded"></div>
                                        <div className="h-2 w-12 bg-slate-200 rounded"></div>
                                    </div>
                                    <div className="space-y-4 px-4">
                                        {[1, 2, 3, 4].map(i => (
                                            <div key={i} className="flex justify-between items-center">
                                                <div className="h-3 w-32 bg-slate-100 rounded"></div>
                                                <div className="h-3 w-40 bg-slate-100 rounded"></div>
                                                <div className="h-3 w-16 bg-slate-200 rounded"></div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            {/* ==========================================
                TRUST BAR (SEGURIDAD BANCARIA)
               ========================================== */}
            <section id="security" className="py-10 bg-blue-950 border-y border-blue-900 shadow-inner">
                <div className="container mx-auto px-6">
                    <div className="flex flex-col md:flex-row items-center justify-center gap-10 md:gap-20 text-slate-300 text-sm md:text-base font-bold tracking-wide">
                        <div className="flex items-center gap-3">
                            <Lock className="text-emerald-400 w-6 h-6" />
                            <span>Cifrado de Grado Militar (AES-256)</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <Cloud className="text-emerald-400 w-6 h-6" />
                            <span>Backups Automáticos Diarios</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <Server className="text-emerald-400 w-6 h-6" />
                            <span>Infraestructura Cloud Segura</span>
                        </div>
                    </div>
                </div>
            </section>

            {/* ==========================================
                CORE FEATURES (LA TRAMPA DE DATA)
               ========================================== */}
            <section id="features" className="py-32 bg-white relative">
                <div className="container mx-auto px-6">
                    <div className="text-center mb-20">
                        <h2 className="text-4xl md:text-5xl font-extrabold text-blue-950 mb-6 tracking-tight">Arquitectura de Clase Mundial</h2>
                        <p className="text-xl text-slate-500 max-w-3xl mx-auto font-medium leading-relaxed">
                            Construímos las fundaciones perfectas. Sustituye 5 aplicaciones desconectadas por un solo motor central que gobierna sobre tu efectivo, tu inventario y tu personal.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-7xl mx-auto">

                        {/* FEATURE 1: POS */}
                        <div className="group bg-slate-50 border border-slate-200 rounded-[2rem] p-10 hover:shadow-2xl hover:shadow-blue-900/10 transition-all duration-300 hover:-translate-y-2">
                            <div className="w-20 h-20 bg-white border border-slate-100 text-blue-600 rounded-2xl flex items-center justify-center mb-8 shadow-sm group-hover:scale-110 transition-transform duration-300">
                                <ScanBarcode size={40} />
                            </div>
                            <h3 className="text-2xl font-bold text-blue-950 mb-4">Punto de Venta (POS) Fricción Cero</h3>
                            <p className="text-slate-600 text-lg leading-relaxed font-medium">
                                Vende en segundos. Compatible con lectores de código de barras y modo offline. La caja nunca se detiene.
                            </p>
                        </div>

                        {/* FEATURE 2: INVENTARIO */}
                        <div className="group bg-slate-50 border border-slate-200 rounded-[2rem] p-10 hover:shadow-2xl hover:shadow-emerald-900/10 transition-all duration-300 hover:-translate-y-2">
                            <div className="w-20 h-20 bg-white border border-slate-100 text-emerald-600 rounded-2xl flex items-center justify-center mb-8 shadow-sm group-hover:scale-110 transition-transform duration-300">
                                <BarChart3 size={40} />
                            </div>
                            <h3 className="text-2xl font-bold text-blue-950 mb-4">Inventario y Compras</h3>
                            <p className="text-slate-600 text-lg leading-relaxed font-medium">
                                Control exacto y milimétrico. Alertas de stock bajo y costeos automáticos para proteger tus márgenes de ganancia.
                            </p>
                        </div>

                        {/* FEATURE 3: NICALABOR */}
                        <div className="group bg-blue-950 border border-blue-900 text-white rounded-[2rem] p-10 shadow-2xl shadow-blue-900/20 hover:shadow-blue-900/40 transition-all duration-300 hover:-translate-y-2 relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-48 h-48 bg-emerald-500 rounded-bl-full blur-3xl opacity-20"></div>
                            <div className="w-20 h-20 bg-blue-900 border border-blue-800 text-emerald-400 rounded-2xl flex items-center justify-center mb-8 group-hover:scale-110 transition-transform duration-300">
                                <Users size={40} />
                            </div>
                            <h3 className="text-2xl font-bold text-white mb-4">Recursos Humanos & NicaLabor</h3>
                            <p className="text-blue-100 text-lg leading-relaxed font-medium">
                                El ÚNICO sistema que calcula tus planillas, aguinaldos y liquidaciones automáticas según la ley. Adiós a los Excel, adiós a las multas de Mitrab.
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            {/* ==========================================
                PRICING (UN SOLO PLAN DICTATORIAL)
               ========================================== */}
            <section id="pricing" className="py-32 bg-slate-50 border-t border-slate-200">
                <div className="container mx-auto px-6 flex flex-col items-center">

                    <div className="text-center mb-16">
                        <h2 className="text-4xl md:text-5xl font-extrabold text-blue-950 mb-6 tracking-tight">Cero Complejidad.</h2>
                        <p className="text-xl text-slate-500 max-w-2xl mx-auto font-medium">Olvídate de módulos bloqueados y planes falsos. Te damos el arsenal completo corporativo por una tarifa plana.</p>
                    </div>

                    <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-[3rem] p-12 md:p-16 shadow-2xl shadow-slate-200/50 relative overflow-hidden">
                        {/* Glows Decorativos */}
                        <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500 rounded-full blur-[100px] opacity-10 -translate-y-1/2 translate-x-1/3 pointer-events-none"></div>
                        <div className="absolute bottom-0 left-0 w-64 h-64 bg-blue-500 rounded-full blur-[100px] opacity-10 translate-y-1/2 -translate-x-1/3 pointer-events-none"></div>

                        <div className="relative z-10 text-center mb-10 border-b border-slate-100 pb-10">
                            <h3 className="text-xl font-bold text-blue-600 mb-4 uppercase tracking-widest">Plan Empresarial Total</h3>
                            <div className="flex justify-center items-end gap-1 mb-2">
                                <span className="text-7xl font-black text-blue-950 tracking-tighter">$25</span>
                                <span className="text-2xl font-bold text-slate-400 mb-2">/mes</span>
                            </div>
                            <p className="text-slate-500 font-medium">Todo incluido. Facturado mensualmente. Sin contratos ocultos.</p>
                        </div>

                        <ul className="relative z-10 space-y-6 mb-12 max-w-md mx-auto">
                            {[
                                "Usuarios ilimitados (Gerentes, Cajeros, Bodega)",
                                "Ingreso de Productos ilimitados",
                                "Soporte Técnico Local (Nicaragua)",
                                "Módulo de HR y Planillas (NicaLabor)",
                                "Facturación Electrónica Ultrarrápida"
                            ].map((feature, i) => (
                                <li key={i} className="flex items-center gap-5 text-blue-950 font-bold text-lg">
                                    <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                                        <CheckCircle className="text-emerald-600 w-5 h-5" />
                                    </div>
                                    {feature}
                                </li>
                            ))}
                        </ul>

                        <div className="text-center relative z-10">
                            <Link to="/register" className="inline-block w-full py-6 bg-blue-950 text-white font-bold rounded-2xl text-xl hover:bg-blue-900 transition-colors shadow-2xl shadow-blue-900/30 hover:-translate-y-1 active:scale-95">
                                Empezar a Configurar mi Empresa
                            </Link>
                        </div>
                    </div>
                </div>
            </section>

            {/* ==========================================
                FOOTER CORPORATIVO
               ========================================== */}
            <footer className="bg-blue-950 pt-24 pb-12 border-t border-blue-900">
                <div className="container mx-auto px-6">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-16 border-b border-blue-900/50 pb-16">
                        <div className="col-span-1 md:col-span-2">
                            <div className="flex items-center gap-3 mb-8">
                                <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20">
                                    <span className="font-bold text-white text-xl">N</span>
                                </div>
                                <span className="text-2xl font-bold tracking-tight text-white block leading-none">NORTEX</span>
                            </div>
                            <p className="text-blue-200/80 font-medium max-w-sm mb-8 text-lg leading-relaxed">
                                Infraestructura tecnológica y de software base para empresas y comercios de alto volumen en Centroamérica.
                            </p>

                            {/* Dirección Local */}
                            <div className="flex items-start gap-3 text-blue-300 text-sm font-medium">
                                <Building className="w-5 h-5 shrink-0 text-emerald-400" />
                                <div>
                                    <p className="font-bold text-white mb-1">Centro de Operaciones</p>
                                    <p>Edificio Corporativo Norte</p>
                                    <p>Managua, Nicaragua.</p>
                                </div>
                            </div>
                        </div>

                        <div>
                            <h4 className="text-white font-bold mb-6 text-lg tracking-wide">Plataforma</h4>
                            <ul className="space-y-4 text-blue-200/80 text-base font-medium">
                                <li><Link to="/register" className="hover:text-emerald-400 transition-colors flex items-center gap-2"><ArrowRight size={14} /> Crear Cuenta</Link></li>
                                <li><Link to="/login" className="hover:text-emerald-400 transition-colors flex items-center gap-2"><ArrowRight size={14} /> Acceso a Clientes</Link></li>
                                <li><a href="#features" className="hover:text-emerald-400 transition-colors flex items-center gap-2"><ArrowRight size={14} /> Características Core</a></li>
                            </ul>
                        </div>

                        <div>
                            <h4 className="text-white font-bold mb-6 text-lg tracking-wide">Legal & Seguridad</h4>
                            <ul className="space-y-4 text-blue-200/80 text-base font-medium">
                                <li><Link to="/terms" className="hover:text-emerald-400 transition-colors flex items-center gap-2"><FileText size={14} /> Términos de Servicio</Link></li>
                                <li><Link to="/privacy" className="hover:text-emerald-400 transition-colors flex items-center gap-2"><ShieldCheck size={14} /> Política de Privacidad</Link></li>
                                <li className="pt-4 mt-4 border-t border-blue-900/50">
                                    <span className="flex items-center gap-2 text-white font-mono text-xs bg-blue-900 px-3 py-1.5 rounded-lg inline-flex border border-blue-800">
                                        RUC: J0310000000000
                                    </span>
                                </li>
                            </ul>
                        </div>
                    </div>

                    <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                        <p className="text-blue-400/60 text-sm font-medium">&copy; {new Date().getFullYear()} Nortex Technology. Todos los derechos reservados bajo las regulaciones comerciales locales.</p>
                        <div className="flex gap-3">
                            <span className="text-xs font-bold font-mono tracking-widest bg-emerald-500/10 text-emerald-400 px-4 py-1.5 rounded-full border border-emerald-500/20">SISTEMA ENCRIPTADO</span>
                            <span className="text-xs font-bold font-mono tracking-widest bg-blue-500/10 text-blue-400 px-4 py-1.5 rounded-full border border-blue-500/20">UPTIME 99.99%</span>
                        </div>
                    </div>
                </div>
            </footer>
        </div>
    );
};

export default LandingPage;
