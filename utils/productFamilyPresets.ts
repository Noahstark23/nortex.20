export type ProductFamily =
    | 'GENERAL'
    | 'MEAT'
    | 'POULTRY'
    | 'ANIMAL_FEED'
    | 'AGRO_INPUT'
    | 'VETERINARY';

export interface ProductFamilyPreset {
    unit: string;
    saleMode: 'COUNTED' | 'MEASURED';
    quantityStep: string;
    requiresBatchTracking: boolean;
    packUnit: string;
    packSize: string;
}

const PRESETS: Record<ProductFamily, ProductFamilyPreset> = {
    GENERAL: { unit: 'unidad', saleMode: 'COUNTED', quantityStep: '1', requiresBatchTracking: false, packUnit: '', packSize: '' },
    MEAT: { unit: 'lb', saleMode: 'MEASURED', quantityStep: '0.01', requiresBatchTracking: true, packUnit: '', packSize: '' },
    POULTRY: { unit: 'lb', saleMode: 'MEASURED', quantityStep: '0.01', requiresBatchTracking: true, packUnit: '', packSize: '' },
    ANIMAL_FEED: { unit: 'lb', saleMode: 'MEASURED', quantityStep: '0.01', requiresBatchTracking: false, packUnit: 'saco', packSize: '100' },
    AGRO_INPUT: { unit: 'unidad', saleMode: 'COUNTED', quantityStep: '1', requiresBatchTracking: false, packUnit: '', packSize: '' },
    VETERINARY: { unit: 'frasco', saleMode: 'COUNTED', quantityStep: '1', requiresBatchTracking: true, packUnit: '', packSize: '' },
};

/** Devuelve una copia para que el formulario pueda editarla sin mutar el preset. */
export const productFamilyPreset = (family: ProductFamily): ProductFamilyPreset => ({
    ...PRESETS[family],
});
