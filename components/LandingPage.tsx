import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
    ArrowRight, ShieldCheck, Lock, CheckCircle, BarChart3, Users, Calculator, ScanBarcode, ChevronRight,
    Building2, FileText, Smartphone, Globe, AlertCircle, Building, HeadphonesIcon, XCircle, Zap, DollarSign, Wallet
} from 'lucide-react';

// Tipos estructurados para SEO Dinámico por Nicho
type NicheContent = {
    titleKey: string;
    focusWords: string;
    subtitle: string;
    icon: React.ReactNode;
    color: string;
};

const NICHES: Record<string, NicheContent> = {
    'ferreterias': {
        titleKey: 'El Sistema Exacto para tu',
        focusWords: 'Ferretería.',
        subtitle: 'Controla miles de códigos, vende al contado y a crédito, y genera reportes DGI sin dolores de cabeza. Diseñado para el ritmo de Managua a Estelí.',
        icon: <Building2 className="w-6 h-6 text-orange-500" />,
        color: 'from-orange-600 to-red-500'
    },
    'farmacias': {
        titleKey: 'Control de Lotes y Vencimientos para',
        focusWords: 'Farmacias.',
        subtitle: 'El único POS en Nicaragua que controla tus lotes, alerta de vencimientos y automatiza tu facturación DGI en un solo clic.',
        icon: <ShieldCheck className="w-6 h-6 text-emerald-500" />,
        color: 'from-emerald-600 to-teal-500'
    },
    'contabilidad-dgi': {
        titleKey: 'Retenciones 2% y 1% en Piloto Automático',
        focusWords: 'Facturación DGI.',
        subtitle: 'Deja de calcular impuestos a mano. Nortex deduce el IVA, IR e IMI automáticamente en cada factura de compra y venta.',
        icon: <Calculator className="w-6 h-6 text-blue-500" />,
        color: 'from-blue-600 to-indigo-500'
    },
    'default': {
        titleKey: 'Crece tu negocio con el',
        focusWords: 'Sistema más fácil de Nicaragua.',
        subtitle: 'Nortex es el Punto de Venta, Control de Inventario y Cierre Fiscal (DGI) diseñado específicamente para dueños que valoran su tiempo.',
        icon: <ScanBarcode className="w-6 h-6 text-blue-500" />,
        color: 'from-blue-700 to-emerald-600'
    }
};

