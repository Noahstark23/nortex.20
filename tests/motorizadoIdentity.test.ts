import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    hasPhoneCredentialConflict,
    motorizadoSafeSelect,
    normalizeMotorizadoPhone,
    resolveUniqueDriverLogin,
} from '../backend/services/motorizadoIdentity';

const pedidosRoute = readFileSync(resolve(process.cwd(), 'backend/routes/pedidos.ts'), 'utf8');

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

    it('expone solo los campos operativos necesarios para asignar entregas', () => {
        expect(Object.keys(motorizadoSafeSelect).sort()).toEqual([
            'activo',
            'calificacionPromedio',
            'id',
            'nombre',
            'telefono',
            'tipoFlota',
            'vehiculoPlaca',
            'zonaCobertura',
        ]);

        const select = motorizadoSafeSelect as Record<string, boolean>;
        expect(select.pinHash).toBeUndefined();
        expect(select.cedula).toBeUndefined();
        expect(select.kycNota).toBeUndefined();
        expect(select.fotoCedulaUrl).toBeUndefined();
        expect(select.fotoVehiculoUrl).toBeUndefined();
        expect(select.walletId).toBeUndefined();
        expect(select.walletBalance).toBeUndefined();
        expect(select.tenantId).toBeUndefined();
    });

    it('reutiliza el select operativo y no serializa el modelo completo en pedidos', () => {
        expect(pedidosRoute).not.toMatch(/motorizado:\s*true/);
        expect(pedidosRoute.match(/motorizado:\s*\{ select: motorizadoSafeSelect \}/g)).toHaveLength(3);
    });
});
