// @vitest-environment jsdom

import {
  BarcodeFormat,
  ChecksumException,
  FormatException,
  NotFoundException,
} from '@zxing/library';
import { describe, expect, it, vi } from 'vitest';
import {
  CAMERA_BARCODE_FORMATS,
  createCameraCapture,
  type CameraCaptureClock,
  type CameraCaptureCloseReason,
  type CameraCaptureEventSource,
  type CameraCaptureLifecycleHandlers,
  type CameraDecoder,
  type CameraDecoderCallback,
  type CameraScannerControls,
} from '../tools/camera-barcode-phase0/capture';

interface TestHarness {
  capture: ReturnType<typeof createCameraCapture>;
  clock: CameraCaptureClock & { currentMs: number; fireTimer(): void };
  controls: CameraScannerControls & { stop: ReturnType<typeof vi.fn> };
  decoder: CameraDecoder & {
    decodeFromConstraints: ReturnType<typeof vi.fn>;
    emit(result: TestResult | undefined, error?: unknown): void;
  };
  events: CameraCaptureEventSource & {
    handlers: CameraCaptureLifecycleHandlers | null;
    unsubscribe: ReturnType<typeof vi.fn>;
  };
  releaseAllStreams: ReturnType<typeof vi.fn>;
  trackStop: ReturnType<typeof vi.fn>;
  onCandidate: ReturnType<typeof vi.fn>;
}

interface TestResult {
  getText(): string;
  getBarcodeFormat(): BarcodeFormat;
}

function result(value: string, format: BarcodeFormat): TestResult {
  return {
    getText: () => value,
    getBarcodeFormat: () => format,
  };
}

function createHarness(options: {
  secure?: boolean;
  decoderRejection?: unknown;
  candidateDecision?: 'ACCEPT' | 'CONTINUE';
} = {}): TestHarness {
  let decoderCallback: CameraDecoderCallback | null = null;
  let timerCallback: (() => void) | null = null;

  const clock: TestHarness['clock'] = {
    currentMs: 1_000,
    now() {
      return this.currentMs;
    },
    setTimeout: vi.fn((callback: () => void) => {
      timerCallback = callback;
      return 42;
    }),
    clearTimeout: vi.fn(() => {
      timerCallback = null;
    }),
    fireTimer() {
      const callback = timerCallback;
      timerCallback = null;
      callback?.();
    },
  };

  const controls: TestHarness['controls'] = { stop: vi.fn<() => void>() };
  const trackStop = vi.fn();
  const stream = { getTracks: () => [{ stop: trackStop }] } as unknown as MediaStream;
  const video = document.createElement('video');

  const decodeFromConstraints = vi.fn(
    async (
      _constraints: MediaStreamConstraints,
      targetVideo: HTMLVideoElement,
      callback: CameraDecoderCallback,
    ) => {
      decoderCallback = callback;
      targetVideo.srcObject = stream;
      if (options.decoderRejection) throw options.decoderRejection;
      return controls;
    },
  );

  const decoder: TestHarness['decoder'] = {
    decodeFromConstraints,
    emit(decodedResult, error) {
      if (!decoderCallback) throw new Error('El decoder aun no fue iniciado');
      decoderCallback(decodedResult, error, controls);
    },
  };

  const events: TestHarness['events'] = {
    handlers: null,
    unsubscribe: vi.fn(),
    subscribe(handlers) {
      this.handlers = handlers;
      return this.unsubscribe;
    },
  };

  const releaseAllStreams = vi.fn();
  const onCandidate = vi.fn(() => options.candidateDecision ?? 'ACCEPT');
  const capture = createCameraCapture({
    video,
    timeoutMs: 5_000,
    onCandidate,
    dependencies: {
      decoder,
      clock,
      events,
      isSecureContext: () => options.secure ?? true,
      releaseAllStreams,
    },
  });

  return {
    capture,
    clock,
    controls,
    decoder,
    events,
    releaseAllStreams,
    trackStop,
    onCandidate,
  };
}

