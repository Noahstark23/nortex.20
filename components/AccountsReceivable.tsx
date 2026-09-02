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
  if (it.daysOverdue > 0) return { text: `Vencido ${it.daysOverdue}d`, cls: 'border-red-200 bg-red-50 text-red-700' };
  if (it.daysOverdue === 0) return { text: 'Vence hoy', cls: 'border-amber-200 bg-amber-50 text-amber-800' };
  if (it.status === 'DUE_SOON') return { text: `Vence en ${-it.daysOverdue}d`, cls: 'border-amber-200 bg-amber-50 text-amber-800' };
  return { text: 'Al día', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' };
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
    <div className="nx-light-context nx-workspace grid h-full overflow-hidden bg-slate-50 text-slate-950 xl:grid-cols-[minmax(330px,410px)_minmax(0,1fr)]">
      <ToastViewport toast={toast} onDismiss={dismissToast} />

      {/* LEFT: Worklist */}
      <div className={`${mobileDetailOpen ? 'hidden xl:flex' : 'flex'} min-h-0 flex-col border-r border-slate-200 bg-white`}>
        <div className="border-b border-slate-200 bg-white p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="nx-label mb-1 text-slate-500">Finanzas</p>
              <h1 className="nx-module-header flex items-center gap-2 text-xl font-bold text-slate-950">
                <Wallet className="text-brand" size={22} /> Cobranza
              </h1>
              <p className="mt-1 text-sm text-slate-600">Priorizá vencidos y dejá cada cuenta lista.</p>
            </div>
            <button type="button" onClick={() => void fetchWorklist()} disabled={loading} className="nx-fluid-press flex h-touch w-touch items-center justify-center rounded-control border border-slate-300 bg-white text-slate-600 shadow-sm hover:bg-slate-100 hover:text-slate-950 disabled:cursor-wait disabled:opacity-60" aria-label="Actualizar bandeja de cobranza">
              <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>

          {/* KPIs */}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="nx-canvas-card p-3">
              <span className="nx-label block text-slate-500">POR COBRAR</span>
              <span className="nx-num text-lg font-semibold text-slate-950">{fmt(summary?.totalReceivable || 0)}</span>
            </div>
            <div className="nx-canvas-card border-red-200 bg-red-50/70 p-3">
              <span className="nx-label block text-slate-500">VENCIDO {summary?.overdueCount ? `(${summary.overdueCount})` : ''}</span>
              <span className="nx-num text-lg font-semibold text-red-700">{fmt(summary?.totalOverdue || 0)}</span>
            </div>
            <div className="nx-canvas-card border-amber-200 bg-amber-50/70 p-3">
              <span className="nx-label block text-slate-500">POR VENCER {summary?.dueSoonCount ? `(${summary.dueSoonCount})` : ''}</span>
              <span className="nx-num text-lg font-semibold text-amber-800">{fmt(summary?.dueSoon || 0)}</span>
            </div>
            <div className="nx-canvas-card border-emerald-200 bg-emerald-50/70 p-3">
              <span className="nx-label block text-slate-500">RECAUDADO HOY</span>
              <span className="nx-num text-lg font-semibold text-emerald-700">{fmt(summary?.collectedToday || 0)}</span>
            </div>
          </div>

          {/* Filter */}
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={() => setFilter('today')} aria-pressed={filter === 'today'} className={`nx-fluid-press h-touch rounded-control px-3 text-sm font-semibold transition-colors ${filter === 'today' ? 'bg-brand text-brand-on shadow-sm' : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'}`}>
              Cobrar hoy {summary ? `(${summary.overdueCount + summary.dueSoonCount})` : ''}
            </button>
            <button type="button" onClick={() => setFilter('all')} aria-pressed={filter === 'all'} className={`nx-fluid-press h-touch rounded-control px-3 text-sm font-semibold transition-colors ${filter === 'all' ? 'bg-brand text-brand-on shadow-sm' : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'}`}>
              Todas ({items.length})
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {listError && (
            <div role="alert" className="m-4 rounded-card border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 shrink-0 text-red-600" size={17} />
                <div>
                  <p className="font-bold">No pudimos actualizar la bandeja</p>
                  <p className="mt-1 text-red-700">{listError}</p>
                  <button type="button" onClick={() => void fetchWorklist()} className="nx-fluid-press mt-3 h-touch rounded-control border border-red-300 bg-white px-3 font-semibold text-red-700 hover:bg-red-100">Reintentar</button>
                </div>
              </div>
            </div>
          )}
          {loading && items.length === 0 && !listError ? (
            <div className="p-10 text-center text-slate-500"><Loader2 className="mr-2 inline animate-spin" size={18} /> Cargando...</div>
          ) : visibleItems.length === 0 && !listError ? (
            <div className="p-10 text-center text-slate-500">
              <CheckCircle size={36} className="mx-auto mb-2 text-emerald-600" />
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
                className={`nx-fluid-press flex w-full items-center justify-between border-b border-slate-100 p-4 text-left transition-colors hover:bg-slate-50
                  ${selected?.saleId === it.saleId ? 'border-l-4 border-l-brand bg-brand-soft' : 'border-l-4 border-l-transparent'}`}
              >
                <div className="min-w-0">
                  <h4 className="truncate font-semibold text-slate-950">{it.customerName}</h4>
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                    <Calendar size={12} /> Vence: {fmtDate(it.dueDate)}
                  </div>
                  <span className={`mt-1.5 inline-block rounded-pill border px-2 py-0.5 text-[11px] font-semibold ${u.cls}`}>{u.text}</span>
                </div>
                <div className="ml-2 shrink-0 text-right">
                  <div className="nx-num font-semibold text-red-700">{fmt(it.balance)}</div>
                  <div className="text-[11px] text-slate-500">de {fmt(it.total)}</div>
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
        className={`${mobileDetailOpen ? 'flex' : 'hidden xl:flex'} nx-workspace relative min-h-0 min-w-0 flex-col overflow-hidden bg-slate-50 focus:outline-none`}
      >
        {!selected ? (
          <div className="flex h-full items-center justify-center p-6 text-slate-600">
            <div className="nx-canvas-card max-w-md border-dashed p-8 text-center">
              <User size={42} className="mx-auto text-slate-400" />
              <h2 className="nx-module-header mt-4 text-2xl font-bold text-slate-950">Elegí una cuenta</h2>
              <p className="mt-2 text-sm">Vas a ver el saldo, las facturas y las acciones de cobro sin perder la bandeja.</p>
            </div>
          </div>
        ) : (
          <div className="h-full overflow-y-auto p-4 sm:p-5 xl:p-6" id="statement-print">
            <button type="button" onClick={() => setMobileDetailOpen(false)} className="nx-fluid-press mb-4 inline-flex h-touch items-center gap-2 rounded-control border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-100 xl:hidden">
              <ArrowLeft size={16} /> Volver a cobranza
            </button>
            {/* Header */}
            <div className="nx-canvas-card mb-5 p-5">
              <div className="flex flex-col gap-5 2xl:flex-row 2xl:items-start 2xl:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="nx-module-header truncate text-2xl font-bold text-slate-950 sm:text-3xl">{statement?.customer.name || selected.customerName}</h1>
                  {statement?.customer.isBlocked && (
                      <span className="rounded-pill border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-bold text-red-700">CRÉDITO BLOQUEADO</span>
                  )}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-600">
                    <span>{statement?.customer.phone || selected.phone || 'Sin teléfono'}</span>
                    <span>Estado generado {statement ? formatReceivableDateTime(statement.generatedAt) : 'al abrir'}</span>
                  </div>
                </div>
                <div className="no-print grid w-full gap-2 sm:grid-cols-2 2xl:w-auto 2xl:min-w-[390px]">
                  <button onClick={() => notifyWhatsapp(statement?.customer.name || selected.customerName, statement?.customer.phone || selected.phone, statement?.totals.balance ?? selected.balance)}
                    className="nx-fluid-press inline-flex h-touch items-center justify-center gap-2 rounded-control bg-brand px-4 text-sm font-semibold text-brand-on shadow-sm hover:bg-brand-hover">
                    <MessageCircle size={16} /> Recordar por WhatsApp
                  </button>
                  {statement && (
                    <button onClick={printStatement} className="nx-fluid-press inline-flex h-touch items-center justify-center gap-2 rounded-control border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-100">
                      <Printer size={16} /> Imprimir estado
                    </button>
                  )}
                </div>
              </div>

              {statement && (
                <div className="mt-5 grid grid-cols-2 gap-3 border-t border-slate-200 pt-5 2xl:grid-cols-4">
                  <div className="rounded-card border border-slate-200 bg-white p-4"><label className="nx-label block text-slate-500">FACTURADO</label><span className="nx-num mt-2 block text-xl font-semibold text-slate-950">{fmt(statement.totals.billed)}</span></div>
                  <div className="rounded-card border border-emerald-200 bg-emerald-50/70 p-4"><label className="nx-label block text-slate-500">ABONADO</label><span className="nx-num mt-2 block text-xl font-semibold text-emerald-700">{fmt(statement.totals.paid)}</span></div>
                  <div className="rounded-card border border-amber-200 bg-amber-50/70 p-4"><label className="nx-label block text-slate-500">SALDO</label><span className="nx-num mt-2 block text-xl font-semibold text-amber-800">{fmt(statement.totals.balance)}</span></div>
                  <div className="rounded-card border border-red-200 bg-red-50/70 p-4"><label className="nx-label block text-slate-500">VENCIDO</label><span className="nx-num mt-2 block text-xl font-semibold text-red-700">{fmt(statement.totals.overdue)}</span></div>
                </div>
              )}
            </div>

            {/* Estado de cuenta (facturas + abonos) */}
            {statementLoading ? (
              <div className="p-10 text-center text-slate-500"><Loader2 className="mr-2 inline animate-spin" size={18} /> Cargando estado de cuenta...</div>
            ) : detailError ? (
              <div role="alert" className="nx-canvas-card border-red-200 bg-red-50 p-6 text-center">
                <AlertCircle className="mx-auto text-red-600" size={30} />
                <h2 className="mt-3 text-xl font-bold text-slate-950">No pudimos abrir el estado de cuenta</h2>
                <p className="mx-auto mt-2 max-w-lg text-sm text-red-700">{detailError}</p>
                {selected.customerId && (
                  <button type="button" onClick={() => void loadStatementByCustomerId(selected.customerId!, selected)} className="nx-fluid-press mt-4 h-touch rounded-control border border-red-300 bg-white px-4 text-sm font-semibold text-red-700 hover:bg-red-100">
                    Reintentar detalle
                  </button>
                )}
              </div>
            ) : statement ? (
              <div className="grid items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_300px]">
                <section className="nx-canvas-card min-w-0 p-4 sm:p-5" aria-labelledby="statement-title">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 id="statement-title" className="flex items-center gap-2 text-xl font-bold text-slate-950"><FileText size={18} className="text-slate-500" /> Estado de cuenta</h2>
                      <p className="mt-1 text-sm text-slate-600">Facturas abiertas, vencidas y pagos aplicados.</p>
                    </div>
                    <span className="rounded-pill border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">{statement.invoices.length} facturas</span>
                  </div>

                  <div className="mt-4 space-y-3">
                    {statement.invoices.length === 0 ? (
                      <div className="rounded-card border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">Este cliente no tiene facturas a crédito.</div>
                    ) : statement.invoices.map((inv) => {
                      const invoiceLabel = inv.invoiceNumber || inv.id.slice(0, 8);
                      return (
                        <article key={inv.id} className="overflow-hidden rounded-card border border-slate-200 bg-white">
                          <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <h3 className="font-semibold text-slate-950">Factura {invoiceLabel}</h3>
                              <div className="mt-1 text-xs text-slate-500">Emitida {fmtDate(inv.date)} · vence {fmtDate(inv.dueDate)}</div>
                              <span className={`mt-2 inline-flex rounded-pill border px-2.5 py-1 text-[11px] font-semibold ${inv.status === 'PAID' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : inv.status === 'WRITTEN_OFF' ? 'border-slate-200 bg-slate-100 text-slate-600' : inv.status === 'OVERDUE' ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                                {inv.status === 'PAID' ? 'Pagada' : inv.status === 'WRITTEN_OFF' ? 'Incobrable' : inv.status === 'OVERDUE' ? `Vencida ${inv.daysOverdue}d` : 'Pendiente'}
                              </span>
                            </div>
                            <div className="sm:text-right">
                              <div className="text-xs text-slate-500">Saldo pendiente</div>
                              <div className="nx-num mt-1 text-xl font-semibold text-red-700">{fmt(inv.balance)}</div>
                              <div className="mt-0.5 text-[11px] text-slate-500">de {fmt(inv.total)}</div>
                              {inv.balance > 0 && (
                                <div className="no-print mt-3 flex flex-wrap gap-2 sm:justify-end">
                                  <button type="button" onClick={(event) => openPay({ id: inv.id, customerName: statement.customer.name, balance: inv.balance }, event.currentTarget)} aria-label={`Abonar factura ${invoiceLabel}`} className="nx-fluid-press h-touch rounded-control bg-brand px-3 text-xs font-semibold text-brand-on hover:bg-brand-hover">
                                    Abonar
                                  </button>
                                  {canWriteOff && (
                                    <button type="button" onClick={(event) => openWriteoff(inv.id, statement.customer.name, inv.balance, event.currentTarget)} aria-label={`Marcar factura ${invoiceLabel} como incobrable`} className="nx-fluid-press h-touch rounded-control border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-700 hover:bg-red-100">
                                      Incobrable
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                          {inv.payments.length > 0 && (
                            <div className="space-y-1.5 border-t border-slate-200 bg-slate-50 px-4 py-3">
                              {inv.payments.map((payment) => (
                                <div key={payment.id} className="flex flex-wrap justify-between gap-2 text-xs text-slate-600">
                                  <span>{formatReceivableDateTime(payment.date)} · {paymentMethodLabel(payment.method)}{payment.collectedBy ? ` · ${payment.collectedBy}` : ''}</span>
                                  <span className="nx-num font-semibold text-emerald-700">+{fmt(payment.amount)}</span>
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
                  <section className="nx-canvas-card p-5" aria-labelledby="portfolio-state-title">
                    <h2 id="portfolio-state-title" className="flex items-center gap-2 font-semibold text-slate-950"><ShieldAlert className={statement.totals.overdue > 0 ? 'text-red-600' : 'text-emerald-600'} size={18} /> Estado de cartera</h2>
                    <div className="mt-4 space-y-4">
                      <div>
                        <div className="flex justify-between text-xs text-slate-600"><span>Uso del límite</span><span>{Math.round(creditUsage)}%</span></div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200"><div className={`h-full rounded-full ${creditUsage > 90 ? 'bg-red-600' : creditUsage > 60 ? 'bg-amber-500' : 'bg-emerald-600'}`} style={{ width: `${creditUsage}%` }} /></div>
                      </div>
                      <div className="flex items-center justify-between border-t border-slate-200 pt-3 text-sm"><span className="text-slate-600">Límite</span><span className="nx-num font-semibold text-slate-950">{fmt(statement.customer.creditLimit)}</span></div>
                      <div className="flex items-center justify-between text-sm"><span className="text-slate-600">Facturas abiertas</span><span className="font-semibold text-slate-950">{openInvoices.length}</span></div>
                      <div className="flex items-center justify-between gap-3 text-sm"><span className="text-slate-600">Acción sugerida</span><span className={`text-right font-semibold ${statement.totals.overdue > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{statement.totals.overdue > 0 ? 'Contactar hoy' : 'Dar seguimiento'}</span></div>
                    </div>
                  </section>

                  <section className="nx-canvas-card p-5" aria-labelledby="recent-activity-title">
                    <h2 id="recent-activity-title" className="flex items-center gap-2 font-semibold text-slate-950"><Clock3 size={18} className="text-slate-500" /> Actividad reciente</h2>
                    <div className="mt-4 space-y-3">
                      {recentPayments.length === 0 ? (
                        <p className="rounded-card border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">Todavía no hay abonos registrados.</p>
                      ) : recentPayments.map((payment) => (
                        <div key={payment.id} className="border-l-2 border-emerald-300 pl-3">
                          <div className="flex items-center justify-between gap-2 text-sm"><span className="font-semibold text-slate-800">Abono {fmt(payment.amount)}</span><span className="text-xs text-slate-500">{formatReceivableDateTime(payment.date)}</span></div>
                          <p className="mt-1 text-xs text-slate-500">Factura {payment.invoiceLabel} · {paymentMethodLabel(payment.method)}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                </aside>
              </div>
            ) : (
              // Walk-in sin ficha de cliente → solo la venta seleccionada
              <div className="nx-canvas-card border-amber-200 bg-amber-50 p-5">
                <div className="mb-4 flex items-start gap-2 text-sm text-amber-800">
                  <AlertTriangle size={16} className="mt-0.5 text-amber-600" /> Cliente sin ficha registrada; se muestra solo esta venta.
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-card border border-slate-200 bg-white p-4"><label className="nx-label mb-1 block text-slate-500">TOTAL</label><span className="nx-num text-xl font-semibold text-slate-950">{fmt(selected.total)}</span></div>
                  <div className="rounded-card border border-red-200 bg-red-50 p-4"><label className="nx-label mb-1 block text-slate-500">SALDO</label><span className="nx-num text-xl font-semibold text-red-700">{fmt(selected.balance)}</span></div>
                  <button type="button" onClick={(event) => openPay({ id: selected.saleId, customerName: selected.customerName, balance: selected.balance }, event.currentTarget)}
                    className="nx-fluid-press flex min-h-20 items-center justify-center gap-2 rounded-control bg-brand font-semibold text-brand-on shadow-sm hover:bg-brand-hover">
                    <DollarSign size={18} /> Registrar abono
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* PAYMENT MODAL */}
        {showPayModal && paySale && (
          <div className="no-print fixed inset-0 z-modal flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) closePaymentModal(); }}>
            <div ref={paymentDialogRef} role="dialog" aria-modal="true" aria-labelledby="receivable-payment-title" aria-describedby="receivable-payment-description" aria-busy={submitting} tabIndex={-1} className="nx-light-context nx-canvas-card max-h-[calc(100dvh-1rem)] w-full max-w-md overflow-y-auto rounded-t-card text-slate-950 shadow-2xl sm:rounded-card">
              <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
                <div>
                  <h2 id="receivable-payment-title" className="text-xl font-bold text-slate-950">Registrar abono</h2>
                  <p id="receivable-payment-description" className="mt-1 text-sm text-slate-600">{paySale.customerName} · saldo {fmt(paySale.balance)}</p>
                </div>
                <button type="button" onClick={closePaymentModal} disabled={submitting} className="nx-fluid-press flex h-touch w-touch items-center justify-center rounded-control text-slate-500 hover:bg-slate-100 hover:text-slate-950 disabled:opacity-50" aria-label="Cerrar registro de abono">
                  <X size={18} />
                </button>
              </div>
              <form onSubmit={handleRegisterPayment} className="p-6" noValidate>
                <div className="mb-4">
                  <label htmlFor="receivable-payment-amount" className="mb-2 block text-sm font-semibold text-slate-700">Monto a cobrar (C$)</label>
                  <input id="receivable-payment-amount" type="number" inputMode="decimal" min="0.01" max={paySale.balance} step="0.01" data-dialog-initial-focus="receivable-payment" value={paymentAmount} onChange={e => { setPaymentAmount(e.target.value); setPaymentError(''); }}
                    aria-invalid={Boolean(paymentError)} aria-describedby={paymentError ? 'receivable-payment-error' : 'receivable-payment-help'}
                    className={`nx-num w-full rounded-control border bg-white px-4 py-3 text-2xl font-semibold text-slate-950 outline-none placeholder:text-slate-400 focus:border-brand focus:ring-2 focus:ring-brand-ring ${paymentError ? 'border-red-500' : 'border-slate-300'}`}
                    placeholder="0.00" />
                  <p id="receivable-payment-help" className="mt-1.5 text-xs text-slate-500">Máximo disponible: {fmt(paySale.balance)}</p>
                </div>
                <div className="mb-6">
                  <label htmlFor="receivable-payment-method" className="mb-2 block text-sm font-semibold text-slate-700">Método</label>
                  <select id="receivable-payment-method" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}
                    className="min-h-tap w-full rounded-control border border-slate-300 bg-white px-4 py-3 text-slate-950 outline-none focus:border-brand focus:ring-2 focus:ring-brand-ring">
                    <option value="CASH">Efectivo</option>
                    <option value="TRANSFER">Transferencia</option>
                    <option value="CARD">Tarjeta</option>
                  </select>
                </div>
                {paymentError && (
                  <div id="receivable-payment-error" role="alert" className="mb-4 rounded-card border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {paymentError}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <button type="button" onClick={closePaymentModal} disabled={submitting} className="nx-fluid-press h-touch rounded-control border border-slate-300 bg-white px-4 font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50">Cancelar</button>
                  <button type="submit" disabled={submitting} className="nx-fluid-press flex h-touch items-center justify-center gap-2 rounded-control bg-brand px-4 font-semibold text-brand-on hover:bg-brand-hover disabled:cursor-wait disabled:opacity-60">
                    {submitting ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle size={18} />} {submitting ? 'Registrando...' : 'Confirmar abono'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {receiptToConfirm && (
          <div className="no-print fixed inset-0 z-modal flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) closeReceiptModal(); }}>
            <div ref={receiptDialogRef} role="dialog" aria-modal="true" aria-labelledby="payment-receipt-title" aria-describedby="payment-receipt-description" tabIndex={-1} className="nx-light-context nx-canvas-card w-full max-w-md text-slate-950 shadow-2xl">
              <div className="p-6 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-control bg-emerald-100 text-emerald-700"><ReceiptText size={24} /></div>
                <h2 id="payment-receipt-title" className="mt-4 text-xl font-bold text-slate-950">Abono registrado</h2>
                <p id="payment-receipt-description" className="mt-2 text-sm text-slate-600">El nuevo saldo de {receiptToConfirm.customer} es {fmt(receiptToConfirm.newBalance)}. ¿Querés imprimir el recibo?</p>
                <div className="nx-num mt-5 rounded-card border border-emerald-200 bg-emerald-50 p-4 text-2xl font-semibold text-emerald-700">{fmt(receiptToConfirm.amount)}</div>
              </div>
              <div className="grid grid-cols-2 gap-3 border-t border-slate-200 p-5">
                <button type="button" data-dialog-initial-focus="receivable-receipt" onClick={closeReceiptModal} className="nx-fluid-press h-touch rounded-control border border-slate-300 bg-white px-4 font-semibold text-slate-700 hover:bg-slate-100">Ahora no</button>
                <button type="button" onClick={() => { if (printReceipt(receiptToConfirm)) closeReceiptModal(); }} className="nx-fluid-press inline-flex h-touch items-center justify-center gap-2 rounded-control bg-brand px-4 font-semibold text-brand-on hover:bg-brand-hover"><Printer size={18} /> Imprimir recibo</button>
              </div>
            </div>
          </div>
        )}

        {writeoffDraft && (
          <div className="no-print fixed inset-0 z-modal flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) closeWriteoffModal(); }}>
            <div ref={writeoffDialogRef} role="dialog" aria-modal="true" aria-labelledby="writeoff-title" aria-describedby="writeoff-description" aria-busy={writeoffSubmitting} tabIndex={-1} className="nx-light-context nx-canvas-card max-h-[calc(100dvh-1rem)] w-full max-w-lg overflow-y-auto rounded-t-card border-red-200 text-slate-950 shadow-2xl sm:rounded-card">
              <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
                <div className="flex items-start gap-3">
                  <div className="rounded-control bg-red-100 p-2.5 text-red-700"><ShieldAlert size={21} /></div>
                  <div>
                    <h2 id="writeoff-title" className="text-xl font-bold text-slate-950">Marcar como incobrable</h2>
                    <p className="mt-1 text-sm text-slate-600">{writeoffDraft.customerName} · saldo {fmt(writeoffDraft.balance)}</p>
                  </div>
                </div>
                <button type="button" onClick={closeWriteoffModal} disabled={writeoffSubmitting} aria-label="Cerrar castigo de cuenta" className="nx-fluid-press flex h-touch w-touch items-center justify-center rounded-control text-slate-500 hover:bg-slate-100 hover:text-slate-950 disabled:opacity-50"><X size={18} /></button>
              </div>
              <form onSubmit={handleWriteoff} className="space-y-4 px-6 py-5" noValidate>
                <div id="writeoff-description" className="rounded-card border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">
                  Esta acción reconoce la pérdida contablemente y deja la factura fuera de cobranza. No se puede deshacer desde este módulo.
                </div>
                <div>
                  <label htmlFor="writeoff-reason" className="mb-2 block text-sm font-semibold text-slate-700">
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
                    className={`w-full resize-y rounded-control border bg-white p-3 text-sm text-slate-950 outline-none placeholder:text-slate-400 focus:border-brand focus:ring-2 focus:ring-brand-ring ${writeoffError ? 'border-red-500' : 'border-slate-300'}`}
                  />
                  {writeoffError && <p id="writeoff-error" role="alert" className="mt-2 rounded-control border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{writeoffError}</p>}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    disabled={writeoffSubmitting}
                    onClick={closeWriteoffModal}
                    className="nx-fluid-press h-touch rounded-control border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={writeoffSubmitting}
                    className="nx-fluid-press inline-flex h-touch items-center justify-center gap-2 rounded-control bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-600 disabled:cursor-wait disabled:opacity-60"
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
