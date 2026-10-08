import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, ChevronRight, Play, Shield, Store, TrendingUp, Zap } from 'lucide-react';
import { PublicFooter, PublicThemeFrame, PublicTopBar } from './PublicChrome';

const LANDING_ACTIONS = [
  { to: '/login', label: 'Entrar', kind: 'link' as const, className: 'hidden md:inline-flex' },
  { to: '/demo?source=landing_spa&location=nav', label: 'Probar una venta', mobileLabel: 'Probar', kind: 'primary' as const },
];

const problems = [
  'Cierres de caja difíciles de explicar cuando la información queda repartida.',
  'Inventario desactualizado justo cuando llega el cliente al mostrador.',
  'Retenciones, Serie A/B y planilla separadas entre libreta, hojas de cálculo y mensajes.',
];

const outcomes = [
  'Punto de venta, caja e inventario dentro del mismo flujo operativo.',
  'Facturación computarizada y reportes con el contexto del negocio.',
  'Registro y acceso coherentes para que el equipo pueda empezar con menos fricción.',
];

const sectors = [
  {
    title: 'Ferreterías',
    body: 'Mostrador rápido, catálogos extensos y control de inventario sin romper el ritmo del negocio.',
    href: '/ferreterias',
  },
  {
    title: 'Farmacias',
    body: 'Venta, stock y operación diaria con una superficie clara para dependientes y administración.',
    href: '/farmacias',
  },
  {
    title: 'PyMES en Nicaragua',
    body: 'Una base para negocios que necesitan facturar, cobrar y ordenar su operación cotidiana.',
    href: '/nicaragua',
  },
];

const previewCards = [
  { label: 'Caja', value: 'Abierta', meta: 'Cierre de turno disponible' },
  { label: 'Ventas', value: 'Al día', meta: 'Mostrador y entrega conectados' },
  { label: 'Inventario', value: 'Visible', meta: 'Alertas para revisar' },
  { label: 'Equipo', value: 'Conectado', meta: 'Accesos por usuario' },
];

