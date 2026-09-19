import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('stack local canónico', () => {
  it('envía /api al backend local en vez de devolver el fallback HTML de Vite', () => {
    const config = readFileSync('vite.config.ts', 'utf8');

    expect(config).toContain("'/api': {");
    expect(config).toContain("env.NORTEX_DEV_API_TARGET || 'http://127.0.0.1:3210'");
    expect(config).toContain('target: apiProxyTarget');
    expect(config).toContain("NORTEX_DEV_API_TARGET debe apuntar a http://127.0.0.1:<puerto>");
    expect(config).toContain('/^http:\\/\\/127\\.0\\.0\\.1:\\d{2,5}$/u');
    expect(config).toContain('changeOrigin: false');
  });
});
