/**
 * Dominio puro del arnes de investigacion de camara/codigos de Fase 0.
 *
 * Esta capa no conoce DOM, camara, red ni persistencia. El payload observado solo
 * cruza `classifyCandidate` y, para muestras de campo, el comparador HMAC provisto
 * por el caller. Ningun tipo de corrida permite conservar el valor crudo.
 */

export type Phase0StudyStatus = 'TEMPLATE' | 'IN_PROGRESS' | 'COMPLETE';
export type Phase0DataClassification = 'REPO_SAFE_SYNTHETIC' | 'LOCAL_FIELD_REDACTED';

export interface Phase0Privacy {
    realPayloadsInRepo: false;
    rawFramesPersisted: false;
    customerDataAllowed: false;
    fingerprintAlgorithm: 'HMAC-SHA-256';
}

export type Phase0Symbology =
    | 'EAN_13'
    | 'EAN_8'
    | 'UPC_A'
    | 'UPC_E'
    | 'CODE_128'
    | 'QR_CODE'
    | 'DATA_MATRIX'
    | 'GS1_DATABAR'
    | 'GS1_128'
    | 'ITF_14'
    | 'SCALE_EAN_13'
    | 'UNKNOWN';

export type Phase0SemanticClass =
    | 'FIXED_PRODUCT'
    | 'INTERNAL_SKU'
    | 'SCALE_WEIGHT'
    | 'SCALE_COUNT'
    | 'SCALE_TOTAL_PRICE'
    | 'NEGATIVE'
    | 'UNKNOWN';

export type Phase0ExpectedOutcome = 'DECODE' | 'REJECT_INVALID' | 'UNSUPPORTED';
export type Phase0ChecksumExpectation = 'VALID' | 'INVALID' | 'NOT_APPLICABLE';
export type Phase0PrintSource = 'LASER' | 'THERMAL' | 'MANUFACTURER' | 'SCREEN' | 'OTHER';
export type Phase0Substrate = 'MATTE_PAPER' | 'GLOSSY_PAPER' | 'PLASTIC' | 'SCREEN' | 'OTHER';
export type Phase0ConditionTag =
    | 'PRISTINE'
    | 'WRINKLED'
    | 'CURVED'
    | 'LOW_CONTRAST'
    | 'PARTIAL_DAMAGE'
    | 'SMALL_PRINT'
    | 'LARGE_PRINT';
export type Phase0QuietZoneClass = 'COMPLIANT' | 'TIGHT' | 'CLIPPED' | 'UNKNOWN';
export type Phase0ContrastClass = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

export interface Phase0SampleBase {
    sampleId: string;
    provenance: 'SYNTHETIC' | 'PUBLIC_TEST' | 'FIELD_EPHEMERAL';
    symbology: Phase0Symbology;
    semanticClass: Phase0SemanticClass;
    expectedOutcome: Phase0ExpectedOutcome;
    checksumExpectation: Phase0ChecksumExpectation;
    printSource: Phase0PrintSource;
    substrate: Phase0Substrate;
    conditionTags: Phase0ConditionTag[];
    barcodeWidthMm: number | null;
    barcodeHeightMm: number | null;
    quietZoneClass: Phase0QuietZoneClass;
    contrastClass: Phase0ContrastClass;
    artifactRef: string | null;
}

export interface Phase0RepoSafeSample extends Phase0SampleBase {
    repoSafe: true;
    expectedValue: string;
    expectedFingerprint?: never;
}

export interface Phase0FieldSample extends Phase0SampleBase {
    repoSafe: false;
    expectedFingerprint: string;
    expectedValue?: never;
}

export type Phase0Sample = Phase0RepoSafeSample | Phase0FieldSample;

export type Phase0DeviceTier =
    | 'ANDROID_LOW'
    | 'ANDROID_MID'
    | 'IPHONE_MIN_SUPPORTED'
    | 'IPHONE_CURRENT'
    | 'DESKTOP_CONTROL';
export type Phase0Surface = 'BROWSER_TAB' | 'INSTALLED_PWA' | 'CAPACITOR_REMOTE' | 'KEYBOARD_WEDGE';
export type Phase0DecoderName =
    | 'KEYBOARD_WEDGE'
    | 'ZXING_BROWSER'
    | 'BARCODE_DETECTOR'
    | 'CAPACITOR_BARCODE_SCANNER';
