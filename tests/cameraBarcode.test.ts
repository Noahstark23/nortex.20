import { describe, expect, it, vi } from 'vitest';
import { startCameraBarcode, type CameraDependencies } from '../utils/cameraBarcode';

function fixture() {
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] } as unknown as MediaStream;
    const video = { srcObject: stream } as HTMLVideoElement;
    const controls = { stop: vi.fn() };
    let frame: Parameters<Awaited<ReturnType<CameraDependencies['reader']>>['decodeFromStream']>[2];
    const dependencies: CameraDependencies = { secure: () => true, getStream: vi.fn(async () => stream),
        reader: async () => ({ decodeFromStream: async (_stream, _video, callback) => { frame = callback; return controls; } }) };
    return { track, stream, video, controls, dependencies, detect: (text: string) => frame({ getText: () => text }, undefined, controls) };
}
describe('lector óptico: una captura, recursos propios', () => {
    it('entrega un código una sola vez y apaga cámara al detectar aunque se repita el fotograma', async () => {
        const f = fixture(), accept = vi.fn();
        const capture = startCameraBarcode(f.video, accept, vi.fn(), f.dependencies);
        await capture.ready;
        f.detect('7501234567890'); f.detect('7501234567890');
        expect(accept).toHaveBeenCalledExactlyOnceWith('7501234567890');
        expect(f.track.stop).toHaveBeenCalled(); expect(f.controls.stop).toHaveBeenCalled(); expect(f.video.srcObject).toBeNull();
    });
    it('libera una cámara cuyo permiso llega después de cerrar, sin decodificar', async () => {
        const f = fixture(); let resolve!: (stream: MediaStream) => void;
        f.dependencies.getStream = () => new Promise(done => { resolve = done; });
        const capture = startCameraBarcode(f.video, vi.fn(), vi.fn(), f.dependencies);
        await Promise.resolve(); capture.stop(); resolve(f.stream); await capture.ready;
        expect(f.track.stop).toHaveBeenCalled();
    });
    it('permiso denegado informa un error accionable sin emitir un producto', async () => {
        const f = fixture(), accept = vi.fn(), error = vi.fn();
        f.dependencies.getStream = async () => { throw { name: 'NotAllowedError' }; };
        await startCameraBarcode(f.video, accept, error, f.dependencies).ready;
        expect(accept).not.toHaveBeenCalled(); expect(error).toHaveBeenCalledWith(expect.stringContaining('Permití'));
    });
    it('HTTPS inválido no pide permiso ni abre cámara', async () => {
        const f = fixture(), error = vi.fn(); f.dependencies.secure = () => false;
        await startCameraBarcode(f.video, vi.fn(), error, f.dependencies).ready;
        expect(f.dependencies.getStream).not.toHaveBeenCalled(); expect(error).toHaveBeenCalledWith(expect.stringContaining('HTTPS'));
    });
    it('ignora códigos fuera del contrato y conserva ceros iniciales', async () => {
        const f = fixture(), accept = vi.fn(); await startCameraBarcode(f.video, accept, vi.fn(), f.dependencies).ready;
        f.detect('A\nB'); f.detect('x'.repeat(101)); expect(accept).not.toHaveBeenCalled();
        f.detect('0012345678905'); expect(accept).toHaveBeenCalledExactlyOnceWith('0012345678905');
    });
});
