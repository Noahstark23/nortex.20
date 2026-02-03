import React, { useState, useEffect } from 'react';
import { MOCK_PRODUCTS, MOCK_SUPPLIERS } from '../constants';
import { Product, Supplier, PurchaseItem } from '../types';
import { Package, Truck, Plus, Search, DollarSign, Save, AlertCircle } from 'lucide-react';

const InventoryManager: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'RESTOCK' | 'SUPPLIERS'>('RESTOCK');
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  
  // States for Restock
  const [selectedSupplier, setSelectedSupplier] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [restockCart, setRestockCart] = useState<PurchaseItem[]>([]);
  const [processing, setProcessing] = useState(false);

  // States for New Supplier
  const [newSupplier, setNewSupplier] = useState({ name: '', taxId: '', phone: '' });

  useEffect(() => {
    // Simulacion Fetch Data
    setProducts(MOCK_PRODUCTS);
    
    const fetchSuppliers = async () => {
        try {
            const tenantId = localStorage.getItem('nortex_tenant_id');
            const res = await fetch('http://localhost:3000/api/suppliers', {
                headers: { 'x-tenant-id': tenantId || '' }
            });
            if(res.ok) {
                const data = await res.json();
                setSuppliers(data.length > 0 ? data : MOCK_SUPPLIERS);
            } else {
                setSuppliers(MOCK_SUPPLIERS);
            }
        } catch(e) {
            setSuppliers(MOCK_SUPPLIERS);
        }
    };
    fetchSuppliers();
  }, []);

  // --- RESTOCK LOGIC ---
  const addToManifest = (product: Product, quantityStr: string, costStr: string) => {
    const quantity = parseInt(quantityStr);
    const cost = parseFloat(costStr);
    
    if (!quantity || quantity <= 0 || !cost || cost <= 0) return;

    setRestockCart(prev => [...prev, {
        productId: product.id,
        productName: product.name,
        quantity,
        cost
    }]);
  };

  const handleRestockSubmit = async () => {
    if (!selectedSupplier || restockCart.length === 0) return;
    setProcessing(true);

    try {
        const tenantId = localStorage.getItem('nortex_tenant_id');
        const res = await fetch('http://localhost:3000/api/purchases', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json', 
                'x-tenant-id': tenantId || '' 
            },
            body: JSON.stringify({
                supplierId: selectedSupplier,
                items: restockCart
            })
        });

        if (res.ok) {
            alert('Compra registrada. Stock actualizado y Billetera descontada.');
            setRestockCart([]);
            setSelectedSupplier('');
        } else {
            alert('Error en la transacción.');
        }
    } catch (e) {
        alert('Simulación: Compra registrada exitosamente.');
        setRestockCart([]);
    } finally {
        setProcessing(false);
    }
  };

  // --- SUPPLIER LOGIC ---
  const handleCreateSupplier = async (e: React.FormEvent) => {
      e.preventDefault();
      try {
        const tenantId = localStorage.getItem('nortex_tenant_id');
        await fetch('http://localhost:3000/api/suppliers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId || '' },
            body: JSON.stringify(newSupplier)
        });
        setSuppliers([...suppliers, { id: 'temp-'+Date.now(), ...newSupplier }]);
        setNewSupplier({ name: '', taxId: '', phone: '' });
      } catch (e) {
          console.error(e);
      }
  };

  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(productSearch.toLowerCase()) || 
    p.sku.toLowerCase().includes(productSearch.toLowerCase())
  );

  const totalCost = restockCart.reduce((acc, item) => acc + (item.quantity * item.cost), 0);

  return (
    <div className="flex flex-col h-full bg-slate-100 p-6 overflow-hidden">
      
      <header className="flex justify-between items-center mb-6">
        <div>
            <h1 className="text-2xl font-bold text-nortex-900 flex items-center gap-2">
                <Package className="text-nortex-accent" />
                Gestión de Inventario
            </h1>
            <p className="text-sm text-slate-500">Cuentas por Pagar & Reabastecimiento</p>
        </div>
        <div className="flex bg-white rounded-lg p-1 shadow-sm border border-slate-200">
            <button 
                onClick={() => setActiveTab('RESTOCK')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${activeTab === 'RESTOCK' ? 'bg-nortex-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
            >
                Reabastecer
            </button>
            <button 
                onClick={() => setActiveTab('SUPPLIERS')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${activeTab === 'SUPPLIERS' ? 'bg-nortex-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
            >
                Proveedores
            </button>
        </div>
      </header>

      {activeTab === 'RESTOCK' && (
          <div className="flex gap-6 h-full overflow-hidden">
            {/* Left: Product Selector */}
            <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
                <div className="p-4 border-b border-slate-100 flex gap-4">
                    <div className="flex-1 relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <input 
                            type="text"
                            placeholder="Buscar producto para comprar..."
                            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-nortex-500"
                            value={productSearch}
                            onChange={(e) => setProductSearch(e.target.value)}
                        />
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {filteredProducts.map(product => (
                        <ProductRow key={product.id} product={product} onAdd={addToManifest} />
                    ))}
                </div>
            </div>

            {/* Right: Manifest */}
            <div className="w-96 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col">
                <div className="p-4 border-b border-slate-100 bg-slate-50 rounded-t-xl">
                    <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Proveedor</label>
                    <select 
                        className="w-full p-2 border border-slate-200 rounded bg-white text-sm"
                        value={selectedSupplier}
                        onChange={(e) => setSelectedSupplier(e.target.value)}
                    >
                        <option value="">Seleccionar Proveedor...</option>
                        {suppliers.map(s => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                    </select>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4">
                    {restockCart.length === 0 ? (
                        <div className="text-center text-slate-400 mt-10">
                            <Truck size={32} className="mx-auto mb-2 opacity-50" />
                            <p className="text-sm">Manifiesto de compra vacío</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {restockCart.map((item, idx) => (
                                <div key={idx} className="flex justify-between items-center text-sm border-b border-slate-100 pb-2">
                                    <div>
                                        <div className="font-bold text-slate-800">{item.productName}</div>
                                        <div className="text-xs text-slate-500">{item.quantity} unids x ${item.cost.toFixed(2)}</div>
                                    </div>
                                    <div className="font-bold text-slate-700">
                                        ${(item.quantity * item.cost).toFixed(2)}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-slate-100 bg-slate-50 rounded-b-xl">
                    <div className="flex justify-between items-center mb-4">
                        <span className="text-sm font-medium text-slate-600">Total a Pagar</span>
                        <span className="text-xl font-bold text-nortex-900">${totalCost.toFixed(2)}</span>
                    </div>
                    <button 
                        onClick={handleRestockSubmit}
                        disabled={processing || restockCart.length === 0 || !selectedSupplier}
                        className="w-full py-3 bg-nortex-900 text-white rounded-lg font-bold hover:bg-nortex-800 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {processing ? 'Procesando...' : 'Confirmar Compra'}
                        <Save size={18} />
                    </button>
                    <div className="flex items-center gap-2 mt-2 text-[10px] text-orange-600 justify-center">
                        <AlertCircle size={12} />
                        Este monto se descontará de la Billetera
                    </div>
                </div>
            </div>
          </div>
      )}

      {activeTab === 'SUPPLIERS' && (
          <div className="flex gap-6 h-full">
              <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                  <table className="w-full text-sm text-left">
                      <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                          <tr>
                              <th className="p-4">Empresa / Nombre</th>
                              <th className="p-4">RUC / Tax ID</th>
                              <th className="p-4">Contacto</th>
                              <th className="p-4">Acciones</th>
                          </tr>
                      </thead>
                      <tbody>
                          {suppliers.map(s => (
                              <tr key={s.id} className="border-b border-slate-100 hover:bg-slate-50">
                                  <td className="p-4 font-bold text-slate-800">{s.name}</td>
                                  <td className="p-4 font-mono text-slate-600">{s.taxId}</td>
                                  <td className="p-4 text-slate-600">{s.email || s.phone}</td>
                                  <td className="p-4">
                                      <button className="text-blue-600 hover:underline">Editar</button>
                                  </td>
                              </tr>
                          ))}
                      </tbody>
                  </table>
              </div>
              
              <div className="w-80 bg-white rounded-xl border border-slate-200 shadow-sm p-6 h-fit">
                  <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                      <Plus size={18} className="text-nortex-accent" />
                      Nuevo Proveedor
                  </h3>
                  <form onSubmit={handleCreateSupplier} className="space-y-4">
                      <div>
                          <label className="block text-xs font-bold text-slate-400 mb-1">RAZÓN SOCIAL</label>
                          <input 
                            required
                            className="w-full border border-slate-200 rounded p-2 text-sm"
                            value={newSupplier.name}
                            onChange={e => setNewSupplier({...newSupplier, name: e.target.value})}
                          />
                      </div>
                      <div>
                          <label className="block text-xs font-bold text-slate-400 mb-1">RUC / TAX ID</label>
                          <input 
                            required
                            className="w-full border border-slate-200 rounded p-2 text-sm font-mono"
                            value={newSupplier.taxId}
                            onChange={e => setNewSupplier({...newSupplier, taxId: e.target.value})}
                          />
                      </div>
                      <div>
                          <label className="block text-xs font-bold text-slate-400 mb-1">TELÉFONO / EMAIL</label>
                          <input 
                            className="w-full border border-slate-200 rounded p-2 text-sm"
                            value={newSupplier.phone}
                            onChange={e => setNewSupplier({...newSupplier, phone: e.target.value})}
                          />
                      </div>
                      <button className="w-full py-2 bg-blue-600 text-white rounded font-bold hover:bg-blue-700 text-sm">
                          Guardar Proveedor
                      </button>
                  </form>
              </div>
          </div>
      )}
    </div>
  );
};

// Subcomponent for Product Row in Restock
const ProductRow = ({ product, onAdd }: { product: Product, onAdd: (p: Product, q: string, c: string) => void }) => {
    const [qty, setQty] = useState('');
    const [cost, setCost] = useState('');

    return (
        <div className="flex items-center gap-4 p-3 bg-slate-50 rounded border border-slate-200">
            <div className="flex-1">
                <div className="font-bold text-slate-800">{product.name}</div>
                <div className="text-xs text-slate-500">SKU: {product.sku} | Stock Actual: {product.stock}</div>
            </div>
            <div className="flex items-center gap-2">
                <div className="flex flex-col w-20">
                    <label className="text-[10px] text-slate-400">Cant.</label>
                    <input 
                        type="number" 
                        className="p-1 border border-slate-300 rounded text-sm w-full" 
                        placeholder="0"
                        value={qty}
                        onChange={e => setQty(e.target.value)}
                    />
                </div>
                <div className="flex flex-col w-24">
                    <label className="text-[10px] text-slate-400">Costo Unit.</label>
                    <div className="relative">
                        <span className="absolute left-1.5 top-1.5 text-slate-400 text-xs">$</span>
                        <input 
                            type="number" 
                            className="p-1 pl-4 border border-slate-300 rounded text-sm w-full" 
                            placeholder="0.00"
                            value={cost}
                            onChange={e => setCost(e.target.value)}
                        />
                    </div>
                </div>
                <button 
                    onClick={() => {
                        onAdd(product, qty, cost);
                        setQty('');
                        setCost('');
                    }}
                    className="mt-3 p-2 bg-slate-200 hover:bg-nortex-accent hover:text-nortex-900 rounded transition-colors text-slate-600"
                >
                    <Plus size={16} />
                </button>
            </div>
        </div>
    );
}

export default InventoryManager;