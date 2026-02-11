import React, { useState, useEffect } from 'react';
import { FileText, Plus, Search, ShoppingCart, Calendar, User, Printer, ArrowRight, Trash2, Clock, CheckCircle } from 'lucide-react';
import { MOCK_PRODUCTS } from '../constants';
import { Product, CartItem, Quotation } from '../types';
import { useNavigate } from 'react-router-dom';

const QuotationManager: React.FC = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'NEW' | 'HISTORY'>('NEW');
  const [products] = useState<Product[]>(MOCK_PRODUCTS);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerRuc, setCustomerRuc] = useState('');
  
  // Persistence for history
  const [history, setHistory] = useState<Quotation[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem('nortex_quotations');
    if (saved) setHistory(JSON.parse(saved));
  }, []);

  // --- LOGIC ---
  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) return prev.map(item => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      return [...prev, { ...product, quantity: 1 }];
    });
  };

  const removeFromCart = (id: string) => setCart(prev => prev.filter(item => item.id !== id));

  const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const tax = total * 0.15; // IVA 15% Nicaragua
  const grandTotal = total + tax;

  const handleSaveQuotation = () => {
    if (cart.length === 0) return alert("Agrega productos primero.");
    if (!customerName) return alert("Ingresa el nombre del cliente.");

    const newQuote: Quotation = {
        id: `QT-${Date.now().toString().slice(-6)}`,
        customerName,
        customerRuc,
        items: cart,
        subtotal: total,
        tax,
        total: grandTotal,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(), // 15 days
        status: 'SENT'
    };

    const updatedHistory = [newQuote, ...history];
    setHistory(updatedHistory);
    localStorage.setItem('nortex_quotations', JSON.stringify(updatedHistory));
    
    // Reset
    setCart([]);
    setCustomerName('');
    setCustomerRuc('');
    setActiveTab('HISTORY');
    alert(`✅ Cotización ${newQuote.id} generada exitosamente.`);
  };

  const convertToSale = (quote: Quotation) => {
      if (confirm(`¿Convertir Cotización ${quote.id} en una Venta Activa?`)) {
          // WE USE THE EXISTING HOOK IN POS.TSX
          localStorage.setItem('nortex_pending_cart', JSON.stringify(quote.items));
          
          // Mark as converted
          const updated = history.map(q => q.id === quote.id ? { ...q, status: 'CONVERTED' as const } : q);
          setHistory(updated);
          localStorage.setItem('nortex_quotations', JSON.stringify(updated));

          navigate('/app/pos');
      }
  };

  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    p.sku.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex h-full bg-slate-100 overflow-hidden">
        {/* Left Panel: Navigation & Products/List */}
        <div className="flex-1 flex flex-col border-r border-slate-200 bg-white text-slate-800">
            <div className="p-6 border-b border-slate-200 text-slate-800">
                <h1 className="text-2xl font-bold text-nortex-900 flex items-center gap-2">
                    <FileText className="text-nortex-500" /> Cotizaciones B2B
                </h1>
                <div className="flex gap-4 mt-6">
                    <button 
                        onClick={() => setActiveTab('NEW')}
                        className={`flex-1 py-2 rounded-lg font-bold text-sm border transition-all ${activeTab === 'NEW' ? 'bg-nortex-50 border-nortex-200 text-nortex-700' : 'bg-white border-slate-200 text-slate-500'}`}
                    >
                        + NUEVA COTIZACIÓN
                    </button>
                    <button 
                        onClick={() => setActiveTab('HISTORY')}
                        className={`flex-1 py-2 rounded-lg font-bold text-sm border transition-all ${activeTab === 'HISTORY' ? 'bg-nortex-50 border-nortex-200 text-nortex-700' : 'bg-white border-slate-200 text-slate-500'}`}
                    >
                        HISTORIAL
                    </button>
                </div>
            </div>

            {activeTab === 'NEW' ? (
                 <div className="flex-1 flex flex-col overflow-hidden">
                    <div className="p-4 border-b border-slate-100 text-slate-800">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                            <input 
                                type="text" 
                                placeholder="Buscar productos para cotizar..." 
                                className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-nortex-500"
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 gap-3 content-start custom-scrollbar">
                        {filteredProducts.map(product => (
                            <button 
                                key={product.id}
                                onClick={() => addToCart(product)}
                                className="p-3 text-left border border-slate-200 rounded-lg hover:border-nortex-500 hover:bg-slate-50 transition-all group text-slate-800"
                            >
                                <div className="flex justify-between items-start">
                                    <span className="text-xs font-mono text-slate-400">{product.sku}</span>
                                    <div className="opacity-0 group-hover:opacity-100 text-nortex-600 bg-nortex-100 p-1 rounded-full"><Plus size={14}/></div>
                                </div>
                                <div className="font-medium text-slate-800 text-sm line-clamp-1 mt-1">{product.name}</div>
                                <div className="font-bold text-slate-900 mt-1">${product.price.toFixed(2)}</div>
                            </button>
                        ))}
                    </div>
                 </div>
            ) : (
                <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                    {history.length === 0 && <div className="text-center text-slate-400 mt-10">No hay cotizaciones guardadas.</div>}
                    {history.map(quote => (
                        <div key={quote.id} className="p-4 mb-3 border border-slate-200 rounded-xl hover:shadow-md transition-shadow bg-slate-50 text-slate-800">
                            <div className="flex justify-between items-start mb-2">
                                <div>
                                    <h3 className="font-bold text-nortex-900">{quote.customerName}</h3>
                                    <span className="text-xs text-slate-500 font-mono">ID: {quote.id}</span>
                                </div>
                                <span className={`text-xs px-2 py-1 rounded font-bold ${
                                    quote.status === 'CONVERTED' ? 'bg-green-100 text-green-700' : 
                                    quote.status === 'EXPIRED' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
                                }`}>
                                    {quote.status}
                                </span>
                            </div>
                            <div className="flex justify-between items-end">
                                <div className="text-xs text-slate-500">
                                    <div className="flex items-center gap-1"><Calendar size={12}/> {new Date(quote.createdAt).toLocaleDateString()}</div>
                                    <div className="flex items-center gap-1 text-red-400"><Clock size={12}/> Vence: {new Date(quote.expiresAt).toLocaleDateString()}</div>
                                </div>
                                <div className="text-right">
                                    <div className="font-bold text-lg">${quote.total.toFixed(2)}</div>
                                    {quote.status === 'SENT' && (
                                        <button 
                                            onClick={() => convertToSale(quote)}
                                            className="mt-2 flex items-center gap-1 text-xs bg-nortex-900 text-white px-3 py-1.5 rounded hover:bg-nortex-800 transition-colors"
                                        >
                                            Convertir a Venta <ArrowRight size={12} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>

        {/* Right Panel: Active Quotation Details */}
        {activeTab === 'NEW' && (
            <div className="w-96 bg-slate-50 flex flex-col border-l border-slate-200 text-slate-800">
                <div className="p-6 border-b border-slate-200 bg-white text-slate-800">
                    <h2 className="font-bold text-slate-800 mb-4 flex items-center gap-2">Detalle de Cotización</h2>
                    <div className="space-y-3">
                        <div>
                            <label className="block text-xs font-mono text-slate-500 mb-1">CLIENTE / EMPRESA</label>
                            <div className="relative">
                                <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                <input 
                                    className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:border-nortex-500 outline-none text-slate-800" 
                                    placeholder="Nombre del Cliente"
                                    value={customerName}
                                    onChange={e => setCustomerName(e.target.value)}
                                />
                            </div>
                        </div>
                        <div>
                             <label className="block text-xs font-mono text-slate-500 mb-1">RUC / NIT (Opcional)</label>
                             <input 
                                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:border-nortex-500 outline-none text-slate-800" 
                                placeholder="00000000000"
                                value={customerRuc}
                                onChange={e => setCustomerRuc(e.target.value)}
                             />
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
                    {cart.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-slate-400 opacity-60">
                            <ShoppingCart size={32} />
                            <p className="text-sm mt-2 text-center">Agrega items para cotizar</p>
                        </div>
                    ) : (
                        cart.map(item => (
                            <div key={item.id} className="flex justify-between items-center bg-white p-3 rounded border border-slate-200 text-sm text-slate-800">
                                <div>
                                    <div className="font-medium text-slate-800 line-clamp-1">{item.name}</div>
                                    <div className="text-xs text-slate-500">{item.quantity} x ${item.price.toFixed(2)}</div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="font-bold">${(item.quantity * item.price).toFixed(2)}</span>
                                    <button onClick={() => removeFromCart(item.id)} className="text-slate-300 hover:text-red-500"><Trash2 size={14}/></button>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                <div className="p-6 bg-white border-t border-slate-200 text-slate-800">
                    <div className="space-y-2 text-sm mb-4">
                        <div className="flex justify-between text-slate-500"><span>Subtotal</span><span>${total.toFixed(2)}</span></div>
                        <div className="flex justify-between text-slate-500"><span>Impuesto (18%)</span><span>${tax.toFixed(2)}</span></div>
                        <div className="flex justify-between font-bold text-nortex-900 text-lg pt-2 border-t border-slate-100 text-slate-800"><span>Total</span><span>${grandTotal.toFixed(2)}</span></div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-3">
                        <button className="py-3 border border-slate-300 rounded-lg font-bold text-slate-600 hover:bg-slate-50 flex items-center justify-center gap-2 text-slate-800">
                            <Printer size={18} /> IMPRIMIR
                        </button>
                        <button 
                            onClick={handleSaveQuotation}
                            className="py-3 bg-nortex-900 text-white rounded-lg font-bold hover:bg-nortex-800 flex items-center justify-center gap-2"
                        >
                            <CheckCircle size={18} /> GUARDAR
                        </button>
                    </div>
                    <p className="text-xs text-center text-slate-400 mt-3">
                        Válido por 15 días. Se generará un enlace público.
                    </p>
                </div>
            </div>
        )}
    </div>
  );
};

export default QuotationManager;
