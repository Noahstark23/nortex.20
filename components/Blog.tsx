import React from 'react';
import { Link } from 'react-router-dom';
import { blogPosts } from '../data/blog-posts';
import { ArrowRight, Clock } from 'lucide-react';

const Blog: React.FC = () => {
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

        <div className="grid md:grid-cols-2 gap-6">
          {blogPosts.map(post => (
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
      </main>
    </div>
  );
};

export default Blog;
