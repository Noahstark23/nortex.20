import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { authenticate } from '../middleware/auth.js';
import { checkRole } from '../middleware/checkRole.js';
import {
    SUPPLIER_READ_ROLES,
    SUPPLIER_WRITE_ROLES,
} from '../middleware/accessPolicies.js';
import {
    createSupplierService,
    SupplierServiceError,
} from '../services/supplierService.js';
import {
    CreateSupplierContactSchema,
    CreateSupplierDocumentSchema,
    CreateSupplierSchema,
    isSupplierControlAuthorized,
    SupplierContactParamsSchema,
    SupplierDocumentParamsSchema,
    SupplierIdParamsSchema,
    SupplierListQuerySchema,
    UpdateSupplierContactSchema,
    UpdateSupplierSchema,
} from '../validation/supplierSchemas.js';

export { SUPPLIER_READ_ROLES, SUPPLIER_WRITE_ROLES };
export const SUPPLIER_ADMIN_ROLES = ['OWNER', 'ADMIN', 'SUPER_ADMIN'] as const;
export const SUPPLIER_CONTACT_WRITE_ROLES = SUPPLIER_WRITE_ROLES;

function validateBody(schema: any) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const result = schema.safeParse(req.body);
        if (!result.success) {
            res.status(400).json({
                error: 'Datos de entrada inválidos',
                details: result.error.flatten().fieldErrors,
            });
            return;
        }
        req.body = result.data;
        next();
    };
}

function parseOrRespond(schema: any, value: unknown, res: Response): any | null {
    const result = schema.safeParse(value);
    if (!result.success) {
        res.status(400).json({
            error: 'Datos de entrada inválidos',
            details: result.error.flatten().fieldErrors,
        });
        return null;
    }
    return result.data;
}

function sendError(res: Response, error: unknown, operation: string) {
    if (error instanceof SupplierServiceError) {
        return res.status(error.status).json({ error: error.message, code: error.code });
    }
    const databaseCode = typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code ?? '')
        : '';
    if (databaseCode === 'P2002') {
        return res.status(409).json({ error: 'Ya existe un registro de proveedor con esos datos' });
    }
    // No serializar el error: Prisma puede adjuntar valores de contacto o keys
    // privadas a sus mensajes. El código/nombre bastan para observabilidad.
    console.error(`Proveedor 360: ${operation} falló`, {
        name: error instanceof Error ? error.name : 'UnknownError',
        code: databaseCode || undefined,
    });
    return res.status(500).json({ error: 'No pudimos completar la operación de proveedor' });
}

