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
          includeAssets: ['icon-192.svg', 'robots.txt'],
          manifest: {
            name: 'Nortex POS',
            short_name: 'Nortex',
            description: 'Sistema de Punto de Venta Nortex',
            theme_color: '#1e293b',
            background_color: '#0f172a',
            display: 'standalone',
            start_url: '/',
            icons: [
              {
                src: '/icon-192.svg',
                sizes: '192x192',
                type: 'image/svg+xml',
                purpose: 'any maskable',
              },
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
            // El resto de rutas (/login, /app/*, etc.) siguen usando el fallback al SPA.
            navigateFallback: '/index.html',
            navigateFallbackDenylist: [/^\/$/, /^\/landing\.html$/],
            runtimeCaching: [
              {
                // API calls: network-first, fallback a cache 10 min
                urlPattern: /^https?:\/\/.*\/api\//,
                handler: 'NetworkFirst',
                options: {
                  cacheName: 'nortex-api-cache',
                  networkTimeoutSeconds: 5,
                  expiration: { maxEntries: 50, maxAgeSeconds: 600 },
                },
              },
            ],
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
      }
    };
});
