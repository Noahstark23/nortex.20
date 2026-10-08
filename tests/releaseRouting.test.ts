import { describe, expect, it } from 'vitest';
import { postRegistrationDestination, uiModeForNewTenant } from '../utils/releaseRouting';

describe('routing de activacion y release', () => {
    it('arranca retail nuevo en modo simple', () => {
        expect(uiModeForNewTenant('FERRETERIA')).toBe('simple');
        expect(uiModeForNewTenant('PULPERIA')).toBe('simple');
    });

    it('conserva el panel del prestamista', () => {
        expect(uiModeForNewTenant('LENDER')).toBe('full');
        expect(postRegistrationDestination({
            role: 'ADMIN',
            tenantType: 'LENDER',
        })).toBe('/app/dashboard?welcome=1');
    });

    it('manda al usuario retail nuevo a Mi Negocio, no a Mi Plata', () => {
        expect(postRegistrationDestination({
            role: 'ADMIN',
            tenantType: 'FERRETERIA',
        })).toBe('/app/inicio?welcome=1');
    });

    it('continúa una intención del demo en el POS sin copiar productos ficticios', () => {
        expect(postRegistrationDestination({
            role: 'ADMIN',
            tenantType: 'FERRETERIA',
            intent: 'completed_sale',
        })).toBe('/app/pos?first_sale=1');
    });
});
