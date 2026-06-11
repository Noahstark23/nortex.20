import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    BookOpen, Plus, Trash2, Lock, Unlock, Loader2, Scale, FileText,
    CalendarDays, CheckCircle2, AlertTriangle, ArrowLeft, ListTree
} from 'lucide-react';
import { sanitizeDecimalInput, toDecimal } from '../utils/money';

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

type Tab = 'asiento' | 'diario' | 'balanza' | 'periodos';

const C = (n: number) => `C$ ${n.toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const Contabilidad: React.FC = () => {
    const token = localStorage.getItem('nortex_token');
    const role = useMemo(() => {
        try { return token ? JSON.parse(atob(token.split('.')[1])).role || '' : ''; } catch { return ''; }
    }, [token]);
    const isOwner = role === 'OWNER' || role === 'SUPER_ADMIN';

    const auth = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
    const today = new Date();

    const [tab, setTab] = useState<Tab>('asiento');
    const [accounts, setAccounts] = useState<Account[]>([]);

    useEffect(() => {
        fetch('/api/accounting/chart', { headers: auth })
            .then(r => r.ok ? r.json() : [])
            .then((data) => setAccounts(Array.isArray(data) ? data : []))
            .catch(() => { /* sin catálogo aún */ });
    }, [auth]);

    // ── Asiento manual (A1/A2) ──────────────────────────────────────────────
    const [entryDate, setEntryDate] = useState(today.toISOString().slice(0, 10));
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
    const [y, setY] = useState(today.getFullYear());
    const [m, setM] = useState(today.getMonth() + 1);
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

    // ── Períodos (A3) ───────────────────────────────────────────────────────
    const [periods, setPeriods] = useState<FiscalPeriodRow[]>([]);
    const loadPeriods = useCallback(async () => {
        const res = await fetch('/api/accounting/periods', { headers: auth });
        if (res.ok) { const d = await res.json(); setPeriods(d.periods ?? []); }
    }, [auth]);
    useEffect(() => { if (tab === 'periodos') loadPeriods(); }, [tab, loadPeriods]);

    const closeMonth = async () => {
        if (!confirm(`¿Cerrar el período ${m}/${y}? Después NO se podrán registrar movimientos con esa fecha (salvo reapertura).`)) return;
        const res = await fetch('/api/accounting/fiscal-close', {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...auth },
            body: JSON.stringify({ month: m, year: y }),
        });
        const d = await res.json();
        alert(res.ok ? `✅ ${d.message}` : (d.error || 'Error al cerrar'));
        if (res.ok) loadPeriods();
    };

    const reopen = async (p: FiscalPeriodRow) => {
        const reason = prompt(`Reabrir ${p.month}/${p.year}. Motivo (queda auditado):`);
        if (!reason?.trim()) return;
        const res = await fetch(`/api/accounting/periods/${p.year}/${p.month}/reopen`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...auth },
            body: JSON.stringify({ reason }),
        });
        const d = await res.json();
        alert(res.ok ? `🔓 ${d.message}` : (d.error || 'Error'));
        if (res.ok) loadPeriods();
    };

    const tabBtn = (t: Tab, label: string, Icon: React.ComponentType<{ size?: number }>) => (
        <button onClick={() => setTab(t)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${tab === t ? 'bg-brand text-white shadow-glow shadow-brand/25' : 'text-slate-400 hover:bg-white/[0.04] hover:text-white'}`}>
            <Icon size={16} /> {label}
        </button>
    );

    const accountLabel = (code: string) => { const a = accounts.find(x => x.code === code); return a ? `${a.code} · ${a.name}` : code; };

    return (
        <div className="h-full overflow-y-auto bg-surface-950 p-6 custom-scrollbar">
            <div className="max-w-5xl mx-auto">
                <header className="mb-6">
                    <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
                        <BookOpen className="text-brand-300" /> Contabilidad
                    </h1>
                    <p className="text-slate-400 text-sm mt-1">Asientos manuales, libros oficiales y cierre de períodos.</p>
                </header>

                <div className="flex flex-wrap gap-2 mb-6">
                    {tabBtn('asiento', 'Asiento Manual', Plus)}
                    {tabBtn('diario', 'Libro Diario', FileText)}
                    {tabBtn('balanza', 'Balanza / Mayor', Scale)}
                    {tabBtn('periodos', 'Períodos', CalendarDays)}
                </div>

                {/* ── ASIENTO MANUAL ── */}
                {tab === 'asiento' && (
                    <div className="panel-premium p-6">
                        <div className="grid sm:grid-cols-3 gap-4 mb-4">
                            <div>
                                <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Fecha</label>
                                <input type="date" value={entryDate} onChange={e => setEntryDate(e.target.value)}
                                    className="w-full bg-white/[0.03] border border-white/[0.08] text-white px-3 py-2.5 rounded-xl focus:outline-none focus:border-brand font-mono" />
                            </div>
                            <div className="sm:col-span-2">
                                <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Tipo</label>
                                <div className="flex gap-2">
                                    {(['MANUAL', 'OPENING'] as const).map(t => (
                                        <button key={t} onClick={() => setTipo(t)}
                                            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all ${tipo === t ? 'bg-brand/15 border-brand/40 text-white' : 'bg-white/[0.02] border-white/[0.06] text-slate-400 hover:text-white'}`}>
                                            {t === 'MANUAL' ? '✍️ Ajuste manual' : '📥 Saldos de apertura'}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div className="mb-4">
                            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Descripción / Concepto</label>
                            <input value={descripcion} onChange={e => setDescripcion(e.target.value)} placeholder="Ej: Provisión de servicios de luz de junio"
                                className="w-full bg-white/[0.03] border border-white/[0.08] text-white px-3 py-2.5 rounded-xl focus:outline-none focus:border-brand placeholder:text-slate-600" />
                        </div>

                        <div className="space-y-2">
                            <div className="grid grid-cols-[1fr_120px_120px_36px] gap-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider px-1">
                                <span>Cuenta</span><span className="text-right">Debe</span><span className="text-right">Haber</span><span />
                            </div>
                            {lines.map((l, i) => (
                                <div key={i} className="grid grid-cols-[1fr_120px_120px_36px] gap-2 items-center">
                                    <select value={l.accountCode} onChange={e => setLine(i, { accountCode: e.target.value })}
                                        className="bg-white/[0.03] border border-white/[0.08] text-white text-sm px-2 py-2 rounded-lg focus:outline-none focus:border-brand">
                                        <option value="">— cuenta —</option>
                                        {accounts.map(a => <option key={a.id} value={a.code}>{a.code} · {a.name}</option>)}
                                    </select>
                                    <input inputMode="decimal" value={l.debit} placeholder="0.00"
                                        onChange={e => setLine(i, { debit: sanitizeDecimalInput(e.target.value), credit: '' })}
                                        className="bg-white/[0.03] border border-white/[0.08] text-white text-right font-mono tabular-nums text-sm px-2 py-2 rounded-lg focus:outline-none focus:border-brand" />
                                    <input inputMode="decimal" value={l.credit} placeholder="0.00"
                                        onChange={e => setLine(i, { credit: sanitizeDecimalInput(e.target.value), debit: '' })}
                                        className="bg-white/[0.03] border border-white/[0.08] text-white text-right font-mono tabular-nums text-sm px-2 py-2 rounded-lg focus:outline-none focus:border-brand" />
                                    <button onClick={() => setLines(prev => prev.length > 2 ? prev.filter((_, idx) => idx !== i) : prev)}
                                        className="text-slate-500 hover:text-red-400 flex justify-center" title="Quitar línea"><Trash2 size={15} /></button>
                                </div>
                            ))}
                        </div>

                        <button onClick={() => setLines(prev => [...prev, { accountCode: '', debit: '', credit: '' }])}
                            className="btn-ghost mt-3 text-xs py-2 inline-flex items-center gap-1.5"><Plus size={14} /> Agregar línea</button>

                        <div className="flex items-center justify-between mt-5 pt-4 border-t border-white/[0.06]">
                            <div className="flex gap-6 font-mono tabular-nums text-sm">
                                <span className="text-slate-400">Debe: <span className="text-white font-bold">{C(totalDebe.toNumber())}</span></span>
                                <span className="text-slate-400">Haber: <span className="text-white font-bold">{C(totalHaber.toNumber())}</span></span>
                                <span className={`flex items-center gap-1 font-bold ${balanced ? 'text-emerald-400' : 'text-amber-400'}`}>
                                    {balanced ? <><CheckCircle2 size={15} /> Cuadrado</> : <><AlertTriangle size={15} /> Descuadre {C(totalDebe.minus(totalHaber).abs().toNumber())}</>}
                                </span>
                            </div>
                            <button onClick={submitEntry} disabled={posting || !balanced}
                                className="btn-primary px-6 disabled:opacity-40 disabled:active:scale-100 disabled:cursor-not-allowed flex items-center gap-2">
                                {posting ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle2 size={18} />} Registrar
                            </button>
                        </div>

                        {postMsg && (
                            <div className={`mt-4 px-4 py-3 rounded-xl text-sm ${postMsg.ok ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>
                                {postMsg.text}
                            </div>
                        )}
                    </div>
                )}

                {/* ── PERÍODO PICKER (diario/balanza) ── */}
                {(tab === 'diario' || tab === 'balanza') && (
                    <div className="flex items-center gap-2 mb-4">
                        <select value={m} onChange={e => setM(Number(e.target.value))} className="bg-surface-900 border border-white/[0.08] text-white px-3 py-2 rounded-xl text-sm">
                            {MESES.map((mes, i) => <option key={i} value={i + 1}>{mes}</option>)}
                        </select>
                        <select value={y} onChange={e => setY(Number(e.target.value))} className="bg-surface-900 border border-white/[0.08] text-white px-3 py-2 rounded-xl text-sm font-mono">
                            {[0, 1, 2, 3].map(d => { const yr = today.getFullYear() - d; return <option key={yr} value={yr}>{yr}</option>; })}
                        </select>
                        {busy && <Loader2 className="animate-spin text-brand-300" size={18} />}
                    </div>
                )}

                {/* ── LIBRO DIARIO ── */}
                {tab === 'diario' && diario && (
                    <div className="panel-premium p-6">
                        {diario.locked && (
                            <div className="mb-4 flex items-center gap-2 text-amber-400 text-sm bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-2">
                                <Lock size={15} /> Período cerrado — solo lectura.
                            </div>
                        )}
                        {diario.asientos.length === 0 ? (
                            <p className="text-slate-500 text-sm text-center py-8">Sin asientos en este período.</p>
                        ) : (
                            <div className="space-y-4">
                                {diario.asientos.map(a => (
                                    <div key={a.id} className="border-b border-white/[0.05] pb-3 last:border-0">
                                        <div className="flex items-center justify-between text-xs mb-1.5">
                                            <span className="text-slate-400 font-mono">#{a.numero} · {new Date(a.fecha).toLocaleDateString('es-NI')}</span>
                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${a.esManual ? 'bg-brand/15 text-brand-300' : 'bg-white/[0.04] text-slate-500'}`}>{a.esManual ? a.tipo : 'AUTO'}</span>
                                        </div>
                                        <p className="text-white text-sm mb-2">{a.descripcion}</p>
                                        <table className="w-full table-premium">
                                            <tbody>
                                                {a.lineas.map((l, idx) => (
                                                    <tr key={idx}>
                                                        <td className="text-slate-300">{l.cuenta} · {l.nombre}</td>
                                                        <td className="text-right num text-emerald-400">{l.debe > 0 ? C(l.debe) : ''}</td>
                                                        <td className="text-right num text-cyan-400">{l.haber > 0 ? C(l.haber) : ''}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ))}
                                <div className="flex justify-end gap-6 pt-2 font-mono tabular-nums text-sm font-bold text-white">
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
                        <div className="panel-premium p-6">
                            <button onClick={() => setMayor(null)} className="btn-ghost text-xs py-1.5 mb-4 inline-flex items-center gap-1.5"><ArrowLeft size={14} /> Volver a la balanza</button>
                            <h3 className="text-white font-bold mb-1">{mayor.cuenta} · {mayor.nombre}</h3>
                            <p className="text-slate-400 text-xs mb-4 font-mono">Saldo inicial: {C(mayor.saldoInicial)} → Saldo final: {C(mayor.saldoFinal)}</p>
                            <table className="w-full table-premium">
                                <thead><tr><th>Fecha</th><th>Concepto</th><th className="text-right">Debe</th><th className="text-right">Haber</th><th className="text-right">Saldo</th></tr></thead>
                                <tbody>
                                    {mayor.movimientos.map((mv, i) => (
                                        <tr key={i}>
                                            <td className="num text-slate-400">{new Date(mv.fecha).toLocaleDateString('es-NI')}</td>
                                            <td className="text-slate-300">{mv.descripcion}</td>
                                            <td className="text-right num text-emerald-400">{mv.debe > 0 ? C(mv.debe) : ''}</td>
                                            <td className="text-right num text-cyan-400">{mv.haber > 0 ? C(mv.haber) : ''}</td>
                                            <td className="text-right num text-white font-bold">{C(mv.saldo)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : balanza && (
                        <div className="panel-premium p-6 overflow-x-auto">
                            <p className="text-[11px] text-slate-500 mb-3 flex items-center gap-1.5"><ListTree size={13} /> Clic en una cuenta para ver su mayor (movimientos).</p>
                            <table className="w-full table-premium">
                                <thead><tr><th>Cuenta</th><th className="text-right">Saldo inicial</th><th className="text-right">Debe</th><th className="text-right">Haber</th><th className="text-right">Saldo final</th></tr></thead>
                                <tbody>
                                    {balanza.balanza.map(b => (
                                        <tr key={b.cuenta} onClick={() => loadMayor(b.cuenta)} className="cursor-pointer hover:bg-white/[0.03]">
                                            <td className="text-slate-300"><span className="font-mono text-slate-500">{b.cuenta}</span> · {b.nombre}</td>
                                            <td className="text-right num text-slate-400">{C(b.saldoInicial)}</td>
                                            <td className="text-right num text-emerald-400">{b.debe > 0 ? C(b.debe) : ''}</td>
                                            <td className="text-right num text-cyan-400">{b.haber > 0 ? C(b.haber) : ''}</td>
                                            <td className="text-right num text-white font-bold">{C(b.saldoFinal)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot><tr className="border-t border-white/10"><td className="text-slate-400 font-bold pt-2">Totales movimiento</td><td /><td className="text-right num text-white font-bold pt-2">{C(balanza.totales.debe)}</td><td className="text-right num text-white font-bold pt-2">{C(balanza.totales.haber)}</td><td /></tr></tfoot>
                            </table>
                        </div>
                    )
                )}

                {/* ── PERÍODOS ── */}
                {tab === 'periodos' && (
                    <div className="panel-premium p-6">
                        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                            <div className="flex items-center gap-2">
                                <select value={m} onChange={e => setM(Number(e.target.value))} className="bg-surface-900 border border-white/[0.08] text-white px-3 py-2 rounded-xl text-sm">
                                    {MESES.map((mes, i) => <option key={i} value={i + 1}>{mes}</option>)}
                                </select>
                                <select value={y} onChange={e => setY(Number(e.target.value))} className="bg-surface-900 border border-white/[0.08] text-white px-3 py-2 rounded-xl text-sm font-mono">
                                    {[0, 1, 2].map(d => { const yr = today.getFullYear() - d; return <option key={yr} value={yr}>{yr}</option>; })}
                                </select>
                            </div>
                            <button onClick={closeMonth} className="btn-primary inline-flex items-center gap-2"><Lock size={16} /> Cerrar {MESES[m - 1]} {y}</button>
                        </div>
                        {periods.length === 0 ? (
                            <p className="text-slate-500 text-sm text-center py-6">Ningún período cerrado todavía. Al cerrar un mes, las cifras de la DGI quedan congeladas.</p>
                        ) : (
                            <div className="space-y-2">
                                {periods.map(p => (
                                    <div key={p.id} className="flex items-center justify-between bg-white/[0.02] border border-white/[0.06] rounded-xl px-4 py-3">
                                        <div className="flex items-center gap-3">
                                            {p.status === 'CLOSED'
                                                ? <span className="w-9 h-9 bg-amber-500/15 border border-amber-500/25 rounded-lg flex items-center justify-center"><Lock size={16} className="text-amber-400" /></span>
                                                : <span className="w-9 h-9 bg-emerald-500/15 border border-emerald-500/25 rounded-lg flex items-center justify-center"><Unlock size={16} className="text-emerald-400" /></span>}
                                            <div>
                                                <p className="text-white font-semibold font-mono">{MESES[p.month - 1]} {p.year}</p>
                                                <p className="text-[11px] text-slate-500">{p.status === 'CLOSED' ? `Cerrado${p.closedAt ? ' · ' + new Date(p.closedAt).toLocaleDateString('es-NI') : ''}` : `Reabierto — ${p.reopenReason || 's/motivo'}`}</p>
                                            </div>
                                        </div>
                                        {p.status === 'CLOSED' && isOwner && (
                                            <button onClick={() => reopen(p)} className="btn-ghost text-xs py-1.5 inline-flex items-center gap-1.5"><Unlock size={13} /> Reabrir</button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default Contabilidad;
