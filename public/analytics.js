// =============================================================
// Nortex analytics loader
// -------------------------------------------------------------
// Pegá tu Measurement ID de GA4 y/o tu Pixel ID de Meta abajo y
// los tags se activan automáticamente en todas las páginas que
// incluyan este script.
//
// Uso en cada HTML: <script src="/analytics.js" defer></script>
// =============================================================

(function () {
  'use strict';

  var CONFIG = {
    GA4_MEASUREMENT_ID: '',   // p. ej. 'G-XXXXXXXXXX' (Google Analytics 4)
    META_PIXEL_ID:      ''    // p. ej. '123456789012345' (Meta / Facebook Pixel)
  };

  // ---------- Google Analytics 4 ----------
  if (CONFIG.GA4_MEASUREMENT_ID) {
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(CONFIG.GA4_MEASUREMENT_ID);
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    gtag('js', new Date());
    gtag('config', CONFIG.GA4_MEASUREMENT_ID, {
      anonymize_ip: true
    });
  }

  // ---------- Meta Pixel ----------
  if (CONFIG.META_PIXEL_ID) {
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n;
      n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
      t = b.createElement(e); t.async = !0; t.src = v;
      s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', CONFIG.META_PIXEL_ID);
    fbq('track', 'PageView');
  }

  // ---------- Helper para conversiones manuales ----------
  // Uso desde React: window.nxTrack && window.nxTrack('generate_lead', { rubro });
  window.nxTrack = function (eventName, params) {
    params = params || {};
    if (typeof window.gtag === 'function') {
      window.gtag('event', eventName, params);
    }
    if (typeof window.fbq === 'function') {
      window.fbq('trackCustom', eventName, params);
    }
  };

  // ---------- Auto-tracking de CTAs en el landing estático ----------
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a');
    if (!a) return;
    var href = a.getAttribute('href') || '';

    if (href.indexOf('wa.me/') !== -1 || href.indexOf('wa.me%') !== -1) {
      window.nxTrack('whatsapp_click', {
        location: a.getAttribute('data-loc') || 'unknown',
        href: href
      });
    } else if (href === '/register' || href.indexOf('/register?') === 0) {
      window.nxTrack('register_cta_click', {
        location: a.getAttribute('data-loc') || 'unknown'
      });
    }
  }, { passive: true });
})();
