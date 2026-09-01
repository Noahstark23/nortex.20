import Decimal from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';
import {
    buildJournalPayloadHash,
    JournalPostingError,
    postJournalOnce,
    type JournalPayloadHashInput,
    type JournalPostingDatabase,
} from '../backend/services/journalPosting';
import { buildLegacyShiftCloseIdentity } from '../backend/services/legacyShiftCloseService';
import { canonicalizeCloseShiftPayload } from '../backend/validation/schemas';

const ECONOMIC_DATE = new Date('2026-08-31T15:00:00.000Z');
const POSTING_DATE = new Date('2026-09-01T01:00:00.000Z');

const balancedLines = () => [
    { accountId: 'z-sales', debit: '0', credit: '9.1' },
    { accountId: 'a-cash', debit: '9.1000', credit: '0.0000' },
];

const journalInput = (
    overrides: Partial<JournalPayloadHashInput> = {},
): JournalPayloadHashInput => ({
    tenantId: ' tenant-a ',
    economicDate: ECONOMIC_DATE,
    postingDate: POSTING_DATE,
    description: ' Venta 42 ',
    referenceId: ' sale-42 ',
    referenceType: ' SALE ',
    isAutomatic: false,
    lines: balancedLines(),
    ...overrides,
});

const expectJournalError = (
    operation: () => unknown,
    message: string,
    code = 'INVALID_JOURNAL_POSTING',
    httpStatus = 400,
) => {
    let caught: unknown;
    try {
        operation();
    } catch (error) {
        caught = error;
    }
    expect(caught).toBeInstanceOf(JournalPostingError);
    expect(caught).toMatchObject({ code, httpStatus, message });
};

