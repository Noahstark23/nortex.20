import React, { useState, useEffect } from 'react';
import { Product, CartItem } from '../types';
import { ShoppingCart, Plus, Minus, Trash2, Search, CreditCard, Banknote, QrCode, Loader2 } from 'lucide-react';

const POS: React.FC = () => {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [processing, setProcessing] = useState(false);

  const fetchProducts = async () => {
    try {
        // Don't set loading to true here to avoid flickering if we refresh in background,
        // but for initial load it's fine.
        // If we call it after checkout, we might want to keep UI stable.
        const tenantId = localStorage.getItem('nortex_tenant_id');
        if (!tenantId) return;

        const response = await fetch('http://localhost:3000/api/products', {
            headers: { 'x-tenant-id': tenantId }
        });
        if (response.ok) {
            const data = await response.json();
            // Ensure price is number
            const formatted = data.map((p: any) => ({ ...p, price: Number(p.price) }));
            setProducts(formatted);
        }
    } catch (e) {
        console.error("Error fetching products", e);
    } finally {
        setLoadingProducts(false);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, []);

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

    try {
        const tenantId = localStorage.getItem('nortex_tenant_id');
        if (!tenantId) throw new Error("No session");

        const response = await fetch('http://localhost:3000/api/sales', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-tenant-id': tenantId
            },
            body: JSON.stringify({
                // server.ts expects `items` to have `id` (as `productId`?)
                // Wait, server.ts: `const product = await tx.product.findUnique({ where: { id: item.id } });`
                // So the payload item should have `id`.
                items: cart.map(item => ({ id: item.id, quantity: item.quantity })),
                paymentMethod: 'CASH',
                userId: 'system'
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Error processing sale');
        }

        alert("¡Venta procesada! Stock actualizado y Scoring recalculado.");
        setCart([]);
        await fetchProducts(); // Refresh stock

    } catch (error: any) {
        alert("Error: " + error.message);
    } finally {
        setProcessing(false);
    }
  };

  const filteredProducts = products.filter(p =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    p.sku.toLowerCase().includes(searchTerm.toLowerCase())
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
            className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-nortex-500 shadow-sm"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        {loadingProducts ? (
            <div className="flex-1 flex items-center justify-center">
                <Loader2 className="animate-spin text-slate-400" size={32} />
            </div>
        ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 overflow-y-auto pb-4">
            {filteredProducts.map(product => (
                <button
                key={product.id}
                onClick={() => addToCart(product)}
                disabled={product.stock <= 0}
                className={`bg-white p-4 rounded-xl border border-slate-200 transition-all text-left group flex flex-col justify-between
                    ${product.stock > 0 ? 'hover:border-nortex-500 hover:shadow-md' : 'opacity-50 cursor-not-allowed'}`}
                >
                <div>
                    <span className="text-xs font-mono text-slate-400 mb-1 block">{product.sku}</span>
                    <h3 className="font-semibold text-slate-800 leading-tight group-hover:text-nortex-500 transition-colors">{product.name}</h3>
                </div>
                <div className="mt-4 flex justify-between items-end">
                    <span className="text-lg font-bold text-slate-900">${product.price.toFixed(2)}</span>
                    <span className={`text-xs px-2 py-1 rounded ${product.stock > 0 ? 'text-slate-500 bg-slate-100' : 'text-red-500 bg-red-100'}`}>
                        {product.stock > 0 ? `Stock: ${product.stock}` : 'Sin Stock'}
                    </span>
                </div>
                </button>
            ))}
            </div>
        )}
      </div>

      {/* Cart - Right Side */}
      <div className="w-96 bg-white border-l border-slate-200 flex flex-col shadow-xl z-10">
        <div className="p-5 border-b border-slate-100 bg-slate-50">
          <h2 className="font-bold text-slate-800 flex items-center gap-2">
            <ShoppingCart size={20} />
            Ticket de Venta
          </h2>
          <p className="text-xs text-slate-500 mt-1">Order #TRX-{Math.floor(Math.random() * 10000)}</p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
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
            className={`w-full py-4 rounded-xl font-bold text-white shadow-lg transition-all transform active:scale-95 flex justify-center items-center gap-2
              ${processing 
                ? 'bg-slate-400 cursor-not-allowed' 
                : 'bg-nortex-900 hover:bg-nortex-800 shadow-nortex-900/20'}`}
          >
            {processing ? <Loader2 className="animate-spin" /> : 'COBRAR'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default POS;