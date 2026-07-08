// utils/markdown.ts
// Renderizador ÚNICO de Markdown -> HTML para el blog de Nortex.
// Lo usan el SPA (components/BlogPost.tsx, vía dangerouslySetInnerHTML) y el
// prerender en Node (scripts/prerender.ts). Antes existían DOS parsers
// distintos (BlogPost.renderContent y prerender.mdToHtml) que divergían; esta
// es ahora la única fuente de verdad del HTML del artículo.
//
// El contenido proviene de data/blog-posts.ts (confiable), pero igual se
// escapa el texto para evitar inyección accidental.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(t: string): string {
  return escapeHtml(t)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+?)`/g, '<code>$1</code>')
    .replace(/\[(.+?)\]\(([^)]+)\)/g, (_m: string, text: string, href: string) => {
      const isCta = /→|»/.test(text) || /^\/register/.test(href);
      return `<a href="${href}"${isCta ? ' class="nx-cta"' : ''}>${text}</a>`;
    });
}

/** Convierte el subconjunto de Markdown de los artículos a HTML crawleable. */
export function mdToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let inUl = false;
  let inOl = false;
  const closeLists = (): void => {
    if (inUl) { out.push('</ul>'); inUl = false; }
    if (inOl) { out.push('</ol>'); inOl = false; }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();

    // Tabla Markdown: fila de encabezado seguida de separador | --- | --- |
    if (line.startsWith('|') && i + 1 < lines.length && /^\|[\s:|-]+\|?$/.test(lines[i + 1].trim())) {
      closeLists();
      const cells = (row: string): string[] => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        body.push(cells(lines[i]));
        i++;
      }
      out.push(
        '<table><thead><tr>' +
        head.map((h) => `<th>${inline(h)}</th>`).join('') +
        '</tr></thead><tbody>' +
        body.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
        '</tbody></table>'
      );
      continue;
    }

    if (!line) { closeLists(); i++; continue; }

    if (line.startsWith('### ')) { closeLists(); out.push(`<h3>${inline(line.slice(4))}</h3>`); }
    else if (line.startsWith('## ')) { closeLists(); out.push(`<h2>${inline(line.slice(3))}</h2>`); }
    else if (line.startsWith('# ')) { closeLists(); out.push(`<h2>${inline(line.slice(2))}</h2>`); }
    else if (line === '---') { closeLists(); out.push('<hr />'); }
    else if (line.startsWith('> ')) { closeLists(); out.push(`<blockquote>${inline(line.slice(2))}</blockquote>`); }
    else if (/^\d+\.\s/.test(line)) {
      if (!inOl) { closeLists(); out.push('<ol>'); inOl = true; }
      out.push(`<li>${inline(line.replace(/^\d+\.\s/, ''))}</li>`);
    }
    else if (line.startsWith('- ')) {
      if (!inUl) { closeLists(); out.push('<ul>'); inUl = true; }
      out.push(`<li>${inline(line.slice(2))}</li>`);
    }
    else { closeLists(); out.push(`<p>${inline(line)}</p>`); }
    i++;
  }
  closeLists();
  return out.join('\n');
}
