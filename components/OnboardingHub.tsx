import React from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Circle, X, Rocket, ArrowRight, Sparkles, PartyPopper, RefreshCw } from 'lucide-react';
import { trackEvent } from '../utils/analytics';

/**
 * OnboardingHub — onboarding guiado de activación.
 *
 * - Modal de bienvenida la primera vez (tras registrarse).
 * - Checklist flotante de "Primeros pasos" que se AUTO-COMPLETA: los hitos los
 *   deriva el backend (GET /api/onboarding) de los datos reales del negocio, así
 *   que no hay nada que marcar a mano. Se ramifica por tipo de negocio.
 *
 * Diseño: las banderas cosméticas (bienvenida vista / descartado) viven en
 * localStorage, igual que el resto del estado de la app. Sin migraciones de BD.
 * Solo lo ven el Dueño/Admin (las tareas de configuración son de ese nivel).
 */

interface OnbStep {
  key: string;
  label: string;
  done: boolean;
  href: string;
  cta: string;
}
interface OnbData {
  type: string;
  businessName: string;
  steps: OnbStep[];
  completed: number;
  total: number;
  allDone: boolean;
}

const WELCOME_KEY = 'nortex_onb_welcome';
const DISMISS_KEY = 'nortex_onb_dismissed';

/** Lee rol y tipo de negocio del usuario guardado, sin reventar si falta algo. */
function readUser(): { role: string; type: string; businessName: string } {
  try {
    const u = JSON.parse(localStorage.getItem('nortex_user') || '{}');
    return {
      role: u?.role || '',
      type: u?.tenant?.type || '',
      businessName: u?.tenant?.businessName || u?.tenant?.name || '',
    };
  } catch {
    return { role: '', type: '', businessName: '' };
  }
}

