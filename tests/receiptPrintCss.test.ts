import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse, type AtRule, type Declaration, type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'index.css'), 'utf8');

describe('sistema de impresion del POS', () => {
    it('hace visible el ticket aunque el componente viva oculto fuera de print', () => {
        const stylesheet = parse(source);
        const printMedia = stylesheet.nodes.find(
            (node): node is AtRule => node.type === 'atrule'
                && node.name === 'media'
                && node.params.trim() === 'print',
        );
        const printableRule = printMedia?.nodes?.find(
            (node): node is Rule => node.type === 'rule'
                && ['#receipt-area', '#receipt-area *', '#shift-report-area', '#shift-report-area *']
                    .every(selector => node.selectors.includes(selector)),
        );
        const opacity = printableRule?.nodes.find(
            (node): node is Declaration => node.type === 'decl' && node.prop === 'opacity',
        );

        expect(printableRule, 'falta la regla de visibilidad de los tickets').toBeDefined();
        expect(opacity?.value).toBe('1');
        expect(opacity?.important).toBe(true);
    });
});
