import React, { useEffect } from 'react';
import { Link, useParams, Navigate } from 'react-router-dom';
import { blogPosts } from '../data/blog-posts';
import {
  getCluster,
  clusterName,
  getRelated,
  articleJsonLd,
  breadcrumbJsonLd,
  faqJsonLd,
} from '../data/blog-taxonomy';
import { markdownToHtml } from '../lib/markdown';
import { ArrowLeft, ArrowRight, Clock, Calendar } from 'lucide-react';

const BlogPost: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const post = blogPosts.find(p => p.slug === slug);
  const cluster = post ? getCluster(post.cluster) : undefined;
  const related = post ? getRelated(post) : [];

  useEffect(() => {
    if (!post) return;
    document.title = `${post.title} | Nortex Blog`;

    // Datos estructurados: Article + BreadcrumbList (+ FAQPage si hay FAQs).
    // El prerender ya inyecta lo mismo en el HTML estático para crawlers; esto
    // cubre la navegación en cliente (SPA) sin duplicar al volver a montar.
    const blocks: Record<string, unknown>[] = [
      articleJsonLd(post),
      breadcrumbJsonLd([
        { name: 'Blog', path: '/blog' },
        ...(cluster ? [{ name: cluster.name, path: `/blog/categoria/${cluster.slug}` }] : []),
        { name: post.title, path: `/blog/${post.slug}` },
      ]),
    ];
    const faq = faqJsonLd(post.faqs);
    if (faq) blocks.push(faq);

    const nodes = blocks.map(block => {
      const el = document.createElement('script');
      el.type = 'application/ld+json';
      el.dataset.blogJsonld = 'post';
      el.text = JSON.stringify(block);
      document.head.appendChild(el);
      return el;
    });
    return () => { nodes.forEach(n => n.remove()); };
  }, [post, cluster]);

  if (!post) return <Navigate to="/blog" replace />;

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
        {/* Migas de pan */}
        <nav className="text-sm text-slate-400 mb-4" aria-label="Migas de pan">
          <Link to="/blog" className="hover:text-emerald-700">Blog</Link>
          {cluster && (
            <>
              <span className="mx-2">/</span>
              <Link to={`/blog/categoria/${cluster.slug}`} className="hover:text-emerald-700">{cluster.name}</Link>
            </>
          )}
        </nav>

        {cluster ? (
          <Link
            to={`/blog/categoria/${cluster.slug}`}
            className="text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full hover:bg-emerald-100 transition-colors"
          >
            {cluster.name}
          </Link>
        ) : (
          <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full">
            {clusterName(post)}
          </span>
        )}

        <h1 className="text-3xl md:text-4xl font-extrabold text-slate-900 mt-4 mb-4 leading-tight">
          {post.title}
        </h1>
        <div className="flex items-center gap-6 text-sm text-slate-400 mb-10 pb-6 border-b border-slate-100">
          <span className="flex items-center gap-1"><Calendar size={14} /> {post.date}</span>
          <span className="flex items-center gap-1"><Clock size={14} /> {post.readTime} de lectura</span>
        </div>

        {/* Cuerpo: renderer Markdown único (lib/markdown.ts). El contenido es
            first-party (data/blog-posts.ts), no entrada de usuario. */}
        <div
          className="prose-nortex"
          dangerouslySetInnerHTML={{ __html: markdownToHtml(post.content) }}
        />

        {/* Bloque FAQ (también emitido como FAQPage en JSON-LD) */}
        {post.faqs && post.faqs.length > 0 && (
          <section className="mt-12 pt-8 border-t border-slate-100">
            <h2 className="text-2xl font-bold text-slate-900 mb-6">Preguntas frecuentes</h2>
            <div className="space-y-4">
              {post.faqs.map((faq, idx) => (
                <details key={idx} className="group bg-slate-50 rounded-xl p-5 border border-slate-100">
                  <summary className="font-bold text-slate-800 cursor-pointer list-none flex items-center justify-between">
                    {faq.q}
                    <span className="text-emerald-600 group-open:rotate-45 transition-transform text-xl leading-none">+</span>
                  </summary>
                  <p className="text-slate-600 mt-3 leading-relaxed">{faq.a}</p>
                </details>
              ))}
            </div>
          </section>
        )}

        {/* CTA */}
        <div className="mt-12 p-8 bg-slate-900 rounded-2xl text-white text-center">
          <h2 className="text-2xl font-bold mb-3">¿Cansado de hacer esto a mano?</h2>
          <p className="text-slate-300 mb-6">Nortex automatiza nómina, facturas y reportes DGI. Prueba gratis 30 días.</p>
          <Link to="/register" className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-white font-bold px-8 py-3 rounded-xl transition-colors">
            Empezar gratis ahora →
          </Link>
        </div>

        {/* Artículos relacionados (enlazado interno, sin huérfanos) */}
        {related.length > 0 && (
          <section className="mt-12 pt-8 border-t border-slate-100">
            <h2 className="text-xl font-bold text-slate-900 mb-6">Seguí leyendo</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {related.map(r => (
                <Link
                  key={r.slug}
                  to={`/blog/${r.slug}`}
                  className="block bg-white border border-slate-200 rounded-xl p-5 hover:border-emerald-300 hover:shadow-md transition-all group"
                >
                  <span className="text-[11px] font-bold text-emerald-700">{clusterName(r)}</span>
                  <h3 className="font-bold text-slate-900 mt-1 mb-1 leading-snug group-hover:text-emerald-700 transition-colors">
                    {r.title}
                  </h3>
                  <span className="text-emerald-600 font-medium text-xs flex items-center gap-1 mt-2">
                    Leer <ArrowRight size={12} />
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </article>
    </div>
  );
};

export default BlogPost;
