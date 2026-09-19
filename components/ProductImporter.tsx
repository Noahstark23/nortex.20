import React, { useState, useRef, useEffect } from 'react';
import { Upload, Download, FileSpreadsheet, AlertCircle, CheckCircle, XCircle, Loader2, X, Columns3 } from 'lucide-react';
// xlsx (~430 KB) se importa DINÁMICAMENTE dentro de cada handler: solo baja al
// navegador cuando alguien importa/exporta un Excel, nunca en el bundle inicial.
import {
    parseWorkbookRows, acceptedHeaders, importInChunks, buildImportedProductPayload,
    type ParsedRow, type ColumnResolution, type CanonicalField,
} from '../utils/importProducts';
import { formatMoney } from '../utils/money';

interface ProductImporterProps {
    onClose: () => void;
    onSuccess: () => void;
}

interface ImportWarehouse { id: string; name: string; isActive: boolean; isDefault?: boolean }

/** Etiquetas humanas de los campos canónicos para el resumen de mapeo. */
const FIELD_LABELS: Record<CanonicalField, string> = {
    sku: 'Código', nombre: 'Nombre', precio: 'Precio', costo: 'Costo',
    stock: 'Existencia', minStock: 'Mínimo', marca: 'Marca', categoria: 'Categoría',
    unidad: 'Unidad', descripcion: 'Descripción',
    modoVenta: 'Forma de venta', pasoCantidad: 'Paso', familiaProducto: 'Familia operativa',
    unidadEmpaque: 'Unidad de empaque', tamanoEmpaque: 'Tamaño de empaque',
    precioEmpaque: 'Precio de empaque', requiereLote: 'Control por lote',
    ivaExento: 'IVA exento',
};

interface ImportSummary {
    created: number;
    updated: number;
    /** Rechazados: los inválidos del archivo + los errores del servidor. */
    rejected: { excelRow: number | null; sku: string; motivo: string }[];
    failedChunks: number;
    uncertain: { excelRow: number | null; sku: string; reason: string }[];
}