const OnboardingHub: React.FC = () => {
  const navigate = useNavigate();
  const { role, businessName } = React.useMemo(readUser, []);
  const isEligible = role === 'OWNER' || role === 'ADMIN';

  const [data, setData] = React.useState<OnbData | null>(null);
  const [fetchFailed, setFetchFailed] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [showWelcome, setShowWelcome] = React.useState(false);
  // 🎉 Cierre del loop "aha": cuando la primera venta se detecta en vivo.
  const [celebration, setCelebration] = React.useState<string | null>(null);
  const [dismissed, setDismissed] = React.useState(
    () => localStorage.getItem(DISMISS_KEY) === '1'
  );
  // Estado anterior, para detectar transiciones (pasos que se completan en vivo).
  const prevStepsRef = React.useRef<Map<string, boolean> | null>(null);

  const fetchStatus = React.useCallback(async () => {
    try {
      const token = localStorage.getItem('nortex_token');
      const res = await fetch('/api/onboarding', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { setFetchFailed(true); return; }
      const json: OnbData = await res.json();
      setFetchFailed(false);

      // Transiciones: pasos que ACABAN de completarse (vs el fetch anterior).
      const prev = prevStepsRef.current;
      if (prev) {
        for (const s of json.steps) {
          if (s.done && prev.get(s.key) === false) {
            trackEvent('onboarding_step_done', { step: s.key });
            if (s.key === 'sale') {
              // La primera venta es EL momento del producto: se celebra en vivo.
              setCelebration('🎉 ¡Tu primera venta quedó registrada! El ticket, la caja y el inventario ya se movieron solos.');
              trackEvent('first_sale', {});
            }
            if (s.key === 'product') trackEvent('first_product', {});
          }
        }
      }
      prevStepsRef.current = new Map(json.steps.map((s) => [s.key, s.done]));
      setData(json);

      // Bienvenida: se muestra al llegar con ?welcome=1 (registro) O cuando el
      // negocio no completó NINGÚN paso — el hilo de ?welcome=1 era frágil (se
      // perdía si no tocaban "Continuar" o entraban por login) y dejaba al
      // usuario nuevo sin guía. Una sola vez por navegador, saltable siempre.
      const welcomeSeen = localStorage.getItem(WELCOME_KEY) === '1';
      const forced = new URLSearchParams(window.location.search).get('welcome') === '1';
      if ((forced || json.completed === 0) && !welcomeSeen && !json.allDone) {
        setShowWelcome(true);
        trackEvent('onboarding_shown', { forced });
      }
    } catch {
      // Sin red / error: NO desaparecemos en silencio — dejamos rastro visible
      // (botón de reintento) en vez de fingir que el onboarding no existe.
      setFetchFailed(true);
    }
  }, []);

  React.useEffect(() => {
    if (isEligible) fetchStatus();
  }, [isEligible, fetchStatus]);

  // El POS (y cualquier pantalla) avisa "cambió la data" tras una venta/alta →
  // el checklist se refresca EN VIVO, sin esperar un remount del Layout.
  React.useEffect(() => {
    if (!isEligible) return;
    const onChange = () => fetchStatus();
    window.addEventListener('nortex:data-changed', onChange);
    return () => window.removeEventListener('nortex:data-changed', onChange);
  }, [isEligible, fetchStatus]);

  // Auto-ocultar la celebración a los 7s.
  React.useEffect(() => {
    if (!celebration) return;
    const t = setTimeout(() => setCelebration(null), 7000);
    return () => clearTimeout(t);
  }, [celebration]);

  if (!isEligible || dismissed) return null;

  // Falló el fetch y no tenemos nada: rastro mínimo con reintento (antes: nada).
  if (!data) {
    if (!fetchFailed) return null; // cargando: sin parpadeos
    return (
      <div className="fixed top-[4.5rem] right-4 lg:right-6 z-sticky print:hidden">
        <button
          onClick={fetchStatus}
          className="flex items-center gap-2 px-4 py-3 bg-surface-900 border border-white/[0.08] text-slate-300 font-bold rounded-full shadow-xl hover:text-white transition-colors"
          title="No pudimos cargar tus primeros pasos"
        >
          <RefreshCw size={16} />
          <span className="text-sm">Primeros pasos — reintentar</span>
        </button>
      </div>
    );
  }
  if (data.allDone && !showWelcome && !celebration) return null;

  const closeWelcome = (startTour: boolean) => {
    localStorage.setItem(WELCOME_KEY, '1');
    setShowWelcome(false);
    if (startTour) setOpen(true);
  };

  const dismissChecklist = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
    setOpen(false);
  };

  const goTo = (href: string) => {
    setOpen(false);
    navigate(href);
  };

  const pct = data.total ? Math.round((data.completed / data.total) * 100) : 0;

  return (
    <>
      {/* ---------- 🎉 CELEBRACIÓN EN VIVO (primera venta) ---------- */}
      {celebration && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[70] max-w-md w-[calc(100vw-2rem)] print:hidden animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="bg-surface-900 border border-emerald-500/40 rounded-2xl shadow-2xl shadow-emerald-500/10 p-4 flex items-start gap-3">
            <PartyPopper size={24} className="text-emerald-400 shrink-0 mt-0.5" />
            <p className="text-sm text-slate-100 leading-relaxed flex-1">{celebration}</p>
            <button onClick={() => setCelebration(null)} className="text-slate-500 hover:text-white transition-colors shrink-0">
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ---------- MODAL DE BIENVENIDA ---------- */}
      {showWelcome && (
        <div className="fixed inset-0 z-[60] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-surface-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-white/[0.06]">
            <div className="bg-nortex-900 p-8 relative overflow-hidden">
              <div className="absolute -top-10 -right-10 w-48 h-48 bg-nortex-accent blur-[70px] opacity-25" />
              <div className="relative z-10">
                <div className="w-14 h-14 bg-nortex-accent/20 text-nortex-accent rounded-2xl flex items-center justify-center mb-4">
                  <Rocket size={28} />
                </div>
                <h2 className="text-2xl font-bold text-white">
                  ¡Bienvenido a Nortex{businessName ? `, ${businessName}` : ''}!                 </h2>
                <p className="text-slate-300 mt-2 text-sm leading-relaxed">
                  Te preparamos una guía de <span className="text-white font-semibold">primeros pasos</span> para
                  que pongas tu negocio a funcionar en minutos. Se va completando sola a medida que usás el sistema.
                </p>
              </div>
            </div>
            <div className="p-6">
              <ul className="space-y-2 mb-6">
                {data.steps.map((s) => (
                  <li key={s.key} className="flex items-center gap-3 text-sm text-slate-300">
                    {s.done ? (
                      <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />
                    ) : (
                      <Circle size={18} className="text-slate-300 shrink-0" />
                    )}
                    <span className={s.done ? 'line-through text-slate-400' : ''}>{s.label}</span>
                  </li>
                ))}
              </ul>
              <div className="flex gap-3">
                <button
                  onClick={() => closeWelcome(false)}
                  className="flex-1 py-3 text-slate-300 font-bold hover:bg-white/[0.06] rounded-lg transition-colors"
                >
                  Ahora no
                </button>
                <button
                  onClick={() => closeWelcome(true)}
                  className="flex-1 py-3 bg-nortex-900 hover:bg-nortex-800 text-white font-bold rounded-lg shadow-lg transition-colors flex items-center justify-center gap-2"
                >
                  Empezar <ArrowRight size={18} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------- LANZADOR + PANEL ---------- */}
      {/* Anclado BAJO EL HEADER, no abajo a la derecha: ahí se superponía al
          botón EFECTIVO del POS y cortaba el texto de CRÉDITO. La zona de cobro
          es intocable — por eso z-sticky (10), por debajo de --nx-z-checkout (20).
          Ningún flotante persistente puede vivir encima del cobro. */}
      <div className="fixed top-[4.5rem] right-4 lg:right-6 z-sticky print:hidden flex flex-col items-end">
        {open && (
          <div className="order-2 mt-3 w-[22rem] max-w-[calc(100vw-2.5rem)] bg-surface-900 rounded-card shadow-2xl border border-white/[0.06] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="bg-nortex-900 px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2 text-white">
                <Sparkles size={18} className="text-nortex-accent" />
                <span className="font-bold">Primeros pasos</span>
              </div>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-white transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="px-5 pt-4">
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                  {data.completed} de {data.total} completados
                </span>
                <span className="text-xs font-bold text-slate-100">{pct}%</span>
              </div>
              <div className="w-full bg-white/[0.04] h-2 rounded-full overflow-hidden">
                <div
                  className="bg-nortex-accent h-full rounded-full transition-all duration-700"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>

            {data.allDone ? (
              <div className="p-6 text-center">
                <PartyPopper className="mx-auto text-emerald-500 mb-2" size={32} />
                <p className="font-bold text-slate-100">¡Configuración completa!</p>
                <p className="text-sm text-slate-500 mt-1">Tu negocio ya está listo para operar.</p>
                <button
                  onClick={dismissChecklist}
                  className="mt-4 px-4 py-2 bg-nortex-900 text-white text-sm font-bold rounded-lg hover:bg-nortex-800 transition-colors"
                >
                  Listo
                </button>
              </div>
            ) : (
              <>
                <ul className="p-3 space-y-1 max-h-[22rem] overflow-y-auto">
                  {data.steps.map((s) => (
                    <li
                      key={s.key}
                      className={`flex items-center gap-3 p-2.5 rounded-xl ${
                        s.done ? 'opacity-60' : 'hover:bg-surface-800/40'
                      }`}
                    >
                      {s.done ? (
                        <CheckCircle2 size={20} className="text-emerald-500 shrink-0" />
                      ) : (
                        <Circle size={20} className="text-slate-300 shrink-0" />
                      )}
                      <span className={`flex-1 text-sm ${s.done ? 'line-through text-slate-400' : 'text-slate-200 font-medium'}`}>
                        {s.label}
                      </span>
                      {!s.done && (
                        <button
                          onClick={() => goTo(s.href)}
                          className="text-xs font-bold text-slate-100 bg-nortex-accent/15 hover:bg-nortex-accent/30 px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap"
                        >
                          {s.cta}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="px-3 pb-3 flex items-center justify-between">
                  <button onClick={fetchStatus} className="text-xs text-slate-400 hover:text-slate-300 font-medium px-2 py-1">
                    Actualizar
                  </button>
                  <button onClick={dismissChecklist} className="text-xs text-slate-400 hover:text-slate-300 font-medium px-2 py-1">
                    No mostrar más
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        <button
          onClick={() => {
            const next = !open;
            setOpen(next);
            if (next) fetchStatus();
          }}
          className="order-1 flex items-center gap-2 pl-4 pr-5 h-touch bg-surface-800 hover:bg-surface-700 text-white font-semibold rounded-pill shadow-premium border border-white/[0.08] transition-colors"
        >
          <Sparkles size={18} className="text-nortex-accent" />
          <span className="text-sm">Primeros pasos</span>
          <span className="text-xs bg-nortex-accent text-slate-100 rounded-full px-2 py-0.5 font-extrabold">
            {data.completed}/{data.total}
          </span>
        </button>
      </div>
    </>
  );
};

export default OnboardingHub;
