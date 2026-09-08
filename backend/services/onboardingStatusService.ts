import type { PrismaClient } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { ESTADO_ANULADA } from './saleCancellation.js';
import { isPlaceholderTaxId } from '../../utils/tenantTaxId.js';
import type { OnboardingStatus } from '../../utils/onboardingStatus.js';
import { claveDelDiaManagua } from './pulsoPos.js';

export type OnboardingDatabase = Pick<PrismaClient,
    'tenant' | 'tenantCapability' | 'product' | 'sale' | 'customer' | 'employee' | 'loan' | 'productBatch'
>;

export type RetailSalesProgress = NonNullable<OnboardingStatus['salesProgress']>;

export type OnboardingStatusResult = OnboardingStatus & { salesProgress?: RetailSalesProgress };

/** Lectura de activación: no siembra catálogo ni modifica dinero, stock o progreso. */
export function createOnboardingStatusService(db: OnboardingDatabase = prisma) {
    return {
        async getStatus(tenantId: string): Promise<OnboardingStatusResult | null> {
            // Impide que otro caller convierta un contexto ausente en una query sin tenant.
            if (!tenantId?.trim()) return null;
            const tenant = await db.tenant.findUnique({
                where: { id: tenantId },
                select: { type: true, businessName: true, taxId: true },
            });
            if (!tenant) return null;

            const isLender = tenant.type === 'LENDER';
            const capabilityRows = isLender ? [] : await db.tenantCapability.findMany({
                where: { tenantId },
                select: { code: true },
            });
            const capabilities = new Set(capabilityRows.map(row => row.code));
            const wantsMeasured = tenant.type === 'CARNICERIA_POLLERIA'
                || capabilities.has('CARNES_AVES') || capabilities.has('ALIMENTO_ANIMAL');
            const wantsPack = tenant.type === 'AGROPECUARIA'
                || capabilities.has('ALIMENTO_ANIMAL') || capabilities.has('MAYOREO');
            const wantsBatch = capabilities.has('PERECEDEROS') || capabilities.has('CARNES_AVES');

            // VOIDED es la anulación fiscal canónica; CANCELLED tampoco acredita
            // activación. Ambas lecturas comparten el filtro y el índice tenant/fecha.
            const confirmedSaleWhere = { tenantId, status: { notIn: [ESTADO_ANULADA, 'CANCELLED', 'DRAFT'] } };
            const [products, sales, customers, employees, lenderLoans, measuredProducts, packedProducts, batches, lastSale, firstSale] = await Promise.all([
                db.product.count({ where: { tenantId } }),
                isLender ? Promise.resolve(0) : db.sale.count({ where: confirmedSaleWhere }),
                db.customer.count({ where: { tenantId } }),
                db.employee.count({ where: { tenantId } }),
                isLender ? db.loan.count({ where: { lenderId: tenantId } }) : Promise.resolve(0),
                wantsMeasured ? db.product.count({ where: { tenantId, saleMode: 'MEASURED' } }) : Promise.resolve(0),
                wantsPack ? db.product.count({ where: { tenantId, packUnit: { not: null }, packSize: { gt: 0 } } }) : Promise.resolve(0),
                wantsBatch ? db.productBatch.count({ where: { tenantId } }) : Promise.resolve(0),
                isLender ? Promise.resolve(null) : db.sale.findFirst({
                    where: confirmedSaleWhere,
                    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                    select: { id: true, createdAt: true },
                }),
                isLender ? Promise.resolve(null) : db.sale.findFirst({
                    where: confirmedSaleWhere,
                    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                    select: { id: true, createdAt: true },
                }),
            ]);

            const firstSaleBusinessDate = firstSale ? claveDelDiaManagua(firstSale.createdAt) : null;
            const lastSaleBusinessDate = lastSale ? claveDelDiaManagua(lastSale.createdAt) : null;

            const hasFiscal = !!(tenant.taxId && String(tenant.taxId).trim() && !isPlaceholderTaxId(tenant.taxId));
            const teamReady = employees > 1;
            const steps = isLender ? [
                { key: 'fiscal', label: 'Configurá los datos de tu negocio', done: hasFiscal, href: '/app/dashboard', cta: 'Configurar' },
                { key: 'customer', label: 'Registrá tu primer cliente', done: customers > 0, href: '/app/dashboard', cta: 'Agregar cliente' },
                { key: 'loan', label: 'Creá tu primer préstamo', done: lenderLoans > 0, href: '/app/dashboard', cta: 'Crear préstamo' },
                { key: 'team', label: 'Agregá un cobrador a tu equipo', done: teamReady, href: '/app/hr', cta: 'Agregar cobrador' },
            ] : [
                {
                    key: 'product',
                    label: wantsMeasured ? 'Configurá tu primer producto por peso o medida' : 'Agregá tu primer producto',
                    done: wantsMeasured ? measuredProducts > 0 : products > 0,
                    href: '/app/inventory',
                    cta: 'Configurar',
                },
                ...(wantsPack ? [{
                    key: 'pack', label: 'Registrá una presentación por empaque o saco',
                    done: packedProducts > 0, href: '/app/inventory', cta: 'Configurar empaque',
                }] : []),
                ...(wantsBatch ? [{
                    key: 'batch', label: 'Registrá tu primer lote y vencimiento',
                    done: batches > 0, href: '/app/inventory', cta: 'Registrar lote',
                }] : []),
                { key: 'sale', label: 'Hacé tu primera venta', done: sales > 0, href: '/app/pos?first_sale=1', cta: 'Vender' },
                { key: 'customer', label: 'Registrá un cliente', done: customers > 0, href: '/app/clients', cta: 'Agregar' },
            ];
            const completed = steps.filter(step => step.done).length;
            return {
                type: tenant.type,
                businessName: tenant.businessName ?? '',
                steps,
                completed,
                total: steps.length,
                allDone: completed === steps.length,
                ...(!isLender ? {
                    salesProgress: {
                        confirmedSales: sales, lastSaleAt: lastSale?.createdAt.toISOString() ?? null,
                        firstSaleId: firstSale?.id ?? null, lastSaleId: lastSale?.id ?? null,
                        firstSaleAt: firstSale?.createdAt.toISOString() ?? null,
                        firstSaleBusinessDate, lastSaleBusinessDate,
                        returnedOnAnotherBusinessDate: firstSaleBusinessDate !== null && lastSaleBusinessDate !== null
                            && lastSaleBusinessDate > firstSaleBusinessDate,
                    },
                } : {}),
            };
        },
    };
}
