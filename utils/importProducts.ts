/**
 * NORTEX — parser puro de importación de catálogo (R2.7, auditoría E1/E3/E4).
 *
 * PROBLEMA: el importador solo entendía las columnas `sku` y `nombre` — el
 * Excel real de una PyME nica ("Código | Descripción | Precio | Costo |
 * Existencia") daba 100% de filas inválidas sin explicar por qué. Y el dinero
 * sucio ("C$ 385.00", "1,250.50") pasaba la validación como NaN o como C$ 1.00:
 * corrupción silenciosa en el minuto uno del sistema.
 *
 * DISEÑO: módulo PURO (sin React, sin fetch) — mismo input → mismo output,
 * testeable sin DOM. Lo consumen ProductImporter.tsx y el import del POS.
 *
 * REGLAS DE DINERO (parseMoneyNi):
 *  - Se aceptan "C$", "U$", "$" y espacios/NBSP como decoración.
 *  - `.` es SIEMPRE decimal (convención nica/US: 1,250.50).
 *  - `,` es decimal solo con 1-2 dígitos al final ("18,50"); si no, es miles.
 *  - Si hay ambos, el ÚLTIMO separador es el decimal.
 *  - Lo ilegible devuelve null → la fila se RECHAZA explícita, nunca pasa
 *    como NaN con check verde ni entra como C$ 1.00.
 */

import Decimal from 'decimal.js';
import { validateQuantity } from './quantity';

export type ImportedSaleMode = 'COUNTED' | 'MEASURED';
export type ImportedProductFamily = 'GENERAL' | 'MEAT' | 'POULTRY' | 'ANIMAL_FEED' | 'AGRO_INPUT' | 'VETERINARY';

export interface ParsedProduct {
    sku: string;
    nombre: string;
    categoria: string;
    precio: number;
    costo: number;
    stock: number;
    minStock: number;
    unidad: string;
    descripcion: string;
    modoVenta: ImportedSaleMode;
    pasoCantidad: number;
    familiaProducto: ImportedProductFamily;
    unidadEmpaque: string | null;
    tamanoEmpaque: number | null;
    precioEmpaque: number | null;
    requiereLote: boolean;
    ivaExento: boolean;
}

export interface ParsedRow {
    /** Fila REAL del Excel (1-based, contando el encabezado como fila 1). */
    excelRow: number;
    data: ParsedProduct;
    valid: boolean;
    errors: string[];
}

export type CanonicalField =
    | 'sku' | 'nombre' | 'precio' | 'costo' | 'stock'
    | 'minStock' | 'categoria' | 'unidad' | 'descripcion'
    | 'modoVenta' | 'pasoCantidad' | 'familiaProducto'
    | 'unidadEmpaque' | 'tamanoEmpaque' | 'precioEmpaque'
    | 'requiereLote' | 'ivaExento';

export interface ColumnResolution {
    /** Campo canónico → encabezado original del archivo (o null si no está). */
    mapping: Record<CanonicalField, string | null>;
    /** Encabezados del archivo que no matchearon ningún campo. */
    unknown: string[];
    /** Campos ESENCIALES que faltan (nombre y precio; sku puede faltar por fila). */
    missing: CanonicalField[];
}

export interface ParseResult {
    rows: ParsedRow[];
    resolution: ColumnResolution;
}

// ── Normalización de encabezados ─────────────────────────────────────────────

