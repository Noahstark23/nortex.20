import Ajv2020, {
  type ErrorObject,
  type ValidateFunction,
} from 'ajv/dist/2020';

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface Phase0Sample {
  sampleId: string;
  repoSafe: boolean;
  expectedValue?: string;
  expectedFingerprint?: string;
  [key: string]: unknown;
}

export interface Phase0Environment {
  environmentId: string;
  surface: string;
  cameraFacing: string;
  secureContext: boolean;
  [key: string]: unknown;
}

export interface Phase0Scenario {
  scenarioId: string;
  [key: string]: unknown;
}

export interface Phase0Run {
  runId: string;
  sampleId: string;
  environmentId: string;
  scenarioId: string;
  [key: string]: unknown;
}

export interface Phase0Manifest {
  studyId: string;
  studyStatus: string;
  samples: Phase0Sample[];
  environments: Phase0Environment[];
  scenarios: Phase0Scenario[];
  runs: Phase0Run[];
  [key: string]: unknown;
}

export type ManifestIssueCode =
  | 'BROKEN_REFERENCE'
  | 'DUPLICATE_ID'
  | 'JSON_PARSE_ERROR'
  | 'SCHEMA_ERROR';

export interface ManifestValidationIssue {
  code: ManifestIssueCode;
  path: string;
  message: string;
}

export type ManifestValidationResult =
  | {
      ok: true;
      manifest: Phase0Manifest;
      issues: [];
    }
  | {
      ok: false;
      issues: ManifestValidationIssue[];
    };

export type ManifestValidator = (value: unknown) => ManifestValidationResult;

const ID_COLLECTIONS = [
  ['samples', 'sampleId'],
  ['environments', 'environmentId'],
  ['scenarios', 'scenarioId'],
  ['runs', 'runId'],
] as const;

const RUN_REFERENCES = [
  ['sampleId', 'samples'],
  ['environmentId', 'environments'],
  ['scenarioId', 'scenarios'],
] as const;

export const FORBIDDEN_EXPORT_KEYS = [
  'rawCode',
  'rawFrame',
  'tenantId',
  'customerName',
  'imei',
  'serialNumber',
  'gps',
  'userAgent',
  'notes',
] as const;

const FORBIDDEN_EXPORT_KEY_LOOKUP = new Map(
  FORBIDDEN_EXPORT_KEYS.map((key) => [key.toLocaleLowerCase('en-US'), key]),
);

export const PHYSICAL_ENVIRONMENT_PLACEHOLDERS = [
  'record-at-run',
  'not-built',
  'nortex-camera-template',
] as const;

const PHYSICAL_ENVIRONMENT_PLACEHOLDER_LOOKUP = new Set(
  PHYSICAL_ENVIRONMENT_PLACEHOLDERS.map((value) => value.toLocaleLowerCase('en-US')),
);

const PHYSICAL_ENVIRONMENT_FIELDS = [
  'manufacturer',
  'modelAlias',
  'osName',
  'osVersion',
  'browserName',
  'browserVersion',
  'engine',
  'decoderVersion',
  'prototypeBuildId',
] as const;

const HMAC_FINGERPRINT_PATTERN = /^hmac-sha256:[a-f0-9]{64}$/;
const JSON_MIME_TYPE = 'application/json;charset=utf-8';
const UNSAFE_JSON_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function schemaIssues(errors: ErrorObject[] | null | undefined): ManifestValidationIssue[] {
  if (!errors || errors.length === 0) {
    return [
      {
        code: 'SCHEMA_ERROR',
        path: '/',
        message: 'El manifiesto no cumple el schema inyectado.',
      },
    ];
  }

  return errors.map((error) => ({
    code: 'SCHEMA_ERROR',
    path: error.instancePath || '/',
    message: error.message
      ? `Schema ${error.keyword}: ${error.message}.`
      : `Schema ${error.keyword}: valor inválido.`,
  }));
}

