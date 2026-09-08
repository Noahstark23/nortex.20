import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import prisma from '../../../lib/prisma.js';
import { SUPPLIER_READ_ROLES } from '../../../middleware/accessPolicies.js';
import { AssistantAccessError, assertAssistantAccess, getAssistantCapabilities } from '../access.js';
import type { AssistantPrincipal } from '../../../../shared/assistant.js';

export const assistantCatalogQuerySchema = z.object({
  kind: z.enum(['products', 'suppliers']), query: z.string().trim().max(100),
  limit: z.number().int().min(1).max(20).default(20),
}).strict();
export function normalizeCatalogQuery(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9\s.-]/g, ' ').replace(/\s+/g, ' ').trim();
}
const escapeLike = (value: string) => value.replace(/[=%_]/g, character => `=${character}`);

/** Variaciones sólo para proponer candidatos; nunca eligen productos ni concentraciones. */
export function approximateCatalogPatterns(token: string): string[] {
  if (!/^[a-z]{5,24}$/.test(token)) return [];
  const patterns = new Set<string>();
  for (let index = 0; index < token.length; index++) {
    patterns.add(`%${token.slice(0, index)}_${token.slice(index + 1)}%`);
    patterns.add(`%${token.slice(0, index)}_${token.slice(index)}%`);
    patterns.add(`%${token.slice(0, index)}${token.slice(index + 1)}%`);
    if (index + 1 < token.length) patterns.add(`%${token.slice(0, index)}${token[index + 1]}${token[index]}${token.slice(index + 2)}%`);
  }
  return [...patterns];
}
interface CatalogRow {
  id: string; name: string; sku?: string; unit?: string; saleMode?: string | null;
  quantityStep?: Prisma.Decimal | null; packUnit?: string | null; packSize?: number | null;
  requiresBatchTracking?: boolean | number;
}
interface CatalogDependencies { db?: PrismaClient; now?: () => Date }

export async function searchAssistantCatalog(principal: AssistantPrincipal, raw: unknown, deps: CatalogDependencies = {}) {
  const { kind, query, limit } = assistantCatalogQuerySchema.parse(raw);
  const db = deps.db ?? prisma;
  const caps = await getAssistantCapabilities(principal, db);
  if (!caps.enabled || !(kind === 'suppliers' ? SUPPLIER_READ_ROLES.includes(principal.role) : caps.inventory || caps.purchasePrepare)) {
    throw new AssistantAccessError(403, 'ASSISTANT_FORBIDDEN', 'Tu rol no tiene acceso a este catálogo.');
  }
  const normalized = normalizeCatalogQuery(query);
  const tokens = normalized.split(' ').filter(Boolean);
  if (query && !tokens.length) {
    await assertAssistantAccess(principal, 'help', db);
    return { kind, checkedAt: (deps.now?.() ?? new Date()).toISOString(), rows: [], warnings: [] };
  }
  const table = kind === 'products' ? Prisma.sql`Product p` : Prisma.sql`Supplier p`;
  const columns = kind === 'products'
    ? Prisma.sql`p.id,p.name,p.sku,p.unit,p.saleMode,p.quantityStep,p.packUnit,p.packSize,p.requiresBatchTracking`
    : Prisma.sql`p.id,p.name`;
  const active = kind === 'suppliers' ? Prisma.sql`AND p.status = 'ACTIVE' AND p.deletedAt IS NULL` : Prisma.empty;
  const alias = kind === 'products' && normalized
    ? Prisma.sql`EXISTS (SELECT 1 FROM AssistantCatalogAlias a WHERE a.tenantId = ${principal.tenantId} AND a.productId=p.id AND a.active=true AND a.normalizedAlias=${normalized})`
    : Prisma.sql`FALSE`;
  const exact = tokens.length ? Prisma.join(tokens.map(token => {
    const pattern = `%${escapeLike(token)}%`;
    return kind === 'products'
      ? Prisma.sql`(p.name LIKE ${pattern} ESCAPE '=' OR p.sku LIKE ${pattern} ESCAPE '=')`
      : Prisma.sql`(p.name LIKE ${pattern} ESCAPE '=')`;
  }), ' AND ') : Prisma.sql`TRUE`;
  const select = async (predicate: Prisma.Sql) => db.$queryRaw<CatalogRow[]>(Prisma.sql`
    SELECT ${columns} FROM ${table} WHERE p.tenantId=${principal.tenantId} ${active}
    AND (${predicate}) ORDER BY CASE WHEN p.name=${normalized} THEN 0 WHEN ${alias} THEN 1
      WHEN p.name LIKE ${`${escapeLike(normalized)}%`} ESCAPE '=' THEN 2 ELSE 3 END,p.name,p.id LIMIT ${limit}`);
  let rows = await select(Prisma.sql`${alias} OR (${exact})`);
  let approximate = false;
  if (!rows.length && tokens.length) {
    const fuzzyToken = [...tokens].filter(token => /^[a-z]{5,24}$/.test(token)).sort((a,b) => b.length-a.length)[0];
    const patterns = fuzzyToken ? approximateCatalogPatterns(fuzzyToken) : [];
    if (patterns.length) {
      const others = tokens.filter(token => token !== fuzzyToken).map(token => Prisma.sql`p.name LIKE ${`%${escapeLike(token)}%`} ESCAPE '='`);
      const fuzzy = Prisma.join(patterns.map(pattern => Prisma.sql`p.name LIKE ${pattern} ESCAPE '='`), ' OR ');
      rows = await select(Prisma.sql`(${fuzzy}) ${others.length ? Prisma.sql`AND ${Prisma.join(others, ' AND ')}` : Prisma.empty}`);
      approximate = rows.length > 0;
    }
  }
  await assertAssistantAccess(principal, kind === 'products' && !caps.purchasePrepare ? 'inventory' : 'help', db);
  return { kind, checkedAt: (deps.now?.() ?? new Date()).toISOString(), rows: rows.map(row => ({
    id: row.id, label: row.name, ...(kind === 'products' ? {
      sku: row.sku, detail: row.sku ?? row.unit, unit: row.unit, saleMode: row.saleMode ?? null, quantityStep: row.quantityStep?.toString() ?? null,
      packUnit: row.packUnit ?? null, packSize: row.packSize === null || row.packSize === undefined ? null : String(row.packSize),
      requiresBatchTracking: Boolean(row.requiresBatchTracking),
    } : {}),
  })), warnings: approximate ? ['Son coincidencias aproximadas. Elegí el producto y verificá concentración, presentación y unidad.'] : [] };
}

