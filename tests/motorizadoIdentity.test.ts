import { describe, expect, it } from 'vitest';
import {
    hasPhoneCredentialConflict,
    motorizadoSafeSelect,
    normalizeMotorizadoPhone,
    resolveUniqueDriverLogin,
} from '../backend/services/motorizadoIdentity';

describe('motorizadoIdentity', () => {
    it('normaliza el telefono a solo digitos', () => {
        expect(normalizeMotorizadoPhone('505 8888-0000')).toBe('50588880000');
    });

    it('detecta conflicto de credenciales cuando otro motorizado ya usa el telefono', () => {
        expect(hasPhoneCredentialConflict([
            { id: 'driver-1', pinHash: 'hash-1' },
            { id: 'driver-2', pinHash: 'hash-2' },
        ], 'driver-1')).toBe(true);
    });

    it('permite conservar el mismo telefono para resetear el PIN del mismo motorizado', () => {
        expect(hasPhoneCredentialConflict([
            { id: 'driver-1', pinHash: 'hash-1' },
        ], 'driver-1')).toBe(false);
    });

    it('rechaza logins ambiguos cuando existen dos cuentas con el mismo telefono', () => {
        expect(resolveUniqueDriverLogin([
            {
                id: 'driver-1',
                nombre: 'Uno',
                tipoFlota: 'PROPIA',
                zonaCobertura: 'Managua',
                activo: true,
                kycStatus: 'APROBADO',
                pinHash: 'hash-1',
            },
            {
                id: 'driver-2',
                nombre: 'Dos',
                tipoFlota: 'NORTEX',
                zonaCobertura: 'Masaya',
                activo: true,
                kycStatus: 'APROBADO',
                pinHash: 'hash-2',
            },
        ])).toEqual({ driver: null, ambiguous: true });
    });

    it('expone un select seguro sin pinHash', () => {
        expect((motorizadoSafeSelect as Record<string, boolean>).pinHash).toBeUndefined();
        expect(motorizadoSafeSelect.nombre).toBe(true);
        expect(motorizadoSafeSelect.telefono).toBe(true);
    });
});
