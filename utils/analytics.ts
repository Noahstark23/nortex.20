/**
 * NORTEX — Wrapper tipado sobre gtag (GA4 G-Q1L0ZWF7SM).
 *
 * El script real lo carga `public/analytics.js` (incluido en index.html, la
 * landing y las páginas prerenderizadas), que define `window.gtag` y el helper
 * `window.nxTrack`. Este módulo solo tipa esos globales y expone funciones
 * seguras para el SPA — si el loader no cargó (ad-blocker, red), todo degrada
 * a no-op sin romper la app. NO agrega dependencias (bundle cerca del límite PWA).
 */

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    nxTrack?: (event: string, params?: Record<string, unknown>) => void;
    dataLayer?: unknown[];
  }
}

export const GA4_MEASUREMENT_ID = 'G-Q1L0ZWF7SM';

/**
 * page_view manual para la navegación del SPA (React Router no recarga la
 * página, así que GA4 no lo detecta solo). El page_view del PRIMER load lo envía
 * `gtag('config', …)` en analytics.js — por eso el hook salta su render inicial.
 */
export function trackPageView(path: string): void {
  if (typeof window.gtag !== 'function') return;
  window.gtag('event', 'page_view', {
    page_path: path,
    page_location: window.location.origin + path,
    page_title: document.title,
  });
}

/**
 * Evento de conversión. Reusa `window.nxTrack` (dispara GA4 + Meta Pixel si
 * está configurado); cae a `gtag` directo si el helper no está.
 */
export function trackEvent(name: string, params: Record<string, unknown> = {}): void {
  if (typeof window.nxTrack === 'function') {
    window.nxTrack(name, params);
    return;
  }
  if (typeof window.gtag === 'function') {
    window.gtag('event', name, params);
  }
}
