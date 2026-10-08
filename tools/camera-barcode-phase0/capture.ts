import {
  BrowserCodeReader,
  BrowserMultiFormatReader,
  type IScannerControls,
} from '@zxing/browser';
import {
  BarcodeFormat,
  ChecksumException,
  DecodeHintType,
  FormatException,
  NotFoundException,
} from '@zxing/library';

export const CAMERA_CAPTURE_TIMEOUT_MS = 5_000;

export const CAMERA_BARCODE_FORMATS = Object.freeze([
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
] as const);

export const CAMERA_MEDIA_CONSTRAINTS = Object.freeze({
  audio: false,
  video: Object.freeze({
    facingMode: Object.freeze({ ideal: 'environment' }),
  }),
}) satisfies MediaStreamConstraints;

export type CameraBarcodeSymbology =
  | 'EAN_13'
  | 'EAN_8'
  | 'UPC_A'
  | 'UPC_E'
  | 'CODE_128';

export type CameraCandidateDecision = 'ACCEPT' | 'CONTINUE';

export type CameraCaptureState = 'IDLE' | 'STARTING' | 'SCANNING' | 'CLOSED';

export type CameraCaptureCloseReason =
  | 'SUCCESS'
  | 'STOPPED'
  | 'TIMEOUT'
  | 'BACKGROUND'
  | 'PAGEHIDE'
  | 'BEFOREUNLOAD'
  | 'PERMISSION_DENIED'
  | 'CAMERA_NOT_FOUND'
  | 'CAMERA_NOT_READABLE'
  | 'INSECURE_CONTEXT'
  | 'DECODER_ERROR';

export interface CameraDecodedCandidate {
  /**
   * Valor efimero. La capa de captura no lo persiste ni lo incluye en snapshots.
   * El consumidor debe compararlo o derivar su huella dentro de este callback.
   */
  value: string;
  symbology: CameraBarcodeSymbology;
  elapsedMs: number;
}

export interface CameraCaptureSnapshot {
  state: CameraCaptureState;
  closeReason: CameraCaptureCloseReason | null;
  cameraReadyMs: number | null;
  firstCandidateMs: number | null;
}

export interface CameraDecoderResult {
  getText(): string;
  getBarcodeFormat(): BarcodeFormat;
}

export interface CameraScannerControls {
  stop(): void | Promise<void>;
}

export type CameraDecoderCallback = (
  result: CameraDecoderResult | undefined,
  error: unknown,
  controls: CameraScannerControls,
) => void;

export interface CameraDecoder {
  decodeFromConstraints(
    constraints: MediaStreamConstraints,
    video: HTMLVideoElement,
    callback: CameraDecoderCallback,
  ): Promise<CameraScannerControls>;
}

export interface CameraCaptureClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface CameraCaptureLifecycleHandlers {
  visibilityChanged(hidden: boolean): void;
  pageHidden(): void;
  beforeUnload(): void;
}

export interface CameraCaptureEventSource {
  subscribe(handlers: CameraCaptureLifecycleHandlers): () => void;
}

export interface CameraCaptureDependencies {
  decoder: CameraDecoder;
  clock: CameraCaptureClock;
  events: CameraCaptureEventSource;
  isSecureContext(): boolean;
  releaseAllStreams(): void;
}

export interface CreateCameraCaptureOptions {
  video: HTMLVideoElement;
  timeoutMs?: number;
  onCandidate(candidate: CameraDecodedCandidate): CameraCandidateDecision | void;
  onStateChange?(snapshot: Readonly<CameraCaptureSnapshot>): void;
  dependencies?: Partial<CameraCaptureDependencies>;
}

export interface CameraCapture {
  start(): Promise<Readonly<CameraCaptureSnapshot>>;
  stop(): Readonly<CameraCaptureSnapshot>;
  getSnapshot(): Readonly<CameraCaptureSnapshot>;
}

const defaultClock: CameraCaptureClock = {
  now: () => globalThis.performance?.now?.() ?? Date.now(),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
  },
};

const defaultEventSource: CameraCaptureEventSource = {
  subscribe(handlers) {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      return () => undefined;
    }

    const onVisibilityChange = () => {
      handlers.visibilityChanged(document.visibilityState === 'hidden');
    };
    const onPageHide = () => handlers.pageHidden();
    const onBeforeUnload = () => handlers.beforeUnload();

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  },
};

