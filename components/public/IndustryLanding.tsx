import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, ChevronRight, Package, Shield } from 'lucide-react';
import { PublicFooter, PublicThemeFrame, PublicTopBar } from './PublicChrome';
import { sectorLandingContent, type SectorKey } from '../../data/sectorLandingContent';

type SectorContent = (typeof sectorLandingContent)[SectorKey];

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
  sector: SectorContent;
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
  sector,
}) => {
  const registerUrl = `/register?type=${industryType}&source=${source}`;

  React.useEffect(() => {
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const previous = { title: document.title, description: description?.content, canonical: canonical?.href };
    document.title = sector.title;
    if (description) description.content = sector.description;
    if (canonical) canonical.href = `https://somosnortex.com${sector.path}`;
    return () => {
      document.title = previous.title;
      if (description && previous.description !== undefined) description.content = previous.description;
      if (canonical && previous.canonical !== undefined) canonical.href = previous.canonical;
    };
  }, [sector]);

  const cta = (location: 'hero' | 'footer') => ({
    'data-sector-cta': sector.key,
    'data-page-kind': 'landing',
    'data-cta-location': location,
  });

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
              { to: registerUrl, label: 'Crear cuenta', mobileLabel: 'Crear', kind: 'primary', sectorCta: { vertical: sector.key, pageKind: 'landing', location: 'nav' } },
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
                    {...cta('hero')}
                    className="nx-public-primary nx-fluid-press inline-flex min-h-[48px] items-center justify-center gap-2 px-6 text-base font-semibold"
                  >
                    {sector.cta}
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

            <section aria-labelledby="sector-journey-title" className="space-y-5">
              <div className="max-w-[760px] space-y-2">
                <span className="nx-public-badge">Recorrido del negocio</span>
                <h2 id="sector-journey-title" className="text-balance text-[clamp(1.9rem,4vw,2.8rem)] font-semibold tracking-[-0.03em] text-[color:var(--nx-public-text)]">{sector.journeyTitle}</h2>
              </div>
              <ol className="grid gap-4 md:grid-cols-3">
                {sector.steps.map((step, index) => (
                  <li key={step.title} className="nx-public-card p-5">
                    <span className="nx-public-badge">Paso {index + 1}</span>
                    <h3 className="mt-3 text-lg font-semibold text-[color:var(--nx-public-text)]">{step.title}</h3>
                    <p className="nx-public-reading mt-2">{step.body}</p>
                  </li>
                ))}
              </ol>
            </section>

            <section aria-labelledby="sector-example-title" className="nx-public-card space-y-4 p-6 sm:p-7">
              <h2 id="sector-example-title" className="text-2xl font-semibold text-[color:var(--nx-public-text)]">Ejemplo para evaluar el recorrido</h2>
              <p className="nx-public-reading max-w-[780px]">{sector.example}</p>
              <p className="nx-public-muted max-w-[780px]">{sector.limit}</p>
              {sector.key === 'farmacia' && (
                <div className="space-y-3 pt-2">
                  <h3 className="text-lg font-semibold text-[color:var(--nx-public-text)]">Recorrido guiado con datos ficticios</h3>
                  <details className="nx-public-surface rounded-2xl border p-4"><summary className="min-h-[44px] cursor-pointer font-semibold">1. Registrar dos lotes</summary><p className="nx-public-reading mt-2">A: 10 unidades, 15/10/2026. B: 8 unidades, 15/12/2026. Registrá lote, fecha y cantidad en Inventario.</p></details>
                  <details className="nx-public-surface rounded-2xl border p-4"><summary className="min-h-[44px] cursor-pointer font-semibold">2. Revisar Avisos</summary><p className="nx-public-reading mt-2">Comprobá si hay lotes próximos a vencer o ya vencidos con existencia. El aviso no retira el lote por sí solo.</p></details>
                  <details className="nx-public-surface rounded-2xl border p-4"><summary className="min-h-[44px] cursor-pointer font-semibold">3. Confirmar venta y consultar Kardex</summary><p className="nx-public-reading mt-2">Si ambos lotes siguen vigentes, FEFO prioriza A. Revisá la salida confirmada y el lote físico.</p></details>
                </div>
              )}
              {'demo' in sector && (
                <div className="pt-2">
                  <h3 className="text-lg font-semibold text-[color:var(--nx-public-text)]">Práctica navegable de mostrador</h3>
                  <p className="nx-public-reading mt-2">Usa productos de ejemplo. Permite buscar, armar carrito y practicar el cobro; no guarda stock ni crédito real.</p>
                  <Link to={sector.demo} className="nx-public-secondary mt-4 inline-flex min-h-[44px] items-center px-5 font-semibold">Abrir práctica de venta</Link>
                </div>
              )}
            </section>

            <section aria-labelledby="sector-guides-title" className="space-y-4">
              <h2 id="sector-guides-title" className="text-2xl font-semibold text-[color:var(--nx-public-text)]">Conocé el proceso</h2>
              <ul className="grid gap-3 sm:grid-cols-2">
                {sector.guides.map(guide => <li key={guide.to}><Link to={guide.to} className="nx-public-card nx-public-link flex min-h-[54px] items-center px-5 font-semibold">{guide.label} <ArrowRight size={16} aria-hidden="true" className="ml-auto shrink-0" /></Link></li>)}
              </ul>
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
                  {...cta('footer')}
                  className="nx-public-primary nx-fluid-press inline-flex min-h-[48px] items-center justify-center gap-2 px-5 text-base font-semibold"
                >
                  {sector.cta}
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
