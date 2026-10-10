import { createHash, randomInt, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Prisma, type Tenant } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { asegurarBodegaPorDefecto } from './stockService.js';

export type DemoResetPrincipal = { tenantId: string; userId: string; role: string };
type Tx = Prisma.TransactionClient;
export type AdminResetTarget = { tenantId: string; ownerId: string };
export async function assertResetAdministrator(tx: Tx, principal: DemoResetPrincipal) {
  const [actor] = await tx.$queryRaw<Array<{ role: string; status: string; password: string }>>`
    SELECT role, status, password FROM User WHERE id = ${principal.userId} AND tenantId = ${principal.tenantId} FOR UPDATE`;
  const tenant = await tx.tenant.findUnique({ where: { id: principal.tenantId }, select: { demoResetArchivedAt: true } });
  if (!tenant || tenant.demoResetArchivedAt || !actor || actor.status !== 'ACTIVE' || actor.role !== 'SUPER_ADMIN' || principal.role !== actor.role)
    throw new DemoResetError('SUPER_ADMIN_REQUIRED', 'Se requiere un administrador activo de Nortex.', 403);
  return actor;
}
export class DemoResetError extends Error {
  constructor(public code: string, message: string, public status = 409) { super(message); }
}
const paidActions = ['SUBSCRIPTION_ACTIVATED', 'SUBSCRIPTION_RENEWED', 'MANUAL_PAYMENT_APPROVED', 'ADMIN_REACTIVATE'];

