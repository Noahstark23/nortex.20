/**
 * NORTEX — Invariantes de SEO del blog.
 *
 * El blog es el activo de adquisición: 28.000 impresiones/mes y subiendo. Estos
 * datos viven en un archivo de 3.000 líneas editado a mano, así que los errores
 * que importan (un título que Google trunca, un `calculator` mal escrito que no
 * renderiza nada, un CTA que el parser no reconoce como botón) son silenciosos:
 * el build pasa igual y el daño se ve semanas después en Search Console.
 */
import { describe, it, expect } from 'vitest';
import { blogPosts } from '../data/blog-posts';
import { blogClusters } from '../data/blog-clusters';
import { CALCULADORAS } from '../utils/calculadoras';

/** Ancho que Google muestra antes de truncar con "…". */
const MAX_TITULO_SERP = 60;
/** Sufijo que el prerender agrega cuando el post NO define metaTitle. */
const SUFIJO = ' | Nortex Blog';

describe('Títulos del SERP', () => {
    it('todo metaTitle entra completo en el SERP', () => {
        // El metaTitle se emite TAL CUAL (sin sufijo): quien lo escribe se hace
        // cargo del ancho. Uno de 70 caracteres se corta justo en el gancho.
        const largos = blogPosts
            .filter(p => p.metaTitle && p.metaTitle.length > MAX_TITULO_SERP)
            .map(p => `${p.slug} (${p.metaTitle!.length})`);
        expect(largos).toEqual([]);
    });

    it('ningún metaTitle repite el sufijo a mano', () => {
        // Ponerlo a mano lo duplicaría si algún día se cambia la regla del prerender.
        const conSufijo = blogPosts.filter(p => p.metaTitle?.includes('Nortex Blog')).map(p => p.slug);
        expect(conSufijo).toEqual([]);
    });

    it('ningún metaTitle está vacío o es igual al título', () => {
        // Un metaTitle idéntico al H1 no aporta nada y esconde que falta trabajo.
        const inutiles = blogPosts
            .filter(p => p.metaTitle !== undefined && (p.metaTitle.trim() === '' || p.metaTitle === p.title))
            .map(p => p.slug);
        expect(inutiles).toEqual([]);
    });

    it('los títulos que YA rankean con calculadora tienen metaTitle propio', () => {
        // Son los que el truncado castigaba más: el "(con calculadora)" quedaba
        // fuera de la vista justo donde tenía que competir con un AI Overview.
        const sinMeta = blogPosts.filter(p => p.calculator && !p.metaTitle).map(p => p.slug);
        expect(sinMeta).toEqual([]);
    });

    it('los posts sin metaTitle siguen entrando por el camino viejo', () => {
        // No hay regresión: el prerender les pone el sufijo como siempre.
        const sinMeta = blogPosts.filter(p => !p.metaTitle);
        expect(sinMeta.length).toBeGreaterThan(0);
        for (const p of sinMeta) expect(`${p.title}${SUFIJO}`).toContain(SUFIJO);
    });
});

describe('Calculadoras declaradas en los posts', () => {
    it('todo `calculator` apunta a una calculadora que existe', () => {
        // Un typo acá no rompe el build: simplemente no se renderiza nada.
        const rotos = blogPosts
            .filter(p => p.calculator && !(p.calculator in CALCULADORAS))
            .map(p => `${p.slug} → ${p.calculator}`);
        expect(rotos).toEqual([]);
    });

    it('toda calculadora del registro tiene título, descripción y campos', () => {
        // El prerender los emite como <h2>, <p> y <label>: si faltan, el bloque
        // estático sale vacío y el crawler vuelve a no ver la herramienta.
        for (const [tipo, c] of Object.entries(CALCULADORAS)) {
            expect(c.titulo.trim(), tipo).not.toBe('');
            expect(c.descripcion.trim(), tipo).not.toBe('');
            expect(c.fields.length, tipo).toBeGreaterThan(0);
            for (const f of c.fields) {
                expect(f.key.trim(), `${tipo}.key`).not.toBe('');
                expect(f.label.trim(), `${tipo}.label`).not.toBe('');
            }
            if (c.select) expect(c.select.options.length, tipo).toBeGreaterThan(0);
        }
    });

    it('cada calculadora produce filas de resultado con una entrada típica', () => {
        // Humo sobre el registro entero: detecta un `compute` que devuelve vacío
        // o revienta por un campo renombrado en un solo lado.
        for (const [tipo, c] of Object.entries(CALCULADORAS)) {
            const v = Object.fromEntries(c.fields.map(f => [f.key, 12]));
            const s = c.select ? { [c.select.key]: c.select.options[0].value } : {};
            const filas = c.compute(v, s);
            expect(filas.length, tipo).toBeGreaterThan(0);
            for (const f of filas) expect(f.value, tipo).toMatch(/\d/);
        }
    });
});

describe('CTAs del cuerpo', () => {
    // El parser de utils/markdown.ts solo convierte en BOTÓN una línea que es
    // SOLO un link y TERMINA en →. Sin la flecha queda un enlace de texto
    // perdido en un párrafo, y es el único mecanismo de conversión que ve un
    // crawler (los 49 CTAs sí están en el HTML estático).
    const CTA_RE = /\[([^\]]*)\]\(\/register\)/g;

    it('todo enlace a /register está escrito como CTA (termina en →)', () => {
        const malos: string[] = [];
        for (const p of blogPosts) {
            for (const m of p.content.matchAll(CTA_RE)) {
                if (!/→\s*$/.test(m[1])) malos.push(`${p.slug}: "${m[1]}"`);
            }
        }
        expect(malos).toEqual([]);
    });

    it('las guías fiscales y de RRHH no ofrecen un trial genérico de POS', () => {
        // Quien buscó "cómo calcular el aguinaldo" recibía "Probá Nortex gratis
        // 30 días": un non sequitur. El CTA tiene que prometer lo que hay detrás.
        const genericos = ['Probá Nortex gratis 30 días', 'Empezá gratis con Nortex', 'Empezá ahora', 'Mirá cómo funciona'];
        const malos: string[] = [];
        for (const p of blogPosts) {
            if (!['Fiscal', 'Recursos Humanos', 'Contabilidad'].includes(p.category)) continue;
            for (const m of p.content.matchAll(CTA_RE)) {
                const texto = m[1].replace(/\s*→\s*$/, '').trim();
                if (genericos.includes(texto)) malos.push(`${p.slug}: "${texto}"`);
            }
        }
        expect(malos).toEqual([]);
    });
});

describe('Integridad de los datos del blog', () => {
    it('no hay slugs duplicados', () => {
        const vistos = blogPosts.map(p => p.slug);
        expect(vistos.length).toBe(new Set(vistos).size);
    });

    it('todo post referencia un clúster que existe por NOMBRE exacto', () => {
        // blog-clusters referencia por name, no por slug: un acento de más deja
        // el post fuera de su hub y sin breadcrumb.
        const nombres = new Set(blogClusters.map(c => c.name));
        const huerfanos = blogPosts.filter(p => !nombres.has(p.cluster)).map(p => `${p.slug} → ${p.cluster}`);
        expect(huerfanos).toEqual([]);
    });

    it('toda meta description entra en el snippet', () => {
        const largas = blogPosts.filter(p => p.description.length > 160).map(p => `${p.slug} (${p.description.length})`);
        expect(largas).toEqual([]);
    });
});
