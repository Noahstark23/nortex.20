import React, { useCallback, useEffect, useRef, useState } from 'react';
import imageCompression from 'browser-image-compression';
import { Camera, X, Upload, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';

// ── Cloudinary config ──────────────────────────────────────────────────────
const CLOUDINARY_CLOUD_NAME = 'dex1vy92h';
const CLOUDINARY_UPLOAD_PRESET = 'nortex_catalog';

const CLOUDINARY_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

interface ImageUploaderProps {
    value: string;           // URL actual (vacío si no hay imagen)
    onChange: (url: string) => void;
    disabled?: boolean;
}

type UploadState = 'idle' | 'compressing' | 'uploading' | 'done' | 'error';

export const getValidHttpsImageUrl = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;

    const candidate = value.trim();
    if (!candidate) return null;

    try {
        const parsed = new URL(candidate);
        return parsed.protocol === 'https:' && Boolean(parsed.hostname) ? candidate : null;
    } catch {
        return null;
    }
};

const ImageUploader: React.FC<ImageUploaderProps> = ({ value, onChange, disabled = false }) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const previewObjectUrlRef = useRef<string | null>(null);
    const retryFileRef = useRef<File | null>(null);
    const uploadInFlightRef = useRef(false);
    const [uploadState, setUploadState] = useState<UploadState>('idle');
    const [errorMsg, setErrorMsg] = useState('');
    const [localPreview, setLocalPreview] = useState('');
    const [failedPreviewUrl, setFailedPreviewUrl] = useState('');

    const revokeLocalPreview = useCallback(() => {
        if (previewObjectUrlRef.current) {
            URL.revokeObjectURL(previewObjectUrlRef.current);
            previewObjectUrlRef.current = null;
        }
    }, []);

    const clearLocalPreview = useCallback(() => {
        revokeLocalPreview();
        setLocalPreview('');
    }, [revokeLocalPreview]);

    useEffect(() => () => {
        revokeLocalPreview();
    }, [revokeLocalPreview]);

    const handleFile = async (file: File) => {
        if (disabled || uploadInFlightRef.current) return;

        if (!file.type.startsWith('image/')) {
            retryFileRef.current = null;
            setErrorMsg('Solo se aceptan imágenes (JPG, PNG, WEBP).');
            setUploadState('error');
            return;
        }

        uploadInFlightRef.current = true;
        retryFileRef.current = file;
        setErrorMsg('');
        setFailedPreviewUrl('');
        setUploadState('compressing');

        try {
            // Mostrar preview local únicamente mientras se procesa. La URL se
            // revoca al terminar y la foto guardada sigue siendo `value` hasta
            // que Cloudinary confirme una nueva URL válida.
            revokeLocalPreview();
            const previewUrl = URL.createObjectURL(file);
            previewObjectUrlRef.current = previewUrl;
            setLocalPreview(previewUrl);

            // 1️⃣ Comprimir en cliente para ahorrar ancho de banda antes de subir.
            //    Cloudinary aplica f_auto + c_limit,w_800 en el preset — no duplicamos.
            const compressed = await imageCompression(file, {
                maxSizeMB: 0.29,       // < 300 KB
                maxWidthOrHeight: 800,
                useWebWorker: true,
            });

            setUploadState('uploading');

            // 2️⃣ Subir directamente a Cloudinary (Unsigned Upload)
            const formData = new FormData();
            formData.append('file', compressed);
            formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

            const res = await fetch(CLOUDINARY_URL, {
                method: 'POST',
                body: formData,
            });

            if (!res.ok) {
                throw new Error(`Cloudinary error ${res.status}`);
            }

            const data: unknown = await res.json();
            const secureUrl = getValidHttpsImageUrl(
                typeof data === 'object' && data !== null && 'secure_url' in data
                    ? (data as { secure_url?: unknown }).secure_url
                    : undefined,
            );

            if (!secureUrl) {
                throw new Error('Cloudinary devolvió una URL de imagen inválida');
            }

            // 3️⃣ Guardar solo la URL en el estado del formulario padre
            onChange(secureUrl);
            setUploadState('done');
        } catch (err) {
            console.error('Image upload error:', err);
            setErrorMsg(value
                ? 'No pudimos subir la imagen. Tu foto anterior se conserva.'
                : 'No pudimos subir la imagen. Podés reintentar con el mismo archivo.');
            setUploadState('error');
        } finally {
            uploadInFlightRef.current = false;
            clearLocalPreview();
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) void handleFile(file);
        // Resetear el input para permitir subir el mismo archivo de nuevo
        e.target.value = '';
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        if (disabled || uploadInFlightRef.current) return;
        const file = e.dataTransfer.files[0];
        if (file) void handleFile(file);
    };

    const handleRetry = () => {
        const file = retryFileRef.current;
        if (file) void handleFile(file);
    };

    const handleRemove = () => {
        if (disabled || uploadInFlightRef.current) return;

        retryFileRef.current = null;
        onChange('');
        clearLocalPreview();
        setFailedPreviewUrl('');
        setUploadState('idle');
        setErrorMsg('');
    };

    const displayImage = localPreview || value;
    const previewFailed = Boolean(displayImage && failedPreviewUrl === displayImage);
    const isLoading = uploadState === 'compressing' || uploadState === 'uploading';

    const handlePreviewError = () => {
        if (!displayImage) return;

        setFailedPreviewUrl(displayImage);
        setUploadState('error');
        setErrorMsg('No pudimos mostrar esta imagen. Podés reintentar o cambiarla.');
        if (displayImage === localPreview) clearLocalPreview();
    };

    const handlePreviewLoad = () => {
        if (displayImage === value && uploadState === 'done') {
            retryFileRef.current = null;
        }
    };

    return (
        <div className="w-full">
            <input
                ref={inputRef}
                type="file"
                accept="image/*"
                capture="environment"   // Abre cámara trasera en móvil
                className="hidden"
                onChange={handleInputChange}
                disabled={disabled || isLoading}
            />

            {displayImage && !previewFailed ? (
                /* ── Vista previa con overlay de estado ── */
                <div className="relative w-full aspect-video rounded-xl overflow-hidden border border-slate-600 bg-slate-900">
                    <img
                        src={displayImage}
                        alt="Foto del producto"
                        onError={handlePreviewError}
                        onLoad={handlePreviewLoad}
                        className={`w-full h-full object-cover transition-opacity duration-300 ${isLoading ? 'opacity-40' : 'opacity-100'}`}
                    />

                    {/* Overlay de carga */}
                    {isLoading && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-900/60">
                            <Loader2 className="animate-spin text-orange-400" size={28} />
                            <p className="text-sm font-semibold text-white">
                                {uploadState === 'compressing' ? 'Comprimiendo...' : 'Subiendo foto...'}
                            </p>
                        </div>
                    )}

                    {/* Badge de éxito */}
                    {uploadState === 'done' && (
                        <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-emerald-600 text-white text-xs font-bold px-2 py-1 rounded-lg">
                            <CheckCircle size={12} />
                            Subida
                        </div>
                    )}

                    {/* Botón quitar */}
                    {!isLoading && (
                        <button
                            type="button"
                            onClick={handleRemove}
                            disabled={disabled}
                            className="absolute top-2 right-2 p-1.5 bg-red-600/90 hover:bg-red-500 text-white rounded-lg transition-colors"
                            title="Quitar imagen"
                            aria-label="Quitar imagen"
                        >
                            <X size={14} />
                        </button>
                    )}

                    {/* Botón cambiar foto */}
                    {!isLoading && (
                        <button
                            type="button"
                            onClick={() => inputRef.current?.click()}
                            disabled={disabled}
                            className="absolute bottom-2 right-2 flex items-center gap-1.5 bg-slate-800/90 hover:bg-slate-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                        >
                            <Camera size={12} /> Cambiar foto
                        </button>
                    )}
                </div>
            ) : displayImage && previewFailed ? (
                <div className="w-full aspect-video rounded-xl border border-red-800/50 bg-slate-900 flex flex-col items-center justify-center gap-3 px-4 text-center">
                    <AlertCircle size={28} className="text-red-400" />
                    <p className="text-sm font-semibold text-slate-200">La imagen no está disponible</p>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => {
                                setFailedPreviewUrl('');
                                setErrorMsg('');
                                setUploadState('idle');
                            }}
                            disabled={disabled}
                            className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-600 disabled:opacity-50"
                        >
                            Reintentar imagen
                        </button>
                        <button
                            type="button"
                            onClick={() => inputRef.current?.click()}
                            disabled={disabled}
                            className="rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-50"
                        >
                            Cambiar foto
                        </button>
                        <button
                            type="button"
                            onClick={handleRemove}
                            disabled={disabled}
                            className="rounded-lg bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-600 disabled:opacity-50"
                        >
                            Quitar imagen
                        </button>
                    </div>
                </div>
            ) : (
                /* ── Zona de drop / selección ── */
                <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    onDrop={handleDrop}
                    onDragOver={e => e.preventDefault()}
                    disabled={disabled || isLoading}
                    className="w-full border-2 border-dashed border-slate-600 hover:border-orange-500 rounded-xl p-6 flex flex-col items-center justify-center gap-2 text-slate-400 hover:text-orange-400 transition-all bg-slate-900/40 hover:bg-orange-500/5 group cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <div className="w-12 h-12 rounded-xl bg-slate-800 group-hover:bg-orange-500/10 flex items-center justify-center transition-colors">
                        <Camera size={24} className="group-hover:text-orange-400 transition-colors" />
                    </div>
                    <div className="text-center">
                        <p className="font-semibold text-sm">
                            <span className="text-orange-400">Subir foto</span> o arrastrar aquí
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                            JPG, PNG, WEBP · Se comprime a &lt;300 KB automáticamente
                        </p>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
                        <Upload size={12} />
                        <span>Toca para abrir cámara o galería</span>
                    </div>
                </button>
            )}

            {/* Error message */}
            {uploadState === 'error' && errorMsg && (
                <div role="alert" className="mt-2 flex items-center gap-2 text-red-400 text-xs bg-red-950/40 border border-red-800/50 rounded-lg px-3 py-2">
                    <AlertCircle size={14} className="flex-shrink-0" />
                    <span className="flex-1">{errorMsg}</span>
                    {retryFileRef.current && (
                        <button
                            type="button"
                            onClick={handleRetry}
                            disabled={disabled || isLoading}
                            className="rounded-md border border-red-700 px-2 py-1 font-semibold text-red-200 hover:bg-red-900/50 disabled:opacity-50"
                        >
                            Reintentar subida
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

export default ImageUploader;