export function buildSuppliersRouter(service = createSupplierService()) {
    const router = express.Router();

    // Compatibilidad: la lista conserva el ARRAY que consume la UI histórica.
    router.get('/', authenticate, checkRole(SUPPLIER_READ_ROLES), async (req: any, res: Response) => {
        const query = parseOrRespond(SupplierListQuerySchema, req.query, res);
        if (!query) return;
        try {
            res.json(await service.list(req.tenantId, query));
        } catch (error) {
            sendError(res, error, 'listar');
        }
    });

    router.get('/:id', authenticate, checkRole(SUPPLIER_READ_ROLES), async (req: any, res: Response) => {
        const params = parseOrRespond(SupplierIdParamsSchema, req.params, res);
        if (!params) return;
        try {
            const data = await service.detail(req.tenantId, params.id, req.role);
            res.json({ data });
        } catch (error) {
            sendError(res, error, 'consultar detalle');
        }
    });

    router.post(
        '/',
        authenticate,
        checkRole(SUPPLIER_WRITE_ROLES),
        validateBody(CreateSupplierSchema),
        async (req: any, res: Response) => {
            if (!isSupplierControlAuthorized(req.role, req.body)) {
                return res.status(403).json({
                    error: 'Los controles fiscales, de crédito y estado requieren administración',
                    code: 'SUPPLIER_CONTROL_FORBIDDEN',
                });
            }
            try {
                const data = await service.create(req.tenantId, req.userId, req.body);
                // Compatibilidad de callers existentes: body.id sigue en la
                // raíz; la UI 360 consume body.data sin un segundo endpoint.
                return res.json({ ...data, data });
            } catch (error) {
                return sendError(res, error, 'crear');
            }
        },
    );

    router.put(
        '/:id',
        authenticate,
        checkRole(SUPPLIER_WRITE_ROLES),
        validateBody(UpdateSupplierSchema),
        async (req: any, res: Response) => {
            const params = parseOrRespond(SupplierIdParamsSchema, req.params, res);
            if (!params) return;
            // Fail-closed sobre el payload completo: no se aplican parcialmente
            // los campos básicos cuando uno de los controles es privilegiado.
            if (!isSupplierControlAuthorized(req.role, req.body)) {
                return res.status(403).json({
                    error: 'Los controles fiscales, de crédito y estado requieren administración',
                    code: 'SUPPLIER_CONTROL_FORBIDDEN',
                });
            }
            try {
                const data = await service.update(req.tenantId, req.userId, params.id, req.body);
                return res.json({ ...data, data });
            } catch (error) {
                return sendError(res, error, 'actualizar');
            }
        },
    );

    router.delete(
        '/:id',
        authenticate,
        checkRole(SUPPLIER_ADMIN_ROLES),
        async (req: any, res: Response) => {
            const params = parseOrRespond(SupplierIdParamsSchema, req.params, res);
            if (!params) return;
            try {
                const data = await service.softDelete(req.tenantId, req.userId, params.id);
                return res.json({ message: 'Proveedor archivado', data });
            } catch (error) {
                return sendError(res, error, 'archivar');
            }
        },
    );

    router.post(
        '/:id/contacts',
        authenticate,
        checkRole(SUPPLIER_CONTACT_WRITE_ROLES),
        validateBody(CreateSupplierContactSchema),
        async (req: any, res: Response) => {
            const params = parseOrRespond(SupplierIdParamsSchema, req.params, res);
            if (!params) return;
            try {
                const data = await service.createContact(req.tenantId, req.userId, params.id, req.body);
                return res.status(201).json({ data });
            } catch (error) {
                return sendError(res, error, 'crear contacto');
            }
        },
    );

    router.patch(
        '/:id/contacts/:contactId',
        authenticate,
        checkRole(SUPPLIER_CONTACT_WRITE_ROLES),
        validateBody(UpdateSupplierContactSchema),
        async (req: any, res: Response) => {
            const params = parseOrRespond(SupplierContactParamsSchema, req.params, res);
            if (!params) return;
            try {
                const data = await service.updateContact(
                    req.tenantId,
                    req.userId,
                    params.id,
                    params.contactId,
                    req.body,
                );
                return res.json({ data });
            } catch (error) {
                return sendError(res, error, 'actualizar contacto');
            }
        },
    );

    router.delete(
        '/:id/contacts/:contactId',
        authenticate,
        checkRole(SUPPLIER_CONTACT_WRITE_ROLES),
        async (req: any, res: Response) => {
            const params = parseOrRespond(SupplierContactParamsSchema, req.params, res);
            if (!params) return;
            try {
                const data = await service.deleteContact(
                    req.tenantId,
                    req.userId,
                    params.id,
                    params.contactId,
                );
                return res.json({ message: 'Contacto eliminado', data });
            } catch (error) {
                return sendError(res, error, 'eliminar contacto');
            }
        },
    );

    router.post(
        '/:id/documents',
        authenticate,
        checkRole(SUPPLIER_ADMIN_ROLES),
        validateBody(CreateSupplierDocumentSchema),
        async (req: any, res: Response) => {
            const params = parseOrRespond(SupplierIdParamsSchema, req.params, res);
            if (!params) return;
            try {
                const data = await service.createDocument(req.tenantId, req.userId, params.id, req.body);
                return res.status(201).json({ data });
            } catch (error) {
                return sendError(res, error, 'registrar documento');
            }
        },
    );

    router.delete(
        '/:id/documents/:documentId',
        authenticate,
        checkRole(SUPPLIER_ADMIN_ROLES),
        async (req: any, res: Response) => {
            const params = parseOrRespond(SupplierDocumentParamsSchema, req.params, res);
            if (!params) return;
            try {
                const data = await service.deleteDocument(
                    req.tenantId,
                    req.userId,
                    params.id,
                    params.documentId,
                );
                return res.json({ message: 'Metadata de documento eliminada', data });
            } catch (error) {
                return sendError(res, error, 'eliminar documento');
            }
        },
    );

    return router;
}

export default buildSuppliersRouter();
