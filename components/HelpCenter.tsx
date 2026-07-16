import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BookOpen, ShoppingCart, Package, PlayCircle, ArrowRight, Sparkles,
  Banknote, Users, Calculator, Truck, HandCoins,
} from 'lucide-react';

/**
 * Centro de Ayuda / Tutoriales.
 *
 * - Tutoriales interactivos: arrancan los tours (driver.js) navegando a la
 *   pantalla con ?tour=pos|inv.
 * - Guías rápidas por tema (resumen del Manual de Nortex).
 * - Botón para volver a mostrar el checklist de "Primeros pasos".
 */

interface QuickGuide {
  icon: React.ReactNode;
  title: string;
  steps: string[];
}

const GUIDES: QuickGuide[] = [
  {
    icon: <ShoppingCart size={18} />,
    title: 'Vender en el Punto de Venta',
    steps: [
      'Marcá tu entrada y abrí la caja con el efectivo inicial.',
      'Buscá el producto (o escaneá el código) y agregalo al carrito.',
      'Elegí Efectivo o Crédito (fiado) y confirmá.',
      'Imprimí el ticket o enviálo por WhatsApp.',
      'Al cerrar el turno hacé el arqueo de caja.',
    ],
  },
  {
    icon: <Package size={18} />,
    title: 'Cargar y controlar inventario',
    steps: [
      'Agregá productos con “Nuevo Producto” o importá desde Excel.',
      'Definí precio, stock mínimo y punto de reorden.',
      'Registrá lotes con vencimiento si tu rubro lo necesita.',
      'El stock baja solo con cada venta; revisá el Kardex para ver el historial.',
    ],
  },
  {
    icon: <Banknote size={18} />,
    title: 'Cobrar el fiado (Cobranza)',
    steps: [
      'Entrá a Cobranza y usá el filtro “cobrar hoy”.',
      'Recordá al cliente con el botón de WhatsApp.',
      'Registrá el abono e imprimí el recibo.',
      'Revisá el estado de cuenta de cada cliente.',
    ],
  },
  {
    icon: <Users size={18} />,
    title: 'Invitar a tu equipo',
    steps: [
      'Andá a Mi Equipo → Invitar.',
      'Poné el correo y elegí el rol (cajero, gerente, contador…).',
      'La persona acepta la invitación por correo (vence en 48 h).',
      'Cada quien marca su entrada con su PIN.',
    ],
  },
  {
    icon: <Calculator size={18} />,
    title: 'Cierre contable del mes (Contador)',
    steps: [
      'Las ventas, compras y nómina generan asientos automáticos.',
      'Registrá asientos manuales solo para ajustes.',
      'Sacá los reportes de IVA e IR para la DGI.',
      'Cerrá el período para proteger lo ya declarado.',
    ],
  },
  {
    icon: <Truck size={18} />,
    title: 'Pedidos web y entregas',
    steps: [
      'Publicá productos en tu catálogo público.',
      'Los pedidos entran a Entregas con aviso.',
      'Asigná un motorizado y el cliente rastrea su pedido.',
    ],
  },
];

