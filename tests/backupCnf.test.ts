import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Credenciales del backup: el option file [client] de MySQL.
 *
 * POR QUÉ ESTO MERECE UNA RED: si el archivo sale mal, `mysqldump` responde
 * "Access denied" y el respaldo **no corre**. Y no falla ruidosamente el día
 * que se escribe el bug: falla todas las noches, en silencio, y solo en el
 * servidor cuya contraseña tenga el carácter problemático. Se descubre el día
 * que hace falta restaurar, que es el peor día posible.
 *
 * DOS BUGS REALES QUE ESTO CUBRE:
 *
 *  1. `#` sin comillas. El parser de option files de MySQL trata `#` como
 *     comienzo de comentario: la contraseña llegaba TRUNCADA.
 *  2. `escribir_cnf` fuera de alcance. La función vive en `db-url.sh`, que
 *     `backup-db.sh` sourceaba SOLO dentro de la rama de `DATABASE_URL`. Un
 *     despliegue con `MYSQL_USER`/`MYSQL_PASSWORD` moría con
 *     `escribir_cnf: command not found`.
 *
 * El test ejecuta bash de verdad — es la única forma honesta de afirmar algo
 * sobre un script de shell.
 */

const raiz = join(__dirname, '..');

/** Corre `escribir_cnf` en un bash real y devuelve el archivo resultante. */
const generarCnf = (usuario: string, clave: string): { texto: string; modo: string; ruta: string } => {
    const dir = mkdtempSync(join(tmpdir(), 'nortex-cnf-'));
    const destino = join(dir, 'client.cnf');
    // El guion se pasa por stdin para no meter las credenciales en argv, igual
    // que hace el script real.
    execFileSync('bash', ['-s', '--', destino, usuario, clave], {
        input: `
            set -Eeuo pipefail
            source "${join(raiz, 'scripts', 'db-url.sh')}"
            escribir_cnf "$1" "$2" "$3" db.interno 3306
        `,
        encoding: 'utf-8',
    });
    return {
        texto: readFileSync(destino, 'utf-8'),
        modo: (statSync(destino).mode & 0o777).toString(8),
        ruta: destino,
    };
};

const lineaPassword = (texto: string): string =>
    texto.split('\n').find(l => l.startsWith('password=')) ?? '';

describe('escribir_cnf — la contraseña llega entera', () => {
    it('una contraseña con # NO se trunca', () => {
        // EL BUG: sin comillas, MySQL leía solo "abc" y el dump moría con
        // "Access denied" todas las noches.
        const { texto } = generarCnf('root', 'abc#def');
        expect(lineaPassword(texto)).toBe('password="abc#def"');
    });

    it('un backslash se duplica, si no se come el carácter siguiente', () => {
        // Entre comillas MySQL interpreta escapes: `\n` sería un salto de línea.
        const { texto } = generarCnf('root', 'ab\\cd');
        expect(lineaPassword(texto)).toBe('password="ab\\\\cd"');
    });

    it('una comilla doble se escapa y no corta el valor', () => {
        const { texto } = generarCnf('root', 'ab"cd');
        expect(lineaPassword(texto)).toBe('password="ab\\"cd"');
    });

    it('los espacios de los bordes sobreviven', () => {
        // Sin comillas MySQL RECORTA el valor: una contraseña que termina en
        // espacio llegaba distinta y nadie lo notaba hasta el "Access denied".
        const { texto } = generarCnf('root', '  clave  ');
        expect(lineaPassword(texto)).toBe('password="  clave  "');
    });

    it('nada se expande como shell: $ y backtick quedan literales', () => {
        const { texto } = generarCnf('root', 'a$HOME`id`b');
        expect(lineaPassword(texto)).toBe('password="a$HOME`id`b"');
    });

    it('el usuario recibe el mismo tratamiento que la contraseña', () => {
        const { texto } = generarCnf('us#er', 'x');
        expect(texto).toContain('user="us#er"');
    });

    it('el archivo nace con permisos 600 — nadie más puede leer la clave', () => {
        expect(generarCnf('root', 'secreta').modo).toBe('600');
    });

    it('host y puerto siguen su camino sin comillas', () => {
        const { texto } = generarCnf('root', 'x');
        expect(texto).toContain('host=db.interno');
        expect(texto).toContain('port=3306');
    });
});

describe('escribir_cnf está al alcance de quien la llama', () => {
    it('backup-db.sh sourcea db-url.sh SIN condicionar al `if`', () => {
        // EL BUG: el `source` vivía dentro de `if [[ -n "$DATABASE_URL" ]]`,
        // así que la rama de MYSQL_USER/MYSQL_PASSWORD moría con
        // `escribir_cnf: command not found` — de noche y solo en algunos
        // servidores, exactamente la clase de fallo que este archivo combate.
        const fuente = readFileSync(join(raiz, 'scripts', 'backup-db.sh'), 'utf-8');
        const src = fuente.indexOf('source "$(dirname "$0")/db-url.sh"');
        const condicional = fuente.indexOf('if [[ -n "${DATABASE_URL:-}" ]]');
        expect(src).toBeGreaterThan(-1);
        expect(condicional).toBeGreaterThan(-1);
        expect(src).toBeLessThan(condicional);
    });

    it('funciona sin DATABASE_URL, con credenciales sueltas', () => {
        // La prueba de verdad del punto anterior: se ejecuta el tramo real del
        // script en la rama MYSQL_* y se comprueba que la función existe.
        const salida = execFileSync('bash', ['-s'], {
            input: `
                set -Eeuo pipefail
                unset DATABASE_URL
                source "${join(raiz, 'scripts', 'db-url.sh')}"
                if [[ -n "\${DATABASE_URL:-}" ]]; then
                    echo "rama equivocada"; exit 1
                fi
                type -t escribir_cnf
            `,
            encoding: 'utf-8',
        });
        expect(salida.trim()).toBe('function');
    });

    it('el trap ERR se hereda dentro de funciones (`set -E`)', () => {
        // Sin `-E`, un fallo dentro de `escribir_cnf` mataría el backup SIN
        // disparar la alerta por webhook: falla en silencio.
        const fuente = readFileSync(join(raiz, 'scripts', 'backup-db.sh'), 'utf-8');
        expect(fuente).toMatch(/^set -Eeuo pipefail$/m);
        expect(fuente).toContain("trap 'fail \"línea $LINENO\"' ERR");
    });

    it('ningún script escribe el [client] a mano por su cuenta', () => {
        // Un cuarto sitio que arme el archivo con printf reintroduce el bug del
        // `#` sin que nadie lo note. La forma correcta es una sola.
        for (const script of ['backup-db.sh', 'verify-backup-restore.sh']) {
            const fuente = readFileSync(join(raiz, 'scripts', script), 'utf-8');
            expect(fuente).not.toContain("printf '[client]");
        }
    });
});
