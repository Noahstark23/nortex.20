/**
 * NORTEX — Nortex Capital fuera de la interfaz del cliente, score en el panel admin.
 *
 * QUÉ PROTEGE ESTE ARCHIVO
 * ------------------------
 * 1. El abono en efectivo a un proveedor sale de la GAVETA del turno, no de
 *    `Tenant.walletBalance`. La billetera fintech no la tiene fondeada ninguna
 *    ferretería: mientras el abono la debitaba, TODO pago en efectivo moría con
 *    "no hay suficiente efectivo disponible" con la caja llena.
 * 2. El Dashboard del dueño no muestra billetera, score ni línea de crédito, y
 *    dejó de recalcular el score en cada apertura.
 * 3. El score se sigue calculando: hay un endpoint SUPER_ADMIN que lo recalcula
 *    y persiste con auditoría, y un botón en el panel que lo dispara. Sin eso,
 *    quitar la pantalla del dueño habría congelado la columna del admin.
 *
 * Se asegura sobre el TEXTO de las rutas (mismo patrón que
 * tests/supplierPaymentRoute.test.ts): server.ts no se puede montar en un test
 * unitario, pero un revert accidental sí cambia estas líneas.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const leer = (ruta: string) => readFileSync(resolve(process.cwd(), ruta), 'utf8');

const server = leer('backend/server.ts');
const dashboard = leer('components/Dashboard.tsx');
const superAdmin = leer('components/SuperAdmin.tsx');
const servicio = leer('backend/services/supplierPaymentService.ts');
const scoring = leer('backend/services/scoring.ts');

const rebanar = (texto: string, desde: string, hasta: string, nombre: string) => {
    const inicio = texto.indexOf(desde);
    const fin = texto.indexOf(hasta, inicio + desde.length);
    if (inicio < 0 || fin < 0) throw new Error(`No se encontró ${nombre}`);
    return texto.slice(inicio, fin);
};

const rutaDePago = rebanar(
    server,
    '// POST /api/purchases/:id/pay',
    "// GET /api/purchases/pending",
    'la ruta de abono a proveedor',
);

const rutaDeScore = rebanar(
    server,
    "app.post('/api/admin/tenants/:id/score'",
    '\n// ',
    'la ruta admin de score',
);

describe('el abono en efectivo sale de la caja, no de la billetera fintech', () => {
    it('la ruta resuelve el turno abierto antes de la transacción y lo pasa al servicio', () => {
        expect(rutaDePago).toContain('normalizeSupplierPaymentMethod(req.body?.method)');
        expect(rutaDePago).toContain('resolverTurnoAbierto(authReq.tenantId!, authReq.userId!)');
        expect(rutaDePago).toContain('shiftId: turnoDelAbono?.id ?? null');
        // El servicio exige caja para pagos nuevos, después del replay.
        // El recorrido HTTP de purchaseFlow prueba ambos casos con caja cerrada.
        expect(servicio).toContain("SupplierPaymentError('NO_OPEN_SHIFT', 409, MENSAJE_SIN_CAJA_ABIERTA)");
    });

    it('el turno solo se exige cuando el abono es en efectivo', () => {
        // TRANSFER/CARD/QR liquidan contra Bancos: pedirles caja abierta
        // bloquearía un pago que no toca la gaveta.
        expect(rutaDePago).toMatch(/metodoDelAbono === 'CASH'\s*\n\s*\?\s*await resolverTurnoAbierto/u);
        expect(rutaDePago).not.toContain("if (metodoDelAbono === 'CASH' && !turnoDelAbono)");
    });

    it('traduce los errores de la gaveta a su propio status, no a un 500 genérico', () => {
        expect(rutaDePago).toContain(
            'error instanceof PayableSupplierPaymentError || error instanceof CashSupplierPaymentError',
        );
        expect(rutaDePago).toContain('res.status(error.httpStatus)');
    });

    it('el servicio ya no debita Tenant.walletBalance en ningún camino', () => {
        // Sobre CÓDIGO, no sobre el comentario que explica por qué se fue.
        expect(servicio).not.toContain('tenant.updateMany');
        expect(servicio).not.toMatch(/walletBalance:\s*\{/u);
        expect(servicio).not.toContain('INSUFFICIENT_CASH_BALANCE');
        expect(servicio).toContain('registrarSalidaDeCajaPorAbonoProveedor');
    });

    it('toma el lock del turno DESPUÉS del de la compra (orden global anti-deadlock)', () => {
        // /api/purchases y /api/returns también dejan Shift al final. Invertirlo
        // acá traba una compra de contado contra un abono del mismo turno.
        const lockCompra = servicio.indexOf('FOR UPDATE');
        const debitoGaveta = servicio.indexOf('registrarSalidaDeCajaPorAbonoProveedor(');
        expect(lockCompra).toBeGreaterThan(0);
        expect(debitoGaveta).toBeGreaterThan(lockCompra);

        // Y la gaveta ANTES del mayor: /api/purchases hace lo mismo
        // (registrarSalidaDeCajaPorCompra y recién después recordPurchase), así
        // que una compra de contado y un abono concurrentes toman Shift →
        // LedgerHead → Account en el mismo orden y no se traban.
        expect(servicio.indexOf('recordSupplierPayment(')).toBeGreaterThan(debitoGaveta);
    });

    it('deja el movimiento de gaveta en el AuditLog del abono (Capa 3)', () => {
        expect(servicio).toContain('efectivoAntes: debitoDeGaveta.efectivoAntes.toFixed(2)');
        expect(servicio).toContain('efectivoDespues: debitoDeGaveta.efectivoDespues.toFixed(2)');
    });
});

describe('el Dashboard del dueño no habla de Nortex Capital', () => {
    it('no queda billetera, score ni línea de crédito en pantalla', () => {
        expect(dashboard).not.toContain('tenantData.walletBalance');
        expect(dashboard).not.toContain('tenantData.creditLimit');
        expect(dashboard).not.toContain('tenantData.creditScore');
        expect(dashboard).not.toContain('Saldo en billetera');
        expect(dashboard).not.toContain('Línea disponible');
        expect(dashboard).not.toContain('Solicitar desembolso');
    });

    it('no llama a los endpoints de Capital', () => {
        expect(dashboard).not.toContain('/api/fintech/score');
        expect(dashboard).not.toContain('/api/loans/request');
    });

    it('conserva lo que sí es del negocio', () => {
        expect(dashboard).toContain('/api/dashboard/stats');
        expect(dashboard).toContain('Flujo de caja real');
        expect(dashboard).toContain('Cuánto podrías retirar');
    });
});

describe('el score se sigue calculando, ahora desde el panel admin', () => {
    it('la ruta es exclusiva de SUPER_ADMIN y persiste score y línea', () => {
        expect(rutaDeScore).toContain('authenticate, requireSuperAdmin');
        expect(rutaDeScore).toContain('calculateTenantScore(tenantId)');
        expect(rutaDeScore).toContain('creditScore: analisis.score');
        expect(rutaDeScore).toContain('creditLimit: analisis.creditLimit');
    });

    it('audita el cambio de línea de crédito con before/after en la misma transacción', () => {
        expect(rutaDeScore).toContain("action: 'ADMIN_SCORE_RECALCULATED'");
        expect(rutaDeScore).toContain('tx.auditLog.create');
        // El análisis pesado corre FUERA de la tx (guardrail de transacciones cortas).
        expect(rutaDeScore.indexOf('calculateTenantScore(tenantId)')).toBeLessThan(
            rutaDeScore.indexOf('prisma.$transaction'),
        );
    });

    it('el panel admin puede dispararlo por empresa', () => {
        expect(superAdmin).toContain('/api/admin/tenants/${tenantId}/score');
        expect(superAdmin).toContain('handleRecalcularScore');
    });

    it('el cálculo respeta los guardrails de escalado', () => {
        // Un `new PrismaClient()` propio (uno de los ~21 del repo) y un findMany
        // sin límite sobre Sale: el score traía a memoria un mes entero de ventas
        // para sacar de ahí un conteo y una suma.
        expect(scoring).not.toContain('new PrismaClient()');
        expect(scoring).toContain("from '../lib/prisma'");
        expect(scoring).not.toContain('prisma.sale.findMany');
        expect(scoring).toContain('prisma.sale.aggregate');
        // `take` sin `orderBy` dejaba que MySQL eligiera 30 turnos cualesquiera.
        expect(scoring).toContain("orderBy: { startTime: 'desc' }");
    });
});
