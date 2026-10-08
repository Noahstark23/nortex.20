import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { SupplierCreditNoteError } from '../lib/supplierCreditNotes.js';
import { SupplierReturnError } from '../lib/supplierReturns.js';
import { authenticate } from '../middleware/auth.js';
import { checkRole } from '../middleware/checkRole.js';
import {
    SUPPLIER_CREDIT_NOTE_READ_ROLES,
    SUPPLIER_CREDIT_NOTE_WRITE_ROLES,
    SUPPLIER_RETURN_READ_ROLES,
    SUPPLIER_RETURN_WRITE_ROLES,
} from '../middleware/accessPolicies.js';
import {
    SupplierReturnServiceError,
    type SupplierReturnEligibleContext,
    type SupplierReturnOperationalDto,
    type SupplierReturnResult,
} from '../services/supplierReturnService.js';
import {
    CreateSupplierCreditNoteSchema,
    CreateSupplierReturnSchema,
    type CreateSupplierCreditNoteInput,
    type CreateSupplierReturnInput,
} from '../validation/supplierReturnSchemas.js';

const identifier = z.string().trim().min(1).max(191)
    .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), 'Identificador inválido');

export const SupplierProcurementParamsSchema = z.object({
    supplierId: identifier,
}).strict();

export const SupplierReturnListQuerySchema = z.object({
    purchaseOrderId: identifier.optional(),
    cursor: z.string().trim().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

export const SupplierCreditNoteListQuerySchema = z.object({
    purchaseId: identifier.optional(),
    cursor: z.string().trim().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

export interface SupplierReturnListQuery {
    purchaseOrderId?: string;
    cursor?: string;
    limit: number;
}

export interface SupplierCreditNoteListQuery {
    purchaseId?: string;
    cursor?: string;
    limit: number;
}

export interface SupplierRouteActorContext {
    tenantId: string;
    userId: string;
    role: string;
    supplierId: string;
}

export interface SupplierReturnListResult {
    data: SupplierReturnOperationalDto[];
    pageInfo: { nextCursor: string | null };
}

export interface SupplierReturnEligibilityQuery {
    purchaseOrderId: string;
    limit: number;
}

export interface SupplierCreditNoteLineHttpDto {
    id: string;
    supplierReturnItemId: string;
    quantityExact: string;
    subtotal: string;
    tax: string;
    creditableTax: string;
    total: string;
    descriptionAtCredit: string;
    unitAtCredit: string;
}

export interface SupplierCreditApplicationHttpDto {
    id: string;
    purchaseId: string;
    amount: string;
    appliedAt: string;
}

/**
 * DTO HTTP deliberadamente allow-listed. Excluye tenantId, clientEventId,
 * payloadHash y detalles internos de Prisma/auditoría.
 */
export interface SupplierCreditNoteHttpDto {
    id: string;
    supplierId: string;
    creditNoteNumber: string;
    type: string;
    status: string;
    invoiceDate: string;
    creditNoteDate: string;
    devolutionDate: string;
    postingDate: string;
    fiscalRegimeAtCredit: string;
    currencyAtIssue: string;
    subtotal: string;
    tax: string;
    creditableTax: string;
    total: string;
    inventoryReversalExact: string;
    priceVarianceReversalExact: string;
    remainingCredit: string;
    reason: string | null;
    supplierReference: string | null;
    createdBy: string;
    createdAt: string;
    lines: SupplierCreditNoteLineHttpDto[];
    applications: SupplierCreditApplicationHttpDto[];
}

export interface SupplierCreditNoteListResult {
    data: SupplierCreditNoteHttpDto[];
    pageInfo: { nextCursor: string | null };
}

export interface SupplierCreditNoteResult {
    supplierCreditNote: SupplierCreditNoteHttpDto;
    replay: boolean;
}

/**
 * Frontera DI: los adapters productivos se conectan solamente cuando los
 * servicios transaccionales están congelados. Las rutas nunca calculan dinero.
 */
export interface SupplierProcurementHttpDependencies {
    listReturns(
        context: SupplierRouteActorContext,
        query: SupplierReturnListQuery,
    ): Promise<SupplierReturnListResult>;
    createReturn(
        context: SupplierRouteActorContext,
        request: CreateSupplierReturnInput,
    ): Promise<SupplierReturnResult>;
    getReturnEligibleLines(
        context: SupplierRouteActorContext,
        query: SupplierReturnEligibilityQuery,
    ): Promise<SupplierReturnEligibleContext>;
    listCreditNotes(
        context: SupplierRouteActorContext,
        query: SupplierCreditNoteListQuery,
    ): Promise<SupplierCreditNoteListResult>;
    createCreditNote(
        context: SupplierRouteActorContext,
        request: CreateSupplierCreditNoteInput,
    ): Promise<SupplierCreditNoteResult>;
}

type AuthenticatedRequest = Request & {
    tenantId: string;
    userId: string;
    role: string;
};

const validateBody = <T>(
    schema: z.ZodType<T>,
    code: string,
    message: string,
) => (req: Request, res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            error: message,
            code,
            details: parsed.error.flatten().fieldErrors,
        });
        return;
    }
    req.body = parsed.data;
    next();
};

const parseOrRespond = <T>(
    schema: z.ZodType<T>,
    value: unknown,
    res: Response,
    code: string,
    message: string,
): T | null => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
        res.status(400).json({
            error: message,
            code,
            details: parsed.error.flatten().fieldErrors,
        });
        return null;
    }
    return parsed.data;
};