const PublicHomePage: React.FC = () => (
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
          eyebrow="Inicio"
          actions={LANDING_ACTIONS}
        />

        <main id="public-main-content" tabIndex={-1} className="mx-auto flex w-full max-w-[1100px] flex-col gap-12 px-4 py-8 sm:px-6 sm:py-12">
          <section aria-labelledby="public-home-title" className="grid items-center gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(340px,.95fr)] lg:gap-8">
            <div className="space-y-5">
              <span className="nx-public-badge inline-flex min-h-[32px] items-center gap-2 px-3 text-sm font-semibold">
                <Zap size={14} aria-hidden="true" />
                Hecho para operar en Nicaragua
              </span>
              <div className="space-y-4">
                <h1 id="public-home-title" className="text-balance text-[clamp(2.6rem,6vw,4.8rem)] font-semibold leading-[1.02] tracking-[-0.045em] text-[color:var(--nx-public-text)]">
                  Tu negocio ya se mueve.
                  <span className="block">Ahora necesita un sistema claro.</span>
                </h1>
                <p className="nx-public-reading max-w-[620px] text-[1.06rem]">
                  Nortex reúne venta, caja, inventario y reportes operativos en una experiencia más limpia. Podés probar una venta, entrar a tu cuenta y decidir con el flujo real.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Link
                  to="/demo?source=landing_spa&location=hero"
                  className="nx-public-primary nx-fluid-press inline-flex min-h-[48px] items-center justify-center gap-2 px-6 text-base font-semibold"
                >
                  <Play size={16} aria-hidden="true" fill="currentColor" />
                  Probar una venta
                </Link>
                <Link
                  to="/register?source=landing_spa&location=hero"
                  className="nx-public-secondary nx-fluid-press inline-flex min-h-[48px] items-center justify-center gap-2 px-6 text-base font-semibold"
                >
                  Crear cuenta gratis
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </div>
              <p className="nx-public-subtle text-sm">30 días gratis · sin tarjeta · modo día o noche con un solo botón</p>
            </div>

            <aside className="nx-public-card overflow-hidden p-5 sm:p-6" aria-label="Vista ilustrativa del panel operativo">
              <div className="nx-public-preview-header flex items-start justify-between gap-3 border-b pb-4">
                <div>
                  <p className="text-sm font-semibold text-[color:var(--nx-public-text)]">Panel operativo</p>
                  <p className="nx-public-subtle text-sm">Una vista simple de lo que el equipo necesita seguir.</p>
                </div>
                <span className="nx-public-badge shrink-0">Ejemplo</span>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {previewCards.map(item => (
                  <div key={item.label} className="nx-public-preview-card rounded-2xl border p-4">
                    <p className="nx-public-subtle text-xs uppercase tracking-[0.12em]">{item.label}</p>
                    <p className="mt-2 text-xl font-semibold tracking-[-0.03em] text-[color:var(--nx-public-text)]">{item.value}</p>
                    <p className="nx-public-muted mt-1 text-sm">{item.meta}</p>
                  </div>
                ))}
              </div>
            </aside>
          </section>

          <section aria-label="Problema y solución" className="grid gap-4 lg:grid-cols-2">
            <article className="nx-public-card p-6 sm:p-7">
              <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--nx-public-text)]">
                <Store size={16} aria-hidden="true" />
                Hoy
              </div>
              <ul className="mt-5 space-y-4">
                {problems.map(item => (
                  <li key={item} className="flex items-start gap-3">
                    <span aria-hidden="true" className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-[color:var(--nx-danger)]" />
                    <span className="nx-public-reading text-base">{item}</span>
                  </li>
                ))}
              </ul>
            </article>

            <article className="nx-public-card p-6 sm:p-7">
              <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--nx-public-text)]">
                <Shield size={16} aria-hidden="true" />
                Con Nortex
              </div>
              <ul className="mt-5 space-y-4">
                {outcomes.map(item => (
                  <li key={item} className="flex items-start gap-3">
                    <CheckCircle2 size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-[color:var(--nx-public-accent-text)]" />
                    <span className="nx-public-reading text-base">{item}</span>
                  </li>
                ))}
              </ul>
            </article>
          </section>

          <section aria-labelledby="public-sectors-title" className="space-y-4">
            <div className="max-w-[720px] space-y-2">
              <span className="nx-public-badge">Rutas de entrada</span>
              <h2 id="public-sectors-title" className="text-balance text-[clamp(2rem,4vw,3rem)] font-semibold tracking-[-0.035em] text-[color:var(--nx-public-text)]">
                Elegí la entrada que más se parece a tu negocio.
              </h2>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {sectors.map(item => (
                <Link key={item.href} to={item.href} className="nx-public-card nx-fluid-press group flex min-h-[220px] flex-col justify-between p-6">
                  <div className="space-y-3">
                    <h3 className="text-xl font-semibold tracking-[-0.025em] text-[color:var(--nx-public-text)]">{item.title}</h3>
                    <p className="nx-public-reading text-[0.98rem]">{item.body}</p>
                  </div>
                  <span className="nx-public-link mt-6 inline-flex items-center gap-1 text-sm">
                    Ver ruta
                    <ChevronRight size={14} aria-hidden="true" />
                  </span>
                </Link>
              ))}
            </div>
          </section>

          <section aria-labelledby="public-next-title" className="nx-public-card flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-7">
            <div className="max-w-[680px]">
              <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--nx-public-text)]">
                <TrendingUp size={16} aria-hidden="true" />
                Próximo paso
              </div>
              <h2 id="public-next-title" className="mt-2 text-balance text-[1.8rem] font-semibold tracking-[-0.03em] text-[color:var(--nx-public-text)]">
                Entrá, probá y decidí con el producto real.
              </h2>
              <p className="nx-public-reading mt-2">
                Nortex Capital continúa en desarrollo. Hoy Nortex no promete ni pre-aprueba crédito; el valor disponible está en la operación diaria: vender, cuadrar caja, ordenar inventario y seguir trabajando con menos fricción.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:min-w-[240px]">
              <Link
                to="/login"
                className="nx-public-secondary nx-fluid-press inline-flex min-h-[48px] items-center justify-center px-5 text-base font-semibold"
              >
                Entrar a mi cuenta
              </Link>
              <Link
                to="/register?source=landing_spa&location=closing"
                className="nx-public-primary nx-fluid-press inline-flex min-h-[48px] items-center justify-center gap-2 px-5 text-base font-semibold"
              >
                Empezar hoy
                <ChevronRight size={16} aria-hidden="true" />
              </Link>
            </div>
          </section>
        </main>

        <PublicFooter />
      </>
    )}
  </PublicThemeFrame>
);

export default PublicHomePage;
