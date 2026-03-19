import express from 'express';
// @ts-ignore
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthRequest } from '../middleware/auth';
import { recordSale } from '../services/accounting';

const prisma = new PrismaClient();
const router = express.Router();

/**
 * ==========================================
 * 🛵 MÓDULO DE ENTREGAS A DOMICILIO
 * ==========================================
 */

// POST /api/v1/pedidos -> (Público) Crear pedido desde el catálogo
router.post('/', async (req: any, res: any) => {
    const {
        tenantId,
        clienteNombre,
        clienteTelefono,
        direccionEntrega,
        referenciaDireccion,
        notas,
        items // Array: [{ productoId, cantidad }]
    } = req.body;

    try {
        if (!tenantId || !clienteNombre || !clienteTelefono || !direccionEntrega || !items || !items.length) {
            return res.status(400).json({ error: 'Faltan datos requeridos para crear el pedido.' });
        }

        // Obtener los productos actuales en la BD para este tenant
        const productIds = items.map((i: any) => i.productoId);
        const productsDB = await prisma.product.findMany({
            where: {
                tenantId: tenantId,
                id: { in: productIds }
            }
        });

        if (productsDB.length !== items.length) {
            return res.status(400).json({ error: 'Algunos productos no fueron encontrados o no pertenecen al negocio.' });
        }

        let totalSuma = 0;
        const pedidoItemsData = items.map((item: any) => {
            const prod = productsDB.find((p: any) => p.id === item.productoId);
            const precioUnitario = Number(prod.price);
            const subtotal = precioUnitario * item.cantidad;
            totalSuma += subtotal;

            return {
                productoId: prod.id,
                cantidad: item.cantidad,
                precioUnitario: precioUnitario,
                subtotal: subtotal
            };
        });

        // NOTA: Configurar costo de entrega predeterminado o leerlo de la config/request. (Asignamos 0 por default)
        const costoEntrega = req.body.costoEntrega ? Number(req.body.costoEntrega) : 0;
        const granTotal = totalSuma + costoEntrega;

        // $transaction para atomicidad total
        const pedidoCreated = await prisma.$transaction(async (tx: any) => {
            const pedido = await tx.pedido.create({
                data: {
                    tenantId,
                    clienteNombre,
                    clienteTelefono,
                    direccionEntrega,
                    referenciaDireccion,
                    notas,
                    estado: 'pendiente',
                    costoEntrega,
                    total: granTotal,
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
