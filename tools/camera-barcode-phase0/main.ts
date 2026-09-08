import { registerSW } from 'virtual:pwa-register';
import schemaSource from '../../docs/product/camera-barcode-phase0-manifest.schema.json?raw';
import templateSource from '../../docs/product/camera-barcode-phase0-manifest.example.json?raw';
import './app.css';
import type {
  CameraCapture,
  CameraCaptureSnapshot,
  CameraDecodedCandidate,
} from './capture';
import {
  classifyCandidate,
  createRun,
  evaluateCell,
  sampleAllowsSuccessfulFallback,
  type Phase0Manifest,
  type Phase0RunObservation,
  type Phase0Sample,
} from './domain';
import {
  createManifestValidator,
  downloadManifestJson,
  evaluateCaptureReadiness,
  importEphemeralHmacKey,
  loadManifestJson,
  payloadMatchesFingerprint,
  type ManifestValidationIssue,
} from './manifest';
import {
  closeReasonToObservation,
  deriveLifecycleChecks,
  hasCompleteProtocolCoverage,
  localIsoDate,
  nextRunIdentity,
  PHASE0_DECODER_VERSION,
  PHASE0_PROTOTYPE_BUILD_ID,
  prepareManifestForStudy,
  type EnvironmentDraft,
} from './study';
import {
  isInstalledPwaDisplayMode,
  manualFallbackOutcomeStatus,
  type RuntimeStatusTone,
} from './runtime';

const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const CAMERA_SUPPORTED_SYMBOLOGIES = new Set<Phase0Sample['symbology']>([
  'EAN_13',
  'SCALE_EAN_13',
  'EAN_8',
  'UPC_A',
  'UPC_E',
  'CODE_128',
]);

interface ActiveAttempt {
  sampleId: string;
  environmentId: string;
  scenarioId: string;
  tracks: Set<MediaStreamTrack>;
  latestSnapshot: Readonly<CameraCaptureSnapshot>;
  candidateSeen: boolean;
  recorded: boolean;
  hmacKey: CryptoKey | null;
}

const schema = JSON.parse(schemaSource) as unknown;
const validateManifest = createManifestValidator(schema);
const initialLoad = loadManifestJson(templateSource, schema);
if (!initialLoad.ok) {
  throw new Error('La plantilla canónica de Fase 0 no cumple su schema.');
}

let manifest = structuredClone(initialLoad.manifest) as unknown as Phase0Manifest;
let activeCapture: CameraCapture | null = null;
let activeAttempt: ActiveAttempt | null = null;
let operationInFlight = false;

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('No existe el contenedor del arnés.');

