import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, ChevronRight, Package, Shield } from 'lucide-react';
import { PublicFooter, PublicThemeFrame, PublicTopBar } from './PublicChrome';

interface IndustryLandingProps {
  industryLabel: string;
  industryType: string;
  source: string;
  hero: string;
  intro: string;
  problems: string[];
  modules: string[];
  closingBody: string;
  footerLinks: Array<{ label: string; to: string }>;
}

const IndustryLanding: React.FC<IndustryLandingProps> = ({
  industryLabel,
  industryType,
  source,
  hero,
  intro,
  problems,
  modules,
  closingBody,
  footerLinks,
}) => {
  const registerUrl = `/register?type=${industryType}&source=${source}`;

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
            eyebrow={industryLabel}
            actions={[
              { to: '/login', label: 'Entrar', kind: 'link', className: 'hidden md:inline-flex' },
              { to: registerUrl, label: 'Crear cuenta', mobileLabel: 'Crear', kind: 'primary' },
            ]}
          />

          <main id="public-main-content" tabIndex={-1} className="mx-auto flex w-full max-w-[1100px] flex-col gap-12 px-4 py-8 sm:px-6 sm:py-12">
            <section aria-labelledby="industry-hero-title" className="grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(340px,.95fr)] lg:items-center">
              <div className="space-y-5">
                <span className="nx-public-badge inline-flex min-h-[32px] items-center gap-2 px-3 text-sm font-semibold">
                  <Package size={14} aria-hidden="true" />
                  Para {industryLabel.toLowerCase()} en Nicaragua
                </span>
                <div className="space-y-4">
                  <h1 id="industry-hero-title" className="text-balance text-[clamp(2.45rem,5vw,4.4rem)] font-semibold leading-[1.04] tracking-[-0.045em] text-[color:var(--nx-public-text)]">
                    {hero}
                  </h1>
                  <p className="nx-public-reading max-w-[640px] text-[1.04rem]">{intro}</p>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <Link
                    to={registerUrl}
                    className="nx-public-primary nx-fluid-press inline-flex min-h-[48px] items-center justify-center gap-2 px-6 text-base font-semibold"
                  >
                    Crear mi cuenta gratis
                    <ArrowRight size={16} aria-hidden="true" />
                  </Link>
                  <p className="nx-public-subtle text-sm">30 días gratis · sin tarjeta de crédito</p>
                </div>
              </div>

              <aside className="nx-public-card p-6 sm:p-7" aria-label={`Prioridades para ${industryLabel.toLowerCase()}`}>
                <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--nx-public-text)]">
                  <Shield size={16} aria-hidden="true" />
                  Operación más clara
                </div>
                <ul className="mt-5 space-y-4">
                  {problems.map(item => (
                    <li key={item} className="flex items-start gap-3">
                      <CheckCircle2 size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-[color:var(--nx-public-accent-text)]" />
                      <span className="nx-public-reading text-base">{item}</span>
                    </li>
                  ))}
                </ul>
              </aside>
            </section>

            <section aria-labelledby="industry-functions-title" className="space-y-4">
              <div className="max-w-[720px] space-y-2">
                <span className="nx-public-badge">Operación diaria</span>
                <h2 id="industry-functions-title" className="text-balance text-[clamp(1.9rem,4vw,2.8rem)] font-semibold tracking-[-0.03em] text-[color:var(--nx-public-text)]">
                  Funciones clave para {industryLabel.toLowerCase()}.
                </h2>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {modules.map(item => (
                  <article key={item} className="nx-public-card flex min-h-[140px] items-start gap-3 p-5">
                    <div className="mt-0.5 rounded-2xl bg-[color:var(--nx-public-accent-soft)] p-2 text-[color:var(--nx-public-accent-text)]">
                      <CheckCircle2 size={16} aria-hidden="true" />
                    </div>
                    <p className="nx-public-reading text-[0.98rem]">{item}</p>
                  </article>
                ))}
              </div>
            </section>

            <section aria-labelledby="industry-closing-title" className="nx-public-card flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-7">
              <div className="max-w-[680px]">
                <p className="text-sm font-semibold text-[color:var(--nx-public-text)]">Siguiente paso</p>
                <h2 id="industry-closing-title" className="mt-2 text-balance text-[1.75rem] font-semibold tracking-[-0.03em] text-[color:var(--nx-public-text)]">
                  Conocé Nortex dentro del flujo de {industryLabel.toLowerCase()}.
                </h2>
                <p className="nx-public-reading mt-2">{closingBody}</p>
              </div>
              <div className="flex flex-col gap-3 sm:min-w-[240px]">
                <Link
                  to="/login"
                  className="nx-public-secondary nx-fluid-press inline-flex min-h-[48px] items-center justify-center px-5 text-base font-semibold"
                >
                  Entrar a mi cuenta
                </Link>
                <Link
                  to={registerUrl}
                  className="nx-public-primary nx-fluid-press inline-flex min-h-[48px] items-center justify-center gap-2 px-5 text-base font-semibold"
                >
                  Abrir mi negocio
                  <ChevronRight size={16} aria-hidden="true" />
                </Link>
              </div>
            </section>
          </main>

          <PublicFooter links={footerLinks} />
        </>
      )}
    </PublicThemeFrame>
  );
};

export default IndustryLanding;
