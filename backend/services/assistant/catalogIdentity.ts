import { Prisma, type PrismaClient } from '@prisma/client';
import type { AssistantCatalogIdentity } from '../../../shared/assistantCatalog.js';

/** La identidad pública del selector no incorpora costos, precios ni contactos. */
export const productCatalogIdentitySelect = { id: true, name: true, sku: true, brand: true, unit: true,
  saleMode: true, quantityStep: true, packUnit: true, packSize: true, requiresBatchTracking: true } satisfies Prisma.ProductSelect;
export const supplierCatalogIdentitySelect = { id: true, name: true, ruc: true, address: true } satisfies Prisma.SupplierSelect;
export const productCatalogIdentityColumns = Prisma.sql`p.id,p.name,p.sku,p.brand,p.unit,p.saleMode,p.quantityStep,p.packUnit,p.packSize,p.requiresBatchTracking`;
export const supplierCatalogIdentityColumns = Prisma.sql`p.id,p.name,p.ruc,p.address`;
export interface ProductCatalogIdentityRow {
  id: string; name: string; sku?: string; brand?: string | null; unit?: string; saleMode?: string | null;
  quantityStep?: Prisma.Decimal | null; packUnit?: string | null; packSize?: number | null;
  requiresBatchTracking?: boolean | number;
}
export interface SupplierCatalogIdentityRow { id: string; name: string; ruc?: string | null; address?: string | null }
const compact = (value: string) => value.replace(/\s+/g, ' ').trim();
const nullable = (value: string | null | undefined) => value ? compact(value) || null : null;
const sameVisibleText = (value: string) => compact(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const indistinguishable = 'Estas fichas no se pueden distinguir con los datos visibles. Revisalas en el catálogo antes de elegir.';
const boundedIdentity = 'La identidad necesita revisión en el catálogo antes de elegir; no se pudo comprobar completa.';
function boundedDetail(detail: string): Pick<AssistantCatalogIdentity, 'detail' | 'selectionIssue'> {
  if (!detail) return {};
  return detail.length <= 3000 ? { detail } : { detail: `${detail.slice(0, 2999)}…`, selectionIssue: boundedIdentity };
}

export function projectProductCatalogIdentity(row: ProductCatalogIdentityRow): AssistantCatalogIdentity {
  const brand = nullable(row.brand), unit = row.unit ? compact(row.unit) : undefined;
  const packUnit = nullable(row.packUnit), packSize = row.packSize == null ? null : String(row.packSize);
  const quantityStep = row.quantityStep?.toString() ?? null, saleMode = nullable(row.saleMode);
  const sku = row.sku ? compact(row.sku) : undefined;
  const detail = [sku ? `SKU ${JSON.stringify(sku)}` : null, brand ? `Marca ${JSON.stringify(brand)}` : null, unit ? `Unidad ${JSON.stringify(unit)}` : null,
    packUnit ? `Empaque ${JSON.stringify(packUnit)}` : null, packSize ? `Factor ${packSize} unidades base` : null,
    saleMode ? `Modo ${JSON.stringify(saleMode)}` : null, quantityStep ? `Paso ${quantityStep}` : null,
    row.requiresBatchTracking ? 'Requiere lote' : null].filter(Boolean).join(' · ');
  return { id: row.id, label: compact(row.name), ...boundedDetail(detail), sku, brand, unit, packUnit, packSize,
    quantityStep, saleMode, requiresBatchTracking: Boolean(row.requiresBatchTracking) };
}
export function projectSupplierCatalogIdentity(row: SupplierCatalogIdentityRow): AssistantCatalogIdentity {
  const ruc = nullable(row.ruc), fullAddress = nullable(row.address);
  const clipped = Boolean(fullAddress && fullAddress.length > 2000);
  const address = clipped ? `${fullAddress!.slice(0, 1999)}…` : fullAddress;
  const detail = [ruc ? `RUC ${JSON.stringify(ruc)}` : null, address ? `Dirección ${JSON.stringify(address)}` : null].filter(Boolean).join(' · ');
  return { id: row.id, label: compact(row.name), ruc, address, ...boundedDetail(detail), ...(clipped ? { selectionIssue: boundedIdentity } : {}) };
}
const visibleKey = (row: AssistantCatalogIdentity) => JSON.stringify([sameVisibleText(row.label), sameVisibleText(row.detail ?? '')]);
export function markCatalogIdentityCollisions(rows: AssistantCatalogIdentity[]): AssistantCatalogIdentity[] {
  const groups = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = visibleKey(row), group = groups.get(key) ?? new Set<string>();
    group.add(row.id); groups.set(key, group);
  }
  return rows.map(row => groups.get(visibleKey(row))!.size > 1 ? { ...row, selectionIssue: indistinguishable } : row);
}
/** Admite candidatos históricos sin metadatos, pero nunca una etiqueta o detalle cambiado. */
export function matchesCurrentCatalogIdentity(previous: AssistantCatalogIdentity, current: AssistantCatalogIdentity): boolean {
  if (previous.id !== current.id || previous.selectionIssue || current.selectionIssue) return false;
  const labels = [current.label, ...(current.sku ? [`${current.label} (${current.sku})`] : [])];
  if (!labels.some(label => sameVisibleText(label) === sameVisibleText(previous.label))) return false;
  const fields = ['detail', 'sku', 'brand', 'unit', 'packUnit', 'packSize', 'saleMode', 'quantityStep', 'requiresBatchTracking', 'ruc', 'address'] as const;
  return fields.every(field => previous[field] === undefined || previous[field] === current[field]);
}
/** Se compara lo visible; una selección guardada no autoriza confiar en una ficha que cambió. */
function checkedSelection(selected: AssistantCatalogIdentity, peers: AssistantCatalogIdentity[], truncated: boolean) {
  if (truncated) return { ...selected, selectionIssue: boundedIdentity };
  const candidates = markCatalogIdentityCollisions([selected, ...peers]);
  return candidates[0];
}
// Mismos espacios que /\s/ de JavaScript, incluido NBSP/BOM. NULL y blanco no identifican fichas distintas.
const SQL_SPACES = '[\t-\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+';
const equivalentText = (column: Prisma.Sql, value: string | null | undefined) => Prisma.sql`
  TRIM(REGEXP_REPLACE(COALESCE(${column}, ''), ${SQL_SPACES}, ' ')) COLLATE utf8mb4_unicode_ci = ${sameVisibleText(value ?? '')}`;
