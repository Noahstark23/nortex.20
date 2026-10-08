import type { CameraCaptureCloseReason } from './capture';
import type {
  Phase0Environment,
  Phase0LifecycleCheck,
  Phase0Manifest,
  Phase0RunObservation,
  Phase0Sample,
} from './domain';

export const PHASE0_DECODER_VERSION = 'browser-0.1.5_library-0.21.3';
export const PHASE0_PROTOTYPE_BUILD_ID = 'phase0-harness-v1';
export const PHASE0_REPORTED_FORMATS = Object.freeze([
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'code_128',
]);

export interface EnvironmentDraft {
  studyId: string;
  deviceTier: Phase0Environment['deviceTier'];
  manufacturer: string;
  modelAlias: string;
  osName: string;
  osVersion: string;
  surface: Extract<Phase0Environment['surface'], 'BROWSER_TAB' | 'INSTALLED_PWA'>;
  browserName: string;
  browserVersion: string;
  engine: string;
}

export interface ObservedCameraCapabilities {
  cameraObserved: boolean;
  secureContext: boolean;
  actualResolution: { width: number; height: number } | null;
  torchAvailable: boolean;
}

function requiredText(value: string, field: string): string {
  const clean = value.trim();
  if (!clean) throw new Error(`${field} es obligatorio.`);
  return clean;
}

export function prepareManifestForStudy(
  manifest: Phase0Manifest,
  environmentId: string,
  draft: EnvironmentDraft,
  capabilities: ObservedCameraCapabilities,
  runDate: string,
): Phase0Manifest {
  const copy = structuredClone(manifest);
  const environment = copy.environments.find((entry) => entry.environmentId === environmentId);
  if (!environment) throw new Error('El ambiente seleccionado no existe.');

  const normalizedDraft = {
    studyId: requiredText(draft.studyId, 'studyId'),
    manufacturer: requiredText(draft.manufacturer, 'manufacturer'),
    modelAlias: requiredText(draft.modelAlias, 'modelAlias'),
    osName: requiredText(draft.osName, 'osName'),
    osVersion: requiredText(draft.osVersion, 'osVersion'),
    browserName: requiredText(draft.browserName, 'browserName'),
    browserVersion: requiredText(draft.browserVersion, 'browserVersion'),
    engine: requiredText(draft.engine, 'engine'),
  };
  const studyHasRuns = copy.runs.length > 0;
  const environmentHasRuns = copy.runs.some((run) => run.environmentId === environmentId);
  const environmentIdentityMatches =
    environment.deviceTier === draft.deviceTier
    && environment.manufacturer === normalizedDraft.manufacturer
    && environment.modelAlias === normalizedDraft.modelAlias
    && environment.osName === normalizedDraft.osName
    && environment.osVersion === normalizedDraft.osVersion
    && environment.surface === draft.surface
    && environment.browserName === normalizedDraft.browserName
    && environment.browserVersion === normalizedDraft.browserVersion
    && environment.engine === normalizedDraft.engine
    && environment.decoderName === 'ZXING_BROWSER'
    && environment.decoderVersion === PHASE0_DECODER_VERSION
    && environment.prototypeBuildId === PHASE0_PROTOTYPE_BUILD_ID
    && environment.cameraFacing === 'ENVIRONMENT';

  if (studyHasRuns && copy.studyId !== normalizedDraft.studyId) {
    throw new Error('studyId no puede cambiar despues de registrar evidencia.');
  }
  if (environmentHasRuns && !environmentIdentityMatches) {
    throw new Error(
      'La identidad del ambiente no puede cambiar despues de registrar evidencia; usa otro environmentId.',
    );
  }

  copy.studyId = normalizedDraft.studyId;
  copy.studyStatus = 'IN_PROGRESS';
  if (!studyHasRuns) copy.createdDate = runDate;
  Object.assign(environment, {
    deviceTier: draft.deviceTier,
    manufacturer: normalizedDraft.manufacturer,
    modelAlias: normalizedDraft.modelAlias,
    osName: normalizedDraft.osName,
    osVersion: normalizedDraft.osVersion,
    surface: draft.surface,
    browserName: normalizedDraft.browserName,
    browserVersion: normalizedDraft.browserVersion,
    engine: normalizedDraft.engine,
    decoderName: 'ZXING_BROWSER',
    decoderVersion: PHASE0_DECODER_VERSION,
    prototypeBuildId: PHASE0_PROTOTYPE_BUILD_ID,
    cameraFacing: 'ENVIRONMENT',
    actualResolution: capabilities.cameraObserved
      ? capabilities.actualResolution
      : environmentIdentityMatches ? environment.actualResolution : null,
    torchAvailable: capabilities.cameraObserved
      ? capabilities.torchAvailable
      : environmentIdentityMatches ? environment.torchAvailable : false,
    secureContext: capabilities.secureContext,
    reportedFormats: [...PHASE0_REPORTED_FORMATS],
  } satisfies Partial<Phase0Environment>);

  return copy;
}

