import express from 'express';
// @ts-ignore
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import Decimal from 'decimal.js';
import { authenticate, AuthRequest } from '../middleware/auth';
import { checkRole } from '../middleware/checkRole';
import { PEDIDO_READ_ROLES, PEDIDO_WRITE_ROLES } from '../middleware/accessPolicies';
import prisma from '../lib/prisma.js';
import { StockError } from '../services/stockService';
import {
    cancelPedidoInTransaction,
    completePedidoDeliveryInTransaction,
    lockPedidoForFulfillment,
    PedidoFulfillmentError,
    reservePedidoInTransaction,
} from '../services/pedidoFulfillmentService.js';
import {
    PublicOrderItemError,
    resolvePublicOrderItems,
    type PublicOrderProductAuthority,
    type ResolvedPublicOrderItem,
} from '../services/publicOrderItemService.js';
import { signPedidoTrackingToken, verifyPedidoTrackingToken } from '../services/secrets.js';
import {
    PUBLIC_PEDIDO_TRACKING_SELECT,
    toPublicPedidoTrackingDto,
} from '../services/pedidoTrackingService.js';
import { motorizadoSafeSelect } from '../services/motorizadoIdentity.js';

const DEFAULT_PEDIDO_LIST_LIMIT = 100;
const MAX_PEDIDO_LIST_LIMIT = 200;
const PEDIDO_PRODUCT_OPERATIONAL_SELECT = {
    name: true,
    sku: true,
    imageUrl: true,
} as const;


export const PedidoListQuerySchema = z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(MAX_PEDIDO_LIST_LIMIT).optional().default(DEFAULT_PEDIDO_LIST_LIMIT),
});

const isLimitedPedidoDetailRole = (role?: string): boolean => (
    role === 'CASHIER' || role === 'VIEWER'
);


export const PEDIDO_ESTADOS_VALIDOS = [
    'pendiente',
    'asignado',
    'preparando',
    'en_tienda',
    'en_ruta',
    'en_camino',
    'en_punto',
    'entregado',
    'cancelado',
] as const;

export type PedidoEstado = typeof PEDIDO_ESTADOS_VALIDOS[number];

/**
 * Flujo autoritativo de pedidos. Esta matriz también protege a clientes PWA
 * desactualizados: el servidor nunca permite saltarse la reserva de stock ni
 * reabrir un pedido terminal.
 */
export const PEDIDO_STATE_TRANSITIONS: Readonly<Record<PedidoEstado, readonly PedidoEstado[]>> = {
    pendiente: ['asignado', 'preparando', 'cancelado'],
    asignado: ['preparando', 'cancelado'],
    preparando: ['en_tienda', 'en_camino', 'cancelado'],
    en_tienda: ['en_ruta', 'en_camino', 'cancelado'],
    en_ruta: ['en_punto', 'entregado', 'cancelado'],
    en_camino: ['en_punto', 'entregado', 'cancelado'],
    en_punto: ['entregado', 'cancelado'],
    entregado: [],
    cancelado: [],
};

const PEDIDO_ROUTE_STATES = new Set<PedidoEstado>(['en_ruta', 'en_camino', 'en_punto']);
const PEDIDO_TERMINAL_STATES: readonly PedidoEstado[] = ['entregado', 'cancelado'];

export const isPedidoEstado = (value: unknown): value is PedidoEstado =>
    typeof value === 'string'
    && (PEDIDO_ESTADOS_VALIDOS as readonly string[]).includes(value);

export const isPedidoTransitionAllowed = (from: string, to: string): boolean =>
    isPedidoEstado(from)
    && isPedidoEstado(to)
    && PEDIDO_STATE_TRANSITIONS[from].some((candidate) => candidate === to);

class PedidoRouteError extends Error {
    constructor(
        public readonly code: 'PEDIDO_RIDER_REQUIRED' | 'PEDIDO_INVALID_RIDER',
        public readonly httpStatus: number,
        message: string,
    ) {
        super(message);
        this.name = 'PedidoRouteError';
    }
}

/**
 * ==========================================
 * 🛵 MÓDULO DE ENTREGAS A DOMICILIO
 * ==========================================
 */

