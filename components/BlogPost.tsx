import React, { useEffect, useMemo, useRef } from 'react';
import { Link, useParams, useNavigate, Navigate } from 'react-router-dom';
import { getPost, relatedPosts } from '../data/blog-posts';
import { getCluster } from '../data/blog-clusters';
import { markdownToHtml } from '../utils/markdown';
import { postJsonLdBlocks } from '../utils/seo';
import { ArrowLeft, Clock, Calendar, ChevronRight } from 'lucide-react';

const BlogPost: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const post = getPost(slug);
  const cluster = getCluster(post?.cluster);
  const related = useMemo(() => (post ? relatedPosts(post) : []), [post]);
  const contentRef = useRef<HTMLDivElement>(null);

  const html = useMemo(() => (post ? markdownToHtml(post.content) : ''), [post]);

  useEffect(() => {
    if (post) {
      document.title = `${post.title} | Nortex Blog`;
    }
  }, [post]);

  // JSON-LD (Article + Breadcrumb + FAQPage) inyectado en runtime. El prerender
  // ya lo deja en el HTML estático; esto cubre la navegación dentro de la SPA.
  useEffect(() => {
    if (!post || !cluster) return;
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.dataset.blogJsonld = 'true';
    script.textContent = JSON.stringify(
      postJsonLdBlocks(post, cluster.name, cluster.slug),
    );
    document.head.appendChild(script);
    return () => {
      script.remove();
    };
  }, [post, cluster]);

  // Los enlaces internos del contenido (renderizado como HTML) hacen navegación
  // SPA en lugar de recargar toda la página.
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement)?.closest('a');
      if (!target) return;
      const href = target.getAttribute('href') || '';
      if (href.startsWith('/') && !href.startsWith('//')) {
        e.preventDefault();
        navigate(href);
      }
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, [html, navigate]);

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
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1 text-xs text-slate-400 mb-6" aria-label="Migas de pan">
          <Link to="/blog" className="hover:text-slate-600">Blog</Link>
          {cluster && (
            <>
              <ChevronRight size={12} />
              <Link to={`/blog/categoria/${cluster.slug}`} className="hover:text-slate-600">
                {cluster.name}
              </Link>
            </>
          )}
        </nav>

        {cluster ? (
          <Link
            to={`/blog/categoria/${cluster.slug}`}
            className="text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full hover:bg-emerald-100 transition-colors"
          >
            {post.category}
          </Link>
        ) : (
          <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full">
            {post.category}
          </span>
        )}

        <h1 className="text-3xl md:text-4xl font-extrabold text-slate-900 mt-4 mb-4 leading-tight">
          {post.title}
        </h1>
        <div className="flex items-center gap-6 text-sm text-slate-400 mb-10 pb-6 border-b border-slate-100">
          <span className="flex items-center gap-1"><Calendar size={14} /> {post.date}</span>
          <span className="flex items-center gap-1"><Clock size={14} /> {post.readTime} de lectura</span>
        </div>

        <div
          ref={contentRef}
          className="prose-nortex"
          dangerouslySetInnerHTML={{ __html: html }}
        />

        {/* Preguntas frecuentes */}
        {post.faqs && post.faqs.length > 0 && (
          <section className="mt-12 pt-8 border-t border-slate-100">
            <h2 className="text-2xl font-bold text-slate-900 mb-6">Preguntas frecuentes</h2>
            <div className="space-y-4">
              {post.faqs.map((faq, i) => (
                <div key={i} className="bg-slate-50 rounded-xl p-5">
                  <h3 className="font-bold text-slate-900 mb-2">{faq.q}</h3>
                  <p className="text-slate-600 text-sm leading-relaxed">{faq.a}</p>
                </div>
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

        {/* Artículos relacionados — evita páginas huérfanas */}
        {related.length > 0 && (
          <section className="mt-12 pt-8 border-t border-slate-100">
            <h2 className="text-xl font-bold text-slate-900 mb-6">Artículos relacionados</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {related.map((r) => (
                <Link
                  key={r.slug}
                  to={`/blog/${r.slug}`}
                  className="block bg-white border border-slate-200 rounded-xl p-5 hover:border-emerald-300 hover:shadow-md transition-all group"
                >
                  <span className="text-xs font-bold text-emerald-700">{r.category}</span>
                  <h3 className="font-bold text-slate-900 mt-1 leading-snug group-hover:text-emerald-700 transition-colors">
                    {r.title}
                  </h3>
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
