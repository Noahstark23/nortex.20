import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const runtimeEntries = [
    'index.html',
    'index.tsx',
    'App.tsx',
    'index.css',
    'nortex-tokens.css',
    'components',
];
const runtimeExtensions = new Set(['.css', '.html', '.ts', '.tsx']);

const collectRuntimeFiles = (entry: string): string[] => {
    const absolute = resolve(root, entry);
    if (!statSync(absolute).isDirectory()) return [absolute];

    return readdirSync(absolute, { withFileTypes: true }).flatMap((child) => {
        const childEntry = join(entry, child.name);
        if (child.isDirectory()) return collectRuntimeFiles(childEntry);
        return runtimeExtensions.has(extname(child.name)) ? [resolve(root, childEntry)] : [];
    });
};

const runtimeSources = runtimeEntries
    .flatMap(collectRuntimeFiles)
    .map((file) => ({ file, source: readFileSync(file, 'utf8') }));
const tailwindConfig = readFileSync(resolve(root, 'tailwind.config.js'), 'utf8');

const findMatches = (pattern: RegExp, capture = 0) => runtimeSources.flatMap(({ file, source }) => {
    pattern.lastIndex = 0;
    return [...source.matchAll(pattern)].map((match) => {
        const line = source.slice(0, match.index ?? 0).split('\n').length;
        return `${relative(root, file)}:${line} (${match[capture]})`;
    });
});

const findMotionTokens = (pattern: RegExp) => {
    const tokens = new Set<string>();
    runtimeSources.forEach(({ source }) => {
        pattern.lastIndex = 0;
        for (const match of source.matchAll(pattern)) {
            if (match[1]) tokens.add(match[1]);
        }
    });
    return [...tokens].sort();
};

// Subconjunto de clases de entrada usadas en Nortex. Si aparecen en runtime,
// el theme debe proveerles CSS real; animate-fade-in-up queda fuera porque ya
// existe como animación propia.
const deadMotionToken = /(?:^|[\s"'`:{])((?:animate-(?:in|out)|fade-(?:in|out)(?:-[^\s"'`{}]+)?|slide-(?:in-from|out-to)(?:-[^\s"'`{}]+)?|zoom-(?:in|out)(?:-[^\s"'`{}]+)?))(?=$|[\s"'`}])/gm;

describe('P0 móvil y PWA', () => {
    it('habilita las safe areas de iOS desde el viewport', () => {
        const html = readFileSync(resolve(root, 'index.html'), 'utf8');

        expect(html).toMatch(
            /<meta\s+name="viewport"\s+content="[^"]*\bviewport-fit=cover\b[^"]*"\s*\/?>/,
        );
    });

    it('usa el viewport dinámico en toda la interfaz', () => {
        expect(findMatches(/100vh/g)).toEqual([]);
    });

    it('toda clase de animación declarada en runtime tiene implementación en el theme', () => {
        const usedTokens = findMotionTokens(deadMotionToken);

        usedTokens.forEach((token) => {
            expect(tailwindConfig).toContain(`'.${token}'`);
        });
        expect(tailwindConfig).toContain("'nx-enter'");
    });
});
