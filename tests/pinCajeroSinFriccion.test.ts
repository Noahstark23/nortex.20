import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guarda de ALCANCE del PIN del cajero.
 *
 * Estos no son tests de lógica —esa vive en tests/shiftIdentity.test.ts— sino
 * guardas contra tres regresiones concretas que YA ocurrieron en este repo y
 * que ninguna prueba unitaria habría cazado, porque el bug no estaba en una
 * función sino en QUIÉN hacía la verificación y en QUÉ se mandaba al navegador.
 */

const raiz = join(__dirname, '..');
const leer = (ruta: string) => readFileSync(join(raiz, ruta), 'utf-8');

/**
 * Estas guardas juzgan CÓDIGO, no prosa. Sin esto se disparaban con los
 * comentarios que EXPLICAN el bug arreglado —"antes se comparaba
 * `empleado.pin === tecleado`"— lo cual castiga justo la documentación que hace
 * el arreglo entendible dentro de seis meses.
 *
 * Solo saca comentarios de línea COMPLETA y bloques `/* *\/`: un `//` a mitad de
 * línea puede ser una URL. Alcanza para lo que estas guardas miran.
 */
const soloCodigo = (fuente: string): string =>
    fuente
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter(l => {
            const t = l.trim();
            return !t.startsWith('//') && !t.startsWith('*');
        })
        .join('\n');

describe('el PIN no se verifica en el navegador', () => {
    it('el POS no compara PINes contra la lista de empleados', () => {
        // EL BUG REAL: el "fiado inteligente" pedía GET /api/employees y hacía
        // `empleado.pin === pinTecleado`. Pero ese endpoint BORRA el pin de la
        // respuesta, así que la comparación era `undefined === '1234'`: la
        // autorización NUNCA funcionó, le decía "PIN incorrecto" al dueño
        // tecleando su propio PIN. Y si el PIN sí hubiera viajado habría sido
        // peor: cualquiera con la consola abierta leía los PINes del personal.
        const pos = soloCodigo(leer('components/POS.tsx'));
        expect(pos).not.toMatch(/\.pin\s*===/);
        expect(pos).not.toMatch(/===\s*\w*[Pp]in\b(?!\w)/);
    });

    it('la autorización de crédito pasa por el endpoint del servidor', () => {
        expect(leer('components/POS.tsx')).toContain('/api/employees/verify-pin');
    });

    it('el endpoint de empleados sigue borrando el PIN de la respuesta', () => {
        // Si alguien "arregla" el fiado devolviendo el PIN, este test lo caza.
        // La respuesta correcta al problema fue mover la verificación, no
        // aflojar la respuesta.
        expect(leer('backend/server.ts')).toMatch(/const \{ pin, bankAccount, \.\.\.safeEmp \} = emp/);
    });

    it('verify-pin no distingue "no existe" de "existe pero no autoriza"', () => {
        // Si las dos respuestas fueran distintas, el endpoint serviría para
        // enumerar los PINes del personal a razón de un intento por consulta.
        const fuente = leer('backend/server.ts');
        const ruta = fuente.slice(fuente.indexOf(`app.post('/api/employees/verify-pin'`));
        const bloque = ruta.slice(0, ruta.indexOf('app.patch'));
        // Un solo camino de rechazo, con un solo mensaje.
        expect((bloque.match(/autorizado: false/g) ?? []).length).toBe(1);
    });
});

describe('el PIN sembrado no vive en el frontend', () => {
    it('el POS no trae el PIN inicial del dueño hardcodeado', () => {
        // El modal IMPRIMÍA "tu PIN inicial es 1234" y además lo precargaba.
        // Un secreto que la pantalla revela y rellena no es un control de
        // acceso; era un peaje. Ahora no hay PIN que precargar.
        const pos = soloCodigo(leer('components/POS.tsx'));
        expect(pos).not.toMatch(/PIN_DUENO_POR_DEFECTO\s*=\s*'/);
        expect(pos).not.toMatch(/employeePin.*=.*'1234'/);
    });
});

describe('la apertura de caja no exige PIN por defecto', () => {
    it('el schema de validación acepta la apertura sin PIN', () => {
        const schemas = leer('backend/validation/schemas.ts');
        const abrir = schemas.slice(schemas.indexOf('export const OpenShiftSchema'));
        const bloque = abrir.slice(0, abrir.indexOf('});'));
        expect(bloque).toContain('employeePin');
        expect(bloque).toContain('.optional()');
        // Pero el formato sigue siendo estricto: un PIN mal formado tiene que
        // fallar como PIN incorrecto, NUNCA colarse como "no vino" y abrir la
        // caja a nombre de otro.
        expect(bloque).toMatch(/regex\(\/\^\\d\{4\}\$\//);
    });

    it('la columna del negocio arranca apagada', () => {
        const schema = leer('backend/prisma/schema.prisma');
        expect(schema).toMatch(/requireCashierPin\s+Boolean\s+@default\(false\)/);
    });

    it('la migración es aditiva: solo agrega la columna', () => {
        const sql = leer('backend/prisma/migrations/20260823_pin_cajero_opcional/migration.sql');
        expect(sql).toContain('ADD COLUMN `requireCashierPin`');
        // El deploy corre `db push` SIN --accept-data-loss: cualquier DDL
        // destructivo acá haría fallar el arranque en vez de borrar prod.
        expect(sql).not.toMatch(/DROP|TRUNCATE|DELETE FROM/i);
    });
});

describe('el rate limit de apertura no castiga a toda la tienda', () => {
    it('authenticate corre ANTES del limiter, si no la llave por usuario no existe', () => {
        // Si el limiter fuera primero, `req.userId` estaría vacío y la llave
        // caería siempre al fallback por IP — el cambio no serviría de nada y
        // nadie lo notaría, porque igual limita.
        const fuente = leer('backend/server.ts');
        const ruta = fuente.slice(fuente.indexOf(`app.post('/api/shifts/open'`));
        const firma = ruta.slice(0, ruta.indexOf('async'));
        expect(firma.indexOf('authenticate')).toBeGreaterThan(-1);
        expect(firma.indexOf('shiftOpenLimiter')).toBeGreaterThan(-1);
        expect(firma.indexOf('authenticate')).toBeLessThan(firma.indexOf('shiftOpenLimiter'));
    });

    it('una apertura SIN PIN no gasta cupo del limiter', () => {
        // Sin PIN no hay nada que adivinar: la identidad la resuelve el
        // servidor desde el JWT. El cupo se reserva para lo adivinable.
        const fuente = leer('backend/server.ts');
        const limiter = fuente.slice(fuente.indexOf('const shiftOpenLimiter'));
        expect(limiter.slice(0, limiter.indexOf('});'))).toContain('skip:');
    });
});
