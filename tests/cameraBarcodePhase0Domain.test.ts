import { describe, expect, it, vi } from 'vitest';
import {
    PHASE0_GATES,
    cellKey,
    classifyCandidate,
    createRun,
    evaluateCell,
    sampleAllowsSuccessfulFallback,
    validateChecksum,
    type Phase0Environment,
    type Phase0FieldSample,
    type Phase0LifecycleCheck,
    type Phase0RepoSafeSample,
    type Phase0Run,
    type Phase0Scenario,
} from '../tools/camera-barcode-phase0/domain';

const SAMPLE: Phase0RepoSafeSample = {
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
    barcodeWidthMm: 37.29,
    barcodeHeightMm: 25.93,
    quietZoneClass: 'COMPLIANT',
    contrastClass: 'HIGH',
    artifactRef: null,
};

const ENVIRONMENT: Phase0Environment = {
    environmentId: 'android-low-pwa-zxing-a',
    deviceTier: 'ANDROID_LOW',
    manufacturer: 'Acme',
    modelAlias: 'android-low-a',
    osName: 'Android',
    osVersion: '15',
    surface: 'INSTALLED_PWA',
    browserName: 'Chrome',
    browserVersion: '140',
    engine: 'Blink',
    decoderName: 'ZXING_BROWSER',
    decoderVersion: '0.1.5',
    prototypeBuildId: 'phase0-a1',
    cameraFacing: 'ENVIRONMENT',
    actualResolution: { width: 1280, height: 720 },
    torchAvailable: false,
    secureContext: true,
    reportedFormats: ['ean_13'],
};

const COMPLETE_LIFECYCLE: Phase0LifecycleCheck[] = [
    { kind: 'PERMISSION_DENIED', passed: true },
    { kind: 'CLOSE', passed: true },
    { kind: 'BACKGROUND_RESUME', passed: true },
    { kind: 'FALLBACK', passed: true },
];

const SCENARIO: Phase0Scenario = {
    scenarioId: 'scenario-normal',
    startState: 'WARM',
    permissionState: 'GRANTED',
    networkMode: 'ONLINE',
    distanceCm: 20,
    angleDeg: 0,
    orientationDeg: 0,
    lightingBand: 'NORMAL_INDOOR',
    motion: 'HANDHELD',
    torch: 'OFF',
    timeoutMs: 5_000,
};

function successfulRun(index: number, overrides: Partial<Phase0Run> = {}): Phase0Run {
    return {
        runId: `run-${String(index).padStart(3, '0')}`,
        sampleId: SAMPLE.sampleId,
        environmentId: ENVIRONMENT.environmentId,
        scenarioId: 'scenario-normal',
        sequence: index,
        repetition: index,
        runDate: '2026-08-30',
        result: 'DECODED_MATCH',
        observedSymbology: 'EAN_13',
        observedLength: 13,
        payloadMatchesExpected: true,
        checksumResult: 'VALID',
        cameraReadyMs: 300,
        firstCandidateMs: 900,
        firstCorrectMs: 900,
        wrongCandidateCount: 0,
        duplicateEmissionsWithin2s: 0,
        cameraTrackStoppedAfterExit: true,
        fallbackUsed: 'NONE',
        fallbackSucceeded: null,
        failureCode: null,
        excluded: false,
        exclusionReason: null,
        ...overrides,
    };
}

function thirtySuccessfulRuns(): Phase0Run[] {
    return Array.from({ length: PHASE0_GATES.minimumValidAttempts }, (_, index) => successfulRun(index + 1));
}

function evaluate(overrides: Partial<Parameters<typeof evaluateCell>[0]> = {}) {
    return evaluateCell({
        environment: ENVIRONMENT,
        sample: SAMPLE,
        scenarios: [SCENARIO],
        runs: thirtySuccessfulRuns(),
        protocolCoverageComplete: true,
        lifecycleChecks: COMPLETE_LIFECYCLE,
        ...overrides,
    });
}

