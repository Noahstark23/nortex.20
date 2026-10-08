// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NotFoundException, Result } from '@zxing/library';
import { CameraFrameReader } from '../utils/cameraFrameReader';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
function fixture() {
    const video = document.createElement('video');
    let width = 640, height = 480, ready = 2;
    Object.defineProperties(video, { videoWidth: { get: () => width }, videoHeight: { get: () => height }, readyState: { get: () => ready } });
    const context = { drawImage: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const reader = new CameraFrameReader();
    const decode = vi.spyOn(reader, 'decodeFromCanvas').mockImplementation(() => { throw new NotFoundException(); });
    const callback = vi.fn(), finalize = vi.fn();
    return { video, context, reader, decode, callback, finalize,
        dimensions: (w: number, h: number, r = 2) => { width = w; height = h; ready = r; } };
}
it('redimensiona la captura cuando cambia el video y conserva el código completo', async () => {
    const f = fixture();
    const sizes: number[][] = [];
    f.decode.mockImplementation(canvas => { sizes.push([canvas.width, canvas.height]); throw new NotFoundException(); });
    const controls = f.reader.scan(f.video, f.callback, f.finalize);
    f.dimensions(1280, 720);
    await vi.advanceTimersByTimeAsync(250);
    expect(sizes).toEqual([[640, 480], [1280, 720]]);
    expect(f.context.drawImage).toHaveBeenLastCalledWith(f.video, 0, 0, 1280, 720);
    controls.stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sizes).toHaveLength(2); expect(f.finalize).toHaveBeenCalledOnce();
});
it('espera dimensiones y fotogramas disponibles sin decodificar un canvas vacío', async () => {
    const f = fixture(); f.dimensions(0, 0, 1);
    const controls = f.reader.scan(f.video, f.callback, f.finalize);
    expect(f.decode).not.toHaveBeenCalled();
    f.dimensions(720, 1280);
    await vi.advanceTimersByTimeAsync(250);
    expect(f.decode).toHaveBeenCalledOnce();
    controls.stop();
});
it('un video sin fotogramas produce error y termina, no queda en silencio', async () => {
    const f = fixture(); f.dimensions(0, 0, 1);
    f.reader.scan(f.video, f.callback, f.finalize);
    await vi.advanceTimersByTimeAsync(5250);
    expect(f.callback).toHaveBeenCalledExactlyOnceWith(undefined, expect.objectContaining({ message: 'La cámara no entrega fotogramas.' }), expect.any(Object));
    expect(f.finalize).toHaveBeenCalledOnce();
    expect(f.decode).not.toHaveBeenCalled();
});
it('detener desde una lectura no agenda más capturas ni finaliza dos veces', async () => {
    const f = fixture(); const result = { getText: () => '0012345678905' } as Result;
    f.decode.mockReturnValue(result);
    const accept = vi.fn((_result, _error, controls) => controls.stop());
    const controls = f.reader.scan(f.video, accept, f.finalize);
    controls.stop(); await vi.advanceTimersByTimeAsync(1000);
    expect(accept).toHaveBeenCalledOnce(); expect(f.finalize).toHaveBeenCalledOnce();
});
