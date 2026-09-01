import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import {
    buildLegacyShiftCloseIdentity,
    closeLegacyShift,
    ShiftCloseError,
    type ShiftCloseDatabase,
    type ShiftCloseTransaction,
} from '../backend/services/legacyShiftCloseService';
import {
    canonicalizeCloseShiftPayload,
    CloseShiftSchema,
} from '../backend/validation/schemas';

const EVENT_ID = '4ac0efc2-fb48-48c8-936a-9bf4dbdf8277';
const context = { tenantId: 'tenant-a', userId: 'user-a', role: 'CASHIER' };
const input = {
    shiftId: 'shift-1',
    declaredCash: '150.00',
    auditNotes: 'Conteo verificado',
    clientEventId: EVENT_ID,
};

type FakeShift = Record<string, any>;

const cloneShift = (shift: FakeShift): FakeShift => ({
    ...shift,
    sales: (shift.sales ?? []).map((sale: any) => ({ ...sale })),
    cashMovements: (shift.cashMovements ?? []).map((movement: any) => ({ ...movement })),
    employee: shift.employee ? { ...shift.employee } : null,
});

const baseShift = (extra: Partial<FakeShift> = {}): FakeShift => ({
    id: 'shift-1',
    tenantId: 'tenant-a',
    userId: 'user-a',
    employeeId: 'employee-a',
    status: 'OPEN',
    startTime: new Date('2026-08-31T08:00:00.000Z'),
    endTime: null,
    initialCash: new Decimal('100.00'),
    initialCashUsd: new Decimal('0'),
    finalCashDeclared: null,
    systemExpectedCash: null,
    difference: null,
    finalCashDeclaredUsd: null,
    systemExpectedUsd: null,
    differenceUsd: null,
    closeEventId: null,
    closePayloadHash: null,
    employee: { id: 'employee-a', firstName: 'Ana', lastName: 'López', role: 'CASHIER' },
    sales: [
        {
            id: 'sale-valid',
            total: new Decimal('50.00'),
            paymentMethod: 'CASH',
            status: 'COMPLETED',
            cancelledAt: null,
        },
        {
            id: 'sale-voided',
            total: new Decimal('1000.00'),
            paymentMethod: 'CASH',
            status: 'VOIDED',
            cancelledAt: new Date('2026-08-31T09:00:00.000Z'),
        },
    ],
    cashMovements: [],
    ...extra,
});

/**
 * Adapter transaccional mínimo. Serializa callbacks como InnoDB sobre la fila
 * reclamada y restaura el estado si una transacción falla.
 */
class FakeShiftCloseDb implements ShiftCloseDatabase {
    public shifts: FakeShift[];
    public readonly audits: Array<Record<string, any>> = [];
    private transactionTail: Promise<void> = Promise.resolve();

    constructor(shifts: FakeShift[] = [baseShift()]) {
        this.shifts = shifts.map(cloneShift);
    }

    private matches(shift: FakeShift, where: Record<string, unknown> = {}): boolean {
        return Object.entries(where).every(([field, expected]) => shift[field] === expected);
    }

    private async findShift(args: any): Promise<any> {
        const found = this.shifts.find((shift) => this.matches(shift, args.where));
        if (!found) return null;
        if (args.select) {
            return Object.fromEntries(
                Object.keys(args.select)
                    .filter((field) => args.select[field])
                    .map((field) => [field, found[field]]),
            );
        }
        // El fake devuelve incluso la venta VOIDED para probar la defensa del
        // cálculo, además del filtro declarado en el include Prisma.
        return cloneShift(found);
    }

    private async updateShifts(args: any): Promise<{ count: number }> {
        const targets = this.shifts.filter((shift) => this.matches(shift, args.where));
        if (
            targets.length > 0
            && args.data.closeEventId
            && this.shifts.some((shift) =>
                !targets.includes(shift)
                && shift.tenantId === targets[0].tenantId
                && shift.closeEventId === args.data.closeEventId)
        ) {
            throw Object.assign(new Error('duplicate close event'), { code: 'P2002' });
        }
        for (const target of targets) Object.assign(target, args.data);
        return { count: targets.length };
    }

