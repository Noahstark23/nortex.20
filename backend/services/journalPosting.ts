/**
 * Posting contable idempotente para eventos financieros nuevos.
 *
 * Invariantes:
 * - `tenantId` y `userId` siempre son contexto servidor, nunca payload HTTP.
 * - el encabezado con `postingKey` se reclama antes de mover saldos;
 * - un replay exacto devuelve el mismo asiento y no vuelve a auditar;
 * - una colision con otro payload falla cerrado;
 * - un reverso copia las lineas persistidas e intercambia Debe/Haber.
 */

import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { fiscalCivilDate } from '../lib/fiscalAccess';

const MONEY_SCALE = 4;
const MAX_MONEY = new Decimal('99999999999999.9999');
const MAX_LINES = 500;

export type ExactJournalAmount = string | Decimal;

export interface JournalPostingLineInput {
    accountId: string;
    debit: ExactJournalAmount;
    credit: ExactJournalAmount;
}

export interface JournalHeaderRecord {
    id: string;
    tenantId: string;
    date: Date;
    description: string;
    referenceId: string | null;
    referenceType: string | null;
    isAutomatic: boolean;
    createdBy: string;
    createdAt: Date;
    postingKey: string | null;
    payloadHash: string | null;
    economicDate: Date | null;
    postedAt: Date | null;
    entryKind: string;
    reversalOfId: string | null;
}

interface OriginalJournalRecord extends JournalHeaderRecord {
    lines: Array<{
        id: string;
        accountId: string;
        debit: unknown;
        credit: unknown;
    }>;
}

interface AccountRecord {
    id: string;
    code: string;
    type: string;
    balance: unknown;
}

interface JournalEntryReadDelegate {
    findFirst(args: unknown): Promise<JournalHeaderRecord | OriginalJournalRecord | null>;
}

interface JournalPostingTx {
    user: {
        findFirst(args: unknown): Promise<{ id: string } | null>;
    };
    fiscalPeriod: {
        findUnique(args: unknown): Promise<{ status: string } | null>;
    };
    account: {
        findMany(args: unknown): Promise<AccountRecord[]>;
        updateMany(args: unknown): Promise<{ count: number }>;
    };
    journalEntry: JournalEntryReadDelegate & {
        create(args: unknown): Promise<JournalHeaderRecord>;
    };
    journalLine: {
        createMany(args: unknown): Promise<{ count: number }>;
    };
    auditLog: {
        create(args: unknown): Promise<unknown>;
    };
}

/**
 * Interfaz estructural pequena para poder probar carreras sin otro PrismaClient.
 * El singleton real se adapta en el borde; nunca se instancia un cliente nuevo.
 */
export interface JournalPostingDatabase {
    user: JournalPostingTx['user'];
    journalEntry: JournalEntryReadDelegate;
    $transaction<T>(
        callback: (tx: JournalPostingTx) => Promise<T>,
        options?: { isolationLevel?: unknown },
    ): Promise<T>;
}

export interface PostJournalOnceInput {
    db?: JournalPostingDatabase;
    tenantId: string;
    userId: string;
    postingKey: string;
    payloadHash: string;
    economicDate: Date;
    postingDate: Date;
    postedAt?: Date;
    description: string;
    referenceId?: string | null;
    referenceType?: string | null;
    isAutomatic?: boolean;
    lines: JournalPostingLineInput[];
}

export interface ReverseJournalOnceInput {
    db?: JournalPostingDatabase;
    tenantId: string;
    userId: string;
    originalEntryId: string;
    postingKey: string;
    payloadHash: string;
    economicDate?: Date;
    postingDate: Date;
    postedAt?: Date;
    description?: string;
}

export interface JournalPostingResult {
    entry: JournalHeaderRecord;
    idempotentReplay: boolean;
}

export class JournalPostingError extends Error {
    constructor(
        public readonly code: string,
        public readonly httpStatus: number,
        message: string,
    ) {
        super(message);
        this.name = 'JournalPostingError';
    }
}

interface NormalizedLine {
    accountId: string;
    debit: string;
    credit: string;
}

