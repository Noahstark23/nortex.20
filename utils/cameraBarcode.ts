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
const defaults: CameraDependencies = {
    secure: () => globalThis.isSecureContext === true && !!navigator.mediaDevices?.getUserMedia,
    getStream: () => navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } }),
    reader: async () => {
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import('@zxing/browser'), import('@zxing/library')]);
        return new BrowserMultiFormatReader(new Map([[DecodeHintType.POSSIBLE_FORMATS,
            [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39]]]));
    },
};
export function cameraErrorMessage(error: unknown): string {
    const name = (error as { name?: string })?.name;
    if (name === 'NotAllowedError') return 'Permití usar la cámara en tu navegador y volvé a intentar. También podés escribir el código.';
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No encontramos una cámara disponible. Podés escribir el código.';
    if (name === 'NotReadableError') return 'Otra aplicación está usando la cámara. Cerrala y reintentá.';
    return 'No pudimos iniciar el lector. Reintentá o escribí el código.';
}
export function startCameraBarcode(video: HTMLVideoElement, onCode: (code: string) => void,
    onError: (message: string) => void, dependencies: CameraDependencies = defaults) {
    let closed = false;
    let stream: MediaStream | undefined;
    let controls: { stop(): void } | undefined;
    const stop = () => {
        closed = true;
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
            const loaded = await reader.decodeFromStream(stream, video, (result, _error, current) => {
                if (closed) { current.stop(); return; }
                controls = current;
                if (!result) return;
                const code = result.getText().trim();
                if (!code || code.length > 100 || /[\u0000-\u001f\u007f]/u.test(code)) return;
                stop(); // Una imagen repetida jamás agrega otra unidad.
                onCode(code);
            });
            if (closed) loaded.stop(); else controls = loaded;
        } catch (error) {
            if (!closed) { stop(); onError(cameraErrorMessage(error)); }
        }
    })();
    return { stop, ready };
}