export function createZxingCameraDecoder(): CameraDecoder {
  const hints = new Map<DecodeHintType, unknown>([
    [DecodeHintType.POSSIBLE_FORMATS, [...CAMERA_BARCODE_FORMATS]],
  ]);
  const reader = new BrowserMultiFormatReader(hints);

  return {
    decodeFromConstraints(constraints, video, callback) {
      return reader.decodeFromConstraints(
        constraints,
        video,
        (result, error, controls) => callback(result, error, controls),
      ) as Promise<IScannerControls>;
    },
  };
}

function defaultSecureContextCheck(): boolean {
  return typeof globalThis.isSecureContext === 'boolean' && globalThis.isSecureContext;
}

function snapshotOf(
  state: CameraCaptureState,
  closeReason: CameraCaptureCloseReason | null,
  cameraReadyMs: number | null,
  firstCandidateMs: number | null,
): Readonly<CameraCaptureSnapshot> {
  return Object.freeze({ state, closeReason, cameraReadyMs, firstCandidateMs });
}

function toElapsedMs(now: number, startedAt: number): number {
  return Math.max(0, Math.round(now - startedAt));
}

function toSymbology(format: BarcodeFormat): CameraBarcodeSymbology {
  switch (format) {
    case BarcodeFormat.EAN_13:
      return 'EAN_13';
    case BarcodeFormat.EAN_8:
      return 'EAN_8';
    case BarcodeFormat.UPC_A:
      return 'UPC_A';
    case BarcodeFormat.UPC_E:
      return 'UPC_E';
    case BarcodeFormat.CODE_128:
      return 'CODE_128';
    default:
      throw new Error('El decodificador emitio una simbologia fuera del contrato');
  }
}

function getErrorName(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const candidate = error as { name?: unknown; getKind?: () => unknown };
  if (typeof candidate.getKind === 'function') {
    const kind = candidate.getKind();
    if (typeof kind === 'string') return kind;
  }
  return typeof candidate.name === 'string' ? candidate.name : '';
}

function isRecoverableDecodeMiss(error: unknown): boolean {
  if (
    error instanceof NotFoundException
    || error instanceof ChecksumException
    || error instanceof FormatException
  ) {
    return true;
  }

  return ['NotFoundException', 'ChecksumException', 'FormatException'].includes(
    getErrorName(error),
  );
}

function mapCaptureError(error: unknown): CameraCaptureCloseReason {
  switch (getErrorName(error)) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'PERMISSION_DENIED';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'CAMERA_NOT_FOUND';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'CAMERA_NOT_READABLE';
    default:
      return 'DECODER_ERROR';
  }
}

function stopVideoTracks(video: HTMLVideoElement): void {
  const source = video.srcObject as (MediaStream & { getTracks?: () => MediaStreamTrack[] }) | null;
  if (source && typeof source.getTracks === 'function') {
    for (const track of source.getTracks()) {
      try {
        track.stop();
      } catch {
        // El cierre del resto de recursos no depende de un track defectuoso.
      }
    }
  }

  try {
    video.srcObject = null;
  } catch {
    // Algunos WebViews exponen srcObject como solo lectura; releaseAllStreams cubre el stream.
  }
}

function safeStopControls(controls: CameraScannerControls | null): void {
  if (!controls) return;
  try {
    const possiblePromise = controls.stop();
    if (possiblePromise) void possiblePromise.catch(() => undefined);
  } catch {
    // Siempre continuar con tracks y stream tracker aunque falle el control de ZXing.
  }
}