interface NormalizedPostCommand {
    tenantId: string;
    userId: string;
    postingKey: string;
    payloadHash: string;
    economicDate: Date;
    postingDate: Date;
    postedAt: Date;
    description: string;
    referenceId: string | null;
    referenceType: string | null;
    isAutomatic: boolean;
    lines: NormalizedLine[];
}

export interface JournalPayloadHashInput {
    tenantId: string;
    economicDate: Date;
    postingDate: Date;
    description: string;
    referenceId?: string | null;
    referenceType?: string | null;
    isAutomatic?: boolean;
    entryKind?: 'ORIGINAL' | 'REVERSAL';
    reversalOfId?: string | null;
    lines: JournalPostingLineInput[];
}

const journalHeaderSelect = {
    id: true,
    tenantId: true,
    date: true,
    description: true,
    referenceId: true,
    referenceType: true,
    isAutomatic: true,
    createdBy: true,
    createdAt: true,
    postingKey: true,
    payloadHash: true,
    economicDate: true,
    postedAt: true,
    entryKind: true,
    reversalOfId: true,
} as const;

const invalid = (message: string): never => {
    throw new JournalPostingError('INVALID_JOURNAL_POSTING', 400, message);
};

const conflict = (): never => {
    throw new JournalPostingError(
        'JOURNAL_POSTING_IDEMPOTENCY_CONFLICT',
        409,
        'La clave contable ya fue usada con una intencion economica diferente',
    );
};

const normalizeIdentifier = (value: unknown, label: string, maxLength = 191): string => {
    if (typeof value !== 'string') return invalid(`${label} es obligatorio`);
    const normalized = value.trim();
    if (!normalized || normalized.length > maxLength) {
        return invalid(`${label} no es valido`);
    }
    return normalized;
};

const normalizeOptionalIdentifier = (
    value: unknown,
    label: string,
    maxLength = 191,
): string | null => {
    if (value == null) return null;
    if (typeof value !== 'string') return invalid(`${label} no es valido`);
    const normalized = value.trim();
    if (!normalized) return null;
    if (normalized.length > maxLength) return invalid(`${label} no es valido`);
    return normalized;
};

const normalizeHash = (value: unknown): string => {
    if (typeof value !== 'string') return invalid('payloadHash es obligatorio');
    const normalized = value.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalized)) {
        return invalid('payloadHash debe ser una huella SHA-256 hexadecimal');
    }
    return normalized;
};

const normalizeDate = (value: unknown, label: string): Date => {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
        return invalid(`${label} no es una fecha valida`);
    }
    return new Date(value.getTime());
};

const decimalText = (value: unknown, label: string): string => {
    if (typeof value !== 'string' && !Decimal.isDecimal(value)) {
        if (value == null || typeof value === 'number' || typeof value === 'bigint') {
            return invalid(`${label} debe recibirse como Decimal o texto exacto`);
        }
        return invalid(`${label} no es un decimal valido`);
    }

    let decimal: Decimal;
    try {
        decimal = new Decimal(String(value));
    } catch {
        return invalid(`${label} no es un decimal valido`);
    }
    if (
        !decimal.isFinite()
        || decimal.isNegative()
        || decimal.decimalPlaces() > MONEY_SCALE
        || decimal.greaterThan(MAX_MONEY)
    ) {
        return invalid(`${label} debe ser positivo, finito y tener maximo ${MONEY_SCALE} decimales`);
    }
    return decimal.toFixed(MONEY_SCALE);
};

const normalizeLines = (lines: unknown): NormalizedLine[] => {
    if (!Array.isArray(lines) || lines.length < 2 || lines.length > MAX_LINES) {
        return invalid(`El asiento debe contener entre 2 y ${MAX_LINES} lineas`);
    }

    const normalized = lines.map((raw, index) => {
        if (!raw || typeof raw !== 'object') return invalid(`Linea ${index + 1} no es valida`);
        const line = raw as Partial<JournalPostingLineInput>;
        const debit = decimalText(line.debit, `Debe de la linea ${index + 1}`);
        const credit = decimalText(line.credit, `Haber de la linea ${index + 1}`);
        const debitAmount = new Decimal(debit);
        const creditAmount = new Decimal(credit);
        if (debitAmount.isZero() === creditAmount.isZero()) {
            return invalid(`La linea ${index + 1} debe tener importe en un solo lado`);
        }
        return {
            accountId: normalizeIdentifier(line.accountId, `Cuenta de la linea ${index + 1}`),
            debit,
            credit,
        };
    });

    const totalDebit = normalized.reduce(
        (sum, line) => sum.plus(line.debit),
        new Decimal(0),
    );
    const totalCredit = normalized.reduce(
        (sum, line) => sum.plus(line.credit),
        new Decimal(0),
    );
    if (!totalDebit.equals(totalCredit) || totalDebit.isZero()) {
        throw new JournalPostingError(
            'JOURNAL_ENTRY_UNBALANCED',
            422,
            `Asiento descuadrado: Debe=${totalDebit.toFixed(4)} Haber=${totalCredit.toFixed(4)}`,
        );
    }
    return normalized;
};

