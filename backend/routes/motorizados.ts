import express from 'express';
// @ts-ignore
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import Decimal from 'decimal.js';
import { authenticate, AuthRequest } from '../middleware/auth';
import { checkRole } from '../middleware/checkRole';
import prisma from '../lib/prisma.js';
import {
    hasPhoneCredentialConflict,
    motorizadoSafeSelect,
    normalizeMotorizadoPhone,
} from '../services/motorizadoIdentity.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

// Solo dueños/administradores gestionan la flota propia y resetean el PIN de
// login del repartidor (evita que un cajero se auto-provisione credenciales de Driver App).
const ROLES_FLOTA = ['OWNER', 'ADMIN'];

const PhoneSchema = z
    .string('El teléfono es obligatorio.')
    .trim()
    .min(1, 'El teléfono es obligatorio.')
    .max(32, 'El teléfono es demasiado largo.')
    .regex(/^[+\d\s().-]+$/u, 'El teléfono contiene caracteres no permitidos.')
    .transform(normalizeMotorizadoPhone)
    .refine((value) => /^\d{8,15}$/u.test(value), {
        message: 'El teléfono debe contener entre 8 y 15 dígitos.',
    });

const PlateSchema = z
    .string('La placa debe ser texto.')
    .trim()
    .min(1, 'La placa no puede quedar vacía.')
    .max(20, 'La placa no puede superar 20 caracteres.')
    .transform((value) => value.toUpperCase());

const PinSchema = z
    .string('El PIN debe ser texto para conservar ceros iniciales.')
    .regex(/^\d{4,6}$/u, 'El PIN debe ser de 4 a 6 dígitos.');

export const FleetRiderCreateSchema = z.object({
    nombre: z
        .string('El nombre es obligatorio.')
        .trim()
        .min(3, 'El nombre debe tener al menos 3 caracteres.')
        .max(100, 'El nombre no puede superar 100 caracteres.'),
    telefono: PhoneSchema,
    zonaCobertura: z
        .string('La zona de cobertura es obligatoria.')
        .trim()
        .min(2, 'La zona de cobertura debe tener al menos 2 caracteres.')
        .max(100, 'La zona de cobertura no puede superar 100 caracteres.'),
    vehiculoPlaca: PlateSchema.optional(),
    pin: PinSchema,
    // Compatibilidad con clientes PWA anteriores. Solo se acepta el literal
    // seguro y el servidor sigue imponiendo PROPIA; jamás toma el tipo del body.
    tipoFlota: z.literal('PROPIA', 'La flota propia es el único tipo permitido.').optional(),
}).strict();

export const FleetRiderPatchSchema = z.object({
    activo: z.boolean('El estado activo debe ser verdadero o falso.').optional(),
    zonaCobertura: z
        .string('La zona de cobertura debe ser texto.')
        .trim()
        .min(2, 'La zona de cobertura debe tener al menos 2 caracteres.')
        .max(100, 'La zona de cobertura no puede superar 100 caracteres.')
        .optional(),
    // null elimina una placa o PIN; undefined conserva el valor actual.
    vehiculoPlaca: z.union([PlateSchema, z.null()]).optional(),
    pin: z.union([PinSchema, z.null()]).optional(),
}).strict().refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    { message: 'Debés enviar al menos un campo para actualizar.' },
);

const motorizadoOperationalSelect = motorizadoSafeSelect;

const validationErrorMessage = (error: z.ZodError): string => {
    if (error.issues.some((issue) => issue.code === 'unrecognized_keys')) {
        return 'La solicitud contiene campos no permitidos.';
    }
    return [...new Set(error.issues.map((issue) => issue.message))].join(' | ');
};

const requireTenantId = (authReq: AuthRequest, res: any): string | null => {
    if (authReq.tenantId) return authReq.tenantId;
    res.status(401).json({ error: 'No se pudo identificar el negocio de la sesión.' });
    return null;
};

