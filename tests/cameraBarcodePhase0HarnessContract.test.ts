import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(__dirname, '..');
const read = (relativePath: string) =>
  fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
const readJson = <T>(relativePath: string): T => JSON.parse(read(relativePath)) as T;

const harnessFiles = [
  'tools/camera-barcode-phase0/capture.ts',
  'tools/camera-barcode-phase0/domain.ts',
  'tools/camera-barcode-phase0/main.ts',
  'tools/camera-barcode-phase0/manifest.ts',
  'tools/camera-barcode-phase0/runtime.ts',
  'tools/camera-barcode-phase0/simulate.ts',
  'tools/camera-barcode-phase0/simulation.ts',
  'tools/camera-barcode-phase0/study.ts',
] as const;

describe('camera barcode Phase 0 isolated harness contract', () => {
  it('pins the Node 22 compatible decoder and exposes isolated commands', () => {
    const packageJson = readJson<{
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    }>('package.json');

    expect(packageJson.scripts).toMatchObject({
      'phase0:camera:dev': 'vite --config vite.phase0.config.ts',
      'phase0:camera:build': 'vite build --config vite.phase0.config.ts',
      'phase0:camera:preview': 'vite preview --config vite.phase0.config.ts',
      'phase0:camera:simulate': 'tsx tools/camera-barcode-phase0/simulate.ts',
    });
    expect(packageJson.devDependencies['@zxing/browser']).toBe('0.1.5');
    expect(packageJson.devDependencies['@zxing/library']).toBe('0.21.3');
    expect(packageJson.devDependencies.ajv).toBe('8.20.0');
    expect(packageJson.dependencies).not.toHaveProperty('@zxing/browser');
    expect(packageJson.dependencies).not.toHaveProperty('@zxing/library');
  });

  it('does not import product runtime or introduce a business/network channel', () => {
    const source = harnessFiles.map(read).join('\n');
    const forbiddenRuntimeTokens = [
      "from '../../App'",
      "from '../../components/",
      "from '../../backend/",
      '/api/',
      'fetch(',
      'XMLHttpRequest',
      'sendBeacon',
      'localStorage',
      'sessionStorage',
      'indexedDB',
      'document.cookie',
    ];

    forbiddenRuntimeTokens.forEach((token) => expect(source).not.toContain(token));
    expect(read('tools/camera-barcode-phase0/main.ts')).toContain(
      '../../docs/product/camera-barcode-phase0-manifest.schema.json?raw',
    );
    expect(read('tools/camera-barcode-phase0/main.ts')).toContain(
      '../../docs/product/camera-barcode-phase0-manifest.example.json?raw',
    );
  });

  it('keeps the service worker, manifest and navigation inside the Phase 0 scope', () => {
    const config = read('vite.phase0.config.ts');

    expect(config).toContain("const phase0Base = '/phase0-camera/'");
    expect(config).toContain('scope: phase0Base');
    expect(config).toContain('start_url: phase0Base');
    expect(config).toContain('runtimeCaching: []');
    expect(config).toContain('Permissions-Policy');
    expect(config).toContain('Content-Security-Policy');
    expect(config).toContain("host = https ? '0.0.0.0' : '127.0.0.1'");
    expect(config).toContain('Boolean(keyPath) !== Boolean(certPath)');
    expect(config).toContain('port: 4176');
    expect(config).toContain('headers: securityHeaders("\'self\' ws: wss:")');
    expect(config).toContain('headers: securityHeaders("\'self\'")');
    expect(config).not.toContain("root: path.resolve(repositoryRoot, 'App.tsx')");
  });

  it('marks the surface noindex and states its privacy boundary in the operator guide', () => {
    const html = read('tools/camera-barcode-phase0/index.html');
    const guide = read('tools/camera-barcode-phase0/README.md');

    expect(html).toContain('noindex,nofollow,noarchive');
    expect(guide).toContain('No se guardan imágenes, frames ni payloads observados.');
    expect(guide).toContain('La prueba física sigue pendiente');
    expect(guide).toContain('Android económico + versión exacta de Android + PWA instalada');
  });
});