/** minúsculas, sin tildes/diéresis, sin puntuación, espacios colapsados. */
export function normalizeKey(header: string): string {
    return String(header)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')   // tildes fuera: Código → codigo
        .toLowerCase()
        .replace(/[._\-/#]/g, ' ')
        .replace(/[^a-z0-9ñ ]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Sinónimos por campo, ya normalizados. El orden dentro de cada lista es la
 * prioridad si el archivo trae más de uno.
 */
const SYNONYMS: Record<CanonicalField, string[]> = {
    sku: ['sku', 'codigo', 'codigo de barras', 'codigo barras', 'cod', 'barra', 'barras', 'barcode', 'upc', 'ean', 'clave', 'referencia', 'ref'],
    nombre: ['nombre', 'name', 'producto', 'articulo', 'detalle', 'item', 'nombre del producto', 'nombre producto'],
    precio: ['precio', 'price', 'precio venta', 'precio de venta', 'pvp', 'venta', 'precio publico', 'precio unitario', 'p venta', 'pv'],
    costo: ['costo', 'cost', 'costo compra', 'costo de compra', 'costo unitario', 'compra', 'p costo', 'pc', 'costprice'],
    stock: ['stock', 'existencia', 'existencias', 'cantidad', 'inventario', 'qty', 'cant', 'disponible', 'unidades'],
    minStock: ['minstock', 'min stock', 'stock minimo', 'minimo', 'min', 'reorden', 'punto de reorden'],
    categoria: ['categoria', 'category', 'rubro', 'familia', 'linea', 'grupo', 'departamento', 'seccion', 'tipo'],
    unidad: ['unidad', 'unit', 'medida', 'unidad de medida', 'um', 'presentacion', 'empaque'],
    // 'descripcion' es secundaria: si el archivo NO trae columna de nombre,
    // "Descripción" ES el nombre (el Excel clásico del sobrino).
    descripcion: ['descripcion', 'description', 'observaciones', 'notas', 'detalle largo'],
    modoVenta: ['modo venta', 'modo de venta', 'sale mode', 'salemode', 'venta por', 'tipo cantidad'],
    pasoCantidad: ['paso cantidad', 'paso de cantidad', 'quantity step', 'quantitystep', 'incremento', 'precision cantidad'],
    // `familia` solo conserva su significado histórico de categoría. Para la
    // clasificación operativa nueva exigimos un encabezado no ambiguo.
    familiaProducto: ['familia producto', 'familia de producto', 'product family', 'productfamily', 'giro producto'],
    unidadEmpaque: ['unidad empaque', 'unidad de empaque', 'pack unit', 'packunit', 'tipo empaque', 'empaque compra'],
    tamanoEmpaque: ['tamano empaque', 'tamano de empaque', 'pack size', 'packsize', 'unidades por empaque', 'contenido empaque', 'factor empaque'],
    precioEmpaque: ['precio empaque', 'precio de empaque', 'precio por empaque', 'pack price', 'packprice'],
    requiereLote: ['requiere lote', 'seguimiento lote', 'seguimiento de lote', 'control lote', 'control de lote', 'batch tracking', 'requires batch tracking', 'lote'],
    ivaExento: ['iva exento', 'exento iva', 'exento de iva', 'ivaexento', 'tax exempt'],
};

/** Resuelve qué encabezado del archivo alimenta cada campo canónico. */
export function resolveColumns(headers: string[]): ColumnResolution {
    const normalized = headers.map(h => ({ original: h, norm: normalizeKey(h) }));
    const used = new Set<string>();
    const mapping = {} as Record<CanonicalField, string | null>;

    const fields = Object.keys(SYNONYMS) as CanonicalField[];
    for (const field of fields) {
        mapping[field] = null;
        for (const syn of SYNONYMS[field]) {
            const hit = normalized.find(h => h.norm === syn && !used.has(h.original));
            if (hit) {
                mapping[field] = hit.original;
                used.add(hit.original);
                break;
            }
        }
    }

    // Fallback del Excel real: sin columna "nombre" pero con "Descripción" →
    // la descripción es el nombre.
    if (!mapping.nombre && mapping.descripcion) {
        mapping.nombre = mapping.descripcion;
        mapping.descripcion = null;
    }

    const unknown = normalized.filter(h => !used.has(h.original)).map(h => h.original);
    const missing: CanonicalField[] = [];
    if (!mapping.nombre) missing.push('nombre');
    if (!mapping.precio) missing.push('precio');
    if (!mapping.sku) missing.push('sku');

    return { mapping, unknown, missing };
}

/** Nombres aceptados por campo, para el mensaje de error de columnas. */
export function acceptedHeaders(field: CanonicalField): string[] {
    return SYNONYMS[field];
}

// ── Dinero y cantidades ──────────────────────────────────────────────────────

/**
 * Parsea un monto "a la nica". Devuelve null si es ilegible — el caller decide
 * si eso rechaza la fila (precio) o usa default (costo/stock vacíos).
 */
export function parseMoneyNi(raw: unknown): number | null {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'number') {
        return Number.isFinite(raw) ? raw : null;
    }
    let s = String(raw)
        .replace(/\u00A0/g, ' ')               // NBSP de Excel
        .replace(/(c\$|u\$s?|us\$|\$)/gi, '')    // monedas como decoración
        .replace(/\s+/g, '')
        .trim();
    if (s === '' || s === '-') return null;

    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');

    if (lastComma !== -1 && lastDot !== -1) {
        // Ambos: el último es el decimal, el otro es miles.
        if (lastDot > lastComma) {
            s = s.replace(/,/g, '');                       // 1,250.50 → 1250.50
        } else {
            s = s.replace(/\./g, '').replace(',', '.');    // 1.250,50 → 1250.50
        }
    } else if (lastComma !== -1) {
        const decimals = s.length - lastComma - 1;
        const commas = (s.match(/,/g) || []).length;
        if (commas === 1 && decimals >= 1 && decimals <= 2) {
            s = s.replace(',', '.');                       // 18,50 → 18.50
        } else {
            s = s.replace(/,/g, '');                       // 1,250 → 1250
        }
    }
    // Solo punto (o nada): el punto ya es decimal (385.00).

    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
}

/**
 * SKU saneado: Excel convierte códigos de barras largos a número (y a notación
 * científica: 7.43E+12). Se restauran como dígitos completos.
 */
export function normalizeSku(raw: unknown): string {
    if (raw === null || raw === undefined) return '';
    if (typeof raw === 'number') {
        return Number.isFinite(raw) ? raw.toFixed(0) : '';
    }
    const s = String(raw).trim();
    // "7.43E+12" / "7,43E+12" pegado como texto
    if (/^\d+([.,]\d+)?e\+?\d+$/i.test(s)) {
        const n = Number(s.replace(',', '.'));
        if (Number.isFinite(n)) return n.toFixed(0);
    }
    return s.toUpperCase();
}

const text = (value: unknown): string =>
    value === null || value === undefined ? '' : String(value).trim();

const SALE_MODE_ALIASES: Record<string, ImportedSaleMode> = {
    counted: 'COUNTED', contado: 'COUNTED', unidad: 'COUNTED', unidades: 'COUNTED', piezas: 'COUNTED', pieza: 'COUNTED',
    measured: 'MEASURED', medido: 'MEASURED', peso: 'MEASURED', 'por peso': 'MEASURED',
    pesable: 'MEASURED', granel: 'MEASURED', medida: 'MEASURED', 'por medida': 'MEASURED',
};

const FAMILY_ALIASES: Record<string, ImportedProductFamily> = {
    general: 'GENERAL',
    meat: 'MEAT', carne: 'MEAT', carnes: 'MEAT', carniceria: 'MEAT',
    poultry: 'POULTRY', pollo: 'POULTRY', pollos: 'POULTRY', aves: 'POULTRY',
    animalfeed: 'ANIMAL_FEED', 'animal feed': 'ANIMAL_FEED', alimentoanimal: 'ANIMAL_FEED', 'alimento animal': 'ANIMAL_FEED', concentrado: 'ANIMAL_FEED',
    agroinput: 'AGRO_INPUT', 'agro input': 'AGRO_INPUT', agroinsumo: 'AGRO_INPUT', agroinsumos: 'AGRO_INPUT',
    veterinary: 'VETERINARY', veterinaria: 'VETERINARY', veterinario: 'VETERINARY',
};

export function parseImportedSaleMode(raw: unknown): ImportedSaleMode | null {
    const normalized = normalizeKey(text(raw));
    if (!normalized) return null;
    return SALE_MODE_ALIASES[normalized] ?? SALE_MODE_ALIASES[normalized.replace(/ /g, '')] ?? null;
}

export function parseImportedProductFamily(raw: unknown): ImportedProductFamily | null {
    const normalized = normalizeKey(text(raw));
    if (!normalized) return null;
    return FAMILY_ALIASES[normalized] ?? FAMILY_ALIASES[normalized.replace(/ /g, '')] ?? null;
}

const BOOLEAN_TRUE = new Set(['1', 'si', 's', 'true', 'yes', 'y', 'x', 'requiere', 'exento']);
const BOOLEAN_FALSE = new Set(['0', 'no', 'n', 'false', 'gravado']);

/** Booleanos habituales de Excel/CSV en español; vacío queda a cargo del default. */
export function parseBooleanNi(raw: unknown): boolean | null {
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'number') {
        if (raw === 1) return true;
        if (raw === 0) return false;
        return null;
    }
    const normalized = normalizeKey(text(raw));
    if (!normalized) return null;
    if (BOOLEAN_TRUE.has(normalized)) return true;
    if (BOOLEAN_FALSE.has(normalized)) return false;
    return null;
}

/** Decimal de cantidad (hasta 4 d.p.); `,` se admite como separador decimal. */
export function parseQuantityNi(raw: unknown): number | null {
    if (raw === null || raw === undefined || text(raw) === '') return null;
    let normalized = text(raw).replace(/\s+/g, '');
    if (normalized.includes(',') && normalized.includes('.')) {
        const comma = normalized.lastIndexOf(',');
        const dot = normalized.lastIndexOf('.');
        normalized = dot > comma
            ? normalized.replace(/,/g, '')
            : normalized.replace(/\./g, '').replace(',', '.');
    } else if (normalized.includes(',')) {
        normalized = normalized.replace(',', '.');
    }
    if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
    try {
        const value = new Decimal(normalized);
        if (!value.isFinite() || !value.greaterThan(0) || value.decimalPlaces() > 4) return null;
        return value.toNumber();
    } catch {
        return null;
    }
}

// ── Parseo de filas ──────────────────────────────────────────────────────────

const cell = (row: Record<string, unknown>, header: string | null): unknown =>
    header === null ? undefined : row[header];

/**
 * Parsea las filas crudas de sheet_to_json con la resolución de columnas.
 * `firstDataRow` = fila Excel de la primera fila de datos (2 si el encabezado
 * es la fila 1 — el default de sheet_to_json).
 */
export function parseProductRows(
    jsonData: Record<string, unknown>[],
    resolution: ColumnResolution,
    firstDataRow = 2,
): ParseResult {
    const { mapping } = resolution;
    const seenSku = new Map<string, number>(); // sku → fila Excel donde apareció

    const rows: ParsedRow[] = jsonData.map((raw, i) => {
        const excelRow = firstDataRow + i;
        const errors: string[] = [];

        const sku = normalizeSku(cell(raw, mapping.sku));
        const nombre = text(cell(raw, mapping.nombre));

        // Precio: ilegible o <= 0 rechaza la fila (nunca NaN con check verde).
        const precioRaw = cell(raw, mapping.precio);
        const precio = parseMoneyNi(precioRaw);

        // Costo/stock/minStock: vacío usa default; con contenido ilegible, rechaza
        // (mejor corregir la celda que importar un costo silenciosamente en 0).
        const costoRaw = cell(raw, mapping.costo);
        const costo = (costoRaw === undefined || text(costoRaw) === '') ? 0 : parseMoneyNi(costoRaw);
        const stockRaw = cell(raw, mapping.stock);
        const stock = (stockRaw === undefined || text(stockRaw) === '') ? 0 : parseMoneyNi(stockRaw);
        const minRaw = cell(raw, mapping.minStock);
        const minStock = (minRaw === undefined || text(minRaw) === '') ? 5 : parseMoneyNi(minRaw);

        const categoria = text(cell(raw, mapping.categoria)) || 'General';
        const unidad = text(cell(raw, mapping.unidad)) || 'unidad';
        const descripcion = text(cell(raw, mapping.descripcion));
        const modoRaw = cell(raw, mapping.modoVenta);
        const modoVenta = text(modoRaw) === '' ? 'COUNTED' : parseImportedSaleMode(modoRaw);
        const pasoRaw = cell(raw, mapping.pasoCantidad);
        const defaultStep = modoVenta === 'MEASURED' ? 0.001 : 1;
        const pasoCantidad = text(pasoRaw) === '' ? defaultStep : parseQuantityNi(pasoRaw);
        const familiaRaw = cell(raw, mapping.familiaProducto);
        const familiaProducto = text(familiaRaw) === '' ? 'GENERAL' : parseImportedProductFamily(familiaRaw);
        const unidadEmpaqueRaw = cell(raw, mapping.unidadEmpaque);
        const unidadEmpaque = text(unidadEmpaqueRaw) || null;
        const tamanoEmpaqueRaw = cell(raw, mapping.tamanoEmpaque);
        const tamanoEmpaque = text(tamanoEmpaqueRaw) === '' ? null : parseQuantityNi(tamanoEmpaqueRaw);
        const precioEmpaqueRaw = cell(raw, mapping.precioEmpaque);
        const precioEmpaque = text(precioEmpaqueRaw) === '' ? null : parseMoneyNi(precioEmpaqueRaw);
        const requiereLoteRaw = cell(raw, mapping.requiereLote);
        const requiereLote = text(requiereLoteRaw) === '' ? false : parseBooleanNi(requiereLoteRaw);
        const ivaExentoRaw = cell(raw, mapping.ivaExento);
        const ivaExento = text(ivaExentoRaw) === '' ? false : parseBooleanNi(ivaExentoRaw);

        if (!sku) errors.push('Sin código (SKU)');
        if (sku.length > 50) errors.push('Código muy largo (máx. 50)');
        if (!nombre) errors.push('Sin nombre');
        if (nombre.length > 200) errors.push('Nombre muy largo (máx. 200)');
        if (precio === null) errors.push(`Precio ilegible: "${text(precioRaw)}"`);
        else if (precio <= 0) errors.push('Precio debe ser mayor que 0');
        if (costo === null) errors.push(`Costo ilegible: "${text(costoRaw)}"`);
        else if (costo < 0) errors.push('Costo no puede ser negativo');
        if (stock === null) errors.push(`Existencia ilegible: "${text(stockRaw)}"`);
        else if (stock < 0) errors.push('Existencia no puede ser negativa');
        if (minStock === null) errors.push(`Mínimo ilegible: "${text(minRaw)}"`);
        else if (minStock < 0) errors.push('Mínimo no puede ser negativo');
        if (modoVenta === null) errors.push(`Modo de venta inválido: "${text(modoRaw)}"`);
        if (pasoCantidad === null) errors.push(`Paso de cantidad inválido: "${text(pasoRaw)}"`);
        if (familiaProducto === null) errors.push(`Familia de producto inválida: "${text(familiaRaw)}"`);
        if (text(tamanoEmpaqueRaw) !== '' && tamanoEmpaque === null) {
            errors.push(`Tamaño de empaque inválido: "${text(tamanoEmpaqueRaw)}"`);
        }
        if (text(precioEmpaqueRaw) !== '' && precioEmpaque === null) {
            errors.push(`Precio de empaque ilegible: "${text(precioEmpaqueRaw)}"`);
        } else if (precioEmpaque !== null && precioEmpaque <= 0) {
            errors.push('Precio de empaque debe ser mayor que 0');
        }
        if (text(requiereLoteRaw) !== '' && requiereLote === null) {
            errors.push(`Lote debe ser sí/no: "${text(requiereLoteRaw)}"`);
        }
        if (text(ivaExentoRaw) !== '' && ivaExento === null) {
            errors.push(`IVA exento debe ser sí/no: "${text(ivaExentoRaw)}"`);
        }
        if (unidadEmpaque && tamanoEmpaque === null) {
            errors.push('La unidad de empaque requiere tamaño de empaque');
        }
        if (!unidadEmpaque && tamanoEmpaque !== null) {
            errors.push('El tamaño de empaque requiere unidad de empaque');
        }
        if (precioEmpaque !== null && (!unidadEmpaque || tamanoEmpaque === null)) {
            errors.push('El precio de empaque requiere unidad y tamaño de empaque');
        }

        if (modoVenta && pasoCantidad !== null) {
            try {
                // Valida el propio paso (COUNTED exige entero) y cada cantidad
                // física importada como múltiplo exacto de ese paso.
                validateQuantity(pasoCantidad, { saleMode: modoVenta, quantityStep: pasoCantidad });
                for (const [label, value] of [['Existencia', stock], ['Mínimo', minStock]] as const) {
                    if (value === null || value === 0) continue;
                    try {
                        validateQuantity(value, { saleMode: modoVenta, quantityStep: pasoCantidad });
                    } catch (error) {
                        errors.push(`${label}: ${error instanceof Error ? error.message : 'cantidad inválida'}`);
                    }
                }
                if (tamanoEmpaque !== null) {
                    try {
                        validateQuantity(tamanoEmpaque, { saleMode: modoVenta, quantityStep: pasoCantidad });
                    } catch (error) {
                        errors.push(`Tamaño de empaque: ${error instanceof Error ? error.message : 'cantidad inválida'}`);
                    }
                }
            } catch (error) {
                errors.push(`Paso de cantidad: ${error instanceof Error ? error.message : 'inválido'}`);
            }
        }

        // Duplicados DENTRO del archivo: el upsert del backend haría que la
        // última fila pise a la primera sin aviso (auditoría E8).
        if (sku) {
            const firstAt = seenSku.get(sku);
            if (firstAt !== undefined) {
                errors.push(`Código repetido (ya está en la fila ${firstAt})`);
            } else {
                seenSku.set(sku, excelRow);
            }
        }

        return {
            excelRow,
            data: {
                sku, nombre, categoria,
                precio: precio ?? 0,
                costo: costo ?? 0,
                stock: stock ?? 0,
                minStock: minStock ?? 5,
                unidad, descripcion,
                modoVenta: modoVenta ?? 'COUNTED',
                pasoCantidad: pasoCantidad ?? defaultStep,
                familiaProducto: familiaProducto ?? 'GENERAL',
                unidadEmpaque,
                tamanoEmpaque,
                precioEmpaque: precioEmpaque ?? null,
                requiereLote: requiereLote ?? false,
                ivaExento: ivaExento ?? false,
            },
            valid: errors.length === 0,
            errors,
        };
    });

    return { rows, resolution };
}

/** Azúcar: leer encabezados de la primera fila cruda de sheet_to_json. */
export function parseWorkbookRows(jsonData: Record<string, unknown>[]): ParseResult {
    const headers = jsonData.length > 0 ? Object.keys(jsonData[0]) : [];
    return parseProductRows(jsonData, resolveColumns(headers));
}

// ── Troceado (auditoría E4: el tope de 500 se descubría al final) ────────────

export const IMPORT_CHUNK_SIZE = 200;

export interface ChunkedImportResult {
    created: number;
    updated: number;
    /** Mensajes de error del servidor, acumulados de todos los lotes. */
    serverErrors: string[];
    /** Lotes que fallaron completos (red/500): filas para reintentar. */
    failedChunks: number;
}

/**
 * Importa en lotes secuenciales de `chunkSize` vía `post` (inyectado: el
 * módulo no conoce fetch). `onProgress(enviados, total)` tras cada lote.
 * Un lote que falla completo NO detiene los siguientes.
 */
export async function importInChunks<T>(
    items: T[],
    post: (chunk: T[]) => Promise<{ created: number; updated: number; errors?: string[] }>,
    onProgress?: (done: number, total: number) => void,
    chunkSize = IMPORT_CHUNK_SIZE,
): Promise<ChunkedImportResult> {
    const result: ChunkedImportResult = { created: 0, updated: 0, serverErrors: [], failedChunks: 0 };
    for (let i = 0; i < items.length; i += chunkSize) {
        const chunk = items.slice(i, i + chunkSize);
        try {
            const r = await post(chunk);
            result.created += r.created || 0;
            result.updated += r.updated || 0;
            if (Array.isArray(r.errors)) result.serverErrors.push(...r.errors);
        } catch (e: any) {
            result.failedChunks++;
            result.serverErrors.push(`Lote de ${chunk.length} productos no se pudo enviar: ${e?.message || 'error de red'}`);
        }
        onProgress?.(Math.min(i + chunkSize, items.length), items.length);
    }
    return result;
}