const canonicalPayloadHash = (
    command: Omit<NormalizedPostCommand, 'userId' | 'postingKey' | 'payloadHash' | 'postedAt'>,
    entryKind: 'ORIGINAL' | 'REVERSAL',
    reversalOfId: string | null,
): string => createHash('sha256').update(JSON.stringify({
    version: 1,
    tenantId: command.tenantId,
    economicDate: command.economicDate.toISOString(),
    postingDate: command.postingDate.toISOString(),
    description: command.description,
    referenceId: command.referenceId,
    referenceType: command.referenceType,
    isAutomatic: command.isAutomatic,
    entryKind,
    reversalOfId,
    lines: [...command.lines].sort((left, right) =>
        left.accountId.localeCompare(right.accountId)
        || left.debit.localeCompare(right.debit)
        || left.credit.localeCompare(right.credit)),
})).digest('hex');

/**
 * Huella canonica tenant-scoped. Excluye `postingKey`, actor y `postedAt`:
 * identifican/retratan el comando, pero no cambian su intencion economica.
 */
export const buildJournalPayloadHash = (input: JournalPayloadHashInput): string => {
    const entryKind = input.entryKind ?? 'ORIGINAL';
    const reversalOfId = entryKind === 'REVERSAL'
        ? normalizeIdentifier(input.reversalOfId, 'reversalOfId')
        : null;
    return canonicalPayloadHash({
        tenantId: normalizeIdentifier(input.tenantId, 'tenantId'),
        economicDate: normalizeDate(input.economicDate, 'economicDate'),
        postingDate: normalizeDate(input.postingDate, 'postingDate'),
        description: normalizeIdentifier(input.description, 'description', 10_000),
        referenceId: normalizeOptionalIdentifier(input.referenceId, 'referenceId'),
        referenceType: normalizeOptionalIdentifier(input.referenceType, 'referenceType'),
        isAutomatic: input.isAutomatic ?? true,
        lines: normalizeLines(input.lines),
    }, entryKind, reversalOfId);
};

const assertCanonicalPayloadHash = (
    command: NormalizedPostCommand,
    entryKind: 'ORIGINAL' | 'REVERSAL',
    reversalOfId: string | null,
): void => {
    const expected = canonicalPayloadHash(command, entryKind, reversalOfId);
    if (command.payloadHash !== expected) conflict();
};

const normalizePostCommand = (input: PostJournalOnceInput): NormalizedPostCommand => {
    const postedAt = normalizeDate(input.postedAt ?? new Date(), 'postedAt');
    const command = {
        tenantId: normalizeIdentifier(input.tenantId, 'tenantId'),
        userId: normalizeIdentifier(input.userId, 'userId'),
        postingKey: normalizeIdentifier(input.postingKey, 'postingKey'),
        payloadHash: normalizeHash(input.payloadHash),
        economicDate: normalizeDate(input.economicDate, 'economicDate'),
        postingDate: normalizeDate(input.postingDate, 'postingDate'),
        postedAt,
        description: normalizeIdentifier(input.description, 'description', 10_000),
        referenceId: normalizeOptionalIdentifier(input.referenceId, 'referenceId'),
        referenceType: normalizeOptionalIdentifier(input.referenceType, 'referenceType'),
        isAutomatic: input.isAutomatic ?? true,
        lines: normalizeLines(input.lines),
    };
    assertCanonicalPayloadHash(command, 'ORIGINAL', null);
    return command;
};

