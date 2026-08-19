import React, { useEffect, useState } from 'react';
import { Truck, RefreshCw, PackageOpen } from 'lucide-react';
import { authFetch } from '../utils/auth';

/**
 * Mi Carga — la vista del VENDEDOR sobre su propia bodega-carga.
 *
 * La carga es la bodega con Warehouse.sellerId = este usuario ("camioneta de
 * Juan"). El dueño la carga con transferencias desde la principal; las ventas
 * del vendedor la descuentan automáticamente. Esta pantalla es solo LECTURA:
 * lo que llevás encima ahora mismo. Si el negocio no usa carga de ruta (no te
 * asignaron bodega), lo dice en vez de mostrar una tabla vacía misteriosa.
 *
 * Reusa GET /api/warehouses (lista, sin gate de rol) y
 * GET /api/warehouses/:id/stock (existencias por bodega) — cero endpoints nuevos.
 */

interface StockItem { productId: string; name: string; sku: string; unit: string; stock: number; }

function miUserId(): string {
    try { return JSON.parse(localStorage.getItem('nortex_user') || '{}').id || ''; }
    catch { return ''; }
}

const CargaVendedor: React.FC = () => {
    const [carga, setCarga] = useState<{ id: string; name: string } | null | 'sin-carga'>(null);
    const [items, setItems] = useState<StockItem[]>([]);
    const [loading, setLoading] = useState(true);

    const cargar = async () => {
        setLoading(true);
        try {
            const res = await authFetch('/api/warehouses');
            if (!res.ok) { setCarga('sin-carga'); return; }
            const d = await res.json();
            const propia = (d.data ?? []).find((w: any) => w.sellerId === miUserId() && w.isActive);
            if (!propia) { setCarga('sin-carga'); return; }
            setCarga({ id: propia.id, name: propia.name });
            const stockRes = await authFetch(`/api/warehouses/${propia.id}/stock`);
            if (stockRes.ok) {
                const sd = await stockRes.json();
                // Solo lo que de verdad llevás: las filas en 0 son ruido acá.
                setItems((sd.data ?? []).filter((it: StockItem) => it.stock !== 0));
            }
        } catch { setCarga('sin-carga'); }
        finally { setLoading(false); }
    };

    useEffect(() => { cargar(); }, []);

    return (
        <div className="p-6 h-full bg-white/[0.04] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
                        <Truck className="text-nortex-500" /> Mi Carga
                    </h1>
                    <p className="text-slate-500 text-sm">
                        {carga && carga !== 'sin-carga' ? `Lo que llevás en ${carga.name}` : 'Tu mercadería asignada'}
                    </p>
                </div>
                <button onClick={cargar} className="p-2 bg-surface-900 border border-white/[0.06] rounded-lg hover:bg-surface-800/40 text-slate-300">
                    <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                </button>
            </div>

            {carga === 'sin-carga' && !loading ? (
                <div className="bg-surface-900 border border-white/[0.06] rounded-xl p-10 text-center text-slate-500">
                    <PackageOpen size={32} className="mx-auto mb-3 opacity-60" />
                    <p className="font-bold text-slate-300 mb-1">No tenés carga asignada</p>
                    <p className="text-sm">
                        Este negocio no usa carga de ruta para tu usuario. Vendés del
                        inventario general, como siempre. Si creés que deberías tener
                        carga, pedile al dueño que te asigne una bodega en Bodegas.
                    </p>
                </div>
            ) : (
                <div className="bg-surface-900 rounded-xl border border-white/[0.06] overflow-hidden">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-surface-800/40 text-slate-500 font-mono text-xs uppercase">
                            <tr>
                                <th className="p-3">Producto</th>
                                <th className="p-3">SKU</th>
                                <th className="p-3 text-right">Llevás</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.04]">
                            {loading ? (
                                <tr><td colSpan={3} className="p-6 text-center text-slate-500">Cargando…</td></tr>
                            ) : items.length === 0 ? (
                                <tr><td colSpan={3} className="p-6 text-center text-slate-500">
                                    Tu carga está vacía — pedí que te carguen mercadería desde la bodega principal.
                                </td></tr>
                            ) : items.map(it => (
                                <tr key={it.productId} className={`hover:bg-surface-800/40 ${it.stock < 0 ? 'bg-red-500/10' : ''}`}>
                                    <td className="p-3 font-bold text-slate-200">{it.name}</td>
                                    <td className="p-3 font-mono text-slate-400 text-xs">{it.sku || '—'}</td>
                                    <td className={`p-3 text-right font-mono ${it.stock < 0 ? 'text-red-400 font-bold' : 'text-slate-200'}`}>
                                        {it.stock} {it.unit || ''}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default CargaVendedor;
