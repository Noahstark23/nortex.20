import React, { useState } from 'react';
import { ShoppingCart, Plus, Minus, Trash2, Banknote, Package, Search } from 'lucide-react';

interface MockProduct {
  id: string;
  name: string;
  price: number;
  category: string;
}

interface GuestPOSProps {
  onHook: (cart: any[]) => void;
}

const MOCK_ITEMS: MockProduct[] = [
  { id: 'm1', name: 'Acetaminofen 500mg x20', price: 3.50, category: 'Farmacia' },
  { id: 'm2', name: 'Camiseta Nike Dri-Fit', price: 45.00, category: 'Boutique' },
  { id: 'm3', name: 'Aceite Motor 10W-40', price: 28.00, category: 'Repuestos' },
  { id: 'm4', name: 'Arroz Faisán 5lb', price: 4.80, category: 'Abarrotería' },
  { id: 'm5', name: 'Cemento Canal 42.5kg', price: 32.50, category: 'Ferretería' },
  { id: 'm6', name: 'Protector Pantalla', price: 8.00, category: 'Tecnología' },
];

const GuestPOS: React.FC<GuestPOSProps> = ({ onHook }) => {
  const [cart, setCart] = useState<{product: MockProduct, quantity: number}[]>([]);

  const addToCart = (product: MockProduct) => {
    setCart(prev => {
      const existing = prev.find(item => item.product.id === product.id);
      if (existing) {
        return prev.map(item => item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, { product, quantity: 1 }];
    });
  };

  const removeFromCart = (id: string) => setCart(prev => prev.filter(item => item.product.id !== id));

  const total = cart.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);
  const tax = total * 0.15;
  const grandTotal = total + tax;

  return (
    <div className="flex h-[480px] w-full max-w-4xl bg-white rounded-xl shadow-2xl overflow-hidden border border-slate-700 mx-auto">
      
      {/* Left: Product Grid */}
      <div className="flex-1 bg-slate-100 p-4 flex flex-col">
        <div className="bg-white p-3 rounded-lg shadow-sm mb-3 flex items-center gap-2 border border-slate-200">
            <Search size={18} className="text-slate-400" />
            <span className="text-sm text-slate-400">Buscar productos...</span>
        </div>

        <div className="grid grid-cols-2 gap-2.5 overflow-y-auto custom-scrollbar">
            {MOCK_ITEMS.map(product => (
                <button 
                    key={product.id}
                    onClick={() => addToCart(product)}
                    className="bg-white p-3 rounded-lg border border-slate-200 hover:border-nortex-500 hover:shadow-md transition-all text-left group"
                >
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{product.category}</div>
                    <div className="font-bold text-slate-800 text-sm mb-1.5 group-hover:text-nortex-600 line-clamp-1">{product.name}</div>
                    <div className="flex justify-between items-center">
                        <span className="bg-slate-100 text-slate-600 text-xs px-2 py-1 rounded font-mono font-bold">C$ {product.price.toFixed(2)}</span>
                        <div className="w-6 h-6 bg-nortex-100 text-nortex-600 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <Plus size={14} />
                        </div>
                    </div>
                </button>
            ))}
        </div>
      </div>

      {/* Right: Cart */}
      <div className="w-72 bg-white border-l border-slate-200 flex flex-col">
        <div className="p-3 border-b border-slate-100 bg-slate-50">
           <h3 className="font-bold text-slate-800 flex items-center gap-2 text-sm">
               <ShoppingCart size={16} /> Ticket de Venta
           </h3>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {cart.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-2 opacity-60">
                    <Package size={28} />
                    <p className="text-xs text-center">Agrega productos para<br/>probar el sistema</p>
                </div>
            ) : (
                cart.map(({product, quantity}) => (
                    <div key={product.id} className="flex items-center gap-2 text-sm">
                        <div className="flex-1 min-w-0">
                            <div className="font-medium text-slate-700 text-xs line-clamp-1">{product.name}</div>
                            <div className="text-[11px] text-slate-500">C$ {product.price} x {quantity}</div>
                        </div>
                        <div className="font-bold text-slate-800 text-xs">C$ {(product.price * quantity).toFixed(2)}</div>
                        <button onClick={() => removeFromCart(product.id)} className="text-slate-300 hover:text-red-500 shrink-0"><Trash2 size={13}/></button>
                    </div>
                ))
            )}
        </div>

        <div className="p-3 bg-slate-50 border-t border-slate-100">
            <div className="flex justify-between items-center mb-3">
                <span className="text-slate-500 text-xs font-medium">Total</span>
                <span className="text-lg font-bold text-nortex-900">C$ {grandTotal.toFixed(2)}</span>
            </div>
            <button 
                onClick={() => onHook(cart)}
                className="w-full py-2.5 bg-nortex-accent hover:bg-emerald-400 text-nortex-900 font-bold rounded-lg shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-2 transform active:scale-95 text-sm"
            >
                <Banknote size={18} /> COBRAR
            </button>
        </div>
      </div>
    </div>
  );
};

export default GuestPOS;
