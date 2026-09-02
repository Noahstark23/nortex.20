export const normalizeMotorizadoPhone = (raw: string): string => raw.replace(/\D/g, '');

export const motorizadoSafeSelect = {
    id: true,
    tenantId: true,
    tipoFlota: true,
    nombre: true,
    telefono: true,
    zonaCobertura: true,
    activo: true,
    walletId: true,
    calificacionPromedio: true,
    vehiculoPlaca: true,
    createdAt: true,
    cedula: true,
    kycStatus: true,
    kycNota: true,
    fotoCedulaUrl: true,
    fotoVehiculoUrl: true,
    walletBalance: true,
} as const;

export interface MotorizadoPhoneCredentialRecord {
    id: string;
    pinHash: string | null;
}

export const hasPhoneCredentialConflict = (
    records: readonly MotorizadoPhoneCredentialRecord[],
    currentId?: string,
): boolean => records.some((record) => record.id !== currentId);

export interface DriverLoginCandidate {
    id: string;
    nombre: string;
    tipoFlota: string;
    zonaCobertura: string;
    activo: boolean;
    kycStatus: string;
    pinHash: string | null;
}

export const resolveUniqueDriverLogin = <T extends DriverLoginCandidate>(
    candidates: readonly T[],
): { driver: T | null; ambiguous: boolean } => {
    if (candidates.length === 0) return { driver: null, ambiguous: false };
    if (candidates.length === 1) return { driver: candidates[0], ambiguous: false };
    return { driver: null, ambiguous: true };
};