const isPrismaCode = (error: unknown, code: 'P2002' | 'P2034'): boolean =>
    error instanceof Prisma.PrismaClientKnownRequestError
        ? error.code === code
        : typeof error === 'object'
            && error !== null
            && 'code' in error
            && (error as { code?: unknown }).code === code;

const assertActiveActor = async (
    database: Pick<JournalPostingTx, 'user'>,
    tenantId: string,
    userId: string,
): Promise<void> => {
    const actor = await database.user.findFirst({
        where: { id: userId, tenantId, status: 'ACTIVE' },
        select: { id: true },
    });
    if (!actor) {
        throw new JournalPostingError(
            'JOURNAL_POSTING_ACTOR_FORBIDDEN',
            403,
            'El usuario no esta activo en este negocio para contabilizar',
        );
    }
};

const findByPostingKey = async (
    database: { journalEntry: JournalEntryReadDelegate },
    tenantId: string,
    postingKey: string,
): Promise<JournalHeaderRecord | null> => database.journalEntry.findFirst({
    where: { tenantId, postingKey },
    select: journalHeaderSelect,
}) as Promise<JournalHeaderRecord | null>;

const findReversal = async (
    database: { journalEntry: JournalEntryReadDelegate },
    tenantId: string,
    originalEntryId: string,
): Promise<JournalHeaderRecord | null> => database.journalEntry.findFirst({
    where: { tenantId, reversalOfId: originalEntryId },
    select: journalHeaderSelect,
}) as Promise<JournalHeaderRecord | null>;

const replayOriginal = (
    entry: JournalHeaderRecord,
    input: { postingKey: string; payloadHash: string },
): JournalPostingResult => {
    if (
        entry.postingKey !== input.postingKey
        || entry.payloadHash !== input.payloadHash
        || entry.entryKind !== 'ORIGINAL'
        || entry.reversalOfId !== null
    ) return conflict();
    return { entry, idempotentReplay: true };
};

const replayReversal = (
    entry: JournalHeaderRecord,
    input: { postingKey: string; payloadHash: string; originalEntryId: string },
): JournalPostingResult => {
    if (
        entry.postingKey !== input.postingKey
        || entry.payloadHash !== input.payloadHash
        || entry.entryKind !== 'REVERSAL'
        || entry.reversalOfId !== input.originalEntryId
    ) return conflict();
    return { entry, idempotentReplay: true };
};

const assertPeriodOpen = async (
    tx: Pick<JournalPostingTx, 'fiscalPeriod'>,
    tenantId: string,
    postingDate: Date,
): Promise<void> => {
    // Nortex opera fiscalmente en Nicaragua. Derivar el mes con la timezone del
    // host permitiria que el mismo ISO caiga en periodos distintos segun deploy.
    const [yearText, monthText] = fiscalCivilDate(postingDate).period.split('-');
    const year = Number(yearText);
    const month = Number(monthText);
    if (!Number.isInteger(year) || !Number.isInteger(month)) {
        return invalid('No se pudo resolver el periodo fiscal de postingDate');
    }
    const period = await tx.fiscalPeriod.findUnique({
        where: { tenantId_year_month: { tenantId, year, month } },
        select: { status: true },
    });
    if (period?.status === 'CLOSED') {
        throw new JournalPostingError(
            'JOURNAL_PERIOD_LOCKED',
            409,
            `El periodo ${year}-${String(month).padStart(2, '0')} esta cerrado`,
        );
    }
};

const accountDelta = (accountType: string, debit: Decimal, credit: Decimal): Decimal => {
    if (accountType === 'ASSET' || accountType === 'EXPENSE') return debit.minus(credit);
    if (accountType === 'LIABILITY' || accountType === 'EQUITY' || accountType === 'REVENUE') {
        return credit.minus(debit);
    }
    return invalid(`Tipo de cuenta contable no soportado: ${accountType}`);
};

