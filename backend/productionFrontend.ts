import express, { type Express } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { setPwaEntrypointCacheHeaders } from './middleware/pwaEntrypointCache.js';

/** Compone landing, assets y SPA sin ampliar el servidor principal. */
export function registerProductionFrontend(app: Express, distPath: string): void {
  app.get('/', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(distPath, 'landing.html'));
  });

  app.use('/assets', express.static(path.join(distPath, 'assets'), {
    maxAge: '1y', immutable: true,
  }));

  app.use(express.static(distPath, {
    maxAge: 0, redirect: false, setHeaders: setPwaEntrypointCacheHeaders,
  }));

  app.get(/^(?!\/api).+/, (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    const rel = req.path.replace(/^\/+|\/+$/g, '');
    if (rel) {
      const prerendered = path.join(distPath, rel, 'index.html');
      if (prerendered.startsWith(distPath + path.sep) && fs.existsSync(prerendered)) {
        return res.sendFile(prerendered);
      }
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });
  console.log(`📂 Serving static files from: ${distPath}`);
}
