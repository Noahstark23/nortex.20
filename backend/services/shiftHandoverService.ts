import Decimal from 'decimal.js';
import type { PrismaClient } from '@prisma/client';
import prisma from '../lib/prisma';
import { calcularEfectivoTurno } from '../../utils/margen';
import { ESTADO_ANULADA } from './saleCancellation';

type Principal = {tenantId: string; userId: string; role: string};
const roles = ['OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER', 'CASHIER'];
export class ShiftHandoverError extends Error {
  constructor(public readonly code: string, public readonly httpStatus: number, message: string) {
    super(message); this.name = 'ShiftHandoverError';
  }
}

/** El corte financiero se lee después de esperar la gaveta y confirma junto con la responsabilidad. */
export async function executeShiftHandover(
  {principal, shiftId}: {principal: Principal; shiftId: string}, db: PrismaClient = prisma,
) {
  const {tenantId, userId, role} = principal;
  if (!tenantId || !userId || !roles.includes(role)) {
    throw new ShiftHandoverError('SHIFT_HANDOVER_FORBIDDEN', 403, 'Tu usuario no puede tomar esta caja.');
  }
  return db.$transaction(async tx => {
    // Mismo orden del registro de compras: autoridad del actor antes del turno.
    const [actor] = await tx.$queryRaw<Array<{role: string; status: string}>>`
      SELECT role, status FROM \`User\` WHERE id = ${userId} AND tenantId = ${tenantId} FOR UPDATE`;
    if (!actor || actor.status !== 'ACTIVE' || actor.role !== role || !roles.includes(actor.role)) {
      throw new ShiftHandoverError('SHIFT_HANDOVER_FORBIDDEN', 403, 'Tu sesión o permiso cambió. Volvé a ingresar.');
    }
    await tx.$queryRaw`SELECT id FROM \`Shift\` WHERE id = ${shiftId} AND tenantId = ${tenantId} FOR UPDATE`;
    const shift = await tx.shift.findFirst({where: {id: shiftId, tenantId, status: 'OPEN'},
      include: {user: {select: {id: true, name: true}}}});
    if (!shift) throw new ShiftHandoverError('SHIFT_HANDOVER_NOT_FOUND', 404, 'No encontramos esa caja abierta.');
    if (shift.userId === userId) return {ok: true, yaEraPropio: true, shiftId: shift.id};

    const [cashSales, movementGroups] = await Promise.all([
      tx.sale.aggregate({where: {tenantId, shiftId, paymentMethod: 'CASH', status: {not: ESTADO_ANULADA}},
        _sum: {total: true, storeCreditApplied: true}}),
      tx.cashMovement.groupBy({by: ['type', 'currency', 'category'], where: {tenantId, shiftId, isVoided: false}, _sum: {amount: true}}),
    ]);
    // La fórmula compartida recibe agregados equivalentes por tipo/moneda/categoría;
    // no se cargan todos los movimientos ni se suman monedas distintas.
    const cash = calcularEfectivoTurno({
      initialCash: shift.initialCash.toString(), initialCashUsd: shift.initialCashUsd.toString(),
      cashSales: new Decimal(cashSales._sum.total?.toString() ?? 0).minus(cashSales._sum.storeCreditApplied?.toString() ?? 0),
      movimientos: movementGroups.map(row => ({type: row.type, currency: row.currency, category: row.category,
        amount: row._sum.amount?.toString() ?? '0'})),
    });
    const changed = await tx.shift.updateMany({where: {id: shiftId, tenantId, status: 'OPEN', userId: shift.userId}, data: {userId}});
    if (changed.count !== 1) throw new ShiftHandoverError('SHIFT_HANDOVER_CONFLICT', 409, 'La caja cambió antes del traspaso. Revisá el turno e intentá nuevamente.');
    const fromName = shift.user?.name ?? shift.userId;
    await tx.auditLog.create({data: {tenantId, userId, action: 'SHIFT_HANDOVER', details: JSON.stringify({
      shiftId, entregaUserId: shift.userId, entregaNombre: fromName, recibeUserId: userId,
      efectivoAlTraspaso: cash.efectivoNIO.toString(), efectivoUsdAlTraspaso: cash.efectivoUSD.toString(),
      fondoInicial: shift.initialCash.toString(),
    })}});
    return {ok: true, shiftId, entregaDe: fromName, efectivoRecibido: cash.efectivoNIO.toNumber(), efectivoUsdRecibido: cash.efectivoUSD.toNumber()};
  }, {isolationLevel: 'ReadCommitted', timeout: 15000});
}