export type Phase0CameraFacing = 'ENVIRONMENT' | 'USER' | 'NOT_APPLICABLE';

export interface Phase0Environment {
    environmentId: string;
    deviceTier: Phase0DeviceTier;
    manufacturer: string;
    modelAlias: string;
    osName: string;
    osVersion: string;
    surface: Phase0Surface;
    browserName: string;
    browserVersion: string;
    engine: string;
    decoderName: Phase0DecoderName;
    decoderVersion: string;
    prototypeBuildId: string;
    cameraFacing: Phase0CameraFacing;
    actualResolution: { width: number; height: number } | null;
    torchAvailable: boolean;
    secureContext: boolean;
    reportedFormats: string[];
}

export interface Phase0Scenario {
    scenarioId: string;
    startState: 'COLD' | 'WARM' | 'RESUME';
    permissionState: 'PROMPT' | 'GRANTED' | 'DENIED' | 'NOT_APPLICABLE';
    networkMode: 'ONLINE' | 'OFFLINE';
    distanceCm: number;
    angleDeg: number;
    orientationDeg: 0 | 90 | 180 | 270;
    lightingBand: 'BRIGHT' | 'NORMAL_INDOOR' | 'LOW' | 'GLARE';
    motion: 'STILL' | 'HANDHELD' | 'FAST';
    torch: 'OFF' | 'ON' | 'UNAVAILABLE';
    timeoutMs: number;
}

export type Phase0RunResult =
    | 'DECODED_MATCH'
    | 'DECODED_WRONG'
    | 'NO_DECODE'
    | 'UNSUPPORTED_FORMAT'
    | 'PERMISSION_DENIED'
    | 'CAMERA_ERROR'
    | 'ABORTED';
export type Phase0ChecksumResult = 'VALID' | 'INVALID' | 'NOT_APPLICABLE' | 'NOT_OBSERVED';
export type Phase0FallbackUsed = 'NONE' | 'MANUAL_INPUT' | 'FILE_CAPTURE' | 'KEYBOARD_WEDGE' | 'NATIVE';
export type Phase0FailureCode =
    | 'PERMISSION_NOT_ALLOWED'
    | 'CAMERA_NOT_FOUND'
    | 'CAMERA_NOT_READABLE'
    | 'SECURE_CONTEXT_REQUIRED'
    | 'DECODER_UNAVAILABLE'
    | 'FORMAT_UNSUPPORTED'
    | 'TIMEOUT'
    | 'LIFECYCLE_INTERRUPTED'
    | 'OPERATOR_ABORTED'
    | 'PROTOCOL_ERROR';
export type Phase0ExclusionReason =
    | 'PROTOCOL_DEVIATION'
    | 'EQUIPMENT_FAILURE'
    | 'DUPLICATE_RUN'
    | 'OTHER_PREDECLARED';

/** Contrato deliberadamente redactado: no contiene payload ni fingerprint observado. */
export interface Phase0Run {
    runId: string;
    sampleId: string;
    environmentId: string;
    scenarioId: string;
    sequence: number;
    repetition: number;
    runDate: string;
    result: Phase0RunResult;
    observedSymbology: string | null;
    observedLength: number | null;
    payloadMatchesExpected: boolean | null;
    checksumResult: Phase0ChecksumResult;
    cameraReadyMs: number | null;
    firstCandidateMs: number | null;
    firstCorrectMs: number | null;
    wrongCandidateCount: number;
    duplicateEmissionsWithin2s: number;
    cameraTrackStoppedAfterExit: boolean;
    fallbackUsed: Phase0FallbackUsed;
    fallbackSucceeded: boolean | null;
    failureCode: Phase0FailureCode | null;
    excluded: boolean;
    exclusionReason: Phase0ExclusionReason | null;
}

export interface Phase0Manifest {
    schemaVersion: 1;
    protocolVersion: 'phase0-v1';
    normalizationVersion: 'barcode-input-v1';
    studyId: string;
    studyStatus: Phase0StudyStatus;
    createdDate: string;
    dataClassification: Phase0DataClassification;
    privacy: Phase0Privacy;
    samples: Phase0Sample[];
    environments: Phase0Environment[];
    scenarios: Phase0Scenario[];
    runs: Phase0Run[];
}

export function sampleAllowsSuccessfulFallback(sample: Pick<Phase0Sample, 'expectedOutcome'>): boolean {
    return sample.expectedOutcome === 'DECODE';
}

