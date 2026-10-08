/**
 * NORTEX — Catálogos SEMILLA por giro (P1 retención).
 *
 * Problema que resuelve: un tenant recién registrado veía una app VACÍA (cero
 * productos) y tenía que cargar todo a mano ANTES de sentir valor → causa #1 de
 * abandono del día 1 (auditoría de retención R2-1/R3-1). Con un catálogo semilla
 * opcional de su giro, el POS "ya funciona" el segundo cero; el dueño edita,
 * borra o le suma lo suyo.
 *
 * Los productos son EDITABLES/BORRABLES como cualquier otro. Precios en córdobas
 * (referenciales, el dueño los ajusta). `stock` modesto para que el POS sea
 * usable de una. No es data real de negocio — es andamiaje de arranque.
 */

export interface SeedProduct {
    name: string;
    category: string;
    price: number; // C$ venta (detalle)
    cost: number;  // C$ costo (editable)
    stock: number;
    unit?: string;
    saleMode?: 'COUNTED' | 'MEASURED';
    quantityStep?: string;
    productFamily?: 'GENERAL' | 'MEAT' | 'POULTRY' | 'ANIMAL_FEED' | 'AGRO_INPUT' | 'VETERINARY';
    packUnit?: string;
    packSize?: number;
    packPrice?: number;
    requiresBatchTracking?: boolean;
}

export const SEED_CAPABILITY_MODULES: Record<string, SeedProduct[]> = {
    CARNES_AVES: [
        { name: 'Pollo entero por libra', category: 'Pollo', price: 55, cost: 43, stock: 50, unit: 'lb', saleMode: 'MEASURED', quantityStep: '0.01', productFamily: 'POULTRY', requiresBatchTracking: true },
        { name: 'Pechuga de pollo por libra', category: 'Pollo', price: 78, cost: 62, stock: 35, unit: 'lb', saleMode: 'MEASURED', quantityStep: '0.01', productFamily: 'POULTRY', requiresBatchTracking: true },
        { name: 'Carne de res por libra', category: 'Carnes', price: 120, cost: 98, stock: 30, unit: 'lb', saleMode: 'MEASURED', quantityStep: '0.01', productFamily: 'MEAT', requiresBatchTracking: true },
    ],
    ALIMENTO_ANIMAL: [
        { name: 'Concentrado para pollo por libra', category: 'Alimento animal', price: 18, cost: 14, stock: 200, unit: 'lb', saleMode: 'MEASURED', quantityStep: '0.01', productFamily: 'ANIMAL_FEED', packUnit: 'saco', packSize: 100, packPrice: 1650 },
        { name: 'Concentrado para cerdo por libra', category: 'Alimento animal', price: 20, cost: 16, stock: 200, unit: 'lb', saleMode: 'MEASURED', quantityStep: '0.01', productFamily: 'ANIMAL_FEED', packUnit: 'saco', packSize: 100, packPrice: 1850 },
        { name: 'Alimento para perro', category: 'Alimento animal', price: 38, cost: 30, stock: 100, unit: 'lb', saleMode: 'MEASURED', quantityStep: '0.01', productFamily: 'ANIMAL_FEED' },
    ],
    AGROINSUMOS: [
        { name: 'Fertilizante completo', category: 'Fertilizantes', price: 1450, cost: 1230, stock: 12, unit: 'saco', saleMode: 'COUNTED', quantityStep: '1', productFamily: 'AGRO_INPUT' },
        { name: 'Semilla de maíz', category: 'Semillas', price: 180, cost: 140, stock: 30, unit: 'bolsa', saleMode: 'COUNTED', quantityStep: '1', productFamily: 'AGRO_INPUT' },
        { name: 'Vitaminas para aves', category: 'Veterinaria', price: 95, cost: 72, stock: 25, unit: 'frasco', saleMode: 'COUNTED', quantityStep: '1', productFamily: 'VETERINARY', requiresBatchTracking: true },
    ],
    PERECEDEROS: [],
    MAYOREO: [],
};

const PULPERIA: SeedProduct[] = [
    { name: 'Arroz (libra)', category: 'Granos básicos', price: 18, cost: 14, stock: 100 },
    { name: 'Frijol rojo (libra)', category: 'Granos básicos', price: 25, cost: 19, stock: 80 },
    { name: 'Azúcar (libra)', category: 'Granos básicos', price: 16, cost: 12, stock: 100 },
    { name: 'Aceite 1 litro', category: 'Abarrotes', price: 55, cost: 45, stock: 40 },
    { name: 'Café molido 200g', category: 'Abarrotes', price: 60, cost: 48, stock: 30 },
    { name: 'Sal (bolsa)', category: 'Abarrotes', price: 8, cost: 5, stock: 60 },
    { name: 'Gaseosa 1.5L', category: 'Bebidas', price: 40, cost: 32, stock: 48 },
    { name: 'Agua embotellada 600ml', category: 'Bebidas', price: 15, cost: 10, stock: 60 },
    { name: 'Galletas (paquete)', category: 'Snacks', price: 12, cost: 8, stock: 50 },
    { name: 'Jabón de lavar', category: 'Limpieza', price: 18, cost: 13, stock: 40 },
    { name: 'Papel higiénico (rollo)', category: 'Limpieza', price: 10, cost: 7, stock: 60 },
    { name: 'Huevos (unidad)', category: 'Perecederos', price: 6, cost: 4.5, stock: 120 },
    { name: 'Pan (bolsa)', category: 'Perecederos', price: 25, cost: 18, stock: 20 },
    { name: 'Cigarrillo (unidad)', category: 'Varios', price: 7, cost: 5, stock: 100 },
];