export const catalogAliasSchema = z.object({ productId: z.string().min(1).max(191), alias: z.string().trim().min(2).max(100) }).strict();
export async function approveAssistantCatalogAlias(principal: AssistantPrincipal, raw: unknown, db: PrismaClient = prisma) {
  const input = catalogAliasSchema.parse(raw), normalizedAlias = normalizeCatalogQuery(input.alias);
  if (normalizedAlias.length < 2) throw new AssistantAccessError(400, 'ALIAS_INVALID', 'Escribí un alias reconocible.');
  await assertAssistantAccess(principal, 'help', db);
  if (!['OWNER','ADMIN','SUPER_ADMIN'].includes(principal.role)) throw new AssistantAccessError(403, 'ASSISTANT_FORBIDDEN', 'Solo administración puede aprobar alias.');
  return db.$transaction(async tx => {
    const actors = await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`SELECT id FROM User WHERE id=${principal.userId} AND tenantId=${principal.tenantId} AND role=${principal.role} AND status='ACTIVE' FOR UPDATE`);
    if (!actors.length) throw new AssistantAccessError(403, 'SESSION_REVOKED', 'Tu sesión cambió. Volvé a ingresar.');
    await assertAssistantAccess(principal, 'help', tx as PrismaClient);
    const product = await tx.product.findFirst({ where: { id:input.productId, tenantId:principal.tenantId }, select:{id:true} });
    if (!product) throw new AssistantAccessError(404,'PRODUCT_NOT_FOUND','Producto no encontrado.');
    const where={tenantId_normalizedAlias_productId:{tenantId:principal.tenantId,normalizedAlias,productId:product.id}};
    const previous=await tx.assistantCatalogAlias.findUnique({where});
    if (previous?.active) return {id:previous.id,productId:previous.productId,alias:previous.alias};
    const row=await tx.assistantCatalogAlias.upsert({where,create:{tenantId:principal.tenantId,productId:product.id,alias:input.alias,normalizedAlias,approvedBy:principal.userId},update:{active:true,alias:input.alias,approvedBy:principal.userId}});
    await tx.auditLog.create({data:{tenantId:principal.tenantId,userId:principal.userId,action:'ASSISTANT_CATALOG_ALIAS_APPROVED',details:JSON.stringify({before:previous?{active:previous.active}:null,after:{id:row.id,productId:product.id,alias:row.alias}})}});
    return {id:row.id,productId:row.productId,alias:row.alias};
  });
}
