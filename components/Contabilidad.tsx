import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    BookOpen, Plus, Trash2, Lock, Unlock, Loader2, Scale, FileText,
    CalendarDays, CheckCircle2, AlertTriangle, ArrowLeft, ListTree, Percent, Coins, Receipt,
    Landmark, FileBarChart, Play, ListChecks, Clock, ShieldCheck, ChevronLeft, ChevronRight,
    Hourglass, Phone, ChevronDown, Wallet, TrendingUp, TrendingDown, X
} from 'lucide-react';
import { sanitizeDecimalInput, toDecimal, formatMoney } from '../utils/money';
import { ToastViewport, useToast } from './ui/Toast';
import ModuleHeader from './ui/ModuleHeader';

/**
 * FASE A — Contabilidad del contador.
 * Asiento manual (A1) + saldos de apertura (A2), libro diario y balanza/mayor
 * (A4), y gestión de períodos con bloqueo/reapertura (A3).
 */

interface Account { id: string; code: string; name: string; type: string; }
interface DraftLine { accountCode: string; debit: string; credit: string; }

interface DiarioLinea { cuenta: string; nombre: string; debe: number; haber: number; }
interface DiarioAsiento { numero: number; id: string; fecha: string; descripcion: string; tipo: string | null; esManual: boolean; lineas: DiarioLinea[]; }
interface BalanzaRow { cuenta: string; nombre: string; tipo: string; saldoInicial: number; debe: number; haber: number; saldoFinal: number; }
interface MayorMov { fecha: string; descripcion: string; debe: number; haber: number; saldo: number; }
interface FiscalPeriodRow { id: string; year: number; month: number; status: string; closedAt?: string | null; reopenReason?: string | null; }

type Tab = 'cierre' | 'aging' | 'flujo' | 'asiento' | 'diario' | 'balanza' | 'periodos' | 'fiscal' | 'retenciones' | 'activos' | 'renta';

interface RetencionRow { id: string; fecha: string; clienteRetenedor: string; tipo: string; baseAmount: number; amount: number; numeroConstancia?: string | null; }
interface OpenCreditSale { saleId: string; customerName: string; invoiceNumber: string | null; date: string; dueDate: string | null; total: number; balance: number; }
interface AssetRow { id: string; nombre: string; categoria: string; costo: number; fechaAdquisicion: string; vidaUtilMeses: number; depreciacionAcumulada: number; mesesDepreciados: number; valorEnLibros: number; estado: string; }
interface AnnualIR { year: number; ingresosNetos: number; costoVentas: number; gastos: number; utilidadFiscal: number; irSobreRenta: number; pmdRate: number; pagoMinimoDefinitivo: number; impuestoDelEjercicio: number; anticiposEnterados: number; retencionesSufridasIR: number; creditosTotales: number; saldoAPagar: number; saldoAFavor: number; resumen: string; }
interface ObligacionRow { key: string; label: string; entidad: string; monto: number; vence: string; dataLista: boolean; declarado: boolean; nota?: string; }
interface CierreData { period: string; obligaciones: ObligacionRow[]; totalDeclarar: number; pendientes: number; periodoCerrado: boolean; planillaCalculada: boolean; vetSummary: string; }
interface AgingFactura { id: string; numero: string | null; fecha: string; vence: string | null; monto: number; saldo: number; dias: number; bucket: string; }
interface AgingEntidad { id: string; nombre: string; telefono: string | null; total: number; vencido: number; corriente: number; b1_30: number; b31_60: number; b61_90: number; b90: number; facturas: AgingFactura[]; }
interface AgingSide { total: number; vencido: number; buckets: { corriente: number; b1_30: number; b31_60: number; b61_90: number; b90: number }; entidades: AgingEntidad[]; }
interface AgingData { asOf: string; cxc: AgingSide; cxp: AgingSide; }
interface FlujoConcepto { label: string; entrada: number; salida: number; neto: number; }
interface FlujoSeccion { entradas: number; salidas: number; neto: number; conceptos: FlujoConcepto[]; }
interface FlujoData { period: string; saldoInicial: number; saldoFinal: number; flujoNeto: number; entradasTotal: number; salidasTotal: number; secciones: { operacion: FlujoSeccion; inversion: FlujoSeccion; financiamiento: FlujoSeccion }; }
type DecisionDialog =
    | { kind: 'close-period'; month: number; year: number }
    | { kind: 'reopen-period'; period: FiscalPeriodRow }
    | { kind: 'retire-asset'; asset: AssetRow };
const FLUJO_SECCIONES: { key: 'operacion' | 'inversion' | 'financiamiento'; label: string }[] = [
    { key: 'operacion', label: 'Actividades de operación' },
    { key: 'inversion', label: 'Actividades de inversión' },
    { key: 'financiamiento', label: 'Actividades de financiamiento' },
];
const BUCKET_META: { key: 'corriente' | 'b1_30' | 'b31_60' | 'b61_90' | 'b90'; label: string; cls: string }[] = [
    { key: 'corriente', label: 'Corriente', cls: 'nx-canvas-muted' },
    { key: 'b1_30', label: '1–30 d', cls: 'nx-tone-warning' },
    { key: 'b31_60', label: '31–60 d', cls: 'nx-tone-warning' },
    { key: 'b61_90', label: '61–90 d', cls: 'nx-tone-warning' },
    { key: 'b90', label: '+90 d', cls: 'nx-tone-danger' },
];

const C = (n: number) => formatMoney(n);
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const ACCOUNTING_ACCESS_ROLES = new Set(['OWNER', 'ADMIN', 'SUPER_ADMIN', 'ACCOUNTANT']);
const ACCOUNTING_PERIOD_ROLES = new Set(['OWNER', 'ADMIN', 'SUPER_ADMIN']);

function managuaCivilToday(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Managua',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);
    const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? '';
    const year = Number(value('year'));
    const month = Number(value('month'));
    const day = Number(value('day'));
    return { year, month, day, isoDay: `${value('year')}-${value('month')}-${value('day')}` };
}

