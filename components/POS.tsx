import React, { useState, useMemo, useEffect } from 'react';
import { MOCK_PRODUCTS } from '../constants';
import { Product, CartItem, Shift } from '../types';
import { ShoppingCart, Plus, Minus, Trash2, Search, CreditCard, Banknote, QrCode, Tag, PackagePlus, X, Save, User, Clock, Lock, ArrowRight, AlertTriangle, DollarSign, Check } from 'lucide-react';

const POS: React.FC = () => {
  const [products, setProducts] = useState<Product[]>(MOCK_PRODUCTS);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [processing, setProcessing] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newProduct, setNewProduct] = useState({ name: '', sku: '', price: '', costPrice: '', stock: '', category: 'General' });

  // SHIFT STATE
  const [currentShift, setCurrentShift] = useState<Shift | null>(null);
  const [showOpenShift, setShowOpenShift] = useState(false);
  const [showCloseShift, setShowCloseShift] = useState(false);
  const [initialCash, setInitialCash] = useState('');
  const [declaredCash, setDeclaredCash] = useState('');
  const [shiftReport, setShiftReport] = useState<{expected: number, diff: number} | null>(null);

  // Load Shift from LocalStorage
  useEffect(() => {
    const savedShift = localStorage.getItem('nortex_current_shift');
    if (savedShift) {
        setCurrentShift(JSON.parse(savedShift));
    } else {
        setShowOpenShift(true); // Force open shift if none exists
    }
  }, []);

  // --- SHIFT LOGIC ---
  const handleOpenShift = (e: React.FormEvent) => {
    e.preventDefault();
    if (!initialCash) return;
    
    const newShift: Shift = {
        id: `sh_${Date.now()}`,
        userId: 'user_01',
        tenantId: 'tnt_01',
        startTime: new Date().toISOString(),
        initialCash: parseFloat(initialCash),
        status: 'OPEN'
    };
    
    setCurrentShift(newShift);
    localStorage.setItem('nortex_current_shift', JSON.stringify(newShift));
    setShowOpenShift(false);
  };

  const handleCloseShift = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentShift || !declaredCash) return;

    // Simulate Backend Calculation
    // In real app, we fetch sales by shiftId. Here we assume all sales in session count for demo.
    // We'll simulate expected cash as Initial + Random Sales for demo effect
    const expected = currentShift.initialCash + 500; // Mock sales
    const declared = parseFloat(declaredCash);
    const diff = declared - expected;

    setShiftReport({ expected, diff });
    localStorage.removeItem('nortex_current_shift'); // Clear session
    setCurrentShift(null);
    // Modal stays open to show report
  };

  const finishClose = () => {
      setShowCloseShift(false);
      setShiftReport(null);
      setDeclaredCash('');
      setInitialCash('');
      setShowOpenShift(true); // Force open new shift
  };
  // -------------------

  const addToCart = (product: Product) => {
    if (!currentShift) {
        alert("⚠️ Debes abrir caja antes de vender.");
        setShowOpenShift(true);
        return;
    }
    const existingInCart = cart.find(item => item.id === product.id);
    const currentQuantity = existingInCart ? existingInCart.quantity : 0;
    if (currentQuantity + 1 > product.stock) {
      alert(`Stock insuficiente para ${product.name}.`);
      return;
    }
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
        if (delta > 0 && newQty > item.stock) return item;
        return { ...item, quantity: newQty };
      }
      return item;
    }));
  };

  const handleCreateProduct = (e: React.FormEvent) => {
    e.preventDefault();
    const price = parseFloat(newProduct.price);
    const cost = parseFloat(newProduct.costPrice);
    const stock = parseInt(newProduct.stock);
    if (isNaN(price) || isNaN(stock)) return;

    const productToAdd: Product = {
      id: `prod_${Date.now()}`,
      name: newProduct.name,
      sku: newProduct.sku || `SKU-${Math.floor(Math.random() * 10000)}`,
      category: newProduct.category,
      price,
      costPrice: cost || price * 0.7, // Default cost if missing
      stock,
    };
    setProducts(prev => [productToAdd, ...prev]);
    setShowAddModal(false);
  };

  const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const tax = total * 0.18; 
  const grandTotal = total + tax;

  const handleCheckout = (method: 'CASH' | 'CARD' | 'QR' | 'CREDIT') => {
    if (!currentShift) return;
    if (cart.length === 0) return;
    if (method === 'CREDIT' && !customerName.trim()) {
      alert("⛔ ERROR: Para ventas a CRÉDITO debe ingresar cliente.");
      return;
    }
    setProcessing(true);
    setTimeout(() => {
      setProcessing(false);
      setCart([]);
      setCustomerName('');
      alert("✅ Venta procesada y registrada en el Turno Actual.");
    }, 1000);
  };

  const filteredProducts = useMemo(() => {
    if (!searchTerm) return products;
    const terms = searchTerm.toLowerCase().split(' ').filter(t => t.length > 0);
    return products.filter(p => terms.every(term => `${p.name} ${p.sku} ${p.category}`.toLowerCase().includes(term)));
  }, [searchTerm, products]);

  return (
    <div className="flex h-full bg-slate-100 relative">
      
      {/* HEADER BAR FOR SHIFT CONTROL */}
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
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-8 text-center">
                  <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Banknote size={32} />
                  </div>
                  <h2 className="text-2xl font-bold text-slate-800 mb-2">Apertura de Caja</h2>
                  <p className="text-slate-500 text-sm mb-6">Ingresa el fondo de efectivo inicial para comenzar a vender.</p>
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
                      <button type="submit" className="w-full py-3 bg-nortex-900 text-white font-bold rounded-lg hover:bg-nortex-800">
                          ABRIR TURNO
                      </button>
                  </form>
              </div>
          </div>
      )}

      {/* --- CLOSE SHIFT MODAL --- */}
      {showCloseShift && (
          <div className="absolute inset-0 z-50 bg-slate-900/80 backdrop-blur flex items-center justify-center p-4">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
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
                                  <button type="submit" className="flex-1 py-3 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700">REALIZAR CORTE Z</button>
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
                                  {shiftReport.diff >= 0 ? 'Cuadre Exitoso' : 'Faltante de Caja'}
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

      {/* LEFT: PRODUCTS (MT-14 due to Header) */}
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

      {/* RIGHT: CART (MT-14 due to Header) */}
      <div className="w-96 bg-white border-l border-slate-200 flex flex-col shadow-xl z-10 mt-14">
        {/* Same Cart UI as before */}
        <div className="p-5 border-b border-slate-100 bg-slate-50">
          <h2 className="font-bold text-slate-800 flex items-center gap-2"><ShoppingCart size={20} /> Ticket</h2>
        </div>
        <div className="px-4 pt-4">
           <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input type="text" placeholder="Cliente (Opcional)" className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg outline-none" value={customerName} onChange={(e) => setCustomerName(e.target.value)}/>
           </div>
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
          <button onClick={() => handleCheckout('CASH')} disabled={!currentShift} className="w-full py-4 bg-nortex-900 text-white font-bold rounded-xl hover:bg-nortex-800 disabled:bg-slate-400 flex justify-center items-center gap-2">
            {processing ? '...' : <><Banknote size={20}/> COBRAR</>}
          </button>
        </div>
      </div>
    </div>
  );
};

export default POS;