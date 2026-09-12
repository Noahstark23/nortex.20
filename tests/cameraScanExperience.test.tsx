// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { CameraScanButton } from '../components/ui/CameraScanButton';
const camera = vi.hoisted(() => ({ stop: vi.fn(), code: null as null | ((code: string) => void), error: null as null | ((error: string) => void), start: vi.fn() }));
vi.mock('../utils/cameraBarcode', () => ({ startCameraBarcode: (_video: unknown, code: (code: string) => void, error: (error: string) => void) => {
    camera.start(); camera.code = code; camera.error = error; return { stop: camera.stop, ready: Promise.resolve() };
} }));
beforeEach(() => { localStorage.setItem('nortex_token', 'qa-only'); camera.start.mockClear(); camera.stop.mockClear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });
const open = (onCode = vi.fn()) => { render(<CameraScanButton onCode={onCode}/>); fireEvent.click(screen.getByRole('button', { name: 'Escanear con cámara' })); return onCode; };
describe('cámara como lector accesible', () => {
    it('solo abre por acción explícita y libera al cerrar', () => {
        render(<CameraScanButton onCode={vi.fn()}/>); expect(camera.start).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Escanear con cámara' })); expect(camera.start).toHaveBeenCalledOnce();
        fireEvent.click(screen.getByRole('button', { name: 'Cerrar cámara' })); expect(camera.stop).toHaveBeenCalled();
        expect(document.querySelector('[data-camera-scanner]')).toBeNull();
    });
    it('un fotograma repetido mientras busca entrega solo un código', async () => {
        let finish!: () => void;
        const onCode = vi.fn(() => new Promise<void>(resolve => { finish = resolve; })); open(onCode);
        act(() => { camera.code!('0012345678905'); camera.code!('0012345678905'); });
        expect(onCode).toHaveBeenCalledExactlyOnceWith('0012345678905');
        await act(async () => { finish(); });
        expect(document.querySelector('[data-camera-scanner]')).toBeNull();
    });
    it('un permiso denegado conserva ingreso manual; no confunde error de búsqueda con ausencia', async () => {
        const onCode = vi.fn().mockRejectedValue(new Error('No pudimos comprobar el código.'));
        open(onCode); act(() => { camera.error!('Permití usar la cámara'); });
        fireEvent.change(screen.getByRole('textbox', { name: 'Código de barras manual' }), { target: { value: 'ABC-1' } });
        fireEvent.click(screen.getByRole('button', { name: 'Usar código' }));
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('No pudimos comprobar'));
        expect(onCode).toHaveBeenCalledExactlyOnceWith('ABC-1'); expect(camera.stop).toHaveBeenCalled();
    });
    it('pausa al ocultarse y requiere acción para reabrir', () => {
        open(); Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        fireEvent(document, new Event('visibilitychange')); expect(camera.stop).toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent('Cámara pausada');
        fireEvent.click(screen.getByRole('button', { name: 'Reintentar cámara' })); expect(camera.start).toHaveBeenCalledTimes(2);
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    });
    it('descarta una captura si cambió la sesión', () => {
        const onCode = open(); localStorage.setItem('nortex_token', 'other-qa');
        act(() => { camera.code!('ABC-1'); }); expect(onCode).not.toHaveBeenCalled();
        expect(camera.stop).toHaveBeenCalled();
    });
    it('solo ofrece alta explícita ante ausencia confirmada y conserva el código', async () => {
        const create = vi.fn();
        render(<CameraScanButton onCreateProduct={create} onCode={async () => { throw Object.assign(new Error('Código no registrado'), { code: 'PRODUCT_NOT_FOUND' }); }}/>);
        fireEvent.click(screen.getByRole('button', { name: 'Escanear con cámara' }));
        await act(async () => { camera.code!('0012345678905'); });
        expect(create).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Crear producto con código 0012345678905' }));
        expect(create).toHaveBeenCalledExactlyOnceWith('0012345678905');
    });
});