type Database = PrismaClient | Prisma.TransactionClient;
// La normalización es un filtro residual: restringir primero al índice del negocio evita escanear otros tenants.
export async function readProductCatalogIdentity(db: Database, tenantId: string, id: string) {
  const row = await db.product.findFirst({ where: { id, tenantId }, select: productCatalogIdentitySelect });
  if (!row) return null;
  const peers = await db.$queryRaw<ProductCatalogIdentityRow[]>(Prisma.sql`
    SELECT ${productCatalogIdentityColumns} FROM Product p FORCE INDEX (Product_tenantId_name_idx) WHERE p.tenantId = ${tenantId}
    AND ${equivalentText(Prisma.sql`p.name`, row.name)} AND ${equivalentText(Prisma.sql`p.sku`, row.sku)}
    AND ${equivalentText(Prisma.sql`p.brand`, row.brand)} AND ${equivalentText(Prisma.sql`p.unit`, row.unit)}
    AND ${equivalentText(Prisma.sql`p.packUnit`, row.packUnit)} AND ${equivalentText(Prisma.sql`p.saleMode`, row.saleMode)}
    AND p.packSize <=> ${row.packSize ?? null} AND p.quantityStep <=> ${row.quantityStep?.toString() ?? null}
    AND p.requiresBatchTracking = ${Boolean(row.requiresBatchTracking)} LIMIT 21`);
  return { row, identity: checkedSelection(projectProductCatalogIdentity(row), peers.map(projectProductCatalogIdentity), peers.length > 20) };
}
export async function readSupplierCatalogIdentity(db: Database, tenantId: string, id: string) {
  const row = await db.supplier.findFirst({ where: { id, tenantId, status: 'ACTIVE', deletedAt: null }, select: supplierCatalogIdentitySelect });
  if (!row) return null;
  const peers = await db.$queryRaw<SupplierCatalogIdentityRow[]>(Prisma.sql`
    SELECT ${supplierCatalogIdentityColumns} FROM Supplier p FORCE INDEX (Supplier_tenantId_status_name_idx) WHERE p.tenantId = ${tenantId} AND p.status = 'ACTIVE' AND p.deletedAt IS NULL
    AND ${equivalentText(Prisma.sql`p.name`, row.name)} AND ${equivalentText(Prisma.sql`p.ruc`, row.ruc)}
    AND ${equivalentText(Prisma.sql`p.address`, row.address)} LIMIT 21`);
  return { row, identity: checkedSelection(projectSupplierCatalogIdentity(row), peers.map(projectSupplierCatalogIdentity), peers.length > 20) };
}
