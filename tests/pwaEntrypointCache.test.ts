import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { setPwaEntrypointCacheHeaders } from '../backend/middleware/pwaEntrypointCache';

let server: Server | undefined;
let directory: string | undefined;
afterEach(async () => {
  if (server?.listening) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
  if (directory) await rm(directory, { recursive: true, force: true });
  server = undefined;
  directory = undefined;
});

describe('caché de entrada PWA para el panel de NortexGPT', () => {
  it('no conserva el service worker ni su registro, pero mantiene caché normal para otros estáticos', async () => {
    directory = await mkdtemp(join(tmpdir(), 'nortex-pwa-cache-'));
    await Promise.all(['sw.js', 'registerSW.js', 'index.html'].map(name => writeFile(join(directory!, name), name)));
    const app = express();
    app.use(express.static(directory, { maxAge: 0, redirect: false, setHeaders: setPwaEntrypointCacheHeaders }));
    server = await new Promise<Server>(resolve => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Servidor de prueba sin puerto TCP');
    const base = `http://127.0.0.1:${address.port}`;
    for (const name of ['sw.js', 'registerSW.js']) {
      const response = await fetch(`${base}/${name}`);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toContain('no-store');
      expect(response.headers.get('cloudflare-cdn-cache-control')).toBe('no-store');
      expect(response.headers.get('cdn-cache-control')).toBe('no-store');
    }
    const html = await fetch(`${base}/index.html`);
    expect(html.headers.get('cache-control')).not.toContain('no-store');
  });
});
