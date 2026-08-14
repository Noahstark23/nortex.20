/** @type {import('tailwindcss').Config} */

// ============================================================================
// NORTEX — Sistema de diseño (rediseño 2026)
//
// Estrategia (la misma palanca que ya usaba "Obsidian", ahora apuntando a los
// tokens): en vez de tocar ~60 componentes, se REMAPEAN las primitivas que el
// JSX ya usa. Ningún hex vive acá — todo sale de `nortex-tokens.css`, que es la
// fuente única de verdad.
//
// Por qué `rgb(var(--nx-*-rgb) / <alpha-value>)` y no `var(--nx-*)` directo:
// la app usa el modificador de opacidad de Tailwind en 360 lugares
// (`bg-surface-800/40`, `ring-brand-500/50`). Con un hex dentro de var(), esas
// clases generan color inválido y se caen en silencio. El triplete de canales
// es el único formato con el que `/40` sigue funcionando.
//
// Semántica de color, fija y sin excepciones:
//   verde  = acción principal y dinero que ENTRA
//   rojo   = destructivo y dinero que SALE
//   ámbar  = requiere atención
//   neutro = todo lo demás (las cifras NO van coloreadas)
// El arcoíris frío (blue/indigo/sky/cyan/violet/purple) colapsa al verde de
// marca: así desaparece el morado/cian del look genérico sin tocar un componente.
// ============================================================================

/** Helper: token de color con soporte de opacidad de Tailwind. */
const t = (name) => `rgb(var(--nx-${name}-rgb) / <alpha-value>)`;

// Neutros — derivados de las superficies/textos de los tokens.
const neutral = {
    50:  t('neutral-50'),
    100: t('neutral-100'),
    200: t('neutral-200'),
    300: t('neutral-300'),
    400: t('neutral-400'),
    500: t('neutral-500'),
    600: t('neutral-600'),
    700: t('neutral-700'),   // --nx-border-strong
    800: t('neutral-800'),   // --nx-surface-2 (elevado)
    900: t('neutral-900'),   // --nx-surface  (tarjetas, paneles)
    950: t('neutral-950'),   // --nx-bg       (fondo absoluto)
};

// Verde de marca — acción principal y dinero que entra.
const brand = {
    DEFAULT: t('brand'),
    hover:   t('brand-hover'),
    glow:    t('brand-400'),
    soft:    'var(--nx-brand-soft)',
    ring:    'var(--nx-brand-ring)',
    on:      t('on-brand'),
    50:  t('brand-50'),
    100: t('brand-100'),
    200: t('brand-200'),
    300: t('brand-300'),
    400: t('brand-400'),
    500: t('brand-500'),
    600: t('brand-600'),
    700: t('brand-700'),
    800: t('brand-800'),
    900: t('brand-900'),
    950: t('brand-950'),
};

// Semánticos. Escala completa para absorber los `red-*` / `amber-*` existentes
// sin que aparezca un rojo o un ámbar fuera del sistema.
const danger = {
    DEFAULT: t('danger'),
    soft: 'var(--nx-danger-soft)',
    50: t('danger'), 100: t('danger'), 200: t('danger'), 300: t('danger'),
    400: t('danger'), 500: t('danger'), 600: t('danger'), 700: t('danger'),
    800: t('danger'), 900: t('danger'), 950: t('danger'),
};
const warning = {
    DEFAULT: t('warning'),
    soft: 'var(--nx-warning-soft)',
    50: t('warning'), 100: t('warning'), 200: t('warning'), 300: t('warning'),
    400: t('warning'), 500: t('warning'), 600: t('warning'), 700: t('warning'),
    800: t('warning'), 900: t('warning'), 950: t('warning'),
};

