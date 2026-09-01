import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import Decimal from 'decimal.js';
import prisma from '../lib/prisma.js';
import { authenticate, type AuthRequest } from '../middleware/auth';
import { checkRole } from '../middleware/checkRole';
import { validate } from '../validation/schemas';
import {
    ApprovalGrantSchema,
    ApproveSaleCorrectionSchema,
    CompleteReturnRefundSchema,
    CreateSaleCorrectionSchema,
    RejectSaleCorrectionSchema,
    ResolveReturnInspectionSchema,
    UpdateReturnSettingsSchema,
} from '../validation/saleCorrectionSchemas';
import {
    approvalTokenHash,
    assertUniqueCorrectionLines,
    canonicalCorrectionCommand,
    CORRECTION_APPROVAL_ROLES,
    CORRECTION_REQUEST_ROLES,
    correctionPayloadHash,
    isReturnWithinWindow,
    isSameManaguaBusinessDay,
} from '../lib/saleCorrections';
import {
    buildReturnAvailability,
    ReturnResolutionError,
    type ReturnProductAuthority,
    type ReturnSaleItemSnapshot,
} from '../services/returnService';
import { applyStockDelta } from '../services/stockService';
import { applyBatchWarehouseDelta } from '../services/productBatchWarehouseLedgerService';
import { createJournalEntry, seedChartOfAccounts } from '../services/accounting';

const router = Router();
const REQUEST_ROLES = [...CORRECTION_REQUEST_ROLES];
const APPROVAL_ROLES = [...CORRECTION_APPROVAL_ROLES];
const CORRECTION_REPORT_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'ACCOUNTANT'];
const approvalGrantLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados intentos de aprobación. Esperá unos minutos.' },
});

router.get('/tenant/return-settings', authenticate, checkRole(REQUEST_ROLES), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const tenant = await prisma.tenant.findUnique({
        where: { id: authReq.tenantId },
        select: { returnWindowDays: true },
    });
    if (!tenant) return res.status(404).json({ error: 'Negocio no encontrado' });
    return res.json(tenant);
});

router.put('/tenant/return-settings', authenticate, checkRole(['OWNER', 'ADMIN']), validate(UpdateReturnSettingsSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const updated = await prisma.$transaction(async (tx) => {
            const before = await tx.tenant.findUnique({ where: { id: authReq.tenantId }, select: { returnWindowDays: true } });
            if (!before) throw new ReturnResolutionError('TENANT_NOT_FOUND', 404, 'Negocio no encontrado');
            const tenant = await tx.tenant.update({
                where: { id: authReq.tenantId },
                data: { returnWindowDays: req.body.returnWindowDays },
                select: { returnWindowDays: true },
            });
            await tx.auditLog.create({ data: {
                tenantId: authReq.tenantId!, userId: authReq.userId!, action: 'RETURN_SETTINGS_UPDATED',
                details: JSON.stringify({ before: before.returnWindowDays, after: tenant.returnWindowDays }),
            } });
            return tenant;
        });
        return res.json(updated);
    } catch (error) {
        return sendError(res, error, 'No pudimos guardar la política de devoluciones');
    }
});

