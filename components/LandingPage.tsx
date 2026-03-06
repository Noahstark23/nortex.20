import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle, Shield, Zap, TrendingUp, Smartphone, ChevronRight } from 'lucide-react';

const LandingPage: React.FC = () => {
    return (
        <div className="min-h-screen bg-slate-50 font-sans text-slate-800 selection:bg-nortex-500 selection:text-white">

            {/* NAVBAR */}
            <nav className="fixed top-0 w-full bg-white/80 backdrop-blur-md border-b border-slate-200 z-50">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-nortex-900 rounded flex items-center justify-center text-white font-bold text-xl">
                            N
                        </div>
                        <span className="text-xl font-bold tracking-tight text-slate-900">NORTEX</span>
                    </div>
                    <div className="flex items-center gap-4">
                        <Link to="/login" className="text-sm font-semibold text-slate-600 hover:text-nortex-900 transition-colors">
                            Iniciar Sesión
                        </Link>
                        <Link to="/register" className="text-sm font-bold bg-nortex-900 text-white px-5 py-2 rounded-lg hover:bg-nortex-800 transition-colors shadow-sm">
                            Empieza Gratis
                        </Link>
                    </div>
                </div>
            </nav>

            {/* HERO SECTION */}
            <section className="pt-32 pb-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto text-center">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-nortex-100 text-nortex-800 text-sm font-semibold mb-6">
                    <Zap size={16} className="text-nortex-600" /> El Sistema #1 para PyMES en Nicaragua
                </div>
                <h1 className="text-5xl md:text-7xl font-extrabold text-slate-900 tracking-tight mb-6 leading-tight">
                    No más libretas.<br className="hidden md:block" />
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-nortex-700 to-nortex-900">
                        Control total de tu negocio.
                    </span>
                </h1>
                <p className="text-lg md:text-xl text-slate-600 max-w-2xl mx-auto mb-10">
                    Facturación DGI, Kardex Inteligente y Planillas (Ley 185). Diseñado específicamente para que las Ferreterías y Farmacias nicaragüenses crezcan sin estrés.
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                    <Link to="/register" className="w-full sm:w-auto flex items-center justify-center gap-2 bg-nortex-900 text-white text-lg font-bold px-8 py-4 rounded-xl hover:bg-nortex-800 hover:scale-105 transition-all shadow-lg hover:shadow-xl">
                        Crear mi cuenta gratis <ArrowRight size={20} />
                    </Link>
                    <span className="text-sm text-slate-500 font-medium">No requiere tarjeta de crédito • Configuración en 2 min</span>
                </div>
            </section>

            {/* DOLOR VS SOLUCIÓN (GUSTO METHOD) */}
            <section className="py-20 bg-white">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="grid md:grid-cols-2 gap-12 items-center">
                        <div>
                            <h2 className="text-3xl font-bold text-slate-900 mb-6">El descontrol te está costando dinero todos los días.</h2>
                            <ul className="space-y-4">
                                {[
                                    "Cierres de caja que nunca cuadran y faltantes misteriosos.",
                                    "Multas de la DGI por errores manuales en tus retenciones.",
                                    "Horas perdidas calculando aguinaldos y vacaciones a mano.",
                                    "Quedarte sin mercadería clave porque olvidaste pedir al proveedor."
                                ].map((item, i) => (
                                    <li key={i} className="flex items-start gap-3">
                                        <div className="mt-1 flex-shrink-0 w-5 h-5 rounded-full bg-red-100 flex items-center justify-center">
                                            <span className="text-red-600 font-bold text-xs">X</span>
                                        </div>
                                        <span className="text-slate-700">{item}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div className="bg-slate-50 border border-slate-200 p-8 rounded-2xl shadow-sm">
                            <h3 className="text-2xl font-bold text-nortex-900 mb-6 flex items-center gap-2">
                                <Shield className="text-nortex-600" /> La Solución Nortex
                            </h3>
                            <ul className="space-y-4">
                                {[
                                    "Cierres de turno ciegos a prueba de robos hormiga.",
                                    "Facturación con Serie A/B y reportes DGI a un clic.",
                                    "Nómina automática que cumple el Código del Trabajo al 100%.",
                                    "Oráculo de Inventario que te avisa antes de que te quedes sin stock."
                                ].map((item, i) => (
                                    <li key={i} className="flex items-start gap-3">
                                        <CheckCircle className="text-nortex-600 mt-1 flex-shrink-0" size={20} />
                                        <span className="text-slate-800 font-medium">{item}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>
            </section>

            {/* EL SECRETO FINTECH: NORTEX BOOST */}
            <section className="py-24 bg-nortex-900 text-white relative overflow-hidden">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
                    <TrendingUp size={48} className="mx-auto text-nortex-300 mb-6" />
                    <h2 className="text-4xl font-extrabold mb-6">Tu buena facturación te abre puertas.</h2>
                    <p className="text-xl text-nortex-100 max-w-3xl mx-auto mb-10 leading-relaxed">
                        Con <strong>Nortex Capital</strong>, no necesitas rogarle a los bancos. El sistema analiza tu volumen de ventas y te pre-aprueba líneas de crédito de capital de trabajo al instante para que llenes tus tramos. Sin papeleos ridículos, directo a tu Kardex.
                    </p>
                    <Link to="/register" className="inline-flex items-center justify-center gap-2 bg-white text-nortex-900 text-lg font-bold px-8 py-4 rounded-xl hover:bg-slate-50 transition-all shadow-lg">
                        Empieza a Facturar Hoy <ChevronRight size={20} />
                    </Link>
                </div>
            </section>

            {/* FOOTER */}
            <footer className="bg-slate-900 text-slate-400 py-12 text-center border-t border-slate-800">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col items-center">
                    <div className="w-10 h-10 bg-slate-800 rounded flex items-center justify-center text-white font-bold text-xl mb-4">
                        N
                    </div>
                    <p className="text-sm font-medium mb-2">Nortex Inc. © {new Date().getFullYear()} - Construido para el comercio centroamericano.</p>
                    <p className="text-xs text-slate-500">Privacidad • Términos y Condiciones</p>
                </div>
            </footer>
        </div>
    );
};

export default LandingPage;
