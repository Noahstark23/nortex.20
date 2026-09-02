import React from 'react';
import {
    PublicFooter,
    PublicThemeFrame,
    PublicTopBar,
    type PublicNavAction,
} from '../public/PublicChrome';

interface BlogShellProps {
    children: React.ReactNode;
    width?: 'wide' | 'reading';
    eyebrow?: string;
    contentId?: string;
    actions?: PublicNavAction[];
    footerLinks?: Array<Pick<PublicNavAction, 'to' | 'label'>>;
}

const BLOG_ACTIONS: PublicNavAction[] = [
    { to: '/blog', label: 'Blog', kind: 'link', className: '!hidden sm:!inline-flex' },
    { to: '/login', label: 'Entrar', kind: 'link', className: '!hidden md:!inline-flex' },
    { to: '/register', label: 'Probar gratis', mobileLabel: 'Gratis', kind: 'primary' },
];

/**
 * Shell compartido de las rutas publicas del blog.
 *
 * La superficie, el contraste y los estados interactivos viven en las clases
 * semanticas `nx-public-*`, para que el blog no vuelva a depender de los
 * colores remapeados del ERP autenticado.
 */
const BlogShell: React.FC<BlogShellProps> = ({
    children,
    width = 'wide',
    eyebrow = 'Recursos',
    contentId = 'blog-main-content',
    actions = BLOG_ACTIONS,
    footerLinks = [],
}) => {
    const contentWidth = width === 'reading' ? 'max-w-[760px]' : 'max-w-[980px]';

    return (
        <PublicThemeFrame>
            {({ theme, toggleTheme }) => (
                <>
                    <a
                        href={`#${contentId}`}
                        className="nx-public-primary sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-modal focus:min-h-[44px] focus:px-5"
                    >
                        Saltar al contenido
                    </a>

                    <PublicTopBar
                        theme={theme}
                        onToggle={toggleTheme}
                        eyebrow={eyebrow}
                        actions={actions}
                    />

                    <main id={contentId} className={`mx-auto w-full ${contentWidth} px-5 py-10 sm:px-6 sm:py-14`}>
                        {children}
                    </main>

                    <PublicFooter links={footerLinks} />
                </>
            )}
        </PublicThemeFrame>
    );
};

export default BlogShell;
