import React, { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import ImageUploader from './ImageUploader';
import { formatMoney } from '../utils/money';
import { trackEvent } from '../utils/analytics';
import { productFamilyPreset, type ProductFamily } from '../utils/productFamilyPresets';
import { buildCreateProductPayload, productValidationMessage } from '../utils/productForm';

interface Product {
    id: string;
    sku: string;
    brand?: string | null;
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
    onSuccess: (product?: Product) => void;
}

const QuickAddProduct: React.FC<QuickAddProductProps> = ({ initialSKU = '', onClose, onSuccess }) => {
    // Form state
    const [formData, setFormData] = useState({
        sku: initialSKU,
        name: '',
        brand: '',
        category: '',
        price: '',
        cost: '',
        stock: '',
        imageUrl: '',
        unit: 'unidad',
        saleMode: 'COUNTED' as 'COUNTED' | 'MEASURED',
        quantityStep: '1',
        productFamily: 'GENERAL' as ProductFamily,
        description: '', minStock: '5', isPublished: false, requiresBatchTracking: false,
        ivaExento: false, reorderPoint: '', maxStock: '', wholesalePrice: '', wholesaleMinQty: '',
        packUnit: '', packSize: '', packPrice: '',
    });

    // UI state
    const [continuousMode, setContinuousMode] = useState(false);
    const [audioEnabled, setAudioEnabled] = useState(true);
    const [sessionHistory, setSessionHistory] = useState<Product[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showSuccess, setShowSuccess] = useState(false);
    const [error, setError] = useState('');

    // Refs
    const skuInputRef = useRef<HTMLInputElement>(null);
    const nameInputRef = useRef<HTMLInputElement>(null);
    const formRef = useRef<HTMLFormElement>(null);
    const submittingRef = useRef(false);
    const requestClose = () => { if (!submittingRef.current) onClose(); };

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

        try {
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
        oscillator.onended = () => { void audioContext.close().catch(() => {}); };
        } catch { /* El sonido opcional nunca cambia el resultado de guardar. */ }
    };

    // Handle form submission
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (submittingRef.current) return;
        const payload = buildCreateProductPayload(formData);
        if (formData.requiresBatchTracking && Number(payload.stock) > 0) {
            setError('Creá este producto sin existencias. Después registrá la entrada con lote, vencimiento y bodega desde Compras o Lotes.');
            return;
        }
        submittingRef.current = true;
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
                body: JSON.stringify(payload)
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
                    id: data.id,
                    sku: formData.sku.toUpperCase(),
                    name: formData.name,
                    brand: formData.brand.trim() || null,
                    category: formData.category,
                    price: Number(data.price ?? payload.price),
                    cost: Number(data.cost ?? payload.cost),
                    stock: Number(data.stock ?? payload.stock),
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
                onSuccess({ ...newProduct, ...data });

                if (continuousMode) {
                    // Clear form but keep category
                    const lastCategory = formData.category;
                    setFormData({
                        ...formData,
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
                setError(productValidationMessage(data, 'Error al crear producto'));
                playSound('error');
            }
        } catch (err) {
            setError('Error de conexión al servidor');
            playSound('error');
        } finally {
            submittingRef.current = false;
            setIsSubmitting(false);
        }
    };

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // F2 to save
            if (e.key === 'F2') {
                e.preventDefault();
                if (!submittingRef.current) formRef.current?.requestSubmit();
            }
            // ESC to close
            if (e.key === 'Escape') {
                requestClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [formData, continuousMode]);

    const fieldClass = 'nx-form-field w-full rounded-control border bg-surface-900 px-3 py-2.5 text-slate-100';
    const labelClass = 'mb-1 block text-sm font-medium text-surface-300';
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm" onClick={requestClose}>
            <div role="dialog" aria-modal="true" aria-label="Nuevo producto" className="nx-dark-context flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-surface-700 bg-surface-800 shadow-2xl" onClick={event => event.stopPropagation()}>
                <header className="flex shrink-0 items-center justify-between border-b border-surface-700 px-5 py-4">
                    <div>
                        <h2 className="text-xl font-bold text-white">Nuevo producto</h2>
                        <p className="mt-1 text-sm text-surface-400">Identificalo y definí cómo lo vendés.</p>
                    </div>
                    <button type="button" onClick={requestClose} disabled={isSubmitting} aria-label="Cerrar modo rápido" className="rounded-lg p-2 text-surface-300 hover:bg-surface-700 disabled:opacity-40"><X size={20} /></button>
                </header>
                <form ref={formRef} onSubmit={handleSubmit} aria-busy={isSubmitting} className="flex min-h-0 flex-1 flex-col">
                    <div className="min-h-0 overflow-y-auto px-5 py-4">
                        <fieldset disabled={isSubmitting} className="space-y-4">
                            {showSuccess && <p role="status" className="rounded-lg bg-emerald-950/60 p-3 text-emerald-300">Producto guardado</p>}
                            {error && <p role="alert" className="rounded-lg bg-red-950/60 p-3 text-red-300">{error}</p>}
                            <div>
                                <label htmlFor="quick-name" className={labelClass}>Nombre del producto *</label>
                                <input id="quick-name" ref={nameInputRef} required maxLength={200} value={formData.name} onChange={event => setFormData({ ...formData, name: event.target.value })} className={fieldClass} placeholder="Martillo 16oz" />
                            </div>
                            <div><label htmlFor="quick-brand" className={labelClass}>Marca (opcional)</label><input id="quick-brand" maxLength={100} value={formData.brand} onChange={event => setFormData({ ...formData, brand: event.target.value })} className={fieldClass} placeholder="Ej. Truper" /></div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label htmlFor="quick-sku" className={labelClass}>Código o código de barras *</label>
                                    <input id="quick-sku" ref={skuInputRef} required maxLength={100} value={formData.sku} onChange={event => setFormData({ ...formData, sku: event.target.value.toUpperCase() })} className={fieldClass} placeholder="7501234567890" />
                                </div>
                                <div>
                                    <label htmlFor="quick-price" className={labelClass}>Precio de venta (C$) *</label>
                                    <input id="quick-price" required type="text" inputMode="decimal" value={formData.price} onChange={event => setFormData({ ...formData, price: event.target.value })} className={fieldClass} placeholder="150.00" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label htmlFor="quick-mode" className={labelClass}>¿Cómo se vende?</label>
                                    <select id="quick-mode" value={formData.saleMode} onChange={event => {
                                        const saleMode = event.target.value as 'COUNTED' | 'MEASURED';
                                        setFormData({ ...formData, saleMode, quantityStep: saleMode === 'COUNTED' ? '1' : '0.001' });
                                    }} className={fieldClass}><option value="COUNTED">Por unidades enteras</option><option value="MEASURED">Por peso o medida</option></select>
                                </div>
                                <div>
                                    <label htmlFor="quick-unit" className={labelClass}>Unidad de venta</label>
                                    <select id="quick-unit" value={formData.unit} onChange={event => {
                                        const unit = event.target.value;
                                        const measured = ['g', 'kg', 'oz', 'lb', 'ml', 'litro', 'metro'].includes(unit);
                                        setFormData({ ...formData, unit, saleMode: measured ? 'MEASURED' : 'COUNTED', quantityStep: measured ? '0.001' : '1' });
                                    }} className={fieldClass}>{['unidad', 'g', 'kg', 'oz', 'lb', 'ml', 'litro', 'metro', 'saco', 'caja', 'frasco', 'bolsa', 'par', 'rollo'].map(unit => <option key={unit}>{unit}</option>)}</select>
                                </div>
                            </div>
                            <p className="text-sm text-surface-400">El precio es por {formData.unit}.{formData.saleMode === 'MEASURED' ? ` Podés vender múltiplos de ${formData.quantityStep} ${formData.unit}.` : ' Se venden cantidades enteras.'}</p>
                            <details className="rounded-lg border border-surface-700 p-3">
                                <summary className="cursor-pointer font-semibold text-surface-300">Más opciones</summary>
                                <div className="mt-4 space-y-4">
                                    <div>
                                        <label htmlFor="quick-family" className={labelClass}>Plantilla de producto</label>
                                        <select id="quick-family" value={formData.productFamily} onChange={event => {
                                            const productFamily = event.target.value as ProductFamily;
                                            setFormData({ ...formData, productFamily, ...productFamilyPreset(productFamily) });
                                        }} className={fieldClass}>
                                            <option value="GENERAL">General</option><option value="MEAT">Carnes</option><option value="POULTRY">Pollos y aves</option><option value="ANIMAL_FEED">Alimento animal</option><option value="AGRO_INPUT">Agroinsumos</option><option value="VETERINARY">Veterinaria</option>
                                        </select>
                                        <p className="mt-1 text-xs text-surface-400">Aplica unidad, fracción, empaque y control por lote. Revisalos antes de guardar.</p>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div><label htmlFor="quick-category" className={labelClass}>Categoría</label><input id="quick-category" value={formData.category} onChange={event => setFormData({ ...formData, category: event.target.value })} className={fieldClass} placeholder="Herramientas" /></div>
                                        <div><label htmlFor="quick-cost" className={labelClass}>Costo (C$, opcional)</label><input id="quick-cost" type="text" inputMode="decimal" value={formData.cost} onChange={event => setFormData({ ...formData, cost: event.target.value })} className={fieldClass} placeholder="95.00" /></div>
                                        <div><label htmlFor="quick-step" className={labelClass}>Fracción o salto de venta</label><input id="quick-step" required type="text" inputMode="decimal" value={formData.quantityStep} onChange={event => setFormData({ ...formData, quantityStep: event.target.value })} className={fieldClass} /></div>
                                        <div><label htmlFor="quick-min" className={labelClass}>Avisar al llegar a</label><input id="quick-min" type="text" inputMode="decimal" value={formData.minStock} onChange={event => setFormData({ ...formData, minStock: event.target.value })} className={fieldClass} /></div>
                                    </div>
                                    <div>
                                        <label htmlFor="quick-stock" className={labelClass}>Existencias iniciales ({formData.unit})</label>
                                        <input id="quick-stock" type="text" inputMode="decimal" value={formData.stock} onChange={event => setFormData({ ...formData, stock: event.target.value })} className={fieldClass} placeholder="0" />
                                        <p className="mt-1 text-xs text-surface-400">Dejalo en cero para registrar la entrada después desde Compras. El alta inicial usa la bodega principal.</p>
                                    </div>
                                    <label className="flex items-center gap-2 text-sm text-surface-300"><input type="checkbox" checked={formData.requiresBatchTracking} onChange={event => setFormData({ ...formData, requiresBatchTracking: event.target.checked })} />Controlar lotes y vencimiento</label>
                                    {formData.requiresBatchTracking && <p className="text-sm text-amber-300">Creá el producto sin existencias. Luego registrá la entrada con lote, vencimiento y bodega desde Compras o Lotes.</p>}
                                    {formData.packUnit && <p className="text-sm text-surface-300">Un {formData.packUnit} contiene {formData.packSize} {formData.unit}. Podés ajustar esta presentación en la ficha completa.</p>}
                                    <label className="flex items-center gap-2 text-sm text-surface-300"><input type="checkbox" checked={formData.ivaExento} onChange={event => setFormData({ ...formData, ivaExento: event.target.checked })} />Producto exento de IVA (según su clasificación fiscal)</label>
                                    <div><p className={labelClass}>Foto del producto</p><ImageUploader value={formData.imageUrl} onChange={imageUrl => setFormData({ ...formData, imageUrl })} disabled={isSubmitting} /></div>
                                    <label className="flex items-center gap-2 text-sm text-surface-300"><input type="checkbox" checked={audioEnabled} onChange={event => setAudioEnabled(event.target.checked)} />Sonido al guardar</label>
                                </div>
                            </details>
                            {sessionHistory.length > 0 && <p className="text-sm text-emerald-300" role="status">Último guardado: {sessionHistory[0].name} · {formatMoney(sessionHistory[0].price)}</p>}
                        </fieldset>
                    </div>
                    <footer className="shrink-0 space-y-3 border-t border-surface-700 bg-surface-800 px-5 py-4">
                        <label className="flex items-center gap-2 text-sm text-surface-300"><input type="checkbox" disabled={isSubmitting} checked={continuousMode} onChange={event => setContinuousMode(event.target.checked)} />Guardar y seguir agregando productos</label>
                        <button type="submit" disabled={isSubmitting} className="flex w-full items-center justify-center gap-2 rounded-control bg-brand px-4 py-3 font-bold text-brand-on hover:bg-brand-hover disabled:opacity-50">{isSubmitting ? 'Guardando...' : 'Guardar (F2 o ENTER)'}</button>
                    </footer>
                </form>
            </div>
        </div>
    );
};

export default QuickAddProduct;
