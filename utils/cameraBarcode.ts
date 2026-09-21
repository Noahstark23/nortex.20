import { openBarcodeCamera, focusBarcodeCamera } from './barcodeCameraStream';
/** Captura local de un código. No conoce productos, red, ventas ni existencias. */
export interface BarcodeReader {
    decodeFromStream(stream: MediaStream, video: HTMLVideoElement,
        callback: (result: { getText(): string } | undefined, error: unknown, controls: { stop(): void }) => void): Promise<{ stop(): void }>;
}
export interface CameraDependencies {
    getStream: () => Promise<MediaStream>;
    reader: () => Promise<BarcodeReader>;
    secure: () => boolean;
}
export async function createCameraReader() {
    const [{ CameraFrameReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import('./cameraFrameReader'), import('@zxing/library')]);
    // Sin TRY_HARDER, ZXing sólo revisa el centro y no intenta rotar códigos 1D.
    return new CameraFrameReader(new Map<import('@zxing/library').DecodeHintType, unknown>([
        [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A,
            BarcodeFormat.UPC_E, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39]],
        [DecodeHintType.TRY_HARDER, true],
    ]));
}

function isDecodeMiss(error: unknown): boolean {
    // getKind permanece estable en el bundle minificado; constructor.name no.
    const candidate = error as { getKind?: () => string } | null;
    const kind = typeof candidate?.getKind === 'function' ? candidate.getKind() : undefined;
    return kind === 'NotFoundException' || kind === 'ChecksumException' || kind === 'FormatException';
}

const defaults: CameraDependencies = {
    secure: () => globalThis.isSecureContext === true && !!navigator.mediaDevices?.getUserMedia,
    getStream: openBarcodeCamera,
    reader: createCameraReader,
};
export function cameraErrorMessage(error: unknown): string {
    const name = (error as { name?: string })?.name;
    if (name === 'NotAllowedError') return 'Permití usar la cámara en tu navegador y volvé a intentar. También podés escribir el código.';
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No encontramos una cámara disponible. Podés escribir el código.';
    if (name === 'NotReadableError') return 'Otra aplicación está usando la cámara. Cerrala y reintentá.';
    return 'No pudimos iniciar el lector. Reintentá o escribí el código.';
}
export function startCameraBarcode(video: HTMLVideoElement, onCode: (code: string) => void,
    onError: (message: string) => void, dependencies: CameraDependencies = defaults, shouldAccept: (code: string) => boolean = () => true, onHint?: (message: string) => void) {
    let closed = false;
    let hintTimer: ReturnType<typeof setTimeout> | undefined;
    let stream: MediaStream | undefined;
    let controls: { stop(): void } | undefined;
    const stop = () => {
        closed = true;
        clearTimeout(hintTimer);
        try { controls?.stop(); } catch { /* Continuar liberando los tracks propios. */ }
        stream?.getTracks().forEach(track => { try { track.stop(); } catch { /* Continuar. */ } });
        if (video.srcObject === stream) video.srcObject = null;
    };
    const ready = (async () => {
        if (!dependencies.secure()) {
            stop(); onError('La cámara necesita una conexión segura (HTTPS). Podés escribir el código.'); return;
        }
        try {
            const reader = await dependencies.reader();
            if (closed) return;
            stream = await dependencies.getStream();
            if (closed) { stop(); return; }
            await focusBarcodeCamera(stream);
            if (closed) { stop(); return; }
            const loaded = await reader.decodeFromStream(stream, video, (result, error, current) => {
                if (closed) { current.stop(); return; }
                controls = current;
                if (!result) {
                    // ZXing detiene su bucle ante un error fatal: no dejar la UI esperando.
                    if (error && !isDecodeMiss(error)) { stop(); onError(cameraErrorMessage(error)); }
                    return;
                }
                const code = result.getText().trim();
                if (!code || code.length > 100 || /[\u0000-\u001f\u007f]/u.test(code)) return;
                if (!shouldAccept(code)) return;
                stop(); // Una imagen repetida jamás agrega otra unidad.
                onCode(code);
            });
            if (closed) loaded.stop(); else {
                controls = loaded;
                if (onHint) hintTimer = setTimeout(() => {
                    if (!closed) onHint('Todavía no leímos el código. Alejá un poco el celular hasta que las barras se vean nítidas, evitá reflejos y mantené el código completo a la vista.');
                }, 8000);
            }
        } catch (error) {
            if (!closed) { stop(); onError(cameraErrorMessage(error)); }
        }
    })();
    return { stop, ready };
}
