import { describe, expect, it, vi } from 'vitest';

const external = vi.hoisted(() => vi.fn(() => { throw new Error('CONEXION_FUERA_DE_TX'); }));
vi.mock('../backend/lib/prisma', () => ({ default: { account: { findUnique: external, createMany: external } } }));
import { createJournalEntry } from '../backend/services/accounting';

function transaction(empty = false) {
    const accounts = new Map<string, { id: string; code: string; type: string }>();
    if (!empty) for (const code of ['1.1.1', '4.1.1']) accounts.set(code, { id: code, code, type: code.startsWith('1') ? 'ASSET' : 'REVENUE' });
    return {
        fiscalPeriod: { findUnique: vi.fn(async () => null) },
        account: {
            findUnique: vi.fn(async ({ where }: any) => {
                expect(where.tenantId_code.tenantId).toBe('tenant-a');
                return accounts.get(where.tenantId_code.code) ?? null;
            }),
            createMany: vi.fn(async ({ data }: any) => {
                for (const row of data) {
                    expect(row.tenantId).toBe('tenant-a');
                    accounts.set(row.code, { id: row.code, code: row.code, type: row.type });
                }
                return { count: data.length };
            }),
            update: vi.fn(async () => ({})),
        },
        $queryRaw: vi.fn(async ({ values }: any) => [{ id: values[1] }]),
        journalEntry: { create: vi.fn(async () => ({ id: 'journal-a' })) },
        journalLine: { create: vi.fn(async () => ({})) },
    };
}

const lines = [{ accountCode: '1.1.1', debit: 25, credit: 0 }, { accountCode: '4.1.1', debit: 0, credit: 25 }];
describe('el asiento no necesita otra conexión mientras retiene la transacción', () => {
    it.each([false, true])('resuelve cuentas y auto-seed dentro de tx (catálogo vacío=%s)', async empty => {
        external.mockClear();
        const tx = transaction(empty);
        await createJournalEntry(tx as any, 'tenant-a', 'Venta', 'sale-a', 'SALE', 'user-a', lines);
        expect(external).not.toHaveBeenCalled();
        expect(tx.journalEntry.create).toHaveBeenCalledTimes(1);
        expect(tx.journalLine.create).toHaveBeenCalledTimes(2);
        expect(tx.account.createMany).toHaveBeenCalledTimes(empty ? 1 : 0);
    });

    it('rechaza una cuenta desconocida sin persistir el asiento ni alterar saldos', async () => {
        const tx = transaction();
        await expect(createJournalEntry(tx as any, 'tenant-a', 'Inválido', 'x', 'SALE', 'user-a', [
            lines[0], { accountCode: 'invalid-account', debit: 0, credit: 25 },
        ])).rejects.toThrow('CUENTA_INEXISTENTE');
        expect(tx.journalEntry.create).not.toHaveBeenCalled();
        expect(tx.account.update).not.toHaveBeenCalled();
    });
});
