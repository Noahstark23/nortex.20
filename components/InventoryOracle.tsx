import React, { useState, useEffect } from 'react';
import {
    AlertTriangle, Zap, ShoppingCart, TrendingDown, Package, DollarSign,
    CheckCircle, XCircle, Loader2, ArrowRight, Shield, Clock
} from 'lucide-react';

interface OracleAlert {
    productId: string;
    name: string;
    currentStock: number;
    price: number;
    cost: number;
    vpd: number;
    daysRemaining: number;
    suggestedQty: number;
    suggestedCost: number;
}

interface OracleData {
    alerts: OracleAlert[];
    totalEstimatedCost: number;
}

interface LoanResult {
    message: string;
    purchaseId: string;
    loanId: string;
    loanTerms: {
        amount: number;
        interest: string;
        totalDue: number;
        dueDate: string;
    };
}

const InventoryOracle: React.FC = () => {
    const [data, setData] = useState<OracleData | null>(null);
    const [loading, setLoading] = useState(true);
    const [financing, setFinancing] = useState(false);
    const [loanResult, setLoanResult] = useState<LoanResult | null>(null);
    const [error, setError] = useState('');
    const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

    const token = localStorage.getItem('nortex_token');

    useEffect(() => {
        fetchOracle();
    }, []);

    const fetchOracle = async () => {
        try {
            setLoading(true);
            const res = await fetch('/api/inventory/oracle', {
                headers: { Authorization: `Bearer ${token}` }
            });
            const json = await res.json();
            if (res.ok) {
                setData(json);
                // Auto-select all items
                setSelectedItems(new Set(json.alerts.map((a: OracleAlert) => a.productId)));
            } else {
                setError(json.error || 'Error cargando el Oráculo');
            }
        } catch {
            setError('Error de conexión');
        } finally {
            setLoading(false);
        }
    };

    const toggleItem = (id: string) => {
        setSelectedItems(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    const selectedAlerts = data?.alerts.filter(a => selectedItems.has(a.productId)) || [];
    const selectedTotal = selectedAlerts.reduce((s, a) => s + a.suggestedCost, 0);

    const handleFinance = async (supplierId: string) => {
        if (selectedAlerts.length === 0) return;
        setFinancing(true);
        setError('');
        try {
            const res = await fetch('/api/capital/finance-purchase', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    supplierId,
                    items: selectedAlerts.map(a => ({
                        productId: a.productId,
                        productName: a.name,
                        quantity: a.suggestedQty,
                        unitCost: a.cost
                    }))
                })
            });
            const json = await res.json();
            if (res.ok) {
                setLoanResult(json);
            } else {
                setError(json.error || 'Error al financiar');
            }
        } catch {
            setError('Error de conexión');
        } finally {
            setFinancing(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
            </div>
        );
    }

    // Success state after financing
    if (loanResult) {
        return (
            <div className="h-full overflow-y-auto p-6 bg-slate-950">
                <div className="max-w-2xl mx-auto">
                    <div className="bg-gradient-to-br from-emerald-900/40 to-slate-900 border border-emerald-500/30 rounded-3xl p-10 text-center">
                        <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                            <CheckCircle className="w-10 h-10 text-emerald-400" />
                        </div>
                        <h2 className="text-3xl font-black text-white mb-2">¡Compra Financiada!</h2>
                        <p className="text-emerald-300 font-medium mb-8">{loanResult.message}</p>

                        <div className="grid grid-cols-2 gap-4 mb-8">
                            <div className="bg-slate-800/50 rounded-2xl p-5 border border-slate-700">
                                <p className="text-slate-400 text-xs font-bold uppercase mb-1">Monto del Préstamo</p>
                                <p className="text-2xl font-black text-white">C$ {loanResult.loanTerms.amount.toLocaleString()}</p>
                            </div>
                            <div className="bg-slate-800/50 rounded-2xl p-5 border border-slate-700">
                                <p className="text-slate-400 text-xs font-bold uppercase mb-1">Total a Pagar</p>
                                <p className="text-2xl font-black text-amber-400">C$ {loanResult.loanTerms.totalDue.toLocaleString()}</p>
                            </div>
                            <div className="bg-slate-800/50 rounded-2xl p-5 border border-slate-700">
                                <p className="text-slate-400 text-xs font-bold uppercase mb-1">Interés</p>
                                <p className="text-2xl font-black text-white">{loanResult.loanTerms.interest}</p>
                            </div>
                            <div className="bg-slate-800/50 rounded-2xl p-5 border border-slate-700">
                                <p className="text-slate-400 text-xs font-bold uppercase mb-1">Vencimiento</p>
                                <p className="text-lg font-black text-white">{new Date(loanResult.loanTerms.dueDate).toLocaleDateString('es-NI')}</p>
                            </div>
                        </div>

                        <div className="bg-blue-950/50 border border-blue-800/30 rounded-xl p-4 text-left">
                            <p className="text-blue-300 text-sm font-medium flex items-center gap-2">
                                <Shield size={16} /> El dinero se depositó directamente al proveedor. Tu inventario se actualizará al recibir la mercancía.
                            </p>
                        </div>

                        <button
                            onClick={() => { setLoanResult(null); fetchOracle(); }}
                            className="mt-8 px-6 py-3 bg-slate-700 text-white rounded-xl font-bold hover:bg-slate-600 transition-colors"
                        >
                            Volver al Oráculo
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full overflow-y-auto p-6 bg-slate-950">

            {/* Header */}
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-2xl font-black text-white flex items-center gap-3">
                        <div className="w-10 h-10 bg-amber-500/20 rounded-xl flex items-center justify-center">
                            <Zap className="text-amber-400" size={22} />
                        </div>
                        Compras Inteligentes
                    </h1>
                    <p className="text-slate-400 mt-1 text-sm font-medium">El Oráculo detecta productos que se agotarán pronto y te sugiere cuánto reabastecer.</p>
                </div>
                <button
                    onClick={fetchOracle}
                    className="px-4 py-2 bg-slate-800 text-slate-300 rounded-xl text-sm font-bold hover:bg-slate-700 transition-colors border border-slate-700"
                >
                    Recalcular
                </button>
            </div>

            {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-6 flex items-center gap-3 text-red-400 font-medium">
                    <XCircle size={18} /> {error}
                </div>
            )}

            {/* No alerts state */}
            {data && data.alerts.length === 0 && (
                <div className="text-center py-20">
                    <Package className="w-16 h-16 text-slate-600 mx-auto mb-4" />
                    <h3 className="text-xl font-bold text-slate-400">Todo bajo control</h3>
                    <p className="text-slate-500 mt-2">Ningún producto se agotará en los próximos 5 días.</p>
                </div>
            )}

            {/* Alert Cards */}
            {data && data.alerts.length > 0 && (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
                        {data.alerts.map(alert => {
                            const isSelected = selectedItems.has(alert.productId);
                            const urgencyColor = alert.daysRemaining <= 1 ? 'border-red-500/50 bg-red-500/5' :
                                alert.daysRemaining <= 3 ? 'border-orange-500/40 bg-orange-500/5' : 'border-yellow-500/30 bg-yellow-500/5';
                            const urgencyText = alert.daysRemaining <= 1 ? 'text-red-400' :
                                alert.daysRemaining <= 3 ? 'text-orange-400' : 'text-yellow-400';

                            return (
                                <div
                                    key={alert.productId}
                                    onClick={() => toggleItem(alert.productId)}
                                    className={`relative rounded-2xl border p-5 cursor-pointer transition-all duration-200 ${urgencyColor} ${isSelected ? 'ring-2 ring-amber-500/60 shadow-lg shadow-amber-500/10' : 'opacity-70 hover:opacity-100'}`}
                                >
                                    {/* Selection indicator */}
                                    <div className={`absolute top-3 right-3 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${isSelected ? 'bg-amber-500 border-amber-500' : 'border-slate-600'}`}>
                                        {isSelected && <CheckCircle size={14} className="text-white" />}
                                    </div>

                                    <div className="flex items-start gap-3 mb-4">
                                        <AlertTriangle className={`flex-shrink-0 mt-0.5 ${urgencyText}`} size={20} />
                                        <div>
                                            <h3 className="text-white font-bold text-sm leading-tight">{alert.name}</h3>
                                            <p className={`${urgencyText} font-black text-lg mt-1`}>
                                                Se agota en {alert.daysRemaining} {alert.daysRemaining === 1 ? 'día' : 'días'}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-3 text-xs">
                                        <div className="bg-slate-800/50 rounded-lg p-2">
                                            <span className="text-slate-500 block">Stock Actual</span>
                                            <span className="text-white font-bold">{alert.currentStock} uds</span>
                                        </div>
                                        <div className="bg-slate-800/50 rounded-lg p-2">
                                            <span className="text-slate-500 block">Venta/Día</span>
                                            <span className="text-white font-bold">{alert.vpd} uds</span>
                                        </div>
                                        <div className="bg-slate-800/50 rounded-lg p-2">
                                            <span className="text-slate-500 block">Pedir</span>
                                            <span className="text-emerald-400 font-bold">{alert.suggestedQty} uds</span>
                                        </div>
                                        <div className="bg-slate-800/50 rounded-lg p-2">
                                            <span className="text-slate-500 block">Costo Est.</span>
                                            <span className="text-amber-400 font-bold">C$ {alert.suggestedCost.toLocaleString()}</span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Summary Footer + Action */}
                    <div className="sticky bottom-0 bg-slate-900/95 backdrop-blur-md border-t border-slate-800 -mx-6 px-6 py-5">
                        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                            <div className="text-left">
                                <p className="text-slate-400 text-sm font-medium">
                                    {selectedAlerts.length} de {data.alerts.length} productos seleccionados
                                </p>
                                <p className="text-white font-black text-2xl">
                                    Total: C$ {selectedTotal.toLocaleString()}
                                </p>
                            </div>

                            <div className="flex gap-3 w-full md:w-auto">
                                <button className="flex-1 md:flex-none px-6 py-4 bg-slate-700 text-white rounded-xl font-bold hover:bg-slate-600 transition-colors flex items-center justify-center gap-2 text-sm">
                                    <ShoppingCart size={18} />
                                    Orden Manual
                                </button>
                                <button
                                    onClick={() => {
                                        // Use the first supplier or a default - in production this would open a supplier picker
                                        const firstSupplierId = prompt('ID del Proveedor (de tu lista de Proveedores):');
                                        if (firstSupplierId) handleFinance(firstSupplierId);
                                    }}
                                    disabled={financing || selectedAlerts.length === 0}
                                    className="flex-1 md:flex-none px-8 py-4 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-black hover:from-amber-600 hover:to-orange-600 transition-all flex items-center justify-center gap-2 shadow-2xl shadow-amber-500/30 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                                >
                                    {financing ? (
                                        <Loader2 size={18} className="animate-spin" />
                                    ) : (
                                        <Zap size={18} className="fill-white" />
                                    )}
                                    {financing ? 'Procesando...' : 'Financiar con Nortex Capital'}
                                </button>
                            </div>
                        </div>
                        <p className="text-amber-500/60 text-xs mt-2 flex items-center gap-1">
                            <Clock size={12} /> Aprobación instantánea · 5% interés · 30 días para pagar · Sujeto a tu límite de crédito
                        </p>
                    </div>
                </>
            )}
        </div>
    );
};

export default InventoryOracle;
