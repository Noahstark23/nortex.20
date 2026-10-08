import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, ArrowLeft, Loader2, Check, AlertCircle } from 'lucide-react';
import AuthShell, { useAuthTheme } from './auth/AuthShell';

const API = import.meta.env.VITE_API_URL || '';

const ForgotPassword: React.FC = () => {
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState('');
    const { theme, toggleTheme } = useAuthTheme();

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
            setError('Error de conexión. Intentá de nuevo.');
        } finally {
            setLoading(false);
        }
    };

    if (sent) {
        return (
            <AuthShell
                title="¡Revisá tu correo!"
                subtitle="Te indicaremos cómo crear una contraseña nueva."
                theme={theme}
                onToggleTheme={toggleTheme}
                headingId="forgot-success-title"
                icon={<Check size={28} />}
                iconTone="success"
            >
                <div className="nx-auth-state" role="status" aria-live="polite">
                    <p>
                        Si <strong>{email}</strong> está registrado en Nortex, recibirás un link para restablecer tu contraseña en los próximos minutos.
                    </p>
                    <p className="nx-auth-note">Revisá también tu carpeta de spam. El link expira en 1 hora.</p>
                    <Link to="/login" className="nx-auth-secondary">
                        <ArrowLeft aria-hidden="true" size={16} /> Volver al login
                    </Link>
                </div>
            </AuthShell>
        );
    }

    return (
        <AuthShell
            title="Recuperar contraseña"
            subtitle="Ingresá tu correo y te enviaremos un link para restablecer tu contraseña."
            theme={theme}
            onToggleTheme={toggleTheme}
            headingId="forgot-title"
            icon={<Mail size={25} />}
            iconTone="neutral"
        >
            <form onSubmit={handleSubmit} className="nx-auth-form" aria-busy={loading}>
                <div className="nx-auth-field-group">
                    <label htmlFor="forgot-email">Correo electrónico</label>
                    <div className="nx-auth-control-wrap">
                        <Mail aria-hidden="true" className="nx-auth-control-icon" size={18} />
                        <input
                            id="forgot-email"
                            type="email"
                            name="email"
                            autoComplete="email"
                            required
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            placeholder="tu@email.com"
                            className="nx-auth-control nx-auth-control-with-icon"
                        />
                    </div>
                </div>

                {error && (
                    <div role="alert" aria-live="assertive" className="nx-auth-alert nx-auth-alert-danger">
                        <AlertCircle aria-hidden="true" size={16} /> <span>{error}</span>
                    </div>
                )}

                <button type="submit" disabled={loading || !email} className="nx-auth-primary">
                    {loading ? <Loader2 aria-hidden="true" className="animate-spin" size={18} /> : <Mail aria-hidden="true" size={18} />}
                    {loading ? 'Enviando…' : 'Enviar link de recuperación'}
                </button>

                <Link to="/login" className="nx-auth-back-link">
                    <ArrowLeft aria-hidden="true" size={16} /> Volver al login
                </Link>
            </form>
        </AuthShell>
    );
};

export default ForgotPassword;
