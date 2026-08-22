import React, { useState, useEffect, useRef } from 'react';
import { X, Zap, Check, AlertCircle, History, Volume2, VolumeX } from 'lucide-react';
import ImageUploader from './ImageUploader';
import { formatMoney } from '../utils/money';
import { trackEvent } from '../utils/analytics';
import { productFamilyPreset, type ProductFamily } from '../utils/productFamilyPresets';

interface Product {
    id: string;
    sku: string;
    name: string;
    category?: string;
    price: number;
    cost: number;
    stock: number;
    unit?: string;
    saleMode?: 'COUNTED' | 'MEASURED';
    quantityStep?: string;
    productFamily?: string;
}

interface QuickAddProductProps {
    initialSKU?: string;
    onClose: () => void;
    onSuccess: () => void;
}

const QuickAddProduct: React.FC<QuickAddProductProps> = ({ initialSKU = '', onClose, onSuccess }) => {
    // Form state
    const [formData, setFormData] = useState({
        sku: initialSKU,
        name: '',
        category: '',
        price: '',
        cost: '',
        stock: '',
        imageUrl: '',
        unit: 'unidad',
        saleMode: 'COUNTED' as 'COUNTED' | 'MEASURED',
        quantityStep: '1',
        productFamily: 'GENERAL',
    });

    // UI state
    const [continuousMode, setContinuousMode] = useState(true);
    const [audioEnabled, setAudioEnabled] = useState(true);
    const [sessionHistory, setSessionHistory] = useState<Product[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showSuccess, setShowSuccess] = useState(false);
    const [error, setError] = useState('');

    // Refs
    const skuInputRef = useRef<HTMLInputElement>(null);
    const nameInputRef = useRef<HTMLInputElement>(null);

    // Auto-focus SKU on mount
    useEffect(() => {
        if (initialSKU) {
            nameInputRef.current?.focus();
        } else {
            skuInputRef.current?.focus();
        }
    }, [initialSKU]);

    // Audio feedback
    const playSound = (type: 'success' | 'error') => {
        if (!audioEnabled) return;

        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        if (type === 'success') {
            // High-pitched "ching!" sound
            oscillator.frequency.value = 800;
            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
        } else {
            // Low-pitched "bonk" sound
            oscillator.frequency.value = 200;
            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
        }

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.15);
    };

    // Handle form submission
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsSubmitting(true);

        try {
            const token = localStorage.getItem('nortex_token');
            const res = await fetch('/api/products', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    sku: formData.sku.trim().toUpperCase(),
                    name: formData.name.trim(),
                    category: formData.category.trim() || undefined,
                    price: parseFloat(formData.price),
                    // Costo opcional: si el dueño no lo sabe, va 0 (se corrige con la compra).
                    cost: formData.cost ? parseFloat(formData.cost) : 0,
                    // La frontera HTTP conserva el texto para que el servidor
                    // pueda rechazar precisión excesiva antes de tocar Float.
                    stock: formData.stock === '' ? '0' : formData.stock,
                    minStock: 5,
                    unit: formData.unit,
                    saleMode: formData.saleMode,
                    quantityStep: formData.quantityStep,
                    productFamily: formData.productFamily,
                    imageUrl: formData.imageUrl || undefined,
                })
            });

            const data = await res.json();

            if (res.ok) {
                // Success!
                playSound('success');
                if (formData.saleMode === 'MEASURED') {
                    trackEvent('measured_product_created', {
                        unit: formData.unit,
                        family: formData.productFamily,
                        source: 'quick_add',
                    });
                }

                // Add to session history
                const newProduct: Product = {
                    id: data.id || Date.now().toString(),
                    sku: formData.sku.toUpperCase(),
                    name: formData.name,
                    category: formData.category,
                    price: parseFloat(formData.price),
                    cost: formData.cost ? parseFloat(formData.cost) : 0,
                    stock: formData.stock === '' ? 0 : Number(formData.stock),
                    unit: formData.unit,
                    saleMode: formData.saleMode,
                    quantityStep: formData.quantityStep,
                    productFamily: formData.productFamily,
                };
                setSessionHistory(prev => [newProduct, ...prev].slice(0, 5));

                // Show success message
                setShowSuccess(true);
                setTimeout(() => setShowSuccess(false), 1000);

                // Call parent success callback
                onSuccess();

                if (continuousMode) {
                    // Clear form but keep category
                    const lastCategory = formData.category;
                    setFormData({
                        sku: '',
                        name: '',
                        category: lastCategory,
                        price: '',
                        cost: '',
                        stock: '',
                        imageUrl: '',
                        unit: formData.unit,
                        saleMode: formData.saleMode,
                        quantityStep: formData.quantityStep,
                        productFamily: formData.productFamily,
                    });
                    // Refocus SKU
                    setTimeout(() => skuInputRef.current?.focus(), 100);
                } else {
                    // Close modal
                    onClose();
                }
            } else {
                setError(data.error || 'Error al crear producto');
                playSound('error');
            }
        } catch (err) {
            setError('Error de conexión al servidor');
            playSound('error');
        } finally {
            setIsSubmitting(false);
        }
    };

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // F2 to save
            if (e.key === 'F2') {
                e.preventDefault();
                handleSubmit(e as any);
            }
            // ESC to close
            if (e.key === 'Escape') {
                onClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [formData, continuousMode]);

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-surface-800 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl border border-surface-700" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="bg-gradient-to-r from-brand-900/40 to-red-900/20 px-6 py-4 border-b border-surface-700 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-brand-600 rounded-lg flex items-center justify-center">
                            <Zap size={20} className="text-white" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                Modo Alta Velocidad
                            </h2>
                            <p className="text-sm text-surface-400">
                                {sessionHistory.length} producto{sessionHistory.length !== 1 ? 's' : ''} agregado{sessionHistory.length !== 1 ? 's' : ''} en esta sesión
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setAudioEnabled(!audioEnabled)}
                            className="p-2 hover:bg-surface-700 rounded-lg text-surface-400 hover:text-white transition-colors"
                            title={audioEnabled ? 'Silenciar' : 'Activar sonido'}
                        >
                            {audioEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
                        </button>
                        <button onClick={onClose} aria-label="Cerrar modo rápido" className="p-2 hover:bg-surface-700 rounded-lg text-surface-400 hover:text-white transition-colors">
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Body */}
                <div className="flex gap-4 p-6 max-h-[calc(90vh-120px)] overflow-y-auto">
                    {/* Form Section */}
                    <div className="flex-1">
                        <form onSubmit={handleSubmit} className="space-y-4">
                            {/* Success Message */}
                            {showSuccess && (
                                <div className="bg-emerald-950/60 border border-emerald-700 rounded-lg p-3 flex items-center gap-2 animate-pulse">
                                    <Check size={20} className="text-emerald-400" />
                                    <span className="text-emerald-300 font-semibold">Producto guardado</span>
                                </div>
                            )}

                            {/* Error Message */}
                            {error && (
                                <div className="bg-red-950/60 border border-red-700 rounded-lg p-3 flex items-center gap-2">
                                    <AlertCircle size={20} className="text-red-400" />
                                    <span className="text-red-300">{error}</span>
                                </div>
                            )}

                            {/* SKU */}
                            <div>
                                <label className="block text-sm text-surface-300 mb-1.5 font-medium">
                                    SKU / Código de Barras *
                                </label>
                                <input
                                    ref={skuInputRef}
                                    required
                                    autoFocus={!initialSKU}
                                    value={formData.sku}
                                    onChange={(e) => setFormData({ ...formData, sku: e.target.value.toUpperCase() })}
                                    className="w-full px-4 py-3 bg-surface-900 border border-surface-700 rounded-lg text-white text-lg font-mono focus:border-brand-500 focus:ring-2 focus:ring-brand-500/50 transition-all"
                                    placeholder="7501234567890"
                                />
                            </div>

                            {/* Name */}
                            <div>
                                <label className="block text-sm text-surface-300 mb-1.5 font-medium">
                                    Nombre del Producto *
                                </label>
                                <input
                                    ref={nameInputRef}
                                    required
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    className="w-full px-4 py-3 bg-surface-900 border border-surface-700 rounded-lg text-white text-lg focus:border-brand-500 focus:ring-2 focus:ring-brand-500/50 transition-all"
                                    placeholder="Martillo Truper 16oz"
                                />
                            </div>

                            {/* Category */}
                            <div>
                                <label className="block text-sm text-surface-300 mb-1.5 font-medium">
                                    Categoría
                                </label>
                                <input
                                    value={formData.category}
                                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                                    className="w-full px-4 py-3 bg-surface-900 border border-surface-700 rounded-lg text-white focus:border-brand-500 focus:ring-2 focus:ring-brand-500/50 transition-all"
                                    placeholder="Herramientas"
                                />
                            </div>

                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <label className="block text-sm text-surface-300 mb-1.5 font-medium">Venta</label>
                                    <select
                                        value={formData.saleMode}
                                        onChange={(e) => {
                                            const saleMode = e.target.value as 'COUNTED' | 'MEASURED';
                                            setFormData({ ...formData, saleMode, quantityStep: saleMode === 'COUNTED' ? '1' : '0.001' });
                                        }}
                                        className="w-full px-3 py-3 bg-surface-900 border border-surface-700 rounded-lg text-white"
                                    >
                                        <option value="COUNTED">Unidades</option>
                                        <option value="MEASURED">Peso/medida</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm text-surface-300 mb-1.5 font-medium">Unidad</label>
                                    <select value={formData.unit} onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                                        className="w-full px-3 py-3 bg-surface-900 border border-surface-700 rounded-lg text-white">
                                        {['unidad', 'g', 'kg', 'oz', 'lb', 'ml', 'litro', 'metro', 'saco', 'caja', 'frasco', 'bolsa'].map(unit => <option key={unit}>{unit}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm text-surface-300 mb-1.5 font-medium">Paso</label>
                                    <input required type="number" min="0.0001" step="0.0001" value={formData.quantityStep}
                                        onChange={(e) => setFormData({ ...formData, quantityStep: e.target.value })}
                                        className="w-full px-3 py-3 bg-surface-900 border border-surface-700 rounded-lg text-white" />
                                </div>
                                <div className="col-span-3">
                                    <label className="block text-sm text-surface-300 mb-1.5 font-medium">Familia</label>
                                    <select value={formData.productFamily} onChange={(e) => {
                                        const productFamily = e.target.value as ProductFamily;
                                        const preset = productFamilyPreset(productFamily);
                                        setFormData({
                                            ...formData,
                                            productFamily,
                                            unit: preset.unit,
                                            saleMode: preset.saleMode,
                                            quantityStep: preset.quantityStep,
                                        });
                                    }}
                                        className="w-full px-3 py-3 bg-surface-900 border border-surface-700 rounded-lg text-white">
                                        <option value="GENERAL">General</option>
                                        <option value="MEAT">Carnes</option>
                                        <option value="POULTRY">Pollos y aves</option>
                                        <option value="ANIMAL_FEED">Alimento animal</option>
                                        <option value="AGRO_INPUT">Agroinsumos</option>
                                        <option value="VETERINARY">Veterinaria</option>
                                    </select>
                                </div>
                            </div>

                            {/* Price & Cost */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm text-surface-300 mb-1.5 font-medium">
                                        Precio Venta *
                                    </label>
                                    <input
                                        required
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={formData.price}
                                        onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                                        className="w-full px-4 py-3 bg-surface-900 border border-surface-700 rounded-lg text-white text-lg focus:border-brand-500 focus:ring-2 focus:ring-brand-500/50 transition-all"
                                        placeholder="150.00"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm text-surface-300 mb-1.5 font-medium">
                                        Costo <span className="text-surface-500 font-normal">(opcional)</span>
                                    </label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={formData.cost}
                                        onChange={(e) => setFormData({ ...formData, cost: e.target.value })}
                                        className="w-full px-4 py-3 bg-surface-900 border border-surface-700 rounded-lg text-white text-lg focus:border-brand-500 focus:ring-2 focus:ring-brand-500/50 transition-all"
                                        placeholder="95.00"
                                    />
                                </div>
                            </div>

                            {/* Stock */}
                            <div>
                                <label className="block text-sm text-surface-300 mb-1.5 font-medium">
                                    Stock Inicial
                                </label>
                                <input
                                    type="number"
                                    min="0"
                                    step={formData.quantityStep || (formData.saleMode === 'COUNTED' ? '1' : '0.0001')}
                                    value={formData.stock}
                                    onChange={(e) => setFormData({ ...formData, stock: e.target.value })}
                                    className="w-full px-4 py-3 bg-surface-900 border border-surface-700 rounded-lg text-white text-lg focus:border-brand-500 focus:ring-2 focus:ring-brand-500/50 transition-all"
                                    placeholder="0"
                                />
                            </div>

                            {/* Foto del Producto */}
                            <div>
                                <label className="block text-sm text-surface-300 mb-1.5 font-medium">
                                    Foto del Producto <span className="text-surface-500 font-normal">(opcional)</span>
                                </label>
                                <ImageUploader
                                    value={formData.imageUrl}
                                    onChange={(url) => setFormData({ ...formData, imageUrl: url })}
                                    disabled={isSubmitting}
                                />
                            </div>

                            {/* Continuous Mode Toggle */}
                            <div className="bg-surface-900/60 border border-surface-700 rounded-lg p-4 flex items-center justify-between">
                                <div>
                                    <p className="text-white font-semibold">Modo Continuo</p>
                                    <p className="text-xs text-surface-400">No cerrar ventana al guardar</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setContinuousMode(!continuousMode)}
                                    className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors ${continuousMode ? 'bg-brand-600' : 'bg-surface-700'
                                        }`}
                                >
                                    <span
                                        className={`inline-block h-5 w-5 transform rounded-full bg-surface-900 transition-transform ${continuousMode ? 'translate-x-8' : 'translate-x-1'
                                            }`}
                                    />
                                </button>
                            </div>

                            {/* Submit Button */}
                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className="w-full bg-brand-600 hover:bg-brand-700 disabled:bg-brand-800 disabled:opacity-50 py-4 rounded-lg text-white font-bold text-lg transition-colors flex items-center justify-center gap-2"
                            >
                                {isSubmitting ? (
                                    <>
                                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                        Guardando...
                                    </>
                                ) : (
                                    <>
                                        <Zap size={20} />
                                        Guardar (F2 o ENTER)
                                    </>
                                )}
                            </button>

                            <p className="text-xs text-surface-500 text-center">
                                Presiona <kbd className="px-2 py-1 bg-surface-700 rounded text-surface-300">ESC</kbd> para cerrar
                            </p>
                        </form>
                    </div>

                    {/* Session History Sidebar */}
                    <div className="w-72 bg-surface-900/60 border border-surface-700 rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-3">
                            <History size={18} className="text-surface-400" />
                            <h3 className="font-semibold text-white">Últimos Agregados</h3>
                        </div>

                        {sessionHistory.length === 0 ? (
                            <div className="text-center py-8">
                                <p className="text-surface-500 text-sm">Aún no has agregado productos</p>
                                <p className="text-xs text-surface-300 mt-1">Completa el formulario y guarda</p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {sessionHistory.map((product, index) => (
                                    <div
                                        key={index}
                                        className="bg-surface-800/60 border border-surface-700 rounded-lg p-3 animate-in fade-in slide-in-from-top-2 duration-200"
                                    >
                                        <div className="flex items-start gap-2">
                                            <Check size={16} className="text-emerald-400 mt-0.5 shrink-0" />
                                            <div className="flex-1 min-w-0">
                                                <p className="text-white font-semibold text-sm truncate">{product.name}</p>
                                                <p className="text-xs text-surface-400 font-mono">{product.sku}</p>
                                                <p className="text-xs text-emerald-400 font-bold mt-1">
                                                    {formatMoney(product.price)}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {sessionHistory.length > 0 && (
                            <div className="mt-4 pt-4 border-t border-surface-700">
                                <div className="bg-brand-950/40 border border-brand-800/50 rounded-lg p-3">
                                    <p className="text-xs text-brand-300 font-semibold">
                                        Total: {sessionHistory.length} producto{sessionHistory.length !== 1 ? 's' : ''}
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default QuickAddProduct;
