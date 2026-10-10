import { type Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';

// Comparte el lock del reinicio: un pago reportado impide reiniciar y una cuenta
// ya reiniciada no puede recibir comprobantes con una sesión anterior en vuelo.
export async function reportManualPayment(data: Prisma.ManualPaymentUncheckedCreateInput) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM Tenant WHERE id = ${data.tenantId} FOR UPDATE`;
    const tenant = await tx.tenant.findUnique({ where: { id: data.tenantId }, select: { demoResetArchivedAt: true } });
    if (!tenant || tenant.demoResetArchivedAt) throw new Error('DEMO_ACCOUNT_RESET');
    const pending = await tx.manualPayment.findFirst({ where: { tenantId: data.tenantId, status: 'PENDING' }, select: { id: true } });
    if (pending) throw new Error('PAYMENT_ALREADY_PENDING');
    return tx.manualPayment.create({ data });
  });
}
