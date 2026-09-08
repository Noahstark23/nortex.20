/**
 * NORTEX — renderer Markdown único para el blog de marketing.
 *
 * POR QUÉ ES PROPIO: el bundle del SPA ya roza el límite de precache del PWA
 * (ver vite.config.ts). En vez de sumar una librería de Markdown, este módulo
 * parsea un subconjunto controlado de Markdown a un AST de bloques tipado y lo
 * sirve por DOS vías desde la MISMA fuente de verdad:
 *
 *   1. `renderMarkdown(md)` → nodos React (usa React.createElement, por eso el
 *      archivo es `.ts` y no `.tsx`). Lo consume components/BlogPost.tsx.
 *   2. `markdownToHtml(md)` → string HTML crawleable. Lo consume
 *      scripts/prerender.ts para el SEO estático.
 *
 * SINTAXIS SOPORTADA (y SOLO esta — ver CLAUDE.md / prompt de contenido):
 *   ## H2            ### H3
 *   **negrita**      `code`      [texto](/ruta)      [texto →](/ruta)  (CTA)
 *   - lista           1. lista ordenada
 *   | a | b |  con fila separadora | --- | --- |   (tabla)
 *   > cita
 *   párrafos de texto normal
 */
import React from 'react';

// ── AST de bloques ──────────────────────────────────────────────────────────

export type InlineToken =
    | { type: 'text'; value: string }
    | { type: 'bold'; value: string }
    | { type: 'code'; value: string }
    | { type: 'link'; text: string; href: string; cta: boolean };

export type Block =
    | { type: 'heading'; level: 2 | 3; tokens: InlineToken[] }
    | { type: 'paragraph'; tokens: InlineToken[] }
    | { type: 'list'; ordered: boolean; items: InlineToken[][] }
    | { type: 'quote'; tokens: InlineToken[] }
    | { type: 'table'; header: InlineToken[][]; rows: InlineToken[][][] }
    | { type: 'cta'; text: string; href: string };

// ── Tokenizador inline ──────────────────────────────────────────────────────

// Detecta **negrita**, `code` y [texto](/ruta) respetando el orden de aparición.
const INLINE_RE = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))/g;

export function parseInline(raw: string): InlineToken[] {
    const tokens: InlineToken[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    INLINE_RE.lastIndex = 0;
    while ((m = INLINE_RE.exec(raw)) !== null) {
        if (m.index > last) tokens.push({ type: 'text', value: raw.slice(last, m.index) });
        if (m[2] !== undefined) {
            tokens.push({ type: 'bold', value: m[2] });
        } else if (m[4] !== undefined) {
            tokens.push({ type: 'code', value: m[4] });
        } else if (m[6] !== undefined && m[7] !== undefined) {
            const text = m[6];
            const href = m[7];
            tokens.push({ type: 'link', text: text.replace(/\s*→\s*$/, '').trim(), href, cta: /→\s*$/.test(text) });
        }
        last = m.index + m[0].length;
    }
    if (last < raw.length) tokens.push({ type: 'text', value: raw.slice(last) });
    return tokens;
}

// ── Parser de bloques ───────────────────────────────────────────────────────

const splitRow = (line: string): string[] =>
    line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());

const isTableSeparator = (line: string): boolean =>
    /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);

export function parseMarkdown(md: string): Block[] {
    const lines = md.replace(/\r\n/g, '\n').split('\n');
    const blocks: Block[] = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();

        if (trimmed === '') { i++; continue; }

        // Encabezados
        if (trimmed.startsWith('### ')) {
            blocks.push({ type: 'heading', level: 3, tokens: parseInline(trimmed.slice(4)) });
            i++; continue;
        }
        if (trimmed.startsWith('## ')) {
            blocks.push({ type: 'heading', level: 2, tokens: parseInline(trimmed.slice(3)) });
            i++; continue;
        }
        // Compatibilidad: `# ` se degrada a H2 (los H1 los pone el componente).
        if (trimmed.startsWith('# ')) {
            blocks.push({ type: 'heading', level: 2, tokens: parseInline(trimmed.slice(2)) });
            i++; continue;
        }

        // Tabla: fila con pipes seguida de una fila separadora
        if (trimmed.startsWith('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
            const header = splitRow(trimmed).map(parseInline);
            i += 2;
            const rows: InlineToken[][][] = [];
            while (i < lines.length && lines[i].trim().startsWith('|')) {
                rows.push(splitRow(lines[i].trim()).map(parseInline));
                i++;
            }
            blocks.push({ type: 'table', header, rows });
            continue;
        }

        // Cita
        if (trimmed.startsWith('> ')) {
            const buf: string[] = [];
            while (i < lines.length && lines[i].trim().startsWith('> ')) {
                buf.push(lines[i].trim().slice(2));
                i++;
            }
            blocks.push({ type: 'quote', tokens: parseInline(buf.join(' ')) });
            continue;
        }

        // Lista no ordenada
        if (/^[-*]\s+/.test(trimmed)) {
            const items: InlineToken[][] = [];
            while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
                items.push(parseInline(lines[i].trim().replace(/^[-*]\s+/, '')));
                i++;
            }
            blocks.push({ type: 'list', ordered: false, items });
            continue;
        }

        // Lista ordenada
        if (/^\d+\.\s+/.test(trimmed)) {
            const items: InlineToken[][] = [];
            while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
                items.push(parseInline(lines[i].trim().replace(/^\d+\.\s+/, '')));
                i++;
            }
            blocks.push({ type: 'list', ordered: true, items });
            continue;
        }

        // CTA: línea que es SOLO un link y termina en → → botón destacado
        const ctaMatch = trimmed.match(/^\[([^\]]+→)\]\(([^)]+)\)$/);
        if (ctaMatch) {
            blocks.push({ type: 'cta', text: ctaMatch[1].replace(/\s*→\s*$/, '').trim(), href: ctaMatch[2] });
            i++; continue;
        }

        // Párrafo (puede continuar en líneas siguientes hasta una vacía/bloque)
        const buf: string[] = [trimmed];
        i++;
        while (i < lines.length) {
            const next = lines[i].trim();
            if (next === '' || /^(#{1,3}\s|[-*]\s|\d+\.\s|>\s|\|)/.test(next)) break;
            buf.push(next);
            i++;
        }
        blocks.push({ type: 'paragraph', tokens: parseInline(buf.join(' ')) });
    }

    return blocks;
}

