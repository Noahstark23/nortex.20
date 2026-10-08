import { expect, it, vi } from 'vitest';
import { openBarcodeCamera, focusBarcodeCamera } from '../utils/barcodeCameraStream';

it('solicita cámara trasera HD como preferencia, sin excluir teléfonos de menor resolución', async () => {
    const stream = {} as MediaStream;
    const getUserMedia = vi.fn(async () => stream);
    expect(await openBarcodeCamera({ getUserMedia })).toBe(stream);
    expect(getUserMedia).toHaveBeenCalledWith({ audio: false, video: {
        facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 },
    } });
});
it('activa enfoque continuo conservando las restricciones de captura cuando está disponible', async () => {
    const track = { readyState: 'live', getCapabilities: () => ({ focusMode: ['manual', 'continuous'] }),
        getConstraints: () => ({ width: { ideal: 1280 } }), applyConstraints: vi.fn(async () => {}) };
    await focusBarcodeCamera({ getVideoTracks: () => [track] } as unknown as MediaStream);
    expect(track.applyConstraints).toHaveBeenCalledWith({ width: { ideal: 1280 }, advanced: [{ focusMode: 'continuous' }] });
});
it('no bloquea la lectura si el navegador no expone enfoque o rechaza ajustarlo', async () => {
    const applyConstraints = vi.fn(async () => { throw new Error('No soportado'); });
    const track = { readyState: 'live', getCapabilities: () => ({}), getConstraints: () => ({}), applyConstraints };
    await focusBarcodeCamera({ getVideoTracks: () => [track] } as unknown as MediaStream);
    expect(applyConstraints).not.toHaveBeenCalled();
    track.getCapabilities = () => ({ focusMode: ['continuous'] });
    await expect(focusBarcodeCamera({ getVideoTracks: () => [track] } as unknown as MediaStream)).resolves.toBeUndefined();
});
