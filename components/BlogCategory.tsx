import React, { useEffect } from 'react';
import { Link, useParams, Navigate } from 'react-router-dom';
import { getCluster } from '../data/blog-clusters';
import { postsByCluster, getPost } from '../data/blog-posts';
import { ArrowRight, Clock, ChevronRight, Star } from 'lucide-react';

// Hub de clúster: /blog/categoria/:slug
// Agrupa el artículo pilar + los artículos de cola larga del clúster. Concentra
// el enlazado interno y la autoridad temática del grupo (modelo pillar/cluster).
const BlogCategory: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const cluster = getCluster(slug);

  useEffect(() => {
    if (cluster) {
      document.title = cluster.metaTitle;
    }
  }, [cluster]);

  if (!cluster) return <Navigate to="/blog" replace />;

  const posts = postsByCluster(cluster.slug);
  const pillar = cluster.pillarSlug ? getPost(cluster.pillarSlug) : undefined;
  const rest = posts.filter((p) => p.slug !== pillar?.slug);

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
        <nav className="flex items-center gap-1 text-xs text-slate-400 mb-6" aria-label="Migas de pan">
          <Link to="/blog" className="hover:text-slate-600">Blog</Link>
          <ChevronRight size={12} />
          <span className="text-slate-600">{cluster.name}</span>
        </nav>

        <h1 className="text-3xl font-bold text-slate-900 mb-3">{cluster.h1}</h1>
        <p className="text-slate-500 mb-10 max-w-2xl">{cluster.intro}</p>

        {/* Artículo pilar destacado */}
        {pillar && (
          <Link
            to={`/blog/${pillar.slug}`}
            className="block bg-white border-2 border-emerald-200 rounded-2xl p-8 mb-10 hover:border-emerald-400 hover:shadow-lg transition-all group"
          >
            <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full">
              <Star size={12} /> Guía pilar
            </span>
            <h2 className="font-bold text-slate-900 mt-3 mb-2 text-2xl leading-snug group-hover:text-emerald-700 transition-colors">
              {pillar.title}
            </h2>
            <p className="text-slate-500 mb-4 leading-relaxed">{pillar.description}</p>
            <span className="text-emerald-600 font-medium inline-flex items-center gap-1">
              Leer la guía completa <ArrowRight size={14} />
            </span>
          </Link>
        )}

        {rest.length > 0 ? (
          <div className="grid md:grid-cols-2 gap-6">
            {rest.map((post) => (
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
        ) : (
          !pillar && (
            <p className="text-slate-500">
              Pronto publicaremos contenido en esta categoría.{' '}
              <Link to="/blog" className="text-emerald-600 font-medium">Ver todo el blog</Link>
            </p>
          )
        )}
      </main>
    </div>
  );
};

export default BlogCategory;