    public readonly shift = {
        findFirst: async (args: any) => this.findShift(args),
    };

    public readonly tenant = {
        findFirst: async ({ where }: any) => (
            where.id === 'tenant-a'
                ? { id: 'tenant-a', theftAlertThreshold: new Decimal('500.00') }
                : null
        ),
    };

    private readonly transaction: ShiftCloseTransaction = {
        $queryRaw: async <T>(_query: TemplateStringsArray, ...values: unknown[]): Promise<T> => {
            const [shiftId, tenantId] = values;
            return this.shifts
                .filter((shift) => shift.id === shiftId && shift.tenantId === tenantId)
                .map((shift) => ({ id: shift.id })) as T;
        },
        shift: {
            findFirst: async (args: any) => this.findShift(args),
            updateMany: async (args: any) => this.updateShifts(args),
        },
        tenant: this.tenant,
        auditLog: {
            create: async ({ data }: any) => {
                this.audits.push({ ...data });
                return data;
            },
        },
    };

    async $transaction<T>(
        operation: (tx: ShiftCloseTransaction) => Promise<T>,
    ): Promise<T> {
        let release!: () => void;
        const gate = new Promise<void>((resolveGate) => {
            release = resolveGate;
        });
        const previous = this.transactionTail;
        this.transactionTail = previous.then(() => gate);
        await previous;

        const snapshot = this.shifts.map(cloneShift);
        const auditLength = this.audits.length;
        try {
            return await operation(this.transaction);
        } catch (error) {
            this.shifts = snapshot;
            this.audits.splice(auditLength);
            throw error;
        } finally {
            release();
        }
    }
}

const hash = (payload: string): string => createHash('sha256').update(payload).digest('hex');

