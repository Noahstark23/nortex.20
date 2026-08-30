import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ORDEN DE BLOQUEO GLOBAL: Product ANTES que Shift.
 *
 * Tres transacciones del sistema bloquean las MISMAS dos tablas:
 *   · executeSaleWithResult (venta POS):             Product → Shift
 *   · POST /api/returns    (reembolso en efectivo): Sale → Product → Shift
 *   · POST /api/purchases  (compra de contado):     Supplier → Product → Shift
 *
 * Si una de las dos invierte el orden, una devolución y una compra de contado
 * del mismo producto sobre el mismo turno se deadlockean (InnoDB mata una con
 * ER_LOCK_DEADLOCK y el handler la devuelve como 500). Ya pasó una vez: se
 * adelantó el `FOR UPDATE` del turno en /api/purchases creyendo que la
 * devolución era Shift → Product. No lo es: la devolución prebloquea los
 * productos en orden determinista antes de tomar el turno.
 *
 * Este test lee el CÓDIGO FUENTE porque el orden de bloqueo no se puede
 * observar desde afuera sin dos conexiones MySQL reales peleando: es una
 * propiedad estructural del handler, y lo que hay que impedir es que alguien la
 * cambie de un lado sin mirar el otro.
 */

const SERVER = readFileSync(join(__dirname, '..', 'backend', 'server.ts'), 'utf-8');

/** Cuerpo de un handler: desde su `app.<verbo>('<ruta>'` hasta el próximo `app.` de nivel superior. */
function cuerpoDelHandler(inicio: string): string {
    const desde = SERVER.indexOf(inicio);
    expect(desde, `no se encontró el handler ${inicio}`).toBeGreaterThan(-1);
    const resto = SERVER.slice(desde + inicio.length);
    const hasta = resto.search(/\napp\.(get|post|put|patch|delete|use)\(/);
    return hasta === -1 ? resto : resto.slice(0, hasta);
}

/** Posición del primer lock exclusivo sobre `Shift` (el `FOR UPDATE` del turno). */
function posicionLockDeTurno(cuerpo: string): number {
    const m = cuerpo.match(/FROM\s+\\`Shift\\`[\s\S]{0,400}?FOR UPDATE/);
    return m?.index ?? -1;
}

/** Posición del primer punto donde se toma el lock de `Product` (updateMany de stock). */
function posicionLockDeProducto(cuerpo: string): number {
    const candidatos = [
        cuerpo.indexOf('applyStockDelta'),
        cuerpo.search(/FROM\s+\\`Product\\`[\s\S]{0,300}?FOR UPDATE/),
    ].filter((i) => i > -1);
    return candidatos.length === 0 ? -1 : Math.min(...candidatos);
}

describe('orden de bloqueo Product → Shift', () => {
    it('la venta POS prebloquea productos ordenados antes de validar el turno OPEN', () => {
        const servicio = readFileSync(
            join(__dirname, '..', 'backend', 'services', 'salesService.ts'),
            'utf-8',
        );
        const transactionStart = servicio.indexOf('const sale = await prisma.$transaction');
        const productLock = servicio.indexOf('await lockSaleProductsInOrder', transactionStart);
        const shiftLock = servicio.indexOf('await lockOpenOwnedPosShift', transactionStart);

        expect(productLock).toBeGreaterThan(transactionStart);
        expect(shiftLock).toBeGreaterThan(productLock);
        expect(servicio).toMatch(
            /const orderedIds = \[\.\.\.new Set\(productIds\)\]\.sort\(\);[\s\S]{0,180}?for \(const productId of orderedIds\)/,
        );
        expect(servicio).toMatch(
            /FROM \\`Product\\`[\s\S]{0,300}?AND \\`tenantId\\` = \$\{tenantId\}[\s\S]{0,160}?FOR UPDATE/,
        );
    });

    it('la devolución en efectivo toca el stock ANTES de bloquear el turno', () => {
        const cuerpo = cuerpoDelHandler("app.post('/api/returns'");

        const producto = posicionLockDeProducto(cuerpo);
        const turno = posicionLockDeTurno(cuerpo);

        expect(producto, 'la devolución debe seguir moviendo stock').toBeGreaterThan(-1);
        expect(turno, 'la devolución debe seguir bloqueando el turno para el reembolso CASH').toBeGreaterThan(-1);
        expect(producto).toBeLessThan(turno);

        const preparacionOrdenada = cuerpo.match(
            /const returnProductIdsInLockOrder = [\s\S]{0,200}?\.sort\(\);[\s\S]{0,120}?for \(const productId of returnProductIdsInLockOrder\)/,
        );
        expect(
            preparacionOrdenada,
            'los productos deben bloquearse una sola vez y en orden determinista',
        ).not.toBeNull();

        const lockAntesDelTurno = cuerpo.slice(producto, turno);
        expect(lockAntesDelTurno).toMatch(
            /FROM\s+\\`Product\\`[\s\S]{0,200}?WHERE id = \$\{productId\}[\s\S]{0,120}?AND \\`tenantId\\` = \$\{authReq\.tenantId\}[\s\S]{0,80}?FOR UPDATE/,
        );
    });

    it('la compra de contado NO adelanta el lock del turno antes del stock', () => {
        const cuerpo = cuerpoDelHandler("app.post('/api/purchases'");

        const producto = posicionLockDeProducto(cuerpo);
        const turno = posicionLockDeTurno(cuerpo);

        expect(producto, 'la compra debe seguir moviendo stock').toBeGreaterThan(-1);
        // El turno lo toma `registrarSalidaDeCajaPorCompra` (fuera de este
        // handler). Si alguien vuelve a poner un FOR UPDATE de Shift acá, tiene
        // que quedar DESPUÉS del stock o el orden se invierte contra /api/returns.
        if (turno > -1) {
            expect(
                producto,
                'un FOR UPDATE de Shift antes del stock invierte el orden contra /api/returns y abre el deadlock',
            ).toBeLessThan(turno);
        }
    });

    it('el débito de la gaveta toma el turno recién en el servicio de pago', () => {
        const servicio = readFileSync(
            join(__dirname, '..', 'backend', 'services', 'supplierPayment.ts'),
            'utf-8',
        );
        // El lock del turno vive en `debitarGaveta`, que los dos caminos de
        // compra llaman DESPUÉS de haber movido el stock.
        expect(servicio).toMatch(/FROM\s+\\`Shift\\`[\s\S]{0,300}?FOR UPDATE/);
        expect(servicio.indexOf('async function debitarGaveta')).toBeLessThan(
            servicio.search(/FROM\s+\\`Shift\\`[\s\S]{0,300}?FOR UPDATE/),
        );
    });
});
