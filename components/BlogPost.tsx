import React, { useEffect } from 'react';
import { Link, useParams, Navigate } from 'react-router-dom';
import { blogPosts } from '../data/blog-posts';
import { ArrowLeft, Clock, Calendar } from 'lucide-react';

const BlogPost: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const post = blogPosts.find(p => p.slug === slug);

  useEffect(() => {
    if (post) {
      document.title = `${post.title} | Nortex Blog`;
    }
  }, [post]);

  if (!post) return <Navigate to="/blog" replace />;

  const renderContent = (content: string) => {
    return content
      .split('\n')
      .map((line, i) => {
        if (line.startsWith('## ')) return <h2 key={i} className="text-2xl font-bold text-slate-900 mt-8 mb-4">{line.slice(3)}</h2>;
        if (line.startsWith('### ')) return <h3 key={i} className="text-xl font-bold text-slate-800 mt-6 mb-3">{line.slice(4)}</h3>;
        if (line.startsWith('**') && line.endsWith('**')) return <p key={i} className="font-bold text-slate-800 mb-2">{line.slice(2, -2)}</p>;
        if (line.startsWith('- ')) return <li key={i} className="ml-6 text-slate-600 mb-1 list-disc">{line.slice(2)}</li>;
        if (line.startsWith('[') && line.includes('→](/')) {
          const text = line.match(/\[(.+)\]/)?.[1];
          const href = line.match(/\(([^)]+)\)/)?.[1];
          return href ? <div key={i} className="my-6"><Link to={href} className="inline-flex items-center gap-2 bg-emerald-600 text-white font-bold px-6 py-3 rounded-lg hover:bg-emerald-500 transition-colors">{text}</Link></div> : null;
        }
        if (line.trim() === '') return <br key={i} />;
        return <p key={i} className="text-slate-600 mb-4 leading-relaxed">{line}</p>;
      });
  };

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

      <article className="max-w-3xl mx-auto px-6 py-12">
        <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full">
          {post.category}
        </span>
        <h1 className="text-3xl md:text-4xl font-extrabold text-slate-900 mt-4 mb-4 leading-tight">
          {post.title}
        </h1>
        <div className="flex items-center gap-6 text-sm text-slate-400 mb-10 pb-6 border-b border-slate-100">
          <span className="flex items-center gap-1"><Calendar size={14} /> {post.date}</span>
          <span className="flex items-center gap-1"><Clock size={14} /> {post.readTime} de lectura</span>
        </div>

        <div className="prose-nortex">
          {renderContent(post.content)}
        </div>

        <div className="mt-12 p-8 bg-slate-900 rounded-2xl text-white text-center">
          <h2 className="text-2xl font-bold mb-3">¿Cansado de hacer esto a mano?</h2>
          <p className="text-slate-300 mb-6">Nortex automatiza nómina, facturas y reportes DGI. Prueba gratis 30 días.</p>
          <Link to="/register" className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-white font-bold px-8 py-3 rounded-xl transition-colors">
            Empezar gratis ahora →
          </Link>
        </div>
      </article>
    </div>
  );
};

export default BlogPost;
