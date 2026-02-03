import React, { useState, useMemo } from 'react';
import { MOCK_PRODUCTS } from '../constants';
import { Product, CartItem } from '../types';
import { ShoppingCart, Plus, Minus, Trash2, Search, CreditCard, Banknote, QrCode, Tag, PackagePlus, X, Save, User, Clock } from 'lucide-react';

const POS: React.FC = () => {
  // Inventory State (initialized with Mock Data)
  const [products, setProducts] = useState<Product[]>(MOCK_PRODUCTS);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [processing, setProcessing] = useState(false);
  const [customerName, setCustomerName] = useState('');
  
  // New Product Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [newProduct, setNewProduct] = useState({
    name: '',
    sku: '',
    price: '',
    stock: '',
    category: 'General'
  });

  const addToCart = (product: Product) => {
    // Check stock availability
    const existingInCart = cart.find(item => item.id === product.id);
    const currentQuantity = existingInCart ? existingInCart.quantity : 0;

    if (currentQuantity + 1 > product.stock) {
      alert(`Stock insuficiente para ${product.name}. Solo quedan ${product.stock} unidades.`);
      return;
    }

    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) {
        return prev.map(item => 
          item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, { ...product, quantity: 1 }];
    });
  };

  const removeFromCart = (id: string) => {
    setCart(prev => prev.filter(item => item.id !== id));
  };

  const updateQuantity = (id: string, delta: number) => {
    if (delta > 0) {
      const item = cart.find(i => i.id === id);
      if (item && item.quantity + 1 > item.stock) {
        alert(`No hay suficiente stock. Máximo disponible: ${item.stock}`);
        return;
      }
    }

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
    if (!newProduct.name || !newProduct.price || !newProduct.stock) {
      alert("Complete los campos obligatorios");
      return;
    }

    const price = parseFloat(newProduct.price);
    const stock = parseInt(newProduct.stock);

    if (isNaN(price) || isNaN(stock)) {
      alert("El precio y el stock deben ser valores numéricos válidos.");
      return;
    }

    const productToAdd: Product = {
      id: `prod_${Date.now()}`, // Simple ID gen
      name: newProduct.name,
      sku: newProduct.sku || `SKU-${Math.floor(Math.random() * 10000)}`,
      category: newProduct.category,
      price: price,
      stock: stock,
    };

    setProducts(prev => [productToAdd, ...prev]);
    setNewProduct({ name: '', sku: '', price: '', stock: '', category: 'General' });
    setShowAddModal(false);
    
    // Feedback táctico
    alert(`✅ Producto agregado al inventario: ${productToAdd.name}`);
  };

  const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const tax = total * 0.18; 
  const grandTotal = total + tax;

  const handleCheckout = (method: 'CASH' | 'CARD' | 'QR' | 'CREDIT') => {
    if (cart.length === 0) return;
    
    // VALIDACIÓN CRÍTICA PARA CRÉDITOS
    if (method === 'CREDIT' && !customerName.trim()) {
      alert("⛔ ERROR: Para ventas a CRÉDITO debe ingresar el nombre del cliente obligatoriamente.");
      return;
    }

    setProcessing(true);
    // Simulate API call to POST /pos/sales
    setTimeout(() => {
      setProcessing(false);
      setCart([]);
      setCustomerName(''); // Reset customer
      const msg = method === 'CREDIT' 
        ? "✅ Venta a CRÉDITO registrada. Deuda asignada al cliente." 
        : "✅ Venta procesada correctamente.";
      alert(msg);
    }, 1500);
  };

  // Smart Search Logic (Uses local 'products' state now)
  const filteredProducts = useMemo(() => {
    if (!searchTerm) return products;

    const terms = searchTerm.toLowerCase().split(' ').filter(t => t.length > 0);

    return products.filter(p => {
      const searchableText = `${p.name} ${p.sku} ${p.category}`.toLowerCase();
      return terms.every(term => searchableText.includes(term));
    });
  }, [searchTerm, products]);

  return (
    <div className="flex h-full bg-slate-100 relative">
      
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
                  <input 
                    type="text" required 
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-nortex-500"
                    placeholder="Ej. Taladro Percutor 500W"
                    value={newProduct.name}
                    onChange={e => setNewProduct({...newProduct, name: e.target.value})}
                  />
                </div>
                
                <div>
                  <label className="block text-xs font-mono text-slate-500 mb-1">SKU (OPCIONAL)</label>
                  <input 
                    type="text" 
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-nortex-500"
                    placeholder="HER-009"
                    value={newProduct.sku}
                    onChange={e => setNewProduct({...newProduct, sku: e.target.value})}
                  />
                </div>

                <div>
                   <label className="block text-xs font-mono text-slate-500 mb-1">CATEGORÍA</label>
                   <select 
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-nortex-500 bg-white"
                      value={newProduct.category}
                      onChange={e => setNewProduct({...newProduct, category: e.target.value})}
                   >
                     <option>General</option>
                     <option>Construcción</option>
                     <option>Albañilería</option>
                     <option>Acabados</option>
                     <option>Ferretería</option>
                     <option>Herramientas</option>
                     <option>Electricidad</option>
                     <option>Gasfitería</option>
                     <option>Químicos</option>
                   </select>
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-500 mb-1">PRECIO VENTA ($) *</label>
                  <input 
                    type="number" step="0.01" required min="0"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-nortex-500"
                    placeholder="0.00"
                    value={newProduct.price}
                    onChange={e => setNewProduct({...newProduct, price: e.target.value})}
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-500 mb-1">STOCK INICIAL *</label>
                  <input 
                    type="number" required min="0"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-nortex-500"
                    placeholder="0"
                    value={newProduct.stock}
                    onChange={e => setNewProduct({...newProduct, stock: e.target.value})}
                  />
                </div>
              </div>

              <div className="pt-4 flex gap-3">
                <button 
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 py-3 rounded-lg border border-slate-300 text-slate-600 font-medium hover:bg-slate-50 transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  className="flex-1 py-3 rounded-lg bg-nortex-900 text-white font-bold hover:bg-nortex-800 shadow-lg shadow-nortex-900/20 transition-all flex items-center justify-center gap-2"
                >
                  <Save size={18} /> Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Product Grid - Left Side */}
      <div className="flex-1 flex flex-col p-6 overflow-hidden">
        <div className="mb-6 flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            <input 
              type="text" 
              placeholder="Buscar por Nombre, SKU o Categoría..." 
              className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-nortex-500 shadow-sm transition-all"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button 
            onClick={() => setShowAddModal(true)}
            className="bg-nortex-500 hover:bg-nortex-400 text-white px-4 rounded-xl shadow-sm transition-all flex items-center gap-2 font-medium"
            title="Agregar Producto Manual"
          >
            <Plus size={20} />
            <span className="hidden xl:inline">Nuevo</span>
          </button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 overflow-y-auto pb-4 custom-scrollbar">
          {filteredProducts.map(product => (
            <button 
              key={product.id}
              onClick={() => addToCart(product)}
              className="bg-white p-4 rounded-xl border border-slate-200 hover:border-nortex-500 hover:shadow-md transition-all text-left group flex flex-col justify-between"
            >
              <div>
                <div className="flex justify-between items-start mb-1">
                  <span className="text-xs font-mono text-slate-400">{product.sku}</span>
                  <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded font-medium flex items-center gap-1">
                     <Tag size={10} /> {product.category}
                  </span>
                </div>
                <h3 className="font-semibold text-slate-800 leading-tight group-hover:text-nortex-500 transition-colors mt-1">{product.name}</h3>
              </div>
              <div className="mt-4 flex justify-between items-end">
                <span className="text-lg font-bold text-slate-900">${product.price.toFixed(2)}</span>
                <span className={`text-xs px-2 py-1 rounded ${product.stock === 0 ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-500'}`}>
                   {product.stock === 0 ? 'Sin Stock' : `Stock: ${product.stock}`}
                </span>
              </div>
            </button>
          ))}
          
          {filteredProducts.length === 0 && (
             <div className="col-span-full flex flex-col items-center justify-center h-48 text-slate-400">
               <PackagePlus size={48} className="mb-2 opacity-20"/>
               <p className="mb-4">No se encontraron productos</p>
               <button 
                 onClick={() => setShowAddModal(true)}
                 className="text-nortex-500 hover:underline font-medium"
               >
                 + Crear nuevo producto
               </button>
             </div>
          )}
        </div>
      </div>

      {/* Cart - Right Side */}
      <div className="w-96 bg-white border-l border-slate-200 flex flex-col shadow-xl z-10">
        <div className="p-5 border-b border-slate-100 bg-slate-50">
          <h2 className="font-bold text-slate-800 flex items-center gap-2">
            <ShoppingCart size={20} />
            Ticket de Venta
          </h2>
          <p className="text-xs text-slate-500 mt-1">Order #TRX-9982</p>
        </div>

        {/* CUSTOMER INPUT FOR CREDIT */}
        <div className="px-4 pt-4">
           <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input 
                 type="text" 
                 placeholder="Cliente (Obligatorio para Crédito)"
                 className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-nortex-500 focus:border-nortex-500 outline-none"
                 value={customerName}
                 onChange={(e) => setCustomerName(e.target.value)}
              />
           </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-4">
              <div className="p-4 bg-slate-50 rounded-full">
                <ShoppingCart size={32} />
              </div>
              <p className="text-sm">El carrito está vacío</p>
            </div>
          ) : (
            cart.map(item => (
              <div key={item.id} className="flex items-center gap-3 bg-slate-50 p-3 rounded-lg border border-slate-100">
                <div className="flex-1">
                  <h4 className="text-sm font-medium text-slate-800 line-clamp-1">{item.name}</h4>
                  <div className="text-xs text-slate-500 mt-1">${item.price.toFixed(2)} unit</div>
                </div>
                
                <div className="flex items-center gap-2 bg-white rounded border border-slate-200 p-1">
                  <button onClick={() => updateQuantity(item.id, -1)} className="p-1 hover:bg-slate-100 rounded text-slate-600">
                    <Minus size={14} />
                  </button>
                  <span className="text-sm font-mono w-4 text-center">{item.quantity}</span>
                  <button onClick={() => updateQuantity(item.id, 1)} className="p-1 hover:bg-slate-100 rounded text-slate-600">
                    <Plus size={14} />
                  </button>
                </div>

                <div className="text-right min-w-[60px]">
                  <div className="text-sm font-bold text-slate-900">${(item.price * item.quantity).toFixed(2)}</div>
                  <button onClick={() => removeFromCart(item.id)} className="text-red-400 hover:text-red-600 mt-1">
                    <Trash2 size={14} className="ml-auto" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="p-5 border-t border-slate-100 bg-slate-50">
          <div className="space-y-2 mb-4">
            <div className="flex justify-between text-sm text-slate-500">
              <span>Subtotal</span>
              <span>${total.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm text-slate-500">
              <span>Impuestos (18%)</span>
              <span>${tax.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-xl font-bold text-nortex-900 pt-2 border-t border-slate-200">
              <span>Total</span>
              <span>${grandTotal.toFixed(2)}</span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 mb-4">
            <button 
              onClick={() => handleCheckout('CASH')}
              className="flex flex-col items-center justify-center py-2 border border-slate-200 rounded hover:border-nortex-500 hover:bg-blue-50 transition-colors text-slate-600 hover:text-nortex-600">
              <Banknote size={20} className="mb-1" />
              <span className="text-[10px] font-bold">EFECTIVO</span>
            </button>
            <button 
               onClick={() => handleCheckout('CARD')}
               className="flex flex-col items-center justify-center py-2 border border-slate-200 rounded hover:border-nortex-500 hover:bg-blue-50 transition-colors text-slate-600 hover:text-nortex-600">
              <CreditCard size={20} className="mb-1" />
              <span className="text-[10px] font-bold">TARJETA</span>
            </button>
            <button 
               onClick={() => handleCheckout('QR')}
               className="flex flex-col items-center justify-center py-2 border border-slate-200 rounded hover:border-nortex-500 hover:bg-blue-50 transition-colors text-slate-600 hover:text-nortex-600">
              <QrCode size={20} className="mb-1" />
              <span className="text-[10px] font-bold">QR / YAPE</span>
            </button>
          </div>

          <button 
            onClick={() => handleCheckout('CREDIT')}
            disabled={cart.length === 0 || processing}
            className={`w-full py-4 rounded-xl font-bold text-white shadow-lg transition-all transform active:scale-95 flex justify-center items-center gap-2
              ${processing 
                ? 'bg-slate-400 cursor-not-allowed' 
                : 'bg-nortex-900 hover:bg-nortex-800 shadow-nortex-900/20'}`}
          >
            {processing ? (
              'PROCESANDO...' 
            ) : (
               <>
                 <Clock size={20} /> CRÉDITO / FIADO
               </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default POS;