import { useState, type ImgHTMLAttributes, type ReactNode } from 'react';
import {
    normalizeAllowedProductImageUrl,
    PRODUCT_IMAGE_ALLOWED_HOST,
} from '../../utils/productImageUrl';

const CLOUDINARY_UPLOAD_SEGMENT = '/image/upload/';
const RESPONSIVE_WIDTHS = [160, 240, 480, 800] as const;
const CLOUDINARY_SIGNATURE_SEGMENT = /\/s--[^/]+--(?:\/|$)/;

const productInitials = (name: string): string => {
    const words = name.trim().toUpperCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '??';
    if (words.length === 1) return words[0].slice(0, 2);
    return `${words[0][0]}${words[1][0]}`;
};

/**
 * Crea variantes responsivas únicamente para URLs públicas y sin firma de
 * Cloudinary. Cualquier otro host se rechaza en la frontera compartida y no
 * recibe una solicitud del navegador.
 */
export const cloudinaryProductSrcSet = (source: string): string | undefined => {
    const normalizedSource = normalizeAllowedProductImageUrl(source);
    if (!normalizedSource) return undefined;

    try {
        const baseUrl = new URL(normalizedSource);
        const markerIndex = baseUrl.pathname.indexOf(CLOUDINARY_UPLOAD_SEGMENT);
        const deliveryPath = markerIndex >= 0
            ? baseUrl.pathname.slice(markerIndex + CLOUDINARY_UPLOAD_SEGMENT.length)
            : '';

        if (
            baseUrl.protocol !== 'https:'
            || baseUrl.hostname.toLowerCase() !== PRODUCT_IMAGE_ALLOWED_HOST
            || markerIndex < 0
            || !deliveryPath
            || CLOUDINARY_SIGNATURE_SEGMENT.test(baseUrl.pathname)
            || baseUrl.search.length > 0
            || baseUrl.username
            || baseUrl.password
        ) {
            return undefined;
        }

        const prefix = baseUrl.pathname.slice(0, markerIndex + CLOUDINARY_UPLOAD_SEGMENT.length);
        return RESPONSIVE_WIDTHS.map(width => {
            const variant = new URL(baseUrl.toString());
            variant.pathname = `${prefix}f_auto,q_auto,c_limit,w_${width}/${deliveryPath}`;
            return `${variant.toString()} ${width}w`;
        }).join(', ');
    } catch {
        return undefined;
    }
};

/**
 * Evita requests malformados, contenido mixto y destinos no autorizados.
 * Las rutas demo relativas y las fotos legacy externas caen al fallback.
 */
export const normalizeProductImageSource = (source?: string | null): string => {
    return normalizeAllowedProductImageUrl(source) ?? '';
};

type ImageLoading = NonNullable<ImgHTMLAttributes<HTMLImageElement>['loading']>;
type ImageFetchPriority = NonNullable<ImgHTMLAttributes<HTMLImageElement>['fetchPriority']>;

export interface ProductImageProps {
    src?: string | null;
    alt: string;
    /** El marco mantiene sus dimensiones aun mientras carga o falla la foto. */
    className?: string;
    imageClassName?: string;
    fallbackClassName?: string;
    fallback?: ReactNode;
    loading?: ImageLoading;
    fetchPriority?: ImageFetchPriority;
    sizes?: string;
}

export const ProductImage = ({
    src,
    alt,
    className = '',
    imageClassName = '',
    fallbackClassName = '',
    fallback,
    loading = 'lazy',
    fetchPriority = 'auto',
    sizes = '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw',
}: ProductImageProps) => {
    const normalizedSource = normalizeProductImageSource(src);
    const [failedSource, setFailedSource] = useState<string | null>(null);
    const [loadedSource, setLoadedSource] = useState<string | null>(null);
    const sourceFailed = normalizedSource.length > 0 && failedSource === normalizedSource;
    const showImage = normalizedSource.length > 0 && !sourceFailed;
    const responsiveSrcSet = showImage
        ? cloudinaryProductSrcSet(normalizedSource)
        : undefined;

    return (
        <div className={`relative isolate overflow-hidden ${className}`}>
            {showImage ? (
                <>
                    {loadedSource !== normalizedSource && (
                        <span
                            aria-hidden="true"
                            className="absolute inset-0 animate-pulse bg-current opacity-[0.06]"
                        />
                    )}
                    <img
                        src={normalizedSource}
                        srcSet={responsiveSrcSet}
                        sizes={responsiveSrcSet ? sizes : undefined}
                        alt={alt}
                        loading={loading}
                        fetchPriority={fetchPriority}
                        decoding="async"
                        onLoad={() => setLoadedSource(normalizedSource)}
                        onError={() => setFailedSource(normalizedSource)}
                        className={`absolute inset-0 h-full w-full object-cover ${imageClassName}`}
                    />
                </>
            ) : (
                <div
                    role="img"
                    aria-label={`Sin foto disponible para ${alt}`}
                    className={`absolute inset-0 grid place-items-center ${fallbackClassName}`}
                >
                    {fallback ?? (
                        <span className="text-xs font-bold uppercase tracking-[0.12em]">
                            {productInitials(alt)}
                        </span>
                    )}
                </div>
            )}
        </div>
    );
};

export default ProductImage;