function duplicateIdIssues(manifest: Phase0Manifest): ManifestValidationIssue[] {
  const issues: ManifestValidationIssue[] = [];

  for (const [collectionName, idKey] of ID_COLLECTIONS) {
    const seen = new Set<string>();
    const collection = manifest[collectionName];

    collection.forEach((entry, index) => {
      const id = entry[idKey];
      if (seen.has(id)) {
        issues.push({
          code: 'DUPLICATE_ID',
          path: `/${collectionName}/${index}/${idKey}`,
          message: `El ID ${idKey} está repetido en ${collectionName}.`,
        });
      }
      seen.add(id);
    });
  }

  return issues;
}

function brokenReferenceIssues(manifest: Phase0Manifest): ManifestValidationIssue[] {
  const issues: ManifestValidationIssue[] = [];
  const validIds = new Map<string, Set<string>>();

  for (const [collectionName, idKey] of ID_COLLECTIONS) {
    validIds.set(
      collectionName,
      new Set(manifest[collectionName].map((entry) => entry[idKey])),
    );
  }

  manifest.runs.forEach((run, runIndex) => {
    for (const [runKey, targetCollection] of RUN_REFERENCES) {
      if (!validIds.get(targetCollection)?.has(run[runKey])) {
        issues.push({
          code: 'BROKEN_REFERENCE',
          path: `/runs/${runIndex}/${runKey}`,
          message: `${runKey} no referencia un ID existente en ${targetCollection}.`,
        });
      }
    }
  });

  return issues;
}

export function findManifestInvariantIssues(
  manifest: Phase0Manifest,
): ManifestValidationIssue[] {
  return [
    ...duplicateIdIssues(manifest),
    ...brokenReferenceIssues(manifest),
  ];
}

/**
 * Compila una sola vez el schema 2020-12 que entrega el llamador. No se agregan
 * formatos implícitos: las reglas aceptadas son únicamente las del contrato.
 */
export function createManifestValidator(schema: unknown): ManifestValidator {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    validateFormats: false,
  });
  const validate = ajv.compile(schema) as ValidateFunction;

  return (value: unknown): ManifestValidationResult => {
    if (!validate(value)) {
      return { ok: false, issues: schemaIssues(validate.errors) };
    }

    const manifest = value as Phase0Manifest;
    const issues = findManifestInvariantIssues(manifest);
    if (issues.length > 0) {
      return { ok: false, issues };
    }

    return { ok: true, manifest, issues: [] };
  };
}

export function validateManifest(
  value: unknown,
  schema: unknown,
): ManifestValidationResult {
  return createManifestValidator(schema)(value);
}

export function loadManifestJson(
  source: string,
  schema: unknown,
): ManifestValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    return {
      ok: false,
      issues: [
        {
          code: 'JSON_PARSE_ERROR',
          path: '/',
          message: 'El archivo no contiene JSON válido.',
        },
      ],
    };
  }

  return validateManifest(parsed, schema);
}

export type CaptureReadinessIssueCode =
  | 'ENVIRONMENT_NOT_FOUND'
  | 'INSECURE_CONTEXT'
  | 'NOT_A_CAMERA_ENVIRONMENT'
  | 'PHYSICAL_PLACEHOLDER'
  | 'STUDY_NOT_IN_PROGRESS';

export interface CaptureReadinessIssue {
  code: CaptureReadinessIssueCode;
  path: string;
  message: string;
}

export interface CaptureReadiness {
  ready: boolean;
  issues: CaptureReadinessIssue[];
}