const FERRETERIA: SeedProduct[] = [
    { name: 'Cemento (bolsa 42.5kg)', category: 'Construcción', price: 380, cost: 330, stock: 40, unit: 'bolsa' },
    { name: 'Varilla de hierro 3/8"', category: 'Construcción', price: 210, cost: 180, stock: 50, unit: 'unidad' },
    { name: 'Bloque de concreto', category: 'Construcción', price: 22, cost: 16, stock: 300, unit: 'unidad' },
    { name: 'Arena (metro)', category: 'Construcción', price: 550, cost: 450, stock: 10, unit: 'metro' },
    { name: 'Clavos (libra)', category: 'Ferretería', price: 30, cost: 22, stock: 60, unit: 'libra' },
    { name: 'Tornillos (caja)', category: 'Ferretería', price: 45, cost: 33, stock: 40, unit: 'caja' },
    { name: 'Tubo PVC 1/2"', category: 'Fontanería', price: 85, cost: 65, stock: 50, unit: 'unidad' },
    { name: 'Pega PVC (bote)', category: 'Fontanería', price: 60, cost: 45, stock: 30 },
    { name: 'Pintura látex (galón)', category: 'Pinturas', price: 320, cost: 260, stock: 25, unit: 'galón' },
    { name: 'Brocha 3"', category: 'Pinturas', price: 45, cost: 30, stock: 40 },
    { name: 'Martillo', category: 'Herramientas', price: 180, cost: 130, stock: 20 },
    { name: 'Cinta métrica 5m', category: 'Herramientas', price: 95, cost: 70, stock: 25 },
    { name: 'Foco LED', category: 'Eléctrico', price: 55, cost: 40, stock: 60 },
    { name: 'Cable eléctrico (metro)', category: 'Eléctrico', price: 18, cost: 13, stock: 200, unit: 'metro' },
];

const FARMACIA: SeedProduct[] = [
    { name: 'Acetaminofén 500mg (tableta)', category: 'Analgésicos', price: 3, cost: 1.8, stock: 500, unit: 'tableta' },
    { name: 'Ibuprofeno 400mg (tableta)', category: 'Analgésicos', price: 4, cost: 2.5, stock: 400, unit: 'tableta' },
    { name: 'Suero oral (sobre)', category: 'Hidratación', price: 20, cost: 14, stock: 80 },
    { name: 'Alcohol 90% (frasco)', category: 'Antisépticos', price: 35, cost: 26, stock: 40 },
    { name: 'Gasa estéril', category: 'Curaciones', price: 15, cost: 10, stock: 60 },
    { name: 'Curitas (caja)', category: 'Curaciones', price: 25, cost: 18, stock: 50 },
    { name: 'Vitamina C (tableta)', category: 'Vitaminas', price: 5, cost: 3, stock: 200, unit: 'tableta' },
    { name: 'Jarabe para la tos', category: 'Respiratorio', price: 90, cost: 70, stock: 30 },
    { name: 'Mascarilla desechable', category: 'Protección', price: 5, cost: 2.5, stock: 300 },
    { name: 'Termómetro digital', category: 'Instrumentos', price: 150, cost: 110, stock: 15 },
    { name: 'Pañales (paquete)', category: 'Cuidado personal', price: 180, cost: 145, stock: 25 },
    { name: 'Toallas sanitarias (paquete)', category: 'Cuidado personal', price: 45, cost: 33, stock: 40 },
];

const MISCELANEA: SeedProduct[] = [
    { name: 'Cuaderno universitario', category: 'Papelería', price: 35, cost: 25, stock: 60 },
    { name: 'Lapicero', category: 'Papelería', price: 8, cost: 4, stock: 200 },
    { name: 'Cargador de celular', category: 'Electrónica', price: 150, cost: 100, stock: 30 },
    { name: 'Audífonos', category: 'Electrónica', price: 120, cost: 80, stock: 25 },
    { name: 'Pilas AA (par)', category: 'Electrónica', price: 40, cost: 28, stock: 50 },
    { name: 'Shampoo (sachet)', category: 'Cuidado personal', price: 6, cost: 3.5, stock: 150 },
    { name: 'Desodorante', category: 'Cuidado personal', price: 65, cost: 48, stock: 40 },
    { name: 'Golosina / dulce', category: 'Snacks', price: 3, cost: 1.5, stock: 300 },
    { name: 'Gaseosa lata', category: 'Bebidas', price: 25, cost: 18, stock: 60 },
    { name: 'Encendedor', category: 'Varios', price: 15, cost: 9, stock: 80 },
    { name: 'Juguete pequeño', category: 'Juguetería', price: 55, cost: 38, stock: 30 },
    { name: 'Recarga telefónica', category: 'Servicios', price: 50, cost: 47, stock: 999 },
];

