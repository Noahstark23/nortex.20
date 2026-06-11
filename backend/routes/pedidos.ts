import express from 'express';
// @ts-ignore
import { PrismaClient } from '@prisma/client';
// @ts-ignore
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import Decimal from 'decimal.js';
import { authenticate, AuthRequest } from '../middleware/auth';
import { recordSale } from '../services/accounting';

const prisma = new PrismaClient();
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
                cantidad: z.number().int().positive().max(999),
            })
        )
        .min(1, 'Se requiere al menos 1 producto')
        .max(50),
});

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
        const productIds = items.map(i => i.productoId);
        const productsDB = await prisma.product.findMany({
            where: { tenantId, id: { in: productIds }, isPublished: true },
        });

        if (productsDB.length !== items.length) {
            return res.status(400).json({ error: 'Algunos productos no fueron encontrados o no están disponibles.' });
        }

        // Totales en Decimal.js (cero aritmética float con dinero)
        let totalSuma = new Decimal(0);
        const pedidoItemsData = items.map(item => {
            const prod = productsDB.find(p => p.id === item.productoId)!;
            const precioUnitario = new Decimal(prod.price.toString());
            const subtotal = precioUnitario.mul(item.cantidad);
            totalSuma = totalSuma.plus(subtotal);

            return {
                productoId: prod.id,
                cantidad: item.cantidad,
                precioUnitario: precioUnitario.toDecimalPlaces(2).toNumber(),
                subtotal: subtotal.toDecimalPlaces(2).toNumber(),
            };
        });

        // Flete: SERVER-SIDE desde la config del negocio (jamás del body)
        const costoEntrega = new Decimal(tenant.deliveryFee.toString());
        const granTotal = totalSuma.plus(costoEntrega).toDecimalPlaces(2);

        // $transaction para atomicidad total
        const pedidoCreated = await prisma.$transaction(async (tx: any) => {
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
                        create: pedidoItemsData
                    },
                    eventos: {
                        create: {
                            estado: 'pendiente',
                            nota: 'Pedido recibido por el sistema.'
                        }
                    }
                },
                include: {
                    items: true,
                    eventos: true
                }
            });

            return pedido;
        });

        res.status(201).json({
            message: 'Pedido creado exitosamente',
            pedidoId: pedidoCreated.id,
            estado: pedidoCreated.estado,
            total: granTotal.toNumber(),
            costoEntrega: costoEntrega.toNumber(),
            trackingPath: `/track/${pedidoCreated.id}`,
            pedido: pedidoCreated
        });

    } catch (error) {
        console.error('Create Pedido Error:', error);
        res.status(500).json({ error: 'Error al procesar el pedido.' });
    }
});

