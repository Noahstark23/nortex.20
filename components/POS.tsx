import React, { useState } from 'react';
import { MOCK_PRODUCTS } from '../constants';
import { Product, CartItem } from '../types';
import { ShoppingCart, Plus, Minus, Trash2, Search, CreditCard, Banknote, QrCode } from 'lucide-react';

const POS: React.FC = () => {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [processing, setProcessing] = useState(false);

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

  const handleCheckout = () => {
    if (cart.length === 0) return;
    setProcessing(true);
    // Simulate API call to POST /pos/sales
    setTimeout(() => {
      setProcessing(false);
      setCart([]);
      alert("¡Venta procesada! Stock actualizado y Scoring recalculado.");
    }, 1500);
  };

  const filteredProducts = MOCK_PRODUCTS.filter(p => 
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

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 overflow-y-auto pb-4">
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
        <div className="p-5 border-b border-slate-100 bg-slate-50">
          <h2 className="font-bold text-slate-800 flex items-center gap-2">
            <ShoppingCart size={20} />
            Ticket de Venta
          </h2>
          <p className="text-xs text-slate-500 mt-1">Order #TRX-9982</p>
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
            {processing ? 'PROCESANDO...' : 'COBRAR'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default POS;