describe('checksum GTIN estricto', () => {
    it('valida EAN-13, etiqueta de balanza EAN-13, EAN-8 y UPC-A', () => {
        expect(validateChecksum('EAN_13', '7501234567893')).toBe('VALID');
        expect(validateChecksum('SCALE_EAN_13', '2000123012506')).toBe('VALID');
        expect(validateChecksum('EAN_8', '96385074')).toBe('VALID');
        expect(validateChecksum('UPC_A', '036000291452')).toBe('VALID');
    });

    it('preserva ceros iniciales y exige longitud, caracteres y digito exactos', () => {
        expect(validateChecksum('EAN_13', '0000000000000')).toBe('VALID');
        expect(validateChecksum('EAN_13', '0000000000001')).toBe('INVALID');
        expect(validateChecksum('EAN_13', '750123456789')).toBe('INVALID');
        expect(validateChecksum('EAN_13', '750123456789X')).toBe('INVALID');
        expect(validateChecksum('EAN_8', '96385075')).toBe('INVALID');
        expect(validateChecksum('UPC_A', '036000291453')).toBe('INVALID');
    });

    it('declara no aplicable lo no implementado en vez de inventar una validacion', () => {
        expect(validateChecksum('UPC_E', '04252614')).toBe('NOT_APPLICABLE');
        expect(validateChecksum('CODE_128', 'ABC-001')).toBe('NOT_APPLICABLE');
        expect(validateChecksum('QR_CODE', 'https://example.invalid')).toBe('NOT_APPLICABLE');
    });
});

describe('clasificacion privada del candidato', () => {
    it('solo permite fallback exitoso en muestras que deben decodificarse', () => {
        expect(sampleAllowsSuccessfulFallback(SAMPLE)).toBe(true);
        expect(sampleAllowsSuccessfulFallback({ ...SAMPLE, expectedOutcome: 'REJECT_INVALID' })).toBe(false);
        expect(sampleAllowsSuccessfulFallback({ ...SAMPLE, expectedOutcome: 'UNSUPPORTED' })).toBe(false);
    });

    it('acepta solo coincidencia exacta, formato compatible y checksum valido', async () => {
        await expect(classifyCandidate({
            sample: SAMPLE,
            observedValue: SAMPLE.expectedValue,
            observedSymbology: 'EAN_13',
        })).resolves.toEqual({
            result: 'DECODED_MATCH',
            observedSymbology: 'EAN_13',
            observedLength: 13,
            payloadMatchesExpected: true,
            checksumResult: 'VALID',
        });

        const scaleSample: Phase0RepoSafeSample = {
            ...SAMPLE,
            sampleId: 'synthetic-scale-ean13',
            symbology: 'SCALE_EAN_13',
            semanticClass: 'SCALE_WEIGHT',
            expectedValue: '2000123012506',
            printSource: 'THERMAL',
        };
        await expect(classifyCandidate({
            sample: scaleSample,
            observedValue: scaleSample.expectedValue,
            observedSymbology: 'EAN_13',
        })).resolves.toMatchObject({ result: 'DECODED_MATCH', checksumResult: 'VALID' });
    });

    it('no normaliza espacios, no confunde simbologias ni acepta checksum invalido', async () => {
        const cases = [
            { observedValue: ` ${SAMPLE.expectedValue}`, observedSymbology: 'EAN_13' as const },
            { observedValue: SAMPLE.expectedValue, observedSymbology: 'UPC_A' as const },
            { observedValue: '7501234567894', observedSymbology: 'EAN_13' as const },
        ];
        for (const candidate of cases) {
            await expect(classifyCandidate({ sample: SAMPLE, ...candidate })).resolves.toMatchObject({
                result: 'DECODED_WRONG',
                payloadMatchesExpected: false,
            });
        }
    });

    it.each(['REJECT_INVALID', 'UNSUPPORTED'] as const)(
        'nunca convierte una emision %s en match aunque el texto coincida',
        async (expectedOutcome) => {
            const negativeSample: Phase0RepoSafeSample = {
                ...SAMPLE,
                sampleId: `synthetic-${expectedOutcome.toLowerCase().replace('_', '-')}`,
                expectedOutcome,
                checksumExpectation: expectedOutcome === 'REJECT_INVALID' ? 'INVALID' : 'VALID',
                expectedValue: expectedOutcome === 'REJECT_INVALID' ? '7501234567894' : SAMPLE.expectedValue,
                semanticClass: 'NEGATIVE',
            };
            const result = await classifyCandidate({
                sample: negativeSample,
                observedValue: negativeSample.expectedValue,
                observedSymbology: 'EAN_13',
            });
            expect(result.result).toBe('DECODED_WRONG');
            expect(result.payloadMatchesExpected).toBe(false);
        },
    );

    it('delega HMAC de campo de forma efimera y no devuelve el payload', async () => {
        const rawFieldValue = '036000291452';
        const { expectedValue: _expectedValue, ...sampleWithoutExpectedValue } = SAMPLE;
        const fieldSample: Phase0FieldSample = {
            ...sampleWithoutExpectedValue,
            sampleId: 'field-upca-redacted',
            provenance: 'FIELD_EPHEMERAL',
            repoSafe: false,
            symbology: 'UPC_A',
            expectedFingerprint: `hmac-sha256:${'a'.repeat(64)}`,
        };
        const comparator = vi.fn(async (candidate: string, fingerprint: string) => {
            expect(candidate).toBe(rawFieldValue);
            expect(fingerprint).toBe(fieldSample.expectedFingerprint);
            return true;
        });

        const classified = await classifyCandidate({
            sample: fieldSample,
            observedValue: rawFieldValue,
            observedSymbology: 'UPC_A',
            compareFieldFingerprint: comparator,
        });

        expect(comparator).toHaveBeenCalledOnce();
        expect(classified.result).toBe('DECODED_MATCH');
        expect(JSON.stringify(classified)).not.toContain(rawFieldValue);
        expect(Object.keys(classified)).not.toContain('observedValue');
    });

    it('falla cerrado si una muestra de campo no recibe comparador HMAC', async () => {
        const { expectedValue: _expectedValue, ...sampleWithoutExpectedValue } = SAMPLE;
        const fieldSample: Phase0FieldSample = {
            ...sampleWithoutExpectedValue,
            sampleId: 'field-ean13-redacted',
            provenance: 'FIELD_EPHEMERAL',
            repoSafe: false,
            expectedFingerprint: `hmac-sha256:${'b'.repeat(64)}`,
        };
        await expect(classifyCandidate({
            sample: fieldSample,
            observedValue: SAMPLE.expectedValue,
            observedSymbology: 'EAN_13',
        })).rejects.toThrow('comparador HMAC efimero');
    });
});

