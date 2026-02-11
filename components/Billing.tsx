import React, { useState, useEffect } from 'react';
import { CreditCard, Shield, CheckCircle, AlertTriangle, Clock, Zap, ArrowRight, ExternalLink, Loader2, XCircle, RefreshCw, Building2, Upload, Send, FileText, DollarSign, Banknote } from 'lucide-react';

interface BillingStatus {
    status: string;
    hasStripe: boolean;
    subscriptionId: string | null;
    endsAt: string | null;
    businessName: string;
    stripeConfigured: boolean;
}

interface ManualPaymentRecord {
    id: string;
    amount: number;
    currency: string;
    bank: string;
    referenceNumber: string;
    status: string;
    rejectionReason?: string;
    createdAt: string;
}

const PLAN_PRICE = 25;

const BANK_ACCOUNTS = [
    { bank: 'BAC Credomatic', type: 'Cuenta de Ahorro Dólares', number: 'XXXX-XXXX-XXXX-4521', name: 'NORTEX INC.' },
    { bank: 'Lafise Bancentro', type: 'Cuenta Corriente Córdobas', number: 'XXXX-XXXX-XXXX-7890', name: 'NORTEX INC.' },
    { bank: 'Banpro', type: 'Cuenta de Ahorro Dólares', number: 'XXXX-XXXX-XXXX-3456', name: 'NORTEX INC.' },
];

