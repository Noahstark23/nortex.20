import React, { useEffect, useMemo } from 'react';
import { Link, useParams, Navigate } from 'react-router-dom';
import { blogPosts } from '../data/blog-posts';
import { getClusterBySlug } from '../data/blog-clusters';
import { buildBreadcrumbJsonLd } from '../utils/seo';
import { ArrowRight, ChevronRight, Clock, Star } from 'lucide-react';
import BlogShell from './blog/BlogShell';

/**
 * Hub de clúster: /blog/categoria/:slug
 * Lista el artículo pilar y todos los artículos de soporte del clúster.
 */
const ClusterPage: React.FC = () => {
    const { slug } = useParams<{ slug: string }>();
    const cluster = slug ? getClusterBySlug(slug) : undefined;

    const posts = useMemo(
        () => (cluster ? blogPosts.filter(p => p.cluster === cluster.name) : []),
        [cluster],
    );
    const pillar = cluster ? posts.find(p => p.slug === cluster.pillarSlug) : undefined;
    const supporting = cluster ? posts.filter(p => p.slug !== cluster?.pillarSlug) : [];

    useEffect(() => {
        if (!cluster) return;
        const prevTitle = document.title;
        document.title = `${cluster.name} | Nortex Blog`;

        const breadcrumb = buildBreadcrumbJsonLd([
            { name: 'Blog', url: '/blog' },
            { name: cluster.name, url: `/blog/categoria/${cluster.slug}` },
        ]);
        const tag = document.createElement('script');
        tag.type = 'application/ld+json';
        tag.setAttribute('data-cluster-jsonld', cluster.slug);
        tag.textContent = JSON.stringify(breadcrumb);
        document.head.appendChild(tag);

        return () => {
            document.title = prevTitle;
            tag.remove();
        };
    }, [cluster]);

    if (!cluster) return <Navigate to="/blog" replace />;

    return (
        <BlogShell>
            <nav className="nx-public-subtle flex flex-wrap items-center gap-1 text-sm" aria-label="Migas de pan">
                <Link to="/blog" className="nx-public-link inline-flex min-h-[44px] items-center px-1">Blog</Link>
                <ChevronRight size={14} aria-hidden="true" />
                <span aria-current="page" className="nx-public-muted">{cluster.name}</span>
            </nav>

            <header className="mt-5 max-w-3xl">
                <p className="nx-public-badge inline-flex min-h-[32px] items-center px-3 text-sm font-semibold">Tema</p>
                <h1 className="mt-5 text-balance text-[36px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[48px]">{cluster.name}</h1>
                <p className="nx-public-muted mt-4 max-w-2xl text-[17px] leading-7 sm:text-[19px]">{cluster.description}</p>
            </header>

            {/* Pilar destacado */}
            {pillar && (
                <section aria-labelledby="pillar-title" className="mt-10">
                    <Link
                        to={`/blog/${pillar.slug}`}
                        className="nx-public-card group block p-7 sm:p-9"
                    >
                        <span className="nx-public-badge inline-flex min-h-[32px] items-center gap-2 px-3 text-sm font-semibold">
                            <Star size={15} aria-hidden="true" /> Guía principal
                        </span>
                        <h2 id="pillar-title" className="mt-5 max-w-3xl text-[28px] font-semibold leading-tight tracking-[-0.02em] sm:text-[32px]">{pillar.title}</h2>
                        <p className="nx-public-muted mt-3 max-w-3xl text-base leading-7">{pillar.description}</p>
                        <span className="nx-public-link mt-6 inline-flex min-h-[44px] items-center gap-1 font-semibold">
                            Leer la guía <ArrowRight size={17} aria-hidden="true" />
                        </span>
                    </Link>
                </section>
            )}

            {/* Artículos de soporte */}
            {supporting.length > 0 ? (
                <section aria-labelledby="supporting-title" className="mt-12">
                    <h2 id="supporting-title" className="text-2xl font-semibold tracking-[-0.02em]">Más guías de este tema</h2>
                    <div className="mt-5 grid gap-5 md:grid-cols-2">
                        {supporting.map(post => (
                            <Link
                                key={post.slug}
                                to={`/blog/${post.slug}`}
                                className="nx-public-card group flex min-h-[260px] flex-col p-6 sm:p-7"
                            >
                                <span className="nx-public-badge inline-flex w-fit min-h-[32px] items-center px-3 text-sm font-semibold">{post.category}</span>
                                <h3 className="mt-5 text-xl font-semibold leading-snug tracking-[-0.015em]">{post.title}</h3>
                                <p className="nx-public-muted mt-3 text-[15px] leading-6">{post.description}</p>
                                <div className="mt-auto flex items-center justify-between gap-4 pt-6 text-sm">
                                    <span className="nx-public-subtle flex items-center gap-2"><Clock size={15} aria-hidden="true" /> {post.readTime} lectura</span>
                                    <span className="nx-public-link flex items-center gap-1 font-semibold">Leer <ArrowRight size={15} aria-hidden="true" /></span>
                                </div>
                            </Link>
                        ))}
                    </div>
                </section>
            ) : (
                <p className="nx-public-muted mt-12 text-sm">Más artículos de este tema vienen en camino.</p>
            )}

            <div className="mt-12">
                <Link to="/blog" className="nx-public-secondary inline-flex min-h-[44px] items-center justify-center px-5 text-sm font-semibold">← Volver a todos los temas</Link>
            </div>
        </BlogShell>
    );
};

export default ClusterPage;
