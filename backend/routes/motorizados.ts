import express from 'express';
// @ts-ignore
import { PrismaClient } from '@prisma/client';
// @ts-ignore
import bcrypt from 'bcryptjs';
import Decimal from 'decimal.js';
import { authenticate, AuthRequest } from '../middleware/auth';
import { checkRole } from '../middleware/checkRole';
import {
    hasPhoneCredentialConflict,
    motorizadoSafeSelect,
    normalizeMotorizadoPhone,
} from '../services/motorizadoIdentity';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

const prisma = new PrismaClient();
const router = express.Router();

// Solo dueños/administradores gestionan la flota propia y resetean el PIN de
// login del repartidor (evita que un cajero se auto-provisione credenciales de Driver App).
const ROLES_FLOTA = ['OWNER', 'ADMIN'];

// GET /api/v1/motorizados
// Listar motorizados (propios del tenant + los globales de NORTEX si están activos)
router.get('/', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const motorizados = await prisma.motorizado.findMany({
            where: {
                OR: [
                    { tenantId: authReq.tenantId },
                    // Red NORTEX: solo repartidores con KYC aprobado y activos —
                    // nadie sin revisión aparece como asignable a los negocios.
                    { tipoFlota: 'NORTEX', kycStatus: 'APROBADO', activo: true }
                ]
            },
            select: motorizadoSafeSelect,
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
router.post('/', authenticate, checkRole(ROLES_FLOTA), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { nombre, telefono, zonaCobertura, pin, vehiculoPlaca } = req.body;
    const normalizedName = String(nombre ?? '').trim();
    const normalizedPhone = normalizeMotorizadoPhone(String(telefono ?? ''));
    const normalizedZone = String(zonaCobertura ?? '').trim();
    const normalizedVehicle = vehiculoPlaca == null ? null : String(vehiculoPlaca).trim();

    if (!normalizedName || !normalizedPhone || !normalizedZone) {
        return res.status(400).json({ error: 'Faltan datos requeridos.' });
    }
    if (normalizedName.length < 3 || normalizedName.length > 100) {
        return res.status(400).json({ error: 'El nombre debe tener de 3 a 100 caracteres.' });
    }
    if (normalizedPhone.length < 8 || normalizedPhone.length > 15) {
        return res.status(400).json({ error: 'Teléfono inválido. Usa de 8 a 15 dígitos.' });
    }
    if (normalizedZone.length < 2 || normalizedZone.length > 100) {
        return res.status(400).json({ error: 'La zona de cobertura debe tener de 2 a 100 caracteres.' });
    }
    if (normalizedVehicle && normalizedVehicle.length > 20) {
        return res.status(400).json({ error: 'La placa o descripción del vehículo no puede superar 20 caracteres.' });
    }
    if (pin !== undefined && !/^\d{4,6}$/.test(String(pin))) {
        return res.status(400).json({ error: 'El PIN debe ser de 4 a 6 dígitos.' });
    }

    try {
        if (pin !== undefined) {
            const conflictingDrivers = await prisma.motorizado.findMany({
                where: { telefono: normalizedPhone, pinHash: { not: null } },
                select: { id: true, pinHash: true },
                take: 2,
            });
            if (hasPhoneCredentialConflict(conflictingDrivers)) {
                return res.status(409).json({
                    error: 'Ya existe un repartidor con ese teléfono y PIN. Usá otro número o restablecé el acceso del actual.',
                });
            }
        }

        // PIN opcional al crear flota propia: necesario para que el repartidor
        // entre a su app con teléfono+PIN (el magic-link ya no existe).
        const pinHash = pin !== undefined ? await bcrypt.hash(String(pin), 10) : null;

        const motorizado = await prisma.motorizado.create({
            data: {
                tenantId: authReq.tenantId,
                nombre: normalizedName,
                telefono: normalizedPhone,
                zonaCobertura: normalizedZone,
                vehiculoPlaca: normalizedVehicle || null,
                tipoFlota: 'PROPIA',
                activo: true,
                pinHash,
                // Flota propia: la confianza la pone el dueño que lo contrata —
                // no pasa por el KYC de la Red NORTEX.
                kycStatus: 'APROBADO'
            },
            select: motorizadoSafeSelect,
        });
        res.status(201).json({ message: 'Motorizado registrado con éxito.', motorizado });
    } catch (error) {
        console.error('Create Motorizado Error:', error);
        res.status(500).json({ error: 'Error al registrar al motorizado.' });
    }
});

// PATCH /api/v1/motorizados/:id
// Actualizar información o activar/desactivar
router.patch('/:id', authenticate, checkRole(ROLES_FLOTA), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { id } = req.params;
    const { activo, zonaCobertura, pin } = req.body;

    try {
        // Solo un dueño de ferretería puede editar SU propia flota
        const existing = await prisma.motorizado.findFirst({
            where: { id, tenantId: authReq.tenantId },
            select: { id: true, telefono: true },
        });

        if (!existing) {
            return res.status(404).json({ error: 'Motorizado no encontrado o no pertenece a tu flota.' });
        }

        const dataUpdate: any = {};
        if (typeof activo === 'boolean') dataUpdate.activo = activo;
        if (zonaCobertura) dataUpdate.zonaCobertura = zonaCobertura;
        // Asignar / resetear el PIN de login del repartidor propio
        if (pin !== undefined) {
            if (!/^\d{4,6}$/.test(String(pin))) {
                return res.status(400).json({ error: 'El PIN debe ser de 4 a 6 dígitos.' });
            }
            const conflictingDrivers = await prisma.motorizado.findMany({
                where: {
                    telefono: existing.telefono,
                    pinHash: { not: null },
                    NOT: { id: existing.id },
                },
                select: { id: true, pinHash: true },
                take: 2,
            });
            if (hasPhoneCredentialConflict(conflictingDrivers, existing.id)) {
                return res.status(409).json({
                    error: 'Ese teléfono ya está vinculado a otro acceso de repartidor. Cambiá el número o restablecé la cuenta existente.',
                });
            }
            dataUpdate.pinHash = await bcrypt.hash(String(pin), 10);
        }

        const motorizado = await prisma.motorizado.update({
            where: { id },
            data: dataUpdate,
            select: motorizadoSafeSelect,
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

        let totalCobradoEfectivo = new Decimal(0);
        let totalComisiones = new Decimal(0); // Comisión dinámica = costoEntrega (asuminos que el delivery fee es del driver)

        for (const p of hoyPedidos) {
            // Asumimos que todos cobrados al momento (CASH default for deliveries in this flow)
            totalCobradoEfectivo = totalCobradoEfectivo.plus(new Decimal(p.total.toString()));
            totalComisiones = totalComisiones.plus(new Decimal(p.costoEntrega.toString()));
        }

        const netoADepositar = totalCobradoEfectivo.minus(totalComisiones);

        res.json({
            motorizado: {
                nombre: motorizado.nombre,
                walletId: motorizado.walletId,
                calificacionPromedio: motorizado.calificacionPromedio
            },
            liquidacionDiaria: {
                pedidosEntregados: hoyPedidos.length,
                totalCobrado: totalCobradoEfectivo.toDecimalPlaces(2).toNumber(),
                comisionesGanadas: totalComisiones.toDecimalPlaces(2).toNumber(),
                netoADepositarA_Tienda: (netoADepositar.gt(0) ? netoADepositar : new Decimal(0)).toDecimalPlaces(2).toNumber()
            }
        });
    } catch (error) {
        console.error('Liquidacion Error:', error);
        res.status(500).json({ error: 'Error al calcular liquidación.' });
    }
});

export default router;
