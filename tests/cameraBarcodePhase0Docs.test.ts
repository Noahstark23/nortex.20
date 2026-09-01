import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isValidEan13 } from '../utils/scaleLabels';

const repositoryRoot = path.resolve(__dirname, '..');
const readText = (relativePath: string) =>
  fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
const readJson = <T>(relativePath: string): T => JSON.parse(readText(relativePath)) as T;

const planPath = 'docs/PLAN_CAMARA_CODIGOS_BODEGA.md';
const schemaPath = 'docs/product/camera-barcode-phase0-manifest.schema.json';
const examplePath = 'docs/product/camera-barcode-phase0-manifest.example.json';
const archivedMobilePlanPaths = ['docs/PLAN_MOBILE_STORES.md', 'docs/PLAN_APP_MOVIL.md'] as const;
const supersededResearchArtifacts = [
  'docs/PLAN_CAMARA_MOVIL_FASE_0.md',
  'docs/research/camera-mobile-phase-0/SESSION_TEMPLATE.md',
  'docs/research/camera-mobile-phase-0/SAMPLE_MATRIX_TEMPLATE.csv',
  'docs/research/camera-mobile-phase-0/DECISION_SCORECARD_TEMPLATE.md',
] as const;

type JsonRecord = Record<string, unknown>;

type SchemaValidator = ((value: unknown) => boolean) & {
  errors?: unknown;
};

type Ajv2020Instance = {
  compile: (schema: unknown) => SchemaValidator;
};

type Ajv2020Constructor = new (options: JsonRecord) => Ajv2020Instance;

const requireFromTest = createRequire(import.meta.url);
const Ajv2020 = requireFromTest('ajv/dist/2020').default as Ajv2020Constructor;

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectKeys(entry, keys));
    return keys;
  }

  if (value && typeof value === 'object') {
    Object.entries(value as JsonRecord).forEach(([key, entry]) => {
      keys.add(key);
      collectKeys(entry, keys);
    });
  }

  return keys;
}

function expectUniqueIds(entries: JsonRecord[], key: string) {
  const ids = entries.map((entry) => entry[key]);
  expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
  expect(new Set(ids).size).toBe(ids.length);
}

function getStringSet(entries: JsonRecord[], key: string): Set<string> {
  return new Set(
    entries
      .map((entry) => entry[key])
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  );
}

function hasValidReferences(manifest: JsonRecord): boolean {
  const sampleIds = getStringSet(manifest.samples as JsonRecord[], 'sampleId');
  const environmentIds = getStringSet(manifest.environments as JsonRecord[], 'environmentId');
  const scenarioIds = getStringSet(manifest.scenarios as JsonRecord[], 'scenarioId');

  return (manifest.runs as JsonRecord[]).every(
    (run) =>
      sampleIds.has(run.sampleId as string) &&
      environmentIds.has(run.environmentId as string) &&
      scenarioIds.has(run.scenarioId as string),
  );
}

