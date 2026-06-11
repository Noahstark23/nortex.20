import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bike, User, Phone, CreditCard, MapPin, Hash, Lock, Loader2, CheckCircle2, ShieldCheck } from 'lucide-react';
import ImageUploader from './ImageUploader';

/**
 * Inscripción pública a la Red NORTEX de repartidores (/repartidor/registro).
 * Crea un Motorizado tipoFlota=NORTEX con kycStatus=PENDIENTE y activo=false:
 * un SUPER_ADMIN revisa cédula + moto (KYC manual) antes de aprobar.
 */

const RegistroRepartidor: React.FC = () => {
    const [form, setForm] = useState({
        nombre: '',
        telefono: '',
        cedula: '',
        zonaCobertura: '',
        vehiculoPlaca: '',
        pin: '',
        pinConfirm: '',
    });
    const [fotoCedulaUrl, setFotoCedulaUrl] = useState('');
    const [fotoVehiculoUrl, setFotoVehiculoUrl] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState('');

    const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
        setForm(prev => ({ ...prev, [k]: e.target.value }));

    const setPinSan = (k: 'pin' | 'pinConfirm') => (e: React.ChangeEvent<HTMLInputElement>) =>
        setForm(prev => ({ ...prev, [k]: e.target.value.replace(/\D/g, '').slice(0, 6) }));

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        if (form.pin.length < 4) return setError('El PIN debe tener 4 a 6 dígitos.');
        if (form.pin !== form.pinConfirm) return setError('Los PIN no coinciden.');
        if (form.telefono.replace(/\D/g, '').length < 8) return setError('Teléfono inválido (8 dígitos).');

        setSubmitting(true);
        try {
            const res = await fetch('/api/driver/registro', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    nombre: form.nombre.trim(),
                    telefono: form.telefono.trim(),
                    cedula: form.cedula.trim(),
                    zonaCobertura: form.zonaCobertura.trim(),
                    vehiculoPlaca: form.vehiculoPlaca.trim() || undefined,
                    pin: form.pin,
                    fotoCedulaUrl: fotoCedulaUrl || undefined,
                    fotoVehiculoUrl: fotoVehiculoUrl || undefined,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                setError(data.error || 'Error al enviar el registro.');
                return;
            }
            setSuccess(true);
        } catch {
            setError('Error de conexión. Intenta de nuevo.');
        } finally {
            setSubmitting(false);
        }
    };

    if (success) {
        return (
            <div className="min-h-screen bg-surface-950 flex items-center justify-center p-4">
                <div className="panel-premium p-8 max-w-md w-full text-center animate-fade-in-up">
                    <div className="w-16 h-16 bg-emerald-500/15 border border-emerald-500/25 rounded-2xl flex items-center justify-center mx-auto mb-4">
                        <CheckCircle2 className="text-emerald-400" size={32} />
                    </div>
                    <h1 className="text-2xl font-bold text-white mb-2">¡Solicitud recibida!</h1>
                    <p className="text-slate-400 text-sm leading-relaxed mb-6">
                        Tu registro está <strong className="text-amber-400">en revisión</strong>. El equipo de Nortex
                        verificará tus documentos y te contactará al <strong className="text-white">{form.telefono}</strong> cuando
                        tu cuenta sea aprobada.
                    </p>
                    <Link to="/driver" className="btn-primary inline-flex items-center gap-2">
                        <Bike size={18} /> Ir al login de repartidores
                    </Link>
                </div>
            </div>
        );
    }

    const inputCls = 'w-full bg-white/[0.03] border border-white/[0.08] text-white pl-10 pr-4 py-3 rounded-xl focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand/40 transition-all placeholder:text-slate-600';

    return (
        <div className="min-h-screen bg-surface-950 py-10 px-4">
            <div className="max-w-md mx-auto">
                {/* Header */}
                <div className="text-center mb-8">
                    <div className="w-14 h-14 bg-nortex-accent rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-glow shadow-emerald-500/40">
                        <Bike className="text-surface-950" size={28} />
                    </div>
                    <h1 className="text-3xl font-bold text-white tracking-tight">Unite a la Red Nortex</h1>
                    <p className="text-slate-400 text-sm mt-2">
                        Repartí para los negocios de tu zona y ganá por cada entrega. 🛵
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="panel-premium p-6 space-y-4">
                    <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={17} />
                        <input required maxLength={100} placeholder="Nombre completo *" value={form.nombre} onChange={set('nombre')} className={inputCls} />
                    </div>
                    <div className="relative">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={17} />
                        <input required type="tel" inputMode="numeric" maxLength={20} placeholder="Teléfono / WhatsApp (8 dígitos) *" value={form.telefono} onChange={set('telefono')} className={`${inputCls} font-mono tabular-nums`} />
                    </div>
                    <div className="relative">
                        <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={17} />
                        <input required maxLength={25} placeholder="Número de cédula *" value={form.cedula} onChange={set('cedula')} className={`${inputCls} font-mono`} />
                    </div>
                    <div className="relative">
                        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={17} />
                        <input required maxLength={100} placeholder="Zona de cobertura (ej: Managua - Altamira) *" value={form.zonaCobertura} onChange={set('zonaCobertura')} className={inputCls} />
                    </div>
                    <div className="relative">
                        <Hash className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={17} />
                        <input maxLength={20} placeholder="Placa de la moto (opcional)" value={form.vehiculoPlaca} onChange={set('vehiculoPlaca')} className={`${inputCls} font-mono uppercase`} />
                    </div>

                    {/* KYC: fotos */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                        <div>
                            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">📄 Foto de tu cédula</label>
                            <ImageUploader value={fotoCedulaUrl} onChange={setFotoCedulaUrl} />
                        </div>
                        <div>
                            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">🛵 Foto de la moto (placa visible)</label>
                            <ImageUploader value={fotoVehiculoUrl} onChange={setFotoVehiculoUrl} />
                        </div>
                    </div>

                    {/* PIN */}
                    <div className="border-t border-white/[0.06] pt-4 space-y-3">
                        <p className="text-xs text-slate-400 flex items-center gap-1.5">
                            <Lock size={13} className="text-brand-300" /> Creá tu PIN de acceso (4-6 dígitos) — con él entrás a tu app de entregas.
                        </p>
                        <div className="grid grid-cols-2 gap-3">
                            <input required type="password" inputMode="numeric" placeholder="PIN *" value={form.pin} onChange={setPinSan('pin')} className="w-full bg-white/[0.03] border border-white/[0.08] text-white text-center text-xl font-mono tracking-[0.4em] py-3 rounded-xl focus:outline-none focus:border-brand placeholder:tracking-normal placeholder:text-sm placeholder:text-slate-600" />
                            <input required type="password" inputMode="numeric" placeholder="Repetir PIN *" value={form.pinConfirm} onChange={setPinSan('pinConfirm')} className="w-full bg-white/[0.03] border border-white/[0.08] text-white text-center text-xl font-mono tracking-[0.4em] py-3 rounded-xl focus:outline-none focus:border-brand placeholder:tracking-normal placeholder:text-sm placeholder:text-slate-600" />
                        </div>
                    </div>

                    {error && (
                        <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm text-center">{error}</div>
                    )}

                    <button type="submit" disabled={submitting} className="btn-primary w-full py-3.5 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100">
                        {submitting ? <Loader2 className="animate-spin" size={20} /> : <ShieldCheck size={20} />}
                        {submitting ? 'Enviando...' : 'Enviar solicitud'}
                    </button>

                    <p className="text-[11px] text-slate-500 text-center leading-relaxed">
                        Tu solicitud pasa por una revisión manual de seguridad (KYC). Solo repartidores
                        verificados acceden a la Red Nortex.
                    </p>
                </form>

                <p className="text-center text-sm text-slate-500 mt-6">
                    ¿Ya tenés cuenta?{' '}
                    <Link to="/driver" className="text-brand-300 hover:text-brand-200 font-semibold">Iniciar sesión</Link>
                </p>
            </div>
        </div>
    );
};

export default RegistroRepartidor;
