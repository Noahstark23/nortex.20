import React, { useState, useEffect } from 'react';
import { MOCK_PRODUCTS, MOCK_CUSTOMERS } from '../constants';
import { Product, CartItem, Customer } from '../types';
import { ShoppingCart, Plus, Minus, Trash2, Search, CreditCard, Banknote, QrCode, User, X } from 'lucide-react';

const POS: React.FC = () => {
  // State: Cart & Products
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  
  // State: Customer Management
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [isCustomerDropdownOpen, setIsCustomerDropdownOpen] = useState(false);

  // State: Processing
  const [processing, setProcessing] = useState(false);

  // --- DATA FETCHING ---
  useEffect(() => {
    // Simulación de carga de productos y clientes
    // En producción: fetch('/api/products')
    setProducts(MOCK_PRODUCTS);

    // Fetch Customers
    const fetchCustomers = async () => {
      try {
        const tenantId = localStorage.getItem('nortex_tenant_id');
        const res = await fetch('http://localhost:3000/api/customers', {
           headers: { 'x-tenant-id': tenantId || '' }
        });
        if (res.ok) {
           const data = await res.json();
           // Si el backend devuelve vacío (porque no hay DB real conectada), usamos MOCK
           setCustomers(data.length > 0 ? data : MOCK_CUSTOMERS);
        } else {
           setCustomers(MOCK_CUSTOMERS);
        }
      } catch (e) {
        setCustomers(MOCK_CUSTOMERS);
      }
    };
    fetchCustomers();
  }, []);


  // --- CART LOGIC ---
  const addToCart = (product: Product) => {
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
    setCart(prev => prev.map(item => {
      if (item.id === id) {
        const newQty = Math.max(1, item.quantity + delta);
        return { ...item, quantity: newQty };
      }
      return item;
    }));
  };

  const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const tax = total * 0.18; // IGV example
  const grandTotal = total + tax;

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    setProcessing(true);

    const payload = {
      items: cart.map(i => ({ id: i.id, quantity: i.quantity })),
      customerId: selectedCustomer?.id || null // Enviar ID si hay cliente
    };

    try {
      const tenantId = localStorage.getItem('nortex_tenant_id');
      const res = await fetch('http://localhost:3000/api/sales', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-tenant-id': tenantId || ''
        },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        setCart([]);
        setSelectedCustomer(null);
        alert("¡Venta procesada exitosamente!");
      } else {
        alert("Error procesando venta. Ver consola.");
      }
    } catch (e) {
      // Fallback para demo si no corre el backend
      setTimeout(() => {
        setCart([]);
        setSelectedCustomer(null);
        alert("¡Venta procesada! (Modo Demo)");
      }, 1000);
    } finally {
      setProcessing(false);
    }
  };

  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    p.sku.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredCustomers = customers.filter(c => 
     c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
     c.taxId.includes(customerSearch)
  );

  return (
    <div className="flex h-full bg-slate-100">
      {/* Product Grid - Left Side */}
      <div className="flex-1 flex flex-col p-6 overflow-hidden">
        <div className="mb-6 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
          <input 
            type="text" 
            placeholder="Buscar productos (SKU, Nombre)..." 
            className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-nortex-500 shadow-sm transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 overflow-y-auto pb-4 pr-2 custom-scrollbar">
          {filteredProducts.map(product => (
            <button 
              key={product.id}
              onClick={() => addToCart(product)}
              className="bg-white p-4 rounded-xl border border-slate-200 hover:border-nortex-500 hover:shadow-md transition-all text-left group flex flex-col justify-between"
            >
              <div>
                <span className="text-xs font-mono text-slate-400 mb-1 block">{product.sku}</span>
                <h3 className="font-semibold text-slate-800 leading-tight group-hover:text-nortex-500 transition-colors">{product.name}</h3>
              </div>
              <div className="mt-4 flex justify-between items-end">
                <span className="text-lg font-bold text-slate-900">${product.price.toFixed(2)}</span>
                <span className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded">Stock: {product.stock}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Cart - Right Side */}
      <div className="w-96 bg-white border-l border-slate-200 flex flex-col shadow-xl z-10">
        
        {/* CUSTOMER SELECTOR */}
        <div className="p-4 border-b border-slate-100 bg-slate-50">
          <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Cliente</label>
          
          {selectedCustomer ? (
            <div className="flex justify-between items-center bg-blue-50 border border-blue-200 text-blue-800 px-3 py-2 rounded-lg">
              <div className="flex items-center gap-2">
                <User size={16} />
                <div className="flex flex-col">
                   <span className="font-bold text-sm leading-none">{selectedCustomer.name}</span>
                   <span className="text-[10px] opacity-70">RUC/DNI: {selectedCustomer.taxId}</span>
                </div>
              </div>
              <button onClick={() => setSelectedCustomer(null)} className="text-blue-400 hover:text-blue-600">
                <X size={16} />
              </button>
            </div>
          ) : (
            <div className="relative">
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  type="text"
                  placeholder="Buscar cliente (Nombre o RUC)..."
                  className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:border-nortex-500 focus:ring-1 focus:ring-nortex-500"
                  value={customerSearch}
                  onFocus={() => setIsCustomerDropdownOpen(true)}
                  onChange={(e) => {
                    setCustomerSearch(e.target.value);
                    setIsCustomerDropdownOpen(true);
                  }}
                />
              </div>
              
              {/* Dropdown Results */}
              {isCustomerDropdownOpen && customerSearch && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto">
                   {filteredCustomers.length > 0 ? (
                      filteredCustomers.map(c => (
                        <button
                          key={c.id}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 border-b border-slate-100 last:border-0"
                          onClick={() => {
                            setSelectedCustomer(c);
                            setCustomerSearch('');
                            setIsCustomerDropdownOpen(false);
                          }}
                        >
                          <div className="font-medium text-slate-800">{c.name}</div>
                          <div className="text-xs text-slate-500">{c.taxId}</div>
                        </button>
                      ))
                   ) : (
                     <div className="px-3 py-2 text-xs text-slate-400 text-center">No encontrado. Venta anónima.</div>
                   )}
                </div>
              )}
               {isCustomerDropdownOpen && (
                 <div 
                   className="fixed inset-0 z-40 bg-transparent" 
                   onClick={() => setIsCustomerDropdownOpen(false)}
                 ></div>
               )}
            </div>
          )}
        </div>

        <div className="p-5 border-b border-slate-100 bg-white">
          <h2 className="font-bold text-slate-800 flex items-center gap-2">
            <ShoppingCart size={20} />
            Ticket de Venta
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-4">
              <div className="p-4 bg-slate-50 rounded-full">
                <ShoppingCart size={32} />
              </div>
              <p className="text-sm">El carrito está vacío</p>
            </div>
          ) : (
            cart.map(item => (
              <div key={item.id} className="flex items-center gap-3 bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                <div className="flex-1">
                  <h4 className="text-sm font-medium text-slate-800 line-clamp-1">{item.name}</h4>
                  <div className="text-xs text-slate-500 mt-1">${item.price.toFixed(2)} unit</div>
                </div>
                
                <div className="flex items-center gap-2 bg-slate-50 rounded border border-slate-200 p-1">
                  <button onClick={() => updateQuantity(item.id, -1)} className="p-1 hover:bg-slate-200 rounded text-slate-600 transition-colors">
                    <Minus size={14} />
                  </button>
                  <span className="text-sm font-mono w-5 text-center">{item.quantity}</span>
                  <button onClick={() => updateQuantity(item.id, 1)} className="p-1 hover:bg-slate-200 rounded text-slate-600 transition-colors">
                    <Plus size={14} />
                  </button>
                </div>

                <div className="text-right min-w-[60px]">
                  <div className="text-sm font-bold text-slate-900">${(item.price * item.quantity).toFixed(2)}</div>
                  <button onClick={() => removeFromCart(item.id)} className="text-red-400 hover:text-red-600 mt-1 transition-colors">
                    <Trash2 size={14} className="ml-auto" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="p-5 border-t border-slate-100 bg-white shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
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
            <button className="flex flex-col items-center justify-center py-2 border border-slate-200 rounded hover:border-nortex-500 hover:bg-blue-50 transition-colors text-slate-600 hover:text-nortex-600">
              <Banknote size={20} className="mb-1" />
              <span className="text-[10px] font-bold">EFECTIVO</span>
            </button>
            <button className="flex flex-col items-center justify-center py-2 border border-slate-200 rounded hover:border-nortex-500 hover:bg-blue-50 transition-colors text-slate-600 hover:text-nortex-600">
              <CreditCard size={20} className="mb-1" />
              <span className="text-[10px] font-bold">TARJETA</span>
            </button>
            <button className="flex flex-col items-center justify-center py-2 border border-slate-200 rounded hover:border-nortex-500 hover:bg-blue-50 transition-colors text-slate-600 hover:text-nortex-600">
              <QrCode size={20} className="mb-1" />
              <span className="text-[10px] font-bold">QR / YAPE</span>
            </button>
          </div>

          <button 
            onClick={handleCheckout}
            disabled={cart.length === 0 || processing}
            className={`w-full py-4 rounded-xl font-bold text-white shadow-lg transition-all transform active:scale-[0.98] flex justify-center items-center gap-2
              ${processing 
                ? 'bg-slate-400 cursor-not-allowed' 
                : 'bg-nortex-900 hover:bg-nortex-800 shadow-nortex-900/20'}`}
          >
            {processing ? 'PROCESANDO...' : 'COBRAR'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default POS;