import React, { useState } from 'react';
import PracticeExercise, { type PracticeKind } from './learning/PracticeExercise';
import { trackEvent } from '../utils/analytics';
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
 * - Prácticas aisladas con ejemplos y guías junto al trabajo real.
 * - Los enlaces ?tour existentes abren la guía del módulo, sin overlay.
 * - Guías rápidas por tema (resumen del Manual de Nortex).
 * - Botón para volver a mostrar el checklist de "Primeros pasos".
 */

interface QuickGuide {
  icon: React.ReactNode;
  title: string;
  steps: string[];
}

interface InteractiveTutorial {
  practice: 'pos' | PracticeKind;
  icon: LucideIcon;
  title: string;
  description: string;
  destination: string;
  tone: 'info' | 'positive' | 'warning' | 'neutral';
}

const TUTORIALS: InteractiveTutorial[] = [
  {
    practice: 'pos',
    icon: ShoppingCart,
    title: 'Cómo hacer una venta',
    description: 'Elegí un producto, cobrá y comprobá el vuelto en una caja de práctica.',
    destination: '/app/pos?tour=pos',
    tone: 'info',
  },
  {
    practice: 'inv',
    icon: Package,
    title: 'Cómo cargar inventario',
    description: 'Creá una ficha de ejemplo y distinguí marca, precio y existencias.',
    destination: '/app/inventory?tour=inv',
    tone: 'positive',
  },
  {
    practice: 'fiado',
    icon: HandCoins,
    title: 'Cómo cobrar el fiado',
    description: 'Registrá un abono de ejemplo y comprobá cuánto queda por pagar.',
    destination: '/app/receivables?tour=fiado',
    tone: 'warning',
  },
  {
    practice: 'compras',
    icon: Truck,
    title: 'Cómo registrar compras',
    description: 'Ensayá una recepción: cantidad, costo, revisión y confirmación.',
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
      'Revisá la confirmación y el ticket; compartilo por los medios disponibles.',
      'Al cerrar el turno hacé el arqueo de caja.',
    ],
  },
  {
    icon: <Package size={18} />,
    title: 'Cargar y controlar inventario',
    steps: [
      'Agregá fichas con “Agregar con cámara”, “Nuevo producto” o importá desde Excel.',
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
      'Revisá la deuda y los movimientos del cliente antes de cobrar.',
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
  const [practice, setPractice] = useState<PracticeKind | null>(null);

  const reshowChecklist = () => {
    clearOnboardingFlags(localStorage, currentOnboardingStorageKeys());
    // El hub relee sus banderas sin recargar la aplicación.
    // A la pantalla de inicio del ROL (antes: siempre /app/dashboard, que para
    // un cajero no es su pantalla).
    let home = '/app/dashboard';
    try {
      const role = JSON.parse(atob((localStorage.getItem('nortex_token') || '').split('.')[1])).role || '';
      const type = JSON.parse(localStorage.getItem('nortex_user') || '{}')?.tenant?.type || '';
      home = homePathFor(role, resolveUiMode(type, localStorage.getItem(UI_MODE_KEY)));
    } catch { /* token ilegible → dashboard */ }
    window.dispatchEvent(new Event('nortex:onboarding-reset'));
    navigate(`${home}?welcome=1`);
  };

  return (
    <div className="nx-workspace mx-auto h-full w-full max-w-[1600px] overflow-y-auto p-4 sm:p-6 lg:p-8">
      <ModuleHeader
        className="mb-8"
        icon={<BookOpen size={20} aria-hidden="true" />}
        title="Ayuda y Tutoriales"
        subtitle="Aprendé haciendo. Primero con ejemplos; después, en tu negocio."
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

      {practice ? <PracticeExercise key={practice} kind={practice} onClose={() => setPractice(null)} onReal={() => navigate(TUTORIALS.find(item => item.practice === practice)!.destination)} /> : <section className="nx-canvas-card p-5 sm:p-7 mb-6" aria-labelledby="learning-start-title">
        <p className="nx-tone-positive text-sm font-bold mb-2">¿Es tu primera vez?</p>
        <h2 id="learning-start-title" className="nx-canvas-text text-2xl sm:text-3xl font-bold">Probá una venta. Sin arriesgar nada.</h2>
        <p className="nx-canvas-muted mt-3 max-w-2xl">Usá productos de ejemplo, agregalos al carrito y practicá el cobro. Tu caja y tu inventario real quedan intactos.</p>
        <button type="button" onClick={() => { trackEvent('activation_practice_started', { source: 'help_center' }); navigate('/demo?source=onboarding'); }} className="nx-fluid-press min-h-tap mt-5 flex items-center gap-2 rounded-control bg-brand px-5 py-3 font-bold text-brand-on"><PlayCircle size={20} aria-hidden="true" /> Practicar una venta</button>
      </section>}
      <section className="mb-8" aria-labelledby="help-center-tutorials-title">
        <h2 id="help-center-tutorials-title" className="nx-canvas-text mb-2 text-lg font-bold">Tutoriales interactivos</h2>
        <p className="nx-canvas-muted text-sm mb-4">Elegí lo que necesitás aprender. Podés equivocarte en la práctica; la guía del negocio te acompaña junto a los controles reales.</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {TUTORIALS.map((tutorial) => {
            const TutorialIcon = tutorial.icon;
            return <article key={tutorial.destination} className="nx-canvas-card p-5">
              <div className="flex items-center gap-3 mb-2">
                <div className={`nx-tone-${tutorial.tone}-bg nx-tone-${tutorial.tone} rounded-control p-2`}><TutorialIcon size={20} aria-hidden="true" /></div>
                <h3 className="nx-canvas-text font-bold">{tutorial.title}</h3>
              </div>
              <p className="nx-canvas-muted text-sm mb-3">{tutorial.description}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" aria-label={`Practicar: ${tutorial.title}`} onClick={() => {
                  trackEvent('tutorial_practice_started', { tutorial: tutorial.practice });
                  if (tutorial.practice === 'pos') navigate('/demo?source=onboarding');
                  else { setPractice(tutorial.practice); }
                }} className="nx-fluid-press nx-tone-positive-bg nx-tone-positive min-h-tap rounded-control px-4 font-bold text-sm">Practicar con ejemplos</button>
                <button type="button" aria-label={`Guía en mi negocio: ${tutorial.title}`} onClick={() => navigate(tutorial.destination)} className="nx-fluid-press nx-canvas-text min-h-tap rounded-control px-3 font-semibold text-sm">Guía en mi negocio <ArrowRight size={15} className="inline" aria-hidden="true" /></button>
              </div>
            </article>;
          })}
        </div>
      </section>

      {/* GUÍAS RÁPIDAS */}
      <section aria-labelledby="help-center-guides-title">
        <h2 id="help-center-guides-title" className="nx-canvas-text mb-4 flex items-center gap-2 text-lg font-bold">
          <HandCoins size={20} className="nx-tone-positive" aria-hidden="true" /> Guías rápidas
        </h2>
        <div className="space-y-2">
          {GUIDES.map((g) => (
            <details key={g.title} className="nx-canvas-card p-4">
              <summary className="nx-canvas-text cursor-pointer min-h-tap flex items-center gap-3">
                <div className="nx-tone-neutral-bg nx-tone-neutral flex h-9 w-9 shrink-0 items-center justify-center rounded-control" aria-hidden="true">
                  {g.icon}
                </div>
                <span className="text-sm font-bold">{g.title}</span>
              </summary>
              <ol className="space-y-1.5 mt-3">
                {g.steps.map((s, i) => (
                  <li key={i} className="nx-canvas-muted flex gap-2 text-sm">
                    <span className="nx-tone-positive shrink-0 font-bold">{i + 1}.</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
            </details>
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
