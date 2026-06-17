import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { DollarSign, Calendar, User, CheckCircle, Clock, Wallet, MessageCircle, AlertTriangle, Printer, FileText, RefreshCw, Loader2 } from 'lucide-react';

// ==========================================
// TYPES
// ==========================================
interface WorklistItem {
  saleId: string;
  customerId: string | null;
  customerName: string;
  phone: string | null;
  invoiceNumber: string | null;
  date: string;
  dueDate: string | null;
  total: number;
  balance: number;
  daysOverdue: number; // >0 vencido, <0 por vencer
  bucket: string;
  status: 'OVERDUE' | 'DUE_SOON' | 'CURRENT';
}
interface Summary {
  totalReceivable: number; totalOverdue: number; overdueCount: number;
  dueSoon: number; dueSoonCount: number; collectedToday: number; dueSoonDays: number;
}
interface StatementPayment { id: string; amount: number; method: string; date: string; collectedBy: string | null; }
interface StatementInvoice {
  id: string; invoiceNumber: string | null; date: string; dueDate: string | null;
  total: number; paid: number; balance: number; daysOverdue: number;
  status: 'PAID' | 'OVERDUE' | 'PENDING' | 'WRITTEN_OFF'; payments: StatementPayment[];
}
interface Statement {
  customer: { id: string; name: string; phone: string | null; creditLimit: number; currentDebt: number; isBlocked: boolean };
  invoices: StatementInvoice[];
  totals: { billed: number; paid: number; balance: number; overdue: number };
  generatedAt: string;
}

