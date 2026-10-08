/**
 * Capacidades combinables de un negocio. `Tenant.type` sigue existiendo para
 * segmentación, pero ninguna operación de inventario o venta depende de él.
 */
export const TENANT_CAPABILITY_CODES = [
    'CARNES_AVES',
    'ALIMENTO_ANIMAL',
    'AGROINSUMOS',
    'PERECEDEROS',
    'MAYOREO',
] as const;

export type TenantCapabilityCode = typeof TENANT_CAPABILITY_CODES[number];

const CAPABILITY_SET = new Set<string>(TENANT_CAPABILITY_CODES);

export const isTenantCapabilityCode = (value: unknown): value is TenantCapabilityCode =>
    typeof value === 'string' && CAPABILITY_SET.has(value);

/** Normaliza, elimina duplicados y rechaza valores fuera del allowlist. */
export const normalizeTenantCapabilities = (values: readonly unknown[]): TenantCapabilityCode[] => {
    const normalized: TenantCapabilityCode[] = [];
    const seen = new Set<TenantCapabilityCode>();

    for (const value of values) {
        if (!isTenantCapabilityCode(value)) {
            throw new Error(`Capacidad no permitida: ${String(value)}`);
        }
        if (!seen.has(value)) {
            seen.add(value);
            normalized.push(value);
        }
    }

    return normalized;
};
/** Sugerencias de onboarding; el dueño puede combinarlas o cambiarlas. */
export const suggestedCapabilitiesForBusinessType = (
    businessType: string | null | undefined,
): TenantCapabilityCode[] => {
    switch (businessType?.trim().toUpperCase()) {
        case 'CARNICERIA_POLLERIA':
            return ['CARNES_AVES', 'PERECEDEROS'];
        case 'AGROPECUARIA':
            return ['ALIMENTO_ANIMAL', 'AGROINSUMOS'];
        case 'DISTRIBUIDORA':
            return ['MAYOREO'];
        default:
            return [];
    }
};
