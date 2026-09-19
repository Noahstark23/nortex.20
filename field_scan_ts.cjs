const fs = require('fs');
const path = require('path');
const cp = require('child_process').execSync;
const ts = require('typescript');

const files = cp('rg --files components --glob "*.tsx"', { encoding: 'utf8' }).trim().split(/\n/).concat(['App.tsx']);

const suspicious = [
  /\bbg-white\b/,
  /\bbg-slate-(50|100|200|300|400|500|600|700|800|900|950)\b/,
  /\bbg-emerald-\d{3}\b/,
  /\btext-slate-(950|900|800|700|600|500)\b/,
  /\btext-black\b/,
  /\brounded-lg\b/,
  /\brounded-md\b/,
  /\brounded-\d+/,
];

function classExprToText(expr) {
  if (!expr) return null;
  if (ts.isStringLiteral(expr)) return expr.text;
  if (ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text;
  if (ts.isTemplateExpression(expr)) {
    if (expr.templateSpans.length === 0) return expr.head.text;
    return null;
  }
  return null;
}

function extractClassName(attr) {
  if (!attr || !ts.isJsxAttribute(attr)) return null;
  if (attr.name.escapedText !== 'className') return null;
  if (!attr.initializer) return { kind: 'missingValue', value: null };

  if (ts.isStringLiteral(attr.initializer)) return { kind: 'literal', value: attr.initializer.text };
  if (ts.isJsxExpression(attr.initializer)) {
    const expr = attr.initializer.expression;
    const text = classExprToText(expr);
    if (text !== null) return { kind: 'literal', value: text };
    return { kind: 'dynamic', value: expr ? ts.SyntaxKind[expr.kind] : 'empty' };
  }
  return { kind: 'dynamic', value: ts.SyntaxKind[attr.initializer.kind] };
}

function isFormControl(tagName) {
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select';
}

const findings = [];

for (const file of files) {
  if (!file) continue;
  const full = path.join(process.cwd(), file);
  if (!fs.existsSync(full)) continue;
  const content = fs.readFileSync(full, 'utf8');

  let src;
  try {
    src = ts.createSourceFile(full, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  } catch {
    continue;
  }

  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tag = ts.isIdentifier(node.tagName) ? node.tagName.text : null;
      if (isFormControl(tag)) {
        let cls = null;
        let hasClass = false;
        for (const prop of node.attributes.properties) {
          if (ts.isJsxAttribute(prop) && prop.name.escapedText === 'className') {
            hasClass = true;
            cls = extractClassName(prop);
            break;
          }
        }

        const line = src.getLineAndCharacterOfPosition(node.getStart()).line + 1;

        if (!hasClass) {
          findings.push({ file, line, tag, issue: 'falta className' });
        } else if (!cls) {
          findings.push({ file, line, tag, issue: 'className inválida' });
        } else if (cls.kind === 'dynamic') {
          findings.push({ file, line, tag, issue: `className dinámico (${cls.value})` });
        } else if (cls.kind === 'literal' && suspicious.some((re) => re.test(cls.value))) {
          findings.push({ file, line, tag, issue: `className sospechoso: ${cls.value}` });
        }
      }
    }

    ts.forEachChild(node, walk);
  }

  walk(src);
}

for (const f of findings) {
  console.log(`${f.file}:${f.line} <${f.tag}> ${f.issue}`);
}
console.log(`TOTAL=${findings.length}`);