async function context(tx: Tx, principal: DemoResetPrincipal, target?: AdminResetTarget) {
  if (target) {
    await assertResetAdministrator(tx, principal);
    if (target.tenantId === principal.tenantId) throw new DemoResetError('PLATFORM_ACCOUNT', 'No podés reiniciar tu propia cuenta desde administración.', 403);
  }
  const tenantId = target?.tenantId ?? principal.tenantId;
  const userId = target?.ownerId ?? principal.userId;
  const [tenant, user, ownerProfile] = await Promise.all([
    tx.tenant.findUnique({ where: { id: tenantId } }),
    tx.user.findFirst({ where: { id: userId, tenantId, status: 'ACTIVE' } }),
    tx.employee.findFirst({ where: { tenantId, userId, role: 'OWNER', status: 'ACTIVE' } }),
  ]);
  // El registro inicial usa ADMIN + Employee OWNER; un administrador invitado no es dueño.
  if (!user || !['ADMIN', 'OWNER'].includes(user.role) || (!target && user.role !== principal.role)
      || (!ownerProfile && user.role !== 'OWNER')) {
    throw new DemoResetError('OWNER_REQUIRED', 'Solo el dueño puede reiniciar la cuenta de prueba.', 403);
  }
  if (!tenant) throw new DemoResetError('ACCOUNT_NOT_FOUND', 'No se encontró tu cuenta.', 404);
  const billingIds = [...new Set([tenant.id, tenant.demoResetRootId].filter((id): id is string => Boolean(id)))];
  const now = new Date();
  const [payment, platformPayments, activation, capital, orders, loans, fleetWallets, networkDeliveries, root] = await Promise.all([
    tx.manualPayment.findFirst({ where: { tenantId: { in: billingIds }, status: { in: ['PENDING', 'APPROVED'] } }, select: { id: true } }),
    // Misma condición de pago conciliado explícito del admin #238. Incluye la
    // identidad original: otro reinicio no vuelve una cuenta cobrada a sin cobro.
    tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM PlatformPaymentEvidence
      WHERE tenantId IN (${Prisma.join(billingIds)}) AND amount > 0
        AND paidAt <= ${now} AND reconciledAt <= ${now}
        AND TRIM(evidenceReference) <> ''
      LIMIT 1`),
    tx.auditLog.findFirst({ where: { tenantId: { in: billingIds }, action: { in: target ? paidActions.filter(action => action !== 'ADMIN_REACTIVATE') : paidActions } }, select: { id: true } }),
    tx.capitalLoan.count({ where: { tenantId: tenant.id } }),
    tx.b2BOrder.count({ where: { tenantId: tenant.id } }),
    tx.loan.count({ where: { OR: [{ tenantId: tenant.id }, { lenderId: tenant.id }] } }),
    tx.motorizado.count({ where: { tenantId: tenant.id, OR: [{ walletId: { not: null } }, { walletBalance: { not: 0 } }, { movimientos: { some: {} } }] } }),
    tx.pedido.count({ where: { tenantId: tenant.id, motorizado: { tipoFlota: 'NORTEX' } } }),
    tenant.demoResetRootId ? tx.tenant.findUnique({ where: { id: tenant.demoResetRootId } }) : Promise.resolve(null),
  ]);
  if (tenant.demoResetArchivedAt || !(target ? ['TRIAL', 'ACTIVE'] : ['TRIAL']).includes(tenant.subscriptionStatus) || !tenant.trialEndsAt
      || (!target && tenant.subscriptionEndsAt) || tenant.stripeCustomerId || tenant.stripeSubscriptionId || payment || platformPayments.length > 0 || activation
      || (tenant.demoResetRootId && (!root || root.stripeCustomerId || root.stripeSubscriptionId || (!target && root.subscriptionEndsAt)))) {
    throw new DemoResetError('DEMO_UNPAID_REQUIRED', 'El reinicio solo está disponible en cuentas de prueba sin pagos ni cobros pendientes.');
  }
  if (!tenant.walletBalance.equals(0) || !tenant.creditLimit.equals(0) || capital || orders || loans || fleetWallets || networkDeliveries) {
    throw new DemoResetError('EXTERNAL_FINANCE_EXISTS', 'Esta cuenta tiene compromisos financieros de plataforma y necesita revisión de Nortex.');
  }
  if (!user.email) throw new DemoResetError('OWNER_LOGIN_REQUIRED', 'El dueño necesita un acceso por correo para conservar su cuenta.');
  return { tenant, user, ownerProfile };
}

async function counts(tx: Tx, tenantId: string) {
  const where = { tenantId };
  const [products, sales, purchases, customers, suppliers, employees, users, expenses, journals, warehouses] = await Promise.all([
    tx.product.count({ where }), tx.sale.count({ where }), tx.purchase.count({ where }), tx.customer.count({ where }),
    tx.supplier.count({ where }), tx.employee.count({ where }), tx.user.count({ where }),
    tx.expense.count({ where }), tx.journalEntry.count({ where }), tx.warehouse.count({ where }),
  ]);
  return { products, sales, purchases, customers, suppliers, employees, users, expenses, journals, warehouses };
}
function fingerprint(tenant: Tenant, identity: unknown, snapshot: Awaited<ReturnType<typeof counts>>) {
  return createHash('sha256').update(JSON.stringify({ tenant, identity, counts: snapshot })).digest('hex');
}
export async function demoResetEligibility(principal: DemoResetPrincipal) {
  try {
    const result = await context(prisma, principal);
    return { eligible: true, businessName: result.tenant.businessName, trialEndsAt: result.tenant.trialEndsAt };
  } catch (error) {
    if (error instanceof DemoResetError) return { eligible: false, code: error.code, reason: error.message };
    throw error;
  }
}
export async function previewDemoReset(principal: DemoResetPrincipal, requestKey: string, target?: AdminResetTarget) {
  const tenantId = target?.tenantId ?? principal.tenantId;
  const actorMode = target ? 'SUPER_ADMIN' : 'OWNER';
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM Tenant WHERE id = ${tenantId} FOR UPDATE`;
    const { tenant, user } = await context(tx, principal, target);
    const prior = await tx.demoAccountReset.findFirst({ where: { tenantId, userId: principal.userId, requestKey, actorMode } });
    if (prior) {
      if (prior.ownerUserId !== user.id) throw new DemoResetError('PREVIEW_CHANGED', 'El dueño cambió. Volvé a revisar.');
      if (prior.status !== 'PREVIEWED' || prior.expiresAt <= new Date()) throw new DemoResetError('PREVIEW_EXPIRED', 'La revisión venció. Volvé a revisar los datos.');
      return { previewId: prior.id, requestKey, counts: prior.counts, expiresAt: prior.expiresAt, businessName: tenant.businessName, ownerEmail: user.email };
    }
    const snapshot = await counts(tx, tenant.id);
    const preview = await tx.demoAccountReset.create({ data: {
      tenantId: tenant.id, userId: principal.userId, requestKey, actorMode, ownerUserId: user.id, counts: snapshot,
      fingerprint: fingerprint(tenant, { user, actorId: principal.userId, actorMode }, snapshot), expiresAt: new Date(Date.now() + 5 * 60_000),
    } });
    return { previewId: preview.id, requestKey, counts: snapshot, expiresAt: preview.expiresAt, businessName: tenant.businessName, ownerEmail: user.email };
  });
}

