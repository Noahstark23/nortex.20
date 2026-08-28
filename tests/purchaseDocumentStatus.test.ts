import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const server = source('backend/server.ts');
const accounting = source('backend/services/accounting.ts');

const routeSlice = (startMarker: string, endMarker: string) => {
    const start = server.indexOf(startMarker);
    const end = server.indexOf(endMarker, start);
    if (start < 0 || end < 0) throw new Error(`No se encontró ${startMarker}`);
    return server.slice(start, end);
};

describe('documentStatus autoritativo en libros fiscales y CxP', () => {
    it('excluye documentos no posteados del pendiente y del aging de proveedores', () => {
        const pending = routeSlice('// GET /api/purchases/pending', '// ==========================================\n// 🇳🇮 NÓMINA');
        const aging = routeSlice("app.get('/api/accounting/aging'", '// ==========================================\n// 💵 FLUJO');

        expect(pending).toContain("documentStatus: 'POSTED'");
        expect(aging).toContain("documentStatus: 'POSTED'");
    });

    it('excluye documentos no posteados del libro, VET y constancia', () => {
        const constancia = routeSlice("app.get('/api/fiscal/constancia-retencion/:purchaseId'", '// ── A2: LIBRO DE COMPRAS');
        const libro = routeSlice("app.get('/api/fiscal/libro-compras/:month/:year'", '// ── A3: ARCHIVO VET');
        const vet = routeSlice("app.get('/api/fiscal/vet-export/:month/:year'", '// ==========================================\n// 🚀 SERVE FRONTEND');

        expect(constancia).toContain("documentStatus: 'POSTED'");
        expect(libro).toContain("documentStatus: 'POSTED'");
        expect(vet).toContain("documentStatus: 'POSTED'");
    });

    it('genera retenciones únicamente sobre facturas posteadas', () => {
        const start = accounting.indexOf('export async function generateRetentions');
        const end = accounting.indexOf('export async function fiscalClose', start);
        expect(start).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(start);
        expect(accounting.slice(start, end)).toContain("documentStatus: 'POSTED'");
    });

    it('conciliación filtra POSTED y responde líneas refrescadas después de matching', () => {
        const service = source('backend/services/procurementMatchService.ts');
        expect(service).toContain("documentStatus: 'POSTED'");
        expect(service).toContain("purchase.documentStatus !== 'POSTED'");

        const purchaseRoute = routeSlice(
            "app.post('/api/purchases'",
            '// POST /api/purchases/:id/pay',
        );
        const matchAt = purchaseRoute.indexOf('await executeProcurementMatch({');
        const refreshAt = purchaseRoute.indexOf('await tx.purchaseItem.findMany({');
        expect(matchAt).toBeGreaterThan(-1);
        expect(refreshAt).toBeGreaterThan(matchAt);
        const refreshBlock = purchaseRoute.slice(
            refreshAt,
            purchaseRoute.indexOf('if (matchedPurchaseItems.length', refreshAt),
        );
        expect(refreshBlock).toContain('purchaseId: purchase.id');
        expect(refreshBlock).toContain('purchase: { tenantId: authReq.tenantId! }');
        expect(refreshBlock).not.toMatch(/where:\s*\{\s*tenantId:/);
        expect(purchaseRoute).toContain('matchedPurchaseItems.length !== purchase.items.length');
        expect(purchaseRoute).toContain('items: matchedPurchaseItems');
    });
});
