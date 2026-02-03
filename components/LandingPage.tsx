import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, ShieldCheck, Zap, TrendingUp } from 'lucide-react';
import GuestPOS from './GuestPOS';

const LandingPage: React.FC = () => {
  const navigate = useNavigate();

  const handleGuestCheckout = () => {
    // Aquí podríamos guardar el estado de la "venta" en localStorage para recuperarlo en el registro
    // Por ahora, redirigimos al registro con un efecto de "continuidad"
    navigate('/register');
  };

  return (
    <div className="min-h-screen bg-nortex-900 text-white font-sans selection:bg-nortex-accent selection:text-nortex-900 overflow-x-hidden">
      
      {/* Header */}
      <nav className="container mx-auto px-6 py-6 flex justify-between items-center relative z-20">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-nortex-accent rounded flex items-center justify-center">
            <span className="font-bold text-nortex-900">N</span>
          </div>
          <span className="text-xl font-mono font-bold tracking-widest">NORTEX</span>
        </div>
        <div className="hidden md:flex gap-8 text-sm font-medium text-slate-400">
          <a href="#features" className="hover:text-white transition-colors">Características</a>
          <a href="#pricing" className="hover:text-white transition-colors">Precios</a>
        </div>
        <div className="flex gap-4">
           <Link to="/login" className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white transition-colors">
            Login
          </Link>
          <Link to="/register" className="px-5 py-2 text-sm font-bold bg-nortex-accent text-nortex-900 rounded hover:bg-emerald-400 transition-all shadow-[0_0_20px_rgba(16,185,129,0.3)]">
            Empezar
          </Link>
        </div>
      </nav>

      {/* Hero Section Split Layout */}
      <header className="container mx-auto px-6 pt-12 pb-24 md:py-24 relative">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-nortex-500 rounded-full blur-[150px] opacity-10 pointer-events-none"></div>
        
        <div className="grid lg:grid-cols-2 gap-12 items-center relative z-10">
            {/* Left Column: Copy */}
            <div className="text-center lg:text-left">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-nortex-800/50 border border-nortex-700 text-nortex-accent text-xs font-mono mb-6">
                    <span className="w-2 h-2 rounded-full bg-nortex-accent animate-pulse"></span>
                    SISTEMA OPERATIVO FINANCIERO V2.0
                </div>
                <h1 className="text-4xl md:text-6xl font-bold mb-6 tracking-tight leading-tight">
                  Tu Ferretería <br />
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-nortex-accent to-blue-500">
                    Ahora es un Banco.
                  </span>
                </h1>
                <p className="text-lg text-slate-400 mb-8 leading-relaxed max-w-xl mx-auto lg:mx-0">
                  Nortex convierte cada venta en historial crediticio. Usa el simulador a la derecha y experimenta la velocidad de un POS diseñado para crecer.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
                  <Link to="/register" className="px-8 py-4 bg-white text-nortex-900 font-bold rounded-lg hover:bg-slate-200 transition-all flex items-center justify-center gap-2 shadow-lg shadow-white/10">
                    Crear Cuenta Gratis
                    <ArrowRight size={20} />
                  </Link>
                  <button className="px-8 py-4 bg-nortex-800 border border-nortex-700 text-white font-medium rounded-lg hover:bg-nortex-700 transition-all">
                    Ver Demo Video
                  </button>
                </div>
                
                <div className="mt-8 flex items-center justify-center lg:justify-start gap-6 text-sm text-slate-500 font-mono">
                    <div className="flex items-center gap-2">
                        <ShieldCheck size={16} className="text-nortex-accent" />
                        <span>Data Encriptada</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Zap size={16} className="text-blue-500" />
                        <span>Setup en 30s</span>
                    </div>
                </div>
            </div>

            {/* Right Column: Guest POS Interactive Demo */}
            <div className="relative group perspective-1000">
                <div className="absolute -inset-1 bg-gradient-to-r from-nortex-accent to-blue-600 rounded-2xl blur opacity-20 group-hover:opacity-40 transition duration-1000"></div>
                <div className="relative transform transition-transform duration-500 hover:scale-[1.01]">
                    <div className="absolute top-0 left-0 right-0 h-8 bg-slate-800 rounded-t-xl flex items-center px-4 gap-2 border-b border-slate-700 z-20">
                        <div className="flex gap-1.5">
                            <div className="w-3 h-3 rounded-full bg-red-500/50"></div>
                            <div className="w-3 h-3 rounded-full bg-yellow-500/50"></div>
                            <div className="w-3 h-3 rounded-full bg-green-500/50"></div>
                        </div>
                        <div className="ml-4 px-3 py-0.5 bg-slate-900/50 rounded text-[10px] text-slate-500 font-mono flex-1 text-center">
                            app.nortex.com/pos
                        </div>
                    </div>
                    <div className="pt-8 bg-slate-900 rounded-xl overflow-hidden shadow-2xl border border-slate-700">
                        <GuestPOS onCobrarClick={handleGuestCheckout} />
                    </div>
                </div>
            </div>
        </div>
      </header>

      {/* Features Grid */}
      <section id="features" className="py-24 bg-nortex-900 border-t border-nortex-800 relative z-10">
        <div className="container mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">Todo lo que necesitas para escalar</h2>
            <p className="text-slate-400">Diseñado por ingenieros, optimizado para dueños de negocio.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="p-8 rounded-2xl bg-nortex-800/30 border border-nortex-800 hover:border-nortex-500 transition-colors group">
              <div className="w-14 h-14 bg-blue-500/10 text-blue-500 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Zap size={28} />
              </div>
              <h3 className="text-xl font-bold mb-3">Ventas Atómicas</h3>
              <p className="text-slate-400 leading-relaxed">Control de inventario en tiempo real con transacciones ACID. Nunca pierdas un tornillo, aunque se vaya la luz.</p>
            </div>
            <div className="p-8 rounded-2xl bg-nortex-800/30 border border-nortex-800 hover:border-nortex-accent transition-colors group">
              <div className="w-14 h-14 bg-nortex-accent/10 text-nortex-accent rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <TrendingUp size={28} />
              </div>
              <h3 className="text-xl font-bold mb-3">Scoring Automático</h3>
              <p className="text-slate-400 leading-relaxed">Cada venta validada aumenta tu capacidad crediticia. Convierte tu flujo de caja en capital de trabajo real.</p>
            </div>
            <div className="p-8 rounded-2xl bg-nortex-800/30 border border-nortex-800 hover:border-purple-500 transition-colors group">
              <div className="w-14 h-14 bg-purple-500/10 text-purple-500 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <ShieldCheck size={28} />
              </div>
              <h3 className="text-xl font-bold mb-3">Seguridad Bancaria</h3>
              <p className="text-slate-400 leading-relaxed">Encriptación de grado militar. Tus datos financieros están aislados y más seguros que en una caja fuerte física.</p>
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