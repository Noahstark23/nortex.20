import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, ArrowLeft, Loader2, Check, AlertCircle } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || '';

const ForgotPassword: React.FC = () => {
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const res = await fetch(`${API}/api/auth/forgot-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            const data = await res.json();

            if (res.ok) {
                setSent(true);
            } else {
                setError(data.error || 'Error procesando solicitud.');
            }
        } catch (err) {
            setError('Error de conexión. Intenta de nuevo.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-nortex-900 flex items-center justify-center p-4">
            <div className="w-full max-w-md">
                {/* Logo */}
                <div className="text-center mb-8">
                    <div className="w-12 h-12 bg-nortex-accent rounded-xl flex items-center justify-center mx-auto mb-3 shadow-lg shadow-nortex-accent/20">
                        <span className="font-bold text-nortex-900 text-xl">N</span>
                    </div>
                    <h1 className="text-2xl font-bold text-white">Recuperar Contraseña</h1>
                    <p className="text-slate-400 text-sm mt-2">
                        Ingresa tu email y te enviaremos un link para restablecer tu contraseña.
                    </p>
                </div>

                {!sent ? (
                    <form onSubmit={handleSubmit} className="bg-nortex-800 border border-slate-700 rounded-2xl p-6 shadow-2xl">
                        <div className="mb-5">
                            <label className="text-sm font-medium text-slate-300 block mb-1.5">Email</label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                                <input
                                    type="email"
                                    required
                                    value={email}
                                    onChange={e => setEmail(e.target.value)}
                                    placeholder="tu@email.com"
                                    className="w-full bg-slate-900 border border-slate-600 rounded-lg pl-10 pr-4 py-2.5 text-white placeholder:text-slate-500 focus:border-nortex-accent focus:outline-none"
                                />
                            </div>
                        </div>

                        {error && (
                            <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400 flex items-center gap-2">
                                <AlertCircle size={16} /> {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading || !email}
                            className="w-full bg-nortex-accent text-nortex-900 font-bold py-3 rounded-lg hover:bg-emerald-400 transition-all flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {loading ? <Loader2 className="animate-spin" size={18} /> : <Mail size={18} />}
                            {loading ? 'Enviando...' : 'Enviar Link de Recuperación'}
                        </button>

                        <Link
                            to="/login"
                            className="w-full mt-3 flex items-center justify-center gap-2 text-sm text-slate-400 hover:text-white transition-colors py-2"
                        >
                            <ArrowLeft size={16} /> Volver al Login
                        </Link>
                    </form>
                ) : (
                    /* Confirmación */
                    <div className="bg-nortex-800 border border-emerald-500/30 rounded-2xl p-8 text-center shadow-2xl">
                        <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Check className="text-emerald-400" size={32} />
                        </div>
                        <h2 className="text-xl font-bold text-white mb-2">¡Revisa tu Email!</h2>
                        <p className="text-slate-400 text-sm mb-6 leading-relaxed">
                            Si <strong className="text-white">{email}</strong> está registrado en Nortex,
                            recibirás un link para restablecer tu contraseña en los próximos minutos.
                        </p>
                        <div className="bg-slate-900/50 rounded-lg p-3 text-xs text-slate-500 mb-6">
                            💡 Revisa también tu carpeta de spam. El link expira en 1 hora.
                        </div>
                        <Link
                            to="/login"
                            className="inline-flex items-center gap-2 px-6 py-2.5 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition-colors"
                        >
                            <ArrowLeft size={16} /> Volver al Login
                        </Link>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ForgotPassword;
