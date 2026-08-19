import { describe, expect, it, vi } from 'vitest';
import {
    applyDeploySchemaPreflight,
    inspectWarehouseSellerColumn,
    inspectWarehouseSellerIndex,
    WAREHOUSE_SELLER_INDEX,
    type WarehouseSellerIndexRow,
} from '../scripts/deploy-schema-preflight';

const validIndexRows: WarehouseSellerIndexRow[] = [
    {
        indexName: WAREHOUSE_SELLER_INDEX,
        nonUnique: 0n,
        seqInIndex: 1n,
        columnName: 'tenantId',
        subPart: null,
        indexType: 'BTREE',
        isVisible: 'YES',
        collation: 'A',
        expression: null,
    },
    {
        indexName: WAREHOUSE_SELLER_INDEX,
        nonUnique: 0n,
        seqInIndex: 2n,
        columnName: 'sellerId',
        subPart: null,
        indexType: 'BTREE',
        isVisible: 'YES',
        collation: 'A',
        expression: null,
    },
];

describe('deploy schema preflight', () => {
    it('acepta únicamente Warehouse.sellerId nullable varchar(191)', () => {
        expect(inspectWarehouseSellerColumn([])).toBe('missing');
        expect(inspectWarehouseSellerColumn([{
            dataType: 'varchar',
            columnType: 'varchar(191)',
            isNullable: 'YES',
            characterMaximumLength: 191n,
            characterSetName: 'utf8mb4',
            collationName: 'utf8mb4_unicode_ci',
            columnDefault: null,
            extra: '',
            generationExpression: '',
        }])).toBe('valid');
        expect(inspectWarehouseSellerColumn([{
            dataType: 'varchar',
            columnType: 'varchar(255)',
            isNullable: 'YES',
            characterMaximumLength: 255n,
            characterSetName: 'utf8mb4',
            collationName: 'utf8mb4_unicode_ci',
            columnDefault: null,
            extra: '',
            generationExpression: '',
        }])).toBe('invalid');
        expect(inspectWarehouseSellerColumn([{
            dataType: 'varchar',
            columnType: 'varchar(191)',
            isNullable: 'NO',
            characterMaximumLength: 191n,
            characterSetName: 'utf8mb4',
            collationName: 'utf8mb4_unicode_ci',
            columnDefault: null,
            extra: '',
            generationExpression: '',
        }])).toBe('invalid');
        expect(inspectWarehouseSellerColumn([{
            dataType: 'varchar',
            columnType: 'varchar(191)',
            isNullable: 'YES',
            characterMaximumLength: 191n,
            characterSetName: 'utf8mb4',
            collationName: 'utf8mb4_unicode_ci',
            columnDefault: 'seller-default',
            extra: '',
            generationExpression: '',
        }])).toBe('invalid');
    });

    it('acepta únicamente el unique tenantId + sellerId en el orden exacto', () => {
        expect(inspectWarehouseSellerIndex([])).toBe('missing');
        expect(inspectWarehouseSellerIndex([...validIndexRows].reverse())).toBe('valid');
        expect(inspectWarehouseSellerIndex(validIndexRows.map(row => ({
            ...row,
            nonUnique: 1n,
        })))).toBe('invalid');
        expect(inspectWarehouseSellerIndex([
            { ...validIndexRows[0], columnName: 'sellerId' },
            { ...validIndexRows[1], columnName: 'tenantId' },
        ])).toBe('invalid');
    });

    it('rechaza un índice homónimo por prefijos o invisible', () => {
        expect(inspectWarehouseSellerIndex(validIndexRows.map(row => ({
            ...row,
            subPart: 10n,
        })))).toBe('invalid');
        expect(inspectWarehouseSellerIndex(validIndexRows.map(row => ({
            ...row,
            isVisible: 'NO',
        })))).toBe('invalid');
    });

    it('no aplica DDL sobre una instalación completamente vacía', async () => {
        const query = vi.fn().mockResolvedValue([]);
        const execute = vi.fn();
        const info = vi.fn();

        await applyDeploySchemaPreflight({ query, execute }, { info, warn: vi.fn() });

        expect(query).toHaveBeenCalledOnce();
        expect(execute).not.toHaveBeenCalled();
        expect(info).toHaveBeenCalledWith(expect.stringContaining('Warehouse aún no existe'));
    });
});