export function findPhysicalEnvironmentPlaceholderIssues(
  environment: Phase0Environment,
  environmentIndex = 0,
): CaptureReadinessIssue[] {
  const issues: CaptureReadinessIssue[] = [];

  for (const field of PHYSICAL_ENVIRONMENT_FIELDS) {
    const value = environment[field];
    if (
      typeof value === 'string' &&
      PHYSICAL_ENVIRONMENT_PLACEHOLDER_LOOKUP.has(
        value.trim().toLocaleLowerCase('en-US'),
      )
    ) {
      issues.push({
        code: 'PHYSICAL_PLACEHOLDER',
        path: `/environments/${environmentIndex}/${field}`,
        message: `${field} debe registrarse con el valor observado antes de capturar.`,
      });
    }
  }

  return issues;
}

/**
 * Esta compuerta se evalúa después de validar el manifiesto. Una plantilla puede
 * importarse, pero no iniciar cámara hasta convertirse en un estudio real y
 * resolver sus datos físicos.
 */
export function evaluateCaptureReadiness(
  manifest: Phase0Manifest,
  environmentId: string,
): CaptureReadiness {
  const issues: CaptureReadinessIssue[] = [];

  if (
    PHYSICAL_ENVIRONMENT_PLACEHOLDER_LOOKUP.has(
      manifest.studyId.trim().toLocaleLowerCase('en-US'),
    )
  ) {
    issues.push({
      code: 'PHYSICAL_PLACEHOLDER',
      path: '/studyId',
      message: 'studyId debe identificar esta ejecución física antes de capturar.',
    });
  }

  if (manifest.studyStatus !== 'IN_PROGRESS') {
    issues.push({
      code: 'STUDY_NOT_IN_PROGRESS',
      path: '/studyStatus',
      message: 'La captura solo se habilita con studyStatus IN_PROGRESS.',
    });
  }

  const environmentIndex = manifest.environments.findIndex(
    (environment) => environment.environmentId === environmentId,
  );
  const environment = manifest.environments[environmentIndex];
  if (!environment) {
    issues.push({
      code: 'ENVIRONMENT_NOT_FOUND',
      path: '/environments',
      message: 'El ambiente seleccionado no existe en el manifiesto.',
    });
    return { ready: false, issues };
  }

  issues.push(
    ...findPhysicalEnvironmentPlaceholderIssues(environment, environmentIndex),
  );

  if (
    environment.surface === 'KEYBOARD_WEDGE' ||
    environment.cameraFacing === 'NOT_APPLICABLE'
  ) {
    issues.push({
      code: 'NOT_A_CAMERA_ENVIRONMENT',
      path: `/environments/${environmentIndex}/cameraFacing`,
      message: 'El ambiente seleccionado no representa una captura por cámara.',
    });
  } else if (!environment.secureContext) {
    issues.push({
      code: 'INSECURE_CONTEXT',
      path: `/environments/${environmentIndex}/secureContext`,
      message: 'La cámara web requiere un contexto seguro verificado.',
    });
  }

  return { ready: issues.length === 0, issues };
}

export type WebCryptoProvider = Pick<Crypto, 'subtle'>;

function getWebCrypto(provider?: WebCryptoProvider): WebCryptoProvider {
  const candidate = provider ?? globalThis.crypto;
  if (!candidate?.subtle) {
    throw new Error('WebCrypto SubtleCrypto no está disponible.');
  }
  return candidate;
}

function assertUsableHmacKey(key: CryptoKey): void {
  if (
    key.extractable ||
    key.algorithm.name !== 'HMAC' ||
    !key.usages.includes('sign')
  ) {
    throw new Error('La CryptoKey debe ser HMAC, no extraíble y apta para firmar.');
  }
}