root.innerHTML = `
  <div class="shell">
    <header class="hero">
      <p class="eyebrow">Investigación aislada · Fase 0</p>
      <h1>Cámara y códigos</h1>
      <p>Mide confiabilidad y lifecycle sin consultar productos ni tocar inventario.</p>
      <p class="runtime-facts">Origen: <code id="runtime-origin"></code> · HTTPS/secure context:
        <strong id="runtime-secure"></strong> · PWA instalada: <strong id="runtime-standalone"></strong></p>
    </header>

    <aside class="privacy-banner" role="note">
      <strong>Privacidad por diseño.</strong> El video se procesa localmente. No se guardan
      frames, códigos observados, datos de clientes ni secretos HMAC.
    </aside>

    <p id="status" class="status-banner" data-tone="neutral">Cargando contrato canónico…</p>

    <div class="grid">
      <section class="card" aria-labelledby="manifest-title">
        <h2 id="manifest-title">1. Manifiesto y ambiente</h2>
        <p class="hint">Importa evidencia existente o prepara la plantilla sintética.</p>

        <label>
          Importar manifiesto JSON
          <input id="manifest-file" type="file" accept="application/json,.json" />
        </label>

        <form id="environment-form" novalidate>
          <div class="fields two-columns">
            <label>
              ID del estudio
              <input id="study-id" required maxlength="64" autocomplete="off" />
            </label>
            <label>
              Nivel de dispositivo
              <select id="device-tier">
                <option value="ANDROID_LOW">Android económico</option>
                <option value="ANDROID_MID">Android medio</option>
                <option value="IPHONE_MIN_SUPPORTED">iPhone mínimo</option>
                <option value="IPHONE_CURRENT">iPhone actual</option>
                <option value="DESKTOP_CONTROL">Desktop control</option>
              </select>
            </label>
            <label>
              Fabricante
              <input id="manufacturer" required maxlength="64" autocomplete="off" />
            </label>
            <label>
              Alias del modelo
              <input id="model-alias" required maxlength="64" autocomplete="off" />
            </label>
            <label>
              Sistema operativo
              <input id="os-name" required maxlength="64" autocomplete="off" />
            </label>
            <label>
              Versión del SO
              <input id="os-version" required maxlength="32" autocomplete="off" />
            </label>
            <label>
              Superficie
              <select id="surface">
                <option value="INSTALLED_PWA">PWA instalada</option>
                <option value="BROWSER_TAB">Pestaña del navegador</option>
                <option value="CAPACITOR_REMOTE" disabled>Capacitor (fuera de este arnés)</option>
                <option value="KEYBOARD_WEDGE" disabled>Lector físico (fuera de este arnés)</option>
              </select>
            </label>
            <label>
              Navegador
              <input id="browser-name" required maxlength="64" autocomplete="off" />
            </label>
            <label>
              Versión del navegador
              <input id="browser-version" required maxlength="32" autocomplete="off" />
            </label>
            <label>
              Motor
              <input id="engine" required maxlength="32" autocomplete="off" />
            </label>
          </div>
          <p class="meta">Decoder fijado: <span id="decoder-version"></span> · build <span id="build-id"></span></p>
          <div class="actions">
            <button id="prepare-study" type="submit">Preparar estudio</button>
            <button id="export-manifest" type="button" class="secondary">Exportar evidencia</button>
          </div>
        </form>
      </section>

      <section class="card" aria-labelledby="capture-title">
        <h2 id="capture-title">2. Intento controlado</h2>
        <p class="hint">La UI nunca muestra el valor leído. Selecciona por ID opaco.</p>

        <div class="fields">
          <label>
            Ambiente
            <select id="environment"></select>
          </label>
          <label>
            Muestra
            <select id="sample"></select>
          </label>
          <label>
            Escenario
            <select id="scenario"></select>
          </label>
          <label id="secret-field" class="secret-field" hidden>
            Secreto HMAC efímero
            <input id="hmac-secret" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" />
            <span class="hint">Usa el mismo secreto externo en toda la sesión; Nortex lo limpia después de cada intento.</span>
          </label>
        </div>

        <div class="preview">
          <video id="camera-preview" autoplay muted playsinline aria-label="Vista previa de la cámara"></video>
        </div>

        <div class="actions">
          <button id="start-camera" type="button" disabled>Iniciar cámara</button>
          <button id="stop-camera" type="button" class="danger" disabled>Cancelar y cerrar</button>
          <button id="toggle-manual" type="button" class="secondary">Fallback manual</button>
        </div>

        <div id="manual-panel" class="manual-panel fields" hidden>
          <label>
            Código efímero (no se muestra ni exporta)
            <input id="manual-value" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" />
          </label>
          <button id="record-manual" type="button">Registrar fallback</button>
        </div>
      </section>
    </div>

    <section class="card" aria-labelledby="metrics-title" style="margin-top: 1rem">
      <h2 id="metrics-title">3. Resultado provisional de la celda</h2>
      <p class="hint">Una decisión solo aplica a la combinación exacta seleccionada.</p>
      <div class="metrics">
        <div class="metric"><span>Decisión</span><strong id="metric-decision">INSUFFICIENT</strong></div>
        <div class="metric"><span>Intentos de medición válidos</span><strong id="metric-attempts">0 / 30</strong></div>
        <div class="metric"><span>Éxito esperado</span><strong id="metric-success">0 %</strong></div>
        <div class="metric"><span>p95 lectura</span><strong id="metric-p95">N/A</strong></div>
        <div class="metric"><span>Lecturas incorrectas</span><strong id="metric-wrong">0</strong></div>
        <div class="metric"><span>Tracks detenidos</span><strong id="metric-tracks">N/A</strong></div>
        <div class="metric"><span>Fallback</span><strong id="metric-fallback">N/A</strong></div>
        <div class="metric"><span>Cobertura protocolo</span><strong id="metric-coverage">Pendiente</strong></div>
      </div>
      <h3 class="recent-title">Últimos intentos de esta celda</h3>
      <ol id="recent-runs" class="recent-runs"><li>Sin intentos registrados.</li></ol>
    </section>

    <p class="footer-note">Sin API · sin persistencia automática · sin autoridad de negocio</p>
  </div>
`;

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Falta el elemento ${id}.`);
  return value as T;
}

const status = element<HTMLParagraphElement>('status');
const environmentForm = element<HTMLFormElement>('environment-form');
const manifestFile = element<HTMLInputElement>('manifest-file');
const studyIdInput = element<HTMLInputElement>('study-id');
const deviceTierSelect = element<HTMLSelectElement>('device-tier');
const manufacturerInput = element<HTMLInputElement>('manufacturer');
const modelAliasInput = element<HTMLInputElement>('model-alias');
const osNameInput = element<HTMLInputElement>('os-name');
const osVersionInput = element<HTMLInputElement>('os-version');
const surfaceSelect = element<HTMLSelectElement>('surface');
const browserNameInput = element<HTMLInputElement>('browser-name');
const browserVersionInput = element<HTMLInputElement>('browser-version');
const engineInput = element<HTMLInputElement>('engine');
const environmentSelect = element<HTMLSelectElement>('environment');
const sampleSelect = element<HTMLSelectElement>('sample');
const scenarioSelect = element<HTMLSelectElement>('scenario');
const secretField = element<HTMLLabelElement>('secret-field');
const secretInput = element<HTMLInputElement>('hmac-secret');
const video = element<HTMLVideoElement>('camera-preview');
const startButton = element<HTMLButtonElement>('start-camera');
const stopButton = element<HTMLButtonElement>('stop-camera');
const prepareButton = element<HTMLButtonElement>('prepare-study');
const exportButton = element<HTMLButtonElement>('export-manifest');
const toggleManualButton = element<HTMLButtonElement>('toggle-manual');
const manualPanel = element<HTMLDivElement>('manual-panel');
const manualValueInput = element<HTMLInputElement>('manual-value');
const recordManualButton = element<HTMLButtonElement>('record-manual');

element<HTMLSpanElement>('decoder-version').textContent = PHASE0_DECODER_VERSION;
element<HTMLSpanElement>('build-id').textContent = PHASE0_PROTOTYPE_BUILD_ID;
element<HTMLElement>('runtime-origin').textContent = globalThis.location.origin;
element<HTMLElement>('runtime-secure').textContent = globalThis.isSecureContext ? 'sí' : 'no';
element<HTMLElement>('runtime-standalone').textContent = isStandaloneDisplay() ? 'sí' : 'no';

function setStatus(message: string, tone: RuntimeStatusTone = 'neutral'): void {
  status.textContent = message;
  status.dataset.tone = tone;
}

function issueSummary(issues: readonly { message: string }[]): string {
  return issues.slice(0, 3).map((issue) => issue.message).join(' ');
}

function fillSelect(
  select: HTMLSelectElement,
  entries: readonly { value: string; label: string }[],
  preferred?: string,
): void {
  const previous = preferred ?? select.value;
  select.replaceChildren();
  entries.forEach((entry) => {
    const option = document.createElement('option');
    option.value = entry.value;
    option.textContent = entry.label;
    select.append(option);
  });
  if (entries.some((entry) => entry.value === previous)) select.value = previous;
}

function renderManifest(): void {
  const environment = manifest.environments.find(
    (entry) => entry.environmentId === environmentSelect.value,
  ) ?? manifest.environments[0];

  fillSelect(
    environmentSelect,
    manifest.environments.map((entry) => ({
      value: entry.environmentId,
      label: `${entry.environmentId} · ${entry.surface}`,
    })),
    environment?.environmentId,
  );
  fillSelect(
    sampleSelect,
    manifest.samples.map((entry) => ({
      value: entry.sampleId,
      label: `${entry.sampleId} · ${entry.symbology} · ${entry.expectedOutcome}`,
    })),
  );
  fillSelect(
    scenarioSelect,
    manifest.scenarios.map((entry) => ({
      value: entry.scenarioId,
      label: `${entry.scenarioId} · ${entry.startState} · ${entry.lightingBand}`,
    })),
  );

  const selectedEnvironment = selectedContext().environment;
  studyIdInput.value = manifest.studyId;
  deviceTierSelect.value = selectedEnvironment.deviceTier;
  manufacturerInput.value = selectedEnvironment.manufacturer;
  modelAliasInput.value = selectedEnvironment.modelAlias;
  osNameInput.value = selectedEnvironment.osName;
  osVersionInput.value = selectedEnvironment.osVersion;
  surfaceSelect.value = selectedEnvironment.surface;
  browserNameInput.value = selectedEnvironment.browserName;
  browserVersionInput.value = selectedEnvironment.browserVersion;
  engineInput.value = selectedEnvironment.engine;
  renderSamplePrivacy();
  updateReadiness();
  renderMetrics();
}

function selectedContext() {
  const environment = manifest.environments.find(
    (entry) => entry.environmentId === environmentSelect.value,
  );
  const sample = manifest.samples.find((entry) => entry.sampleId === sampleSelect.value);
  const scenario = manifest.scenarios.find((entry) => entry.scenarioId === scenarioSelect.value);
  if (!environment || !sample || !scenario) {
    throw new Error('La selección no referencia ambiente, muestra y escenario válidos.');
  }
  return { environment, sample, scenario };
}

function renderSamplePrivacy(): void {
  const sample = manifest.samples.find((entry) => entry.sampleId === sampleSelect.value);
  const needsSecret = sample?.repoSafe === false;
  secretField.hidden = !needsSecret;
  secretInput.required = needsSecret;
  if (!needsSecret) secretInput.value = '';
  toggleManualButton.disabled = sample ? !sampleAllowsSuccessfulFallback(sample) : true;
  if (toggleManualButton.disabled) manualPanel.hidden = true;
}

function isStandaloneDisplay(): boolean {
  return isInstalledPwaDisplayMode();
}

function updateReadiness(): void {
  const readiness = evaluateCaptureReadiness(
    manifest as unknown as import('./manifest').Phase0Manifest,
    environmentSelect.value,
  );
  const selectedSurface = manifest.environments.find(
    (entry) => entry.environmentId === environmentSelect.value,
  )?.surface;
  const selectedDecoder = manifest.environments.find(
    (entry) => entry.environmentId === environmentSelect.value,
  )?.decoderName;
  const harnessSupportsEnvironment =
    (selectedSurface === 'BROWSER_TAB' || selectedSurface === 'INSTALLED_PWA') &&
    selectedDecoder === 'ZXING_BROWSER';
  const surfaceMatches = selectedSurface !== 'INSTALLED_PWA' || isStandaloneDisplay();
  const busy = activeCapture !== null || activeAttempt !== null || operationInFlight;

  startButton.disabled = !readiness.ready || !harnessSupportsEnvironment || !surfaceMatches || busy;
  recordManualButton.disabled = busy || manifest.studyStatus !== 'IN_PROGRESS';
  stopButton.disabled = !busy;
  exportButton.disabled = busy;
  prepareButton.disabled = busy;
  manifestFile.disabled = busy;

  if (!readiness.ready) {
    setStatus(issueSummary(readiness.issues), 'warning');
  } else if (!harnessSupportsEnvironment) {
    setStatus('Este arnés solo ejecuta cámara web/PWA con ZXing Browser.', 'warning');
  } else if (!surfaceMatches) {
    setStatus('El ambiente exige PWA instalada, pero esta ventana es una pestaña del navegador.', 'warning');
  }
}

function draftFromForm(): EnvironmentDraft {
  return {
    studyId: studyIdInput.value,
    deviceTier: deviceTierSelect.value as EnvironmentDraft['deviceTier'],
    manufacturer: manufacturerInput.value,
    modelAlias: modelAliasInput.value,
    osName: osNameInput.value,
    osVersion: osVersionInput.value,
    surface: surfaceSelect.value as EnvironmentDraft['surface'],
    browserName: browserNameInput.value,
    browserVersion: browserVersionInput.value,
    engine: engineInput.value,
  };
}

function cameraCapabilities(tracks: Iterable<MediaStreamTrack> = []): {
  cameraObserved: boolean;
  secureContext: boolean;
  actualResolution: { width: number; height: number } | null;
  torchAvailable: boolean;
} {
  const track = [...tracks].find((entry) => entry.kind === 'video');
  const settings = track?.getSettings?.();
  const width = settings?.width ?? video.videoWidth;
  const height = settings?.height ?? video.videoHeight;
  const capabilities = track?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;

  return {
    cameraObserved: track !== undefined,
    secureContext: globalThis.isSecureContext === true,
    actualResolution: width > 0 && height > 0 ? { width, height } : null,
    torchAvailable: capabilities?.torch === true,
  };
}

function prepareCurrentManifest(): void {
  const environmentId = environmentSelect.value;
  if (surfaceSelect.value !== 'BROWSER_TAB' && surfaceSelect.value !== 'INSTALLED_PWA') {
    throw new Error('Selecciona pestaña web o PWA instalada para usar este arnés.');
  }
  const prepared = prepareManifestForStudy(
    manifest,
    environmentId,
    draftFromForm(),
    cameraCapabilities(activeAttempt?.tracks),
    localIsoDate(),
  );
  const validation = validateManifest(prepared);
  if (!validation.ok) throw new Error(issueSummary(validation.issues));
  manifest = prepared;
}

function rememberTracks(attempt: ActiveAttempt): void {
  const stream = video.srcObject as MediaStream | null;
  stream?.getTracks().forEach((track) => attempt.tracks.add(track));
}

function tracksStopped(attempt: ActiveAttempt): boolean {
  return [...attempt.tracks].every((track) => track.readyState === 'ended');
}

function refreshObservedCapabilities(target: Phase0Manifest, attempt: ActiveAttempt): void {
  const environment = target.environments.find(
    (entry) => entry.environmentId === attempt.environmentId,
  );
  if (!environment) return;
  const observed = cameraCapabilities(attempt.tracks);
  environment.actualResolution = observed.actualResolution ?? environment.actualResolution;
  environment.torchAvailable = observed.torchAvailable;
  environment.secureContext = observed.secureContext;
}

function appendRun(
  attempt: ActiveAttempt,
  observation: Phase0RunObservation,
  fallback: { fallbackUsed: 'NONE'; fallbackSucceeded?: null } | {
    fallbackUsed: 'MANUAL_INPUT';
    fallbackSucceeded: boolean;
  } = { fallbackUsed: 'NONE', fallbackSucceeded: null },
): void {
  if (attempt.recorded) return;
  const nextManifest = structuredClone(manifest);
  refreshObservedCapabilities(nextManifest, attempt);
  const identity = nextRunIdentity(
    manifest,
    attempt.sampleId,
    attempt.environmentId,
    attempt.scenarioId,
  );
  nextManifest.runs.push(createRun({
    ...identity,
    sampleId: attempt.sampleId,
    environmentId: attempt.environmentId,
    scenarioId: attempt.scenarioId,
    runDate: localIsoDate(),
    observation,
    cameraReadyMs: attempt.latestSnapshot.cameraReadyMs,
    cameraTrackStoppedAfterExit: tracksStopped(attempt),
    fallback,
  }));
  const validation = validateManifest(nextManifest);
  if (!validation.ok) throw new Error(issueSummary(validation.issues));
  manifest = nextManifest;
  attempt.recorded = true;
  attempt.hmacKey = null;
  renderMetrics();
}

async function classify(
  attempt: ActiveAttempt,
  sample: Phase0Sample,
  observedValue: string,
  observedSymbology: Phase0Sample['symbology'],
) {
  return classifyCandidate({
    sample,
    observedValue,
    observedSymbology,
    compareFieldFingerprint: attempt.hmacKey
      ? (value, expected) => payloadMatchesFingerprint(value, expected, attempt.hmacKey as CryptoKey)
      : undefined,
  });
}

async function recordCandidate(
  attempt: ActiveAttempt,
  candidate: CameraDecodedCandidate,
): Promise<void> {
  try {
    const sample = manifest.samples.find((entry) => entry.sampleId === attempt.sampleId);
    if (!sample) throw new Error('La muestra activa dejó de existir.');
    const classification = await classify(
      attempt,
      sample,
      candidate.value,
      candidate.symbology,
    );
    appendRun(attempt, {
      kind: 'CANDIDATE',
      classification,
      firstCandidateMs: candidate.elapsedMs,
      firstCorrectMs: classification.result === 'DECODED_MATCH' ? candidate.elapsedMs : undefined,
    });
    setStatus(
      classification.result === 'DECODED_MATCH'
        ? 'Intento registrado: coincidencia correcta. El payload no fue conservado.'
        : 'Intento registrado: lectura incorrecta. La celda queda NO_GO.',
      classification.result === 'DECODED_MATCH' ? 'success' : 'error',
    );
  } catch {
    appendRun(attempt, {
      kind: 'ABORTED',
      failureCode: 'PROTOCOL_ERROR',
      firstCandidateMs: candidate.elapsedMs,
    });
    setStatus('El candidato no pudo clasificarse con el contrato seguro.', 'error');
  } finally {
    attempt.hmacKey = null;
    activeAttempt = null;
    updateReadiness();
  }
}

function handleCaptureState(
  attempt: ActiveAttempt,
  snapshot: Readonly<CameraCaptureSnapshot>,
): void {
  attempt.latestSnapshot = snapshot;
  rememberTracks(attempt);

  if (snapshot.state === 'STARTING') {
    setStatus('Solicitando permiso y abriendo la cámara…');
    return;
  }
  if (snapshot.state === 'SCANNING') {
    setStatus('Cámara activa. Apunta una sola etiqueta al encuadre.');
    return;
  }
  if (snapshot.state !== 'CLOSED') return;

  activeCapture = null;
  rememberTracks(attempt);
  if (!attempt.candidateSeen && snapshot.closeReason) {
    const observation = closeReasonToObservation(snapshot.closeReason);
    if (observation) {
      appendRun(attempt, observation);
      const tone: RuntimeStatusTone = snapshot.closeReason === 'TIMEOUT' ? 'warning' : 'error';
      setStatus(`Intento cerrado: ${snapshot.closeReason}.`, tone);
    }
    activeAttempt = null;
  }
  updateReadiness();
}

async function prepareHmacKey(sample: Phase0Sample): Promise<CryptoKey | null> {
  if (sample.repoSafe) return null;
  const secret = secretInput.value;
  secretInput.value = '';
  if (!secret) throw new Error('La muestra de campo requiere el secreto HMAC efímero.');
  return importEphemeralHmacKey(secret);
}

function unsupportedObservation(sample: Phase0Sample): Phase0RunObservation | null {
  if (CAMERA_SUPPORTED_SYMBOLOGIES.has(sample.symbology)) return null;
  return { kind: 'UNSUPPORTED_FORMAT' };
}

async function startCameraAttempt(): Promise<void> {
  if (activeCapture || activeAttempt || operationInFlight) return;
  operationInFlight = true;
  updateReadiness();
  try {
    prepareCurrentManifest();
    const readiness = evaluateCaptureReadiness(
      manifest as unknown as import('./manifest').Phase0Manifest,
      environmentSelect.value,
    );
    if (!readiness.ready) throw new Error(issueSummary(readiness.issues));
    const { environment, sample, scenario } = selectedContext();
    if (environment.surface === 'INSTALLED_PWA' && !isStandaloneDisplay()) {
      throw new Error('Abre la PWA instalada para registrar esta superficie.');
    }

    const unsupported = unsupportedObservation(sample);
    const attempt: ActiveAttempt = {
      sampleId: sample.sampleId,
      environmentId: environment.environmentId,
      scenarioId: scenario.scenarioId,
      tracks: new Set(),
      latestSnapshot: {
        state: 'IDLE',
        closeReason: null,
        cameraReadyMs: null,
        firstCandidateMs: null,
      },
      candidateSeen: false,
      recorded: false,
      hmacKey: unsupported ? null : await prepareHmacKey(sample),
    };

    if (unsupported) {
      appendRun(attempt, unsupported);
      setStatus('Formato fuera del decoder fijado; se registró como no soportado.', 'warning');
      renderMetrics();
      return;
    }

    activeAttempt = attempt;
    const { createCameraCapture } = await import('./capture');
    activeCapture = createCameraCapture({
      video,
      timeoutMs: scenario.timeoutMs,
      onCandidate: (candidate) => {
        attempt.candidateSeen = true;
        void recordCandidate(attempt, candidate);
      },
      onStateChange: (snapshot) => handleCaptureState(attempt, snapshot),
    });
    updateReadiness();
    await activeCapture.start();
  } catch (error) {
    activeAttempt = null;
    activeCapture = null;
    setStatus(error instanceof Error ? error.message : 'No se pudo iniciar el intento.', 'error');
  } finally {
    operationInFlight = false;
    updateReadiness();
  }
}

async function recordManualFallback(): Promise<void> {
  if (activeCapture || activeAttempt || operationInFlight) return;
  const observedValue = manualValueInput.value;
  manualValueInput.value = '';
  if (!observedValue) {
    setStatus('Introduce un código efímero para probar el fallback.', 'warning');
    return;
  }

  operationInFlight = true;
  updateReadiness();
  try {
    prepareCurrentManifest();
    const { environment, sample, scenario } = selectedContext();
    if (!sampleAllowsSuccessfulFallback(sample)) {
      throw new Error('El fallback manual solo aplica a muestras con expectedOutcome DECODE.');
    }
    const attempt: ActiveAttempt = {
      sampleId: sample.sampleId,
      environmentId: environment.environmentId,
      scenarioId: scenario.scenarioId,
      tracks: new Set(),
      latestSnapshot: {
        state: 'CLOSED',
        closeReason: 'SUCCESS',
        cameraReadyMs: null,
        firstCandidateMs: 0,
      },
      candidateSeen: true,
      recorded: false,
      hmacKey: await prepareHmacKey(sample),
    };
    const startedAt = performance.now();
    const classification = await classify(
      attempt,
      sample,
      observedValue,
      sample.symbology === 'SCALE_EAN_13' ? 'EAN_13' : sample.symbology,
    );
    const elapsedMs = Math.max(0, Math.round(performance.now() - startedAt));
    appendRun(attempt, {
      kind: 'CANDIDATE',
      classification,
      firstCandidateMs: elapsedMs,
      firstCorrectMs: classification.result === 'DECODED_MATCH' ? elapsedMs : undefined,
    }, {
      fallbackUsed: 'MANUAL_INPUT',
      fallbackSucceeded: classification.result === 'DECODED_MATCH',
    });
    const outcome = manualFallbackOutcomeStatus(classification);
    setStatus(outcome.message, outcome.tone);
  } catch {
    setStatus('El fallback no pudo clasificarse con el contrato seguro.', 'error');
  } finally {
    operationInFlight = false;
    renderMetrics();
    updateReadiness();
  }
}

function percent(value: number | null): string {
  return value === null ? 'N/A' : `${(value * 100).toFixed(1)} %`;
}

function renderMetrics(): void {
  let context: ReturnType<typeof selectedContext>;
  try {
    context = selectedContext();
  } catch {
    return;
  }
  const lifecycleChecks = deriveLifecycleChecks(
    manifest,
    context.environment.environmentId,
  );
  const protocolCoverageComplete = hasCompleteProtocolCoverage(
    manifest,
    context.environment.environmentId,
    context.sample,
  );
  const evaluation = evaluateCell({
    environment: context.environment,
    sample: context.sample,
    scenarios: manifest.scenarios,
    runs: manifest.runs,
    protocolCoverageComplete,
    lifecycleChecks,
    privacyViolation: false,
    mutationTriggered: false,
  });

  element<HTMLElement>('metric-decision').textContent = evaluation.decision;
  element<HTMLElement>('metric-attempts').textContent = `${evaluation.metrics.validAttemptCount} / 30`;
  element<HTMLElement>('metric-success').textContent = percent(
    evaluation.metrics.expectedOutcomeSuccessRate,
  );
  element<HTMLElement>('metric-p95').textContent = evaluation.metrics.p95FirstCorrectMs === null
    ? 'N/A'
    : `${evaluation.metrics.p95FirstCorrectMs} ms`;
  element<HTMLElement>('metric-wrong').textContent = String(evaluation.metrics.wrongDecodeRunCount);
  element<HTMLElement>('metric-tracks').textContent = percent(evaluation.metrics.trackStopRate);
  element<HTMLElement>('metric-fallback').textContent = percent(evaluation.metrics.fallbackSuccessRate);
  element<HTMLElement>('metric-coverage').textContent = protocolCoverageComplete ? 'Completa' : 'Pendiente';

  const recentRuns = manifest.runs
    .filter(
      (run) =>
        run.environmentId === context.environment.environmentId &&
        run.sampleId === context.sample.sampleId,
    )
    .slice(-5)
    .reverse();
  const recentList = element<HTMLOListElement>('recent-runs');
  recentList.replaceChildren();
  if (recentRuns.length === 0) {
    const empty = document.createElement('li');
    empty.textContent = 'Sin intentos registrados.';
    recentList.append(empty);
  } else {
    recentRuns.forEach((run) => {
      const item = document.createElement('li');
      const timing = run.firstCorrectMs === null ? 'sin lectura correcta' : `${run.firstCorrectMs} ms`;
      item.textContent = `#${run.sequence} · ${run.result} · ${run.scenarioId} · ${timing} · cámara ${run.cameraTrackStoppedAfterExit ? 'cerrada' : 'NO cerrada'}`;
      recentList.append(item);
    });
  }
}

