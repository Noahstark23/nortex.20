import Decimal from 'decimal.js';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { AuthRequest } from '../middleware/auth';
import prisma from '../lib/prisma';
import { QuotationItemError, resolveQuotationItems, serializeQuotationItemsForClient, type QuotationProductAuthority } from '../lib/quotationItems';
import { QuantityValidationError } from '../../utils/quantity';
import { normalizeFiscalRegime } from '../../utils/fiscalRegime';
import { calculateQuotationTotals } from '../lib/quotationTotals';

/** Montar después de authenticate + checkRole(QUOTATION_WRITE_ROLES); tenant del JWT. */
export function createQuotationHandler({db=prisma}: {db?:PrismaClient}={}) {
  return async (req:any,res:any)=>{
    const authReq = req as AuthRequest;
    const { customerName, customerRuc, items, expiresAt } = req.body;

    if (!items || items.length === 0) return res.status(400).json({ error: 'Faltan items' });

    try {
        const parsedItems = z.array(z.object({
            id: z.string().trim().min(1).max(191).optional(),
            productId: z.string().trim().min(1).max(191).optional(),
            quantity: z.union([z.string(), z.number()]),
            price: z.union([z.string(), z.number()]).optional(),
            name: z.string().trim().min(1).max(255).optional(),
        }).strict()).min(1).max(500).parse(items).map((item) => ({
            ...item,
            quantity: item.quantity,
        }));

        const productIds = [...new Set(parsedItems.map((item) => String(item.productId ?? item.id)))];
        const [products, tenantFiscal] = await Promise.all([
            db.product.findMany({
                where: { tenantId: authReq.tenantId!, id: { in: productIds } },
                select: {
                    id: true,
                    name: true,
                    price: true,
                    unit: true,
                    ivaExento: true,
                    saleMode: true,
                    quantityStep: true,
                },
            }) as Promise<QuotationProductAuthority[]>,
            db.tenant.findUnique({
                where: { id: authReq.tenantId! },
                select: { fiscalRegime: true },
            }),
        ]);
        if (!tenantFiscal) return res.status(404).json({ error: 'Negocio no encontrado' });
        const fiscalRegimeAtQuote = normalizeFiscalRegime(tenantFiscal.fiscalRegime);
        const resolvedItems = resolveQuotationItems(parsedItems, products);

        const amounts = calculateQuotationTotals(resolvedItems, fiscalRegimeAtQuote);
        const subtotal = amounts.subtotal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
        const tax = amounts.tax.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
        const total = amounts.total.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();

        const quote = await db.quotation.create({
            data: {
                tenantId: authReq.tenantId!,
                customerName,
                customerRuc,
                subtotal,
                tax,
                fiscalRegimeAtQuote,
                total,
                expiresAt: new Date(expiresAt),
                items: {
                    create: resolvedItems.map((item) => ({
                        productId: item.productId,
                        name: item.name,
                        price: item.price.toNumber(),
                        unitPriceExact: item.price.toFixed(4),
                        quantity: item.quantityLegacy,
                        quantityExact: item.quantityExact.toFixed(),
                        unitAtQuote: item.unit,
                        saleModeAtQuote: item.saleMode,
                        quantityStepAtQuote: item.quantityStep,
                        presentationAtQuote: item.presentationAtQuote,
                        presentationQuantityAtQuote: item.presentationQuantityAtQuote.toFixed(4),
                        ivaExentoAtQuote: item.ivaExento,
                    })),
                },
            },
            include: {
                items: {
                    orderBy: { id: 'asc' },
                },
            },
        });

        res.json({
            ...quote,
            subtotal,
            tax,
            total,
            items: serializeQuotationItemsForClient(quote.items, products),
        });
    } catch (error) {
        if (error instanceof QuotationItemError) {
            return res.status(error.code === 'PRODUCT_NOT_FOUND' ? 404 : 400).json({ error: error.message, code: error.code });
        }
        if (error instanceof QuantityValidationError) {
            return res.status(400).json({ error: error.message, code: error.code });
        }
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: error.issues.map((issue) => issue.message).join(' | ') || 'Items inválidos' });
        }
        console.error('Create quotation error:', error);
        res.status(500).json({ error: 'Error al crear cotización' });
    }
  };
}
