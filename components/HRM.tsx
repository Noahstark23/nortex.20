import React, { useState, useEffect, useCallback } from 'react';
import { Users, Briefcase, DollarSign, Plus, UserPlus, CheckCircle, Clock, KeyRound, FileText, AlertTriangle, Calculator, CreditCard, Printer, X, Shield, Calendar, TrendingDown, Wallet, FileSpreadsheet, Gift, BarChart3 } from 'lucide-react';
import * as XLSX from 'xlsx';

interface Employee {
    id: string;
    firstName: string;
    lastName: string;
    role: string;
    pin?: string;
    cedula?: string;
    inss?: string;
    baseSalary: number;
    commissionRate: number;
    salesMonthToDate: number;
    hireDate: string;
    vacationDays?: number;
}

interface PayrollRecord {
    id: string;
    employeeId: string;
    month: number;
    year: number;
    grossSalary: number;
    commissions: number;
    overtimePay?: number;
    horasExtra?: number;
    holidayPay?: number;
    diasFeriados?: number;
    totalIncome: number;
    inssLaboral: number;
    irLaboral: number;
    totalDeductions: number;
    advanceDeduction?: number;
    absenceDeduction?: number;
    diasAusencia?: number;
    judicialDeduction?: number;
    netSalary: number;
    inssPatronal: number;
    inatec: number;
    status: string;
    employeeName?: string;
    employee?: { firstName: string; lastName: string; cedula?: string; inss?: string; role: string; baseSalary: any };
    ventasMes?: number;
}

interface LaborLiability {
    employeeId: string;
    employeeName: string;
    hireDate: string;
    monthsWorked: number;
    vacacionesPendientes: number;
    aguinaldoAcumulado: number;
    indemnizacion: number;
    totalPasivo: number;
}
interface SalaryAdvance {
    id: string;
    employeeId: string;
    amount: number;
    fee: number;
    reason: string;
    status: string;
    createdAt: string;
    employee?: { firstName: string; lastName: string; role: string };
}

interface Leave {
    id: string;
    employeeId: string;
    type: string;
    startDate: string;
    endDate: string;
    status: string;
    reason: string;
    employee?: { firstName: string; lastName: string };
}

interface Shift {
    id: string;
    employeeId: string;
    clockIn: string | null;
    clockOut: string | null;
    totalHours: number;
    employeeName?: string;
}

interface AguinaldoItem {
    employeeId: string;
    name: string;
    cedula?: string;
    baseSalary: number;
    diasLaborados: number;
    monto: number;
    pagado: boolean;
    paidAt: string | null;
}
interface AguinaldoData {
    year: number;
    periodo: string;
    items: AguinaldoItem[];
    totalMonto: number;
    dueDate: string;
    diasParaVencer: number;
    pendientes: number;
}
interface SettlementCalc {
    antiguedadAnios: number;
    antiguedadTexto: string;
    salarioMensual: number;
    salarioDiario: number;
    reason: string;
    aplicaIndemnizacion: boolean;
    indemnizacionDias: number;
    indemnizacion: number;
    diasVacaciones: number;
    vacaciones: number;
    diasAguinaldo: number;
    aguinaldo: number;
    total: number;
}
interface SettlementData {
    employee: { id: string; name: string; cedula?: string; hireDate: string; baseSalary: number; status: string };
    settlement: SettlementCalc;
    yaLiquidado: boolean;
}
interface ContractRow {
    id: string; type: string; startDate: string; endDate: string | null; probationEnd: string | null;
    salary: number; position: string | null; status: string; createdAt: string;
}
interface JudicialRow {
    id: string; type: string; amount: number | null; percentage: number | null;
    beneficiary: string | null; priority: number; startDate: string;
}
interface HolidayRow { id: string; date: string; name: string; national: boolean; }
interface HRAlert { severity: 'danger' | 'warning' | 'info'; message: string; }
interface HRDashboard {
    period: string;
    headcount: number;
    planillaCalculada: boolean;
    costoLaboralReal: number;
    totalDevengado: number;
    nominaNeta: number;
    aportesPatronales: number;
    provisionMensual: number;
    ausentismo: { diasAusencia: number; empleadosConAusencia: number };
    rotacion: { bajasAnio: number; tasaRotacion: number };
    salarioMinimo: number;
    bajoMinimo: { id: string; name: string; baseSalary: number }[];
}
interface ExpedienteData {
    employee: { id: string; name: string; cedula?: string; inss?: string; phone?: string; role: string; baseSalary: number; hireDate: string; status: string; vacationDays: number; bankAccount?: string; jornada?: string; antiguedadTexto: string };
    contracts: ContractRow[];
    judicialDeductions: JudicialRow[];
    linkedUser?: { id: string; name: string; email?: string | null } | null;
    alertas: string[];
}
interface AttendanceRow { employeeId: string; name: string; jornada: string; diasTrabajados: number; horasRegulares: number; horasExtra: number; diasFeriados: number; diasAusencia: number; }
interface AttendanceData { period: string; items: AttendanceRow[]; }