// ── Render a React (createElement, sin JSX para mantener el archivo .ts) ─────

const h = React.createElement;

/**
 * Contrato visual compartido por React y el prerender. Mantener los nombres en
 * un solo registro evita que el HTML indexable vuelva a divergir del artículo
 * hidratado o que una utilidad de color saltee los tokens públicos.
 */
const MARKDOWN_CLASSES = {
    strong: 'nx-prose-strong',
    code: 'nx-prose-code',
    link: 'nx-public-link',
    heading2: 'nx-prose-heading nx-prose-heading-2',
    heading3: 'nx-prose-heading nx-prose-heading-3',
    paragraph: 'nx-prose-paragraph',
    quote: 'nx-prose-quote',
    listOrdered: 'nx-prose-list nx-prose-list-ordered',
    listUnordered: 'nx-prose-list nx-prose-list-unordered',
    listItem: 'nx-prose-list-item',
    tableWrap: 'nx-prose-table-wrap',
    table: 'nx-prose-table',
    tableHead: 'nx-prose-table-head',
    tableHeading: 'nx-prose-table-heading',
    tableRowAlt: 'nx-prose-table-row-alt',
    tableCell: 'nx-prose-table-cell',
    ctaWrap: 'nx-prose-cta',
    cta: 'nx-public-primary',
} as const;

function renderInlineReact(tokens: InlineToken[], keyPrefix: string): React.ReactNode[] {
    return tokens.map((t, idx) => {
        const key = `${keyPrefix}-${idx}`;
        switch (t.type) {
            case 'bold':
                return h('strong', { key, className: MARKDOWN_CLASSES.strong }, t.value);
            case 'code':
                return h('code', { key, className: MARKDOWN_CLASSES.code }, t.value);
            case 'link': {
                const isInternal = t.href.startsWith('/');
                return h('a', {
                    key,
                    href: t.href,
                    ...(isInternal ? {} : { target: '_blank', rel: 'noopener noreferrer' }),
                    className: MARKDOWN_CLASSES.link,
                }, t.text);
            }
            default:
                return t.value;
        }
    });
}

/**
 * Renderiza Markdown a nodos React. Devuelve un array de bloques que el
 * componente envuelve en su contenedor `.prose-nortex`.
 *
 * `linkComponent` permite inyectar el <Link> de react-router para navegación
 * SPA en CTAs internas; si no se pasa, se usa <a href>.
 */
