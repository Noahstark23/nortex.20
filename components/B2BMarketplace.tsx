import React, { useState, useEffect } from 'react';
import { ShoppingBag, Search, Filter, Truck, Package, Tag, Plus, Minus, ShoppingCart, Check } from 'lucide-react';
import { CatalogItem, Tenant } from '../types';
import { MOCK_CATALOG } from '../constants';

const SECTORS = [
  { id: 'ALL', label: 'Todo el Mercado' },
  { id: 'ABARROTES', label: '🛒 Abarrotes' },
  { id: 'FARMACIA', label: '💊 Farmacia' },
  { id: 'FERRETERIA', label: '🔨 Ferretería' },
  { id: 'MODA', label: '👕 Moda' },
  { id: 'TECNOLOGIA', label: '💻 Tecnología' },
];

const B2BMarketplace: React.FC = () => {
  const [activeSector, setActiveSector] = useState('ALL');
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [cart, setCart] = useState<{item: CatalogItem, qty: number}[]>([]);
  const [tenantData, setTenantData] = useState<Tenant | null>(null);

  useEffect(() => {
    // 1. Get Tenant Data to auto-select sector
    const storedTenant = localStorage.getItem('nortex_tenant_data');
    if (storedTenant) {
        const t = JSON.parse(storedTenant);
        setTenantData(t);
        // Default Sector Logic
        let defaultSector = 'ALL';
        if (t.type === 'FERRETERIA') defaultSector = 'FERRETERIA';
        else if (t.type === 'FARMACIA') defaultSector = 'FARMACIA';
        else if (t.type === 'PULPERIA') defaultSector = 'ABARROTES';
        else if (t.type === 'BOUTIQUE') defaultSector = 'MODA';
        setActiveSector(defaultSector);
    }
  }, []);

  useEffect(() => {
    // 2. Fetch Catalog (Simulated)
    setLoading(true);
    setTimeout(() => {
        let items = MOCK_CATALOG;
        if (activeSector !== 'ALL') {
            items = MOCK_CATALOG.filter(i => i.sector === activeSector);
        }
        setCatalog(items);
        setLoading(false);
    }, 400); // Network latency sim
  }, [activeSector]);

  const addToCart = (item: CatalogItem) => {
    setCart(prev => {
      const existing = prev.find(i => i.item.id === item.id);
      if (existing) {
        return prev.map(i => i.item.id === item.id ? { ...i, qty: i.qty + item.minQuantity } : i);
      }
      return [...prev, { item, qty: item.minQuantity }];
    });
  };

  const cartTotal = cart.reduce((sum, i) => sum + (i.item.price * i.qty), 0);

  const handleCheckout = async () => {
    if (!tenantData) return;
    if (cartTotal > tenantData.walletBalance) {
        alert("❌ Saldo insuficiente en Wallet. Solicita un préstamo en el Dashboard.");
        return;
    }

    if (confirm(`¿Confirmar compra por $${cartTotal.toFixed(2)}? Se descontará de tu Wallet.`)) {
        // Optimistic UI Update
        const updatedTenant = { ...tenantData, walletBalance: tenantData.walletBalance - cartTotal };
        setTenantData(updatedTenant);
        localStorage.setItem('nortex_tenant_data', JSON.stringify(updatedTenant));
        
        setCart([]);
        alert("✅ Orden B2B enviada al proveedor. El inventario se actualizará al recibir la mercadería.");
    }
  };

  return (
    <div className="flex h-full bg-slate-100 overflow-hidden relative">
      
      {/* LEFT: MARKETPLACE */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-white border-b border-slate-200 p-6">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-nortex-900 flex items-center gap-2">
                        <ShoppingBag className="text-nortex-500" /> Mercado Mayorista
                    </h1>
                    <p className="text-slate-500 text-sm mt-1">Abastece tu negocio con los mejores precios B2B.</p>
                </div>
                <div className="flex items-center gap-4">
                    <div className="text-right hidden md:block">
                        <div className="text-xs text-slate-400 font-bold uppercase">Tu Poder de Compra</div>
                        <div className="text-xl font-bold text-nortex-900">${tenantData?.walletBalance.toLocaleString(undefined, {minimumFractionDigits: 2})}</div>
                    </div>
                </div>
            </div>

            {/* Sector Tabs */}
            <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar">
                {SECTORS.map(sec => (
                    <button
                        key={sec.id}
                        onClick={() => setActiveSector(sec.id)}
                        className={`px-4 py-2 rounded-full text-sm font-bold whitespace-nowrap transition-all ${
                            activeSector === sec.id 
                            ? 'bg-nortex-900 text-white shadow-lg' 
                            : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                        }`}
                    >
                        {sec.label}
                    </button>
                ))}
            </div>
        </div>

        {/* Catalog Grid */}
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
            {loading ? (
                <div className="flex items-center justify-center h-64 text-slate-400">
                    Cargando catálogo...
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {catalog.map(item => (
                        <div key={item.id} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm hover:shadow-md transition-all flex flex-col">
                            <div className="flex justify-between items-start mb-4">
                                <div className="p-2 bg-blue-50 text-blue-600 rounded-lg text-xs font-bold uppercase tracking-wider">
                                    {item.wholesalerName}
                                </div>
                                <div className="text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded">
                                    Min: {item.minQuantity} u.
                                </div>
                            </div>
                            
                            <div className="flex-1">
                                <h3 className="font-bold text-lg text-slate-800 leading-tight">{item.name}</h3>
                                <p className="text-sm text-slate-500 mt-1">{item.description}</p>
                            </div>

                            <div className="mt-4 pt-4 border-t border-slate-100 flex items-end justify-between">
                                <div>
                                    <div className="text-xs text-slate-400">Precio Mayorista</div>
                                    <div className="text-xl font-bold text-nortex-900">${item.price.toFixed(2)}</div>
                                </div>
                                <button 
                                    onClick={() => addToCart(item)}
                                    className="bg-nortex-500 hover:bg-nortex-600 text-white p-2 rounded-lg transition-colors shadow-sm"
                                >
                                    <Plus size={20} />
                                </button>
                            </div>
                        </div>
                    ))}
                    {catalog.length === 0 && (
                        <div className="col-span-full text-center py-12 text-slate-400">
                            No hay productos disponibles en este sector por el momento.
                        </div>
                    )}
                </div>
            )}
        </div>
      </div>

      {/* RIGHT: CART DRAWER */}
      <div className="w-80 bg-white border-l border-slate-200 shadow-xl z-20 flex flex-col">
        <div className="p-5 border-b border-slate-200 bg-slate-50">
            <h2 className="font-bold text-slate-800 flex items-center gap-2">
                <Truck size={20} /> Orden de Compra
            </h2>
            <p className="text-xs text-slate-500 mt-1">Reabastecimiento de Inventario</p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {cart.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 opacity-60">
                    <Package size={48} className="mb-2" />
                    <p className="text-sm text-center">Selecciona productos para armar tu pedido</p>
                </div>
            ) : (
                cart.map((line, idx) => (
                    <div key={idx} className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                        <div className="flex justify-between items-start mb-2">
                            <h4 className="font-bold text-sm text-slate-800 line-clamp-1">{line.item.name}</h4>
                            <button onClick={() => {
                                const newCart = [...cart];
                                newCart.splice(idx, 1);
                                setCart(newCart);
                            }} className="text-slate-400 hover:text-red-500"><Minus size={14}/></button>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-slate-500">{line.qty} x ${line.item.price}</span>
                            <span className="font-bold text-slate-900">${(line.qty * line.item.price).toFixed(2)}</span>
                        </div>
                    </div>
                ))
            )}
        </div>

        <div className="p-5 border-t border-slate-200 bg-slate-50">
            <div className="flex justify-between items-center mb-4 text-lg font-bold text-nortex-900">
                <span>Total a Pagar</span>
                <span>${cartTotal.toFixed(2)}</span>
            </div>
            <button 
                onClick={handleCheckout}
                disabled={cart.length === 0}
                className="w-full py-3 bg-nortex-900 text-white font-bold rounded-xl shadow-lg hover:bg-nortex-800 disabled:bg-slate-300 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
            >
                Confirmar Pedido <Check size={18} />
            </button>
        </div>
      </div>

    </div>
  );
};

export default B2BMarketplace;