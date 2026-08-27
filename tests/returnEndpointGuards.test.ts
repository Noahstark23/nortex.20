import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const server = readFileSync(resolve(process.cwd(), 'backend/server.ts'), 'utf8');
const pos = readFileSync(resolve(process.cwd(), 'components/POS.tsx'), 'utf8');

const locate = (source: string, pattern: string | RegExp): number => {
    if (typeof pattern === 'string') return source.indexOf(pattern);
    const match = pattern.exec(source);
    return match?.index ?? -1;
};

const between = (source: string, start: string | RegExp, end: string | RegExp): string => {
    const from = locate(source, start);
    const startLength = typeof start === 'string' ? start.length : 1;
    const tail = source.slice(from + Math.max(startLength, 1));
    const tailOffset = locate(tail, end);
    const to = tailOffset < 0 ? -1 : from + Math.max(startLength, 1) + tailOffset;
    if (from < 0 || to < 0) throw new Error(`No se encontró el bloque ${String(start)}`);
    return source.slice(from, to);
};

const searchRoute = between(
    server,
    "app.get('/api/sales/search'",
    /app\.post\(\s*['"]\/api\/returns['"]/,
);
const returnRoute = between(
    server,
    /app\.post\(\s*['"]\/api\/returns['"]/,
    /app\.post\(\s*['"]\/api\/payments['"]/,
);
const returnSubmitFlow = between(
    pos,
    'const returnCreditReduction =',
    'if (shiftLoading)',
);
const returnRefundSelector = between(
    pos,
    '{returnRequiresRefundMethod && (',
    '{/* Confirm */}',
);

describe('guardas estructurales de devoluciones', () => {
    it('el POS solo envía refundMethod para crédito con importe ya liquidado', () => {
        expect(returnSubmitFlow).toContain(
            "const returnRequiresRefundMethod = returnSaleData?.paymentMethod === 'CREDIT'",
        );
        expect(returnSubmitFlow).toContain('&& returnSettledRefund.greaterThan(0)');
        expect(returnSubmitFlow).toContain(
            '...(returnRequiresRefundMethod ? { refundMethod: returnRefundMethod } : {})',
        );
        expect(returnSubmitFlow.match(/refundMethod:/g)).toHaveLength(1);
        expect(returnRefundSelector).toContain('id="return-refund-method"');
        expect(returnRefundSelector).toContain('value={returnRefundMethod}');
        expect(returnRefundSelector).toContain('returnSaleData.allowedRefundMethods.map');
    });

    it('aísla por tenant tanto la búsqueda como la transacción de devolución', () => {
        expect(searchRoute).toContain('tenantId: authReq.tenantId');
        expect(searchRoute).toContain('where: { saleId: sale.id, tenantId: authReq.tenantId }');

        expect(returnRoute).toContain('WHERE id = ${saleId} AND \\`tenantId\\` = ${authReq.tenantId}');
        expect(returnRoute).toContain('where: { id: saleId, tenantId: authReq.tenantId }');
        expect(returnRoute).toContain('where: { saleId, tenantId: authReq.tenantId }');
        expect(returnRoute).toContain('where: { tenantId: authReq.tenantId, id: { in: productIds } }');
    });

    it('bloquea la venta antes de releer el historial que limita la cantidad', () => {
        const transactionIndex = returnRoute.indexOf('prisma.$transaction');
        const saleLockIndex = returnRoute.indexOf('SELECT id FROM \\`Sale\\`');
        const forUpdateIndex = returnRoute.indexOf('FOR UPDATE', saleLockIndex);
        const historyIndex = returnRoute.indexOf('tx.productReturn.findMany');
        const resolutionIndex = returnRoute.indexOf('resolveRequestedReturnItems');

        expect(transactionIndex).toBeGreaterThan(-1);
        expect(saleLockIndex).toBeGreaterThan(transactionIndex);
        expect(forUpdateIndex).toBeGreaterThan(saleLockIndex);
        expect(historyIndex).toBeGreaterThan(forUpdateIndex);
        expect(resolutionIndex).toBeGreaterThan(historyIndex);
    });

    it('mantiene stock, Kardex, contabilidad y auditoría dentro de la misma transacción', () => {
        expect(returnRoute).toContain('applyStockDelta(tx');
        expect(returnRoute).toContain('tx.kardexMovement.create');
        expect(returnRoute).toMatch(/recordReturn\(\s*tx,/);
        expect(returnRoute).toContain('tx.auditLog.create');
        expect(returnRoute.indexOf('res.json({ ...result.productReturn')).toBeGreaterThan(returnRoute.indexOf('tx.auditLog.create'));
    });

    it('reclama tenant+clientEventId antes de cualquier efecto y persiste la huella canónica', () => {
        const hashIndex = returnRoute.indexOf('buildReturnPayloadHash');
        const fastReplayIndex = returnRoute.indexOf('const preexistingReturn = await prisma.productReturn.findFirst');
        const transactionIndex = returnRoute.indexOf('prisma.$transaction');
        const saleLockIndex = returnRoute.indexOf('SELECT id FROM \\`Sale\\`');
        const replayReadIndex = returnRoute.indexOf('const existingReturn = await tx.productReturn.findFirst');
        const stockIndex = returnRoute.indexOf('applyStockDelta(tx');
        const createIndex = returnRoute.indexOf('tx.productReturn.create');
        const createEnd = returnRoute.indexOf('// Stock y Kardex', createIndex);

        expect(hashIndex).toBeGreaterThan(-1);
        expect(fastReplayIndex).toBeGreaterThan(hashIndex);
        expect(returnRoute.slice(fastReplayIndex, transactionIndex)).toContain('tenantId: authReq.tenantId');
        expect(returnRoute.slice(fastReplayIndex, transactionIndex)).toContain('clientEventId');
        expect(saleLockIndex).toBeGreaterThan(transactionIndex);
        expect(replayReadIndex).toBeGreaterThan(saleLockIndex);
        expect(returnRoute.slice(replayReadIndex, createIndex)).toContain('tenantId: authReq.tenantId');
        expect(returnRoute.slice(replayReadIndex, createIndex)).toContain('clientEventId');
        expect(createIndex).toBeGreaterThan(replayReadIndex);
        expect(returnRoute.slice(createIndex, createEnd)).toContain('clientEventId,');
        expect(returnRoute.slice(createIndex, createEnd)).toContain('payloadHash,');
        expect(stockIndex).toBeGreaterThan(createIndex);
    });

    it('un replay idéntico retorna la fila existente y una reutilización distinta da 409', () => {
        const existingIndex = returnRoute.indexOf('if (existingReturn)');
        const replayAssertIndex = returnRoute.indexOf('assertMatchingReturnReplay', existingIndex);
        const replayReturnIndex = returnRoute.indexOf('idempotentReplay: true', replayAssertIndex);
        const uniqueCatchIndex = returnRoute.indexOf("error?.code === 'P2002'");
        const fallbackQueryIndex = returnRoute.indexOf('prisma.productReturn.findFirst', uniqueCatchIndex);

        expect(existingIndex).toBeGreaterThan(-1);
        expect(replayAssertIndex).toBeGreaterThan(existingIndex);
        expect(replayReturnIndex).toBeGreaterThan(replayAssertIndex);
        expect(uniqueCatchIndex).toBeGreaterThan(replayReturnIndex);
        expect(fallbackQueryIndex).toBeGreaterThan(uniqueCatchIndex);
        expect(returnRoute.slice(fallbackQueryIndex)).toContain('tenantId: authReq.tenantId');
        expect(returnRoute.slice(fallbackQueryIndex)).toContain('clientEventId');
        expect(returnRoute).toContain('idempotentReplay: result.idempotentReplay');
    });

    it('el POS conserva la UUID para retries y la rota al cambiar el payload material', () => {
        expect(pos).toContain("const returnRequestRef = useRef<{ signature: string; clientEventId: string } | null>(null)");
        expect(returnSubmitFlow).toContain('const signature = JSON.stringify(materialPayload)');
        expect(returnSubmitFlow).toContain('returnRequestRef.current.signature !== signature');
        expect(returnSubmitFlow).toContain('clientEventId: generateOfflineId()');
        expect(returnSubmitFlow).toContain('clientEventId: returnRequestRef.current.clientEventId');
        expect(pos).toContain('returnRequestRef.current = null;');
    });

    it('restituye existencias en la ubicación original de la venta cuando es inequívoca', () => {
        expect(returnRoute).toContain('tx.kardexMovement.findMany');
        expect(returnRoute).toContain('referenceId: saleId');
        expect(returnRoute).toContain("referenceType: 'SALE'");
        expect(returnRoute).toContain("type: 'SALE'");
        expect(returnRoute).toContain('pedidos: { select: { id: true } }');
        expect(returnRoute).toContain('const pedidoReferenceIds = sale.pedidos.map');
        expect(returnRoute).toContain("referenceType: { in: ['PEDIDO_RESERVA', 'PEDIDO_VENTA'] }");
        expect(returnRoute).toContain("type: 'OUT'");
        expect(returnRoute).toContain('const returnWarehouseId = resolveReturnWarehouseId(saleKardexLocations)');
        expect(returnRoute).toContain('warehouseId: returnWarehouseId ?? undefined');
    });

    it('bloquea la caja actual, revalida efectivo y registra un único movimiento firmado', () => {
        const cashBlockStart = returnRoute.indexOf(
            "if (settledRefund.greaterThan(0) && refundMethod === 'CASH')",
        );
        const shiftLockIndex = returnRoute.indexOf('FROM \\`Shift\\`', cashBlockStart);
        const shiftForUpdateIndex = returnRoute.indexOf('FOR UPDATE', shiftLockIndex);
        const balanceIndex = returnRoute.indexOf('calcularEfectivoTurno', shiftForUpdateIndex);
        const movementIndex = returnRoute.indexOf('appendSignedCashMovement', balanceIndex);

        expect(cashBlockStart).toBeGreaterThan(-1);
        expect(returnRoute.slice(cashBlockStart, shiftLockIndex)).toContain("status: 'OPEN'");
        expect(shiftLockIndex).toBeGreaterThan(cashBlockStart);
        expect(returnRoute.slice(shiftLockIndex, shiftForUpdateIndex)).toContain('AND \\`tenantId\\` = ${authReq.tenantId}');
        expect(shiftForUpdateIndex).toBeGreaterThan(shiftLockIndex);
        expect(balanceIndex).toBeGreaterThan(shiftForUpdateIndex);
        expect(returnRoute).toContain("'RETURN_CASH_INSUFFICIENT'");
        expect(movementIndex).toBeGreaterThan(balanceIndex);
        expect(returnRoute.slice(movementIndex)).toContain("category: 'DEVOLUCION'");
        expect(returnRoute.match(/appendSignedCashMovement/g)).toHaveLength(1);
        expect(returnRoute).not.toContain('recordCashMovement');
    });

    it('envía el split a contabilidad y deja IDs de caja y turno en auditoría', () => {
        const accountingIndex = returnRoute.indexOf('await recordReturn(');
        const auditIndex = returnRoute.indexOf('tx.auditLog.create', accountingIndex);

        expect(accountingIndex).toBeGreaterThan(-1);
        const accountingBlock = returnRoute.slice(accountingIndex, auditIndex);
        expect(accountingBlock).toContain('exemptTotal: resolved.exemptTotal');
        expect(accountingBlock).toContain('creditReduction,');
        expect(accountingBlock).toContain('settledRefund,');
        expect(accountingBlock).toContain("refundMethod: refundMethod ?? 'CASH'");
        expect(auditIndex).toBeGreaterThan(accountingIndex);
        expect(returnRoute.slice(auditIndex)).toContain('cashMovementId,');
        expect(returnRoute.slice(auditIndex)).toContain('refundShiftId,');
        expect(returnRoute.slice(auditIndex)).toContain('refundMethod,');
    });

    it('restaura lotes dentro de la transacción usando el historial leído bajo lock', () => {
        const transactionIndex = returnRoute.indexOf('prisma.$transaction');
        const historyIndex = returnRoute.indexOf('tx.productReturn.findMany');
        const batchCallIndex = returnRoute.indexOf('await restoreSaleItemBatchesForReturn(tx');
        const batchCallEnd = returnRoute.indexOf('});', batchCallIndex);
        const persistenceIndex = returnRoute.indexOf('const persistItems', batchCallEnd);
        const batchCall = returnRoute.slice(batchCallIndex, batchCallEnd);

        expect(transactionIndex).toBeGreaterThan(-1);
        expect(historyIndex).toBeGreaterThan(transactionIndex);
        expect(batchCallIndex).toBeGreaterThan(historyIndex);
        expect(persistenceIndex).toBeGreaterThan(batchCallEnd);
        expect(batchCall).toContain('tenantId: authReq.tenantId!');
        expect(batchCall).toContain('saleItemId: item.saleItemId');
        expect(batchCall).toContain('productId: item.productId');
        expect(batchCall).toContain('quantity: item.quantity');
        expect(batchCall).toContain('previousReturns,');
    });

    it('persiste evidencia por lote y el remanente agregado en ProductReturn.items', () => {
        const persistenceIndex = returnRoute.indexOf(
            'const persistItems = resolvedWithBatches.map',
        );
        const createIndex = returnRoute.indexOf('tx.productReturn.create', persistenceIndex);
        const persistenceBlock = returnRoute.slice(persistenceIndex, createIndex);
        const createBlockEnd = returnRoute.indexOf('// Stock y Kardex', createIndex);
        const createBlock = returnRoute.slice(createIndex, createBlockEnd);

        expect(persistenceIndex).toBeGreaterThan(-1);
        expect(persistenceBlock).toContain('batchRestorationMode: batchRestoration.mode');
        expect(persistenceBlock).toContain('batchRestorations: batchRestoration.batchRestorations.map');
        expect(persistenceBlock).toContain('batchId: restoration.batchId');
        expect(persistenceBlock).toContain('quantity: restoration.quantity.toString()');
        expect(persistenceBlock).toContain(
            'aggregateOnlyQuantity: batchRestoration.aggregateOnlyQuantity.toString()',
        );
        expect(createBlock).toContain('items: persistItems');
    });

    it('mueve stock agregado una vez y desglosa Kardex por lote más fallback sin batch', () => {
        expect(returnRoute.match(/applyStockDelta\(tx/g)).toHaveLength(1);

        const stockIndex = returnRoute.indexOf('const stockResult = await applyStockDelta(tx');
        const batchKardexIndex = returnRoute.indexOf(
            'for (const restoration of batchRestoration.batchRestorations)',
            stockIndex,
        );
        const aggregateKardexIndex = returnRoute.indexOf(
            'if (batchRestoration.aggregateOnlyQuantity.greaterThan(0))',
            batchKardexIndex,
        );
        const invariantIndex = returnRoute.indexOf(
            'if (stockCursor.minus(stockResult.stockAfter)',
            aggregateKardexIndex,
        );
        const batchKardexBlock = returnRoute.slice(batchKardexIndex, aggregateKardexIndex);
        const aggregateKardexBlock = returnRoute.slice(aggregateKardexIndex, invariantIndex);

        expect(stockIndex).toBeGreaterThan(-1);
        expect(batchKardexIndex).toBeGreaterThan(stockIndex);
        expect(batchKardexBlock).toContain('tx.kardexMovement.create');
        expect(batchKardexBlock).toContain('quantity: restoration.quantity.toNumber()');
        expect(batchKardexBlock).toContain('batchId: restoration.batchId');

        expect(aggregateKardexIndex).toBeGreaterThan(batchKardexIndex);
        expect(aggregateKardexBlock).toContain('tx.kardexMovement.create');
        expect(aggregateKardexBlock).toContain(
            'quantity: batchRestoration.aggregateOnlyQuantity.toNumber()',
        );
        expect(aggregateKardexBlock).not.toMatch(/\bbatchId\s*:/);
        expect(invariantIndex).toBeGreaterThan(aggregateKardexIndex);
    });

    it('traduce BatchRestorationError sin ocultar su status ni código', () => {
        const catchIndex = returnRoute.indexOf('if (error instanceof BatchRestorationError)');
        const returnErrorIndex = returnRoute.indexOf('if (error instanceof ReturnResolutionError)');
        const catchBlock = returnRoute.slice(catchIndex, returnErrorIndex);

        expect(catchIndex).toBeGreaterThan(-1);
        expect(catchBlock).toContain('res.status(error.httpStatus)');
        expect(catchBlock).toContain('code: error.code');
        expect(returnErrorIndex).toBeGreaterThan(catchIndex);
    });
});