export default {
    content: [
        "./index.html",
        "./*.{js,ts,jsx,tsx}",
        "./src/**/*.{js,ts,jsx,tsx}",
        "./components/**/*.{js,ts,jsx,tsx}",
        "./app/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            fontFamily: {
                // Una sola familia en toda la app (tokens: --nx-font).
                sans: ['var(--nx-font)'],
                // Monoespaciada SOLO para SKU y códigos de barras.
                mono: ['var(--nx-font-mono)'],
            },
            spacing: {
                // `pb-safe` (bottom-nav de Layout): en Android con navegación por
                // gestos, sin este inset el sistema se come los últimos ~16px de
                // los botones.
                'safe': 'env(safe-area-inset-bottom)',
            },
            colors: {
                // Superficies y neutros: todo `slate-*`/`surface-*`/`gray-*` del
                // JSX existente cae acá.
                slate: neutral,
                surface: neutral,
                gray: neutral,
                zinc: neutral,
                neutral,
                stone: neutral,

                brand,

                // El arcoíris frío colapsa al verde de marca: sin morado, sin cian.
                blue: brand,
                indigo: brand,
                sky: brand,
                cyan: brand,
                violet: brand,
                purple: brand,
                fuchsia: brand,
                teal: brand,
                // Los dos verdes preexistentes colapsan al mismo verde.
                emerald: brand,
                green: brand,
                lime: brand,

                // Semánticos de uso restringido.
                red: danger,
                rose: danger,
                orange: warning,
                amber: warning,
                yellow: warning,

                nortex: {
                    50:  t('brand-50'),
                    100: t('brand-100'),
                    200: t('brand-200'),
                    300: t('brand-300'),
                    400: t('brand-400'),
                    500: t('brand-500'),
                    600: t('brand-600'),
                    700: t('brand-700'),
                    800: t('neutral-800'),
                    900: t('neutral-950'),  // sidebar: el fondo más profundo
                    accent:  t('brand'),
                    danger:  t('danger'),
                    warning: t('warning'),
                },
            },
            borderRadius: {
                // Solo 3 radios en todo el sistema (tokens): control / card / pill.
                DEFAULT: 'var(--nx-r-control)',
                sm: 'var(--nx-r-control)',
                md: 'var(--nx-r-control)',
                lg: 'var(--nx-r-card)',
                xl: 'var(--nx-r-card)',
                '2xl': 'var(--nx-r-card)',
                '3xl': 'var(--nx-r-card)',
                full: 'var(--nx-r-pill)',
                control: 'var(--nx-r-control)',
                card: 'var(--nx-r-card)',
                pill: 'var(--nx-r-pill)',
            },
            height: {
                compact: 'var(--nx-h-compact)',
                touch: 'var(--nx-h-touch)',
                pay: 'var(--nx-h-pay)',
            },
            minHeight: {
                tap: 'var(--nx-tap-min)',
            },
            minWidth: {
                tap: 'var(--nx-tap-min)',
            },
            fontSize: {
                display: ['var(--nx-fs-display)', { lineHeight: 'var(--nx-lh-display)' }],
                kpi:     ['var(--nx-fs-kpi)', { lineHeight: 'var(--nx-lh-kpi)' }],
                title:   ['var(--nx-fs-title)', { lineHeight: 'var(--nx-lh-title)' }],
            },
            zIndex: {
                content:  'var(--nx-z-content)',
                sticky:   'var(--nx-z-sticky)',
                checkout: 'var(--nx-z-checkout)',
                modal:    'var(--nx-z-modal)',
            },
            transitionTimingFunction: {
                nx: 'cubic-bezier(0.2, 0, 0, 1)',
            },
            boxShadow: {
                // Sombras suaves y difusas — nunca el shadow-md gris duro.
                'premium': '0 4px 24px -6px rgba(0, 0, 0, 0.35), 0 1px 2px rgba(0, 0, 0, 0.25)',
                'premium-light': '0 4px 20px -2px rgba(0, 0, 0, 0.05), 0 0 3px rgba(0, 0, 0, 0.02)',
                'glow': '0 0 20px -5px var(--tw-shadow-color)',
                // Item de nav activo: barra interna, nunca un bloque sólido.
                'nav-active': 'inset 3px 0 0 var(--nx-brand)',
            },
            keyframes: {
                'fade-in-up': {
                    '0%':   { opacity: '0', transform: 'translateY(6px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
                'nx-shimmer': {
                    '100%': { transform: 'translateX(100%)' },
                },
            },
            animation: {
                'fade-in-up': 'fade-in-up 0.25s ease-out both',
                'nx-shimmer': 'nx-shimmer 1.6s infinite',
            },
        },
    },
    plugins: [],
}
