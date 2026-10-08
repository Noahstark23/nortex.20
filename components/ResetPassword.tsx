/// <reference types="vite/client" />
import React, { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { Lock, Loader2, Check, AlertCircle, ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { homePathFor, resolveUiMode, UI_MODE_KEY } from '../utils/navigation';
import AuthShell, { persistAuthenticatedTheme, useAuthTheme } from './auth/AuthShell';

const API = import.meta.env.VITE_API_URL || '';
const PASSWORD_MIN = 8;

interface TokenData {
    email: string;
    name: string;
}

interface ResetPasswordSuccessPayload {
    message?: string;
    error?: string;
    token?: string;
    user?: {
        id?: string;
        email?: string | null;
        name?: string | null;
        role?: string;
    };
    tenant?: {
        id?: string;
        type?: string | null;
        businessName?: string | null;
    };
}

interface CompleteResetSession {
    token: string;
    user: {
        id: string;
        email?: string | null;
        name?: string | null;
        role: string;
    };
    tenant: {
        id: string;
        type: string;
        businessName: string;
    };
}

function isCompleteResetSession(data: ResetPasswordSuccessPayload | null): data is CompleteResetSession {
    return Boolean(
        data
        && typeof data.token === 'string'
        && data.token.trim()
        && typeof data.user?.id === 'string'
        && data.user.id.trim()
        && typeof data.user.role === 'string'
        && data.user.role.trim()
        && typeof data.tenant?.id === 'string'
        && data.tenant.id.trim()
        && typeof data.tenant.type === 'string'
        && data.tenant.type.trim()
        && typeof data.tenant.businessName === 'string'
        && data.tenant.businessName.trim()
    );
}

function persistResetSession(data: CompleteResetSession): boolean {
    const sessionEntries = [
        ['nortex_token', data.token],
        ['nortex_user', JSON.stringify({ ...data.user, tenant: data.tenant })],
        ['nortex_tenant_id', data.tenant.id],
        ['nortex_tenant_data', JSON.stringify(data.tenant)],
    ] as const;
    const previousValues: Array<readonly [string, string | null]> = [];

    try {
        sessionEntries.forEach(([key]) => previousValues.push([key, localStorage.getItem(key)]));
        sessionEntries.forEach(([key, value]) => localStorage.setItem(key, value));
        return true;
    } catch {
        // localStorage no es transaccional. Si una escritura falla, restauramos
        // el estado previo para no dejar una identidad mezclada o parcial.
        previousValues.forEach(([key, previous]) => {
            try {
                if (previous === null) localStorage.removeItem(key);
                else localStorage.setItem(key, previous);
            } catch {
                // El navegador puede bloquear todo storage; el fallback manual
                // sigue siendo seguro porque no se navega a una ruta protegida.
            }
        });
        return false;
    }
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
    const [completion, setCompletion] = useState<'idle' | 'automatic' | 'manual'>('idle');
    const { theme, toggleTheme } = useAuthTheme();
    const redirectTimerRef = React.useRef<number | null>(null);

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

    useEffect(() => () => {
        if (redirectTimerRef.current !== null) {
            window.clearTimeout(redirectTimerRef.current);
        }
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (password !== confirmPassword) {
            setError('Las contraseñas no coinciden.');
            return;
        }
        if (password.length < PASSWORD_MIN) {
            setError(`La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`);
            return;
        }

        setSubmitting(true);
        try {
            const res = await fetch(`${API}/api/auth/reset-password/${token}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });
            const data = await res.json().catch(() => null) as ResetPasswordSuccessPayload | null;

            if (res.ok) {
                if (!isCompleteResetSession(data)) {
                    setPassword('');
                    setConfirmPassword('');
                    setCompletion('manual');
                    return;
                }

                if (!persistResetSession(data)) {
                    setPassword('');
                    setConfirmPassword('');
                    setCompletion('manual');
                    return;
                }

                persistAuthenticatedTheme(theme);
                setCompletion('automatic');
                const nextPath = data.user.role === 'SUPER_ADMIN'
                    ? '/admin'
                    : data.tenant.type === 'LENDER'
                        ? '/app/dashboard'
                        : homePathFor(
                            data.user.role,
                            resolveUiMode(data.tenant.type, localStorage.getItem(UI_MODE_KEY)),
                        );
                redirectTimerRef.current = window.setTimeout(() => {
                    navigate(nextPath, { replace: true });
                }, 1600);
            } else {
                setError(data?.error || 'Error restableciendo contraseña.');
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
            <AuthShell
                title="Validando tu link"
                subtitle="Esto tomará solo un momento."
                theme={theme}
                onToggleTheme={toggleTheme}
                headingId="reset-validating-title"
                icon={<Loader2 className="animate-spin" size={28} />}
                iconTone="neutral"
            >
                <p className="nx-auth-state-message" role="status" aria-live="polite">Validando link…</p>
            </AuthShell>
        );
    }

    // Invalid token
    if (error && !tokenData) {
        return (
            <AuthShell
                title="Link inválido"
                subtitle={<span role="alert">{error}</span>}
                theme={theme}
                onToggleTheme={toggleTheme}
                headingId="reset-invalid-title"
                icon={<AlertCircle size={28} />}
                iconTone="danger"
            >
                <div className="nx-auth-state">
                    <Link to="/forgot-password" className="nx-auth-primary">Solicitar nuevo link</Link>
                    <Link to="/login" className="nx-auth-back-link">
                        <ArrowLeft aria-hidden="true" size={16} /> Volver al login
                    </Link>
                </div>
            </AuthShell>
        );
    }

    if (completion === 'manual') {
        return (
            <AuthShell
                title="Contraseña actualizada"
                subtitle="El cambio se guardó, pero no pudimos iniciar tu sesión automáticamente."
                theme={theme}
                onToggleTheme={toggleTheme}
                headingId="reset-manual-title"
                icon={<Check size={28} />}
                iconTone="success"
            >
                <div className="nx-auth-state" role="status" aria-live="polite">
                    <p className="nx-auth-state-message">Entrá con tu correo y la nueva contraseña para continuar.</p>
                    <Link to="/login" className="nx-auth-primary">Entrar con mi nueva contraseña</Link>
                </div>
            </AuthShell>
        );
    }

    // Success with a complete, persisted session.
    if (completion === 'automatic') {
        return (
            <AuthShell
                title="¡Contraseña actualizada!"
                subtitle="Tu contraseña fue restablecida exitosamente."
                theme={theme}
                onToggleTheme={toggleTheme}
                headingId="reset-success-title"
                icon={<Check size={28} />}
                iconTone="success"
            >
                <div className="nx-auth-state" role="status" aria-live="polite">
                    <p className="nx-auth-state-message">Redirigiendo a tu inicio…</p>
                </div>
            </AuthShell>
        );
    }

    // Reset form
    return (
        <AuthShell
            title="Nueva contraseña"
            subtitle={<>Hola <strong>{tokenData?.name}</strong>, creá tu nueva contraseña.</>}
            theme={theme}
            onToggleTheme={toggleTheme}
            headingId="reset-title"
            icon={<Lock size={25} />}
            iconTone="neutral"
        >
                <form onSubmit={handleSubmit} className="nx-auth-form" aria-busy={submitting}>
                    <div className="nx-auth-field-group">
                        <label htmlFor="reset-email">Correo electrónico</label>
                        <input
                            id="reset-email"
                            type="email"
                            name="email"
                            autoComplete="email"
                            readOnly
                            value={tokenData?.email || ''}
                            className="nx-auth-control nx-auth-control-readonly"
                        />
                    </div>

                    <div className="nx-auth-field-group">
                        <label htmlFor="reset-password">Nueva contraseña</label>
                        <div className="nx-auth-control-wrap">
                            <Lock aria-hidden="true" className="nx-auth-control-icon" size={18} />
                            <input
                                id="reset-password"
                                type={showPassword ? 'text' : 'password'}
                                name="password"
                                autoComplete="new-password"
                                required
                                minLength={PASSWORD_MIN}
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                placeholder={`Mínimo ${PASSWORD_MIN} caracteres`}
                                className="nx-auth-control nx-auth-control-with-icon nx-auth-control-with-action"
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="nx-auth-control-action"
                                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                                aria-pressed={showPassword}
                            >
                                {showPassword ? <EyeOff aria-hidden="true" size={18} /> : <Eye aria-hidden="true" size={18} />}
                            </button>
                        </div>
                    </div>

                    <div className="nx-auth-field-group">
                        <label htmlFor="reset-confirm-password">Confirmar contraseña</label>
                        <div className="nx-auth-control-wrap">
                            <Lock aria-hidden="true" className="nx-auth-control-icon" size={18} />
                            <input
                                id="reset-confirm-password"
                                type={showPassword ? 'text' : 'password'}
                                name="confirmPassword"
                                autoComplete="new-password"
                                required
                                minLength={PASSWORD_MIN}
                                value={confirmPassword}
                                onChange={e => setConfirmPassword(e.target.value)}
                                placeholder="Repetí la contraseña"
                                aria-invalid={Boolean(password && confirmPassword && password !== confirmPassword)}
                                aria-describedby={password && confirmPassword && password !== confirmPassword ? 'reset-confirm-error' : undefined}
                                className="nx-auth-control nx-auth-control-with-icon"
                            />
                        </div>
                        {password && confirmPassword && password !== confirmPassword && (
                            <p id="reset-confirm-error" className="nx-auth-field-error">Las contraseñas no coinciden</p>
                        )}
                    </div>

                    {error && (
                        <div role="alert" aria-live="assertive" className="nx-auth-alert nx-auth-alert-danger">
                            <AlertCircle aria-hidden="true" size={16} /> <span>{error}</span>
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={submitting || !password || !confirmPassword}
                        className="nx-auth-primary"
                    >
                        {submitting ? <Loader2 aria-hidden="true" className="animate-spin" size={18} /> : <Lock aria-hidden="true" size={18} />}
                        {submitting ? 'Actualizando…' : 'Restablecer contraseña'}
                    </button>

                    <Link
                        to="/login"
                        className="nx-auth-back-link"
                    >
                        <ArrowLeft aria-hidden="true" size={16} /> Volver al login
                    </Link>
                </form>
        </AuthShell>
    );
};

export default ResetPassword;