const CHECKSUM_LENGTHS: Partial<Record<Phase0Symbology, number>> = {
    EAN_13: 13,
    SCALE_EAN_13: 13,
    EAN_8: 8,
    UPC_A: 12,
};

/**
 * Valida el digito de control GTIN sin convertir nunca el codigo completo a
 * Number. Por tanto, ceros iniciales y longitudes exactas se preservan.
 */
export function validateChecksum(
    symbology: Phase0Symbology,
    payload: string,
): Exclude<Phase0ChecksumResult, 'NOT_OBSERVED'> {
    const requiredLength = CHECKSUM_LENGTHS[symbology];
    if (requiredLength === undefined) return 'NOT_APPLICABLE';
    if (payload.length !== requiredLength || !/^\d+$/.test(payload)) return 'INVALID';

    let weightedSum = 0;
    const dataLength = payload.length - 1;
    for (let index = dataLength - 1, offsetFromRight = 0; index >= 0; index -= 1, offsetFromRight += 1) {
        const digit = payload.charCodeAt(index) - 48;
        weightedSum += digit * (offsetFromRight % 2 === 0 ? 3 : 1);
    }

    const expectedCheckDigit = (10 - (weightedSum % 10)) % 10;
    const observedCheckDigit = payload.charCodeAt(dataLength) - 48;
    return observedCheckDigit === expectedCheckDigit ? 'VALID' : 'INVALID';
}

export type Phase0FieldFingerprintComparator = (
    observedValue: string,
    expectedFingerprint: string,
) => boolean | Promise<boolean>;

export interface ClassifyCandidateInput {
    sample: Phase0Sample;
    observedValue: string;
    observedSymbology: Phase0Symbology;
    compareFieldFingerprint?: Phase0FieldFingerprintComparator;
}

interface Phase0CandidateClassificationBase {
    observedSymbology: Phase0Symbology;
    observedLength: number;
    checksumResult: Exclude<Phase0ChecksumResult, 'NOT_OBSERVED'>;
}

/** Resultado seguro que puede pasar a createRun; nunca incluye el valor observado. */
export type Phase0CandidateClassification = Phase0CandidateClassificationBase & (
    | { result: 'DECODED_MATCH'; payloadMatchesExpected: true }
    | { result: 'DECODED_WRONG'; payloadMatchesExpected: false }
);

function symbologyMatches(expected: Phase0Symbology, observed: Phase0Symbology): boolean {
    if (expected === 'SCALE_EAN_13') {
        return observed === 'EAN_13' || observed === 'SCALE_EAN_13';
    }
    return expected === observed;
}

/**
 * Clasifica un unico candidato. Una muestra REJECT_INVALID o UNSUPPORTED jamas
 * produce DECODED_MATCH, aun cuando el texto coincida con su referencia.
 */
export async function classifyCandidate({
    sample,
    observedValue,
    observedSymbology,
    compareFieldFingerprint,
}: ClassifyCandidateInput): Promise<Phase0CandidateClassification> {
    if (observedValue.length === 0) throw new Error('El candidato observado no puede estar vacio.');

    let referenceMatches: boolean;
    if (sample.repoSafe === true) {
        referenceMatches = observedValue === sample.expectedValue;
    } else {
        referenceMatches = await compareFieldCandidate(sample, observedValue, compareFieldFingerprint);
    }
    const checksumResult = validateChecksum(sample.symbology, observedValue);
    const checksumCanBeAccepted = sample.checksumExpectation === 'NOT_APPLICABLE'
        ? checksumResult === 'NOT_APPLICABLE'
        : sample.checksumExpectation === 'VALID' && checksumResult === 'VALID';
    const isAcceptedMatch = sample.expectedOutcome === 'DECODE'
        && referenceMatches
        && symbologyMatches(sample.symbology, observedSymbology)
        && checksumCanBeAccepted;

    const safeObservation = {
        observedSymbology,
        observedLength: observedValue.length,
        checksumResult,
    };
    return isAcceptedMatch
        ? { ...safeObservation, result: 'DECODED_MATCH', payloadMatchesExpected: true }
        : { ...safeObservation, result: 'DECODED_WRONG', payloadMatchesExpected: false };
}

