import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ShieldCheck, Zap, TrendingUp, X } from 'lucide-react';
import GuestPOS from './GuestPOS';
import RegisterTenant from './RegisterTenant';

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
          <Link to="/register" className="hidden md:block px-5 py-2 text-sm font-bold bg-nortex-accent text-nortex-900 rounded hover:bg-emerald-400 transition-all shadow-[0_0_20px_rgba(16,185,129,0.3)]">
            Empezar Gratis
          </Link>
        </div>
      </nav>

      {/* Hero Section Split */}
      <header className="container mx-auto px-6 py-10 md:py-16 relative">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-nortex-500 rounded-full blur-[150px] opacity-10 pointer-events-none"></div>
        
        <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-20">
            {/* Left Content */}
            <div className="flex-1 text-center lg:text-left z-10">
                <div className="inline-block px-3 py-1 bg-nortex-800 border border-nortex-700 rounded-full text-xs font-mono text-nortex-accent mb-6 animate-pulse">
                    v2.0 SYSTEM ONLINE
                </div>
                <h1 className="text-5xl md:text-6xl font-bold mb-6 tracking-tight leading-tight">
                Tu Ferretería <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-nortex-accent to-blue-500">
                    Ahora es un Banco.
                </span>
                </h1>
                <p className="text-lg text-slate-400 max-w-xl mx-auto lg:mx-0 mb-8 leading-relaxed">
                Nortex convierte tus ventas diarias en historial crediticio real. 
                Usa el POS interactivo de la derecha para ver lo fácil que es.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
                    <Link to="/register" className="px-8 py-4 bg-white text-nortex-900 font-bold rounded-lg hover:bg-slate-200 transition-all flex items-center justify-center gap-2">
                        Crear Cuenta Gratis
                        <ArrowRight size={20} />
                    </Link>
                </div>
            </div>

            {/* Right Content: THE GUEST POS (PHANTOM) */}
            <div className="flex-1 w-full z-10 perspective-1000">
                <div className="relative transform rotate-y-minus-5 hover:rotate-0 transition-transform duration-500">
                    <div className="absolute -inset-4 bg-gradient-to-r from-nortex-accent to-blue-600 rounded-2xl blur-lg opacity-30"></div>
                    <GuestPOS onHook={handleGuestHook} />
                    
                    {/* Badge Overlay */}
                    <div className="absolute -top-6 -right-6 bg-yellow-400 text-nortex-900 font-bold px-4 py-2 rounded-lg shadow-xl transform rotate-12 z-20 hidden md:block border border-nortex-900">
                        ¡PRUÉBALO AHORA!
                    </div>
                </div>
            </div>
        </div>
      </header>

      {/* Features Grid */}
      <section id="features" className="py-24 bg-nortex-900 border-t border-nortex-800 relative z-10">
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

      {/* REGISTRATION MODAL (HOOK) */}
      {showRegisterModal && (
          <div className="fixed inset-0 z-50 bg-nortex-900/90 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-300">
              <div className="relative w-full max-w-md">
                  <button 
                    onClick={() => setShowRegisterModal(false)}
                    className="absolute -top-12 right-0 text-slate-400 hover:text-white"
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