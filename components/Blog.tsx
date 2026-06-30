import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { blogPosts } from '../data/blog-posts';
import { blogClusters } from '../data/blog-clusters';
import { ArrowRight, Clock } from 'lucide-react';

const PER_PAGE = 12;

const Blog: React.FC = () => {
  const [active, setActive] = useState<string>('all');
  const [page, setPage] = useState<number>(1);

  // Clústeres que efectivamente tienen artículos, en el orden de la taxonomía.
  const clusters = useMemo(
    () => blogClusters.filter((c) => blogPosts.some((p) => p.cluster === c.name)),
    []
  );

  const filtered = useMemo(() => {
    const list = active === 'all' ? blogPosts : blogPosts.filter((p) => p.cluster === active);
    return [...list].sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [active]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  const selectCluster = (name: string): void => { setActive(name); setPage(1); };

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="bg-white border-b border-slate-200 py-4 px-6">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-slate-900 rounded flex items-center justify-center text-white font-bold">N</div>
            <span className="font-bold text-slate-900">NORTEX</span>
            <span className="text-slate-400 ml-2">/ Blog</span>
          </Link>
          <Link to="/register" className="text-sm font-bold bg-slate-900 text-white px-4 py-2 rounded-lg focus-visible:ring-2 focus-visible:ring-emerald-500">
            Prueba Gratis
          </Link>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold text-slate-900 mb-3">
          Recursos para negocios en Nicaragua
        </h1>
        <p className="text-slate-500 mb-8">
          Guías de inventario, facturación DGI, nómina, impuestos y gestión para PyMES nicaragüenses.
        </p>

        {/* Filtro por clúster temático */}
        <div className="flex flex-wrap gap-2 mb-10" role="group" aria-label="Filtrar por categoría">
          <button
            type="button"
            onClick={() => selectCluster('all')}
            aria-pressed={active === 'all'}
            className={`text-sm font-medium px-4 py-2 rounded-full border transition-colors focus-visible:ring-2 focus-visible:ring-emerald-500 ${active === 'all' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300'}`}
          >
            Todos
          </button>
          {clusters.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => selectCluster(c.name)}
              aria-pressed={active === c.name}
              className={`text-sm font-medium px-4 py-2 rounded-full border transition-colors focus-visible:ring-2 focus-visible:ring-emerald-500 ${active === c.name ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300'}`}
            >
              {c.name}
            </button>
          ))}
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {visible.map((post) => (
            <Link
              key={post.slug}
              to={`/blog/${post.slug}`}
              className="block bg-white border border-slate-200 rounded-xl p-6 hover:border-emerald-300 hover:shadow-md transition-all group focus-visible:ring-2 focus-visible:ring-emerald-500"
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

        {totalPages > 1 && (
          <nav className="flex items-center justify-center gap-2 mt-12" aria-label="Paginación">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage === 1}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-600 disabled:opacity-40 hover:border-emerald-300 focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              Anterior
            </button>
            <span className="text-sm text-slate-500">Página {safePage} de {totalPages}</span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-600 disabled:opacity-40 hover:border-emerald-300 focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              Siguiente
            </button>
          </nav>
        )}
      </main>
    </div>
  );
};

export default Blog;