async function compareFieldCandidate(
    sample: Phase0FieldSample,
    observedValue: string,
    compareFieldFingerprint: Phase0FieldFingerprintComparator | undefined,
): Promise<boolean> {
    if (!compareFieldFingerprint) {
        throw new Error('La muestra de campo requiere un comparador HMAC efimero.');
    }
    return compareFieldFingerprint(observedValue, sample.expectedFingerprint);
}

export type Phase0FallbackEvidence =
    | { fallbackUsed: 'NONE'; fallbackSucceeded?: null }
    | {
        fallbackUsed: Exclude<Phase0FallbackUsed, 'NONE'>;
        fallbackSucceeded: boolean;
    };

export type Phase0ExclusionEvidence =
    | { excluded: false; exclusionReason?: null }
    | { excluded: true; exclusionReason: Phase0ExclusionReason };

type Phase0CameraErrorCode = Extract<
    Phase0FailureCode,
    'CAMERA_NOT_FOUND' | 'CAMERA_NOT_READABLE' | 'SECURE_CONTEXT_REQUIRED' | 'DECODER_UNAVAILABLE'
>;
type Phase0AbortCode = Extract<
    Phase0FailureCode,
    'LIFECYCLE_INTERRUPTED' | 'OPERATOR_ABORTED' | 'PROTOCOL_ERROR'
>;

export type Phase0RunObservation =
    | {
        kind: 'CANDIDATE';
        classification: Phase0CandidateClassification;
        firstCandidateMs: number;
        firstCorrectMs?: number;
        wrongCandidateCount?: number;
    }
    | { kind: 'NO_DECODE'; firstCandidateMs?: number | null; wrongCandidateCount?: number }
    | { kind: 'UNSUPPORTED_FORMAT'; firstCandidateMs?: number | null; wrongCandidateCount?: number }
    | { kind: 'PERMISSION_DENIED' }
    | { kind: 'CAMERA_ERROR'; failureCode: Phase0CameraErrorCode }
    | { kind: 'ABORTED'; failureCode: Phase0AbortCode; firstCandidateMs?: number | null; wrongCandidateCount?: number };