const actorContext = (
    req: AuthenticatedRequest,
    supplierId: string,
): SupplierRouteActorContext => ({
    tenantId: req.tenantId,
    userId: req.userId,
    role: req.role,
    supplierId,
});

/** Defensa en profundidad: ni una dependencia DI puede filtrar costos al DTO operativo. */
const serializeSupplierReturn = (
    value: SupplierReturnOperationalDto,
): SupplierReturnOperationalDto => ({
    id: value.id,
    supplierId: value.supplierId,
    returnNumber: value.returnNumber,
    status: value.status,
    reasonCode: value.reasonCode,
    reason: value.reason,
    supplierReference: value.supplierReference,
    batchLedgerMode: value.batchLedgerMode,
    returnedBy: value.returnedBy,
    returnedAt: value.returnedAt,
    createdAt: value.createdAt,
    items: value.items.map((item) => ({
        id: item.id,
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        productId: item.productId,
        productNameAtReturn: item.productNameAtReturn,
        warehouse: { id: item.warehouse.id, name: item.warehouse.name },
        batch: item.batch === null ? null : {
            id: item.batch.id,
            batchNumber: item.batch.batchNumber,
            expiryDate: item.batch.expiryDate,
        },
        quantityExact: item.quantityExact,
        unitAtReturn: item.unitAtReturn,
        saleModeAtReturn: item.saleModeAtReturn,
        quantityStepAtReturn: item.quantityStepAtReturn,
        batchLedgerStatus: item.batchLedgerStatus,
        creditEligibility: item.creditEligibility,
    })),
});

const serializeSupplierReturnEligibility = (
    value: SupplierReturnEligibleContext,
): SupplierReturnEligibleContext => ({
    purchaseOrderId: value.purchaseOrderId,
    supplierId: value.supplierId,
    batchLedgerMode: value.batchLedgerMode,
    truncated: value.truncated,
    eligibleLines: value.eligibleLines.map((line) => ({
        sourceType: line.sourceType,
        sourceId: line.sourceId,
        purchaseOrderId: line.purchaseOrderId,
        goodsReceiptItemId: line.goodsReceiptItemId,
        purchaseMatchAllocationId: line.purchaseMatchAllocationId,
        product: { id: line.product.id, name: line.product.name },
        warehouse: { id: line.warehouse.id, name: line.warehouse.name },
        batch: line.batch === null ? null : {
            id: line.batch.id,
            batchNumber: line.batch.batchNumber,
            expiryDate: line.batch.expiryDate,
        },
        quantity: {
            acceptedExact: line.quantity.acceptedExact,
            allocatedExact: line.quantity.allocatedExact,
            returnedExact: line.quantity.returnedExact,
            availableExact: line.quantity.availableExact,
            physicalRemainingExact: line.quantity.physicalRemainingExact,
        },
        unitAtReturn: line.unitAtReturn,
        saleModeAtReturn: line.saleModeAtReturn,
        quantityStepAtReturn: line.quantityStepAtReturn,
        blockCode: line.blockCode,
    })),
});