export const buildMotorizadosRouter = () => {
    const router = express.Router();

    // GET /api/v1/motorizados
    // Listar motorizados (propios del tenant + los globales de NORTEX si están activos)
    router.get('/', authenticate, async (req: any, res: any) => {
        const authReq = req as AuthRequest;
        const tenantId = requireTenantId(authReq, res);
        if (!tenantId) return;
        try {
            const motorizados = await prisma.motorizado.findMany({
                where: {
                    OR: [
                        { tenantId },
                        // Red NORTEX: solo repartidores con KYC aprobado y activos —
                        // nadie sin revisión aparece como asignable a los negocios.
                        { tipoFlota: 'NORTEX', kycStatus: 'APROBADO', activo: true }
                    ]
                },
                orderBy: {
                    tipoFlota: 'asc' // NORTEX (freelance) primero o PROPIA primero
                },
                take: 250,
                select: motorizadoOperationalSelect,
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
        const tenantId = requireTenantId(authReq, res);
        if (!tenantId) return;

        const parsed = FleetRiderCreateSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: validationErrorMessage(parsed.error) });
        }

        const data = parsed.data;

        try {
            const duplicate = await prisma.motorizado.findFirst({
                where: {
                    tenantId,
                    tipoFlota: 'PROPIA',
                    telefono: data.telefono,
                },
                select: { id: true },
            });
            if (duplicate) {
                return res.status(409).json({
                    error: 'Ya existe un motorizado con ese teléfono en tu flota.',
                });
            }

            // El teléfono es identidad de login global. No crear una segunda
            // credencial aunque pertenezca a otro tenant o tenga un PIN distinto.
            const conflictingDrivers = await prisma.motorizado.findMany({
                where: { telefono: data.telefono, pinHash: { not: null } },
                select: { id: true, pinHash: true },
                take: 2,
            });
            if (hasPhoneCredentialConflict(conflictingDrivers)) {
                return res.status(409).json({
                    error: 'Ya existe un repartidor con ese teléfono y PIN. Usá otro número o restablecé el acceso del actual.',
                });
            }
            const pinHash = await bcrypt.hash(data.pin, 10);

            const motorizado = await prisma.motorizado.create({
                data: {
                    tenantId,
                    nombre: data.nombre,
                    telefono: data.telefono,
                    zonaCobertura: data.zonaCobertura,
                    vehiculoPlaca: data.vehiculoPlaca ?? null,
                    tipoFlota: 'PROPIA',
                    activo: true,
                    pinHash,
                    // Flota propia: la confianza la pone el dueño que lo contrata —
                    // no pasa por el KYC de la Red NORTEX.
                    kycStatus: 'APROBADO',
                },
                select: motorizadoOperationalSelect,
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
        const tenantId = requireTenantId(authReq, res);
        if (!tenantId) return;

        const parsed = FleetRiderPatchSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: validationErrorMessage(parsed.error) });
        }

        try {
            // Solo un dueño de ferretería puede editar SU propia flota.
            const existing = await prisma.motorizado.findFirst({
                where: { id, tenantId, tipoFlota: 'PROPIA' },
                select: { id: true, telefono: true },
            });

            if (!existing) {
                return res.status(404).json({ error: 'Motorizado no encontrado o no pertenece a tu flota.' });
            }

            const dataUpdate: {
                activo?: boolean;
                zonaCobertura?: string;
                vehiculoPlaca?: string | null;
                pinHash?: string | null;
            } = {};
            if (parsed.data.activo !== undefined) dataUpdate.activo = parsed.data.activo;
            if (parsed.data.zonaCobertura !== undefined) dataUpdate.zonaCobertura = parsed.data.zonaCobertura;
            if (parsed.data.vehiculoPlaca !== undefined) dataUpdate.vehiculoPlaca = parsed.data.vehiculoPlaca;
            // null revoca el acceso; un PIN válido lo asigna o lo resetea.
            if (parsed.data.pin !== undefined) {
                if (parsed.data.pin !== null) {
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
                }
                dataUpdate.pinHash = parsed.data.pin === null
                    ? null
                    : await bcrypt.hash(parsed.data.pin, 10);
            }

            // La escritura vuelve a incluir tenant+tipo para cerrar la carrera
            // entre la comprobación de propiedad y la actualización.
            await prisma.motorizado.updateMany({
                where: { id, tenantId, tipoFlota: 'PROPIA' },
                data: dataUpdate,
            });

            const motorizado = await prisma.motorizado.findFirst({
                where: { id, tenantId, tipoFlota: 'PROPIA' },
                select: motorizadoOperationalSelect,
            });
            if (!motorizado) {
                return res.status(404).json({ error: 'Motorizado no encontrado o no pertenece a tu flota.' });
            }

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
        const tenantId = requireTenantId(authReq, res);
        if (!tenantId) return;

        try {
            const motorizado = await prisma.motorizado.findFirst({
                where: { id, tenantId },
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
                    tenantId,
                    estado: 'entregado',
                    entregadoAt: { gte: todayStart },
                },
            });

            let totalCobradoEfectivo = new Decimal(0);
            // Comisión dinámica = costoEntrega (asuminos que el delivery fee es del driver)
            let totalComisiones = new Decimal(0);

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
                    calificacionPromedio: motorizado.calificacionPromedio,
                },
                liquidacionDiaria: {
                    pedidosEntregados: hoyPedidos.length,
                    totalCobrado: totalCobradoEfectivo.toDecimalPlaces(2).toNumber(),
                    comisionesGanadas: totalComisiones.toDecimalPlaces(2).toNumber(),
                    netoADepositarA_Tienda: (
                        netoADepositar.gt(0) ? netoADepositar : new Decimal(0)
                    ).toDecimalPlaces(2).toNumber(),
                },
            });
        } catch (error) {
            console.error('Liquidacion Error:', error);
            res.status(500).json({ error: 'Error al calcular liquidación.' });
        }
    });

    return router;
};

export default buildMotorizadosRouter();