router.get('/reports/sale-corrections/summary', authenticate, checkRole(CORRECTION_REPORT_ROLES), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const end = req.query.to ? new Date(String(req.query.to)) : new Date();
    const start = req.query.from ? new Date(String(req.query.from)) : new Date(end.getTime() - 30 * 86_400_000);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end || end.getTime() - start.getTime() > 366 * 86_400_000) {
        return res.status(400).json({ error: 'El rango del reporte es inválido o supera 366 días' });
    }
    try {
        const [sales, returns, voids, pendingRefunds, quarantine] = await Promise.all([
            prisma.sale.aggregate({
                where: { tenantId: authReq.tenantId!, createdAt: { gte: start, lte: end }, status: { not: 'VOIDED' } },
                _count: { _all: true }, _sum: { total: true },
            }),
            prisma.productReturn.aggregate({
                where: { tenantId: authReq.tenantId!, createdAt: { gte: start, lte: end } },
                _count: { _all: true }, _sum: { total: true },
            }),
            prisma.sale.aggregate({
                where: { tenantId: authReq.tenantId!, status: 'VOIDED', cancelledAt: { gte: start, lte: end } },
                _count: { _all: true }, _sum: { total: true },
            }),
            prisma.returnRefund.aggregate({
                where: { tenantId: authReq.tenantId!, status: 'PENDING' },
                _count: { _all: true }, _sum: { amount: true },
            }),
            prisma.returnInspection.count({ where: { tenantId: authReq.tenantId!, status: 'PENDING' } }),
        ]);
        const grossSales = new Decimal(sales._sum.total?.toString() ?? 0);
        const returnTotal = new Decimal(returns._sum.total?.toString() ?? 0);
        return res.json({
            from: start, to: end,
            grossSales: grossSales.toFixed(2),
            returnTotal: returnTotal.toFixed(2),
            netSalesAfterReturns: grossSales.minus(returnTotal).toFixed(2),
            saleCount: sales._count._all,
            returnCount: returns._count._all,
            voidCount: voids._count._all,
            voidTotal: new Decimal(voids._sum.total?.toString() ?? 0).toFixed(2),
            pendingRefundCount: pendingRefunds._count._all,
            pendingRefundTotal: new Decimal(pendingRefunds._sum.amount?.toString() ?? 0).toFixed(2),
            quarantineCount: quarantine,
        });
    } catch (error) {
        return sendError(res, error, 'No pudimos calcular el resumen de correcciones');
    }
});

const sendError = (res: any, error: unknown, fallback: string) => {
    if (error instanceof ReturnResolutionError) {
        return res.status(error.httpStatus).json({ error: error.message, code: error.code });
    }
    console.error(fallback, error instanceof Error ? error.message : 'UNKNOWN_ERROR');
    return res.status(500).json({ error: fallback });
};

const ensureCorrectionAccounts = async (tenantId: string): Promise<void> => {
    const required = ['1.1.2', '1.1.4', '2.1.13', '5.1.1'];
    const count = await prisma.account.count({ where: { tenantId, code: { in: required } } });
    if (count !== required.length) await seedChartOfAccounts(tenantId);
};

type InspectionBatchEvidence = {
    ledgerMode: 'OFF' | 'SHADOW' | 'ENFORCED';
    requiresBatchTracking: boolean;
    returnWarehouseId: string | null;
    aggregateOnlyQuantity: Decimal;
    restorations: Array<{
        allocationId: string | null;
        batchId: string;
        batchNumber: string;
        warehouseId: string | null;
        quantity: Decimal;
    }>;
};

const parseInspectionBatchEvidence = (value: unknown, fallbackQuantity: Decimal): InspectionBatchEvidence => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { ledgerMode: 'OFF', requiresBatchTracking: false, returnWarehouseId: null, aggregateOnlyQuantity: fallbackQuantity, restorations: [] };
    }
    const raw = value as Record<string, unknown>;
    const ledgerMode = ['OFF', 'SHADOW', 'ENFORCED'].includes(String(raw.ledgerMode))
        ? String(raw.ledgerMode) as InspectionBatchEvidence['ledgerMode']
        : 'OFF';
    const restorations = Array.isArray(raw.restorations) ? raw.restorations.map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new ReturnResolutionError('INSPECTION_EVIDENCE_INVALID', 409, 'La evidencia de lote requiere conciliación');
        const row = entry as Record<string, unknown>;
        const quantity = new Decimal(String(row.quantity ?? 'NaN'));
        if (!quantity.isFinite() || !quantity.greaterThan(0) || !String(row.batchId ?? '').trim()) {
            throw new ReturnResolutionError('INSPECTION_EVIDENCE_INVALID', 409, 'La evidencia de lote requiere conciliación');
        }
        return {
            allocationId: typeof row.allocationId === 'string' ? row.allocationId : null,
            batchId: String(row.batchId),
            batchNumber: String(row.batchNumber ?? ''),
            warehouseId: typeof row.warehouseId === 'string' && row.warehouseId ? row.warehouseId : null,
            quantity,
        };
    }) : [];
    const aggregateOnlyQuantity = new Decimal(String(raw.aggregateOnlyQuantity ?? 0));
    if (!aggregateOnlyQuantity.isFinite() || aggregateOnlyQuantity.isNegative()) {
        throw new ReturnResolutionError('INSPECTION_EVIDENCE_INVALID', 409, 'La evidencia agregada requiere conciliación');
    }
    const total = restorations.reduce((sum, row) => sum.plus(row.quantity), aggregateOnlyQuantity);
    if (!total.equals(fallbackQuantity)) {
        throw new ReturnResolutionError('INSPECTION_EVIDENCE_INVALID', 409, 'La evidencia no coincide con la cantidad en cuarentena');
    }
    return {
        ledgerMode,
        requiresBatchTracking: raw.requiresBatchTracking === true,
        returnWarehouseId: typeof raw.returnWarehouseId === 'string' && raw.returnWarehouseId ? raw.returnWarehouseId : null,
        aggregateOnlyQuantity,
        restorations,
    };
};

