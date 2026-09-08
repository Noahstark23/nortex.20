import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Moon, Sun } from 'lucide-react';
import {
  nextWorkspaceTheme,
  persistWorkspaceTheme,
  readWorkspaceTheme,
  type WorkspaceTheme,
} from '../../utils/workspaceTheme';

export interface PublicThemeControls {
  theme: WorkspaceTheme;
  isDark: boolean;
  toggleTheme: () => void;
}

export interface PublicNavAction {
  to: string;
  label: string;
  mobileLabel?: string;
  kind?: 'link' | 'secondary' | 'primary';
  className?: string;
}

interface PublicThemeFrameProps {
  children: (controls: PublicThemeControls) => React.ReactNode;
  className?: string;
}

interface PublicThemeToggleProps {
  theme: WorkspaceTheme;
  onToggle: () => void;
  className?: string;
}

interface PublicTopBarProps {
  theme: WorkspaceTheme;
  onToggle: () => void;
  eyebrow?: string;
  actions?: PublicNavAction[];
}

interface PublicFooterProps {
  links?: Array<Pick<PublicNavAction, 'to' | 'label'>>;
}

const navClassFor = (kind: PublicNavAction['kind'] = 'link') => {
  if (kind === 'primary') {
    return 'nx-public-primary nx-fluid-press inline-flex min-h-[44px] items-center justify-center px-4 text-sm font-semibold';
  }
  if (kind === 'secondary') {
    return 'nx-public-secondary nx-fluid-press inline-flex min-h-[44px] items-center justify-center px-4 text-sm font-semibold';
  }
  return 'nx-public-link inline-flex min-h-[44px] items-center px-3 text-sm';
};

export const PublicThemeFrame: React.FC<PublicThemeFrameProps> = ({ children, className = '' }) => {
  const [theme, setTheme] = useState<WorkspaceTheme>(() => readWorkspaceTheme());

  useEffect(() => persistWorkspaceTheme(theme), [theme]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    document.documentElement.setAttribute('data-nx-theme', theme);
    document.body.setAttribute('data-nx-theme', theme);

    return () => {
      document.documentElement.removeAttribute('data-nx-theme');
      document.body.removeAttribute('data-nx-theme');
    };
  }, [theme]);

  return (
    <div
      className={`nx-public-page min-h-[100dvh] antialiased ${className}`.trim()}
      data-nx-theme={theme}
      data-testid="public-theme-root"
    >
      {children({
        theme,
        isDark: theme === 'dark',
        toggleTheme: () => setTheme(current => nextWorkspaceTheme(current)),
      })}
    </div>
  );
};

export const PublicThemeToggle: React.FC<PublicThemeToggleProps> = ({ theme, onToggle, className = '' }) => {
  const isDark = theme === 'dark';
  const currentLabel = isDark ? 'modo noche' : 'modo día';
  const nextLabel = isDark ? 'Modo día' : 'Modo noche';
  const Icon = isDark ? Sun : Moon;

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`nx-public-theme-toggle nx-fluid-press ${className}`.trim()}
      aria-pressed={isDark}
      aria-label={`${currentLabel} activo. Cambiar a ${nextLabel.toLowerCase()}`}
      title={`Cambiar a ${nextLabel.toLowerCase()}`}
    >
      <Icon size={17} aria-hidden="true" />
      <span className="nx-public-theme-toggle-label">{nextLabel}</span>
    </button>
  );
};

export const PublicTopBar: React.FC<PublicTopBarProps> = ({
  theme,
  onToggle,
  eyebrow = 'Acceso Nortex',
  actions = [],
}) => (
  <header className="nx-public-nav sticky top-0 z-sticky border-b">
    <nav aria-label="Navegación pública" className="mx-auto flex min-h-[64px] max-w-[1100px] items-center justify-between gap-2 px-3 sm:gap-3 sm:px-6">
      <a
        href="/"
        aria-label="Nortex, inicio"
        className="nx-public-brand flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center gap-2.5 rounded-lg sm:min-w-0 sm:justify-start"
      >
        <img src="/icon-192.svg" alt="" width="32" height="32" className="h-8 w-8 rounded-lg" />
        <span className="nx-public-brand-wordmark truncate text-[18px] font-semibold tracking-[-0.02em] text-[color:var(--nx-public-text)]">Nortex</span>
        <span aria-hidden="true" className="nx-public-subtle hidden text-sm sm:inline">/</span>
        <span className="nx-public-muted hidden text-sm sm:inline">{eyebrow}</span>
      </a>

      <div className="flex min-w-0 items-center gap-1 sm:gap-2">
        {actions.map(action => (
          <Link
            key={`${action.kind ?? 'link'}:${action.to}:${action.label}`}
            to={action.to}
            className={`${navClassFor(action.kind)} ${action.className ?? ''}`.trim()}
          >
            {action.mobileLabel ? (
              <>
                <span className="sm:hidden">{action.mobileLabel}</span>
                <span className="hidden sm:inline">{action.label}</span>
              </>
            ) : action.label}
          </Link>
        ))}
        <PublicThemeToggle theme={theme} onToggle={onToggle} />
      </div>
    </nav>
  </header>
);

export const PublicFooter: React.FC<PublicFooterProps> = ({ links = [] }) => (
  <footer className="nx-public-surface border-t">
    <div className="mx-auto flex max-w-[1100px] flex-col items-center justify-between gap-3 px-4 py-8 text-sm sm:flex-row sm:px-6">
      <p className="nx-public-muted">Nortex Inc. © {new Date().getFullYear()} — Hecho para Nicaragua.</p>
      <nav aria-label="Enlaces públicos y legales" className="flex flex-wrap items-center justify-center gap-1">
        {links.map(link => (
          <Link key={`${link.to}:${link.label}`} to={link.to} className="nx-public-link inline-flex min-h-[44px] items-center px-3">
            {link.label}
          </Link>
        ))}
        <Link to="/privacy" className="nx-public-link inline-flex min-h-[44px] items-center px-3">
          Política de Privacidad
        </Link>
        <Link to="/terms" className="nx-public-link inline-flex min-h-[44px] items-center px-3">
          Términos de Servicio
        </Link>
      </nav>
    </div>
  </footer>
);