// Rate limit del checkout público: el endpoint no exige JWT, así que la
// única defensa anti-spam es por IP (mismo perfil que /api/public/orders).
const createPedidoLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Demasiados pedidos desde esta conexión. Intenta en unos minutos.' },
});

// Contrato del checkout del catálogo. El tenant se deriva del SLUG público
// (nunca del body) y costoEntrega lo fija el servidor (Tenant.deliveryFee):
// un cliente malicioso no puede pedirle a otro tenant ni alterar el flete.
const CreatePedidoSchema = z.object({
    slug: z.string().min(1, 'slug requerido'),
    clienteNombre: z.string().trim().min(1, 'Nombre requerido').max(100),
    clienteTelefono: z.string().trim().min(8, 'Teléfono requerido').max(20),
    direccionEntrega: z.string().trim().min(5, 'Dirección de entrega requerida').max(2000),
    referenciaDireccion: z.string().trim().max(2000).optional(),
    notas: z.string().trim().max(2000).optional(),
    items: z
        .array(
            z.object({
                productoId: z.string().min(1),
                cantidad: z.union([z.string().trim().min(1).max(64), z.number().finite()]),
                presentation: z.enum(['BASE', 'PACK']).optional(),
            })
        )
        .min(1, 'Se requiere al menos 1 producto')
        .max(50),
});

export interface PublicPedidoConfirmationItem {
    productId: string;
    name: string;
    quantity: string;
    presentation: 'BASE' | 'PACK';
    unit: string;
    subtotal: string;
}

/** Proyecta solo el resumen público ya resuelto dentro del tenant del slug. */
export const buildPublicPedidoConfirmationItems = (
    resolvedItems: readonly ResolvedPublicOrderItem[],
    products: readonly PublicOrderProductAuthority[],
): PublicPedidoConfirmationItem[] => {
    const productsById = new Map(products.map((product) => [product.id, product]));
    return resolvedItems.map((item) => {
        const product = productsById.get(item.productId);
        if (!product) {
            throw new PublicOrderItemError(
                'PRODUCT_NOT_FOUND',
                'Producto no encontrado en este negocio',
                404,
            );
        }
        const presentationUnit = item.presentationAtSale === 'PACK'
            ? product.packUnit?.trim()
            : item.unit.trim();
        if (!presentationUnit) {
            throw new PublicOrderItemError(
                'INVALID_PRODUCT_CONFIGURATION',
                `${item.productName} no tiene una unidad de presentación válida`,
                409,
            );
        }
        return {
            productId: item.productId,
            name: item.productName,
            quantity: item.presentationQuantityAtSale.toFixed(),
            presentation: item.presentationAtSale,
            unit: presentationUnit,
            subtotal: item.subtotal.toFixed(2),
        };
    });
};

