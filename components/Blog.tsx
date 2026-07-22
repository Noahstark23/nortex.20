import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { blogPosts } from '../data/blog-posts';
import { blogClusters, getClusterByName } from '../data/blog-clusters';
import { ArrowRight, Clock } from 'lucide-react';

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
        <div className="min-h-screen bg-slate-50">
            <nav className="bg-white border-b border-slate-200 py-4 px-6">
                <div className="max-w-5xl mx-auto flex items-center justify-between">
                    <Link to="/" className="flex items-center gap-2">
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
                <h1 className="text-3xl font-bold text-slate-900 mb-3">
                    Recursos para negocios en Nicaragua
                </h1>
                <p className="text-slate-500 mb-8">
                    Guías de nómina, facturación DGI, impuestos, inventario y gestión de negocios para PyMES nicaragüenses.
                </p>

                {/* Chips de clúster */}
                <div className="flex flex-wrap gap-2 mb-10">
                    <button
                        onClick={() => selectCluster(null)}
                        className={`text-xs font-bold px-3 py-1.5 rounded-full border transition-colors ${activeCluster === null ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}
                    >
                        Todos
                    </button>
                    {blogClusters.map(c => {
                        const count = blogPosts.filter(p => p.cluster === c.name).length;
                        if (count === 0) return null;
                        return (
                            <button
                                key={c.slug}
                                onClick={() => selectCluster(c.name)}
                                className={`text-xs font-bold px-3 py-1.5 rounded-full border transition-colors ${activeCluster === c.name ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300'}`}
                            >
                                {c.emoji} {c.name}
                            </button>
                        );
                    })}
                </div>

                {activeCluster && (
                    <div className="mb-6">
                        <Link
                            to={`/blog/categoria/${getClusterByName(activeCluster)?.slug ?? ''}`}
                            className="text-sm font-medium text-emerald-700 hover:text-emerald-600"
                        >
                            Ver el hub completo de {activeCluster} →
                        </Link>
                    </div>
                )}

                <div className="grid md:grid-cols-2 gap-6">
                    {visible.map(post => (
                        <Link
                            key={post.slug}
                            to={`/blog/${post.slug}`}
                            className="block bg-white border border-slate-200 rounded-xl p-6 hover:border-emerald-300 hover:shadow-md transition-all group"
                        >
                            <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full">
                                {post.category}
                            </span>
                            <h2 className="font-bold text-slate-900 mt-3 mb-2 text-lg leading-snug group-hover:text-emerald-700 transition-colors">
                                {post.title}
                            </h2>
                            <p className="text-slate-500 text-sm mb-4 leading-relaxed">
                                {post.description}
                            </p>
                            <div className="flex items-center justify-between text-xs text-slate-400">
                                <span className="flex items-center gap-1">
                                    <Clock size={12} /> {post.readTime} lectura
                                </span>
                                <span className="text-emerald-600 font-medium flex items-center gap-1">
                                    Leer <ArrowRight size={12} />
                                </span>
                            </div>
                        </Link>
                    ))}
                </div>

                {/* Paginación */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-center gap-2 mt-12">
                        <button
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            disabled={safePage === 1}
                            className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-600 disabled:opacity-40 hover:border-slate-400 transition-colors"
                        >
                            Anterior
                        </button>
                        {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => (
                            <button
                                key={n}
                                onClick={() => setPage(n)}
                                className={`w-9 h-9 text-sm font-medium rounded-lg border transition-colors ${n === safePage ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}
                            >
                                {n}
                            </button>
                        ))}
                        <button
                            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                            disabled={safePage === totalPages}
                            className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-600 disabled:opacity-40 hover:border-slate-400 transition-colors"
                        >
                            Siguiente
                        </button>
                    </div>
                )}
            </main>
        </div>
    );
};

export default Blog;
