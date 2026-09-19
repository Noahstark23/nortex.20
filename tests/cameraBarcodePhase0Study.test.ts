import { describe, expect, it } from 'vitest';
import type {
  Phase0Manifest,
  Phase0RepoSafeSample,
} from '../tools/camera-barcode-phase0/domain';
import {
  closeReasonToObservation,
  deriveLifecycleChecks,
  hasCompleteProtocolCoverage,
  localIsoDate,
  nextRunIdentity,
  prepareManifestForStudy,
} from '../tools/camera-barcode-phase0/study';

function manifestFixture(): Phase0Manifest {
  return {
    schemaVersion: 1,
    protocolVersion: 'phase0-v1',
    normalizationVersion: 'barcode-input-v1',
    studyId: 'nortex-camera-template',
    studyStatus: 'TEMPLATE',
    createdDate: '2026-08-30',
    dataClassification: 'REPO_SAFE_SYNTHETIC',
    privacy: {
      realPayloadsInRepo: false,
      rawFramesPersisted: false,
      customerDataAllowed: false,
      fingerprintAlgorithm: 'HMAC-SHA-256',
    },
    samples: [{
      sampleId: 'synthetic-ean13-valid',
      provenance: 'SYNTHETIC',
      repoSafe: true,
      symbology: 'EAN_13',
      semanticClass: 'FIXED_PRODUCT',
      expectedOutcome: 'DECODE',
      expectedValue: '7501234567893',
      checksumExpectation: 'VALID',
      printSource: 'LASER',
      substrate: 'MATTE_PAPER',
      conditionTags: ['PRISTINE'],
      barcodeWidthMm: 37,
      barcodeHeightMm: 25,
      quietZoneClass: 'COMPLIANT',
      contrastClass: 'HIGH',
      artifactRef: null,
    }],
    environments: [{
      environmentId: 'android-low-pwa-zxing-template',
      deviceTier: 'ANDROID_LOW',
      manufacturer: 'record-at-run',
      modelAlias: 'android-low-a',
      osName: 'Android',
      osVersion: 'record-at-run',
      surface: 'INSTALLED_PWA',
      browserName: 'Chrome',
      browserVersion: 'record-at-run',
      engine: 'Blink',
      decoderName: 'ZXING_BROWSER',
      decoderVersion: 'record-at-run',
      prototypeBuildId: 'not-built',
      cameraFacing: 'ENVIRONMENT',
      actualResolution: null,
      torchAvailable: false,
      secureContext: true,
      reportedFormats: ['ean_13'],
    }],
    scenarios: [{
      scenarioId: 'cold-normal-handheld',
      startState: 'COLD',
      permissionState: 'PROMPT',
      networkMode: 'ONLINE',
      distanceCm: 20,
      angleDeg: 0,
      orientationDeg: 0,
      lightingBand: 'NORMAL_INDOOR',
      motion: 'HANDHELD',
      torch: 'OFF',
      timeoutMs: 5000,
    }],
    runs: [],
  };
}

