import { BarcodeFormat } from '@zxing/library';
import {
  createCameraCapture,
  type CameraCaptureCloseReason,
  type CameraCaptureClock,
  type CameraCaptureLifecycleHandlers,
  type CameraDecoderCallback,
  type CameraScannerControls,
} from './capture';
import {
  evaluateCell,
  type Phase0CellDecision,
  type Phase0Environment,
  type Phase0LifecycleCheck,
  type Phase0Manifest,
  type Phase0RepoSafeSample,
  type Phase0Run,
  type Phase0Scenario,
} from './domain';
import {
  deriveLifecycleChecks,
  hasCompleteProtocolCoverage,
} from './study';

export const SOFTWARE_SIMULATION_KIND = 'NORTEX_PHASE0_SOFTWARE_SIMULATION' as const;
export const SOFTWARE_ONLY_EVIDENCE_CLASS = 'SOFTWARE_ONLY_NOT_PHYSICAL' as const;

type CaptureScenario =
  | 'SUCCESS'
  | 'TIMEOUT'
  | 'STOPPED'
  | 'BACKGROUND'
  | 'RESUME_SUCCESS'
  | 'PAGEHIDE'
  | 'BEFOREUNLOAD'
  | 'PERMISSION_DENIED'
  | 'INSECURE_CONTEXT';

export interface CaptureSimulationResult {
  scenario: CaptureScenario;
  expectedCloseReason: CameraCaptureCloseReason;
  actualCloseReason: CameraCaptureCloseReason | null;
  candidateDelivered: boolean;
  resourcesReleased: boolean;
  snapshotRedacted: boolean;
  passed: boolean;
}

export interface DecisionSimulationResult {
  scenario:
    | 'NOMINAL'
    | 'SLOW_P95'
    | 'WRONG_DECODE'
    | 'FALLBACK_ONLY'
    | 'TRACK_LEAK'
    | 'UNEXPECTED_PERMISSION_DENIAL';
  expectedDecision: Phase0CellDecision;
  actualDecision: Phase0CellDecision;
  protocolCoverageComplete: boolean;
  lifecycleCoverage: Phase0LifecycleCheck[];
  measurementAttemptCount: number;
  primaryAttemptCount: number;
  protocolControlAttemptCount: number;
  fallbackAttemptCount: number;
  passed: boolean;
}

export interface Phase0SoftwareSimulationReport {
  kind: typeof SOFTWARE_SIMULATION_KIND;
  schemaVersion: 1;
  evidenceClass: typeof SOFTWARE_ONLY_EVIDENCE_CLASS;
  deterministic: true;
  physicalEvidenceAccepted: false;
  rawPayloadsPersisted: false;
  captureLifecycle: CaptureSimulationResult[];
  decisionMatrix: DecisionSimulationResult[];
  summary: {
    captureScenariosPassed: number;
    captureScenarioCount: number;
    decisionScenariosPassed: number;
    decisionScenarioCount: number;
    allPassed: boolean;
  };
  limitations: readonly string[];
}

interface MutableTrack {
  readonly kind: 'video';
  readonly readyState: 'live' | 'ended';
  stop(): void;
}

function createMutableTrack(): MutableTrack {
  let readyState: MutableTrack['readyState'] = 'live';
  return {
    kind: 'video',
    get readyState() {
      return readyState;
    },
    stop() {
      readyState = 'ended';
    },
  };
}

function expectedCloseReason(scenario: CaptureScenario): CameraCaptureCloseReason {
  if (scenario === 'RESUME_SUCCESS') return 'SUCCESS';
  return scenario;
}

