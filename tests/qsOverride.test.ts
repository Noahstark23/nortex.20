import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

import express from 'express';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

const readResolvedPackageVersion = (specifier: string) => {
  const packagePath = require.resolve(specifier);
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as {
    version?: unknown;
  };

  return packageJson.version;
};

describe('qs security override', () => {
  it('resolves the exact globally overridden version', () => {
    expect(readResolvedPackageVersion('qs/package.json')).toBe('6.16.0');
  });

  it('preserves Express extended query parsing for repeated, array and nested values', () => {
    const app = express();
    app.set('query parser', 'extended');

    const parseQuery = app.get('query parser fn') as (
      query: string,
    ) => Record<string, unknown>;

    expect(
      parseQuery(
        'tag=ventas&tag=inventario&canal%5B%5D=pos&canal%5B%5D=web' +
          '&filtro%5Bestado%5D=activo&lineas%5B0%5D%5Bsku%5D=ABC-123',
      ),
    ).toEqual({
      tag: ['ventas', 'inventario'],
      canal: ['pos', 'web'],
      filtro: { estado: 'activo' },
      lineas: [{ sku: 'ABC-123' }],
    });
  });
});
