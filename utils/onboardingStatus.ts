export interface OnboardingStepStatus {
    key: string;
    label: string;
    done: boolean;
    href: string;
    cta: string;
}

export interface OnboardingStatus {
    type: string;
    businessName: string;
    steps: OnboardingStepStatus[];
    completed: number;
    total: number;
    allDone: boolean;
}

const CACHE_TTL_MS = 2_000;
let cached: { token: string; data: OnboardingStatus; storedAt: number } | null = null;
let inFlight: { token: string; promise: Promise<OnboardingStatus> } | null = null;

/**
 * Comparte la lectura de activación entre Layout y la pantalla hija.
 * React monta ambos en el mismo cambio de ruta; sin este in-flight cache se
 * emitían dos GET /api/onboarding idénticos en /app/inicio.
 */
export async function fetchOnboardingStatus(
    token: string,
    options: { force?: boolean } = {},
): Promise<OnboardingStatus> {
    const now = Date.now();
    if (!options.force && cached?.token === token && now - cached.storedAt < CACHE_TTL_MS) {
        return cached.data;
    }
    if (inFlight?.token === token) return inFlight.promise;

    const promise = fetch('/api/onboarding', {
        headers: { Authorization: `Bearer ${token}` },
    }).then(async (response) => {
        if (!response.ok) throw new Error('No pudimos cargar tus primeros pasos.');
        const data = await response.json() as OnboardingStatus;
        cached = { token, data, storedAt: Date.now() };
        return data;
    }).finally(() => {
        if (inFlight?.promise === promise) inFlight = null;
    });

    inFlight = { token, promise };
    return promise;
}

export function invalidateOnboardingStatusCache(): void {
    cached = null;
}