environmentForm.addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    prepareCurrentManifest();
    renderManifest();
    if (!startButton.disabled) {
      setStatus('Contrato válido. La captura está lista para un intento físico.', 'success');
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'El ambiente no es válido.', 'error');
  }
});

manifestFile.addEventListener('change', async () => {
  const file = manifestFile.files?.[0];
  manifestFile.value = '';
  if (!file) return;
  if (file.size > MAX_MANIFEST_BYTES) {
    setStatus('El manifiesto supera el límite local de 2 MiB.', 'error');
    return;
  }
  const loaded = loadManifestJson(await file.text(), schema);
  if (!loaded.ok) {
    setStatus(issueSummary(loaded.issues), 'error');
    return;
  }
  manifest = structuredClone(loaded.manifest) as unknown as Phase0Manifest;
  renderManifest();
  setStatus('Manifiesto importado y validado; no se persistió automáticamente.', 'success');
});

environmentSelect.addEventListener('change', renderManifest);
sampleSelect.addEventListener('change', () => {
  renderSamplePrivacy();
  renderMetrics();
});
scenarioSelect.addEventListener('change', renderMetrics);
startButton.addEventListener('click', () => void startCameraAttempt());
stopButton.addEventListener('click', () => activeCapture?.stop());
recordManualButton.addEventListener('click', () => void recordManualFallback());
toggleManualButton.addEventListener('click', () => {
  manualPanel.hidden = !manualPanel.hidden;
  if (!manualPanel.hidden) manualValueInput.focus();
});
exportButton.addEventListener('click', () => {
  try {
    const receipt = downloadManifestJson(manifest, schema);
    setStatus(`Evidencia exportada: ${receipt.fileName} (${receipt.byteLength} bytes).`, 'success');
  } catch (error) {
    const issues = (error as { issues?: ManifestValidationIssue[] }).issues;
    setStatus(
      issues ? issueSummary(issues) : 'La exportación fue bloqueada por validación o privacidad.',
      'error',
    );
  }
});

registerSW({
  immediate: true,
  onNeedRefresh() {
    setStatus('Hay una nueva versión del arnés. Cierra la cámara antes de recargar.', 'warning');
  },
  onOfflineReady() {
    setStatus('Arnés listo para ejecutar escenarios sin red.', 'success');
  },
  onRegisterError() {
    setStatus('No se pudo registrar el service worker aislado.', 'warning');
  },
});

renderManifest();
