import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { maybeAutostartTour } from '../utils/tours';
import { authFetch } from '../utils/auth';
import { formatMoney } from '../utils/money';
import { normalizeApiFailure } from '../utils/posActivation';
import { ToastViewport, useToast } from './ui/Toast';
import { AlertCircle, ArrowLeft, DollarSign, Calendar, User, CheckCircle, Clock3, Wallet, MessageCircle, AlertTriangle, Printer, FileText, RefreshCw, Loader2, ReceiptText, ShieldAlert, X } from 'lucide-react';

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

interface ReceiptDraft {
  customer: string;
  amount: number;
  method: string;
  prevBalance: number;
  newBalance: number;
}

// El símbolo sale de formatMoney, nunca de una plantilla local: es lo que evita
// que la misma cifra aparezca como "C$ 2,042,190.31" acá y "$2,042,190.31" en
// Reportes, que era el bug de credibilidad más caro del producto.
const fmt = (n: number) => formatMoney(n);
const MANAGUA_TIME_ZONE = 'America/Managua';

type ReceivableDateValue = Date | string | null | undefined;

const validDate = (value: ReceivableDateValue): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

// Cobranza comparte la fecha civil de negocio de Customer 360. La zona se pasa
// siempre a Intl para que un navegador/CI en UTC no corra un timestamp al día
// siguiente respecto de Nicaragua.
export const formatReceivableDate = (value: ReceivableDateValue): string => {
  const date = validDate(value);
  if (!date) return '—';
  return date.toLocaleDateString('es-NI', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: MANAGUA_TIME_ZONE,
  });
};

export const formatReceivableDateTime = (value: ReceivableDateValue): string => {
  const date = validDate(value);
  if (!date) return '—';
  return date.toLocaleString('es-NI', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: MANAGUA_TIME_ZONE,
  });
};

const fmtDate = formatReceivableDate;

// Etiqueta de urgencia a partir de los días vencidos.
const urgencyLabel = (it: { daysOverdue: number; status: string }) => {
  if (it.daysOverdue > 0) return { text: `Vencido ${it.daysOverdue}d`, cls: 'bg-red-500/15 text-red-400 border-red-500/20' };
  if (it.daysOverdue === 0) return { text: 'Vence hoy', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/20' };
  if (it.status === 'DUE_SOON') return { text: `Vence en ${-it.daysOverdue}d`, cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' };
  return { text: 'Al día', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' };
};

const paymentMethodLabel = (method: string) => {
  if (method === 'CASH') return 'Efectivo';
  if (method === 'TRANSFER') return 'Transferencia';
  if (method === 'CARD') return 'Tarjeta';
  return method;
};

const DIALOG_FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const dialogFocusableElements = (dialog: HTMLElement): HTMLElement[] => (
  Array.from(dialog.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR))
    .filter((element) => element.tabIndex >= 0
      && !element.hidden
      && element.getAttribute('aria-hidden') !== 'true')
);

/**
 * Conserva el foco dentro del modal y lo devuelve al control que lo abrió.
 * El callback vive en un ref para que el listener respete el estado busy actual
 * sin reinstalarse en cada render del formulario.
 */
const useAccessibleDialog = (
  open: boolean,
  onClose: () => void,
  initialFocusSelector: string,
  returnFocusRef: React.MutableRefObject<HTMLElement | null>,
  fallbackReturnFocusRef?: React.MutableRefObject<HTMLElement | null>,
) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;

    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    const returnFocus = returnFocusRef.current
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const focusInitialControl = () => {
      const initialFocus = dialog.querySelector<HTMLElement>(initialFocusSelector)
        ?? dialogFocusableElements(dialog)[0]
        ?? dialog;
      initialFocus.focus({ preventScroll: true });
    };

    focusInitialControl();

    const keepKeyboardFocusInside = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = dialogFocusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    const recoverEscapedFocus = (event: FocusEvent) => {
      const target = event.target;
      if (target instanceof Node && !dialog.contains(target)) {
        event.stopPropagation();
        focusInitialControl();
      }
    };

    document.addEventListener('keydown', keepKeyboardFocusInside);
    document.addEventListener('focusin', recoverEscapedFocus);
    return () => {
      document.removeEventListener('keydown', keepKeyboardFocusInside);
      document.removeEventListener('focusin', recoverEscapedFocus);
      const canReceiveRestoredFocus = (element: HTMLElement | null | undefined) => (
        Boolean(element?.isConnected)
        && !element!.hasAttribute('disabled')
        && element!.getAttribute('aria-hidden') !== 'true'
      );
      const focusTarget = canReceiveRestoredFocus(returnFocus)
        ? returnFocus
        : fallbackReturnFocusRef?.current;
      if (canReceiveRestoredFocus(focusTarget)) {
        focusTarget!.focus({ preventScroll: true });
      }
      if (returnFocusRef.current === returnFocus) returnFocusRef.current = null;
    };
  }, [fallbackReturnFocusRef, initialFocusSelector, open, returnFocusRef]);

  return dialogRef;
};

