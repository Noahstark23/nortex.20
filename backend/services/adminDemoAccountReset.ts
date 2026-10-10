import { createHash } from 'node:crypto';
import prisma from '../lib/prisma.js';
import { BulkImportProductsSchema } from '../validation/schemas.js';
import { DemoResetError, assertResetAdministrator, type DemoResetPrincipal } from './demoAccountReset.js';
import { writeImportedProductRow, ProductImportError } from './productImportService.js';
import type { Prisma } from '@prisma/client';

async function receipt(tx: Prisma.TransactionClient, actor: DemoResetPrincipal, tenantId: string, requestKey: string) {
  await tx.$queryRaw`SELECT id FROM Tenant WHERE id = ${tenantId} FOR UPDATE`;
  await assertResetAdministrator(tx, actor);
  const reset = await tx.demoAccountReset.findFirst({ where: { tenantId, userId: actor.userId, requestKey, actorMode: 'SUPER_ADMIN' } });
  if (!reset) throw new DemoResetError('RESET_NOT_FOUND', 'No se encontró un reinicio tuyo para esta empresa.', 404);
  return reset;
}
export async function adminResetReceipt(actor: DemoResetPrincipal, tenantId: string, requestKey: string) {
  return prisma.$transaction(async tx => {
    const reset = await receipt(tx, actor, tenantId, requestKey);
    const status = reset.status === 'PREVIEWED' && reset.expiresAt <= new Date() ? 'EXPIRED' : reset.status;
    const warehouses = reset.status === 'APPLIED' && reset.nextTenantId
      ? await tx.warehouse.findMany({ where: { tenantId: reset.nextTenantId, isActive: true }, take: 100, select: { id: true, name: true, isActive: true, isDefault: true } }) : [];
    return { requestKey, status, loginRequired: false, warehouses,
      imported: await tx.demoResetImportRow.count({ where: { resetId: reset.id } }) };
  });
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]));
  return value;
}

/** El destino procede del comprobante aplicado, jamás del tenant enviado en el Excel. */
export async function importAfterAdminReset(actor: DemoResetPrincipal, tenantId: string, requestKey: string, raw: unknown) {
  const input = BulkImportProductsSchema.parse(raw);
  let created = 0, alreadyApplied = 0;
  const errors: string[] = [];
  for (const [index, item] of input.products.entries()) {
    const sku = String(item.sku ?? '').trim().toUpperCase(), name = String(item.name ?? item.nombre ?? '').trim();
    const row = Number.isInteger(item.excelRow) ? item.excelRow : index + 2;
    try {
      if (!sku || sku.length > 191 || !name) throw new ProductImportError('Revisá el código y el nombre.');
      const payloadHash = createHash('sha256').update(JSON.stringify(stable({ item, warehouseId: input.warehouseId ?? null }))).digest('hex');
      const replay = await prisma.$transaction(async tx => {
        const reset = await receipt(tx, actor, tenantId, requestKey);
        if (reset.status !== 'APPLIED' || !reset.nextTenantId || !reset.appliedAt)
          throw new DemoResetError('RESET_NOT_APPLIED', 'Primero confirmá el reinicio de esta empresa.');
        await tx.$queryRaw`SELECT id FROM Tenant WHERE id = ${reset.nextTenantId} FOR UPDATE`;
        const next = await tx.tenant.findUniqueOrThrow({ where: { id: reset.nextTenantId } });
        if (next.demoResetArchivedAt) throw new DemoResetError('RESET_SUPERSEDED', 'La cuenta se volvió a reiniciar. No se puede cargar en el espacio anterior.');
        const previous = await tx.demoResetImportRow.findUnique({ where: { resetId_sku: { resetId: reset.id, sku } } });
        if (previous) {
          if (previous.payloadHash !== payloadHash) throw new DemoResetError('IMPORT_CHANGED', 'Este código ya se cargó con otro contenido. No se modificaron sus existencias.');
          return true;
        }
        if (Date.now() - reset.appliedAt.getTime() > 24 * 60 * 60_000)
          throw new DemoResetError('IMPORT_WINDOW_EXPIRED', 'Venció la carga asistida de 24 horas. El dueño puede continuar desde su inventario.');
        await writeImportedProductRow(tx, { tenantId: next.id, userId: actor.userId, role: actor.role }, item, sku, name, input.warehouseId, true);
        const product = await tx.product.findUniqueOrThrow({ where: { tenantId_sku: { tenantId: next.id, sku } }, select: { id: true } });
        await tx.demoResetImportRow.create({ data: { resetId: reset.id, sku, payloadHash, productId: product.id } });
        await tx.auditLog.create({ data: { tenantId: next.id, userId: actor.userId, action: 'ADMIN_DEMO_PRODUCT_IMPORTED',
          details: JSON.stringify({ resetId: reset.id, requestKey, productId: product.id, sku, payloadHash }) } });
        return false;
      }, { isolationLevel: 'ReadCommitted', timeout: 15_000 });
      created++; if (replay) alreadyApplied++;
    } catch (error) {
      if (error instanceof DemoResetError && error.status === 403) throw error;
      errors.push(`Fila ${row} (${sku.slice(0, 100)}): ${error instanceof DemoResetError || error instanceof ProductImportError
        ? error.message : 'No se pudo aplicar esta fila. Volvé a cargar el mismo archivo para verificarla sin duplicar.'}`);
    }
  }
  return { created, updated: 0, alreadyApplied, total: input.products.length, errors,
    message: `${created} productos confirmados; ${alreadyApplied} ya estaban cargados por este intento.` };
}