const executePosting = async (
    tx: JournalPostingTx,
    command: NormalizedPostCommand,
    options: {
        entryKind: 'ORIGINAL' | 'REVERSAL';
        reversalOfId: string | null;
        auditAction: 'JOURNAL_POSTED' | 'JOURNAL_REVERSED';
    },
): Promise<JournalPostingResult> => {
    await assertPeriodOpen(tx, command.tenantId, command.postingDate);

    const accountIds = [...new Set(command.lines.map(line => line.accountId))].sort();
    const accounts = await tx.account.findMany({
        where: { tenantId: command.tenantId, id: { in: accountIds } },
        select: { id: true, code: true, type: true, balance: true },
        orderBy: [{ code: 'asc' }, { id: 'asc' }],
        take: accountIds.length,
    });
    const accountsById = new Map(accounts.map(account => [account.id, account]));
    const missing = accountIds.filter(accountId => !accountsById.has(accountId));
    if (missing.length > 0) {
        throw new JournalPostingError(
            'JOURNAL_ACCOUNT_NOT_FOUND',
            422,
            'Una o mas cuentas no existen en el negocio autenticado',
        );
    }

    // La restriccion UNIQUE se reclama antes de lineas, saldos y auditoria.
    // Si otra transaccion gana, MySQL aborta esta transaccion completa con P2002.
    const entry = await tx.journalEntry.create({
        data: {
            tenantId: command.tenantId,
            date: command.postingDate,
            economicDate: command.economicDate,
            postedAt: command.postedAt,
            description: command.description,
            referenceId: command.referenceId,
            referenceType: command.referenceType,
            isAutomatic: command.isAutomatic,
            createdBy: command.userId,
            postingKey: command.postingKey,
            payloadHash: command.payloadHash,
            entryKind: options.entryKind,
            reversalOfId: options.reversalOfId,
        },
        select: journalHeaderSelect,
    });

    const createdLines = await tx.journalLine.createMany({
        data: command.lines.map(line => ({
            journalEntryId: entry.id,
            accountId: line.accountId,
            debit: line.debit,
            credit: line.credit,
        })),
    });
    if (createdLines.count !== command.lines.length) {
        throw new JournalPostingError(
            'JOURNAL_LINES_INCOMPLETE',
            500,
            'No se persistieron todas las lineas del asiento',
        );
    }

    const deltas = new Map<string, Decimal>();
    for (const line of command.lines) {
        const account = accountsById.get(line.accountId)!;
        const delta = accountDelta(account.type, new Decimal(line.debit), new Decimal(line.credit));
        deltas.set(line.accountId, (deltas.get(line.accountId) ?? new Decimal(0)).plus(delta));
    }

    // Mismo orden canonico para reducir deadlocks entre asientos concurrentes.
    const orderedAccounts = [...accounts].sort((left, right) =>
        left.code.localeCompare(right.code) || left.id.localeCompare(right.id));
    for (const account of orderedAccounts) {
        const delta = deltas.get(account.id) ?? new Decimal(0);
        // Incluso el neto cero ejecuta UPDATE: asi toda cuenta del asiento queda
        // bloqueada hasta el AuditLog y su before/after no mezcla otra tx bajo RC.
        const updated = await tx.account.updateMany({
            where: { id: account.id, tenantId: command.tenantId },
            data: { balance: { increment: delta.toFixed(MONEY_SCALE) } },
        });
        if (updated.count !== 1) {
            throw new JournalPostingError(
                'JOURNAL_ACCOUNT_CONCURRENTLY_MISSING',
                409,
                'Una cuenta dejo de estar disponible durante la contabilizacion',
            );
        }
    }

    const balancesAfter = await tx.account.findMany({
        where: { tenantId: command.tenantId, id: { in: accountIds } },
        select: { id: true, code: true, type: true, balance: true },
        orderBy: [{ code: 'asc' }, { id: 'asc' }],
        take: accountIds.length,
    });
    if (balancesAfter.length !== accountIds.length) {
        throw new JournalPostingError(
            'JOURNAL_ACCOUNT_CONCURRENTLY_MISSING',
            409,
            'No se pudo reconstruir el saldo auditado del asiento',
        );
    }

    await tx.auditLog.create({
        data: {
            tenantId: command.tenantId,
            userId: command.userId,
            action: options.auditAction,
            details: JSON.stringify({
                version: 1,
                journalEntryId: entry.id,
                postingKey: command.postingKey,
                payloadHash: command.payloadHash,
                entryKind: options.entryKind,
                reversalOfId: options.reversalOfId,
                economicDate: command.economicDate.toISOString(),
                postingDate: command.postingDate.toISOString(),
                lines: command.lines,
                accounts: balancesAfter.map(account => {
                    const after = new Decimal(String(account.balance));
                    const delta = deltas.get(account.id) ?? new Decimal(0);
                    return {
                        accountId: account.id,
                        code: account.code,
                        before: after.minus(delta).toFixed(MONEY_SCALE),
                        after: after.toFixed(MONEY_SCALE),
                    };
                }),
            }),
            createdAt: command.postedAt,
        },
    });

    return { entry, idempotentReplay: false };
};

