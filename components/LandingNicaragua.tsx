import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, MapPinned, Shield, Store } from 'lucide-react';
import { PublicFooter, PublicThemeFrame, PublicTopBar } from './public/PublicChrome';

const REGISTER_SOURCE = 'landing_nicaragua';

const capabilities = [
  'Facturación Serie A/B y operación diaria dentro de la misma experiencia.',
  'Inventario, caja, ventas y cobranza con una lectura clara para el equipo.',
  'Planilla y cálculos laborales reunidos con el resto de la operación.',
  'Acceso desde computadora, tableta o teléfono con modo día y modo noche.',
];

const LandingNicaragua: React.FC = () => {
  const [email, setEmail] = useState('');
  const navigate = useNavigate();

  const handleCTA = (event?: React.FormEvent) => {
    event?.preventDefault();
    const params = new URLSearchParams({ source: REGISTER_SOURCE });
    if (email.trim()) params.set('email', email.trim());
    navigate(`/register?${params.toString()}`);
  };

  return (
    <PublicThemeFrame>
      {({ theme, toggleTheme }) => (
        <>
          <a
            href="#public-main-content"
            className="nx-public-primary sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-modal focus:min-h-[44px] focus:px-5"
          >
            Saltar al contenido
          </a>

          <PublicTopBar
            theme={theme}
            onToggle={toggleTheme}
            eyebrow="Nicaragua"
            actions={[
              { to: '/login', label: 'Entrar', kind: 'link', className: 'hidden md:inline-flex' },
              { to: '/register?source=landing_nicaragua', label: 'Crear cuenta', mobileLabel: 'Crear', kind: 'primary' },
            ]}
          />

          <main id="public-main-content" tabIndex={-1} className="mx-auto flex w-full max-w-[1100px] flex-col gap-12 px-4 py-8 sm:px-6 sm:py-12">
            <section aria-labelledby="nicaragua-hero-title" className="grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(340px,.95fr)] lg:items-center">
              <div className="space-y-5">
                <span className="nx-public-badge inline-flex min-h-[32px] items-center gap-2 px-3 text-sm font-semibold">
                  <MapPinned size={14} aria-hidden="true" />
                  Hecho para PyMES en Nicaragua
                </span>
                <div className="space-y-4">
                  <h1 id="nicaragua-hero-title" className="text-balance text-[clamp(2.45rem,5vw,4.6rem)] font-semibold leading-[1.04] tracking-[-0.045em] text-[color:var(--nx-public-text)]">
                    Facturá, controlá inventario y gestioná tu negocio con más claridad.
                  </h1>
                  <p className="nx-public-reading max-w-[650px] text-[1.04rem]">
                    Nortex reúne punto de venta, inventario, cobranza y equipo para negocios que necesitan trabajar sin repartir la operación entre libretas, hojas de cálculo y mensajes.
                  </p>
                </div>

                <form onSubmit={handleCTA} className="nx-public-card max-w-[620px] p-4 sm:p-5">
                  <label htmlFor="landing-nicaragua-email" className="block text-sm font-semibold text-[color:var(--nx-public-text)]">
                    Correo de trabajo <span className="nx-public-subtle font-normal">(opcional)</span>
                  </label>
                  <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                    <input
                      id="landing-nicaragua-email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      value={email}
                      onChange={event => setEmail(event.target.value)}
                      placeholder="tu@correo.com"
                      className="nx-public-field min-h-[48px] w-full rounded-xl border px-4 text-[16px] outline-none"
                    />
                    <button
                      type="submit"
                      className="nx-public-primary nx-fluid-press inline-flex min-h-[48px] items-center justify-center gap-2 px-5 text-base font-semibold sm:min-w-[188px]"
                    >
                      Empezá gratis
                      <ArrowRight size={16} aria-hidden="true" />
                    </button>
                  </div>
                  <p className="nx-public-subtle mt-3 text-sm">30 días gratis · sin tarjeta · cancelás cuando querás</p>
                </form>
              </div>

              <aside className="nx-public-card p-6 sm:p-7" aria-label="Capacidades de Nortex para Nicaragua">
                <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--nx-public-text)]">
                  <Shield size={16} aria-hidden="true" />
                  Una sola base operativa
                </div>
                <ul className="mt-5 space-y-4">
                  {capabilities.map(item => (
                    <li key={item} className="flex items-start gap-3">
                      <CheckCircle2 size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-[color:var(--nx-public-accent-text)]" />
                      <span className="nx-public-reading text-base">{item}</span>
                    </li>
                  ))}
                </ul>
              </aside>
            </section>

            <section aria-labelledby="nicaragua-operation-title" className="grid gap-4 md:grid-cols-2">
              <article className="nx-public-card p-6 sm:p-7">
                <Store size={20} aria-hidden="true" className="text-[color:var(--nx-public-accent-text)]" />
                <h2 id="nicaragua-operation-title" className="mt-4 text-[1.5rem] font-semibold tracking-[-0.03em] text-[color:var(--nx-public-text)]">
                  Operación conectada
                </h2>
                <p className="nx-public-reading mt-3">
                  La venta actualiza el trabajo que sigue: caja, inventario, cliente y reportes permanecen dentro del mismo sistema.
                </p>
              </article>
              <article className="nx-public-card p-6 sm:p-7">
                <Shield size={20} aria-hidden="true" className="text-[color:var(--nx-public-accent-text)]" />
                <h2 className="mt-4 text-[1.5rem] font-semibold tracking-[-0.03em] text-[color:var(--nx-public-text)]">
                  Entrada coherente
                </h2>
                <p className="nx-public-reading mt-3">
                  Landing, registro y acceso comparten una interfaz legible para que la persona no sienta que cambió de producto al comenzar.
                </p>
              </article>
            </section>

            <section aria-labelledby="nicaragua-closing-title" className="nx-public-card flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-7">
              <div className="max-w-[680px]">
                <p className="text-sm font-semibold text-[color:var(--nx-public-text)]">Siguiente paso</p>
                <h2 id="nicaragua-closing-title" className="mt-2 text-balance text-[1.75rem] font-semibold tracking-[-0.03em] text-[color:var(--nx-public-text)]">
                  Empezá con tus datos y comprobá el flujo real.
                </h2>
                <p className="nx-public-reading mt-2">El correo es opcional: podés continuar directo al registro y completar allí la información de tu negocio.</p>
              </div>
              <button
                type="button"
                onClick={() => handleCTA()}
                className="nx-public-primary nx-fluid-press inline-flex min-h-[48px] items-center justify-center gap-2 px-6 text-base font-semibold sm:min-w-[220px]"
              >
                Crear mi cuenta gratis
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            </section>
          </main>

          <PublicFooter links={[
            { label: 'Para ferreterías', to: '/ferreterias' },
            { label: 'Para farmacias', to: '/farmacias' },
            { label: 'Blog', to: '/blog' },
          ]} />
        </>
      )}
    </PublicThemeFrame>
  );
};

export default LandingNicaragua;
