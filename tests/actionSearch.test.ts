import { describe, expect, it } from 'vitest';
import { buildNavigation } from '../utils/navigation';
import { searchAllowedActions } from '../utils/actionSearch';

const entriesFor = (role: string) => {
    const nav = buildNavigation({ tenantType: 'PULPERIA', role, simple: true });
    return [...nav.primary, ...nav.more];
};

describe('búsqueda de funciones', () => {
    it('encuentra sinónimos de pulpería incluso en Más opciones', () => {
        const entries = entriesFor('OWNER');
        expect(searchAllowedActions(entries, 'fiado').map(item => item.path)).toContain('/app/receivables');
        expect(searchAllowedActions(entries, 'ganancia mes').map(item => item.path)).toContain('/app/reports');
        expect(searchAllowedActions(entries, 'bodega').map(item => item.path)).toContain('/app/warehouses');
    });

    it('no revela rutas vedadas al rol y tolera tildes', () => {
        const entries = entriesFor('CASHIER');
        expect(searchAllowedActions(entries, 'arqueo')).toEqual([]);
        expect(searchAllowedActions(entries, 'contabilidad')).toEqual([]);
        expect(searchAllowedActions(entries, 'crédito').map(item => item.path)).toContain('/app/receivables');
    });

    it('no propone destinos sin consulta', () => {
        expect(searchAllowedActions(entriesFor('OWNER'), '  ')).toEqual([]);
    });
});