/**
 * Crea una sola poliza por `tenantId + postingKey`.
 * El catch de P2002 vive fuera de la transaccion perdedora para poder observar
 * al ganador ya confirmado bajo un snapshot fresco.
 */
export async function postJournalOnce(input: PostJournalOnceInput): Promise<JournalPostingResult> {
    const command = normalizePostCommand(input);
    const db = input.db ?? (prisma as unknown as JournalPostingDatabase);

    await assertActiveActor(db, command.tenantId, command.userId);
    const existing = await findByPostingKey(db, command.tenantId, command.postingKey);
    if (existing) return replayOriginal(existing, command);

    try {
        return await db.$transaction(async tx => {
            await assertActiveActor(tx, command.tenantId, command.userId);
            const lockedReplay = await findByPostingKey(tx, command.tenantId, command.postingKey);
            if (lockedReplay) return replayOriginal(lockedReplay, command);
            return executePosting(tx, command, {
                entryKind: 'ORIGINAL',
                reversalOfId: null,
                auditAction: 'JOURNAL_POSTED',
            });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
        if (isPrismaCode(error, 'P2034')) {
            throw new JournalPostingError(
                'JOURNAL_CONCURRENT_WRITE',
                409,
                'La contabilizacion choco con otro movimiento; intenta nuevamente',
            );
        }
        if (!isPrismaCode(error, 'P2002')) throw error;
        await assertActiveActor(db, command.tenantId, command.userId);
        const winner = await findByPostingKey(db, command.tenantId, command.postingKey);
        if (!winner) throw error;
        return replayOriginal(winner, command);
    }
}

const loadOriginal = async (
    tx: { journalEntry: JournalEntryReadDelegate },
    tenantId: string,
    originalEntryId: string,
): Promise<OriginalJournalRecord | null> => tx.journalEntry.findFirst({
    where: { id: originalEntryId, tenantId },
    select: {
        ...journalHeaderSelect,
        lines: {
            select: { id: true, accountId: true, debit: true, credit: true },
            orderBy: { id: 'asc' },
        },
    },
}) as Promise<OriginalJournalRecord | null>;

/** Crea un unico reverso exacto para un asiento original del mismo tenant. */
export async function reverseJournalOnce(input: ReverseJournalOnceInput): Promise<JournalPostingResult> {
    const tenantId = normalizeIdentifier(input.tenantId, 'tenantId');
    const userId = normalizeIdentifier(input.userId, 'userId');
    const originalEntryId = normalizeIdentifier(input.originalEntryId, 'originalEntryId');
    const postingKey = normalizeIdentifier(input.postingKey, 'postingKey');
    const payloadHash = normalizeHash(input.payloadHash);
    const postedAt = normalizeDate(input.postedAt ?? new Date(), 'postedAt');
    const postingDate = normalizeDate(input.postingDate, 'postingDate');
    const db = input.db ?? (prisma as unknown as JournalPostingDatabase);

    await assertActiveActor(db, tenantId, userId);
    const originalPreview = await loadOriginal(db, tenantId, originalEntryId);
    if (!originalPreview) {
        throw new JournalPostingError(
            'JOURNAL_ENTRY_NOT_FOUND',
            404,
            'No se encontro el asiento original en el negocio autenticado',
        );
    }
    if (originalPreview.entryKind === 'REVERSAL' || originalPreview.reversalOfId !== null) {
        throw new JournalPostingError(
            'JOURNAL_REVERSAL_OF_REVERSAL_FORBIDDEN',
            409,
            'Un reverso no puede revertirse como si fuera un asiento original',
        );
    }
    const previewEconomicDate = input.economicDate
        ? normalizeDate(input.economicDate, 'economicDate')
        : new Date((originalPreview.economicDate ?? originalPreview.date).getTime());
    const previewCommand: NormalizedPostCommand = {
        tenantId,
        userId,
        postingKey,
        payloadHash,
        economicDate: previewEconomicDate,
        postingDate,
        postedAt,
        description: input.description
            ? normalizeIdentifier(input.description, 'description', 10_000)
            : `Reverso: ${originalPreview.description}`,
        referenceId: originalPreview.id,
        referenceType: 'JOURNAL_REVERSAL',
        isAutomatic: true,
        lines: normalizeLines(originalPreview.lines.map(line => ({
            accountId: line.accountId,
            debit: line.credit,
            credit: line.debit,
        }))),
    };
    assertCanonicalPayloadHash(previewCommand, 'REVERSAL', originalPreview.id);
    const existingReversal = await findReversal(db, tenantId, originalEntryId);
    if (existingReversal) {
        return replayReversal(existingReversal, { postingKey, payloadHash, originalEntryId });
    }
    const existingKey = await findByPostingKey(db, tenantId, postingKey);
    if (existingKey) {
        return replayReversal(existingKey, { postingKey, payloadHash, originalEntryId });
    }

    try {
        return await db.$transaction(async tx => {
            await assertActiveActor(tx, tenantId, userId);
            const replayByReversal = await findReversal(tx, tenantId, originalEntryId);
            if (replayByReversal) {
                return replayReversal(replayByReversal, { postingKey, payloadHash, originalEntryId });
            }
            const replayByKey = await findByPostingKey(tx, tenantId, postingKey);
            if (replayByKey) {
                return replayReversal(replayByKey, { postingKey, payloadHash, originalEntryId });
            }

            const original = await loadOriginal(tx, tenantId, originalEntryId);
            if (!original) {
                throw new JournalPostingError(
                    'JOURNAL_ENTRY_NOT_FOUND',
                    404,
                    'No se encontro el asiento original en el negocio autenticado',
                );
            }
            if (original.entryKind === 'REVERSAL' || original.reversalOfId !== null) {
                throw new JournalPostingError(
                    'JOURNAL_REVERSAL_OF_REVERSAL_FORBIDDEN',
                    409,
                    'Un reverso no puede revertirse como si fuera un asiento original',
                );
            }
            if (original.lines.length < 2) {
                throw new JournalPostingError(
                    'JOURNAL_ORIGINAL_INCOMPLETE',
                    500,
                    'El asiento original no contiene lineas suficientes para reversarlo',
                );
            }

            const economicDate = input.economicDate
                ? normalizeDate(input.economicDate, 'economicDate')
                : new Date((original.economicDate ?? original.date).getTime());
            const lines = normalizeLines(original.lines.map(line => ({
                accountId: line.accountId,
                debit: line.credit,
                credit: line.debit,
            })));
            const command: NormalizedPostCommand = {
                tenantId,
                userId,
                postingKey,
                payloadHash,
                economicDate,
                postingDate,
                postedAt,
                description: input.description
                    ? normalizeIdentifier(input.description, 'description', 10_000)
                    : `Reverso: ${original.description}`,
                referenceId: original.id,
                referenceType: 'JOURNAL_REVERSAL',
                isAutomatic: true,
                lines,
            };
            assertCanonicalPayloadHash(command, 'REVERSAL', original.id);
            return executePosting(tx, command, {
                entryKind: 'REVERSAL',
                reversalOfId: original.id,
                auditAction: 'JOURNAL_REVERSED',
            });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
        if (isPrismaCode(error, 'P2034')) {
            throw new JournalPostingError(
                'JOURNAL_CONCURRENT_WRITE',
                409,
                'El reverso choco con otro movimiento; intenta nuevamente',
            );
        }
        if (!isPrismaCode(error, 'P2002')) throw error;

        await assertActiveActor(db, tenantId, userId);
        const winnerByReversal = await findReversal(db, tenantId, originalEntryId);
        if (winnerByReversal) {
            return replayReversal(winnerByReversal, { postingKey, payloadHash, originalEntryId });
        }
        const winnerByKey = await findByPostingKey(db, tenantId, postingKey);
        if (winnerByKey) {
            return replayReversal(winnerByKey, { postingKey, payloadHash, originalEntryId });
        }
        throw error;
    }
}