export interface CreatePhase0RunInput {
    runId: string;
    sampleId: string;
    environmentId: string;
    scenarioId: string;
    sequence: number;
    repetition: number;
    runDate: string;
    observation: Phase0RunObservation;
    cameraReadyMs?: number | null;
    duplicateEmissionsWithin2s?: number;
    cameraTrackStoppedAfterExit: boolean;
    fallback?: Phase0FallbackEvidence;
    exclusion?: Phase0ExclusionEvidence;
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/;

/** Construye una corrida que satisface las relaciones condicionales del schema. */
export function createRun(input: CreatePhase0RunInput): Phase0Run {
    assertId(input.runId, 'runId');
    assertId(input.sampleId, 'sampleId');
    assertId(input.environmentId, 'environmentId');
    assertId(input.scenarioId, 'scenarioId');
    assertPositiveInteger(input.sequence, 'sequence');
    assertPositiveInteger(input.repetition, 'repetition');
    assertIsoDate(input.runDate);
    assertNullableNonNegativeInteger(input.cameraReadyMs ?? null, 'cameraReadyMs');
    assertNonNegativeInteger(input.duplicateEmissionsWithin2s ?? 0, 'duplicateEmissionsWithin2s');

    const fallback = input.fallback ?? { fallbackUsed: 'NONE' as const, fallbackSucceeded: null };
    const exclusion = input.exclusion ?? { excluded: false as const, exclusionReason: null };
    const observation = buildObservation(input.observation);

    return {
        runId: input.runId,
        sampleId: input.sampleId,
        environmentId: input.environmentId,
        scenarioId: input.scenarioId,
        sequence: input.sequence,
        repetition: input.repetition,
        runDate: input.runDate,
        ...observation,
        cameraReadyMs: input.cameraReadyMs ?? null,
        duplicateEmissionsWithin2s: input.duplicateEmissionsWithin2s ?? 0,
        cameraTrackStoppedAfterExit: input.cameraTrackStoppedAfterExit,
        fallbackUsed: fallback.fallbackUsed,
        fallbackSucceeded: fallback.fallbackUsed === 'NONE' ? null : fallback.fallbackSucceeded,
        excluded: exclusion.excluded,
        exclusionReason: exclusion.excluded ? exclusion.exclusionReason : null,
    };
}

type ObservationFields = Pick<
    Phase0Run,
    | 'result'
    | 'observedSymbology'
    | 'observedLength'
    | 'payloadMatchesExpected'
    | 'checksumResult'
    | 'firstCandidateMs'
    | 'firstCorrectMs'
    | 'wrongCandidateCount'
    | 'failureCode'
>;

function buildObservation(observation: Phase0RunObservation): ObservationFields {
    if (observation.kind === 'CANDIDATE') {
        assertNonNegativeInteger(observation.firstCandidateMs, 'firstCandidateMs');
        assertPositiveInteger(observation.classification.observedLength, 'observedLength');
        if (
            observation.classification.observedSymbology.length === 0
            || observation.classification.observedSymbology.length > 64
        ) {
            throw new Error('observedSymbology debe tener entre 1 y 64 caracteres.');
        }
        const isMatch = observation.classification.result === 'DECODED_MATCH';
        if (observation.classification.payloadMatchesExpected !== isMatch) {
            throw new Error('La clasificacion del candidato es incoherente.');
        }
        const firstCorrectMs = isMatch
            ? observation.firstCorrectMs ?? observation.firstCandidateMs
            : null;
        if (isMatch) assertNonNegativeInteger(firstCorrectMs, 'firstCorrectMs');
        if (!isMatch && observation.firstCorrectMs !== undefined) {
            throw new Error('Una lectura incorrecta no puede registrar firstCorrectMs.');
        }

        const minimumWrongCount = isMatch ? 0 : 1;
        const wrongCandidateCount = observation.wrongCandidateCount ?? minimumWrongCount;
        assertNonNegativeInteger(wrongCandidateCount, 'wrongCandidateCount');
        if (wrongCandidateCount < minimumWrongCount) {
            throw new Error('DECODED_WRONG requiere al menos un candidato incorrecto.');
        }

        return {
            result: observation.classification.result,
            observedSymbology: observation.classification.observedSymbology,
            observedLength: observation.classification.observedLength,
            payloadMatchesExpected: observation.classification.payloadMatchesExpected,
            checksumResult: observation.classification.checksumResult,
            firstCandidateMs: observation.firstCandidateMs,
            firstCorrectMs,
            wrongCandidateCount,
            failureCode: null,
        };
    }

    const firstCandidateMs = 'firstCandidateMs' in observation
        ? observation.firstCandidateMs ?? null
        : null;
    const wrongCandidateCount = 'wrongCandidateCount' in observation
        ? observation.wrongCandidateCount ?? 0
        : 0;
    assertNullableNonNegativeInteger(firstCandidateMs, 'firstCandidateMs');
    assertNonNegativeInteger(wrongCandidateCount, 'wrongCandidateCount');

    const terminal = terminalResult(observation);
    return {
        result: terminal.result,
        observedSymbology: null,
        observedLength: null,
        payloadMatchesExpected: null,
        checksumResult: 'NOT_OBSERVED',
        firstCandidateMs,
        firstCorrectMs: null,
        wrongCandidateCount,
        failureCode: terminal.failureCode,
    };
}

function terminalResult(
    observation: Exclude<Phase0RunObservation, { kind: 'CANDIDATE' }>,
): Pick<Phase0Run, 'result' | 'failureCode'> {
    switch (observation.kind) {
        case 'NO_DECODE':
            return { result: 'NO_DECODE', failureCode: 'TIMEOUT' };
        case 'UNSUPPORTED_FORMAT':
            return { result: 'UNSUPPORTED_FORMAT', failureCode: 'FORMAT_UNSUPPORTED' };
        case 'PERMISSION_DENIED':
            return { result: 'PERMISSION_DENIED', failureCode: 'PERMISSION_NOT_ALLOWED' };
        case 'CAMERA_ERROR':
            return { result: 'CAMERA_ERROR', failureCode: observation.failureCode };
        case 'ABORTED':
            return { result: 'ABORTED', failureCode: observation.failureCode };
    }
}

function assertId(value: string, field: string): void {
    if (!ID_PATTERN.test(value)) throw new Error(`${field} no cumple el formato de ID del protocolo.`);
}

function assertNonNegativeInteger(value: number, field: string): void {
    if (!Number.isInteger(value) || value < 0) throw new Error(`${field} debe ser un entero no negativo.`);
}

function assertNullableNonNegativeInteger(value: number | null, field: string): void {
    if (value !== null) assertNonNegativeInteger(value, field);
}

function assertPositiveInteger(value: number, field: string): void {
    if (!Number.isInteger(value) || value < 1) throw new Error(`${field} debe ser un entero positivo.`);
}

function assertIsoDate(value: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('runDate debe usar YYYY-MM-DD.');
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
        throw new Error('runDate debe ser una fecha calendario valida.');
    }
}

