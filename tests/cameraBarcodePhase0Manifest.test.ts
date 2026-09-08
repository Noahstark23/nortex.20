import { createHmac, webcrypto } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  FORBIDDEN_EXPORT_KEYS,
  ManifestPrivacyError,
  ManifestValidationError,
  createManifestValidator,
  downloadManifestJson,
  evaluateCaptureReadiness,
  fingerprintNormalizedPayload,
  fingerprintWithEphemeralSecret,
  importEphemeralHmacKey,
  loadManifestJson,
  payloadMatchesFingerprint,
  sanitizeManifestForExport,
  serializeManifestForExport,
  type ManifestDownloadDependencies,
  type Phase0Manifest,
  type WebCryptoProvider,
} from '../tools/camera-barcode-phase0/manifest';

const repositoryRoot = path.resolve(__dirname, '..');
const schema = JSON.parse(
  fs.readFileSync(
    path.join(
      repositoryRoot,
      'docs/product/camera-barcode-phase0-manifest.schema.json',
    ),
    'utf8',
  ),
) as unknown;
const template = JSON.parse(
  fs.readFileSync(
    path.join(
      repositoryRoot,
      'docs/product/camera-barcode-phase0-manifest.example.json',
    ),
    'utf8',
  ),
) as Phase0Manifest;
const cryptoProvider = webcrypto as unknown as WebCryptoProvider;

function cloneTemplate(): Phase0Manifest {
  return structuredClone(template);
}

function validRun() {
  return {
    runId: 'synthetic-valid-run',
    sampleId: 'synthetic-ean13-valid',
    environmentId: 'android-low-pwa-zxing-template',
    scenarioId: 'cold-normal-handheld',
    sequence: 1,
    repetition: 1,
    runDate: '2026-08-30',
    result: 'DECODED_MATCH',
    observedSymbology: 'EAN_13',
    observedLength: 13,
    payloadMatchesExpected: true,
    checksumResult: 'VALID',
    cameraReadyMs: 250,
    firstCandidateMs: 600,
    firstCorrectMs: 800,
    wrongCandidateCount: 0,
    duplicateEmissionsWithin2s: 0,
    cameraTrackStoppedAfterExit: true,
    fallbackUsed: 'NONE',
    fallbackSucceeded: null,
    failureCode: null,
    excluded: false,
    exclusionReason: null,
  };
}

function resolvePhysicalEnvironment(manifest: Phase0Manifest): void {
  const environment = manifest.environments[0];
  manifest.studyId = 'android-low-study-1';
  environment.manufacturer = 'device-vendor-a';
  environment.modelAlias = 'android-low-a';
  environment.osVersion = '14';
  environment.browserVersion = '128.0';
  environment.decoderVersion = '0.1.5';
  environment.prototypeBuildId = 'phase0-local-001';
}

