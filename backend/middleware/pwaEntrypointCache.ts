import { basename } from 'node:path';
import type { ServerResponse } from 'node:http';

/** Los archivos sin hash que actualizan el PWA deben revalidarse en cada carga. */
export function setPwaEntrypointCacheHeaders(response: ServerResponse, filePath: string): void {
  if (!['sw.js', 'registerSW.js'].includes(basename(filePath))) return;
  response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  response.setHeader('CDN-Cache-Control', 'no-store');
  response.setHeader('Cloudflare-CDN-Cache-Control', 'no-store');
}
