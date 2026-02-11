import React, { useState, useEffect, useRef } from 'react';
import { X, Zap, Check, AlertCircle, History, Volume2, VolumeX } from 'lucide-react';

interface Product {
    id: string;
    sku: string;
    name: string;
    category?: string;
    price: number;
    cost: number;
    stock: number;
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
        stock: ''
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
                    cost: parseFloat(formData.cost),
                    stock: parseInt(formData.stock) || 0,
                    minStock: 5,
                    unit: 'unidad'
                })
            });

            const data = await res.json();

            if (res.ok) {
                // Success!
                playSound('success');

                // Add to session history
                const newProduct: Product = {
                    id: data.id || Date.now().toString(),
                    sku: formData.sku.toUpperCase(),
                    name: formData.name,
                    category: formData.category,
                    price: parseFloat(formData.price),
                    cost: parseFloat(formData.cost),
                    stock: parseInt(formData.stock) || 0
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
                        stock: ''
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
            <div className="bg-slate-800 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl border border-slate-700" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="bg-gradient-to-r from-orange-900/40 to-red-900/20 px-6 py-4 border-b border-slate-700 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-orange-600 rounded-lg flex items-center justify-center">
                            <Zap size={20} className="text-white" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                🔫 Modo Alta Velocidad
                            </h2>
                            <p className="text-sm text-slate-400">
                                {sessionHistory.length} producto{sessionHistory.length !== 1 ? 's' : ''} agregado{sessionHistory.length !== 1 ? 's' : ''} en esta sesión
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setAudioEnabled(!audioEnabled)}
                            className="p-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white transition-colors"
                            title={audioEnabled ? 'Silenciar' : 'Activar sonido'}
                        >
                            {audioEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
                        </button>
                        <button onClick={onClose} className="p-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white transition-colors">
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
                                    <span className="text-emerald-300 font-semibold">✅ Producto guardado</span>
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
                                <label className="block text-sm text-slate-300 mb-1.5 font-medium">
                                    SKU / Código de Barras *
                                </label>
                                <input
                                    ref={skuInputRef}
                                    required
                                    autoFocus={!initialSKU}
                                    value={formData.sku}
                                    onChange={(e) => setFormData({ ...formData, sku: e.target.value.toUpperCase() })}
                                    className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-lg text-white text-lg font-mono focus:border-orange-500 focus:ring-2 focus:ring-orange-500/50 transition-all"
                                    placeholder="7501234567890"
                                />
                            </div>

                            {/* Name */}
                            <div>
                                <label className="block text-sm text-slate-300 mb-1.5 font-medium">
                                    Nombre del Producto *
                                </label>
                                <input
                                    ref={nameInputRef}
                                    required
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-lg text-white text-lg focus:border-orange-500 focus:ring-2 focus:ring-orange-500/50 transition-all"
                                    placeholder="Martillo Truper 16oz"
                                />
                            </div>

                            {/* Category */}
                            <div>
                                <label className="block text-sm text-slate-300 mb-1.5 font-medium">
                                    Categoría
                                </label>
                                <input
                                    value={formData.category}
                                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                                    className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-orange-500 focus:ring-2 focus:ring-orange-500/50 transition-all"
                                    placeholder="Herramientas"
                                />
                            </div>

                            {/* Price & Cost */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm text-slate-300 mb-1.5 font-medium">
                                        Precio Venta *
                                    </label>
                                    <input
                                        required
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={formData.price}
                                        onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                                        className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-lg text-white text-lg focus:border-orange-500 focus:ring-2 focus:ring-orange-500/50 transition-all"
                                        placeholder="150.00"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm text-slate-300 mb-1.5 font-medium">
                                        Costo *
                                    </label>
                                    <input
                                        required
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={formData.cost}
                                        onChange={(e) => setFormData({ ...formData, cost: e.target.value })}
                                        className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-lg text-white text-lg focus:border-orange-500 focus:ring-2 focus:ring-orange-500/50 transition-all"
                                        placeholder="95.00"
                                    />
                                </div>
                            </div>

                            {/* Stock */}
                            <div>
                                <label className="block text-sm text-slate-300 mb-1.5 font-medium">
                                    Stock Inicial
                                </label>
                                <input
                                    type="number"
                                    min="0"
                                    value={formData.stock}
                                    onChange={(e) => setFormData({ ...formData, stock: e.target.value })}
                                    className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-lg text-white text-lg focus:border-orange-500 focus:ring-2 focus:ring-orange-500/50 transition-all"
                                    placeholder="0"
                                />
                            </div>

                            {/* Continuous Mode Toggle */}
                            <div className="bg-slate-900/60 border border-slate-700 rounded-lg p-4 flex items-center justify-between">
                                <div>
                                    <p className="text-white font-semibold">Modo Continuo</p>
                                    <p className="text-xs text-slate-400">No cerrar ventana al guardar</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setContinuousMode(!continuousMode)}
                                    className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors ${continuousMode ? 'bg-orange-600' : 'bg-slate-700'
                                        }`}
                                >
                                    <span
                                        className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${continuousMode ? 'translate-x-8' : 'translate-x-1'
                                            }`}
                                    />
                                </button>
                            </div>

                            {/* Submit Button */}
                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className="w-full bg-orange-600 hover:bg-orange-700 disabled:bg-orange-800 disabled:opacity-50 py-4 rounded-lg text-white font-bold text-lg transition-colors flex items-center justify-center gap-2"
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

                            <p className="text-xs text-slate-500 text-center">
                                Presiona <kbd className="px-2 py-1 bg-slate-700 rounded text-slate-300">ESC</kbd> para cerrar
                            </p>
                        </form>
                    </div>

                    {/* Session History Sidebar */}
                    <div className="w-72 bg-slate-900/60 border border-slate-700 rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-3">
                            <History size={18} className="text-slate-400" />
                            <h3 className="font-semibold text-white">Últimos Agregados</h3>
                        </div>

                        {sessionHistory.length === 0 ? (
                            <div className="text-center py-8">
                                <p className="text-slate-500 text-sm">Aún no has agregado productos</p>
                                <p className="text-xs text-slate-600 mt-1">Completa el formulario y guarda</p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {sessionHistory.map((product, index) => (
                                    <div
                                        key={index}
                                        className="bg-slate-800/60 border border-slate-700 rounded-lg p-3 animate-in fade-in slide-in-from-top-2 duration-200"
                                    >
                                        <div className="flex items-start gap-2">
                                            <Check size={16} className="text-emerald-400 mt-0.5 shrink-0" />
                                            <div className="flex-1 min-w-0">
                                                <p className="text-white font-semibold text-sm truncate">{product.name}</p>
                                                <p className="text-xs text-slate-400 font-mono">{product.sku}</p>
                                                <p className="text-xs text-emerald-400 font-bold mt-1">
                                                    C$ {product.price.toFixed(2)}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {sessionHistory.length > 0 && (
                            <div className="mt-4 pt-4 border-t border-slate-700">
                                <div className="bg-orange-950/40 border border-orange-800/50 rounded-lg p-3">
                                    <p className="text-xs text-orange-300 font-semibold">
                                        📊 Total: {sessionHistory.length} producto{sessionHistory.length !== 1 ? 's' : ''}
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