describe('Phase 0 manifest validation', () => {
  it('loads the canonical template under strict AJV 2020 validation', () => {
    const validate = createManifestValidator(schema);
    const result = validate(cloneTemplate());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.studyId).toBe('nortex-camera-template');
    }
  });

  it('reports malformed JSON without echoing its contents', () => {
    const result = loadManifestJson('{"secret":"do-not-echo"', schema);

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          code: 'JSON_PARSE_ERROR',
          path: '/',
          message: 'El archivo no contiene JSON válido.',
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('do-not-echo');
  });

  it('rejects duplicate IDs after schema validation', () => {
    const manifest = cloneTemplate();
    manifest.samples.push(structuredClone(manifest.samples[0]));

    const result = createManifestValidator(schema)(manifest);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          code: 'DUPLICATE_ID',
          path: '/samples/3/sampleId',
        }),
      );
    }
  });

  it('rejects run references that do not resolve to canonical arrays', () => {
    const manifest = cloneTemplate();
    manifest.studyStatus = 'IN_PROGRESS';
    manifest.runs = [{ ...validRun(), sampleId: 'missing-sample' }];

    const result = createManifestValidator(schema)(manifest);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          code: 'BROKEN_REFERENCE',
          path: '/runs/0/sampleId',
        }),
      );
    }
  });

  it('keeps a template importable but blocks physical capture until facts are recorded', () => {
    const manifest = cloneTemplate();
    const templateReadiness = evaluateCaptureReadiness(
      manifest,
      manifest.environments[0].environmentId,
    );

    expect(templateReadiness.ready).toBe(false);
    expect(templateReadiness.issues.map((issue) => issue.code)).toContain(
      'STUDY_NOT_IN_PROGRESS',
    );
    expect(
      templateReadiness.issues.filter(
        (issue) => issue.code === 'PHYSICAL_PLACEHOLDER',
      ),
    ).toHaveLength(7);

    manifest.studyStatus = 'IN_PROGRESS';
    resolvePhysicalEnvironment(manifest);

    expect(
      evaluateCaptureReadiness(manifest, manifest.environments[0].environmentId),
    ).toEqual({ ready: true, issues: [] });
  });

  it('blocks missing, non-camera and insecure environments explicitly', () => {
    const manifest = cloneTemplate();
    manifest.studyStatus = 'IN_PROGRESS';
    resolvePhysicalEnvironment(manifest);

    expect(evaluateCaptureReadiness(manifest, 'missing').issues).toContainEqual(
      expect.objectContaining({ code: 'ENVIRONMENT_NOT_FOUND' }),
    );

    manifest.environments[0].secureContext = false;
    expect(
      evaluateCaptureReadiness(manifest, manifest.environments[0].environmentId)
        .issues,
    ).toContainEqual(expect.objectContaining({ code: 'INSECURE_CONTEXT' }));

    manifest.environments[0].surface = 'KEYBOARD_WEDGE';
    manifest.environments[0].cameraFacing = 'NOT_APPLICABLE';
    expect(
      evaluateCaptureReadiness(manifest, manifest.environments[0].environmentId)
        .issues,
    ).toContainEqual(
      expect.objectContaining({ code: 'NOT_A_CAMERA_ENVIRONMENT' }),
    );
  });
});

describe('Phase 0 field payload privacy', () => {
  it('uses a non-extractable HMAC-SHA-256 CryptoKey', async () => {
    const secret = 'synthetic-phase0-secret';
    const payload = '7501234567893';
    const expected = `hmac-sha256:${createHmac('sha256', secret)
      .update(payload)
      .digest('hex')}`;

    const key = await importEphemeralHmacKey(secret, cryptoProvider);
    expect(key.extractable).toBe(false);
    expect(key.algorithm.name).toBe('HMAC');
    expect(key.usages).toContain('sign');

    await expect(
      fingerprintNormalizedPayload(payload, key, cryptoProvider),
    ).resolves.toBe(expected);
    await expect(
      payloadMatchesFingerprint(payload, expected, key, cryptoProvider),
    ).resolves.toBe(true);
    await expect(
      payloadMatchesFingerprint(`${payload}0`, expected, key, cryptoProvider),
    ).resolves.toBe(false);
    await expect(
      payloadMatchesFingerprint(payload, 'sha256:invalid', key, cryptoProvider),
    ).resolves.toBe(false);
  });

  it('supports one-shot fingerprinting without returning the ephemeral key', async () => {
    const fingerprint = await fingerprintWithEphemeralSecret(
      'synthetic-code',
      'temporary-only-secret',
      cryptoProvider,
    );

    expect(fingerprint).toMatch(/^hmac-sha256:[a-f0-9]{64}$/);
    await expect(
      fingerprintWithEphemeralSecret(
        'synthetic-code',
        '   ',
        cryptoProvider,
      ),
    ).rejects.toThrow('no puede estar vacío');
  });

  it.each(FORBIDDEN_EXPORT_KEYS)(
    'fails closed when export contains forbidden key %s',
    (forbiddenKey) => {
      const manifest = cloneTemplate() as unknown as Record<string, unknown>;
      manifest.wrapper = { [forbiddenKey]: 'must-never-export' };

      expect(() => sanitizeManifestForExport(manifest)).toThrow(
        ManifestPrivacyError,
      );
      try {
        sanitizeManifestForExport(manifest);
      } catch (error) {
        expect(error).toMatchObject({
          forbiddenKey,
          path: `/wrapper/${forbiddenKey}`,
        });
        expect(String(error)).not.toContain('must-never-export');
      }
    },
  );

  it('rejects case variants, circular values and non-JSON values', () => {
    expect(() => sanitizeManifestForExport({ RawCode: 'hidden' })).toThrow(
      ManifestPrivacyError,
    );
    const prototypePayload = JSON.parse(
      '{"__proto__":{"value":"must-not-disappear"}}',
    ) as unknown;
    expect(() => sanitizeManifestForExport(prototypePayload)).toThrow(
      'clave JSON insegura',
    );

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => sanitizeManifestForExport(circular)).toThrow(
      'referencia circular',
    );
    expect(() => sanitizeManifestForExport({ value: Number.NaN })).toThrow(
      'número no finito',
    );
  });

  it('exports a redacted field fingerprint without the payload or secret', async () => {
    const payload = 'field-payload-never-export';
    const secret = 'local-operator-secret';
    const manifest = cloneTemplate();
    manifest.studyStatus = 'IN_PROGRESS';
    manifest.dataClassification = 'LOCAL_FIELD_REDACTED';

    const fieldSample = manifest.samples[0];
    fieldSample.provenance = 'FIELD_EPHEMERAL';
    fieldSample.repoSafe = false;
    fieldSample.expectedFingerprint = await fingerprintWithEphemeralSecret(
      payload,
      secret,
      cryptoProvider,
    );
    delete fieldSample.expectedValue;

    const exported = serializeManifestForExport(manifest, schema);
    const exportedManifest = JSON.parse(exported) as Phase0Manifest;

    expect(exportedManifest.samples[0]).toMatchObject({
      expectedFingerprint: fieldSample.expectedFingerprint,
      repoSafe: false,
    });
    expect(exported).not.toContain(payload);
    expect(exported).not.toContain(secret);
    expect(exported.endsWith('\n')).toBe(true);
  });

  it('refuses to serialize schema-invalid data', () => {
    const manifest = cloneTemplate();
    manifest.privacy = {
      ...(manifest.privacy as Record<string, unknown>),
      realPayloadsInRepo: true,
    };

    expect(() => serializeManifestForExport(manifest, schema)).toThrow(
      ManifestValidationError,
    );
  });
});

