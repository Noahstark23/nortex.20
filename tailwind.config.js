/** @type {import('tailwindcss').Config} */

// ============================================================================
// NORTEX — Sistema de diseño "Obsidian" (anti-SaaS genérico)
//
// Estrategia: en vez de tocar ~30 componentes, se REMAPEAN las primitivas que
// ya usan. `slate` deja de ser el gris azulado default de Tailwind y pasa a
// una escala neutra profunda (obsidiana, estilo Linear/Vercel); `nortex-500`
// deja de ser el azul genérico y pasa al índigo de marca. Resultado: toda la
// app cambia de temperatura sin un solo find-and-replace en JSX.
// ============================================================================

const obsidian = {
    50:  '#fafafa',
    100: '#f4f4f5',
    200: '#e4e4e7',
    300: '#d4d4d8',
    400: '#a1a1aa',
    500: '#71717a',
    600: '#52525b',
    700: '#2e2e33',
    800: '#1d1d20', // superficies elevadas (cards, sidebar hover)
    900: '#121214', // canvas principal dark
    950: '#09090b', // fondo absoluto
};

const brand = {
    DEFAULT: '#6366f1', // índigo vibrante
    hover:   '#4f46e5',
    glow:    '#818cf8',
    50:  '#eef2ff',
    100: '#e0e7ff',
    200: '#c7d2fe',
    300: '#a5b4fc',
    400: '#818cf8',
    500: '#6366f1',
    600: '#4f46e5',
    700: '#4338ca',
    800: '#3730a3',
    900: '#312e81',
    950: '#1e1b4b',
};

// Verde Nortex (dinero que entra / éxito) — escala completa para absorber
// los usos de `emerald-*` y `green-*` en un solo verde de marca.
const accent = {
    DEFAULT: '#10b981',
    50:  '#ecfdf5',
    100: '#d1fae5',
    200: '#a7f3d0',
    300: '#6ee7b7',
    400: '#34d399',
    500: '#10b981',
    600: '#059669',
    700: '#047857',
    800: '#065f46',
    900: '#064e3b',
    950: '#022c22',
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
                sans: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'],
                mono: ['"JetBrains Mono"', 'monospace'], // SKUs, IDs, montos, tickets
            },
            colors: {
                // Override global: todo `slate-*` existente se vuelve obsidiana.
                slate: obsidian,
                surface: obsidian,
                brand,
                // ── Fase 1 rediseño: la paleta default de Tailwind deja de
                // existir en la app. El arcoíris frío (blue/indigo/sky/cyan/
                // violet/purple — >600 usos, el look genérico de IA) colapsa
                // al índigo de marca; los dos verdes (emerald+green) colapsan
                // al verde Nortex; `gray` duplicaba a `slate` → obsidiana.
                // Cientos de usos se recolorean sin tocar un solo componente
                // (misma palanca que el remapeo de `slate`). La semántica de
                // color queda fija: índigo=acción · verde=dinero/éxito ·
                // ámbar=advertencia/deuda · rojo=peligro/salida.
                blue: brand,
                indigo: brand,
                sky: brand,
                cyan: brand,
                violet: brand,
                purple: brand,
                emerald: accent,
                green: accent,
                gray: obsidian,
                nortex: {
                    // Lights → índigo suave (badges, fondos tenues)
                    50:  brand[50],
                    100: brand[100],
                    200: brand[200],
                    300: brand[300],
                    // Acción → índigo de marca (antes azul genérico #3b82f6)
                    400: brand[400],
                    500: brand[500],
                    600: brand[600],
                    700: brand[700],
                    // Chrome oscuro → obsidiana (antes slate azulado)
                    800: '#1d1d20',
                    900: '#0c0c0e', // sidebar: el negro más profundo de la UI
                    accent:  '#10b981', // verde Nortex — identidad, se conserva
                    danger:  '#ef4444',
                    warning: '#f59e0b',
                },
            },
            boxShadow: {
                // Sombras suaves y difusas — nunca el shadow-md gris duro
                'premium': '0 4px 24px -6px rgba(0, 0, 0, 0.35), 0 1px 2px rgba(0, 0, 0, 0.25)',
                'premium-light': '0 4px 20px -2px rgba(0, 0, 0, 0.05), 0 0 3px rgba(0, 0, 0, 0.02)',
                'glow': '0 0 20px -5px var(--tw-shadow-color)',
            },
            keyframes: {
                'fade-in-up': {
                    '0%':   { opacity: '0', transform: 'translateY(6px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
            },
            animation: {
                'fade-in-up': 'fade-in-up 0.25s ease-out both',
            },
        },
    },
    plugins: [],
}