export const PHASE0_GATES = Object.freeze({
    minimumValidAttempts: 30,
    maximumWrongCandidates: 0,
    maximumInvalidOrUnsupportedAccepted: 0,
    minimumFirstTryRate: 0.95,
    maximumP95FirstCorrectMs: 2_000,
    minimumWithin5sRate: 0.99,
    requiredLifecycleRate: 1,
    requiredFallbackRate: 1,
    requiredTrackStopRate: 1,
});

export type Phase0CellDecision = 'INSUFFICIENT' | 'GO' | 'PILOT' | 'NO_GO';
export type Phase0LifecycleCheckKind =
    | 'PERMISSION_DENIED'
    | 'CLOSE'
    | 'BACKGROUND_RESUME'
    | 'FALLBACK';

const REQUIRED_LIFECYCLE_CHECKS: readonly Phase0LifecycleCheckKind[] = [
    'PERMISSION_DENIED',
    'CLOSE',
    'BACKGROUND_RESUME',
    'FALLBACK',
];

export interface Phase0LifecycleCheck {
    kind: Phase0LifecycleCheckKind;
    passed: boolean;
}

export interface EvaluatePhase0CellInput {
    environment: Phase0Environment;
    sample: Phase0Sample;
    scenarios: readonly Phase0Scenario[];
    runs: readonly Phase0Run[];
    protocolCoverageComplete: boolean;
    lifecycleChecks: readonly Phase0LifecycleCheck[];
    privacyViolation?: boolean;
    mutationTriggered?: boolean;
}

export interface Phase0CellMetrics {
    totalAttemptCount: number;
    excludedAttemptCount: number;
    primaryAttemptCount: number;
    protocolControlAttemptCount: number;
    validAttemptCount: number;
    decodedMatchCount: number;
    wrongDecodeRunCount: number;
    wrongCandidateCount: number;
    invalidOrUnsupportedAcceptedCount: number;
    expectedOutcomeSuccessCount: number;
    expectedOutcomeSuccessRate: number;
    performanceApplicable: boolean;
    firstTryRate: number | null;
    within5sRate: number | null;
    wrongDecodeRate: number;
    p95FirstCorrectMs: number | null;
    fallbackInitiatedCount: number;
    fallbackSuccessRate: number | null;
    lifecycleSuccessRate: number | null;
    requiredLifecycleCoverageComplete: boolean;
    trackStopRate: number | null;
    duplicateEmissionCount: number;
}

export interface Phase0CellGateResults {
    minimumAttempts: boolean;
    protocolCoverage: boolean;
    noWrongCandidates: boolean;
    noInvalidOrUnsupportedAccepted: boolean;
    expectedOutcomeHandled: boolean;
    firstTryRate: boolean;
    p95FirstCorrectMs: boolean;
    within5sRate: boolean;
    lifecycleHandled: boolean;
    fallbackHandled: boolean;
    tracksStopped: boolean;
    privacyPreserved: boolean;
    noMutationTriggered: boolean;
}

export interface Phase0CellEvaluation {
    cellKey: string;
    decision: Phase0CellDecision;
    metrics: Phase0CellMetrics;
    gates: Phase0CellGateResults;
}

/**
 * Identidad exacta de una celda. El build se incluye para evitar mezclar
 * resultados de prototipos distintos bajo una misma combinacion fisica.
 */
export function cellKey(environment: Phase0Environment, sample: Phase0Sample): string {
    return JSON.stringify([
        environment.deviceTier,
        environment.manufacturer,
        environment.modelAlias,
        environment.osName,
        environment.osVersion,
        environment.surface,
        environment.browserName,
        environment.browserVersion,
        environment.engine,
        environment.decoderName,
        environment.decoderVersion,
        environment.prototypeBuildId,
        sample.symbology,
    ]);
}

