import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const server = readFileSync(resolve(root, 'backend/server.ts'), 'utf8');
const schema = readFileSync(resolve(root, 'backend/prisma/schema.prisma'), 'utf8');
const service = readFileSync(resolve(root, 'backend/services/shiftCloseService.ts'), 'utf8');

function sourceBetween(source: string, start: string, end: string): string {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    expect(from, `No se encontro ${start}`).toBeGreaterThanOrEqual(0);
    expect(to, `No se encontro ${end}`).toBeGreaterThan(from);
    return source.slice(from, to);
}

const closeRoute = sourceBetween(
    server,
    "app.post('/api/shifts/close'",
    '// GET /api/shifts/history',
);
const closeService = sourceBetween(
    service,
    'export async function closeShiftWithReport',
    '\n}',
);

describe('contrato durable del cierre de caja y su Reporte Z', () => {
    it('solo calcula sobre ventas vigentes y bloquea un turno todavia OPEN', () => {
        // Una venta anulada no puede volver a aparecer ni en el arqueo ni en el
        // documento que firma el cierre. El lock evita dos cierres simultaneos.
        expect(service).toMatch(/status:\s*\{\s*not:\s*ESTADO_ANULADA\s*\}/);
        expect(service).toMatch(/status\s*<>\s*\$\{ESTADO_ANULADA\}/);
        expect(service).toContain('processedShiftId');
        expect(service).toMatch(/FOR\s+UPDATE/i);
        expect(closeService).toMatch(/locked\.status\s*!==\s*'OPEN'/);
        expect(closeService).toMatch(/status:\s*'OPEN'/);
    });

    it('persiste el snapshot dentro de la misma transaccion del cierre', () => {
        const txStart = closeService.indexOf('client.$transaction');
        const shiftWrite = closeService.search(/tx\.shift\.(?:update|updateMany)\s*\(/);
        const reportWrite = closeService.search(/tx\.shiftCloseReport\.create\s*\(/);
        const auditWrite = closeService.search(/tx\.auditLog\.create\s*\(/);
        const txEnd = closeService.lastIndexOf('TransactionIsolationLevel.Serializable');

        expect(txStart).toBeGreaterThanOrEqual(0);
        expect(shiftWrite).toBeGreaterThan(txStart);
        expect(reportWrite).toBeGreaterThan(shiftWrite);
        expect(auditWrite).toBeGreaterThan(txStart);
        expect(reportWrite).toBeLessThan(txEnd);

        const transactionalReport = closeService.slice(reportWrite, txEnd);
        expect(transactionalReport).toContain('tenantId: command.tenantId');
        expect(transactionalReport).toContain('shiftId');
        expect(transactionalReport).toContain('contentHash');
        expect(transactionalReport).toContain('report:');
        expect(transactionalReport).toContain('createdBy: command.userId');
    });

    it('devuelve una URL autenticada del documento recien congelado', () => {
        expect(service).toMatch(/documentUrl\s*:/);
        expect(service).toMatch(/\/api\/reports\/shifts\/\$\{[^}]+\}\/document/);
    });

    it('POST delega identidad JWT y conteos al servicio atomico', () => {
        expect(closeRoute).toContain('closeShiftWithReport({');
        expect(closeRoute).toContain('tenantId: authReq.tenantId');
        expect(closeRoute).toContain('userId: authReq.userId');
        expect(closeRoute).toContain('role: authReq.role');
        expect(closeRoute).toContain('closeReport: result.closeReport');
        expect(closeRoute).not.toContain('const cashSalesD = shift.sales');
    });

    it('el schema hace el snapshot uno-a-uno, tenant-scoped e indexado', () => {
        const model = sourceBetween(schema, 'model ShiftCloseReport {', '\n}');
        const productReturn = sourceBetween(schema, 'model ProductReturn {', '\n}');

        expect(model).toContain('tenantId');
        expect(model).toMatch(/shiftId\s+String\s+@unique/);
        expect(model).toMatch(/businessDate\s+String/);
        expect(model).toMatch(/report\s+Json/);
        expect(model).toMatch(/contentHash\s+String/);
        expect(model).toMatch(/@@unique\(\[tenantId, folio\]\)/);
        expect(model).toMatch(/@@index\(\[tenantId, businessDate\]\)/);
        expect(model).toMatch(/@@index\(\[tenantId, createdAt\]\)/);
        expect(productReturn).toMatch(/processedShiftId\s+String\?/);
        expect(productReturn).toMatch(/processedShift\s+Shift\?/);
        expect(productReturn).toMatch(/@@index\(\[tenantId, processedShiftId, createdAt\]\)/);
    });
});