describe('Phase 0 camera capture', () => {
  it('limita ZXing a los cinco formatos aprobados y solicita la camara trasera', async () => {
    expect(CAMERA_BARCODE_FORMATS).toEqual([
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.CODE_128,
    ]);

    const harness = createHarness();
    const starting = harness.capture.start();
    harness.clock.currentMs = 1_080;
    await starting;

    expect(harness.decoder.decodeFromConstraints).toHaveBeenCalledTimes(1);
    expect(harness.decoder.decodeFromConstraints.mock.calls[0][0]).toEqual({
      audio: false,
      video: { facingMode: { ideal: 'environment' } },
    });
    expect(harness.capture.getSnapshot()).toEqual({
      state: 'SCANNING',
      closeReason: null,
      cameraReadyMs: 80,
      firstCandidateMs: null,
    });
  });

  it('ignora misses recuperables, entrega el valor solo al callback y cierra en exito', async () => {
    const harness = createHarness();
    const starting = harness.capture.start();
    harness.clock.currentMs = 1_040;
    await starting;

    harness.decoder.emit(undefined, NotFoundException.getNotFoundInstance());
    harness.decoder.emit(undefined, ChecksumException.getChecksumInstance());
    harness.decoder.emit(undefined, FormatException.getFormatInstance());
    expect(harness.capture.getSnapshot().state).toBe('SCANNING');

    harness.clock.currentMs = 1_430;
    harness.decoder.emit(result('0012345678905', BarcodeFormat.EAN_13));

    expect(harness.onCandidate).toHaveBeenCalledWith({
      value: '0012345678905',
      symbology: 'EAN_13',
      elapsedMs: 430,
    });
    expect(harness.capture.getSnapshot()).toEqual({
      state: 'CLOSED',
      closeReason: 'SUCCESS',
      cameraReadyMs: 40,
      firstCandidateMs: 430,
    });
    expect(JSON.stringify(harness.capture.getSnapshot())).not.toContain('0012345678905');
    expect(harness.controls.stop).toHaveBeenCalledTimes(1);
    expect(harness.trackStop).toHaveBeenCalledTimes(1);
    expect(harness.releaseAllStreams).toHaveBeenCalledTimes(1);
    expect(harness.clock.clearTimeout).toHaveBeenCalledWith(42);
    expect(harness.events.unsubscribe).toHaveBeenCalledTimes(1);

    harness.capture.stop();
    expect(harness.capture.getSnapshot().closeReason).toBe('SUCCESS');
    expect(harness.controls.stop).toHaveBeenCalledTimes(1);
    expect(harness.trackStop).toHaveBeenCalledTimes(1);
    expect(harness.releaseAllStreams).toHaveBeenCalledTimes(1);
  });

  it('conserva la primera latencia cuando el consumidor pide continuar', async () => {
    const harness = createHarness({ candidateDecision: 'CONTINUE' });
    await harness.capture.start();

    harness.clock.currentMs = 1_200;
    harness.decoder.emit(result('wrong', BarcodeFormat.CODE_128));
    harness.clock.currentMs = 1_600;
    harness.decoder.emit(result('right', BarcodeFormat.CODE_128));

    expect(harness.capture.getSnapshot()).toMatchObject({
      state: 'SCANNING',
      firstCandidateMs: 200,
    });
    expect(harness.onCandidate).toHaveBeenCalledTimes(2);

    harness.capture.stop();
    expect(harness.capture.getSnapshot().closeReason).toBe('STOPPED');
  });

  it.each([
    ['NotAllowedError', 'PERMISSION_DENIED'],
    ['SecurityError', 'PERMISSION_DENIED'],
    ['NotFoundError', 'CAMERA_NOT_FOUND'],
    ['OverconstrainedError', 'CAMERA_NOT_FOUND'],
    ['NotReadableError', 'CAMERA_NOT_READABLE'],
    ['AbortError', 'CAMERA_NOT_READABLE'],
  ] as const)('mapea %s sin filtrar detalles del error', async (errorName, expectedReason) => {
    const error = new DOMException('detalle sensible del navegador', errorName);
    const harness = createHarness({ decoderRejection: error });

    await harness.capture.start();

    expect(harness.capture.getSnapshot()).toEqual({
      state: 'CLOSED',
      closeReason: expectedReason,
      cameraReadyMs: null,
      firstCandidateMs: null,
    });
    expect(JSON.stringify(harness.capture.getSnapshot())).not.toContain(error.message);
    expect(harness.trackStop).toHaveBeenCalledTimes(1);
    expect(harness.releaseAllStreams).toHaveBeenCalledTimes(1);
  });

  it('rechaza contextos inseguros antes de solicitar la camara', async () => {
    const harness = createHarness({ secure: false });

    await harness.capture.start();

    expect(harness.capture.getSnapshot().closeReason).toBe('INSECURE_CONTEXT');
    expect(harness.decoder.decodeFromConstraints).not.toHaveBeenCalled();
    expect(harness.events.handlers).toBeNull();
    expect(harness.releaseAllStreams).toHaveBeenCalledTimes(1);
  });

  it('cierra como error de decoder ante un fallo fatal o una simbologia no permitida', async () => {
    const fatalHarness = createHarness();
    await fatalHarness.capture.start();
    fatalHarness.decoder.emit(undefined, new Error('canvas roto'));
    expect(fatalHarness.capture.getSnapshot().closeReason).toBe('DECODER_ERROR');

    const unsupportedHarness = createHarness();
    await unsupportedHarness.capture.start();
    unsupportedHarness.decoder.emit(result('qr', BarcodeFormat.QR_CODE));
    expect(unsupportedHarness.capture.getSnapshot().closeReason).toBe('DECODER_ERROR');
    expect(unsupportedHarness.onCandidate).not.toHaveBeenCalled();
  });

  it.each([
    ['BACKGROUND', (handlers: CameraCaptureLifecycleHandlers) => handlers.visibilityChanged(true)],
    ['PAGEHIDE', (handlers: CameraCaptureLifecycleHandlers) => handlers.pageHidden()],
    ['BEFOREUNLOAD', (handlers: CameraCaptureLifecycleHandlers) => handlers.beforeUnload()],
  ] as const)('libera recursos al cerrar por %s', async (reason, trigger) => {
    const harness = createHarness();
    await harness.capture.start();

    trigger(harness.events.handlers!);

    expect(harness.capture.getSnapshot().closeReason).toBe(reason);
    expect(harness.controls.stop).toHaveBeenCalledTimes(1);
    expect(harness.trackStop).toHaveBeenCalledTimes(1);
    expect(harness.releaseAllStreams).toHaveBeenCalledTimes(1);
    expect(harness.events.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('agota el timeout, limpia el timer y mantiene el primer motivo de cierre', async () => {
    const harness = createHarness();
    await harness.capture.start();

    harness.clock.fireTimer();
    expect(harness.capture.getSnapshot().closeReason).toBe('TIMEOUT');
    expect(harness.controls.stop).toHaveBeenCalledTimes(1);
    expect(harness.trackStop).toHaveBeenCalledTimes(1);
    expect(harness.releaseAllStreams).toHaveBeenCalledTimes(1);

    harness.events.handlers?.pageHidden();
    harness.capture.stop();
    expect(harness.capture.getSnapshot().closeReason).toBe('TIMEOUT');
    expect(harness.releaseAllStreams).toHaveBeenCalledTimes(1);
  });

  it.each([
    'PERMISSION_DENIED',
    'CAMERA_NOT_FOUND',
    'CAMERA_NOT_READABLE',
    'DECODER_ERROR',
  ] satisfies CameraCaptureCloseReason[])('nunca expone un error crudo para %s', (reason) => {
    expect(reason).not.toContain('Error:');
  });
});