/** Evalua unicamente las corridas de la celda exacta recibida. */
export function evaluateCell(input: EvaluatePhase0CellInput): Phase0CellEvaluation {
    const matchingRuns = input.runs.filter(
        (run) => run.environmentId === input.environment.environmentId && run.sampleId === input.sample.sampleId,
    );
    const validRuns = matchingRuns.filter((run) => !run.excluded);
    // Un fallback demuestra recuperacion operativa, no rendimiento del decoder.
    // Separarlo evita que la entrada manual pueda fabricar un GO de camara.
    const primaryRuns = validRuns.filter((run) => run.fallbackUsed === 'NONE');
    const scenarioById = new Map(input.scenarios.map((scenario) => [scenario.scenarioId, scenario]));
    const protocolControlRuns = primaryRuns.filter(
        (run) => isProtocolControlRun(run, scenarioById.get(run.scenarioId)),
    );
    // Permiso denegado intencional, cierre y background validan lifecycle, no
    // optica. Mantenerlos fuera evita castigar o premiar la precision del decoder.
    const measurementRuns = primaryRuns.filter(
        (run) => !isProtocolControlRun(run, scenarioById.get(run.scenarioId)),
    );
    const decodedMatches = measurementRuns.filter((run) => run.result === 'DECODED_MATCH');
    const wrongDecodeRuns = measurementRuns.filter((run) => run.result === 'DECODED_WRONG');
    // Un candidato incorrecto sigue siendo un hard failure aunque el intento
    // termine como control de cierre o background.
    const wrongCandidateCount = primaryRuns.reduce((sum, run) => sum + run.wrongCandidateCount, 0);
    const invalidOrUnsupportedAcceptedCount = measurementRuns.filter(
        (run) => isDecoded(run)
            && (input.sample.expectedOutcome !== 'DECODE' || run.checksumResult === 'INVALID'),
    ).length;
    const expectedOutcomeSuccessCount = measurementRuns.filter(
        (run) => isExpectedOutcome(run, input.sample.expectedOutcome),
    ).length;
    const performanceApplicable = input.sample.expectedOutcome === 'DECODE';
    const fallbacks = validRuns.filter((run) => run.fallbackUsed !== 'NONE');
    const requiredLifecycleCoverageComplete = REQUIRED_LIFECYCLE_CHECKS.every(
        (kind) => input.lifecycleChecks.some((check) => check.kind === kind),
    );
    const firstCorrectTimes = decodedMatches
        .map((run) => run.firstCorrectMs)
        .filter((time): time is number => time !== null);

    const metrics: Phase0CellMetrics = {
        totalAttemptCount: matchingRuns.length,
        excludedAttemptCount: matchingRuns.length - validRuns.length,
        primaryAttemptCount: primaryRuns.length,
        protocolControlAttemptCount: protocolControlRuns.length,
        validAttemptCount: measurementRuns.length,
        decodedMatchCount: decodedMatches.length,
        wrongDecodeRunCount: wrongDecodeRuns.length,
        wrongCandidateCount,
        invalidOrUnsupportedAcceptedCount,
        expectedOutcomeSuccessCount,
        expectedOutcomeSuccessRate: rate(expectedOutcomeSuccessCount, measurementRuns.length),
        performanceApplicable,
        firstTryRate: performanceApplicable ? rate(decodedMatches.length, measurementRuns.length) : null,
        within5sRate: performanceApplicable
            ? rate(
                decodedMatches.filter((run) => run.firstCorrectMs !== null && run.firstCorrectMs <= 5_000).length,
                measurementRuns.length,
            )
            : null,
        wrongDecodeRate: rate(wrongDecodeRuns.length, measurementRuns.length),
        p95FirstCorrectMs: performanceApplicable ? percentile95(firstCorrectTimes) : null,
        fallbackInitiatedCount: fallbacks.length,
        fallbackSuccessRate: fallbacks.length === 0
            ? null
            : rate(fallbacks.filter((run) => run.fallbackSucceeded === true).length, fallbacks.length),
        lifecycleSuccessRate: input.lifecycleChecks.length === 0
            ? null
            : rate(input.lifecycleChecks.filter((check) => check.passed).length, input.lifecycleChecks.length),
        requiredLifecycleCoverageComplete,
        trackStopRate: primaryRuns.length === 0
            ? null
            : rate(primaryRuns.filter((run) => run.cameraTrackStoppedAfterExit).length, primaryRuns.length),
        duplicateEmissionCount: primaryRuns.reduce(
            (sum, run) => sum + run.duplicateEmissionsWithin2s,
            0,
        ),
    };

    const fallbackHandled = metrics.fallbackSuccessRate === null
        || metrics.fallbackSuccessRate === PHASE0_GATES.requiredFallbackRate;
    const gates: Phase0CellGateResults = {
        minimumAttempts: metrics.validAttemptCount >= PHASE0_GATES.minimumValidAttempts,
        protocolCoverage: input.protocolCoverageComplete && requiredLifecycleCoverageComplete,
        noWrongCandidates: metrics.wrongCandidateCount <= PHASE0_GATES.maximumWrongCandidates
            && metrics.wrongDecodeRunCount === 0,
        noInvalidOrUnsupportedAccepted:
            metrics.invalidOrUnsupportedAcceptedCount <= PHASE0_GATES.maximumInvalidOrUnsupportedAccepted,
        expectedOutcomeHandled: performanceApplicable || metrics.expectedOutcomeSuccessRate === 1,
        firstTryRate: !performanceApplicable
            || (metrics.firstTryRate !== null && metrics.firstTryRate >= PHASE0_GATES.minimumFirstTryRate),
        p95FirstCorrectMs: !performanceApplicable
            || (metrics.p95FirstCorrectMs !== null
                && metrics.p95FirstCorrectMs <= PHASE0_GATES.maximumP95FirstCorrectMs),
        within5sRate: !performanceApplicable
            || (metrics.within5sRate !== null && metrics.within5sRate >= PHASE0_GATES.minimumWithin5sRate),
        lifecycleHandled: metrics.lifecycleSuccessRate === PHASE0_GATES.requiredLifecycleRate,
        fallbackHandled,
        tracksStopped: metrics.trackStopRate === PHASE0_GATES.requiredTrackStopRate,
        privacyPreserved: input.privacyViolation !== true,
        noMutationTriggered: input.mutationTriggered !== true,
    };

    return {
        cellKey: cellKey(input.environment, input.sample),
        decision: decideCell(
            gates,
            input.lifecycleChecks,
            primaryRuns.some((run) => !run.cameraTrackStoppedAfterExit),
        ),
        metrics,
        gates,
    };
}