const BOUTIQUE: SeedProduct[] = [
    { name: 'Camiseta básica', category: 'Caballeros', price: 250, cost: 170, stock: 30 },
    { name: 'Blusa dama', category: 'Damas', price: 320, cost: 220, stock: 25 },
    { name: 'Pantalón jeans', category: 'Caballeros', price: 550, cost: 400, stock: 20 },
    { name: 'Vestido', category: 'Damas', price: 680, cost: 480, stock: 15 },
    { name: 'Short', category: 'Casual', price: 280, cost: 190, stock: 25 },
    { name: 'Ropa interior (paquete)', category: 'Íntima', price: 180, cost: 120, stock: 40 },
    { name: 'Calcetines (par)', category: 'Accesorios', price: 60, cost: 38, stock: 60 },
    { name: 'Gorra', category: 'Accesorios', price: 220, cost: 150, stock: 25 },
    { name: 'Sandalias', category: 'Calzado', price: 350, cost: 250, stock: 20 },
    { name: 'Zapatos deportivos', category: 'Calzado', price: 900, cost: 650, stock: 15 },
    { name: 'Cinturón', category: 'Accesorios', price: 180, cost: 120, stock: 30 },
    { name: 'Cartera / bolso', category: 'Accesorios', price: 450, cost: 310, stock: 18 },
];

const DISTRIBUIDORA: SeedProduct[] = [
    { name: 'Arroz (quintal)', category: 'Granos', price: 1600, cost: 1400, stock: 30, unit: 'quintal' },
    { name: 'Frijol (quintal)', category: 'Granos', price: 2200, cost: 1900, stock: 25, unit: 'quintal' },
    { name: 'Azúcar (quintal)', category: 'Granos', price: 1500, cost: 1300, stock: 30, unit: 'quintal' },
    { name: 'Aceite (caja 12u)', category: 'Abarrotes', price: 620, cost: 520, stock: 40, unit: 'caja' },
    { name: 'Gaseosa (caja 24u)', category: 'Bebidas', price: 480, cost: 400, stock: 50, unit: 'caja' },
    { name: 'Agua (fardo 12u)', category: 'Bebidas', price: 150, cost: 110, stock: 60, unit: 'fardo' },
    { name: 'Jabón de lavar (caja)', category: 'Limpieza', price: 380, cost: 300, stock: 35, unit: 'caja' },
    { name: 'Papel higiénico (fardo)', category: 'Limpieza', price: 240, cost: 190, stock: 40, unit: 'fardo' },
    { name: 'Galletas (caja)', category: 'Snacks', price: 280, cost: 220, stock: 45, unit: 'caja' },
    { name: 'Café (caja)', category: 'Abarrotes', price: 700, cost: 580, stock: 30, unit: 'caja' },
    { name: 'Harina (quintal)', category: 'Granos', price: 1100, cost: 950, stock: 20, unit: 'quintal' },
    { name: 'Sal (saco)', category: 'Abarrotes', price: 200, cost: 150, stock: 40, unit: 'saco' },
];

export const SEED_CATALOGS: Record<string, SeedProduct[]> = {
    PULPERIA,
    FERRETERIA,
    FARMACIA,
    MISCELANEA,
    BOUTIQUE,
    DISTRIBUIDORA,
    RETAIL: MISCELANEA, // Retail general usa el set de miscelánea
};

/** Devuelve el catálogo semilla del giro, o null si el giro no vende productos
 *  (p. ej. LENDER/prestamista) o no tiene un set definido. */
export function seedCatalogFor(type: string | null | undefined): SeedProduct[] | null {
    if (!type) return null;
    return SEED_CATALOGS[type] ?? null;
}

/**
 * Compone el giro principal con módulos opt-in. La fiscalidad nunca se infiere
 * de estas sugerencias; cada producto conserva `ivaExento=false` hasta que el
 * dueño o contador lo clasifique explícitamente.
 */
export function composeSeedCatalog(
    type: string | null | undefined,
    capabilities: readonly string[],
): SeedProduct[] | null {
    const base = seedCatalogFor(type) ?? (
        type === 'CARNICERIA_POLLERIA' || type === 'AGROPECUARIA' ? [] : null
    );
    if (base === null) return null;

    const combined = [
        ...base,
        ...capabilities.flatMap((code) => SEED_CAPABILITY_MODULES[code] ?? []),
    ];
    const seenNames = new Set<string>();
    return combined.filter((product) => {
        const key = product.name.trim().toLocaleLowerCase('es');
        if (seenNames.has(key)) return false;
        seenNames.add(key);
        return true;
    });
}