const formatC = (n: number) => `C$ ${n.toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (s: string) => new Date(s).toLocaleDateString('es-NI', { day: '2-digit', month: 'short', year: '2-digit' });
const LEAVE_LABELS: Record<string, string> = { UNPAID: 'Permiso sin goce', VACATION: 'Vacaciones', SICK: 'Incapacidad (INSS)', MATERNITY: 'Maternidad' };
const LEAVE_BADGE: Record<string, string> = { UNPAID: 'bg-amber-100 text-amber-700', VACATION: 'bg-emerald-100 text-emerald-700', SICK: 'bg-orange-100 text-orange-700', MATERNITY: 'bg-pink-100 text-pink-700' };
const REASON_LABELS: Record<string, string> = { DISMISSAL: 'Despido', RESIGNATION: 'Renuncia', MUTUAL: 'Mutuo acuerdo' };
const CONTRACT_LABELS: Record<string, string> = { INDETERMINADO: 'Indeterminado', DETERMINADO: 'Determinado', POR_OBRA: 'Por obra' };
const JORNADA_LABELS: Record<string, string> = { DIURNA: 'Diurna (8h)', NOCTURNA: 'Nocturna (7h)', MIXTA: 'Mixta (7.5h)' };
const JUDICIAL_LABELS: Record<string, string> = { PENSION_ALIMENTICIA: 'Pensión alimenticia', EMBARGO: 'Embargo', OTRO: 'Otro' };

const HRM: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'DASHBOARD' | 'TEAM' | 'PAYROLL' | 'LIABILITIES' | 'AGUINALDO' | 'ADVANCES' | 'LEAVES' | 'TIME'>('TEAM');
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [showModal, setShowModal] = useState(false);
    const [loading, setLoading] = useState(false);

    // Payroll state
    const [payrollMonth, setPayrollMonth] = useState(new Date().getMonth() + 1);
    const [payrollYear, setPayrollYear] = useState(new Date().getFullYear());
    const [payrolls, setPayrolls] = useState<PayrollRecord[]>([]);
    const [calculatingPayroll, setCalculatingPayroll] = useState(false);
    const [showColilla, setShowColilla] = useState<PayrollRecord | null>(null);

    // Liabilities state
    const [liabilities, setLiabilities] = useState<LaborLiability[]>([]);
    const [totalPasivo, setTotalPasivo] = useState(0);

    // Leaves (ausencias) state
    const [leaves, setLeaves] = useState<Leave[]>([]);
    const [leaveForm, setLeaveForm] = useState({ employeeId: '', type: 'UNPAID', startDate: '', endDate: '', reason: '' });
    const [savingLeave, setSavingLeave] = useState(false);

    // Adelantos state
    const [advancesList, setAdvancesList] = useState<{ id: string; amount: number; fee: number; status: string; employee?: { firstName: string; lastName: string } }[]>([]);

    // Aguinaldo state
    const [aguinaldoYear, setAguinaldoYear] = useState(new Date().getFullYear());
    const [aguinaldo, setAguinaldo] = useState<AguinaldoData | null>(null);
    const [runningAg, setRunningAg] = useState(false);

    // Tablero gerencial state
    const [dashMonth, setDashMonth] = useState(new Date().getMonth() + 1);
    const [dashYear, setDashYear] = useState(new Date().getFullYear());
    const [dashboard, setDashboard] = useState<HRDashboard | null>(null);
    const [alerts, setAlerts] = useState<HRAlert[]>([]);

    // Feriados state
    const [holidayYear, setHolidayYear] = useState(new Date().getFullYear());
    const [holidays, setHolidays] = useState<HolidayRow[]>([]);
    const [holidayForm, setHolidayForm] = useState({ date: '', name: '' });
    const [savingHoliday, setSavingHoliday] = useState(false);

    // Liquidación (finiquito) state
    const [settlementEmp, setSettlementEmp] = useState<Employee | null>(null);
    const [settlementReason, setSettlementReason] = useState('DISMISSAL');
    const [settlementDate, setSettlementDate] = useState(new Date().toISOString().slice(0, 10));
    const [settlementData, setSettlementData] = useState<SettlementData | null>(null);
    const [settlementLoading, setSettlementLoading] = useState(false);
    const [settlementPaying, setSettlementPaying] = useState(false);

    // Expediente digital state
    const [expedienteEmp, setExpedienteEmp] = useState<Employee | null>(null);
    const [expediente, setExpediente] = useState<ExpedienteData | null>(null);
    const [expedienteLoading, setExpedienteLoading] = useState(false);
    const [showContractForm, setShowContractForm] = useState(false);
    const [savingContract, setSavingContract] = useState(false);
    const [contractForm, setContractForm] = useState({ type: 'INDETERMINADO', startDate: '', endDate: '', probationEnd: '', salary: '', position: '' });
    const [showJudicialForm, setShowJudicialForm] = useState(false);
    const [savingJudicial, setSavingJudicial] = useState(false);
    const [judicialForm, setJudicialForm] = useState({ type: 'PENSION_ALIMENTICIA', amount: '', percentage: '', beneficiary: '' });
    const [linkableUsers, setLinkableUsers] = useState<{ id: string; name: string; email?: string | null; role: string }[]>([]);
    const [linkUserId, setLinkUserId] = useState('');
    const [savingLink, setSavingLink] = useState(false);

    // New Employee Form
    const [formData, setFormData] = useState({
        firstName: '', lastName: '', role: 'VENDEDOR', baseSalary: '', commissionRate: '', pin: '', cedula: '', inss: '', jornada: 'DIURNA'
    });

    // Reporte de asistencia state
    const [attMonth, setAttMonth] = useState(new Date().getMonth() + 1);
    const [attendance, setAttendance] = useState<AttendanceData | null>(null);

    // PIN change state
    const [pinModal, setPinModal] = useState<{ id: string; name: string } | null>(null);
    const [newPin, setNewPin] = useState('');
    const [pinSaving, setPinSaving] = useState(false);
    const [pinError, setPinError] = useState('');

    const token = localStorage.getItem('nortex_token');
    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

    const fetchEmployees = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/employees', { headers });
            const data = await res.json();
            if (res.ok) setEmployees(data);
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    };

    const handleChangePin = async () => {
        if (!pinModal) return;
        if (!/^\d{4}$/.test(newPin)) { setPinError('PIN debe ser exactamente 4 dígitos.'); return; }
        setPinSaving(true);
        setPinError('');
        try {
            const res = await fetch(`/api/employees/${pinModal.id}/pin`, {
                method: 'PATCH',
                headers,
                body: JSON.stringify({ pin: newPin }),
            });
            const data = await res.json();
            if (!res.ok) { setPinError(data.error || 'Error al cambiar PIN.'); return; }
            await fetchEmployees();
            setPinModal(null);
            setNewPin('');
        } catch { setPinError('Error de conexión.'); }
        finally { setPinSaving(false); }
    };

    const fetchPayrolls = useCallback(async () => {
        try {
            const res = await fetch(`/api/payroll/${payrollMonth}/${payrollYear}`, { headers });
            if (res.ok) {
                const data = await res.json();
                setPayrolls(data);
            }
        } catch (e) { console.error(e); }
    }, [payrollMonth, payrollYear]);

    const fetchLiabilities = async () => {
        try {
            const res = await fetch('/api/labor-liabilities', { headers });
            if (res.ok) {
                const data = await res.json();
                setLiabilities(data.liabilities);
                setTotalPasivo(data.totalPasivo);
            }
        } catch (e) { console.error(e); }
    };

    const fetchLeaves = async () => {
        try {
            const res = await fetch('/api/hr/leaves', { headers });
            if (res.ok) setLeaves(await res.json());
        } catch (e) { console.error(e); }
    };

    const handleCreateLeave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!leaveForm.employeeId || !leaveForm.startDate || !leaveForm.endDate) return;
        setSavingLeave(true);
        try {
            const res = await fetch('/api/hr/leave/request', {
                method: 'POST', headers, body: JSON.stringify(leaveForm),
            });
            const data = await res.json();
            if (!res.ok) { alert(data.error || 'Error al registrar la ausencia'); return; }
            setLeaveForm({ employeeId: '', type: 'UNPAID', startDate: '', endDate: '', reason: '' });
            await fetchLeaves();
        } catch { alert('Error de conexión'); }
        finally { setSavingLeave(false); }
    };

    const decideLeave = async (id: string, action: 'APPROVED' | 'REJECTED') => {
        try {
            const res = await fetch(`/api/hr/leave/${id}/decision`, { method: 'PATCH', headers, body: JSON.stringify({ action }) });
            if (res.ok) await fetchLeaves();
            else { const d = await res.json(); alert(d.error || 'Error'); }
        } catch { alert('Error de conexión'); }
    };

    const fetchAdvances = async () => {
        try { const res = await fetch('/api/hr/advances', { headers }); if (res.ok) setAdvancesList(await res.json()); } catch (e) { console.error(e); }
    };
    const decideAdvance = async (advanceId: string, action: 'APPROVED' | 'REJECTED') => {
        try {
            const res = await fetch('/api/hr/advance/approve', { method: 'POST', headers, body: JSON.stringify({ advanceId, action }) });
            if (res.ok) await fetchAdvances();
            else { const d = await res.json(); alert(d.error || 'Error'); }
        } catch { alert('Error de conexión'); }
    };

    const fetchAguinaldo = useCallback(async () => {
        try {
            const res = await fetch(`/api/payroll/aguinaldo/${aguinaldoYear}`, { headers });
            if (res.ok) setAguinaldo(await res.json());
        } catch (e) { console.error(e); }
    }, [aguinaldoYear]);

    const handleRunAguinaldo = async () => {
        if (!confirm(`¿Correr el aguinaldo ${aguinaldoYear}? Se pagará a los colaboradores pendientes y quedará registrado contablemente.`)) return;
        setRunningAg(true);
        try {
            const res = await fetch(`/api/payroll/aguinaldo/${aguinaldoYear}/run`, { method: 'POST', headers });
            const data = await res.json();
            if (!res.ok) { alert(data.error || 'Error al correr el aguinaldo'); return; }
            alert(data.message);
            await fetchAguinaldo();
        } catch { alert('Error de conexión'); }
        finally { setRunningAg(false); }
    };

    const fetchSettlement = useCallback(async () => {
        if (!settlementEmp) return;
        setSettlementLoading(true);
        try {
            const res = await fetch(`/api/hrm/settlement-preview/${settlementEmp.id}?reason=${settlementReason}&date=${settlementDate}`, { headers });
            if (res.ok) setSettlementData(await res.json());
        } catch (e) { console.error(e); }
        finally { setSettlementLoading(false); }
    }, [settlementEmp, settlementReason, settlementDate]);

    const paySettlement = async () => {
        if (!settlementEmp || !settlementData) return;
        if (!confirm(`¿Liquidar a ${settlementEmp.firstName} ${settlementEmp.lastName} por ${formatC(settlementData.settlement.total)}? El colaborador quedará dado de baja.`)) return;
        setSettlementPaying(true);
        try {
            const res = await fetch(`/api/hrm/settlement/${settlementEmp.id}`, {
                method: 'POST', headers,
                body: JSON.stringify({ reason: settlementReason, terminationDate: settlementDate }),
            });
            const data = await res.json();
            if (!res.ok) { alert(data.error || 'Error al liquidar'); return; }
            printFiniquito(settlementData);
            setSettlementEmp(null);
            await fetchEmployees();
        } catch { alert('Error de conexión'); }
        finally { setSettlementPaying(false); }
    };

    const printFiniquito = (data: SettlementData) => {
        const s = data.settlement;
        const html = `<!DOCTYPE html><html><head><title>Finiquito - ${data.employee.name}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', sans-serif; padding: 40px; color: #1e293b; max-width: 720px; margin: 0 auto; }
        .header { text-align: center; border-bottom: 3px solid #0f172a; padding-bottom: 20px; margin-bottom: 20px; }
        .header h1 { font-size: 22px; color: #0f172a; }
        .header p { font-size: 12px; color: #64748b; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 20px; font-size: 13px; }
        .info-grid .label { color: #64748b; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
        th { background: #0f172a; color: white; padding: 8px 12px; text-align: left; font-size: 12px; text-transform: uppercase; }
        td { padding: 9px 12px; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
        .amount { text-align: right; font-family: monospace; font-weight: bold; }
        .net-row { background: #dcfce7; font-size: 18px; }
        .footer { text-align: center; margin-top: 40px; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 15px; }
        .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 60px; text-align: center; font-size: 12px; }
        .sig-line { border-top: 1px solid #333; padding-top: 5px; margin-top: 40px; }
      </style></head><body>
        <div class="header">
          <h1>FINIQUITO LABORAL</h1>
          <p>Liquidación final — Ley 185, Arts. 42-45</p>
        </div>
        <div class="info-grid">
          <div><span class="label">Empleado:</span> <strong>${data.employee.name}</strong></div>
          <div><span class="label">Cédula:</span> <strong>${data.employee.cedula || 'N/A'}</strong></div>
          <div><span class="label">Ingreso:</span> <strong>${new Date(data.employee.hireDate).toLocaleDateString('es-NI')}</strong></div>
          <div><span class="label">Antigüedad:</span> <strong>${s.antiguedadTexto}</strong></div>
          <div><span class="label">Causa:</span> <strong>${REASON_LABELS[s.reason] || s.reason}</strong></div>
          <div><span class="label">Salario base (prom. 6m):</span> <strong>C$ ${s.salarioMensual.toFixed(2)}</strong></div>
        </div>
        <table>
          <thead><tr><th>Concepto</th><th style="text-align:right">Monto</th></tr></thead>
          <tbody>
            <tr><td>Indemnización por antigüedad (Art. 45)${s.aplicaIndemnizacion ? ` — ${s.indemnizacionDias.toFixed(0)} días` : ' — no aplica'}</td><td class="amount">C$ ${s.indemnizacion.toFixed(2)}</td></tr>
            <tr><td>Vacaciones pendientes (${s.diasVacaciones.toFixed(1)} días)</td><td class="amount">C$ ${s.vacaciones.toFixed(2)}</td></tr>
            <tr><td>Aguinaldo proporcional (${s.diasAguinaldo} días)</td><td class="amount">C$ ${s.aguinaldo.toFixed(2)}</td></tr>
            <tr class="net-row"><td><strong>TOTAL A PAGAR</strong></td><td class="amount"><strong>C$ ${s.total.toFixed(2)}</strong></td></tr>
          </tbody>
        </table>
        <div class="signatures">
          <div><div class="sig-line">Firma del Empleado</div></div>
          <div><div class="sig-line">Firma del Empleador</div></div>
        </div>
        <div class="footer">Generado por NORTEX ERP | Ley 185 Código del Trabajo de Nicaragua</div>
      </body></html>`;
        const w = window.open('', '_blank');
        if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 500); }
    };

    useEffect(() => { fetchEmployees(); }, []);
    useEffect(() => { if (activeTab === 'PAYROLL') fetchPayrolls(); }, [activeTab, fetchPayrolls]);
    useEffect(() => { if (activeTab === 'LIABILITIES') fetchLiabilities(); }, [activeTab]);
    useEffect(() => { if (activeTab === 'LEAVES') fetchLeaves(); }, [activeTab]);
    useEffect(() => { if (activeTab === 'ADVANCES') fetchAdvances(); }, [activeTab]);
    useEffect(() => { if (activeTab === 'AGUINALDO') fetchAguinaldo(); }, [activeTab, fetchAguinaldo]);

    const fetchDashboard = useCallback(async () => {
        try {
            const res = await fetch(`/api/hrm/dashboard/${dashYear}/${dashMonth}`, { headers });
            if (res.ok) setDashboard(await res.json());
        } catch (e) { console.error(e); }
    }, [dashMonth, dashYear]);
    useEffect(() => { if (activeTab === 'DASHBOARD') fetchDashboard(); }, [activeTab, fetchDashboard]);

    const fetchAlerts = async () => {
        try { const res = await fetch('/api/hr/alerts', { headers }); if (res.ok) { const d = await res.json(); setAlerts(d.alerts || []); } } catch (e) { console.error(e); }
    };
    useEffect(() => { fetchAlerts(); }, []);

    const fetchHolidays = useCallback(async () => {
        try {
            const res = await fetch(`/api/hr/holidays/${holidayYear}`, { headers });
            if (res.ok) setHolidays(await res.json());
        } catch (e) { console.error(e); }
    }, [holidayYear]);
    useEffect(() => { if (activeTab === 'TIME') fetchHolidays(); }, [activeTab, fetchHolidays]);

    const fetchAttendance = useCallback(async () => {
        try {
            const res = await fetch(`/api/hr/attendance/${holidayYear}/${attMonth}`, { headers });
            if (res.ok) setAttendance(await res.json());
        } catch (e) { console.error(e); }
    }, [holidayYear, attMonth]);
    useEffect(() => { if (activeTab === 'TIME') fetchAttendance(); }, [activeTab, fetchAttendance]);

    const fmtHoliday = (iso: string) => {
        const [y, m, d] = iso.slice(0, 10).split('-');
        return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString('es-NI', { weekday: 'short', day: '2-digit', month: 'short' });
    };

    const addHoliday = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!holidayForm.date || !holidayForm.name) return;
        setSavingHoliday(true);
        try {
            const res = await fetch('/api/hr/holidays', { method: 'POST', headers, body: JSON.stringify(holidayForm) });
            const data = await res.json();
            if (!res.ok) { alert(data.error || 'Error al agregar el feriado'); return; }
            setHolidayForm({ date: '', name: '' });
            await fetchHolidays();
        } catch { alert('Error de conexión'); }
        finally { setSavingHoliday(false); }
    };

    const deleteHoliday = async (id: string) => {
        if (!confirm('¿Eliminar este feriado?')) return;
        try {
            const res = await fetch(`/api/hr/holidays/${id}`, { method: 'DELETE', headers });
            if (res.ok) await fetchHolidays();
            else { const d = await res.json(); alert(d.error || 'Error'); }
        } catch { alert('Error de conexión'); }
    };
    useEffect(() => { if (settlementEmp) fetchSettlement(); }, [settlementEmp, fetchSettlement]);

    const fetchExpediente = useCallback(async () => {
        if (!expedienteEmp) return;
        setExpedienteLoading(true);
        try {
            const res = await fetch(`/api/hr/employees/${expedienteEmp.id}/file`, { headers });
            if (res.ok) setExpediente(await res.json());
        } catch (e) { console.error(e); }
        finally { setExpedienteLoading(false); }
    }, [expedienteEmp]);

    const fetchLinkable = async () => {
        try { const res = await fetch('/api/hr/linkable-users', { headers }); if (res.ok) setLinkableUsers(await res.json()); } catch (e) { console.error(e); }
    };

    useEffect(() => { if (expedienteEmp) { setShowContractForm(false); setShowJudicialForm(false); setLinkUserId(''); fetchExpediente(); fetchLinkable(); } }, [expedienteEmp, fetchExpediente]);

    const linkUser = async () => {
        if (!expedienteEmp || !linkUserId) return;
        setSavingLink(true);
        try {
            const res = await fetch(`/api/hr/employees/${expedienteEmp.id}/link-user`, { method: 'PATCH', headers, body: JSON.stringify({ userId: linkUserId }) });
            const d = await res.json();
            if (!res.ok) { alert(d.error || 'Error al vincular'); return; }
            setLinkUserId('');
            await fetchExpediente();
            await fetchLinkable();
        } catch { alert('Error de conexión'); }
        finally { setSavingLink(false); }
    };

    const unlinkUser = async () => {
        if (!expedienteEmp || !confirm('¿Desvincular la cuenta de acceso? El colaborador dejará de ver su Mi Espacio.')) return;
        setSavingLink(true);
        try {
            const res = await fetch(`/api/hr/employees/${expedienteEmp.id}/link-user`, { method: 'PATCH', headers, body: JSON.stringify({ userId: null }) });
            if (res.ok) { await fetchExpediente(); await fetchLinkable(); }
            else { const d = await res.json(); alert(d.error || 'Error'); }
        } catch { alert('Error de conexión'); }
        finally { setSavingLink(false); }
    };

    const openContractForm = () => {
        if (!expedienteEmp) return;
        setContractForm({
            type: 'INDETERMINADO',
            startDate: new Date(expedienteEmp.hireDate).toISOString().slice(0, 10),
            endDate: '', probationEnd: '',
            salary: String(expedienteEmp.baseSalary || ''),
            position: expedienteEmp.role || '',
        });
        setShowContractForm(true);
    };

    const handleAddContract = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!expedienteEmp || !contractForm.startDate || !contractForm.salary) return;
        setSavingContract(true);
        try {
            const res = await fetch(`/api/hr/employees/${expedienteEmp.id}/contract`, {
                method: 'POST', headers, body: JSON.stringify(contractForm),
            });
            const data = await res.json();
            if (!res.ok) { alert(data.error || 'Error al registrar el contrato'); return; }
            setShowContractForm(false);
            await fetchExpediente();
        } catch { alert('Error de conexión'); }
        finally { setSavingContract(false); }
    };

    const handleAddJudicial = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!expedienteEmp) return;
        if (!judicialForm.amount && !judicialForm.percentage) { alert('Indique un monto fijo o un porcentaje.'); return; }
        setSavingJudicial(true);
        try {
            const res = await fetch(`/api/hr/employees/${expedienteEmp.id}/judicial`, {
                method: 'POST', headers, body: JSON.stringify(judicialForm),
            });
            const data = await res.json();
            if (!res.ok) { alert(data.error || 'Error al registrar la deducción'); return; }
            setJudicialForm({ type: 'PENSION_ALIMENTICIA', amount: '', percentage: '', beneficiary: '' });
            setShowJudicialForm(false);
            await fetchExpediente();
        } catch { alert('Error de conexión'); }
        finally { setSavingJudicial(false); }
    };

    const endJudicial = async (id: string) => {
        if (!confirm('¿Finalizar esta deducción judicial? Dejará de descontarse de la nómina.')) return;
        try {
            const res = await fetch(`/api/hr/judicial/${id}/end`, { method: 'PATCH', headers });
            if (res.ok) await fetchExpediente();
            else { const d = await res.json(); alert(d.error || 'Error'); }
        } catch { alert('Error de conexión'); }
    };

    const handleCreateEmployee = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const res = await fetch('/api/employees', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    firstName: formData.firstName,
                    lastName: formData.lastName,
                    role: formData.role,
                    baseSalary: parseFloat(formData.baseSalary),
                    commissionRate: parseFloat(formData.commissionRate) / 100,
                    pin: formData.pin || '0000',
                    cedula: formData.cedula || null,
                    inss: formData.inss || null,
                    jornada: formData.jornada,
                })
            });
            const data = await res.json();
            if (res.ok) {
                setShowModal(false);
                setFormData({ firstName: '', lastName: '', role: 'VENDEDOR', baseSalary: '', commissionRate: '', pin: '', cedula: '', inss: '', jornada: 'DIURNA' });
                fetchEmployees();
                alert("Colaborador añadido exitosamente.");
            } else {
                alert(data.error || 'Error al crear empleado');
            }
        } catch (e: any) { alert("Error de conexion: " + (e?.message || e)); }
    };

    const handleCalculatePayroll = async () => {
        setCalculatingPayroll(true);
        try {
            const res = await fetch('/api/payroll/calculate', {
                method: 'POST',
                headers,
                body: JSON.stringify({ month: payrollMonth, year: payrollYear }),
            });
            if (res.ok) {
                const data = await res.json();
                setPayrolls(data.payrolls);
                alert(`Nómina ${payrollMonth}/${payrollYear} calculada para ${data.payrolls.length} empleados.`);
            } else {
                const err = await res.json();
                alert(err.error || 'Error al calcular nómina');
            }
        } catch (e: any) { alert('Error de conexión: ' + e?.message); }
        finally { setCalculatingPayroll(false); }
    };

    const handlePayPayroll = async (payrollId: string) => {
        if (!confirm('¿Confirma el pago de esta nómina?')) return;
        try {
            const res = await fetch(`/api/payroll/${payrollId}/pay`, { method: 'POST', headers });
            if (res.ok) {
                fetchPayrolls();
                alert('Nómina pagada exitosamente.');
            }
        } catch (e) { alert('Error al pagar'); }
    };

    // B5 — Exportar la planilla INSS/SIE del mes a Excel (para declarar al INSS).
    const [exportingSIE, setExportingSIE] = useState(false);
    const exportPlanillaINSS = async () => {
        setExportingSIE(true);
        try {
            const res = await fetch(`/api/payroll/sie/${payrollMonth}/${payrollYear}`, { headers });
            if (!res.ok) { alert('No se pudo generar el reporte INSS.'); return; }
            const data = await res.json();
            const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
            const rows: Record<string, string | number>[] = data.empleados.map((e: any, i: number) => ({
                '#': i + 1,
                'N° INSS': e.inss || '— FALTA —',
                'Cédula': e.cedula || '',
                'Nombre': e.nombre,
                'Salario (C$)': e.salario,
                'INSS Laboral 7%': e.inssLaboral,
                'INSS Patronal': e.inssPatronal,
                'Total INSS': e.totalInss,
                'INATEC 2%': e.inatec,
            }));
            rows.push({
                '#': '', 'N° INSS': '', 'Cédula': '', 'Nombre': 'TOTALES',
                'Salario (C$)': data.totals.salario, 'INSS Laboral 7%': data.totals.inssLaboral,
                'INSS Patronal': data.totals.inssPatronal, 'Total INSS': data.totals.totalInss, 'INATEC 2%': data.totals.inatec,
            });
            const ws = XLSX.utils.aoa_to_sheet([
                [`PLANILLA INSS — ${data.empresa}`],
                [`RUC: ${data.ruc}   |   Período: ${meses[data.month - 1]} ${data.year}`],
                [],
            ]);
            XLSX.utils.sheet_add_json(ws, rows, { origin: 'A4' });
            ws['!cols'] = [{ wch: 4 }, { wch: 16 }, { wch: 16 }, { wch: 28 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 }];
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Planilla INSS');
            XLSX.writeFile(wb, `Planilla_INSS_${data.year}_${String(data.month).padStart(2, '0')}.xlsx`);
            if (data.empleadosSinINSS > 0) {
                alert(`${data.empleadosSinINSS} empleado(s) sin número INSS. Complétalo en su ficha para una declaración válida.`);
            }
        } catch {
            alert('Error de conexión al generar el Excel.');
        } finally {
            setExportingSIE(false);
        }
    };

    const printColilla = (p: PayrollRecord) => {
        const empName = p.employee ? `${p.employee.firstName} ${p.employee.lastName}` : (p.employeeName || 'Empleado');
        const cedula = p.employee?.cedula || '';
        const inss = p.employee?.inss || '';
        const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

        const html = `<!DOCTYPE html><html><head><title>Colilla de Pago - ${empName}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', sans-serif; padding: 40px; color: #1e293b; max-width: 800px; margin: 0 auto; }
        .header { text-align: center; border-bottom: 3px solid #0f172a; padding-bottom: 20px; margin-bottom: 20px; }
        .header h1 { font-size: 22px; color: #0f172a; }
        .header p { font-size: 12px; color: #64748b; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 20px; font-size: 13px; }
        .info-grid .label { color: #64748b; }
        .info-grid .value { font-weight: bold; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
        th { background: #0f172a; color: white; padding: 8px 12px; text-align: left; font-size: 12px; text-transform: uppercase; }
        td { padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
        .amount { text-align: right; font-family: monospace; font-weight: bold; }
        .total-row { background: #f1f5f9; font-weight: bold; }
        .net-row { background: #dcfce7; font-size: 16px; }
        .footer { text-align: center; margin-top: 40px; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 15px; }
        .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 60px; text-align: center; font-size: 12px; }
        .sig-line { border-top: 1px solid #333; padding-top: 5px; margin-top: 40px; }
        @media print { body { padding: 20px; } }
      </style></head><body>
        <div class="header">
          <h1>COLILLA DE PAGO</h1>
          <p>Periodo: ${monthNames[p.month - 1]} ${p.year}</p>
        </div>
        <div class="info-grid">
          <div><span class="label">Empleado:</span> <span class="value">${empName}</span></div>
          <div><span class="label">Cédula:</span> <span class="value">${cedula || 'N/A'}</span></div>
          <div><span class="label">No. INSS:</span> <span class="value">${inss || 'N/A'}</span></div>
          <div><span class="label">Cargo:</span> <span class="value">${p.employee?.role || ''}</span></div>
        </div>

        <table>
          <thead><tr><th colspan="2">INGRESOS</th></tr></thead>
          <tbody>
            <tr><td>Salario Base</td><td class="amount">C$ ${Number(p.grossSalary).toFixed(2)}</td></tr>
            <tr><td>Comisiones del Periodo</td><td class="amount">C$ ${Number(p.commissions).toFixed(2)}</td></tr>
            ${Number(p.overtimePay || 0) > 0 ? `<tr><td>Horas Extra (${Number(p.horasExtra || 0)} h al doble · Art. 62)</td><td class="amount">C$ ${Number(p.overtimePay).toFixed(2)}</td></tr>` : ''}
            ${Number(p.holidayPay || 0) > 0 ? `<tr><td>Feriado trabajado (${Number(p.diasFeriados || 0)} día${Number(p.diasFeriados || 0) === 1 ? '' : 's'} · recargo Art. 68)</td><td class="amount">C$ ${Number(p.holidayPay).toFixed(2)}</td></tr>` : ''}
            ${Number(p.absenceDeduction || 0) > 0 ? `<tr><td>Ausencias sin goce (${Number(p.diasAusencia || 0)} día${Number(p.diasAusencia || 0) === 1 ? '' : 's'})</td><td class="amount">- C$ ${Number(p.absenceDeduction).toFixed(2)}</td></tr>` : ''}
            <tr class="total-row"><td>TOTAL DEVENGADO</td><td class="amount">C$ ${Number(p.totalIncome).toFixed(2)}</td></tr>
          </tbody>
        </table>

        <table>
          <thead><tr><th colspan="2">DEDUCCIONES DE LEY</th></tr></thead>
          <tbody>
            <tr><td>INSS Laboral (7%)</td><td class="amount">- C$ ${Number(p.inssLaboral).toFixed(2)}</td></tr>
            <tr><td>IR Laboral (Tabla DGI)</td><td class="amount">- C$ ${Number(p.irLaboral).toFixed(2)}</td></tr>
            <tr class="total-row"><td>TOTAL DEDUCCIONES</td><td class="amount">- C$ ${Number(p.totalDeductions).toFixed(2)}</td></tr>
          </tbody>
        </table>

        ${(Number(p.advanceDeduction || 0) > 0 || Number(p.judicialDeduction || 0) > 0) ? `<table>
          <thead><tr><th colspan="2">OTROS DESCUENTOS</th></tr></thead>
          <tbody>
            ${Number(p.judicialDeduction || 0) > 0 ? `<tr><td>Deducción judicial (pensión / embargo)</td><td class="amount">- C$ ${Number(p.judicialDeduction).toFixed(2)}</td></tr>` : ''}
            ${Number(p.advanceDeduction || 0) > 0 ? `<tr><td>Adelanto de salario</td><td class="amount">- C$ ${Number(p.advanceDeduction).toFixed(2)}</td></tr>` : ''}
          </tbody>
        </table>` : ''}

        <table>
          <tbody>
            <tr class="net-row"><td><strong>NETO A RECIBIR</strong></td><td class="amount"><strong>C$ ${Number(p.netSalary).toFixed(2)}</strong></td></tr>
          </tbody>
        </table>

        <table>
          <thead><tr><th colspan="2">APORTES PATRONALES (Informativo)</th></tr></thead>
          <tbody>
            <tr><td>INSS Patronal (22.5%)</td><td class="amount">C$ ${Number(p.inssPatronal).toFixed(2)}</td></tr>
            <tr><td>INATEC (2%)</td><td class="amount">C$ ${Number(p.inatec).toFixed(2)}</td></tr>
          </tbody>
        </table>

        <div class="signatures">
          <div><div class="sig-line">Firma del Empleado</div></div>
          <div><div class="sig-line">Firma del Empleador</div></div>
        </div>

        <div class="footer">
          Generado por NORTEX ERP | Ley 185 Código del Trabajo | Ley 539 Seguridad Social
        </div>
      </body></html>`;

        const w = window.open('', '_blank');
        if (w) {
            w.document.write(html);
            w.document.close();
            setTimeout(() => w.print(), 500);
        }
    };

    const printAguinaldo = (item: AguinaldoItem) => {
        const html = `<!DOCTYPE html><html><head><title>Comprobante de Aguinaldo - ${item.name}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', sans-serif; padding: 40px; color: #1e293b; max-width: 700px; margin: 0 auto; }
        .header { text-align: center; border-bottom: 3px solid #0f172a; padding-bottom: 20px; margin-bottom: 20px; }
        .header h1 { font-size: 22px; color: #0f172a; }
        .header p { font-size: 12px; color: #64748b; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 20px; font-size: 13px; }
        .info-grid .label { color: #64748b; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
        td { padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
        .amount { text-align: right; font-family: monospace; font-weight: bold; }
        .net-row { background: #dcfce7; font-size: 18px; }
        .footer { text-align: center; margin-top: 40px; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 15px; }
        .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 60px; text-align: center; font-size: 12px; }
        .sig-line { border-top: 1px solid #333; padding-top: 5px; margin-top: 40px; }
      </style></head><body>
        <div class="header">
          <h1>COMPROBANTE DE AGUINALDO</h1>
          <p>Treceavo Mes — Período ${aguinaldo?.periodo || ''}</p>
        </div>
        <div class="info-grid">
          <div><span class="label">Empleado:</span> <strong>${item.name}</strong></div>
          <div><span class="label">Cédula:</span> <strong>${item.cedula || 'N/A'}</strong></div>
          <div><span class="label">Salario Base:</span> <strong>C$ ${Number(item.baseSalary).toFixed(2)}</strong></div>
          <div><span class="label">Días laborados:</span> <strong>${item.diasLaborados} días</strong></div>
        </div>
        <table>
          <tbody>
            <tr><td>Aguinaldo proporcional (Art. 93)</td><td class="amount">C$ ${Number(item.monto).toFixed(2)}</td></tr>
            <tr><td>Deducciones (exento de INSS e IR)</td><td class="amount">C$ 0.00</td></tr>
            <tr class="net-row"><td><strong>NETO A RECIBIR</strong></td><td class="amount"><strong>C$ ${Number(item.monto).toFixed(2)}</strong></td></tr>
          </tbody>
        </table>
        <div class="signatures">
          <div><div class="sig-line">Firma del Empleado</div></div>
          <div><div class="sig-line">Firma del Empleador</div></div>
        </div>
        <div class="footer">Generado por NORTEX ERP | Ley 185 Código del Trabajo, Arts. 93-95</div>
      </body></html>`;
        const w = window.open('', '_blank');
        if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 500); }
    };

    const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

    // Pasivo laboral semáforo
    const pasivoSemaforo = totalPasivo > 50000 ? 'red' : totalPasivo > 20000 ? 'yellow' : 'green';

    return (
        <>
        <div className="flex h-full bg-slate-100 overflow-hidden">
            {/* Sidebar Navigation */}
            <div className="w-64 bg-white border-r border-slate-200 flex flex-col text-slate-800">
                <div className="p-6 border-b border-slate-200 text-slate-800">
                    <h2 className="text-xl font-bold text-nortex-900 flex items-center gap-2">
                        <Briefcase className="text-nortex-500" /> Recursos Humanos
                    </h2>
                    <p className="text-xs text-slate-400 mt-1">Nómina & Leyes Laborales NI</p>
                </div>
                <nav className="p-4 space-y-2">
                    <button
                        onClick={() => setActiveTab('DASHBOARD')}
                        className={`w-full text-left px-4 py-3 rounded-lg font-medium flex items-center gap-3 transition-colors ${activeTab === 'DASHBOARD' ? 'bg-nortex-50 text-nortex-700' : 'text-slate-500 hover:bg-slate-50'}`}
                    >
                        <BarChart3 size={18} /> Tablero
                        {alerts.length > 0 && <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-red-100 text-red-700">{alerts.length}</span>}
                    </button>
                    <button
                        onClick={() => setActiveTab('TEAM')}
                        className={`w-full text-left px-4 py-3 rounded-lg font-medium flex items-center gap-3 transition-colors ${activeTab === 'TEAM' ? 'bg-nortex-50 text-nortex-700' : 'text-slate-500 hover:bg-slate-50'}`}
                    >
                        <Users size={18} /> Mi Equipo
                    </button>
                    <button
                        onClick={() => setActiveTab('PAYROLL')}
                        className={`w-full text-left px-4 py-3 rounded-lg font-medium flex items-center gap-3 transition-colors ${activeTab === 'PAYROLL' ? 'bg-nortex-50 text-nortex-700' : 'text-slate-500 hover:bg-slate-50'}`}
                    >
                        <Calculator size={18} /> Nómina Nica
                    </button>
                    <button
                        onClick={() => setActiveTab('LIABILITIES')}
                        className={`w-full text-left px-4 py-3 rounded-lg font-medium flex items-center gap-3 transition-colors ${activeTab === 'LIABILITIES' ? 'bg-nortex-50 text-nortex-700' : 'text-slate-500 hover:bg-slate-50'}`}
                    >
                        <Shield size={18} /> Pasivo Laboral
                        {totalPasivo > 0 && (
                            <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded font-bold ${pasivoSemaforo === 'red' ? 'bg-red-100 text-red-700' :
                                pasivoSemaforo === 'yellow' ? 'bg-yellow-100 text-yellow-700' :
                                    'bg-green-100 text-green-700'
                                }`}>!</span>
                        )}
                    </button>
                    <button
                        onClick={() => setActiveTab('AGUINALDO')}
                        className={`w-full text-left px-4 py-3 rounded-lg font-medium flex items-center gap-3 transition-colors ${activeTab === 'AGUINALDO' ? 'bg-rose-50 text-rose-700' : 'text-slate-500 hover:bg-slate-50'}`}
                    >
                        <Gift size={18} /> Aguinaldo
                    </button>
                    <div className="pt-4 pb-2">
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider px-4">Operaciones</p>
                    </div>
                    <button
                        onClick={() => setActiveTab('TIME')}
                        className={`w-full text-left px-4 py-3 rounded-lg font-medium flex items-center gap-3 transition-colors ${activeTab === 'TIME' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50'}`}
                    >
                        <Clock size={18} /> Asistencia y Turnos
                    </button>
                    <button
                        onClick={() => setActiveTab('ADVANCES')}
                        className={`w-full text-left px-4 py-3 rounded-lg font-medium flex items-center gap-3 transition-colors ${activeTab === 'ADVANCES' ? 'bg-emerald-50 text-emerald-700' : 'text-slate-500 hover:bg-slate-50'}`}
                    >
                        <DollarSign size={18} /> Adelantos (Lending)
                    </button>
                    <button
                        onClick={() => setActiveTab('LEAVES')}
                        className={`w-full text-left px-4 py-3 rounded-lg font-medium flex items-center gap-3 transition-colors ${activeTab === 'LEAVES' ? 'bg-amber-50 text-amber-700' : 'text-slate-500 hover:bg-slate-50'}`}
                    >
                        <Calendar size={18} /> Gestión de Vacaciones
                    </button>
                </nav>
            </div>

            {/* Main Content */}
            <div className="flex-1 p-8 overflow-y-auto">

                {/* ==================== TAB: TABLERO ==================== */}
                {activeTab === 'DASHBOARD' && (
                    <div>
                        <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
                            <div>
                                <h3 className="text-2xl font-bold text-slate-800">Tablero de RRHH</h3>
                                <p className="text-slate-500 text-sm">Costo laboral real, ausentismo y rotación.</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <select value={dashMonth} onChange={e => setDashMonth(Number(e.target.value))} className="border border-slate-300 p-2 rounded bg-white text-slate-800 text-sm">
                                    {monthNames.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                                </select>
                                <select value={dashYear} onChange={e => setDashYear(Number(e.target.value))} className="border border-slate-300 p-2 rounded bg-white text-slate-800 text-sm font-mono">
                                    {[0, 1, 2].map(d => { const yr = new Date().getFullYear() - d; return <option key={yr} value={yr}>{yr}</option>; })}
                                </select>
                            </div>
                        </div>

                        {alerts.length > 0 && (
                            <div className="mb-6 space-y-2">
                                <h4 className="text-sm font-bold text-slate-600 flex items-center gap-2"><AlertTriangle size={15} className="text-amber-500" /> Alertas ({alerts.length})</h4>
                                {alerts.map((a, i) => {
                                    const cls = a.severity === 'danger' ? 'bg-red-50 border-red-200 text-red-700' : a.severity === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-blue-50 border-blue-200 text-blue-700';
                                    return <div key={i} className={`text-sm border rounded-lg px-4 py-2.5 ${cls}`}>{a.message}</div>;
                                })}
                            </div>
                        )}

                        {!dashboard ? (
                            <div className="py-12 text-center text-slate-400">Cargando…</div>
                        ) : (
                            <>
                                {!dashboard.planillaCalculada && (
                                    <div className="mb-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-2"><AlertTriangle size={15} /> La nómina de este mes aún no se calculó — los montos aparecerán al correrla.</div>
                                )}
                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                                    {([
                                        { label: 'Costo laboral real', value: formatC(dashboard.costoLaboralReal), sub: 'incluye aportes + provisiones', dark: true },
                                        { label: 'Nómina neta', value: formatC(dashboard.nominaNeta), sub: 'a pagar' },
                                        { label: 'Aportes patronales', value: formatC(dashboard.aportesPatronales), sub: 'INSS + INATEC' },
                                        { label: 'Provisión del mes', value: formatC(dashboard.provisionMensual), sub: 'aguinaldo + vac. + indem.' },
                                        { label: 'Colaboradores', value: String(dashboard.headcount), sub: 'activos' },
                                        { label: 'Devengado total', value: formatC(dashboard.totalDevengado), sub: 'bruto del mes' },
                                        { label: 'Ausentismo', value: `${dashboard.ausentismo.diasAusencia} días`, sub: `${dashboard.ausentismo.empleadosConAusencia} colaborador(es)` },
                                        { label: 'Rotación (año)', value: `${dashboard.rotacion.tasaRotacion}%`, sub: `${dashboard.rotacion.bajasAnio} baja(s)` },
                                    ] as { label: string; value: string; sub: string; dark?: boolean }[]).map((m, i) => (
                                        <div key={i} className={`rounded-xl p-4 border ${m.dark ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-200'}`}>
                                            <p className={`text-[11px] uppercase tracking-wider ${m.dark ? 'text-slate-300' : 'text-slate-400'}`}>{m.label}</p>
                                            <p className="text-xl font-bold font-mono mt-1">{m.value}</p>
                                            <p className={`text-[11px] mt-0.5 ${m.dark ? 'text-slate-400' : 'text-slate-400'}`}>{m.sub}</p>
                                        </div>
                                    ))}
                                </div>

                                {dashboard.salarioMinimo > 0 && (
                                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
                                        <div className="flex items-center justify-between mb-3">
                                            <h4 className="font-bold text-slate-700">Alerta de salario mínimo</h4>
                                            <span className="text-xs text-slate-500">Mínimo vigente: {formatC(dashboard.salarioMinimo)}</span>
                                        </div>
                                        {dashboard.bajoMinimo.length === 0 ? (
                                            <p className="text-sm text-emerald-600 flex items-center gap-2"><CheckCircle size={15} /> Ningún colaborador por debajo del salario mínimo.</p>
                                        ) : (
                                            <div className="space-y-2">
                                                {dashboard.bajoMinimo.map(e => (
                                                    <div key={e.id} className="flex items-center justify-between bg-red-50 border border-red-200 rounded-lg px-4 py-2">
                                                        <span className="font-semibold text-slate-700">{e.name}</span>
                                                        <span className="font-mono text-red-600 font-bold">{formatC(e.baseSalary)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}

                {/* ==================== TAB: EQUIPO ==================== */}
                {activeTab === 'TEAM' && (
                    <div>
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-2xl font-bold text-slate-800">Directorio de Personal</h3>
                            <button onClick={() => setShowModal(true)} className="bg-nortex-900 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-nortex-800">
                                <UserPlus size={18} /> Nuevo Colaborador
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {employees.map(emp => (
                                <div key={emp.id} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all text-slate-800">
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center text-slate-500 font-bold text-xl">
                                            {emp.firstName[0]}{emp.lastName[0]}
                                        </div>
                                        <span className="px-2 py-1 bg-blue-50 text-blue-700 text-xs font-bold rounded uppercase">{emp.role}</span>
                                    </div>
                                    <h4 className="text-lg font-bold text-slate-800">{emp.firstName} {emp.lastName}</h4>
                                    <div className="mt-4 space-y-2 text-sm text-slate-600">
                                        <div className="flex justify-between items-center">
                                            <span className="flex items-center gap-1"><KeyRound size={13} /> PIN:</span>
                                            <div className="flex items-center gap-2">
                                                <span className="font-mono font-bold bg-slate-100 px-2 py-0.5 rounded tracking-widest">{emp.pin || '****'}</span>
                                                <button
                                                    onClick={() => { setPinModal({ id: emp.id, name: `${emp.firstName} ${emp.lastName}` }); setNewPin(''); setPinError(''); }}
                                                    className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold underline"
                                                >
                                                    Cambiar
                                                </button>
                                            </div>
                                        </div>
                                        {(emp as any).cedula && (
                                            <div className="flex justify-between">
                                                <span>Cédula:</span>
                                                <span className="font-mono text-xs">{(emp as any).cedula}</span>
                                            </div>
                                        )}
                                        {(emp as any).inss && (
                                            <div className="flex justify-between">
                                                <span>INSS:</span>
                                                <span className="font-mono text-xs">{(emp as any).inss}</span>
                                            </div>
                                        )}
                                        <div className="flex justify-between">
                                            <span>Salario Base:</span>
                                            <span className="font-mono font-bold">{formatC(emp.baseSalary)}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span>Comision:</span>
                                            <span className="font-mono font-bold">{(emp.commissionRate * 100).toFixed(1)}%</span>
                                        </div>
                                        <div className="flex justify-between border-t border-slate-100 pt-2">
                                            <span className="flex items-center gap-1"><Calendar size={13} /> Vacaciones:</span>
                                            <span className="font-mono font-bold text-emerald-700">{Number(emp.vacationDays || 0).toFixed(1)} días</span>
                                        </div>
                                    </div>
                                    <div className="mt-4 flex gap-2">
                                        <button
                                            onClick={() => setExpedienteEmp(emp)}
                                            className="flex-1 text-xs font-bold text-slate-600 hover:text-white hover:bg-slate-700 border border-slate-200 rounded-lg py-2 transition-colors inline-flex items-center justify-center gap-1.5"
                                        >
                                            <Briefcase size={13} /> Expediente
                                        </button>
                                        <button
                                            onClick={() => setSettlementEmp(emp)}
                                            className="flex-1 text-xs font-bold text-rose-600 hover:text-white hover:bg-rose-600 border border-rose-200 rounded-lg py-2 transition-colors inline-flex items-center justify-center gap-1.5"
                                        >
                                            <FileText size={13} /> Liquidar
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* ==================== TAB: NÓMINA ==================== */}
                {activeTab === 'PAYROLL' && (
                    <div>
                        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                            <div>
                                <h3 className="text-2xl font-bold text-slate-800">Nómina Nicaragüense</h3>
                                <p className="text-slate-500 text-sm">Ley 185 - Código del Trabajo | Ley 539 - Seguridad Social</p>
                            </div>
                            <div className="flex items-center gap-3">
                                <select
                                    value={payrollMonth}
                                    onChange={e => setPayrollMonth(Number(e.target.value))}
                                    className="border p-2 rounded-lg text-slate-800 bg-white"
                                >
                                    {monthNames.map((m, i) => (
                                        <option key={i} value={i + 1}>{m}</option>
                                    ))}
                                </select>
                                <input
                                    type="number"
                                    value={payrollYear}
                                    onChange={e => setPayrollYear(Number(e.target.value))}
                                    className="border p-2 rounded-lg w-24 text-slate-800"
                                />
                                {payrolls.length > 0 && (
                                    <button
                                        onClick={exportPlanillaINSS}
                                        disabled={exportingSIE}
                                        className="bg-emerald-600 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-emerald-700 disabled:opacity-50"
                                        title="Descargar planilla para declarar al INSS/SIE"
                                    >
                                        <FileSpreadsheet size={18} /> {exportingSIE ? 'Generando...' : 'Planilla INSS'}
                                    </button>
                                )}
                                <button
                                    onClick={handleCalculatePayroll}
                                    disabled={calculatingPayroll}
                                    className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-blue-700 disabled:opacity-50"
                                >
                                    <Calculator size={18} /> {calculatingPayroll ? 'Calculando...' : 'Calcular Nómina'}
                                </button>
                            </div>
                        </div>

                        {/* Payroll Summary Cards */}
                        {payrolls.length > 0 && (
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                                    <div className="text-xs text-slate-500 font-mono mb-1">TOTAL BRUTO</div>
                                    <div className="text-xl font-bold text-slate-800">{formatC(payrolls.reduce((s, p) => s + Number(p.totalIncome), 0))}</div>
                                </div>
                                <div className="bg-white p-4 rounded-xl border border-red-100 shadow-sm">
                                    <div className="text-xs text-slate-500 font-mono mb-1">TOTAL INSS + IR</div>
                                    <div className="text-xl font-bold text-red-600">{formatC(payrolls.reduce((s, p) => s + Number(p.totalDeductions), 0))}</div>
                                </div>
                                <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-200 shadow-sm">
                                    <div className="text-xs text-slate-500 font-mono mb-1">TOTAL NETO A PAGAR</div>
                                    <div className="text-xl font-bold text-emerald-700">{formatC(payrolls.reduce((s, p) => s + Number(p.netSalary), 0))}</div>
                                </div>
                                <div className="bg-white p-4 rounded-xl border border-amber-200 shadow-sm">
                                    <div className="text-xs text-slate-500 font-mono mb-1">COSTO PATRONAL</div>
                                    <div className="text-xl font-bold text-amber-700">{formatC(payrolls.reduce((s, p) => s + Number(p.inssPatronal) + Number(p.inatec), 0))}</div>
                                    <div className="text-[10px] text-amber-600">INSS 22.5% + INATEC 2%</div>
                                </div>
                            </div>
                        )}

                        {/* Payroll Table */}
                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden text-slate-800">
                            <table className="w-full text-left">
                                <thead className="bg-slate-50 text-slate-500 font-mono text-xs uppercase">
                                    <tr>
                                        <th className="p-4">Colaborador</th>
                                        <th className="p-4 text-right">Bruto</th>
                                        <th className="p-4 text-right">INSS 7%</th>
                                        <th className="p-4 text-right">IR</th>
                                        <th className="p-4 text-right">Neto</th>
                                        <th className="p-4 text-center">Estado</th>
                                        <th className="p-4 text-center">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {payrolls.length === 0 ? (
                                        <tr><td colSpan={7} className="p-8 text-center text-slate-400">
                                            Selecciona mes/año y dale "Calcular Nómina" para generar los cálculos.
                                        </td></tr>
                                    ) : payrolls.map(p => {
                                        const name = p.employee ? `${p.employee.firstName} ${p.employee.lastName}` : (p.employeeName || '');
                                        return (
                                            <tr key={p.id} className="hover:bg-slate-50">
                                                <td className="p-4">
                                                    <div className="font-bold text-slate-700">{name}</div>
                                                    {p.employee?.cedula && <div className="text-[10px] text-slate-400">Céd: {p.employee.cedula}</div>}
                                                    <div className="flex flex-wrap gap-2 mt-0.5">
                                                        {Number(p.horasExtra || 0) > 0 && <span className="text-[10px] text-amber-600 font-bold">+{Number(p.horasExtra)}h extra</span>}
                                                        {Number(p.diasFeriados || 0) > 0 && <span className="text-[10px] text-indigo-600 font-bold">{Number(p.diasFeriados)}d feriado</span>}
                                                        {Number(p.diasAusencia || 0) > 0 && <span className="text-[10px] text-orange-600 font-bold">{Number(p.diasAusencia)}d ausencia</span>}
                                                        {Number(p.judicialDeduction || 0) > 0 && <span className="text-[10px] text-purple-600 font-bold">Judicial -{formatC(Number(p.judicialDeduction))}</span>}
                                                        {Number(p.advanceDeduction || 0) > 0 && <span className="text-[10px] text-red-500 font-bold">Adelanto -{formatC(Number(p.advanceDeduction))}</span>}
                                                    </div>
                                                </td>
                                                <td className="p-4 text-right font-mono">{formatC(Number(p.totalIncome))}</td>
                                                <td className="p-4 text-right font-mono text-red-500">-{formatC(Number(p.inssLaboral))}</td>
                                                <td className="p-4 text-right font-mono text-red-500">-{formatC(Number(p.irLaboral))}</td>
                                                <td className="p-4 text-right font-mono font-bold text-emerald-700 text-lg">{formatC(Number(p.netSalary))}</td>
                                                <td className="p-4 text-center">
                                                    <span className={`px-2 py-1 rounded text-xs font-bold ${p.status === 'PAGADO' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                                                        }`}>
                                                        {p.status === 'PAGADO' ? 'PAGADO' : '⏳ PENDIENTE'}
                                                    </span>
                                                </td>
                                                <td className="p-4 text-center">
                                                    <div className="flex items-center justify-center gap-2">
                                                        <button
                                                            onClick={() => { setShowColilla(p); }}
                                                            className="p-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
                                                            title="Ver Colilla de Pago"
                                                        >
                                                            <FileText size={16} />
                                                        </button>
                                                        {p.status !== 'PAGADO' && (
                                                            <button
                                                                onClick={() => handlePayPayroll(p.id)}
                                                                className="p-2 bg-green-50 text-green-600 rounded-lg hover:bg-green-100 transition-colors"
                                                                title="Pagar"
                                                            >
                                                                <CreditCard size={16} />
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* ==================== TAB: PASIVO LABORAL ==================== */}
                {activeTab === 'LIABILITIES' && (
                    <div>
                        <div className="flex justify-between items-center mb-6">
                            <div>
                                <h3 className="text-2xl font-bold text-slate-800">Pasivo Laboral Acumulado</h3>
                                <p className="text-slate-500 text-sm">Reserva para Aguinaldo, Vacaciones e Indemnización (Ley 185)</p>
                            </div>
                            <button onClick={fetchLiabilities} className="text-sm text-nortex-600 hover:text-nortex-800 font-bold">
                                Actualizar
                            </button>
                        </div>

                        {/* Semáforo total */}
                        <div className={`p-6 rounded-xl border-2 mb-6 ${pasivoSemaforo === 'red' ? 'bg-red-50 border-red-300' :
                            pasivoSemaforo === 'yellow' ? 'bg-yellow-50 border-yellow-300' :
                                'bg-green-50 border-green-300'
                            }`}>
                            <div className="flex items-center gap-4">
                                <div className={`p-4 rounded-xl ${pasivoSemaforo === 'red' ? 'bg-red-100 text-red-600' :
                                    pasivoSemaforo === 'yellow' ? 'bg-yellow-100 text-yellow-600' :
                                        'bg-green-100 text-green-600'
                                    }`}>
                                    {pasivoSemaforo === 'red' ? <AlertTriangle size={32} /> :
                                        pasivoSemaforo === 'yellow' ? <Wallet size={32} /> :
                                            <CheckCircle size={32} />}
                                </div>
                                <div>
                                    <div className="text-sm font-mono text-slate-500">TOTAL PASIVO LABORAL</div>
                                    <div className={`text-3xl font-bold ${pasivoSemaforo === 'red' ? 'text-red-700' :
                                        pasivoSemaforo === 'yellow' ? 'text-yellow-700' :
                                            'text-green-700'
                                        }`}>{formatC(totalPasivo)}</div>
                                    <div className="text-sm mt-1 text-slate-500">
                                        {pasivoSemaforo === 'red' ? 'Alerta: Reserva insuficiente. Provisione fondos inmediatamente.' :
                                            pasivoSemaforo === 'yellow' ? 'Precaución: Pasivo moderado. Revise su flujo de caja.' :
                                                'Saludable: Pasivo controlado.'}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Liabilities Table */}
                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden text-slate-800">
                            <table className="w-full text-left">
                                <thead className="bg-slate-50 text-slate-500 font-mono text-xs uppercase">
                                    <tr>
                                        <th className="p-4">Colaborador</th>
                                        <th className="p-4 text-center">Antigüedad</th>
                                        <th className="p-4 text-right">Vacaciones</th>
                                        <th className="p-4 text-right">Aguinaldo</th>
                                        <th className="p-4 text-right">Indemnización</th>
                                        <th className="p-4 text-right">Total Pasivo</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {liabilities.map(l => (
                                        <tr key={l.employeeId} className="hover:bg-slate-50">
                                            <td className="p-4 font-bold text-slate-700">{l.employeeName}</td>
                                            <td className="p-4 text-center">
                                                <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded text-xs font-bold">
                                                    {l.monthsWorked} meses
                                                </span>
                                            </td>
                                            <td className="p-4 text-right font-mono">{formatC(l.vacacionesPendientes)}</td>
                                            <td className="p-4 text-right font-mono">{formatC(l.aguinaldoAcumulado)}</td>
                                            <td className="p-4 text-right font-mono">{formatC(l.indemnizacion)}</td>
                                            <td className="p-4 text-right font-mono font-bold text-red-600 text-lg">{formatC(l.totalPasivo)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* ==================== TAB: ASISTENCIA (TIME) ==================== */}
                {activeTab === 'TIME' && (
                    <div>
                        <div className="flex justify-between items-center mb-6">
                            <div>
                                <h3 className="text-2xl font-bold text-slate-800">Asistencia y Feriados</h3>
                                <p className="text-slate-500 text-sm">Marcaje por PIN y calendario de feriados (los trabajados se pagan al doble, Art. 68).</p>
                            </div>
                        </div>

                        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 mb-6 flex items-center gap-3">
                            <Clock className="w-8 h-8 text-indigo-400 shrink-0" />
                            <p className="text-sm text-indigo-700">Usa el botón <strong>"CLOCK IN/OUT"</strong> del menú principal para marcar asistencia con el PIN. Las horas extra y los feriados trabajados se suman a la nómina del mes automáticamente.</p>
                        </div>

                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                            <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-slate-100">
                                <h4 className="font-bold text-slate-700">Calendario de feriados</h4>
                                <select value={holidayYear} onChange={e => setHolidayYear(Number(e.target.value))} className="border border-slate-300 p-2 rounded bg-white text-slate-800 text-sm font-mono">
                                    {[0, 1, 2].map(d => { const yr = new Date().getFullYear() - d + 1; return <option key={yr} value={yr}>{yr}</option>; })}
                                </select>
                            </div>

                            <form onSubmit={addHoliday} className="flex flex-wrap items-end gap-3 p-4 bg-slate-50 border-b border-slate-100">
                                <div>
                                    <label className="text-xs font-bold text-slate-500">Fecha</label>
                                    <input type="date" required value={holidayForm.date} onChange={e => setHolidayForm({ ...holidayForm, date: e.target.value })} className="block border border-slate-300 p-2 rounded text-slate-800 text-sm font-mono" />
                                </div>
                                <div className="flex-1 min-w-[160px]">
                                    <label className="text-xs font-bold text-slate-500">Nombre (fiesta local)</label>
                                    <input required value={holidayForm.name} onChange={e => setHolidayForm({ ...holidayForm, name: e.target.value })} placeholder="Ej: Fiestas patronales" className="block w-full border border-slate-300 p-2 rounded text-slate-800 text-sm" />
                                </div>
                                <button type="submit" disabled={savingHoliday} className="bg-indigo-600 text-white font-bold px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm inline-flex items-center gap-1.5"><Plus size={15} /> {savingHoliday ? 'Guardando…' : 'Agregar'}</button>
                            </form>

                            <div className="divide-y divide-slate-100">
                                {holidays.length === 0 ? (
                                    <p className="p-8 text-center text-slate-400 text-sm">Cargando feriados…</p>
                                ) : holidays.map(h => (
                                    <div key={h.id} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
                                        <div className="flex items-center gap-3">
                                            <span className="font-mono text-xs text-slate-500 w-28">{fmtHoliday(h.date)}</span>
                                            <span className="font-semibold text-slate-700">{h.name}</span>
                                            {h.national
                                                ? <span className="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-500 font-bold">Nacional</span>
                                                : <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 font-bold">Local</span>}
                                        </div>
                                        {!h.national && (
                                            <button onClick={() => deleteHoliday(h.id)} className="text-rose-500 hover:text-rose-700" title="Eliminar"><X size={16} /></button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mt-6">
                            <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-slate-100">
                                <h4 className="font-bold text-slate-700">Reporte de asistencia</h4>
                                <select value={attMonth} onChange={e => setAttMonth(Number(e.target.value))} className="border border-slate-300 p-2 rounded bg-white text-slate-800 text-sm">
                                    {monthNames.map((m, i) => <option key={i} value={i + 1}>{m} {holidayYear}</option>)}
                                </select>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-slate-50 text-slate-500 font-mono text-xs uppercase">
                                        <tr>
                                            <th className="p-3">Colaborador</th>
                                            <th className="p-3 text-center">Jornada</th>
                                            <th className="p-3 text-center">Días</th>
                                            <th className="p-3 text-center">H. extra</th>
                                            <th className="p-3 text-center">Feriados</th>
                                            <th className="p-3 text-center">Ausencias</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {!attendance || attendance.items.length === 0 ? (
                                            <tr><td colSpan={6} className="p-6 text-center text-slate-400">Sin colaboradores activos.</td></tr>
                                        ) : attendance.items.map(a => (
                                            <tr key={a.employeeId} className="hover:bg-slate-50">
                                                <td className="p-3 font-semibold text-slate-700">{a.name}</td>
                                                <td className="p-3 text-center text-xs text-slate-500">{JORNADA_LABELS[a.jornada] || a.jornada}</td>
                                                <td className="p-3 text-center font-mono">{a.diasTrabajados}</td>
                                                <td className="p-3 text-center font-mono text-amber-600">{a.horasExtra > 0 ? `${a.horasExtra}h` : '—'}</td>
                                                <td className="p-3 text-center font-mono text-indigo-600">{a.diasFeriados > 0 ? a.diasFeriados : '—'}</td>
                                                <td className="p-3 text-center font-mono text-orange-600">{a.diasAusencia > 0 ? a.diasAusencia : '—'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}

                {/* ==================== TAB: ADELANTOS (LENDING) ==================== */}
                {activeTab === 'ADVANCES' && (
                    <div>
                        <div className="flex justify-between items-center mb-6">
                            <div>
                                <h3 className="text-2xl font-bold text-slate-800">Micro-Préstamos Nortex</h3>
                                <p className="text-slate-500 text-sm">Adelantos de salario (Capital Financiero Integrado)</p>
                            </div>
                        </div>
                        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 mb-6">
                            <div className="flex items-start gap-4">
                                <div className="p-3 bg-emerald-100 text-emerald-600 rounded-lg">
                                    <DollarSign size={24} />
                                </div>
                                <div>
                                    <h4 className="font-bold text-emerald-800 text-lg">Financiamiento de Nómina Inteligente</h4>
                                    <p className="text-emerald-700 text-sm mt-1">
                                        Nortex te presta liquidez instantánea para que apruebes los adelantos de tus empleados sin descapitalizar el negocio. Las cuotas se deducen automáticamente en la quincena.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 text-slate-800 overflow-hidden">
                            <table className="w-full text-left">
                                <thead className="bg-slate-50 text-slate-500 font-mono text-xs uppercase">
                                    <tr>
                                        <th className="p-4">Solicitante</th>
                                        <th className="p-4 text-center">Fecha</th>
                                        <th className="p-4">Motivo</th>
                                        <th className="p-4 text-right">Monto</th>
                                        <th className="p-4 text-right">Costo Nortex (Fee)</th>
                                        <th className="p-4 text-center">Estado</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {advancesList.length === 0 ? (
                                        <tr>
                                            <td colSpan={6} className="p-8 text-center text-slate-400">
                                                No hay solicitudes de adelanto.
                                            </td>
                                        </tr>
                                    ) : advancesList.map(a => (
                                        <tr key={a.id} className="hover:bg-slate-50">
                                            <td className="p-4 font-bold text-slate-700">{a.employee ? `${a.employee.firstName} ${a.employee.lastName}` : '—'}</td>
                                            <td className="p-4 text-center text-xs text-slate-400">—</td>
                                            <td className="p-4 text-slate-500 text-sm">Adelanto de salario</td>
                                            <td className="p-4 text-right font-mono font-bold text-slate-700">{formatC(a.amount)}</td>
                                            <td className="p-4 text-right font-mono text-emerald-600">{formatC(a.fee)}</td>
                                            <td className="p-4 text-center">
                                                {a.status === 'PENDING' ? (
                                                    <div className="flex items-center justify-center gap-2">
                                                        <button onClick={() => decideAdvance(a.id, 'APPROVED')} className="px-2 py-1 bg-green-50 text-green-700 rounded text-xs font-bold hover:bg-green-100">Aprobar</button>
                                                        <button onClick={() => decideAdvance(a.id, 'REJECTED')} className="px-2 py-1 bg-red-50 text-red-600 rounded text-xs font-bold hover:bg-red-100">Rechazar</button>
                                                    </div>
                                                ) : (
                                                    <span className={`px-2 py-1 rounded text-xs font-bold ${a.status === 'REJECTED' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                                                        {a.status === 'APPROVED' ? 'Aprobado' : a.status === 'DEDUCTED' ? 'Descontado' : a.status === 'REJECTED' ? 'Rechazado' : a.status}
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* ==================== TAB: VACACIONES (LEAVES) ==================== */}
                {activeTab === 'LEAVES' && (
                    <div>
                        <div className="flex justify-between items-center mb-6">
                            <div>
                                <h3 className="text-2xl font-bold text-slate-800">Gestión de Ausencias</h3>
                                <p className="text-slate-500 text-sm">Vacaciones, Incapacidades INSS y Permisos. Los <strong>permisos sin goce</strong> descuentan días de la nómina del mes.</p>
                            </div>
                        </div>

                        {/* Registrar ausencia */}
                        <form onSubmit={handleCreateLeave} className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 mb-6 grid sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
                            <div>
                                <label className="text-xs font-bold text-slate-500">Colaborador</label>
                                <select required value={leaveForm.employeeId} onChange={e => setLeaveForm({ ...leaveForm, employeeId: e.target.value })} className="w-full border border-slate-300 p-2 rounded bg-white text-slate-800 text-sm">
                                    <option value="">Seleccionar…</option>
                                    {employees.map(e => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500">Tipo</label>
                                <select value={leaveForm.type} onChange={e => setLeaveForm({ ...leaveForm, type: e.target.value })} className="w-full border border-slate-300 p-2 rounded bg-white text-slate-800 text-sm">
                                    <option value="UNPAID">Permiso sin goce</option>
                                    <option value="VACATION">Vacaciones</option>
                                    <option value="SICK">Incapacidad (INSS)</option>
                                    <option value="MATERNITY">Maternidad</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500">Desde</label>
                                <input type="date" required value={leaveForm.startDate} onChange={e => setLeaveForm({ ...leaveForm, startDate: e.target.value })} className="w-full border border-slate-300 p-2 rounded text-slate-800 text-sm font-mono" />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500">Hasta</label>
                                <input type="date" required value={leaveForm.endDate} onChange={e => setLeaveForm({ ...leaveForm, endDate: e.target.value })} className="w-full border border-slate-300 p-2 rounded text-slate-800 text-sm font-mono" />
                            </div>
                            <button type="submit" disabled={savingLeave} className="bg-amber-600 text-white font-bold py-2 rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50">
                                {savingLeave ? 'Guardando…' : 'Registrar'}
                            </button>
                            <div className="sm:col-span-2 lg:col-span-5">
                                <input value={leaveForm.reason} onChange={e => setLeaveForm({ ...leaveForm, reason: e.target.value })} placeholder="Justificación (opcional)" className="w-full border border-slate-300 p-2 rounded text-slate-800 text-sm" />
                            </div>
                            {leaveForm.type === 'VACATION' && leaveForm.employeeId && (
                                <div className="sm:col-span-2 lg:col-span-5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                                    Saldo de vacaciones disponible: <strong>{Number(employees.find(e => e.id === leaveForm.employeeId)?.vacationDays || 0).toFixed(1)} días</strong> · se descontará al registrar.
                                </div>
                            )}
                        </form>

                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 text-slate-800 overflow-hidden">
                            <table className="w-full text-left">
                                <thead className="bg-slate-50 text-slate-500 font-mono text-xs uppercase">
                                    <tr>
                                        <th className="p-4">Colaborador</th>
                                        <th className="p-4 text-center">Tipo</th>
                                        <th className="p-4 text-center">Fechas</th>
                                        <th className="p-4">Justificación</th>
                                        <th className="p-4 text-center">Estado</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {leaves.length === 0 ? (
                                        <tr>
                                            <td colSpan={5} className="p-8 text-center text-slate-400">
                                                No hay solicitudes de ausencia registradas.
                                            </td>
                                        </tr>
                                    ) : leaves.map(l => (
                                        <tr key={l.id} className="hover:bg-slate-50">
                                            <td className="p-4 font-bold text-slate-700">{l.employee ? `${l.employee.firstName} ${l.employee.lastName}` : '—'}</td>
                                            <td className="p-4 text-center">
                                                <span className={`px-2 py-1 rounded text-xs font-bold ${LEAVE_BADGE[l.type] || 'bg-slate-100 text-slate-600'}`}>{LEAVE_LABELS[l.type] || l.type}</span>
                                            </td>
                                            <td className="p-4 text-center font-mono text-xs text-slate-600">{fmtDate(l.startDate)} → {fmtDate(l.endDate)}</td>
                                            <td className="p-4 text-sm text-slate-500">{l.reason || '—'}</td>
                                            <td className="p-4 text-center">
                                                {l.status === 'PENDING' ? (
                                                    <div className="flex items-center justify-center gap-2">
                                                        <button onClick={() => decideLeave(l.id, 'APPROVED')} className="px-2 py-1 bg-green-50 text-green-700 rounded text-xs font-bold hover:bg-green-100">Aprobar</button>
                                                        <button onClick={() => decideLeave(l.id, 'REJECTED')} className="px-2 py-1 bg-red-50 text-red-600 rounded text-xs font-bold hover:bg-red-100">Rechazar</button>
                                                    </div>
                                                ) : (
                                                    <span className={`px-2 py-1 rounded text-xs font-bold ${l.status === 'REJECTED' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{l.status === 'APPROVED' ? 'Aprobada' : l.status === 'REJECTED' ? 'Rechazada' : l.status}</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* ==================== TAB: AGUINALDO ==================== */}
                {activeTab === 'AGUINALDO' && (
                    <div>
                        <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
                            <div>
                                <h3 className="text-2xl font-bold text-slate-800">Aguinaldo (Treceavo Mes)</h3>
                                <p className="text-slate-500 text-sm">{aguinaldo?.periodo ? `${aguinaldo.periodo} · ` : ''}Exento de INSS e IR (Arts. 93-95)</p>
                            </div>
                            <div className="flex items-center gap-3">
                                <select value={aguinaldoYear} onChange={e => setAguinaldoYear(Number(e.target.value))} className="border border-slate-300 p-2 rounded bg-white text-slate-800 text-sm font-mono">
                                    {[0, 1, 2].map(d => { const yr = new Date().getFullYear() - d; return <option key={yr} value={yr}>{yr}</option>; })}
                                </select>
                                <button onClick={handleRunAguinaldo} disabled={runningAg || !aguinaldo || aguinaldo.pendientes === 0}
                                    className="bg-rose-600 text-white font-bold px-4 py-2 rounded-lg hover:bg-rose-700 transition-colors disabled:opacity-50 inline-flex items-center gap-2">
                                    <Gift size={16} /> {runningAg ? 'Procesando…' : `Correr aguinaldo ${aguinaldoYear}`}
                                </button>
                            </div>
                        </div>

                        {aguinaldo && (() => {
                            const vencidoSinPagar = aguinaldo.diasParaVencer < 0 && aguinaldo.pendientes > 0;
                            const todoPagado = aguinaldo.pendientes === 0;
                            const cardCls = vencidoSinPagar ? 'bg-red-50 border-red-300' : todoPagado ? 'bg-green-50 border-green-300' : 'bg-blue-50 border-blue-300';
                            return (
                                <div className={`p-5 rounded-xl border-2 mb-6 flex flex-wrap items-center justify-between gap-3 ${cardCls}`}>
                                    <div>
                                        {vencidoSinPagar ? (
                                            <p className="font-bold text-red-700 flex items-center gap-2"><AlertTriangle size={18} /> Vencido hace {Math.abs(aguinaldo.diasParaVencer)} días — multa de un día de salario por día de retraso (Art. 95)</p>
                                        ) : todoPagado ? (
                                            <p className="font-bold text-green-700 flex items-center gap-2"><CheckCircle size={18} /> Aguinaldo {aguinaldoYear} pagado a todos los colaboradores</p>
                                        ) : (
                                            <p className="font-bold text-blue-700 flex items-center gap-2"><Clock size={18} /> Faltan {aguinaldo.diasParaVencer} días para la fecha límite</p>
                                        )}
                                        <p className="text-sm text-slate-500 mt-1">Fecha límite legal: 10 de diciembre {aguinaldoYear} · {aguinaldo.pendientes} pendiente(s)</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-xs uppercase tracking-wider text-slate-500">Total aguinaldo</p>
                                        <p className="text-2xl font-bold font-mono text-slate-800">{formatC(aguinaldo.totalMonto)}</p>
                                    </div>
                                </div>
                            );
                        })()}

                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 text-slate-800 overflow-hidden">
                            <table className="w-full text-left">
                                <thead className="bg-slate-50 text-slate-500 font-mono text-xs uppercase">
                                    <tr>
                                        <th className="p-4">Colaborador</th>
                                        <th className="p-4 text-center">Días</th>
                                        <th className="p-4 text-right">Salario Base</th>
                                        <th className="p-4 text-right">Aguinaldo</th>
                                        <th className="p-4 text-center">Estado</th>
                                        <th className="p-4 text-center">Comprobante</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {!aguinaldo || aguinaldo.items.length === 0 ? (
                                        <tr><td colSpan={6} className="p-8 text-center text-slate-400">Sin colaboradores activos para el período.</td></tr>
                                    ) : aguinaldo.items.map(item => (
                                        <tr key={item.employeeId} className="hover:bg-slate-50">
                                            <td className="p-4 font-bold text-slate-700">{item.name}{item.cedula && <div className="text-[10px] text-slate-400 font-normal">Céd: {item.cedula}</div>}</td>
                                            <td className="p-4 text-center font-mono text-slate-600">{item.diasLaborados}</td>
                                            <td className="p-4 text-right font-mono text-slate-600">{formatC(item.baseSalary)}</td>
                                            <td className="p-4 text-right font-mono font-bold text-rose-700 text-lg">{formatC(item.monto)}</td>
                                            <td className="p-4 text-center">
                                                <span className={`px-2 py-1 rounded text-xs font-bold ${item.pagado ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>{item.pagado ? 'Pagado' : '⏳ Pendiente'}</span>
                                            </td>
                                            <td className="p-4 text-center">
                                                {item.pagado && (
                                                    <button onClick={() => printAguinaldo(item)} className="p-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors" title="Imprimir comprobante"><Printer size={16} /></button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>

            {/* ==================== MODAL: CREAR EMPLEADO ==================== */}
            {showModal && (
                <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 animate-in zoom-in duration-200">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="font-bold text-lg text-slate-800">Registrar Colaborador</h3>
                            <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleCreateEmployee} className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <input required className="border p-2 rounded text-slate-800" placeholder="Nombre" value={formData.firstName} onChange={e => setFormData({ ...formData, firstName: e.target.value })} />
                                <input required className="border p-2 rounded text-slate-800" placeholder="Apellido" value={formData.lastName} onChange={e => setFormData({ ...formData, lastName: e.target.value })} />
                            </div>

                            {/* Datos Nicaragua */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-bold text-slate-500">Cédula de Identidad</label>
                                    <input
                                        className="w-full border p-2 rounded text-slate-800 font-mono"
                                        placeholder="001-010190-0001A"
                                        value={formData.cedula}
                                        onChange={e => setFormData({ ...formData, cedula: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500">Número INSS</label>
                                    <input
                                        className="w-full border p-2 rounded text-slate-800 font-mono"
                                        placeholder="123456789"
                                        value={formData.inss}
                                        onChange={e => setFormData({ ...formData, inss: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-bold text-slate-500">Cargo</label>
                                    <select className="w-full border p-2 rounded bg-white text-slate-800" value={formData.role} onChange={e => setFormData({ ...formData, role: e.target.value })}>
                                        <option value="VENDEDOR">Vendedor</option>
                                        <option value="MANAGER">Gerente</option>
                                        <option value="BODEGA">Bodeguero</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500">PIN de Acceso (4 dígitos)</label>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        maxLength={4}
                                        required
                                        className="w-full border p-2 rounded text-slate-800 font-mono text-lg tracking-[0.5em] text-center"
                                        placeholder="0000"
                                        value={formData.pin}
                                        onChange={e => setFormData({ ...formData, pin: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-bold text-slate-500">Salario Base (C$)</label>
                                    <input type="number" required className="w-full border p-2 rounded text-slate-800" placeholder="0.00" value={formData.baseSalary} onChange={e => setFormData({ ...formData, baseSalary: e.target.value })} />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500">Comision (%)</label>
                                    <input type="number" required className="w-full border p-2 rounded text-slate-800" placeholder="Ej: 5" value={formData.commissionRate} onChange={e => setFormData({ ...formData, commissionRate: e.target.value })} />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500">Jornada (Art. 51)</label>
                                <select className="w-full border p-2 rounded bg-white text-slate-800" value={formData.jornada} onChange={e => setFormData({ ...formData, jornada: e.target.value })}>
                                    <option value="DIURNA">Diurna (8h)</option>
                                    <option value="NOCTURNA">Nocturna (7h)</option>
                                    <option value="MIXTA">Mixta (7.5h)</option>
                                </select>
                            </div>
                            <button type="submit" className="w-full bg-nortex-900 text-white py-3 rounded-lg font-bold hover:bg-nortex-800">Guardar</button>
                            <button type="button" onClick={() => setShowModal(false)} className="w-full text-slate-500 py-2 hover:text-slate-700">Cancelar</button>
                        </form>
                    </div>
                </div>
            )}

            {/* ==================== MODAL: COLILLA DE PAGO ==================== */}
            {showColilla && (
                <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl p-6 max-h-[90vh] overflow-y-auto">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                                <FileText className="text-blue-500" /> Colilla de Pago
                            </h3>
                            <button onClick={() => setShowColilla(null)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                        </div>

                        <div className="space-y-4">
                            <div className="bg-slate-50 p-4 rounded-lg">
                                <div className="grid grid-cols-2 gap-2 text-sm">
                                    <div><span className="text-slate-500">Empleado:</span> <strong>{showColilla.employee ? `${showColilla.employee.firstName} ${showColilla.employee.lastName}` : showColilla.employeeName}</strong></div>
                                    <div><span className="text-slate-500">Periodo:</span> <strong>{monthNames[showColilla.month - 1]} {showColilla.year}</strong></div>
                                    {showColilla.employee?.cedula && <div><span className="text-slate-500">Cédula:</span> <strong>{showColilla.employee.cedula}</strong></div>}
                                    {showColilla.employee?.inss && <div><span className="text-slate-500">INSS:</span> <strong>{showColilla.employee.inss}</strong></div>}
                                </div>
                            </div>

                            {/* Ingresos */}
                            <div>
                                <div className="text-xs font-bold text-slate-500 mb-2 uppercase">Ingresos</div>
                                <div className="bg-blue-50 p-3 rounded-lg space-y-2">
                                    <div className="flex justify-between text-sm">
                                        <span>Salario Base</span>
                                        <span className="font-mono font-bold">{formatC(Number(showColilla.grossSalary))}</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span>Comisiones</span>
                                        <span className="font-mono font-bold text-blue-600">+{formatC(Number(showColilla.commissions))}</span>
                                    </div>
                                    <div className="flex justify-between text-sm font-bold border-t border-blue-200 pt-2">
                                        <span>TOTAL DEVENGADO</span>
                                        <span className="font-mono">{formatC(Number(showColilla.totalIncome))}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Deducciones */}
                            <div>
                                <div className="text-xs font-bold text-slate-500 mb-2 uppercase">Deducciones de Ley</div>
                                <div className="bg-red-50 p-3 rounded-lg space-y-2">
                                    <div className="flex justify-between text-sm">
                                        <span>INSS Laboral (7%)</span>
                                        <span className="font-mono font-bold text-red-600">-{formatC(Number(showColilla.inssLaboral))}</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span>IR Laboral (Tabla DGI)</span>
                                        <span className="font-mono font-bold text-red-600">-{formatC(Number(showColilla.irLaboral))}</span>
                                    </div>
                                    <div className="flex justify-between text-sm font-bold border-t border-red-200 pt-2">
                                        <span>TOTAL DEDUCCIONES</span>
                                        <span className="font-mono text-red-700">-{formatC(Number(showColilla.totalDeductions))}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Neto */}
                            <div className="bg-emerald-100 p-4 rounded-lg">
                                <div className="flex justify-between items-center">
                                    <span className="text-lg font-bold text-emerald-800">NETO A RECIBIR</span>
                                    <span className="text-2xl font-bold font-mono text-emerald-700">{formatC(Number(showColilla.netSalary))}</span>
                                </div>
                            </div>

                            {/* Patronal */}
                            <div className="bg-amber-50 p-3 rounded-lg space-y-2">
                                <div className="text-xs font-bold text-amber-700 uppercase mb-1">Aportes Patronales (Informativo)</div>
                                <div className="flex justify-between text-sm">
                                    <span>INSS Patronal (22.5%)</span>
                                    <span className="font-mono">{formatC(Number(showColilla.inssPatronal))}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span>INATEC (2%)</span>
                                    <span className="font-mono">{formatC(Number(showColilla.inatec))}</span>
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={() => printColilla(showColilla)}
                            className="mt-6 w-full bg-nortex-900 text-white py-3 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-nortex-800"
                        >
                            <Printer size={18} /> Imprimir Colilla de Pago
                        </button>
                    </div>
                </div>
            )}
        </div>

            {/* Modal: Cambiar PIN */}
            {pinModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
                        <h3 className="text-lg font-bold text-slate-800 mb-1">Cambiar PIN</h3>
                        <p className="text-sm text-slate-500 mb-5">
                            Nuevo PIN para <strong>{pinModal.name}</strong>
                        </p>
                        <input
                            type="text"
                            inputMode="numeric"
                            maxLength={4}
                            placeholder="4 dígitos"
                            value={newPin}
                            onChange={e => { setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setPinError(''); }}
                            className="w-full text-center text-3xl font-mono tracking-[0.5em] border-2 border-slate-200 rounded-xl py-4 focus:outline-none focus:border-indigo-500 mb-3"
                            autoFocus
                        />
                        {pinError && <p className="text-sm text-red-500 text-center mb-3">{pinError}</p>}
                        <div className="flex gap-3">
                            <button
                                onClick={() => { setPinModal(null); setNewPin(''); setPinError(''); }}
                                className="flex-1 py-3 border border-slate-200 rounded-xl font-semibold text-slate-600 hover:bg-slate-50"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleChangePin}
                                disabled={pinSaving || newPin.length !== 4}
                                className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 disabled:opacity-50"
                            >
                                {pinSaving ? 'Guardando...' : 'Guardar PIN'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ==================== MODAL: LIQUIDACIÓN / FINIQUITO ==================== */}
            {settlementEmp && (
                <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2"><FileText size={18} className="text-rose-600" /> Liquidación — {settlementEmp.firstName} {settlementEmp.lastName}</h3>
                            <button onClick={() => setSettlementEmp(null)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                        </div>

                        <div className="grid grid-cols-2 gap-3 mb-4">
                            <div>
                                <label className="text-xs font-bold text-slate-500">Causa de salida</label>
                                <select value={settlementReason} onChange={e => setSettlementReason(e.target.value)} className="w-full border border-slate-300 p-2 rounded bg-white text-slate-800 text-sm">
                                    <option value="DISMISSAL">Despido</option>
                                    <option value="MUTUAL">Mutuo acuerdo</option>
                                    <option value="RESIGNATION">Renuncia</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500">Fecha de salida</label>
                                <input type="date" value={settlementDate} onChange={e => setSettlementDate(e.target.value)} className="w-full border border-slate-300 p-2 rounded text-slate-800 text-sm font-mono" />
                            </div>
                        </div>

                        {settlementLoading || !settlementData ? (
                            <div className="py-10 text-center text-slate-400 text-sm">Calculando…</div>
                        ) : (
                            <>
                                {settlementData.yaLiquidado && (
                                    <div className="mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Este colaborador ya tiene una liquidación registrada.</div>
                                )}
                                {settlementReason === 'RESIGNATION' && (
                                    <div className="mb-3 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">En renuncia no corresponde indemnización por antigüedad (Art. 45); sí vacaciones y aguinaldo proporcional.</div>
                                )}
                                <div className="bg-slate-50 rounded-xl p-4 text-sm space-y-2">
                                    <div className="flex justify-between text-slate-500"><span>Antigüedad</span><span className="font-mono">{settlementData.settlement.antiguedadTexto}</span></div>
                                    <div className="flex justify-between text-slate-500"><span>Salario base (prom. 6m)</span><span className="font-mono">{formatC(settlementData.settlement.salarioMensual)}</span></div>
                                    <div className="border-t border-slate-200 pt-2 flex justify-between"><span>Indemnización {settlementData.settlement.aplicaIndemnizacion ? `(${settlementData.settlement.indemnizacionDias.toFixed(0)} días)` : '(no aplica)'}</span><span className="font-mono font-bold">{formatC(settlementData.settlement.indemnizacion)}</span></div>
                                    <div className="flex justify-between"><span>Vacaciones ({settlementData.settlement.diasVacaciones.toFixed(1)} días)</span><span className="font-mono font-bold">{formatC(settlementData.settlement.vacaciones)}</span></div>
                                    <div className="flex justify-between"><span>Aguinaldo ({settlementData.settlement.diasAguinaldo} días)</span><span className="font-mono font-bold">{formatC(settlementData.settlement.aguinaldo)}</span></div>
                                    <div className="border-t-2 border-slate-300 pt-2 flex justify-between text-lg"><span className="font-bold text-slate-800">Total a pagar</span><span className="font-mono font-bold text-rose-700">{formatC(settlementData.settlement.total)}</span></div>
                                </div>

                                <div className="flex gap-3 mt-5">
                                    <button onClick={() => printFiniquito(settlementData)} className="flex-1 border border-slate-300 text-slate-600 font-bold py-2.5 rounded-lg hover:bg-slate-50 inline-flex items-center justify-center gap-2"><Printer size={16} /> Imprimir</button>
                                    <button onClick={paySettlement} disabled={settlementPaying || settlementData.yaLiquidado} className="flex-1 bg-rose-600 text-white font-bold py-2.5 rounded-lg hover:bg-rose-700 disabled:opacity-50 inline-flex items-center justify-center gap-2">
                                        {settlementPaying ? 'Procesando…' : 'Pagar liquidación'}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* ==================== MODAL: EXPEDIENTE DIGITAL ==================== */}
            {expedienteEmp && (
                <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2"><Briefcase size={18} className="text-slate-700" /> Expediente — {expedienteEmp.firstName} {expedienteEmp.lastName}</h3>
                            <button onClick={() => setExpedienteEmp(null)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                        </div>

                        {expedienteLoading || !expediente ? (
                            <div className="py-10 text-center text-slate-400 text-sm">Cargando…</div>
                        ) : (
                            <>
                                {expediente.alertas.length > 0 && (
                                    <div className="mb-4 space-y-1.5">
                                        {expediente.alertas.map((a, i) => (
                                            <div key={i} className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center gap-2"><AlertTriangle size={13} /> {a}</div>
                                        ))}
                                    </div>
                                )}

                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5 text-sm">
                                    {([
                                        ['Cédula', expediente.employee.cedula || 'N/A'],
                                        ['N° INSS', expediente.employee.inss || 'N/A'],
                                        ['Teléfono', expediente.employee.phone || 'N/A'],
                                        ['Cargo', expediente.employee.role || 'N/A'],
                                        ['Jornada', JORNADA_LABELS[expediente.employee.jornada || 'DIURNA'] || 'N/A'],
                                        ['Ingreso', fmtDate(expediente.employee.hireDate)],
                                        ['Antigüedad', expediente.employee.antiguedadTexto],
                                        ['Salario base', formatC(expediente.employee.baseSalary)],
                                        ['Vacaciones', `${Number(expediente.employee.vacationDays).toFixed(1)} días`],
                                        ['Estado', expediente.employee.status],
                                    ] as [string, string][]).map(([label, val]) => (
                                        <div key={label} className="bg-slate-50 rounded-lg p-3">
                                            <p className="text-[10px] uppercase tracking-wider text-slate-400">{label}</p>
                                            <p className="font-semibold text-slate-700">{val}</p>
                                        </div>
                                    ))}
                                </div>

                                <div className="flex items-center justify-between mb-2">
                                    <h4 className="font-bold text-slate-700">Contratos</h4>
                                    {!showContractForm && <button onClick={openContractForm} className="text-xs font-bold text-nortex-600 hover:text-nortex-800 inline-flex items-center gap-1"><Plus size={13} /> Agregar contrato</button>}
                                </div>

                                {showContractForm && (
                                    <form onSubmit={handleAddContract} className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-4 grid sm:grid-cols-2 gap-3">
                                        <div>
                                            <label className="text-xs font-bold text-slate-500">Tipo</label>
                                            <select value={contractForm.type} onChange={e => setContractForm({ ...contractForm, type: e.target.value })} className="w-full border border-slate-300 p-2 rounded bg-white text-slate-800 text-sm">
                                                <option value="INDETERMINADO">Indeterminado</option>
                                                <option value="DETERMINADO">Determinado</option>
                                                <option value="POR_OBRA">Por obra</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="text-xs font-bold text-slate-500">Cargo</label>
                                            <input value={contractForm.position} onChange={e => setContractForm({ ...contractForm, position: e.target.value })} className="w-full border border-slate-300 p-2 rounded text-slate-800 text-sm" />
                                        </div>
                                        <div>
                                            <label className="text-xs font-bold text-slate-500">Inicio</label>
                                            <input type="date" required value={contractForm.startDate} onChange={e => setContractForm({ ...contractForm, startDate: e.target.value })} className="w-full border border-slate-300 p-2 rounded text-slate-800 text-sm font-mono" />
                                        </div>
                                        <div>
                                            <label className="text-xs font-bold text-slate-500">Fin (si aplica)</label>
                                            <input type="date" value={contractForm.endDate} onChange={e => setContractForm({ ...contractForm, endDate: e.target.value })} className="w-full border border-slate-300 p-2 rounded text-slate-800 text-sm font-mono" />
                                        </div>
                                        <div>
                                            <label className="text-xs font-bold text-slate-500">Fin período de prueba</label>
                                            <input type="date" value={contractForm.probationEnd} onChange={e => setContractForm({ ...contractForm, probationEnd: e.target.value })} className="w-full border border-slate-300 p-2 rounded text-slate-800 text-sm font-mono" />
                                        </div>
                                        <div>
                                            <label className="text-xs font-bold text-slate-500">Salario</label>
                                            <input type="number" required value={contractForm.salary} onChange={e => setContractForm({ ...contractForm, salary: e.target.value })} className="w-full border border-slate-300 p-2 rounded text-slate-800 text-sm font-mono" />
                                        </div>
                                        <div className="sm:col-span-2 flex gap-2">
                                            <button type="submit" disabled={savingContract} className="bg-nortex-600 text-white font-bold px-4 py-2 rounded-lg hover:bg-nortex-700 disabled:opacity-50 text-sm">{savingContract ? 'Guardando…' : 'Guardar contrato'}</button>
                                            <button type="button" onClick={() => setShowContractForm(false)} className="text-slate-500 px-4 py-2 text-sm">Cancelar</button>
                                        </div>
                                    </form>
                                )}

                                {expediente.contracts.length === 0 ? (
                                    <p className="text-sm text-slate-400 text-center py-6 bg-slate-50 rounded-xl">Sin contratos registrados.</p>
                                ) : (
                                    <div className="space-y-2">
                                        {expediente.contracts.map(c => (
                                            <div key={c.id} className="border border-slate-200 rounded-xl px-4 py-3 flex items-center justify-between">
                                                <div>
                                                    <p className="font-semibold text-slate-700">{CONTRACT_LABELS[c.type] || c.type}{c.position ? ` · ${c.position}` : ''}</p>
                                                    <p className="text-xs text-slate-500 font-mono">{fmtDate(c.startDate)}{c.endDate ? ` → ${fmtDate(c.endDate)}` : ' → indefinido'}{c.probationEnd ? ` · prueba hasta ${fmtDate(c.probationEnd)}` : ''}</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="font-mono font-bold text-slate-700">{formatC(c.salary)}</p>
                                                    <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${c.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>{c.status === 'ACTIVE' ? 'Vigente' : 'Finalizado'}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Deducciones judiciales */}
                                <div className="flex items-center justify-between mt-6 mb-2">
                                    <h4 className="font-bold text-slate-700">Deducciones judiciales</h4>
                                    {!showJudicialForm && <button onClick={() => setShowJudicialForm(true)} className="text-xs font-bold text-purple-600 hover:text-purple-800 inline-flex items-center gap-1"><Plus size={13} /> Agregar</button>}
                                </div>

                                {showJudicialForm && (
                                    <form onSubmit={handleAddJudicial} className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-4 grid sm:grid-cols-2 gap-3">
                                        <div>
                                            <label className="text-xs font-bold text-slate-500">Tipo</label>
                                            <select value={judicialForm.type} onChange={e => setJudicialForm({ ...judicialForm, type: e.target.value })} className="w-full border border-slate-300 p-2 rounded bg-white text-slate-800 text-sm">
                                                <option value="PENSION_ALIMENTICIA">Pensión alimenticia</option>
                                                <option value="EMBARGO">Embargo</option>
                                                <option value="OTRO">Otro</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="text-xs font-bold text-slate-500">Beneficiario / N° expediente</label>
                                            <input value={judicialForm.beneficiary} onChange={e => setJudicialForm({ ...judicialForm, beneficiary: e.target.value })} className="w-full border border-slate-300 p-2 rounded text-slate-800 text-sm" />
                                        </div>
                                        <div>
                                            <label className="text-xs font-bold text-slate-500">Monto fijo (C$)</label>
                                            <input type="number" value={judicialForm.amount} onChange={e => setJudicialForm({ ...judicialForm, amount: e.target.value, percentage: '' })} placeholder="0.00" className="w-full border border-slate-300 p-2 rounded text-slate-800 text-sm font-mono" />
                                        </div>
                                        <div>
                                            <label className="text-xs font-bold text-slate-500">o % del salario disponible</label>
                                            <input type="number" value={judicialForm.percentage} onChange={e => setJudicialForm({ ...judicialForm, percentage: e.target.value, amount: '' })} placeholder="0" className="w-full border border-slate-300 p-2 rounded text-slate-800 text-sm font-mono" />
                                        </div>
                                        <div className="sm:col-span-2 flex gap-2">
                                            <button type="submit" disabled={savingJudicial} className="bg-purple-600 text-white font-bold px-4 py-2 rounded-lg hover:bg-purple-700 disabled:opacity-50 text-sm">{savingJudicial ? 'Guardando…' : 'Guardar deducción'}</button>
                                            <button type="button" onClick={() => setShowJudicialForm(false)} className="text-slate-500 px-4 py-2 text-sm">Cancelar</button>
                                        </div>
                                    </form>
                                )}

                                {expediente.judicialDeductions.length === 0 ? (
                                    <p className="text-sm text-slate-400 text-center py-4 bg-slate-50 rounded-xl">Sin deducciones judiciales activas.</p>
                                ) : (
                                    <div className="space-y-2">
                                        {expediente.judicialDeductions.map(j => (
                                            <div key={j.id} className="border border-slate-200 rounded-xl px-4 py-3 flex items-center justify-between">
                                                <div>
                                                    <p className="font-semibold text-slate-700">{JUDICIAL_LABELS[j.type] || j.type}{j.beneficiary ? ` · ${j.beneficiary}` : ''}</p>
                                                    <p className="text-xs text-slate-500">Prioridad {j.priority} · desde {fmtDate(j.startDate)}</p>
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    <span className="font-mono font-bold text-purple-700">{j.amount != null ? formatC(j.amount) : `${j.percentage}%`}</span>
                                                    <button onClick={() => endJudicial(j.id)} className="text-xs text-rose-500 hover:text-rose-700 font-semibold underline">Finalizar</button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Cuenta de acceso (Mi Espacio) */}
                                <h4 className="font-bold text-slate-700 mt-6 mb-2">Cuenta de acceso (Mi Espacio)</h4>
                                {expediente.linkedUser ? (
                                    <div className="flex items-center justify-between border border-slate-200 rounded-xl px-4 py-3">
                                        <div>
                                            <p className="font-semibold text-slate-700">{expediente.linkedUser.name}</p>
                                            {expediente.linkedUser.email && <p className="text-xs text-slate-500">{expediente.linkedUser.email}</p>}
                                        </div>
                                        <button onClick={unlinkUser} disabled={savingLink} className="text-xs text-rose-500 hover:text-rose-700 font-semibold underline disabled:opacity-50">Desvincular</button>
                                    </div>
                                ) : (
                                    <div className="flex flex-wrap items-center gap-2">
                                        <select value={linkUserId} onChange={e => setLinkUserId(e.target.value)} className="flex-1 min-w-[180px] border border-slate-300 p-2 rounded bg-white text-slate-800 text-sm">
                                            <option value="">Seleccionar cuenta de usuario…</option>
                                            {linkableUsers.map(u => <option key={u.id} value={u.id}>{u.name}{u.email ? ` (${u.email})` : ''} · {u.role}</option>)}
                                        </select>
                                        <button onClick={linkUser} disabled={savingLink || !linkUserId} className="bg-slate-700 text-white font-bold px-4 py-2 rounded-lg hover:bg-slate-800 disabled:opacity-50 text-sm">Vincular</button>
                                        {linkableUsers.length === 0 && <p className="w-full text-xs text-slate-400">No hay cuentas libres. Creá un usuario en "Mi Equipo" y vinculalo aquí.</p>}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}
        </>
    );
};

export default HRM;
