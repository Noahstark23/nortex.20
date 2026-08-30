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

const router = express.Router();

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
    try {
        const pedidos = await prisma.pedido.findMany({
            where: { tenantId: authReq.tenantId },
            include: {
                motorizado: true,
                items: {
                    include: {
                        producto: {
                            select: { name: true, sku: true, imageUrl: true }
                        }
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json({ pedidos });
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
        const pedido = await prisma.pedido.findFirst({
            where: { id, tenantId: authReq.tenantId },
            include: {
                motorizado: true,
                items: {
                    include: {
                        producto: true
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

    const estadosValidos = ['pendiente', 'asignado', 'preparando', 'en_tienda', 'en_ruta', 'en_camino', 'en_punto', 'entregado', 'cancelado'];

    if (!estadosValidos.includes(estado)) {
        return res.status(400).json({ error: `Estado inválido. Opciones: ${estadosValidos.join(', ')}` });
    }

    try {
        const numericLat = lat === undefined || lat === null ? null : Number(lat);
        const numericLng = lng === undefined || lng === null ? null : Number(lng);
        if ((numericLat !== null && !Number.isFinite(numericLat)) || (numericLng !== null && !Number.isFinite(numericLng))) {
            return res.status(400).json({ error: 'Coordenadas inválidas.' });
        }

        if (estado === 'entregado') {
            const result = await prisma.$transaction((tx) => completePedidoDeliveryInTransaction(tx, {
                pedidoId: id,
                tenantId: authReq.tenantId,
                actorUserId: authReq.userId,
                source: 'DELIVERY_DASHBOARD',
                nota: typeof nota === 'string' ? nota : null,
                lat: numericLat,
                lng: numericLng,
            }));
            return res.json({ message: 'Estado actualizado a entregado', pedido: result.pedido });
        }

        if (estado === 'preparando') {
            const updated = await prisma.$transaction((tx) => reservePedidoInTransaction(tx, {
                pedidoId: id,
                tenantId: authReq.tenantId!,
                userId: authReq.userId!,
                nota: typeof nota === 'string' ? nota : null,
                lat: numericLat,
                lng: numericLng,
            }));
            return res.json({ message: 'Estado actualizado a preparando', pedido: updated });
        }

        if (estado === 'cancelado') {
            const result = await prisma.$transaction((tx) => cancelPedidoInTransaction(tx, {
                pedidoId: id,
                tenantId: authReq.tenantId!,
                userId: authReq.userId!,
                nota: typeof nota === 'string' ? nota : null,
                lat: numericLat,
                lng: numericLng,
            }));
            return res.json({
                message: 'Estado actualizado a cancelado',
                pedido: result.pedido,
                idempotentReplay: result.idempotentReplay,
                releasedQuantity: result.releasedQuantity,
            });
        }

        const updated = await prisma.$transaction(async (tx) => {
            await lockPedidoForFulfillment(tx, {
                pedidoId: id,
                tenantId: authReq.tenantId!,
            });
            const pedido = await tx.pedido.findFirst({
                where: { id, tenantId: authReq.tenantId },
                select: { id: true, estado: true, facturaId: true },
            });
            if (!pedido) {
                throw new PedidoFulfillmentError('PEDIDO_NOT_FOUND', 404, 'Pedido no encontrado.');
            }
            if (pedido.facturaId || pedido.estado === 'entregado' || pedido.estado === 'cancelado') {
                throw new PedidoFulfillmentError(
                    'PEDIDO_ALREADY_PROCESSED',
                    409,
                    'Un pedido entregado, facturado o cancelado no se puede reabrir.',
                );
            }
            const changed = await tx.pedido.updateMany({
                where: {
                    id,
                    tenantId: authReq.tenantId,
                    facturaId: null,
                    estado: { notIn: ['entregado', 'cancelado'] },
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
            return tx.pedido.findFirstOrThrow({
                where: { id, tenantId: authReq.tenantId },
            });
        });
        return res.json({ message: `Estado actualizado a ${estado}`, pedido: updated });
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
        console.error('Patch Estado Error:', error);
        res.status(500).json({ error: 'Error al actualizar el estado.' });
    }
});

// PATCH /api/v1/pedidos/:id/motorizado -> (Privado) Asignar motorizado
router.patch('/:id/motorizado', authenticate, checkRole(PEDIDO_WRITE_ROLES), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { id } = req.params;
    const { motorizadoId } = req.body;

    try {
        const pedido = await prisma.pedido.findFirst({
            where: { id, tenantId: authReq.tenantId }
        });

        if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado.' });

        if (motorizadoId) {
            // Verificar que el motorizado es del tenant o es un freelancer global
            // activo CON KYC aprobado (Red NORTEX: nadie reparte sin revisión).
            const mot = await prisma.motorizado.findFirst({
                where: {
                    id: motorizadoId,
                    activo: true,
                    OR: [
                        { tenantId: authReq.tenantId },
                        { tipoFlota: 'NORTEX', kycStatus: 'APROBADO' }
                    ]
                }
            });
            if (!mot) return res.status(400).json({ error: 'Motorizado inválido, inactivo o no autorizado.' });
        }

        const updated = await prisma.pedido.update({
            where: { id },
            data: { motorizadoId }
        });

        // Registrar evento de asignación si es nuevo motorizado
        if (motorizadoId && pedido.motorizadoId !== motorizadoId) {
            await prisma.trackingEvento.create({
                data: {
                    pedidoId: id,
                    estado: pedido.estado,
                    nota: `Motorizado asignado.`
                }
            });
        }

        res.json({ message: 'Motorizado asignado correctamente.', pedido: updated });
    } catch (error) {
        console.error('Patch Motorizado Error:', error);
        res.status(500).json({ error: 'Error al asignar motorizado.' });
    }
});

export default router;
