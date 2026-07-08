// lib/markdown.ts
// ─────────────────────────────────────────────────────────────────────────────
// Renderer de Markdown ÚNICO del blog. Lo usan tanto components/BlogPost.tsx
// (cliente, vía dangerouslySetInnerHTML) como scripts/prerender.ts (HTML estático
// para crawlers). Tener un solo renderer evita que el contenido se vea distinto
// según quién lo pinte y centraliza el soporte de tablas, listas y CTAs.
//
// Seguridad: el contenido del blog es FIRST-PARTY (lo escriben los editores en
// data/blog-posts.ts dentro del repo, nunca usuarios), pero igual escapamos el
// texto antes de aplicar las marcas para que un símbolo suelto (<, >, &) no rompa
// el HTML ni habilite inyección si algún día el contenido viniera de otra fuente.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Marcas inline: **negrita**, `código`, [texto](url). Se aplican SOBRE el texto
// ya escapado (los caracteres *, `, [, ], (, ) no se escapan, así que los regex
// siguen funcionando).
function inline(text: string): string {
  let t = escapeHtml(text);
  t = t.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/`([^`]+?)`/g, '<code>$1</code>');
  t = t.replace(/\[([^\]]+?)\]\(([^)]+?)\)/g, (_m, label: string, href: string) => {
    const external = !href.startsWith('/') && !href.startsWith('#');
    const attrs = external ? ' rel="noopener noreferrer" target="_blank"' : '';
    return `<a href="${href}"${attrs}>${label}</a>`;
  });
  return t;
}

// Una fila de tabla "| a | b |" → ['a', 'b']
function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map(c => c.trim());
}

// Detecta la fila separadora de una tabla GFM: | --- | :--: | ---: |
function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
}

/**
 * Convierte el subconjunto de Markdown usado en el blog a HTML.
 * Soporta: # / ## / ###, listas (- y 1.), tablas GFM, **negrita**, `código`,
 * enlaces [texto](url) y CTAs (línea que es solo un enlace interno).
 */
export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (!line) { i++; continue; }

    // ── Tabla GFM ──
    if (line.startsWith('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headers = splitTableRow(line);
      i += 2; // saltar cabecera + separador
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      const thead = `<thead><tr>${headers.map(h => `<th>${inline(h)}</th>`).join('')}</tr></thead>`;
      const tbody = `<tbody>${rows
        .map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`)
        .join('')}</tbody>`;
      out.push(`<div class="prose-table-wrap"><table>${thead}${tbody}</table></div>`);
      continue;
    }

    // ── Encabezados (un solo H1 = el título de la página; en el cuerpo van H2/H3) ──
    if (line.startsWith('### ')) { out.push(`<h3>${inline(line.slice(4))}</h3>`); i++; continue; }
    if (line.startsWith('## '))  { out.push(`<h2>${inline(line.slice(3))}</h2>`); i++; continue; }
    if (line.startsWith('# '))   { out.push(`<h2>${inline(line.slice(2))}</h2>`); i++; continue; }

    // ── Lista desordenada ──
    if (line.startsWith('- ')) {
      const items: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('- ')) {
        items.push(`<li>${inline(lines[i].trim().slice(2))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    // ── Lista ordenada ──
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        items.push(`<li>${inline(lines[i].trim().replace(/^\d+\.\s/, ''))}</li>`);
        i++;
      }
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    // ── CTA: línea que es SOLO un enlace interno (p. ej. "[Prueba gratis →](/register)") ──
    if (/^\[[^\]]+\]\((\/|#)[^)]*\)$/.test(line)) {
      out.push(`<p class="prose-cta">${inline(line)}</p>`);
      i++;
      continue;
    }

    // ── Párrafo ──
    out.push(`<p>${inline(line)}</p>`);
    i++;
  }

  return out.join('\n');
}
