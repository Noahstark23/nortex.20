import React, { useEffect } from 'react';
import { Link, useParams, Navigate } from 'react-router-dom';
import { getCluster, postsByCluster, getPillar, breadcrumbJsonLd } from '../data/blog-taxonomy';
import { ArrowLeft, ArrowRight, Clock, Star } from 'lucide-react';

// Hub de categoría (clúster): /blog/categoria/:slug
// Agrupa el artículo pilar + los artículos de cola larga del clúster. Concentra
// el enlazado interno del tema y le da a Google una página "índice" del clúster.
const BlogHub: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const cluster = getCluster(slug);
  const posts = cluster ? postsByCluster(cluster.slug) : [];
  const pillar = cluster ? getPillar(cluster.slug) : undefined;

  useEffect(() => {
    if (!cluster) return;
    document.title = `${cluster.name} | Blog Nortex`;

    // Datos estructurados de migas de pan para el hub.
    const ld = document.createElement('script');
    ld.type = 'application/ld+json';
    ld.dataset.blogJsonld = 'hub';
    ld.text = JSON.stringify(
      breadcrumbJsonLd([
        { name: 'Blog', path: '/blog' },
        { name: cluster.name, path: `/blog/categoria/${cluster.slug}` },
      ]),
    );
    document.head.appendChild(ld);
    return () => { ld.remove(); };
  }, [cluster]);

  // Clúster inexistente → al índice del blog.
  if (!cluster) return <Navigate to="/blog" replace />;

  // Los artículos de la lista excluyen el pilar (ya va destacado arriba).
  const rest = posts.filter(p => p.slug !== pillar?.slug);

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="bg-white border-b border-slate-200 py-4 px-6">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link to="/blog" className="flex items-center gap-2 text-slate-600 hover:text-slate-900 transition-colors">
            <ArrowLeft size={16} /> Blog
          </Link>
          <Link to="/register" className="text-sm font-bold bg-slate-900 text-white px-4 py-2 rounded-lg">
            Prueba Gratis
          </Link>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-12">
        {/* Migas de pan */}
        <nav className="text-sm text-slate-400 mb-6" aria-label="Migas de pan">
          <Link to="/blog" className="hover:text-emerald-700">Blog</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-600 font-medium">{cluster.name}</span>
        </nav>

        <h1 className="text-3xl font-bold text-slate-900 mb-3">{cluster.name}</h1>
        <p className="text-slate-500 mb-10 max-w-2xl">{cluster.description}</p>

        {posts.length === 0 && (
          <div className="bg-white border border-dashed border-slate-300 rounded-xl p-10 text-center text-slate-500">
            Pronto publicaremos artículos sobre <strong>{cluster.name}</strong>.{' '}
            <Link to="/blog" className="text-emerald-700 font-semibold">Ver otros temas →</Link>
          </div>
        )}

        {/* Artículo pilar destacado */}
        {pillar && (
          <Link
            to={`/blog/${pillar.slug}`}
            className="block bg-slate-900 text-white rounded-2xl p-8 mb-10 hover:bg-slate-800 transition-colors group"
          >
            <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-300 bg-emerald-500/10 px-3 py-1 rounded-full">
              <Star size={12} /> Guía principal
            </span>
            <h2 className="text-2xl font-bold mt-4 mb-2 leading-snug group-hover:text-emerald-300 transition-colors">
              {pillar.title}
            </h2>
            <p className="text-slate-300 text-sm mb-4 leading-relaxed max-w-2xl">{pillar.description}</p>
            <span className="text-emerald-400 font-medium text-sm flex items-center gap-1">
              Leer la guía completa <ArrowRight size={14} />
            </span>
          </Link>
        )}

        {/* Resto de artículos del clúster */}
        {rest.length > 0 && (
          <div className="grid md:grid-cols-2 gap-6">
            {rest.map(post => (
              <Link
                key={post.slug}
                to={`/blog/${post.slug}`}
                className="block bg-white border border-slate-200 rounded-xl p-6 hover:border-emerald-300 hover:shadow-md transition-all group"
              >
                <h3 className="font-bold text-slate-900 mb-2 text-lg leading-snug group-hover:text-emerald-700 transition-colors">
                  {post.title}
                </h3>
                <p className="text-slate-500 text-sm mb-4 leading-relaxed">{post.description}</p>
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
        )}
      </main>
    </div>
  );
};

export default BlogHub;
