import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle, ArrowRight, Star } from 'lucide-react';

const LandingNicaragua: React.FC = () => {
  const [email, setEmail] = useState('');
  const navigate = useNavigate();

  const handleCTA = () => {
    if (email) {
      navigate(`/register?email=${encodeURIComponent(email)}`);
    } else {
      navigate('/register');
    }
  };

  return (
    <div className="min-h-screen bg-white font-sans text-slate-800">
      <header className="bg-slate-900 py-4 px-6 text-center">
        <div className="flex items-center justify-center gap-2">
          <div className="w-7 h-7 bg-emerald-500 rounded flex items-center justify-center text-white font-bold text-sm">N</div>
          <span className="font-bold text-white text-lg">NORTEX</span>
        </div>
      </header>

      <section className="py-16 px-6 max-w-4xl mx-auto text-center">
        <div className="inline-flex items-center gap-2 bg-emerald-50 text-emerald-700 text-sm font-medium px-4 py-2 rounded-full mb-6 border border-emerald-200">
          ⚡ Sistema POS #1 para PyMES en Nicaragua
        </div>
        
        <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900 mb-6 leading-tight">
          Factura, controla tu inventario<br />y gestiona tu negocio
          <span className="text-emerald-600"> desde Nicaragua</span>
        </h1>
        
        <p className="text-xl text-slate-500 mb-10 max-w-2xl mx-auto">
          El único sistema POS que cumple con DGI Nicaragua, incluye nómina Ley 185 
          y se configura en menos de 5 minutos.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto mb-6">
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="tu@correo.com"
            className="flex-1 px-4 py-3 border-2 border-slate-200 rounded-xl text-base focus:border-emerald-500 focus:outline-none"
          />
          <button
            onClick={handleCTA}
            className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-6 py-3 rounded-xl transition-colors whitespace-nowrap"
          >
            Empieza gratis <ArrowRight size={18} />
          </button>
        </div>
        <p className="text-sm text-slate-400">30 días gratis · Sin tarjeta · Cancela cuando quieras</p>
      </section>

      <section className="py-8 bg-slate-50 border-y border-slate-100">
        <div className="max-w-3xl mx-auto px-6">
          <div className="flex flex-wrap justify-center gap-8 text-center">
            {[
              { n: "500+", l: "negocios en Nicaragua" },
              { n: "4.8★", l: "calificación promedio" },
              { n: "2 min", l: "tiempo de configuración" },
              { n: "99.5%", l: "disponibilidad del sistema" }
            ].map((s, i) => (
              <div key={i}>
                <div className="text-2xl font-bold text-slate-900">{s.n}</div>
                <div className="text-sm text-slate-500">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 px-6 max-w-3xl mx-auto">
        <h2 className="text-2xl font-bold text-center text-slate-900 mb-10">
          Todo lo que necesita tu negocio en Nicaragua
        </h2>
        <div className="grid sm:grid-cols-2 gap-4">
          {[
            "Facturación compatible con DGI Nicaragua",
            "Control de inventario en tiempo real",
            "Punto de Venta (POS) con escáner",
            "Nómina según Código del Trabajo Ley 185",
            "Cálculo automático INSS y INATEC",
            "Reportes de retenciones IR para DGI",
            "Gestión de clientes y cobranza",
            "Entregas a domicilio con app para motorizado",
            "Múltiples usuarios y sucursales",
            "Acceso desde celular o computadora",
          ].map((f, i) => (
            <div key={i} className="flex items-center gap-3">
              <CheckCircle size={18} className="text-emerald-600 flex-shrink-0" />
              <span className="text-slate-700">{f}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="py-16 bg-slate-900 text-white text-center px-6">
        <h2 className="text-3xl font-bold mb-4">Empieza hoy — Es gratis</h2>
        <p className="text-slate-300 mb-8">Sin contratos. Sin letra pequeña. Sin tarjeta de crédito.</p>
        <button
          onClick={handleCTA}
          className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-white font-bold px-12 py-4 rounded-xl text-lg transition-colors"
        >
          Crear mi cuenta gratis <ArrowRight size={20} />
        </button>
      </section>
    </div>
  );
};

export default LandingNicaragua;