describe('gate de mutación PR-01 — huella contable canónica', () => {
    it('congela la representación material exacta, incluidos trim, fechas, escala y orden', () => {
        expect(buildJournalPayloadHash(journalInput())).toBe(
            '349649653574717a7a2c8d045ff120282a7951a19403897fc3c71ce92f156b2b',
        );

        expect(buildJournalPayloadHash(journalInput({
            tenantId: 'tenant-a',
            description: 'Venta 42',
            referenceId: 'sale-42',
            referenceType: 'SALE',
            lines: [
                { accountId: 'a-cash', debit: new Decimal('9.1'), credit: new Decimal(0) },
                { accountId: 'z-sales', debit: new Decimal(0), credit: new Decimal('9.1000') },
            ],
        }))).toBe('349649653574717a7a2c8d045ff120282a7951a19403897fc3c71ce92f156b2b');
    });

    it('ordena de forma total incluso cuando accountId y Debe empatan', () => {
        const tied = [
            { accountId: 'same', debit: '9', credit: '0' },
            { accountId: 'same', debit: '0', credit: '10' },
            { accountId: 'same', debit: '10', credit: '0' },
            { accountId: 'same', debit: '0', credit: '9' },
        ];
        const reversed = [...tied].reverse();
        expect(buildJournalPayloadHash(journalInput({ lines: tied }))).toBe(
            buildJournalPayloadHash(journalInput({ lines: reversed })),
        );
    });

    it.each([
        ['tenantId', { tenantId: 'tenant-b' }],
        ['economicDate', { economicDate: new Date('2026-08-30T15:00:00.000Z') }],
        ['postingDate', { postingDate: new Date('2026-09-02T01:00:00.000Z') }],
        ['description', { description: 'Venta 43' }],
        ['referenceId', { referenceId: 'sale-43' }],
        ['referenceType', { referenceType: 'REFUND' }],
        ['isAutomatic', { isAutomatic: true }],
        ['accountId', { lines: [
            { accountId: 'bank', debit: '9.1', credit: '0' },
            { accountId: 'z-sales', debit: '0', credit: '9.1' },
        ] }],
        ['amount', { lines: [
            { accountId: 'a-cash', debit: '9.2', credit: '0' },
            { accountId: 'z-sales', debit: '0', credit: '9.2' },
        ] }],
    ] as const)('incluye %s en la intención económica', (_field, override) => {
        expect(buildJournalPayloadHash(journalInput(override as Partial<JournalPayloadHashInput>)))
            .not.toBe(buildJournalPayloadHash(journalInput()));
    });

    it('distingue original y reverso, y exige identidad al reverso', () => {
        const original = buildJournalPayloadHash(journalInput({
            isAutomatic: undefined,
            reversalOfId: 'se-ignora-en-original',
        }));
        const explicitOriginal = buildJournalPayloadHash(journalInput({
            isAutomatic: true,
            entryKind: 'ORIGINAL',
        }));
        expect(original).toBe(explicitOriginal);

        const reversal = buildJournalPayloadHash(journalInput({
            isAutomatic: true,
            entryKind: 'REVERSAL',
            reversalOfId: ' entry-1 ',
        }));
        expect(reversal).not.toBe(original);
        expect(reversal).not.toBe(buildJournalPayloadHash(journalInput({
            isAutomatic: true,
            entryKind: 'REVERSAL',
            reversalOfId: 'entry-2',
        })));

        expectJournalError(
            () => buildJournalPayloadHash(journalInput({
                entryKind: 'REVERSAL',
                reversalOfId: null,
            })),
            'reversalOfId es obligatorio',
        );
    });

    it.each([
        [{ tenantId: 42 }, 'tenantId es obligatorio'],
        [{ tenantId: '   ' }, 'tenantId no es valido'],
        [{ tenantId: 't'.repeat(192) }, 'tenantId no es valido'],
        [{ description: 42 }, 'description es obligatorio'],
        [{ description: '' }, 'description no es valido'],
        [{ description: 'd'.repeat(10_001) }, 'description no es valido'],
        [{ referenceId: 42 }, 'referenceId no es valido'],
        [{ referenceId: 'r'.repeat(192) }, 'referenceId no es valido'],
        [{ referenceType: 42 }, 'referenceType no es valido'],
        [{ referenceType: 'r'.repeat(192) }, 'referenceType no es valido'],
        [{ economicDate: '2026-08-31' }, 'economicDate no es una fecha valida'],
        [{ economicDate: new Date(Number.NaN) }, 'economicDate no es una fecha valida'],
        [{ postingDate: '2026-09-01' }, 'postingDate no es una fecha valida'],
        [{ postingDate: new Date(Number.NaN) }, 'postingDate no es una fecha valida'],
    ] as const)('rechaza identificadores o fechas no canónicos %#', (override, message) => {
        expectJournalError(
            () => buildJournalPayloadHash(journalInput(override as unknown as Partial<JournalPayloadHashInput>)),
            message,
        );
    });

    it('normaliza opcionales vacíos como null sin confundirlos con valores', () => {
        const omitted = buildJournalPayloadHash(journalInput({
            referenceId: undefined,
            referenceType: undefined,
        }));
        const nulls = buildJournalPayloadHash(journalInput({
            referenceId: null,
            referenceType: null,
        }));
        const blanks = buildJournalPayloadHash(journalInput({
            referenceId: '   ',
            referenceType: '   ',
        }));
        expect(omitted).toBe(nulls);
        expect(blanks).toBe(nulls);
        expect(buildJournalPayloadHash(journalInput({ referenceId: '0', referenceType: '0' })))
            .not.toBe(nulls);
    });

    it('acepta exactamente los límites de longitud documentados', () => {
        expect(buildJournalPayloadHash(journalInput({
            tenantId: 't'.repeat(191),
            description: 'd'.repeat(10_000),
            referenceId: 'r'.repeat(191),
            referenceType: 't'.repeat(191),
        }))).toMatch(/^[a-f0-9]{64}$/);
    });

    it.each([
        [null, 'Debe de la linea 1 debe recibirse como Decimal o texto exacto'],
        [1, 'Debe de la linea 1 debe recibirse como Decimal o texto exacto'],
        [1n, 'Debe de la linea 1 debe recibirse como Decimal o texto exacto'],
        ['', 'Debe de la linea 1 no es un decimal valido'],
        ['   ', 'Debe de la linea 1 no es un decimal valido'],
        ['abc', 'Debe de la linea 1 no es un decimal valido'],
        ['Infinity', 'Debe de la linea 1 debe ser positivo, finito y tener maximo 4 decimales'],
        ['-1', 'Debe de la linea 1 debe ser positivo, finito y tener maximo 4 decimales'],
        ['1.00001', 'Debe de la linea 1 debe ser positivo, finito y tener maximo 4 decimales'],
        ['100000000000000', 'Debe de la linea 1 debe ser positivo, finito y tener maximo 4 decimales'],
        [{}, 'Debe de la linea 1 no es un decimal valido'],
        [{ toString: 1 }, 'Debe de la linea 1 no es un decimal valido'],
        [Object.assign(() => undefined, { toString: () => '9.1' }), 'Debe de la linea 1 no es un decimal valido'],
    ] as const)('rechaza importes no exactos o no persistibles %#', (debit, message) => {
        expectJournalError(
            () => buildJournalPayloadHash(journalInput({
                lines: [
                    { accountId: 'a-cash', debit: debit as never, credit: '0' },
                    { accountId: 'z-sales', debit: '0', credit: '9.1' },
                ],
            })),
            message,
        );
    });

    it('acepta exactamente Decimal(18,4), pero no un diezmilésimo más', () => {
        const maximum = '99999999999999.9999';
        expect(buildJournalPayloadHash(journalInput({
            lines: [
                { accountId: 'a-cash', debit: maximum, credit: '0' },
                { accountId: 'z-sales', debit: '0', credit: maximum },
            ],
        }))).toMatch(/^[a-f0-9]{64}$/);
        expectJournalError(
            () => buildJournalPayloadHash(journalInput({
                lines: [
                    { accountId: 'a-cash', debit: '100000000000000.0000', credit: '0' },
                    { accountId: 'z-sales', debit: '0', credit: '100000000000000.0000' },
                ],
            })),
            'Debe de la linea 1 debe ser positivo, finito y tener maximo 4 decimales',
        );
    });

    it.each([
        [null, 'El asiento debe contener entre 2 y 500 lineas'],
        [[], 'El asiento debe contener entre 2 y 500 lineas'],
        [[balancedLines()[0]], 'El asiento debe contener entre 2 y 500 lineas'],
        [[null, balancedLines()[1]], 'Linea 1 no es valida'],
        [[Object.assign(() => undefined, balancedLines()[0]), balancedLines()[1]], 'Linea 1 no es valida'],
        [[
            { accountId: '', debit: '9.1', credit: '0' },
            balancedLines()[1],
        ], 'Cuenta de la linea 1 no es valido'],
        [[
            { accountId: 'a-cash', debit: '0', credit: '0' },
            balancedLines()[1],
        ], 'La linea 1 debe tener importe en un solo lado'],
        [[
            { accountId: 'a-cash', debit: '9.1', credit: '1' },
            balancedLines()[1],
        ], 'La linea 1 debe tener importe en un solo lado'],
    ] as const)('rechaza estructuras de línea ambiguas %#', (lines, message) => {
        expectJournalError(
            () => buildJournalPayloadHash(journalInput({ lines: lines as never })),
            message,
        );
    });

    it('protege ambos bordes del máximo de 500 líneas', () => {
        const fiveHundred = Array.from({ length: 500 }, (_, index) => ({
            accountId: `account-${index}`,
            debit: index < 250 ? '1' : '0',
            credit: index < 250 ? '0' : '1',
        }));
        expect(buildJournalPayloadHash(journalInput({ lines: fiveHundred })))
            .toMatch(/^[a-f0-9]{64}$/);
        expectJournalError(
            () => buildJournalPayloadHash(journalInput({
                lines: [...fiveHundred, { accountId: 'extra', debit: '1', credit: '0' }],
            })),
            'El asiento debe contener entre 2 y 500 lineas',
        );
    });

    it('rechaza el descuadre con totales exactos y conserva su diagnóstico', () => {
        expectJournalError(
            () => buildJournalPayloadHash(journalInput({
                lines: [
                    { accountId: 'a-cash', debit: '9.1000', credit: '0' },
                    { accountId: 'z-sales', debit: '0', credit: '9.0999' },
                ],
            })),
            'Asiento descuadrado: Debe=9.1000 Haber=9.0999',
            'JOURNAL_ENTRY_UNBALANCED',
            422,
        );
    });

    it('identifica Haber e índice exactos cuando falla el segundo lado', () => {
        expectJournalError(
            () => buildJournalPayloadHash(journalInput({
                lines: [
                    { accountId: 'a-cash', debit: '9.1000', credit: '0' },
                    { accountId: 'z-sales', debit: '0', credit: 'abc' },
                ],
            })),
            'Haber de la linea 2 no es un decimal valido',
        );
    });

    it('valida el formato SHA-256 declarado antes de cualquier acceso a datos', async () => {
        const db = {
            user: { findFirst: async () => null },
            journalEntry: { findFirst: async () => { throw new Error('no debe consultar'); } },
            $transaction: async () => { throw new Error('no debe abrir transacción'); },
        } as unknown as JournalPostingDatabase;
        const call = (payloadHash: unknown) => postJournalOnce({
            db,
            tenantId: 'tenant-a',
            userId: 'user-a',
            postingKey: 'sale:sale-42',
            payloadHash: payloadHash as string,
            economicDate: ECONOMIC_DATE,
            postingDate: POSTING_DATE,
            description: 'Venta 42',
            lines: balancedLines(),
        });

        for (const invalidHash of [null, 42]) {
            await expect(call(invalidHash)).rejects.toMatchObject({
                code: 'INVALID_JOURNAL_POSTING',
                httpStatus: 400,
                message: 'payloadHash es obligatorio',
            });
        }
        for (const invalidHash of ['', 'a'.repeat(63), 'g'.repeat(64),
            `x${'a'.repeat(64)}`, `${'a'.repeat(64)}x`]) {
            await expect(call(invalidHash)).rejects.toMatchObject({
                code: 'INVALID_JOURNAL_POSTING',
                httpStatus: 400,
                message: 'payloadHash debe ser una huella SHA-256 hexadecimal',
            });
        }
        const validHash = buildJournalPayloadHash({
            tenantId: 'tenant-a',
            economicDate: ECONOMIC_DATE,
            postingDate: POSTING_DATE,
            description: 'Venta 42',
            lines: balancedLines(),
        });
        await expect(call(`  ${validHash.toUpperCase()}  `)).rejects.toMatchObject({
            code: 'JOURNAL_POSTING_ACTOR_FORBIDDEN',
            httpStatus: 403,
        });
    });

    it('recarga el módulo dentro del test para matar reemplazos estáticos de la función', async () => {
        vi.resetModules();
        const fresh = await import('../backend/services/journalPosting');
        expect(fresh.buildJournalPayloadHash(journalInput())).toBe(
            '349649653574717a7a2c8d045ff120282a7951a19403897fc3c71ce92f156b2b',
        );
    });
});