describe('contrato idempotente del cierre de caja legacy', () => {
    it('mantiene compatible el payload del PWA anterior y normaliza una UUID nueva', () => {
        const legacy = CloseShiftSchema.parse({ shiftId: ' shift-1 ', declaredCash: 100 });
        expect(legacy).toEqual({ shiftId: 'shift-1', declaredCash: '100' });

        const current = CloseShiftSchema.parse({
            shiftId: 'shift-1',
            declaredCash: '100.00',
            clientEventId: EVENT_ID.toUpperCase(),
        });
        expect(current.clientEventId).toBe(EVENT_ID);
        expect(CloseShiftSchema.safeParse({
            shiftId: 'shift-1',
            declaredCash: '100',
            clientEventId: 'retry-1',
        }).success).toBe(false);
    });

    it('rechaza escala o rango que las columnas Decimal de Shift no pueden persistir', () => {
        expect(CloseShiftSchema.parse({
            shiftId: 'shift-1',
            declaredCash: '99999999.99',
            declaredCashUsd: '99999999999999.9999',
        })).toMatchObject({
            declaredCash: '99999999.99',
            declaredCashUsd: '99999999999999.9999',
        });

        const invalid = [
            [{ shiftId: 'shift-1', declaredCash: '1.001' }, 'máximo 2 decimales'],
            [{ shiftId: 'shift-1', declaredCash: '100000000.00' }, 'excede el máximo'],
            [
                { shiftId: 'shift-1', declaredCash: '1', declaredCashUsd: '1.00001' },
                'máximo 4 decimales',
            ],
            [
                { shiftId: 'shift-1', declaredCash: '1', declaredCashUsd: '100000000000000' },
                'excede el máximo',
            ],
        ] as const;

        for (const [payload, message] of invalid) {
            const result = CloseShiftSchema.safeParse(payload);
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error.issues.some((issue) => issue.message.includes(message))).toBe(true);
            }
        }
    });

    it('produce una huella canónica estable y separa intenciones materiales', () => {
        const numeric = canonicalizeCloseShiftPayload({
            shiftId: 'shift-1',
            declaredCash: 100,
            auditNotes: '  Revisado  ',
        });
        const textual = canonicalizeCloseShiftPayload({
            shiftId: 'shift-1',
            declaredCash: '100.00',
            declaredCashUsd: '0.0000',
            auditNotes: 'Revisado',
        });
        expect(numeric).toBe(textual);
        expect(hash(numeric)).toHaveLength(64);

        const changedCash = canonicalizeCloseShiftPayload({
            shiftId: 'shift-1',
            declaredCash: '100.01',
            auditNotes: 'Revisado',
        });
        expect(hash(changedCash)).not.toBe(hash(numeric));
    });

    it('deriva una llave legacy estable por tenant+turno cuando falta clientEventId', () => {
        const legacyInput = { shiftId: 'shift-1', declaredCash: '150.00' };
        const first = buildLegacyShiftCloseIdentity(context, legacyInput);
        const retry = buildLegacyShiftCloseIdentity(context, {
            ...legacyInput,
            declaredCash: '150',
        });
        const otherTenant = buildLegacyShiftCloseIdentity(
            { tenantId: 'tenant-b' },
            legacyInput,
        );

        expect(first).toEqual(retry);
        expect(first.closeEventId).toMatch(/^legacy:[a-f0-9]{64}$/);
        expect(first.closeEventId).not.toBe(otherTenant.closeEventId);
        expect(first.closePayloadHash).toHaveLength(64);
    });

    it('50 cierres concurrentes producen un SHIFT_CLOSED y 49 replays', async () => {
        const db = new FakeShiftCloseDb();
        const results = await Promise.all(
            Array.from({ length: 50 }, () => closeLegacyShift(db, context, input)),
        );

        expect(results.filter((result) => result.body.idempotentReplay === false)).toHaveLength(1);
        expect(results.filter((result) => result.body.idempotentReplay === true)).toHaveLength(49);
        expect(new Set(results.map((result) => result.body.id))).toEqual(new Set(['shift-1']));
        expect(db.audits.filter((audit) => audit.action === 'SHIFT_CLOSED')).toHaveLength(1);
        expect(db.shifts[0]).toMatchObject({
            status: 'CLOSED',
            finalCashDeclared: '150.00',
            systemExpectedCash: '150.00',
            difference: '0.00',
        });

        const audit = JSON.parse(String(db.audits[0].details));
        expect(audit).toMatchObject({
            totalVentas: 1,
            totalEfectivo: '50.00',
            totalTarjeta: '0.00',
            esperado: '150.00',
            declarado: '150.00',
            diferencia: '0.00',
            fondoInicial: '100.00',
        });
    });

    it('un replay legacy idéntico devuelve el cierre sin una segunda auditoría', async () => {
        const db = new FakeShiftCloseDb();
        const legacyInput = { shiftId: 'shift-1', declaredCash: '150.00' };

        const first = await closeLegacyShift(db, context, legacyInput);
        const replay = await closeLegacyShift(db, context, {
            shiftId: 'shift-1',
            declaredCash: '150',
        });

        expect(first.body.idempotentReplay).toBe(false);
        expect(replay.body.idempotentReplay).toBe(true);
        expect(db.audits.filter((audit) => audit.action === 'SHIFT_CLOSED')).toHaveLength(1);
    });

    it('conserva snapshots USD como strings de cuatro decimales en auditoría', async () => {
        const db = new FakeShiftCloseDb([
            baseShift({ initialCashUsd: new Decimal('10.1234') }),
        ]);
        await closeLegacyShift(db, context, {
            ...input,
            clientEventId: '4ac0efc2-fb48-48c8-936a-9bf4dbdf8278',
            declaredCashUsd: '10.1200',
        });

        const audit = JSON.parse(String(db.audits[0].details));
        expect(audit.usd).toEqual({
            esperado: '10.1200',
            declarado: '10.1200',
            diferencia: '0.0000',
            fondoInicial: '10.1234',
        });
    });

    it('misma llave con payload distinto responde 409 y no escribe', async () => {
        const db = new FakeShiftCloseDb();
        await closeLegacyShift(db, context, input);
        const auditsBefore = db.audits.length;

        await expect(closeLegacyShift(db, context, {
            ...input,
            declaredCash: '149.99',
        })).rejects.toMatchObject({
            code: 'CLOSE_SHIFT_CONFLICT',
            httpStatus: 409,
        });
        expect(db.audits).toHaveLength(auditsBefore);
        expect(db.shifts[0].finalCashDeclared).toBe('150.00');
    });

    it('la unicidad tenant+evento convierte P2002 de otro turno en 409 sin cierre parcial', async () => {
        const identity = buildLegacyShiftCloseIdentity(context, input);
        const db = new FakeShiftCloseDb([
            baseShift(),
            baseShift({
                id: 'shift-2',
                status: 'CLOSED',
                closeEventId: identity.closeEventId,
                closePayloadHash: 'otro-hash',
            }),
        ]);

        await expect(closeLegacyShift(db, context, input)).rejects.toMatchObject({
            code: 'CLOSE_SHIFT_CONFLICT',
            httpStatus: 409,
        });
        expect(db.shifts.find((shift) => shift.id === 'shift-1')?.status).toBe('OPEN');
        expect(db.audits).toHaveLength(0);
    });

    it('aísla todas las lecturas por el tenant del JWT', async () => {
        const db = new FakeShiftCloseDb();
        let caught: unknown;
        try {
            await closeLegacyShift(
                db,
                { tenantId: 'tenant-b', userId: 'user-a', role: 'OWNER' },
                input,
            );
        } catch (error) {
            caught = error;
        }

        expect(caught).toBeInstanceOf(ShiftCloseError);
        expect(caught).toMatchObject({ code: 'CLOSE_SHIFT_NOT_FOUND', httpStatus: 404 });
        expect(db.shifts[0].status).toBe('OPEN');
        expect(db.audits).toHaveLength(0);
    });
});

