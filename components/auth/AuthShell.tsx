import React from 'react';
import { Moon, Sun } from 'lucide-react';
import {
    nextWorkspaceTheme,
    persistWorkspaceTheme,
    readWorkspaceTheme,
    type WorkspaceTheme,
} from '../../utils/workspaceTheme';

interface AuthShellProps {
    children: React.ReactNode;
    title: React.ReactNode;
    subtitle?: React.ReactNode;
    theme: WorkspaceTheme;
    onToggleTheme: () => void;
    headingId?: string;
    size?: 'compact' | 'regular';
    icon?: React.ReactNode;
    iconTone?: 'brand' | 'success' | 'danger' | 'neutral';
}

/**
 * Las rutas públicas de auth comparten la preferencia global del dispositivo.
 * Cuando un caller obtiene identidad completa (usuario + tenant), vuelve a
 * persistir el mismo valor y workspaceTheme lo mueve al scope tenant/usuario.
 */
export function useAuthTheme() {
    const [theme, setTheme] = React.useState<WorkspaceTheme>(() => readWorkspaceTheme());

    React.useEffect(() => persistWorkspaceTheme(theme), [theme]);

    React.useEffect(() => {
        if (typeof document === 'undefined') return;
        document.documentElement.setAttribute('data-nx-theme', theme);
        document.body.setAttribute('data-nx-theme', theme);
    }, [theme]);

    React.useEffect(() => {
        if (typeof document === 'undefined') return undefined;
        return () => {
            document.documentElement.removeAttribute('data-nx-theme');
            document.body.removeAttribute('data-nx-theme');
        };
    }, []);

    return {
        theme,
        toggleTheme: React.useCallback(() => setTheme(nextWorkspaceTheme), []),
    };
}

export function persistAuthenticatedTheme(theme: WorkspaceTheme): void {
    persistWorkspaceTheme(theme);
}

const AuthThemeToggle: React.FC<{
    theme: WorkspaceTheme;
    onToggle: () => void;
}> = ({ theme, onToggle }) => {
    const isDark = theme === 'dark';
    const actionLabel = isDark ? 'Modo día' : 'Modo noche';
    const Icon = isDark ? Sun : Moon;

    return (
        <button
            type="button"
            onClick={onToggle}
            className="nx-auth-theme-toggle"
            aria-pressed={isDark}
            aria-label={`${isDark ? 'Modo noche' : 'Modo día'} activo. Cambiar a ${actionLabel.toLowerCase()}`}
            title={`Cambiar a ${actionLabel.toLowerCase()}`}
        >
            <Icon aria-hidden="true" size={16} />
            <span>{actionLabel}</span>
        </button>
    );
};

const AuthShell: React.FC<AuthShellProps> = ({
    children,
    title,
    subtitle,
    theme,
    onToggleTheme,
    headingId = 'auth-title',
    size = 'compact',
    icon,
    iconTone = 'brand',
}) => (
    <main className="nx-auth-shell" data-nx-theme={theme} data-testid="auth-theme-root">
        <a className="nx-auth-skip-link" href={`#${headingId}`}>Saltar al contenido</a>

        <nav className="nx-auth-nav" aria-label="Navegación de acceso">
            <div className="nx-auth-nav-inner">
                <a href="/" className="nx-auth-wordmark" aria-label="Nortex, inicio">
                    <span className="nx-auth-wordmark-mark" aria-hidden="true">N</span>
                    <span>Nortex</span>
                </a>
                <AuthThemeToggle theme={theme} onToggle={onToggleTheme} />
            </div>
        </nav>

        <div className="nx-auth-stage">
            <section
                className={`nx-auth-card ${size === 'regular' ? 'nx-auth-card-regular' : ''}`}
                aria-labelledby={headingId}
            >
                <header className="nx-auth-heading">
                    <div className={`nx-auth-heading-icon nx-auth-heading-icon-${iconTone}`} aria-hidden="true">
                        {icon ?? 'N'}
                    </div>
                    <h1 id={headingId}>{title}</h1>
                    {subtitle && <p>{subtitle}</p>}
                </header>
                {children}
            </section>
        </div>
    </main>
);

export default AuthShell;
