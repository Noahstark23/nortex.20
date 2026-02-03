import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ShieldCheck, Zap, TrendingUp, Lock } from 'lucide-react';

const LandingPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-nortex-900 text-white font-sans selection:bg-nortex-accent selection:text-nortex-900">
      
      {/* Header */}
      <nav className="container mx-auto px-6 py-6 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-nortex-accent rounded flex items-center justify-center">
            <span className="font-bold text-nortex-900">N</span>
          </div>
          <span className="text-xl font-mono font-bold tracking-widest">NORTEX</span>
        </div>
        <div className="hidden md:flex gap-8 text-sm font-medium text-slate-400">
          <a href="#features" className="hover:text-white transition-colors">Características</a>
          <a href="#pricing" className="hover:text-white transition-colors">Precios</a>
          <a href="#security" className="hover:text-white transition-colors">Seguridad</a>
        </div>
        <div className="flex gap-4">
           <Link to="/login" className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white transition-colors">
            Login
          </Link>
          <Link to="/register" className="px-5 py-2 text-sm font-bold bg-nortex-accent text-nortex-900 rounded hover:bg-emerald-400 transition-all shadow-[0_0_20px_rgba(16,185,129,0.3)]">
            Empezar Gratis
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <header className="container mx-auto px-6 py-20 md:py-32 text-center relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-nortex-500 rounded-full blur-[120px] opacity-10 pointer-events-none"></div>
        
        <h1 className="text-5xl md:text-7xl font-bold mb-6 tracking-tight relative z-10">
          Tu Ferretería <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-nortex-accent to-blue-500">
            Ahora es un Banco.
          </span>
        </h1>
        <p className="text-xl text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed">
          Nortex no es solo un POS. Es un Sistema Operativo Financiero que convierte tus ventas en score crediticio para acceder a préstamos automáticos.
        </p>
        <div className="flex flex-col md:flex-row gap-4 justify-center items-center relative z-10">
          <Link to="/register" className="group px-8 py-4 bg-white text-nortex-900 font-bold rounded-lg hover:bg-slate-200 transition-all flex items-center gap-2">
            Crear Cuenta Gratis
            <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
          </Link>
          <button className="px-8 py-4 bg-nortex-800 border border-nortex-700 text-white font-medium rounded-lg hover:bg-nortex-700 transition-all">
            Ver Demo en Vivo
          </button>
        </div>

        {/* Floating UI Elements (Decoration) */}
        <div className="mt-20 relative mx-auto max-w-5xl rounded-xl border border-nortex-800 bg-nortex-900/50 backdrop-blur-xl shadow-2xl p-4 md:p-8 transform rotate-x-12 perspective-1000">
           <div className="grid grid-cols-3 gap-4 opacity-80 pointer-events-none">
              <div className="h-32 bg-nortex-800 rounded animate-pulse"></div>
              <div className="h-32 bg-nortex-800 rounded"></div>
              <div className="h-32 bg-nortex-800 rounded"></div>
              <div className="col-span-2 h-48 bg-nortex-800 rounded"></div>
              <div className="h-48 bg-nortex-800 rounded animate-pulse delay-75"></div>
           </div>
           <div className="absolute inset-0 flex items-center justify-center">
              <span className="bg-nortex-900/80 px-6 py-2 rounded-full border border-nortex-accent text-nortex-accent font-mono text-sm">
                SYSTEM_READY: v2.0
              </span>
           </div>
        </div>
      </header>

      {/* Features Grid */}
      <section id="features" className="py-24 bg-nortex-900 border-t border-nortex-800">
        <div className="container mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            <div className="p-6 rounded-2xl bg-nortex-800/30 border border-nortex-800 hover:border-nortex-500 transition-colors">
              <div className="w-12 h-12 bg-blue-500/10 text-blue-500 rounded-lg flex items-center justify-center mb-4">
                <Zap size={24} />
              </div>
              <h3 className="text-xl font-bold mb-2">Ventas Atómicas</h3>
              <p className="text-slate-400">Control de inventario en tiempo real con transacciones ACID. Nunca pierdas un tornillo.</p>
            </div>
            <div className="p-6 rounded-2xl bg-nortex-800/30 border border-nortex-800 hover:border-nortex-accent transition-colors">
              <div className="w-12 h-12 bg-nortex-accent/10 text-nortex-accent rounded-lg flex items-center justify-center mb-4">
                <TrendingUp size={24} />
              </div>
              <h3 className="text-xl font-bold mb-2">Scoring Automático</h3>
              <p className="text-slate-400">Cada venta aumenta tu capacidad crediticia. Convierte tu flujo de caja en capital de trabajo.</p>
            </div>
            <div className="p-6 rounded-2xl bg-nortex-800/30 border border-nortex-800 hover:border-purple-500 transition-colors">
              <div className="w-12 h-12 bg-purple-500/10 text-purple-500 rounded-lg flex items-center justify-center mb-4">
                <ShieldCheck size={24} />
              </div>
              <h3 className="text-xl font-bold mb-2">Seguridad Bancaria</h3>
              <p className="text-slate-400">Encriptación de grado militar. Tus datos financieros están más seguros que en una caja fuerte.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t border-nortex-800 text-center text-slate-500 text-sm">
        <p>&copy; 2024 Nortex Inc. Construyendo el futuro del retail en LATAM.</p>
      </footer>
    </div>
  );
};

export default LandingPage;