/// <reference types="vite/client" />
import React from 'react';
import { Link, useParams } from 'react-router-dom';
import {
    AlertCircle,
    ArrowLeft,
    ArrowRight,
    Check,
    Eye,
    EyeOff,
    Loader2,
    Lock,
    Mail,
    ShieldCheck,
    UserRound,
    Users,
} from 'lucide-react';
import AuthShell, { useAuthTheme } from './auth/AuthShell';

const API = import.meta.env.VITE_API_URL || '';
// Debe reflejar el contrato del endpoint público existente. Si esa política se
// endurece en el backend, se actualizan ambos límites en el mismo cambio.
const PASSWORD_MIN = 8;

interface InvitationData {
    email: string;
    role: string;
    businessName: string;
    expiresAt: string;
}

const ROLE_LABELS: Record<string, string> = {
    ADMIN: 'Administración',
    MANAGER: 'Gerencia',
    CASHIER: 'Caja',
    VENDEDOR: 'Ventas',
    EMPLOYEE: 'Operación',
    VIEWER: 'Consulta',
    ACCOUNTANT: 'Contabilidad',
    BODEGUERO: 'Bodega',
};

function asInvitationData(value: unknown): InvitationData | null {
    if (!value || typeof value !== 'object') return null;
    const candidate = value as Record<string, unknown>;
    if (
        typeof candidate.email !== 'string'
        || typeof candidate.role !== 'string'
        || typeof candidate.businessName !== 'string'
        || typeof candidate.expiresAt !== 'string'
    ) {
        return null;
    }

    return {
        email: candidate.email,
        role: candidate.role,
        businessName: candidate.businessName,
        expiresAt: candidate.expiresAt,
    };
}

function errorMessage(value: unknown, fallback: string): string {
    if (value && typeof value === 'object') {
        const message = (value as Record<string, unknown>).error;
        if (typeof message === 'string' && message.trim()) return message;
    }
    return fallback;
}

function hasAcceptedInvitation(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    const user = (value as Record<string, unknown>).user;
    if (!user || typeof user !== 'object') return false;
    const candidate = user as Record<string, unknown>;
    return typeof candidate.id === 'string' && candidate.id.trim().length > 0
        && typeof candidate.email === 'string' && candidate.email.trim().length > 0
        && typeof candidate.role === 'string' && candidate.role.trim().length > 0;
}

