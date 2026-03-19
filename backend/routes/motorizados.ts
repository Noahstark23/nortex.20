import express from 'express';
// @ts-ignore
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthRequest } from '../middleware/auth';

const prisma = new PrismaClient();
const router = express.Router();

// GET /api/v1/motorizados
// Listar motorizados (propios del tenant + los globales de NORTEX si están activos)
router.get('/', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const motorizados = await prisma.motorizado.findMany({
            where: {
                OR: [
                    { tenantId: authReq.tenantId },
                    { tipoFlota: 'NORTEX' }
                ]
            },
            orderBy: {
                tipoFlota: 'asc' // NORTEX (freelance) primero o PROPIA primero
            }
        });
        res.json({ motorizados });
    } catch (error) {
        console.error('List Motorizados Error:', error);
        res.status(500).json({ error: 'Error al obtener los motorizados.' });
    }
});

// POST /api/v1/motorizados
// Registrar nuevo motorizado (por defecto es de la ferretería: PROPIA)
router.post('/', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { nombre, telefono, zonaCobertura } = req.body;

    if (!nombre || !telefono || !zonaCobertura) {
        return res.status(400).json({ error: 'Faltan datos requeridos.' });
    }

    try {
        const motorizado = await prisma.motorizado.create({
            data: {
                tenantId: authReq.tenantId,
                nombre,
                telefono,
                zonaCobertura,
                tipoFlota: 'PROPIA',
                activo: true
            }
        });
        res.status(201).json({ message: 'Motorizado registrado con éxito.', motorizado });
    } catch (error) {
        console.error('Create Motorizado Error:', error);
        res.status(500).json({ error: 'Error al registrar al motorizado.' });
    }
});

// PATCH /api/v1/motorizados/:id
// Actualizar información o activar/desactivar
router.patch('/:id', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { id } = req.params;
    const { activo, zonaCobertura } = req.body;

    try {
        // Solo un dueño de ferretería puede editar SU propia flota
        const existing = await prisma.motorizado.findFirst({
            where: { id, tenantId: authReq.tenantId }
        });

        if (!existing) {
            return res.status(404).json({ error: 'Motorizado no encontrado o no pertenece a tu flota.' });
        }

        const dataUpdate: any = {};
        if (typeof activo === 'boolean') dataUpdate.activo = activo;
        if (zonaCobertura) dataUpdate.zonaCobertura = zonaCobertura;

        const motorizado = await prisma.motorizado.update({
            where: { id },
            data: dataUpdate
        });

        res.json({ message: 'Motorizado actualizado.', motorizado });
    } catch (error) {
        console.error('Update Motorizado Error:', error);
        res.status(500).json({ error: 'Error al actualizar el motorizado.' });
    }
});

// GET /api/v1/motorizados/:id/liquidacion
// Liquidación Diaria Automática (Efectivo Neto a entregar en Caja Central)
router.get('/:id/liquidacion', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { id } = req.params;

    try {
        const motorizado = await prisma.motorizado.findFirst({
            where: { id, tenantId: authReq.tenantId }
        });

        if (!motorizado) {
            return res.status(404).json({ error: 'Motorizado no encontrado.' });
        }

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        // Fetch today's delivered orders for this driver
        const hoyPedidos = await prisma.pedido.findMany({
            where: {
                motorizadoId: id,
                tenantId: authReq.tenantId,
                estado: 'entregado',
                entregadoAt: { gte: todayStart }
            }
        });

        let totalCobradoEfectivo = 0;
        let totalComisiones = 0; // Comisión dinámica = costoEntrega (asuminos que el delivery fee es del driver)

        for (const p of hoyPedidos) {
            // Asumimos que todos cobrados al momento (CASH default for deliveries in this flow)
            totalCobradoEfectivo += Number(p.total);
            totalComisiones += Number(p.costoEntrega);
        }

        const netoADepositar = totalCobradoEfectivo - totalComisiones;

        res.json({
            motorizado: {
                nombre: motorizado.nombre,
                walletId: motorizado.walletId,
                calificacionPromedio: motorizado.calificacionPromedio
            },
            liquidacionDiaria: {
                pedidosEntregados: hoyPedidos.length,
                totalCobrado: totalCobradoEfectivo,
                comisionesGanadas: totalComisiones,
                netoADepositarA_Tienda: netoADepositar > 0 ? netoADepositar : 0
            }
        });
    } catch (error) {
        console.error('Liquidacion Error:', error);
        res.status(500).json({ error: 'Error al calcular liquidación.' });
    }
});

export default router;