export const buildPedidosRouter = () => {
    const router = express.Router();

// POST /api/v1/pedidos -> (Público) Crear pedido desde el catálogo
router.post('/', createPedidoLimiter, async (req: any, res: any) => {
    const parsed = CreatePedidoSchema.safeParse(req.body);
    if (!parsed.success) {
        const msg = parsed.error.issues.map(i => i.message).join(' | ');
        return res.status(400).json({ error: msg || 'Datos del pedido inválidos.' });
    }
    const { slug, clienteNombre, clienteTelefono, direccionEntrega, referenciaDireccion, notas, items } = parsed.data;

    try {
        // Tenant derivado del slug del catálogo público
        const tenant = await prisma.tenant.findUnique({
            where: { slug },
            select: { id: true, deliveryFee: true },
        });
        if (!tenant) {
            return res.status(404).json({ error: 'Catálogo no encontrado.' });
        }
        const tenantId = tenant.id;

        // Solo productos del tenant Y publicados en el catálogo: el precio
        // SIEMPRE sale de la BD (el cliente no manda precios).
        const pedidoCreated = await prisma.$transaction(async (tx: any) => {
            const productIds = [...new Set(items.map((item) => item.productoId))];
            const productsDB: PublicOrderProductAuthority[] = await tx.product.findMany({
                where: { tenantId, id: { in: productIds }, isPublished: true },
                select: {
                    id: true, tenantId: true, isPublished: true, name: true, unit: true,
                    price: true, cost: true, ivaExento: true, saleMode: true, quantityStep: true,
                    wholesalePrice: true, wholesaleMinQty: true, packUnit: true, packSize: true,
                    packPrice: true, requiresBatchTracking: true,
                },
            });
            const resolvedItems = resolvePublicOrderItems(
                tenantId,
                items.map((item) => ({
                    productId: item.productoId,
                    quantity: item.cantidad,
                    presentation: item.presentation,
                })),
                productsDB,
            );
            const confirmationItems = buildPublicPedidoConfirmationItems(resolvedItems, productsDB);
            const totalSuma = resolvedItems.reduce(
                (sum, item) => sum.plus(item.subtotal),
                new Decimal(0),
            );
            // Flete: SERVER-SIDE desde la config del negocio (jamás del body).
            const costoEntrega = new Decimal(tenant.deliveryFee.toString()).toDecimalPlaces(2);
            const granTotal = totalSuma.plus(costoEntrega).toDecimalPlaces(2);
            const pedido = await tx.pedido.create({
                data: {
                    tenantId,
                    clienteNombre,
                    clienteTelefono,
                    direccionEntrega,
                    referenciaDireccion: referenciaDireccion ?? null,
                    notas: notas ?? null,
                    estado: 'pendiente',
                    costoEntrega: costoEntrega.toNumber(),
                    total: granTotal.toNumber(),
                    items: {
                        create: resolvedItems.map((item) => ({
                            productoId: item.productId,
                            cantidad: item.quantityLegacy,
                            cantidadExact: item.quantityExact.toFixed(),
                            precioUnitario: item.unitPrice.toFixed(2),
                            unitPriceExactAtOrder: item.unitPrice.toFixed(4),
                            subtotal: item.subtotal.toFixed(2),
                            productNameAtOrder: item.productName,
                            unitAtOrder: item.unit,
                            saleModeAtOrder: item.saleMode,
                            quantityStepAtOrder: item.quantityStep,
                            ivaExentoAtOrder: item.ivaExento,
                            presentationAtSale: item.presentationAtSale,
                            presentationQuantityAtSale: item.presentationQuantityAtSale.toFixed(4),
                        })),
                    },
                    eventos: {
                        create: {
                            estado: 'pendiente',
                            nota: 'Pedido recibido por el sistema.'
                        }
                    }
                },
                // El endpoint público solo necesita identidad/estado. Los
                // renglones y eventos se crean, pero no se vuelven a leer ni se
                // materializan en el DTO de salida.
                select: { id: true, estado: true },
            });

            return {
                pedidoId: pedido.id,
                estado: pedido.estado,
                granTotal,
                costoEntrega,
                confirmationItems,
            };
        });

        const trackingToken = signPedidoTrackingToken(
            pedidoCreated.pedidoId,
            tenantId,
        );
        const publicPedidoResponse = {
            pedidoId: pedidoCreated.pedidoId,
            estado: pedidoCreated.estado,
            total: pedidoCreated.granTotal.toNumber(),
            costoEntrega: pedidoCreated.costoEntrega.toNumber(),
            // Resumen autoritativo del servidor para confirmación y WhatsApp.
            items: pedidoCreated.confirmationItems,
            // El token queda en el fragmento: el navegador no lo incluye en la
            // petición HTML ni en Referer. TrackPedido lo envía al API por header.
            trackingPath: `/track/${pedidoCreated.pedidoId}#token=${encodeURIComponent(trackingToken)}`,
        };
        res.status(201).json(publicPedidoResponse);

    } catch (error) {
        if (error instanceof PublicOrderItemError) {
            return res.status(error.httpStatus).json({ error: error.message, code: error.code });
        }
        console.error('Create Pedido Error:', error);
        res.status(500).json({ error: 'Error al procesar el pedido.' });
    }
});

// GET /api/v1/pedidos -> (Privado) Listar pedidos del Dashboard
    router.get('/', authenticate, checkRole(PEDIDO_READ_ROLES), async (req: any, res: any) => {
        const authReq = req as AuthRequest;
        const parsedQuery = PedidoListQuerySchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return res.status(400).json({ error: 'Parámetros de listado inválidos.' });
        }

        try {
            const { page, limit } = parsedQuery.data;
            const skip = (page - 1) * limit;
            const pedidos = await prisma.pedido.findMany({
                where: { tenantId: authReq.tenantId },
                include: {
                    motorizado: { select: motorizadoSafeSelect },
                    items: {
                        include: {
                            producto: {
                                select: PEDIDO_PRODUCT_OPERATIONAL_SELECT,
                            }
                        }
                    }
                },
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                skip,
                take: limit + 1,
            });

            const hasMore = pedidos.length > limit;
            const pageItems = hasMore ? pedidos.slice(0, limit) : pedidos;

            res.json({
                pedidos: pageItems,
                pageInfo: {
                    page,
                    limit,
                    hasMore,
                    nextPage: hasMore ? page + 1 : null,
                },
            });
        } catch (error) {
            console.error('Get Pedidos Error:', error);
            res.status(500).json({ error: 'Error al listar los pedidos.' });
        }
    });

