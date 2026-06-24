import React from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Circle, X, Rocket, ArrowRight, Sparkles, PartyPopper } from 'lucide-react';

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
  const [open, setOpen] = React.useState(false);
  const [showWelcome, setShowWelcome] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(
    () => localStorage.getItem(DISMISS_KEY) === '1'
  );

  const fetchStatus = React.useCallback(async () => {
    try {
      const token = localStorage.getItem('nortex_token');
      const res = await fetch('/api/onboarding', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const json: OnbData = await res.json();
      setData(json);
      // La bienvenida solo se auto-muestra tras registrarse (?welcome=1) y una
      // sola vez por navegador. Quien vuelve a entrar no la ve de nuevo; puede
      // reabrirla desde Ayuda → "Ver mis primeros pasos".
      const welcomeSeen = localStorage.getItem(WELCOME_KEY) === '1';
      const forced = new URLSearchParams(window.location.search).get('welcome') === '1';
      if (forced && !welcomeSeen && !json.allDone) setShowWelcome(true);
    } catch {
      /* silencioso: el onboarding nunca debe romper la app */
    }
  }, []);

  React.useEffect(() => {
    if (isEligible) fetchStatus();
  }, [isEligible, fetchStatus]);

  if (!isEligible || dismissed) return null;
  // Nada que mostrar: sin datos todavía, o ya completó todo (y vio la bienvenida).
  if (!data) return null;
  if (data.allDone && !showWelcome) return null;

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
      {/* ---------- MODAL DE BIENVENIDA ---------- */}
      {showWelcome && (
        <div className="fixed inset-0 z-[60] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200">
            <div className="bg-nortex-900 p-8 relative overflow-hidden">
              <div className="absolute -top-10 -right-10 w-48 h-48 bg-nortex-accent blur-[70px] opacity-25" />
              <div className="relative z-10">
                <div className="w-14 h-14 bg-nortex-accent/20 text-nortex-accent rounded-2xl flex items-center justify-center mb-4">
                  <Rocket size={28} />
                </div>
                <h2 className="text-2xl font-bold text-white">
                  ¡Bienvenido a Nortex{businessName ? `, ${businessName}` : ''}! 🎉
                </h2>
                <p className="text-slate-300 mt-2 text-sm leading-relaxed">
                  Te preparamos una guía de <span className="text-white font-semibold">primeros pasos</span> para
                  que pongas tu negocio a funcionar en minutos. Se va completando sola a medida que usás el sistema.
                </p>
              </div>
            </div>
            <div className="p-6">
              <ul className="space-y-2 mb-6">
                {data.steps.map((s) => (
                  <li key={s.key} className="flex items-center gap-3 text-sm text-slate-600">
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
                  className="flex-1 py-3 text-slate-600 font-bold hover:bg-slate-100 rounded-lg transition-colors"
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

      {/* ---------- LANZADOR FLOTANTE + PANEL ---------- */}
      {/* En móvil lo subimos por encima de la barra inferior (h-16); en desktop, abajo. */}
      <div className="fixed bottom-20 right-5 lg:bottom-5 z-40 print:hidden">
        {open && (
          <div className="mb-3 w-[22rem] max-w-[calc(100vw-2.5rem)] bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200">
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
                <span className="text-xs font-bold text-nortex-900">{pct}%</span>
              </div>
              <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-nortex-accent h-full rounded-full transition-all duration-700"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>

            {data.allDone ? (
              <div className="p-6 text-center">
                <PartyPopper className="mx-auto text-emerald-500 mb-2" size={32} />
                <p className="font-bold text-slate-800">¡Configuración completa!</p>
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
                        s.done ? 'opacity-60' : 'hover:bg-slate-50'
                      }`}
                    >
                      {s.done ? (
                        <CheckCircle2 size={20} className="text-emerald-500 shrink-0" />
                      ) : (
                        <Circle size={20} className="text-slate-300 shrink-0" />
                      )}
                      <span className={`flex-1 text-sm ${s.done ? 'line-through text-slate-400' : 'text-slate-700 font-medium'}`}>
                        {s.label}
                      </span>
                      {!s.done && (
                        <button
                          onClick={() => goTo(s.href)}
                          className="text-xs font-bold text-nortex-900 bg-nortex-accent/15 hover:bg-nortex-accent/30 px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap"
                        >
                          {s.cta}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="px-3 pb-3 flex items-center justify-between">
                  <button onClick={fetchStatus} className="text-xs text-slate-400 hover:text-slate-600 font-medium px-2 py-1">
                    Actualizar
                  </button>
                  <button onClick={dismissChecklist} className="text-xs text-slate-400 hover:text-slate-600 font-medium px-2 py-1">
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
          className="flex items-center gap-2 pl-4 pr-5 py-3 bg-nortex-900 hover:bg-nortex-800 text-white font-bold rounded-full shadow-xl shadow-nortex-900/30 transition-colors"
        >
          <Sparkles size={18} className="text-nortex-accent" />
          <span className="text-sm">Primeros pasos</span>
          <span className="text-xs bg-nortex-accent text-nortex-900 rounded-full px-2 py-0.5 font-extrabold">
            {data.completed}/{data.total}
          </span>
        </button>
      </div>
    </>
  );
};

export default OnboardingHub;
