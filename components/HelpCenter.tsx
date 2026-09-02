import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BookOpen, ShoppingCart, Package, PlayCircle, ArrowRight, Sparkles,
  Banknote, Users, Calculator, Truck, HandCoins, Scale,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import ModuleHeader from './ui/ModuleHeader';
import { homePathFor, resolveUiMode, UI_MODE_KEY } from '../utils/navigation';
import { clearOnboardingFlags, currentOnboardingStorageKeys } from '../utils/onboardingStorage';

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

interface InteractiveTutorial {
  icon: LucideIcon;
  title: string;
  description: string;
  destination: string;
  tone: 'info' | 'positive' | 'warning' | 'neutral';
}

const TUTORIALS: InteractiveTutorial[] = [
  {
    icon: ShoppingCart,
    title: 'Cómo hacer una venta',
    description: 'Un recorrido guiado por el Punto de Venta: del carrito al ticket.',
    destination: '/app/pos?tour=pos',
    tone: 'info',
  },
  {
    icon: Package,
    title: 'Cómo cargar inventario',
    description: 'Te muestro dónde agregar productos y cómo buscarlos.',
    destination: '/app/inventory?tour=inv',
    tone: 'positive',
  },
  {
    icon: HandCoins,
    title: 'Cómo cobrar el fiado',
    description: 'Quién te debe, qué cobrar primero y cómo registrar los abonos.',
    destination: '/app/receivables?tour=fiado',
    tone: 'warning',
  },
  {
    icon: Truck,
    title: 'Cómo registrar compras',
    description: 'Registrá la mercadería que entra para conocer tu ganancia real.',
    destination: '/app/purchases?tour=compras',
    tone: 'neutral',
  },
];

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
    icon: <Scale size={18} />,
    title: 'Facturar carne por peso',
    steps: [
      'Configurá la carne como “Peso/medida”, con unidad, paso y precio por lb o kg.',
      'Con cualquier balanza: pesá, tocá el producto y escribí el peso estable en el POS.',
      'Para automatizar: usá una etiqueta EAN-13 que codifique peso y mapeá su PLU en Balanzas y Etiquetas.',
      'Conectá al equipo del POS un lector USB/Bluetooth en modo teclado con Enter; no hace falta conectar la balanza.',
      'Revisá peso, precio unitario y total antes de cobrar. La conexión serial directa sigue siendo experimental.',
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
    clearOnboardingFlags(localStorage, currentOnboardingStorageKeys());
    // Recargamos para que el OnboardingHub (montado en Layout) lo vuelva a leer.
    // A la pantalla de inicio del ROL (antes: siempre /app/dashboard, que para
    // un cajero no es su pantalla).
    let home = '/app/dashboard';
    try {
      const role = JSON.parse(atob((localStorage.getItem('nortex_token') || '').split('.')[1])).role || '';
      const type = JSON.parse(localStorage.getItem('nortex_user') || '{}')?.tenant?.type || '';
      home = homePathFor(role, resolveUiMode(type, localStorage.getItem(UI_MODE_KEY)));
    } catch { /* token ilegible → dashboard */ }
    window.location.assign(`${home}?welcome=1`);
  };

  return (
    <div className="nx-workspace mx-auto h-full w-full max-w-[1600px] overflow-y-auto p-4 sm:p-6 lg:p-8">
      <ModuleHeader
        className="mb-8"
        icon={<BookOpen size={20} aria-hidden="true" />}
        title="Ayuda y Tutoriales"
        subtitle="Aprendé a usar Nortex paso a paso."
        actions={(
          <button
            type="button"
            onClick={reshowChecklist}
            className="nx-fluid-press nx-tone-positive-bg nx-tone-positive flex min-h-tap items-center gap-2 rounded-control px-4 py-2.5 font-bold transition-colors hover:brightness-[0.98]"
          >
            <Sparkles size={18} aria-hidden="true" /> Ver mis primeros pasos
          </button>
        )}
      />

      {/* TUTORIALES INTERACTIVOS */}
      <section className="mb-10" aria-labelledby="help-center-tutorials-title">
        <h2 id="help-center-tutorials-title" className="nx-canvas-text mb-4 flex items-center gap-2 text-lg font-bold">
          <PlayCircle size={20} className="nx-tone-positive" aria-hidden="true" /> Tutoriales interactivos
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {TUTORIALS.map((tutorial) => {
            const TutorialIcon = tutorial.icon;
            return (
              <button
                key={tutorial.destination}
                type="button"
                onClick={() => navigate(tutorial.destination)}
                className="nx-fluid-press nx-canvas-card nx-canvas-text group min-h-tap p-5 text-left transition-colors hover:bg-[var(--nx-canvas-subtle)] hover:border-[var(--nx-positive-border)]"
              >
                <div className="mb-2 flex items-center gap-3">
                  <div className={`nx-tone-${tutorial.tone}-bg nx-tone-${tutorial.tone} flex h-10 w-10 shrink-0 items-center justify-center rounded-control`}>
                    <TutorialIcon size={20} aria-hidden="true" />
                  </div>
                  <h3 className="nx-canvas-text font-bold">{tutorial.title}</h3>
                </div>
                <p className="nx-canvas-muted mb-3 text-sm">{tutorial.description}</p>
                <span className="nx-canvas-text flex items-center gap-1 text-sm font-bold">
                  Iniciar tutorial <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* GUÍAS RÁPIDAS */}
      <section aria-labelledby="help-center-guides-title">
        <h2 id="help-center-guides-title" className="nx-canvas-text mb-4 flex items-center gap-2 text-lg font-bold">
          <HandCoins size={20} className="nx-tone-positive" aria-hidden="true" /> Guías rápidas
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {GUIDES.map((g) => (
            <article key={g.title} className="nx-canvas-card p-5">
              <div className="mb-3 flex items-center gap-3">
                <div className="nx-tone-neutral-bg nx-tone-neutral flex h-9 w-9 shrink-0 items-center justify-center rounded-control" aria-hidden="true">
                  {g.icon}
                </div>
                <h3 className="nx-canvas-text text-sm font-bold">{g.title}</h3>
              </div>
              <ol className="space-y-1.5">
                {g.steps.map((s, i) => (
                  <li key={i} className="nx-canvas-muted flex gap-2 text-sm">
                    <span className="nx-tone-positive shrink-0 font-bold">{i + 1}.</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
            </article>
          ))}
        </div>
        <p className="nx-canvas-faint mt-6 text-xs">
          ¿Necesitás más detalle? El <span className="font-semibold">Manual de Nortex</span> cubre cada módulo
          paso a paso, con las notas fiscales de Nicaragua.
        </p>
      </section>
    </div>
  );
};

export default HelpCenter;
