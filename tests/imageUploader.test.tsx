// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
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
    it('acepta únicamente URLs HTTPS absolutas', () => {
        expect(getValidHttpsImageUrl(' https://res.cloudinary.com/demo/image/upload/foto.webp '))
            .toBe('https://res.cloudinary.com/demo/image/upload/foto.webp');
        expect(getValidHttpsImageUrl('http://res.cloudinary.com/foto.webp')).toBeNull();
        expect(getValidHttpsImageUrl('/foto.webp')).toBeNull();
        expect(getValidHttpsImageUrl('no-es-una-url')).toBeNull();
        expect(getValidHttpsImageUrl({ secure_url: 'https://example.com/foto.webp' })).toBeNull();
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
            json: async () => ({ secure_url: 'https://res.cloudinary.com/demo/producto.webp' }),
        } as Response);
        vi.stubGlobal('fetch', fetchMock);

        const onChange = vi.fn();
        const { container } = render(
            <ImageUploader value="https://res.cloudinary.com/demo/anterior.webp" onChange={onChange} />,
        );

        chooseFile(container, file);

        expect(await screen.findByRole('alert')).toHaveTextContent('Tu foto anterior se conserva');
        expect(onChange).not.toHaveBeenCalled();
        expect(screen.getByAltText('Foto del producto')).toHaveAttribute(
            'src',
            'https://res.cloudinary.com/demo/anterior.webp',
        );
        expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:nortex-preview-1');

        fireEvent.click(screen.getByRole('button', { name: 'Reintentar subida' }));

        await waitFor(() => {
            expect(onChange).toHaveBeenCalledWith('https://res.cloudinary.com/demo/producto.webp');
        });
        expect(compressionMock).toHaveBeenCalledTimes(2);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:nortex-preview-2');
    });

    it('rechaza una secure_url no HTTPS sin reemplazar ni borrar la foto guardada', async () => {
        const file = new File(['foto'], 'producto.png', { type: 'image/png' });
        compressionMock.mockResolvedValue(file);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ secure_url: 'http://res.cloudinary.com/demo/insegura.png' }),
        } as Response));

        const onChange = vi.fn();
        const { container } = render(
            <ImageUploader value="https://res.cloudinary.com/demo/anterior.png" onChange={onChange} />,
        );

        chooseFile(container, file);

        expect(await screen.findByRole('alert')).toHaveTextContent('Tu foto anterior se conserva');
        expect(onChange).not.toHaveBeenCalled();
        expect(screen.getByAltText('Foto del producto')).toHaveAttribute(
            'src',
            'https://res.cloudinary.com/demo/anterior.png',
        );

        fireEvent.click(screen.getByRole('button', { name: 'Quitar imagen' }));
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith('');
    });

    it('reemplaza una vista rota por controles claros sin modificar el valor', () => {
        const onChange = vi.fn();
        render(<ImageUploader value="https://images.example.test/rota.webp" onChange={onChange} />);

        fireEvent.error(screen.getByAltText('Foto del producto'));

        expect(screen.queryByAltText('Foto del producto')).toBeNull();
        expect(screen.getByText('La imagen no está disponible')).toBeTruthy();
        expect(screen.getByRole('alert')).toHaveTextContent('No pudimos mostrar esta imagen');
        expect(onChange).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Reintentar imagen' }));
        expect(screen.getByAltText('Foto del producto')).toHaveAttribute(
            'src',
            'https://images.example.test/rota.webp',
        );
        expect(onChange).not.toHaveBeenCalled();
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
