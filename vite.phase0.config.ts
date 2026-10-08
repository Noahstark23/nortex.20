import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const repositoryRoot = __dirname;
const harnessRoot = path.resolve(repositoryRoot, 'tools/camera-barcode-phase0');
const phase0Base = '/phase0-camera/';

function loadTls() {
  const keyPath = process.env.NORTEX_PHASE0_TLS_KEY_PATH;
  const certPath = process.env.NORTEX_PHASE0_TLS_CERT_PATH;

  if (Boolean(keyPath) !== Boolean(certPath)) {
    throw new Error(
      'NORTEX_PHASE0_TLS_KEY_PATH y NORTEX_PHASE0_TLS_CERT_PATH deben configurarse juntos.',
    );
  }

  if (!keyPath || !certPath) return undefined;

  return {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  };
}

function emitPhase0Icons() {
  const icons = ['icon-192.png', 'icon-512.png'] as const;

  return {
    name: 'nortex-phase0-camera-icons',
    apply: 'build' as const,
    generateBundle(this: { emitFile: (asset: object) => void }) {
      icons.forEach((fileName) => {
        this.emitFile({
          type: 'asset',
          fileName,
          source: fs.readFileSync(path.resolve(repositoryRoot, 'public', fileName)),
        });
      });
    },
  };
}

function securityHeaders(connectSource: string) {
  return {
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      `connect-src ${connectSource}`,
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
    'Permissions-Policy': 'camera=(self)',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  };
}

export default defineConfig(() => {
  const https = loadTls();
  const host = https ? '0.0.0.0' : '127.0.0.1';

  return {
    root: harnessRoot,
    base: phase0Base,
    publicDir: false as const,
    envDir: harnessRoot,
    server: {
      host,
      port: 4176,
      strictPort: true,
      https,
      headers: securityHeaders("'self' ws: wss:"),
      fs: { allow: [repositoryRoot] },
    },
    preview: {
      host,
      port: 4176,
      strictPort: true,
      https,
      headers: securityHeaders("'self'"),
    },
    build: {
      outDir: path.resolve(repositoryRoot, 'dist/phase0-camera'),
      emptyOutDir: true,
      sourcemap: false,
    },
    plugins: [
      emitPhase0Icons(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: false,
        manifestFilename: 'manifest.webmanifest',
        manifest: {
          id: phase0Base,
          name: 'Nortex Fase 0 — Cámara',
          short_name: 'Nortex Fase 0',
          description: 'Arnés aislado para investigar lectura de códigos sin tocar datos de negocio.',
          lang: 'es',
          theme_color: '#111827',
          background_color: '#f8fafc',
          display: 'standalone',
          start_url: phase0Base,
          scope: phase0Base,
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,png}'],
          navigateFallback: `${phase0Base}index.html`,
          runtimeCaching: [],
          cleanupOutdatedCaches: true,
        },
        devOptions: { enabled: false },
      }),
    ],
  };
});
