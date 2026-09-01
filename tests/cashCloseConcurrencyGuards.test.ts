import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const server = readFileSync(join(__dirname, '..', 'backend', 'server.ts'), 'utf8');
const legacyShiftCloseService = readFileSync(
    join(__dirname, '..', 'backend', 'services', 'legacyShiftCloseService.ts'),
    'utf8',
);
const salesService = readFileSync(
    join(__dirname, '..', 'backend', 'services', 'salesService.ts'),
    'utf8',
);

function handlerBody(source: string, start: string): string {
    const from = source.indexOf(start);
    expect(from, `no se encontró ${start}`).toBeGreaterThan(-1);
    const rest = source.slice(from + start.length);
    const end = rest.search(/\napp\.(get|post|put|patch|delete|use)\(/);
    return end === -1 ? rest : rest.slice(0, end);
}

describe('serialización del cierre de caja legacy', () => {
    it('bloquea el turno antes de reclamarlo y calcula el arqueo sobre la reread cerrada', () => {
        const lockIndex = legacyShiftCloseService.indexOf('const lockedShiftRows: Array<{ id: string }> = await tx.$queryRaw`');
        const lockClauseIndex = legacyShiftCloseService.indexOf('FOR UPDATE', lockIndex);
        const claimIndex = legacyShiftCloseService.indexOf('const claim = await tx.shift.updateMany');
        const closedShiftIndex = legacyShiftCloseService.indexOf('const closedShift = await tx.shift.findFirst');
        const metricsIndex = legacyShiftCloseService.indexOf('const metrics = calculateCloseMetrics(closedShift, input)');

        expect(lockIndex).toBeGreaterThan(-1);
        expect(lockClauseIndex).toBeGreaterThan(lockIndex);
        expect(claimIndex).toBeGreaterThan(lockClauseIndex);
        expect(closedShiftIndex).toBeGreaterThan(claimIndex);
        expect(metricsIndex).toBeGreaterThan(closedShiftIndex);
    });

    it('exige que el movimiento de caja siga apuntando a un turno OPEN bajo lock', () => {
        const movementRoute = handlerBody(server, "app.post('/api/cash-movements'");
        const lockIndex = movementRoute.indexOf('SELECT \\`id\\`, \\`initialCash\\`, \\`initialCashUsd\\`');
        const appendIndex = movementRoute.indexOf('const movement = await appendSignedCashMovement');

        expect(lockIndex).toBeGreaterThan(-1);
        expect(movementRoute).toContain("AND \\`status\\` = 'OPEN'");
        expect(appendIndex).toBeGreaterThan(lockIndex);
    });
});

describe('venta POS contra cierre concurrente', () => {
    it('hace el gate final del turno antes del asiento contable', () => {
        const helperIndex = salesService.indexOf('const lockOwnedOpenPosShift = async');
        const callIndex = salesService.indexOf('await lockOwnedOpenPosShift(tx, tenantId, userId, shiftId!);');
        const recordSaleIndex = salesService.indexOf('await recordSale(');

        expect(helperIndex).toBeGreaterThan(-1);
        expect(callIndex).toBeGreaterThan(helperIndex);
        expect(recordSaleIndex).toBeGreaterThan(callIndex);
    });
});