async function simulateCaptureScenario(
  scenario: CaptureScenario,
): Promise<CaptureSimulationResult> {
  let currentMs = 1_000;
  let timerCallback: (() => void) | null = null;
  let decoderCallback: CameraDecoderCallback | null = null;
  let lifecycleHandlers: CameraCaptureLifecycleHandlers | null = null;
  let controlsStopCount = 0;
  let releaseAllStreamsCount = 0;
  let unsubscribeCount = 0;
  let candidateDelivered = false;
  const secureContext = scenario !== 'INSECURE_CONTEXT';
  const decoderStarts = secureContext && scenario !== 'PERMISSION_DENIED';
  const track = createMutableTrack();
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const video = { srcObject: null } as unknown as HTMLVideoElement;
  const controls: CameraScannerControls = {
    stop() {
      controlsStopCount += 1;
    },
  };
  const clock: CameraCaptureClock = {
    now: () => currentMs,
    setTimeout(callback) {
      timerCallback = callback;
      return 1;
    },
    clearTimeout() {
      timerCallback = null;
    },
  };

  const capture = createCameraCapture({
    video,
    timeoutMs: 5_000,
    onCandidate: () => {
      candidateDelivered = true;
      return 'ACCEPT';
    },
    dependencies: {
      clock,
      decoder: {
        async decodeFromConstraints(_constraints, targetVideo, callback) {
          if (scenario === 'PERMISSION_DENIED') {
            throw Object.assign(new Error('simulated permission denial'), {
              name: 'NotAllowedError',
            });
          }
          decoderCallback = callback;
          targetVideo.srcObject = stream;
          return controls;
        },
      },
      events: {
        subscribe(handlers) {
          lifecycleHandlers = handlers;
          return () => {
            unsubscribeCount += 1;
            lifecycleHandlers = null;
          };
        },
      },
      isSecureContext: () => secureContext,
      releaseAllStreams: () => {
        releaseAllStreamsCount += 1;
      },
    },
  });

  await capture.start();
  currentMs = 1_430;
  const handlers = lifecycleHandlers;

  switch (scenario) {
    case 'SUCCESS':
    case 'RESUME_SUCCESS':
      decoderCallback?.({
        getText: () => '7501234567893',
        getBarcodeFormat: () => BarcodeFormat.EAN_13,
      }, undefined, controls);
      break;
    case 'TIMEOUT':
      timerCallback?.();
      break;
    case 'STOPPED':
      capture.stop();
      break;
    case 'BACKGROUND':
      handlers?.visibilityChanged(true);
      break;
    case 'PAGEHIDE':
      handlers?.pageHidden();
      break;
    case 'BEFOREUNLOAD':
      handlers?.beforeUnload();
      break;
    case 'PERMISSION_DENIED':
    case 'INSECURE_CONTEXT':
      break;
  }

  const snapshot = capture.getSnapshot();
  const trackReleased = decoderStarts ? track.readyState === 'ended' : track.readyState === 'live';
  const controlsReleased = decoderStarts ? controlsStopCount === 1 : controlsStopCount === 0;
  const lifecycleReleased = secureContext ? unsubscribeCount === 1 : unsubscribeCount === 0;
  const resourcesReleased =
    releaseAllStreamsCount === 1
    && trackReleased
    && controlsReleased
    && lifecycleReleased
    && video.srcObject === null;
  const snapshotRedacted = !JSON.stringify(snapshot).includes('7501234567893');
  const expected = expectedCloseReason(scenario);
  const expectedCandidate = scenario === 'SUCCESS' || scenario === 'RESUME_SUCCESS';

  return {
    scenario,
    expectedCloseReason: expected,
    actualCloseReason: snapshot.closeReason,
    candidateDelivered,
    resourcesReleased,
    snapshotRedacted,
    passed:
      snapshot.closeReason === expected
      && candidateDelivered === expectedCandidate
      && resourcesReleased
      && snapshotRedacted,
  };
}