export function localIsoDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function nextRunIdentity(
  manifest: Phase0Manifest,
  sampleId: string,
  environmentId: string,
  scenarioId: string,
  nowMs = Date.now(),
): { runId: string; sequence: number; repetition: number } {
  const sequence = manifest.runs.length + 1;
  const repetition = manifest.runs.filter(
    (run) =>
      run.sampleId === sampleId &&
      run.environmentId === environmentId &&
      run.scenarioId === scenarioId,
  ).length + 1;
  const timeToken = Math.max(0, Math.floor(nowMs)).toString(36);

  return {
    runId: `run-${timeToken}-${sequence}`.slice(0, 64),
    sequence,
    repetition,
  };
}

export function closeReasonToObservation(
  reason: CameraCaptureCloseReason,
): Phase0RunObservation | null {
  switch (reason) {
    case 'SUCCESS':
      return null;
    case 'TIMEOUT':
      return { kind: 'NO_DECODE' };
    case 'PERMISSION_DENIED':
      return { kind: 'PERMISSION_DENIED' };
    case 'CAMERA_NOT_FOUND':
      return { kind: 'CAMERA_ERROR', failureCode: 'CAMERA_NOT_FOUND' };
    case 'CAMERA_NOT_READABLE':
      return { kind: 'CAMERA_ERROR', failureCode: 'CAMERA_NOT_READABLE' };
    case 'INSECURE_CONTEXT':
      return { kind: 'CAMERA_ERROR', failureCode: 'SECURE_CONTEXT_REQUIRED' };
    case 'DECODER_ERROR':
      return { kind: 'CAMERA_ERROR', failureCode: 'DECODER_UNAVAILABLE' };
    case 'STOPPED':
      return { kind: 'ABORTED', failureCode: 'OPERATOR_ABORTED' };
    case 'BACKGROUND':
    case 'PAGEHIDE':
    case 'BEFOREUNLOAD':
      return { kind: 'ABORTED', failureCode: 'LIFECYCLE_INTERRUPTED' };
  }
}

function matchingRuns(
  manifest: Phase0Manifest,
  environmentId: string,
  sampleId?: string,
) {
  return manifest.runs.filter(
    (run) =>
      !run.excluded &&
      run.environmentId === environmentId &&
      (sampleId === undefined || run.sampleId === sampleId),
  );
}

/**
 * Deriva únicamente evidencia persistida en el manifiesto. Una comprobación no
 * ejecutada se omite (cobertura insuficiente); una ejecutada que falla se marca
 * false y produce NO_GO en el dominio.
 */