// Historial operativo paginado. La respuesta evita traer líneas completas hasta
// abrir el detalle, y toda búsqueda nace del tenant autenticado.
router.get('/sales', authenticate, checkRole([...REQUEST_ROLES, 'VIEWER']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const q = String(req.query.q ?? '').trim();
    const status = String(req.query.status ?? '').trim();
    const cursor = String(req.query.cursor ?? '').trim();
    const requestedTake = Number(req.query.take ?? 30);
    const take = Number.isInteger(requestedTake) ? Math.min(Math.max(requestedTake, 1), 50) : 30;
    const invoiceMatch = q.match(/^(?:([\p{L}\d_-]+)[-\s])?(\d{1,12})$/u);
    const invoiceNumber = invoiceMatch ? Number(invoiceMatch[2]) : null;
    const invoiceSeries = invoiceMatch?.[1] ?? null;

    try {
        const sales = await prisma.sale.findMany({
            where: {
                tenantId: authReq.tenantId,
                ...(status ? { status } : {}),
                ...(q ? {
                    OR: [
                        { id: { startsWith: q } },
                        { customerName: { contains: q } },
                        { customer: { phone: { contains: q } } },
                        ...(invoiceNumber == null ? [] : [{
                            invoiceNumber,
                            ...(invoiceSeries ? { invoiceSeries } : {}),
                        }]),
                    ],
                } : {}),
            },
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            take: take + 1,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: {
                id: true,
                invoiceNumber: true,
                invoiceSeries: true,
                createdAt: true,
                total: true,
                status: true,
                paymentMethod: true,
                customerName: true,
                cancelledAt: true,
                cancelReason: true,
                _count: { select: { items: true, productReturns: true, correctionRequests: true } },
            },
        });
        const hasMore = sales.length > take;
        const page = hasMore ? sales.slice(0, take) : sales;
        return res.json({ items: page, nextCursor: hasMore ? page.at(-1)?.id ?? null : null });
    } catch (error) {
        return sendError(res, error, 'No pudimos cargar el historial de ventas');
    }
});

router.get('/sales/:id/corrections', authenticate, checkRole([...REQUEST_ROLES, 'VIEWER']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const sale = await prisma.sale.findFirst({
            where: { id: req.params.id, tenantId: authReq.tenantId },
            include: {
                customer: { select: { id: true, name: true, phone: true, storeCreditBalance: true } },
                items: true,
                productReturns: { orderBy: { createdAt: 'desc' }, include: { refunds: true, normalizedItems: true } },
                correctionRequests: { orderBy: { createdAt: 'desc' }, include: { lines: true } },
                returnRefunds: { orderBy: { createdAt: 'desc' } },
            },
        });
        if (!sale) return res.status(404).json({ error: 'Venta no encontrada' });
        return res.json(sale);
    } catch (error) {
        return sendError(res, error, 'No pudimos abrir el expediente de la venta');
    }
});

router.get('/sale-corrections', authenticate, checkRole(REQUEST_ROLES), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const status = String(req.query.status ?? '').trim();
    try {
        const requests = await prisma.saleCorrectionRequest.findMany({
            where: { tenantId: authReq.tenantId, ...(status ? { status } : {}) },
            orderBy: { createdAt: 'desc' },
            take: 100,
            include: {
                lines: { include: { saleItem: { select: { productNameAtSale: true, unitAtSale: true } } } },
                sale: { select: { invoiceNumber: true, invoiceSeries: true, total: true, customerId: true, customerName: true, createdAt: true } },
            },
        });
        return res.json(requests);
    } catch (error) {
        return sendError(res, error, 'No pudimos cargar la bandeja de aprobaciones');
    }
});

