import React, { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { Users, Shield, Loader2, AlertCircle, Check, ArrowRight } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || '';

interface InviteData {
    email: string;
    role: string;
    businessName: string;
    expiresAt: string;
}

const ROLE_LABELS: Record<string, string> = {
    MANAGER: 'Gerente',
    CASHIER: 'Cajero/a',
    VIEWER: 'Visor (solo lectura)',
    EMPLOYEE: 'Empleado/a',
};

const AcceptInvitation: React.FC = () => {
    const { token } = useParams<{ token: string }>();
    const navigate = useNavigate();

    const [inviteData, setInviteData] = useState<InviteData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [accepting, setAccepting] = useState(false);
    const [success, setSuccess] = useState(false);

    // Validar token
    useEffect(() => {
        const validateToken = async () => {
            try {
                const res = await fetch(`${API}/api/invite/${token}`);
                const data = await res.json();
                if (res.ok) {
                    setInviteData(data);
                } else {
                    setError(data.error || 'Invitación inválida');
                }
            } catch (err) {
                setError('Error de conexión. Intenta de nuevo.');
            } finally {
                setLoading(false);
            }
        };
        if (token) validateToken();
    }, [token]);

    const handleAccept = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (password !== confirmPassword) {
            setError('Las contraseñas no coinciden.');
            return;
        }
        if (password.length < 6) {
            setError('La contraseña debe tener al menos 6 caracteres.');
            return;
        }

        setAccepting(true);
        try {
            const res = await fetch(`${API}/api/invite/${token}/accept`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, password })
            });
            const data = await res.json();
            if (res.ok) {
                // Auto-login
                localStorage.setItem('token', data.token);
                localStorage.setItem('user', JSON.stringify(data.user));
                localStorage.setItem('tenant', JSON.stringify(data.tenant));
                setSuccess(true);
                setTimeout(() => navigate('/app'), 2000);
            } else {
                setError(data.error || 'Error aceptando invitación');
            }
        } catch (err) {
            setError('Error de conexión');
        } finally {
            setAccepting(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-nortex-900 flex items-center justify-center">
                <div className="text-center">
                    <Loader2 className="animate-spin text-nortex-accent mx-auto mb-4" size={40} />
                    <p className="text-slate-400">Validando invitación...</p>
                </div>
            </div>
        );
    }

    if (error && !inviteData) {
        return (
            <div className="min-h-screen bg-nortex-900 flex items-center justify-center p-4">
                <div className="bg-nortex-800 border border-slate-700 rounded-2xl p-8 max-w-md w-full text-center">
                    <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                        <AlertCircle className="text-red-400" size={32} />
                    </div>
                    <h1 className="text-xl font-bold text-white mb-2">Invitación Inválida</h1>
                    <p className="text-slate-400 mb-6">{error}</p>
                    <Link
                        to="/"
                        className="inline-flex items-center gap-2 px-6 py-2.5 bg-nortex-accent text-nortex-900 font-bold rounded-lg hover:bg-emerald-400 transition-all"
                    >
                        Ir al Inicio
                    </Link>
                </div>
            </div>
        );
    }

    if (success) {
        return (
            <div className="min-h-screen bg-nortex-900 flex items-center justify-center p-4">
                <div className="bg-nortex-800 border border-emerald-500/30 rounded-2xl p-8 max-w-md w-full text-center">
                    <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Check className="text-emerald-400" size={32} />
                    </div>
                    <h1 className="text-xl font-bold text-white mb-2">¡Bienvenido al equipo!</h1>
                    <p className="text-slate-400 mb-2">Te has unido a <strong className="text-white">{inviteData?.businessName}</strong></p>
                    <p className="text-sm text-slate-500">Redirigiendo al dashboard...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-nortex-900 flex items-center justify-center p-4">
            <div className="w-full max-w-md">
                {/* Logo */}
                <div className="text-center mb-8">
                    <div className="w-12 h-12 bg-nortex-accent rounded-xl flex items-center justify-center mx-auto mb-3 shadow-lg shadow-nortex-accent/20">
                        <span className="font-bold text-nortex-900 text-xl">N</span>
                    </div>
                    <h1 className="text-2xl font-bold text-white">Únete al Equipo</h1>
                </div>

                {/* Invitation Info */}
                <div className="bg-nortex-800/50 border border-slate-700/50 rounded-xl p-4 mb-6">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-nortex-accent/10 rounded-lg flex items-center justify-center shrink-0">
                            <Users className="text-nortex-accent" size={20} />
                        </div>
                        <div>
                            <p className="text-white font-medium">{inviteData?.businessName}</p>
                            <p className="text-xs text-slate-400">
                                Te invitó como <strong className="text-nortex-accent">{ROLE_LABELS[inviteData?.role || ''] || inviteData?.role}</strong>
                            </p>
                        </div>
                    </div>
                </div>

                {/* Form */}
                <form onSubmit={handleAccept} className="bg-nortex-800 border border-slate-700 rounded-2xl p-6 shadow-2xl">
                    <div className="space-y-4">
                        {/* Email (readonly) */}
                        <div>
                            <label className="text-sm font-medium text-slate-300 block mb-1.5">Email</label>
                            <input
                                type="email"
                                readOnly
                                value={inviteData?.email || ''}
                                className="w-full bg-slate-900/50 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-400 cursor-not-allowed"
                            />
                        </div>

                        {/* Name */}
                        <div>
                            <label className="text-sm font-medium text-slate-300 block mb-1.5">Tu Nombre Completo</label>
                            <input
                                type="text"
                                required
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder="Juan Pérez"
                                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2.5 text-white placeholder:text-slate-500 focus:border-nortex-accent focus:outline-none"
                            />
                        </div>

                        {/* Password */}
                        <div>
                            <label className="text-sm font-medium text-slate-300 block mb-1.5">Crear Contraseña</label>
                            <input
                                type="password"
                                required
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                placeholder="Mínimo 6 caracteres"
                                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2.5 text-white placeholder:text-slate-500 focus:border-nortex-accent focus:outline-none"
                            />
                        </div>

                        {/* Confirm */}
                        <div>
                            <label className="text-sm font-medium text-slate-300 block mb-1.5">Confirmar Contraseña</label>
                            <input
                                type="password"
                                required
                                value={confirmPassword}
                                onChange={e => setConfirmPassword(e.target.value)}
                                placeholder="Repite la contraseña"
                                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2.5 text-white placeholder:text-slate-500 focus:border-nortex-accent focus:outline-none"
                            />
                        </div>
                    </div>

                    {error && (
                        <div className="mt-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400 flex items-center gap-2">
                            <AlertCircle size={16} /> {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={accepting || !name || !password || !confirmPassword}
                        className="w-full mt-6 bg-nortex-accent text-nortex-900 font-bold py-3 rounded-lg hover:bg-emerald-400 transition-all flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {accepting ? <Loader2 className="animate-spin" size={18} /> : <>Unirme al Equipo <ArrowRight size={18} /></>}
                    </button>

                    <p className="text-xs text-slate-500 text-center mt-3">
                        Al unirte, aceptas los{' '}
                        <Link to="/terms" className="text-nortex-accent hover:underline">Términos de Servicio</Link>
                        {' '}y{' '}
                        <Link to="/privacy" className="text-nortex-accent hover:underline">Política de Privacidad</Link>.
                    </p>
                </form>
            </div>
        </div>
    );
};

export default AcceptInvitation;
