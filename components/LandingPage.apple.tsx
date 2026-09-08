import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle, Shield, Zap, TrendingUp, ChevronRight, Play, X } from 'lucide-react';

/**
 * Nortex Landing — Apple HIG LIGHT (apple.com style)
 * Mantiene fondo claro, minimal, SF-like, jerarquía Apple, sin Obsidian oscuro.
 * Skills: ios-design-guidelines (44pt, safe-area), apple-human-interface-guidelines (Hierarchy/Harmony/Consistency)
 */
const LandingPageApple: React.FC = () => {
  return (
    <div className="min-h-screen bg-[#ececf0] font-sans text-[#1d1d1f] selection:bg-[#0071e3] selection:text-white antialiased">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-full focus:bg-slate-900 focus:px-4 focus:py-2 focus:text-white focus:outline-none">
        Saltar al contenido
      </a>

      {/* NAVBAR — Apple style: gris cálido translúcido, menos quemado */}
      <nav aria-label="Navegación principal" className="fixed top-0 w-full z-50 border-b border-black/[0.08] bg-[#ececf0]/85 supports-[backdrop-filter]:backdrop-blur-xl supports-[backdrop-filter]:bg-[#ececf0]/70">
        <div className="max-w-[980px] mx-auto px-6 h-[44px] flex items-center justify-between">
          <Link to="/" aria-label="Nortex, inicio" className="flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3] rounded">
            <div className="w-7 h-7 bg-slate-900 rounded-md flex items-center justify-center text-white font-semibold text-sm">N</div>
            <span className="text-[19px] font-semibold tracking-[-0.02em] text-slate-900">Nortex</span>
          </Link>
          <div className="flex items-center gap-6">
            <Link to="/login" className="min-h-[44px] inline-flex items-center text-[12px] font-medium text-slate-600 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3] rounded">
              Entrar
            </Link>
            <Link to="/demo?source=landing_spa&location=nav" className="min-h-[32px] inline-flex items-center justify-center px-4 rounded-full bg-[#0071e3] text-white text-[12px] font-medium hover:bg-[#0077ed] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3] transition-colors">
              Probar
            </Link>
          </div>
        </div>
      </nav>

      {/* HERO — apple.com: tipografía display, tracking tight, sin glows */}
      <main id="main-content" className="pt-[88px] pb-12 px-6 max-w-[980px] mx-auto text-center">
        <div className="inline-flex items-center gap-1.5 text-[12px] font-semibold tracking-wide text-[#bf4800]">
          <Zap size={12} aria-hidden /> Hecho para PyMES en Nicaragua
        </div>
        <h1 className="mt-4 text-balance text-[40px] sm:text-[48px] font-semibold tracking-[-0.03em] leading-[1.05] text-slate-900">
          No más libretas.
          <span className="block font-semibold text-slate-900">Control total de tu negocio.</span>
        </h1>
        <p className="mt-4 text-[19px] leading-[1.42] font-normal text-slate-600 max-w-[600px] mx-auto text-balance">
          Facturación DGI, Kardex Inteligente y Planillas (Ley 185). Para ferreterías y farmacias que quieren crecer sin estrés.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link to="/demo?source=landing_spa&location=hero" className="w-full sm:w-auto inline-flex items-center justify-center gap-2 min-h-[44px] px-6 rounded-full bg-[#0071e3] text-white text-[17px] font-normal hover:bg-[#0077ed] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3] transition-colors">
            <Play size={16} fill="currentColor" aria-hidden /> Probar una venta
          </Link>
          <Link to="/register?source=landing_spa&location=hero" className="w-full sm:w-auto inline-flex items-center justify-center gap-1 min-h-[44px] px-6 rounded-full text-[#06c] text-[17px] font-normal hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3] rounded-full">
            Crear cuenta gratis <ArrowRight size={16} aria-hidden />
          </Link>
        </div>
        <p className="mt-3 text-[12px] text-slate-500">Sin tarjeta. Prueba tu primera venta en 60 segundos.</p>
      </main>

      {/* DOLOR VS SOLUCIÓN — cards suaves, gris cálido reduce quemado */}
      <section aria-labelledby="dolor-title" className="py-12 sm:py-16 bg-[#e8e8ed]">
        <div className="max-w-[980px] mx-auto px-6">
          <h2 id="dolor-title" className="text-center text-[28px] sm:text-[32px] font-semibold tracking-[-0.02em] text-slate-900 text-balance">El descontrol te cuesta dinero cada día.</h2>
          <div className="mt-10 grid md:grid-cols-2 gap-6 items-start">
            <div className="bg-white rounded-[18px] p-7">
              <h3 className="text-[12px] font-semibold tracking-wide text-slate-500 uppercase">Hoy</h3>
              <ul role="list" className="mt-4 space-y-3">
                {[
                  'Cierres de caja que nunca cuadran.',
                  'Multas DGI por retenciones a mano.',
                  'Horas calculando aguinaldos.',
                  'Stock agotado sin aviso.',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3 text-[14px] leading-6 text-slate-700">
                    <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-white rounded-[18px] p-7 border border-black/[0.04]">
              <h3 className="flex items-center gap-2 text-[12px] font-semibold tracking-wide text-slate-900 uppercase">
                <Shield size={14} aria-hidden className="text-[#0071e3]" /> Con Nortex
              </h3>
              <ul role="list" className="mt-4 space-y-3">
                {[
                  'Cierres ciegos a prueba de faltantes.',
                  'Facturación Serie A/B y reporte DGI a un clic.',
                  'Nómina Ley 185 automatizada.',
                  'Oráculo que avisa antes del quiebre.',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3 text-[14px] leading-6 text-slate-900">
                    <CheckCircle size={16} aria-hidden className="mt-0.5 shrink-0 text-[#0071e3]" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* BOOST — gris cálido, no blanco puro */}
      <section aria-labelledby="boost-title" className="py-16 sm:py-20 bg-[#ececf0] border-t border-black/[0.06]">
        <div className="max-w-[980px] mx-auto px-6 text-center">
          <div className="mx-auto w-10 h-10 rounded-full bg-[#f5f5f7] flex items-center justify-center">
            <TrendingUp size={18} aria-hidden className="text-slate-700" />
          </div>
          <h2 id="boost-title" className="mt-4 text-[28px] font-semibold tracking-[-0.02em] text-slate-900">Tu buena facturación te abre puertas.</h2>
          <p className="mt-3 text-[17px] leading-6 text-slate-600 max-w-[640px] mx-auto text-balance">
            <strong className="font-semibold text-slate-900">Nortex Capital está en desarrollo.</strong> La meta es que tu historial te ayude a solicitar capital cuando el servicio esté disponible. <span className="text-slate-500">Hoy no promete ni pre-aprueba crédito.</span>
          </p>
          <Link to="/register" className="mt-6 inline-flex min-h-[44px] items-center justify-center gap-1.5 px-6 rounded-full bg-[#0071e3] text-white text-[17px] hover:bg-[#0077ed] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]">
            Empieza hoy <ChevronRight size={18} aria-hidden />
          </Link>
        </div>
      </section>

      <footer className="bg-[#e8e8ed] border-t border-black/[0.06] py-8">
        <div className="max-w-[980px] mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-[12px] text-slate-500">
          <span>Nortex Inc. © {new Date().getFullYear()} — Hecho para Nicaragua.</span>
          <nav aria-label="Legal" className="flex gap-4">
            <Link to="/privacy" className="hover:underline hover:text-slate-700">Privacidad</Link>
            <Link to="/terms" className="hover:underline hover:text-slate-700">Términos</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
};

export default LandingPageApple;