router.post('/sale-corrections', authenticate, checkRole(REQUEST_ROLES), validate(CreateSaleCorrectionSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const command = canonicalCorrectionCommand(req.body);
    const payloadHash = correctionPayloadHash(req.body);
    try {
        const existing = await prisma.saleCorrectionRequest.findFirst({
            where: { tenantId: authReq.tenantId, clientEventId: req.body.clientEventId },
            include: { lines: true },
        });
        if (existing) {
            if (existing.payloadHash !== payloadHash) {
                return res.status(409).json({ error: 'clientEventId ya fue usado con otra solicitud', code: 'CORRECTION_IDEMPOTENCY_CONFLICT' });
            }
            return res.json({ ...existing, idempotentReplay: true });
        }

        assertUniqueCorrectionLines(command.lines);
        const sale = await prisma.sale.findFirst({
            where: { id: command.saleId, tenantId: authReq.tenantId },
            include: {
                shift: { select: { id: true, status: true } },
                customer: { select: { id: true } },
                items: true,
                productReturns: { select: { items: true } },
                correctionRequests: { where: { status: { in: ['PENDING_APPROVAL', 'APPROVED'] } }, select: { id: true } },
            },
        });
        if (!sale) return res.status(404).json({ error: 'Venta no encontrada' });
        if (sale.status === 'VOIDED' || sale.cancelledAt) {
            return res.status(409).json({ error: 'La factura ya está anulada', code: 'SALE_VOIDED' });
        }
        if (sale.correctionRequests.length > 0) {
            return res.status(409).json({ error: 'La venta ya tiene una corrección pendiente de resolver', code: 'CORRECTION_ALREADY_OPEN' });
        }

        if (command.kind === 'VOID') {
            if (!isSameManaguaBusinessDay(sale.createdAt) || sale.shift?.status !== 'OPEN') {
                return res.status(409).json({
                    error: 'Solo se puede anular el mismo día y mientras la caja original siga abierta. Usá una devolución.',
                    code: 'VOID_WINDOW_CLOSED',
                });
            }
        } else {
            const tenant = await prisma.tenant.findUnique({
                where: { id: authReq.tenantId },
                select: { returnWindowDays: true },
            });
            if (!tenant) return res.status(404).json({ error: 'Negocio no encontrado' });
            if (!isReturnWithinWindow(sale.createdAt, tenant.returnWindowDays) && command.reason.length < 20) {
                return res.status(409).json({
                    error: `La venta supera el plazo de ${tenant.returnWindowDays} días. Documentá la excepción con más detalle.`,
                    code: 'RETURN_WINDOW_EXCEPTION_REASON_REQUIRED',
                });
            }
            if (command.resolution === 'STORE_CREDIT' && !sale.customerId) {
                return res.status(409).json({ error: 'El saldo a favor requiere un cliente identificado', code: 'STORE_CREDIT_CUSTOMER_REQUIRED' });
            }
            const products = await prisma.product.findMany({
                where: { tenantId: authReq.tenantId, id: { in: [...new Set(sale.items.map((item) => item.productId))] } },
                select: { id: true, name: true, unit: true },
            });
            const availability = buildReturnAvailability({
                saleItems: sale.items as ReturnSaleItemSnapshot[],
                previousReturns: sale.productReturns,
                productsById: new Map<string, ReturnProductAuthority>(products.map((product) => [product.id, product])),
                globalDiscount: sale.globalDiscount,
            });
            const availabilityById = new Map(availability.map((line) => [line.saleItemId, line]));
            for (const line of command.lines) {
                const available = availabilityById.get(line.saleItemId);
                if (!available) return res.status(409).json({ error: 'Una línea no pertenece a la venta', code: 'RETURN_LINE_NOT_FOUND' });
                if (new Decimal(line.quantity).greaterThan(available.returnableQuantity)) {
                    return res.status(409).json({ error: `La devolución excede lo disponible de ${available.name}`, code: 'RETURN_QUANTITY_EXCEEDED' });
                }
            }
        }

        const created = await prisma.$transaction(async (tx) => {
            const locked = await tx.$queryRaw<Array<{ id: string }>>`
                SELECT id FROM \`Sale\`
                WHERE id = ${command.saleId} AND tenantId = ${authReq.tenantId}
                FOR UPDATE`;
            if (locked.length !== 1) throw new ReturnResolutionError('SALE_NOT_FOUND', 404, 'Venta no encontrada');
            const openRequest = await tx.saleCorrectionRequest.findFirst({
                where: {
                    tenantId: authReq.tenantId!,
                    saleId: command.saleId,
                    status: { in: ['PENDING_APPROVAL', 'APPROVED'] },
                },
                select: { id: true },
            });
            if (openRequest) {
                throw new ReturnResolutionError('CORRECTION_ALREADY_OPEN', 409, 'La venta ya tiene una corrección pendiente de resolver');
            }
            const persisted = await tx.saleCorrectionRequest.create({
                data: {
                    tenantId: authReq.tenantId!,
                    saleId: command.saleId,
                    kind: command.kind,
                    reason: command.reason,
                    resolution: command.resolution,
                    refundMethod: command.refundMethod,
                    requestedBy: authReq.userId!,
                    clientEventId: req.body.clientEventId,
                    payloadHash,
                    lines: {
                        create: command.lines.map((line) => ({
                            tenantId: authReq.tenantId!,
                            saleItemId: line.saleItemId,
                            quantity: line.quantity,
                            disposition: line.disposition,
                        })),
                    },
                },
                include: { lines: true },
            });
            await tx.auditLog.create({ data: {
                tenantId: authReq.tenantId!, userId: authReq.userId!, action: 'SALE_CORRECTION_REQUESTED',
                details: JSON.stringify({ requestId: persisted.id, saleId: persisted.saleId, kind: persisted.kind, status: persisted.status }),
            } });
            return persisted;
        });
        return res.status(201).json(created);
    } catch (error: any) {
        if (error?.code === 'P2002') return res.status(409).json({ error: 'La solicitud ya existe' });
        return sendError(res, error, 'No pudimos crear la solicitud');
    }
});

