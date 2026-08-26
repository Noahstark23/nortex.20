import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const compose = readFileSync(join(__dirname, '..', 'docker-compose.yml'), 'utf8');

/**
 * Devuelve el bloque de un servicio sin depender de que Docker esté instalado
 * en la máquina que ejecuta Vitest. Las claves de servicios Compose viven a dos
 * espacios; las claves internas, a cuatro.
 */
const serviceBlock = (name: string): string => {
    const lines = compose.split('\n');
    const start = lines.findIndex(line => line === `  ${name}:`);
    expect(start, `No existe services.${name} en docker-compose.yml`).toBeGreaterThan(-1);

    const nextService = lines.findIndex(
        (line, index) => index > start && /^  [a-zA-Z0-9_-]+:\s*$/.test(line),
    );

    return lines.slice(start + 1, nextService === -1 ? undefined : nextService).join('\n');
};

const listUnder = (block: string, key: string): string[] => {
    const lines = block.split('\n');
    const start = lines.findIndex(line => line === `    ${key}:`);
    if (start === -1) return [];

    const values: string[] = [];
    for (const line of lines.slice(start + 1)) {
        if (/^    \S/.test(line)) break;
        const item = line.match(/^      -\s+['"]?([^'"\s]+)['"]?\s*(?:#.*)?$/);
        if (item) values.push(item[1]);
    }
    return values;
};

describe('contrato de red del compose', () => {
    it('app solo anuncia el puerto interno a Traefik y no reserva un puerto del host', () => {
        const app = serviceBlock('app');

        expect(app).not.toMatch(/^    ports:\s*$/m);
        expect(listUnder(app, 'expose')).toEqual(['3000']);
    });
});