const LandingPage: React.FC = () => {
    const { niche } = useParams<{ niche: string }>();
    const [scrolled, setScrolled] = useState(false);

    useEffect(() => {
        const handleScroll = () => setScrolled(window.scrollY > 20);
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    const content = NICHES[niche?.toLowerCase() || ''] || NICHES['default'];

    return (
        <div className="min-h-screen bg-slate-50 text-slate-800 font-sans selection:bg-blue-600 selection:text-white overflow-x-hidden">

            {/* ==========================================
                NAVBAR CORPORATIVA (Pegajosa)
               ========================================== */}
            <nav className={`fixed top-0 w-full z-50 transition-all duration-300 ${scrolled ? 'bg-white/90 backdrop-blur-md shadow-sm py-4' : 'bg-transparent py-6'}`}>
                <div className="container mx-auto px-6 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-900 rounded-xl flex items-center justify-center shadow-lg shadow-blue-900/20">
                            <span className="font-bold text-white text-xl">N</span>
                        </div>
                        <div>
                            <span className="text-2xl font-bold tracking-tight text-blue-950 block leading-none">NORTEX</span>
                        </div>
                    </div>
                    <div className="hidden md:flex gap-10 text-sm font-bold text-slate-600">
                        <a href="#solucion" className="hover:text-blue-700 transition-colors">La Solución</a>
                        <a href="#boost" className="hover:text-amber-500 transition-colors flex items-center gap-1"><Zap size={14} /> Capital</a>
                        <a href="#precio" className="hover:text-blue-700 transition-colors">Precios</a>
                    </div>
                    <div className="flex gap-4">
                        <Link to="/login" className="px-5 py-2.5 text-sm font-bold text-slate-600 hover:text-blue-800 transition-colors hidden sm:block">
                            Ingresar
                        </Link>
                        <Link to="/register" className="px-6 py-2.5 text-sm font-bold bg-blue-700 text-white rounded-xl hover:bg-blue-800 transition-all shadow-lg shadow-blue-700/30 active:scale-95 flex items-center gap-2">
                            Empieza Gratis
                        </Link>
                    </div>
                </div>
            </nav>

            {/* ==========================================
                HERO SECTION (ABOVE THE FOLD - PLG)
               ========================================== */}
            <header className="container mx-auto px-6 pt-36 pb-20 relative text-center">
                {/* Iluminación de fondo */}
                <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-blue-500 rounded-full blur-[180px] opacity-[0.07] pointer-events-none"></div>

                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-50 text-blue-700 font-semibold text-sm mb-8 border border-blue-100">
                    {content.icon}
                    Especialmente hecho en Nicaragua 🇳🇮
                </div>

                <h1 className="text-5xl md:text-7xl lg:text-[5.5rem] font-black text-slate-900 mb-6 tracking-tighter leading-[1.05] max-w-5xl mx-auto">
                    No uses Excel. No uses libretas. {content.titleKey} <span className={`text-transparent bg-clip-text bg-gradient-to-r ${content.color}`}>{content.focusWords}</span>
                </h1>

                <p className="text-xl md:text-2xl text-slate-500 max-w-3xl mx-auto mb-10 leading-relaxed font-medium">
                    {content.subtitle}
                </p>

                <div className="flex flex-col items-center z-20 relative mb-16">
                    <Link to="/register" className="group px-12 py-6 bg-blue-700 text-white font-bold rounded-2xl hover:bg-blue-800 transition-all flex items-center justify-center gap-3 shadow-2xl shadow-blue-700/30 text-xl hover:-translate-y-1 w-full sm:w-auto">
                        Empieza Gratis en 2 Minutos
                        <ArrowRight size={26} className="group-hover:translate-x-1 transition-transform" />
                    </Link>
                    <p className="text-slate-400 text-sm mt-4 font-medium flex items-center gap-2">
                        <CheckCircle size={14} className="text-emerald-500" /> No requiere tarjeta de crédito. Configuración en 3 clics.
                    </p>
                </div>

                {/* Social Proof Instantáneo */}
                <div className="pt-8 border-t border-slate-200/60 max-w-3xl mx-auto flex flex-col md:flex-row items-center justify-center gap-6 opacity-80">
                    <div className="flex -space-x-3">
                        <div className="w-10 h-10 rounded-full bg-slate-200 border-2 border-white"></div>
                        <div className="w-10 h-10 rounded-full bg-slate-300 border-2 border-white"></div>
                        <div className="w-10 h-10 rounded-full bg-slate-400 border-2 border-white"></div>
                        <div className="w-10 h-10 rounded-full bg-slate-500 border-2 border-white flex items-center justify-center text-xs text-white font-bold">+100</div>
                    </div>
                    <div className="text-left">
                        <p className="font-bold text-slate-800 text-sm">Más de 150 negocios creciendo con Nortex.</p>
                        <p className="text-slate-500 text-xs">Procesando más de C$10 Millones mensuales.</p>
                    </div>
                </div>
            </header>

            {/* ==========================================
                SECCIÓN DE DOLOR VS SOLUCIÓN (MÉTODO "GUSTO")
               ========================================== */}
            <section id="solucion" className="py-24 bg-white">
                <div className="container mx-auto px-6">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl md:text-5xl font-extrabold text-slate-900 mb-6 tracking-tight">Sobrevivir vs. Crecer de Verdad</h2>
                        <p className="text-lg text-slate-500 max-w-2xl mx-auto font-medium">Dejemos de románzitar lo difícil. Tu negocio merece tecnología que trabaje por ti, no tecnología que te dé más trabajo.</p>
                    </div>

                    <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-8">
                        {/* El Dolor (Antes) */}
                        <div className="bg-red-50/50 border border-red-100 rounded-3xl p-8 md:p-12">
                            <div className="inline-flex items-center gap-2 px-3 py-1 bg-red-100 text-red-700 rounded-lg font-bold text-sm mb-8">
                                <XCircle size={16} /> La Pesadilla Tradicional
                            </div>
                            <ul className="space-y-6">
                                <PainRow text="Cuadres de caja que nunca dan, faltando 200 pesos diario." />
                                <PainRow text="El pánico de fin de mes calculando IVA y Retenciones a mano." />
                                <PainRow text="Robos hormiga de inventario imposibles de rastrear." />
                                <PainRow text="Perder horas calculando el INSS y liquidaciones Ley 185." />
                            </ul>
                        </div>

                        {/* La Solución (Con Nortex) */}
                        <div className="bg-emerald-50/50 border border-emerald-100 rounded-3xl p-8 md:p-12 shadow-xl shadow-emerald-900/5 hover:-translate-y-1 transition-transform">
                            <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-100 text-emerald-800 rounded-lg font-bold text-sm mb-8">
                                <CheckCircle size={16} /> El Paraíso Nortex
                            </div>
                            <ul className="space-y-6">
                                <SolutionRow text="Cierres de turno ciegos automatizados en segundos." />
                                <SolutionRow text="Reportes DGI (DMI, Retenciones) listos a un clic." />
                                <SolutionRow text="Auditoría forense de Kardex detectando 'ajustes' sospechosos." />
                                <SolutionRow text="Nómina y Aguinaldo calculados en piloto automático." />
                            </ul>
                        </div>
                    </div>
                </div>
            </section>

            {/* ==========================================
                NORTEX BOOST (EMBEDDED FINANCE LENDING)
               ========================================== */}
            <section id="boost" className="py-24 bg-slate-900 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-amber-500 rounded-full blur-[150px] opacity-10 pointer-events-none"></div>

                <div className="container mx-auto px-6 relative z-10">
                    <div className="max-w-4xl mx-auto text-center">
                        <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-full font-bold text-sm mb-8">
                            <Zap size={16} className="fill-amber-400" /> NORTEX BOOST
                        </div>
                        <h2 className="text-4xl md:text-5xl font-black text-white mb-8 tracking-tight">Tu data de ventas vale oro. Literalmente.</h2>

                        <p className="text-xl text-slate-300 font-medium leading-relaxed mb-12">
                            Con Nortex, tu buen historial de ventas dentro del sistema te abre puertas. ¿Necesitas llenar tus tramos para la temporada escolar o fin de año?
                            <strong className="text-white font-bold ml-2">El sistema analiza tus ventas diarias y te ofrece adelantos de capital al instante.</strong>
                        </p>

                        <div className="grid md:grid-cols-3 gap-6 text-left mb-12">
                            <BoostFeature icon={<Building size={24} />} title="Sin Bancos" desc="No te pediremos la fe de bautismo ni estados financieros sellados." />
                            <BoostFeature icon={<Users size={24} />} title="Sin Fiadores" desc="Tus ventas diarias registradas en Nortex son tu mejor garantía." />
                            <BoostFeature icon={<Clock size={24} />} title="Al Instante" desc="Crédito pre-aprobado depositado a tu cuenta en 24 horas." />
                        </div>

                        <div className="bg-slate-800/50 backdrop-blur-md border border-slate-700 rounded-2xl p-6 inline-flex flex-col items-center">
                            <span className="text-slate-400 text-sm font-bold mb-2 uppercase tracking-wide">Línea de Crédito Estimada</span>
                            <span className="text-4xl md:text-6xl font-black text-amber-400">C$ 150,000</span>
                            <span className="text-slate-500 text-xs mt-2">*Exclusivo para negocios operando con Nortex Pro por 3+ meses.</span>
                        </div>
                    </div>
                </div>
            </section>

            {/* ==========================================
                PRICING (LA TRAMPA DE MIEL)
               ========================================== */}
            <section id="precio" className="py-24 bg-slate-50 border-t border-slate-200">
                <div className="container mx-auto px-6 max-w-5xl">
                    <div className="text-center mb-16">
                        <h2 className="text-4xl font-extrabold text-slate-900 mb-4 tracking-tight">Precios Honestos.</h2>
                        <p className="text-lg text-slate-500 font-medium">Diseñado para que crezcas, no para exprimirte cuando apenas empiezas.</p>
                    </div>

                    <div className="grid md:grid-cols-2 gap-8 items-stretch pt-4">

                        {/* Plan Freemium (Lead Magnet) */}
                        <div className="bg-white border border-slate-200 rounded-[2.5rem] p-10 hover:shadow-xl transition-shadow flex flex-col">
                            <h3 className="text-2xl font-black text-slate-900 mb-2">Comienza Hoy</h3>
                            <p className="text-slate-500 font-medium mb-6">La manera más rápida de probar el sistema en tu tienda real.</p>
                            <div className="flex items-end gap-1 mb-8">
                                <span className="text-6xl font-black text-slate-900">$0</span>
                                <span className="text-xl font-bold text-slate-400 mb-2">/prueba local</span>
                            </div>
                            <ul className="space-y-4 mb-10 flex-1">
                                <PricingFeature text="Instalación en 2 minutos" />
                                <PricingFeature text="Punto de Venta Web" />
                                <PricingFeature text="Inventario Básico" />
                                <PricingFeature text="Hasta 50 productos" />
                            </ul>
                            <Link to="/register" className="w-full py-4 bg-slate-100 text-slate-800 font-bold rounded-xl text-center hover:bg-slate-200 transition-colors">
                                Instalar Gratis
                            </Link>
                        </div>

                        {/* Plan Pro (El Ancla) */}
                        <div className="bg-blue-950 border-2 border-blue-600 rounded-[2.5rem] p-10 shadow-2xl shadow-blue-900/30 flex flex-col relative transform md:-translate-y-4">
                            <div className="absolute top-0 right-10 -translate-y-1/2 bg-gradient-to-r from-blue-500 to-indigo-500 text-white px-4 py-1 rounded-full text-xs font-bold uppercase tracking-wide">
                                Todo Incluido
                            </div>
                            <h3 className="text-2xl font-black text-white mb-2">Nortex Pro</h3>
                            <p className="text-blue-200 font-medium mb-6">Todo el software corporativo. Sin licencias caras ni cobros por módulo.</p>
                            <div className="flex items-end gap-1 mb-8">
                                <span className="text-6xl font-black text-white">$25</span>
                                <span className="text-xl font-bold text-blue-400 mb-2">/mes</span>
                            </div>
                            <ul className="space-y-4 mb-10 flex-1">
                                <PricingFeature text="Usuarios, cajas y productos ilimitados" light />
                                <PricingFeature text="Auditoría Forense y Salud Financiera" light />
                                <PricingFeature text="NicaLabor (Nómina y Aguinaldo)" light />
                                <PricingFeature text="Retenciones DGI 2%, 1% e IVA" light />
                                <PricingFeature text="Elegibilidad inmediata para Nortex Boost" light />
                            </ul>
                            <Link to="/register" className="w-full py-4 bg-blue-600 text-white font-bold rounded-xl text-center hover:bg-blue-500 shadow-lg shadow-blue-600/30 transition-colors">
                                Crear mi Cuenta Pro
                            </Link>
                        </div>

                    </div>
                </div>
            </section>

            {/* ==========================================
                FOOTER CORPORATIVO
               ========================================== */}
            <footer className="bg-slate-900 py-12 border-t border-slate-800">
                <div className="container mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-6">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                            <span className="font-bold text-white text-lg">N</span>
                        </div>
                        <span className="text-xl font-bold tracking-tight text-white block">NORTEX</span>
                    </div>
                    <div className="text-slate-500 text-sm font-medium">
                        Hecho por ingenieros comerciales. Operando 24/7 en la Nube.
                    </div>
                    <div className="flex gap-6 text-sm font-bold text-slate-400">
                        <Link to="/login" className="hover:text-white transition-colors">Login</Link>
                        <Link to="/terms" className="hover:text-white transition-colors">Términos</Link>
                        <Link to="/privacy" className="hover:text-white transition-colors">Privacidad</Link>
                    </div>
                </div>
            </footer>
        </div>
    );
};

/* Helper Components */
const PainRow = ({ text }: { text: string }) => (
    <li className="flex gap-4 items-start text-red-900 font-medium text-lg leading-snug">
        <XCircle className="text-red-400 flex-shrink-0 mt-0.5" /> <span>{text}</span>
    </li>
);

const SolutionRow = ({ text }: { text: string }) => (
    <li className="flex gap-4 items-start text-emerald-900 font-medium text-lg leading-snug">
        <CheckCircle className="text-emerald-500 flex-shrink-0 mt-0.5" /> <span>{text}</span>
    </li>
);

const BoostFeature = ({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) => (
    <div className="bg-slate-800/40 rounded-2xl p-6 border border-slate-700/50">
        <div className="w-12 h-12 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center mb-4">
            {icon}
        </div>
        <h4 className="text-white font-bold text-lg mb-2">{title}</h4>
        <p className="text-slate-400 font-medium text-sm leading-relaxed">{desc}</p>
    </div>
);

const PricingFeature = ({ text, light }: { text: string; light?: boolean }) => (
    <li className={`flex items-start gap-3 font-bold ${light ? 'text-white' : 'text-slate-700'}`}>
        <CheckCircle className={`w-5 h-5 flex-shrink-0 ${light ? 'text-blue-400' : 'text-slate-400'} mt-0.5`} />
        <span>{text}</span>
    </li>
);

export default LandingPage;
