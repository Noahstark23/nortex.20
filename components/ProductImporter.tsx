import React, { useState, useRef } from 'react';
import { Upload, Download, FileSpreadsheet, AlertCircle, CheckCircle, XCircle, Loader2, X } from 'lucide-react';
import * as XLSX from 'xlsx';

interface ProductRow {
    sku: string;
    nombre: string;
    categoria?: string;
    precio: number;
    costo: number;
    stock: number;
    minStock: number;
    unidad: string;
    descripcion?: string;
    valid: boolean;
    errors: string[];
}

interface ProductImporterProps {
    onClose: () => void;
    onSuccess: () => void;
}

const ProductImporter: React.FC<ProductImporterProps> = ({ onClose, onSuccess }) => {
    const [products, setProducts] = useState<ProductRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [importing, setImporting] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Validar fila
    const validateRow = (row: any, index: number): ProductRow => {
        const errors: string[] = [];
        const sku = String(row.sku || row.SKU || '').trim().toUpperCase();
        const nombre = String(row.nombre || row.Nombre || row.name || row.Name || '').trim();
        const precio = parseFloat(row.precio || row.Precio || row.price || row.Price || 0);
        const costo = parseFloat(row.costo || row.Costo || row.cost || row.Cost || 0);
        const stock = parseInt(row.stock || row.Stock || 0) || 0;
        const minStock = parseInt(row.minStock || row['Min Stock'] || row.minimo || 5) || 5;
        const categoria = String(row.categoria || row.Categoria || row.category || 'General').trim();
        const unidad = String(row.unidad || row.Unidad || row.unit || 'unidad').trim();
        const descripcion = String(row.descripcion || row.Descripcion || row.description || '').trim();

        // Validaciones
        if (!sku || sku.length === 0) errors.push('SKU vacío');
        if (sku.length > 50) errors.push('SKU muy largo (max 50)');
        if (!nombre || nombre.length === 0) errors.push('Nombre vacío');
        if (nombre.length > 200) errors.push('Nombre muy largo (max 200)');
        if (precio <= 0) errors.push('Precio debe ser > 0');
        if (costo < 0) errors.push('Costo no puede ser negativo');
        if (stock < 0) errors.push('Stock no puede ser negativo');
        if (minStock < 0) errors.push('Min Stock no puede ser negativo');

        return {
            sku,
            nombre,
            categoria,
            precio,
            costo,
            stock,
            minStock,
            unidad,
            descripcion,
            valid: errors.length === 0,
            errors
        };
    };

    // Manejar archivo
    const handleFile = (file: File) => {
        setLoading(true);
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const data = e.target?.result;
                const workbook = XLSX.read(data, { type: 'binary' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet);

                const validated = jsonData.map((row, i) => validateRow(row, i));
                setProducts(validated);
            } catch (error) {
                alert('Error leyendo archivo. Verifica que sea un Excel/CSV válido.');
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
        const template = [
            {
                sku: 'PROD001',
                nombre: 'Laptop Dell XPS 15',
                categoria: 'Electrónica',
                precio: 1200.00,
                costo: 950.00,
                stock: 10,
                minStock: 2,
                unidad: 'unidad',
                descripcion: 'Laptop profesional 15 pulgadas'
            },
            {
                sku: 'PROD002',
                nombre: 'Mouse Logitech MX Master 3',
                categoria: 'Accesorios',
                precio: 45.00,
                costo: 30.00,
                stock: 50,
                minStock: 10,
                unidad: 'unidad',
                descripcion: ''
            },
            {
                sku: 'PROD003',
                nombre: 'Teclado Mecánico',
                categoria: 'Accesorios',
                precio: 85.00,
                costo: 60.00,
                stock: 25,
                minStock: 5,
                unidad: 'unidad',
                descripcion: 'Switches Blue'
            }
        ];

        const worksheet = XLSX.utils.json_to_sheet(template);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Productos');
        XLSX.writeFile(workbook, 'plantilla_productos_nortex.xlsx');
    };

    // Importar a backend
    const handleImport = async () => {
        const validProducts = products.filter(p => p.valid);
        if (validProducts.length === 0) {
            alert('No hay productos válidos para importar');
            return;
        }

        setImporting(true);

        try {
            const token = localStorage.getItem('nortex_token');
            const res = await fetch('/api/products/bulk', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    products: validProducts.map(p => ({
                        sku: p.sku,
                        name: p.nombre,
                        category: p.categoria,
                        price: p.precio,
                        cost: p.costo,
                        stock: p.stock,
                        minStock: p.minStock,
                        unit: p.unidad,
                        description: p.descripcion
                    }))
                })
            });

            const data = await res.json();

            if (res.ok) {
                alert(`✅ Importación exitosa!\n\n✅ Creados: ${data.created}\n🔄 Actualizados: ${data.updated}\n❌ Errores: ${data.errors?.length || 0}`);
                onSuccess();
                onClose();
            } else {
                alert(`❌ Error: ${data.error}`);
            }
        } catch (error) {
            alert('Error de conexión al servidor');
        } finally {
            setImporting(false);
        }
    };

    const validCount = products.filter(p => p.valid).length;
    const errorCount = products.filter(p => !p.valid).length;

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-slate-800 rounded-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden shadow-2xl border border-slate-700" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="bg-gradient-to-r from-blue-900/40 to-cyan-900/20 px-6 py-4 border-b border-slate-700 flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                            <Upload size={20} className="text-blue-400" />
                            Importar Productos Masivamente
                        </h2>
                        <p className="text-sm text-slate-400 mt-1">Carga hasta 500 productos desde Excel/CSV con validación automática</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(90vh-180px)]">
                    {/* Upload Zone */}
                    {products.length === 0 && (
                        <div>
                            <div
                                onDrop={handleDrop}
                                onDragOver={(e) => e.preventDefault()}
                                onClick={() => fileInputRef.current?.click()}
                                className="border-2 border-dashed border-slate-600 rounded-xl p-12 text-center cursor-pointer hover:border-blue-500 hover:bg-slate-700/20 transition-all"
                            >
                                {loading ? (
                                    <div className="flex flex-col items-center gap-3">
                                        <Loader2 className="animate-spin text-blue-400" size={48} />
                                        <p className="text-slate-400">Procesando archivo...</p>
                                    </div>
                                ) : (
                                    <>
                                        <FileSpreadsheet size={48} className="mx-auto text-blue-400 mb-4" />
                                        <p className="text-lg text-white font-semibold mb-2">Arrastra tu archivo Excel/CSV aquí</p>
                                        <p className="text-sm text-slate-400 mb-4">o haz click para seleccionar</p>
                                        <p className="text-xs text-slate-500">Formatos soportados: .xlsx, .xls, .csv (max 500 productos)</p>
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
                                    className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-white font-medium transition-colors"
                                >
                                    <Download size={18} />
                                    Descargar Plantilla Excel
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Preview Table */}
                    {products.length > 0 && (
                        <div>
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
                                    onClick={() => setProducts([])}
                                    className="text-sm text-slate-400 hover:text-white underline"
                                >
                                    Cargar otro archivo
                                </button>
                            </div>

                            <div className="bg-slate-900/60 rounded-xl border border-slate-700 overflow-hidden">
                                <div className="overflow-x-auto max-h-96">
                                    <table className="w-full text-sm">
                                        <thead className="bg-slate-900/80 sticky top-0">
                                            <tr>
                                                <th className="text-left px-3 py-2 text-xs text-slate-400 uppercase font-semibold">Estado</th>
                                                <th className="text-left px-3 py-2 text-xs text-slate-400 uppercase font-semibold">SKU</th>
                                                <th className="text-left px-3 py-2 text-xs text-slate-400 uppercase font-semibold">Nombre</th>
                                                <th className="text-left px-3 py-2 text-xs text-slate-400 uppercase font-semibold">Categoría</th>
                                                <th className="text-right px-3 py-2 text-xs text-slate-400 uppercase font-semibold">Precio</th>
                                                <th className="text-right px-3 py-2 text-xs text-slate-400 uppercase font-semibold">Costo</th>
                                                <th className="text-right px-3 py-2 text-xs text-slate-400 uppercase font-semibold">Stock</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-700/50">
                                            {products.map((p, i) => (
                                                <tr key={i} className={p.valid ? 'hover:bg-slate-700/20' : 'bg-red-950/20'}>
                                                    <td className="px-3 py-2">
                                                        {p.valid ? (
                                                            <CheckCircle size={16} className="text-emerald-400" />
                                                        ) : (
                                                            <div className="group relative">
                                                                <AlertCircle size={16} className="text-red-400 cursor-help" />
                                                                <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block bg-red-900 text-red-200 text-xs p-2 rounded shadow-lg w-48 z-10">
                                                                    {p.errors.join(', ')}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="px-3 py-2 font-mono text-slate-300">{p.sku}</td>
                                                    <td className="px-3 py-2 text-white">{p.nombre}</td>
                                                    <td className="px-3 py-2 text-slate-400">{p.categoria}</td>
                                                    <td className="px-3 py-2 text-right text-emerald-400 font-semibold">
                                                        ${p.precio.toFixed(2)}
                                                    </td>
                                                    <td className="px-3 py-2 text-right text-slate-400">${p.costo.toFixed(2)}</td>
                                                    <td className="px-3 py-2 text-right text-white font-bold">{p.stock}</td>
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
                                            Solo se importarán los productos válidos. Pasa el mouse sobre ⚠️ para ver detalles del error.
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                {products.length > 0 && (
                    <div className="bg-slate-900/80 px-6 py-4 border-t border-slate-700 flex items-center justify-between">
                        <div className="text-sm text-slate-400">
                            Se importarán <span className="font-bold text-white">{validCount}</span> producto{validCount !== 1 ? 's' : ''}
                        </div>
                        <div className="flex gap-3">
                            <button
                                onClick={onClose}
                                className="px-6 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-white font-medium transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleImport}
                                disabled={validCount === 0 || importing}
                                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:opacity-50 rounded-lg text-white font-bold transition-colors flex items-center gap-2"
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