const AccountsReceivable: React.FC = () => {
  const { toast, showToast, dismissToast } = useToast();
  const [searchParams] = useSearchParams();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [items, setItems] = useState<WorklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [filter, setFilter] = useState<'today' | 'all'>('today');
  const [mobileDetailOpen, setMobileDetailOpen] = useState(Boolean(searchParams.get('customerId')));

  const [selected, setSelected] = useState<WorklistItem | null>(null);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [statementLoading, setStatementLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const [showPayModal, setShowPayModal] = useState(false);
  const [paySale, setPaySale] = useState<{ id: string; customerName: string; balance: number } | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [paymentClientEventId, setPaymentClientEventId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const [receiptToConfirm, setReceiptToConfirm] = useState<ReceiptDraft | null>(null);
  const [writeoffDraft, setWriteoffDraft] = useState<{ saleId: string; customerName: string; balance: number; reason: string } | null>(null);
  const [writeoffSubmitting, setWriteoffSubmitting] = useState(false);
  const [writeoffError, setWriteoffError] = useState('');
  const paymentReturnFocusRef = useRef<HTMLElement | null>(null);
  const receiptReturnFocusRef = useRef<HTMLElement | null>(null);
  const writeoffReturnFocusRef = useRef<HTMLElement | null>(null);
  const detailReturnFocusRef = useRef<HTMLElement | null>(null);

  const token = localStorage.getItem('nortex_token');
  const headers = useMemo(() => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }), [token]);
  const canWriteOff = useMemo(() => {
    try {
      const r = JSON.parse(localStorage.getItem('nortex_user') || '{}')?.role;
      return r === 'OWNER' || r === 'ADMIN' || r === 'SUPER_ADMIN';
    } catch {
      return false;
    }
  }, []);
  const customerIdFromUrl = searchParams.get('customerId');

  const fetchWorklist = useCallback(async () => {
    setLoading(true);
    setListError('');
    try {
      const res = await authFetch('/api/collections/worklist?dueSoonDays=7', { headers });
      if (res.ok) {
        const data = await res.json();
        setSummary(data.summary);
        setItems(data.items || []);
      } else {
        const data = await res.json().catch(() => ({}));
        const message = normalizeApiFailure(res.status, data, 'La bandeja de cobranza no respondió.').message;
        setListError(message);
        showToast({
          tone: 'error',
          title: 'No se pudo cargar la cobranza',
          message,
        });
      }
    } catch (e) {
      console.error('Error worklist:', e);
      const message = 'No pudimos cargar la bandeja de cobranza. Revisá tu conexión e intentá de nuevo.';
      setListError(message);
      showToast({
        tone: 'error',
        title: 'Error de conexión',
        message,
      });
    }
    finally { setLoading(false); }
  }, [headers, showToast]);

  useEffect(() => { fetchWorklist(); }, [fetchWorklist]);

  // Tutorial guiado: si entran con ?tour=fiado (desde Ayuda).
  useEffect(() => { maybeAutostartTour(); }, []);

  const loadStatementByCustomerId = useCallback(async (customerId: string, seed?: Partial<WorklistItem>) => {
    setStatementLoading(true);
    setDetailError('');
    try {
      const res = await authFetch(`/api/customers/${customerId}/statement`, { headers });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const message = normalizeApiFailure(res.status, data, 'El detalle del cliente no estuvo disponible.').message;
        setStatement(null);
        setDetailError(message);
        showToast({
          tone: 'error',
          title: 'No se pudo abrir el estado de cuenta',
          message,
        });
        return;
      }
      const nextStatement: Statement = await res.json();
      setStatement(nextStatement);
      setSelected((previous) => ({
        saleId: seed?.saleId ?? previous?.saleId ?? `customer:${customerId}`,
        customerId,
        customerName: nextStatement.customer.name,
        phone: nextStatement.customer.phone,
        invoiceNumber: seed?.invoiceNumber ?? null,
        date: seed?.date ?? previous?.date ?? nextStatement.generatedAt,
        dueDate: seed?.dueDate ?? null,
        total: seed?.total ?? nextStatement.totals.billed,
        balance: nextStatement.totals.balance,
        daysOverdue: seed?.daysOverdue ?? (nextStatement.totals.overdue > 0 ? 1 : 0),
        bucket: seed?.bucket ?? (nextStatement.totals.overdue > 0 ? 'b1_30' : 'corriente'),
        status: seed?.status ?? (nextStatement.totals.overdue > 0 ? 'OVERDUE' : 'CURRENT'),
      }));
    } catch (e) {
      console.error('Error statement:', e);
      const message = 'No pudimos abrir el estado de cuenta del cliente. Revisá tu conexión e intentá de nuevo.';
      setStatement(null);
      setDetailError(message);
      showToast({
        tone: 'error',
        title: 'Error de conexión',
        message,
      });
    } finally { setStatementLoading(false); }
  }, [headers, showToast]);

  const openDetail = (it: WorklistItem) => {
    setSelected(it);
    setStatement(null);
    setDetailError('');
    setMobileDetailOpen(true);
    if (!it.customerId) return; // walk-in sin ficha de cliente → solo la venta
    void loadStatementByCustomerId(it.customerId, it);
  };

  const reloadDetail = async () => {
    await fetchWorklist();
    if (selected) {
      if (selected.customerId) {
        await loadStatementByCustomerId(selected.customerId, selected);
      }
    }
  };

  useEffect(() => {
    if (!customerIdFromUrl) return;
    setSelected((previous) => previous?.customerId === customerIdFromUrl ? previous : {
      saleId: `customer:${customerIdFromUrl}`,
      customerId: customerIdFromUrl,
      customerName: 'Estado de cuenta',
      phone: null,
      invoiceNumber: null,
      date: new Date().toISOString(),
      dueDate: null,
      total: 0,
      balance: 0,
      daysOverdue: 0,
      bucket: 'corriente',
      status: 'CURRENT',
    });
    setStatement(null);
    setMobileDetailOpen(true);
    void loadStatementByCustomerId(customerIdFromUrl);
  }, [customerIdFromUrl, loadStatementByCustomerId]);

  const openPay = (
    sale: { id: string; customerName: string; balance: number },
    trigger: HTMLElement,
  ) => {
    paymentReturnFocusRef.current = trigger;
    setPaySale(sale);
    setPaymentAmount('');
    setPaymentMethod('CASH');
    setPaymentClientEventId(crypto.randomUUID());
    setPaymentError('');
    setShowPayModal(true);
  };

  const closePaymentModal = () => {
    if (submitting) return;
    setShowPayModal(false);
    setPaySale(null);
    setPaymentAmount('');
    setPaymentError('');
    setPaymentClientEventId('');
  };

  const closeReceiptModal = () => {
    setReceiptToConfirm(null);
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
        <div class="muted">${formatReceivableDateTime(new Date())}</div>
        <div class="big">${fmt(r.amount)}</div>
        <div class="row"><span>Cliente</span><b>${esc(r.customer)}</b></div>
        <div class="row"><span>Método</span><span>${esc(methodLbl)}</span></div>
        <div class="row"><span>Saldo anterior</span><span>${fmt(r.prevBalance)}</span></div>
        <div class="row"><span>Nuevo saldo</span><b>${fmt(r.newBalance)}</b></div>
        <div class="sig">Firma / Recibí conforme</div>
        <script>window.onload=function(){setTimeout(function(){try{window.print()}catch(e){}},300)}<\/script>
      </body></html>`;
    const w = window.open('', '_blank');
    if (w) {
      w.document.write(html);
      w.document.close();
      return true;
    } else {
      showToast({
        tone: 'warning',
        title: 'El navegador bloqueó la ventana',
        message: 'Permití ventanas emergentes para imprimir el recibo.',
      });
      return false;
    }
  };

  const handleRegisterPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paySale || submitting) return;
    const amount = Number(paymentAmount);
    if (!paymentAmount.trim() || !Number.isFinite(amount) || amount <= 0) {
      setPaymentError('Ingresá un monto mayor que cero.');
      return;
    }
    if (amount > paySale.balance + 0.001) {
      setPaymentError('El monto no puede exceder el saldo pendiente.');
      return;
    }
    const clientEventId = paymentClientEventId || crypto.randomUUID();
    if (!paymentClientEventId) setPaymentClientEventId(clientEventId);
    setSubmitting(true);
    setPaymentError('');
    try {
      const res = await authFetch('/api/credits/payment', {
        method: 'POST', headers,
        body: JSON.stringify({ saleId: paySale.id, amount: paymentAmount.trim(), method: paymentMethod, clientEventId }),
      });
      if (res.ok) {
        const receipt: ReceiptDraft = { customer: paySale.customerName, amount, method: paymentMethod, prevBalance: paySale.balance, newBalance: Math.max(0, paySale.balance - amount) };
        receiptReturnFocusRef.current = paymentReturnFocusRef.current;
        setShowPayModal(false);
        setPaySale(null);
        setPaymentAmount('');
        setPaymentClientEventId('');
        setPaymentError('');
        setReceiptToConfirm(receipt);
        await reloadDetail();
        showToast({
          tone: 'success',
          title: 'Abono registrado',
          message: `Se aplicaron ${fmt(amount)} a la cuenta de ${receipt.customer}.`,
        });
      } else {
        const err = await res.json().catch(() => ({}));
        const message = normalizeApiFailure(res.status, err, 'No se pudo registrar el abono.').message;
        setPaymentError(message);
        showToast({ tone: 'error', title: 'El abono no se registró', message });
      }
    } catch (e) {
      const message = 'No se confirmó el abono. Podés reintentar sin duplicarlo cuando vuelva la conexión.';
      setPaymentError(message);
      showToast({ tone: 'error', title: 'Error de conexión', message });
    }
    finally { setSubmitting(false); }
  };

  const openWriteoff = (saleId: string, customerName: string, balance: number, trigger: HTMLElement) => {
    writeoffReturnFocusRef.current = trigger;
    setWriteoffDraft({ saleId, customerName, balance, reason: '' });
    setWriteoffError('');
  };

  const closeWriteoffModal = () => {
    if (writeoffSubmitting) return;
    setWriteoffDraft(null);
    setWriteoffError('');
  };

  const paymentDialogRef = useAccessibleDialog(
    showPayModal && Boolean(paySale),
    closePaymentModal,
    '[data-dialog-initial-focus="receivable-payment"]',
    paymentReturnFocusRef,
    detailReturnFocusRef,
  );
  const receiptDialogRef = useAccessibleDialog(
    Boolean(receiptToConfirm),
    closeReceiptModal,
    '[data-dialog-initial-focus="receivable-receipt"]',
    receiptReturnFocusRef,
    detailReturnFocusRef,
  );
  const writeoffDialogRef = useAccessibleDialog(
    Boolean(writeoffDraft),
    closeWriteoffModal,
    '[data-dialog-initial-focus="receivable-writeoff"]',
    writeoffReturnFocusRef,
    detailReturnFocusRef,
  );

  const handleWriteoff = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!writeoffDraft || writeoffSubmitting) return;
    if (writeoffDraft.reason.trim().length < 3) {
      setWriteoffError('Escribí una justificación de al menos 3 caracteres.');
      return;
    }
    setWriteoffError('');
    setWriteoffSubmitting(true);
    try {
      const res = await authFetch(`/api/credits/${writeoffDraft.saleId}/writeoff`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ reason: writeoffDraft.reason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setWriteoffDraft(null);
        setWriteoffError('');
        await reloadDetail();
        showToast({
          tone: 'success',
          title: 'Venta castigada como incobrable',
          message: data.message || 'La pérdida contable ya quedó registrada.',
        });
      } else {
        const message = normalizeApiFailure(res.status, data, 'La venta no pudo marcarse como incobrable.').message;
        setWriteoffError(message);
        showToast({
          tone: 'error',
          title: 'No se pudo castigar la venta',
          message,
        });
      }
    } catch (e) {
      const message = 'No pudimos completar el castigo por un problema de conexión.';
      setWriteoffError(message);
      showToast({
        tone: 'error',
        title: 'Error castigando la venta',
        message,
      });
    } finally {
      setWriteoffSubmitting(false);
    }
  };

  const notifyWhatsapp = (name: string, phone: string | null, balance: number) => {
    const msg = `Hola ${name}, le recordamos su saldo pendiente de ${fmt(balance)}. ¡Gracias!`;
    const digits = String(phone || '').replace(/\D/g, '');
    const whatsappPhone = digits.startsWith('505') ? digits : `505${digits}`;
    const url = digits
      ? `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`;
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) {
      showToast({
        tone: 'warning',
        title: 'No se pudo abrir WhatsApp',
        message: 'Permití ventanas emergentes para enviar el recordatorio.',
      });
    }
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
        <td>${inv.status === 'PAID' ? 'Pagada' : inv.status === 'WRITTEN_OFF' ? 'Incobrable' : inv.status === 'OVERDUE' ? `Vencida ${inv.daysOverdue}d` : 'Pendiente'}</td>
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
        <div class="muted">Generado: ${formatReceivableDateTime(statement.generatedAt)}</div>
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
    if (w) { w.document.write(html); w.document.close(); } else {
      showToast({
        tone: 'warning',
        title: 'No se pudo abrir la impresión',
        message: 'Permití ventanas emergentes para imprimir el estado de cuenta.',
      });
    }
  };

  const visibleItems = filter === 'today'
    ? items.filter(i => i.status === 'OVERDUE' || i.status === 'DUE_SOON')
    : items;

  const recentPayments = useMemo(() => {
    if (!statement) return [];
    return statement.invoices
      .flatMap((invoice) => invoice.payments.map((payment) => ({
        ...payment,
        invoiceLabel: invoice.invoiceNumber || invoice.id.slice(0, 8),
      })))
      .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime())
      .slice(0, 5);
  }, [statement]);

  const openInvoices = statement?.invoices.filter((invoice) => invoice.balance > 0) || [];
  const creditUsage = statement && statement.customer.creditLimit > 0
    ? Math.min(100, (statement.customer.currentDebt / statement.customer.creditLimit) * 100)
    : statement?.customer.currentDebt ? 100 : 0;

  return (
    <div className="grid h-full overflow-hidden bg-surface-950 text-slate-100 xl:grid-cols-[minmax(330px,410px)_minmax(0,1fr)]">
      <ToastViewport toast={toast} onDismiss={dismissToast} />

      {/* LEFT: Worklist */}
      <div className={`${mobileDetailOpen ? 'hidden xl:flex' : 'flex'} min-h-0 flex-col border-r border-white/[0.06] bg-surface-900`}>
        <div className="p-5 border-b border-white/[0.06] bg-surface-800/40">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-black text-slate-100 flex items-center gap-2">
                <Wallet className="text-nortex-400" size={22} /> Cobranza
              </h1>
              <p className="mt-1 text-sm text-slate-400">Priorizá vencidos y dejá cada cuenta lista.</p>
            </div>
            <button type="button" onClick={() => void fetchWorklist()} disabled={loading} className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-2.5 text-slate-300 hover:bg-white/[0.06] hover:text-white disabled:cursor-wait disabled:opacity-60" aria-label="Actualizar bandeja de cobranza">
              <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="bg-surface-900 p-3 rounded-lg border border-white/[0.06] shadow-sm">
              <span className="text-[11px] text-slate-500 font-mono block">POR COBRAR</span>
              <span className="text-lg font-bold text-slate-100">{fmt(summary?.totalReceivable || 0)}</span>
            </div>
            <div className="bg-surface-900 p-3 rounded-lg border border-red-500/15 shadow-sm">
              <span className="text-[11px] text-slate-500 font-mono block">VENCIDO {summary?.overdueCount ? `(${summary.overdueCount})` : ''}</span>
              <span className="text-lg font-bold text-red-400">{fmt(summary?.totalOverdue || 0)}</span>
            </div>
            <div className="bg-surface-900 p-3 rounded-lg border border-amber-500/15 shadow-sm">
              <span className="text-[11px] text-slate-500 font-mono block">POR VENCER {summary?.dueSoonCount ? `(${summary.dueSoonCount})` : ''}</span>
              <span className="text-lg font-bold text-amber-400">{fmt(summary?.dueSoon || 0)}</span>
            </div>
            <div className="bg-surface-900 p-3 rounded-lg border border-emerald-500/15 shadow-sm">
              <span className="text-[11px] text-slate-500 font-mono block">RECAUDADO HOY</span>
              <span className="text-lg font-bold text-emerald-400">{fmt(summary?.collectedToday || 0)}</span>
            </div>
          </div>

          {/* Filter */}
          <div className="flex gap-2 mt-4">
            <button type="button" onClick={() => setFilter('today')} aria-pressed={filter === 'today'} className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${filter === 'today' ? 'bg-nortex-900 text-white' : 'bg-surface-900 border border-white/[0.06] text-slate-300'}`}>
              Cobrar hoy {summary ? `(${summary.overdueCount + summary.dueSoonCount})` : ''}
            </button>
            <button type="button" onClick={() => setFilter('all')} aria-pressed={filter === 'all'} className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${filter === 'all' ? 'bg-nortex-900 text-white' : 'bg-surface-900 border border-white/[0.06] text-slate-300'}`}>
              Todas ({items.length})
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {listError && (
            <div role="alert" className="m-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-100">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 shrink-0 text-red-300" size={17} />
                <div>
                  <p className="font-bold">No pudimos actualizar la bandeja</p>
                  <p className="mt-1 text-red-100/80">{listError}</p>
                  <button type="button" onClick={() => void fetchWorklist()} className="mt-3 rounded-xl bg-red-500/15 px-3 py-2 font-bold text-red-100 hover:bg-red-500/20">Reintentar</button>
                </div>
              </div>
            </div>
          )}
          {loading && items.length === 0 && !listError ? (
            <div className="p-10 text-center text-slate-400"><Loader2 className="animate-spin inline mr-2" size={18} /> Cargando...</div>
          ) : visibleItems.length === 0 && !listError ? (
            <div className="p-10 text-center text-slate-400">
              <CheckCircle size={36} className="mx-auto mb-2 opacity-30 text-emerald-500" />
              {filter === 'today' ? 'Nada vencido ni por vencer. ¡Al día!' : 'Sin cuentas por cobrar.'}
            </div>
          ) : visibleItems.map(it => {
            const u = urgencyLabel(it);
            return (
              <button
                type="button"
                key={it.saleId}
                onClick={() => openDetail(it)}
                aria-label={`Abrir estado de cuenta de ${it.customerName}`}
                className={`w-full text-left p-4 border-b border-white/[0.04] hover:bg-surface-800/40 transition-colors flex justify-between items-center
                  ${selected?.saleId === it.saleId ? 'bg-nortex-500/10 border-l-4 border-l-nortex-400' : 'border-l-4 border-l-transparent'}`}
              >
                <div className="min-w-0">
                  <h4 className="font-bold text-slate-100 truncate">{it.customerName}</h4>
                  <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
                    <Calendar size={12} /> Vence: {fmtDate(it.dueDate)}
                  </div>
                  <span className={`inline-block mt-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${u.cls}`}>{u.text}</span>
                </div>
                <div className="text-right shrink-0 ml-2">
                  <div className="font-mono font-bold text-red-400">{fmt(it.balance)}</div>
                  <div className="text-[11px] text-slate-400">de {fmt(it.total)}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* RIGHT: Detail / Statement */}
      <div
        ref={(element) => { detailReturnFocusRef.current = element; }}
        tabIndex={-1}
        role="region"
        aria-label="Detalle de cobranza"
        className={`${mobileDetailOpen ? 'flex' : 'hidden xl:flex'} relative min-h-0 min-w-0 flex-col overflow-hidden bg-surface-950 focus:outline-none`}
      >
        {!selected ? (
          <div className="flex h-full items-center justify-center p-6 text-slate-400">
            <div className="max-w-md rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.02] p-8 text-center">
              <User size={42} className="mx-auto text-nortex-400/70" />
              <h2 className="mt-4 text-2xl font-black text-slate-100">Elegí una cuenta</h2>
              <p className="mt-2 text-sm">Vas a ver el saldo, las facturas y las acciones de cobro sin perder la bandeja.</p>
            </div>
          </div>
        ) : (
          <div className="h-full overflow-y-auto p-4 sm:p-5 xl:p-6" id="statement-print">
            <button type="button" onClick={() => setMobileDetailOpen(false)} className="mb-4 inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm font-bold text-slate-200 xl:hidden">
              <ArrowLeft size={16} /> Volver a cobranza
            </button>
            {/* Header */}
            <div className="mb-5 rounded-card border border-white/[0.06] bg-surface-900/90 p-5 shadow-2xl shadow-black/10">
              <div className="flex flex-col gap-5 2xl:flex-row 2xl:items-start 2xl:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="truncate text-2xl font-black text-slate-100 sm:text-3xl">{statement?.customer.name || selected.customerName}</h1>
                  {statement?.customer.isBlocked && (
                      <span className="rounded-full border border-red-500/20 bg-red-500/15 px-2.5 py-1 text-[11px] font-black text-red-300">CRÉDITO BLOQUEADO</span>
                  )}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-400">
                    <span>{statement?.customer.phone || selected.phone || 'Sin teléfono'}</span>
                    <span>Estado generado {statement ? formatReceivableDateTime(statement.generatedAt) : 'al abrir'}</span>
                  </div>
                </div>
                <div className="no-print grid w-full gap-2 sm:grid-cols-2 2xl:w-auto 2xl:min-w-[390px]">
                  <button onClick={() => notifyWhatsapp(statement?.customer.name || selected.customerName, statement?.customer.phone || selected.phone, statement?.totals.balance ?? selected.balance)}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-500/15 px-4 py-3 text-sm font-bold text-emerald-200 hover:bg-emerald-500/20">
                    <MessageCircle size={16} /> Recordar por WhatsApp
                  </button>
                  {statement && (
                    <button onClick={printStatement} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm font-bold text-slate-100 hover:bg-white/[0.07]">
                      <Printer size={16} /> Imprimir estado
                    </button>
                  )}
                </div>
              </div>

              {statement && (
                <div className="mt-5 grid grid-cols-2 gap-3 border-t border-white/[0.04] pt-5 2xl:grid-cols-4">
                  <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4"><label className="text-[10px] font-mono text-slate-500 block">FACTURADO</label><span className="mt-2 block text-xl font-black text-slate-100">{fmt(statement.totals.billed)}</span></div>
                  <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/[0.05] p-4"><label className="text-[10px] font-mono text-slate-500 block">ABONADO</label><span className="mt-2 block text-xl font-black text-emerald-300">{fmt(statement.totals.paid)}</span></div>
                  <div className="rounded-2xl border border-amber-500/15 bg-amber-500/[0.05] p-4"><label className="text-[10px] font-mono text-slate-500 block">SALDO</label><span className="mt-2 block text-xl font-black text-amber-300">{fmt(statement.totals.balance)}</span></div>
                  <div className="rounded-2xl border border-red-500/15 bg-red-500/[0.05] p-4"><label className="text-[10px] font-mono text-slate-500 block">VENCIDO</label><span className="mt-2 block text-xl font-black text-red-300">{fmt(statement.totals.overdue)}</span></div>
                </div>
              )}
            </div>

            {/* Estado de cuenta (facturas + abonos) */}
            {statementLoading ? (
              <div className="p-10 text-center text-slate-400"><Loader2 className="animate-spin inline mr-2" size={18} /> Cargando estado de cuenta...</div>
            ) : detailError ? (
              <div role="alert" className="rounded-card border border-red-500/20 bg-red-500/10 p-6 text-center">
                <AlertCircle className="mx-auto text-red-300" size={30} />
                <h2 className="mt-3 text-xl font-black text-slate-100">No pudimos abrir el estado de cuenta</h2>
                <p className="mx-auto mt-2 max-w-lg text-sm text-red-100/80">{detailError}</p>
                {selected.customerId && (
                  <button type="button" onClick={() => void loadStatementByCustomerId(selected.customerId!, selected)} className="mt-4 rounded-2xl bg-red-500/15 px-4 py-3 text-sm font-bold text-red-100 hover:bg-red-500/20">
                    Reintentar detalle
                  </button>
                )}
              </div>
            ) : statement ? (
              <div className="grid items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_300px]">
                <section className="min-w-0 rounded-card border border-white/[0.06] bg-surface-900/90 p-4 sm:p-5" aria-labelledby="statement-title">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 id="statement-title" className="flex items-center gap-2 text-xl font-black text-slate-100"><FileText size={18} className="text-nortex-300" /> Estado de cuenta</h2>
                      <p className="mt-1 text-sm text-slate-400">Facturas abiertas, vencidas y pagos aplicados.</p>
                    </div>
                    <span className="rounded-full bg-white/[0.04] px-3 py-1 text-xs font-bold text-slate-300">{statement.invoices.length} facturas</span>
                  </div>

                  <div className="mt-4 space-y-3">
                    {statement.invoices.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] p-6 text-center text-sm text-slate-400">Este cliente no tiene facturas a crédito.</div>
                    ) : statement.invoices.map((inv) => {
                      const invoiceLabel = inv.invoiceNumber || inv.id.slice(0, 8);
                      return (
                        <article key={inv.id} className="overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.025]">
                          <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <h3 className="font-black text-slate-100">Factura {invoiceLabel}</h3>
                              <div className="mt-1 text-xs text-slate-500">Emitida {fmtDate(inv.date)} · vence {fmtDate(inv.dueDate)}</div>
                              <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${inv.status === 'PAID' ? 'bg-emerald-500/15 text-emerald-300' : inv.status === 'WRITTEN_OFF' ? 'bg-white/[0.06] text-slate-300' : inv.status === 'OVERDUE' ? 'bg-red-500/15 text-red-300' : 'bg-amber-500/15 text-amber-300'}`}>
                                {inv.status === 'PAID' ? 'Pagada' : inv.status === 'WRITTEN_OFF' ? 'Incobrable' : inv.status === 'OVERDUE' ? `Vencida ${inv.daysOverdue}d` : 'Pendiente'}
                              </span>
                            </div>
                            <div className="sm:text-right">
                              <div className="text-xs text-slate-500">Saldo pendiente</div>
                              <div className="mt-1 font-mono text-xl font-black text-red-300">{fmt(inv.balance)}</div>
                              <div className="mt-0.5 text-[11px] text-slate-500">de {fmt(inv.total)}</div>
                              {inv.balance > 0 && (
                                <div className="no-print mt-3 flex flex-wrap gap-2 sm:justify-end">
                                  <button type="button" onClick={(event) => openPay({ id: inv.id, customerName: statement.customer.name, balance: inv.balance }, event.currentTarget)} aria-label={`Abonar factura ${invoiceLabel}`} className="rounded-xl bg-nortex-900 px-3 py-2 text-xs font-black text-white hover:bg-nortex-800">
                                    Abonar
                                  </button>
                                  {canWriteOff && (
                                    <button type="button" onClick={(event) => openWriteoff(inv.id, statement.customer.name, inv.balance, event.currentTarget)} aria-label={`Marcar factura ${invoiceLabel} como incobrable`} className="rounded-xl border border-red-500/15 bg-red-500/[0.06] px-3 py-2 text-xs font-bold text-red-300 hover:bg-red-500/10">
                                      Incobrable
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                          {inv.payments.length > 0 && (
                            <div className="space-y-1.5 border-t border-white/[0.04] bg-black/10 px-4 py-3">
                              {inv.payments.map((payment) => (
                                <div key={payment.id} className="flex flex-wrap justify-between gap-2 text-xs text-slate-300">
                                  <span>{formatReceivableDateTime(payment.date)} · {paymentMethodLabel(payment.method)}{payment.collectedBy ? ` · ${payment.collectedBy}` : ''}</span>
                                  <span className="font-mono font-bold text-emerald-300">+{fmt(payment.amount)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                </section>

                <aside className="space-y-4">
                  <section className="rounded-card border border-white/[0.06] bg-surface-900/90 p-5" aria-labelledby="portfolio-state-title">
                    <h2 id="portfolio-state-title" className="flex items-center gap-2 font-black text-slate-100"><ShieldAlert className={statement.totals.overdue > 0 ? 'text-red-300' : 'text-emerald-300'} size={18} /> Estado de cartera</h2>
                    <div className="mt-4 space-y-4">
                      <div>
                        <div className="flex justify-between text-xs text-slate-400"><span>Uso del límite</span><span>{Math.round(creditUsage)}%</span></div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/[0.06]"><div className={`h-full rounded-full ${creditUsage > 90 ? 'bg-red-400' : creditUsage > 60 ? 'bg-amber-400' : 'bg-emerald-400'}`} style={{ width: `${creditUsage}%` }} /></div>
                      </div>
                      <div className="flex items-center justify-between border-t border-white/[0.05] pt-3 text-sm"><span className="text-slate-400">Límite</span><span className="font-bold text-slate-100">{fmt(statement.customer.creditLimit)}</span></div>
                      <div className="flex items-center justify-between text-sm"><span className="text-slate-400">Facturas abiertas</span><span className="font-bold text-slate-100">{openInvoices.length}</span></div>
                      <div className="flex items-center justify-between gap-3 text-sm"><span className="text-slate-400">Acción sugerida</span><span className={`text-right font-bold ${statement.totals.overdue > 0 ? 'text-red-300' : 'text-emerald-300'}`}>{statement.totals.overdue > 0 ? 'Contactar hoy' : 'Dar seguimiento'}</span></div>
                    </div>
                  </section>

                  <section className="rounded-card border border-white/[0.06] bg-surface-900/90 p-5" aria-labelledby="recent-activity-title">
                    <h2 id="recent-activity-title" className="flex items-center gap-2 font-black text-slate-100"><Clock3 size={18} className="text-nortex-300" /> Actividad reciente</h2>
                    <div className="mt-4 space-y-3">
                      {recentPayments.length === 0 ? (
                        <p className="rounded-2xl border border-dashed border-white/[0.08] p-4 text-sm text-slate-500">Todavía no hay abonos registrados.</p>
                      ) : recentPayments.map((payment) => (
                        <div key={payment.id} className="border-l-2 border-emerald-500/30 pl-3">
                          <div className="flex items-center justify-between gap-2 text-sm"><span className="font-bold text-slate-200">Abono {fmt(payment.amount)}</span><span className="text-xs text-slate-500">{formatReceivableDateTime(payment.date)}</span></div>
                          <p className="mt-1 text-xs text-slate-500">Factura {payment.invoiceLabel} · {paymentMethodLabel(payment.method)}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                </aside>
              </div>
            ) : (
              // Walk-in sin ficha de cliente → solo la venta seleccionada
              <div className="rounded-card border border-amber-500/15 bg-amber-500/[0.05] p-5">
                <div className="mb-4 flex items-start gap-2 text-sm text-amber-100/80">
                  <AlertTriangle size={16} className="mt-0.5 text-amber-300" /> Cliente sin ficha registrada; se muestra solo esta venta.
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-white/[0.06] bg-black/10 p-4"><label className="text-xs font-mono text-slate-400 block mb-1">TOTAL</label><span className="text-xl font-bold text-slate-100">{fmt(selected.total)}</span></div>
                  <div className="rounded-2xl border border-red-500/15 bg-red-500/[0.05] p-4"><label className="text-xs font-mono text-slate-400 block mb-1">SALDO</label><span className="text-xl font-bold text-red-300">{fmt(selected.balance)}</span></div>
                  <button type="button" onClick={(event) => openPay({ id: selected.saleId, customerName: selected.customerName, balance: selected.balance }, event.currentTarget)}
                    className="flex min-h-20 items-center justify-center gap-2 rounded-2xl bg-nortex-900 font-bold text-white hover:bg-nortex-800">
                    <DollarSign size={18} /> Registrar abono
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* PAYMENT MODAL */}
        {showPayModal && paySale && (
          <div className="fixed inset-0 z-modal flex items-end justify-center bg-slate-950/80 p-0 backdrop-blur-sm sm:items-center sm:p-4 no-print" onMouseDown={(event) => { if (event.target === event.currentTarget) closePaymentModal(); }}>
            <div ref={paymentDialogRef} role="dialog" aria-modal="true" aria-labelledby="receivable-payment-title" aria-describedby="receivable-payment-description" aria-busy={submitting} tabIndex={-1} className="max-h-[calc(100dvh-1rem)] w-full max-w-md overflow-y-auto rounded-t-card border border-white/[0.08] bg-surface-900 text-slate-100 shadow-2xl sm:rounded-card">
              <div className="flex items-start justify-between gap-4 border-b border-white/[0.06] px-6 py-5">
                <div>
                  <h2 id="receivable-payment-title" className="text-xl font-black">Registrar abono</h2>
                  <p id="receivable-payment-description" className="mt-1 text-sm text-slate-400">{paySale.customerName} · saldo {fmt(paySale.balance)}</p>
                </div>
                <button type="button" onClick={closePaymentModal} disabled={submitting} className="rounded-full p-2 text-slate-400 hover:bg-white/[0.04] hover:text-white disabled:opacity-50" aria-label="Cerrar registro de abono">
                  <X size={18} />
                </button>
              </div>
              <form onSubmit={handleRegisterPayment} className="p-6" noValidate>
                <div className="mb-4">
                  <label htmlFor="receivable-payment-amount" className="block text-sm font-bold mb-2 text-slate-400">Monto a cobrar (C$)</label>
                  <input id="receivable-payment-amount" type="number" inputMode="decimal" min="0.01" max={paySale.balance} step="0.01" data-dialog-initial-focus="receivable-payment" value={paymentAmount} onChange={e => { setPaymentAmount(e.target.value); setPaymentError(''); }}
                    aria-invalid={Boolean(paymentError)} aria-describedby={paymentError ? 'receivable-payment-error' : 'receivable-payment-help'}
                    className={`w-full rounded-2xl border bg-white/[0.03] px-4 py-3 text-2xl font-black tabular-nums text-slate-100 outline-none focus:border-nortex-500 ${paymentError ? 'border-red-500/70' : 'border-white/[0.08]'}`}
                    placeholder="0.00" />
                  <p id="receivable-payment-help" className="mt-1.5 text-xs text-slate-500">Máximo disponible: {fmt(paySale.balance)}</p>
                </div>
                <div className="mb-6">
                  <label htmlFor="receivable-payment-method" className="block text-sm font-bold mb-2 text-slate-400">Método</label>
                  <select id="receivable-payment-method" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}
                    className="w-full rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-slate-100 outline-none focus:border-nortex-500">
                    <option value="CASH">Efectivo</option>
                    <option value="TRANSFER">Transferencia</option>
                    <option value="CARD">Tarjeta</option>
                  </select>
                </div>
                {paymentError && (
                  <div id="receivable-payment-error" role="alert" className="mb-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                    {paymentError}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <button type="button" onClick={closePaymentModal} disabled={submitting} className="rounded-2xl border border-white/[0.08] px-4 py-3 font-bold text-slate-300 hover:bg-white/[0.05] disabled:opacity-50">Cancelar</button>
                  <button type="submit" disabled={submitting} className="flex items-center justify-center gap-2 rounded-2xl bg-nortex-900 px-4 py-3 font-black text-white hover:bg-nortex-800 disabled:cursor-wait disabled:opacity-60">
                    {submitting ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle size={18} />} {submitting ? 'Registrando...' : 'Confirmar abono'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {receiptToConfirm && (
          <div className="fixed inset-0 z-modal flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm no-print" onMouseDown={(event) => { if (event.target === event.currentTarget) closeReceiptModal(); }}>
            <div ref={receiptDialogRef} role="dialog" aria-modal="true" aria-labelledby="payment-receipt-title" aria-describedby="payment-receipt-description" tabIndex={-1} className="w-full max-w-md rounded-card border border-white/[0.08] bg-surface-900 shadow-2xl">
              <div className="p-6 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-300"><ReceiptText size={24} /></div>
                <h2 id="payment-receipt-title" className="mt-4 text-xl font-black text-slate-100">Abono registrado</h2>
                <p id="payment-receipt-description" className="mt-2 text-sm text-slate-400">El nuevo saldo de {receiptToConfirm.customer} es {fmt(receiptToConfirm.newBalance)}. ¿Querés imprimir el recibo?</p>
                <div className="mt-5 rounded-2xl border border-emerald-500/15 bg-emerald-500/[0.06] p-4 text-2xl font-black text-emerald-300">{fmt(receiptToConfirm.amount)}</div>
              </div>
              <div className="grid grid-cols-2 gap-3 border-t border-white/[0.06] p-5">
                <button type="button" data-dialog-initial-focus="receivable-receipt" onClick={closeReceiptModal} className="rounded-2xl border border-white/[0.08] px-4 py-3 font-bold text-slate-300 hover:bg-white/[0.05]">Ahora no</button>
                <button type="button" onClick={() => { if (printReceipt(receiptToConfirm)) closeReceiptModal(); }} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-nortex-900 px-4 py-3 font-black text-white hover:bg-nortex-800"><Printer size={18} /> Imprimir recibo</button>
              </div>
            </div>
          </div>
        )}

        {writeoffDraft && (
          <div className="fixed inset-0 z-modal flex items-end justify-center bg-slate-950/85 p-0 backdrop-blur-sm sm:items-center sm:p-4 no-print" onMouseDown={(event) => { if (event.target === event.currentTarget) closeWriteoffModal(); }}>
            <div ref={writeoffDialogRef} role="dialog" aria-modal="true" aria-labelledby="writeoff-title" aria-describedby="writeoff-description" aria-busy={writeoffSubmitting} tabIndex={-1} className="max-h-[calc(100dvh-1rem)] w-full max-w-lg overflow-y-auto rounded-t-card border border-red-500/20 bg-surface-900 text-slate-100 shadow-2xl sm:rounded-card">
              <div className="flex items-start justify-between gap-4 border-b border-white/[0.06] px-6 py-5">
                <div className="flex items-start gap-3">
                  <div className="rounded-2xl bg-red-500/15 p-2.5 text-red-300"><ShieldAlert size={21} /></div>
                  <div>
                    <h2 id="writeoff-title" className="text-xl font-black">Marcar como incobrable</h2>
                    <p className="mt-1 text-sm text-slate-400">{writeoffDraft.customerName} · saldo {fmt(writeoffDraft.balance)}</p>
                  </div>
                </div>
                <button type="button" onClick={closeWriteoffModal} disabled={writeoffSubmitting} aria-label="Cerrar castigo de cuenta" className="rounded-full p-2 text-slate-400 hover:bg-white/[0.04] hover:text-white disabled:opacity-50"><X size={18} /></button>
              </div>
              <form onSubmit={handleWriteoff} className="space-y-4 px-6 py-5" noValidate>
                <div id="writeoff-description" className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm leading-6 text-red-100/90">
                  Esta acción reconoce la pérdida contablemente y deja la factura fuera de cobranza. No se puede deshacer desde este módulo.
                </div>
                <div>
                  <label htmlFor="writeoff-reason" className="mb-2 block text-sm font-bold text-slate-300">
                    Justificación
                  </label>
                  <textarea
                    id="writeoff-reason"
                    rows={4}
                    maxLength={500}
                    data-dialog-initial-focus="receivable-writeoff"
                    value={writeoffDraft.reason}
                    onChange={(event) => { setWriteoffDraft((previous) => previous ? { ...previous, reason: event.target.value } : previous); setWriteoffError(''); }}
                    aria-invalid={Boolean(writeoffError)}
                    aria-describedby={writeoffError ? 'writeoff-error' : 'writeoff-description'}
                    placeholder="Ej.: cliente cerró operaciones y se agotaron las gestiones de cobro."
                    className={`w-full resize-y rounded-2xl border bg-white/[0.03] p-3 text-sm text-slate-100 outline-none focus:border-nortex-500 ${writeoffError ? 'border-red-500/70' : 'border-white/[0.08]'}`}
                  />
                  {writeoffError && <p id="writeoff-error" role="alert" className="mt-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">{writeoffError}</p>}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    disabled={writeoffSubmitting}
                    onClick={closeWriteoffModal}
                    className="rounded-2xl border border-white/[0.08] px-4 py-3 text-sm font-bold text-slate-200 hover:bg-white/[0.04] disabled:opacity-60"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={writeoffSubmitting}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-red-700 px-4 py-3 text-sm font-black text-white hover:bg-red-600 disabled:cursor-wait disabled:opacity-60"
                  >
                    {writeoffSubmitting ? <Loader2 size={18} className="animate-spin" /> : <ShieldAlert size={18} />} {writeoffSubmitting ? 'Registrando...' : 'Confirmar castigo'}
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
