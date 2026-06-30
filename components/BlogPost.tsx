import React, { useEffect, useMemo } from 'react';
import { Link, useParams, Navigate } from 'react-router-dom';
import { blogPosts } from '../data/blog-posts';
import { clusterByName } from '../data/blog-clusters';
import { mdToHtml } from '../utils/markdown';
import { articleJsonLd, breadcrumbJsonLd, faqJsonLd, type JsonLd } from '../utils/seo';
import { ArrowLeft, ArrowRight, Clock, Calendar } from 'lucide-react';

const ORIGIN = 'https://somosnortex.com';

const PROSE_CSS = `
.prose-nortex h2{font-size:1.5rem;font-weight:700;color:#0f172a;margin:2rem 0 1rem}
.prose-nortex h3{font-size:1.2rem;font-weight:700;color:#1e293b;margin:1.5rem 0 .75rem}
.prose-nortex p{color:#475569;line-height:1.75;margin:0 0 1rem}
.prose-nortex ul,.prose-nortex ol{margin:0 0 1rem 1.25rem;color:#475569;line-height:1.75}
.prose-nortex li{margin:.25rem 0}
.prose-nortex strong{color:#0f172a}
.prose-nortex a{color:#059669;text-decoration:underline}
.prose-nortex a.nx-cta{display:inline-block;margin:1rem 0;background:#059669;color:#fff;font-weight:700;padding:.75rem 1.5rem;border-radius:.5rem;text-decoration:none}
.prose-nortex table{width:100%;border-collapse:collapse;margin:1rem 0;font-size:.95rem}
.prose-nortex th,.prose-nortex td{border:1px solid #e2e8f0;padding:.5rem .75rem;text-align:left}
.prose-nortex th{background:#f1f5f9;color:#0f172a;font-weight:700}
.prose-nortex blockquote{border-left:4px solid #10b981;padding-left:1rem;color:#475569;font-style:italic;margin:1rem 0}
.prose-nortex code{background:#f1f5f9;padding:.1rem .35rem;border-radius:.25rem;font-size:.9em}
.prose-nortex hr{border:0;border-top:1px solid #e2e8f0;margin:2rem 0}
`;

const BlogPost: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const post = blogPosts.find((p) => p.slug === slug);

  useEffect(() => {
    if (!post) return;
    document.title = `${post.title} | Nortex Blog`;
    const setMeta = (selector: string, attr: string, value: string): void => {
      const el = document.querySelector(selector);
      if (el) el.setAttribute(attr, value);
    };
    setMeta('meta[name="description"]', 'content', post.description);
    setMeta('link[rel="canonical"]', 'href', `${ORIGIN}/blog/${post.slug}`);
  }, [post]);

  const related = useMemo(() => {
    if (!post) return [];
    const bySlug = (post.relatedSlugs ?? [])
      .map((s) => blogPosts.find((p) => p.slug === s))
      .filter((p): p is NonNullable<typeof p> => Boolean(p) && p!.slug !== post.slug);
    if (bySlug.length >= 3) return bySlug.slice(0, 3);
    const sameCluster = blogPosts.filter(
      (p) => p.cluster && p.cluster === post.cluster && p.slug !== post.slug && !bySlug.includes(p)
    );
    return [...bySlug, ...sameCluster].slice(0, 3);
  }, [post]);

  if (!post) return <Navigate to="/blog" replace />;

  const cluster = post.cluster ? clusterByName(post.cluster) : undefined;
  const crumbs = [
    { name: 'Inicio', url: '/' },
    { name: 'Blog', url: '/blog' },
    ...(cluster ? [{ name: cluster.name, url: `/blog/categoria/${cluster.slug}` }] : []),
    { name: post.title, url: `/blog/${post.slug}` },
  ];
  const jsonLd: JsonLd[] = [
    articleJsonLd(post, ORIGIN),
    breadcrumbJsonLd(crumbs, ORIGIN),
    ...(post.faq && post.faq.length ? [faqJsonLd(post.faq)] : []),
  ];

  return (
    <div className="min-h-screen bg-white">
      <style dangerouslySetInnerHTML={{ __html: PROSE_CSS }} />
      {jsonLd.map((ld, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      ))}

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
        <nav aria-label="breadcrumb" className="text-xs text-slate-400 mb-4">
          {crumbs.slice(0, -1).map((c) => (
            <span key={c.url}>
              <Link to={c.url} className="hover:text-slate-600">{c.name}</Link>
              <span className="mx-1">/</span>
            </span>
          ))}
          <span className="text-slate-600">{post.category}</span>
        </nav>

        <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full">
          {post.category}
        </span>
        <h1 className="text-3xl md:text-4xl font-extrabold text-slate-900 mt-4 mb-4 leading-tight">
          {post.title}
        </h1>
        <div className="flex items-center gap-6 text-sm text-slate-400 mb-10 pb-6 border-b border-slate-100">
          <span className="flex items-center gap-1"><Calendar size={14} /> {post.updated ?? post.date}</span>
          <span className="flex items-center gap-1"><Clock size={14} /> {post.readTime} de lectura</span>
        </div>

        <div className="prose-nortex" dangerouslySetInnerHTML={{ __html: mdToHtml(post.content) }} />

        {post.faq && post.faq.length > 0 && (
          <section className="mt-12">
            <h2 className="text-2xl font-bold text-slate-900 mb-4">Preguntas frecuentes</h2>
            <div className="space-y-4">
              {post.faq.map((f, i) => (
                <details key={i} className="bg-slate-50 rounded-lg p-4">
                  <summary className="font-bold text-slate-800 cursor-pointer">{f.q}</summary>
                  <p className="text-slate-600 mt-2 leading-relaxed">{f.a}</p>
                </details>
              ))}
            </div>
          </section>
        )}

        <div className="mt-12 p-8 bg-slate-900 rounded-2xl text-white text-center">
          <h2 className="text-2xl font-bold mb-3">¿Cansado de hacer esto a mano?</h2>
          <p className="text-slate-300 mb-6">Nortex automatiza nómina, facturas y reportes DGI. Prueba gratis 30 días.</p>
          <Link to="/register" className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-white font-bold px-8 py-3 rounded-xl transition-colors">
            Empezar gratis ahora →
          </Link>
        </div>

        {related.length > 0 && (
          <section className="mt-12">
            <h2 className="text-xl font-bold text-slate-900 mb-4">Seguí leyendo</h2>
            <div className="grid sm:grid-cols-3 gap-4">
              {related.map((r) => (
                <Link key={r.slug} to={`/blog/${r.slug}`}
                  className="block bg-white border border-slate-200 rounded-xl p-4 hover:border-emerald-300 hover:shadow-md transition-all group">
                  <span className="text-[11px] font-bold text-emerald-700">{r.category}</span>
                  <h3 className="font-bold text-slate-800 text-sm mt-1 mb-2 leading-snug group-hover:text-emerald-700">{r.title}</h3>
                  <span className="text-emerald-600 text-xs font-medium flex items-center gap-1">Leer <ArrowRight size={11} /></span>
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