describe('construccion coherente y redactada de corridas', () => {
    it('construye DECODED_MATCH sin aceptar ni devolver el payload', async () => {
        const classification = await classifyCandidate({
            sample: SAMPLE,
            observedValue: SAMPLE.expectedValue,
            observedSymbology: 'EAN_13',
        });
        const run = createRun({
            runId: 'run-match-001',
            sampleId: SAMPLE.sampleId,
            environmentId: ENVIRONMENT.environmentId,
            scenarioId: 'scenario-normal',
            sequence: 1,
            repetition: 1,
            runDate: '2026-08-30',
            observation: {
                kind: 'CANDIDATE',
                classification,
                firstCandidateMs: 850,
            },
            cameraReadyMs: 250,
            cameraTrackStoppedAfterExit: true,
            // Aun si JS sin tipos intenta inyectarlo, el constructor no lo copia.
            observedValue: SAMPLE.expectedValue,
        } as Parameters<typeof createRun>[0] & { observedValue: string });

        expect(run).toMatchObject({
            result: 'DECODED_MATCH',
            observedLength: 13,
            payloadMatchesExpected: true,
            firstCandidateMs: 850,
            firstCorrectMs: 850,
            wrongCandidateCount: 0,
            failureCode: null,
            fallbackUsed: 'NONE',
            fallbackSucceeded: null,
            excluded: false,
            exclusionReason: null,
        });
        expect(JSON.stringify(run)).not.toContain(SAMPLE.expectedValue);
        expect(Object.keys(run)).not.toContain('observedValue');
    });

    it('fija resultado, codigo de falla y campos nulos para cada salida terminal', () => {
        const common = {
            runId: 'run-terminal-001',
            sampleId: SAMPLE.sampleId,
            environmentId: ENVIRONMENT.environmentId,
            scenarioId: 'scenario-normal',
            sequence: 1,
            repetition: 1,
            runDate: '2026-08-30',
            cameraTrackStoppedAfterExit: true,
        } as const;

        expect(createRun({ ...common, observation: { kind: 'NO_DECODE' } })).toMatchObject({
            result: 'NO_DECODE', failureCode: 'TIMEOUT', payloadMatchesExpected: null, firstCorrectMs: null,
        });
        expect(createRun({ ...common, observation: { kind: 'UNSUPPORTED_FORMAT' } })).toMatchObject({
            result: 'UNSUPPORTED_FORMAT', failureCode: 'FORMAT_UNSUPPORTED', checksumResult: 'NOT_OBSERVED',
        });
        expect(createRun({ ...common, observation: { kind: 'PERMISSION_DENIED' } })).toMatchObject({
            result: 'PERMISSION_DENIED', failureCode: 'PERMISSION_NOT_ALLOWED', observedLength: null,
        });
        expect(createRun({
            ...common,
            observation: { kind: 'CAMERA_ERROR', failureCode: 'CAMERA_NOT_READABLE' },
        })).toMatchObject({ result: 'CAMERA_ERROR', failureCode: 'CAMERA_NOT_READABLE' });
        expect(createRun({
            ...common,
            observation: { kind: 'ABORTED', failureCode: 'LIFECYCLE_INTERRUPTED' },
        })).toMatchObject({ result: 'ABORTED', failureCode: 'LIFECYCLE_INTERRUPTED' });
    });

    it('mantiene fallback y exclusion como pares coherentes', () => {
        const run = createRun({
            runId: 'run-fallback-001',
            sampleId: SAMPLE.sampleId,
            environmentId: ENVIRONMENT.environmentId,
            scenarioId: 'scenario-normal',
            sequence: 1,
            repetition: 1,
            runDate: '2026-08-30',
            observation: { kind: 'NO_DECODE' },
            cameraTrackStoppedAfterExit: true,
            fallback: { fallbackUsed: 'MANUAL_INPUT', fallbackSucceeded: true },
            exclusion: { excluded: true, exclusionReason: 'PROTOCOL_DEVIATION' },
        });
        expect(run).toMatchObject({
            fallbackUsed: 'MANUAL_INPUT',
            fallbackSucceeded: true,
            excluded: true,
            exclusionReason: 'PROTOCOL_DEVIATION',
        });
    });

    it('rechaza IDs, fechas, tiempos y estados de candidato imposibles', async () => {
        const classification = await classifyCandidate({
            sample: { ...SAMPLE, expectedValue: '7501234567894', checksumExpectation: 'VALID' },
            observedValue: '7501234567894',
            observedSymbology: 'EAN_13',
        });
        const base = {
            runId: 'run-wrong-001',
            sampleId: SAMPLE.sampleId,
            environmentId: ENVIRONMENT.environmentId,
            scenarioId: 'scenario-normal',
            sequence: 1,
            repetition: 1,
            runDate: '2026-08-30',
            observation: {
                kind: 'CANDIDATE' as const,
                classification,
                firstCandidateMs: 100,
            },
            cameraTrackStoppedAfterExit: true,
        };
        expect(() => createRun({
            ...base,
            observation: { ...base.observation, wrongCandidateCount: 0 },
        })).toThrow('al menos un candidato incorrecto');
        expect(() => createRun({ ...base, runId: 'X' })).toThrow('runId');
        expect(() => createRun({ ...base, runDate: '2026-02-30' })).toThrow('fecha calendario valida');
        expect(() => createRun({ ...base, cameraReadyMs: -1 })).toThrow('cameraReadyMs');
        expect(() => createRun({
            ...base,
            observation: { ...base.observation, firstCorrectMs: 200 },
        })).toThrow('no puede registrar firstCorrectMs');
    });
});