describe('Phase 0 explicit JSON download', () => {
  it('creates one Blob, triggers the requested file and revokes its URL', () => {
    const createBlob = vi.fn((contents: string, mimeType: string) => ({
      contents,
      mimeType,
    }));
    const createObjectUrl = vi.fn(() => 'blob:phase0-safe');
    const revokeObjectUrl = vi.fn();
    const triggerDownload = vi.fn();
    const deferCleanup = vi.fn((cleanup: () => void) => cleanup());
    const dependencies: ManifestDownloadDependencies = {
      createBlob,
      createObjectUrl,
      revokeObjectUrl,
      triggerDownload,
      deferCleanup,
    };

    const receipt = downloadManifestJson(cloneTemplate(), schema, {
      dependencies,
      fileName: 'phase0-evidence.json',
    });

    expect(receipt.fileName).toBe('phase0-evidence.json');
    expect(receipt.byteLength).toBeGreaterThan(0);
    expect(createBlob).toHaveBeenCalledOnce();
    expect(createBlob).toHaveBeenCalledWith(
      expect.stringContaining('"studyId": "nortex-camera-template"'),
      'application/json;charset=utf-8',
    );
    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(triggerDownload).toHaveBeenCalledWith(
      'blob:phase0-safe',
      'phase0-evidence.json',
    );
    expect(deferCleanup).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:phase0-safe');
  });

  it('rejects unsafe file names before creating browser resources', () => {
    const dependencies: ManifestDownloadDependencies = {
      createBlob: vi.fn(),
      createObjectUrl: vi.fn(),
      revokeObjectUrl: vi.fn(),
      triggerDownload: vi.fn(),
      deferCleanup: vi.fn(),
    };

    expect(() =>
      downloadManifestJson(cloneTemplate(), schema, {
        dependencies,
        fileName: '../evidence.json',
      }),
    ).toThrow('no es seguro');
    expect(dependencies.createBlob).not.toHaveBeenCalled();
  });
});
