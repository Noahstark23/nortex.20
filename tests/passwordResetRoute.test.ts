import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import {
    createCompletePasswordResetHandler,
    createValidatePasswordResetHandler,
    type PasswordResetPrisma,
} from '../backend/routes/passwordReset';

const NOW = new Date('2026-09-02T18:00:00.000Z');

function recordFixture(overrides: Record<string, unknown> = {}) {
    const base = {
        id: 'reset-1',
        userId: 'user-1',
        used: false,
        expiresAt: new Date('2026-09-03T18:00:00.000Z'),
        user: {
            id: 'user-1',
            tenantId: 'tenant-1',
            email: 'persona@negocio.test',
            name: 'Persona QA',
            role: 'OWNER',
            status: 'ACTIVE',
            tenant: {
                id: 'tenant-1',
                type: 'RETAIL',
                businessName: 'Negocio QA',
            },
        },
    };

    return { ...base, ...overrides };
}

function prismaFixture(record = recordFixture()) {
    const passwordResetUpdateMany = vi.fn(async () => ({ count: 1 }));
    const userUpdateMany = vi.fn(async () => ({ count: 1 }));
    const tx = {
        passwordReset: { updateMany: passwordResetUpdateMany },
        user: { updateMany: userUpdateMany },
    };
    const transaction = vi.fn(async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx));
    const prisma = {
        passwordReset: {
            findUnique: vi.fn(async () => record),
        },
        $transaction: transaction,
    } as unknown as PasswordResetPrisma;

    return { prisma, passwordResetUpdateMany, userUpdateMany, transaction };
}

async function withResetServer<T>(
    prisma: PasswordResetPrisma,
    run: (baseUrl: string) => Promise<T>,
) {
    const app = express();
    app.use(express.json());
    const dependencies = {
        prisma,
        now: () => NOW,
        logError: vi.fn(),
    };
    app.get('/api/auth/reset-password/:token', createValidatePasswordResetHandler(dependencies));
    app.post('/api/auth/reset-password/:token', createCompletePasswordResetHandler({
        ...dependencies,
        hashPassword: async (password) => `hashed:${password}`,
        signToken: () => 'signed-session-token',
    }));

    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as AddressInfo;

    try {
        return await run(`http://127.0.0.1:${address.port}/api/auth/reset-password`);
    } finally {
        await new Promise<void>((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
        });
    }
}

describe('rutas ejecutables de restablecimiento de contraseña', () => {
    it.each([
        {
            label: 'usuario inactivo',
            user: { ...recordFixture().user, status: 'SUSPENDED' },
        },
        {
            label: 'tenant inconsistente',
            user: {
                ...recordFixture().user,
                tenant: { ...recordFixture().user.tenant, id: 'tenant-other' },
            },
        },
    ])('GET y POST rechazan sin exponer identidad para $label', async ({ user }) => {
        const { prisma, userUpdateMany, transaction } = prismaFixture(recordFixture({ user }));

        await withResetServer(prisma, async (baseUrl) => {
            const getResponse = await fetch(`${baseUrl}/token-invalido`);
            const getBody = await getResponse.json();

            expect(getResponse.status).toBe(404);
            expect(getBody).toEqual({ error: 'Link inválido o expirado.' });
            expect(getBody).not.toHaveProperty('email');
            expect(getBody).not.toHaveProperty('name');

            const postResponse = await fetch(`${baseUrl}/token-invalido`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'segura-123' }),
            });
            const postBody = await postResponse.json();

            expect(postResponse.status).toBe(409);
            expect(postBody).toEqual({
                error: 'No se pudo completar el restablecimiento. Solicitá un nuevo link o contactá a soporte.',
            });
            expect(postBody).not.toHaveProperty('email');
            expect(postBody).not.toHaveProperty('name');
        });

        expect(userUpdateMany).not.toHaveBeenCalled();
        expect(transaction).not.toHaveBeenCalled();
    });

    it('POST actualiza por usuario, tenant, estado y rol y devuelve solo la sesión mínima', async () => {
        const { prisma, passwordResetUpdateMany, userUpdateMany } = prismaFixture();

        await withResetServer(prisma, async (baseUrl) => {
            const response = await fetch(`${baseUrl}/token-valido`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'segura-123' }),
            });
            const body = await response.json();

            expect(response.status).toBe(200);
            expect(body).toEqual({
                message: 'Contraseña actualizada exitosamente.',
                token: 'signed-session-token',
                user: {
                    id: 'user-1',
                    email: 'persona@negocio.test',
                    name: 'Persona QA',
                    role: 'OWNER',
                },
                tenant: {
                    id: 'tenant-1',
                    type: 'RETAIL',
                    businessName: 'Negocio QA',
                },
            });
        });

        expect(userUpdateMany).toHaveBeenCalledWith({
            where: {
                id: 'user-1',
                tenantId: 'tenant-1',
                status: 'ACTIVE',
                role: 'OWNER',
            },
            data: { password: 'hashed:segura-123' },
        });
        expect(passwordResetUpdateMany).toHaveBeenCalledTimes(2);
    });

    it('solo permite que uno de dos POST concurrentes reclame el token', async () => {
        let claimed = false;
        const userUpdateMany = vi.fn(async () => ({ count: 1 }));
        const passwordResetUpdateMany = vi.fn(async (args: any) => {
            if (args.where?.id === 'reset-1') {
                if (claimed) return { count: 0 };
                claimed = true;
                return { count: 1 };
            }
            return { count: 1 };
        });
        const tx = {
            passwordReset: { updateMany: passwordResetUpdateMany },
            user: { updateMany: userUpdateMany },
        };
        const prisma = {
            passwordReset: { findUnique: vi.fn(async () => recordFixture()) },
            $transaction: vi.fn(async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx)),
        } as unknown as PasswordResetPrisma;

        await withResetServer(prisma, async (baseUrl) => {
            const submit = (password: string) => fetch(`${baseUrl}/token-race`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password }),
            });
            const responses = await Promise.all([
                submit('ganadora-123'),
                submit('perdedora-456'),
            ]);

            expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
            const conflict = responses.find((response) => response.status === 409)!;
            await expect(conflict.json()).resolves.toEqual({
                error: 'Este link ya no está disponible. Solicitá uno nuevo.',
            });
        });

        expect(userUpdateMany).toHaveBeenCalledTimes(1);
    });
});
