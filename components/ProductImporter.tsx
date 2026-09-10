import React, { useState, useRef, useMemo } from 'react';
import { Upload, Download, FileSpreadsheet, AlertCircle, CheckCircle, XCircle, Loader2, X, Columns3 } from 'lucide-react';
// xlsx (~430 KB) se importa DINÁMICAMENTE dentro de cada handler: solo baja al
// navegador cuando alguien importa/exporta un Excel, nunca en el bundle inicial.
import {
    parseWorkbookRows, acceptedHeaders, importInChunks,
    type ParsedRow, type ColumnResolution, type CanonicalField,
} from '../utils/importProducts';
import { formatMoney } from '../utils/money';
import {
    PREVIEW_FILTERS,
    PREVIEW_PAGE_SIZE,
    countPreviewRows,
    selectPreviewRows,
    summarizePreviewIssues,
    type PreviewFilter,
} from '../utils/importPreview';

interface ProductImporterProps {
    onClose: () => void;
    onSuccess: () => void;
}

/** Etiquetas humanas de los campos canónicos para el resumen de mapeo. */
const FIELD_LABELS: Record<CanonicalField, string> = {
    sku: 'Código', nombre: 'Nombre', precio: 'Precio', costo: 'Costo',
    stock: 'Existencia', minStock: 'Mínimo', categoria: 'Categoría',
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
}