export function createCameraCapture(options: CreateCameraCaptureOptions): CameraCapture {
  const timeoutMs = options.timeoutMs ?? CAMERA_CAPTURE_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('timeoutMs debe ser un numero positivo y finito');
  }

  const dependencies: CameraCaptureDependencies = {
    decoder: options.dependencies?.decoder ?? createZxingCameraDecoder(),
    clock: options.dependencies?.clock ?? defaultClock,
    events: options.dependencies?.events ?? defaultEventSource,
    isSecureContext: options.dependencies?.isSecureContext ?? defaultSecureContextCheck,
    releaseAllStreams:
      options.dependencies?.releaseAllStreams ?? (() => BrowserCodeReader.releaseAllStreams()),
  };

  let state: CameraCaptureState = 'IDLE';
  let closeReason: CameraCaptureCloseReason | null = null;
  let cameraReadyMs: number | null = null;
  let firstCandidateMs: number | null = null;
  let startedAt: number | null = null;
  let controls: CameraScannerControls | null = null;
  let timeoutHandle: unknown = null;
  let unsubscribeEvents: (() => void) | null = null;
  let startPromise: Promise<Readonly<CameraCaptureSnapshot>> | null = null;

  const getSnapshot = () => snapshotOf(state, closeReason, cameraReadyMs, firstCandidateMs);

  const notifyState = () => {
    try {
      options.onStateChange?.(getSnapshot());
    } catch {
      // Un observador de UI no puede impedir que se libere la camara.
    }
  };

  const releaseMedia = (scannerControls: CameraScannerControls | null = controls) => {
    safeStopControls(scannerControls);
    stopVideoTracks(options.video);
    try {
      dependencies.releaseAllStreams();
    } catch {
      // La limpieza explicita de tracks ya se intento; no propagar desde cleanup.
    }
  };

  const close = (reason: CameraCaptureCloseReason) => {
    if (state === 'CLOSED') return getSnapshot();

    state = 'CLOSED';
    closeReason = reason;
    if (timeoutHandle !== null) {
      dependencies.clock.clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
    unsubscribeEvents?.();
    unsubscribeEvents = null;
    releaseMedia();
    notifyState();
    return getSnapshot();
  };

  const markCameraReady = () => {
    if (state === 'CLOSED' || startedAt === null) return;
    if (cameraReadyMs === null) {
      cameraReadyMs = toElapsedMs(dependencies.clock.now(), startedAt);
    }
    if (state === 'STARTING') state = 'SCANNING';
    notifyState();
  };

  const handleDecoderEvent: CameraDecoderCallback = (result, error, callbackControls) => {
    if (state === 'CLOSED') {
      safeStopControls(callbackControls);
      return;
    }

    controls = callbackControls;
    markCameraReady();

    if (result) {
      try {
        const elapsedMs = toElapsedMs(dependencies.clock.now(), startedAt ?? dependencies.clock.now());
        if (firstCandidateMs === null) {
          firstCandidateMs = elapsedMs;
          notifyState();
        }

        const decision = options.onCandidate({
          value: result.getText(),
          symbology: toSymbology(result.getBarcodeFormat()),
          elapsedMs,
        });
        if (decision !== 'CONTINUE') close('SUCCESS');
      } catch {
        close('DECODER_ERROR');
      }
      return;
    }

    if (error && !isRecoverableDecodeMiss(error)) {
      close(mapCaptureError(error));
    }
  };

  const start = () => {
    if (startPromise) return startPromise;
    if (state === 'CLOSED') return Promise.resolve(getSnapshot());

    startPromise = (async () => {
      state = 'STARTING';
      startedAt = dependencies.clock.now();
      notifyState();

      if (!dependencies.isSecureContext()) {
        return close('INSECURE_CONTEXT');
      }

      try {
        unsubscribeEvents = dependencies.events.subscribe({
          visibilityChanged: (hidden) => {
            if (hidden) close('BACKGROUND');
          },
          pageHidden: () => close('PAGEHIDE'),
          beforeUnload: () => close('BEFOREUNLOAD'),
        });
        timeoutHandle = dependencies.clock.setTimeout(() => close('TIMEOUT'), timeoutMs);

        const resolvedControls = await dependencies.decoder.decodeFromConstraints(
          {
            audio: CAMERA_MEDIA_CONSTRAINTS.audio,
            video: { facingMode: { ideal: 'environment' } },
          },
          options.video,
          handleDecoderEvent,
        );

        if (getSnapshot().state === 'CLOSED') {
          releaseMedia(resolvedControls);
          return getSnapshot();
        }

        controls = resolvedControls;
        markCameraReady();
      } catch (error) {
        if (getSnapshot().state !== 'CLOSED') close(mapCaptureError(error));
      }

      return getSnapshot();
    })();

    return startPromise;
  };

  return {
    start,
    stop: () => close('STOPPED'),
    getSnapshot,
  };
}
