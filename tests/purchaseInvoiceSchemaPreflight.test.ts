import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
    applyPurchaseInvoiceSchemaPreflight,
    inspectPurchaseInvoiceUniqueIndex,
    PURCHASE_INVOICE_UNIQUE_INDEX,
    UnsafeSchemaStateError,
    type DeploySchemaClient,
    type PurchaseInvoiceIndexRow,
} from '../scripts/deploy-schema-preflight';

type IndexState = 'missing' | 'valid' | 'invalid';

function sqlText(statement: Prisma.Sql): string {
    return statement.strings.join('?').replace(/\s+/g, ' ').trim();
}

function exactIndexRows(): PurchaseInvoiceIndexRow[] {
    return ['tenantId', 'supplierId', 'invoiceNumber'].map((columnName, index) => ({
        indexName: PURCHASE_INVOICE_UNIQUE_INDEX,
        nonUnique: 0n,
        seqInIndex: BigInt(index + 1),
        columnName,
        subPart: null,
        indexType: 'BTREE',
        isVisible: 'YES',
        collation: 'A',
        expression: null,
    }));
}

class PurchaseInvoiceSchemaFake implements DeploySchemaClient {
    tableExists = true;
    index: IndexState = 'missing';
    duplicates: Array<{
        tenantId: string;
        supplierId: string;
        invoiceNumber: string;
        duplicateCount: bigint;
    }> = [];
    raceWins = false;
    hardFailure = false;
    events: string[] = [];

    private indexRows(): PurchaseInvoiceIndexRow[] {
        if (this.index === 'missing') return [];
        const rows = exactIndexRows();
        return this.index === 'valid'
            ? rows
            : rows.map(row => ({ ...row, nonUnique: 1n }));
    }

    async query<T>(statement: Prisma.Sql): Promise<T> {
        const text = sqlText(statement);
        const values = statement.values as unknown[];

        if (text.includes('information_schema.TABLES')
            && text.includes("TABLE_NAME = 'Purchase'")) {
            return (this.tableExists ? [{ tableName: 'Purchase' }] : []) as T;
        }
        if (text.includes('information_schema.STATISTICS')
            && text.includes("TABLE_NAME = 'Purchase'")
            && values.includes(PURCHASE_INVOICE_UNIQUE_INDEX)) {
            this.events.push('query:index');
            return this.indexRows() as T;
        }
        if (text.includes('GROUP BY tenantId, supplierId, invoiceNumber')) {
            this.events.push('query:duplicates');
            return this.duplicates as T;
        }

        throw new Error(`Query inesperada en fake de Purchase: ${text}`);
    }

    async execute(statement: Prisma.Sql): Promise<number> {
        const text = sqlText(statement);
        if (!text.includes(`CREATE UNIQUE INDEX \`${PURCHASE_INVOICE_UNIQUE_INDEX}\``)) {
            throw new Error(`DDL inesperado en fake de Purchase: ${text}`);
        }

        this.events.push('execute:index');
        if (this.hardFailure) throw new Error('fallo DDL');
        this.index = 'valid';
        if (this.raceWins) throw new Error('otro iniciador ganó la carrera');
        return 0;
    }
}

describe('Purchase invoice deploy schema preflight', () => {
    it('acepta solo el UNIQUE tenant + proveedor + factura exacto', () => {
        const exact = exactIndexRows();

        expect(inspectPurchaseInvoiceUniqueIndex([])).toBe('missing');
        expect(inspectPurchaseInvoiceUniqueIndex([...exact].reverse())).toBe('valid');
        expect(inspectPurchaseInvoiceUniqueIndex(
            exact.map(row => ({ ...row, nonUnique: 1n })),
        )).toBe('invalid');
        expect(inspectPurchaseInvoiceUniqueIndex([
            { ...exact[0], columnName: 'supplierId' },
            { ...exact[1], columnName: 'tenantId' },
            exact[2],
        ])).toBe('invalid');
        expect(inspectPurchaseInvoiceUniqueIndex(
            exact.map(row => ({ ...row, subPart: 32n })),
        )).toBe('invalid');
    });

    it('deja que db push cree el índice cuando Purchase aún no existe', async () => {
        const db = new PurchaseInvoiceSchemaFake();
        db.tableExists = false;
        const info = vi.fn();

        await applyPurchaseInvoiceSchemaPreflight(db, { info, warn: vi.fn() });

        expect(db.events).toEqual([]);
        expect(info).toHaveBeenCalledWith(expect.stringContaining('Purchase aún no existe'));
    });

    it('valida duplicados antes del DDL, crea y revalida la definición exacta', async () => {
        const db = new PurchaseInvoiceSchemaFake();

        await applyPurchaseInvoiceSchemaPreflight(db, { info: vi.fn(), warn: vi.fn() });

        expect(db.index).toBe('valid');
        expect(db.events).toContain('execute:index');
        expect(db.events.indexOf('query:duplicates')).toBeLessThan(
            db.events.indexOf('execute:index'),
        );
        expect(db.events.lastIndexOf('query:duplicates')).toBeGreaterThan(
            db.events.indexOf('execute:index'),
        );
    });

    it('es idempotente cuando el índice ya existe con la definición exacta', async () => {
        const db = new PurchaseInvoiceSchemaFake();
        db.index = 'valid';

        await applyPurchaseInvoiceSchemaPreflight(db, { info: vi.fn(), warn: vi.fn() });
        await applyPurchaseInvoiceSchemaPreflight(db, { info: vi.fn(), warn: vi.fn() });

        expect(db.events).not.toContain('execute:index');
    });

    it('falla cerrado ante una definición homónima incompatible', async () => {
        const db = new PurchaseInvoiceSchemaFake();
        db.index = 'invalid';

        await expect(applyPurchaseInvoiceSchemaPreflight(
            db,
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow(PURCHASE_INVOICE_UNIQUE_INDEX);
        expect(db.events).not.toContain('execute:index');
    });

    it('falla cerrado ante duplicados y no modifica datos ni crea el índice', async () => {
        const db = new PurchaseInvoiceSchemaFake();
        db.duplicates = [{
            tenantId: 'tenant-1',
            supplierId: 'supplier-1',
            invoiceNumber: 'FAC-1',
            duplicateCount: 2n,
        }];

        await expect(applyPurchaseInvoiceSchemaPreflight(
            db,
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow(UnsafeSchemaStateError);
        expect(db.index).toBe('missing');
        expect(db.events).not.toContain('execute:index');
    });

    it('tolera una carrera solo si la relectura confirma el índice exacto', async () => {
        const db = new PurchaseInvoiceSchemaFake();
        db.raceWins = true;
        const warn = vi.fn();

        await applyPurchaseInvoiceSchemaPreflight(db, { info: vi.fn(), warn });

        expect(db.index).toBe('valid');
        expect(warn).toHaveBeenCalledOnce();
    });

    it('propaga el fallo DDL si la relectura confirma que el índice sigue ausente', async () => {
        const db = new PurchaseInvoiceSchemaFake();
        db.hardFailure = true;

        await expect(applyPurchaseInvoiceSchemaPreflight(
            db,
            { info: vi.fn(), warn: vi.fn() },
        )).rejects.toThrow('fallo DDL');
        expect(db.index).toBe('missing');
    });
});
