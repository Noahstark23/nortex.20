import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { registerProductionFrontend } from '../backend/productionFrontend';

let server: Server | undefined;
let directory: string | undefined;
afterEach(async () => {
  if (server?.listening) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
  if (directory) await rm(directory, { recursive: true, force: true });
  server = undefined;
  directory = undefined;
});

describe('entrega del frontend de producción', () => {
  it('conserva landing, SPA, prerender, assets con hash y rutas API separadas', async () => {
    directory = await mkdtemp(join(tmpdir(), 'nortex-frontend-'));
    await mkdir(join(directory, 'assets'));
    await mkdir(join(directory, 'ferreterias'));
    await Promise.all([
      writeFile(join(directory, 'landing.html'), '<main>LANDING_NORTEX</main>'),
      writeFile(join(directory, 'index.html'), '<main>SPA_NORTEX</main>'),
      writeFile(join(directory, 'ferreterias', 'index.html'), '<main>SEO_FERRETERIAS</main>'),
      writeFile(join(directory, 'assets', 'index-hash.js'), 'console.log("HASHED_ASSET")'),
      writeFile(join(directory, 'sw.js'), 'self.skipWaiting()'),
      writeFile(join(directory, 'registerSW.js'), 'navigator.serviceWorker.register("/sw.js")'),
    ]);
    const app = express();
    registerProductionFrontend(app, directory);
    server = await new Promise<Server>(resolve => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Servidor de prueba sin puerto TCP');
    const base = `http://127.0.0.1:${address.port}`;
    const get = (route: string) => fetch(`${base}${route}`);

    const landing = await get('/');
    expect(await landing.text()).toContain('LANDING_NORTEX');
    expect(landing.headers.get('cache-control')).toContain('no-store');
    const spa = await get('/admin');
    expect(await spa.text()).toContain('SPA_NORTEX');
    expect(spa.headers.get('cache-control')).toContain('no-store');
    const seo = await get('/ferreterias');
    expect(await seo.text()).toContain('SEO_FERRETERIAS');
    const asset = await get('/assets/index-hash.js');
    expect(await asset.text()).toContain('HASHED_ASSET');
    expect(asset.headers.get('cache-control')).toContain('max-age=31536000');
    expect(asset.headers.get('cache-control')).toContain('immutable');
    for (const route of ['/sw.js', '/registerSW.js']) {
      const response = await get(route);
      expect(response.headers.get('cache-control')).toContain('no-store');
      expect(response.headers.get('cloudflare-cdn-cache-control')).toBe('no-store');
    }
    expect((await get('/api/nonexistent-qa')).status).toBe(404);
  });
});