describe('gate de mutación PR-01 — identidad canónica del cierre legacy', () => {
    const closeInput = {
        shiftId: 'shift-1',
        declaredCash: '100',
        auditNotes: '  Revisado  ',
    };

    it('congela el JSON y las dos huellas exactas del contrato legacy', () => {
        expect(canonicalizeCloseShiftPayload(closeInput)).toBe(
            '{"version":1,"shiftId":"shift-1","declaredCash":"100.00","declaredCashUsd":"0.0000","auditNotes":"Revisado"}',
        );
        expect(buildLegacyShiftCloseIdentity({ tenantId: 'tenant-a' }, closeInput)).toEqual({
            closeEventId: 'legacy:f07780a83d028308af5b7df911df2374e5c9a328c8851025e9ace2a02a6a21d5',
            closePayloadHash: '73308b19b0d5e7c7af4c86c34111032dce60e084ac8b47590c25199b7b767ed3',
        });
    });

    it('trata formatos equivalentes como el mismo cierre', () => {
        const equivalent = {
            shiftId: 'shift-1',
            declaredCash: 100,
            declaredCashUsd: '0.0000',
            auditNotes: 'Revisado',
        };
        expect(canonicalizeCloseShiftPayload(equivalent))
            .toBe(canonicalizeCloseShiftPayload(closeInput));
        expect(buildLegacyShiftCloseIdentity(
            { tenantId: 'tenant-a' },
            { ...equivalent, declaredCash: '100.00' },
        ))
            .toEqual(buildLegacyShiftCloseIdentity({ tenantId: 'tenant-a' }, closeInput));
    });

    it('separa tenant, turno, importes, notas y evento explícito sin mezclar responsabilidades', () => {
        const baseline = buildLegacyShiftCloseIdentity({ tenantId: 'tenant-a' }, closeInput);
        const otherTenant = buildLegacyShiftCloseIdentity({ tenantId: 'tenant-b' }, closeInput);
        expect(otherTenant.closeEventId).not.toBe(baseline.closeEventId);
        expect(otherTenant.closePayloadHash).toBe(baseline.closePayloadHash);

        const otherShift = buildLegacyShiftCloseIdentity(
            { tenantId: 'tenant-a' },
            { ...closeInput, shiftId: 'shift-2' },
        );
        expect(otherShift.closeEventId).not.toBe(baseline.closeEventId);
        expect(otherShift.closePayloadHash).not.toBe(baseline.closePayloadHash);

        for (const changed of [
            { ...closeInput, declaredCash: '100.01' },
            { ...closeInput, declaredCashUsd: '1' },
            { ...closeInput, auditNotes: 'Otro arqueo' },
        ]) {
            const identity = buildLegacyShiftCloseIdentity({ tenantId: 'tenant-a' }, changed);
            expect(identity.closeEventId).toBe(baseline.closeEventId);
            expect(identity.closePayloadHash).not.toBe(baseline.closePayloadHash);
        }

        const explicit = buildLegacyShiftCloseIdentity(
            { tenantId: 'tenant-a' },
            { ...closeInput, clientEventId: '4ac0efc2-fb48-48c8-936a-9bf4dbdf8278' },
        );
        expect(explicit).toEqual({
            closeEventId: '4ac0efc2-fb48-48c8-936a-9bf4dbdf8278',
            closePayloadHash: baseline.closePayloadHash,
        });
    });

    it('normaliza notas omitidas o blancas a null y preserva cero explícito', () => {
        expect(canonicalizeCloseShiftPayload({ shiftId: 's', declaredCash: '0' })).toBe(
            '{"version":1,"shiftId":"s","declaredCash":"0.00","declaredCashUsd":"0.0000","auditNotes":null}',
        );
        expect(canonicalizeCloseShiftPayload({
            shiftId: 's',
            declaredCash: '0.00',
            declaredCashUsd: 0,
            auditNotes: '   ',
        })).toBe(
            '{"version":1,"shiftId":"s","declaredCash":"0.00","declaredCashUsd":"0.0000","auditNotes":null}',
        );
    });

    it('recarga las funciones dentro del test para matar reemplazos estáticos', async () => {
        vi.resetModules();
        const [{ buildLegacyShiftCloseIdentity: freshIdentity }, { canonicalizeCloseShiftPayload: freshCanonicalize }]
            = await Promise.all([
                import('../backend/services/legacyShiftCloseService'),
                import('../backend/validation/schemas'),
            ]);
        expect(freshCanonicalize(closeInput)).toBe(
            '{"version":1,"shiftId":"shift-1","declaredCash":"100.00","declaredCashUsd":"0.0000","auditNotes":"Revisado"}',
        );
        expect(freshIdentity({ tenantId: 'tenant-a' }, closeInput)).toEqual({
            closeEventId: 'legacy:f07780a83d028308af5b7df911df2374e5c9a328c8851025e9ace2a02a6a21d5',
            closePayloadHash: '73308b19b0d5e7c7af4c86c34111032dce60e084ac8b47590c25199b7b767ed3',
        });
    });
});
