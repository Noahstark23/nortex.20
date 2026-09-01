import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createManifestValidator } from '../tools/camera-barcode-phase0/manifest';
import {
  runPhase0SoftwareSimulation,
  SOFTWARE_ONLY_EVIDENCE_CLASS,
  SOFTWARE_SIMULATION_KIND,
} from '../tools/camera-barcode-phase0/simulation';

describe('Phase 0 deterministic software simulation', () => {
  it('simula lifecycle y decisiones sin producir evidencia fisica', async () => {
    const report = await runPhase0SoftwareSimulation();

    expect(report).toMatchObject({
      kind: SOFTWARE_SIMULATION_KIND,
      schemaVersion: 1,
      evidenceClass: SOFTWARE_ONLY_EVIDENCE_CLASS,
      deterministic: true,
      physicalEvidenceAccepted: false,
      rawPayloadsPersisted: false,
      summary: {
        captureScenariosPassed: 9,
        captureScenarioCount: 9,
        decisionScenariosPassed: 6,
        decisionScenarioCount: 6,
        allPassed: true,
      },
    });
    expect(report.captureLifecycle.every((entry) => entry.resourcesReleased)).toBe(true);
    expect(report.captureLifecycle.every((entry) => entry.snapshotRedacted)).toBe(true);
    expect(Object.fromEntries(report.decisionMatrix.map((entry) => [
      entry.scenario,
      entry.actualDecision,
    ]))).toEqual({
      NOMINAL: 'GO',
      SLOW_P95: 'PILOT',
      WRONG_DECODE: 'NO_GO',
      FALLBACK_ONLY: 'INSUFFICIENT',
      TRACK_LEAK: 'NO_GO',
      UNEXPECTED_PERMISSION_DENIAL: 'PILOT',
    });
    expect(JSON.stringify(report)).not.toContain('7501234567893');

    const schema = JSON.parse(fs.readFileSync(path.resolve(
      __dirname,
      '../docs/product/camera-barcode-phase0-manifest.schema.json',
    ), 'utf8')) as unknown;
    expect(createManifestValidator(schema)(report).ok).toBe(false);
  });

  it('produce exactamente el mismo reporte en cada ejecucion', async () => {
    expect(await runPhase0SoftwareSimulation()).toEqual(
      await runPhase0SoftwareSimulation(),
    );
  });
});