const HelpCenter: React.FC = () => {
  const navigate = useNavigate();

  const reshowChecklist = () => {
    localStorage.removeItem('nortex_onb_welcome');
    localStorage.removeItem('nortex_onb_dismissed');
    // Recargamos para que el OnboardingHub (montado en Layout) lo vuelva a leer.
    window.location.assign('/app/dashboard?welcome=1');
  };

  return (
    <div className="p-6 h-full overflow-y-auto bg-slate-50 text-slate-800">
      <header className="mb-8 flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-nortex-900 text-white rounded-2xl flex items-center justify-center">
            <BookOpen size={24} />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-nortex-900">Ayuda y Tutoriales</h1>
            <p className="text-slate-500">Aprendé a usar Nortex paso a paso.</p>
          </div>
        </div>
        <button
          onClick={reshowChecklist}
          className="flex items-center gap-2 px-4 py-2.5 bg-nortex-accent/15 hover:bg-nortex-accent/30 text-nortex-900 font-bold rounded-xl transition-colors"
        >
          <Sparkles size={18} /> Ver mis primeros pasos
        </button>
      </header>

      {/* TUTORIALES INTERACTIVOS */}
      <section className="mb-10">
        <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
          <PlayCircle size={20} className="text-nortex-accent" /> Tutoriales interactivos
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            onClick={() => navigate('/app/pos?tour=pos')}
            className="text-left bg-white border border-slate-200 hover:border-nortex-accent rounded-2xl p-5 shadow-sm hover:shadow-md transition-all group"
          >
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center">
                <ShoppingCart size={20} />
              </div>
              <h3 className="font-bold text-slate-800">Cómo hacer una venta</h3>
            </div>
            <p className="text-sm text-slate-500 mb-3">
              Un recorrido guiado por el Punto de Venta: del carrito al ticket.
            </p>
            <span className="text-sm font-bold text-nortex-900 flex items-center gap-1 group-hover:gap-2 transition-all">
              Iniciar tutorial <ArrowRight size={16} />
            </span>
          </button>

          <button
            onClick={() => navigate('/app/inventory?tour=inv')}
            className="text-left bg-white border border-slate-200 hover:border-nortex-accent rounded-2xl p-5 shadow-sm hover:shadow-md transition-all group"
          >
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center">
                <Package size={20} />
              </div>
              <h3 className="font-bold text-slate-800">Cómo cargar inventario</h3>
            </div>
            <p className="text-sm text-slate-500 mb-3">
              Te muestro dónde agregar productos y cómo buscarlos.
            </p>
            <span className="text-sm font-bold text-nortex-900 flex items-center gap-1 group-hover:gap-2 transition-all">
              Iniciar tutorial <ArrowRight size={16} />
            </span>
          </button>

          <button
            onClick={() => navigate('/app/receivables?tour=fiado')}
            className="text-left bg-white border border-slate-200 hover:border-nortex-accent rounded-2xl p-5 shadow-sm hover:shadow-md transition-all group"
          >
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-amber-100 text-amber-600 rounded-xl flex items-center justify-center">
                <HandCoins size={20} />
              </div>
              <h3 className="font-bold text-slate-800">Cómo cobrar el fiado</h3>
            </div>
            <p className="text-sm text-slate-500 mb-3">
              Quién te debe, qué cobrar primero y cómo registrar los abonos.
            </p>
            <span className="text-sm font-bold text-nortex-900 flex items-center gap-1 group-hover:gap-2 transition-all">
              Iniciar tutorial <ArrowRight size={16} />
            </span>
          </button>

          <button
            onClick={() => navigate('/app/purchases?tour=compras')}
            className="text-left bg-white border border-slate-200 hover:border-nortex-accent rounded-2xl p-5 shadow-sm hover:shadow-md transition-all group"
          >
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center">
                <Truck size={20} />
              </div>
              <h3 className="font-bold text-slate-800">Cómo registrar compras</h3>
            </div>
            <p className="text-sm text-slate-500 mb-3">
              Registrá la mercadería que entra para conocer tu ganancia real.
            </p>
            <span className="text-sm font-bold text-nortex-900 flex items-center gap-1 group-hover:gap-2 transition-all">
              Iniciar tutorial <ArrowRight size={16} />
            </span>
          </button>
        </div>
      </section>

      {/* GUÍAS RÁPIDAS */}
      <section>
        <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
          <HandCoins size={20} className="text-nortex-accent" /> Guías rápidas
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {GUIDES.map((g) => (
            <div key={g.title} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 bg-slate-100 text-slate-600 rounded-lg flex items-center justify-center">
                  {g.icon}
                </div>
                <h3 className="font-bold text-slate-800 text-sm">{g.title}</h3>
              </div>
              <ol className="space-y-1.5">
                {g.steps.map((s, i) => (
                  <li key={i} className="text-sm text-slate-600 flex gap-2">
                    <span className="text-nortex-accent font-bold shrink-0">{i + 1}.</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-400 mt-6">
          ¿Necesitás más detalle? El <span className="font-semibold">Manual de Nortex</span> cubre cada módulo
          paso a paso, con las notas fiscales de Nicaragua.
        </p>
      </section>
    </div>
  );
};

export default HelpCenter;