export async function importEphemeralHmacKey(
  secret: string,
  provider?: WebCryptoProvider,
): Promise<CryptoKey> {
  if (secret.trim().length === 0) {
    throw new Error('El secreto efímero no puede estar vacío.');
  }

  const cryptoProvider = getWebCrypto(provider);
  const secretBytes = new TextEncoder().encode(secret);

  try {
    const key = await cryptoProvider.subtle.importKey(
      'raw',
      secretBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    assertUsableHmacKey(key);
    return key;
  } finally {
    secretBytes.fill(0);
  }
}

export async function withEphemeralHmacKey<T>(
  secret: string,
  operation: (key: CryptoKey) => T | Promise<T>,
  provider?: WebCryptoProvider,
): Promise<T> {
  const key = await importEphemeralHmacKey(secret, provider);
  return operation(key);
}

export async function fingerprintNormalizedPayload(
  normalizedPayload: string,
  key: CryptoKey,
  provider?: WebCryptoProvider,
): Promise<string> {
  if (normalizedPayload.length === 0) {
    throw new Error('El payload normalizado no puede estar vacío.');
  }
  assertUsableHmacKey(key);

  const payloadBytes = new TextEncoder().encode(normalizedPayload);
  try {
    const signature = await getWebCrypto(provider).subtle.sign(
      'HMAC',
      key,
      payloadBytes,
    );
    const hexadecimal = Array.from(new Uint8Array(signature), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    return `hmac-sha256:${hexadecimal}`;
  } finally {
    payloadBytes.fill(0);
  }
}

export async function fingerprintWithEphemeralSecret(
  normalizedPayload: string,
  secret: string,
  provider?: WebCryptoProvider,
): Promise<string> {
  return withEphemeralHmacKey(
    secret,
    (key) => fingerprintNormalizedPayload(normalizedPayload, key, provider),
    provider,
  );
}

function equalAsciiConstantWork(left: string, right: string): boolean {
  const longestLength = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;

  for (let index = 0; index < longestLength; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }

  return difference === 0;
}

export async function payloadMatchesFingerprint(
  normalizedPayload: string,
  expectedFingerprint: string,
  key: CryptoKey,
  provider?: WebCryptoProvider,
): Promise<boolean> {
  if (!HMAC_FINGERPRINT_PATTERN.test(expectedFingerprint)) {
    return false;
  }
  const actualFingerprint = await fingerprintNormalizedPayload(
    normalizedPayload,
    key,
    provider,
  );
  return equalAsciiConstantWork(actualFingerprint, expectedFingerprint);
}

export class ManifestPrivacyError extends Error {
  readonly path: string;
  readonly forbiddenKey?: string;

  constructor(message: string, path: string, forbiddenKey?: string) {
    super(message);
    this.name = 'ManifestPrivacyError';
    this.path = path;
    this.forbiddenKey = forbiddenKey;
  }
}

export class ManifestValidationError extends Error {
  readonly issues: ManifestValidationIssue[];

  constructor(issues: ManifestValidationIssue[]) {
    super('El manifiesto no cumple el contrato de evidencia.');
    this.name = 'ManifestValidationError';
    this.issues = issues;
  }
}

function sanitizeJsonValue(
  value: unknown,
  path: string,
  ancestors: Set<object>,
): JsonValue {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  ) {
    return value as JsonPrimitive;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ManifestPrivacyError('La exportación contiene un número no finito.', path);
    }
    return value;
  }

  if (typeof value !== 'object') {
    throw new ManifestPrivacyError('La exportación contiene un valor no serializable.', path);
  }

  if (ancestors.has(value)) {
    throw new ManifestPrivacyError('La exportación contiene una referencia circular.', path);
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry, index) =>
        sanitizeJsonValue(entry, `${path}/${index}`, ancestors),
      );
    }

    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new ManifestPrivacyError('La exportación solo admite objetos JSON planos.', path);
    }

    const sanitized = Object.create(null) as { [key: string]: JsonValue };
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (UNSAFE_JSON_KEYS.has(key)) {
        throw new ManifestPrivacyError(
          `La exportación contiene la clave JSON insegura ${key}.`,
          `${path}/${key}`,
          key,
        );
      }
      const forbiddenKey = FORBIDDEN_EXPORT_KEY_LOOKUP.get(
        key.toLocaleLowerCase('en-US'),
      );
      if (forbiddenKey) {
        throw new ManifestPrivacyError(
          `La exportación contiene la clave prohibida ${forbiddenKey}.`,
          `${path}/${key}`,
          forbiddenKey,
        );
      }
      sanitized[key] = sanitizeJsonValue(entry, `${path}/${key}`, ancestors);
    }
    return sanitized;
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Produce una copia JSON segura. Ante una clave sensible falla cerrada; nunca la
 * elimina silenciosamente porque eso escondería una desviación del protocolo.
 */
