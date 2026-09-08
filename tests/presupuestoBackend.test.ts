import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Trinquete: sólo baja. La base conversacional tenía 14,638 líneas.
// Nuevas capacidades pertenecen a rutas/servicios; el servidor sólo compone.
const MAX_SERVER_LINES = 14266;

describe('presupuesto de composición del backend', () => {
  it('impide recuperar espacio extraído para ampliar el monolito', () => {
    const source = readFileSync('backend/server.ts', 'utf8');
    const lines = source.trimEnd().split('\n').length;
    expect(lines, 'Extraer el flujo y reducir este presupuesto; nunca elevarlo.').toBeLessThanOrEqual(MAX_SERVER_LINES);
    expect(MAX_SERVER_LINES - lines, 'Una extracción debe reducir el presupuesto en el mismo cambio.').toBeLessThanOrEqual(20);
  });
});
