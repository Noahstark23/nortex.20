import React, { useState, useEffect, useMemo } from 'react';
import { UserCircle, CalendarDays, FileText, Loader2, Printer, Briefcase, Wallet, AlertTriangle } from 'lucide-react';
import { formatMoney } from '../utils/money';
import ModuleHeader from './ui/ModuleHeader';

interface MeProfile {
    id: string;
    name: string;
    role: string;
    cedula?: string | null;
    inss?: string | null;
    baseSalary: number;
    vacationDays: number;
    jornada: string;
    hireDate: string;
    antiguedadTexto: string;
}
interface MePayroll {
    id: string;
    month: number;
    year: number;
    grossSalary: number;
    commissions: number;
    overtimePay?: number;
    holidayPay?: number;
    totalIncome: number;
    inssLaboral: number;
    irLaboral: number;
    advanceDeduction?: number;
    absenceDeduction?: number;
    judicialDeduction?: number;
    netSalary: number;
    inssPatronal: number;
    inatec: number;
    status: string;
}

interface MeLeave { id: string; type: string; startDate: string; endDate: string; status: string; reason?: string | null; }
interface MeAdvance { id: string; amount: number; fee: number; status: string; }

const C = (n: number) => formatMoney(n);
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const JORNADA: Record<string, string> = { DIURNA: 'Diurna (8h)', NOCTURNA: 'Nocturna (7h)', MIXTA: 'Mixta (7.5h)' };
const LEAVE_LABELS: Record<string, string> = { UNPAID: 'Permiso sin goce', VACATION: 'Vacaciones', SICK: 'Incapacidad', MATERNITY: 'Maternidad' };
const formatCivilDate = (s: string, options: Intl.DateTimeFormatOptions = {}) =>
    new Date(s).toLocaleDateString('es-NI', { timeZone: 'UTC', ...options });
const fmtD = (s: string) => formatCivilDate(s, { day: '2-digit', month: 'short', year: '2-digit' });
const sanitizeAdvanceAmount = (value: string) => {
    const normalized = value.replace(/[^0-9.]/g, '');
    const [whole, ...fraction] = normalized.split('.');
    return fraction.length > 0 ? `${whole}.${fraction.join('')}` : whole;
};
const statusBadge = (s: string) =>
    s === 'APPROVED' ? 'nx-tone-positive-bg nx-tone-positive'
        : s === 'REJECTED' ? 'nx-tone-danger-bg nx-tone-danger'
            : 'nx-tone-warning-bg nx-tone-warning';
const statusText = (s: string) => s === 'APPROVED' ? 'Aprobada' : s === 'REJECTED' ? 'Rechazada' : 'Pendiente';

