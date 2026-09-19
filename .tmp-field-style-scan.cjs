#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = process.cwd();
const ROOT_DIR = path.join(ROOT, 'components');
const APP_TSX = path.join(ROOT, 'App.tsx');

const EXENTOS = [
  /^components\/Landing\//,
  /^components\/Blog\//,
  /^components\/LandingPage(\.apple)?\.tsx$/,
  /^components\/Blog\.tsx$/,
  /^components\/BlogPost\.tsx$/,
  /^components\/ClusterPage\.tsx$/,
  /^components\/Calculator\.tsx$/,
  /^components\/HelpCenter\.tsx$/,
  /^components\/ReceiptTicket\.tsx$/,
  /^components\/ShiftReportTicket\.tsx$/,
  /^components\/InvoiceTemplate\.tsx$/,
  /^components\/BlueprintViewer\.tsx$/,
];

const disallowedBgPrefixes = new Set([
  'bg-white', 'bg-black', 'bg-gray', 'bg-slate', 'bg-zinc', 'bg-stone', 'bg-neutral',
  'bg-red', 'bg-blue', 'bg-emerald', 'bg-green', 'bg-lime', 'bg-yellow', 'bg-amber',
  'bg-orange', 'bg-cyan', 'bg-sky', 'bg-teal', 'bg-indigo', 'bg-violet', 'bg-purple',
  'bg-fuchsia', 'bg-pink', 'bg-rose'
]);

const disallowedText = new Set([
  'text-white', 'text-black',
  'text-slate-900', 'text-slate-800', 'text-slate-700', 'text-slate-600', 'text-slate-950',
  'text-gray-900', 'text-gray-800', 'text-gray-700', 'text-gray-600', 'text-gray-500',
  'text-neutral-900', 'text-neutral-800', 'text-neutral-700', 'text-neutral-600',
  'text-red-500', 'text-red-600',
  'text-emerald-500', 'text-green-500', 'text-blue-500', 'text-orange-500', 'text-purple-500'
]);

const disallowedBorder = new Set([
  'border-white', 'border-black', 'border-gray-200', 'border-gray-300', 'border-gray-400',
  'border-slate-200', 'border-slate-300', 'border-slate-700', 'border-slate-800',
  'border-zinc-300', 'border-stone-200', 'border-neutral-200'
]);

const allowedBgExact = new Set([
  'bg-transparent', 'bg-surface-950', 'bg-surface-900', 'bg-surface-800', 'bg-surface-700',
  'bg-surface-2', 'bg-canvas', 'bg-canvas-raised', 'bg-canvas-subtle', 'bg-nortex-900',
  'bg-surface', 'bg-nortex', 'bg-apple'
]);

const allowedTextExact = new Set([
  'text-slate-100', 'text-slate-200', 'text-slate-300', 'text-slate-400', 'text-slate-500',
  'text-white/80', 'text-white/90',
]);

function isExento(rel) {
  const r = rel.replace('\\', '/');
  return EXENTOS.some((pat) => pat.test(r));
}

function walkDir(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (['node_modules', 'dist', '.git'].includes(ent.name)) continue;
      walkDir(full, acc);
    } else if (ent.isFile() && path.extname(ent.name) === '.tsx') {
      acc.push(full);
    }
  }
  return acc;
}

function splitTokens(text) {
  return String(text).split(/\s+/).map((s) => s.trim()).filter(Boolean);
}

function classIsTemplateExpression(node) {
  return ts.isJsxExpression(node) && node.expression && (
    !ts.isStringLiteral(node.expression) &&
    !ts.isNoSubstitutionTemplateLiteral(node.expression)
  );
}

function getClassTokensFromAttr(attr) {
  if (!attr) return null;
  if (ts.isStringLiteral(attr) || ts.isNoSubstitutionTemplateLiteral(attr)) return { kind: 'literal', tokens: splitTokens(attr.text) };
  if (ts.isTemplateExpression(attr)) return { kind: 'template', text: attr.getText(), tokens: [] };
  if (ts.isNoSubstitutionTemplateLiteral(attr)) return { kind: 'literal', tokens: splitTokens(attr.text) };
  if (ts.isJsxExpression(attr)) {
    const expr = attr.expression;
    if (!expr) return { kind: 'empty', tokens: [] };
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return { kind: 'literal', tokens: splitTokens(expr.text) };
    return { kind: 'expression', text: expr.getText(), tokens: [] };
  }
  return { kind: 'unknown', text: attr.getText(), tokens: [] };
}

