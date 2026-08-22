/**
 * Integridad de los catálogos SEMILLA (P1 retención). No prueban lógica de dinero,
 * pero garantizan que la data de arranque sea sana: sin precios/costos inválidos,
 * con margen no-negativo, y el ruteo por giro correcto. Si un edit futuro mete un
 * precio negativo o vacía un campo requerido, el CI lo atrapa.
 */
import { describe, it, expect } from 'vitest';
import {
    composeSeedCatalog,
    SEED_CAPABILITY_MODULES,
    SEED_CATALOGS,
    seedCatalogFor,
} from '../backend/data/seedCatalogs';

describe('catálogos semilla — integridad de datos', () => {
    for (const [type, items] of Object.entries(SEED_CATALOGS)) {
        it(`${type}: productos bien formados`, () => {
            expect(items.length).toBeGreaterThanOrEqual(8);
            for (const p of items) {
                expect(p.name.trim().length).toBeGreaterThan(0);
                expect(p.category.trim().length).toBeGreaterThan(0);
                expect(p.price).toBeGreaterThan(0);
                expect(p.cost).toBeGreaterThan(0);
                expect(p.price).toBeGreaterThanOrEqual(p.cost); // margen no-negativo
                expect(p.stock).toBeGreaterThanOrEqual(0);
                expect(Number.isFinite(p.price) && Number.isFinite(p.cost)).toBe(true);
            }
        });
    }
});

describe('ruteo por giro — seedCatalogFor', () => {
    it('PULPERIA devuelve su set', () => {
        expect(seedCatalogFor('PULPERIA')).toBe(SEED_CATALOGS.PULPERIA);
    });
    it('RETAIL cae a MISCELANEA', () => {
        expect(seedCatalogFor('RETAIL')).toBe(SEED_CATALOGS.MISCELANEA);
    });
    it('LENDER (no vende productos) → null', () => {
        expect(seedCatalogFor('LENDER')).toBeNull();
    });
    it('giro desconocido → null (no rompe)', () => {
        expect(seedCatalogFor('XYZ')).toBeNull();
        expect(seedCatalogFor(null)).toBeNull();
        expect(seedCatalogFor(undefined)).toBeNull();
    });
});

describe('compositor por capacidades', () => {
    it('combina miscelánea con carnes sin duplicar el catálogo base', () => {
        const catalog = composeSeedCatalog('MISCELANEA', ['CARNES_AVES']);
        expect(catalog).not.toBeNull();
        expect(catalog).toHaveLength(SEED_CATALOGS.MISCELANEA.length + SEED_CAPABILITY_MODULES.CARNES_AVES.length);
        expect(catalog?.find((item) => item.name === 'Pollo entero por libra')).toMatchObject({
            saleMode: 'MEASURED',
            unit: 'lb',
            quantityStep: '0.01',
        });
    });

    it('permite agropecuaria basada solo en módulos', () => {
        const catalog = composeSeedCatalog('AGROPECUARIA', ['ALIMENTO_ANIMAL', 'AGROINSUMOS']);
        expect(catalog?.some((item) => item.productFamily === 'ANIMAL_FEED')).toBe(true);
        expect(catalog?.some((item) => item.productFamily === 'AGRO_INPUT')).toBe(true);
    });

    it('no cambia el ruteo legado cuando no se solicitan módulos', () => {
        expect(composeSeedCatalog('FERRETERIA', [])).toEqual(SEED_CATALOGS.FERRETERIA);
    });
});
