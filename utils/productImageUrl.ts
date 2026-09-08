/**
 * Frontera compartida para fotos de productos.
 *
 * Cloudinary es el único proveedor de imágenes autorizado. Las rutas relativas
 * de demos y las URLs legacy de terceros se rechazan deliberadamente: la UI
 * debe mostrar su fallback sin iniciar una solicitud hacia esos destinos.
 */
export const PRODUCT_IMAGE_ALLOWED_HOST = 'res.cloudinary.com';
export const PRODUCT_IMAGE_CLOUDINARY_CLOUD_NAME = 'dex1vy92h';
export const PRODUCT_IMAGE_URL_MAX_LENGTH = 2_000;
const PRODUCT_IMAGE_UPLOAD_PATH_PREFIX = `/${PRODUCT_IMAGE_CLOUDINARY_CLOUD_NAME}/image/upload/`;
const CLOUDINARY_REMOTE_FETCH_TRANSFORMATION = /(?:^|[\/,])(?:l|u)_fetch(?=[:\/,]|$)/i;

const repeatedlyDecodePath = (pathname: string): string | null => {
    let decoded = pathname;
    try {
        // Cada pasada que cambia el texto reduce al menos una secuencia `%xx`.
        // Si 20 capas no bastan, se rechaza la ruta en vez de aceptar una
        // codificación ambigua que el CDN podría volver a decodificar.
        for (let pass = 0; pass < 20; pass += 1) {
            const next = decodeURIComponent(decoded);
            if (next === decoded) return decoded;
            decoded = next;
        }
        return null;
    } catch {
        return null;
    }
};

export const normalizeAllowedProductImageUrl = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;

    const candidate = value.trim();
    if (!candidate || candidate.length > PRODUCT_IMAGE_URL_MAX_LENGTH) return null;

    try {
        const parsed = new URL(candidate);
        const decodedPath = repeatedlyDecodePath(parsed.pathname);
        const decodedPathSegments = decodedPath?.split('/') ?? [];
        if (
            parsed.protocol !== 'https:'
            || parsed.hostname.toLowerCase() !== PRODUCT_IMAGE_ALLOWED_HOST
            || parsed.username.length > 0
            || parsed.password.length > 0
            || parsed.port.length > 0
            || !parsed.pathname.startsWith(PRODUCT_IMAGE_UPLOAD_PATH_PREFIX)
            || parsed.pathname.length === PRODUCT_IMAGE_UPLOAD_PATH_PREFIX.length
            || decodedPath === null
            || !decodedPath.startsWith(PRODUCT_IMAGE_UPLOAD_PATH_PREFIX)
            || decodedPathSegments.some((segment) => segment === '.' || segment === '..')
            || decodedPath.includes('\\')
            || CLOUDINARY_REMOTE_FETCH_TRANSFORMATION.test(decodedPath)
        ) {
            return null;
        }

        return parsed.toString();
    } catch {
        return null;
    }
};