const Contabilidad: React.FC = () => {
    const token = localStorage.getItem('nortex_token');
    const role = useMemo(() => {
        try { return token ? JSON.parse(atob(token.split('.')[1])).role || '' : ''; } catch { return ''; }
    }, [token]);
    const canAccessAccounting = ACCOUNTING_ACCESS_ROLES.has(role);
    // `checkRole` trata estos tres roles como superusuarios antes de evaluar la
    // lista puntual del endpoint. La UI debe reflejar ese contrato efectivo:
    // ACCOUNTANT puede operar la contabilidad diaria, pero no cerrar/reabrir.
    const canManagePeriods = ACCOUNTING_PERIOD_ROLES.has(role);

    const auth = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
    const today = new Date();
    const todayCivil = managuaCivilToday(today);
    const { toast, showToast, dismissToast } = useToast();

    const [decisionDialog, setDecisionDialog] = useState<DecisionDialog | null>(null);
    const [decisionBusy, setDecisionBusy] = useState(false);
    const [decisionError, setDecisionError] = useState('');
    const [reopenReason, setReopenReason] = useState('');
    const decisionDialogRef = useRef<HTMLDivElement | null>(null);
    const decisionSafeActionRef = useRef<HTMLButtonElement | null>(null);
    const reopenReasonRef = useRef<HTMLTextAreaElement | null>(null);
    const decisionReturnFocusRef = useRef<HTMLElement | null>(null);
    const decisionBusyRef = useRef(false);

    const resetDecisionDialog = useCallback(() => {
        setDecisionDialog(null);
        setDecisionError('');
        setReopenReason('');
    }, []);

    const dismissDecisionDialog = useCallback(() => {
        if (decisionBusyRef.current) return;
        resetDecisionDialog();
    }, [resetDecisionDialog]);

    const openDecisionDialog = (dialog: DecisionDialog, trigger: HTMLElement) => {
        decisionReturnFocusRef.current = trigger;
        setDecisionError('');
        setReopenReason('');
        setDecisionDialog(dialog);
    };

    useEffect(() => {
        if (!decisionDialog) return;

        const dialog = decisionDialogRef.current;
        const returnFocus = decisionReturnFocusRef.current
            ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
        const focusFrame = window.requestAnimationFrame(() => {
            (decisionDialog.kind === 'reopen-period'
                ? reopenReasonRef.current
                : decisionSafeActionRef.current)?.focus();
        });

        const keepFocusInside = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                dismissDecisionDialog();
                return;
            }
            if (event.key !== 'Tab' || !dialog) return;

            const focusable = (Array.from(dialog.querySelectorAll(
                'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
            )) as HTMLElement[]).filter(element => element.getAttribute('aria-hidden') !== 'true');

            if (focusable.length === 0) {
                event.preventDefault();
                dialog.focus();
                return;
            }

            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const active = document.activeElement;
            if (event.shiftKey && (active === first || !dialog.contains(active))) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', keepFocusInside);
        return () => {
            window.cancelAnimationFrame(focusFrame);
            document.removeEventListener('keydown', keepFocusInside);
            if (returnFocus?.isConnected && !returnFocus.hasAttribute('disabled')) returnFocus.focus();
            decisionReturnFocusRef.current = null;
        };
    }, [decisionDialog, dismissDecisionDialog]);

    const [tab, setTab] = useState<Tab>('cierre');
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [accountsBusy, setAccountsBusy] = useState(true);
    const [accountsError, setAccountsError] = useState('');

    useEffect(() => {
        if (!canAccessAccounting) return;
        let active = true;
        setAccountsBusy(true);
        setAccountsError('');
        fetch('/api/accounting/chart', { headers: auth })
            .then(async (response) => {
                if (!response.ok) throw new Error('No pudimos cargar el catálogo de cuentas.');
                return response.json();
            })
            .then((data) => {
                if (active) setAccounts(Array.isArray(data) ? data : []);
            })
            .catch(() => {
                if (active) setAccountsError('No pudimos cargar el catálogo de cuentas. Intentá de nuevo.');
            })
            .finally(() => {
                if (active) setAccountsBusy(false);
            });
        return () => { active = false; };
    }, [auth, canAccessAccounting]);

    // ── Asiento manual (A1/A2) ──────────────────────────────────────────────
    const [entryDate, setEntryDate] = useState(todayCivil.isoDay);
    const [descripcion, setDescripcion] = useState('');
    const [tipo, setTipo] = useState<'MANUAL' | 'OPENING'>('MANUAL');
    const [lines, setLines] = useState<DraftLine[]>([
        { accountCode: '', debit: '', credit: '' },
        { accountCode: '', debit: '', credit: '' },
    ]);
    const [posting, setPosting] = useState(false);
    const [postMsg, setPostMsg] = useState<{ ok: boolean; text: string } | null>(null);

    const totalDebe = lines.reduce((s, l) => s.plus(toDecimal(l.debit)), toDecimal(0));
    const totalHaber = lines.reduce((s, l) => s.plus(toDecimal(l.credit)), toDecimal(0));
    const balanced = totalDebe.equals(totalHaber) && totalDebe.greaterThan(0);

    const setLine = (i: number, patch: Partial<DraftLine>) =>
        setLines(prev => prev.map((l, idx) => idx === i ? { ...l, ...patch } : l));

    const submitEntry = async () => {
        setPostMsg(null);
        if (!descripcion.trim()) return setPostMsg({ ok: false, text: 'Escribe una descripción.' });
        if (!balanced) return setPostMsg({ ok: false, text: 'El asiento debe cuadrar (Debe = Haber) y ser mayor a cero.' });
        const payloadLines = lines
            .filter(l => l.accountCode && (toDecimal(l.debit).greaterThan(0) || toDecimal(l.credit).greaterThan(0)))
            .map(l => ({ accountCode: l.accountCode, debit: toDecimal(l.debit).toNumber(), credit: toDecimal(l.credit).toNumber() }));
        if (payloadLines.length < 2) return setPostMsg({ ok: false, text: 'Se requieren al menos 2 líneas con cuenta y monto.' });

        setPosting(true);
        try {
            const res = await fetch('/api/accounting/journal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...auth },
                body: JSON.stringify({ date: entryDate, description: descripcion.trim(), type: tipo, lines: payloadLines }),
            });
            const data = await res.json();
            if (!res.ok) { setPostMsg({ ok: false, text: data.error || 'Error al registrar.' }); return; }
            setPostMsg({ ok: true, text: data.message || 'Asiento registrado.' });
            setDescripcion('');
            setLines([{ accountCode: '', debit: '', credit: '' }, { accountCode: '', debit: '', credit: '' }]);
        } catch { setPostMsg({ ok: false, text: 'Error de conexión.' }); }
        finally { setPosting(false); }
    };

    // ── Libro diario / balanza (A4) ─────────────────────────────────────────
    const [y, setY] = useState(todayCivil.year);
    const [m, setM] = useState(todayCivil.month);
    const [diario, setDiario] = useState<{ locked: boolean; totalDebe: number; totalHaber: number; asientos: DiarioAsiento[] } | null>(null);
    const [balanza, setBalanza] = useState<{ balanza: BalanzaRow[]; totales: { debe: number; haber: number } } | null>(null);
    const [mayor, setMayor] = useState<{ cuenta: string; nombre: string; saldoInicial: number; saldoFinal: number; movimientos: MayorMov[] } | null>(null);
    const [busy, setBusy] = useState(false);

    const loadDiario = useCallback(async () => {
        setBusy(true);
        try {
            const res = await fetch(`/api/accounting/libro-diario/${y}/${m}`, { headers: auth });
            setDiario(res.ok ? await res.json() : null);
        } finally { setBusy(false); }
    }, [y, m, auth]);

    const loadBalanza = useCallback(async () => {
        setBusy(true); setMayor(null);
        try {
            const res = await fetch(`/api/accounting/libro-mayor/${y}/${m}`, { headers: auth });
            setBalanza(res.ok ? await res.json() : null);
        } finally { setBusy(false); }
    }, [y, m, auth]);

    const loadMayor = async (code: string) => {
        setBusy(true);
        try {
            const res = await fetch(`/api/accounting/libro-mayor/${y}/${m}?accountCode=${encodeURIComponent(code)}`, { headers: auth });
            setMayor(res.ok ? await res.json() : null);
        } finally { setBusy(false); }
    };

    useEffect(() => { if (tab === 'diario') loadDiario(); }, [tab, loadDiario]);
    useEffect(() => { if (tab === 'balanza') loadBalanza(); }, [tab, loadBalanza]);

    // ── Cierre mensual / Panel del contador (Fase C) ────────────────────────
    const [cierre, setCierre] = useState<CierreData | null>(null);
    const [cierreBusy, setCierreBusy] = useState(false);
    const [marking, setMarking] = useState<string | null>(null);

    const loadCierre = useCallback(async () => {
        if (!canAccessAccounting) return;
        setCierreBusy(true);
        try {
            const res = await fetch(`/api/accounting/cierre-mensual/${y}/${m}`, { headers: auth });
            setCierre(res.ok ? await res.json() : null);
        } catch { setCierre(null); }
        finally { setCierreBusy(false); }
    }, [y, m, auth, canAccessAccounting]);

    useEffect(() => { if (tab === 'cierre') loadCierre(); }, [tab, loadCierre]);

    const toggleObligacion = async (key: string, declarado: boolean) => {
        setMarking(key);
        // Optimista: refleja el cambio al instante y confirma con el servidor.
        setCierre(prev => prev ? { ...prev, obligaciones: prev.obligaciones.map(o => o.key === key ? { ...o, declarado } : o) } : prev);
        try {
            const res = await fetch(`/api/accounting/cierre-mensual/${y}/${m}/${key}`, {
                method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' },
                body: JSON.stringify({ declarado }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'No pudimos actualizar la obligación.');
            await loadCierre();
            showToast({
                tone: 'success',
                title: declarado ? 'Obligación declarada' : 'Obligación reabierta',
                message: 'El panel mensual quedó actualizado.',
            });
        } catch (error) {
            await loadCierre();
            showToast({
                tone: 'error',
                title: 'No se guardó el cambio',
                message: error instanceof Error ? error.message : 'Intentá de nuevo.',
            });
        }
        finally { setMarking(null); }
    };

    const stepMonth = (delta: number) => {
        let nm = m + delta, ny = y;
        if (nm < 1) { nm = 12; ny -= 1; }
        if (nm > 12) { nm = 1; ny += 1; }
        setM(nm); setY(ny);
    };
    const fmtVence = (iso: string) => new Date(iso).toLocaleDateString('es-NI', { day: '2-digit', month: 'short' });
    const isVencido = (o: ObligacionRow) => !o.declarado && o.monto > 0 && new Date(o.vence) < today;

    // ── Antigüedad de saldos / Aging CxC-CxP (Fase C3) ──────────────────────
    const [aging, setAging] = useState<AgingData | null>(null);
    const [agingBusy, setAgingBusy] = useState(false);
    const [agingSide, setAgingSide] = useState<'cxc' | 'cxp'>('cxc');
    const [agingOpen, setAgingOpen] = useState<string | null>(null);

    const loadAging = useCallback(async () => {
        setAgingBusy(true); setAgingOpen(null);
        try {
            const res = await fetch('/api/accounting/aging', { headers: auth });
            setAging(res.ok ? await res.json() : null);
        } catch { setAging(null); }
        finally { setAgingBusy(false); }
    }, [auth]);

    useEffect(() => { if (tab === 'aging') loadAging(); }, [tab, loadAging]);

    const fmtFecha = (iso: string) => new Date(iso).toLocaleDateString('es-NI', { day: '2-digit', month: 'short', year: '2-digit' });

    // ── Flujo de efectivo / Cash flow (Fase C2) ─────────────────────────────
    const [flujo, setFlujo] = useState<FlujoData | null>(null);
    const [flujoBusy, setFlujoBusy] = useState(false);

    const loadFlujo = useCallback(async () => {
        setFlujoBusy(true);
        try {
            const res = await fetch(`/api/accounting/flujo-efectivo/${y}/${m}`, { headers: auth });
            setFlujo(res.ok ? await res.json() : null);
        } catch { setFlujo(null); }
        finally { setFlujoBusy(false); }
    }, [y, m, auth]);

    useEffect(() => { if (tab === 'flujo') loadFlujo(); }, [tab, loadFlujo]);

    const signedC = (n: number) => `${n < 0 ? '−' : '+'}${C(Math.abs(n))}`;
    const netoCls = (n: number) => n > 0 ? 'nx-tone-positive' : n < 0 ? 'nx-tone-danger' : 'nx-canvas-muted';

    // ── Períodos (A3) ───────────────────────────────────────────────────────
    const [periods, setPeriods] = useState<FiscalPeriodRow[]>([]);
    const [periodsBusy, setPeriodsBusy] = useState(false);
    const [periodsError, setPeriodsError] = useState('');
    const loadPeriods = useCallback(async () => {
        setPeriodsBusy(true);
        setPeriodsError('');
        try {
            const res = await fetch('/api/accounting/periods', { headers: auth });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(d.error || 'No pudimos cargar los períodos.');
            setPeriods(d.periods ?? []);
        } catch (error) {
            setPeriodsError(error instanceof Error ? error.message : 'No pudimos cargar los períodos.');
        } finally {
            setPeriodsBusy(false);
        }
    }, [auth]);
    useEffect(() => { if (tab === 'periodos') loadPeriods(); }, [tab, loadPeriods]);

    // ── Config fiscal + tipo de cambio (B4/B6) ──────────────────────────────
    const [cfg, setCfg] = useState({ inssPatronalRate: '', anticipoIrRate: '', imiRate: '', salarioMinimo: '' });
    const [cfgMsg, setCfgMsg] = useState<{ ok: boolean; text: string } | null>(null);
    const [fiscalBusy, setFiscalBusy] = useState(false);
    const [fiscalError, setFiscalError] = useState('');
    const [savingCfg, setSavingCfg] = useState(false);
    const [exLatest, setExLatest] = useState<{ rate: number | null; fecha?: string }>({ rate: null });
    const [exDate, setExDate] = useState(todayCivil.isoDay);
    const [exRate, setExRate] = useState('');
    const [exRateError, setExRateError] = useState('');
    const [savingRate, setSavingRate] = useState(false);

    const loadFiscal = useCallback(async () => {
        setFiscalBusy(true);
        setFiscalError('');
        try {
            const [configResponse, exchangeResponse] = await Promise.all([
                fetch('/api/accounting/tax-config', { headers: auth }),
                fetch('/api/accounting/exchange-rate/latest', { headers: auth }),
            ]);
            if (!configResponse.ok || !exchangeResponse.ok) throw new Error('No pudimos cargar la configuración fiscal.');
            const [c, e] = await Promise.all([configResponse.json(), exchangeResponse.json()]);
            setCfg({
                inssPatronalRate: String((Number(c.inssPatronalRate) * 100).toFixed(2)),
                anticipoIrRate: String((Number(c.anticipoIrRate) * 100).toFixed(2)),
                imiRate: String((Number(c.imiRate) * 100).toFixed(2)),
                salarioMinimo: c.salarioMinimo ? String(Number(c.salarioMinimo)) : '',
            });
            setExLatest(e);
        } catch {
            setFiscalError('No pudimos cargar la configuración fiscal. Intentá de nuevo.');
        } finally {
            setFiscalBusy(false);
        }
    }, [auth]);
    useEffect(() => { if (tab === 'fiscal') loadFiscal(); }, [tab, loadFiscal]);

    const saveCfg = async () => {
        setCfgMsg(null);
        const pct = (s: string) => toDecimal(s).div(100).toNumber();
        setSavingCfg(true);
        try {
            const res = await fetch('/api/accounting/tax-config', {
                method: 'PUT', headers: { 'Content-Type': 'application/json', ...auth },
                body: JSON.stringify({
                    inssPatronalRate: pct(cfg.inssPatronalRate), anticipoIrRate: pct(cfg.anticipoIrRate),
                    imiRate: pct(cfg.imiRate), salarioMinimo: toDecimal(cfg.salarioMinimo).toNumber(),
                }),
            });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(d.error || 'No pudimos guardar las tasas.');
            setCfgMsg({ ok: true, text: 'Configuración guardada.' });
            showToast({ tone: 'success', title: 'Tasas actualizadas', message: 'La nueva configuración fiscal ya está vigente.' });
        } catch (error) {
            setCfgMsg({ ok: false, text: error instanceof Error ? error.message : 'No pudimos guardar las tasas.' });
        } finally {
            setSavingCfg(false);
        }
    };

    const saveRate = async () => {
        setExRateError('');
        if (!exDate) {
            setExRateError('Seleccioná la fecha de vigencia.');
            return;
        }
        if (toDecimal(exRate).lessThanOrEqualTo(0)) {
            setExRateError('Ingresá una tasa mayor a cero.');
            return;
        }
        setSavingRate(true);
        try {
            const res = await fetch('/api/accounting/exchange-rate', {
                method: 'POST', headers: { 'Content-Type': 'application/json', ...auth },
                body: JSON.stringify({ fecha: exDate, rate: toDecimal(exRate).toNumber() }),
            });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(d.error || 'No pudimos registrar la tasa.');
            setExRate('');
            await loadFiscal();
            showToast({ tone: 'success', title: 'Tipo de cambio registrado', message: `La tasa del ${new Date(`${exDate}T12:00:00`).toLocaleDateString('es-NI')} ya está disponible en el POS.` });
        } catch (error) {
            setExRateError(error instanceof Error ? error.message : 'No pudimos registrar la tasa.');
        } finally {
            setSavingRate(false);
        }
    };

    // ── Retenciones sufridas (B1) ────────────────────────────────────────────
    const [retList, setRetList] = useState<RetencionRow[]>([]);
    const [ret, setRet] = useState({ saleId: '', fecha: todayCivil.isoDay, clienteRetenedor: '', tipo: 'IR_2', baseAmount: '', amount: '', numeroConstancia: '' });
    const [retMsg, setRetMsg] = useState<{ ok: boolean; text: string } | null>(null);
    const [retBusy, setRetBusy] = useState(false);
    const [retError, setRetError] = useState('');
    const [openCreditSales, setOpenCreditSales] = useState<OpenCreditSale[]>([]);
    const [openCreditSalesBusy, setOpenCreditSalesBusy] = useState(false);
    const [openCreditSalesError, setOpenCreditSalesError] = useState('');
    const [savingRet, setSavingRet] = useState(false);
    const [retClientEventId, setRetClientEventId] = useState('');

    const loadRet = useCallback(async () => {
        setRetBusy(true);
        setRetError('');
        try {
            const res = await fetch('/api/accounting/retenciones-sufridas', { headers: auth });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(d.error || 'No pudimos cargar las retenciones.');
            setRetList(d.retenciones ?? []);
        } catch (error) {
            setRetError(error instanceof Error ? error.message : 'No pudimos cargar las retenciones.');
        } finally {
            setRetBusy(false);
        }
    }, [auth]);

    const loadOpenCreditSales = useCallback(async () => {
        setOpenCreditSalesBusy(true);
        setOpenCreditSalesError('');
        try {
            const res = await fetch('/api/collections/worklist', { headers: auth });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(d.error || 'No pudimos cargar las facturas abiertas.');
            setOpenCreditSales(Array.isArray(d.items) ? d.items : []);
        } catch (error) {
            setOpenCreditSalesError(error instanceof Error ? error.message : 'No pudimos cargar las facturas abiertas.');
        } finally {
            setOpenCreditSalesBusy(false);
        }
    }, [auth]);

    useEffect(() => {
        if (tab !== 'retenciones') return;
        void loadRet();
        void loadOpenCreditSales();
    }, [tab, loadRet, loadOpenCreditSales]);

    // Auto-calcular el monto retenido según el tipo y la base.
    const retAmountAuto = useMemo(() => {
        const base = toDecimal(ret.baseAmount);
        const rate = ret.tipo === 'IR_2' ? 0.02 : 0.01;
        const calculated = base.mul(rate).toDecimalPlaces(2);
        const selectedSale = openCreditSales.find(sale => sale.saleId === ret.saleId);
        const balance = selectedSale ? toDecimal(selectedSale.balance) : null;
        return balance && calculated.greaterThan(balance)
            ? balance.toDecimalPlaces(2).toNumber()
            : calculated.toNumber();
    }, [openCreditSales, ret.baseAmount, ret.saleId, ret.tipo]);

    const selectRetentionSale = (saleId: string) => {
        const selected = openCreditSales.find(sale => sale.saleId === saleId);
        setRetClientEventId('');
        setRet(current => selected ? {
            ...current,
            saleId: selected.saleId,
            clienteRetenedor: selected.customerName,
            baseAmount: toDecimal(selected.total).toFixed(2),
            amount: '',
        } : {
            ...current,
            saleId: '',
            clienteRetenedor: '',
            baseAmount: '',
            amount: '',
        });
    };

    const submitRet = async () => {
        setRetMsg(null);
        if (!ret.saleId) return setRetMsg({ ok: false, text: 'Seleccioná la factura a crédito que recibió la retención.' });
        if (!ret.clienteRetenedor.trim()) return setRetMsg({ ok: false, text: 'Indica quién te retuvo.' });
        const baseAmount = toDecimal(ret.baseAmount);
        if (!baseAmount.greaterThan(0)) return setRetMsg({ ok: false, text: 'La base facturada debe ser mayor a cero.' });
        const amount = toDecimal(ret.amount).greaterThan(0) ? toDecimal(ret.amount) : toDecimal(retAmountAuto);
        if (!amount.greaterThan(0)) return setRetMsg({ ok: false, text: 'El monto retenido debe ser mayor a cero.' });
        const clientEventId = retClientEventId || crypto.randomUUID();
        if (!retClientEventId) setRetClientEventId(clientEventId);
        setSavingRet(true);
        try {
            const res = await fetch('/api/accounting/retenciones-sufridas', {
                method: 'POST', headers: { 'Content-Type': 'application/json', ...auth },
                body: JSON.stringify({
                    saleId: ret.saleId,
                    fecha: ret.fecha, clienteRetenedor: ret.clienteRetenedor.trim(), tipo: ret.tipo,
                    baseAmount: baseAmount.toFixed(2), amount: amount.toFixed(2),
                    numeroConstancia: ret.numeroConstancia.trim() || undefined, clientEventId,
                }),
            });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(d.error || 'No pudimos registrar la retención.');
            setRetMsg({ ok: true, text: d.message || 'Retención registrada.' });
            setRet(r => ({ ...r, saleId: '', clienteRetenedor: '', baseAmount: '', amount: '', numeroConstancia: '' }));
            setRetClientEventId('');
            await Promise.all([loadRet(), loadOpenCreditSales()]);
            showToast({ tone: 'success', title: 'Retención registrada', message: 'El crédito fiscal quedó incluido en la contabilidad.' });
        } catch (error) {
            setRetMsg({ ok: false, text: error instanceof Error ? error.message : 'No pudimos registrar la retención.' });
        } finally {
            setSavingRet(false);
        }
    };

    // ── Activos fijos + depreciación (B2) ───────────────────────────────────
    const [assets, setAssets] = useState<AssetRow[]>([]);
    const [newAsset, setNewAsset] = useState({ nombre: '', categoria: 'COMPUTO', costo: '', fechaAdquisicion: todayCivil.isoDay });
    const [depMsg, setDepMsg] = useState<{ ok: boolean; text: string } | null>(null);
    const [assetsBusy, setAssetsBusy] = useState(false);
    const [assetsError, setAssetsError] = useState('');
    const [assetFormError, setAssetFormError] = useState('');
    const [addingAsset, setAddingAsset] = useState(false);
    const [depreciationBusy, setDepreciationBusy] = useState(false);
    const loadAssets = useCallback(async () => {
        setAssetsBusy(true);
        setAssetsError('');
        try {
            const res = await fetch('/api/accounting/fixed-assets', { headers: auth });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(d.error || 'No pudimos cargar los activos.');
            setAssets(d.assets ?? []);
        } catch (error) {
            setAssetsError(error instanceof Error ? error.message : 'No pudimos cargar los activos.');
        } finally {
            setAssetsBusy(false);
        }
    }, [auth]);
    useEffect(() => { if (tab === 'activos') loadAssets(); }, [tab, loadAssets]);

    const addAsset = async () => {
        setAssetFormError('');
        if (!newAsset.nombre.trim()) {
            setAssetFormError('Escribí el nombre del activo.');
            return;
        }
        if (toDecimal(newAsset.costo).lessThanOrEqualTo(0)) {
            setAssetFormError('Ingresá un costo mayor a cero.');
            return;
        }
        setAddingAsset(true);
        try {
            const res = await fetch('/api/accounting/fixed-assets', {
                method: 'POST', headers: { 'Content-Type': 'application/json', ...auth },
                body: JSON.stringify({ ...newAsset, costo: toDecimal(newAsset.costo).toNumber() }),
            });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(d.error || 'No pudimos registrar el activo.');
            setNewAsset(a => ({ ...a, nombre: '', costo: '' }));
            await loadAssets();
            showToast({ tone: 'success', title: 'Activo registrado', message: 'La adquisición y su asiento contable quedaron guardados.' });
        } catch (error) {
            setAssetFormError(error instanceof Error ? error.message : 'No pudimos registrar el activo.');
        } finally {
            setAddingAsset(false);
        }
    };
    const runDep = async () => {
        setDepMsg(null);
        setDepreciationBusy(true);
        try {
            const res = await fetch('/api/accounting/depreciacion/run', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify({}) });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(d.error || 'No pudimos correr la depreciación.');
            setDepMsg({ ok: true, text: d.message || 'Depreciación completada.' });
            await loadAssets();
            showToast({ tone: 'success', title: 'Depreciación completada', message: d.message || 'Los valores en libros quedaron actualizados.' });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'No pudimos correr la depreciación.';
            setDepMsg({ ok: false, text: message });
            showToast({ tone: 'error', title: 'No se pudo depreciar', message });
        } finally {
            setDepreciationBusy(false);
        }
    };

    const completeDecision = () => {
        decisionBusyRef.current = false;
        setDecisionBusy(false);
        resetDecisionDialog();
    };

    const confirmClosePeriod = async () => {
        if (!canManagePeriods || decisionDialog?.kind !== 'close-period') return;
        const { month, year } = decisionDialog;
        setDecisionError('');
        decisionBusyRef.current = true;
        setDecisionBusy(true);
        try {
            const res = await fetch('/api/accounting/fiscal-close', {
                method: 'POST', headers: { 'Content-Type': 'application/json', ...auth },
                body: JSON.stringify({ month, year }),
            });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(d.error || 'No pudimos cerrar el período.');
            await loadPeriods();
            showToast({
                tone: 'success',
                title: 'Período cerrado',
                message: d.message || `${MESES[month - 1]} ${year} quedó bloqueado para nuevos movimientos.`,
            });
            completeDecision();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'No pudimos cerrar el período.';
            setDecisionError(message);
            showToast({ tone: 'error', title: 'No se pudo cerrar', message });
            decisionBusyRef.current = false;
            setDecisionBusy(false);
        }
    };

    const confirmReopenPeriod = async () => {
        if (!canManagePeriods || decisionDialog?.kind !== 'reopen-period') return;
        const reason = reopenReason.trim();
        if (reason.length < 3) {
            setDecisionError('Escribí un motivo de al menos 3 caracteres. Quedará en la auditoría.');
            reopenReasonRef.current?.focus();
            return;
        }

        const { period } = decisionDialog;
        setDecisionError('');
        decisionBusyRef.current = true;
        setDecisionBusy(true);
        try {
            const res = await fetch(`/api/accounting/periods/${period.year}/${period.month}/reopen`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', ...auth },
                body: JSON.stringify({ reason }),
            });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(d.error || 'No pudimos reabrir el período.');
            await loadPeriods();
            showToast({
                tone: 'success',
                title: 'Período reabierto',
                message: d.message || `${MESES[period.month - 1]} ${period.year} admite movimientos nuevamente.`,
            });
            completeDecision();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'No pudimos reabrir el período.';
            setDecisionError(message);
            showToast({ tone: 'error', title: 'No se pudo reabrir', message });
            decisionBusyRef.current = false;
            setDecisionBusy(false);
        }
    };

    const confirmAssetRetirement = async () => {
        if (decisionDialog?.kind !== 'retire-asset') return;
        const { asset } = decisionDialog;
        setDecisionError('');
        decisionBusyRef.current = true;
        setDecisionBusy(true);
        try {
            const res = await fetch(`/api/accounting/fixed-assets/${asset.id}/baja`, { method: 'PATCH', headers: auth });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(d.error || 'No pudimos dar de baja el activo.');
            await loadAssets();
            showToast({
                tone: 'success',
                title: 'Activo dado de baja',
                message: `${asset.nombre} dejó de depreciarse y se registró su salida contable.`,
            });
            completeDecision();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'No pudimos dar de baja el activo.';
            setDecisionError(message);
            showToast({ tone: 'error', title: 'No se pudo dar de baja', message });
            decisionBusyRef.current = false;
            setDecisionBusy(false);
        }
    };

    // ── Renta anual (B3) ─────────────────────────────────────────────────────
    const [rentaYear, setRentaYear] = useState(todayCivil.year);
    const [renta, setRenta] = useState<AnnualIR | null>(null);
    const loadRenta = useCallback(async () => {
        setBusy(true);
        try {
            const res = await fetch(`/api/fiscal/renta-anual/${rentaYear}`, { headers: auth });
            setRenta(res.ok ? await res.json() : null);
        } finally { setBusy(false); }
    }, [rentaYear, auth]);
    useEffect(() => { if (tab === 'renta') loadRenta(); }, [tab, loadRenta]);

    if (!canAccessAccounting) {
        return (
            <div className="nx-workspace h-full overflow-y-auto p-4 sm:p-6 custom-scrollbar">
                <div className="mx-auto flex min-h-[50vh] max-w-2xl items-center justify-center">
                    <div role="alert" className="nx-canvas-card w-full p-6 text-center sm:p-8">
                        <span className="nx-tone-warning-bg nx-tone-warning mx-auto flex h-12 w-12 items-center justify-center rounded-control">
                            <ShieldCheck size={22} aria-hidden="true" />
                        </span>
                        <h1 className="nx-canvas-text mt-4 text-xl font-bold">Contabilidad restringida</h1>
                        <p className="nx-canvas-muted mx-auto mt-2 max-w-md text-sm leading-6">
                            Tu rol no tiene acceso a los libros, cierres ni operaciones contables de este negocio.
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    const inputCls = 'nx-canvas-text min-h-tap w-full rounded-control border border-[var(--nx-canvas-border)] bg-[var(--nx-canvas-raised)] px-3 py-2.5 outline-none placeholder:text-[var(--nx-canvas-faint)] focus:border-brand focus:ring-2 focus:ring-brand-ring';
    const monthButtonCls = 'nx-fluid-press nx-canvas-text flex h-touch w-touch shrink-0 items-center justify-center rounded-control border border-[var(--nx-canvas-border)] bg-[var(--nx-canvas-raised)] transition-colors hover:bg-[var(--nx-canvas-subtle)]';

    const tabBtn = (t: Tab, label: string, Icon: React.ComponentType<{ size?: number }>) => (
        <button type="button" onClick={() => setTab(t)} aria-current={tab === t ? 'page' : undefined}
            className={`nx-module-tab nx-fluid-press flex min-h-tap min-w-0 items-center justify-start gap-2 rounded-control border px-3 py-2 text-left text-sm font-semibold transition-colors sm:shrink-0 sm:px-4 ${tab === t ? 'nx-module-tab-active' : ''}`}>
            <Icon size={16} aria-hidden="true" /> <span>{label}</span>
        </button>
    );

    const accountLabel = (code: string) => { const a = accounts.find(x => x.code === code); return a ? `${a.code} · ${a.name}` : code; };

    return (
        <div className="nx-workspace h-full overflow-y-auto p-4 sm:p-6 lg:p-8 custom-scrollbar">
            <ToastViewport toast={toast} onDismiss={dismissToast} />
            <div className="max-w-5xl mx-auto">
                <ModuleHeader
                    className="mb-6"
                    icon={<BookOpen size={20} aria-hidden="true" />}
                    title="Contabilidad"
                    subtitle="Asientos manuales, libros oficiales y cierre de períodos."
                />

                <nav aria-label="Secciones de contabilidad" className="mb-6 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                    {tabBtn('cierre', 'Cierre Mensual', ListChecks)}
                    {tabBtn('aging', 'Antigüedad', Hourglass)}
                    {tabBtn('flujo', 'Flujo de Caja', Wallet)}
                    {tabBtn('asiento', 'Asiento Manual', Plus)}
                    {tabBtn('diario', 'Libro Diario', FileText)}
                    {tabBtn('balanza', 'Balanza / Mayor', Scale)}
                    {tabBtn('periodos', 'Períodos', CalendarDays)}
                    {tabBtn('retenciones', 'Retenciones', Receipt)}
                    {tabBtn('activos', 'Activos Fijos', Landmark)}
                    {tabBtn('renta', 'Renta Anual', FileBarChart)}
                    {tabBtn('fiscal', 'Config Fiscal', Percent)}
                </nav>

                {/* ── CIERRE MENSUAL (Panel del contador, Fase C) ── */}
                {tab === 'cierre' && (
                    <div className="space-y-5">
                        {/* Cabecera: selector de mes + total a declarar */}
                        <div className="nx-canvas-card p-5 sm:p-6">
                            <div className="flex flex-wrap items-start justify-between gap-4">
                                <div>
                                    <div className="flex items-center gap-1.5 mb-2">
                                        <button onClick={() => stepMonth(-1)} aria-label="Mes anterior"
                                            className={monthButtonCls}><ChevronLeft size={18} aria-hidden="true" /></button>
                                        <span className="nx-canvas-text min-w-[120px] px-2 text-center font-mono text-lg font-bold">{MESES[m - 1]} {y}</span>
                                        <button onClick={() => stepMonth(1)} aria-label="Mes siguiente"
                                            className={monthButtonCls}><ChevronRight size={18} aria-hidden="true" /></button>
                                    </div>
                                    <p className="nx-canvas-muted flex items-center gap-1.5 text-sm"><ShieldCheck size={14} className="nx-tone-positive" aria-hidden="true" /> ¿Qué me falta declarar este mes?</p>
                                </div>
                                <div className="text-right">
                                    <p className="nx-canvas-muted text-[11px] uppercase tracking-wider">Total a declarar</p>
                                    <p className="nx-canvas-text font-mono text-3xl font-bold leading-tight tabular-nums">{cierre ? C(cierre.totalDeclarar) : '—'}</p>
                                    {cierre && (cierre.pendientes > 0
                                        ? <span className="nx-tone-warning-bg nx-tone-warning mt-1.5 inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-semibold"><Clock size={12} /> {cierre.pendientes} pendiente{cierre.pendientes > 1 ? 's' : ''}</span>
                                        : <span className="nx-tone-positive-bg nx-tone-positive mt-1.5 inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-semibold"><CheckCircle2 size={12} /> Todo declarado</span>)}
                                </div>
                            </div>
                            {cierre?.periodoCerrado && (
                                <div className="nx-tone-warning-bg nx-tone-warning mt-4 flex items-center gap-2 rounded-control px-3 py-2 text-xs">
                                    <Lock size={13} /> Período cerrado — las cifras de la DGI están congeladas.
                                </div>
                            )}
                            {cierre && !cierre.planillaCalculada && (
                                <div className="nx-canvas-muted mt-3 flex items-center gap-2 rounded-control border border-[var(--nx-canvas-border)] bg-[var(--nx-canvas-subtle)] px-3 py-2 text-xs">
                                    <AlertTriangle size={13} className="nx-tone-warning" /> La nómina de {MESES[m - 1]} aún no se ha calculado: el INSS e INATEC aparecerán al cerrar la planilla.
                                </div>
                            )}
                        </div>

                        {/* Lista de obligaciones */}
                        {cierreBusy && !cierre ? (
                            <div className="nx-canvas-card flex items-center justify-center p-12"><Loader2 className="nx-tone-positive animate-spin" /></div>
                        ) : !cierre ? (
                            <div className="nx-canvas-card nx-canvas-faint p-10 text-center text-sm">No se pudo cargar el panel de cierre.</div>
                        ) : (
                            <div className="space-y-3">
                                {cierre.obligaciones.map(o => {
                                    const vencido = isVencido(o);
                                    const sinMonto = o.monto <= 0;
                                    const iconWrap = 'w-10 h-10 rounded-lg border flex items-center justify-center shrink-0';
                                    return (
                                        <div key={o.key} className={`nx-canvas-card flex flex-wrap items-center gap-x-4 gap-y-3 p-4 sm:px-5 ${o.declarado ? 'opacity-60' : ''}`}>
                                            <span className={`${iconWrap} ${o.declarado ? 'nx-tone-positive-bg' : !o.dataLista ? 'nx-tone-warning-bg' : vencido ? 'nx-tone-danger-bg' : 'border-[var(--nx-canvas-border)] bg-[var(--nx-canvas-subtle)]'}`}>
                                                {o.declarado ? <CheckCircle2 size={18} className="nx-tone-positive" />
                                                    : !o.dataLista ? <AlertTriangle size={18} className="nx-tone-warning" />
                                                        : vencido ? <AlertTriangle size={18} className="nx-tone-danger" />
                                                            : <Clock size={18} className="nx-canvas-muted" />}
                                            </span>
                                            <div className="flex-1 min-w-[170px]">
                                                <p className="nx-canvas-text font-semibold leading-tight">{o.label}</p>
                                                <p className="nx-canvas-faint mt-0.5 text-xs">{o.entidad}</p>
                                                {o.nota && <p className="nx-tone-warning mt-0.5 text-xs">{o.nota}</p>}
                                            </div>
                                            <div className="text-right">
                                                <p className="nx-canvas-faint text-[10px] uppercase tracking-wider">Vence</p>
                                                <p className={`font-mono text-sm ${vencido ? 'nx-tone-danger font-bold' : 'nx-canvas-muted'}`}>{fmtVence(o.vence)}</p>
                                            </div>
                                            <div className="text-right min-w-[120px]">
                                                <p className={`font-mono text-lg font-bold tabular-nums ${sinMonto ? 'nx-canvas-faint' : 'nx-canvas-text'}`}>{C(o.monto)}</p>
                                            </div>
                                            <button onClick={() => toggleObligacion(o.key, !o.declarado)} disabled={marking === o.key}
                                                className={`nx-fluid-press inline-flex min-h-tap min-w-[150px] items-center justify-center gap-1.5 rounded-control px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50 ${o.declarado
                                                    ? 'nx-tone-positive-bg nx-tone-positive hover:brightness-[0.98]'
                                                    : 'btn-primary'}`}>
                                                {marking === o.key ? <Loader2 size={14} className="animate-spin" />
                                                    : o.declarado ? <><CheckCircle2 size={14} /> Declarado</>
                                                        : <><ListChecks size={14} /> Marcar declarado</>}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* Resumen VET (DGI) */}
                        {cierre?.vetSummary && (
                            <div className="nx-canvas-card p-5">
                                <p className="nx-canvas-muted mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wider"><FileText size={13} /> Resumen VET — DGI</p>
                                <pre className="nx-canvas-muted whitespace-pre-wrap font-mono text-xs leading-relaxed">{cierre.vetSummary}</pre>
                            </div>
                        )}
                    </div>
                )}

                {/* ── ANTIGÜEDAD DE SALDOS (Aging CxC/CxP, Fase C3) ── */}
                {tab === 'aging' && (() => {
                    const s = aging ? aging[agingSide] : null;
                    return (
                        <div className="space-y-5">
                            <div className="nx-canvas-card p-5 sm:p-6">
                                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                                    <div className="inline-flex rounded-control border border-[var(--nx-canvas-border)] bg-[var(--nx-canvas-subtle)] p-1">
                                        {(['cxc', 'cxp'] as const).map(sd => (
                                            <button key={sd} onClick={() => { setAgingSide(sd); setAgingOpen(null); }}
                                                className={`nx-fluid-press min-h-tap rounded-control px-4 py-2 text-sm font-semibold transition-colors ${agingSide === sd ? 'nx-tone-positive-bg nx-tone-positive' : 'nx-canvas-muted hover:text-[var(--nx-canvas-text)]'}`}>
                                                {sd === 'cxc' ? 'Por Cobrar' : 'Por Pagar'}
                                            </button>
                                        ))}
                                    </div>
                                    {aging && <p className="nx-canvas-faint flex items-center gap-1.5 text-xs"><CalendarDays size={13} /> Saldos al {fmtFecha(aging.asOf)}</p>}
                                </div>

                                {s && (
                                    <>
                                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                            <div className="rounded-control border border-[var(--nx-canvas-border)] bg-[var(--nx-canvas-subtle)] p-4">
                                                <p className="nx-canvas-muted text-[11px] uppercase tracking-wider">{agingSide === 'cxc' ? 'Total por cobrar' : 'Total por pagar'}</p>
                                                <p className="nx-canvas-text mt-0.5 font-mono text-2xl font-bold tabular-nums">{C(s.total)}</p>
                                            </div>
                                            <div className={`rounded-control border p-4 ${s.vencido > 0 ? 'nx-tone-danger-bg' : 'border-[var(--nx-canvas-border)] bg-[var(--nx-canvas-subtle)]'}`}>
                                                <p className="nx-canvas-muted text-[11px] uppercase tracking-wider">Vencido</p>
                                                <p className={`mt-0.5 font-mono text-2xl font-bold tabular-nums ${s.vencido > 0 ? 'nx-tone-danger' : 'nx-canvas-text'}`}>{C(s.vencido)}</p>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-3">
                                            {BUCKET_META.map(b => (
                                                <div key={b.key} className="rounded-control border border-[var(--nx-canvas-border)] bg-[var(--nx-canvas-subtle)] px-3 py-2.5 text-center">
                                                    <p className="nx-canvas-faint text-[10px] uppercase tracking-wider">{b.label}</p>
                                                    <p className={`mt-0.5 font-mono text-sm tabular-nums ${s.buckets[b.key] > 0 ? b.cls : 'nx-canvas-faint'}`}>{C(s.buckets[b.key])}</p>
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>

                            {agingBusy && !aging ? (
                                <div className="nx-canvas-card flex items-center justify-center p-12"><Loader2 className="nx-tone-positive animate-spin" /></div>
                            ) : !s ? (
                                <div className="nx-canvas-card nx-canvas-faint p-10 text-center text-sm">No se pudo cargar la antigüedad de saldos.</div>
                            ) : s.entidades.length === 0 ? (
                                <div className="nx-canvas-card nx-canvas-muted p-10 text-center text-sm">
                                    {agingSide === 'cxc' ? 'Nadie te debe — las ventas a crédito están al día. ' : 'No tenés cuentas por pagar pendientes. '}
                                </div>
                            ) : (
                                <div className="nx-canvas-card overflow-hidden p-0">
                                    <div className="overflow-x-auto custom-scrollbar">
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="nx-canvas-faint border-b border-[var(--nx-canvas-border)] text-[10px] uppercase tracking-wider">
                                                    <th className="text-left font-semibold px-4 py-3">{agingSide === 'cxc' ? 'Cliente' : 'Proveedor'}</th>
                                                    {BUCKET_META.map(b => <th key={b.key} className="text-right font-semibold px-3 py-3 whitespace-nowrap">{b.label}</th>)}
                                                    <th className="text-right font-semibold px-4 py-3">Total</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {s.entidades.map(e => {
                                                    const open = agingOpen === e.id;
                                                    return (
                                                        <React.Fragment key={e.id}>
                                                            <tr onClick={() => setAgingOpen(open ? null : e.id)} className="cursor-pointer border-b border-[var(--nx-canvas-border)] transition-colors hover:bg-[var(--nx-canvas-subtle)]">
                                                                <td className="px-4 py-3">
                                                                    <div className="flex items-center gap-2">
                                                                        <ChevronDown size={14} className={`nx-canvas-faint shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
                                                                        <div>
                                                                            <p className="nx-canvas-text font-semibold leading-tight">{e.nombre}</p>
                                                                            {e.telefono && <p className="nx-canvas-faint flex items-center gap-1 text-[11px]"><Phone size={10} /> {e.telefono}</p>}
                                                                        </div>
                                                                    </div>
                                                                </td>
                                                                {BUCKET_META.map(b => (
                                                                    <td key={b.key} className={`whitespace-nowrap px-3 py-3 text-right font-mono tabular-nums ${e[b.key] > 0 ? b.cls : 'nx-canvas-faint'}`}>
                                                                        {e[b.key] > 0 ? C(e[b.key]) : '—'}
                                                                    </td>
                                                                ))}
                                                                <td className="nx-canvas-text whitespace-nowrap px-4 py-3 text-right font-mono font-bold tabular-nums">{C(e.total)}</td>
                                                            </tr>
                                                            {open && e.facturas.map(f => (
                                                                <tr key={f.id} className="border-b border-[var(--nx-canvas-border)] bg-[var(--nx-canvas-subtle)] text-xs">
                                                                    <td className="nx-canvas-muted whitespace-nowrap px-4 py-2 pl-10">
                                                                        {f.numero ? `#${f.numero} · ` : ''}{fmtFecha(f.fecha)}
                                                                        {f.vence && <span className="nx-canvas-faint"> · vence {fmtFecha(f.vence)}</span>}
                                                                        {f.dias > 0 && <span className="nx-tone-danger"> · {f.dias}d vencido</span>}
                                                                    </td>
                                                                    {BUCKET_META.map(b => (
                                                                        <td key={b.key} className="nx-canvas-muted px-3 py-2 text-right font-mono tabular-nums">
                                                                            {f.bucket === b.key ? C(f.saldo) : ''}
                                                                        </td>
                                                                    ))}
                                                                    <td className="nx-canvas-muted px-4 py-2 text-right font-mono tabular-nums">{C(f.saldo)}</td>
                                                                </tr>
                                                            ))}
                                                        </React.Fragment>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })()}

                {/* ── FLUJO DE EFECTIVO (Cash flow, Fase C2) ── */}
                {tab === 'flujo' && (
                    <div className="space-y-5">
                        <div className="nx-canvas-card p-5 sm:p-6">
                            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                                <div className="flex items-center gap-1.5">
                                    <button onClick={() => stepMonth(-1)} aria-label="Mes anterior"
                                        className={monthButtonCls}><ChevronLeft size={18} aria-hidden="true" /></button>
                                    <span className="nx-canvas-text min-w-[120px] px-2 text-center font-mono text-lg font-bold">{MESES[m - 1]} {y}</span>
                                    <button onClick={() => stepMonth(1)} aria-label="Mes siguiente"
                                        className={monthButtonCls}><ChevronRight size={18} aria-hidden="true" /></button>
                                </div>
                                <p className="nx-canvas-faint flex items-center gap-1.5 text-xs"><Wallet size={13} className="nx-tone-positive" aria-hidden="true" /> Plata real que entra y sale</p>
                            </div>
                            {flujo && (
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                    <div className="nx-tone-positive-bg rounded-control p-4">
                                        <p className="nx-canvas-muted flex items-center gap-1 text-[11px] uppercase tracking-wider"><TrendingUp size={12} className="nx-tone-positive" aria-hidden="true" /> Entró</p>
                                        <p className="nx-tone-positive mt-0.5 font-mono text-xl font-bold tabular-nums sm:text-2xl">{C(flujo.entradasTotal)}</p>
                                    </div>
                                    <div className="nx-tone-danger-bg rounded-control p-4">
                                        <p className="nx-canvas-muted flex items-center gap-1 text-[11px] uppercase tracking-wider"><TrendingDown size={12} className="nx-tone-danger" aria-hidden="true" /> Salió</p>
                                        <p className="nx-tone-danger mt-0.5 font-mono text-xl font-bold tabular-nums sm:text-2xl">{C(flujo.salidasTotal)}</p>
                                    </div>
                                    <div className="rounded-control border border-[var(--nx-canvas-border)] bg-[var(--nx-canvas-subtle)] p-4">
                                        <p className="nx-canvas-muted text-[11px] uppercase tracking-wider">Flujo neto</p>
                                        <p className={`mt-0.5 font-mono text-xl font-bold tabular-nums sm:text-2xl ${netoCls(flujo.flujoNeto)}`}>{signedC(flujo.flujoNeto)}</p>
                                    </div>
                                </div>
                            )}
                        </div>

                        {flujoBusy && !flujo ? (
                            <div className="nx-canvas-card flex items-center justify-center p-12"><Loader2 className="nx-tone-positive animate-spin" /></div>
                        ) : !flujo ? (
                            <div className="nx-canvas-card nx-canvas-faint p-10 text-center text-sm">No se pudo cargar el flujo de efectivo.</div>
                        ) : (
                            <>
                                {/* Estado resumido: saldo inicial → secciones → saldo final */}
                                <div className="nx-canvas-card p-5">
                                    <div className="flex items-center justify-between py-2">
                                        <span className="nx-canvas-muted text-sm">Saldo inicial de efectivo</span>
                                        <span className="nx-canvas-text font-mono tabular-nums">{C(flujo.saldoInicial)}</span>
                                    </div>
                                    {FLUJO_SECCIONES.map(({ key, label }) => (
                                        <div key={key} className="flex items-center justify-between border-t border-[var(--nx-canvas-border)] py-2">
                                            <span className="nx-canvas-muted text-sm">{label}</span>
                                            <span className={`font-mono tabular-nums ${netoCls(flujo.secciones[key].neto)}`}>{signedC(flujo.secciones[key].neto)}</span>
                                        </div>
                                    ))}
                                    <div className="mt-1 flex items-center justify-between border-t-2 border-[var(--nx-canvas-border)] py-2.5">
                                        <span className="nx-canvas-text font-semibold">Saldo final de efectivo</span>
                                        <span className="nx-canvas-text font-mono text-lg font-bold tabular-nums">{C(flujo.saldoFinal)}</span>
                                    </div>
                                </div>

                                {/* Detalle por sección */}
                                {FLUJO_SECCIONES.map(({ key, label }) => {
                                    const sec = flujo.secciones[key];
                                    if (!sec.conceptos.length) return null;
                                    return (
                                        <div key={key} className="nx-canvas-card p-5">
                                            <div className="flex items-center justify-between mb-3">
                                                <h3 className="nx-canvas-text text-sm font-semibold">{label}</h3>
                                                <span className={`font-mono text-sm tabular-nums ${netoCls(sec.neto)}`}>{signedC(sec.neto)}</span>
                                            </div>
                                            <div className="space-y-1">
                                                {sec.conceptos.map((c, i) => (
                                                    <div key={i} className="flex items-center justify-between rounded-control px-3 py-1.5 hover:bg-[var(--nx-canvas-subtle)]">
                                                        <span className="nx-canvas-muted flex items-center gap-2 text-sm">
                                                            {c.neto >= 0 ? <TrendingUp size={13} className="nx-tone-positive shrink-0" /> : <TrendingDown size={13} className="nx-tone-danger shrink-0" />}
                                                            {c.label}
                                                        </span>
                                                        <span className={`font-mono text-sm tabular-nums ${netoCls(c.neto)}`}>{signedC(c.neto)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}

                                {flujo.entradasTotal === 0 && flujo.salidasTotal === 0 && (
                                    <div className="nx-canvas-card nx-canvas-faint p-10 text-center text-sm">Sin movimientos de efectivo en {MESES[m - 1]} {y}.</div>
                                )}
                            </>
                        )}
                    </div>
                )}

                {/* ── ASIENTO MANUAL ── */}
                {tab === 'asiento' && (
                    <div className="nx-canvas-card p-4 sm:p-6">
                        {accountsBusy && (
                            <div role="status" className="nx-canvas-muted mb-4 flex items-center gap-2 rounded-control border border-[var(--nx-canvas-border)] bg-[var(--nx-canvas-subtle)] px-4 py-3 text-sm">
                                <Loader2 size={16} className="nx-tone-positive animate-spin" aria-hidden="true" /> Cargando catálogo de cuentas…
                            </div>
                        )}
                        {accountsError && (
                            <div role="alert" className="nx-tone-danger-bg nx-tone-danger mb-4 rounded-control px-4 py-3 text-sm">
                                {accountsError}
                            </div>
                        )}
                        <div className="grid sm:grid-cols-3 gap-4 mb-4">
                            <div>
                                <label htmlFor="accounting-entry-date" className="nx-canvas-muted mb-1.5 block text-[11px] font-semibold uppercase tracking-wider">Fecha</label>
                                <input type="date" value={entryDate} onChange={e => setEntryDate(e.target.value)}
                                    id="accounting-entry-date" className={`${inputCls} font-mono`} />
                            </div>
                            <div className="sm:col-span-2">
                                <p className="nx-canvas-muted mb-1.5 text-[11px] font-semibold uppercase tracking-wider">Tipo</p>
                                <div className="flex gap-2">
                                    {(['MANUAL', 'OPENING'] as const).map(t => (
                                        <button key={t} type="button" onClick={() => setTipo(t)} aria-pressed={tipo === t}
                                            className={`nx-fluid-press min-h-tap flex-1 rounded-control border px-3 py-2 text-sm font-semibold transition-colors ${tipo === t ? 'nx-tone-positive-bg nx-tone-positive' : 'nx-canvas-muted border-[var(--nx-canvas-border)] bg-[var(--nx-canvas-raised)] hover:bg-[var(--nx-canvas-subtle)] hover:text-[var(--nx-canvas-text)]'}`}>
                                            {t === 'MANUAL' ? 'Ajuste manual' : 'Saldos de apertura'}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div className="mb-4">
                            <label htmlFor="accounting-entry-description" className="nx-canvas-muted mb-1.5 block text-[11px] font-semibold uppercase tracking-wider">Descripción / Concepto</label>
                            <input value={descripcion} onChange={e => setDescripcion(e.target.value)} placeholder="Ej: Provisión de servicios de luz de junio"
                                id="accounting-entry-description" className={inputCls} />
                        </div>

                        <div className="space-y-2">
                            <div className="nx-canvas-faint hidden grid-cols-[minmax(0,1fr)_120px_120px_44px] gap-2 px-1 text-[10px] font-bold uppercase tracking-wider sm:grid">
                                <span>Cuenta</span><span className="text-right">Debe</span><span className="text-right">Haber</span><span />
                            </div>
                            {lines.map((l, i) => (
                                <div key={i} className="grid grid-cols-2 items-end gap-2 rounded-control border border-[var(--nx-canvas-border)] bg-[var(--nx-canvas-subtle)] p-3 sm:grid-cols-[minmax(0,1fr)_120px_120px_44px] sm:border-0 sm:bg-transparent sm:p-0">
                                    <label className="col-span-2 sm:col-span-1">
                                        <span className="nx-canvas-faint mb-1 block text-[10px] font-bold uppercase tracking-wider sm:sr-only">Cuenta</span>
                                        <select aria-label={`Cuenta de la línea ${i + 1}`} value={l.accountCode} onChange={e => setLine(i, { accountCode: e.target.value })}
                                            className={`${inputCls} text-sm`}>
                                            <option value="">— cuenta —</option>
                                            {accounts.map(a => <option key={a.id} value={a.code}>{a.code} · {a.name}</option>)}
                                        </select>
                                    </label>
                                    <label>
                                        <span className="nx-canvas-faint mb-1 block text-[10px] font-bold uppercase tracking-wider sm:sr-only">Debe</span>
                                        <input aria-label={`Debe de la línea ${i + 1}`} inputMode="decimal" value={l.debit} placeholder="0.00"
                                            onChange={e => setLine(i, { debit: sanitizeDecimalInput(e.target.value), credit: '' })}
                                            className={`${inputCls} text-right font-mono text-sm tabular-nums`} />
                                    </label>
                                    <label>
                                        <span className="nx-canvas-faint mb-1 block text-[10px] font-bold uppercase tracking-wider sm:sr-only">Haber</span>
                                        <input aria-label={`Haber de la línea ${i + 1}`} inputMode="decimal" value={l.credit} placeholder="0.00"
                                            onChange={e => setLine(i, { credit: sanitizeDecimalInput(e.target.value), debit: '' })}
                                            className={`${inputCls} text-right font-mono text-sm tabular-nums`} />
                                    </label>
                                    <button type="button" onClick={() => setLines(prev => prev.length > 2 ? prev.filter((_, idx) => idx !== i) : prev)}
                                        className="nx-fluid-press nx-canvas-faint flex h-touch w-touch items-center justify-center rounded-control transition-colors hover:bg-[var(--nx-canvas-raised)] hover:text-[var(--nx-danger)]"
                                        aria-label={`Quitar línea ${i + 1}`}><Trash2 size={16} aria-hidden="true" /></button>
                                </div>
                            ))}
                        </div>

                        <button type="button" onClick={() => setLines(prev => [...prev, { accountCode: '', debit: '', credit: '' }])}
                            className="btn-ghost nx-fluid-press nx-canvas-text mt-3 inline-flex min-h-tap items-center gap-1.5 text-xs"><Plus size={14} /> Agregar línea</button>

                        <div className="mt-5 flex flex-col gap-4 border-t border-[var(--nx-canvas-border)] pt-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex flex-wrap gap-x-6 gap-y-2 font-mono text-sm tabular-nums">
                                <span className="nx-canvas-muted">Debe: <span className="nx-canvas-text font-bold">{C(totalDebe.toNumber())}</span></span>
                                <span className="nx-canvas-muted">Haber: <span className="nx-canvas-text font-bold">{C(totalHaber.toNumber())}</span></span>
                                <span className={`flex items-center gap-1 font-bold ${balanced ? 'nx-tone-positive' : 'nx-tone-warning'}`}>
                                    {balanced ? <><CheckCircle2 size={15} /> Cuadrado</> : <><AlertTriangle size={15} /> Descuadre {C(totalDebe.minus(totalHaber).abs().toNumber())}</>}
                                </span>
                            </div>
                            <button onClick={submitEntry} disabled={posting || !balanced}
                                className="btn-primary nx-fluid-press flex min-h-tap w-full items-center justify-center gap-2 px-6 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 sm:w-auto">
                                {posting ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle2 size={18} />} Registrar
                            </button>
                        </div>

                        {postMsg && (
                            <div className={`mt-4 rounded-control px-4 py-3 text-sm ${postMsg.ok ? 'nx-tone-positive-bg nx-tone-positive' : 'nx-tone-danger-bg nx-tone-danger'}`}>
                                {postMsg.text}
                            </div>
                        )}
                    </div>
                )}

                {/* ── PERÍODO PICKER (diario/balanza) ── */}
                {(tab === 'diario' || tab === 'balanza') && (
                    <div className="flex items-center gap-2 mb-4">
                        <select aria-label="Mes contable" value={m} onChange={e => setM(Number(e.target.value))} className={`${inputCls} w-auto text-sm`}>
                            {MESES.map((mes, i) => <option key={i} value={i + 1}>{mes}</option>)}
                        </select>
                        <select aria-label="Año contable" value={y} onChange={e => setY(Number(e.target.value))} className={`${inputCls} w-auto font-mono text-sm`}>
                            {[0, 1, 2, 3].map(d => { const yr = todayCivil.year - d; return <option key={yr} value={yr}>{yr}</option>; })}
                        </select>
                        {busy && <Loader2 className="nx-tone-positive animate-spin" size={18} />}
                    </div>
                )}

                {/* ── LIBRO DIARIO ── */}
                {tab === 'diario' && diario && (
                    <div className="nx-canvas-card p-4 sm:p-6">
                        {diario.locked && (
                            <div className="nx-tone-warning-bg nx-tone-warning mb-4 flex items-center gap-2 rounded-control px-4 py-2 text-sm">
                                <Lock size={15} /> Período cerrado — solo lectura.
                            </div>
                        )}
                        {diario.asientos.length === 0 ? (
                            <p className="nx-canvas-faint py-8 text-center text-sm">Sin asientos en este período.</p>
                        ) : (
                            <div className="space-y-4">
                                {diario.asientos.map(a => (
                                    <div key={a.id} className="border-b border-[var(--nx-canvas-border)] pb-3 last:border-0">
                                        <div className="flex items-center justify-between text-xs mb-1.5">
                                            <span className="nx-canvas-muted font-mono">#{a.numero} · {new Date(a.fecha).toLocaleDateString('es-NI')}</span>
                                            <span className={`rounded-pill px-2 py-0.5 text-[10px] font-bold ${a.esManual ? 'nx-tone-positive-bg nx-tone-positive' : 'nx-canvas-faint border border-[var(--nx-canvas-border)] bg-[var(--nx-canvas-subtle)]'}`}>{a.esManual ? a.tipo : 'AUTO'}</span>
                                        </div>
                                        <p className="nx-canvas-text mb-2 text-sm">{a.descripcion}</p>
                                        <div className="overflow-x-auto">
                                        <table className="table-premium w-full min-w-[520px]">
                                            <tbody>
                                                {a.lineas.map((l, idx) => (
                                                    <tr key={idx}>
                                                        <td className="nx-canvas-muted">{l.cuenta} · {l.nombre}</td>
                                                        <td className="nx-tone-positive num text-right">{l.debe > 0 ? C(l.debe) : ''}</td>
                                                        <td className="nx-tone-info num text-right">{l.haber > 0 ? C(l.haber) : ''}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                        </div>
                                    </div>
                                ))}
                                <div className="nx-canvas-text flex flex-wrap justify-end gap-3 pt-2 font-mono text-sm font-bold tabular-nums sm:gap-6">
                                    <span>Σ Debe: {C(diario.totalDebe)}</span>
                                    <span>Σ Haber: {C(diario.totalHaber)}</span>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* ── BALANZA / MAYOR ── */}
                {tab === 'balanza' && (
                    mayor ? (
                        <div className="nx-canvas-card p-4 sm:p-6">
                            <button onClick={() => setMayor(null)} className="btn-ghost nx-fluid-press nx-canvas-text mb-4 inline-flex min-h-tap items-center gap-1.5 text-xs"><ArrowLeft size={14} /> Volver a la balanza</button>
                            <h3 className="nx-canvas-text mb-1 font-bold">{mayor.cuenta} · {mayor.nombre}</h3>
                            <p className="nx-canvas-muted mb-4 font-mono text-xs">Saldo inicial: {C(mayor.saldoInicial)} → Saldo final: {C(mayor.saldoFinal)}</p>
                            <div className="overflow-x-auto">
                            <table className="table-premium w-full min-w-[680px]">
                                <thead><tr><th>Fecha</th><th>Concepto</th><th className="text-right">Debe</th><th className="text-right">Haber</th><th className="text-right">Saldo</th></tr></thead>
                                <tbody>
                                    {mayor.movimientos.map((mv, i) => (
                                        <tr key={i}>
                                            <td className="nx-canvas-muted num">{new Date(mv.fecha).toLocaleDateString('es-NI')}</td>
                                            <td className="nx-canvas-muted">{mv.descripcion}</td>
                                            <td className="nx-tone-positive num text-right">{mv.debe > 0 ? C(mv.debe) : ''}</td>
                                            <td className="nx-tone-info num text-right">{mv.haber > 0 ? C(mv.haber) : ''}</td>
                                            <td className="nx-canvas-text num text-right font-bold">{C(mv.saldo)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            </div>
                        </div>
                    ) : balanza && (
                        <div className="nx-canvas-card overflow-x-auto p-4 sm:p-6">
                            <p className="nx-canvas-faint mb-3 flex items-center gap-1.5 text-[11px]"><ListTree size={13} /> Clic en una cuenta para ver su mayor (movimientos).</p>
                            <table className="table-premium w-full min-w-[720px]">
                                <thead><tr><th>Cuenta</th><th className="text-right">Saldo inicial</th><th className="text-right">Debe</th><th className="text-right">Haber</th><th className="text-right">Saldo final</th></tr></thead>
                                <tbody>
                                    {balanza.balanza.map(b => (
                                        <tr key={b.cuenta} onClick={() => loadMayor(b.cuenta)} className="cursor-pointer transition-colors hover:bg-[var(--nx-canvas-subtle)]">
                                            <td className="nx-canvas-muted"><span className="nx-canvas-faint font-mono">{b.cuenta}</span> · {b.nombre}</td>
                                            <td className="nx-canvas-muted num text-right">{C(b.saldoInicial)}</td>
                                            <td className="nx-tone-positive num text-right">{b.debe > 0 ? C(b.debe) : ''}</td>
                                            <td className="nx-tone-info num text-right">{b.haber > 0 ? C(b.haber) : ''}</td>
                                            <td className="nx-canvas-text num text-right font-bold">{C(b.saldoFinal)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot><tr className="border-t border-[var(--nx-canvas-border)]"><td className="nx-canvas-muted pt-2 font-bold">Totales movimiento</td><td /><td className="nx-canvas-text num pt-2 text-right font-bold">{C(balanza.totales.debe)}</td><td className="nx-canvas-text num pt-2 text-right font-bold">{C(balanza.totales.haber)}</td><td /></tr></tfoot>
                            </table>
                        </div>
                    )
                )}

                {/* ── PERÍODOS ── */}
                {tab === 'periodos' && (
                    <div className="nx-canvas-card p-4 sm:p-6">
                        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                            <div className="flex items-center gap-2">
                                <select aria-label="Mes a gestionar" value={m} onChange={e => setM(Number(e.target.value))} className={`${inputCls} w-auto text-sm`}>
                                    {MESES.map((mes, i) => <option key={i} value={i + 1}>{mes}</option>)}
                                </select>
                                <select aria-label="Año a gestionar" value={y} onChange={e => setY(Number(e.target.value))} className={`${inputCls} w-auto font-mono text-sm`}>
                                    {[0, 1, 2].map(d => { const yr = todayCivil.year - d; return <option key={yr} value={yr}>{yr}</option>; })}
                                </select>
                            </div>
                            {canManagePeriods ? (
                                <button
                                    type="button"
                                    onClick={(event) => openDecisionDialog({ kind: 'close-period', month: m, year: y }, event.currentTarget)}
                                    className="btn-primary nx-fluid-press inline-flex min-h-tap items-center gap-2"
                                >
                                    <Lock size={16} /> Cerrar {MESES[m - 1]} {y}
                                </button>
                            ) : (
                                <span className="nx-canvas-muted inline-flex min-h-tap items-center gap-2 rounded-control border border-[var(--nx-canvas-border)] bg-[var(--nx-canvas-subtle)] px-3 py-2 text-xs">
                                    <ShieldCheck size={14} className="nx-tone-positive" /> Solo el propietario o la administración pueden cerrar períodos
                                </span>
                            )}
                        </div>
                        {periodsBusy && (
                            <div role="status" className="nx-canvas-muted flex items-center justify-center gap-2 py-8 text-sm">
                                <Loader2 size={17} className="nx-tone-positive animate-spin" aria-hidden="true" /> Cargando períodos…
                            </div>
                        )}
                        {periodsError && (
                            <div role="alert" className="nx-tone-danger-bg nx-tone-danger mb-4 flex flex-wrap items-center justify-between gap-3 rounded-control px-4 py-3 text-sm">
                                <span>{periodsError}</span>
                                <button type="button" onClick={() => void loadPeriods()} className="nx-fluid-press min-h-tap font-semibold underline underline-offset-4">Reintentar</button>
                            </div>
                        )}
                        {!periodsBusy && !periodsError && periods.length === 0 ? (
                            <p className="nx-canvas-faint py-6 text-center text-sm">Ningún período cerrado todavía. Al cerrar un mes, las cifras de la DGI quedan congeladas.</p>
                        ) : !periodsBusy && !periodsError ? (
                            <div className="space-y-2">
                                {periods.map(p => (
                                    <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-[var(--nx-canvas-border)] bg-[var(--nx-canvas-subtle)] px-4 py-3">
                                        <div className="flex items-center gap-3">
                                            {p.status === 'CLOSED'
                                                ? <span className="nx-tone-warning-bg nx-tone-warning flex h-9 w-9 items-center justify-center rounded-control"><Lock size={16} /></span>
                                                : <span className="nx-tone-positive-bg nx-tone-positive flex h-9 w-9 items-center justify-center rounded-control"><Unlock size={16} /></span>}
                                            <div>
                                                <p className="nx-canvas-text font-mono font-semibold">{MESES[p.month - 1]} {p.year}</p>
                                                <p className="nx-canvas-faint text-[11px]">{p.status === 'CLOSED' ? `Cerrado${p.closedAt ? ' · ' + new Date(p.closedAt).toLocaleDateString('es-NI') : ''}` : `Reabierto — ${p.reopenReason || 's/motivo'}`}</p>
                                            </div>
                                        </div>
                                        {p.status === 'CLOSED' && canManagePeriods && (
                                            <button
                                                type="button"
                                                onClick={(event) => openDecisionDialog({ kind: 'reopen-period', period: p }, event.currentTarget)}
                                                className="btn-ghost nx-fluid-press nx-canvas-text inline-flex min-h-tap items-center gap-1.5 text-xs"
                                            >
                                                <Unlock size={13} /> Reabrir
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : null}
                    </div>
                )}

                {/* ── RETENCIONES SUFRIDAS (B1) ── */}
                {tab === 'retenciones' && (
                    <div className="space-y-6">
                        <div className="nx-canvas-card p-4 sm:p-6">
                            <h3 className="nx-canvas-text mb-1 flex items-center gap-2 font-bold"><Receipt size={18} className="nx-tone-positive" /> Registrar retención sufrida</h3>
                            <p className="nx-canvas-muted mb-4 text-xs">Cuando una empresa o el Estado te retiene IR 2% / IMI 1% al pagarte, es <strong className="nx-tone-positive">crédito contra tu anticipo del mes</strong>. Regístralo aquí para no pagar de más.</p>
                            <div className="grid sm:grid-cols-2 gap-3">
                                <label className="nx-canvas-muted block text-[11px] uppercase tracking-wider sm:col-span-2">
                                    Factura a crédito abierta
                                    <select
                                        value={ret.saleId}
                                        onChange={event => selectRetentionSale(event.target.value)}
                                        disabled={openCreditSalesBusy}
                                        className={`${inputCls} mt-1.5 normal-case disabled:cursor-wait disabled:opacity-60`}
                                    >
                                        <option value="">
                                            {openCreditSalesBusy
                                                ? 'Cargando facturas abiertas…'
                                                : openCreditSales.length === 0
                                                    ? 'No hay facturas con saldo pendiente'
                                                    : 'Seleccioná una factura abierta'}
                                        </option>
                                        {openCreditSales.map(sale => (
                                            <option key={sale.saleId} value={sale.saleId}>
                                                {sale.invoiceNumber ? `Factura #${sale.invoiceNumber}` : `Venta del ${new Date(sale.date).toLocaleDateString('es-NI')}`} · {sale.customerName} · saldo {C(sale.balance)}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                {openCreditSalesError && (
                                    <div role="alert" className="nx-tone-danger-bg nx-tone-danger flex flex-wrap items-center justify-between gap-2 rounded-control px-3 py-2 text-xs sm:col-span-2">
                                        <span>{openCreditSalesError}</span>
                                        <button type="button" onClick={() => void loadOpenCreditSales()} className="nx-fluid-press min-h-tap font-semibold underline underline-offset-4">Reintentar</button>
                                    </div>
                                )}
                                <label className="nx-canvas-muted block text-[11px] uppercase tracking-wider">
                                    Fecha de retención
                                    <input type="date" value={ret.fecha} onChange={e => setRet({ ...ret, fecha: e.target.value })} className={`${inputCls} mt-1.5 font-mono`} />
                                </label>
                                <label className="nx-canvas-muted block text-[11px] uppercase tracking-wider">
                                    Tipo de retención
                                    <select value={ret.tipo} onChange={e => setRet({ ...ret, tipo: e.target.value })} className={`${inputCls} mt-1.5`}>
                                        <option value="IR_2">IR 2% (renta)</option>
                                        <option value="IMI_1">IMI 1% (alcaldía)</option>
                                    </select>
                                </label>
                                <label className="nx-canvas-muted block text-[11px] uppercase tracking-wider sm:col-span-2">
                                    Cliente retenedor
                                    <input value={ret.clienteRetenedor} onChange={e => setRet({ ...ret, clienteRetenedor: e.target.value })} placeholder="Ej: SINSA S.A." className={`${inputCls} mt-1.5 normal-case`} />
                                </label>
                                <label className="nx-canvas-muted block text-[11px] uppercase tracking-wider">
                                    Base (monto facturado)
                                    <input inputMode="decimal" value={ret.baseAmount} onChange={e => setRet({ ...ret, baseAmount: sanitizeDecimalInput(e.target.value) })} placeholder="0.00" className={`${inputCls} mt-1.5 text-right font-mono tabular-nums`} />
                                </label>
                                <label className="nx-canvas-muted block text-[11px] uppercase tracking-wider">
                                    Retenido {ret.amount ? '' : <span className="nx-canvas-faint">(auto {C(retAmountAuto)})</span>}
                                    <input inputMode="decimal" value={ret.amount} onChange={e => setRet({ ...ret, amount: sanitizeDecimalInput(e.target.value) })} placeholder={retAmountAuto.toFixed(2)} className={`${inputCls} mt-1.5 text-right font-mono tabular-nums`} />
                                </label>
                                <label className="nx-canvas-muted block text-[11px] uppercase tracking-wider sm:col-span-2">
                                    N° de constancia <span className="nx-canvas-faint normal-case">(opcional)</span>
                                    <input value={ret.numeroConstancia} onChange={e => setRet({ ...ret, numeroConstancia: e.target.value })} className={`${inputCls} mt-1.5 font-mono`} />
                                </label>
                            </div>
                            {retMsg && <div className={`mt-3 rounded-control px-4 py-2.5 text-sm ${retMsg.ok ? 'nx-tone-positive-bg nx-tone-positive' : 'nx-tone-danger-bg nx-tone-danger'}`}>{retMsg.text}</div>}
                            <button type="button" onClick={() => void submitRet()} disabled={savingRet} className="btn-primary nx-fluid-press mt-4 inline-flex min-h-tap items-center gap-2 disabled:opacity-50">
                                {savingRet ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Plus size={16} />}
                                {savingRet ? 'Registrando…' : 'Registrar retención'}
                            </button>
                        </div>

                        <div className="nx-canvas-card p-4 sm:p-6">
                            <h3 className="nx-canvas-text mb-3 text-sm font-bold uppercase tracking-wider">Retenciones registradas</h3>
                            {retBusy ? (
                                <div role="status" className="nx-canvas-muted flex items-center justify-center gap-2 py-8 text-sm">
                                    <Loader2 size={17} className="nx-tone-positive animate-spin" aria-hidden="true" /> Cargando retenciones…
                                </div>
                            ) : retError ? (
                                <div role="alert" className="nx-tone-danger-bg nx-tone-danger flex flex-wrap items-center justify-between gap-3 rounded-control px-4 py-3 text-sm">
                                    <span>{retError}</span>
                                    <button type="button" onClick={() => void loadRet()} className="nx-fluid-press min-h-tap font-semibold underline underline-offset-4">Reintentar</button>
                                </div>
                            ) : retList.length === 0 ? <p className="nx-canvas-faint py-4 text-center text-sm">Aún no hay retenciones registradas.</p> : (
                                <div className="overflow-x-auto">
                                <table className="w-full min-w-[620px] table-premium">
                                    <thead><tr><th>Fecha</th><th>Cliente</th><th>Tipo</th><th className="text-right">Base</th><th className="text-right">Retenido</th></tr></thead>
                                    <tbody>
                                        {retList.map(r => (
                                            <tr key={r.id}>
                                                <td className="nx-canvas-muted num">{new Date(r.fecha).toLocaleDateString('es-NI')}</td>
                                                <td className="nx-canvas-muted">{r.clienteRetenedor}{r.numeroConstancia ? <span className="nx-canvas-faint font-mono"> · {r.numeroConstancia}</span> : ''}</td>
                                                <td><span className={`rounded-pill px-2 py-0.5 text-[10px] font-bold ${r.tipo === 'IR_2' ? 'nx-tone-positive-bg nx-tone-positive' : 'nx-tone-warning-bg nx-tone-warning'}`}>{r.tipo === 'IR_2' ? 'IR 2%' : 'IMI 1%'}</span></td>
                                                <td className="nx-canvas-muted num text-right">{C(r.baseAmount)}</td>
                                                <td className="nx-tone-positive num text-right font-bold">{C(r.amount)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ── CONFIG FISCAL + TIPO DE CAMBIO (B4/B6) ── */}
                {tab === 'fiscal' && (
                    <div className="space-y-6">
                        {fiscalBusy && (
                            <div role="status" className="nx-canvas-card nx-canvas-muted flex items-center justify-center gap-2 p-8 text-sm">
                                <Loader2 size={17} className="nx-tone-positive animate-spin" aria-hidden="true" /> Cargando configuración fiscal…
                            </div>
                        )}
                        {fiscalError && (
                            <div role="alert" className="nx-tone-danger-bg nx-tone-danger flex flex-wrap items-center justify-between gap-3 rounded-control px-4 py-3 text-sm">
                                <span>{fiscalError}</span>
                                <button type="button" onClick={() => void loadFiscal()} className="nx-fluid-press min-h-tap font-semibold underline underline-offset-4">Reintentar</button>
                            </div>
                        )}
                        <div className="nx-canvas-card p-4 sm:p-6">
                            <h3 className="nx-canvas-text mb-1 flex items-center gap-2 font-bold"><Percent size={18} className="nx-tone-positive" /> Tasas fiscales del negocio</h3>
                            <p className="nx-canvas-muted mb-4 text-xs">Ajusta según tu contribuyente. Reemplazan los valores por defecto en la declaración mensual y la planilla.</p>
                            <div className="grid sm:grid-cols-2 gap-4">
                                {([
                                    ['inssPatronalRate', 'INSS Patronal %', '21.5 (<50 emp) · 22.5 (≥50)'],
                                    ['anticipoIrRate', 'Anticipo IR / PMD %', '1 a 3 según escala'],
                                    ['imiRate', 'IMI Alcaldía %', 'usualmente 1'],
                                    ['salarioMinimo', 'Salario mínimo C$', 'vigente del sector'],
                                ] as const).map(([key, label, hint]) => (
                                    <div key={key}>
                                        <label className="nx-canvas-muted mb-1.5 block text-[11px] uppercase tracking-wider">{label}</label>
                                        <input inputMode="decimal" value={cfg[key]} onChange={e => setCfg({ ...cfg, [key]: sanitizeDecimalInput(e.target.value) })}
                                            className={`${inputCls} text-right font-mono tabular-nums`} />
                                        <p className="nx-canvas-faint mt-1 text-[10px]">{hint}</p>
                                    </div>
                                ))}
                            </div>
                            {cfgMsg && <p role={cfgMsg.ok ? 'status' : 'alert'} className={`mt-3 text-sm ${cfgMsg.ok ? 'nx-tone-positive' : 'nx-tone-danger'}`}>{cfgMsg.text}</p>}
                            <button type="button" onClick={() => void saveCfg()} disabled={savingCfg} className="btn-primary nx-fluid-press mt-4 inline-flex min-h-tap items-center gap-2 disabled:opacity-50">
                                {savingCfg ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <CheckCircle2 size={16} />}
                                {savingCfg ? 'Guardando…' : 'Guardar tasas'}
                            </button>
                        </div>

                        <div className="nx-canvas-card p-4 sm:p-6">
                            <h3 className="nx-canvas-text mb-1 flex items-center gap-2 font-bold"><Coins size={18} className="nx-tone-positive" /> Tipo de cambio (C$/US$)</h3>
                            <p className="nx-canvas-muted mb-4 text-xs">
                                Vigente: <span className="nx-canvas-text font-mono font-bold">{exLatest.rate ? `${formatMoney(exLatest.rate, 'NIO', { decimals: 4 })}` : '— sin registrar —'}</span>
                                {exLatest.fecha ? <span className="nx-canvas-faint"> (del {new Date(exLatest.fecha).toLocaleDateString('es-NI')})</span> : ''}. El POS lo usa para pagos en dólares.
                            </p>
                            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3">
                                <div className="w-full sm:w-auto">
                                    <label className="nx-canvas-muted mb-1.5 block text-[11px] uppercase tracking-wider">Fecha</label>
                                    <input type="date" value={exDate} onChange={e => setExDate(e.target.value)} className={`${inputCls} font-mono`} />
                                </div>
                                <div className="w-full sm:w-auto">
                                    <label className="nx-canvas-muted mb-1.5 block text-[11px] uppercase tracking-wider">Tasa</label>
                                    <input
                                        inputMode="decimal"
                                        value={exRate}
                                        onChange={e => { setExRate(sanitizeDecimalInput(e.target.value)); setExRateError(''); }}
                                        placeholder="36.6234"
                                        aria-invalid={Boolean(exRateError)}
                                        aria-describedby={exRateError ? 'exchange-rate-error' : undefined}
                                        className={`${inputCls} text-right font-mono tabular-nums sm:w-36 ${exRateError ? 'border-rose-500/60' : ''}`}
                                    />
                                </div>
                                <button type="button" onClick={() => void saveRate()} disabled={savingRate} className="btn-primary nx-fluid-press inline-flex min-h-tap w-full items-center justify-center gap-2 disabled:opacity-50 sm:w-auto">
                                    {savingRate ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Plus size={16} />}
                                    {savingRate ? 'Registrando…' : 'Registrar'}
                                </button>
                            </div>
                            {exRateError && <p id="exchange-rate-error" role="alert" className="nx-tone-danger mt-3 text-sm">{exRateError}</p>}
                        </div>
                    </div>
                )}
                {/* ── ACTIVOS FIJOS (B2) ── */}
                {tab === 'activos' && (
                    <div className="space-y-6">
                        <div className="nx-canvas-card p-4 sm:p-6">
                            <h3 className="nx-canvas-text mb-1 flex items-center gap-2 font-bold"><Landmark size={18} className="nx-tone-positive" /> Registrar activo fijo</h3>
                            <p className="nx-canvas-muted mb-4 text-xs">Se deprecia solo cada mes (línea recta, Ley 822). La cuota baja la utilidad → menos IR.</p>
                            <div className="grid sm:grid-cols-4 gap-3">
                                <input value={newAsset.nombre} onChange={e => setNewAsset({ ...newAsset, nombre: e.target.value })} placeholder="Nombre (ej: Camioneta Hilux)" className={`${inputCls} sm:col-span-2`} />
                                <select value={newAsset.categoria} onChange={e => setNewAsset({ ...newAsset, categoria: e.target.value })} className={inputCls}>
                                    {['EDIFICIO', 'VEHICULO', 'MAQUINARIA', 'MOBILIARIO', 'COMPUTO', 'OTRO'].map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                                <input type="date" value={newAsset.fechaAdquisicion} onChange={e => setNewAsset({ ...newAsset, fechaAdquisicion: e.target.value })} className={`${inputCls} font-mono`} />
                                <input inputMode="decimal" value={newAsset.costo} onChange={e => setNewAsset({ ...newAsset, costo: sanitizeDecimalInput(e.target.value) })} placeholder="Costo C$" className={`${inputCls} text-right font-mono tabular-nums`} />
                                <button type="button" onClick={() => void addAsset()} disabled={addingAsset} className="btn-primary nx-fluid-press inline-flex min-h-tap items-center justify-center gap-2 disabled:opacity-50 sm:col-span-3">
                                    {addingAsset ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Plus size={16} />}
                                    {addingAsset ? 'Registrando…' : 'Agregar activo'}
                                </button>
                            </div>
                            {assetFormError && <p role="alert" className="nx-tone-danger mt-3 text-sm">{assetFormError}</p>}
                        </div>

                        <div className="nx-canvas-card p-4 sm:p-6">
                            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                                <h3 className="nx-canvas-text text-sm font-bold uppercase tracking-wider">Activos registrados</h3>
                                <button type="button" onClick={() => void runDep()} disabled={depreciationBusy} className="btn-ghost nx-fluid-press nx-canvas-text inline-flex min-h-tap items-center gap-1.5 text-xs disabled:opacity-50">
                                    {depreciationBusy ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Play size={13} />}
                                    {depreciationBusy ? 'Corriendo…' : 'Correr depreciación del mes'}
                                </button>
                            </div>
                            {depMsg && <p role={depMsg.ok ? 'status' : 'alert'} className={`mb-2 text-xs ${depMsg.ok ? 'nx-tone-positive' : 'nx-tone-danger'}`}>{depMsg.text}</p>}
                            {assetsBusy ? (
                                <div role="status" className="nx-canvas-muted flex items-center justify-center gap-2 py-8 text-sm">
                                    <Loader2 size={17} className="nx-tone-positive animate-spin" aria-hidden="true" /> Cargando activos…
                                </div>
                            ) : assetsError ? (
                                <div role="alert" className="nx-tone-danger-bg nx-tone-danger flex flex-wrap items-center justify-between gap-3 rounded-control px-4 py-3 text-sm">
                                    <span>{assetsError}</span>
                                    <button type="button" onClick={() => void loadAssets()} className="nx-fluid-press min-h-tap font-semibold underline underline-offset-4">Reintentar</button>
                                </div>
                            ) : assets.length === 0 ? <p className="nx-canvas-faint py-4 text-center text-sm">Sin activos registrados.</p> : (
                                <div className="overflow-x-auto">
                                <table className="w-full min-w-[720px] table-premium">
                                    <thead><tr><th>Activo</th><th>Categoría</th><th className="text-right">Costo</th><th className="text-right">Deprec. acum.</th><th className="text-right">Valor libros</th><th /></tr></thead>
                                    <tbody>
                                        {assets.map(a => (
                                            <tr key={a.id} className={a.estado === 'BAJA' ? 'opacity-40' : ''}>
                                                <td className="nx-canvas-text">{a.nombre}</td>
                                                <td className="nx-canvas-muted text-xs">{a.categoria} · {a.mesesDepreciados}/{a.vidaUtilMeses}m</td>
                                                <td className="nx-canvas-muted num text-right">{C(a.costo)}</td>
                                                <td className="nx-tone-warning num text-right">{C(a.depreciacionAcumulada)}</td>
                                                <td className="nx-canvas-text num text-right font-bold">{C(a.valorEnLibros)}</td>
                                                <td className="text-right">{a.estado === 'ACTIVO' && (
                                                    <button
                                                        type="button"
                                                        onClick={(event) => openDecisionDialog({ kind: 'retire-asset', asset: a }, event.currentTarget)}
                                                        className="nx-fluid-press nx-canvas-faint flex h-touch w-touch items-center justify-center rounded-control transition-colors hover:bg-[var(--nx-danger-bg)] hover:text-[var(--nx-danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/60"
                                                        aria-label={`Dar de baja ${a.nombre}`}
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                )}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ── RENTA ANUAL (B3) ── */}
                {tab === 'renta' && (
                    <div className="space-y-4">
                        <div className="flex items-center gap-2">
                            <select aria-label="Año de la declaración" value={rentaYear} onChange={e => setRentaYear(Number(e.target.value))} className={`${inputCls} w-auto font-mono text-sm`}>
                                {[0, 1, 2, 3].map(d => { const yr = todayCivil.year - d; return <option key={yr} value={yr}>{yr}</option>; })}
                            </select>
                            {busy && <Loader2 className="nx-tone-positive animate-spin" size={18} />}
                        </div>
                        {renta && (
                            <div className="nx-canvas-card p-5 sm:p-6">
                                <h3 className="nx-canvas-text mb-4 flex items-center gap-2 font-bold"><FileBarChart size={18} className="nx-tone-positive" /> Declaración anual de IR · {renta.year}</h3>
                                <div className="space-y-1.5 font-mono tabular-nums text-sm">
                                    <div className="nx-canvas-muted flex justify-between gap-4"><span>Ingresos netos (sin IVA)</span><span>{C(renta.ingresosNetos)}</span></div>
                                    <div className="nx-canvas-muted flex justify-between gap-4"><span>(−) Costo de ventas</span><span>{C(renta.costoVentas)}</span></div>
                                    <div className="nx-canvas-muted flex justify-between gap-4"><span>(−) Gastos del período</span><span>{C(renta.gastos)}</span></div>
                                    <div className="nx-canvas-text flex justify-between gap-4 border-t border-[var(--nx-canvas-border)] pt-1.5 font-bold"><span>= Utilidad fiscal</span><span>{C(renta.utilidadFiscal)}</span></div>
                                    <div className="h-2" />
                                    <div className="nx-canvas-muted flex justify-between gap-4"><span>IR sobre renta (30%)</span><span>{C(renta.irSobreRenta)}</span></div>
                                    <div className="nx-canvas-muted flex justify-between gap-4"><span>Pago Mínimo Definitivo ({(renta.pmdRate * 100).toFixed(1)}%)</span><span>{C(renta.pagoMinimoDefinitivo)}</span></div>
                                    <div className="nx-canvas-text flex justify-between gap-4 font-bold"><span>= Impuesto del ejercicio (el mayor)</span><span>{C(renta.impuestoDelEjercicio)}</span></div>
                                    <div className="h-2" />
                                    <div className="nx-tone-positive flex justify-between gap-4"><span>(−) Anticipos IR enterados</span><span>{C(renta.anticiposEnterados)}</span></div>
                                    <div className="nx-tone-positive flex justify-between gap-4"><span>(−) Retenciones IR sufridas</span><span>{C(renta.retencionesSufridasIR)}</span></div>
                                    <div className={`mt-1 flex justify-between gap-4 border-t border-[var(--nx-canvas-border)] pt-2 text-lg font-black ${renta.saldoAPagar > 0 ? 'nx-tone-danger' : 'nx-tone-positive'}`}>
                                        <span>{renta.saldoAPagar > 0 ? 'SALDO A PAGAR' : 'SALDO A FAVOR'}</span>
                                        <span>{C(renta.saldoAPagar > 0 ? renta.saldoAPagar : renta.saldoAFavor)}</span>
                                    </div>
                                </div>
                                <p className="nx-canvas-faint mt-4 text-[11px]">IR-1 — vence el 31 de marzo de {renta.year + 1}. Revisar con el contador antes de presentar.</p>
                            </div>
                        )}
                    </div>
                )}

                {decisionDialog && (
                    <div
                        className="nx-overlay-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
                        onMouseDown={(event) => {
                            if (event.target === event.currentTarget) dismissDecisionDialog();
                        }}
                    >
                        <div
                            ref={decisionDialogRef}
                            role="alertdialog"
                            aria-modal="true"
                            aria-labelledby="accounting-decision-title"
                            aria-describedby="accounting-decision-description"
                            tabIndex={-1}
                            className="nx-overlay-dialog w-full max-w-lg overflow-hidden rounded-card"
                        >
                            <div className="flex items-start justify-between gap-4 border-b border-[var(--nx-canvas-border)] px-5 py-4 sm:px-6">
                                <div className="flex items-start gap-3">
                                    <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-control ${decisionDialog.kind === 'retire-asset' ? 'nx-tone-danger-bg nx-tone-danger' : decisionDialog.kind === 'reopen-period' ? 'nx-tone-positive-bg nx-tone-positive' : 'nx-tone-warning-bg nx-tone-warning'}`}>
                                        {decisionDialog.kind === 'retire-asset' ? <Trash2 size={19} aria-hidden="true" /> : decisionDialog.kind === 'reopen-period' ? <Unlock size={19} aria-hidden="true" /> : <Lock size={19} aria-hidden="true" />}
                                    </span>
                                    <div>
                                        <h2 id="accounting-decision-title" className="nx-canvas-text text-lg font-bold">
                                            {decisionDialog.kind === 'close-period'
                                                ? `Cerrar ${MESES[decisionDialog.month - 1]} ${decisionDialog.year}`
                                                : decisionDialog.kind === 'reopen-period'
                                                    ? `Reabrir ${MESES[decisionDialog.period.month - 1]} ${decisionDialog.period.year}`
                                                    : `Dar de baja ${decisionDialog.asset.nombre}`}
                                        </h2>
                                        <p className="nx-canvas-faint mt-1 text-xs">Esta decisión quedará registrada en la auditoría.</p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={dismissDecisionDialog}
                                    disabled={decisionBusy}
                                    className="nx-fluid-press nx-canvas-muted flex h-touch w-touch items-center justify-center rounded-control transition-colors hover:bg-[var(--nx-canvas-subtle)] hover:text-[var(--nx-canvas-text)] disabled:opacity-40"
                                    aria-label="Cerrar confirmación"
                                >
                                    <X size={18} />
                                </button>
                            </div>

                            <div className="space-y-4 px-5 py-5 sm:px-6">
                                <p id="accounting-decision-description" className="nx-canvas-muted text-sm leading-6">
                                    {decisionDialog.kind === 'close-period' ? (
                                        <>Los libros y cifras DGI del período quedarán congelados. No se podrán registrar movimientos con esas fechas hasta una reapertura autorizada.</>
                                    ) : decisionDialog.kind === 'reopen-period' ? (
                                        <>El período volverá a admitir movimientos. Indicá por qué se necesita reabrirlo para conservar una trazabilidad clara.</>
                                    ) : (
                                        <>El activo dejará de depreciarse y se registrará su salida contable por un valor en libros de <strong className="nx-canvas-text">{C(decisionDialog.asset.valorEnLibros)}</strong>. Esta acción no se puede deshacer desde esta pantalla.</>
                                    )}
                                </p>

                                {decisionDialog.kind === 'reopen-period' && (
                                    <div>
                                        <label htmlFor="reopen-period-reason" className="nx-canvas-muted mb-1.5 block text-[11px] font-semibold uppercase tracking-wider">
                                            Motivo de reapertura
                                        </label>
                                        <textarea
                                            ref={reopenReasonRef}
                                            id="reopen-period-reason"
                                            value={reopenReason}
                                            onChange={(event) => { setReopenReason(event.target.value); setDecisionError(''); }}
                                            rows={4}
                                            maxLength={500}
                                            required
                                            aria-invalid={Boolean(decisionError)}
                                            aria-describedby={`reopen-period-help${decisionError ? ' accounting-decision-error' : ''}`}
                                            placeholder="Ej: corregir una factura contabilizada en el mes equivocado"
                                            className={`${inputCls} resize-none ${decisionError ? 'border-rose-500/60' : ''}`}
                                        />
                                        <div id="reopen-period-help" className="nx-canvas-faint mt-1.5 flex items-center justify-between gap-3 text-[11px]">
                                            <span>Mínimo 3 caracteres · queda auditado</span>
                                            <span>{reopenReason.length}/500</span>
                                        </div>
                                    </div>
                                )}

                                {decisionError && (
                                    <div id="accounting-decision-error" role="alert" className="nx-tone-danger-bg nx-tone-danger flex items-start gap-2 rounded-control px-3 py-2.5 text-sm">
                                        <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                                        <span>{decisionError}</span>
                                    </div>
                                )}

                                <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:justify-end">
                                    <button
                                        ref={decisionSafeActionRef}
                                        type="button"
                                        onClick={dismissDecisionDialog}
                                        disabled={decisionBusy}
                                        className="btn-ghost nx-fluid-press nx-canvas-text min-h-tap justify-center disabled:opacity-40 sm:min-w-28"
                                    >
                                        Volver
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (decisionDialog.kind === 'close-period') void confirmClosePeriod();
                                            else if (decisionDialog.kind === 'reopen-period') void confirmReopenPeriod();
                                            else void confirmAssetRetirement();
                                        }}
                                        disabled={decisionBusy}
                                        className={`nx-fluid-press inline-flex min-h-tap items-center justify-center gap-2 rounded-control px-4 py-2.5 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:min-w-40 ${decisionDialog.kind === 'retire-asset' ? 'bg-rose-600 hover:bg-rose-500' : 'bg-brand hover:bg-brand-hover'}`}
                                    >
                                        {decisionBusy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : decisionDialog.kind === 'retire-asset' ? <Trash2 size={16} aria-hidden="true" /> : decisionDialog.kind === 'reopen-period' ? <Unlock size={16} aria-hidden="true" /> : <Lock size={16} aria-hidden="true" />}
                                        {decisionBusy
                                            ? 'Procesando…'
                                            : decisionDialog.kind === 'close-period'
                                                ? 'Confirmar cierre'
                                                : decisionDialog.kind === 'reopen-period'
                                                    ? 'Reabrir período'
                                                    : 'Dar de baja'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Contabilidad;
