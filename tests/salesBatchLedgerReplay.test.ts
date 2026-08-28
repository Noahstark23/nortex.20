import { beforeEach, describe, expect, it, vi } from 'vitest';

const saleFindFirst = vi.hoisted(() => vi.fn());
const transaction = vi.hoisted(() => vi.fn());
const allocateSaleItemBatchesFefo = vi.hoisted(() => vi.fn());
const resolveBatchWarehouseLedgerMode = vi.hoisted(() => vi.fn());

vi.mock('../backend/lib/prisma.js', () => {
    const mockedPrisma = {
        sale: { findFirst: saleFindFirst },
        $transaction: transaction,
    };
    return { default: mockedPrisma, prisma: mockedPrisma };
});

vi.mock('../backend/services/saleBatchAllocationService.js', () => ({
    allocateSaleItemBatchesFefo,
    BatchAllocationError: class BatchAllocationError extends Error {
        readonly httpStatus = 409;
    },
}));

vi.mock('../backend/services/productBatchWarehouseLedgerService.js', () => ({
    resolveBatchWarehouseLedgerMode,
}));

import {
    offlineReplayPayloadHash,
    type OfflineReplaySaleInput,
} from '../backend/lib/offlineSaleReplay';
import {
    CreateSaleSchema,
    executeSaleWithResult,
} from '../backend/services/salesService';

describe('replay de venta con subledger lote+bodega', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('un replay aceptado retorna antes de resolver modo o consumir el lote otra vez', async () => {
        const raw = {
            offlineId: 'sale-event-1',
            paymentMethod: 'CASH',
            customerId: null,
            customerName: 'Cliente General',
            globalDiscount: '0',
            source: 'POS',
            items: [{ id: 'product-batch-a', quantity: '0.0001', price: '1', discount: '0' }],
        };
        const input = CreateSaleSchema.parse(raw);
        const existing = {
            id: 'sale-existing',
            tenantId: 'tenant-a',
            offlinePayloadHash: offlineReplayPayloadHash({
                tenantId: 'tenant-a',
                userId: 'user-a',
                shiftId: 'shift-a',
                input: input as unknown as OfflineReplaySaleInput,
            }),
        };
        saleFindFirst.mockResolvedValue(existing);

        await expect(executeSaleWithResult(
            'tenant-a',
            'user-a',
            'shift-a',
            raw,
        )).resolves.toEqual({ sale: existing, idempotentReplay: true });
        expect(transaction).not.toHaveBeenCalled();
        expect(resolveBatchWarehouseLedgerMode).not.toHaveBeenCalled();
        expect(allocateSaleItemBatchesFefo).not.toHaveBeenCalled();
    });
});