const serializeCreditNote = (
    value: SupplierCreditNoteHttpDto,
): SupplierCreditNoteHttpDto => ({
    id: value.id,
    supplierId: value.supplierId,
    creditNoteNumber: value.creditNoteNumber,
    type: value.type,
    status: value.status,
    invoiceDate: value.invoiceDate,
    creditNoteDate: value.creditNoteDate,
    devolutionDate: value.devolutionDate,
    postingDate: value.postingDate,
    fiscalRegimeAtCredit: value.fiscalRegimeAtCredit,
    currencyAtIssue: value.currencyAtIssue,
    subtotal: value.subtotal,
    tax: value.tax,
    creditableTax: value.creditableTax,
    total: value.total,
    inventoryReversalExact: value.inventoryReversalExact,
    priceVarianceReversalExact: value.priceVarianceReversalExact,
    remainingCredit: value.remainingCredit,
    reason: value.reason,
    supplierReference: value.supplierReference,
    createdBy: value.createdBy,
    createdAt: value.createdAt,
    lines: value.lines.map((line) => ({
        id: line.id,
        supplierReturnItemId: line.supplierReturnItemId,
        quantityExact: line.quantityExact,
        subtotal: line.subtotal,
        tax: line.tax,
        creditableTax: line.creditableTax,
        total: line.total,
        descriptionAtCredit: line.descriptionAtCredit,
        unitAtCredit: line.unitAtCredit,
    })),
    applications: value.applications.map((application) => ({
        id: application.id,
        purchaseId: application.purchaseId,
        amount: application.amount,
        appliedAt: application.appliedAt,
    })),
});

const safeErrorMetadata = (error: unknown): { name: string; code?: string } => ({
    name: error instanceof Error ? error.name : 'UnknownError',
    code: typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code ?? '') || undefined
        : undefined,
});

const sendError = (res: Response, error: unknown, operation: string): Response => {
    if (
        error instanceof SupplierReturnError
        || error instanceof SupplierReturnServiceError
        || error instanceof SupplierCreditNoteError
    ) {
        return res.status(error.httpStatus).json({ error: error.message, code: error.code });
    }
    // Prisma puede adjuntar IDs/documentos a Error.message. Nunca se registra
    // ni se serializa el mensaje de un error desconocido.
    console.error('Proveedor: operación de devolución/crédito falló', {
        operation,
        ...safeErrorMetadata(error),
    });
    return res.status(500).json({
        error: 'No pudimos completar la operación de proveedor',
        code: 'SUPPLIER_OPERATION_FAILED',
    });
};