const fmt = (n: number) => `C$ ${Number(n).toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('es-NI', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

// Etiqueta de urgencia a partir de los días vencidos.
const urgencyLabel = (it: { daysOverdue: number; status: string }) => {
  if (it.daysOverdue > 0) return { text: `Vencido ${it.daysOverdue}d`, cls: 'bg-red-100 text-red-700 border-red-200' };
  if (it.daysOverdue === 0) return { text: 'Vence hoy', cls: 'bg-amber-100 text-amber-700 border-amber-200' };
  if (it.status === 'DUE_SOON') return { text: `Vence en ${-it.daysOverdue}d`, cls: 'bg-amber-50 text-amber-600 border-amber-200' };
  return { text: 'Al día', cls: 'bg-emerald-50 text-emerald-600 border-emerald-200' };
};

const AccountsReceivable: React.FC = () => {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [items, setItems] = useState<WorklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'today' | 'all'>('today');

  const [selected, setSelected] = useState<WorklistItem | null>(null);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [statementLoading, setStatementLoading] = useState(false);

  const [showPayModal, setShowPayModal] = useState(false);
  const [paySale, setPaySale] = useState<{ id: string; customerName: string; balance: number } | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [submitting, setSubmitting] = useState(false);

  const token = localStorage.getItem('nortex_token');
  const headers = useMemo(() => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }), [token]);
  const isOwner = useMemo(() => {
    try { const r = JSON.parse(localStorage.getItem('nortex_user') || '{}')?.role; return r === 'OWNER' || r === 'ADMIN'; } catch { return false; }
  }, []);

  const fetchWorklist = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/collections/worklist?dueSoonDays=7', { headers });
      if (res.ok) {
        const data = await res.json();
        setSummary(data.summary);
        setItems(data.items || []);
      }
    } catch (e) { console.error('Error worklist:', e); }
    finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { fetchWorklist(); }, [fetchWorklist]);

  const openDetail = async (it: WorklistItem) => {
    setSelected(it);
    setStatement(null);
    if (!it.customerId) return; // walk-in sin ficha de cliente → solo la venta
    setStatementLoading(true);
    try {
      const res = await fetch(`/api/customers/${it.customerId}/statement`, { headers });
      if (res.ok) setStatement(await res.json());
    } catch (e) { console.error('Error statement:', e); }
    finally { setStatementLoading(false); }
  };

  const reloadDetail = async () => {
    await fetchWorklist();
    if (selected) {
      if (selected.customerId) {
        const res = await fetch(`/api/customers/${selected.customerId}/statement`, { headers });
        if (res.ok) setStatement(await res.json());
      }
    }
  };

  const openPay = (sale: { id: string; customerName: string; balance: number }) => {
    setPaySale(sale);
    setPaymentAmount('');
    setPaymentMethod('CASH');
    setShowPayModal(true);
  };

  // B3: recibo de abono imprimible (ventana limpia, formato media carta).
  const printReceipt = (r: { customer: string; amount: number; method: string; prevBalance: number; newBalance: number }) => {
    const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
    const methodLbl = r.method === 'CASH' ? 'Efectivo' : r.method === 'TRANSFER' ? 'Transferencia' : r.method === 'CARD' ? 'Tarjeta' : r.method;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Recibo de abono</title>
      <style>body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:24px;max-width:420px}
        h1{font-size:18px;margin:0 0 2px}.muted{color:#666;font-size:12px}
        .row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed #ddd;font-size:14px}
        .big{font-size:22px;font-weight:800;margin:10px 0;text-align:center}
        .sig{margin-top:40px;border-top:1px solid #333;text-align:center;font-size:12px;padding-top:4px}
        @media print{.no-print{display:none}}</style></head><body>
        <button class="no-print" onclick="window.print()" style="margin-bottom:12px;padding:8px 14px;font-weight:700;cursor:pointer">Imprimir</button>
        <h1>Recibo de Abono</h1>
        <div class="muted">${new Date().toLocaleString('es-NI')}</div>
        <div class="big">${fmt(r.amount)}</div>
        <div class="row"><span>Cliente</span><b>${esc(r.customer)}</b></div>
        <div class="row"><span>Método</span><span>${esc(methodLbl)}</span></div>
        <div class="row"><span>Saldo anterior</span><span>${fmt(r.prevBalance)}</span></div>
        <div class="row"><span>Nuevo saldo</span><b>${fmt(r.newBalance)}</b></div>
        <div class="sig">Firma / Recibí conforme</div>
        <script>window.onload=function(){setTimeout(function(){try{window.print()}catch(e){}},300)}<\/script>
      </body></html>`;
    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); }
  };

  const handleRegisterPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paySale) return;
    const amount = parseFloat(paymentAmount);
    if (isNaN(amount) || amount <= 0) { alert('Ingrese un monto válido'); return; }
    if (amount > paySale.balance + 0.001) { alert('El monto no puede exceder el saldo pendiente'); return; }
    setSubmitting(true);
    try {
      const res = await fetch('/api/credits/payment', {
        method: 'POST', headers,
        body: JSON.stringify({ saleId: paySale.id, amount, method: paymentMethod }),
      });
      if (res.ok) {
        const receipt = { customer: paySale.customerName, amount, method: paymentMethod, prevBalance: paySale.balance, newBalance: Math.max(0, paySale.balance - amount) };
        setShowPayModal(false);
        setPaymentAmount('');
        await reloadDetail();
        if (window.confirm('Abono registrado. ¿Imprimir recibo?')) printReceipt(receipt);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Error al registrar pago');
      }
    } catch (e) { alert('Error de conexión al registrar pago'); }
    finally { setSubmitting(false); }
  };

  const handleWriteoff = async (saleId: string, balance: number) => {
    const reason = window.prompt(`Castigar como INCOBRABLE el saldo de ${fmt(balance)}.\nSe reconoce la pérdida contablemente y no se podrá deshacer.\n\nJustificación (obligatoria):`);
    if (reason === null) return;
    if (reason.trim().length < 3) { alert('La justificación es obligatoria (mínimo 3 caracteres).'); return; }
    try {
      const res = await fetch(`/api/credits/${saleId}/writeoff`, { method: 'POST', headers, body: JSON.stringify({ reason: reason.trim() }) });
      const data = await res.json();
      if (res.ok) { await reloadDetail(); alert(data.message); }
      else alert(`Error: ${data.error}`);
    } catch (e) { alert('Error castigando la venta'); }
  };

  const notifyWhatsapp = (name: string, phone: string | null, balance: number) => {
    const msg = `Hola ${name}, le recordamos su saldo pendiente de ${fmt(balance)}. ¡Gracias!`;
    const url = phone
      ? `https://wa.me/505${String(phone).replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
  };

  // Imprime el estado de cuenta en una ventana limpia (no usa el CSS de tickets
  // térmicos de 80mm; un estado de cuenta va en papel normal).
  const printStatement = () => {
    if (!statement) return;
    const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
    const rows = statement.invoices.map(inv => `
      <tr>
        <td>${esc(inv.invoiceNumber || inv.id.slice(0, 8))}</td>
        <td>${fmtDate(inv.date)}</td><td>${fmtDate(inv.dueDate)}</td>
        <td style="text-align:right">${fmt(inv.total)}</td>
        <td style="text-align:right">${fmt(inv.paid)}</td>
        <td style="text-align:right">${fmt(inv.balance)}</td>
        <td>${inv.status === 'PAID' ? 'Pagada' : inv.status === 'OVERDUE' ? `Vencida ${inv.daysOverdue}d` : 'Pendiente'}</td>
      </tr>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Estado de cuenta - ${esc(statement.customer.name)}</title>
      <style>
        body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:24px;font-size:13px}
        h1{font-size:20px;margin:0 0 4px}.muted{color:#666;font-size:12px}
        table{width:100%;border-collapse:collapse;margin-top:16px}
        th,td{border-bottom:1px solid #ddd;padding:6px 8px;text-align:left}
        th{background:#f3f3f3;font-size:11px;text-transform:uppercase;color:#555}
        .totals{margin-top:16px;display:flex;gap:24px;justify-content:flex-end}
        .totals .lbl{font-size:11px;color:#666;text-transform:uppercase}.totals .val{font-size:16px;font-weight:700;text-align:right}
        @media print{.no-print{display:none}}
      </style></head><body>
        <button class="no-print" onclick="window.print()" style="margin-bottom:12px;padding:8px 14px;font-weight:700;cursor:pointer">Imprimir</button>
        <h1>Estado de Cuenta</h1>
        <div class="muted">${esc(statement.customer.name)}${statement.customer.phone ? ' · ' + esc(statement.customer.phone) : ''}</div>
        <div class="muted">Generado: ${new Date(statement.generatedAt).toLocaleString('es-NI')}</div>
        <table><thead><tr><th>Factura</th><th>Emitida</th><th>Vence</th><th>Total</th><th>Abonado</th><th>Saldo</th><th>Estado</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:#999">Sin facturas a crédito</td></tr>'}</tbody></table>
        <div class="totals">
          <div><div class="lbl">Facturado</div><div class="val">${fmt(statement.totals.billed)}</div></div>
          <div><div class="lbl">Abonado</div><div class="val">${fmt(statement.totals.paid)}</div></div>
          <div><div class="lbl">Saldo</div><div class="val">${fmt(statement.totals.balance)}</div></div>
        </div>
        <script>window.onload=function(){setTimeout(function(){try{window.print()}catch(e){}},300)}<\/script>
      </body></html>`;
    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); } else { alert('Permite ventanas emergentes para imprimir.'); }
  };

  const visibleItems = filter === 'today'
    ? items.filter(i => i.status === 'OVERDUE' || i.status === 'DUE_SOON')
    : items;

  return (
    <div className="flex h-full bg-slate-100 overflow-hidden">

      {/* LEFT: Worklist */}
      <div className="w-1/2 lg:w-2/5 flex flex-col border-r border-slate-200 bg-white">
        <div className="p-5 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-nortex-900 flex items-center gap-2">
              <Wallet className="text-nortex-500" /> Cobranza
            </h2>
            <button onClick={fetchWorklist} className="p-2 rounded-lg text-slate-400 hover:text-nortex-700 hover:bg-slate-100" title="Actualizar">
              <RefreshCw size={16} />
            </button>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
              <span className="text-[11px] text-slate-500 font-mono block">POR COBRAR</span>
              <span className="text-lg font-bold text-slate-800">{fmt(summary?.totalReceivable || 0)}</span>
            </div>
            <div className="bg-white p-3 rounded-lg border border-red-100 shadow-sm">
              <span className="text-[11px] text-slate-500 font-mono block">VENCIDO {summary?.overdueCount ? `(${summary.overdueCount})` : ''}</span>
              <span className="text-lg font-bold text-red-600">{fmt(summary?.totalOverdue || 0)}</span>
            </div>
            <div className="bg-white p-3 rounded-lg border border-amber-100 shadow-sm">
              <span className="text-[11px] text-slate-500 font-mono block">POR VENCER {summary?.dueSoonCount ? `(${summary.dueSoonCount})` : ''}</span>
              <span className="text-lg font-bold text-amber-600">{fmt(summary?.dueSoon || 0)}</span>
            </div>
            <div className="bg-white p-3 rounded-lg border border-emerald-100 shadow-sm">
              <span className="text-[11px] text-slate-500 font-mono block">RECAUDADO HOY</span>
              <span className="text-lg font-bold text-emerald-600">{fmt(summary?.collectedToday || 0)}</span>
            </div>
          </div>

          {/* Filter */}
          <div className="flex gap-2 mt-4">
            <button onClick={() => setFilter('today')} className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${filter === 'today' ? 'bg-nortex-900 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
              Cobrar hoy {summary ? `(${summary.overdueCount + summary.dueSoonCount})` : ''}
            </button>
            <button onClick={() => setFilter('all')} className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${filter === 'all' ? 'bg-nortex-900 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
              Todos ({items.length})
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {loading ? (
            <div className="p-10 text-center text-slate-400"><Loader2 className="animate-spin inline mr-2" size={18} /> Cargando...</div>
          ) : visibleItems.length === 0 ? (
            <div className="p-10 text-center text-slate-400">
              <CheckCircle size={36} className="mx-auto mb-2 opacity-30 text-emerald-500" />
              {filter === 'today' ? 'Nada vencido ni por vencer. ¡Al día!' : 'Sin cuentas por cobrar.'}
            </div>
          ) : visibleItems.map(it => {
            const u = urgencyLabel(it);
            return (
              <button
                key={it.saleId}
                onClick={() => openDetail(it)}
                className={`w-full text-left p-4 border-b border-slate-100 hover:bg-slate-50 transition-colors flex justify-between items-center
                  ${selected?.saleId === it.saleId ? 'bg-blue-50 border-l-4 border-l-nortex-500' : ''}`}
              >
                <div className="min-w-0">
                  <h4 className="font-bold text-slate-800 truncate">{it.customerName}</h4>
                  <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
                    <Calendar size={12} /> Vence: {fmtDate(it.dueDate)}
                  </div>
                  <span className={`inline-block mt-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${u.cls}`}>{u.text}</span>
                </div>
                <div className="text-right shrink-0 ml-2">
                  <div className="font-mono font-bold text-red-600">{fmt(it.balance)}</div>
                  <div className="text-[11px] text-slate-400">de {fmt(it.total)}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* RIGHT: Detail / Statement */}
      <div className="flex-1 bg-slate-100 flex flex-col relative overflow-hidden">
        {!selected ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-400">
            <User size={48} className="mb-4 opacity-20" />
            <p>Seleccione un cliente para ver su estado de cuenta</p>
          </div>
        ) : (
          <div className="h-full flex flex-col p-6 overflow-y-auto" id="statement-print">
            {/* Header */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-5">
              <div className="flex justify-between items-start gap-3">
                <div>
                  <h1 className="text-2xl font-bold text-nortex-900">{statement?.customer.name || selected.customerName}</h1>
                  {statement?.customer.phone && <span className="text-sm text-slate-400">{statement.customer.phone}</span>}
                  {statement?.customer.isBlocked && (
                    <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">BLOQUEADO</span>
                  )}
                </div>
                <div className="flex gap-2 no-print">
                  <button onClick={() => notifyWhatsapp(statement?.customer.name || selected.customerName, statement?.customer.phone || selected.phone, statement?.totals.balance ?? selected.balance)}
                    className="px-3 py-1.5 bg-green-100 hover:bg-green-200 text-green-700 rounded-lg flex items-center gap-2 font-bold text-sm">
                    <MessageCircle size={16} /> Recordar
                  </button>
                  {statement && (
                    <button onClick={printStatement} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg flex items-center gap-2 font-bold text-sm">
                      <Printer size={16} /> Imprimir
                    </button>
                  )}
                </div>
              </div>

              {statement && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5 pt-5 border-t border-slate-100">
                  <div><label className="text-[11px] font-mono text-slate-400 block">FACTURADO</label><span className="text-lg font-bold text-slate-800">{fmt(statement.totals.billed)}</span></div>
                  <div><label className="text-[11px] font-mono text-slate-400 block">ABONADO</label><span className="text-lg font-bold text-emerald-600">{fmt(statement.totals.paid)}</span></div>
                  <div><label className="text-[11px] font-mono text-slate-400 block">SALDO</label><span className="text-lg font-bold text-red-600">{fmt(statement.totals.balance)}</span></div>
                  <div><label className="text-[11px] font-mono text-slate-400 block">LÍMITE</label><span className="text-lg font-bold text-slate-700">{fmt(statement.customer.creditLimit)}</span></div>
                </div>
              )}
            </div>

            {/* Estado de cuenta (facturas + abonos) */}
            {statementLoading ? (
              <div className="p-10 text-center text-slate-400"><Loader2 className="animate-spin inline mr-2" size={18} /> Cargando estado de cuenta...</div>
            ) : statement ? (
              <>
                <h3 className="text-sm font-bold text-slate-500 mb-3 uppercase tracking-wider flex items-center gap-2"><FileText size={15} /> Estado de cuenta</h3>
                <div className="space-y-3">
                  {statement.invoices.map(inv => (
                    <div key={inv.id} className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                      <div className="p-4 flex justify-between items-center">
                        <div>
                          <div className="font-bold text-slate-800">Factura {inv.invoiceNumber || inv.id.slice(0, 8)}</div>
                          <div className="text-xs text-slate-500 mt-0.5">Emitida {fmtDate(inv.date)} · Vence {fmtDate(inv.dueDate)}</div>
                          <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${inv.status === 'PAID' ? 'bg-emerald-100 text-emerald-700' : inv.status === 'WRITTEN_OFF' ? 'bg-slate-200 text-slate-600' : inv.status === 'OVERDUE' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                            {inv.status === 'PAID' ? 'Pagada' : inv.status === 'WRITTEN_OFF' ? 'Incobrable' : inv.status === 'OVERDUE' ? `Vencida ${inv.daysOverdue}d` : 'Pendiente'}
                          </span>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-slate-400">Saldo</div>
                          <div className="font-mono font-bold text-red-600">{fmt(inv.balance)}</div>
                          <div className="text-[11px] text-slate-400">de {fmt(inv.total)}</div>
                          {inv.balance > 0 && (
                            <div className="no-print mt-1 flex gap-1 justify-end">
                              <button onClick={() => openPay({ id: inv.id, customerName: statement.customer.name, balance: inv.balance })}
                                className="px-3 py-1 bg-nortex-900 text-white rounded-lg text-xs font-bold hover:bg-nortex-800">
                                Abonar
                              </button>
                              {isOwner && (
                                <button onClick={() => handleWriteoff(inv.id, inv.balance)}
                                  className="px-2 py-1 border border-slate-300 text-slate-500 rounded-lg text-xs font-semibold hover:bg-red-50 hover:text-red-600 hover:border-red-200"
                                  title="Castigar como incobrable">
                                  Incobrable
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      {inv.payments.length > 0 && (
                        <div className="border-t border-slate-100 bg-slate-50 px-4 py-2 space-y-1">
                          {inv.payments.map(p => (
                            <div key={p.id} className="flex justify-between text-xs text-slate-600">
                              <span>{fmtDate(p.date)} · {p.method}{p.collectedBy ? ` · ${p.collectedBy}` : ''}</span>
                              <span className="font-mono font-semibold text-emerald-600">+{fmt(p.amount)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              // Walk-in sin ficha de cliente → solo la venta seleccionada
              <div className="bg-white rounded-xl border border-slate-200 p-6">
                <div className="flex items-start gap-2 text-slate-500 text-sm mb-4">
                  <AlertTriangle size={16} className="text-amber-500 mt-0.5" /> Cliente sin ficha registrada; se muestra solo esta venta.
                </div>
                <div className="grid grid-cols-3 gap-6">
                  <div><label className="text-xs font-mono text-slate-400 block mb-1">TOTAL</label><span className="text-xl font-bold text-slate-800">{fmt(selected.total)}</span></div>
                  <div><label className="text-xs font-mono text-slate-400 block mb-1">SALDO</label><span className="text-xl font-bold text-red-600">{fmt(selected.balance)}</span></div>
                  <button onClick={() => openPay({ id: selected.saleId, customerName: selected.customerName, balance: selected.balance })}
                    className="bg-nortex-900 text-white rounded-lg font-bold hover:bg-nortex-800 flex items-center justify-center gap-2">
                    <DollarSign size={18} /> Abonar
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* PAYMENT MODAL */}
        {showPayModal && paySale && (
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 no-print">
            <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden" style={{ color: '#1e293b' }}>
              <div className="bg-nortex-900 px-6 py-5 text-white flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold">Registrar Abono</h3>
                  <p className="text-slate-400 text-sm">{paySale.customerName}</p>
                </div>
                <button type="button" onClick={() => setShowPayModal(false)} className="p-1 hover:bg-white/10 rounded-lg">
                  <span className="text-2xl leading-none">&times;</span>
                </button>
              </div>
              <form onSubmit={handleRegisterPayment} className="p-6">
                <div className="text-center mb-5">
                  <span className="inline-block px-4 py-2 rounded-full bg-red-50 border border-red-200 text-red-600 font-bold text-lg">{fmt(paySale.balance)}</span>
                </div>
                <div className="mb-4">
                  <label className="block text-sm font-bold mb-2" style={{ color: '#475569' }}>Monto a cobrar (C$)</label>
                  <input type="number" step="0.01" autoFocus value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)}
                    className="w-full px-4 py-3 text-2xl font-bold border-2 border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    style={{ color: '#0f172a', backgroundColor: '#ffffff' }} placeholder="0.00" />
                </div>
                <div className="mb-6">
                  <label className="block text-sm font-bold mb-2" style={{ color: '#475569' }}>Método</label>
                  <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}
                    className="w-full px-4 py-3 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                    style={{ color: '#0f172a', backgroundColor: '#ffffff' }}>
                    <option value="CASH">Efectivo</option>
                    <option value="TRANSFER">Transferencia</option>
                    <option value="CARD">Tarjeta</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <button type="button" onClick={() => setShowPayModal(false)} className="py-3 px-4 rounded-xl border border-slate-300 font-medium hover:bg-slate-50" style={{ color: '#475569' }}>Cancelar</button>
                  <button type="submit" disabled={submitting} className="py-3 px-4 rounded-xl bg-nortex-500 font-bold text-white hover:bg-nortex-400 disabled:opacity-50 flex items-center justify-center gap-2">
                    {submitting ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle size={18} />} Confirmar
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
