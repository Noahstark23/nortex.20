const BASE_ALLOWED_ORIGINS = [
    'http://localhost:3000',
    'http://localhost:3210',
    'http://localhost:4174',
    'http://localhost:5173',
    'http://127.0.0.1:3210',
    'http://127.0.0.1:4174',
    'https://somosnortex.com',
    'https://www.somosnortex.com',
    'http://206.189.183.163:3000',
] as const;

/**
 * Nortex tiene dos superficies locales válidas:
 * - `nortex frontend` en 127.0.0.1:4174
 * - `nortex app-up` o preview integrado en 127.0.0.1:3210
 *
 * Ambas deben poder hablar con el backend aislado sin depender de una sola env.
 */
export function buildAllowedOrigins(...dynamicOrigins: Array<string | null | undefined>): string[] {
    return Array.from(new Set([
        ...BASE_ALLOWED_ORIGINS,
        ...dynamicOrigins
            .map((origin) => origin?.trim())
            .filter((origin): origin is string => Boolean(origin)),
    ]));
}

export function isAllowedOrigin(allowedOrigins: readonly string[], origin: string | undefined): boolean {
    if (!origin) return true;
    return allowedOrigins.includes(origin);
}
