import React, { useState } from 'react';
import { ShoppingCart, Plus, Minus, Trash2, Zap, ArrowRight, MousePointer2 } from 'lucide-react';

interface GuestProduct {
  id: number;
  name: string;
  price: number;
  icon: string;
  color: string;
}

interface GuestCartItem extends GuestProduct {
  quantity: number;
}

const DEMO_PRODUCTS: GuestProduct[] = [
  { id: 1, name: 'Cemento Sol', price: 28.50, icon: '🧱', color: 'bg-orange-100 text-orange-600' },
  { id: 2, name: 'Martillo Pro', price: 45.00, icon: '🔨', color: 'bg-blue-100 text-blue-600' },
  { id: 3, name: 'Pintura 1GL', price: 35.00, icon: '🎨', color: 'bg-purple-100 text-purple-600' },
  { id: 4, name: 'Tubo PVC', price: 12.90, icon: '🔧', color: 'bg-slate-100 text-slate-600' },
];

interface Props {
  onCobrarClick: () => void;
}

const GuestPOS: React.FC<Props> = ({ onCobrarClick }) => {
  const [cart, setCart] = useState<GuestCartItem[]>([]);
  const [clickCount, setClickCount] = useState(0);

  const addToCart = (product: GuestProduct) => {
    setClickCount(prev => prev + 1);
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

  const updateQuantity = (id: number, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.id === id) {
        return { ...item, quantity: Math.max(0, item.quantity + delta) };
      }
      return item;
    }).filter(item => item.quantity > 0));
  };

  const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const tax = total * 0.18;

  return (
    <div className="w-full max-w-4xl mx-auto bg-white rounded-xl shadow-2xl overflow-hidden border border-slate-700/50 flex flex-col md:flex-row h-[500px] md:h-[450px] relative animate-in fade-in zoom-in duration-500">
      
      {/* Overlay hint if empty */}
      {cart.length === 0 && clickCount === 0 && (
        <div className="absolute inset-0 z-50 pointer-events-none flex items-center justify-center bg-black/5 md:bg-transparent">
          <div className="bg-nortex-accent text-nortex-900 px-4 py-2 rounded-full font-bold shadow-lg animate-bounce flex items-center gap-2">
            <MousePointer2 size={18} />
            ¡Haz click para vender!
          </div>
        </div>
      )}

      {/* LEFT: Product Grid */}
      <div className="flex-1 bg-slate-50 p-4 overflow-y-auto">
        <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Catálogo Demo</h3>
            <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-bold">LIVE MODE</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {DEMO_PRODUCTS.map(product => (
            <button
              key={product.id}
              onClick={() => addToCart(product)}
              className="bg-white p-3 rounded-lg border border-slate-200 hover:border-nortex-500 hover:shadow-md transition-all text-left group active:scale-95"
            >
              <div className={`w-8 h-8 ${product.color} rounded-lg flex items-center justify-center text-lg mb-2`}>
                {product.icon}
              </div>
              <h4 className="font-bold text-slate-800 text-sm leading-tight">{product.name}</h4>
              <p className="text-nortex-500 font-bold text-sm mt-1">${product.price.toFixed(2)}</p>
            </button>
          ))}
        </div>
        <div className="mt-4 p-3 bg-slate-100 rounded-lg border border-slate-200 text-xs text-slate-500">
            <p className="flex items-center gap-2">
                <Zap size={14} className="text-yellow-500" />
                <strong>Tip:</strong> El sistema real soporta +10,000 productos y lectores de código de barras.
            </p>
        </div>
      </div>

      {/* RIGHT: Cart & Checkout */}
      <div className="w-full md:w-80 bg-white border-l border-slate-200 flex flex-col">
        <div className="p-4 border-b border-slate-100 bg-white shadow-sm z-10">
          <h2 className="font-bold text-slate-800 flex items-center gap-2 text-sm">
            <ShoppingCart size={18} />
            Venta Actual
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-slate-50/50">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-2 opacity-60">
              <ShoppingCart size={24} />
              <p className="text-xs">Carrito vacío</p>
            </div>
          ) : (
            cart.map(item => (
              <div key={item.id} className="flex items-center gap-2 bg-white p-2 rounded border border-slate-200 shadow-sm animate-in slide-in-from-right-2">
                <div className="flex-1 min-w-0">
                  <h4 className="text-xs font-bold text-slate-800 truncate">{item.name}</h4>
                  <div className="text-[10px] text-slate-500">${item.price} x {item.quantity}</div>
                </div>
                <div className="flex items-center gap-1">
                    <button onClick={() => updateQuantity(item.id, -1)} className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-red-500">
                        <Minus size={12} />
                    </button>
                    <button onClick={() => updateQuantity(item.id, 1)} className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-green-500">
                        <Plus size={12} />
                    </button>
                </div>
                <div className="text-right min-w-[50px]">
                  <span className="text-xs font-bold text-slate-900">${(item.price * item.quantity).toFixed(0)}</span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Total & Action */}
        <div className="p-4 border-t border-slate-100 bg-white">
            <div className="flex justify-between items-end mb-4">
                <span className="text-xs text-slate-500">Total + IGV</span>
                <span className="text-2xl font-bold text-nortex-900">${(total + tax).toFixed(2)}</span>
            </div>
            <button 
                onClick={onCobrarClick}
                className="w-full bg-nortex-900 hover:bg-nortex-800 text-white font-bold py-3 rounded-lg shadow-lg shadow-nortex-900/20 active:scale-95 transition-all flex items-center justify-center gap-2 group"
            >
                COBRAR
                <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
            </button>
            <p className="text-[10px] text-center text-slate-400 mt-2">
                Simulación instantánea. Sin registro.
            </p>
        </div>
      </div>
    </div>
  );
};

export default GuestPOS;