function flagClassTokens(tokens) {
  const flags = [];

  for (const t of tokens) {
    const base = t.split(':').pop();

    if (base.startsWith('bg-')) {
      const core = base.replace(/:.*/, '');
      if (allowedBgExact.has(core)) continue;
      const family = core.split('-')[0] + '-' + (core.split('-')[1] || '');
      for (const dis of disallowedBgPrefixes) {
        if (core === dis || core.startsWith(dis + '-') || core.startsWith(dis + '/') || core.startsWith(dis + '.')) {
          flags.push({ kind: 'bg', token: base });
          break;
        }
      }
    }

    if (base.startsWith('text-') || base.startsWith('placeholder:text-')) {
      const isAllowed = allowedTextExact.has(base);
      if (!isAllowed && (disallowedText.has(base) || /^text-(white|black|gray|neutral|slate-9|slate-8|red-|green-|blue-|amber-|yellow-|purple-|pink-|rose-|fuchsia-|indigo-|violet-|teal-|cyan-|sky-|emerald-|zinc-|stone-)/.test(base))) {
        flags.push({ kind: 'text', token: base });
      }
    }

    if (base.startsWith('border-') && (disallowedBorder.has(base) || /^border-(white|black|gray|neutral|slate|zinc|stone)-/.test(base))) {
      flags.push({ kind: 'border', token: base });
    }

    if (base.startsWith('rounded-') && !['rounded-md', 'rounded-xl', 'rounded-2xl', 'rounded-full', 'rounded-none'].includes(base)) {
      flags.push({ kind: 'round', token: base });
    }

    if (base === 'bg-transparent') {
      // no issue
    }
  }

  return flags;
}

const files = walkDir(ROOT_DIR).concat(fs.existsSync(APP_TSX) ? [APP_TSX] : []).map((full) => ({
  full,
  rel: path.relative(ROOT, full).replace('\\', '/'),
})).filter(({ rel }) => !isExento(rel));

const output = [];

for (const { full, rel } of files) {
  const sourceText = fs.readFileSync(full, 'utf8');
  const sf = ts.createSourceFile(full, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const lines = sourceText.split('\n');

  const visit = (node) => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tag = node.tagName.getText();
      if (!['input', 'textarea', 'select'].includes(tag)) return ts.forEachChild(node, visit);

      let typeAttr = null;
      let classAttrNode = null;
      for (const p of node.attributes.properties) {
        if (!ts.isJsxAttribute(p)) continue;
        const key = p.name.getText();
        if (key === 'type' && p.initializer && ts.isStringLiteral(p.initializer)) {
          typeAttr = p.initializer.text;
        }
        if (key === 'className') {
          classAttrNode = p.initializer;
        }
      }

      if (tag === 'input' && typeAttr === 'hidden') return ts.forEachChild(node, visit);

      const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      const lineText = lines[line - 1].trim();

      if (!classAttrNode) {
        output.push({
          level: 'medio',
          kind: 'missing',
          file: rel,
          line,
          tag,
          reason: 'Sin className en input/textarea/select',
          snippet: lineText,
        });
        return ts.forEachChild(node, visit);
      }

      const info = getClassTokensFromAttr(classAttrNode);
      if (!info || info.kind === 'expression' || info.kind === 'template' || info.kind === 'unknown') {
        output.push({
          level: 'baja',
          kind: 'dynamic',
          file: rel,
          line,
          tag,
          reason: info && info.text ? `className dinámico (${info.text.slice(0, 180)})` : 'className no literal',
          snippet: lineText,
        });
        return ts.forEachChild(node, visit);
      }

      const flags = flagClassTokens(info.tokens);
      if (flags.length > 0) {
        const reasons = {};
        for (const f of flags) {
          (reasons[f.kind] ||= new Set()).add(f.token);
        }
        const dedup = {};
        for (const [k, v] of Object.entries(reasons)) dedup[k] = Array.from(v).sort().slice(0, 10);

        output.push({
          level: 'alta',
          kind: 'style',
          file: rel,
          line,
          tag,
          reason: JSON.stringify(dedup),
          snippet: lineText,
        });
      }
    }

    return ts.forEachChild(node, visit);
  };

  visit(sf);
}

const uniq = new Map();
for (const item of output) {
  const key = `${item.file}:${item.line}:${item.tag}:${item.kind}:${item.reason}`;
  if (!uniq.has(key)) uniq.set(key, item);
}

const items = Array.from(uniq.values()).sort((a, b) => {
  const rank = { alta: 2, medio: 1, baja: 0 };
  if (rank[b.level] !== rank[a.level]) return rank[b.level] - rank[a.level];
  if (a.file !== b.file) return a.file.localeCompare(b.file);
  return a.line - b.line;
});

const grouped = {};
for (const it of items) {
  (grouped[it.file] ||= []).push(it);
}

console.log(JSON.stringify({
  total: items.length,
  files: Object.keys(grouped).length,
  grouped,
}, null, 2));