const ProductImporter: React.FC<ProductImporterProps> = ({ onClose, onSuccess }) => {
    const [rows, setRows] = useState<ParsedRow[]>([]);
    const [resolution, setResolution] = useState<ColumnResolution | null>(null);
    const [loading, setLoading] = useState(false);
    const [importing, setImporting] = useState(false);
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
    const [summary, setSummary] = useState<ImportSummary | null>(null);
    // Filtro y tope de la vista previa. Se reinician con cada archivo para que
    // un "Con errores" de una carga anterior no esconda la carga nueva.
    const [filter, setFilter] = useState<PreviewFilter>('ALL');
    const [limit, setLimit] = useState(PREVIEW_PAGE_SIZE);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Manejar archivo — el parseo/validación vive en utils/importProducts.ts
    // (puro y testeado): sinónimos de encabezados nicas, dinero con "C$"/comas,
    // códigos en notación científica, duplicados dentro del archivo.
    const handleFile = (file: File) => {
        setLoading(true);
        setSummary(null);
        const reader = new FileReader();

        reader.onload = async (e) => {
            try {
                const XLSX = await import('xlsx');
                const data = e.target?.result;
                const workbook = XLSX.read(data, { type: 'binary' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet) as Record<string, unknown>[];

                const result = parseWorkbookRows(jsonData);
                setRows(result.rows);
                setResolution(result.resolution);
                // Un archivo nuevo empieza mostrándose entero: heredar el filtro
                // anterior haría creer que la carga vino vacía o sin errores.
                setFilter('ALL');
                setLimit(PREVIEW_PAGE_SIZE);
            } catch (error) {
                alert('Error leyendo archivo. Verificá que sea un Excel/CSV válido.');
            } finally {
                setLoading(false);
            }
        };

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
                categoria: 'Construcción',
                precio: 385.00,
                costo: 330.00,
                stock: 40,
                minStock: 10,
                unidad: 'saco',
                descripcion: 'Cemento gris uso general',
                modoVenta: 'COUNTED',
                pasoCantidad: 1,
                familiaProducto: 'AGRO_INPUT',
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
                familiaProducto: 'VETERINARY',
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
        const validRows = rows.filter(r => r.valid);
        if (validRows.length === 0) return;

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
                        products: chunk.map(r => ({
                            sku: r.data.sku,
                            name: r.data.nombre,
                            category: r.data.categoria,
                            price: r.data.precio,
                            cost: r.data.costo,
                            stock: r.data.stock,
                            minStock: r.data.minStock,
                            unit: r.data.unidad,
                            description: r.data.descripcion,
                            saleMode: r.data.modoVenta,
                            quantityStep: r.data.pasoCantidad,
                            productFamily: r.data.familiaProducto,
                            ...(resolution?.mapping.unidadEmpaque ? { packUnit: r.data.unidadEmpaque } : {}),
                            ...(resolution?.mapping.tamanoEmpaque ? { packSize: r.data.tamanoEmpaque } : {}),
                            ...(resolution?.mapping.precioEmpaque ? { packPrice: r.data.precioEmpaque } : {}),
                            ...(resolution?.mapping.requiereLote ? { requiresBatchTracking: r.data.requiereLote } : {}),
                            ...(resolution?.mapping.ivaExento ? { ivaExento: r.data.ivaExento } : {}),
                            excelRow: r.excelRow,
                        }))
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
            ...rows.filter(r => !r.valid).map(r => ({
                excelRow: r.excelRow,
                sku: r.data.sku || '—',
                motivo: r.errors.join(' · '),
            })),
            ...result.serverErrors.map(msg => ({ excelRow: null, sku: '—', motivo: msg })),
        ];
        setSummary({ created: result.created, updated: result.updated, rejected, failedChunks: result.failedChunks });
        setImporting(false);
        setProgress(null);
        if (result.created + result.updated > 0) onSuccess();
    };

    // Descargar los rechazados como Excel para corregir y re-subir SOLO eso.
    const downloadRejected = async () => {
        if (!summary || summary.rejected.length === 0) return;
        const XLSX = await import('xlsx');
        const sheetRows = summary.rejected.map(r => ({
            fila_excel: r.excelRow ?? '',
            codigo: r.sku,
            motivo: r.motivo,
        }));
        const worksheet = XLSX.utils.json_to_sheet(sheetRows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Rechazados');
        XLSX.writeFile(workbook, 'productos_rechazados_nortex.xlsx');
    };

    const counts = useMemo(() => countPreviewRows(rows), [rows]);
    const issues = useMemo(() => summarizePreviewIssues(rows), [rows]);
    const selection = useMemo(() => selectPreviewRows(rows, filter, limit), [rows, filter, limit]);
    const visibleRows = selection.visible;
    const matchingRows = selection.matching;
    const hiddenRows = selection.hidden;
    const validCount = counts.valid;
    const errorCount = counts.errors;
    const missingCols = resolution?.missing.filter(f => f !== 'sku') ?? [];

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-stretch sm:items-center justify-center z-50 p-0 sm:p-4" onClick={onClose}>
            {/*
              Altura en `dvh`, no `vh`: en iOS la barra dinámica achica el viewport
              y `90vh` se pasaba de largo, recortando la cabecera. El alto lo
              reparte flex — el body es el único que scrollea — para no depender
              de una resta hardcodeada de la altura de cabecera, que asumía una
              sola línea y dejaba de cuadrar apenas el título envolvía.
            */}
            <div
                className="bg-surface-800 rounded-none sm:rounded-2xl w-full max-w-6xl h-[100dvh] sm:h-auto sm:max-h-[90dvh] flex flex-col overflow-hidden shadow-2xl border-0 sm:border border-surface-700"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="bg-gradient-to-r from-brand-900/40 to-brand-900/20 px-4 sm:px-6 py-3 sm:py-4 border-b border-surface-700 flex items-start justify-between gap-3 shrink-0">
                    <div className="min-w-0">
                        <h2 className="text-base sm:text-xl font-bold text-white flex items-center gap-2">
                            <Upload size={20} className="text-brand-400 shrink-0" />
                            <span className="truncate">Importar productos</span>
                        </h2>
                        <p className="hidden sm:block text-sm text-surface-400 mt-1">Carga hasta 500 productos desde Excel/CSV con validación automática</p>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label="Cerrar importador"
                        className="shrink-0 flex h-11 w-11 items-center justify-center hover:bg-surface-700 rounded-lg text-surface-400 hover:text-white transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 overflow-y-auto flex-1 min-h-0">
                    {/* Upload Zone */}
                    {rows.length === 0 && !summary && (
                        <div>
                            <div
                                onDrop={handleDrop}
                                onDragOver={(e) => e.preventDefault()}
                                onClick={() => fileInputRef.current?.click()}
                                className="border-2 border-dashed border-surface-600 rounded-xl p-6 sm:p-12 text-center cursor-pointer hover:border-brand-500 hover:bg-surface-700/20 transition-all"
                            >
                                {loading ? (
                                    <div className="flex flex-col items-center gap-3">
                                        <Loader2 className="animate-spin text-brand-400 size-9 sm:size-12" />
                                        <p className="text-surface-400">Procesando archivo...</p>
                                    </div>
                                ) : (
                                    <>
                                        <FileSpreadsheet className="mx-auto text-brand-400 mb-3 sm:mb-4 size-9 sm:size-12" />
                                        {/* En un teléfono no se arrastra nada: el gesto real es tocar. */}
                                        <p className="text-base sm:text-lg text-white font-semibold mb-2">
                                            <span className="sm:hidden">Tocá para elegir tu archivo</span>
                                            <span className="hidden sm:inline">Arrastra tu archivo Excel/CSV aquí</span>
                                        </p>
                                        <p className="hidden sm:block text-sm text-surface-400 mb-4">o haz click para seleccionar</p>
                                        <p className="text-xs text-surface-500">.xlsx, .xls o .csv · hasta 500 productos</p>
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
                                    {summary.failedChunks} lote{summary.failedChunks > 1 ? 's' : ''} no se pudo enviar (¿se cayó el internet?).
                                    Los productos ya creados quedaron guardados; volvé a subir el archivo — los existentes solo se actualizan, no se duplican.
                                </div>
                            )}

                            {summary.rejected.length > 0 && (
                                <div className="bg-surface-900/60 rounded-xl border border-surface-700 overflow-hidden">
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3 border-b border-surface-700">
                                        <p className="text-sm font-semibold text-white">Filas que NO entraron (corregilas en tu Excel y volvé a subir solo esas)</p>
                                        <button
                                            onClick={downloadRejected}
                                            className="nx-fluid-press flex min-h-11 shrink-0 items-center justify-center gap-2 px-3 py-1.5 bg-amber-600/20 border border-amber-600/40 hover:bg-amber-600/30 rounded-lg text-amber-300 text-sm font-semibold transition-colors"
                                        >
                                            <Download size={16} />
                                            Descargar los {summary.rejected.length} que fallaron
                                        </button>
                                    </div>
                                    {/* Mismo criterio que la vista previa: en angosto
                                      una lista apilada, y la tabla solo cuando hay
                                      ancho real para sus tres columnas. */}
                                    <ul className="sm:hidden max-h-72 overflow-y-auto divide-y divide-surface-700/50">
                                        {summary.rejected.map((r, i) => (
                                            <li key={i} className="bg-red-950/10 px-4 py-2.5">
                                                <p className="text-xs font-mono text-surface-400">
                                                    Fila {r.excelRow ?? '—'}{r.sku && r.sku !== '—' ? ` · ${r.sku}` : ''}
                                                </p>
                                                <p className="text-sm text-red-300 break-words">{r.motivo}</p>
                                            </li>
                                        ))}
                                    </ul>
                                    <div className="hidden sm:block overflow-x-auto max-h-72">
                                        <table className="min-w-full text-sm">
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
                                    onClick={onClose}
                                    className="px-6 py-2.5 bg-brand-600 hover:bg-brand-700 rounded-lg text-white font-bold transition-colors"
                                >
                                    Listo
                                </button>
                            </div>
                        </div>
                    )}

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
                            {/*
                              Filtro y tope: con 500 filas la lista completa no es
                              recorrible en un teléfono y lo único accionable son
                              las que fallaron. El filtro las aísla; el tope evita
                              renderizar miles de nodos. Las reglas viven en
                              utils/importPreview.ts para poder probarlas sin DOM.
                            */}
                            <div className="flex flex-wrap items-center gap-2 mb-3">
                                {PREVIEW_FILTERS.map(f => {
                                    const label = f === 'ALL' ? 'Todos' : f === 'VALID' ? 'Válidos' : 'Con errores';
                                    const count = f === 'ALL' ? counts.total : f === 'VALID' ? counts.valid : counts.errors;
                                    const active = filter === f;
                                    if (f === 'ERRORS' && counts.errors === 0) return null;
                                    return (
                                        <button
                                            key={f}
                                            type="button"
                                            aria-pressed={active}
                                            onClick={() => { setFilter(f); setLimit(PREVIEW_PAGE_SIZE); }}
                                            className={`nx-fluid-press min-h-11 rounded-lg border px-3 text-sm font-semibold transition-colors ${active
                                                ? f === 'ERRORS'
                                                    ? 'border-red-700 bg-red-900/40 text-red-300'
                                                    : 'border-emerald-700 bg-emerald-900/40 text-emerald-300'
                                                : 'border-surface-600 bg-surface-800 text-surface-300 hover:border-surface-500'}`}
                                        >
                                            {label} <span className="font-bold">{count}</span>
                                        </button>
                                    );
                                })}
                                <button
                                    onClick={() => { setRows([]); setResolution(null); }}
                                    className="nx-fluid-press ml-auto min-h-11 px-2 text-sm text-surface-400 hover:text-white underline"
                                >
                                    Cargar otro archivo
                                </button>
                            </div>

                            {/*
                              Motivos agrupados: con un archivo grande sirve leer
                              "12 filas sin precio" y corregir la columna entera,
                              en vez de cazar 12 íconos rojos de a uno.
                            */}
                            {issues.length > 0 && (
                                <div className="bg-red-950/30 border border-red-800/40 rounded-lg p-3 mb-3 space-y-1.5">
                                    <p className="text-xs uppercase font-semibold text-red-300">Qué hay que corregir en tu Excel</p>
                                    {issues.map(issue => (
                                        <p key={issue.motivo} className="text-sm text-red-200">
                                            <span className="font-bold">{issue.filas}</span>{' '}
                                            {issue.filas === 1 ? 'fila' : 'filas'}: {issue.motivo}
                                            <span className="block text-xs text-red-300/70">
                                                Fila{issue.ejemplos.length > 1 ? 's' : ''} {issue.ejemplos.join(', ')}
                                                {issue.filas > issue.ejemplos.length ? '…' : ''}
                                            </span>
                                        </p>
                                    ))}
                                </div>
                            )}

                            {/*
                              Móvil: tarjetas apiladas. Una tabla de 8 columnas en
                              390px se aplasta y desborda a la vez, y obliga a un
                              scroll horizontal anidado dentro del scroll vertical
                              del modal. El motivo del error va INLINE: antes vivía
                              en un tooltip `group-hover`, y en touch no hay hover,
                              así que una fila rota nunca podía explicarse.
                            */}
                            <div className="sm:hidden space-y-2">
                                {visibleRows.map(r => (
                                    <div
                                        key={r.excelRow}
                                        className={`rounded-xl border p-3 ${r.valid ? 'border-surface-700 bg-surface-900/60' : 'border-red-800/60 bg-red-950/30'}`}
                                    >
                                        <div className="flex items-start gap-2">
                                            {r.valid
                                                ? <CheckCircle size={16} className="text-emerald-400 mt-0.5 shrink-0" />
                                                : <AlertCircle size={16} className="text-red-400 mt-0.5 shrink-0" />}
                                            <div className="min-w-0 flex-1">
                                                <p className="text-white font-semibold break-words">{r.data.nombre || '(sin nombre)'}</p>
                                                <p className="text-xs text-surface-500 font-mono">
                                                    Fila {r.excelRow}{r.data.sku ? ` · ${r.data.sku}` : ''}
                                                </p>
                                            </div>
                                            <span className={`shrink-0 font-bold ${r.valid ? 'text-emerald-400' : 'text-red-300'}`}>
                                                {r.valid ? formatMoney(r.data.precio) : '—'}
                                            </span>
                                        </div>
                                        {!r.valid && (
                                            <p className="mt-2 text-xs text-red-300">{r.errors.join(' · ')}</p>
                                        )}
                                        <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                                            <div className="min-w-0">
                                                <dt className="text-surface-500">Costo</dt>
                                                <dd className="text-surface-300">{formatMoney(r.data.costo)}</dd>
                                            </div>
                                            <div className="min-w-0">
                                                <dt className="text-surface-500">Existencia</dt>
                                                <dd className="text-white font-semibold">{r.data.stock} {r.data.unidad}</dd>
                                            </div>
                                            <div className="min-w-0">
                                                <dt className="text-surface-500">Categoría</dt>
                                                <dd className="text-surface-300 truncate">{r.data.categoria}</dd>
                                            </div>
                                        </dl>
                                    </div>
                                ))}
                            </div>

                            {/* Pantalla ancha: la tabla completa, con ancho natural
                              (`min-w-full`) para que el contenedor scrollee en vez
                              de aplastar las columnas hasta romperlas. */}
                            <div className="hidden sm:block bg-surface-900/60 rounded-xl border border-surface-700 overflow-hidden">
                                <div className="overflow-x-auto max-h-96">
                                    <table className="min-w-full text-sm">
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
                                            {visibleRows.map((r) => (
                                                <tr key={r.excelRow} className={r.valid ? 'hover:bg-surface-700/20' : 'bg-red-950/20'}>
                                                    <td className="px-3 py-2 align-top">
                                                        {r.valid
                                                            ? <CheckCircle size={16} className="text-emerald-400" />
                                                            : <AlertCircle size={16} className="text-red-400" />}
                                                    </td>
                                                    <td className="px-3 py-2 align-top font-mono text-surface-500">{r.excelRow}</td>
                                                    <td className="px-3 py-2 align-top font-mono text-surface-300">{r.data.sku}</td>
                                                    <td className="px-3 py-2 align-top text-white">
                                                        {r.data.nombre}
                                                        {!r.valid && (
                                                            <span className="block text-xs text-red-300 mt-0.5">{r.errors.join(' · ')}</span>
                                                        )}
                                                    </td>
                                                    <td className="px-3 py-2 align-top text-surface-400">{r.data.categoria}</td>
                                                    <td className={`px-3 py-2 align-top text-right font-semibold ${r.valid ? 'text-emerald-400' : 'text-red-300'}`}>
                                                        {r.valid ? `${formatMoney(r.data.precio)}` : '—'}
                                                    </td>
                                                    <td className="px-3 py-2 align-top text-right text-surface-400">{formatMoney(r.data.costo)}</td>
                                                    <td className="px-3 py-2 align-top text-right text-white font-bold">
                                                        {r.data.stock} {r.data.unidad}
                                                        <span className="block text-[10px] text-surface-500">
                                                            {r.data.modoVenta === 'MEASURED' ? 'Medido' : 'Contado'} · paso {r.data.pasoCantidad}
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

                            {/* El tope acota el DOM, no los datos: el conteo real
                              sigue a la vista para que nadie crea que el archivo
                              llegó recortado. */}
                            {hiddenRows > 0 && (
                                <button
                                    type="button"
                                    onClick={() => setLimit(current => current + PREVIEW_PAGE_SIZE)}
                                    className="nx-fluid-press mt-3 min-h-11 w-full rounded-lg border border-surface-600 bg-surface-800 px-4 text-sm font-semibold text-surface-200 hover:border-surface-500"
                                >
                                    Ver {Math.min(hiddenRows, PREVIEW_PAGE_SIZE)} más ({visibleRows.length} de {matchingRows})
                                </button>
                            )}
                            {matchingRows === 0 && (
                                <p className="rounded-lg border border-surface-700 bg-surface-900/60 p-4 text-center text-sm text-surface-400">
                                    Ninguna fila en este filtro.
                                </p>
                            )}

                            {errorCount > 0 && (
                                <div className="bg-amber-950/40 border border-amber-800/50 rounded-lg p-3 flex items-start gap-2 mt-4">
                                    <AlertCircle size={18} className="text-amber-400 mt-0.5 shrink-0" />
                                    <div>
                                        <p className="text-sm text-amber-300 font-semibold">
                                            {errorCount} {errorCount === 1 ? 'producto tiene' : 'productos tienen'} errores
                                        </p>
                                        <p className="text-xs text-amber-400/80 mt-1">
                                            Solo se importarán los válidos. El motivo de cada fila se ve arriba, en la lista.
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                {rows.length > 0 && !summary && (
                    <div className="bg-surface-900/80 px-4 sm:px-6 py-3 sm:py-4 border-t border-surface-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-4">
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
                                onClick={onClose}
                                className="nx-fluid-press min-h-11 px-4 sm:px-6 py-2.5 bg-surface-700 hover:bg-surface-600 rounded-lg text-white font-medium transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleImport}
                                disabled={validCount === 0 || importing}
                                className="nx-fluid-press min-h-11 flex-1 sm:flex-none justify-center px-4 sm:px-6 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:bg-brand-800 disabled:opacity-50 rounded-lg text-white font-bold transition-colors flex items-center gap-2"
                            >
                                {importing ? (
                                    <>
                                        <Loader2 className="animate-spin" size={18} />
                                        Importando...
                                    </>
                                ) : (
                                    <>
                                        <Upload size={18} />
                                        Importar {validCount}
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