export function buildSupplierReturnsRouter(
    dependencies: SupplierProcurementHttpDependencies,
) {
    const router = express.Router();

    router.get(
        '/:supplierId/returns',
        authenticate,
        checkRole(SUPPLIER_RETURN_READ_ROLES),
        async (request: Request, res: Response) => {
            const req = request as AuthenticatedRequest;
            const params = parseOrRespond(
                SupplierProcurementParamsSchema,
                req.params,
                res,
                'INVALID_SUPPLIER_RETURN_PARAMS',
                'Proveedor de devolución inválido',
            );
            if (!params) return;
            const query = parseOrRespond(
                SupplierReturnListQuerySchema,
                req.query,
                res,
                'INVALID_SUPPLIER_RETURN_QUERY',
                'Filtros de devolución inválidos',
            );
            if (!query) return;
            if (req.role === 'BODEGUERO' && !query.purchaseOrderId) {
                return res.status(400).json({
                    error: 'La consulta de bodega requiere una orden de compra',
                    code: 'SUPPLIER_RETURN_CONTEXT_REQUIRED',
                });
            }
            try {
                const context = actorContext(req, params.supplierId);
                const [result, eligibility] = await Promise.all([
                    dependencies.listReturns(context, query),
                    query.purchaseOrderId
                        ? dependencies.getReturnEligibleLines(context, {
                            purchaseOrderId: query.purchaseOrderId,
                            limit: query.limit,
                        })
                        : Promise.resolve(null),
                ]);
                return res.json({
                    data: {
                        returns: result.data.map(serializeSupplierReturn),
                        ...(eligibility === null ? {} : {
                            eligibleLines: serializeSupplierReturnEligibility(eligibility),
                        }),
                    },
                    pageInfo: result.pageInfo,
                });
            } catch (error) {
                return sendError(res, error, 'listar devoluciones');
            }
        },
    );

    router.post(
        '/:supplierId/returns',
        authenticate,
        checkRole(SUPPLIER_RETURN_WRITE_ROLES),
        validateBody(
            CreateSupplierReturnSchema,
            'INVALID_SUPPLIER_RETURN',
            'Datos de devolución inválidos',
        ),
        async (request: Request, res: Response) => {
            const req = request as AuthenticatedRequest;
            const params = parseOrRespond(
                SupplierProcurementParamsSchema,
                req.params,
                res,
                'INVALID_SUPPLIER_RETURN_PARAMS',
                'Proveedor de devolución inválido',
            );
            if (!params) return;
            try {
                const result = await dependencies.createReturn(
                    actorContext(req, params.supplierId),
                    req.body,
                );
                return res.json({
                    data: serializeSupplierReturn(result.supplierReturn),
                    replay: result.replay,
                });
            } catch (error) {
                return sendError(res, error, 'registrar devolución');
            }
        },
    );

    router.get(
        '/:supplierId/credit-notes',
        authenticate,
        checkRole(SUPPLIER_CREDIT_NOTE_READ_ROLES),
        async (request: Request, res: Response) => {
            const req = request as AuthenticatedRequest;
            const params = parseOrRespond(
                SupplierProcurementParamsSchema,
                req.params,
                res,
                'INVALID_SUPPLIER_CREDIT_NOTE_PARAMS',
                'Proveedor de nota de crédito inválido',
            );
            if (!params) return;
            const query = parseOrRespond(
                SupplierCreditNoteListQuerySchema,
                req.query,
                res,
                'INVALID_SUPPLIER_CREDIT_NOTE_QUERY',
                'Filtros de nota de crédito inválidos',
            );
            if (!query) return;
            try {
                const result = await dependencies.listCreditNotes(
                    actorContext(req, params.supplierId),
                    query,
                );
                return res.json({
                    data: result.data.map(serializeCreditNote),
                    pageInfo: result.pageInfo,
                });
            } catch (error) {
                return sendError(res, error, 'listar notas de crédito');
            }
        },
    );

    router.post(
        '/:supplierId/credit-notes',
        authenticate,
        checkRole(SUPPLIER_CREDIT_NOTE_WRITE_ROLES),
        validateBody(
            CreateSupplierCreditNoteSchema,
            'INVALID_SUPPLIER_CREDIT_NOTE',
            'Datos de nota de crédito inválidos',
        ),
        async (request: Request, res: Response) => {
            const req = request as AuthenticatedRequest;
            const params = parseOrRespond(
                SupplierProcurementParamsSchema,
                req.params,
                res,
                'INVALID_SUPPLIER_CREDIT_NOTE_PARAMS',
                'Proveedor de nota de crédito inválido',
            );
            if (!params) return;
            try {
                const result = await dependencies.createCreditNote(
                    actorContext(req, params.supplierId),
                    req.body,
                );
                return res.json({
                    data: serializeCreditNote(result.supplierCreditNote),
                    replay: result.replay,
                });
            } catch (error) {
                return sendError(res, error, 'registrar nota de crédito');
            }
        },
    );

    return router;
}