export function deriveLifecycleChecks(
  manifest: Phase0Manifest,
  environmentId: string,
  sampleId?: string,
): Phase0LifecycleCheck[] {
  const runs = matchingRuns(manifest, environmentId, sampleId);
  const scenarios = new Map(manifest.scenarios.map((scenario) => [scenario.scenarioId, scenario]));
  const checks: Phase0LifecycleCheck[] = [];

  const deniedRuns = runs.filter(
    (run) => scenarios.get(run.scenarioId)?.permissionState === 'DENIED',
  );
  if (deniedRuns.length > 0) {
    checks.push({
      kind: 'PERMISSION_DENIED',
      passed: deniedRuns.every(
        (run) => run.result === 'PERMISSION_DENIED' && run.cameraTrackStoppedAfterExit,
      ),
    });
  }

  const closeRuns = runs.filter(
    (run) => run.result === 'ABORTED' && run.failureCode === 'OPERATOR_ABORTED',
  );
  if (closeRuns.length > 0) {
    checks.push({
      kind: 'CLOSE',
      passed: closeRuns.every((run) => run.cameraTrackStoppedAfterExit),
    });
  }

  const lifecycleExitRuns = runs.filter(
    (run) => run.result === 'ABORTED' && run.failureCode === 'LIFECYCLE_INTERRUPTED',
  );
  const resumeRuns = runs.filter(
    (run) => scenarios.get(run.scenarioId)?.startState === 'RESUME',
  );
  if (lifecycleExitRuns.length > 0 || resumeRuns.length > 0) {
    checks.push({
      kind: 'BACKGROUND_RESUME',
      passed:
        lifecycleExitRuns.length > 0 &&
        resumeRuns.length > 0 &&
        [...lifecycleExitRuns, ...resumeRuns].every((run) => run.cameraTrackStoppedAfterExit),
    });
  }

  const fallbackRuns = runs.filter((run) => run.fallbackUsed !== 'NONE');
  if (fallbackRuns.length > 0) {
    checks.push({
      kind: 'FALLBACK',
      passed: fallbackRuns.every(
        (run) => run.fallbackSucceeded === true && run.cameraTrackStoppedAfterExit,
      ),
    });
  }

  return checks;
}

function containsAll<T>(values: Set<T>, required: readonly T[]): boolean {
  return required.every((value) => values.has(value));
}

export function hasCompleteProtocolCoverage(
  manifest: Phase0Manifest,
  environmentId: string,
  sample: Phase0Sample,
): boolean {
  // Los fallbacks tienen su gate propio. No pueden acreditar condiciones de
  // captura que el decoder primario nunca ejecuto.
  const runs = matchingRuns(manifest, environmentId, sample.sampleId)
    .filter((run) => run.fallbackUsed === 'NONE');
  const scenarioById = new Map(manifest.scenarios.map((scenario) => [scenario.scenarioId, scenario]));
  const covered = runs
    .map((run) => scenarioById.get(run.scenarioId))
    .filter((scenario): scenario is NonNullable<typeof scenario> => Boolean(scenario));

  const startStates = new Set(covered.map((scenario) => scenario.startState));
  const permissions = new Set(covered.map((scenario) => scenario.permissionState));
  const networks = new Set(covered.map((scenario) => scenario.networkMode));
  const lighting = new Set(covered.map((scenario) => scenario.lightingBand));
  const motions = new Set(covered.map((scenario) => scenario.motion));
  const orientations = new Set(covered.map((scenario) => scenario.orientationDeg));
  const lifecycleKinds = new Set(
    deriveLifecycleChecks(manifest, environmentId).map((check) => check.kind),
  );

  return (
    containsAll(startStates, ['COLD', 'WARM', 'RESUME']) &&
    containsAll(permissions, ['PROMPT', 'GRANTED', 'DENIED']) &&
    containsAll(networks, ['ONLINE', 'OFFLINE']) &&
    containsAll(lighting, ['NORMAL_INDOOR', 'LOW', 'GLARE']) &&
    containsAll(motions, ['STILL', 'HANDHELD']) &&
    containsAll(orientations, [0, 90]) &&
    containsAll(lifecycleKinds, ['PERMISSION_DENIED', 'CLOSE', 'BACKGROUND_RESUME', 'FALLBACK'])
  );
}
