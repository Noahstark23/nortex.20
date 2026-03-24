import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle, Package, BarChart2, Users, Zap } from 'lucide-react';

const LandingFerreteria: React.FC = () => {
  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800">
      <nav className="fixed top-0 w-full bg-white/90 backdrop-blur-md border-b border-slate-200 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-slate-900 rounded flex items-center justify-center text-white font-bold">N</div>
            <span className="font-bold text-lg text-slate-900">NORTEX</span>
          </Link>
          <Link to="/register" className="bg-slate-900 text-white text-sm font-bold px-5 py-2 rounded-lg hover:bg-slate-700 transition-colors">
            Prueba Gratis
          </Link>
        </div>
      </nav>

      <section className="pt-32 pb-20 px-6 max-w-5xl mx-auto text-center">
        <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900 mb-6 leading-tight">
          Sistema POS e Inventario<br />
          <span className="text-emerald-600">para Ferreterías en Nicaragua</span>
        </h1>
        <p className="text-xl text-slate-600 max-w-3xl mx-auto mb-10 leading-relaxed">
          Controla tu stock de 10,000+ productos, factura cumpliendo la DGI, 
          y gestiona a tus vendedores desde una sola pantalla. 
          Diseñado específicamente para el ritmo de una ferretería nicaragüense.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link to="/register" className="flex items-center justify-center gap-2 bg-slate-900 text-white font-bold px-8 py-4 rounded-xl hover:bg-slate-700 transition-colors">
            Crear mi cuenta gratis <ArrowRight size={18} />
          </Link>
          <span className="text-sm text-slate-500 flex items-center justify-center">Sin tarjeta de crédito · 30 días gratis</span>
        </div>
      </section>

      <section className="py-16 bg-white border-y border-slate-100">
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="text-3xl font-bold text-center text-slate-900 mb-12">
            Los problemas que resuelve Nortex en tu ferretería
          </h2>
          <div className="grid md:grid-cols-2 gap-8">
            {[
              {
                icon: <Package size={24} />,
                title: "Inventario de miles de productos sin errores",
                desc: "Gestiona pernos, cemento, pintura y materiales eléctricos con códigos de barras y alertas automáticas de stock mínimo. Nunca más 'ya se nos acabó'."
              },
              {
                icon: <Zap size={24} />,
                title: "Ventas rápidas en el mostrador",
                desc: "POS optimizado para velocidad: busca productos por nombre, código o categoría. Escáner de código de barras integrado. Cobra en efectivo o crédito en segundos."
              },
              {
                icon: <BarChart2 size={24} />,
                title: "Facturación compatible con DGI Nicaragua",
                desc: "Genera facturas con Series A y B, calcula IVA 15%, retenciones IR, e imprime en impresora térmica o A4. Cumple todas las normativas DGI 2026."
              },
              {
                icon: <Users size={24} />,
                title: "Control de vendedores y comisiones",
                desc: "Asigna metas a cada vendedor, calcula comisiones automáticamente, y ve en tiempo real quién está vendiendo más. Gestión de nómina incluida."
              }
            ].map((item, i) => (
              <div key={i} className="flex gap-4 p-6 bg-slate-50 rounded-xl">
                <div className="p-3 bg-emerald-100 text-emerald-700 rounded-lg flex-shrink-0 h-fit">{item.icon}</div>
                <div>
                  <h3 className="font-bold text-slate-900 mb-2">{item.title}</h3>
                  <p className="text-slate-600 text-sm leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 max-w-5xl mx-auto px-6">
        <h2 className="text-2xl font-bold text-slate-900 mb-8">
          Todo lo que necesita tu ferretería en Nicaragua
        </h2>
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
          {[
            "Control de stock en tiempo real",
            "Múltiples categorías de productos",
            "Kardex de inventario",
            "Facturas DGI Series A y B",
            "Cálculo automático de IVA 15%",
            "Retenciones IR Nicaragua",
            "POS con escáner de barras",
            "Ventas a crédito y cobranza",
            "Reportes de ventas diarias",
            "Gestión de proveedores",
            "Órdenes de compra",
            "Planilla según Ley 185",
            "Cálculo de INSS patronal",
            "Vacaciones y aguinaldo",
            "App para entrega a domicilio",
            "Cotizaciones en PDF",
            "CRM de clientes",
            "Acceso desde cualquier dispositivo"
          ].map((feat, i) => (
            <div key={i} className="flex items-center gap-3 p-3 bg-white border border-slate-200 rounded-lg">
              <CheckCircle size={16} className="text-emerald-600 flex-shrink-0" />
              <span className="text-sm text-slate-700">{feat}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="py-20 bg-slate-900 text-white text-center px-6">
        <h2 className="text-3xl font-bold mb-4">
          ¿Listo para modernizar tu ferretería?
        </h2>
        <p className="text-slate-300 mb-8 max-w-2xl mx-auto">
          Cientos de ferreterías en Nicaragua ya usan Nortex. 
          Configura tu cuenta en 2 minutos y empieza a facturar hoy.
        </p>
        <Link to="/register" className="inline-flex items-center gap-2 bg-emerald-500 text-white font-bold px-10 py-4 rounded-xl hover:bg-emerald-400 transition-colors text-lg">
          Empieza gratis — 30 días sin costo <ArrowRight size={20} />
        </Link>
      </section>

      <footer className="py-8 bg-slate-800 text-slate-400 text-center text-sm">
        <div className="max-w-4xl mx-auto px-6">
          <p>© {new Date().getFullYear()} Nortex Inc. — Sistema de facturación e inventario para Nicaragua</p>
          <div className="mt-3 flex justify-center gap-6">
            <Link to="/" className="hover:text-white">Inicio</Link>
            <Link to="/farmacias" className="hover:text-white">Para Farmacias</Link>
            <Link to="/blog" className="hover:text-white">Blog</Link>
            <Link to="/register" className="hover:text-white">Registrarse</Link>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingFerreteria;
