import React, { useRef, useState } from 'react';
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

const ImageUploader: React.FC<ImageUploaderProps> = ({ value, onChange, disabled = false }) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const [uploadState, setUploadState] = useState<UploadState>('idle');
    const [errorMsg, setErrorMsg] = useState('');
    const [localPreview, setLocalPreview] = useState('');

    const handleFile = async (file: File) => {
        if (!file.type.startsWith('image/')) {
            setErrorMsg('Solo se aceptan imágenes (JPG, PNG, WEBP).');
            setUploadState('error');
            return;
        }

        setErrorMsg('');
        setUploadState('compressing');

        // Mostrar preview local inmediatamente mientras se procesa
        const previewUrl = URL.createObjectURL(file);
        setLocalPreview(previewUrl);

        try {
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

            const data: { secure_url: string } = await res.json();

            // 3️⃣ Guardar solo la URL en el estado del formulario padre
            onChange(data.secure_url);
            setUploadState('done');
        } catch (err) {
            console.error('Image upload error:', err);
            setErrorMsg('Error al subir la imagen. Intenta de nuevo.');
            setUploadState('error');
            setLocalPreview('');
            onChange('');
        } finally {
            URL.revokeObjectURL(previewUrl);
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) handleFile(file);
        // Resetear el input para permitir subir el mismo archivo de nuevo
        e.target.value = '';
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
    };

    const handleRemove = () => {
        onChange('');
        setLocalPreview('');
        setUploadState('idle');
        setErrorMsg('');
    };

    const displayImage = value || localPreview;
    const isLoading = uploadState === 'compressing' || uploadState === 'uploading';

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

            {displayImage ? (
                /* ── Vista previa con overlay de estado ── */
                <div className="relative w-full aspect-video rounded-xl overflow-hidden border border-slate-600 bg-slate-900">
                    <img
                        src={displayImage}
                        alt="Foto del producto"
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
                            className="absolute top-2 right-2 p-1.5 bg-red-600/90 hover:bg-red-500 text-white rounded-lg transition-colors"
                            title="Quitar imagen"
                        >
                            <X size={14} />
                        </button>
                    )}

                    {/* Botón cambiar foto */}
                    {!isLoading && (
                        <button
                            type="button"
                            onClick={() => inputRef.current?.click()}
                            className="absolute bottom-2 right-2 flex items-center gap-1.5 bg-slate-800/90 hover:bg-slate-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
                        >
                            <Camera size={12} /> Cambiar foto
                        </button>
                    )}
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
                <div className="mt-2 flex items-center gap-2 text-red-400 text-xs bg-red-950/40 border border-red-800/50 rounded-lg px-3 py-2">
                    <AlertCircle size={14} className="flex-shrink-0" />
                    {errorMsg}
                </div>
            )}
        </div>
    );
};

export default ImageUploader;
