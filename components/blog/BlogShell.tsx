import React from 'react';
import { Link } from 'react-router-dom';

interface BlogShellProps {
    children: React.ReactNode;
    width?: 'wide' | 'reading';
}

/**
 * Shell compartido de las rutas publicas del blog.
 *
 * La superficie, el contraste y los estados interactivos viven en las clases
 * semanticas `nx-public-*`, para que el blog no vuelva a depender de los
 * colores remapeados del ERP autenticado.
 */
const BlogShell: React.FC<BlogShellProps> = ({ children, width = 'wide' }) => {
    const contentWidth = width === 'reading' ? 'max-w-[760px]' : 'max-w-[980px]';

    return (
        <div className="nx-public-page min-h-screen antialiased">
            <a
                href="#blog-main-content"
                className="nx-public-primary sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-modal focus:min-h-[44px] focus:px-5"
            >
                Saltar al contenido
            </a>

            <header className="nx-public-nav sticky top-0 z-sticky border-b">
                <div className="mx-auto flex min-h-[64px] max-w-[980px] items-center justify-between gap-4 px-5 sm:px-6">
                    <Link
                        to="/"
                        aria-label="Nortex, inicio"
                        className="flex min-h-[44px] items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-800 focus-visible:ring-offset-2"
                    >
                        <img
                            src="/icon-192.svg"
                            alt=""
                            width="32"
                            height="32"
                            className="h-8 w-8 rounded-lg"
                        />
                        <span className="text-[18px] font-semibold tracking-[-0.02em]">Nortex</span>
                        <span aria-hidden="true" className="nx-public-subtle hidden text-sm sm:inline">/</span>
                        <span className="nx-public-muted hidden text-sm sm:inline">Recursos</span>
                    </Link>

                    <nav aria-label="Navegación del blog" className="flex items-center gap-1 sm:gap-3">
                        <Link
                            to="/blog"
                            className="nx-public-link hidden min-h-[44px] items-center px-3 text-sm sm:inline-flex"
                        >
                            Blog
                        </Link>
                        <Link
                            to="/login"
                            className="nx-public-link hidden min-h-[44px] items-center px-3 text-sm md:inline-flex"
                        >
                            Entrar
                        </Link>
                        <Link
                            to="/register"
                            className="nx-public-primary inline-flex min-h-[44px] items-center justify-center px-5 text-sm font-semibold"
                        >
                            Probar gratis
                        </Link>
                    </nav>
                </div>
            </header>

            <main id="blog-main-content" className={`mx-auto w-full ${contentWidth} px-5 py-10 sm:px-6 sm:py-14`}>
                {children}
            </main>

            <footer className="nx-public-surface border-t">
                <div className="mx-auto flex max-w-[980px] flex-col items-center justify-between gap-3 px-5 py-8 text-sm sm:flex-row sm:px-6">
                    <p className="nx-public-muted">Nortex Inc. © {new Date().getFullYear()} — Hecho para Nicaragua.</p>
                    <nav aria-label="Enlaces legales" className="flex items-center gap-1">
                        <Link to="/privacy" className="nx-public-link inline-flex min-h-[44px] items-center px-3">
                            Privacidad
                        </Link>
                        <Link to="/terms" className="nx-public-link inline-flex min-h-[44px] items-center px-3">
                            Términos
                        </Link>
                    </nav>
                </div>
            </footer>
        </div>
    );
};

export default BlogShell;
