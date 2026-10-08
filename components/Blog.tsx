import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { blogPosts } from '../data/blog-posts';
import { blogClusters, getClusterByName } from '../data/blog-clusters';
import { ArrowRight, Clock } from 'lucide-react';
import BlogShell from './blog/BlogShell';

const PAGE_SIZE = 12;

const Blog: React.FC = () => {
    const [activeCluster, setActiveCluster] = useState<string | null>(null);
    const [page, setPage] = useState(1);

    // Orden estable: más recientes primero (por fecha de actualización/publicación).
    const sorted = useMemo(
        () => [...blogPosts].sort((a, b) => (b.updated ?? b.date).localeCompare(a.updated ?? a.date)),
        [],
    );

    const filtered = useMemo(
        () => (activeCluster ? sorted.filter(p => p.cluster === activeCluster) : sorted),
        [sorted, activeCluster],
    );

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const safePage = Math.min(page, totalPages);
    const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

    const selectCluster = (name: string | null) => {
        setActiveCluster(name);
        setPage(1);
    };

    return (
        <BlogShell>
            <header className="max-w-3xl">
                <p className="nx-public-badge inline-flex min-h-[32px] items-center px-3 text-sm font-semibold">
                    Biblioteca Nortex
                </p>
                <h1 className="mt-5 text-balance text-[36px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[48px]">
                    Recursos para negocios en Nicaragua
                </h1>
                <p className="nx-public-muted mt-4 max-w-2xl text-[17px] leading-7 sm:text-[19px]">
                    Guías de nómina, facturación DGI, impuestos, inventario y gestión de negocios para PyMES nicaragüenses.
                </p>
            </header>

            {/* Filtros temáticos sin iconografía decorativa. */}
            <section aria-label="Filtrar por tema" className="mt-9">
                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={() => selectCluster(null)}
                        aria-pressed={activeCluster === null}
                        className={`${activeCluster === null ? 'nx-public-primary' : 'nx-public-secondary'} inline-flex min-h-[44px] items-center justify-center px-4 text-sm font-semibold`}
                    >
                        Todos
                    </button>
                    {blogClusters.map(c => {
                        const count = blogPosts.filter(p => p.cluster === c.name).length;
                        if (count === 0) return null;
                        return (
                            <button
                                key={c.slug}
                                type="button"
                                onClick={() => selectCluster(c.name)}
                                aria-pressed={activeCluster === c.name}
                                className={`${activeCluster === c.name ? 'nx-public-primary' : 'nx-public-secondary'} inline-flex min-h-[44px] items-center justify-center px-4 text-sm font-semibold`}
                            >
                                {c.name}
                            </button>
                        );
                    })}
                </div>
            </section>

            {activeCluster && (
                <div className="mt-5">
                    <Link
                        to={`/blog/categoria/${getClusterByName(activeCluster)?.slug ?? ''}`}
                        className="nx-public-link inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold"
                    >
                        Ver el hub completo de {activeCluster}
                        <ArrowRight size={16} aria-hidden="true" />
                    </Link>
                </div>
            )}

            <section aria-label="Artículos" className="mt-8 grid gap-5 md:grid-cols-2">
                {visible.map(post => (
                    <Link
                        key={post.slug}
                        to={`/blog/${post.slug}`}
                        className="nx-public-card group flex min-h-[260px] flex-col p-6 sm:p-7"
                    >
                        <span className="nx-public-badge inline-flex w-fit min-h-[32px] items-center px-3 text-sm font-semibold">
                            {post.category}
                        </span>
                        <h2 className="mt-5 text-xl font-semibold leading-snug tracking-[-0.015em] sm:text-[22px]">
                            {post.title}
                        </h2>
                        <p className="nx-public-muted mt-3 text-[15px] leading-6">
                            {post.description}
                        </p>
                        <div className="mt-auto flex items-center justify-between gap-4 pt-6 text-sm">
                            <span className="nx-public-subtle flex items-center gap-2">
                                <Clock size={15} aria-hidden="true" /> {post.readTime} lectura
                            </span>
                            <span className="nx-public-link flex items-center gap-1 font-semibold">
                                Leer <ArrowRight size={15} aria-hidden="true" />
                            </span>
                        </div>
                    </Link>
                ))}
            </section>

            {/* Paginación */}
            {totalPages > 1 && (
                <nav aria-label="Paginación del blog" className="mt-12 flex flex-wrap items-center justify-center gap-2">
                    <button
                        type="button"
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={safePage === 1}
                        className="nx-public-secondary inline-flex min-h-[44px] items-center justify-center px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Anterior
                    </button>
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => (
                        <button
                            key={n}
                            type="button"
                            onClick={() => setPage(n)}
                            aria-label={`Página ${n}`}
                            aria-current={n === safePage ? 'page' : undefined}
                            className={`${n === safePage ? 'nx-public-primary' : 'nx-public-secondary'} inline-flex min-h-[44px] min-w-[44px] items-center justify-center text-sm font-semibold`}
                        >
                            {n}
                        </button>
                    ))}
                    <button
                        type="button"
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={safePage === totalPages}
                        className="nx-public-secondary inline-flex min-h-[44px] items-center justify-center px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Siguiente
                    </button>
                </nav>
            )}
        </BlogShell>
    );
};

export default Blog;
