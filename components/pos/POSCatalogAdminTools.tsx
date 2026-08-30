import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, PackagePlus, Plus, Save, Upload, X } from 'lucide-react';
import type { Product } from '../../types';
import { sanitizeDecimalInput } from '../../utils/money';
import { parseWorkbookRows, importInChunks } from '../../utils/importProducts';
import { normalizeApiFailure, validateQuickProductDraft } from '../../utils/posActivation';

const MENSAJE_REQUERIDO = 'Completá este campo.';

const validacionEs = (mensaje: string = MENSAJE_REQUERIDO) => ({
    onInvalid: (event: React.InvalidEvent<HTMLInputElement | HTMLSelectElement>) => {
        event.currentTarget.setCustomValidity(mensaje);
    },
    onInput: (event: React.FormEvent<HTMLInputElement | HTMLSelectElement>) => {
        event.currentTarget.setCustomValidity('');
    },
});

type ProductDraft = {
    name: string;
    sku: string;
    price: string;
    costPrice: string;
    stock: string;
    category: string;
};

type ImportPreviewRow = {
    sku: string;
    name: string;
    price: string;
    cost: string;
    stock: string;
    minStock?: string;
    category?: string;
    unit?: string;
    excelRow: number;
};

type ImportProgress = { step: string; pct: number };
type ImportResult = { created: number; updated: number; errors: string[] };
type ToastPayload = { tone: 'warning' | 'error' | 'success'; title: string; message: string };

export interface POSCatalogAdminToolsProps {
    guidedSimpleMode: boolean;
    headers: HeadersInit;
    showAddModal: boolean;
    showImportModal: boolean;
    onOpenAddModal: () => void;
    onCloseAddModal: () => void;
    onOpenImportModal: () => void;
    onCloseImportModal: () => void;
    onProductCreated: (product: Product) => void;
    onProductsReload: () => void;
    showToast: (toast: ToastPayload) => void;
}

const INITIAL_PRODUCT_DRAFT: ProductDraft = {
    name: '',
    sku: '',
    price: '',
    costPrice: '',
    stock: '',
    category: 'General',
};

