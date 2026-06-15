import React, { useState, useEffect, useMemo } from 'react';
import { UserCircle, CalendarDays, FileText, Loader2, Printer, Briefcase, Wallet, AlertTriangle } from 'lucide-react';

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

const C = (n: number) => `C$ ${Number(n).toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const JORNADA: Record<string, string> = { DIURNA: 'Diurna (8h)', NOCTURNA: 'Nocturna (7h)', MIXTA: 'Mixta (7.5h)' };

const MiEspacio: React.FC = () => {
    const token = localStorage.getItem('nortex_token');
    const auth = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

    const [profile, setProfile] = useState<MeProfile | null>(null);
    const [payrolls, setPayrolls] = useState<MePayroll[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

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
            } catch { setError('No se pudo cargar tu espacio.'); }
            finally { setLoading(false); }
        })();
    }, [auth]);

    const printColilla = (p: MePayroll) => {
        const nombre = profile?.name || 'Colaborador';
        const fila = (label: string, val: number, neg = false) => `<tr><td>${label}</td><td class="amount">${neg ? '- ' : ''}C$ ${Number(val).toFixed(2)}</td></tr>`;
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
          <tr class="total-row"><td>Total devengado</td><td class="amount">C$ ${Number(p.totalIncome).toFixed(2)}</td></tr>
        </tbody></table>
        <table><thead><tr><th colspan="2">Deducciones</th></tr></thead><tbody>
          ${fila('INSS Laboral (7%)', p.inssLaboral, true)}
          ${fila('IR Laboral', p.irLaboral, true)}
          ${Number(p.judicialDeduction || 0) > 0 ? fila('Deducción judicial', p.judicialDeduction || 0, true) : ''}
          ${Number(p.advanceDeduction || 0) > 0 ? fila('Adelanto de salario', p.advanceDeduction || 0, true) : ''}
        </tbody></table>
        <table><tbody><tr class="net-row"><td><strong>Neto a recibir</strong></td><td class="amount"><strong>C$ ${Number(p.netSalary).toFixed(2)}</strong></td></tr></tbody></table>
        <div class="footer">Generado por NORTEX ERP · Ley 185 Código del Trabajo de Nicaragua</div>
      </body></html>`;
        const w = window.open('', '_blank');
        if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 400); }
    };

    if (loading) {
        return <div className="h-full flex items-center justify-center bg-surface-950"><Loader2 className="animate-spin text-brand-300" /></div>;
    }

    if (error || !profile) {
        return (
            <div className="h-full overflow-y-auto bg-surface-950 p-6">
                <div className="max-w-lg mx-auto panel-premium p-8 text-center mt-10">
                    <AlertTriangle className="mx-auto text-amber-400 mb-3" size={32} />
                    <h2 className="text-white font-bold text-lg">Mi Espacio</h2>
                    <p className="text-slate-400 text-sm mt-2">{error || 'No se encontró tu expediente.'}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full overflow-y-auto bg-surface-950 p-6 custom-scrollbar">
            <div className="max-w-4xl mx-auto">
                <header className="mb-6">
                    <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
                        <UserCircle className="text-brand-300" /> Mi Espacio
                    </h1>
                    <p className="text-slate-400 text-sm mt-1">Tu información laboral, colillas y prestaciones.</p>
                </header>

                {/* Perfil + saldo de vacaciones */}
                <div className="grid sm:grid-cols-3 gap-4 mb-6">
                    <div className="panel-premium p-5 sm:col-span-2">
                        <p className="text-white font-bold text-lg">{profile.name}</p>
                        <p className="text-slate-400 text-sm flex items-center gap-1.5 mt-0.5"><Briefcase size={13} /> {profile.role} · {JORNADA[profile.jornada] || profile.jornada}</p>
                        <div className="grid grid-cols-2 gap-3 mt-4 text-sm">
                            <div><p className="text-[11px] uppercase tracking-wider text-slate-500">Cédula</p><p className="text-slate-200 font-mono">{profile.cedula || 'N/A'}</p></div>
                            <div><p className="text-[11px] uppercase tracking-wider text-slate-500">N° INSS</p><p className="text-slate-200 font-mono">{profile.inss || 'N/A'}</p></div>
                            <div><p className="text-[11px] uppercase tracking-wider text-slate-500">Ingreso</p><p className="text-slate-200">{new Date(profile.hireDate).toLocaleDateString('es-NI')}</p></div>
                            <div><p className="text-[11px] uppercase tracking-wider text-slate-500">Antigüedad</p><p className="text-slate-200">{profile.antiguedadTexto}</p></div>
                        </div>
                    </div>
                    <div className="panel-premium p-5 flex flex-col justify-center bg-emerald-500/5 border-emerald-500/20">
                        <p className="text-[11px] uppercase tracking-wider text-slate-400 flex items-center gap-1.5"><CalendarDays size={13} className="text-emerald-400" /> Vacaciones acumuladas</p>
                        <p className="text-3xl font-bold font-mono text-emerald-300 mt-1">{Number(profile.vacationDays).toFixed(1)}</p>
                        <p className="text-xs text-slate-500">días disponibles</p>
                    </div>
                </div>

                {/* Colillas */}
                <div className="panel-premium p-0 overflow-hidden">
                    <div className="px-5 py-4 border-b border-white/[0.06]">
                        <h2 className="text-white font-semibold flex items-center gap-2"><FileText size={16} className="text-brand-300" /> Mis colillas</h2>
                    </div>
                    <div className="overflow-x-auto custom-scrollbar">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-white/[0.06]">
                                    <th className="text-left font-semibold px-5 py-3">Período</th>
                                    <th className="text-right font-semibold px-3 py-3">Devengado</th>
                                    <th className="text-right font-semibold px-3 py-3">Neto</th>
                                    <th className="text-center font-semibold px-3 py-3">Estado</th>
                                    <th className="text-center font-semibold px-5 py-3">Colilla</th>
                                </tr>
                            </thead>
                            <tbody>
                                {payrolls.length === 0 ? (
                                    <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-500">Aún no tenés colillas registradas.</td></tr>
                                ) : payrolls.map(p => (
                                    <tr key={p.id} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                                        <td className="px-5 py-3 text-white font-medium">{MESES[p.month - 1]} {p.year}</td>
                                        <td className="px-3 py-3 text-right font-mono tabular-nums text-slate-300">{C(p.totalIncome)}</td>
                                        <td className="px-3 py-3 text-right font-mono tabular-nums font-bold text-emerald-300">{C(p.netSalary)}</td>
                                        <td className="px-3 py-3 text-center">
                                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${p.status === 'PAGADO' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>{p.status === 'PAGADO' ? 'Pagado' : 'Pendiente'}</span>
                                        </td>
                                        <td className="px-5 py-3 text-center">
                                            <button onClick={() => printColilla(p)} className="text-brand-300 hover:text-white transition-colors" title="Imprimir colilla"><Printer size={16} /></button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MiEspacio;
