import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    Package, Plus, Search, Eye, Edit, Trash2, AlertTriangle,
    ArrowDownCircle, ArrowUpCircle, Shield, X, ChevronDown,
    RotateCcw, TrendingDown, TrendingUp, Clock, User, FileWarning, Upload, Zap
} from 'lucide-react';
import ProductImporter from './ProductImporter';
import QuickAddProduct from './QuickAddProduct';

// ==========================================
// TYPES
// ==========================================

interface Product {
    id: string;
    name: string;
    sku: string;
    description?: string;
    category?: string;
    price: number;
    cost: number;
    stock: number;
    minStock: number;
    unit: string;
    creator?: { name: string };
    updatedAt?: string;
}

interface KardexEntry {
    id: string;
    type: string;
    quantity: number;
    stockBefore: number;
    stockAfter: number;
    reason?: string;
    referenceId?: string;
    referenceType?: string;
    date: string;
    user: { name: string; email: string };
    product?: { name: string; sku: string };
}

type AdjustType = 'ADJUST_LOSS' | 'ADJUST_GAIN' | 'IN_PURCHASE' | 'RETURN';

// ==========================================
// HELPERS
// ==========================================

const MOVEMENT_LABELS: Record<string, { label: string; color: string; icon: string }> = {
    'IN_PURCHASE': { label: 'Compra', color: 'bg-emerald-900/60 text-emerald-300 border-emerald-700', icon: '📦' },
    'IN': { label: 'Entrada', color: 'bg-emerald-900/60 text-emerald-300 border-emerald-700', icon: '📦' },
    'OUT_SALE': { label: 'Venta', color: 'bg-red-900/60 text-red-300 border-red-700', icon: '🛒' },
    'OUT': { label: 'Salida', color: 'bg-red-900/60 text-red-300 border-red-700', icon: '📤' },
    'SALE': { label: 'Venta', color: 'bg-red-900/60 text-red-300 border-red-700', icon: '🛒' },
    'ADJUST_LOSS': { label: 'Pérdida', color: 'bg-orange-900/60 text-orange-300 border-orange-700', icon: '⚠️' },
    'ADJUST_GAIN': { label: 'Ganancia', color: 'bg-blue-900/60 text-blue-300 border-blue-700', icon: '📈' },
    'ADJUSTMENT': { label: 'Ajuste', color: 'bg-yellow-900/60 text-yellow-300 border-yellow-700', icon: '🔧' },
    'RETURN': { label: 'Devolución', color: 'bg-purple-900/60 text-purple-300 border-purple-700', icon: '↩️' },
};

const getMovementMeta = (type: string) => {
    return MOVEMENT_LABELS[type] || { label: type, color: 'bg-slate-700 text-slate-300 border-slate-600', icon: '❓' };
};