export function sanitizeManifestForExport(manifest: unknown): JsonValue {
  return sanitizeJsonValue(manifest, '', new Set<object>());
}

interface PreparedManifestExport {
  contents: string;
  manifest: Phase0Manifest;
}

function prepareManifestExport(
  manifest: unknown,
  schema: unknown,
): PreparedManifestExport {
  const sanitized = sanitizeManifestForExport(manifest);
  const validation = validateManifest(sanitized, schema);
  if (!validation.ok) {
    throw new ManifestValidationError(validation.issues);
  }
  return {
    contents: `${JSON.stringify(sanitized, null, 2)}\n`,
    manifest: validation.manifest,
  };
}

export function serializeManifestForExport(
  manifest: unknown,
  schema: unknown,
): string {
  return prepareManifestExport(manifest, schema).contents;
}

export interface ManifestDownloadDependencies {
  createBlob: (contents: string, mimeType: string) => unknown;
  createObjectUrl: (blob: unknown) => string;
  revokeObjectUrl: (url: string) => void;
  triggerDownload: (href: string, fileName: string) => void;
  deferCleanup: (cleanup: () => void) => void;
}

export interface DownloadManifestOptions {
  dependencies?: ManifestDownloadDependencies;
  fileName?: string;
}

export interface ManifestDownloadReceipt {
  byteLength: number;
  fileName: string;
}

export function createBrowserManifestDownloadDependencies(): ManifestDownloadDependencies {
  return {
    createBlob: (contents, mimeType) => new Blob([contents], { type: mimeType }),
    createObjectUrl: (blob) => URL.createObjectURL(blob as Blob),
    revokeObjectUrl: (url) => URL.revokeObjectURL(url),
    triggerDownload: (href, fileName) => {
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = fileName;
      anchor.hidden = true;
      document.body.append(anchor);
      try {
        anchor.click();
      } finally {
        anchor.remove();
      }
    },
    deferCleanup: (cleanup) => {
      globalThis.setTimeout(cleanup, 0);
    },
  };
}

function safeDownloadFileName(studyId: string, requested?: string): string {
  const fileName = requested ?? `${studyId}-phase0-manifest.json`;
  if (
    !/^[a-z0-9][a-z0-9._-]{0,126}\.json$/i.test(fileName) ||
    fileName.includes('..')
  ) {
    throw new Error('El nombre de descarga JSON no es seguro.');
  }
  return fileName;
}

export function downloadManifestJson(
  manifest: unknown,
  schema: unknown,
  options: DownloadManifestOptions = {},
): ManifestDownloadReceipt {
  const prepared = prepareManifestExport(manifest, schema);
  const dependencies =
    options.dependencies ?? createBrowserManifestDownloadDependencies();
  const fileName = safeDownloadFileName(
    prepared.manifest.studyId,
    options.fileName,
  );
  const blob = dependencies.createBlob(prepared.contents, JSON_MIME_TYPE);
  const objectUrl = dependencies.createObjectUrl(blob);

  try {
    dependencies.triggerDownload(objectUrl, fileName);
  } finally {
    try {
      dependencies.deferCleanup(() => dependencies.revokeObjectUrl(objectUrl));
    } catch {
      dependencies.revokeObjectUrl(objectUrl);
    }
  }

  return {
    byteLength: new TextEncoder().encode(prepared.contents).byteLength,
    fileName,
  };
}
