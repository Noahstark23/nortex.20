import React, { useEffect } from 'react';
import { Link, useParams, Navigate } from 'react-router-dom';
import { blogPosts } from '../data/blog-posts';
import { getClusterByName } from '../data/blog-clusters';
import { renderMarkdown } from '../utils/markdown';
import {
    buildArticleJsonLd,
    buildBreadcrumbJsonLd,
    buildFaqJsonLd,
    buildHowToJsonLd,
    buildCalculatorAppJsonLd,
} from '../utils/seo';
import Calculator from './Calculator';
import { CALCULADORAS } from '../utils/calculadoras';
import { pickRelatedGuides } from '../utils/related-guides';
import { Clock, Calendar, ChevronRight } from 'lucide-react';
import BlogShell from './blog/BlogShell';

const BlogPost: React.FC = () => {
    const { slug } = useParams<{ slug: string }>();
    const post = blogPosts.find(p => p.slug === slug);
    const cluster = post ? getClusterByName(post.cluster) : undefined;

    useEffect(() => {
        if (!post) return;
        const prevTitle = document.title;
        // Mismo criterio que el prerender: si hay metaTitle manda tal cual.
        document.title = post.metaTitle ?? `${post.title} | Nortex Blog`;

        // JSON-LD: Article + BreadcrumbList + FAQPage (inyectado al montar; el
        // prerender ya lo incluye en el HTML estático para los crawlers).
        const breadcrumb = [
            { name: 'Blog', url: '/blog' },
            ...(cluster ? [{ name: cluster.name, url: `/blog/categoria/${cluster.slug}` }] : []),
            { name: post.title, url: `/blog/${post.slug}` },
        ];
        const blocks = [
            buildArticleJsonLd(post),
            buildBreadcrumbJsonLd(breadcrumb),
            buildFaqJsonLd(post.faq),
            post.howToSteps ? buildHowToJsonLd(post.title, post.howToSteps, post.description) : null,
            post.calculator
                ? buildCalculatorAppJsonLd({
                      slug: post.slug,
                      name: CALCULADORAS[post.calculator].titulo,
                      description: CALCULADORAS[post.calculator].descripcion,
                  })
                : null,
        ].filter((b): b is Record<string, unknown> => b !== null);

        const tag = document.createElement('script');
        tag.type = 'application/ld+json';
        tag.setAttribute('data-blog-jsonld', post.slug);
        tag.textContent = JSON.stringify(blocks);
        document.head.appendChild(tag);

        return () => {
            document.title = prevTitle;
            tag.remove();
        };
    }, [post, cluster]);

    if (!post) return <Navigate to="/blog" replace />;

    // Relacionados: solo los slugs que existen como artículos publicados.
    // Enlazado interno: relacionados curados + relleno automático con hermanos
    // del clúster (Palanca B). Ver utils/related-guides.ts.
    const related = pickRelatedGuides(post, blogPosts, {
        limit: 4,
        relatedSlugs: post.relatedSlugs,
        pillarSlug: cluster?.pillarSlug,
    });

    return (
        <BlogShell width="reading">
            <article>
                {/* Breadcrumb visible */}
                <nav className="nx-public-subtle flex flex-wrap items-center gap-1 text-sm" aria-label="Migas de pan">
                    <Link to="/blog" className="nx-public-link inline-flex min-h-[44px] items-center px-1">Blog</Link>
                    {cluster && (
                        <>
                            <ChevronRight size={14} aria-hidden="true" />
                            <Link to={`/blog/categoria/${cluster.slug}`} className="nx-public-link inline-flex min-h-[44px] items-center px-1">{cluster.name}</Link>
                        </>
                    )}
                    <ChevronRight size={14} aria-hidden="true" />
                    <span aria-current="page" className="nx-public-muted max-w-[220px] truncate">{post.title}</span>
                </nav>

                {cluster ? (
                    <Link
                        to={`/blog/categoria/${cluster.slug}`}
                        className="nx-public-badge mt-4 inline-flex min-h-[36px] items-center px-3 text-sm font-semibold"
                    >
                        {post.category}
                    </Link>
                ) : (
                    <span className="nx-public-badge mt-4 inline-flex min-h-[36px] items-center px-3 text-sm font-semibold">{post.category}</span>
                )}

                <h1 className="mt-5 text-balance text-[36px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[48px]">
                    {post.title}
                </h1>
                <div className="nx-public-subtle mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 border-b pb-7 text-sm">
                    <span className="flex min-h-[32px] items-center gap-2">
                        <Calendar size={15} aria-hidden="true" />
                        <time dateTime={post.updated ?? post.date}>{post.updated ?? post.date}</time>
                    </span>
                    <span className="flex min-h-[32px] items-center gap-2"><Clock size={15} aria-hidden="true" /> {post.readTime} de lectura</span>
                </div>

                {/* Calculadora interactiva (si la guía la declara) — arriba del
                    cuerpo para que quede visible sin scroll y capte conversión. */}
                {post.calculator && (
                    <div className="mt-8">
                        <Calculator type={post.calculator} />
                    </div>
                )}

                <div className="prose-nortex nx-public-reading mt-9">
                    {renderMarkdown(post.content, Link)}
                </div>

                {/* FAQ visible (además del JSON-LD) */}
                {post.faq.length > 0 && (
                    <section aria-labelledby="faq-title" className="mt-14">
                        <h2 id="faq-title" className="text-[28px] font-semibold leading-tight tracking-[-0.02em]">Preguntas frecuentes</h2>
                        <div className="mt-6 space-y-3">
                            {post.faq.map((item, i) => (
                                <details key={i} className="nx-public-surface group rounded-2xl border px-5 py-4">
                                    <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-4 font-semibold leading-6">
                                        {item.q}
                                        <ChevronRight size={18} aria-hidden="true" className="nx-public-subtle shrink-0 transition-transform group-open:rotate-90" />
                                    </summary>
                                    <p className="nx-public-muted mt-3 pb-1 leading-7">{item.a}</p>
                                </details>
                            ))}
                        </div>
                    </section>
                )}

                {/* CTA principal */}
                <aside className="nx-public-surface mt-14 rounded-3xl border p-7 text-center sm:p-10" aria-labelledby="article-cta-title">
                    <h2 id="article-cta-title" className="text-[28px] font-semibold leading-tight tracking-[-0.02em]">¿Cansado de hacer esto a mano?</h2>
                    <p className="nx-public-muted mx-auto mt-3 max-w-xl text-[17px] leading-7">Nortex automatiza nómina, facturas y reportes DGI. Prueba gratis 30 días.</p>
                    <Link to="/register" className="nx-public-primary mt-6 inline-flex min-h-[44px] items-center justify-center gap-2 px-7 text-base font-semibold">
                        Empezar gratis ahora →
                    </Link>
                </aside>

                {/* Artículos relacionados */}
                {related.length > 0 && (
                    <section aria-labelledby="related-title" className="mt-14 border-t pt-9">
                        <h2 id="related-title" className="text-2xl font-semibold tracking-[-0.02em]">Seguí leyendo</h2>
                        <div className="mt-5 grid gap-4 sm:grid-cols-2">
                            {related.map(r => (
                                <Link
                                    key={r.slug}
                                    to={`/blog/${r.slug}`}
                                    className="nx-public-card group flex min-h-[144px] flex-col p-5"
                                >
                                    <span className="nx-public-badge inline-flex w-fit min-h-[28px] items-center px-2.5 text-[13px] font-semibold">{r.category}</span>
                                    <h3 className="mt-3 text-[15px] font-semibold leading-snug">{r.title}</h3>
                                    <span className="nx-public-link mt-auto pt-4 text-sm font-semibold">Leer guía</span>
                                </Link>
                            ))}
                        </div>
                    </section>
                )}
            </article>
        </BlogShell>
    );
};

export default BlogPost;