const formatCurrency = (n: number) => `C$ ${n.toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatDate = (d: string) => new Date(d).toLocaleString('es-NI', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
});

// ==========================================
// MAIN COMPONENT
// ==========================================

export default function Inventory() {
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [userRole, setUserRole] = useState('EMPLOYEE');

    // Modals
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);
    const [showQuickAddModal, setShowQuickAddModal] = useState(false);
    const [quickAddSKU, setQuickAddSKU] = useState('');
    const [showKardexModal, setShowKardexModal] = useState(false);
    const [showAdjustModal, setShowAdjustModal] = useState(false);
    const [showDropdown, setShowDropdown] = useState(false);

    // Kardex
    const [kardexData, setKardexData] = useState<KardexEntry[]>([]);
    const [kardexLoading, setKardexLoading] = useState(false);
    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

    // Adjust form
    const [adjustForm, setAdjustForm] = useState({
        type: 'ADJUST_LOSS' as AdjustType,
        quantity: '',
        reason: ''
    });
    const [adjustSubmitting, setAdjustSubmitting] = useState(false);

    // Create form
    const [formData, setFormData] = useState({
        name: '', sku: '', description: '', category: '',
        price: '', cost: '', stock: '', minStock: '5', unit: 'unidad'
    });

    const token = localStorage.getItem('nortex_token');
    const headers = useMemo(() => ({
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    }), [token]);

    // ==========================================
    // DATA FETCHING
    // ==========================================

    useEffect(() => {
        const userData = localStorage.getItem('nortex_user');
        if (userData) {
            try {
                const user = JSON.parse(userData);
                setUserRole(user.role || 'EMPLOYEE');
            } catch (e) { /* ignore */ }
        }
        fetchProducts();
    }, []);

    const fetchProducts = useCallback(async () => {
        try {
            setLoading(true);
            const res = await fetch(`/api/products?search=${searchTerm}`, { headers });
            if (res.ok) {
                const data = await res.json();
                setProducts(data);
            }
        } catch (e) {
            console.error('Error fetching products:', e);
        } finally {
            setLoading(false);
        }
    }, [searchTerm, headers]);

    // ==========================================
    // SCAN DETECTION
    // ==========================================

    const playScanSound = useCallback((found: boolean) => {
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        if (found) {
            oscillator.frequency.value = 1000;
            gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.1);
        } else {
            oscillator.frequency.value = 600;
            gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.15);
        }
    }, []);

    useEffect(() => {
        let buffer = '';
        let lastKeyTime = Date.now();

        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            if (showCreateModal || showImportModal || showQuickAddModal || showKardexModal || showAdjustModal) return;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

            const currentTime = Date.now();

            if (currentTime - lastKeyTime > 100) {
                buffer = '';
            }

            lastKeyTime = currentTime;

            if (e.key === 'Enter') {
                if (buffer.length >= 3) {
                    const scannedCode = buffer;
                    const found = products.find(p => p.sku === scannedCode || p.sku === scannedCode.toUpperCase());

                    if (found) {
                        playScanSound(true);
                        setSearchTerm(found.sku);
                    } else {
                        playScanSound(false);
                        setQuickAddSKU(scannedCode);
                        setShowQuickAddModal(true);
                    }
                }
                buffer = '';
            } else if (e.key.length === 1) {
                buffer += e.key;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [products, showCreateModal, showImportModal, showQuickAddModal, showKardexModal, showAdjustModal, playScanSound]);

    // ==========================================
    // INVENTORY TOTALS
    // ==========================================

    const totals = useMemo(() => {
        let totalValue = 0;
        let totalItems = 0;
        let lowStockCount = 0;
        let outOfStockCount = 0;

        products.forEach(p => {
            totalValue += p.stock * p.cost;
            totalItems += p.stock;
            if (p.stock <= p.minStock && p.stock > 0) lowStockCount++;
            if (p.stock === 0) outOfStockCount++;
        });

        return { totalValue, totalItems, lowStockCount, outOfStockCount };
    }, [products]);

    // ==========================================
    // KARDEX
    // ==========================================

    const openKardex = async (product: Product) => {
        setSelectedProduct(product);
        setShowKardexModal(true);
        setKardexLoading(true);

        try {
            const res = await fetch(`/api/kardex/${product.id}`, { headers });
            if (res.ok) {
                const data = await res.json();
                setKardexData(data);
            }
        } catch (e) {
            console.error('Error fetching kardex:', e);
        } finally {
            setKardexLoading(false);
        }
    };

    // ==========================================
    // ADJUST
    // ==========================================

    const openAdjust = (product: Product) => {
        setSelectedProduct(product);
        setAdjustForm({ type: 'ADJUST_LOSS', quantity: '', reason: '' });
        setShowAdjustModal(true);
    };

    const handleAdjust = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedProduct) return;

        const qty = parseInt(adjustForm.quantity);
        if (isNaN(qty) || qty === 0) {
            alert('La cantidad debe ser un numero distinto de cero.');
            return;
        }

        const adjustedQty = adjustForm.type === 'ADJUST_LOSS'
            ? -Math.abs(qty)
            : Math.abs(qty);

        setAdjustSubmitting(true);

        try {
            const res = await fetch('/api/inventory/adjust', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    productId: selectedProduct.id,
                    quantity: adjustedQty,
                    reason: adjustForm.reason.trim(),
                    type: adjustForm.type
                })
            });

            const data = await res.json();

            if (res.ok) {
                setShowAdjustModal(false);
                fetchProducts();
                alert(`Ajuste registrado: ${data.message}`);
            } else {
                alert(`Error: ${data.error}`);
            }
        } catch (e) {
            alert('Error procesando ajuste');
        } finally {
            setAdjustSubmitting(false);
        }
    };

    // ==========================================
    // CREATE PRODUCT
    // ==========================================

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();

        try {
            const res = await fetch('/api/products', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    ...formData,
                    price: parseFloat(formData.price),
                    cost: parseFloat(formData.cost),
                    stock: parseInt(formData.stock) || 0,
                    minStock: parseInt(formData.minStock) || 5
                })
            });

            if (res.ok) {
                setShowCreateModal(false);
                setFormData({ name: '', sku: '', description: '', category: '', price: '', cost: '', stock: '', minStock: '5', unit: 'unidad' });
                fetchProducts();
                alert('Producto creado exitosamente');
            } else {
                const error = await res.json();
                alert(`Error: ${error.error}`);
            }
        } catch (e) {
            alert('Error creando producto');
        }
    };

    // ==========================================
    // DELETE PRODUCT
    // ==========================================

    const handleDelete = async (id: string, name: string) => {
        if (!confirm(`Eliminar producto "${name}"? Solo se puede eliminar si stock = 0`)) return;

        try {
            const res = await fetch(`/api/products/${id}`, {
                method: 'DELETE',
                headers
            });

            if (res.ok) {
                fetchProducts();
                alert('Producto eliminado');
            } else {
                const error = await res.json();
                alert(`Error: ${error.error}`);
            }
        } catch (e) {
            alert('Error eliminando producto');
        }
    };

    // ==========================================
    // FILTERED PRODUCTS
    // ==========================================

    const filteredProducts = useMemo(() =>
        products.filter(p =>
            p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            p.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (p.category || '').toLowerCase().includes(searchTerm.toLowerCase())
        ), [products, searchTerm]);

    const isOwner = userRole === 'OWNER' || userRole === 'ADMIN';

    // ==========================================
    // RENDER
    // ==========================================

    return (
            <div className="h-full overflow-y-auto p-6 space-y-6">
                {/* HEADER */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-cyan-500 rounded-xl flex items-center justify-center shadow-lg shadow-blue-900/30">
                            <Shield size={24} className="text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-white">Inventario Blindado</h1>
                            <p className="text-sm text-slate-400">Sistema Kardex con auditoría inmutable</p>
                        </div>
                    </div>

                    {isOwner && (
                        <div className="relative">
                            <button
                                onClick={() => setShowDropdown(!showDropdown)}
                                className="flex items-center gap-2 bg-blue-600 px-4 py-2.5 rounded-lg hover:bg-blue-700 text-white font-semibold transition-colors shadow-lg shadow-blue-900/30"
                            >
                                <Plus size={20} />
                                Nuevo Producto
                                <ChevronDown size={16} className={`transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
                            </button>

                            {showDropdown && (
                                <>
                                    <div className="fixed inset-0 z-10" onClick={() => setShowDropdown(false)} />
                                    <div className="absolute right-0 mt-2 w-56 bg-slate-800 border border-slate-700 rounded-lg shadow-2xl overflow-hidden z-20">
                                        <button
                                            onClick={() => { setShowCreateModal(true); setShowDropdown(false); }}
                                            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-700/60 text-left text-white transition-colors"
                                        >
                                            <Plus size={18} className="text-blue-400" />
                                            <div>
                                                <p className="font-semibold">Crear Manual</p>
                                                <p className="text-xs text-slate-400">Producto individual</p>
                                            </div>
                                        </button>
                                        <div className="border-t border-slate-700" />
                                        <button
                                            onClick={() => { setShowQuickAddModal(true); setQuickAddSKU(''); setShowDropdown(false); }}
                                            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-700/60 text-left text-white transition-colors"
                                        >
                                            <Zap size={18} className="text-orange-400" />
                                            <div>
                                                <p className="font-semibold">Modo Rápido 🔫</p>
                                                <p className="text-xs text-slate-400">Escáner / Teclado</p>
                                            </div>
                                        </button>
                                        <div className="border-t border-slate-700" />
                                        <button
                                            onClick={() => { setShowImportModal(true); setShowDropdown(false); }}
                                            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-700/60 text-left text-white transition-colors"
                                        >
                                            <Upload size={18} className="text-emerald-400" />
                                            <div>
                                                <p className="font-semibold">Importar Masivo</p>
                                                <p className="text-xs text-slate-400">Carga desde Excel/CSV</p>
                                            </div>
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>

                {/* KPI CARDS */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-1">
                            <Package size={16} className="text-blue-400" />
                            <span className="text-xs text-slate-400 uppercase tracking-wider">Productos</span>
                        </div>
                        <p className="text-2xl font-bold text-white">{products.length}</p>
                        <p className="text-xs text-slate-500">{totals.totalItems.toLocaleString()} unidades en bodega</p>
                    </div>

                    <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-1">
                            <TrendingUp size={16} className="text-emerald-400" />
                            <span className="text-xs text-slate-400 uppercase tracking-wider">Valor Inventario</span>
                        </div>
                        <p className="text-2xl font-bold text-emerald-400">{formatCurrency(totals.totalValue)}</p>
                        <p className="text-xs text-slate-500">Al costo de compra</p>
                    </div>

                    <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-1">
                            <AlertTriangle size={16} className="text-amber-400" />
                            <span className="text-xs text-slate-400 uppercase tracking-wider">Stock Bajo</span>
                        </div>
                        <p className={`text-2xl font-bold ${totals.lowStockCount > 0 ? 'text-amber-400' : 'text-white'}`}>
                            {totals.lowStockCount}
                        </p>
                        <p className="text-xs text-slate-500">Productos bajo mínimo</p>
                    </div>

                    <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-1">
                            <FileWarning size={16} className="text-red-400" />
                            <span className="text-xs text-slate-400 uppercase tracking-wider">Agotados</span>
                        </div>
                        <p className={`text-2xl font-bold ${totals.outOfStockCount > 0 ? 'text-red-400' : 'text-white'}`}>
                            {totals.outOfStockCount}
                        </p>
                        <p className="text-xs text-slate-500">Stock en cero</p>
                    </div>
                </div>

                {/* SEARCH BAR */}
                <div className="flex gap-3">
                    <div className="flex-1 relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                        <input
                            type="text"
                            placeholder="Buscar por nombre, SKU o categoría..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            onKeyUp={fetchProducts}
                            className="w-full pl-10 pr-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                        />
                    </div>
                </div>

                {/* PRODUCTS TABLE */}
                <div className="bg-slate-800/60 rounded-xl border border-slate-700 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="bg-slate-900/80">
                                    <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase tracking-wider font-semibold">SKU</th>
                                    <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase tracking-wider font-semibold">Producto</th>
                                    <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase tracking-wider font-semibold">Categoría</th>
                                    <th className="text-right px-4 py-3 text-xs text-slate-400 uppercase tracking-wider font-semibold">Stock</th>
                                    <th className="text-right px-4 py-3 text-xs text-slate-400 uppercase tracking-wider font-semibold">Precio</th>
                                    {isOwner && (
                                        <>
                                            <th className="text-right px-4 py-3 text-xs text-slate-400 uppercase tracking-wider font-semibold">Costo</th>
                                            <th className="text-right px-4 py-3 text-xs text-slate-400 uppercase tracking-wider font-semibold">Valor Total</th>
                                        </>
                                    )}
                                    <th className="text-center px-4 py-3 text-xs text-slate-400 uppercase tracking-wider font-semibold">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-700/50">
                                {loading ? (
                                    <tr>
                                        <td colSpan={isOwner ? 8 : 6} className="text-center py-12 text-slate-400">
                                            <div className="flex flex-col items-center gap-2">
                                                <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                                                <span>Cargando inventario...</span>
                                            </div>
                                        </td>
                                    </tr>
                                ) : filteredProducts.length === 0 ? (
                                    <tr>
                                        <td colSpan={isOwner ? 8 : 6} className="text-center py-12 text-slate-400">
                                            <Package size={40} className="mx-auto mb-2 opacity-30" />
                                            {searchTerm ? 'No se encontraron resultados' : 'No hay productos. Crea el primero.'}
                                        </td>
                                    </tr>
                                ) : (
                                    filteredProducts.map((product) => {
                                        const isLow = product.stock <= product.minStock && product.stock > 0;
                                        const isOut = product.stock === 0;
                                        const rowBg = isOut
                                            ? 'bg-red-950/20'
                                            : isLow
                                                ? 'bg-amber-950/10'
                                                : 'hover:bg-slate-700/30';

                                        return (
                                            <tr key={product.id} className={`${rowBg} transition-colors`}>
                                                <td className="px-4 py-3">
                                                    <span className="font-mono text-sm text-slate-300 bg-slate-900/60 px-2 py-0.5 rounded">
                                                        {product.sku}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="flex flex-col">
                                                        <span className="text-white font-semibold">{product.name}</span>
                                                        {product.description && (
                                                            <span className="text-xs text-slate-500 truncate max-w-[200px]">{product.description}</span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    {product.category ? (
                                                        <span className="text-xs bg-slate-700/60 text-slate-300 px-2 py-1 rounded-full">
                                                            {product.category}
                                                        </span>
                                                    ) : (
                                                        <span className="text-slate-600">-</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 text-right">
                                                    <div className="flex items-center justify-end gap-2">
                                                        {(isLow || isOut) && (
                                                            <AlertTriangle size={14} className={isOut ? 'text-red-400' : 'text-amber-400'} />
                                                        )}
                                                        <span className={`font-bold ${isOut ? 'text-red-400' : isLow ? 'text-amber-400' : 'text-white'}`}>
                                                            {product.stock}
                                                        </span>
                                                        <span className="text-xs text-slate-500">{product.unit}</span>
                                                    </div>
                                                    {isLow && (
                                                        <span className="text-[10px] text-amber-500">Mín: {product.minStock}</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 text-right text-emerald-400 font-semibold">
                                                    {formatCurrency(product.price)}
                                                </td>
                                                {isOwner && (
                                                    <>
                                                        <td className="px-4 py-3 text-right text-slate-400">
                                                            {formatCurrency(product.cost)}
                                                        </td>
                                                        <td className="px-4 py-3 text-right font-semibold text-cyan-400">
                                                            {formatCurrency(product.stock * product.cost)}
                                                        </td>
                                                    </>
                                                )}
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center justify-center gap-1">
                                                        {isOwner && (
                                                            <>
                                                                <button
                                                                    onClick={() => openKardex(product)}
                                                                    className="p-2 hover:bg-blue-500/20 rounded-lg text-blue-400 transition-colors"
                                                                    title="Auditar Kardex"
                                                                >
                                                                    <Eye size={17} />
                                                                </button>
                                                                <button
                                                                    onClick={() => openAdjust(product)}
                                                                    className="p-2 hover:bg-amber-500/20 rounded-lg text-amber-400 transition-colors"
                                                                    title="Ajuste Manual"
                                                                >
                                                                    <Edit size={17} />
                                                                </button>
                                                                <button
                                                                    onClick={() => handleDelete(product.id, product.name)}
                                                                    className="p-2 hover:bg-red-500/20 rounded-lg text-red-400 transition-colors"
                                                                    title="Eliminar"
                                                                >
                                                                    <Trash2 size={17} />
                                                                </button>
                                                            </>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* ==========================================
                MODAL: KARDEX (HISTORIAL DE AUDITORÍA)
               ========================================== */}
                {showKardexModal && selectedProduct && (
                    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200" onClick={() => setShowKardexModal(false)}>
                        <div className="bg-slate-800 rounded-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden shadow-2xl border border-slate-700" onClick={(e) => e.stopPropagation()}>
                            {/* Kardex Header */}
                            <div className="bg-gradient-to-r from-blue-900/50 to-cyan-900/30 px-6 py-4 flex items-center justify-between border-b border-slate-700">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <Shield size={20} className="text-blue-400" />
                                        <h2 className="text-xl font-bold text-white">Kardex - {selectedProduct.name}</h2>
                                    </div>
                                    <p className="text-sm text-slate-400 mt-1">
                                        SKU: <span className="font-mono text-slate-300">{selectedProduct.sku}</span>
                                        {' '} | Stock Actual: <span className={`font-bold ${selectedProduct.stock <= selectedProduct.minStock ? 'text-red-400' : 'text-emerald-400'}`}>{selectedProduct.stock} {selectedProduct.unit}</span>
                                        {' '} | Valor: <span className="text-cyan-400 font-semibold">{formatCurrency(selectedProduct.stock * selectedProduct.cost)}</span>
                                    </p>
                                </div>
                                <button onClick={() => setShowKardexModal(false)} className="p-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white transition-colors">
                                    <X size={20} />
                                </button>
                            </div>

                            {/* Kardex Table */}
                            <div className="overflow-y-auto max-h-[calc(90vh-120px)]">
                                {kardexLoading ? (
                                    <div className="flex flex-col items-center justify-center py-16">
                                        <div className="w-10 h-10 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mb-3" />
                                        <span className="text-slate-400">Cargando historial...</span>
                                    </div>
                                ) : kardexData.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                                        <Clock size={40} className="opacity-30 mb-2" />
                                        <p>No hay movimientos registrados</p>
                                        <p className="text-xs text-slate-600 mt-1">El historial se llenará automáticamente con cada operación</p>
                                    </div>
                                ) : (
                                    <table className="w-full">
                                        <thead className="bg-slate-900/80 sticky top-0">
                                            <tr>
                                                <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase font-semibold">Fecha</th>
                                                <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase font-semibold">Tipo</th>
                                                <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase font-semibold">Usuario</th>
                                                <th className="text-right px-4 py-3 text-xs text-slate-400 uppercase font-semibold">Cantidad</th>
                                                <th className="text-right px-4 py-3 text-xs text-slate-400 uppercase font-semibold">Saldo Final</th>
                                                <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase font-semibold">Justificación</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-700/50">
                                            {kardexData.map((entry) => {
                                                const meta = getMovementMeta(entry.type);
                                                return (
                                                    <tr key={entry.id} className="hover:bg-slate-700/20 transition-colors">
                                                        <td className="px-4 py-3 text-sm text-slate-300 whitespace-nowrap">
                                                            {formatDate(entry.date)}
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${meta.color}`}>
                                                                <span>{meta.icon}</span>
                                                                {meta.label}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <div className="flex items-center gap-2">
                                                                <div className="w-6 h-6 bg-slate-700 rounded-full flex items-center justify-center">
                                                                    <User size={12} className="text-slate-400" />
                                                                </div>
                                                                <span className="text-sm text-slate-300">{entry.user.name}</span>
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-3 text-right">
                                                            <span className={`font-bold text-sm ${entry.quantity > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                                {entry.quantity > 0 ? '+' : ''}{entry.quantity}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-3 text-right">
                                                            <span className="text-white font-bold text-sm bg-slate-700/60 px-2 py-0.5 rounded">
                                                                {entry.stockAfter}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <span className="text-sm text-slate-400 max-w-[200px] truncate block">
                                                                {entry.reason || '-'}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* ==========================================
                MODAL: AJUSTE MANUAL (SOLO OWNER)
               ========================================== */}
                {showAdjustModal && selectedProduct && (
                    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200" onClick={() => setShowAdjustModal(false)}>
                        <div className="bg-slate-800 rounded-2xl w-full max-w-lg shadow-2xl border border-slate-700" onClick={(e) => e.stopPropagation()}>
                            {/* Adjust Header */}
                            <div className="bg-gradient-to-r from-amber-900/30 to-orange-900/20 px-6 py-4 border-b border-slate-700">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                            <Shield size={20} className="text-amber-400" />
                                            Ajuste Manual de Inventario
                                        </h2>
                                        <p className="text-sm text-slate-400 mt-1">
                                            {selectedProduct.name} | Stock actual: <span className="font-bold text-white">{selectedProduct.stock}</span>
                                        </p>
                                    </div>
                                    <button onClick={() => setShowAdjustModal(false)} className="p-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white">
                                        <X size={20} />
                                    </button>
                                </div>
                            </div>

                            <form onSubmit={handleAdjust} className="p-6 space-y-5">
                                {/* Warn banner */}
                                <div className="bg-amber-950/40 border border-amber-800/50 rounded-lg p-3 flex items-start gap-2">
                                    <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
                                    <p className="text-xs text-amber-300/80">
                                        Este movimiento queda registrado permanentemente en el Kardex con tu nombre, fecha y justificación. No se puede borrar ni editar.
                                    </p>
                                </div>

                                {/* Type */}
                                <div>
                                    <label className="block text-sm text-slate-300 mb-2 font-medium">Tipo de Ajuste</label>
                                    <div className="grid grid-cols-2 gap-2">
                                        {([
                                            { value: 'ADJUST_LOSS', label: 'Pérdida / Merma', icon: TrendingDown, color: 'red' },
                                            { value: 'ADJUST_GAIN', label: 'Ganancia / Hallazgo', icon: TrendingUp, color: 'emerald' },
                                            { value: 'IN_PURCHASE', label: 'Compra / Entrada', icon: ArrowDownCircle, color: 'blue' },
                                            { value: 'RETURN', label: 'Devolución', icon: RotateCcw, color: 'purple' },
                                        ] as const).map(opt => {
                                            const Icon = opt.icon;
                                            const isSelected = adjustForm.type === opt.value;
                                            return (
                                                <button
                                                    key={opt.value}
                                                    type="button"
                                                    onClick={() => setAdjustForm({ ...adjustForm, type: opt.value as AdjustType })}
                                                    className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${isSelected
                                                        ? `border-${opt.color}-500 bg-${opt.color}-950/40 text-${opt.color}-300`
                                                        : 'border-slate-700 bg-slate-900/40 text-slate-400 hover:border-slate-600'
                                                        }`}
                                                >
                                                    <Icon size={16} />
                                                    {opt.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Quantity */}
                                <div>
                                    <label className="block text-sm text-slate-300 mb-1.5 font-medium">
                                        Cantidad {adjustForm.type === 'ADJUST_LOSS' ? '(se restará del stock)' : '(se sumará al stock)'}
                                    </label>
                                    <input
                                        required
                                        type="number"
                                        min="1"
                                        value={adjustForm.quantity}
                                        onChange={(e) => setAdjustForm({ ...adjustForm, quantity: e.target.value })}
                                        placeholder="Ej: 5"
                                        className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white text-lg font-bold focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                                    />
                                    {adjustForm.quantity && (
                                        <p className="text-xs mt-1.5 text-slate-400">
                                            Stock resultante:{' '}
                                            <span className="font-bold text-white">
                                                {adjustForm.type === 'ADJUST_LOSS'
                                                    ? selectedProduct.stock - Math.abs(parseInt(adjustForm.quantity) || 0)
                                                    : selectedProduct.stock + Math.abs(parseInt(adjustForm.quantity) || 0)
                                                }
                                            </span>
                                        </p>
                                    )}
                                </div>

                                {/* Reason (MANDATORY) */}
                                <div>
                                    <label className="block text-sm text-slate-300 mb-1.5 font-medium">
                                        Justificación <span className="text-red-400">*</span>
                                    </label>
                                    <textarea
                                        required
                                        minLength={3}
                                        value={adjustForm.reason}
                                        onChange={(e) => setAdjustForm({ ...adjustForm, reason: e.target.value })}
                                        placeholder='Ej: "Producto dañado por lluvia", "Conteo físico encontró 3 extra", "Compra a Proveedor X Factura #123"'
                                        rows={3}
                                        className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors resize-none"
                                    />
                                </div>

                                {/* Actions */}
                                <div className="flex gap-3 pt-2">
                                    <button
                                        type="submit"
                                        disabled={adjustSubmitting}
                                        className={`flex-1 py-3 rounded-lg font-bold text-white transition-all ${adjustForm.type === 'ADJUST_LOSS'
                                            ? 'bg-red-600 hover:bg-red-700 disabled:bg-red-800'
                                            : 'bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800'
                                            } disabled:opacity-50`}
                                    >
                                        {adjustSubmitting ? 'Procesando...' : (
                                            adjustForm.type === 'ADJUST_LOSS'
                                                ? 'Registrar Pérdida'
                                                : 'Registrar Ajuste'
                                        )}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setShowAdjustModal(false)}
                                        className="px-6 bg-slate-700 py-3 rounded-lg hover:bg-slate-600 text-white font-medium transition-colors"
                                    >
                                        Cancelar
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {/* ==========================================
                MODAL: NUEVO PRODUCTO
               ========================================== */}
                {showCreateModal && (
                    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200" onClick={() => setShowCreateModal(false)}>
                        <div className="bg-slate-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-700" onClick={(e) => e.stopPropagation()}>
                            <div className="bg-gradient-to-r from-blue-900/40 to-cyan-900/20 px-6 py-4 border-b border-slate-700 flex items-center justify-between">
                                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                    <Plus size={20} className="text-blue-400" />
                                    Nuevo Producto
                                </h2>
                                <button onClick={() => setShowCreateModal(false)} className="p-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white">
                                    <X size={20} />
                                </button>
                            </div>

                            <form onSubmit={handleCreate} className="p-6 space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm text-slate-300 mb-1 font-medium">Nombre del Producto *</label>
                                        <input
                                            required
                                            value={formData.name}
                                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                            className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm text-slate-300 mb-1 font-medium">SKU / Código *</label>
                                        <input
                                            required
                                            value={formData.sku}
                                            onChange={(e) => setFormData({ ...formData, sku: e.target.value.toUpperCase() })}
                                            className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm text-slate-300 mb-1 font-medium">Descripción</label>
                                    <textarea
                                        value={formData.description}
                                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-none"
                                        rows={2}
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm text-slate-300 mb-1 font-medium">Categoría</label>
                                        <input
                                            value={formData.category}
                                            onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                                            className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm text-slate-300 mb-1 font-medium">Unidad</label>
                                        <select
                                            value={formData.unit}
                                            onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                                            className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white"
                                        >
                                            <option>unidad</option>
                                            <option>kg</option>
                                            <option>litro</option>
                                            <option>caja</option>
                                            <option>metro</option>
                                            <option>par</option>
                                            <option>rollo</option>
                                        </select>
                                    </div>
                                </div>

                                <div className="grid grid-cols-4 gap-4">
                                    <div className="col-span-2">
                                        <label className="block text-sm text-slate-300 mb-1 font-medium">Precio de Venta *</label>
                                        <input
                                            required
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            value={formData.price}
                                            onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                                            className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                        />
                                    </div>
                                    <div className="col-span-2">
                                        <label className="block text-sm text-slate-300 mb-1 font-medium">Costo de Compra *</label>
                                        <input
                                            required
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            value={formData.cost}
                                            onChange={(e) => setFormData({ ...formData, cost: e.target.value })}
                                            className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                        />
                                    </div>
                                    <div className="col-span-2">
                                        <label className="block text-sm text-slate-300 mb-1 font-medium">Stock Inicial</label>
                                        <input
                                            type="number"
                                            min="0"
                                            value={formData.stock}
                                            onChange={(e) => setFormData({ ...formData, stock: e.target.value })}
                                            className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                        />
                                    </div>
                                    <div className="col-span-2">
                                        <label className="block text-sm text-slate-300 mb-1 font-medium">Stock Mínimo</label>
                                        <input
                                            type="number"
                                            min="0"
                                            value={formData.minStock}
                                            onChange={(e) => setFormData({ ...formData, minStock: e.target.value })}
                                            className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                        />
                                    </div>
                                </div>

                                <div className="flex gap-3 pt-2">
                                    <button
                                        type="submit"
                                        className="flex-1 bg-blue-600 py-3 rounded-lg hover:bg-blue-700 text-white font-bold transition-colors"
                                    >
                                        Crear Producto
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setShowCreateModal(false)}
                                        className="px-6 bg-slate-700 py-3 rounded-lg hover:bg-slate-600 text-white font-medium transition-colors"
                                    >
                                        Cancelar
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {/* ==========================================
                MODAL: IMPORTADOR MASIVO
               ========================================== */}
                {showImportModal && (
                    <ProductImporter
                        onClose={() => setShowImportModal(false)}
                        onSuccess={() => {
                            fetchProducts();
                            setShowImportModal(false);
                        }}
                    />
                )}
                {/* ==========================================
                MODAL: QUICK ADD SCANNER MODE
               ========================================== */}
                {showQuickAddModal && (
                    <QuickAddProduct
                        initialSKU={quickAddSKU}
                        onClose={() => setShowQuickAddModal(false)}
                        onSuccess={() => {
                            fetchProducts();
                            // Don't close modal here, QuickAddProduct handles continuous mode
                        }}
                    />
                )}
            </div>
        );
    }