// GET /api/v1/pedidos/:id -> (Privado) Detalle de pedido
router.get('/:id', authenticate, checkRole(PEDIDO_READ_ROLES), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { id } = req.params;

    try {
        const includeProduct = isLimitedPedidoDetailRole(authReq.role)
            ? { select: PEDIDO_PRODUCT_OPERATIONAL_SELECT }
            : true;
        const pedido = await prisma.pedido.findFirst({
            where: { id, tenantId: authReq.tenantId },
            include: {
                motorizado: { select: motorizadoSafeSelect },
                items: {
                    include: {
                        producto: includeProduct
                    }
                },
                eventos: {
                    orderBy: { createdAt: 'desc' }
                }
            }
        });

        if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado u oculto para tu tenant.' });

        res.json({ pedido });
    } catch (error) {
        console.error('Get Pedido Detail Error:', error);
        res.status(500).json({ error: 'Error al obtener el pedido.' });
    }
});

// GET /api/v1/pedidos/:id/tracking -> tracking mediante capacidad firmada
router.get('/:id/tracking', async (req: any, res: any) => {
    const { id } = req.params;
    const token = req.get('x-pedido-tracking-token');
    res.set('Cache-Control', 'private, no-store, max-age=0');

    try {
        if (typeof token !== 'string' || !token) {
            return res.status(404).json({ error: 'Enlace de seguimiento inválido o vencido.' });
        }
        const capability = verifyPedidoTrackingToken(token, id);
        const pedido = await prisma.pedido.findFirst({
            where: { id, tenantId: capability.tenantId },
            select: PUBLIC_PEDIDO_TRACKING_SELECT,
        });

        if (!pedido) return res.status(404).json({ error: 'Enlace de seguimiento inválido o vencido.' });

        res.json({ tracking: toPublicPedidoTrackingDto(pedido) });
    } catch {
        // Firma inválida, token de otro pedido y expiración responden igual. No
        // revelamos si el UUID existe ni registramos la capacidad secreta.
        res.status(404).json({ error: 'Enlace de seguimiento inválido o vencido.' });
    }
});

