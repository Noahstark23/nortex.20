import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const dashboard = readFileSync(
  resolve(process.cwd(), 'components/Dashboard.tsx'),
  'utf8',
);

describe('configuración del régimen fiscal en Dashboard', () => {
  it('mantiene GENERAL como default seguro y normaliza lo recibido del backend', () => {
    expect(dashboard).toContain('fiscalRegime: FISCAL_REGIME_GENERAL');
    expect(dashboard).toContain('fiscalRegime: normalizeFiscalRegime(data.tenant.fiscalRegime)');
  });

  it('permite elegir explícitamente entre régimen general y cuota fija', () => {
    expect(dashboard).toContain('value="GENERAL"');
    expect(dashboard).toContain('value="CUOTA_FIJA"');
    expect(dashboard).toContain('Régimen general');
    expect(dashboard).toContain('Cuota fija');
  });

  it('advierte que el cambio no reescribe facturas previas y persiste la respuesta', () => {
    // El texto ahora dice también CUÁNDO se guarda, porque el régimen dejó de
    // depender del submit del formulario (que se bloquea cuando faltan RUC o
    // dirección — el caso del negocio de cuota fija). La garantía que este test
    // protege es la misma: aplica solo a ventas nuevas, no reescribe historia.
    expect(dashboard).toContain('El régimen se guarda apenas lo elegís. Aplica solo a ventas nuevas:');
    expect(dashboard).toContain('no modifica ni reescribe facturas anteriores.');
    expect(dashboard).toContain("fetch('/api/tenant/fiscal'");
    expect(dashboard).toContain('body: JSON.stringify(fiscalData)');
    expect(dashboard).toContain("localStorage.setItem('nortex_tenant_data', JSON.stringify(updatedTenant))");
  });
});