export default function POSCatalogAdminTools({
    guidedSimpleMode,
    headers,
    showAddModal,
    showImportModal,
    onOpenAddModal,
    onCloseAddModal,
    onOpenImportModal,
    onCloseImportModal,
    onProductCreated,
    onProductsReload,
    showToast,
}: POSCatalogAdminToolsProps) {
    const [newProduct, setNewProduct] = useState<ProductDraft>(INITIAL_PRODUCT_DRAFT);
    const [importData, setImportData] = useState<ImportPreviewRow[]>([]);
    const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
    const [importResult, setImportResult] = useState<ImportResult | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const resetImportState = useCallback(() => {
        setImportData([]);
        setImportProgress(null);
        setImportResult(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    }, []);

    useEffect(() => {
        if (!showImportModal) resetImportState();
    }, [resetImportState, showImportModal]);

    const closeImportModal = useCallback(() => {
        onCloseImportModal();
        resetImportState();
    }, [onCloseImportModal, resetImportState]);

    const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setImportProgress({ step: 'Leyendo archivo...', pct: 10 });
        setImportResult(null);

        const reader = new FileReader();
        reader.onload = async (loadEvent) => {
            try {
                // xlsx (~430 KB) entra aquí por import dinámico: no se mete al
                // bundle inicial del POS cuando la cajera nunca usa Excel.
                const XLSX = await import('xlsx');
                const data = loadEvent.target?.result;
                const workbook = XLSX.read(data, { type: 'binary' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet);

                setImportProgress({ step: `${jsonData.length} filas leídas`, pct: 30 });

                const parsed = parseWorkbookRows(jsonData as Record<string, unknown>[]);
                const valid = parsed.rows.filter((row) => row.valid).map((row) => ({
                    sku: row.data.sku,
                    name: row.data.nombre,
                    price: row.data.precio,
                    cost: row.data.costo,
                    stock: row.data.stock,
                    minStock: row.data.minStock,
                    category: row.data.categoria,
                    unit: row.data.unidad,
                    excelRow: row.excelRow,
                }));
                const skipped = parsed.rows.length - valid.length;

                setImportData(valid);
                setImportProgress({
                    step: skipped > 0
                        ? `${valid.length} productos listos (${skipped} filas con problemas — usá el importador de Inventario para ver el detalle)`
                        : `${valid.length} productos válidos listos`,
                    pct: 50,
                });
            } catch (error: any) {
                setImportProgress({ step: `Error: ${error.message}`, pct: 0 });
            }
        };

        reader.readAsBinaryString(file);
    }, []);

    const executeImport = useCallback(async () => {
        if (importData.length === 0) return;

        setImportProgress({ step: 'Enviando al servidor...', pct: 60 });

        const result = await importInChunks(
            importData,
            async (chunk) => {
                const response = await fetch('/api/products/bulk', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ products: chunk }),
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
                return data;
            },
            (done, total) => setImportProgress({
                step: `Importando… ${done} de ${total}`,
                pct: 60 + Math.round((done / Math.max(1, total)) * 40),
            }),
        );

        setImportProgress({ step: 'Completado', pct: 100 });
        setImportResult({ created: result.created, updated: result.updated, errors: result.serverErrors });
        onProductsReload();
    }, [headers, importData, onProductsReload]);

    const handleCreateProduct = useCallback(async (event: React.FormEvent) => {
        event.preventDefault();
        const validated = validateQuickProductDraft({
            name: newProduct.name,
            sku: newProduct.sku,
            price: newProduct.price,
            cost: newProduct.costPrice,
            stock: newProduct.stock,
        }, `SKU-${Date.now().toString(36).toUpperCase()}`);

        if ('errors' in validated) {
            showToast({
                tone: 'warning',
                title: 'Revisá el producto',
                message: Object.values(validated.errors)[0] || 'Hay datos inválidos.',
            });
            return;
        }

        try {
            const response = await fetch('/api/products', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    ...validated.payload,
                    category: newProduct.category,
                }),
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                const failure = normalizeApiFailure(response.status, data, 'No pudimos guardar el producto.');
                throw new Error(Object.values(failure.fields)[0] || failure.message);
            }

            onProductCreated({
                id: data.id,
                name: data.name,
                sku: data.sku,
                category: data.category || newProduct.category,
                price: data.price,
                costPrice: data.cost,
                stock: data.stock,
                wholesalePrice: data.wholesalePrice ?? null,
                wholesaleMinQty: data.wholesaleMinQty ?? null,
                packUnit: data.packUnit ?? null,
                packSize: data.packSize ?? null,
                packPrice: data.packPrice ?? null,
                unit: data.unit ?? 'unidad',
                saleMode: data.saleMode ?? 'COUNTED',
                quantityStep: data.quantityStep ?? 1,
            });
            onCloseAddModal();
            setNewProduct(INITIAL_PRODUCT_DRAFT);
        } catch (error: any) {
            showToast({
                tone: 'error',
                title: 'No se pudo guardar el producto',
                message: error?.message ? `Error: ${error.message}` : 'Reintentá en un momento.',
            });
        }
    }, [headers, newProduct, onCloseAddModal, onProductCreated, showToast]);

    return (
        <>
            {!guidedSimpleMode && (
                <>
                    <button
                        onClick={onOpenAddModal}
                        className="bg-nortex-500 text-white px-3 rounded-xl flex items-center gap-1.5 font-medium text-sm hover:bg-nortex-600 transition-all"
                        title="Crear producto completo"
                    >
                        <Plus size={18} /> Nuevo
                    </button>
                    <button
                        onClick={onOpenImportModal}
                        className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-3 rounded-xl flex items-center gap-1.5 font-bold text-sm hover:from-blue-700 hover:to-indigo-700 shadow-md transition-all"
                        title="Importar desde Excel"
                    >
                        <Upload size={18} /> Excel
                    </button>
                </>
            )}

            {showAddModal && (
                <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-surface-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-white/[0.06] text-slate-100">
                        <div className="p-5 border-b border-white/[0.04] flex justify-between items-center bg-surface-800/40 text-slate-100">
                            <h3 className="font-bold text-slate-100 flex items-center gap-2">
                                <PackagePlus size={20} className="text-nortex-500" /> Nuevo Producto
                            </h3>
                            <button onClick={onCloseAddModal} className="text-slate-400 hover:text-red-500 transition-colors">
                                <X size={24} />
                            </button>
                        </div>

                        <form onSubmit={handleCreateProduct} className="p-6 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="col-span-2">
                                    <label className="block text-xs font-mono text-slate-500 mb-1">NOMBRE DEL PRODUCTO *</label>
                                    <input
                                        type="text"
                                        required
                                        {...validacionEs('Escribí el nombre del producto.')}
                                        className="w-full px-3 py-2 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-nortex-500 text-slate-100"
                                        placeholder="Ej. Taladro Percutor 500W"
                                        value={newProduct.name}
                                        onChange={(event) => setNewProduct({ ...newProduct, name: event.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-mono text-slate-500 mb-1">SKU / CÓDIGO DE BARRAS</label>
                                    <input
                                        type="text"
                                        className="w-full px-3 py-2 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-nortex-500 text-slate-100"
                                        placeholder="Escaneá o escribí"
                                        value={newProduct.sku}
                                        onChange={(event) => setNewProduct({ ...newProduct, sku: event.target.value.toUpperCase() })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-mono text-slate-500 mb-1">CATEGORÍA</label>
                                    <select
                                        className="w-full px-3 py-2 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-nortex-500 bg-surface-900"
                                        value={newProduct.category}
                                        onChange={(event) => setNewProduct({ ...newProduct, category: event.target.value })}
                                    >
                                        <option>General</option>
                                        <option>Construcción</option>
                                        <option>Ferretería</option>
                                        <option>Herramientas</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-mono text-slate-500 mb-1">PRECIO VENTA *</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        required
                                        {...validacionEs('Ingresá el precio de venta.')}
                                        className="w-full px-3 py-2 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-nortex-500 text-slate-100 font-mono tabular-nums"
                                        placeholder="0.00"
                                        value={newProduct.price}
                                        onChange={(event) => setNewProduct({ ...newProduct, price: sanitizeDecimalInput(event.target.value) })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-mono text-slate-500 mb-1">COSTO (COMPRA) *</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        required
                                        {...validacionEs('Ingresá el costo del producto.')}
                                        className="w-full px-3 py-2 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-nortex-500 bg-surface-800/40 text-slate-100 font-mono tabular-nums"
                                        placeholder="0.00"
                                        value={newProduct.costPrice}
                                        onChange={(event) => setNewProduct({ ...newProduct, costPrice: sanitizeDecimalInput(event.target.value) })}
                                    />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-xs font-mono text-slate-500 mb-1">STOCK INICIAL *</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        required
                                        {...validacionEs('Ingresá el stock inicial (puede ser 0).')}
                                        className="w-full px-3 py-2 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-nortex-500 text-slate-100 font-mono tabular-nums"
                                        placeholder="0"
                                        value={newProduct.stock}
                                        onChange={(event) => setNewProduct({ ...newProduct, stock: sanitizeDecimalInput(event.target.value) })}
                                    />
                                </div>
                            </div>
                            <button type="submit" className="btn-primary w-full py-3 flex items-center justify-center gap-2">
                                <Save size={18} /> Guardar en Inventario
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {showImportModal && (
                <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-surface-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-white/[0.06]">
                        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-4 flex items-center justify-between">
                            <h3 className="font-bold text-white flex items-center gap-2">
                                <Upload size={18} /> Importar Productos (Excel/CSV)
                            </h3>
                            <button onClick={closeImportModal} className="text-white/80 hover:text-white">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="p-6 space-y-4">
                            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
                                <p className="text-xs text-blue-300 font-medium mb-1">Columnas esperadas en el archivo:</p>
                                <p className="text-[11px] text-blue-400 font-mono">Nombre | SKU | Precio | Costo | Stock | Categoria | Unidad</p>
                                <p className="text-[10px] text-blue-400 mt-1">Acepta .xlsx y .csv. Los nombres de columna son flexibles (Nombre/name/producto, etc.)</p>
                            </div>

                            <div>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept=".xlsx,.xls,.csv"
                                    onChange={handleFileUpload}
                                    className="w-full text-sm text-slate-300 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:font-bold file:bg-blue-500/15 file:text-blue-400 hover:file:bg-blue-200 file:cursor-pointer"
                                />
                            </div>

                            {importProgress && (
                                <div>
                                    <div className="flex justify-between text-xs mb-1">
                                        <span className="text-slate-300 font-medium">{importProgress.step}</span>
                                        <span className="text-slate-500">{importProgress.pct}%</span>
                                    </div>
                                    <div className="w-full bg-white/[0.06] rounded-full h-2.5 overflow-hidden">
                                        <div
                                            className="bg-gradient-to-r from-blue-500 to-indigo-500 h-full rounded-full transition-all duration-500"
                                            style={{ width: `${importProgress.pct}%` }}
                                        />
                                    </div>
                                </div>
                            )}

                            {importData.length > 0 && !importResult && (
                                <div>
                                    <p className="text-sm font-bold text-slate-200 mb-2">Vista previa ({importData.length} productos):</p>
                                    <div className="max-h-40 overflow-y-auto border border-white/[0.06] rounded-lg">
                                        <table className="w-full text-xs">
                                            <thead className="bg-white/[0.04] sticky top-0">
                                                <tr>
                                                    <th className="text-left px-2 py-1.5 text-slate-300">SKU</th>
                                                    <th className="text-left px-2 py-1.5 text-slate-300">Nombre</th>
                                                    <th className="text-right px-2 py-1.5 text-slate-300">Precio</th>
                                                    <th className="text-right px-2 py-1.5 text-slate-300">Stock</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-white/[0.04]">
                                                {importData.slice(0, 10).map((row, index) => (
                                                    <tr key={index} className="hover:bg-surface-800/40">
                                                        <td className="px-2 py-1 font-mono text-slate-500">{row.sku}</td>
                                                        <td className="px-2 py-1 text-slate-200">{row.name}</td>
                                                        <td className="px-2 py-1 text-right text-slate-200">{row.price}</td>
                                                        <td className="px-2 py-1 text-right text-slate-200">{row.stock}</td>
                                                    </tr>
                                                ))}
                                                {importData.length > 10 && (
                                                    <tr>
                                                        <td colSpan={4} className="text-center py-1 text-slate-400 text-[10px]">
                                                            ... y {importData.length - 10} mas
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>

                                    <button
                                        onClick={executeImport}
                                        className="w-full mt-3 py-3 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold hover:from-blue-700 hover:to-indigo-700 shadow-lg flex items-center justify-center gap-2"
                                    >
                                        <Upload size={18} /> Importar {importData.length} Productos
                                    </button>
                                </div>
                            )}

                            {importResult && (
                                <div className="space-y-3">
                                    <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-4 text-center">
                                        <Check size={32} className="text-emerald-500 mx-auto mb-2" />
                                        <p className="font-bold text-emerald-300">Importación Completada</p>
                                        <div className="flex justify-center gap-6 mt-2">
                                            <div>
                                                <p className="text-2xl font-bold text-emerald-400">{importResult.created}</p>
                                                <p className="text-[10px] text-emerald-400">Creados</p>
                                            </div>
                                            <div>
                                                <p className="text-2xl font-bold text-blue-400">{importResult.updated}</p>
                                                <p className="text-[10px] text-blue-400">Actualizados</p>
                                            </div>
                                        </div>
                                    </div>

                                    {importResult.errors.length > 0 && (
                                        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                                            <p className="text-xs font-bold text-red-400 mb-1">Errores ({importResult.errors.length}):</p>
                                            <ul className="text-[10px] text-red-400 space-y-0.5 max-h-20 overflow-y-auto">
                                                {importResult.errors.map((error, index) => (
                                                    <li key={index}>{error}</li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}

                                    <button
                                        onClick={closeImportModal}
                                        className="w-full py-3 rounded-lg bg-slate-800 text-white font-bold hover:bg-slate-900"
                                    >
                                        Cerrar
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