describe('camera barcode Phase 0 study helpers', () => {
  it('prepares only the selected environment with observed, pinned values', () => {
    const original = manifestFixture();
    const prepared = prepareManifestForStudy(original, original.environments[0].environmentId, {
      studyId: 'android-low-study-1',
      deviceTier: 'ANDROID_LOW',
      manufacturer: 'Example',
      modelAlias: 'android-low-a',
      osName: 'Android',
      osVersion: '15',
      surface: 'INSTALLED_PWA',
      browserName: 'Chrome',
      browserVersion: '140',
      engine: 'Blink',
    }, {
      cameraObserved: true,
      secureContext: true,
      actualResolution: { width: 1280, height: 720 },
      torchAvailable: true,
    }, '2026-08-30');

    expect(prepared).not.toBe(original);
    expect(original.studyStatus).toBe('TEMPLATE');
    expect(prepared.studyStatus).toBe('IN_PROGRESS');
    expect(prepared.studyId).toBe('android-low-study-1');
    expect(prepared.environments[0]).toMatchObject({
      manufacturer: 'Example',
      decoderName: 'ZXING_BROWSER',
      decoderVersion: 'browser-0.1.5_library-0.21.3',
      prototypeBuildId: 'phase0-harness-v1',
      actualResolution: { width: 1280, height: 720 },
      torchAvailable: true,
    });
  });

  it('congela identidades con evidencia y preserva capacidades cuando no observa camara', () => {
    const original = manifestFixture();
    original.studyId = 'android-low-study-1';
    original.studyStatus = 'IN_PROGRESS';
    original.createdDate = '2026-08-29';
    Object.assign(original.environments[0], {
      manufacturer: 'Example',
      modelAlias: 'android-low-a',
      osVersion: '15',
      browserVersion: '140',
      decoderVersion: 'browser-0.1.5_library-0.21.3',
      prototypeBuildId: 'phase0-harness-v1',
      actualResolution: { width: 1280, height: 720 },
      torchAvailable: true,
    });
    original.runs.push({
      runId: 'run-primary-1',
      sampleId: original.samples[0].sampleId,
      environmentId: original.environments[0].environmentId,
      scenarioId: original.scenarios[0].scenarioId,
      sequence: 1,
      repetition: 1,
      runDate: '2026-08-29',
      result: 'NO_DECODE',
      observedSymbology: null,
      observedLength: null,
      payloadMatchesExpected: null,
      checksumResult: 'NOT_OBSERVED',
      cameraReadyMs: 250,
      firstCandidateMs: null,
      firstCorrectMs: null,
      wrongCandidateCount: 0,
      duplicateEmissionsWithin2s: 0,
      cameraTrackStoppedAfterExit: true,
      fallbackUsed: 'NONE',
      fallbackSucceeded: null,
      failureCode: 'TIMEOUT',
      excluded: false,
      exclusionReason: null,
    });
    const draft = {
      studyId: 'android-low-study-1',
      deviceTier: 'ANDROID_LOW' as const,
      manufacturer: 'Example',
      modelAlias: 'android-low-a',
      osName: 'Android',
      osVersion: '15',
      surface: 'INSTALLED_PWA' as const,
      browserName: 'Chrome',
      browserVersion: '140',
      engine: 'Blink',
    };
    const noCameraObserved = {
      cameraObserved: false,
      secureContext: true,
      actualResolution: null,
      torchAvailable: false,
    };

    const prepared = prepareManifestForStudy(
      original,
      original.environments[0].environmentId,
      draft,
      noCameraObserved,
      '2026-08-30',
    );
    expect(prepared.createdDate).toBe('2026-08-29');
    expect(prepared.environments[0]).toMatchObject({
      actualResolution: { width: 1280, height: 720 },
      torchAvailable: true,
    });

    expect(() => prepareManifestForStudy(
      original,
      original.environments[0].environmentId,
      { ...draft, studyId: 'renamed-study' },
      noCameraObserved,
      '2026-08-30',
    )).toThrow('studyId no puede cambiar');
    expect(() => prepareManifestForStudy(
      original,
      original.environments[0].environmentId,
      { ...draft, modelAlias: 'another-device' },
      noCameraObserved,
      '2026-08-30',
    )).toThrow('identidad del ambiente no puede cambiar');

    for (const [field, value] of [
      ['decoderVersion', 'other-decoder-version'],
      ['prototypeBuildId', 'other-build'],
    ] as const) {
      const altered = structuredClone(original);
      altered.environments[0][field] = value;
      expect(() => prepareManifestForStudy(
        altered,
        altered.environments[0].environmentId,
        draft,
        noCameraObserved,
        '2026-08-30',
      )).toThrow('identidad del ambiente no puede cambiar');
    }
  });

  it('creates stable schema-safe run identities without changing existing runs', () => {
    const manifest = manifestFixture();
    const identity = nextRunIdentity(
      manifest,
      manifest.samples[0].sampleId,
      manifest.environments[0].environmentId,
      manifest.scenarios[0].scenarioId,
      1_725_000_000_000,
    );

    expect(identity).toEqual({ runId: 'run-m0gcgmio-1', sequence: 1, repetition: 1 });
    expect(manifest.runs).toEqual([]);
  });

  it('maps every terminal camera reason without inventing a candidate', () => {
    expect(closeReasonToObservation('SUCCESS')).toBeNull();
    expect(closeReasonToObservation('TIMEOUT')).toEqual({ kind: 'NO_DECODE' });
    expect(closeReasonToObservation('PERMISSION_DENIED')).toEqual({ kind: 'PERMISSION_DENIED' });
    expect(closeReasonToObservation('BACKGROUND')).toEqual({
      kind: 'ABORTED',
      failureCode: 'LIFECYCLE_INTERRUPTED',
    });
    expect(closeReasonToObservation('INSECURE_CONTEXT')).toEqual({
      kind: 'CAMERA_ERROR',
      failureCode: 'SECURE_CONTEXT_REQUIRED',
    });
  });

  it('treats absent lifecycle evidence as insufficient, not as a failed check', () => {
    const manifest = manifestFixture();
    expect(deriveLifecycleChecks(
      manifest,
      manifest.environments[0].environmentId,
      manifest.samples[0].sampleId,
    )).toEqual([]);
    expect(hasCompleteProtocolCoverage(
      manifest,
      manifest.environments[0].environmentId,
      manifest.samples[0],
    )).toBe(false);
  });

  it('derives lifecycle coverage at environment scope so negative samples can reuse fallback evidence', () => {
    const manifest = manifestFixture();
    const baseSample = manifest.samples[0] as Phase0RepoSafeSample;
    manifest.studyStatus = 'IN_PROGRESS';
    const negativeSample: Phase0RepoSafeSample = {
      ...baseSample,
      sampleId: 'synthetic-ean13-invalid',
      expectedOutcome: 'REJECT_INVALID',
      expectedValue: '7501234567894',
      checksumExpectation: 'INVALID',
      semanticClass: 'NEGATIVE',
    };
    manifest.samples.push(negativeSample);
    manifest.runs = [
      {
        runId: 'run-fallback-1',
        sampleId: manifest.samples[0].sampleId,
        environmentId: manifest.environments[0].environmentId,
        scenarioId: manifest.scenarios[0].scenarioId,
        sequence: 1,
        repetition: 1,
        runDate: '2026-08-30',
        result: 'DECODED_MATCH',
        observedSymbology: 'EAN_13',
        observedLength: 13,
        payloadMatchesExpected: true,
        checksumResult: 'VALID',
        cameraReadyMs: 250,
        firstCandidateMs: 500,
        firstCorrectMs: 500,
        wrongCandidateCount: 0,
        duplicateEmissionsWithin2s: 0,
        cameraTrackStoppedAfterExit: true,
        fallbackUsed: 'MANUAL_INPUT',
        fallbackSucceeded: true,
        failureCode: null,
        excluded: false,
        exclusionReason: null,
      },
    ];

    expect(
      deriveLifecycleChecks(
        manifest,
        manifest.environments[0].environmentId,
        'synthetic-ean13-invalid',
      ),
    ).toEqual([]);
    expect(
      deriveLifecycleChecks(manifest, manifest.environments[0].environmentId),
    ).toContainEqual({ kind: 'FALLBACK', passed: true });
  });

  it('no acredita cobertura de escenarios primarios con una corrida fallback', () => {
    const manifest = manifestFixture();
    manifest.studyStatus = 'IN_PROGRESS';
    const environmentId = manifest.environments[0].environmentId;
    const sampleId = manifest.samples[0].sampleId;
    const scenarioDefinitions = [
      ['cold-primary', 'COLD', 'PROMPT', 'ONLINE', 'NORMAL_INDOOR', 'HANDHELD', 0],
      ['warm-primary', 'WARM', 'GRANTED', 'OFFLINE', 'LOW', 'STILL', 90],
      ['resume-primary', 'RESUME', 'GRANTED', 'ONLINE', 'NORMAL_INDOOR', 'HANDHELD', 0],
      ['denied-primary', 'WARM', 'DENIED', 'ONLINE', 'NORMAL_INDOOR', 'STILL', 0],
      ['background-primary', 'WARM', 'GRANTED', 'ONLINE', 'NORMAL_INDOOR', 'HANDHELD', 0],
      ['glare-fallback', 'WARM', 'GRANTED', 'ONLINE', 'GLARE', 'HANDHELD', 0],
    ] as const;
    manifest.scenarios = scenarioDefinitions.map(([
      scenarioId,
      startState,
      permissionState,
      networkMode,
      lightingBand,
      motion,
      orientationDeg,
    ]) => ({
      scenarioId,
      startState,
      permissionState,
      networkMode,
      distanceCm: 20,
      angleDeg: 0,
      orientationDeg,
      lightingBand,
      motion,
      torch: 'OFF',
      timeoutMs: 5000,
    }));

    const baseRun = (sequence: number, scenarioId: string) => ({
      runId: `run-coverage-${sequence}`,
      sampleId,
      environmentId,
      scenarioId,
      sequence,
      repetition: 1,
      runDate: '2026-08-30',
      result: 'NO_DECODE' as const,
      observedSymbology: null,
      observedLength: null,
      payloadMatchesExpected: null,
      checksumResult: 'NOT_OBSERVED' as const,
      cameraReadyMs: 250,
      firstCandidateMs: null,
      firstCorrectMs: null,
      wrongCandidateCount: 0,
      duplicateEmissionsWithin2s: 0,
      cameraTrackStoppedAfterExit: true,
      fallbackUsed: 'NONE' as const,
      fallbackSucceeded: null,
      failureCode: 'TIMEOUT' as const,
      excluded: false,
      exclusionReason: null,
    });
    manifest.runs = [
      baseRun(1, 'cold-primary'),
      {
        ...baseRun(2, 'warm-primary'),
        result: 'ABORTED',
        failureCode: 'OPERATOR_ABORTED',
      },
      baseRun(3, 'resume-primary'),
      {
        ...baseRun(4, 'denied-primary'),
        result: 'PERMISSION_DENIED',
        failureCode: 'PERMISSION_NOT_ALLOWED',
        cameraReadyMs: null,
      },
      {
        ...baseRun(5, 'background-primary'),
        result: 'ABORTED',
        failureCode: 'LIFECYCLE_INTERRUPTED',
      },
      {
        ...baseRun(6, 'glare-fallback'),
        result: 'DECODED_MATCH',
        observedSymbology: 'EAN_13',
        observedLength: 13,
        payloadMatchesExpected: true,
        checksumResult: 'VALID',
        firstCandidateMs: 1,
        firstCorrectMs: 1,
        fallbackUsed: 'MANUAL_INPUT',
        fallbackSucceeded: true,
        failureCode: null,
      },
    ];

    expect(hasCompleteProtocolCoverage(
      manifest,
      environmentId,
      manifest.samples[0],
    )).toBe(false);

    manifest.runs.push(baseRun(7, 'glare-fallback'));
    expect(hasCompleteProtocolCoverage(
      manifest,
      environmentId,
      manifest.samples[0],
    )).toBe(true);
  });

  it('uses the local calendar date instead of coercing to UTC', () => {
    expect(localIsoDate(new Date(2026, 7, 30, 23, 59))).toBe('2026-08-30');
  });
});