describe('estructura del adaptador HTTP de cierre', () => {
    const server = readFileSync(resolve(process.cwd(), 'backend/server.ts'), 'utf8');
    const service = readFileSync(
        resolve(process.cwd(), 'backend/services/legacyShiftCloseService.ts'),
        'utf8',
    );
    const routeStart = server.indexOf("app.post('/api/shifts/close'");
    const routeEnd = server.indexOf("app.get('/api/shifts/history'", routeStart);
    const route = server.slice(routeStart, routeEnd);

    it('deja server.ts fino y delega el dominio al servicio inyectable', () => {
        expect(route).toContain('closeShiftWithReport({');
        expect(route).toContain('tenantId: authReq.tenantId');
        expect(route).not.toContain('prisma.$transaction');
        expect(route).not.toContain('auditLog.create');
        expect(service).not.toContain('new PrismaClient');
    });

    it('conserva claim tenant+id+OPEN, filtro de anuladas y auditoría debajo del ganador', () => {
        const claimStart = service.indexOf('const claim = await tx.shift.updateMany');
        const claimGuard = service.indexOf('if (claim.count !== 1)', claimStart);
        const audit = service.indexOf("action: 'SHIFT_CLOSED'", claimGuard);
        const claimBlock = service.slice(claimStart, claimGuard);

        expect(claimBlock).toContain('id: input.shiftId');
        expect(claimBlock).toContain('tenantId: context.tenantId');
        expect(claimBlock).toContain("status: 'OPEN'");
        expect(claimBlock).toContain("status: 'CLOSED'");
        expect(claimBlock).toContain('closeEventId: identity.closeEventId');
        expect(claimBlock).toContain('closePayloadHash: identity.closePayloadHash');
        expect(audit).toBeGreaterThan(claimGuard);
        expect(service.match(/action: 'SHIFT_CLOSED'/g)).toHaveLength(1);
        expect(service).toContain("status: { not: ESTADO_ANULADA }, cancelledAt: null");
    });

    it('relee al perdedor fuera de la transacción abortada', () => {
        const transaction = service.indexOf('return await db.$transaction');
        const catchIndex = service.indexOf('} catch (error: unknown) {', transaction);
        const freshRead = service.indexOf('const targetShift = await db.shift.findFirst', catchIndex);

        expect(catchIndex).toBeGreaterThan(transaction);
        expect(freshRead).toBeGreaterThan(catchIndex);
        expect(service.slice(freshRead)).toContain('tenantId: context.tenantId');
        expect(service.slice(freshRead)).toContain('isExactReplay(targetShift, input, identity)');
    });
});
