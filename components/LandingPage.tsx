import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle, Shield, Zap, TrendingUp, ChevronRight } from 'lucide-react';

const LandingPage: React.FC = () => {
    return (
        <div className="min-h-screen bg-slate-50 font-sans text-slate-800 selection:bg-nortex-500 selection:text-white relative overflow-hidden">

            {/* NAVBAR */}
            <nav className="fixed top-0 w-full bg-white/80 backdrop-blur-md border-b border-slate-200 z-50 transition-all duration-300">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-2 group cursor-pointer hover:opacity-80 transition-opacity">
                        <div className="w-8 h-8 bg-nortex-900 rounded flex items-center justify-center text-white font-bold text-xl shadow-md group-hover:bg-slate-800 transition-colors">
                            N
                        </div>
                        <span className="text-xl font-bold tracking-tight text-slate-900 group-hover:text-nortex-accent transition-colors">NORTEX</span>
                    </div>
                    <div className="flex items-center gap-4">
                        <Link to="/login" className="text-sm font-semibold text-slate-600 hover:text-nortex-900 transition-colors">
                            Iniciar Sesión
                        </Link>
                        <Link to="/register" className="text-sm font-bold bg-nortex-900 text-white px-5 py-2 rounded-lg hover:bg-slate-800 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-nortex-900">
                            Empieza Gratis
                        </Link>
                    </div>
                </div>
            </nav>

            {/* HERO SECTION ("The Silicon Glow") */}
            <section className="relative pt-32 pb-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto text-center z-10">
                {/* Background ambient blurs */}
                <div className="absolute top-10 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-nortex-500/10 rounded-full blur-[120px] -z-10 pointer-events-none"></div>
                <div className="absolute top-40 left-1/4 w-[400px] h-[300px] bg-nortex-accent/10 rounded-full blur-[100px] -z-10 pointer-events-none animate-pulse"></div>

                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-nortex-100/80 backdrop-blur-sm border border-nortex-200 text-nortex-800 text-sm font-semibold mb-6 shadow-sm hover:shadow-md transition-shadow">
                    <Zap size={16} className="text-nortex-600 animate-pulse" /> El Sistema #1 para PyMES en Nicaragua
                </div>
                <h1 className="text-5xl md:text-7xl font-extrabold text-slate-900 tracking-tight mb-6 leading-[1.1]">
                    No más libretas.<br className="hidden md:block" />
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-nortex-600 to-nortex-900 drop-shadow-sm">
                        Control total de tu negocio.
                    </span>
                </h1>
                <p className="text-lg md:text-xl text-slate-600 max-w-2xl mx-auto mb-10 leading-relaxed font-medium">
                    Facturación DGI, Kardex Inteligente y Planillas (Ley 185). Diseñado específicamente para que las Ferreterías y Farmacias nicaragüenses crezcan sin estrés.
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                    <Link to="/register" className="group w-full sm:w-auto flex items-center justify-center gap-2 bg-nortex-900 text-white text-lg font-bold px-8 py-4 rounded-xl border border-nortex-700/50 hover:border-nortex-accent/50 shadow-xl hover:shadow-[0_0_30px_rgba(16,185,129,0.3)] transition-all duration-300 hover:-translate-y-1 focus:outline-none focus:ring-4 focus:ring-nortex-accent/30">
                        Crear mi cuenta gratis
                        <ArrowRight size={20} className="transition-transform duration-300 group-hover:translate-x-1.5" />
                    </Link>
                    <span className="text-sm text-slate-500 font-medium tracking-wide">No requiere tarjeta de crédito • Configuración en 2 min</span>
                </div>
            </section>

            {/* DOLOR VS SOLUCIÓN (GUSTO METHOD with Stripe Lift) */}
            <section className="relative py-24 bg-white border-t border-slate-100 z-10">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="grid md:grid-cols-2 gap-16 items-center">
                        <div>
                            <h2 className="text-3xl font-bold text-slate-900 mb-8 tracking-tight leading-tight">El descontrol te está costando dinero todos los días.</h2>
                            <ul className="space-y-6">
                                {[
                                    "Cierres de caja que nunca cuadran y faltantes misteriosos.",
                                    "Multas de la DGI por errores manuales en tus retenciones.",
                                    "Horas perdidas calculando aguinaldos y vacaciones a mano.",
                                    "Quedarte sin mercadería clave porque olvidaste pedir al proveedor."
                                ].map((item, i) => (
                                    <li key={i} className="flex items-start gap-4">
                                        <div className="mt-1 flex-shrink-0 w-6 h-6 rounded-full bg-red-50 border border-red-100 flex items-center justify-center shadow-sm">
                                            <span className="text-red-500 font-bold text-xs">✕</span>
                                        </div>
                                        <span className="text-slate-700 font-medium leading-relaxed">{item}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                        {/* Elevated Card */}
                        <div className="group bg-slate-50 border border-slate-200 hover:border-nortex-accent/40 p-10 rounded-3xl shadow-md hover:shadow-2xl transition-all duration-500 hover:-translate-y-2 relative overflow-hidden">
                            {/* Card inner glow */}
                            <div className="absolute top-0 right-0 p-12 bg-nortex-accent/5 blur-3xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>

                            <h3 className="text-2xl font-bold text-nortex-900 mb-8 flex items-center gap-3 relative z-10">
                                <Shield className="text-nortex-600 transition-transform duration-500 group-hover:scale-110" /> La Solución Nortex
                            </h3>
                            <ul className="space-y-6 relative z-10">
                                {[
                                    "Cierres de turno ciegos a prueba de robos hormiga.",
                                    "Facturación con Serie A/B y reportes DGI a un clic.",
                                    "Nómina automática que cumple el Código del Trabajo al 100%.",
                                    "Oráculo de Inventario que te avisa antes de que te quedes sin stock."
                                ].map((item, i) => (
                                    <li key={i} className="group/item flex items-start gap-4">
                                        <CheckCircle className="text-nortex-600 mt-1 flex-shrink-0 transition-transform duration-300 group-hover/item:scale-110 drop-shadow-sm" size={24} />
                                        <span className="text-slate-800 font-semibold leading-relaxed">{item}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>
            </section>

            {/* EL SECRETO FINTECH: NORTEX BOOST */}
            <section className="relative py-32 bg-nortex-900 text-white overflow-hidden border-t border-nortex-800">
                {/* Institutional ambient lighting */}
                <div className="absolute inset-0 bg-nortex-accent/10 blur-[150px] z-0 pointer-events-none"></div>
                <div className="absolute top-0 right-0 w-1/2 h-full bg-nortex-500/10 blur-[150px] z-0 pointer-events-none"></div>

                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
                    <div className="inline-flex items-center justify-center p-3 rounded-2xl bg-white/5 border border-white/10 mb-8 shadow-2xl backdrop-blur-sm">
                        <TrendingUp size={40} className="text-nortex-accent" />
                    </div>
                    <h2 className="text-4xl md:text-5xl font-extrabold mb-6 tracking-tight drop-shadow-md">Tu buena facturación te abre puertas.</h2>
                    <p className="text-xl md:text-2xl text-nortex-100 max-w-3xl mx-auto mb-12 leading-relaxed font-light">
                        Con <strong className="font-bold text-white">Nortex Capital</strong>, no necesitas rogarle a los bancos. El sistema analiza tu volumen de ventas y te pre-aprueba líneas de crédito de capital de trabajo al instante para que llenes tus tramos. <span className="opacity-80">Sin papeleos ridículos, directo a tu Kardex.</span>
                    </p>
                    <Link to="/register" className="group inline-flex items-center justify-center gap-3 bg-white text-nortex-900 text-lg font-bold px-10 py-5 rounded-2xl hover:bg-slate-50 transition-all duration-300 shadow-[0_0_40px_rgba(255,255,255,0.1)] hover:shadow-[0_0_60px_rgba(255,255,255,0.2)] hover:-translate-y-1">
                        Empieza a Facturar Hoy <ChevronRight size={22} className="transition-transform duration-300 group-hover:translate-x-1" />
                    </Link>
                </div>
            </section>

            {/* FOOTER */}
            <footer className="bg-slate-900 text-slate-400 py-16 text-center border-t border-slate-800">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col items-center">
                    <div className="w-12 h-12 bg-slate-800 rounded-xl flex items-center justify-center text-white font-bold text-2xl mb-6 shadow-inner">
                        N
                    </div>
                    <p className="text-sm font-medium mb-3 text-slate-300 tracking-wide">Nortex Inc. &copy; {new Date().getFullYear()} — Construido para el comercio centroamericano.</p>
                    <div className="text-sm font-medium flex items-center justify-center gap-3">
                        <Link to="/privacy" className="hover:text-white transition-colors duration-200">Privacidad</Link>
                        <span className="opacity-30">•</span>
                        <Link to="/terms" className="hover:text-white transition-colors duration-200">Términos y Condiciones</Link>
                    </div>
                </div>
            </footer>
        </div>
    );
};

export default LandingPage;
