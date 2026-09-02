import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CheckCircle2, Circle, X, Sparkles, PartyPopper, RefreshCw } from 'lucide-react';
import { trackEvent } from '../utils/analytics';
import { fetchOnboardingStatus, type OnboardingStatus, type OnboardingStepStatus } from '../utils/onboardingStatus';
import {
  currentOnboardingStorageKeys,
  isOnboardingFlagSet,
  setOnboardingFlag,
} from '../utils/onboardingStorage';

/**
 * OnboardingHub — onboarding guiado de activación.
 *
 * - Checklist flotante de "Primeros pasos", disponible cuando el usuario lo pide.
 * - Los hitos se AUTO-COMPLETAN: el backend (GET /api/onboarding) los deriva
 *   de los datos reales del negocio, así que no hay nada que marcar a mano.
 *   Se ramifica por tipo de negocio.
 *
 * Diseño: las banderas cosméticas (bienvenida vista / descartado) viven en
 * localStorage, igual que el resto del estado de la app. Sin migraciones de BD.
 * Solo lo ven el Dueño/Admin (las tareas de configuración son de ese nivel).
 */

/** Lee el rol del usuario guardado, sin reventar si falta algo. */
function readRole(): string {
  try {
    const u = JSON.parse(localStorage.getItem('nortex_user') || '{}');
    return u?.role || '';
  } catch {
    return '';
  }
}

const OnboardingHub: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const isPos = location.pathname === '/app/pos';
  const role = React.useMemo(readRole, []);
  const storageKeys = React.useMemo(currentOnboardingStorageKeys, []);
  const isEligible = role === 'OWNER' || role === 'ADMIN';

  const [data, setData] = React.useState<OnboardingStatus | null>(null);
  const [fetchFailed, setFetchFailed] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  // 🎉 Cierre del loop "aha": cuando la primera venta se detecta en vivo.
  const [celebration, setCelebration] = React.useState<string | null>(null);
  const [dismissed, setDismissed] = React.useState(
    () => isOnboardingFlagSet(localStorage, storageKeys?.dismissed)
  );
  // Estado anterior, para detectar transiciones (pasos que se completan en vivo).
  const prevStepsRef = React.useRef<Map<string, boolean> | null>(null);

  const fetchStatus = React.useCallback(async (force = false) => {
    try {
      const token = localStorage.getItem('nortex_token');
      if (!token) { setFetchFailed(true); return; }
      const json = await fetchOnboardingStatus(token, { force });
      setFetchFailed(false);

      // Transiciones: pasos que ACABAN de completarse (vs el fetch anterior).
      const prev = prevStepsRef.current;
      if (prev) {
        for (const s of json.steps) {
          if (s.done && prev.get(s.key) === false) {
            trackEvent('onboarding_step_done', { onboarding_step: s.key });
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

      // Registramos la primera exposición al onboarding sin interrumpir al
      // usuario con un modal. El checklist queda disponible cuando lo necesite.
      // Guardamos la marca antes del evento para que un reintento no lo duplique.
      const welcomeSeen = isOnboardingFlagSet(localStorage, storageKeys?.welcome);
      const forced = new URLSearchParams(window.location.search).get('welcome') === '1';
      if ((forced || json.completed === 0) && !welcomeSeen && !json.allDone) {
        setOnboardingFlag(localStorage, storageKeys?.welcome);
        trackEvent('onboarding_shown', { forced });
      }
    } catch {
      // Sin red / error: NO desaparecemos en silencio — dejamos rastro visible
      // (botón de reintento) en vez de fingir que el onboarding no existe.
      setFetchFailed(true);
    }
  }, [storageKeys]);

  React.useEffect(() => {
    if (isEligible) void fetchStatus();
  }, [isEligible, fetchStatus]);

  // El POS (y cualquier pantalla) avisa "cambió la data" tras una venta/alta →
  // el checklist se refresca EN VIVO, sin esperar un remount del Layout.
  React.useEffect(() => {
    if (!isEligible) return;
    const onChange = () => { void fetchStatus(true); };
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
      <div className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-sticky print:hidden lg:bottom-6 lg:right-6">
        <button
          onClick={() => void fetchStatus(true)}
          className="flex items-center gap-2 px-4 py-3 bg-surface-900 border border-white/[0.08] text-slate-300 font-bold rounded-full shadow-xl hover:text-white transition-colors"
          title="No pudimos cargar tus primeros pasos"
        >
          <RefreshCw size={16} />
          <span className="text-sm">Primeros pasos — reintentar</span>
        </button>
      </div>
    );
  }
  if (data.allDone && !celebration) return null;

  const dismissChecklist = () => {
    setOnboardingFlag(localStorage, storageKeys?.dismissed);
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
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-toast max-w-md w-[calc(100vw-2rem)] print:hidden duration-300 pointer-events-none [&>*]:pointer-events-auto">
          <div className="bg-surface-900 border border-emerald-500/40 rounded-2xl shadow-2xl shadow-emerald-500/10 p-4 flex items-start gap-3">
            <PartyPopper size={24} className="text-emerald-400 shrink-0 mt-0.5" />
            <p className="text-sm text-slate-100 leading-relaxed flex-1">{celebration}</p>
            <button onClick={() => setCelebration(null)} className="text-slate-500 hover:text-white transition-colors shrink-0">
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ---------- LANZADOR + PANEL ---------- */}
      {/* Fuera del POS vive sobre la esquina inferior, dejando libre la franja
          superior donde cada módulo coloca sus acciones principales. En móvil
          sube por encima de la barra de navegación. El POS continúa excluido:
          ningún flotante persistente puede cubrir el cobro. */}
      {!isPos && <div className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-sticky flex flex-col items-end print:hidden lg:bottom-6 lg:right-6">
        {open && (
          <div id="onboarding-steps-panel" className="mb-3 w-[22rem] max-w-[calc(100vw-2.5rem)] overflow-hidden rounded-card border border-white/[0.06] bg-surface-900 shadow-2xl duration-200">
            <div className="bg-nortex-900 px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2 text-white">
                <Sparkles size={18} className="text-nortex-accent" />
                <span className="font-bold">Primeros pasos</span>
              </div>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-white transition-colors" aria-label="Cerrar primeros pasos">
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
                  {data.steps.map((s: OnboardingStepStatus) => (
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
                  <button onClick={() => void fetchStatus(true)} className="text-xs text-slate-400 hover:text-slate-300 font-medium px-2 py-1">
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
            if (next) void fetchStatus(true);
          }}
          aria-expanded={open}
          aria-controls="onboarding-steps-panel"
          className="flex h-touch items-center gap-2 rounded-pill border border-white/[0.08] bg-surface-800 pl-4 pr-5 font-semibold text-white shadow-premium transition-colors hover:bg-surface-700"
        >
          <Sparkles size={18} className="text-nortex-accent" />
          {/* En móvil la píldora se encoge a ícono+contador: con el texto
              completo tapaba controles reales (el botón Agregar del POS, la
              tarjeta VALOR de Inventario — auditoría de uso real en 390px). */}
          <span className="text-sm hidden md:inline">Primeros pasos</span>
          <span className="text-xs bg-nortex-accent text-slate-100 rounded-full px-2 py-0.5 font-extrabold">
            {data.completed}/{data.total}
          </span>
        </button>
      </div>}
    </>
  );
};

export default OnboardingHub;