describe('camera and barcode Phase 0 documentation', () => {
  it('keeps Phase 0 explicitly research-only and links its canonical artifacts', () => {
    const plan = readText(planPath);

    expect(plan).toContain('**Estado:** Fase 0 en curso');
    expect(plan).toContain('**Cambios al runtime productivo, schema, permisos o inventario:** ninguno.');
    expect(plan).toContain('camera-barcode-phase0-manifest.schema.json');
    expect(plan).toContain('camera-barcode-phase0-manifest.example.json');
    expect(plan).toContain('Escanear solo propone una identidad');
    expect(plan).toContain('Una sola lectura incorrecta');
    expect(plan).toContain('ProductCodeResolver');
  });

  it('uses a strict privacy-first JSON Schema contract', () => {
    const schema = readJson<JsonRecord>(schemaPath);
    const privacy = ((schema.$defs as JsonRecord).privacy as JsonRecord).properties as JsonRecord;

    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.additionalProperties).toBe(false);
    expect((privacy.realPayloadsInRepo as JsonRecord).const).toBe(false);
    expect((privacy.rawFramesPersisted as JsonRecord).const).toBe(false);
    expect((privacy.customerDataAllowed as JsonRecord).const).toBe(false);
    expect((privacy.fingerprintAlgorithm as JsonRecord).const).toBe('HMAC-SHA-256');

    const forbiddenKeys = [
      'tenantId',
      'customerName',
      'rawCode',
      'rawFrame',
      'imei',
      'serialNumber',
      'gps',
      'userAgent',
      'notes',
    ];
    const schemaKeys = collectKeys(schema);
    forbiddenKeys.forEach((key) => expect(schemaKeys.has(key)).toBe(false));
  });

  it('compiles the schema strictly and validates the canonical template', () => {
    const schema = readJson<JsonRecord>(schemaPath);
    const example = readJson<JsonRecord>(examplePath);
    const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: false });
    const validate = ajv.compile(schema);

    expect(validate(example), JSON.stringify(validate.errors)).toBe(true);
    expect(hasValidReferences(example)).toBe(true);
  });

  it('rejects mislabeled field data and internally impossible runs', () => {
    const schema = readJson<JsonRecord>(schemaPath);
    const example = readJson<JsonRecord>(examplePath);
    const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: false });
    const validate = ajv.compile(schema);

    const mislabeledFieldManifest = structuredClone(example);
    const fieldSample = (mislabeledFieldManifest.samples as JsonRecord[])[0];
    fieldSample.provenance = 'FIELD_EPHEMERAL';
    fieldSample.repoSafe = false;
    fieldSample.expectedFingerprint = `hmac-sha256:${'a'.repeat(64)}`;
    delete fieldSample.expectedValue;
    expect(validate(mislabeledFieldManifest)).toBe(false);

    const impossibleRunManifest = structuredClone(example);
    impossibleRunManifest.studyStatus = 'IN_PROGRESS';
    impossibleRunManifest.runs = [
      {
        runId: 'synthetic-impossible-run',
        sampleId: 'synthetic-ean13-valid',
        environmentId: 'android-low-pwa-zxing-template',
        scenarioId: 'cold-normal-handheld',
        sequence: 1,
        repetition: 1,
        runDate: '2026-08-30',
        result: 'PERMISSION_DENIED',
        observedSymbology: null,
        observedLength: null,
        payloadMatchesExpected: null,
        checksumResult: 'NOT_OBSERVED',
        cameraReadyMs: null,
        firstCandidateMs: null,
        firstCorrectMs: 1200,
        wrongCandidateCount: 0,
        duplicateEmissionsWithin2s: 0,
        cameraTrackStoppedAfterExit: true,
        fallbackUsed: 'NONE',
        fallbackSucceeded: true,
        failureCode: 'PERMISSION_NOT_ALLOWED',
        excluded: false,
        exclusionReason: null,
      },
    ];
    expect(validate(impossibleRunManifest)).toBe(false);

    const validRunManifest = structuredClone(example);
    validRunManifest.studyStatus = 'IN_PROGRESS';
    validRunManifest.runs = [
      {
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
      },
    ];
    expect(validate(validRunManifest), JSON.stringify(validate.errors)).toBe(true);
    expect(hasValidReferences(validRunManifest)).toBe(true);

    const brokenReferenceManifest = structuredClone(validRunManifest);
    (brokenReferenceManifest.runs as JsonRecord[])[0].sampleId = 'missing-sample';
    expect(hasValidReferences(brokenReferenceManifest)).toBe(false);
  });

  it('allows field manifests only when they stay redacted and fingerprinted', () => {
    const schema = readJson<JsonRecord>(schemaPath);
    const example = readJson<JsonRecord>(examplePath);
    const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: false });
    const validate = ajv.compile(schema);

    const validFieldManifest = structuredClone(example);
    validFieldManifest.studyStatus = 'IN_PROGRESS';
    validFieldManifest.dataClassification = 'LOCAL_FIELD_REDACTED';

    const fieldSample = (validFieldManifest.samples as JsonRecord[])[0];
    fieldSample.provenance = 'FIELD_EPHEMERAL';
    fieldSample.repoSafe = false;
    fieldSample.expectedFingerprint = `hmac-sha256:${'b'.repeat(64)}`;
    delete fieldSample.expectedValue;

    expect(validate(validFieldManifest), JSON.stringify(validate.errors)).toBe(true);

    const leakedFieldManifest = structuredClone(validFieldManifest);
    ((leakedFieldManifest.samples as JsonRecord[])[0] as JsonRecord).expectedValue = '7501234567893';
    expect(validate(leakedFieldManifest)).toBe(false);
  });

  it('ships a synthetic template, not fabricated field results', () => {
    const example = readJson<JsonRecord>(examplePath);
    const privacy = example.privacy as JsonRecord;
    const samples = example.samples as JsonRecord[];
    const environments = example.environments as JsonRecord[];
    const scenarios = example.scenarios as JsonRecord[];
    const runs = example.runs as JsonRecord[];

    expect(example.studyStatus).toBe('TEMPLATE');
    expect(example.dataClassification).toBe('REPO_SAFE_SYNTHETIC');
    expect(privacy).toEqual({
      realPayloadsInRepo: false,
      rawFramesPersisted: false,
      customerDataAllowed: false,
      fingerprintAlgorithm: 'HMAC-SHA-256',
    });
    expect(runs).toEqual([]);

    expectUniqueIds(samples, 'sampleId');
    expectUniqueIds(environments, 'environmentId');
    expectUniqueIds(scenarios, 'scenarioId');
    expect(hasValidReferences(example)).toBe(true);

    const exampleKeys = collectKeys(example);
    [
      'tenantId',
      'customerName',
      'rawCode',
      'rawFrame',
      'imei',
      'serialNumber',
      'gps',
      'userAgent',
      'notes',
    ].forEach((key) => expect(exampleKeys.has(key)).toBe(false));

    samples.forEach((sample) => {
      expect(sample.provenance).toBe('SYNTHETIC');
      expect(sample.repoSafe).toBe(true);
      expect(typeof sample.expectedValue).toBe('string');
      expect(sample).not.toHaveProperty('expectedFingerprint');
      expect(sample.artifactRef).toBeNull();

      if (
        sample.checksumExpectation === 'VALID' &&
        (sample.symbology === 'EAN_13' || sample.symbology === 'SCALE_EAN_13')
      ) {
        expect(isValidEan13(sample.expectedValue as string)).toBe(true);
      }
    });
  });

  it('removes the stale claim that the BODEGUERO role is absent', () => {
    const bodegaPlan = readText('docs/PLAN_BODEGA_CONFIABLE_2026.md');

    expect(bodegaPlan).not.toContain('Nortex aún no tiene un rol Bodeguero');
    expect(bodegaPlan).not.toContain('La auditoría confirmó que no existe `BODEGUERO`');
    expect(bodegaPlan).toContain('`BODEGUERO` ya existe');
  });

  it('archives stale mobile-store plans and points them to current authorities', () => {
    archivedMobilePlanPaths.forEach((relativePath) => {
      const archivedPlan = readText(relativePath);

      expect(archivedPlan).toContain('**ARCHIVADO (2026-08-30):**');
      expect(archivedPlan).toContain('PLAN_CAMARA_CODIGOS_BODEGA.md');
      expect(archivedPlan).toContain('BUILD_ANDROID.md');
    });
  });

  it('keeps a single canonical Phase 0 authority in the repository', () => {
    supersededResearchArtifacts.forEach((relativePath) => {
      expect(fs.existsSync(path.join(repositoryRoot, relativePath))).toBe(false);
    });
  });
});