function isProtocolControlRun(
    run: Phase0Run,
    scenario: Phase0Scenario | undefined,
): boolean {
    if (
        run.result === 'PERMISSION_DENIED'
        && scenario?.permissionState === 'DENIED'
    ) {
        return true;
    }
    return run.result === 'ABORTED'
        && (run.failureCode === 'OPERATOR_ABORTED' || run.failureCode === 'LIFECYCLE_INTERRUPTED');
}

function isDecoded(run: Phase0Run): boolean {
    return run.result === 'DECODED_MATCH' || run.result === 'DECODED_WRONG';
}

function isExpectedOutcome(run: Phase0Run, expectedOutcome: Phase0ExpectedOutcome): boolean {
    switch (expectedOutcome) {
        case 'DECODE':
            return run.result === 'DECODED_MATCH';
        case 'REJECT_INVALID':
            return run.result === 'NO_DECODE';
        case 'UNSUPPORTED':
            return run.result === 'UNSUPPORTED_FORMAT';
    }
}

function rate(numerator: number, denominator: number): number {
    return denominator === 0 ? 0 : numerator / denominator;
}

function percentile95(values: readonly number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((left, right) => left - right);
    const nearestRankIndex = Math.ceil(0.95 * sorted.length) - 1;
    return sorted[nearestRankIndex];
}

function decideCell(
    gates: Phase0CellGateResults,
    lifecycleChecks: readonly Phase0LifecycleCheck[],
    explicitTrackFailure: boolean,
): Phase0CellDecision {
    const explicitLifecycleFailure = lifecycleChecks.some((check) => !check.passed);
    const hardFailure = !gates.noWrongCandidates
        || !gates.noInvalidOrUnsupportedAccepted
        || !gates.privacyPreserved
        || !gates.noMutationTriggered
        || explicitLifecycleFailure
        || explicitTrackFailure
        || !gates.fallbackHandled;
    if (hardFailure) return 'NO_GO';
    if (!gates.minimumAttempts || !gates.protocolCoverage) return 'INSUFFICIENT';

    const allGatesPass = Object.values(gates).every(Boolean);
    return allGatesPass ? 'GO' : 'PILOT';
}
