// utils/markdown.ts
// Renderer de Markdown ÚNICO para el blog. Sin dependencias de React/DOM →
// se usa igual en Node (scripts/prerender.ts genera el HTML estático que indexa
// Google) y en el navegador (components/BlogPost.tsx lo inyecta con
// dangerouslySetInnerHTML). Una sola fuente de verdad evita que el HTML del
// crawler y el de la SPA diverjan.
//
// Soporta: encabezados (##, ###, ####), negritas, listas con viñetas, enlaces,
// CTA (enlaces cuyo texto incluye "→"), tablas estilo GitHub y párrafos.
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

// Formato en línea: negritas y enlaces (incluye CTA). Se aplica sobre texto ya
// escapado para que el contenido no pueda inyectar HTML.
function inline(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, href: string) => {
      const isCta = label.includes('→');
      const cls = isCta ? ' class="blog-cta"' : '';
      return `<a href="${href}"${cls}>${label}</a>`;
    });
}

// Divide una fila de tabla "| a | b |" en celdas, ignorando los pipes de borde.
function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

// Una línea es separadora de tabla si solo tiene |, -, :, espacios y al menos un -.
function isTableSeparator(line: string): boolean {
  const t = line.trim();
  return /^\|?[\s:|-]+\|?$/.test(t) && t.includes('-') && t.includes('|');
}

export function markdownToHtml(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();

    // ── Tabla: fila de encabezado seguida de una fila separadora ──
    if (
      line.startsWith('|') &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1])
    ) {
      closeList();
      const header = splitTableRow(line);
      i += 2; // saltar encabezado + separador
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      i--; // compensar el i++ del for

      const thead = `<thead><tr>${header
        .map((h) => `<th>${inline(h)}</th>`)
        .join('')}</tr></thead>`;
      const tbody = `<tbody>${rows
        .map(
          (r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`,
        )
        .join('')}</tbody>`;
      out.push(`<table class="blog-table">${thead}${tbody}</table>`);
      continue;
    }

    if (!line) {
      closeList();
      continue;
    }

    if (line.startsWith('#### ')) {
      closeList();
      out.push(`<h4>${inline(line.slice(5))}</h4>`);
    } else if (line.startsWith('### ')) {
      closeList();
      out.push(`<h3>${inline(line.slice(4))}</h3>`);
    } else if (line.startsWith('## ')) {
      closeList();
      out.push(`<h2>${inline(line.slice(3))}</h2>`);
    } else if (line.startsWith('# ')) {
      closeList();
      out.push(`<h2>${inline(line.slice(2))}</h2>`);
    } else if (line.startsWith('- ')) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inline(line.slice(2))}</li>`);
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }

  closeList();
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
