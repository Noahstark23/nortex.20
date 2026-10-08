export const PUBLIC_ACQUISITION_SOURCES = [
    'direct',
    'demo',
    'landing_spa',
    'landing_html',
    'landing_ferreteria',
    'landing_farmacia',
    'landing_nicaragua',
    'first_sale',
    'onboarding',
    'empty_catalog',
] as const;

export type PublicAcquisitionSource = typeof PUBLIC_ACQUISITION_SOURCES[number];

const PUBLIC_ACQUISITION_SOURCE_SET = new Set<string>(PUBLIC_ACQUISITION_SOURCES);

/**
 * Keeps analytics dimensions bounded and prevents arbitrary query-string values
 * from becoming high-cardinality GA4 sources.
 */
export function normalizePublicAcquisitionSource(
    value: string | null | undefined,
): PublicAcquisitionSource {
    const normalized = value?.trim().toLowerCase() || 'direct';
    return PUBLIC_ACQUISITION_SOURCE_SET.has(normalized)
        ? normalized as PublicAcquisitionSource
        : 'direct';
}

export const REGISTRATION_INTENTS = ['own_products', 'completed_sale'] as const;
export type RegistrationIntent = typeof REGISTRATION_INTENTS[number];

const REGISTRATION_INTENT_SET = new Set<string>(REGISTRATION_INTENTS);

export function normalizeRegistrationIntent(
    value: string | null | undefined,
): RegistrationIntent | null {
    const normalized = value?.trim().toLowerCase();
    return normalized && REGISTRATION_INTENT_SET.has(normalized)
        ? normalized as RegistrationIntent
        : null;
}

/** Keeps the original acquisition channel when the demo hands off to registration. */
export function buildPublicRegistrationPath(
    source: string | null | undefined,
    intent: RegistrationIntent,
): string {
    const normalizedSource = normalizePublicAcquisitionSource(source);
    return `/register?source=${normalizedSource}&intent=${intent}`;
}

export interface PublicRegistrationInput {
    companyName: string;
    email: string;
    password: string;
    phone: string;
    type: string;
}

export type PublicRegistrationField = keyof PublicRegistrationInput;
export type PublicRegistrationErrors = Partial<Record<PublicRegistrationField, string>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[0-9+\-\s()]*$/;

/** Fast client-side mirror of the public registration rules. The backend stays authoritative. */
export function validatePublicRegistration(
    input: PublicRegistrationInput,
): PublicRegistrationErrors {
    const errors: PublicRegistrationErrors = {};
    const companyName = input.companyName.trim();
    const email = input.email.trim();
    const phone = input.phone.trim();

    if (companyName.length < 2) {
        errors.companyName = 'Escribí el nombre de tu negocio';
    } else if (companyName.length > 120) {
        errors.companyName = 'Usá un nombre de hasta 120 caracteres';
    }

    if (!EMAIL_PATTERN.test(email)) {
        errors.email = 'Escribí un correo válido';
    }

    if (!input.type) {
        errors.type = 'Seleccioná el tipo de negocio';
    }

    if (input.password.length < 8) {
        errors.password = 'La contraseña debe tener al menos 8 caracteres';
    } else if (input.password.length > 200) {
        errors.password = 'La contraseña es demasiado larga';
    }

    if (phone.length > 20) {
        errors.phone = 'Usá un número de hasta 20 caracteres';
    } else if (!PHONE_PATTERN.test(phone)) {
        errors.phone = 'Usá solo números, espacios, paréntesis, + o -';
    }

    return errors;
}

export function firstPublicRegistrationError(
    errors: PublicRegistrationErrors,
): PublicRegistrationField | null {
    const fieldOrder: PublicRegistrationField[] = [
        'companyName',
        'type',
        'email',
        'phone',
        'password',
    ];
    return fieldOrder.find((field) => Boolean(errors[field])) ?? null;
}
