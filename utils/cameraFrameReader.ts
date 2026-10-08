import { BrowserMultiFormatReader } from '@zxing/browser';
import { BinaryBitmap, HybridBinarizer, RGBLuminanceSource, Result } from '@zxing/library';

/** Rotación con dimensiones coherentes, también para video vertical no cuadrado. */
export class CameraLuminanceSource extends RGBLuminanceSource {
    isRotateSupported() { return true; }
    rotateCounterClockwise(): CameraLuminanceSource {
        const width = this.getWidth(), height = this.getHeight(), input = this.getMatrix();
        const rotated = new Uint8ClampedArray(width * height);
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            rotated[(width - 1 - x) * height + y] = input[y * width + x];
        }
        return new CameraLuminanceSource(rotated, height, width);
    }
}

export function isCameraDecodeMiss(error: unknown): boolean {
    const candidate = error as { getKind?: () => string } | null;
    const kind = typeof candidate?.getKind === 'function' ? candidate.getKind() : undefined;
    return kind === 'NotFoundException' || kind === 'ChecksumException' || kind === 'FormatException';
}

type ScanArguments = Parameters<BrowserMultiFormatReader['scan']>;
/** Conserva permisos/playback de ZXing, pero toma el tamaño de cada fotograma. */
export class CameraFrameReader extends BrowserMultiFormatReader {
    decodeFromCanvas(canvas: HTMLCanvasElement): Result {
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('No se pudo leer el fotograma de la cámara.');
        const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const luminance = new Uint8ClampedArray(canvas.width * canvas.height);
        for (let i = 0; i < luminance.length; i++) {
            const p = i * 4;
            luminance[i] = rgba[p + 3] === 0 ? 255 : (306 * rgba[p] + 601 * rgba[p + 1] + 117 * rgba[p + 2] + 512) >> 10;
        }
        return this.decodeBitmap(new BinaryBitmap(new HybridBinarizer(new CameraLuminanceSource(luminance, canvas.width, canvas.height))));
    }

    scan(element: ScanArguments[0], callback: ScanArguments[1], finalize?: ScanArguments[2]): ReturnType<BrowserMultiFormatReader['scan']> {
        const canvas = element.ownerDocument.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('No se pudo iniciar el lector de cámara.');
        let stopped = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let lastFrameAt = Date.now();
        const controls = { stop: () => {
            if (stopped) return;
            stopped = true; clearTimeout(timer); finalize?.();
            canvas.width = 0; canvas.height = 0;
        } };
        const loop = () => {
            if (stopped) return;
            try {
                const video = element instanceof HTMLVideoElement;
                const width = video ? element.videoWidth : (element as HTMLImageElement).naturalWidth;
                const height = video ? element.videoHeight : (element as HTMLImageElement).naturalHeight;
                if (!width || !height || (video && element.readyState < 2)) {
                    if (Date.now() - lastFrameAt >= 5000) throw new Error('La cámara no entrega fotogramas.');
                } else {
                    lastFrameAt = Date.now();
                    if (canvas.width !== width) canvas.width = width;
                    if (canvas.height !== height) canvas.height = height;
                    context.drawImage(element, 0, 0, width, height);
                    callback(this.decodeFromCanvas(canvas), undefined, controls);
                }
            } catch (error) {
                callback(undefined, error, controls);
                if (!isCameraDecodeMiss(error)) controls.stop();
            }
            if (!stopped) timer = setTimeout(loop, 250);
        };
        loop();
        return controls;
    }
}
