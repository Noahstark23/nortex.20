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
    SITE_ORIGIN,
} from '../utils/seo';
import Calculator from './Calculator';
import { ArrowLeft, Clock, Calendar, ChevronRight } from 'lucide-react';

const BlogPost: React.FC = () => {
    const { slug } = useParams<{ slug: string }>();
    const post = blogPosts.find(p => p.slug === slug);
    const cluster = post ? getClusterByName(post.cluster) : undefined;

    useEffect(() => {
        if (!post) return;
        const prevTitle = document.title;
        document.title = `${post.title} | Nortex Blog`;

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
    const related = post.relatedSlugs
        .filter(s => s !== post.slug)
        .map(s => blogPosts.find(p => p.slug === s))
        .filter((p): p is typeof blogPosts[number] => Boolean(p))
        .slice(0, 3);

    return (
        <div className="min-h-screen bg-white">
            <nav className="border-b border-slate-200 py-4 px-6">
                <div className="max-w-3xl mx-auto flex items-center justify-between">
                    <Link to="/blog" className="flex items-center gap-2 text-slate-600 hover:text-slate-900 transition-colors">
                        <ArrowLeft size={16} /> Blog
                    </Link>
                    <Link to="/register" className="text-sm font-bold bg-slate-900 text-white px-4 py-2 rounded-lg">
                        Prueba Nortex Gratis
                    </Link>
                </div>
            </nav>

            <article className="max-w-3xl mx-auto px-6 py-10">
                {/* Breadcrumb visible */}
                <nav className="flex items-center flex-wrap gap-1 text-xs text-slate-400 mb-6" aria-label="Breadcrumb">
                    <Link to="/blog" className="hover:text-slate-600">Blog</Link>
                    {cluster && (
                        <>
                            <ChevronRight size={12} />
                            <Link to={`/blog/categoria/${cluster.slug}`} className="hover:text-slate-600">{cluster.name}</Link>
                        </>
                    )}
                    <ChevronRight size={12} />
                    <span className="text-slate-500 truncate max-w-[200px]">{post.title}</span>
                </nav>

                {cluster ? (
                    <Link
                        to={`/blog/categoria/${cluster.slug}`}
                        className="text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full hover:bg-emerald-100 transition-colors"
                    >
                        {post.category}
                    </Link>
                ) : (
                    <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full">{post.category}</span>
                )}

                <h1 className="text-3xl md:text-4xl font-extrabold text-slate-900 mt-4 mb-4 leading-tight">
                    {post.title}
                </h1>
                <div className="flex items-center gap-6 text-sm text-slate-400 mb-8 pb-6 border-b border-slate-100">
                    <span className="flex items-center gap-1"><Calendar size={14} /> {post.updated ?? post.date}</span>
                    <span className="flex items-center gap-1"><Clock size={14} /> {post.readTime} de lectura</span>
                </div>

                {/* Calculadora interactiva (si la guía la declara) — arriba del
                    cuerpo para que quede visible sin scroll y capte conversión. */}
                {post.calculator && <Calculator type={post.calculator} />}

                <div className="prose-nortex">
                    {renderMarkdown(post.content, Link)}
                </div>

                {/* FAQ visible (además del JSON-LD) */}
                {post.faq.length > 0 && (
                    <section className="mt-12">
                        <h2 className="text-2xl font-bold text-slate-900 mb-5">Preguntas frecuentes</h2>
                        <div className="space-y-3">
                            {post.faq.map((item, i) => (
                                <details key={i} className="group border border-slate-200 rounded-xl p-4 open:bg-slate-50">
                                    <summary className="font-semibold text-slate-800 cursor-pointer list-none flex items-center justify-between">
                                        {item.q}
                                        <ChevronRight size={16} className="text-slate-400 group-open:rotate-90 transition-transform" />
                                    </summary>
                                    <p className="text-slate-600 mt-3 leading-relaxed">{item.a}</p>
                                </details>
                            ))}
                        </div>
                    </section>
                )}

                {/* CTA principal */}
                <div className="mt-12 p-8 bg-slate-900 rounded-2xl text-white text-center">
                    <h2 className="text-2xl font-bold mb-3">¿Cansado de hacer esto a mano?</h2>
                    <p className="text-slate-300 mb-6">Nortex automatiza nómina, facturas y reportes DGI. Prueba gratis 30 días.</p>
                    <Link to="/register" className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-white font-bold px-8 py-3 rounded-xl transition-colors">
                        Empezar gratis ahora →
                    </Link>
                </div>

                {/* Artículos relacionados */}
                {related.length > 0 && (
                    <section className="mt-12 pt-8 border-t border-slate-100">
                        <h2 className="text-lg font-bold text-slate-900 mb-4">Seguí leyendo</h2>
                        <div className="grid sm:grid-cols-2 gap-4">
                            {related.map(r => (
                                <Link
                                    key={r.slug}
                                    to={`/blog/${r.slug}`}
                                    className="block border border-slate-200 rounded-xl p-4 hover:border-emerald-300 hover:shadow-sm transition-all group"
                                >
                                    <span className="text-[11px] font-bold text-emerald-700">{r.category}</span>
                                    <h3 className="font-semibold text-slate-800 text-sm mt-1 leading-snug group-hover:text-emerald-700 transition-colors">{r.title}</h3>
                                </Link>
                            ))}
                        </div>
                    </section>
                )}
            </article>

            <footer className="max-w-3xl mx-auto px-6 pb-12 text-center text-xs text-slate-400">
                <a href={`${SITE_ORIGIN}/blog`} className="hover:text-slate-600">Nortex Blog · Recursos para PyMES de Nicaragua</a>
            </footer>
        </div>
    );
};

export default BlogPost;