describe('metricas y decision de celda exacta', () => {
    it('crea una clave estable y separa cambios de dispositivo, version, build y formato', () => {
        expect(cellKey(ENVIRONMENT, SAMPLE)).toBe(cellKey({ ...ENVIRONMENT }, { ...SAMPLE }));
        expect(cellKey(ENVIRONMENT, SAMPLE)).not.toBe(cellKey({ ...ENVIRONMENT, modelAlias: 'android-low-b' }, SAMPLE));
        expect(cellKey(ENVIRONMENT, SAMPLE)).not.toBe(cellKey({ ...ENVIRONMENT, decoderVersion: '0.1.6' }, SAMPLE));
        expect(cellKey(ENVIRONMENT, SAMPLE)).not.toBe(cellKey({ ...ENVIRONMENT, prototypeBuildId: 'phase0-a2' }, SAMPLE));
        expect(cellKey(ENVIRONMENT, SAMPLE)).not.toBe(cellKey(ENVIRONMENT, { ...SAMPLE, symbology: 'EAN_8' }));
    });

    it('da GO solo con al menos 30 intentos y todos los gates satisfechos', () => {
        const result = evaluate();
        expect(result.decision).toBe('GO');
        expect(result.metrics).toMatchObject({
            validAttemptCount: 30,
            decodedMatchCount: 30,
            wrongCandidateCount: 0,
            invalidOrUnsupportedAcceptedCount: 0,
            firstTryRate: 1,
            within5sRate: 1,
            p95FirstCorrectMs: 900,
            lifecycleSuccessRate: 1,
            requiredLifecycleCoverageComplete: true,
            trackStopRate: 1,
        });
        expect(Object.values(result.gates).every(Boolean)).toBe(true);
    });

    it('mantiene INSUFFICIENT con 29 intentos o cobertura incompleta', () => {
        expect(evaluate({ runs: thirtySuccessfulRuns().slice(0, 29) }).decision).toBe('INSUFFICIENT');
        expect(evaluate({ protocolCoverageComplete: false }).decision).toBe('INSUFFICIENT');
        expect(evaluate({ lifecycleChecks: COMPLETE_LIFECYCLE.slice(0, 3) }).decision).toBe('INSUFFICIENT');
    });

    it('separa controles deliberados de lifecycle de los intentos de medicion', () => {
        const deniedScenario: Phase0Scenario = {
            ...SCENARIO,
            scenarioId: 'scenario-denied',
            permissionState: 'DENIED',
        };
        const controls: Phase0Run[] = [
            successfulRun(31, {
                scenarioId: deniedScenario.scenarioId,
                result: 'PERMISSION_DENIED',
                observedSymbology: null,
                observedLength: null,
                payloadMatchesExpected: null,
                checksumResult: 'NOT_OBSERVED',
                cameraReadyMs: null,
                firstCandidateMs: null,
                firstCorrectMs: null,
                failureCode: 'PERMISSION_NOT_ALLOWED',
            }),
            successfulRun(32, {
                result: 'ABORTED',
                observedSymbology: null,
                observedLength: null,
                payloadMatchesExpected: null,
                checksumResult: 'NOT_OBSERVED',
                firstCandidateMs: null,
                firstCorrectMs: null,
                failureCode: 'OPERATOR_ABORTED',
            }),
            successfulRun(33, {
                result: 'ABORTED',
                observedSymbology: null,
                observedLength: null,
                payloadMatchesExpected: null,
                checksumResult: 'NOT_OBSERVED',
                firstCandidateMs: null,
                firstCorrectMs: null,
                failureCode: 'LIFECYCLE_INTERRUPTED',
            }),
        ];

        const result = evaluate({
            scenarios: [SCENARIO, deniedScenario],
            runs: [...thirtySuccessfulRuns(), ...controls],
        });
        expect(result.decision).toBe('GO');
        expect(result.metrics).toMatchObject({
            totalAttemptCount: 33,
            primaryAttemptCount: 33,
            protocolControlAttemptCount: 3,
            validAttemptCount: 30,
            decodedMatchCount: 30,
            firstTryRate: 1,
            within5sRate: 1,
            trackStopRate: 1,
        });
    });

    it('mantiene en el denominador un permiso denegado inesperado', () => {
        const unexpectedDenial = successfulRun(31, {
            result: 'PERMISSION_DENIED',
            observedSymbology: null,
            observedLength: null,
            payloadMatchesExpected: null,
            checksumResult: 'NOT_OBSERVED',
            cameraReadyMs: null,
            firstCandidateMs: null,
            firstCorrectMs: null,
            failureCode: 'PERMISSION_NOT_ALLOWED',
        });

        const result = evaluate({ runs: [...thirtySuccessfulRuns(), unexpectedDenial] });
        expect(result.metrics).toMatchObject({
            primaryAttemptCount: 31,
            protocolControlAttemptCount: 0,
            validAttemptCount: 31,
            expectedOutcomeSuccessCount: 30,
        });
        expect(result.decision).toBe('PILOT');
    });

    it('no oculta un candidato incorrecto dentro de un control de cierre', () => {
        const closedAfterWrongCandidate = successfulRun(31, {
            result: 'ABORTED',
            observedSymbology: null,
            observedLength: null,
            payloadMatchesExpected: null,
            checksumResult: 'NOT_OBSERVED',
            firstCandidateMs: 200,
            firstCorrectMs: null,
            wrongCandidateCount: 1,
            failureCode: 'OPERATOR_ABORTED',
        });

        const result = evaluate({
            runs: [...thirtySuccessfulRuns(), closedAfterWrongCandidate],
        });
        expect(result.metrics).toMatchObject({
            protocolControlAttemptCount: 1,
            validAttemptCount: 30,
            wrongCandidateCount: 1,
        });
        expect(result.decision).toBe('NO_GO');
    });

    it('calcula p95 por nearest-rank y deja PILOT una celda segura pero lenta', () => {
        const runs = thirtySuccessfulRuns().map((run, index) => ({
            ...run,
            firstCandidateMs: index < 28 ? 1_000 : 2_500,
            firstCorrectMs: index < 28 ? 1_000 : 2_500,
        }));
        const result = evaluate({ runs });
        expect(result.metrics.p95FirstCorrectMs).toBe(2_500);
        expect(result.gates.p95FirstCorrectMs).toBe(false);
        expect(result.decision).toBe('PILOT');
    });

    it('aplica el denominador a todos los intentos validos para el gate dentro de 5s', () => {
        const runs = thirtySuccessfulRuns();
        runs[29] = successfulRun(30, {
            result: 'NO_DECODE',
            observedSymbology: null,
            observedLength: null,
            payloadMatchesExpected: null,
            checksumResult: 'NOT_OBSERVED',
            firstCandidateMs: null,
            firstCorrectMs: null,
            failureCode: 'TIMEOUT',
        });
        const result = evaluate({ runs });
        expect(result.metrics.firstTryRate).toBe(29 / 30);
        expect(result.metrics.within5sRate).toBe(29 / 30);
        expect(result.gates.firstTryRate).toBe(true);
        expect(result.gates.within5sRate).toBe(false);
        expect(result.decision).toBe('PILOT');
    });

    it('una sola lectura incorrecta fuerza NO_GO incluso antes de 30 intentos', () => {
        const wrong = successfulRun(1, {
            result: 'DECODED_WRONG',
            payloadMatchesExpected: false,
            firstCorrectMs: null,
            wrongCandidateCount: 1,
        });
        const result = evaluate({ runs: [wrong] });
        expect(result.metrics.wrongDecodeRunCount).toBe(1);
        expect(result.metrics.wrongCandidateCount).toBe(1);
        expect(result.decision).toBe('NO_GO');
    });

    it('detecta como aceptada cualquier emision para una muestra negativa', () => {
        const negativeSample: Phase0RepoSafeSample = {
            ...SAMPLE,
            sampleId: 'synthetic-ean13-invalid',
            expectedOutcome: 'REJECT_INVALID',
            expectedValue: '7501234567894',
            checksumExpectation: 'INVALID',
            semanticClass: 'NEGATIVE',
        };
        const runs = thirtySuccessfulRuns().map((run) => ({
            ...run,
            sampleId: negativeSample.sampleId,
            result: 'DECODED_WRONG' as const,
            payloadMatchesExpected: false,
            checksumResult: 'INVALID' as const,
            firstCorrectMs: null,
            wrongCandidateCount: 1,
        }));
        const result = evaluate({ sample: negativeSample, runs });
        expect(result.metrics.invalidOrUnsupportedAcceptedCount).toBe(30);
        expect(result.gates.noInvalidOrUnsupportedAccepted).toBe(false);
        expect(result.decision).toBe('NO_GO');
    });

    it.each([
        ['REJECT_INVALID', 'NO_DECODE', 'TIMEOUT'],
        ['UNSUPPORTED', 'UNSUPPORTED_FORMAT', 'FORMAT_UNSUPPORTED'],
    ] as const)(
        'da GO a %s con 30 rechazos correctos y marca rendimiento como no aplicable',
        (expectedOutcome, runResult, failureCode) => {
            const negativeSample: Phase0RepoSafeSample = {
                ...SAMPLE,
                sampleId: `synthetic-${expectedOutcome.toLowerCase().replace('_', '-')}`,
                expectedOutcome,
                expectedValue: expectedOutcome === 'REJECT_INVALID' ? '7501234567894' : SAMPLE.expectedValue,
                checksumExpectation: expectedOutcome === 'REJECT_INVALID' ? 'INVALID' : 'VALID',
                semanticClass: 'NEGATIVE',
            };
            const runs = thirtySuccessfulRuns().map((run) => ({
                ...run,
                sampleId: negativeSample.sampleId,
                result: runResult,
                observedSymbology: null,
                observedLength: null,
                payloadMatchesExpected: null,
                checksumResult: 'NOT_OBSERVED' as const,
                firstCandidateMs: null,
                firstCorrectMs: null,
                failureCode,
            }));

            const result = evaluate({ sample: negativeSample, runs });
            expect(result.decision).toBe('GO');
            expect(result.metrics).toMatchObject({
                expectedOutcomeSuccessCount: 30,
                expectedOutcomeSuccessRate: 1,
                invalidOrUnsupportedAcceptedCount: 0,
                performanceApplicable: false,
                firstTryRate: null,
                within5sRate: null,
                p95FirstCorrectMs: null,
            });
            expect(result.gates).toMatchObject({
                expectedOutcomeHandled: true,
                firstTryRate: true,
                within5sRate: true,
                p95FirstCorrectMs: true,
            });
        },
    );

    it('un track vivo observado fuerza NO_GO aun con evidencia menor a 30', () => {
        const result = evaluate({
            runs: [successfulRun(1, { cameraTrackStoppedAfterExit: false })],
        });
        expect(result.gates.minimumAttempts).toBe(false);
        expect(result.gates.tracksStopped).toBe(false);
        expect(result.decision).toBe('NO_GO');
    });

    it.each([
        ['fallo de lifecycle', { lifecycleChecks: COMPLETE_LIFECYCLE.map((check, index) => ({ ...check, passed: index !== 0 })) }],
        ['track vivo', { runs: thirtySuccessfulRuns().map((run, index) => index === 0 ? { ...run, cameraTrackStoppedAfterExit: false } : run) }],
        ['fallback fallido', { runs: thirtySuccessfulRuns().map((run, index) => index === 0 ? { ...run, fallbackUsed: 'MANUAL_INPUT' as const, fallbackSucceeded: false } : run) }],
        ['fuga de privacidad', { privacyViolation: true }],
        ['mutacion iniciada', { mutationTriggered: true }],
    ])('fuerza NO_GO ante %s', (_label, overrides) => {
        expect(evaluate(overrides).decision).toBe('NO_GO');
    });

    it('calcula fallback al 100% y excluye corridas predeclaradas y celdas ajenas', () => {
        const runs = thirtySuccessfulRuns();
        runs.push(successfulRun(31, {
            fallbackUsed: 'MANUAL_INPUT',
            fallbackSucceeded: true,
        }));
        runs.push(successfulRun(32, {
            excluded: true,
            exclusionReason: 'EQUIPMENT_FAILURE',
            result: 'DECODED_WRONG',
            payloadMatchesExpected: false,
            firstCorrectMs: null,
            wrongCandidateCount: 1,
        }));
        runs.push(successfulRun(33, {
            environmentId: 'other-environment',
            result: 'DECODED_WRONG',
            payloadMatchesExpected: false,
            firstCorrectMs: null,
            wrongCandidateCount: 1,
        }));

        const result = evaluate({ runs });
        expect(result.decision).toBe('GO');
        expect(result.metrics).toMatchObject({
            totalAttemptCount: 32,
            excludedAttemptCount: 1,
            validAttemptCount: 30,
            fallbackInitiatedCount: 1,
            fallbackSuccessRate: 1,
            wrongCandidateCount: 0,
        });
    });

    it('no permite que el fallback manual fabrique intentos ni rendimiento de camara', () => {
        const runs = thirtySuccessfulRuns().map((run) => ({
            ...run,
            fallbackUsed: 'MANUAL_INPUT' as const,
            fallbackSucceeded: true,
        }));

        const result = evaluate({ runs });
        expect(result.decision).toBe('INSUFFICIENT');
        expect(result.metrics).toMatchObject({
            totalAttemptCount: 30,
            validAttemptCount: 0,
            decodedMatchCount: 0,
            expectedOutcomeSuccessRate: 0,
            firstTryRate: 0,
            within5sRate: 0,
            p95FirstCorrectMs: null,
            fallbackInitiatedCount: 30,
            fallbackSuccessRate: 1,
            trackStopRate: null,
        });
        expect(result.gates.minimumAttempts).toBe(false);
        expect(result.gates.tracksStopped).toBe(false);
    });
});
