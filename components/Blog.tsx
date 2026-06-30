import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { postsByDate } from '../data/blog-posts';
import { orderedClusters } from '../data/blog-clusters';
import { ArrowRight, Clock, ChevronLeft, ChevronRight } from 'lucide-react';

const PAGE_SIZE = 12;

const Blog: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const clusters = orderedClusters();
  const posts = postsByDate();

  const totalPages = Math.max(1, Math.ceil(posts.length / PAGE_SIZE));
  const requested = parseInt(params.get('page') || '1', 10);
  const page = Number.isNaN(requested) ? 1 : Math.min(Math.max(requested, 1), totalPages);
  const start = (page - 1) * PAGE_SIZE;
  const pagePosts = posts.slice(start, start + PAGE_SIZE);

  const goToPage = (n: number) => {
    if (n <= 1) {
      params.delete('page');
    } else {
      params.set('page', String(n));
    }
    setParams(params);
    window.scrollTo({ top: 0 });
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
        <p className="text-slate-500 mb-10">
          Guías de nómina, facturación DGI, impuestos y gestión de negocios para PyMES nicaragüenses.
        </p>

        {/* Explorá por tema (hubs de clúster) */}
        <section className="mb-12">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-400 mb-4">
            Explorá por tema
          </h2>
          <div className="flex flex-wrap gap-2">
            {clusters.map((c) => (
              <Link
                key={c.slug}
                to={`/blog/categoria/${c.slug}`}
                className="text-sm font-medium text-slate-700 bg-white border border-slate-200 px-4 py-2 rounded-full hover:border-emerald-300 hover:text-emerald-700 transition-colors"
              >
                {c.name}
              </Link>
            ))}
          </div>
        </section>

        {/* Listado paginado de artículos */}
        <div className="grid md:grid-cols-2 gap-6">
          {pagePosts.map((post) => (
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
          <nav className="flex items-center justify-center gap-2 mt-12" aria-label="Paginación">
            <button
              onClick={() => goToPage(page - 1)}
              disabled={page === 1}
              className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-slate-600 rounded-lg border border-slate-200 bg-white disabled:opacity-40 disabled:cursor-not-allowed hover:border-emerald-300"
            >
              <ChevronLeft size={14} /> Anterior
            </button>
            <span className="text-sm text-slate-500 px-2">
              Página {page} de {totalPages}
            </span>
            <button
              onClick={() => goToPage(page + 1)}
              disabled={page === totalPages}
              className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-slate-600 rounded-lg border border-slate-200 bg-white disabled:opacity-40 disabled:cursor-not-allowed hover:border-emerald-300"
            >
              Siguiente <ChevronRight size={14} />
            </button>
          </nav>
        )}
      </main>
    </div>
  );
};

export default Blog;
