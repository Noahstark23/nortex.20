import React, { useState, useEffect, useCallback } from 'react';
import { Users, Briefcase, DollarSign, Plus, UserPlus, CheckCircle, Clock, KeyRound, FileText, AlertTriangle, Calculator, CreditCard, Printer, X, Shield, Calendar, TrendingDown, Wallet } from 'lucide-react';

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
}

interface PayrollRecord {
    id: string;
    employeeId: string;
    month: number;
    year: number;
    grossSalary: number;
    commissions: number;
    totalIncome: number;
    inssLaboral: number;
    irLaboral: number;
    totalDeductions: number;
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

const formatC = (n: number) => `C$ ${n.toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const HRM: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'TEAM' | 'PAYROLL' | 'LIABILITIES' | 'ADVANCES' | 'LEAVES' | 'TIME'>('TEAM');
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

    // New Employee Form
    const [formData, setFormData] = useState({
        firstName: '', lastName: '', role: 'VENDEDOR', baseSalary: '', commissionRate: '', pin: '', cedula: '', inss: ''
    });

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

    useEffect(() => { fetchEmployees(); }, []);
    useEffect(() => { if (activeTab === 'PAYROLL') fetchPayrolls(); }, [activeTab, fetchPayrolls]);
    useEffect(() => { if (activeTab === 'LIABILITIES') fetchLiabilities(); }, [activeTab]);

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
                })
            });
            const data = await res.json();
            if (res.ok) {
                setShowModal(false);
                setFormData({ firstName: '', lastName: '', role: 'VENDEDOR', baseSalary: '', commissionRate: '', pin: '', cedula: '', inss: '' });
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

    const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

    // Pasivo laboral semáforo
    const pasivoSemaforo = totalPasivo > 50000 ? 'red' : totalPasivo > 20000 ? 'yellow' : 'green';

    return (
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
                                            <span className="font-mono font-bold bg-slate-100 px-2 py-0.5 rounded tracking-widest">{emp.pin || '****'}</span>
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
                                                </td>
                                                <td className="p-4 text-right font-mono">{formatC(Number(p.totalIncome))}</td>
                                                <td className="p-4 text-right font-mono text-red-500">-{formatC(Number(p.inssLaboral))}</td>
                                                <td className="p-4 text-right font-mono text-red-500">-{formatC(Number(p.irLaboral))}</td>
                                                <td className="p-4 text-right font-mono font-bold text-emerald-700 text-lg">{formatC(Number(p.netSalary))}</td>
                                                <td className="p-4 text-center">
                                                    <span className={`px-2 py-1 rounded text-xs font-bold ${p.status === 'PAGADO' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                                                        }`}>
                                                        {p.status === 'PAGADO' ? '✅ PAGADO' : '⏳ PENDIENTE'}
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
                                        {pasivoSemaforo === 'red' ? '⚠️ Alerta: Reserva insuficiente. Provisione fondos inmediatamente.' :
                                            pasivoSemaforo === 'yellow' ? '⚡ Precaución: Pasivo moderado. Revise su flujo de caja.' :
                                                '✅ Saludable: Pasivo controlado.'}
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
                                <h3 className="text-2xl font-bold text-slate-800">Control de Asistencia</h3>
                                <p className="text-slate-500 text-sm">Registro de Turnos de Hoy via PIN Pad</p>
                            </div>
                        </div>
                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                            <div className="p-12 text-center">
                                <Clock className="w-16 h-16 text-indigo-200 mx-auto mb-4" />
                                <h4 className="text-lg font-bold text-slate-700">Integración Activa</h4>
                                <p className="text-slate-500 max-w-md mx-auto mt-2">
                                    Usa el botón <strong className="text-indigo-600">"CLOCK IN/OUT"</strong> del menú principal para marcar asistencia con tu PIN desde cualquier dispositivo de la ferretería.
                                </p>
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
                                    <tr>
                                        <td colSpan={6} className="p-8 text-center text-slate-400">
                                            No hay solicitudes de adelanto pendientes.
                                        </td>
                                    </tr>
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
                                <p className="text-slate-500 text-sm">Vacaciones, Incapacidades INSS y Permisos</p>
                            </div>
                        </div>

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
                                    <tr>
                                        <td colSpan={5} className="p-8 text-center text-slate-400">
                                            No hay solicitudes de ausencia registradas.
                                        </td>
                                    </tr>
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
    );
};

export default HRM;