const Billing: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'CARD' | 'DEPOSIT'>('CARD');
    const [billing, setBilling] = useState<BillingStatus | null>(null);
    const [manualPayments, setManualPayments] = useState<ManualPaymentRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [checkoutLoading, setCheckoutLoading] = useState(false);
    const [portalLoading, setPortalLoading] = useState(false);
    const [reportLoading, setReportLoading] = useState(false);

    // Manual payment form
    const [manualForm, setManualForm] = useState({ amount: '25', currency: 'USD', bank: '', referenceNumber: '', notes: '' });
    const [proofFile, setProofFile] = useState<File | null>(null);

    const token = localStorage.getItem('nortex_token');
    const headers: Record<string, string> = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

    const urlParams = new URLSearchParams(window.location.search);
    const paymentStatus = urlParams.get('status');

    const fetchAll = async () => {
        try {
            const [billingRes, manualRes] = await Promise.all([
                fetch('/api/billing/status', { headers }),
                fetch('/api/billing/manual-status', { headers }),
            ]);
            if (billingRes.ok) setBilling(await billingRes.json());
            if (manualRes.ok) setManualPayments(await manualRes.json());
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    };

    useEffect(() => { fetchAll(); }, []);

    const handleCheckout = async () => {
        setCheckoutLoading(true);
        try {
            const res = await fetch('/api/billing/create-session', { method: 'POST', headers });
            const data = await res.json();
            if (res.ok && data.url) {
                window.location.href = data.url;
            } else {
                alert(data.error || 'Error al crear sesión de pago');
            }
        } catch (e: any) { alert('Error: ' + e?.message); }
        finally { setCheckoutLoading(false); }
    };

    const handlePortal = async () => {
        setPortalLoading(true);
        try {
            const res = await fetch('/api/billing/portal', { method: 'POST', headers });
            const data = await res.json();
            if (res.ok && data.url) { window.location.href = data.url; }
            else { alert(data.error || 'Error'); }
        } catch (e: any) { alert('Error: ' + e?.message); }
        finally { setPortalLoading(false); }
    };

    const handleReportManual = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!manualForm.bank || !manualForm.referenceNumber) {
            alert('Selecciona el banco y escribe el número de referencia.');
            return;
        }
        setReportLoading(true);
        try {
            const res = await fetch('/api/billing/report-manual', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    amount: parseFloat(manualForm.amount),
                    currency: manualForm.currency,
                    bank: manualForm.bank,
                    referenceNumber: manualForm.referenceNumber,
                    proofUrl: proofFile ? proofFile.name : null,
                    notes: manualForm.notes || null,
                }),
            });
            const data = await res.json();
            if (res.ok) {
                alert('Pago reportado exitosamente. Será revisado pronto.');
                setManualForm({ amount: '25', currency: 'USD', bank: '', referenceNumber: '', notes: '' });
                setProofFile(null);
                fetchAll();
            } else {
                alert(data.error || 'Error al reportar pago');
            }
        } catch (e: any) { alert('Error: ' + e?.message); }
        finally { setReportLoading(false); }
    };

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center text-slate-500 gap-2">
                <Loader2 className="animate-spin" size={24} /> Cargando facturación...
            </div>
        );
    }

    const isActive = billing?.status === 'ACTIVE';
    const isTrial = billing?.status === 'TRIAL' || !billing?.status;
    const isSuspended = billing?.status === 'PAST_DUE' || billing?.status === 'CANCELLED';
    const daysLeft = billing?.endsAt ? Math.max(0, Math.ceil((new Date(billing.endsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : null;
    const hasPendingManual = manualPayments.some(p => p.status === 'PENDING');

    return (
        <div className="p-6 h-full overflow-y-auto bg-slate-50">
            {/* Success/Cancel Banner */}
            {paymentStatus === 'success' && (
                <div className="mb-6 p-4 bg-emerald-50 border-2 border-emerald-300 rounded-xl flex items-center gap-3">
                    <CheckCircle className="text-emerald-500 flex-shrink-0" size={24} />
                    <div>
                        <div className="font-bold text-emerald-800">Pago Exitoso</div>
                        <div className="text-sm text-emerald-600">Tu suscripción ha sido activada. Todas las funciones están desbloqueadas.</div>
                    </div>
                </div>
            )}

            {/* Header */}
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-3xl font-bold text-nortex-900 flex items-center gap-2">
                        <CreditCard className="text-nortex-500" /> Facturación & Suscripción
                    </h1>
                    <p className="text-slate-500 text-sm mt-1">{billing?.businessName}</p>
                </div>
                <button onClick={fetchAll} className="p-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600">
                    <RefreshCw size={18} />
                </button>
            </div>

            {/* Status Card */}
            <div className={`p-6 rounded-2xl mb-6 relative overflow-hidden ${
                isActive ? 'bg-gradient-to-br from-emerald-500 to-emerald-700 text-white' :
                isSuspended ? 'bg-gradient-to-br from-red-500 to-red-700 text-white' :
                'bg-gradient-to-br from-amber-400 to-amber-600 text-white'
            }`}>
                <div className="absolute -right-8 -top-8 w-32 h-32 bg-white/10 rounded-full" />
                <div className="relative z-10 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        {isActive ? <Shield size={28} /> : isSuspended ? <XCircle size={28} /> : <Clock size={28} />}
                        <div>
                            <div className="text-sm font-mono opacity-80">ESTADO</div>
                            <div className="text-xl font-bold">
                                {isActive ? 'SUSCRIPCIÓN ACTIVA' : isSuspended ? 'SERVICIO SUSPENDIDO' : 'PERIODO DE PRUEBA'}
                            </div>
                        </div>
                    </div>
                    {isActive && daysLeft !== null && (
                        <div className="text-right text-sm opacity-80">
                            Renueva en <strong>{daysLeft} días</strong>
                        </div>
                    )}
                </div>
            </div>

            {/* Pending Manual Payment Alert */}
            {hasPendingManual && (
                <div className="mb-6 p-4 bg-yellow-50 border-2 border-yellow-300 rounded-xl flex items-center gap-3">
                    <Clock className="text-yellow-600 flex-shrink-0 animate-pulse" size={24} />
                    <div>
                        <div className="font-bold text-yellow-800">Tu pago está en revisión</div>
                        <div className="text-sm text-yellow-700">Hemos recibido tu comprobante. Te avisaremos cuando se active tu cuenta (generalmente en menos de 24 horas).</div>
                    </div>
                </div>
            )}

            {/* TAB SWITCHER */}
            <div className="flex bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm mb-8">
                <button
                    onClick={() => setActiveTab('CARD')}
                    className={`flex-1 px-6 py-3 text-sm font-bold flex items-center justify-center gap-2 transition-colors ${
                        activeTab === 'CARD' ? 'bg-nortex-900 text-white' : 'text-slate-500 hover:bg-slate-50'
                    }`}
                >
                    <CreditCard size={16} /> Tarjeta (Stripe)
                </button>
                <button
                    onClick={() => setActiveTab('DEPOSIT')}
                    className={`flex-1 px-6 py-3 text-sm font-bold flex items-center justify-center gap-2 transition-colors ${
                        activeTab === 'DEPOSIT' ? 'bg-nortex-900 text-white' : 'text-slate-500 hover:bg-slate-50'
                    }`}
                >
                    <Building2 size={16} /> Depósito / Transferencia
                </button>
            </div>

            {/* ==================== TAB: TARJETA (STRIPE) ==================== */}
            {activeTab === 'CARD' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Plan Card */}
                    <div className="bg-white rounded-2xl border-2 border-nortex-200 shadow-lg p-8 relative overflow-hidden">
                        <div className="absolute top-4 right-4">
                            <span className="bg-nortex-900 text-white text-xs font-bold px-3 py-1 rounded-full">PRO</span>
                        </div>
                        <div className="mb-6">
                            <div className="flex items-baseline gap-1 mb-2">
                                <span className="text-5xl font-bold text-slate-800">${PLAN_PRICE}</span>
                                <span className="text-slate-500 text-lg">/USD mes</span>
                            </div>
                            <p className="text-slate-500 text-sm">Cobro automático mensual con tarjeta.</p>
                        </div>
                        <div className="space-y-3 mb-8">
                            {['POS ilimitado', 'Inventario + Kardex', 'Nómina INSS/IR', 'Reportes DGI', 'Multi-usuario', 'Compras y proveedores', 'CRM y cobranza', 'Soporte WhatsApp'].map((f, i) => (
                                <div key={i} className="flex items-center gap-2 text-sm text-slate-600">
                                    <CheckCircle size={16} className="text-emerald-500 flex-shrink-0" /> {f}
                                </div>
                            ))}
                        </div>
                        {!isActive ? (
                            <button onClick={handleCheckout} disabled={checkoutLoading || !billing?.stripeConfigured}
                                className="w-full bg-nortex-900 text-white py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-3 hover:bg-nortex-800 shadow-lg disabled:opacity-50">
                                {checkoutLoading ? <Loader2 className="animate-spin" size={22} /> : <><Zap size={22} /> PAGAR CON TARJETA <ArrowRight size={18} /></>}
                            </button>
                        ) : (
                            <div className="bg-emerald-50 p-4 rounded-xl text-center">
                                <CheckCircle size={32} className="text-emerald-500 mx-auto mb-2" />
                                <div className="font-bold text-emerald-800">Plan Activo</div>
                            </div>
                        )}
                        {!billing?.stripeConfigured && (
                            <p className="text-xs text-amber-600 mt-3 text-center bg-amber-50 p-2 rounded-lg">
                                Stripe no configurado. Usa la opción de depósito bancario.
                            </p>
                        )}
                    </div>

                    {/* Right Column */}
                    <div className="space-y-6">
                        {isActive && billing?.hasStripe && (
                            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
                                <h3 className="font-bold text-slate-800 mb-2 flex items-center gap-2"><CreditCard size={18} className="text-slate-500" /> Gestionar Suscripción</h3>
                                <p className="text-sm text-slate-500 mb-4">Descarga facturas, actualiza método de pago o cancela.</p>
                                <button onClick={handlePortal} disabled={portalLoading}
                                    className="w-full bg-slate-100 text-slate-700 py-3 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-slate-200 disabled:opacity-50">
                                    {portalLoading ? <Loader2 className="animate-spin" size={18} /> : <><ExternalLink size={16} /> Portal de Stripe</>}
                                </button>
                            </div>
                        )}
                        <div className="bg-slate-900 rounded-xl p-6 text-white">
                            <div className="flex items-center gap-3 mb-3"><Shield size={24} className="text-emerald-400" /><div className="font-bold">Pago 100% Seguro</div></div>
                            <p className="text-sm text-slate-400">Procesado por Stripe. Nortex nunca almacena datos de tarjeta.</p>
                            <div className="flex gap-3 mt-4 opacity-60">
                                <span className="text-xs bg-white/10 px-2 py-1 rounded">VISA</span>
                                <span className="text-xs bg-white/10 px-2 py-1 rounded">MASTERCARD</span>
                                <span className="text-xs bg-white/10 px-2 py-1 rounded">AMEX</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ==================== TAB: DEPÓSITO / TRANSFERENCIA ==================== */}
            {activeTab === 'DEPOSIT' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Left: Bank Info + Form */}
                    <div className="space-y-6">
                        {/* Bank Accounts */}
                        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
                            <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                                <Building2 size={18} className="text-blue-500" /> Cuentas para Depósito
                            </h3>
                            <div className="space-y-3">
                                {BANK_ACCOUNTS.map((acc, i) => (
                                    <div key={i} className="bg-slate-50 p-4 rounded-lg border border-slate-100">
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <div className="font-bold text-slate-800 text-sm">{acc.bank}</div>
                                                <div className="text-xs text-slate-500">{acc.type}</div>
                                            </div>
                                            <Banknote size={20} className="text-slate-400" />
                                        </div>
                                        <div className="mt-2 font-mono text-lg text-slate-700 tracking-wider">{acc.number}</div>
                                        <div className="text-xs text-slate-500 mt-1">A nombre de: <strong>{acc.name}</strong></div>
                                    </div>
                                ))}
                            </div>
                            <div className="mt-4 p-3 bg-blue-50 rounded-lg text-xs text-blue-700">
                                <strong>Monto:</strong> $25.00 USD (o equivalente en C$ al tipo de cambio del día)
                            </div>
                        </div>

                        {/* Report Form */}
                        {!hasPendingManual && !isActive && (
                            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
                                <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                                    <Send size={18} className="text-emerald-500" /> Reportar Pago
                                </h3>
                                <form onSubmit={handleReportManual} className="space-y-4">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="text-xs font-bold text-slate-500">Monto</label>
                                            <input type="number" step="0.01" required
                                                className="w-full border p-2.5 rounded-lg text-slate-800"
                                                value={manualForm.amount}
                                                onChange={e => setManualForm({...manualForm, amount: e.target.value})} />
                                        </div>
                                        <div>
                                            <label className="text-xs font-bold text-slate-500">Moneda</label>
                                            <select className="w-full border p-2.5 rounded-lg text-slate-800 bg-white"
                                                value={manualForm.currency}
                                                onChange={e => setManualForm({...manualForm, currency: e.target.value})}>
                                                <option value="USD">$ Dólares (USD)</option>
                                                <option value="NIO">C$ Córdobas (NIO)</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-slate-500">Banco donde depositaste</label>
                                        <select required className="w-full border p-2.5 rounded-lg text-slate-800 bg-white"
                                            value={manualForm.bank}
                                            onChange={e => setManualForm({...manualForm, bank: e.target.value})}>
                                            <option value="">Seleccionar banco...</option>
                                            {BANK_ACCOUNTS.map((a, i) => <option key={i} value={a.bank}>{a.bank}</option>)}
                                            <option value="OTRO">Otro banco</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-slate-500">Número de Referencia / Comprobante</label>
                                        <input type="text" required placeholder="Ej: 2849571023"
                                            className="w-full border p-2.5 rounded-lg text-slate-800"
                                            value={manualForm.referenceNumber}
                                            onChange={e => setManualForm({...manualForm, referenceNumber: e.target.value})} />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-slate-500">Foto del Voucher (opcional)</label>
                                        <div className="border-2 border-dashed border-slate-200 rounded-lg p-4 text-center hover:border-blue-400 transition-colors cursor-pointer relative">
                                            <input type="file" accept="image/*"
                                                className="absolute inset-0 opacity-0 cursor-pointer"
                                                onChange={e => setProofFile(e.target.files?.[0] || null)} />
                                            {proofFile ? (
                                                <div className="flex items-center justify-center gap-2 text-sm text-emerald-600">
                                                    <CheckCircle size={16} /> {proofFile.name}
                                                </div>
                                            ) : (
                                                <div className="text-slate-400 text-sm">
                                                    <Upload size={24} className="mx-auto mb-1" />
                                                    Clic para subir foto del comprobante
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-slate-500">Notas (opcional)</label>
                                        <input type="text" placeholder="Ej: Pagado por Juan Perez"
                                            className="w-full border p-2.5 rounded-lg text-slate-800"
                                            value={manualForm.notes}
                                            onChange={e => setManualForm({...manualForm, notes: e.target.value})} />
                                    </div>
                                    <button type="submit" disabled={reportLoading}
                                        className="w-full bg-emerald-600 text-white py-3.5 rounded-xl font-bold text-lg flex items-center justify-center gap-2 hover:bg-emerald-700 shadow-lg disabled:opacity-50">
                                        {reportLoading ? <Loader2 className="animate-spin" size={20} /> : <><Send size={20} /> Reportar Pago</>}
                                    </button>
                                </form>
                            </div>
                        )}
                    </div>

                    {/* Right: History + Info */}
                    <div className="space-y-6">
                        {/* Payment History */}
                        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
                            <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                                <FileText size={18} className="text-slate-500" /> Historial de Pagos
                            </h3>
                            {manualPayments.length === 0 ? (
                                <div className="text-center py-8 text-slate-400 text-sm">Sin pagos reportados</div>
                            ) : (
                                <div className="space-y-3">
                                    {manualPayments.map(p => (
                                        <div key={p.id} className={`p-4 rounded-lg border ${
                                            p.status === 'APPROVED' ? 'bg-emerald-50 border-emerald-200' :
                                            p.status === 'REJECTED' ? 'bg-red-50 border-red-200' :
                                            'bg-yellow-50 border-yellow-200'
                                        }`}>
                                            <div className="flex justify-between items-start">
                                                <div>
                                                    <div className="font-bold text-slate-800 text-sm">
                                                        {p.currency === 'NIO' ? 'C$' : '$'}{Number(p.amount).toFixed(2)} - {p.bank}
                                                    </div>
                                                    <div className="text-xs text-slate-500 mt-0.5">
                                                        Ref: {p.referenceNumber} | {new Date(p.createdAt).toLocaleDateString('es-NI')}
                                                    </div>
                                                </div>
                                                <span className={`text-xs font-bold px-2 py-1 rounded ${
                                                    p.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' :
                                                    p.status === 'REJECTED' ? 'bg-red-100 text-red-700' :
                                                    'bg-yellow-100 text-yellow-700'
                                                }`}>
                                                    {p.status === 'APPROVED' ? 'APROBADO' : p.status === 'REJECTED' ? 'RECHAZADO' : 'EN REVISIÓN'}
                                                </span>
                                            </div>
                                            {p.status === 'REJECTED' && p.rejectionReason && (
                                                <div className="mt-2 text-xs text-red-600 bg-red-100 p-2 rounded">
                                                    Motivo: {p.rejectionReason}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Instructions */}
                        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
                            <h3 className="font-bold text-slate-800 mb-3">¿Cómo funciona?</h3>
                            <div className="space-y-3 text-sm text-slate-600">
                                <div className="flex gap-3">
                                    <div className="w-7 h-7 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0">1</div>
                                    <span>Deposita o transfiere <strong>$25 USD</strong> a cualquiera de nuestras cuentas.</span>
                                </div>
                                <div className="flex gap-3">
                                    <div className="w-7 h-7 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0">2</div>
                                    <span>Llena el formulario con el <strong>número de referencia</strong> y sube la foto del voucher.</span>
                                </div>
                                <div className="flex gap-3">
                                    <div className="w-7 h-7 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0">3</div>
                                    <span>Nuestro equipo verifica el depósito y <strong>activa tu cuenta en menos de 24 horas</strong>.</span>
                                </div>
                            </div>
                        </div>

                        {/* WhatsApp Support */}
                        <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center text-white font-bold text-lg">W</div>
                                <div>
                                    <div className="font-bold text-green-800 text-sm">¿Necesitas ayuda?</div>
                                    <div className="text-xs text-green-600">Escríbenos al WhatsApp: +505 XXXX-XXXX</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Billing;