const SIMULATED_SAMPLE: Phase0RepoSafeSample = {
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

const SIMULATED_ENVIRONMENT: Phase0Environment = {
  environmentId: 'software-simulation-only',
  deviceTier: 'DESKTOP_CONTROL',
  manufacturer: 'SIMULATED',
  modelAlias: 'software-only',
  osName: 'Simulated',
  osVersion: 'not-physical',
  surface: 'BROWSER_TAB',
  browserName: 'Simulated',
  browserVersion: 'not-physical',
  engine: 'Mock',
  decoderName: 'ZXING_BROWSER',
  decoderVersion: 'browser-0.1.5_library-0.21.3',
  prototypeBuildId: 'phase0-harness-v1',
  cameraFacing: 'ENVIRONMENT',
  actualResolution: null,
  torchAvailable: false,
  secureContext: true,
  reportedFormats: ['ean_13'],
};

const SIMULATION_SCENARIOS: Phase0Scenario[] = [
  {
    scenarioId: 'measurement-cold-normal',
    startState: 'COLD',
    permissionState: 'PROMPT',
    networkMode: 'ONLINE',
    distanceCm: 20,
    angleDeg: 0,
    orientationDeg: 0,
    lightingBand: 'NORMAL_INDOOR',
    motion: 'HANDHELD',
    torch: 'OFF',
    timeoutMs: 5_000,
  },
  {
    scenarioId: 'measurement-warm-low',
    startState: 'WARM',
    permissionState: 'GRANTED',
    networkMode: 'OFFLINE',
    distanceCm: 20,
    angleDeg: 0,
    orientationDeg: 90,
    lightingBand: 'LOW',
    motion: 'STILL',
    torch: 'OFF',
    timeoutMs: 5_000,
  },
  {
    scenarioId: 'measurement-resume-glare',
    startState: 'RESUME',
    permissionState: 'GRANTED',
    networkMode: 'ONLINE',
    distanceCm: 20,
    angleDeg: 0,
    orientationDeg: 0,
    lightingBand: 'GLARE',
    motion: 'HANDHELD',
    torch: 'OFF',
    timeoutMs: 5_000,
  },
  {
    scenarioId: 'control-permission-denied',
    startState: 'WARM',
    permissionState: 'DENIED',
    networkMode: 'ONLINE',
    distanceCm: 20,
    angleDeg: 0,
    orientationDeg: 0,
    lightingBand: 'NORMAL_INDOOR',
    motion: 'STILL',
    torch: 'OFF',
    timeoutMs: 5_000,
  },
  {
    scenarioId: 'control-close',
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
  },
  {
    scenarioId: 'control-background',
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
  },
  {
    scenarioId: 'control-fallback',
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
  },
];

function measurementRun(sequence: number, scenarioId: string): Phase0Run {
  return {
    runId: `run-measurement-${sequence}`,
    sampleId: SIMULATED_SAMPLE.sampleId,
    environmentId: SIMULATED_ENVIRONMENT.environmentId,
    scenarioId,
    sequence,
    repetition: sequence,
    runDate: '2026-08-30',
    result: 'DECODED_MATCH',
    observedSymbology: 'EAN_13',
    observedLength: 13,
    payloadMatchesExpected: true,
    checksumResult: 'VALID',
    cameraReadyMs: 250,
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
  };
}

function baseSimulationManifest(): Phase0Manifest {
  const measurementScenarioIds = [
    'measurement-cold-normal',
    'measurement-warm-low',
    'measurement-resume-glare',
  ];
  const runs = Array.from({ length: 30 }, (_, index) => measurementRun(
    index + 1,
    measurementScenarioIds[index % measurementScenarioIds.length],
  ));
  runs.push(
    {
      ...measurementRun(31, 'control-permission-denied'),
      runId: 'run-control-permission-denied',
      result: 'PERMISSION_DENIED',
      observedSymbology: null,
      observedLength: null,
      payloadMatchesExpected: null,
      checksumResult: 'NOT_OBSERVED',
      cameraReadyMs: null,
      firstCandidateMs: null,
      firstCorrectMs: null,
      failureCode: 'PERMISSION_NOT_ALLOWED',
    },
    {
      ...measurementRun(32, 'control-close'),
      runId: 'run-control-close',
      result: 'ABORTED',
      observedSymbology: null,
      observedLength: null,
      payloadMatchesExpected: null,
      checksumResult: 'NOT_OBSERVED',
      firstCandidateMs: null,
      firstCorrectMs: null,
      failureCode: 'OPERATOR_ABORTED',
    },
    {
      ...measurementRun(33, 'control-background'),
      runId: 'run-control-background',
      result: 'ABORTED',
      observedSymbology: null,
      observedLength: null,
      payloadMatchesExpected: null,
      checksumResult: 'NOT_OBSERVED',
      firstCandidateMs: null,
      firstCorrectMs: null,
      failureCode: 'LIFECYCLE_INTERRUPTED',
    },
    {
      ...measurementRun(34, 'control-fallback'),
      runId: 'run-control-fallback',
      fallbackUsed: 'MANUAL_INPUT',
      fallbackSucceeded: true,
    },
  );

  return {
    schemaVersion: 1,
    protocolVersion: 'phase0-v1',
    normalizationVersion: 'barcode-input-v1',
    studyId: 'software-simulation-only',
    studyStatus: 'IN_PROGRESS',
    createdDate: '2026-08-30',
    dataClassification: 'REPO_SAFE_SYNTHETIC',
    privacy: {
      realPayloadsInRepo: false,
      rawFramesPersisted: false,
      customerDataAllowed: false,
      fingerprintAlgorithm: 'HMAC-SHA-256',
    },
    samples: [structuredClone(SIMULATED_SAMPLE)],
    environments: [structuredClone(SIMULATED_ENVIRONMENT)],
    scenarios: structuredClone(SIMULATION_SCENARIOS),
    runs,
  };
}

function evaluateSimulationManifest(
  scenario: DecisionSimulationResult['scenario'],
  expectedDecision: Phase0CellDecision,
  manifest: Phase0Manifest,
): DecisionSimulationResult {
  const environment = manifest.environments[0];
  const sample = manifest.samples[0];
  const lifecycleCoverage = deriveLifecycleChecks(manifest, environment.environmentId);
  const protocolCoverageComplete = hasCompleteProtocolCoverage(
    manifest,
    environment.environmentId,
    sample,
  );
  const evaluation = evaluateCell({
    environment,
    sample,
    scenarios: manifest.scenarios,
    runs: manifest.runs,
    protocolCoverageComplete,
    lifecycleChecks: lifecycleCoverage,
    privacyViolation: false,
    mutationTriggered: false,
  });

  return {
    scenario,
    expectedDecision,
    actualDecision: evaluation.decision,
    protocolCoverageComplete,
    lifecycleCoverage,
    measurementAttemptCount: evaluation.metrics.validAttemptCount,
    primaryAttemptCount: evaluation.metrics.primaryAttemptCount,
    protocolControlAttemptCount: evaluation.metrics.protocolControlAttemptCount,
    fallbackAttemptCount: evaluation.metrics.fallbackInitiatedCount,
    passed: evaluation.decision === expectedDecision,
  };
}

function decisionSimulationMatrix(): DecisionSimulationResult[] {
  const nominal = baseSimulationManifest();
  const slow = structuredClone(nominal);
  slow.runs
    .filter((run) => run.runId.startsWith('run-measurement-'))
    .slice(-2)
    .forEach((run) => {
      run.firstCandidateMs = 2_500;
      run.firstCorrectMs = 2_500;
    });

  const wrong = structuredClone(nominal);
  const wrongRun = wrong.runs.find((run) => run.runId === 'run-measurement-1');
  if (!wrongRun) throw new Error('La simulacion no encontro su corrida incorrecta.');
  Object.assign(wrongRun, {
    result: 'DECODED_WRONG',
    payloadMatchesExpected: false,
    firstCorrectMs: null,
    wrongCandidateCount: 1,
  } satisfies Partial<Phase0Run>);

  const fallbackOnly = structuredClone(nominal);
  fallbackOnly.runs = Array.from({ length: 30 }, (_, index) => ({
    ...measurementRun(index + 1, 'control-fallback'),
    runId: `run-fallback-only-${index + 1}`,
    fallbackUsed: 'MANUAL_INPUT' as const,
    fallbackSucceeded: true,
  }));

  const trackLeak = structuredClone(nominal);
  const leakedRun = trackLeak.runs.find((run) => run.runId === 'run-measurement-1');
  if (!leakedRun) throw new Error('La simulacion no encontro su track de prueba.');
  leakedRun.cameraTrackStoppedAfterExit = false;

  const unexpectedDenial = structuredClone(nominal);
  const deniedRun = unexpectedDenial.runs.find((run) => run.runId === 'run-measurement-1');
  if (!deniedRun) throw new Error('La simulacion no encontro su permiso inesperado.');
  Object.assign(deniedRun, {
    result: 'PERMISSION_DENIED',
    observedSymbology: null,
    observedLength: null,
    payloadMatchesExpected: null,
    checksumResult: 'NOT_OBSERVED',
    cameraReadyMs: null,
    firstCandidateMs: null,
    firstCorrectMs: null,
    failureCode: 'PERMISSION_NOT_ALLOWED',
  } satisfies Partial<Phase0Run>);

  return [
    evaluateSimulationManifest('NOMINAL', 'GO', nominal),
    evaluateSimulationManifest('SLOW_P95', 'PILOT', slow),
    evaluateSimulationManifest('WRONG_DECODE', 'NO_GO', wrong),
    evaluateSimulationManifest('FALLBACK_ONLY', 'INSUFFICIENT', fallbackOnly),
    evaluateSimulationManifest('TRACK_LEAK', 'NO_GO', trackLeak),
    evaluateSimulationManifest('UNEXPECTED_PERMISSION_DENIAL', 'PILOT', unexpectedDenial),
  ];
}

export async function runPhase0SoftwareSimulation(): Promise<Phase0SoftwareSimulationReport> {
  const captureScenarios: CaptureScenario[] = [
    'SUCCESS',
    'TIMEOUT',
    'STOPPED',
    'BACKGROUND',
    'RESUME_SUCCESS',
    'PAGEHIDE',
    'BEFOREUNLOAD',
    'PERMISSION_DENIED',
    'INSECURE_CONTEXT',
  ];
  const captureLifecycle = [];
  for (const scenario of captureScenarios) {
    captureLifecycle.push(await simulateCaptureScenario(scenario));
  }
  const decisionMatrix = decisionSimulationMatrix();
  const captureScenariosPassed = captureLifecycle.filter((entry) => entry.passed).length;
  const decisionScenariosPassed = decisionMatrix.filter((entry) => entry.passed).length;

  return {
    kind: SOFTWARE_SIMULATION_KIND,
    schemaVersion: 1,
    evidenceClass: SOFTWARE_ONLY_EVIDENCE_CLASS,
    deterministic: true,
    physicalEvidenceAccepted: false,
    rawPayloadsPersisted: false,
    captureLifecycle,
    decisionMatrix,
    summary: {
      captureScenariosPassed,
      captureScenarioCount: captureLifecycle.length,
      decisionScenariosPassed,
      decisionScenarioCount: decisionMatrix.length,
      allPassed:
        captureScenariosPassed === captureLifecycle.length
        && decisionScenariosPassed === decisionMatrix.length,
    },
    limitations: [
      'No usa una camara, lente, autofocus, torch ni frames reales.',
      'No prueba permisos ni lifecycle reales de Android, iOS o una PWA instalada.',
      'No autoriza un GO fisico ni reemplaza los 30 intentos medidos por dispositivo.',
    ],
  };
}