export function renderMarkdown(
    md: string,
    linkComponent?: React.ComponentType<{ to: string; className?: string; children?: React.ReactNode }>,
): React.ReactNode[] {
    const blocks = parseMarkdown(md);

    return blocks.map((block, bi) => {
        const key = `b-${bi}`;
        switch (block.type) {
            case 'heading':
                return block.level === 2
                    ? h('h2', { key, className: MARKDOWN_CLASSES.heading2 }, renderInlineReact(block.tokens, key))
                    : h('h3', { key, className: MARKDOWN_CLASSES.heading3 }, renderInlineReact(block.tokens, key));

            case 'paragraph':
                return h('p', { key, className: MARKDOWN_CLASSES.paragraph }, renderInlineReact(block.tokens, key));

            case 'quote':
                return h('blockquote', { key, className: MARKDOWN_CLASSES.quote }, renderInlineReact(block.tokens, key));

            case 'list': {
                const tag = block.ordered ? 'ol' : 'ul';
                const cls = block.ordered ? MARKDOWN_CLASSES.listOrdered : MARKDOWN_CLASSES.listUnordered;
                return h(tag, { key, className: cls },
                    block.items.map((item, ii) => h('li', { key: `${key}-${ii}`, className: MARKDOWN_CLASSES.listItem }, renderInlineReact(item, `${key}-${ii}`))));
            }

            case 'table':
                return h('div', {
                    key,
                    className: MARKDOWN_CLASSES.tableWrap,
                    role: 'region',
                    'aria-label': 'Tabla del artículo',
                    tabIndex: 0,
                },
                    h('table', { className: MARKDOWN_CLASSES.table },
                        h('thead', { className: MARKDOWN_CLASSES.tableHead },
                            h('tr', null, block.header.map((cell, ci) =>
                                h('th', { key: `${key}-h-${ci}`, scope: 'col', className: MARKDOWN_CLASSES.tableHeading }, renderInlineReact(cell, `${key}-h-${ci}`))))),
                        h('tbody', null, block.rows.map((row, ri) =>
                            h('tr', { key: `${key}-r-${ri}`, className: ri % 2 ? MARKDOWN_CLASSES.tableRowAlt : undefined },
                                row.map((cell, ci) =>
                                    h('td', { key: `${key}-r-${ri}-${ci}`, className: MARKDOWN_CLASSES.tableCell }, renderInlineReact(cell, `${key}-r-${ri}-${ci}`))))))));

            case 'cta': {
                const cls = MARKDOWN_CLASSES.cta;
                const inner = `${block.text} →`;
                const node = linkComponent && block.href.startsWith('/')
                    ? h(linkComponent, { to: block.href, className: cls }, inner)
                    : h('a', { href: block.href, className: cls }, inner);
                return h('div', { key, className: MARKDOWN_CLASSES.ctaWrap }, node);
            }
        }
    });
}

// ── Serializador a HTML (para prerender SEO) ─────────────────────────────────

const escHtml = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inlineToHtml(tokens: InlineToken[]): string {
    return tokens.map(t => {
        switch (t.type) {
            case 'bold': return `<strong class="${MARKDOWN_CLASSES.strong}">${escHtml(t.value)}</strong>`;
            case 'code': return `<code class="${MARKDOWN_CLASSES.code}">${escHtml(t.value)}</code>`;
            case 'link': {
                const ext = t.href.startsWith('/') ? '' : ' target="_blank" rel="noopener noreferrer"';
                return `<a href="${escHtml(t.href)}"${ext} class="${MARKDOWN_CLASSES.link}">${escHtml(t.text)}</a>`;
            }
            default: return escHtml(t.value);
        }
    }).join('');
}

/** Convierte Markdown a HTML estático y crawleable (mismo parser que React). */
export function markdownToHtml(md: string): string {
    const blocks = parseMarkdown(md);
    const out: string[] = [];

    for (const block of blocks) {
        switch (block.type) {
            case 'heading':
                out.push(`<h${block.level} class="${block.level === 2 ? MARKDOWN_CLASSES.heading2 : MARKDOWN_CLASSES.heading3}">${inlineToHtml(block.tokens)}</h${block.level}>`);
                break;
            case 'paragraph':
                out.push(`<p class="${MARKDOWN_CLASSES.paragraph}">${inlineToHtml(block.tokens)}</p>`);
                break;
            case 'quote':
                out.push(`<blockquote class="${MARKDOWN_CLASSES.quote}">${inlineToHtml(block.tokens)}</blockquote>`);
                break;
            case 'list': {
                const tag = block.ordered ? 'ol' : 'ul';
                const cls = block.ordered ? MARKDOWN_CLASSES.listOrdered : MARKDOWN_CLASSES.listUnordered;
                out.push(`<${tag} class="${cls}">${block.items.map(it => `<li class="${MARKDOWN_CLASSES.listItem}">${inlineToHtml(it)}</li>`).join('')}</${tag}>`);
                break;
            }
            case 'table': {
                const head = `<thead class="${MARKDOWN_CLASSES.tableHead}"><tr>${block.header.map(c => `<th scope="col" class="${MARKDOWN_CLASSES.tableHeading}">${inlineToHtml(c)}</th>`).join('')}</tr></thead>`;
                const body = `<tbody>${block.rows.map((r, ri) => `<tr${ri % 2 ? ` class="${MARKDOWN_CLASSES.tableRowAlt}"` : ''}>${r.map(c => `<td class="${MARKDOWN_CLASSES.tableCell}">${inlineToHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
                out.push(`<div class="${MARKDOWN_CLASSES.tableWrap}" role="region" aria-label="Tabla del artículo" tabindex="0"><table class="${MARKDOWN_CLASSES.table}">${head}${body}</table></div>`);
                break;
            }
            case 'cta':
                out.push(`<div class="${MARKDOWN_CLASSES.ctaWrap}"><a href="${escHtml(block.href)}" class="${MARKDOWN_CLASSES.cta}">${escHtml(block.text)} →</a></div>`);
                break;
        }
    }

    return out.join('\n');
}
