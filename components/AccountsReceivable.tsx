import React, { useState, useEffect } from 'react';
import { MOCK_DEBTORS } from '../constants';
import { Sale, Payment } from '../types';
import { DollarSign, Calendar, User, CheckCircle, Clock, ChevronRight, ChevronDown, Wallet, MessageCircle, Send } from 'lucide-react';

const AccountsReceivable: React.FC = () => {
  // In a real app, fetch from API. Here we use Mock Data + Local State manipulation
  const [sales, setSales] = useState<Sale[]>([]);

  useEffect(() => {
    fetchDebtors();
  }, []);

  const fetchDebtors = async () => {
    try {
      const token = localStorage.getItem('nortex_token');
      const res = await fetch('/api/credits/debtors', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setSales(data);
      }
    } catch (error) {
      console.error('Error fetching debtors:', error);
    }
  };
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [showPayModal, setShowPayModal] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');

  // Derived Stats
  const safeSales = Array.isArray(sales) ? sales : [];

  console.log('AccountsReceivable Render. Sales:', sales);

  const totalReceivable = safeSales.reduce((acc, sale) => acc + (sale.status === 'CREDIT_PENDING' ? Number(sale.balance) : 0), 0);
  const collectedToday = safeSales
    .flatMap(s => s.payments || [])
    .filter(p => new Date(p.date).toDateString() === new Date().toDateString())
    .reduce((acc, p) => acc + Number(p.amount), 0);

  const handleRegisterPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSale || !paymentAmount) return;

    const amount = parseFloat(paymentAmount);
    if (isNaN(amount) || amount <= 0) {
      alert("Ingrese un monto válido");
      return;
    }

    if (amount > selectedSale.balance) {
      alert("El monto no puede exceder la deuda pendiente");
      return;
    }

    try {
      const token = localStorage.getItem('nortex_token');
      const res = await fetch('/api/credits/payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          saleId: selectedSale.id,
          amount,
          method: 'CASH' // TODO: Add selector in UI if needed, currently hardcoded in frontend form but could be dynamic
        })
      });

      if (res.ok) {
        const updatedSale = await res.json();
        setSales(prev => prev.map(s => s.id === updatedSale.id ? updatedSale : s));
        setSelectedSale(updatedSale);
        setShowPayModal(false);
        setPaymentAmount('');
        alert(`✅ Abono registrado exitosamente.`);
      } else {
        const error = await res.json();
        alert(error.error || 'Error al registrar pago');
      }
    } catch (error) {
      console.error('Payment error:', error);
      alert('Error de conexión al registrar pago');
    }
  };

  const handleNotifyWhatsapp = (sale: Sale) => {
    const message = `Hola ${sale.customerName}, tu deuda en Ferretería Nortex es de $${sale.balance.toFixed(2)}. Paga aquí: link.nortex.com/pago/${sale.id}`;
    const url = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
  };

  return (

    <div className="flex h-full bg-slate-100 overflow-hidden">

      {/* LEFT: Debtors List */}
      <div className="w-1/2 lg:w-2/5 flex flex-col border-r border-slate-200 bg-white">
        <div className="p-6 border-b border-slate-200 bg-slate-50">
          <h2 className="text-xl font-bold text-nortex-900 flex items-center gap-2">
            <Wallet className="text-nortex-500" /> Cobranza y Créditos
          </h2>
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
              <span className="text-xs text-slate-500 font-mono block">POR COBRAR</span>
              <span className="text-xl font-bold text-red-500">${totalReceivable.toFixed(2)}</span>
            </div>
            <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
              <span className="text-xs text-slate-500 font-mono block">RECAUDADO HOY</span>
              <span className="text-xl font-bold text-emerald-600">${collectedToday.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {safeSales.map(sale => (
            <button
              key={sale.id}
              onClick={() => setSelectedSale(sale)}
              className={`w-full text-left p-4 border-b border-slate-100 hover:bg-slate-50 transition-colors flex justify-between items-center group
                ${selectedSale?.id === sale.id ? 'bg-blue-50 border-l-4 border-l-nortex-500' : ''}
              `}
            >
              <div>
                <h4 className="font-bold text-slate-800">{sale.customerName || 'Cliente Sin Nombre'}</h4>
                <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
                  <Calendar size={12} />
                  <span>Vencimiento: {new Date(sale.dueDate || sale.date).toLocaleDateString()}</span>
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono font-bold text-slate-900">${sale.total.toFixed(2)}</div>
                {sale.status === 'PAID' ? (
                  <span className="text-xs font-bold text-emerald-600 flex items-center justify-end gap-1">
                    <CheckCircle size={10} /> PAGADO
                  </span>
                ) : (
                  <span className="text-xs font-bold text-red-500 flex items-center justify-end gap-1">
                    <Clock size={10} /> DEBE: ${sale.balance.toFixed(2)}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* RIGHT: Detail & Action */}
      <div className="flex-1 bg-slate-100 flex flex-col relative">
        {selectedSale ? (
          <div className="h-full flex flex-col p-6 overflow-y-auto">

            {/* Header Detail */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
              <div className="flex justify-between items-start">
                <div>
                  <h1 className="text-2xl font-bold text-nortex-900">{selectedSale.customerName}</h1>
                  <span className="text-sm text-slate-400 font-mono">ID Venta: {selectedSale.id}</span>
                </div>
                <div className="flex gap-2">
                  {selectedSale.status !== 'PAID' && (
                    <button
                      onClick={() => handleNotifyWhatsapp(selectedSale)}
                      className="px-3 py-1 bg-green-100 hover:bg-green-200 text-green-700 rounded-lg flex items-center gap-2 font-bold text-sm transition-colors"
                    >
                      <MessageCircle size={16} /> WhatsApp
                    </button>
                  )}
                  <div className={`px-3 py-1 rounded-full text-sm font-bold flex items-center ${selectedSale.status === 'PAID' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                    {selectedSale.status === 'PAID' ? 'COMPLETADO' : 'PENDIENTE DE PAGO'}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-6 mt-6 pt-6 border-t border-slate-100">
                <div>
                  <label className="text-xs font-mono text-slate-400 block mb-1">TOTAL VENTA</label>
                  <span className="text-xl font-bold text-slate-800">${selectedSale.total.toFixed(2)}</span>
                </div>
                <div>
                  <label className="text-xs font-mono text-slate-400 block mb-1">SALDO PENDIENTE</label>
                  <span className="text-xl font-bold text-red-500">${selectedSale.balance.toFixed(2)}</span>
                </div>
                <div>
                  {selectedSale.status !== 'PAID' && (
                    <button
                      onClick={() => setShowPayModal(true)}
                      className="w-full h-full bg-nortex-900 text-white rounded-lg font-bold hover:bg-nortex-800 transition-all flex items-center justify-center gap-2 shadow-lg shadow-nortex-900/20"
                    >
                      <DollarSign size={18} /> REGISTRAR ABONO
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* History */}
            <h3 className="text-sm font-bold text-slate-500 mb-3 uppercase tracking-wider">Historial de Pagos</h3>
            <div className="space-y-3">
              {(selectedSale.payments || []).length === 0 ? (
                <div className="text-center p-8 text-slate-400 italic">No hay pagos registrados aún.</div>
              ) : (
                selectedSale.payments?.map(pay => (
                  <div key={pay.id} className="bg-white p-4 rounded-lg border border-slate-200 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-emerald-50 text-emerald-600 rounded-full">
                        <CheckCircle size={16} />
                      </div>
                      <div>
                        <div className="font-bold text-slate-700">Abono a Cuenta</div>
                        <div className="text-xs text-slate-400">{new Date(pay.date).toLocaleString()}</div>
                      </div>
                    </div>
                    <span className="font-mono font-bold text-emerald-600">+${Number(pay.amount).toFixed(2)}</span>
                  </div>
                ))
              )}
            </div>

          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-slate-400">
            <User size={48} className="mb-4 opacity-20" />
            <p>Seleccione un cliente para ver detalles</p>
          </div>
        )}

        {/* PAYMENT MODAL */}
        {showPayModal && (
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden" style={{ color: '#1e293b' }}>
              {/* Header */}
              <div className="bg-nortex-900 px-6 py-5 text-white flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold">Registrar Abono</h3>
                  <p className="text-slate-400 text-sm">{selectedSale?.customerName}</p>
                </div>
                <button type="button" onClick={() => setShowPayModal(false)} className="p-1 hover:bg-white/10 rounded-lg transition-colors">
                  <span className="text-2xl leading-none">&times;</span>
                </button>
              </div>

              <form onSubmit={handleRegisterPayment} className="p-6">
                {/* Balance badge */}
                <div className="text-center mb-5">
                  <span className="inline-block px-4 py-2 rounded-full bg-red-50 border border-red-200 text-red-600 font-bold text-lg">
                    C$ {selectedSale?.balance.toFixed(2)}
                  </span>
                </div>

                {/* Amount input */}
                <div className="mb-4">
                  <label className="block text-sm font-bold mb-2" style={{ color: '#475569' }}>Monto a cobrar (C$)</label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full px-4 py-3 text-2xl font-bold border-2 border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    style={{ color: '#0f172a', backgroundColor: '#ffffff' }}
                    placeholder="0.00"
                    value={paymentAmount}
                    onChange={e => setPaymentAmount(e.target.value)}
                    autoFocus
                  />
                </div>

                {/* Payment method */}
                <div className="mb-6">
                  <label className="block text-sm font-bold mb-2" style={{ color: '#475569' }}>Método</label>
                  <select
                    className="w-full px-4 py-3 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                    style={{ color: '#0f172a', backgroundColor: '#ffffff' }}
                  >
                    <option value="CASH">Efectivo</option>
                    <option value="TRANSFER">Transferencia</option>
                  </select>
                </div>

                {/* Action buttons */}
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setShowPayModal(false)}
                    className="py-3 px-4 rounded-xl border border-slate-300 font-medium hover:bg-slate-50 transition-colors"
                    style={{ color: '#475569' }}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="py-3 px-4 rounded-xl bg-nortex-500 font-bold text-white hover:bg-nortex-400 shadow-lg shadow-nortex-500/30 flex items-center justify-center gap-2"
                  >
                    <CheckCircle size={18} /> Confirmar
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default AccountsReceivable;