const AcceptInvitation: React.FC = () => {
    const { token } = useParams<{ token: string }>();
    const { theme, toggleTheme } = useAuthTheme();
    const [invitation, setInvitation] = React.useState<InvitationData | null>(null);
    const [state, setState] = React.useState<'validating' | 'ready' | 'invalid' | 'accepted'>('validating');
    const [validationError, setValidationError] = React.useState('');
    const [submitError, setSubmitError] = React.useState('');
    const [name, setName] = React.useState('');
    const [password, setPassword] = React.useState('');
    const [confirmPassword, setConfirmPassword] = React.useState('');
    const [showPassword, setShowPassword] = React.useState(false);
    const [submitting, setSubmitting] = React.useState(false);

    const validateInvitation = React.useCallback(async () => {
        if (!token) {
            setInvitation(null);
            setValidationError('Este enlace de invitación está incompleto. Pedile una invitación nueva a quien administra el negocio.');
            setState('invalid');
            return;
        }

        setState('validating');
        setInvitation(null);
        setValidationError('');
        setSubmitError('');

        try {
            // El token viene de la URL: se codifica antes de interpolarlo para
            // que no pueda modificar la ruta de la API ni sus query params.
            const response = await fetch(`${API}/api/invite/${encodeURIComponent(token)}`);
            const payload = await response.json().catch(() => null);
            const data = asInvitationData(payload);

            if (!response.ok || !data) {
                setValidationError(errorMessage(payload, 'No pudimos validar esta invitación. Pedí una nueva e intentá de nuevo.'));
                setState('invalid');
                return;
            }

            setInvitation(data);
            setState('ready');
        } catch {
            setValidationError('No pudimos validar la invitación por ahora. Revisá tu conexión e intentá de nuevo.');
            setState('invalid');
        }
    }, [token]);

    React.useEffect(() => {
        void validateInvitation();
    }, [validateInvitation]);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setSubmitError('');

        const trimmedName = name.trim();
        if (!trimmedName) {
            setSubmitError('Indicá tu nombre para crear tu acceso.');
            return;
        }
        if (password.length < PASSWORD_MIN) {
            setSubmitError(`La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`);
            return;
        }
        if (password !== confirmPassword) {
            setSubmitError('Las contraseñas no coinciden.');
            return;
        }
        if (!token) {
            setSubmitError('El enlace de invitación no es válido. Pedí una invitación nueva.');
            return;
        }

        setSubmitting(true);
        try {
            const response = await fetch(`${API}/api/invite/${encodeURIComponent(token)}/accept`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: trimmedName, password }),
            });
            const payload = await response.json().catch(() => null);

            if (!response.ok) {
                setSubmitError(errorMessage(payload, 'No pudimos crear tu acceso. Intentá de nuevo.'));
                return;
            }
            if (!hasAcceptedInvitation(payload)) {
                setSubmitError('El servidor confirmó la solicitud de forma incompleta. Entrá al login para verificar tu acceso o pedí ayuda a quien administra el negocio.');
                return;
            }

            // La aceptación solo crea la cuenta. Nunca se confía ni persiste un
            // JWT de este flujo público: Login conserva la creación de sesión,
            // validación y destino de rol en una única ruta canónica.
            setPassword('');
            setConfirmPassword('');
            setState('accepted');
        } catch {
            setSubmitError('No pudimos conectar con el servidor. Revisá tu conexión e intentá de nuevo.');
        } finally {
            setSubmitting(false);
        }
    };

    if (state === 'validating') {
        return (
            <AuthShell
                title="Validando tu invitación"
                subtitle="Esto tomará solo un momento."
                theme={theme}
                onToggleTheme={toggleTheme}
                headingId="invite-validating-title"
                icon={<Loader2 className="animate-spin" size={28} />}
                iconTone="neutral"
            >
                <p className="nx-auth-state-message" role="status" aria-live="polite">Validando enlace…</p>
            </AuthShell>
        );
    }

    if (state === 'invalid') {
        return (
            <AuthShell
                title="Invitación no disponible"
                subtitle="No podemos abrir este acceso al equipo."
                theme={theme}
                onToggleTheme={toggleTheme}
                headingId="invite-invalid-title"
                icon={<AlertCircle size={28} />}
                iconTone="danger"
            >
                <div className="nx-auth-state">
                    <p className="nx-auth-state-message" role="alert">{validationError}</p>
                    <button type="button" className="nx-auth-secondary" onClick={() => void validateInvitation()}>
                        Validar de nuevo
                    </button>
                    <Link to="/login" className="nx-auth-back-link">
                        <ArrowLeft aria-hidden="true" size={16} /> Ya tengo una cuenta
                    </Link>
                </div>
            </AuthShell>
        );
    }

    if (state === 'accepted') {
        return (
            <AuthShell
                title="¡Tu cuenta está lista!"
                subtitle={<>Ya pertenecés a <strong>{invitation?.businessName}</strong>.</>}
                theme={theme}
                onToggleTheme={toggleTheme}
                headingId="invite-success-title"
                icon={<Check size={28} />}
                iconTone="success"
            >
                <div className="nx-auth-state" role="status" aria-live="polite">
                    <p className="nx-auth-state-message">Entrá con el correo de tu invitación y la contraseña que acabás de crear.</p>
                    <Link to="/login" className="nx-auth-primary">
                        Entrar con mi cuenta <ArrowRight aria-hidden="true" size={18} />
                    </Link>
                </div>
                <div className="nx-auth-footer">
                    <p>¿Necesitás registrar una empresa?</p>
                    <Link to="/register" className="nx-auth-link nx-auth-link-prominent">Registrar empresa <ArrowRight aria-hidden="true" size={15} /></Link>
                </div>
            </AuthShell>
        );
    }

    const roleLabel = invitation ? (ROLE_LABELS[invitation.role] || invitation.role) : 'el equipo';

    return (
        <AuthShell
            title="Unite al equipo"
            subtitle={<>Te invitaron a <strong>{invitation?.businessName}</strong> como {roleLabel}.</>}
            theme={theme}
            onToggleTheme={toggleTheme}
            headingId="invite-title"
            icon={<Users size={25} />}
            iconTone="neutral"
        >
            <div className="nx-auth-note" aria-label="Resumen de invitación">
                <ShieldCheck aria-hidden="true" size={16} />
                Crearás un acceso personal para <strong>{invitation?.email}</strong>.
            </div>

            <form onSubmit={handleSubmit} className="nx-auth-form" aria-busy={submitting}>
                <div className="nx-auth-field-group">
                    <label htmlFor="invite-email">Correo electrónico</label>
                    <div className="nx-auth-control-wrap">
                        <Mail aria-hidden="true" className="nx-auth-control-icon" size={18} />
                        <input
                            id="invite-email"
                            type="email"
                            name="email"
                            autoComplete="email"
                            readOnly
                            value={invitation?.email || ''}
                            className="nx-auth-control nx-auth-control-with-icon nx-auth-control-readonly"
                        />
                    </div>
                </div>

                <div className="nx-auth-field-group">
                    <label htmlFor="invite-name">Tu nombre completo</label>
                    <div className="nx-auth-control-wrap">
                        <UserRound aria-hidden="true" className="nx-auth-control-icon" size={18} />
                        <input
                            id="invite-name"
                            type="text"
                            name="name"
                            autoComplete="name"
                            required
                            maxLength={120}
                            value={name}
                            onChange={event => setName(event.target.value)}
                            placeholder="Ej. Ana López"
                            className="nx-auth-control nx-auth-control-with-icon"
                        />
                    </div>
                </div>

                <div className="nx-auth-field-group">
                    <label htmlFor="invite-password">Crear contraseña</label>
                    <div className="nx-auth-control-wrap">
                        <Lock aria-hidden="true" className="nx-auth-control-icon" size={18} />
                        <input
                            id="invite-password"
                            type={showPassword ? 'text' : 'password'}
                            name="password"
                            autoComplete="new-password"
                            required
                            minLength={PASSWORD_MIN}
                            value={password}
                            onChange={event => setPassword(event.target.value)}
                            placeholder={`Mínimo ${PASSWORD_MIN} caracteres`}
                            className="nx-auth-control nx-auth-control-with-icon nx-auth-control-with-action"
                        />
                        <button
                            type="button"
                            onClick={() => setShowPassword(current => !current)}
                            className="nx-auth-control-action"
                            aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                            aria-pressed={showPassword}
                        >
                            {showPassword ? <EyeOff aria-hidden="true" size={18} /> : <Eye aria-hidden="true" size={18} />}
                        </button>
                    </div>
                </div>

                <div className="nx-auth-field-group">
                    <label htmlFor="invite-confirm-password">Confirmar contraseña</label>
                    <div className="nx-auth-control-wrap">
                        <Lock aria-hidden="true" className="nx-auth-control-icon" size={18} />
                        <input
                            id="invite-confirm-password"
                            type={showPassword ? 'text' : 'password'}
                            name="confirmPassword"
                            autoComplete="new-password"
                            required
                            minLength={PASSWORD_MIN}
                            value={confirmPassword}
                            onChange={event => setConfirmPassword(event.target.value)}
                            placeholder="Repetí la contraseña"
                            aria-invalid={Boolean(password && confirmPassword && password !== confirmPassword)}
                            aria-describedby={password && confirmPassword && password !== confirmPassword ? 'invite-confirm-password-error' : undefined}
                            className="nx-auth-control nx-auth-control-with-icon"
                        />
                    </div>
                    {password && confirmPassword && password !== confirmPassword && (
                        <p id="invite-confirm-password-error" className="nx-auth-field-error">Las contraseñas no coinciden.</p>
                    )}
                </div>

                {submitError && (
                    <div role="alert" aria-live="assertive" className="nx-auth-alert nx-auth-alert-danger">
                        <AlertCircle aria-hidden="true" size={16} /> <span>{submitError}</span>
                    </div>
                )}

                <button
                    type="submit"
                    disabled={submitting || !name.trim() || !password || !confirmPassword}
                    className="nx-auth-primary"
                >
                    {submitting ? <Loader2 aria-hidden="true" className="animate-spin" size={18} /> : <Users aria-hidden="true" size={18} />}
                    {submitting ? 'Creando acceso…' : 'Unirme al equipo'}
                </button>

                <Link to="/login" className="nx-auth-back-link">
                    <ArrowLeft aria-hidden="true" size={16} /> Ya tengo una cuenta
                </Link>
            </form>
        </AuthShell>
    );
};

export default AcceptInvitation;
