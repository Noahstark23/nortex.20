import type { Request, RequestHandler, Response } from 'express';

type ResetTenant = {
    id: string;
    type: string;
    businessName: string;
};

type ResetUser = {
    id: string;
    tenantId: string;
    email: string | null;
    name: string | null;
    role: string;
    status: string;
    tenant: ResetTenant | null;
};

type ResetRecord = {
    id: string;
    userId: string;
    used: boolean;
    expiresAt: Date;
    user: ResetUser;
};

type MutationResult = { count: number };

type ResetTransaction = {
    passwordReset: {
        updateMany(args: unknown): Promise<MutationResult>;
    };
    user: {
        updateMany(args: unknown): Promise<MutationResult>;
    };
};

export type PasswordResetPrisma = {
    passwordReset: {
        findUnique(args: unknown): Promise<ResetRecord | null>;
    };
    $transaction<T>(work: (tx: ResetTransaction) => Promise<T>): Promise<T>;
};

type PasswordResetDependencies = {
    prisma: PasswordResetPrisma;
    hashPassword: (password: string) => Promise<string>;
    signToken: (payload: {
        userId: string;
        tenantId: string;
        role: string;
        email?: string;
    }) => string;
    now?: () => Date;
    logError?: (message: string, details?: unknown) => void;
};

const INVALID_LINK = 'Link inválido o expirado.';
const RESET_INTEGRITY_ERROR = 'No se pudo completar el restablecimiento. Solicitá un nuevo link o contactá a soporte.';
const RESET_TOKEN_CONFLICT = 'RESET_TOKEN_CONFLICT';

const resetRecordSelect = {
    id: true,
    userId: true,
    used: true,
    expiresAt: true,
    user: {
        select: {
            id: true,
            tenantId: true,
            email: true,
            name: true,
            role: true,
            status: true,
            tenant: {
                select: {
                    id: true,
                    type: true,
                    businessName: true,
                },
            },
        },
    },
} as const;

function resolveValidTenant(record: ResetRecord): ResetTenant | null {
    const tenant = record.user.tenant;
    return tenant
        && tenant.id === record.user.tenantId
        && record.user.status === 'ACTIVE'
        ? tenant
        : null;
}

function rejectInvalidToken(record: ResetRecord | null, now: Date, res: Response): boolean {
    if (!record) {
        res.status(404).json({ error: INVALID_LINK });
        return true;
    }

    if (record.used) {
        res.status(400).json({ error: 'Este link ya fue utilizado.' });
        return true;
    }

    if (now > record.expiresAt) {
        res.status(400).json({ error: 'Este link ha expirado. Solicita uno nuevo.' });
        return true;
    }

    return false;
}

export function createValidatePasswordResetHandler({
    prisma,
    now = () => new Date(),
    logError = console.error,
}: Pick<PasswordResetDependencies, 'prisma' | 'now' | 'logError'>): RequestHandler {
    return async (req: Request, res: Response) => {
        try {
            const resetRecord = await prisma.passwordReset.findUnique({
                where: { token: req.params.token },
                select: resetRecordSelect,
            });

            if (rejectInvalidToken(resetRecord, now(), res)) return;
            if (!resetRecord) return;

            // GET y POST validan el mismo principal. Un usuario inactivo o una
            // relación tenant dañada nunca anuncia identidad asociada al token.
            if (!resolveValidTenant(resetRecord)) {
                res.status(404).json({ error: INVALID_LINK });
                return;
            }

            res.json({
                valid: true,
                email: resetRecord.user.email,
                name: resetRecord.user.name,
            });
        } catch (error) {
            logError('Validate reset token error:', error);
            res.status(500).json({ error: 'Error validando link.' });
        }
    };
}

export function createCompletePasswordResetHandler({
    prisma,
    hashPassword,
    signToken,
    now = () => new Date(),
    logError = console.error,
}: PasswordResetDependencies): RequestHandler {
    return async (req: Request, res: Response) => {
        const { password } = req.body ?? {};

        try {
            if (typeof password !== 'string' || password.length < 8) {
                res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
                return;
            }

            const resetRecord = await prisma.passwordReset.findUnique({
                where: { token: req.params.token },
                select: resetRecordSelect,
            });

            const requestTime = now();
            if (rejectInvalidToken(resetRecord, requestTime, res)) return;
            if (!resetRecord) return;

            const tenant = resolveValidTenant(resetRecord);
            if (!tenant) {
                logError('Reset password principal integrity error', {
                    resetId: resetRecord.id,
                    userId: resetRecord.userId,
                });
                res.status(409).json({ error: RESET_INTEGRITY_ERROR });
                return;
            }

            // Preparar contraseña y sesión antes de reclamar el token. Si una de
            // estas operaciones falla, no consumimos el reset.
            const hashedPassword = await hashPassword(password);
            const jwtToken = signToken({
                userId: resetRecord.user.id,
                tenantId: resetRecord.user.tenantId,
                role: resetRecord.user.role,
                email: resetRecord.user.email ?? undefined,
            });
            const claimTime = now();

            await prisma.$transaction(async (tx) => {
                // Claim atómico: dos POST concurrentes no pueden imponer dos
                // contraseñas diferentes con el mismo link.
                const tokenClaim = await tx.passwordReset.updateMany({
                    where: {
                        id: resetRecord.id,
                        userId: resetRecord.userId,
                        used: false,
                        expiresAt: { gt: claimTime },
                    },
                    data: { used: true },
                });

                const userUpdate = tokenClaim.count === 1
                    ? await tx.user.updateMany({
                        where: {
                            id: resetRecord.userId,
                            tenantId: resetRecord.user.tenantId,
                            status: 'ACTIVE',
                            role: resetRecord.user.role,
                        },
                        data: { password: hashedPassword },
                    })
                    : { count: 0 };

                if (tokenClaim.count !== 1 || userUpdate.count !== 1) {
                    throw new Error(RESET_TOKEN_CONFLICT);
                }

                await tx.passwordReset.updateMany({
                    where: {
                        userId: resetRecord.userId,
                        used: false,
                        id: { not: resetRecord.id },
                    },
                    data: { used: true },
                });
            });

            res.json({
                message: 'Contraseña actualizada exitosamente.',
                token: jwtToken,
                user: {
                    id: resetRecord.user.id,
                    email: resetRecord.user.email,
                    name: resetRecord.user.name,
                    role: resetRecord.user.role,
                },
                tenant: {
                    id: tenant.id,
                    type: tenant.type,
                    businessName: tenant.businessName,
                },
            });
        } catch (error) {
            if (error instanceof Error && error.message === RESET_TOKEN_CONFLICT) {
                res.status(409).json({ error: 'Este link ya no está disponible. Solicitá uno nuevo.' });
                return;
            }
            logError('Reset password error:', error);
            res.status(500).json({ error: 'Error restableciendo contraseña.' });
        }
    };
}