router.post('/auth/approval-grants', approvalGrantLimiter, authenticate, validate(ApprovalGrantSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const approver = await prisma.user.findFirst({
            where: { tenantId: authReq.tenantId, email: req.body.email, status: 'ACTIVE', role: { in: APPROVAL_ROLES } },
            select: { id: true, password: true, role: true },
        });
        if (!approver || !(await bcrypt.compare(req.body.password, approver.password))) {
            return res.status(401).json({ error: 'Credenciales de aprobación incorrectas' });
        }
        const token = crypto.randomBytes(32).toString('base64url');
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
        await prisma.approvalGrant.create({
            data: { tenantId: authReq.tenantId!, userId: approver.id, tokenHash: approvalTokenHash(token), purpose: 'SALE_CORRECTION', expiresAt },
        });
        return res.status(201).json({ grantToken: token, expiresAt, approverRole: approver.role });
    } catch (error) {
        return sendError(res, error, 'No pudimos validar la aprobación');
    }
});

router.post('/sale-corrections/:id/approve', authenticate, checkRole(REQUEST_ROLES), validate(ApproveSaleCorrectionSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const result = await prisma.$transaction(async (tx) => {
            const grant = await tx.approvalGrant.findFirst({
                where: { tenantId: authReq.tenantId, tokenHash: approvalTokenHash(req.body.grantToken), purpose: 'SALE_CORRECTION' },
            });
            if (!grant || grant.usedAt || grant.expiresAt <= new Date()) throw new ReturnResolutionError('APPROVAL_GRANT_INVALID', 401, 'La aprobación venció o ya fue utilizada');
            const approver = await tx.user.findFirst({
                where: { id: grant.userId, tenantId: authReq.tenantId, status: 'ACTIVE', role: { in: APPROVAL_ROLES } },
                select: { id: true, role: true },
            });
            if (!approver) throw new ReturnResolutionError('APPROVER_NOT_AUTHORIZED', 403, 'La persona ya no puede aprobar esta operación');
            const request = await tx.saleCorrectionRequest.findFirst({
                where: { id: req.params.id, tenantId: authReq.tenantId },
            });
            if (!request) throw new ReturnResolutionError('CORRECTION_NOT_FOUND', 404, 'Solicitud no encontrada');
            if (request.status !== 'PENDING_APPROVAL') throw new ReturnResolutionError('CORRECTION_NOT_PENDING', 409, 'La solicitud ya fue resuelta');
            if (request.requestedBy === approver.id && approver.role !== 'OWNER') {
                throw new ReturnResolutionError('SELF_APPROVAL_NOT_ALLOWED', 403, 'Solo el dueño de un negocio unipersonal puede aprobar su propia solicitud');
            }
            if (request.requestedBy === approver.id && approver.role === 'OWNER') {
                const otherApprovers = await tx.user.count({
                    where: {
                        tenantId: authReq.tenantId!,
                        id: { not: approver.id },
                        status: 'ACTIVE',
                        role: { in: APPROVAL_ROLES },
                    },
                });
                if (otherApprovers > 0) {
                    throw new ReturnResolutionError('SELF_APPROVAL_NOT_ALLOWED', 403, 'Hay otro aprobador activo; el dueño no puede autoaprobar esta solicitud');
                }
            }
            const consumed = await tx.approvalGrant.updateMany({ where: { id: grant.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
            if (consumed.count !== 1) throw new ReturnResolutionError('APPROVAL_GRANT_INVALID', 401, 'La aprobación ya fue utilizada');
            const updated = await tx.saleCorrectionRequest.updateMany({
                where: { id: request.id, tenantId: authReq.tenantId!, status: 'PENDING_APPROVAL' },
                data: { status: 'APPROVED', approvedBy: approver.id, approvedAt: new Date() },
            });
            if (updated.count !== 1) throw new ReturnResolutionError('CORRECTION_NOT_PENDING', 409, 'La solicitud cambió mientras se aprobaba');
            await tx.auditLog.create({ data: {
                tenantId: authReq.tenantId!, userId: approver.id, action: 'SALE_CORRECTION_APPROVED',
                details: JSON.stringify({ requestId: request.id, saleId: request.saleId, kind: request.kind, requestedBy: request.requestedBy }),
            } });
            return tx.saleCorrectionRequest.findFirst({ where: { id: request.id, tenantId: authReq.tenantId! }, include: { lines: true } });
        });
        return res.json(result);
    } catch (error) {
        return sendError(res, error, 'No pudimos aprobar la solicitud');
    }
});

router.post('/sale-corrections/:id/reject', authenticate, checkRole(APPROVAL_ROLES), validate(RejectSaleCorrectionSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        await prisma.$transaction(async (tx) => {
            const updated = await tx.saleCorrectionRequest.updateMany({
                where: { id: req.params.id, tenantId: authReq.tenantId!, status: 'PENDING_APPROVAL' },
                data: { status: 'REJECTED', rejectedBy: authReq.userId!, rejectedAt: new Date(), rejectionReason: req.body.reason },
            });
            if (updated.count !== 1) throw new ReturnResolutionError('CORRECTION_NOT_PENDING', 409, 'La solicitud no está pendiente');
            await tx.auditLog.create({ data: {
                tenantId: authReq.tenantId!, userId: authReq.userId!, action: 'SALE_CORRECTION_REJECTED',
                details: JSON.stringify({ requestId: req.params.id, reason: req.body.reason }),
            } });
        });
        return res.json({ success: true });
    } catch (error) {
        return sendError(res, error, 'No pudimos rechazar la solicitud');
    }
});

router.get('/return-refunds', authenticate, checkRole(APPROVAL_ROLES), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const status = String(req.query.status ?? 'PENDING');
    try {
        const refunds = await prisma.returnRefund.findMany({
            where: { tenantId: authReq.tenantId, status },
            orderBy: { createdAt: 'asc' }, take: 100,
            include: { sale: { select: { invoiceNumber: true, invoiceSeries: true, customerName: true } } },
        });
        return res.json(refunds);
    } catch (error) {
        return sendError(res, error, 'No pudimos cargar los reembolsos pendientes');
    }
});