const MiEspacio: React.FC = () => {
    const token = localStorage.getItem('nortex_token');
    const auth = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

    const [profile, setProfile] = useState<MeProfile | null>(null);
    const [payrolls, setPayrolls] = useState<MePayroll[]>([]);
    const [leaves, setLeaves] = useState<MeLeave[]>([]);
    const [advances, setAdvances] = useState<MeAdvance[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [leaveForm, setLeaveForm] = useState({ type: 'VACATION', startDate: '', endDate: '', reason: '' });
    const [advAmount, setAdvAmount] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const loadRequests = async () => {
        try {
            const res = await fetch('/api/me/requests', { headers: auth });
            if (res.ok) { const d = await res.json(); setLeaves(d.leaves || []); setAdvances(d.advances || []); }
        } catch { /* noop */ }
    };

    useEffect(() => {
        (async () => {
            setLoading(true);
            setError('');
            try {
                const res = await fetch('/api/me/profile', { headers: auth });
                if (res.status === 404) { const d = await res.json(); setError(d.error || 'Sin expediente vinculado.'); return; }
                if (res.ok) setProfile(await res.json());
                const pr = await fetch('/api/me/payrolls', { headers: auth });
                if (pr.ok) setPayrolls(await pr.json());
                await loadRequests();
            } catch { setError('No se pudo cargar tu espacio.'); }
            finally { setLoading(false); }
        })();
    }, [auth]);

    const submitLeave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!leaveForm.startDate || !leaveForm.endDate) return;
        setSubmitting(true);
        try {
            const res = await fetch('/api/me/leave', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(leaveForm) });
            const d = await res.json();
            if (!res.ok) { alert(d.error || 'Error'); return; }
            setLeaveForm({ type: 'VACATION', startDate: '', endDate: '', reason: '' });
            await loadRequests();
            alert(d.message);
        } catch { alert('Error de conexión'); }
        finally { setSubmitting(false); }
    };

    const submitAdvance = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!advAmount) return;
        setSubmitting(true);
        try {
            const res = await fetch('/api/me/advance', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: advAmount }) });
            const d = await res.json();
            if (!res.ok) { alert(d.error || 'Error'); return; }
            setAdvAmount('');
            await loadRequests();
            alert(d.message);
        } catch { alert('Error de conexión'); }
        finally { setSubmitting(false); }
    };

    const printColilla = (p: MePayroll) => {
        const nombre = profile?.name || 'Colaborador';
        const fila = (label: string, val: number, neg = false) => `<tr><td>${label}</td><td class="amount">${neg ? '- ' : ''}${formatMoney(Number(val))}</td></tr>`;
        const html = `<!DOCTYPE html><html><head><title>Colilla - ${nombre}</title>
      <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:'Segoe UI',sans-serif;padding:40px;color:#1e293b;max-width:760px;margin:0 auto}
        .header{text-align:center;border-bottom:3px solid #0f172a;padding-bottom:18px;margin-bottom:18px}
        .header h1{font-size:22px;color:#0f172a}.header p{font-size:12px;color:#64748b}
        table{width:100%;border-collapse:collapse;margin-bottom:14px}
        th{background:#0f172a;color:#fff;padding:8px 12px;text-align:left;font-size:12px;text-transform:uppercase}
        td{padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:13px}
        .amount{text-align:right;font-family:monospace;font-weight:bold}
        .total-row{background:#f1f5f9;font-weight:bold}.net-row{background:#dcfce7;font-size:16px}
        .footer{text-align:center;margin-top:34px;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:14px}
      </style></head><body>
        <div class="header"><h1>COLILLA DE PAGO</h1><p>${nombre} · ${MESES[p.month - 1]} ${p.year}</p></div>
        <table><thead><tr><th colspan="2">Ingresos</th></tr></thead><tbody>
          ${fila('Salario base', p.grossSalary)}
          ${Number(p.commissions) > 0 ? fila('Comisiones', p.commissions) : ''}
          ${Number(p.overtimePay || 0) > 0 ? fila('Horas extra (Art. 62)', p.overtimePay || 0) : ''}
          ${Number(p.holidayPay || 0) > 0 ? fila('Feriado trabajado (Art. 68)', p.holidayPay || 0) : ''}
          ${Number(p.absenceDeduction || 0) > 0 ? fila('Ausencias sin goce', p.absenceDeduction || 0, true) : ''}
          <tr class="total-row"><td>Total devengado</td><td class="amount">${formatMoney(Number(p.totalIncome))}</td></tr>
        </tbody></table>
        <table><thead><tr><th colspan="2">Deducciones</th></tr></thead><tbody>
          ${fila('INSS Laboral (7%)', p.inssLaboral, true)}
          ${fila('IR Laboral', p.irLaboral, true)}
          ${Number(p.judicialDeduction || 0) > 0 ? fila('Deducción judicial', p.judicialDeduction || 0, true) : ''}
          ${Number(p.advanceDeduction || 0) > 0 ? fila('Adelanto de salario', p.advanceDeduction || 0, true) : ''}
        </tbody></table>
        <table><tbody><tr class="net-row"><td><strong>Neto a recibir</strong></td><td class="amount"><strong>${formatMoney(Number(p.netSalary))}</strong></td></tr></tbody></table>
        <div class="footer">Generado por NORTEX ERP · Ley 185 Código del Trabajo de Nicaragua</div>
      </body></html>`;
        const w = window.open('', '_blank');
        if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 400); }
    };

    const inputCls = 'nx-canvas-text min-h-tap w-full rounded-control border border-[var(--nx-canvas-border)] bg-[var(--nx-canvas-raised)] px-3 py-2 text-sm outline-none placeholder:text-[var(--nx-canvas-faint)] focus:border-brand focus:ring-2 focus:ring-brand-ring';

    if (loading) {
        return (
            <div className="nx-workspace flex h-full items-center justify-center" role="status" aria-live="polite">
                <Loader2 className="nx-tone-positive animate-spin" aria-hidden="true" />
                <span className="sr-only">Cargando Mi Espacio…</span>
            </div>
        );
    }

    if (error || !profile) {
        return (
            <div className="nx-workspace h-full overflow-y-auto p-4 sm:p-6 lg:p-8">
                <div className="mx-auto max-w-4xl">
                    <ModuleHeader
                        className="mb-6"
                        icon={<UserCircle size={20} aria-hidden="true" />}
                        title="Mi Espacio"
                        subtitle="Tu información laboral, colillas y prestaciones."
                    />
                    <div role="alert" className="nx-canvas-card mx-auto mt-10 max-w-lg p-8 text-center">
                        <div className="nx-tone-warning-bg nx-tone-warning mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-pill">
                            <AlertTriangle size={28} aria-hidden="true" />
                        </div>
                        <h2 className="nx-canvas-text text-lg font-bold">No pudimos abrir tu expediente</h2>
                        <p className="nx-canvas-muted mt-2 text-sm">{error || 'No se encontró tu expediente.'}</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="nx-workspace h-full overflow-y-auto p-4 sm:p-6 lg:p-8 custom-scrollbar">
            <div className="mx-auto max-w-4xl">
                <ModuleHeader
                    className="mb-6"
                    icon={<UserCircle size={20} aria-hidden="true" />}
                    title="Mi Espacio"
                    subtitle="Tu información laboral, colillas y prestaciones."
                />

                {/* Perfil + saldo de vacaciones */}
                <section aria-label="Resumen laboral" className="mb-6 grid gap-4 sm:grid-cols-3">
                    <div className="nx-canvas-card p-5 sm:col-span-2">
                        <p className="nx-canvas-text text-lg font-bold">{profile.name}</p>
                        <p className="nx-canvas-muted mt-0.5 flex items-center gap-1.5 text-sm"><Briefcase size={13} aria-hidden="true" /> {profile.role} · {JORNADA[profile.jornada] || profile.jornada}</p>
                        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                            <div><p className="nx-canvas-faint text-[11px] uppercase tracking-wider">Cédula</p><p className="nx-canvas-text font-mono">{profile.cedula || 'N/A'}</p></div>
                            <div><p className="nx-canvas-faint text-[11px] uppercase tracking-wider">N° INSS</p><p className="nx-canvas-text font-mono">{profile.inss || 'N/A'}</p></div>
                            <div><p className="nx-canvas-faint text-[11px] uppercase tracking-wider">Ingreso</p><p className="nx-canvas-text">{formatCivilDate(profile.hireDate)}</p></div>
                            <div><p className="nx-canvas-faint text-[11px] uppercase tracking-wider">Antigüedad</p><p className="nx-canvas-text">{profile.antiguedadTexto}</p></div>
                        </div>
                    </div>
                    <div className="nx-canvas-card nx-tone-positive-bg flex flex-col justify-center p-5">
                        <p className="nx-tone-positive flex items-center gap-1.5 text-[11px] uppercase tracking-wider"><CalendarDays size={13} aria-hidden="true" /> Vacaciones acumuladas</p>
                        <p className="nx-tone-positive mt-1 font-mono text-3xl font-bold">{Number(profile.vacationDays).toFixed(1)}</p>
                        <p className="nx-canvas-muted text-xs">días disponibles</p>
                    </div>
                </section>

                {/* Colillas */}
                <section className="nx-canvas-card overflow-hidden" aria-labelledby="mi-espacio-payrolls-title">
                    <div className="border-b border-[var(--nx-canvas-border)] px-5 py-4">
                        <h2 id="mi-espacio-payrolls-title" className="nx-canvas-text flex items-center gap-2 font-semibold"><FileText size={16} className="nx-tone-positive" aria-hidden="true" /> Mis colillas</h2>
                    </div>
                    {payrolls.length === 0 ? (
                        <p role="status" className="nx-canvas-muted px-5 py-8 text-center text-sm">Aún no tenés colillas registradas.</p>
                    ) : (
                        <>
                            <div className="divide-y divide-[var(--nx-canvas-border)] md:hidden">
                                {payrolls.map(p => {
                                    const period = `${MESES[p.month - 1]} ${p.year}`;
                                    return (
                                        <article key={p.id} className="p-4">
                                            <div className="flex items-start justify-between gap-3">
                                                <div>
                                                    <p className="nx-canvas-text font-semibold">{period}</p>
                                                    <p className="nx-canvas-muted mt-1 text-xs">Devengado {C(p.totalIncome)}</p>
                                                </div>
                                                <span className={`rounded-pill px-2 py-1 text-[10px] font-semibold ${p.status === 'PAGADO' ? statusBadge('APPROVED') : statusBadge('PENDING')}`}>{p.status === 'PAGADO' ? 'Pagado' : 'Pendiente'}</span>
                                            </div>
                                            <div className="mt-3 flex items-center justify-between gap-3">
                                                <div>
                                                    <p className="nx-canvas-faint text-[10px] uppercase tracking-wider">Neto</p>
                                                    <p className="nx-tone-positive font-mono font-bold tabular-nums">{C(p.netSalary)}</p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => printColilla(p)}
                                                    className="nx-fluid-press nx-canvas-text flex h-touch w-touch items-center justify-center rounded-control border border-[var(--nx-canvas-border)] bg-[var(--nx-canvas-raised)] transition-colors hover:bg-[var(--nx-canvas-subtle)]"
                                                    aria-label={`Imprimir colilla de ${period}`}
                                                >
                                                    <Printer size={17} aria-hidden="true" />
                                                </button>
                                            </div>
                                        </article>
                                    );
                                })}
                            </div>
                            <div className="hidden overflow-x-auto custom-scrollbar md:block">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="nx-canvas-faint border-b border-[var(--nx-canvas-border)] text-[10px] uppercase tracking-wider">
                                            <th className="px-5 py-3 text-left font-semibold">Período</th>
                                            <th className="px-3 py-3 text-right font-semibold">Devengado</th>
                                            <th className="px-3 py-3 text-right font-semibold">Neto</th>
                                            <th className="px-3 py-3 text-center font-semibold">Estado</th>
                                            <th className="px-5 py-3 text-center font-semibold">Colilla</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {payrolls.map(p => {
                                            const period = `${MESES[p.month - 1]} ${p.year}`;
                                            return (
                                                <tr key={p.id} className="border-b border-[var(--nx-canvas-border)] transition-colors hover:bg-[var(--nx-canvas-subtle)]">
                                                    <td className="nx-canvas-text px-5 py-3 font-medium">{period}</td>
                                                    <td className="nx-canvas-muted px-3 py-3 text-right font-mono tabular-nums">{C(p.totalIncome)}</td>
                                                    <td className="nx-tone-positive px-3 py-3 text-right font-mono font-bold tabular-nums">{C(p.netSalary)}</td>
                                                    <td className="px-3 py-3 text-center">
                                                        <span className={`rounded-pill px-2 py-1 text-[10px] font-semibold ${p.status === 'PAGADO' ? statusBadge('APPROVED') : statusBadge('PENDING')}`}>{p.status === 'PAGADO' ? 'Pagado' : 'Pendiente'}</span>
                                                    </td>
                                                    <td className="px-5 py-3 text-center">
                                                        <button
                                                            type="button"
                                                            onClick={() => printColilla(p)}
                                                            className="nx-fluid-press nx-canvas-text inline-flex h-touch w-touch items-center justify-center rounded-control transition-colors hover:bg-[var(--nx-canvas-subtle)]"
                                                            aria-label={`Imprimir colilla de ${period}`}
                                                        >
                                                            <Printer size={16} aria-hidden="true" />
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </section>

                {/* Solicitudes */}
                <section aria-label="Solicitudes laborales" className="mt-6 grid gap-4 md:grid-cols-2">
                    <form onSubmit={submitLeave} className="nx-canvas-card p-5">
                        <h2 className="nx-canvas-text mb-4 font-semibold">Solicitar ausencia</h2>
                        <div className="space-y-3">
                            <label htmlFor="leave-type" className="nx-canvas-muted block text-xs font-medium">Tipo de ausencia</label>
                            <select id="leave-type" value={leaveForm.type} onChange={e => setLeaveForm({ ...leaveForm, type: e.target.value })} className={inputCls}>
                                <option value="VACATION">Vacaciones</option>
                                <option value="UNPAID">Permiso sin goce</option>
                                <option value="SICK">Incapacidad</option>
                                <option value="MATERNITY">Maternidad</option>
                            </select>
                            <div className="grid grid-cols-2 gap-2">
                                <label htmlFor="leave-start" className="nx-canvas-muted text-xs font-medium">Desde</label>
                                <label htmlFor="leave-end" className="nx-canvas-muted text-xs font-medium">Hasta</label>
                                <input id="leave-start" type="date" required value={leaveForm.startDate} onChange={e => setLeaveForm({ ...leaveForm, startDate: e.target.value })} className={`${inputCls} font-mono`} />
                                <input id="leave-end" type="date" required value={leaveForm.endDate} onChange={e => setLeaveForm({ ...leaveForm, endDate: e.target.value })} className={`${inputCls} font-mono`} />
                            </div>
                            <label htmlFor="leave-reason" className="nx-canvas-muted block text-xs font-medium">Motivo <span className="nx-canvas-faint font-normal">(opcional)</span></label>
                            <input id="leave-reason" value={leaveForm.reason} onChange={e => setLeaveForm({ ...leaveForm, reason: e.target.value })} placeholder="Contanos brevemente" className={inputCls} />
                            <button type="submit" disabled={submitting} className="btn-primary nx-fluid-press min-h-tap w-full disabled:opacity-50">Enviar solicitud</button>
                        </div>
                    </form>

                    <form onSubmit={submitAdvance} className="nx-canvas-card p-5">
                        <h2 className="nx-canvas-text font-semibold">Solicitar adelanto</h2>
                        <p id="advance-help" className="nx-canvas-muted mb-4 mt-2 text-xs">Hasta el 30% de tu salario. Se descuenta de tu próxima nómina (5% de comisión).</p>
                        <label htmlFor="advance-amount" className="nx-canvas-muted mb-2 block text-xs font-medium">Monto solicitado (C$)</label>
                        <input id="advance-amount" inputMode="decimal" aria-describedby="advance-help" value={advAmount} onChange={e => setAdvAmount(sanitizeAdvanceAmount(e.target.value))} placeholder="0.00" className={`${inputCls} font-mono`} />
                        <button type="submit" disabled={submitting} className="btn-primary nx-fluid-press mt-3 min-h-tap w-full disabled:opacity-50">Solicitar adelanto</button>
                    </form>
                </section>

                {/* Mis solicitudes */}
                {(leaves.length > 0 || advances.length > 0) && (
                    <section className="nx-canvas-card mt-4 p-5" aria-labelledby="mi-espacio-requests-title">
                        <h2 id="mi-espacio-requests-title" className="nx-canvas-text mb-3 font-semibold">Mis solicitudes</h2>
                        <div className="space-y-2">
                            {leaves.map(l => (
                                <div key={l.id} className="flex flex-col gap-2 border-b border-[var(--nx-canvas-border)] pb-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                                    <span className="nx-canvas-text">{LEAVE_LABELS[l.type] || l.type} · <span className="nx-canvas-muted font-mono text-xs">{fmtD(l.startDate)} → {fmtD(l.endDate)}</span></span>
                                    <span className={`w-fit rounded-pill px-2 py-1 text-[10px] font-semibold ${statusBadge(l.status)}`}>{statusText(l.status)}</span>
                                </div>
                            ))}
                            {advances.map(a => (
                                <div key={a.id} className="flex flex-col gap-2 border-b border-[var(--nx-canvas-border)] pb-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                                    <span className="nx-canvas-text">Adelanto {C(a.amount)} <span className="nx-canvas-muted text-xs">(+{C(a.fee)} comisión)</span></span>
                                    <span className={`w-fit rounded-pill px-2 py-1 text-[10px] font-semibold ${statusBadge(a.status === 'DEDUCTED' ? 'APPROVED' : a.status)}`}>{statusText(a.status === 'DEDUCTED' ? 'APPROVED' : a.status)}</span>
                                </div>
                            ))}
                        </div>
                    </section>
                )}
            </div>
        </div>
    );
};

export default MiEspacio;
