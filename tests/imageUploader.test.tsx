// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import imageCompression from 'browser-image-compression';
import ImageUploader, { getValidHttpsImageUrl } from '../components/ImageUploader';

vi.mock('browser-image-compression', () => ({
    default: vi.fn(),
}));

const compressionMock = vi.mocked(imageCompression);
const createObjectURLMock = vi.fn<(file: Blob) => string>();
const revokeObjectURLMock = vi.fn<(url: string) => void>();

const chooseFile = (container: HTMLElement, file: File) => {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
};

beforeEach(() => {
    vi.clearAllMocks();
    compressionMock.mockReset();
    createObjectURLMock.mockReset();
    revokeObjectURLMock.mockReset();
    let previewNumber = 0;
    createObjectURLMock.mockImplementation(() => `blob:nortex-preview-${++previewNumber}`);
    Object.defineProperty(URL, 'createObjectURL', {
        value: createObjectURLMock,
        configurable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
        value: revokeObjectURLMock,
        configurable: true,
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('getValidHttpsImageUrl', () => {
    it('acepta únicamente HTTPS del host Cloudinary exacto y sin credenciales', () => {
        expect(getValidHttpsImageUrl(' https://res.cloudinary.com/dex1vy92h/image/upload/foto.webp '))
            .toBe('https://res.cloudinary.com/dex1vy92h/image/upload/foto.webp');
        expect(getValidHttpsImageUrl('https://res.cloudinary.com:443/dex1vy92h/image/upload/foto.webp'))
            .toBe('https://res.cloudinary.com/dex1vy92h/image/upload/foto.webp');
        expect(getValidHttpsImageUrl('http://res.cloudinary.com/foto.webp')).toBeNull();
        expect(getValidHttpsImageUrl('https://images.example.test/foto.webp')).toBeNull();
        expect(getValidHttpsImageUrl('https://res.cloudinary.com.ejemplo.test/foto.webp')).toBeNull();
        expect(getValidHttpsImageUrl('https://usuario:clave@res.cloudinary.com/foto.webp')).toBeNull();
        expect(getValidHttpsImageUrl('https://res.cloudinary.com:8443/foto.webp')).toBeNull();
        expect(getValidHttpsImageUrl('https://res.cloudinary.com./foto.webp')).toBeNull();
        expect(getValidHttpsImageUrl('https://res.cloudinary.com/otro/image/upload/foto.webp')).toBeNull();
        expect(getValidHttpsImageUrl(
            'https://res.cloudinary.com/dex1vy92h/image/fetch/https://legacy.example.test/foto.webp',
        )).toBeNull();
        expect(getValidHttpsImageUrl(
            'https://res.cloudinary.com/dex1vy92h/image/upload/l_fetch:aHR0cHM6Ly9ldmls/foto.webp',
        )).toBeNull();
        expect(getValidHttpsImageUrl(
            'https://res.cloudinary.com/dex1vy92h/image/upload/l_%2566etch:aHR0cHM6Ly9ldmls/foto.webp',
        )).toBeNull();
        expect(getValidHttpsImageUrl('/foto.webp')).toBeNull();
        expect(getValidHttpsImageUrl('no-es-una-url')).toBeNull();
        expect(getValidHttpsImageUrl({ secure_url: 'https://example.com/foto.webp' })).toBeNull();
        expect(getValidHttpsImageUrl(
            `https://res.cloudinary.com/dex1vy92h/image/upload/${'a'.repeat(2_000)}`,
        )).toBeNull();
    });
});

describe('ImageUploader', () => {
    it('conserva la foto anterior cuando falla y permite reintentar el mismo archivo', async () => {
        const file = new File(['foto'], 'producto.webp', { type: 'image/webp' });
        const compressed = new File(['comprimida'], 'producto.webp', { type: 'image/webp' });
        compressionMock
            .mockRejectedValueOnce(new Error('falló la compresión'))
            .mockResolvedValueOnce(compressed);

        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ secure_url: 'https://res.cloudinary.com/dex1vy92h/image/upload/producto.webp' }),
        } as Response);
        vi.stubGlobal('fetch', fetchMock);

        const onChange = vi.fn();
        const { container } = render(
            <ImageUploader value="https://res.cloudinary.com/dex1vy92h/image/upload/anterior.webp" onChange={onChange} />,
        );

        chooseFile(container, file);

        expect((await screen.findByRole('alert')).textContent).toContain('Tu foto anterior se conserva');
        expect(onChange).not.toHaveBeenCalled();
        expect(screen.getByAltText('Foto del producto').getAttribute('src'))
            .toBe('https://res.cloudinary.com/dex1vy92h/image/upload/anterior.webp');
        expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:nortex-preview-1');

        fireEvent.click(screen.getByRole('button', { name: 'Reintentar subida' }));

        await waitFor(() => {
            expect(onChange).toHaveBeenCalledWith('https://res.cloudinary.com/dex1vy92h/image/upload/producto.webp');
        });
        expect(compressionMock).toHaveBeenCalledTimes(2);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:nortex-preview-2');
    });

    it('rechaza una secure_url de un tercero sin reemplazar ni borrar la foto guardada', async () => {
        const file = new File(['foto'], 'producto.png', { type: 'image/png' });
        compressionMock.mockResolvedValue(file);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ secure_url: 'https://images.example.test/insegura.png' }),
        } as Response));

        const onChange = vi.fn();
        const { container } = render(
            <ImageUploader value="https://res.cloudinary.com/dex1vy92h/image/upload/anterior.png" onChange={onChange} />,
        );

        chooseFile(container, file);

        expect((await screen.findByRole('alert')).textContent).toContain('Tu foto anterior se conserva');
        expect(onChange).not.toHaveBeenCalled();
        expect(screen.getByAltText('Foto del producto').getAttribute('src'))
            .toBe('https://res.cloudinary.com/dex1vy92h/image/upload/anterior.png');

        fireEvent.click(screen.getByRole('button', { name: 'Quitar imagen' }));
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith('');
    });

    it('no solicita una foto legacy externa y ofrece reemplazarla o quitarla', () => {
        const onChange = vi.fn();
        render(<ImageUploader value="https://images.example.test/rota.webp" onChange={onChange} />);

        expect(screen.queryByAltText('Foto del producto')).toBeNull();
        expect(document.querySelector('img')).toBeNull();
        expect(screen.getByText('La imagen anterior usa un proveedor no autorizado')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Reintentar imagen' })).toBeNull();
        expect(onChange).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Quitar imagen' }));
        expect(onChange).toHaveBeenCalledOnce();
        expect(onChange).toHaveBeenCalledWith('');
    });

    it('revoca la vista temporal al desmontarse durante la compresión', async () => {
        const file = new File(['foto'], 'producto.jpg', { type: 'image/jpeg' });
        compressionMock.mockImplementation(() => new Promise(() => undefined));

        const { container, unmount } = render(<ImageUploader value="" onChange={vi.fn()} />);
        chooseFile(container, file);

        expect(await screen.findByText('Comprimiendo...')).toBeTruthy();
        unmount();

        expect(revokeObjectURLMock).toHaveBeenCalledTimes(1);
        expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:nortex-preview-1');
    });
});