router.get('/return-inspections', authenticate, checkRole(APPROVAL_ROLES), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const status = String(req.query.status ?? 'PENDING');
    try {
        const inspections = await prisma.returnInspection.findMany({
            where: { tenantId: authReq.tenantId, status },
            orderBy: { createdAt: 'asc' }, take: 100,
            include: {
                product: { select: { name: true, sku: true, unit: true } },
                correctionLine: { select: { requestId: true } },
            },
        });
        return res.json(inspections);
    } catch (error) {
        return sendError(res, error, 'No pudimos cargar las inspecciones pendientes');
    }
});

router.post('/return-refunds/:id/complete', authenticate, checkRole(APPROVAL_ROLES), validate(CompleteReturnRefundSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        await ensureCorrectionAccounts(authReq.tenantId!);
        const result = await prisma.$transaction(async (tx) => {
            const refund = await tx.returnRefund.findFirst({ where: { id: req.params.id, tenantId: authReq.tenantId } });
            if (!refund) throw new ReturnResolutionError('REFUND_NOT_FOUND', 404, 'Reembolso no encontrado');
            if (refund.status !== 'PENDING') throw new ReturnResolutionError('REFUND_NOT_PENDING', 409, 'El reembolso ya fue resuelto');
            const updated = await tx.returnRefund.updateMany({
                where: { id: refund.id, tenantId: authReq.tenantId!, status: 'PENDING' },
                data: { status: 'COMPLETED', externalReference: req.body.externalReference, evidenceNote: req.body.evidenceNote, completedBy: authReq.userId!, completedAt: new Date() },
            });
            if (updated.count !== 1) throw new ReturnResolutionError('REFUND_NOT_PENDING', 409, 'El reembolso cambió mientras se completaba');
            if (refund.productReturnId) {
                await tx.productReturn.updateMany({
                    where: { id: refund.productReturnId, tenantId: authReq.tenantId! },
                    data: { refundStatus: 'COMPLETED' },
                });
            }
            await createJournalEntry(tx, authReq.tenantId!, `Liquidación de reembolso #${refund.id.slice(0, 8)}`, refund.id, 'REFUND_SETTLEMENT', authReq.userId!, [
                { accountCode: '2.1.13', debit: refund.amount.toNumber(), credit: 0 },
                { accountCode: '1.1.2', debit: 0, credit: refund.amount.toNumber() },
            ]);
            await tx.auditLog.create({ data: {
                tenantId: authReq.tenantId!, userId: authReq.userId!, action: 'RETURN_REFUND_COMPLETED',
                details: JSON.stringify({ refundId: refund.id, saleId: refund.saleId, amount: refund.amount.toString(), method: refund.method, externalReference: req.body.externalReference }),
            } });
            return tx.returnRefund.findFirst({ where: { id: refund.id, tenantId: authReq.tenantId! } });
        });
        return res.json(result);
    } catch (error) {
        return sendError(res, error, 'No pudimos completar el reembolso');
    }
});

