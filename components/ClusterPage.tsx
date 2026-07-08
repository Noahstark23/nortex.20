import React, { useEffect } from 'react';
import { Link, useParams, Navigate } from 'react-router-dom';
import { blogPosts } from '../data/blog-posts';
import { clusterBySlug } from '../data/blog-clusters';
import { ArrowLeft, ArrowRight, Clock } from 'lucide-react';

// Hub de clúster: /blog/categoria/:clusterSlug
// Lista los artículos de un clúster, destacando su pilar. Mejora el enlazado
// interno (modelo pillar/cluster) y crea páginas indexables por categoría.
const ClusterPage: React.FC = () => {
  const { clusterSlug } = useParams<{ clusterSlug: string }>();
  const cluster = clusterSlug ? clusterBySlug(clusterSlug) : undefined;

  useEffect(() => {
    if (cluster) document.title = `${cluster.name} | Blog Nortex`;
  }, [cluster]);

  if (!cluster) return <Navigate to="/blog" replace />;

  const posts = blogPosts.filter((p) => p.cluster === cluster.name);
  const pillar = cluster.pillarSlug ? posts.find((p) => p.slug === cluster.pillarSlug) : undefined;
  const rest = posts.filter((p) => p.slug !== pillar?.slug);

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
        <nav aria-label="breadcrumb" className="text-xs text-slate-400 mb-4">
          <Link to="/blog" className="hover:text-slate-600">Blog</Link> <span className="mx-1">/</span>
          <span className="text-slate-600">{cluster.name}</span>
        </nav>
        <h1 className="text-3xl font-bold text-slate-900 mb-3">{cluster.name}</h1>
        <p className="text-slate-500 mb-10 max-w-2xl">{cluster.description}</p>

        {pillar && (
          <Link to={`/blog/${pillar.slug}`}
            className="block bg-slate-900 text-white rounded-2xl p-8 mb-10 hover:bg-slate-800 transition-colors">
            <span className="text-xs font-bold text-emerald-300 uppercase tracking-wide">Guía principal</span>
            <h2 className="text-2xl font-bold mt-2 mb-2">{pillar.title}</h2>
            <p className="text-slate-300 text-sm mb-3">{pillar.description}</p>
            <span className="text-emerald-300 text-sm font-medium inline-flex items-center gap-1">
              Leer la guía <ArrowRight size={14} />
            </span>
          </Link>
        )}

        <div className="grid md:grid-cols-2 gap-6">
          {rest.map((post) => (
            <Link key={post.slug} to={`/blog/${post.slug}`}
              className="block bg-white border border-slate-200 rounded-xl p-6 hover:border-emerald-300 hover:shadow-md transition-all group">
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

        {posts.length === 0 && (
          <p className="text-slate-400 text-sm">Pronto publicaremos artículos en esta categoría.</p>
        )}
      </main>
    </div>
  );
};

export default ClusterPage;