// GET /api/v1/pedidos -> (Privado) Listar pedidos del Dashboard
router.get('/', authenticate, async (req: any, res: any) => {
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
router.get('/:id', authenticate, async (req: any, res: any) => {
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

// GET /api/v1/pedidos/:id/tracking -> (Público) Ver tracking del pedido
router.get('/:id/tracking', async (req: any, res: any) => {
    const { id } = req.params;

    try {
        const pedido = await prisma.pedido.findUnique({
            where: { id },
            select: {
                id: true,
                estado: true,
                createdAt: true,
                eventos: {
                    orderBy: { createdAt: 'desc' }
                },
                clienteNombre: true,
                motorizado: {
                    select: { nombre: true, telefono: true }
                }
            }
        });

        if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado.' });

        res.json({ tracking: pedido });
    } catch (error) {
        console.error('Tracking Error:', error);
        res.status(500).json({ error: 'Error al cargar el tracking.' });
    }
});

// PATCH /api/v1/pedidos/:id/estado -> (Privado) Cambiar estado
router.patch('/:id/estado', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { id } = req.params;
    const { estado, nota, lat, lng } = req.body;

    const estadosValidos = ['pendiente', 'asignado', 'preparando', 'en_tienda', 'en_ruta', 'en_camino', 'en_punto', 'entregado', 'cancelado'];

    if (!estadosValidos.includes(estado)) {
        return res.status(400).json({ error: `Estado inválido. Opciones: ${estadosValidos.join(', ')}` });
    }

    try {
        const pedido = await prisma.pedido.findFirst({
            where: { id, tenantId: authReq.tenantId },
            include: { items: true } // Necesitamos los items para facturar
        });

        if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado.' });

        const entregadoAt = estado === 'entregado' ? new Date() : pedido.entregadoAt;

        const updated = await prisma.$transaction(async (tx) => {
            const p = await tx.pedido.update({
                where: { id },
                data: {
                    estado,
                    entregadoAt
                }
            });

            await tx.trackingEvento.create({
                data: {
                    pedidoId: id,
                    estado,
                    nota,
                    lat: lat ? Number(lat) : null,
                    lng: lng ? Number(lng) : null
                }
            });

            // FASE: Reserva Exclusiva de Kardex (Inventario)
            if (estado === 'preparando') {
                const existingReservas = await tx.kardexMovement.count({
                    where: { referenceId: id, referenceType: 'PEDIDO_RESERVA' }
                });

                if (existingReservas === 0) {
                    for (const item of pedido.items) {
                        const prod = await tx.product.findUnique({ where: { id: item.productoId } });
                        if (prod) {
                            const stockBefore = Number(prod.stock);
                            const stockAfter = stockBefore - item.cantidad;

                            // 1. Decrementar físicamente para que no se venda en mostrador
                            await tx.product.update({
                                where: { id: item.productoId },
                                data: { stock: stockAfter }
                            });

                            // 2. Registrar en Kardex
                            await tx.kardexMovement.create({
                                data: {
                                    tenantId: authReq.tenantId,
                                    productId: item.productoId,
                                    type: 'OUT',
                                    quantity: -item.cantidad,
                                    stockBefore,
                                    stockAfter,
                                    referenceId: id,
                                    referenceType: 'PEDIDO_RESERVA',
                                    reason: `Reserva para envío. Pedido: ${id}`,
                                    userId: authReq.userId
                                }
                            });
                        }
                    }
                }
            }

            // FASE: Auditoría de Geolocalización (Proximity Alert)
            if (estado === 'entregado' && lat && lng) {
                // Generamos una Alerta de Auditoría simulando un cálculo de distancia
                // ya que no almacenamos lat/lng del cliente originalmente, 
                // pero alertaremos al dueño del negocio para revisión si el delivery "lo cerró desde la calle"
                await tx.auditLog.create({
                    data: {
                        tenantId: authReq.tenantId,
                        userId: authReq.userId,
                        action: 'GPS_AUDIT_ALERT',
                        details: JSON.stringify({
                            mensaje: 'Pedido entregado. Coordenadas GPS han sido registradas para verificación cruzada.',
                            lat: Number(lat),
                            lng: Number(lng),
                            pedidoId: id
                        })
                    }
                });
            }

            // FASE 2: Integración de Facturación
            // Si el estado pasa a "entregado" y no tiene factura asociada, procedemos a facturar.
            if (estado === 'entregado' && !pedido.facturaId) {
                // 1. Calcular costos para contabilidad
                let costTotal = 0;
                const saleItemsData = [];

                for (const item of pedido.items) {
                    const prod = await tx.product.findUnique({ where: { id: item.productoId } });
                    if (prod) {
                        const unitCost = Number(prod.cost || 0);
                        costTotal += (unitCost * item.cantidad);

                        saleItemsData.push({
                            productId: item.productoId,
                            quantity: item.cantidad,
                            priceAtSale: item.precioUnitario,
                            costAtSale: unitCost,
                            discount: 0
                        });

                        // Opcional: Descontar stock (Kardex)
                        // await tx.product.update({
                        //     where: { id: item.productoId },
                        //     data: { stock: { decrement: item.cantidad } }
                        // });
                    }
                }

                // 2. Crear la Factura (Sale)
                const sale = await tx.sale.create({
                    data: {
                        tenantId: authReq.tenantId,
                        total: pedido.total,
                        status: 'COMPLETED',
                        paymentMethod: 'CASH', // Asumiendo pago contra entrega
                        customerName: pedido.clienteNombre,
                        items: {
                            create: saleItemsData
                        }
                    }
                });

                // 3. Crear pago asociado
                await tx.payment.create({
                    data: {
                        saleId: sale.id,
                        amount: pedido.total,
                        method: 'CASH',
                        collectedBy: authReq.userId // El usuario que marca como entregado
                    }
                });

                // 4. Registrar en contabilidad mediante el motor (recordSale)
                await recordSale(tx, authReq.tenantId, authReq.userId, sale.id, Number(pedido.total), costTotal, 'CASH');

                // 5. Vincular la factura al pedido
                await tx.pedido.update({
                    where: { id },
                    data: { facturaId: sale.id }
                });
            }

            return p;
        });

        res.json({ message: `Estado actualizado a ${estado}`, pedido: updated });
    } catch (error) {
        console.error('Patch Estado Error:', error);
        res.status(500).json({ error: 'Error al actualizar el estado.' });
    }
});

// PATCH /api/v1/pedidos/:id/motorizado -> (Privado) Asignar motorizado
router.patch('/:id/motorizado', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { id } = req.params;
    const { motorizadoId } = req.body;

    try {
        const pedido = await prisma.pedido.findFirst({
            where: { id, tenantId: authReq.tenantId }
        });

        if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado.' });

        if (motorizadoId) {
            // Verificar que el motorizado es del tenant o es un freelancer global activo
            const mot = await prisma.motorizado.findFirst({
                where: {
                    id: motorizadoId,
                    activo: true,
                    OR: [
                        { tenantId: authReq.tenantId },
                        { tipoFlota: 'NORTEX' }
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
