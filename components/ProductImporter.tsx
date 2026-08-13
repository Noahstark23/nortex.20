import React, { useState, useRef } from 'react';
import { Upload, Download, FileSpreadsheet, AlertCircle, CheckCircle, XCircle, Loader2, X, Columns3 } from 'lucide-react';
import * as XLSX from 'xlsx';
import {
    parseWorkbookRows, acceptedHeaders, importInChunks,
    type ParsedRow, type ColumnResolution, type CanonicalField,
} from '../utils/importProducts';

interface ProductImporterProps {
    onClose: () => void;
    onSuccess: () => void;
}

/** Etiquetas humanas de los campos canónicos para el resumen de mapeo. */
const FIELD_LABELS: Record<CanonicalField, string> = {
    sku: 'Código', nombre: 'Nombre', precio: 'Precio', costo: 'Costo',
    stock: 'Existencia', minStock: 'Mínimo', categoria: 'Categoría',
    unidad: 'Unidad', descripcion: 'Descripción',
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
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Manejar archivo — el parseo/validación vive en utils/importProducts.ts
    // (puro y testeado): sinónimos de encabezados nicas, dinero con "C$"/comas,
    // códigos en notación científica, duplicados dentro del archivo.
    const handleFile = (file: File) => {
        setLoading(true);
        setSummary(null);
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const data = e.target?.result;
                const workbook = XLSX.read(data, { type: 'binary' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet) as Record<string, unknown>[];

                const result = parseWorkbookRows(jsonData);
                setRows(result.rows);
                setResolution(result.resolution);
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
    const downloadTemplate = () => {
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
                descripcion: 'Cemento gris uso general'
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
                descripcion: ''
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
                descripcion: 'Analgésico / antipirético'
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
        const result = await importInChunks(
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
    const downloadRejected = () => {
        if (!summary || summary.rejected.length === 0) return;
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

    const validCount = rows.filter(r => r.valid).length;
    const errorCount = rows.filter(r => !r.valid).length;
    const missingCols = resolution?.missing.filter(f => f !== 'sku') ?? [];

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-surface-800 rounded-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden shadow-2xl border border-surface-700" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="bg-gradient-to-r from-brand-900/40 to-brand-900/20 px-6 py-4 border-b border-surface-700 flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                            <Upload size={20} className="text-brand-400" />
                            Importar Productos Masivamente
                        </h2>
                        <p className="text-sm text-surface-400 mt-1">Carga hasta 500 productos desde Excel/CSV con validación automática</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-surface-700 rounded-lg text-surface-400 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(90vh-180px)]">
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
                                        <p className="text-xs text-surface-500">Formatos soportados: .xlsx, .xls, .csv (max 500 productos)</p>
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
                                    onClick={() => { setRows([]); setResolution(null); }}
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
                                            {rows.map((r) => (
                                                <tr key={r.excelRow} className={r.valid ? 'hover:bg-surface-700/20' : 'bg-red-950/20'}>
                                                    <td className="px-3 py-2">
                                                        {r.valid ? (
                                                            <CheckCircle size={16} className="text-emerald-400" />
                                                        ) : (
                                                            <div className="group relative">
                                                                <AlertCircle size={16} className="text-red-400 cursor-help" />
                                                                <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block bg-red-900 text-red-200 text-xs p-2 rounded shadow-lg w-56 z-10">
                                                                    {r.errors.join(' · ')}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="px-3 py-2 font-mono text-surface-500">{r.excelRow}</td>
                                                    <td className="px-3 py-2 font-mono text-surface-300">{r.data.sku}</td>
                                                    <td className="px-3 py-2 text-white">{r.data.nombre}</td>
                                                    <td className="px-3 py-2 text-surface-400">{r.data.categoria}</td>
                                                    <td className={`px-3 py-2 text-right font-semibold ${r.valid ? 'text-emerald-400' : 'text-red-300'}`}>
                                                        {r.valid ? `C$ ${r.data.precio.toFixed(2)}` : '—'}
                                                    </td>
                                                    <td className="px-3 py-2 text-right text-surface-400">C$ {r.data.costo.toFixed(2)}</td>
                                                    <td className="px-3 py-2 text-right text-white font-bold">{r.data.stock}</td>
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
                                            Solo se importarán los productos válidos. Pasa el mouse sobre para ver detalles del error.
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
                                onClick={onClose}
                                className="px-6 py-2.5 bg-surface-700 hover:bg-surface-600 rounded-lg text-white font-medium transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleImport}
                                disabled={validCount === 0 || importing}
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
