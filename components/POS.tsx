import React, { useState, useMemo, useEffect } from 'react';
import { MOCK_PRODUCTS } from '../constants';
import { Product, CartItem, Shift } from '../types';
import { ShoppingCart, Plus, Minus, Trash2, Search, CreditCard, Banknote, QrCode, Tag, PackagePlus, X, Save, User, Clock, Lock, ArrowRight, AlertTriangle, DollarSign, Check, Loader2, Ban, ShieldAlert } from 'lucide-react';

interface Customer {
  id: string;
  name: string;
  creditLimit: number;
  currentDebt: number;
  isBlocked: boolean;
}

const POS: React.FC = () => {
  const [products, setProducts] = useState<Product[]>(MOCK_PRODUCTS);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [processing, setProcessing] = useState(false);
  
  // CUSTOMER STATE (SMART SEARCH)
  const [customerList, setCustomerList] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);

  const [showAddModal, setShowAddModal] = useState(false);
  const [newProduct, setNewProduct] = useState({ name: '', sku: '', price: '', costPrice: '', stock: '', category: 'General' });

  // SHIFT STATE
  const [currentShift, setCurrentShift] = useState<Shift | null>(null);
  const [showOpenShift, setShowOpenShift] = useState(false);
  const [showCloseShift, setShowCloseShift] = useState(false);
  const [initialCash, setInitialCash] = useState('');
  const [declaredCash, setDeclaredCash] = useState('');
  const [shiftReport, setShiftReport] = useState<{expected: number, diff: number} | null>(null);
  const [shiftLoading, setShiftLoading] = useState(true);

  // Check Shift Status on Mount AND PENDING GUEST CART
  useEffect(() => {
    const initPOS = async () => {
        try {
            // 1. Check Shift
            const token = localStorage.getItem('nortex_token');
            const res = await fetch('http://localhost:3000/api/shifts/current', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (res.ok && data) {
                setCurrentShift(data);
                setShowOpenShift(false);
            } else {
                setCurrentShift(null);
                setShowOpenShift(true); 
            }

            // 2. Fetch Customers for Dropdown
            const custRes = await fetch('http://localhost:3000/api/customers', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (custRes.ok) {
                setCustomerList(await custRes.json());
            }

            // 3. Check for Ghost Cart
            const pendingCart = localStorage.getItem('nortex_pending_cart');
            if (pendingCart) {
                setCart(JSON.parse(pendingCart));
                localStorage.removeItem('nortex_pending_cart');
                if (!data) alert("👋 ¡Bienvenido! Abre tu caja para completar la venta de la demo.");
            }

        } catch (e) {
            console.error("Failed to check shift", e);
            setShowOpenShift(true);
        } finally {
            setShiftLoading(false);
        }
    };
    initPOS();
  }, []);

  // --- SHIFT LOGIC (API) ---
  const handleOpenShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!initialCash) return;
    setShiftLoading(true);
    
    try {
        const token = localStorage.getItem('nortex_token');
        const res = await fetch('http://localhost:3000/api/shifts/open', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ initialCash: parseFloat(initialCash) })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setCurrentShift(data);
        setShowOpenShift(false);
    } catch (error: any) { alert(error.message); } 
    finally { setShiftLoading(false); }
  };

  const handleCloseShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentShift || !declaredCash) return;
    setShiftLoading(true);

    try {
        const token = localStorage.getItem('nortex_token');
        const res = await fetch('http://localhost:3000/api/shifts/close', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ shiftId: currentShift.id, declaredCash: parseFloat(declaredCash) })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        setShiftReport({ expected: parseFloat(data.systemExpectedCash), diff: parseFloat(data.difference) });
        setCurrentShift(null); 
    } catch (error: any) { alert(error.message); } 
    finally { setShiftLoading(false); }
  };

  const finishClose = () => {
      setShowCloseShift(false);
      setShiftReport(null);
      setDeclaredCash('');
      setInitialCash('');
      setShowOpenShift(true); 
  };
  // -------------------

  const addToCart = (product: Product) => {
    if (!currentShift) { setShowOpenShift(true); return; }
    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) return prev.map(item => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      return [...prev, { ...product, quantity: 1 }];
    });
  };

  const removeFromCart = (id: string) => setCart(prev => prev.filter(item => item.id !== id));
  
  const updateQuantity = (id: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.id === id) {
        const newQty = Math.max(1, item.quantity + delta);
        return { ...item, quantity: newQty };
      }
      return item;
    }));
  };

  const handleCreateProduct = (e: React.FormEvent) => {
    e.preventDefault();
    const price = parseFloat(newProduct.price);
    const stock = parseInt(newProduct.stock);
    if (isNaN(price) || isNaN(stock)) return;

    const productToAdd: Product = {
      id: `prod_${Date.now()}`,
      name: newProduct.name,
      sku: newProduct.sku || `SKU-${Math.floor(Math.random() * 10000)}`,
      category: newProduct.category,
      price,
      costPrice: parseFloat(newProduct.costPrice) || price * 0.7, 
      stock,
    };
    setProducts(prev => [productToAdd, ...prev]);
    setShowAddModal(false);
  };

  const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const tax = total * 0.18; 
  const grandTotal = total + tax;

  // SMART CREDIT CHECK
  const isCreditBlocked = useMemo(() => {
      if (!selectedCustomer) return true; // Cannot use credit without customer
      if (selectedCustomer.isBlocked) return true;
      if (selectedCustomer.currentDebt + grandTotal > selectedCustomer.creditLimit) return true;
      return false;
  }, [selectedCustomer, grandTotal]);

  const handleCheckout = async (method: 'CASH' | 'CARD' | 'QR' | 'CREDIT') => {
    if (!currentShift) { setShowOpenShift(true); return; }
    if (cart.length === 0) return;
    
    // Front-end Block
    if (method === 'CREDIT' && isCreditBlocked) {
        alert("⛔ Crédito Denegado: Cliente bloqueado o sin cupo disponible.");
        return;
    }
    
    setProcessing(true);
    try {
        const token = localStorage.getItem('nortex_token');
        const res = await fetch('http://localhost:3000/api/sales', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({
                items: cart.map(c => ({ id: c.id, quantity: c.quantity, price: c.price, costPrice: c.costPrice })),
                paymentMethod: method,
                customerName: selectedCustomer ? selectedCustomer.name : 'Cliente General',
                customerId: selectedCustomer?.id,
                total: grandTotal
            })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        setCart([]);
        setSelectedCustomer(null);
        setCustomerSearch('');
        alert("✅ Venta registrada exitosamente.");

    } catch (error: any) {
        alert(error.message);
    } finally {
        setProcessing(false);
    }
  };

  const filteredProducts = useMemo(() => {
    if (!searchTerm) return products;
    const terms = searchTerm.toLowerCase().split(' ').filter(t => t.length > 0);
    return products.filter(p => terms.every(term => `${p.name} ${p.sku} ${p.category}`.toLowerCase().includes(term)));
  }, [searchTerm, products]);

  const filteredCustomers = customerList.filter(c => c.name.toLowerCase().includes(customerSearch.toLowerCase()));

  if (shiftLoading) return <div className="h-full flex items-center justify-center text-slate-500 gap-2"><Loader2 className="animate-spin"/> Cargando Sistema...</div>;

  return (
    <div className="flex h-full bg-slate-100 relative">
      
      {/* HEADER BAR */}
      <div className="absolute top-0 right-0 left-0 h-14 bg-white border-b border-slate-200 px-6 flex justify-between items-center z-10">
         <div className="font-bold text-nortex-900 flex items-center gap-2">
            PUNTO DE VENTA
            {currentShift && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full border border-green-200">CAJA ABIERTA</span>}
         </div>
         {currentShift ? (
             <button onClick={() => setShowCloseShift(true)} className="text-xs font-bold text-red-500 hover:bg-red-50 px-3 py-1.5 rounded transition-colors flex items-center gap-1">
                 <Lock size={14} /> CERRAR CAJA
             </button>
         ) : (
             <span className="text-xs font-bold text-red-500 flex items-center gap-1"><AlertTriangle size={14}/> CAJA CERRADA</span>
         )}
      </div>

      {/* --- OPEN SHIFT MODAL --- */}
      {showOpenShift && (
          <div className="absolute inset-0 z-50 bg-slate-900/90 backdrop-blur flex items-center justify-center p-4">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-8 text-center animate-in zoom-in duration-200">
                  <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Banknote size={32} />
                  </div>
                  <h2 className="text-2xl font-bold text-slate-800 mb-2">Apertura de Caja</h2>
                  <p className="text-slate-500 text-sm mb-6">El sistema está bloqueado. Ingresa el fondo inicial.</p>
                  <form onSubmit={handleOpenShift}>
                      <input 
                        type="number" 
                        autoFocus 
                        className="w-full text-center text-3xl font-bold border-b-2 border-slate-300 focus:border-nortex-500 outline-none pb-2 mb-8 text-slate-800" 
                        placeholder="0.00"
                        value={initialCash}
                        onChange={e => setInitialCash(e.target.value)}
                        required
                      />
                      <button type="submit" disabled={shiftLoading} className="w-full py-3 bg-nortex-900 text-white font-bold rounded-lg hover:bg-nortex-800">
                          {shiftLoading ? 'ABRIENDO...' : 'ABRIR TURNO'}
                      </button>
                  </form>
              </div>
          </div>
      )}

      {/* --- CLOSE SHIFT MODAL --- */}
      {showCloseShift && (
          <div className="absolute inset-0 z-50 bg-slate-900/80 backdrop-blur flex items-center justify-center p-4">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in duration-200">
                  {!shiftReport ? (
                      <div className="p-8">
                          <h2 className="text-xl font-bold text-slate-800 mb-1">Cierre de Caja (Ciego)</h2>
                          <p className="text-slate-500 text-sm mb-6">Cuenta el dinero físico e ingrésalo abajo.</p>
                          <form onSubmit={handleCloseShift}>
                              <label className="text-xs font-mono font-bold text-slate-500">EFECTIVO CONTADO</label>
                              <div className="relative mb-6">
                                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                  <input 
                                    type="number" 
                                    autoFocus 
                                    className="w-full pl-10 py-3 text-2xl font-bold border border-slate-300 rounded-lg focus:ring-2 focus:ring-nortex-500 outline-none" 
                                    placeholder="0.00"
                                    value={declaredCash}
                                    onChange={e => setDeclaredCash(e.target.value)}
                                    required
                                  />
                              </div>
                              <div className="flex gap-3">
                                  <button type="button" onClick={() => setShowCloseShift(false)} className="flex-1 py-3 text-slate-600 font-medium hover:bg-slate-50 rounded-lg">Cancelar</button>
                                  <button type="submit" disabled={shiftLoading} className="flex-1 py-3 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700">
                                      {shiftLoading ? 'CERRANDO...' : 'REALIZAR CORTE Z'}
                                  </button>
                              </div>
                          </form>
                      </div>
                  ) : (
                      <div className="bg-slate-50">
                          <div className="p-8 text-center border-b border-slate-200 bg-white">
                              <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${shiftReport.diff >= 0 ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                                  {shiftReport.diff >= 0 ? <Check size={32} /> : <AlertTriangle size={32} />}
                              </div>
                              <h2 className="text-2xl font-bold text-slate-800">Resumen de Cierre</h2>
                              <p className={`text-lg font-bold mt-2 ${shiftReport.diff >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                  {shiftReport.diff >= 0 ? 'Cuadre Exitoso' : 'Discrepancia de Efectivo'}
                              </p>
                          </div>
                          <div className="p-8 space-y-4">
                              <div className="flex justify-between text-sm">
                                  <span className="text-slate-500">Esperado (Sistema)</span>
                                  <span className="font-mono font-bold">${shiftReport.expected.toFixed(2)}</span>
                              </div>
                              <div className="flex justify-between text-sm">
                                  <span className="text-slate-500">Declarado (Cajero)</span>
                                  <span className="font-mono font-bold">${parseFloat(declaredCash).toFixed(2)}</span>
                              </div>
                              <div className="border-t border-slate-200 pt-3 flex justify-between text-base">
                                  <span className="font-bold text-slate-700">Diferencia</span>
                                  <span className={`font-mono font-bold ${shiftReport.diff < 0 ? 'text-red-500' : 'text-green-500'}`}>
                                      {shiftReport.diff > 0 ? '+' : ''}{shiftReport.diff.toFixed(2)}
                                  </span>
                              </div>
                              <button onClick={finishClose} className="w-full mt-6 py-3 bg-slate-900 text-white font-bold rounded-lg hover:bg-slate-800">
                                  FINALIZAR TURNO
                              </button>
                          </div>
                      </div>
                  )}
              </div>
          </div>
      )}

      {/* ADD PRODUCT MODAL */}
      {showAddModal && (
        <div className="absolute inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <PackagePlus size={20} className="text-nortex-500"/> Nuevo Producto
              </h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-red-500 transition-colors">
                <X size={24} />
              </button>
            </div>
            
            <form onSubmit={handleCreateProduct} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-mono text-slate-500 mb-1">NOMBRE DEL PRODUCTO *</label>
                  <input type="text" required className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-nortex-500"
                    placeholder="Ej. Taladro Percutor 500W" value={newProduct.name} onChange={e => setNewProduct({...newProduct, name: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs font-mono text-slate-500 mb-1">SKU (OPCIONAL)</label>
                  <input type="text" className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-nortex-500"
                    placeholder="HER-009" value={newProduct.sku} onChange={e => setNewProduct({...newProduct, sku: e.target.value})} />
                </div>
                <div>
                   <label className="block text-xs font-mono text-slate-500 mb-1">CATEGORÍA</label>
                   <select className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-nortex-500 bg-white"
                      value={newProduct.category} onChange={e => setNewProduct({...newProduct, category: e.target.value})} >
                     <option>General</option><option>Construcción</option><option>Ferretería</option><option>Herramientas</option>
                   </select>
                </div>
                <div>
                  <label className="block text-xs font-mono text-slate-500 mb-1">PRECIO VENTA *</label>
                  <input type="number" step="0.01" required min="0" className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-nortex-500"
                    placeholder="0.00" value={newProduct.price} onChange={e => setNewProduct({...newProduct, price: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs font-mono text-slate-500 mb-1">COSTO (Wholesale) *</label>
                  <input type="number" step="0.01" required min="0" className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-nortex-500 bg-slate-50"
                    placeholder="0.00" value={newProduct.costPrice} onChange={e => setNewProduct({...newProduct, costPrice: e.target.value})} />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-mono text-slate-500 mb-1">STOCK INICIAL *</label>
                  <input type="number" required min="0" className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-nortex-500"
                    placeholder="0" value={newProduct.stock} onChange={e => setNewProduct({...newProduct, stock: e.target.value})} />
                </div>
              </div>
              <button type="submit" className="w-full py-3 rounded-lg bg-nortex-900 text-white font-bold hover:bg-nortex-800 shadow-lg transition-all flex items-center justify-center gap-2">
                <Save size={18} /> Guardar
              </button>
            </form>
          </div>
        </div>
      )}

      {/* LEFT: PRODUCTS */}
      <div className="flex-1 flex flex-col p-6 mt-14 overflow-hidden">
        <div className="mb-6 flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            <input 
              type="text" 
              placeholder="Buscar..." 
              className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-nortex-500 shadow-sm"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button onClick={() => setShowAddModal(true)} className="bg-nortex-500 text-white px-4 rounded-xl flex items-center gap-2 font-medium">
            <Plus size={20} /> <span className="hidden xl:inline">Nuevo</span>
          </button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 overflow-y-auto pb-4 custom-scrollbar">
          {filteredProducts.map(product => (
            <button key={product.id} onClick={() => addToCart(product)} className="bg-white p-4 rounded-xl border border-slate-200 hover:border-nortex-500 hover:shadow-md transition-all text-left flex flex-col justify-between">
              <div>
                <div className="flex justify-between items-start mb-1">
                  <span className="text-xs font-mono text-slate-400">{product.sku}</span>
                  <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded font-medium">{product.category}</span>
                </div>
                <h3 className="font-semibold text-slate-800 leading-tight mt-1">{product.name}</h3>
              </div>
              <div className="mt-4 flex justify-between items-end">
                <span className="text-lg font-bold text-slate-900">${product.price.toFixed(2)}</span>
                <span className={`text-xs px-2 py-1 rounded ${product.stock === 0 ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-500'}`}>
                   {product.stock === 0 ? 'Sin Stock' : `Stock: ${product.stock}`}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* RIGHT: CART DRAWER */}
      <div className="w-96 bg-white border-l border-slate-200 flex flex-col shadow-xl z-10 mt-14">
        <div className="p-5 border-b border-slate-100 bg-slate-50">
          <h2 className="font-bold text-slate-800 flex items-center gap-2"><ShoppingCart size={20} /> Ticket</h2>
        </div>
        
        {/* SMART CUSTOMER SEARCH */}
        <div className="px-4 pt-4 relative">
           <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input 
                  type="text" 
                  placeholder="Seleccionar Cliente..." 
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg outline-none focus:border-nortex-500" 
                  value={selectedCustomer ? selectedCustomer.name : customerSearch}
                  onChange={(e) => {
                      setCustomerSearch(e.target.value);
                      setSelectedCustomer(null);
                      setShowCustomerDropdown(true);
                  }}
                  onFocus={() => setShowCustomerDropdown(true)}
              />
              {selectedCustomer && (
                  <button onClick={() => {setSelectedCustomer(null); setCustomerSearch('');}} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-red-500">
                      <X size={14}/>
                  </button>
              )}
           </div>

           {/* Dropdown Results */}
           {showCustomerDropdown && !selectedCustomer && (
               <div className="absolute left-4 right-4 top-12 bg-white border border-slate-200 rounded-lg shadow-lg z-20 max-h-48 overflow-y-auto">
                   {filteredCustomers.length === 0 ? (
                       <div className="p-3 text-xs text-slate-400 text-center">No encontrado. Ir a Clientes para crear.</div>
                   ) : (
                       filteredCustomers.map(c => (
                           <button 
                                key={c.id} 
                                onClick={() => {
                                    setSelectedCustomer(c);
                                    setShowCustomerDropdown(false);
                                }}
                                className="w-full text-left p-2 hover:bg-slate-50 text-sm border-b border-slate-50 last:border-0"
                           >
                               <div className="font-bold text-slate-800">{c.name}</div>
                               <div className="text-[10px] text-slate-500">Límite: ${c.creditLimit} | Deuda: ${c.currentDebt}</div>
                           </button>
                       ))
                   )}
               </div>
           )}

           {/* Credit Status Indicator */}
           {selectedCustomer && (
               <div className={`mt-2 p-2 rounded text-xs border ${selectedCustomer.isBlocked ? 'bg-red-50 border-red-200 text-red-700' : 'bg-blue-50 border-blue-100 text-blue-700'}`}>
                   <div className="flex justify-between font-bold mb-1">
                       <span>{selectedCustomer.isBlocked ? 'BLOQUEADO' : 'Línea Disponible:'}</span>
                       {!selectedCustomer.isBlocked && <span>${(selectedCustomer.creditLimit - selectedCustomer.currentDebt).toFixed(2)}</span>}
                   </div>
                   {!selectedCustomer.isBlocked && (
                       <div className="w-full bg-blue-200 h-1.5 rounded-full overflow-hidden">
                           <div className="bg-blue-500 h-full" style={{ width: `${Math.min((selectedCustomer.currentDebt/selectedCustomer.creditLimit)*100, 100)}%` }}></div>
                       </div>
                   )}
               </div>
           )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-4">
              <ShoppingCart size={32} /> <p className="text-sm">Carrito vacío</p>
            </div>
          ) : (
            cart.map(item => (
              <div key={item.id} className="flex items-center gap-3 bg-slate-50 p-3 rounded-lg border border-slate-100">
                <div className="flex-1">
                  <h4 className="text-sm font-medium text-slate-800 line-clamp-1">{item.name}</h4>
                  <div className="text-xs text-slate-500 mt-1">${item.price.toFixed(2)}</div>
                </div>
                <div className="flex items-center gap-2 bg-white rounded border border-slate-200 p-1">
                  <button onClick={() => updateQuantity(item.id, -1)} className="p-1 hover:bg-slate-100 rounded text-slate-600"><Minus size={14} /></button>
                  <span className="text-sm font-mono w-4 text-center">{item.quantity}</span>
                  <button onClick={() => updateQuantity(item.id, 1)} className="p-1 hover:bg-slate-100 rounded text-slate-600"><Plus size={14} /></button>
                </div>
                <div className="text-right min-w-[60px]">
                  <div className="text-sm font-bold text-slate-900">${(item.price * item.quantity).toFixed(2)}</div>
                  <button onClick={() => removeFromCart(item.id)} className="text-red-400 hover:text-red-600 mt-1"><Trash2 size={14} className="ml-auto" /></button>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="p-5 border-t border-slate-100 bg-slate-50">
          <div className="flex justify-between text-xl font-bold text-nortex-900 mb-4 pt-2 border-t border-slate-200"><span>Total</span><span>${grandTotal.toFixed(2)}</span></div>
          
          <div className="grid grid-cols-2 gap-2 mb-2">
               <button onClick={() => handleCheckout('CASH')} disabled={!currentShift || processing} className="py-3 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 text-sm flex items-center justify-center gap-1">
                   <DollarSign size={16}/> EFECTIVO
               </button>
               <button 
                   onClick={() => handleCheckout('CREDIT')} 
                   disabled={!currentShift || processing || isCreditBlocked} 
                   className={`py-3 font-bold rounded-lg text-sm flex items-center justify-center gap-1 ${isCreditBlocked ? 'bg-slate-300 text-slate-500 cursor-not-allowed' : 'bg-nortex-900 text-white hover:bg-nortex-800'}`}
               >
                   {isCreditBlocked ? <Ban size={16}/> : <ShieldAlert size={16}/>} CRÉDITO
               </button>
          </div>
          {isCreditBlocked && selectedCustomer && (
              <p className="text-[10px] text-center text-red-500 font-bold">⚠️ Crédito no disponible: Límite excedido o cliente bloqueado.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default POS;