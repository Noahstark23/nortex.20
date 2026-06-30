import React, { useEffect, useMemo } from 'react';
import { Link, useParams, Navigate } from 'react-router-dom';
import { blogPosts } from '../data/blog-posts';
import { getClusterBySlug } from '../data/blog-clusters';
import { buildBreadcrumbJsonLd } from '../utils/seo';
import { ArrowRight, ChevronRight, Clock, Star } from 'lucide-react';

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
        <div className="min-h-screen bg-slate-50">
            <nav className="bg-white border-b border-slate-200 py-4 px-6">
                <div className="max-w-5xl mx-auto flex items-center justify-between">
                    <Link to="/blog" className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-slate-900 rounded flex items-center justify-center text-white font-bold">N</div>
                        <span className="font-bold text-slate-900">NORTEX</span>
                        <span className="text-slate-400 ml-2">/ Blog</span>
                    </Link>
                    <Link to="/register" className="text-sm font-bold bg-slate-900 text-white px-4 py-2 rounded-lg">
                        Prueba Gratis
                    </Link>
                </div>
            </nav>

            <main className="max-w-5xl mx-auto px-6 py-12">
                <nav className="flex items-center gap-1 text-xs text-slate-400 mb-6" aria-label="Breadcrumb">
                    <Link to="/blog" className="hover:text-slate-600">Blog</Link>
                    <ChevronRight size={12} />
                    <span className="text-slate-500">{cluster.name}</span>
                </nav>

                <div className="flex items-center gap-3 mb-3">
                    <span className="text-3xl">{cluster.emoji}</span>
                    <h1 className="text-3xl font-bold text-slate-900">{cluster.name}</h1>
                </div>
                <p className="text-slate-500 mb-10 max-w-2xl">{cluster.description}</p>

                {/* Pilar destacado */}
                {pillar && (
                    <Link
                        to={`/blog/${pillar.slug}`}
                        className="block bg-slate-900 text-white rounded-2xl p-8 mb-10 hover:bg-slate-800 transition-colors group"
                    >
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-400 mb-3">
                            <Star size={12} /> Guía principal
                        </span>
                        <h2 className="text-2xl font-bold mb-2 group-hover:text-emerald-300 transition-colors">{pillar.title}</h2>
                        <p className="text-slate-300 text-sm mb-4">{pillar.description}</p>
                        <span className="text-emerald-400 font-medium text-sm flex items-center gap-1">
                            Leer la guía <ArrowRight size={14} />
                        </span>
                    </Link>
                )}

                {/* Artículos de soporte */}
                {supporting.length > 0 ? (
                    <div className="grid md:grid-cols-2 gap-6">
                        {supporting.map(post => (
                            <Link
                                key={post.slug}
                                to={`/blog/${post.slug}`}
                                className="block bg-white border border-slate-200 rounded-xl p-6 hover:border-emerald-300 hover:shadow-md transition-all group"
                            >
                                <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full">{post.category}</span>
                                <h3 className="font-bold text-slate-900 mt-3 mb-2 text-lg leading-snug group-hover:text-emerald-700 transition-colors">{post.title}</h3>
                                <p className="text-slate-500 text-sm mb-4 leading-relaxed">{post.description}</p>
                                <div className="flex items-center justify-between text-xs text-slate-400">
                                    <span className="flex items-center gap-1"><Clock size={12} /> {post.readTime} lectura</span>
                                    <span className="text-emerald-600 font-medium flex items-center gap-1">Leer <ArrowRight size={12} /></span>
                                </div>
                            </Link>
                        ))}
                    </div>
                ) : (
                    <p className="text-slate-400 text-sm">Más artículos de este tema vienen en camino.</p>
                )}

                <div className="mt-12">
                    <Link to="/blog" className="text-sm font-medium text-emerald-700 hover:text-emerald-600">← Volver a todos los temas</Link>
                </div>
            </main>
        </div>
    );
};

export default ClusterPage;