// Lista explícita: identidad fiscal y preferencias se conservan; saldos y correlativos no se trasladan.
function freshTenantData(t: Tenant, assisted = false): Prisma.TenantCreateInput {
  return {
    businessName: t.businessName, type: t.type, taxId: t.taxId, slug: t.slug,
    subscriptionStatus: assisted ? t.subscriptionStatus : 'TRIAL', subscriptionEndsAt: assisted ? t.subscriptionEndsAt : null, trialEndsAt: t.trialEndsAt, createdAt: t.createdAt,
    demoResetRootId: t.demoResetRootId ?? t.id,
    theftAlertThreshold: t.theftAlertThreshold, agentCashMin: t.agentCashMin, agentCashMax: t.agentCashMax,
    deliveryFee: t.deliveryFee, allowNegativeStock: t.allowNegativeStock, requireCashierPin: t.requireCashierPin,
    returnWindowDays: t.returnWindowDays, batchWarehouseLedgerMode: t.batchWarehouseLedgerMode,
    fiscalRegime: t.fiscalRegime, fiscalRegimeVersion: t.fiscalRegimeVersion, address: t.address, phone: t.phone,
    dgiAuthCode: t.dgiAuthCode, dgiAuthDate: t.dgiAuthDate,
  };
}
export async function confirmDemoReset(principal: DemoResetPrincipal, input: { previewId: string; requestKey: string; password: string }, target?: AdminResetTarget) {
  const tenantId = target?.tenantId ?? principal.tenantId;
  const actorMode = target ? 'SUPER_ADMIN' : 'OWNER';
  const authenticated = await prisma.user.findFirst({ where: { id: principal.userId, tenantId: principal.tenantId, status: 'ACTIVE' }, select: { password: true } });
  if (!authenticated || !await bcrypt.compare(input.password, authenticated.password)) {
    throw new DemoResetError('PASSWORD_INVALID', 'La contraseña no es correcta.', 403);
  }
  return prisma.$transaction(async tx => {
    // Mismo orden en preview/confirm: tenant primero. Nada externo dentro de la transacción.
    await tx.$queryRaw`SELECT id FROM Tenant WHERE id = ${tenantId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM User WHERE tenantId = ${tenantId} ORDER BY id FOR UPDATE`;
    const { tenant, user, ownerProfile } = await context(tx, principal, target);
    const actor = target ? await assertResetAdministrator(tx, principal) : user;
    if (actor.password !== authenticated.password) throw new DemoResetError('SESSION_CHANGED', 'Tu acceso cambió. Volvé a ingresar.', 403);
    const preview = await tx.demoAccountReset.findFirst({ where: { id: input.previewId, tenantId: tenant.id, userId: principal.userId, requestKey: input.requestKey, actorMode, ownerUserId: user.id } });
    if (!preview || preview.status !== 'PREVIEWED' || preview.expiresAt <= new Date()) throw new DemoResetError('PREVIEW_EXPIRED', 'La revisión venció. Volvé a revisar los datos.');
    const snapshot = await counts(tx, tenant.id);
    if (preview.fingerprint !== fingerprint(tenant, { user, actorId: principal.userId, actorMode }, snapshot)) throw new DemoResetError('PREVIEW_CHANGED', 'Los datos cambiaron desde la revisión. Volvé a revisarlos antes de reiniciar.');
    const [capabilities, tax, policy, assistant] = await Promise.all([
      tx.tenantCapability.findMany({ where: { tenantId: tenant.id }, take: 50 }),
      tx.taxConfig.findUnique({ where: { tenantId: tenant.id } }),
      tx.procurementPolicy.findUnique({ where: { tenantId: tenant.id } }),
      tx.assistantTenantConfig.findUnique({ where: { tenantId: tenant.id } }),
    ]);
    const now = new Date();
    // Rotación del espacio: ningún documento de prueba se borra ni puede aparecer en el nuevo tenant.
    // Los IDs antiguos también aíslan colas offline y peticiones que ya estaban en vuelo.
    await tx.tenant.update({ where: { id: tenant.id }, data: {
      taxId: 'DEMO-ARCHIVE-' + randomUUID(), slug: null, subscriptionStatus: 'CANCELLED', demoResetArchivedAt: now,
    } });
    await tx.user.updateMany({ where: { tenantId: tenant.id }, data: { status: 'DISABLED' } });
    await tx.invitation.updateMany({ where: { tenantId: tenant.id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
    await tx.motorizado.updateMany({ where: { tenantId: tenant.id }, data: { activo: false } });
    await tx.whatsAppChannel.updateMany({ where: { tenantId: tenant.id }, data: { active: false } });
    await tx.user.update({ where: { id: user.id, tenantId: tenant.id }, data: { email: null, whatsappNumber: null } });
    const next = await tx.tenant.create({ data: freshTenantData(tenant, Boolean(target)) });
    if (target) await asegurarBodegaPorDefecto(tx, next.id);
    const owner = await tx.user.create({ data: {
      tenantId: next.id, email: user.email, password: user.password, name: user.name, role: user.role,
      whatsappNumber: user.whatsappNumber, createdAt: user.createdAt, assistantBudgetOwner: user.assistantBudgetOwner,
    } });
    await tx.employee.create({ data: {
      tenantId: next.id, userId: owner.id, firstName: ownerProfile?.firstName ?? user.name, lastName: ownerProfile?.lastName ?? '',
      role: 'OWNER', pin: ownerProfile?.pin ?? String(randomInt(2000, 10000)), baseSalary: 0, commissionRate: 0,
    } });
    if (capabilities.length) await tx.tenantCapability.createMany({ data: capabilities.map(c => ({ tenantId: next.id, code: c.code })) });
    if (tax) await tx.taxConfig.create({ data: { ...tax, tenantId: next.id } });
    if (policy) await tx.procurementPolicy.create({ data: { tenantId: next.id, priceTolerancePct: policy.priceTolerancePct, autoHold: policy.autoHold, updatedBy: owner.id } });
    if (assistant) await tx.assistantTenantConfig.create({ data: { ...assistant, tenantId: next.id } });
    await tx.demoAccountReset.update({ where: { id: preview.id }, data: { status: 'APPLIED', nextTenantId: next.id, nextUserId: owner.id, appliedAt: now } });
    const details = JSON.stringify({ before: { tenantId: tenant.id, counts: snapshot }, after: { tenantId: next.id, products: 0, sales: 0, purchases: 0 }, requestKey: input.requestKey, actorMode, actorId: principal.userId, ownerId: user.id });
    await tx.auditLog.createMany({ data: [
      { tenantId: tenant.id, userId: principal.userId, action: 'DEMO_ACCOUNT_RESET', details },
      { tenantId: next.id, userId: target ? principal.userId : owner.id, action: 'DEMO_ACCOUNT_STARTED', details },
    ] });
    return { status: 'APPLIED' as const, requestKey: input.requestKey, loginRequired: !target };
  }, { timeout: 10_000 });
}

// Solo devuelve el comprobante propio; NO reactiva la sesión ni devuelve un JWT nuevo.
export async function readDemoResetReceipt(principal: Pick<DemoResetPrincipal, 'tenantId' | 'userId'>, requestKey: string) {
  return prisma.$transaction(async tx => {
    // Esperar una confirmación en curso antes de declarar que una revisión vencida ya no puede aplicarse.
    await tx.$queryRaw`SELECT id FROM Tenant WHERE id = ${principal.tenantId} FOR UPDATE`;
    const row = await tx.demoAccountReset.findFirst({ where: { tenantId: principal.tenantId, userId: principal.userId, requestKey } });
    if (!row) throw new DemoResetError('RESET_NOT_FOUND', 'No se encontró un comprobante de este intento.', 404);
    const status = row.status === 'PREVIEWED' && row.expiresAt <= new Date() ? 'EXPIRED' : row.status;
    return { requestKey, status, loginRequired: row.status === 'APPLIED' };
  });
}