const ProductImporter: React.FC<ProductImporterProps> = ({ onClose, onSuccess }) => {
    const [rows, setRows] = useState<ParsedRow[]>([]);
    const [resolution, setResolution] = useState<ColumnResolution | null>(null);
    const [loading, setLoading] = useState(false);
    const [importing, setImporting] = useState(false);
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
    const [summary, setSummary] = useState<ImportSummary | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const importingRef = useRef(false);
    const [includeInitialStock, setIncludeInitialStock] = useState(false);
    const [warehouses, setWarehouses] = useState<ImportWarehouse[]>([]);
    const [warehouseId, setWarehouseId] = useState('');
    const [warehousesLoading, setWarehousesLoading] = useState(false);
    const [warehousesError, setWarehousesError] = useState('');
    const [warehouseReload, setWarehouseReload] = useState(0);
    const [fileError, setFileError] = useState('');
    const initialWarehouseReady = !warehousesLoading && !warehousesError && warehouses.some(warehouse => warehouse.id === warehouseId);
    useEffect(() => {
        if (!includeInitialStock) return;
        const controller = new AbortController();
        let active = true;
        setWarehousesLoading(true);
        setWarehousesError('');
        void fetch('/api/warehouses', {
            headers: { Authorization: `Bearer ${localStorage.getItem('nortex_token')}` },
            signal: controller.signal,
        }).then(async response => {
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'No pudimos cargar las bodegas. Reintentá.');
            if (!Array.isArray(data.data)) throw new Error('No pudimos leer la lista de bodegas. Reintentá.');
            if (!active) return;
            const available: ImportWarehouse[] = data.data.filter((warehouse: ImportWarehouse) =>
                warehouse?.isActive === true && typeof warehouse.id === 'string' && typeof warehouse.name === 'string');
            setWarehouses(available);
            setWarehouseId(current => available.some(warehouse => warehouse.id === current)
                ? current : available.length === 1 ? available[0].id : '');
            if (!available.length) setWarehousesError('No hay bodegas activas. Activá una bodega y reintentá la carga.');
        }).catch(error => {
            if (!active) return;
            setWarehouses([]);
            setWarehouseId('');
            setWarehousesError(error instanceof Error ? error.message : 'No pudimos cargar las bodegas. Reintentá.');
        }).finally(() => { if (active) setWarehousesLoading(false); });
        return () => { active = false; controller.abort(); };
    }, [includeInitialStock, warehouseReload]);
    // En actualización comercial la columna de existencias no se envía;
    // tampoco debe impedir corregir un precio por un dato que se conserva.
    const effectiveRows = rows.map(row => {
        const errors = includeInitialStock ? row.errors : row.errors.filter(error => !error.startsWith('Existencia'));
        return { ...row, errors, valid: errors.length === 0 };
    });
    const requestClose = () => { if (!importingRef.current && !loading) onClose(); };
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') requestClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [loading, onClose]);

    // Manejar archivo — el parseo/validación vive en utils/importProducts.ts
    // (puro y testeado): sinónimos de encabezados nicas, dinero con "C$"/comas,
    // códigos en notación científica, duplicados dentro del archivo.
    const handleFile = (file: File) => {
        if (importingRef.current) return;
        setLoading(true);
        setRows([]);
        setResolution(null);
        setFileError('');
        setSummary(null);
        const reader = new FileReader();

        reader.onload = async (e) => {
            try {
                const XLSX = await import('xlsx');
                const data = e.target?.result;
                const workbook = XLSX.read(data, { type: 'binary' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: '' }) as Record<string, unknown>[];

                const result = parseWorkbookRows(jsonData);
                setRows(result.rows);
                setResolution(result.resolution);
            } catch (error) {
                setFileError('No pudimos leer el archivo. Verificá que sea un Excel/CSV válido.');
            } finally {
                setLoading(false);
            }
        };

        reader.onerror = () => { setLoading(false); setFileError('No pudimos leer el archivo. Volvé a seleccionarlo.'); };
        reader.readAsBinaryString(file);
    };

    // Drag & Drop
    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
    };

    // Click selección
    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) handleFile(file);
    };

    // Descargar plantilla
    const downloadTemplate = async () => {
        const XLSX = await import('xlsx');
        // Ejemplos de una PyME nica (ferretería/pulpería/farmacia) con precios
        // realistas en córdobas (C$). El dueño reemplaza estas filas con su catálogo.
        const template = [
            {
                sku: 'CEM001',
                nombre: 'Cemento Canal 42.5kg',
                categoria: 'Construcción', marca: 'Ejemplo',
                precio: 385.00,
                costo: 330.00,
                stock: 40,
                minStock: 10,
                unidad: 'saco',
                descripcion: 'Cemento gris uso general',
                modoVenta: 'COUNTED',
                pasoCantidad: 1,
                familiaProducto: 'GENERAL',
                unidadEmpaque: '',
                tamanoEmpaque: '',
                precioEmpaque: '',
                requiereLote: 'NO',
                ivaExento: 'NO',
            },
            {
                sku: 'COCA600',
                nombre: 'Coca-Cola 600ml',
                categoria: 'Bebidas',
                precio: 25.00,
                costo: 18.00,
                stock: 120,
                minStock: 24,
                unidad: 'unidad',
                descripcion: '',
                modoVenta: 'COUNTED',
                pasoCantidad: 1,
                familiaProducto: 'GENERAL',
                unidadEmpaque: 'caja',
                tamanoEmpaque: 24,
                precioEmpaque: 540,
                requiereLote: 'NO',
                ivaExento: 'NO',
            },
            {
                sku: 'ACE500',
                nombre: 'Acetaminofén 500mg (tableta)',
                categoria: 'Farmacia',
                precio: 3.50,
                costo: 2.00,
                stock: 500,
                minStock: 50,
                unidad: 'unidad',
                descripcion: 'Analgésico / antipirético',
                modoVenta: 'COUNTED',
                pasoCantidad: 1,
                familiaProducto: 'GENERAL',
                unidadEmpaque: 'caja',
                tamanoEmpaque: 100,
                precioEmpaque: 300,
                requiereLote: 'SÍ',
                ivaExento: 'SÍ',
            },
            {
                sku: 'RESKG',
                nombre: 'Posta de res',
                categoria: 'Carnes',
                precio: 145,
                costo: 112,
                stock: 37.5,
                minStock: 5,
                unidad: 'kg',
                descripcion: 'Venta por peso',
                modoVenta: 'MEASURED',
                pasoCantidad: 0.001,
                familiaProducto: 'MEAT',
                unidadEmpaque: '',
                tamanoEmpaque: '',
                precioEmpaque: '',
                requiereLote: 'SÍ',
                ivaExento: 'NO',
            },
            {
                sku: 'CERDO-SACO',
                nombre: 'Concentrado para cerdo',
                categoria: 'Alimento animal',
                precio: 16,
                costo: 12.5,
                stock: 200,
                minStock: 50,
                unidad: 'lb',
                descripcion: 'Compra y venta por libra o saco',
                modoVenta: 'MEASURED',
                pasoCantidad: 0.25,
                familiaProducto: 'ANIMAL_FEED',
                unidadEmpaque: 'saco',
                tamanoEmpaque: 100,
                precioEmpaque: 1500,
                requiereLote: 'SÍ',
                ivaExento: 'NO',
            }
        ];

        const worksheet = XLSX.utils.json_to_sheet(template);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Productos');
        XLSX.writeFile(workbook, 'plantilla_productos_nortex.xlsx');
    };

    // Importar a backend en LOTES de 200 secuenciales (auditoría E4: antes un
    // solo POST y el tope de 500 del server se descubría al final, con 0
    // productos cargados y un alert).
    const handleImport = async () => {
        const validRows = effectiveRows.filter(r => r.valid);
        if (validRows.length === 0 || importingRef.current || (includeInitialStock && !initialWarehouseReady)) return;
        importingRef.current = true;

        setImporting(true);
        setProgress({ done: 0, total: validRows.length });

        const token = localStorage.getItem('nortex_token');
        const result = await importInChunks<ParsedRow>(
            validRows,
            async (chunk) => {
                const res = await fetch('/api/products/bulk', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        products: chunk.map(row => buildImportedProductPayload(row, { includeInitialStock })),
                        ...(includeInitialStock ? { warehouseId } : {}),
                    })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
                return data;
            },
            (done, total) => setProgress({ done, total }),
        );

        // Resumen: rechazados del archivo (con su fila real) + errores del server.
        const rejected: ImportSummary['rejected'] = [
            ...effectiveRows.filter(r => !r.valid).map(r => ({
                excelRow: r.excelRow,
                sku: r.data.sku || '—',
                motivo: r.errors.join(' · '),
            })),
            ...result.serverErrors.filter(message => !message.startsWith('Lote de ')).map(motivo => {
                const match = motivo.match(/^Fila (\d+)/);
                const excelRow = match ? Number(match[1]) : null;
                return { excelRow, sku: rows.find(row => row.excelRow === excelRow)?.data.sku ?? '—', motivo };
            }),
        ];
        setSummary({ created: result.created, updated: result.updated, rejected, failedChunks: result.failedChunks, uncertain: result.uncertainRows });
        importingRef.current = false;
        setImporting(false);
        setProgress(null);
        if (result.created + result.updated > 0 || result.uncertainRows.length > 0) onSuccess();
    };

    // Descargar los rechazados como Excel para corregir y re-subir SOLO eso.
    const downloadRejected = async () => {
        if (!summary || summary.rejected.length === 0) return;
        const XLSX = await import('xlsx');
        const sheetRows = summary.rejected.map(r => ({
            ...rows.find(row => row.excelRow === r.excelRow)?.source,
            fila_excel: r.excelRow ?? '',
            codigo: r.sku,
            motivo: r.motivo,
        }));
        const worksheet = XLSX.utils.json_to_sheet(sheetRows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Rechazados');
        XLSX.writeFile(workbook, 'productos_rechazados_nortex.xlsx');
    };

    const downloadUncertain = async () => {
        if (!summary?.uncertain.length) return;
        const XLSX = await import('xlsx');
        const workbook = XLSX.utils.book_new();
        const pending = summary.uncertain.map(row => ({
            ...rows.find(source => source.excelRow === row.excelRow)?.source,
            fila_excel: row.excelRow ?? '', codigo: row.sku,
            estado: 'SIN CONFIRMAR: verificar en catálogo antes de reenviar', motivo: row.reason,
        }));
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(pending), 'Por verificar');
        XLSX.writeFile(workbook, 'productos_por_verificar_nortex.xlsx');
    };

    const validCount = effectiveRows.filter(r => r.valid).length;
    const errorCount = effectiveRows.filter(r => !r.valid).length;
    const missingCols = resolution?.missing.filter(f => f !== 'sku') ?? [];

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={requestClose}>
            <div role="dialog" aria-modal="true" aria-label="Importar productos" className="nx-dark-context bg-surface-800 rounded-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden shadow-2xl border border-surface-700" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="bg-gradient-to-r from-brand-900/40 to-brand-900/20 px-6 py-4 border-b border-surface-700 flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                            <Upload size={20} className="text-brand-400" />
                            Importar productos
                        </h2>
                        <p className="text-sm text-surface-400 mt-1">Revisá tu Excel o CSV antes de aplicar los cambios</p>
                    </div>
                    <button disabled={importing || loading} onClick={requestClose} aria-label="Cerrar importador" className="p-2 hover:bg-surface-700 rounded-lg text-surface-400 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(90vh-180px)]">
                    {fileError && <p role="alert" className="rounded-lg bg-red-950/60 p-3 text-red-300">{fileError}</p>}
                    {/* Upload Zone */}
                    {rows.length === 0 && !summary && (
                        <div>
                            <div
                                onDrop={handleDrop}
                                onDragOver={(e) => e.preventDefault()}
                                onClick={() => fileInputRef.current?.click()}
                                className="border-2 border-dashed border-surface-600 rounded-xl p-12 text-center cursor-pointer hover:border-brand-500 hover:bg-surface-700/20 transition-all"
                            >
                                {loading ? (
                                    <div className="flex flex-col items-center gap-3">
                                        <Loader2 className="animate-spin text-brand-400" size={48} />
                                        <p className="text-surface-400">Procesando archivo...</p>
                                    </div>
                                ) : (
                                    <>
                                        <FileSpreadsheet size={48} className="mx-auto text-brand-400 mb-4" />
                                        <p className="text-lg text-white font-semibold mb-2">Arrastra tu archivo Excel/CSV aquí</p>
                                        <p className="text-sm text-surface-400 mb-4">o haz click para seleccionar</p>
                                        <p className="text-xs text-surface-500">Formatos: .xlsx, .xls, .csv · envío en lotes de 200</p>
                                    </>
                                )}
                            </div>

                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".xlsx,.xls,.csv"
                                className="hidden"
                                onChange={handleFileSelect}
                            />

                            <div className="mt-4 flex justify-center">
                                <button
                                    onClick={downloadTemplate}
                                    className="flex items-center gap-2 px-4 py-2 bg-surface-700 hover:bg-surface-600 rounded-lg text-white font-medium transition-colors"
                                >
                                    <Download size={18} />
                                    Descargar Plantilla Excel
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Resultado de la importación */}
                    {summary && (
                        <div className="space-y-4">
                            <div className="flex items-center gap-4 flex-wrap">
                                <div className="flex items-center gap-2 bg-emerald-900/40 border border-emerald-700 text-emerald-300 px-3 py-1.5 rounded-lg">
                                    <CheckCircle size={16} />
                                    <span className="font-bold">{summary.created}</span>
                                    <span className="text-sm">creados</span>
                                </div>
                                <div className="flex items-center gap-2 bg-sky-900/40 border border-sky-700 text-sky-300 px-3 py-1.5 rounded-lg">
                                    <CheckCircle size={16} />
                                    <span className="font-bold">{summary.updated}</span>
                                    <span className="text-sm">actualizados</span>
                                </div>
                                {summary.rejected.length > 0 && (
                                    <div className="flex items-center gap-2 bg-red-900/40 border border-red-700 text-red-300 px-3 py-1.5 rounded-lg">
                                        <XCircle size={16} />
                                        <span className="font-bold">{summary.rejected.length}</span>
                                        <span className="text-sm">rechazados</span>
                                    </div>
                                )}
                            </div>

                            {summary.failedChunks > 0 && (
                                <div className="bg-red-950/40 border border-red-800/50 rounded-lg p-3 text-sm text-red-300">
                                    {summary.failedChunks} lote{summary.failedChunks > 1 ? 's' : ''} sin confirmación del servidor.
                                    No tenemos confirmación del resultado de esas filas. Verificá sus códigos en el catálogo antes de volver a enviarlas.
                                </div>
                            )}

                            {summary.uncertain.length > 0 && <div role="alert" className="rounded-lg border border-amber-700 p-3 text-sm text-amber-300">
                                <p className="font-semibold">{summary.uncertain.length} filas sin confirmar</p>
                                <ul className="mt-2 max-h-40 overflow-y-auto">{summary.uncertain.map((row, index) => <li key={index}>Fila {row.excelRow ?? '—'} · {row.sku}: {row.reason}</li>)}</ul>
                                <button type="button" onClick={downloadUncertain} className="mt-3 rounded-control border border-amber-700 px-3 py-2 font-semibold">Descargar filas sin confirmar</button>
                            </div>}
                            {summary.rejected.length > 0 && (
                                <div className="bg-surface-900/60 rounded-xl border border-surface-700 overflow-hidden">
                                    <div className="flex items-center justify-between px-4 py-3 border-b border-surface-700">
                                        <p className="text-sm font-semibold text-white">Filas que NO entraron (corregilas en tu Excel y volvé a subir solo esas)</p>
                                        <button
                                            onClick={downloadRejected}
                                            className="flex items-center gap-2 px-3 py-1.5 bg-amber-600/20 border border-amber-600/40 hover:bg-amber-600/30 rounded-lg text-amber-300 text-sm font-semibold transition-colors"
                                        >
                                            <Download size={16} />
                                            Descargar los {summary.rejected.length} que fallaron
                                        </button>
                                    </div>
                                    <div className="overflow-x-auto max-h-72">
                                        <table className="w-full text-sm">
                                            <thead className="bg-surface-900/80 sticky top-0">
                                                <tr>
                                                    <th className="text-left px-3 py-2 text-xs text-surface-400 uppercase font-semibold">Fila Excel</th>
                                                    <th className="text-left px-3 py-2 text-xs text-surface-400 uppercase font-semibold">Código</th>
                                                    <th className="text-left px-3 py-2 text-xs text-surface-400 uppercase font-semibold">Motivo</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-surface-700/50">
                                                {summary.rejected.map((r, i) => (
                                                    <tr key={i} className="bg-red-950/10">
                                                        <td className="px-3 py-2 font-mono text-surface-300">{r.excelRow ?? '—'}</td>
                                                        <td className="px-3 py-2 font-mono text-surface-300">{r.sku}</td>
                                                        <td className="px-3 py-2 text-red-300">{r.motivo}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            <div className="flex justify-between items-center">
                                <button
                                    onClick={() => { setRows([]); setResolution(null); setSummary(null); }}
                                    className="text-sm text-surface-400 hover:text-white underline"
                                >
                                    Importar otro archivo
                                </button>
                                <button
                                    onClick={requestClose}
                                    className="px-6 py-2.5 bg-brand-600 hover:bg-brand-700 rounded-lg text-white font-bold transition-colors"
                                >
                                    Listo
                                </button>
                            </div>
                        </div>
                    )}

                    {rows.length > 0 && !summary && <div className="space-y-2 rounded-lg border border-surface-600 p-4">
                        <label htmlFor="catalog-import-purpose" className="block text-sm font-semibold text-white">Qué querés importar</label>
                        <select id="catalog-import-purpose" disabled={importing} value={includeInitialStock ? 'initial' : 'catalog'} onChange={event => { if (!importingRef.current) setIncludeInitialStock(event.target.value === 'initial'); }} className="nx-form-field w-full rounded-control border bg-surface-900 p-3 text-slate-100">
                            <option value="catalog">Actualizar catálogo y precios</option>
                            <option value="initial">Cargar existencias iniciales de productos nuevos</option>
                        </select>
                        <p className="text-sm text-surface-300">{includeInitialStock ? 'Las existencias sólo se cargan al crear códigos nuevos, en la bodega que elijás. Un código existente se rechaza si trae stock. Los productos con lotes se reciben desde Compras o Lotes.' : 'Las existencias actuales se conservan. Los productos nuevos se crean sin stock; registrá su entrada después desde Compras.'}</p>
                        {includeInitialStock && <div className="space-y-2 pt-2">
                            <label htmlFor="catalog-import-warehouse" className="block text-sm font-semibold text-surface-300">Bodega de las existencias iniciales</label>
                            <select id="catalog-import-warehouse" value={warehouseId} disabled={importing || warehousesLoading || Boolean(warehousesError)} aria-describedby="catalog-import-warehouse-status" onChange={event => { if (!importingRef.current) setWarehouseId(event.target.value); }} className="nx-form-field w-full rounded-control border bg-surface-900 p-3 text-slate-100 disabled:opacity-60">
                                <option value="">{warehousesLoading ? 'Cargando bodegas…' : 'Seleccioná una bodega'}</option>
                                {warehouses.map(warehouse => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}{warehouse.isDefault ? ' · Principal' : ''}</option>)}
                            </select>
                            <div id="catalog-import-warehouse-status">
                                {warehousesLoading && <p role="status" className="text-sm text-surface-300">Consultando bodegas activas…</p>}
                                {warehousesError && <div className="space-y-2">
                                    <p role="alert" className="text-sm text-red-300">{warehousesError}</p>
                                    <button type="button" disabled={importing || warehousesLoading} onClick={() => { if (!importingRef.current) setWarehouseReload(current => current + 1); }} className="rounded-control border border-surface-600 px-3 py-2 text-sm font-semibold text-surface-300 disabled:opacity-60">Reintentar carga de bodegas</button>
                                </div>}
                            </div>
                        </div>}
                        <p className="text-xs text-surface-400">Sólo se cambian las celdas con valor, incluidos precio y costo si vienen en el archivo. En cantidades, la coma o el punto separan decimales: 0,125 equivale a 0.125. No uses separadores de miles.</p>
                        <p className="text-xs text-surface-400">Guardá los códigos como texto en Excel para conservar sus ceros iniciales.</p>
                    </div>}
                    {/* Preview Table */}
                    {rows.length > 0 && !summary && (
                        <div>
                            {/* Cómo se leyeron las columnas del archivo */}
                            {resolution && (
                                <div className="bg-surface-900/60 border border-surface-700 rounded-lg p-3 mb-4">
                                    <p className="text-xs text-surface-400 uppercase font-semibold flex items-center gap-1.5 mb-2">
                                        <Columns3 size={14} /> Así leímos tu archivo
                                    </p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {(Object.entries(resolution.mapping) as [CanonicalField, string | null][])
                                            .filter(([, header]) => header !== null)
                                            .map(([field, header]) => (
                                                <span key={field} className="text-xs bg-surface-700/60 border border-surface-600 rounded px-2 py-0.5 text-surface-300">
                                                    <span className="font-mono text-white">{header}</span> → {FIELD_LABELS[field]}
                                                </span>
                                            ))}
                                        {resolution.unknown.map(h => (
                                            <span key={h} className="text-xs bg-surface-800 border border-surface-700 rounded px-2 py-0.5 text-surface-500 line-through">
                                                {h}
                                            </span>
                                        ))}
                                    </div>
                                    {missingCols.length > 0 && (
                                        <div className="mt-3 bg-red-950/40 border border-red-800/50 rounded-lg p-3">
                                            <p className="text-sm text-red-300 font-semibold">
                                                No encontramos la columna de {missingCols.map(f => FIELD_LABELS[f].toLowerCase()).join(' ni de ')}.
                                            </p>
                                            <p className="text-xs text-red-400/80 mt-1">
                                                Renombrá el encabezado en tu Excel a alguno de estos y volvé a subirlo:{' '}
                                                {missingCols.map(f => acceptedHeaders(f).slice(0, 6).join(', ')).join(' — ')}
                                            </p>
                                        </div>
                                    )}
                                    {resolution.missing.includes('sku') && (
                                        <p className="text-xs text-amber-400/90 mt-2">
                                            Sin columna de código: aceptamos <span className="font-mono">codigo, barra, barcode, upc, referencia…</span>
                                        </p>
                                    )}
                                </div>
                            )}
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-4">
                                    <div className="flex items-center gap-2 bg-emerald-900/40 border border-emerald-700 text-emerald-300 px-3 py-1.5 rounded-lg">
                                        <CheckCircle size={16} />
                                        <span className="font-bold">{validCount}</span>
                                        <span className="text-sm">válidos</span>
                                    </div>
                                    {errorCount > 0 && (
                                        <div className="flex items-center gap-2 bg-red-900/40 border border-red-700 text-red-300 px-3 py-1.5 rounded-lg">
                                            <XCircle size={16} />
                                            <span className="font-bold">{errorCount}</span>
                                            <span className="text-sm">con errores</span>
                                        </div>
                                    )}
                                </div>
                                <button
                                    disabled={importing}
                                    onClick={() => { if (!importingRef.current) { setRows([]); setResolution(null); } }}
                                    className="text-sm text-surface-400 hover:text-white underline"
                                >
                                    Cargar otro archivo
                                </button>
                            </div>

                            <div className="bg-surface-900/60 rounded-xl border border-surface-700 overflow-hidden">
                                <div className="overflow-x-auto max-h-96">
                                    <table className="w-full text-sm">
                                        <thead className="bg-surface-900/80 sticky top-0">
                                            <tr>
                                                <th className="text-left px-3 py-2 text-xs text-surface-400 uppercase font-semibold">Estado</th>
                                                <th className="text-left px-3 py-2 text-xs text-surface-400 uppercase font-semibold">Fila</th>
                                                <th className="text-left px-3 py-2 text-xs text-surface-400 uppercase font-semibold">Código</th>
                                                <th className="text-left px-3 py-2 text-xs text-surface-400 uppercase font-semibold">Nombre</th>
                                                <th className="text-left px-3 py-2 text-xs text-surface-400 uppercase font-semibold">Categoría</th>
                                                <th className="text-right px-3 py-2 text-xs text-surface-400 uppercase font-semibold">Precio</th>
                                                <th className="text-right px-3 py-2 text-xs text-surface-400 uppercase font-semibold">Costo</th>
                                                <th className="text-right px-3 py-2 text-xs text-surface-400 uppercase font-semibold">Existencia</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-surface-700/50">
                                            {effectiveRows.map((r) => (
                                                <tr key={r.excelRow} className={r.valid ? 'hover:bg-surface-700/20' : 'bg-red-950/20'}>
                                                    <td className="px-3 py-2">
                                                        {r.valid ? (
                                                            <CheckCircle size={16} className="text-emerald-400" />
                                                        ) : (
                                                            <AlertCircle size={16} className="text-red-400" />
                                                        )}
                                                    </td>
                                                    <td className="px-3 py-2 font-mono text-surface-500">{r.excelRow}</td>
                                                    <td className="px-3 py-2 font-mono text-surface-300">{r.data.sku}</td>
                                                    <td className="px-3 py-2 text-white">{r.data.nombre}{r.errors.length > 0 && <p className="mt-1 text-xs text-red-300">{r.errors.join(" · ")}</p>}</td>
                                                    <td className="px-3 py-2 text-surface-400">{r.data.categoria}{r.data.marca && <span className="block">{r.data.marca}</span>}</td>
                                                    <td className={`px-3 py-2 text-right font-semibold ${r.valid ? 'text-emerald-400' : 'text-red-300'}`}>
                                                        {r.valid ? `${formatMoney(r.data.precio)}` : '—'}
                                                    </td>
                                                    <td className="px-3 py-2 text-right text-surface-400">{formatMoney(r.data.costo)}</td>
                                                    <td className="px-3 py-2 text-right text-white font-bold">
                                                        {r.data.stock} {r.data.unidad}
                                                        <span className="block text-[10px] text-surface-500">
                                                            {r.data.modoVenta === 'LEGACY' ? 'Configuración actual' : r.data.modoVenta === 'MEASURED' ? 'Medido' : 'Contado'} · paso {r.data.pasoCantidad}
                                                        </span>
                                                        {(r.data.unidadEmpaque || r.data.requiereLote || r.data.ivaExento) && (
                                                            <span className="block text-[10px] text-surface-500">
                                                                {r.data.unidadEmpaque
                                                                    ? `${r.data.unidadEmpaque} × ${r.data.tamanoEmpaque} ${r.data.unidad}`
                                                                    : 'Sin empaque'}
                                                                {r.data.requiereLote ? ' · lote' : ''}
                                                                {r.data.ivaExento ? ' · IVA exento' : ''}
                                                            </span>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {errorCount > 0 && (
                                <div className="bg-amber-950/40 border border-amber-800/50 rounded-lg p-3 flex items-start gap-2 mt-4">
                                    <AlertCircle size={18} className="text-amber-400 mt-0.5 shrink-0" />
                                    <div>
                                        <p className="text-sm text-amber-300 font-semibold">
                                            {errorCount} {errorCount === 1 ? 'producto tiene' : 'productos tienen'} errores
                                        </p>
                                        <p className="text-xs text-amber-400/80 mt-1">
                                            Sólo se importarán las filas válidas. El motivo aparece junto a cada producto.
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                {rows.length > 0 && !summary && (
                    <div className="bg-surface-900/80 px-6 py-4 border-t border-surface-700 flex items-center justify-between gap-4">
                        <div className="text-sm text-surface-400 flex-1 min-w-0">
                            {progress ? (
                                <div>
                                    <div className="flex justify-between text-xs mb-1">
                                        <span>Importando en lotes…</span>
                                        <span className="font-bold text-white">{progress.done} de {progress.total}</span>
                                    </div>
                                    <div className="h-2 bg-surface-700 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-brand-500 transition-all duration-300"
                                            style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }}
                                        />
                                    </div>
                                </div>
                            ) : (
                                <>Se importarán <span className="font-bold text-white">{validCount}</span> producto{validCount !== 1 ? 's' : ''} (en lotes de 200)</>
                            )}
                        </div>
                        <div className="flex gap-3">
                            <button
                                onClick={requestClose}
                                disabled={importing}
                                className="px-6 py-2.5 bg-surface-700 hover:bg-surface-600 rounded-lg text-white font-medium transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleImport}
                                disabled={validCount === 0 || importing || (includeInitialStock && !initialWarehouseReady)}
                                className="px-6 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:bg-brand-800 disabled:opacity-50 rounded-lg text-white font-bold transition-colors flex items-center gap-2"
                            >
                                {importing ? (
                                    <>
                                        <Loader2 className="animate-spin" size={18} />
                                        Importando...
                                    </>
                                ) : (
                                    <>
                                        <Upload size={18} />
                                        Importar {validCount} Productos
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ProductImporter;
