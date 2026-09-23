import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { CreateProductSchema } from '../validation/schemas';
import { createProductInTransaction } from './productCreationService';

const inputSchema = z.object({ operationId: z.uuid(), product: CreateProductSchema }).strict();
export class EnrollmentError extends Error { constructor(message: string, public status = 409) { super(message); } }
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Shared product writer, with a durable outcome for each camera enrollment intent. */
export async function enrollProduct(db: PrismaClient, principal: { tenantId: string; userId: string; role: string }, raw: unknown) {
    if (!['OWNER', 'ADMIN', 'SUPER_ADMIN'].includes(principal.role)) throw new EnrollmentError('No tenés permiso para crear productos.', 403);
    const input = inputSchema.parse(raw);
    if (input.product.stock !== '0') throw new EnrollmentError('El alta con cámara no recibe existencias. Registrá la entrada en Compras.', 400);
    const productInput = { ...input.product, sku: input.product.sku.toUpperCase() };
    const hash = fingerprint(productInput);
    for (let retry = 0; ; retry++) {
        try {
            return await db.$transaction(async tx => {
                const [user] = await tx.$queryRaw<Array<{role: string; status: string}>>`SELECT role, status FROM User WHERE id = ${principal.userId} AND tenantId = ${principal.tenantId} FOR UPDATE`;
                if (!user || user.status !== 'ACTIVE' || user.role !== principal.role) throw new EnrollmentError('Tu sesión cambió. Volvé a ingresar.', 403);
                const key = { tenantId_operationId: { tenantId: principal.tenantId, operationId: input.operationId } };
                const previous = await tx.productEnrollment.findUnique({ where: key });
                if (previous) {
                    if (previous.userId !== principal.userId || previous.payloadHash !== hash) throw new EnrollmentError('Este intento pertenece a otros datos. Conservá el original.');
                    return previous.result;
                }
                const duplicate = await tx.product.findUnique({ where: { tenantId_sku: { tenantId: principal.tenantId, sku: productInput.sku } } });
                const product = duplicate ? null : await createProductInTransaction(tx, principal, productInput);
                const result = JSON.parse(JSON.stringify({
                    operationId: input.operationId,
                    outcome: duplicate ? 'REJECTED' : 'APPLIED',
                    ...(duplicate ? { code: 'PRODUCT_EXISTS', productId: duplicate.id, error: 'Este código ya está registrado. No creamos otro producto.' } : { product }),
                })) as Prisma.InputJsonValue;
                await tx.productEnrollment.create({ data: { tenantId: principal.tenantId, userId: principal.userId, operationId: input.operationId, payloadHash: hash, result } });
                return result;
            }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
        } catch (error) {
            // A concurrent SKU or operation winner rolls back this whole transaction, including audit.
            if (retry < 2 && ['P2002', 'P2034'].includes((error as { code?: string })?.code ?? '')) continue;
            throw error;
        }
    }
}