// PATCH /api/v1/pedidos/:id/estado -> (Privado) Cambiar estado
router.patch('/:id/estado', authenticate, checkRole(PEDIDO_WRITE_ROLES), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { id } = req.params;
    const { estado, nota, lat, lng } = req.body;

    if (!isPedidoEstado(estado)) {
        return res.status(400).json({ error: `Estado inválido. Opciones: ${PEDIDO_ESTADOS_VALIDOS.join(', ')}` });
    }

    try {
        const numericLat = lat === undefined || lat === null ? null : Number(lat);
        const numericLng = lng === undefined || lng === null ? null : Number(lng);
        if ((numericLat !== null && !Number.isFinite(numericLat)) || (numericLng !== null && !Number.isFinite(numericLng))) {
            return res.status(400).json({ error: 'Coordenadas inválidas.' });
        }

        const response = await prisma.$transaction(async (tx) => {
            await lockPedidoForFulfillment(tx, {
                pedidoId: id,
                tenantId: authReq.tenantId!,
            });
            const pedido = await tx.pedido.findFirst({
                where: { id, tenantId: authReq.tenantId },
                select: { id: true, estado: true, facturaId: true, motorizadoId: true },
            });
            if (!pedido) {
                throw new PedidoFulfillmentError('PEDIDO_NOT_FOUND', 404, 'Pedido no encontrado.');
            }
            if (pedido.facturaId) {
                throw new PedidoFulfillmentError(
                    'PEDIDO_ALREADY_PROCESSED',
                    409,
                    'Un pedido entregado, facturado o cancelado no se puede reabrir.',
                );
            }
            const isCancellationReplay = pedido.estado === 'cancelado' && estado === 'cancelado';
            const isPreparationRetry = pedido.estado === 'preparando' && estado === 'preparando';
            if (
                !isCancellationReplay
                && !isPreparationRetry
                && PEDIDO_TERMINAL_STATES.includes(pedido.estado as PedidoEstado)
            ) {
                throw new PedidoFulfillmentError(
                    'PEDIDO_ALREADY_PROCESSED',
                    409,
                    'Un pedido entregado, facturado o cancelado no se puede reabrir.',
                );
            }
            if (
                !isCancellationReplay
                && !isPreparationRetry
                && !isPedidoTransitionAllowed(pedido.estado, estado)
            ) {
                throw new PedidoFulfillmentError(
                    'PEDIDO_INVALID_STATE_TRANSITION',
                    409,
                    `Transición de ${pedido.estado} a ${estado} no permitida.`,
                );
            }
            if (PEDIDO_ROUTE_STATES.has(estado) && !pedido.motorizadoId) {
                throw new PedidoRouteError(
                    'PEDIDO_RIDER_REQUIRED',
                    409,
                    'Asigná un motorizado antes de iniciar la ruta.',
                );
            }

            if (estado === 'entregado') {
                const result = await completePedidoDeliveryInTransaction(tx, {
                    pedidoId: id,
                    tenantId: authReq.tenantId,
                    actorUserId: authReq.userId,
                    source: 'DELIVERY_DASHBOARD',
                    nota: typeof nota === 'string' ? nota : null,
                    lat: numericLat,
                    lng: numericLng,
                });
                return { message: 'Estado actualizado a entregado', pedido: result.pedido };
            }

            if (estado === 'preparando') {
                const updated = await reservePedidoInTransaction(tx, {
                    pedidoId: id,
                    tenantId: authReq.tenantId!,
                    userId: authReq.userId!,
                    nota: typeof nota === 'string' ? nota : null,
                    lat: numericLat,
                    lng: numericLng,
                });
                return { message: 'Estado actualizado a preparando', pedido: updated };
            }

            if (estado === 'cancelado') {
                const result = await cancelPedidoInTransaction(tx, {
                    pedidoId: id,
                    tenantId: authReq.tenantId!,
                    userId: authReq.userId!,
                    nota: typeof nota === 'string' ? nota : null,
                    lat: numericLat,
                    lng: numericLng,
                });
                return {
                    message: 'Estado actualizado a cancelado',
                    pedido: result.pedido,
                    idempotentReplay: result.idempotentReplay,
                    releasedQuantity: result.releasedQuantity,
                };
            }

            const changed = await tx.pedido.updateMany({
                where: {
                    id,
                    tenantId: authReq.tenantId,
                    facturaId: null,
                    estado: pedido.estado,
                    ...(PEDIDO_ROUTE_STATES.has(estado) ? { motorizadoId: { not: null } } : {}),
                },
                data: { estado },
            });
            if (changed.count !== 1) {
                throw new PedidoFulfillmentError(
                    'PEDIDO_ALREADY_PROCESSED',
                    409,
                    'El pedido fue procesado por otra operación.',
                );
            }
            await tx.trackingEvento.create({
                data: {
                    pedidoId: id,
                    estado,
                    nota: typeof nota === 'string' ? nota : null,
                    lat: numericLat,
                    lng: numericLng,
                },
            });
            const updated = await tx.pedido.findFirstOrThrow({
                where: { id, tenantId: authReq.tenantId },
            });
            return { message: `Estado actualizado a ${estado}`, pedido: updated };
        });
        return res.json(response);
    } catch (error) {
        // Stock insuficiente / producto inexistente: la transacción abortó por el
        // decremento atómico. Devolvemos un estado claro en vez de un 500 genérico.
        if (error instanceof StockError) {
            const status = error.code === 'PRODUCT_NOT_FOUND' ? 404 : 422;
            return res.status(status).json({ error: error.message });
        }
        if (error instanceof PedidoFulfillmentError) {
            return res.status(error.httpStatus).json({ error: error.message, code: error.code });
        }
        if (error instanceof PedidoRouteError) {
            return res.status(error.httpStatus).json({ error: error.message, code: error.code });
        }
        console.error('Patch Estado Error:', error);
        res.status(500).json({ error: 'Error al actualizar el estado.' });
    }
});

