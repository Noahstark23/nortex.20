import { describe, expect, it } from 'vitest';
import { assertMigrationManifest, BASELINE_COMMIT, MIGRATION_PATHS } from '../scripts/qa/test-assistant-budget-upgrade.mjs';

const delta = (paths: string[]) => paths.map(path => `A\0${path}\0`).join('');
const extra = 'backend/prisma/migrations/20260924010000_next_feature/migration.sql';

describe('contrato del espejo completo de upgrade de presupuesto', () => {
  it('fija el origen productivo y acredita los siete SQL de este candidato', () => {
    expect(BASELINE_COMMIT).toBe('20fda8dc196b808b0508e53d1253510cacd7096b');
    expect(MIGRATION_PATHS).toHaveLength(7);
    expect(assertMigrationManifest(delta([...MIGRATION_PATHS].reverse()))).toEqual([...MIGRATION_PATHS].sort());
  });

  it('rechaza el manifiesto antiguo de cuatro SQL aunque esos cuatro sean correctos', () => {
    expect(() => assertMigrationManifest(delta(MIGRATION_PATHS), '', MIGRATION_PATHS.slice(0, 4))).toThrow('TODOS');
  });

  it('rechaza un SQL listado que falta en el candidato', () => {
    expect(() => assertMigrationManifest(delta(MIGRATION_PATHS.slice(0, -1)))).toThrow('TODOS');
  });

  it('exige incorporar una migración nueva al manifiesto antes de ejecutar Docker', () => {
    expect(() => assertMigrationManifest(delta([...MIGRATION_PATHS, extra]))).toThrow('TODOS');
  });

  it.each(['M', 'D', 'T', 'R100'])('rechaza %s sobre un SQL preexistente sin reinterpretarlo como expansión', status => {
    expect(() => assertMigrationManifest(`${delta(MIGRATION_PATHS)}${status}\0backend/prisma/migrations/20260101000000_existing/migration.sql\0`)).toThrow('No modificar ni eliminar');
  });

  it('detecta SQL nuevo sin seguimiento; no basta con que git diff omita el archivo', () => {
    expect(() => assertMigrationManifest(delta(MIGRATION_PATHS), `${extra}\0`)).toThrow('sin seguimiento');
  });

  it('permite archivos de documentación sin confundirlos con SQL de upgrade', () => {
    expect(assertMigrationManifest(`${delta(MIGRATION_PATHS)}M\0backend/prisma/migrations/README.md\0`, 'backend/prisma/migrations/NOTAS.md\0')).toEqual(MIGRATION_PATHS);
  });

  it('rechaza duplicaciones en el delta y en el manifiesto', () => {
    expect(() => assertMigrationManifest(delta([...MIGRATION_PATHS, MIGRATION_PATHS[0]]))).toThrow('delta contiene SQL duplicado');
    expect(() => assertMigrationManifest(delta(MIGRATION_PATHS), '', [...MIGRATION_PATHS, MIGRATION_PATHS[0]])).toThrow('manifiesto contiene SQL duplicado');
  });

  it('rechaza salida git truncada o sin terminador NUL', () => {
    expect(() => assertMigrationManifest(delta(MIGRATION_PATHS).slice(0, -1))).toThrow('terminar en NUL');
    expect(() => assertMigrationManifest(`${delta(MIGRATION_PATHS)}A\0`)).toThrow('incompleto');
    expect(() => assertMigrationManifest('')).toThrow('TODOS');
  });
});
