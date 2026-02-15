/// <reference types="vite/client" />
import React, { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { Lock, Loader2, Check, AlertCircle, ArrowLeft, Eye, EyeOff } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || '';

interface TokenData {
    email: string;
    name: string;
}

const ResetPassword: React.FC = () => {
    const { token } = useParams<{ token: string }>();
    const navigate = useNavigate();

    const [tokenData, setTokenData] = useState<TokenData | null>(null);
    const [validating, setValidating] = useState(true);
    const [error, setError] = useState('');

    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);

    // Validar token al cargar
    useEffect(() => {
        const validate = async () => {
            try {
                const res = await fetch(`${API}/api/auth/reset-password/${token}`);
                const data = await res.json();
                if (res.ok) {
                    setTokenData(data);
                } else {
                    setError(data.error || 'Link inválido.');
                }
            } catch (err) {
                setError('Error de conexión.');
            } finally {
                setValidating(false);
            }
        };
        if (token) validate();
    }, [token]);

    const handleSubmit = async (e: React.FormEvent) => {
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

        setSubmitting(true);
        try {
            const res = await fetch(`${API}/api/auth/reset-password/${token}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });
            const data = await res.json();

            if (res.ok) {
                // Auto-login
                localStorage.setItem('token', data.token);
                localStorage.setItem('user', JSON.stringify(data.user));
                setSuccess(true);
                setTimeout(() => navigate('/app'), 2000);
            } else {
                setError(data.error || 'Error restableciendo contraseña.');
            }
        } catch (err) {
            setError('Error de conexión.');
        } finally {
            setSubmitting(false);
        }
    };

    // Loading state
    if (validating) {
        return (
            <div className="min-h-screen bg-nortex-900 flex items-center justify-center">
                <div className="text-center">
                    <Loader2 className="animate-spin text-nortex-accent mx-auto mb-4" size={40} />
                    <p className="text-slate-400">Validando link...</p>
                </div>
            </div>
        );
    }

    // Invalid token
    if (error && !tokenData) {
        return (
            <div className="min-h-screen bg-nortex-900 flex items-center justify-center p-4">
                <div className="bg-nortex-800 border border-slate-700 rounded-2xl p-8 max-w-md w-full text-center">
                    <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                        <AlertCircle className="text-red-400" size={32} />
                    </div>
                    <h1 className="text-xl font-bold text-white mb-2">Link Inválido</h1>
                    <p className="text-slate-400 mb-6">{error}</p>
                    <div className="flex flex-col gap-3">
                        <Link
                            to="/forgot-password"
                            className="inline-flex items-center justify-center gap-2 px-6 py-2.5 bg-nortex-accent text-nortex-900 font-bold rounded-lg hover:bg-emerald-400 transition-all"
                        >
                            Solicitar Nuevo Link
                        </Link>
                        <Link
                            to="/login"
                            className="inline-flex items-center justify-center gap-2 text-sm text-slate-400 hover:text-white transition-colors"
                        >
                            <ArrowLeft size={16} /> Volver al Login
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    // Success
    if (success) {
        return (
            <div className="min-h-screen bg-nortex-900 flex items-center justify-center p-4">
                <div className="bg-nortex-800 border border-emerald-500/30 rounded-2xl p-8 max-w-md w-full text-center">
                    <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Check className="text-emerald-400" size={32} />
                    </div>
                    <h1 className="text-xl font-bold text-white mb-2">¡Contraseña Actualizada!</h1>
                    <p className="text-slate-400 mb-2">Tu contraseña ha sido restablecida exitosamente.</p>
                    <p className="text-sm text-slate-500">Redirigiendo al dashboard...</p>
                </div>
            </div>
        );
    }

    // Reset form
    return (
        <div className="min-h-screen bg-nortex-900 flex items-center justify-center p-4">
            <div className="w-full max-w-md">
                {/* Logo */}
                <div className="text-center mb-8">
                    <div className="w-12 h-12 bg-nortex-accent rounded-xl flex items-center justify-center mx-auto mb-3 shadow-lg shadow-nortex-accent/20">
                        <span className="font-bold text-nortex-900 text-xl">N</span>
                    </div>
                    <h1 className="text-2xl font-bold text-white">Nueva Contraseña</h1>
                    <p className="text-slate-400 text-sm mt-2">
                        Hola <strong className="text-white">{tokenData?.name}</strong>, crea tu nueva contraseña.
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="bg-nortex-800 border border-slate-700 rounded-2xl p-6 shadow-2xl">
                    {/* Email (readonly) */}
                    <div className="mb-4">
                        <label className="text-sm font-medium text-slate-300 block mb-1.5">Email</label>
                        <input
                            type="email"
                            readOnly
                            value={tokenData?.email || ''}
                            className="w-full bg-slate-900/50 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-400 cursor-not-allowed"
                        />
                    </div>

                    {/* New Password */}
                    <div className="mb-4">
                        <label className="text-sm font-medium text-slate-300 block mb-1.5">Nueva Contraseña</label>
                        <div className="relative">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                            <input
                                type={showPassword ? 'text' : 'password'}
                                required
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                placeholder="Mínimo 6 caracteres"
                                className="w-full bg-slate-900 border border-slate-600 rounded-lg pl-10 pr-10 py-2.5 text-white placeholder:text-slate-500 focus:border-nortex-accent focus:outline-none"
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                            >
                                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                        </div>
                    </div>

                    {/* Confirm */}
                    <div className="mb-5">
                        <label className="text-sm font-medium text-slate-300 block mb-1.5">Confirmar Contraseña</label>
                        <div className="relative">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                            <input
                                type={showPassword ? 'text' : 'password'}
                                required
                                value={confirmPassword}
                                onChange={e => setConfirmPassword(e.target.value)}
                                placeholder="Repite la contraseña"
                                className="w-full bg-slate-900 border border-slate-600 rounded-lg pl-10 pr-4 py-2.5 text-white placeholder:text-slate-500 focus:border-nortex-accent focus:outline-none"
                            />
                        </div>
                        {password && confirmPassword && password !== confirmPassword && (
                            <p className="text-red-400 text-xs mt-1.5">Las contraseñas no coinciden</p>
                        )}
                    </div>

                    {error && (
                        <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400 flex items-center gap-2">
                            <AlertCircle size={16} /> {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={submitting || !password || !confirmPassword}
                        className="w-full bg-nortex-accent text-nortex-900 font-bold py-3 rounded-lg hover:bg-emerald-400 transition-all flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {submitting ? <Loader2 className="animate-spin" size={18} /> : <Lock size={18} />}
                        {submitting ? 'Actualizando...' : 'Restablecer Contraseña'}
                    </button>

                    <Link
                        to="/login"
                        className="w-full mt-3 flex items-center justify-center gap-2 text-sm text-slate-400 hover:text-white transition-colors py-2"
                    >
                        <ArrowLeft size={16} /> Volver al Login
                    </Link>
                </form>
            </div>
        </div>
    );
};

export default ResetPassword;