// PATCH /api/v1/pedidos/:id/motorizado -> (Privado) Asignar motorizado
router.patch('/:id/motorizado', authenticate, checkRole(PEDIDO_WRITE_ROLES), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { id } = req.params;
    const parsedMotorizadoId = z.union([
        z.string().trim().min(1).max(191),
        z.null(),
    ]).safeParse(req.body?.motorizadoId);

    if (!parsedMotorizadoId.success) {
        return res.status(400).json({
            error: 'motorizadoId debe ser un identificador no vacío o null.',
            code: 'PEDIDO_INVALID_RIDER',
        });
    }
    const motorizadoId = parsedMotorizadoId.data;

    try {
        const updated = await prisma.$transaction(async (tx) => {
            await lockPedidoForFulfillment(tx, {
                pedidoId: id,
                tenantId: authReq.tenantId!,
            });
            const pedido = await tx.pedido.findFirst({
                where: { id, tenantId: authReq.tenantId },
                select: { id: true, estado: true, facturaId: true, motorizadoId: true },
            });
            if (!pedido) {
                throw new PedidoFulfillmentError('PEDIDO_NOT_FOUND', 404, 'Pedido no encontrado.');
            }
            if (pedido.facturaId || PEDIDO_TERMINAL_STATES.includes(pedido.estado as PedidoEstado)) {
                throw new PedidoFulfillmentError(
                    'PEDIDO_ALREADY_PROCESSED',
                    409,
                    'Un pedido entregado, facturado o cancelado no se puede reasignar.',
                );
            }

            if (motorizadoId) {
                // La autorización se verifica dentro de la misma transacción y
                // siempre contra el tenant autenticado.
                const motorizado = await tx.motorizado.findFirst({
                    where: {
                        id: motorizadoId,
                        activo: true,
                        OR: [
                            { tenantId: authReq.tenantId },
                            { tipoFlota: 'NORTEX', kycStatus: 'APROBADO' },
                        ],
                    },
                    select: { id: true },
                });
                if (!motorizado) {
                    throw new PedidoRouteError(
                        'PEDIDO_INVALID_RIDER',
                        400,
                        'Motorizado inválido, inactivo o no autorizado.',
                    );
                }
            }

            const changed = await tx.pedido.updateMany({
                where: {
                    id,
                    tenantId: authReq.tenantId,
                    facturaId: null,
                    motorizadoId: pedido.motorizadoId,
                    AND: [
                        { estado: pedido.estado },
                        { estado: { notIn: [...PEDIDO_TERMINAL_STATES] } },
                    ],
                },
                data: { motorizadoId },
            });
            if (changed.count !== 1) {
                throw new PedidoFulfillmentError(
                    'PEDIDO_ALREADY_PROCESSED',
                    409,
                    'El pedido fue procesado por otra operación.',
                );
            }

            if (pedido.motorizadoId !== motorizadoId) {
                await tx.trackingEvento.create({
                    data: {
                        pedidoId: id,
                        estado: pedido.estado,
                        nota: motorizadoId
                            ? 'Motorizado asignado.'
                            : 'Asignación de motorizado removida.',
                    },
                });
            }

            return tx.pedido.findFirstOrThrow({
                where: { id, tenantId: authReq.tenantId },
                include: { motorizado: { select: motorizadoSafeSelect } },
            });
        });

        res.json({ message: 'Motorizado asignado correctamente.', pedido: updated });
    } catch (error) {
        if (error instanceof PedidoFulfillmentError) {
            return res.status(error.httpStatus).json({ error: error.message, code: error.code });
        }
        if (error instanceof PedidoRouteError) {
            return res.status(error.httpStatus).json({ error: error.message, code: error.code });
        }
        console.error('Patch Motorizado Error:', error);
        res.status(500).json({ error: 'Error al asignar motorizado.' });
    }
});

    return router;
};

export default buildPedidosRouter();
