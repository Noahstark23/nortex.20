import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        react(),
        VitePWA({
          registerType: 'autoUpdate',
          includeAssets: ['icon-192.svg', 'icon-192.png', 'icon-512.png', 'favicon.svg', 'robots.txt'],
          manifest: {
            name: 'Nortex — Punto de venta e inventario',
            short_name: 'Nortex',
            description: 'El sistema del negocio nica: ventas, inventario, caja y fiado.',
            // Fase 1 rediseño: colores de la identidad Obsidian real (antes
            // quedaban los slate azulados viejos, contradiciendo index.html).
            theme_color: '#0c0c0e',
            background_color: '#09090b',
            lang: 'es',
            display: 'standalone',
            // '/app/pos' y no '/': la raíz la sirve Express con landing.html
            // (marketing) y además está en el navigateFallbackDenylist del SW —
            // con start_url '/' la app instalada abría la landing y NO abría
            // offline. /app/pos cae en el fallback al SPA (funciona offline) y,
            // sin token, ProtectedApp redirige solo a /login.
            start_url: '/app/pos',
            icons: [
              // PNG 192+512: Chrome Android los exige para la splash screen y el
              // diálogo de instalación completo (el SVG solo no basta en WebViews
              // de gama baja).
              { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
              { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
              { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
              { src: '/icon-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
            ],
          },
          workbox: {
            globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
            // El bundle del SPA ronda los 2 MB (sobre el límite por defecto de
            // Workbox de 2 MiB). Subimos el tope para que el PWA precachee toda
            // la app y siga funcionando offline. (Build fallaba al superar 2 MiB.)
            maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
            // La raíz "/" la sirve Express con landing.html (marketing/SEO).
            // Sin este denylist, el SW intercepta la navegación a "/" y devuelve
            // el index.html cacheado (el SPA), ocultando la landing profesional.
            //
            // Las rutas PÚBLICAS prerenderizadas (/blog/*, landings de nicho,
            // legales) también van al denylist. Antes solo se excluía "/": en
            // cualquier teléfono que hubiera visitado la app una vez, el SW
            // respondía TODA navegación a /blog/... con el shell PRECACHEADO del
            // SPA — la página nunca tocaba el servidor, y como el contenido del
            // blog viaja embebido en el bundle JS, el usuario recurrente veía la
            // versión de cuando se instaló su SW, deploy tras deploy ("los
            // cambios no se reflejan en el teléfono"). El HTML prerenderizado
            // fresco solo lo veían los crawlers y las visitas sin SW.
            // El app (/login, /app/*, /pedidos, /driver…) conserva el fallback:
            // ahí el offline-first es la función, no un bug.
            navigateFallback: '/index.html',
            navigateFallbackDenylist: [
                /^\/$/,
                /^\/landing\.html$/,
                /^\/blog(\/|$)/,
                /^\/ferreterias$/,
                /^\/farmacias$/,
                /^\/nicaragua$/,
                /^\/privacy$/,
                /^\/terms$/,
            ],
            // NO cacheamos en runtime las respuestas de /api/. Antes un
            // NetworkFirst guardaba respuestas AUTENTICADAS de negocio en un
            // Cache Storage compartido por origen, sin partición por tenant/sesión
            // ni purga en logout: en una terminal POS compartida, el usuario B
            // podía recibir datos del tenant del usuario A desde caché dentro de
            // la ventana de expiración si la red estaba lenta/offline. Los datos
            // de negocio deben venir siempre de la red (o de la cola offline en
            // IndexedDB para ventas), nunca de un caché HTTP compartido.
            runtimeCaching: [],
          },
        }),
      ],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      test: {
        // Excluir cualquier sandbox de Stryker: además del default
        // `.stryker-tmp/`, las corridas enfocadas pueden dejar variantes como
        // `.stryker-tmp-pos-activation/`. Si Vitest las descubre, ejecuta una
        // copia congelada de la suite y mete falsos rojos o falsos verdes.
        exclude: [
          '**/node_modules/**',
          '**/dist/**',
          '**/.stryker-tmp*/**',
          '**/.codex-stryker-*-tmp/**',
        ],
      },
    };
});