router.post('/return-inspections/:id/resolve', authenticate, checkRole(APPROVAL_ROLES), validate(ResolveReturnInspectionSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        await ensureCorrectionAccounts(authReq.tenantId!);
        const result = await prisma.$transaction(async (tx) => {
            const inspection = await tx.returnInspection.findFirst({
                where: { id: req.params.id, tenantId: authReq.tenantId },
                include: { correctionLine: { include: { saleItem: true } } },
            });
            if (!inspection) throw new ReturnResolutionError('INSPECTION_NOT_FOUND', 404, 'Inspección no encontrada');
            if (inspection.status !== 'PENDING') throw new ReturnResolutionError('INSPECTION_ALREADY_RESOLVED', 409, 'La inspección ya fue resuelta');
            let stockBefore: number | null = null;
            let stockAfter: number | null = null;
            if (req.body.resolution === 'RESTOCK') {
                const evidence = parseInspectionBatchEvidence(inspection.batchEvidence, inspection.quantity);
                if (evidence.requiresBatchTracking && evidence.restorations.length === 0) {
                    throw new ReturnResolutionError('INSPECTION_BATCH_RECONCILIATION_REQUIRED', 409, 'No se puede liberar a stock sin identificar el lote original');
                }
                let applied = new Decimal(0);
                const restorations = [...evidence.restorations].sort((left, right) => left.batchId.localeCompare(right.batchId));
                for (const restoration of restorations) {
                    if (restoration.warehouseId) {
                        await applyBatchWarehouseDelta({
                            tx, mode: evidence.ledgerMode, tenantId: authReq.tenantId!, productId: inspection.productId,
                            batchId: restoration.batchId, warehouseId: restoration.warehouseId,
                            delta: restoration.quantity.toFixed(4), movementType: 'SALE_RETURN',
                            referenceId: inspection.id, referenceType: 'RETURN_INSPECTION', userId: authReq.userId!,
                            reason: req.body.reason,
                            sourceKey: `return-inspection:${inspection.id}:batch:${restoration.batchId}`,
                            allowNegative: false,
                        });
                    }
                    const batchUpdated = await tx.productBatch.updateMany({
                        where: { id: restoration.batchId, tenantId: authReq.tenantId!, productId: inspection.productId },
                        data: { stock: { increment: restoration.quantity.toNumber() } },
                    });
                    if (batchUpdated.count !== 1) throw new ReturnResolutionError('INSPECTION_BATCH_NOT_FOUND', 409, 'El lote original ya no está disponible');
                    const stock = await applyStockDelta(tx, {
                        tenantId: authReq.tenantId!, productId: inspection.productId,
                        delta: restoration.quantity.toNumber(), enforceSufficient: false,
                        warehouseId: restoration.warehouseId ?? evidence.returnWarehouseId ?? undefined,
                    });
                    stockBefore ??= stock.stockBefore;
                    stockAfter = stock.stockAfter;
                    await tx.kardexMovement.create({ data: {
                        tenantId: authReq.tenantId!, productId: inspection.productId, type: 'RETURN', quantity: restoration.quantity.toNumber(),
                        stockBefore: stock.stockBefore, stockAfter: stock.stockAfter, referenceId: inspection.id,
                        referenceType: 'RETURN_INSPECTION', reason: `${req.body.reason} - lote ${restoration.batchNumber}`,
                        userId: authReq.userId!, batchId: restoration.batchId, warehouseId: stock.warehouseId,
                    } });
                    applied = applied.plus(restoration.quantity);
                }
                if (evidence.aggregateOnlyQuantity.greaterThan(0)) {
                    const stock = await applyStockDelta(tx, {
                        tenantId: authReq.tenantId!, productId: inspection.productId,
                        delta: evidence.aggregateOnlyQuantity.toNumber(), enforceSufficient: false,
                        warehouseId: evidence.returnWarehouseId ?? undefined,
                    });
                    stockBefore ??= stock.stockBefore;
                    stockAfter = stock.stockAfter;
                    await tx.kardexMovement.create({ data: {
                        tenantId: authReq.tenantId!, productId: inspection.productId, type: 'RETURN', quantity: evidence.aggregateOnlyQuantity.toNumber(),
                        stockBefore: stock.stockBefore, stockAfter: stock.stockAfter, referenceId: inspection.id,
                        referenceType: 'RETURN_INSPECTION', reason: req.body.reason,
                        userId: authReq.userId!, warehouseId: stock.warehouseId,
                    } });
                    applied = applied.plus(evidence.aggregateOnlyQuantity);
                }
                if (!applied.equals(inspection.quantity)) {
                    throw new ReturnResolutionError('INSPECTION_EVIDENCE_INVALID', 409, 'La liberación no coincide con la cantidad en cuarentena');
                }
                const cost = inspection.quantity.mul(inspection.correctionLine.saleItem.costAtSale.toString()).toDecimalPlaces(4);
                await createJournalEntry(tx, authReq.tenantId!, `Liberación de devolución #${inspection.id.slice(0, 8)}`, inspection.id, 'RETURN_INSPECTION', authReq.userId!, [
                    { accountCode: '1.1.4', debit: cost.toNumber(), credit: 0 },
                    { accountCode: '5.1.1', debit: 0, credit: cost.toNumber() },
                ]);
            }
            const status = req.body.resolution === 'RESTOCK' ? 'RESTOCKED' : 'DISCARDED';
            await tx.returnInspection.update({ where: { id: inspection.id }, data: { status, resolvedBy: authReq.userId!, resolvedAt: new Date(), resolutionReason: req.body.reason } });
            await tx.auditLog.create({ data: {
                tenantId: authReq.tenantId!, userId: authReq.userId!, action: 'RETURN_INSPECTION_RESOLVED',
                details: JSON.stringify({ inspectionId: inspection.id, productId: inspection.productId, quantity: inspection.quantity.toString(), status, stockBefore, stockAfter }),
            } });
            return { id: inspection.id, status, stockBefore, stockAfter };
        });
        return res.json(result);
    } catch (error) {
        return sendError(res, error, 'No pudimos resolver la inspección');
    }
});

export default router;
