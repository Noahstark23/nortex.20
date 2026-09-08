/**
 * NORTEX — Red de Motorizados (FASE 2)
 *
 * - POST /api/driver/registro  (público): inscripción a la flota NORTEX global.
 *   Nace con kycStatus=PENDIENTE y activo=false → un SUPER_ADMIN revisa el
 *   KYC (cédula + moto) y aprueba desde el panel. Nadie reparte sin revisión.
 * - POST /api/driver/login     (público): teléfono + PIN → token de driver.
 *   Reemplaza el magic-link /driver/:id (cualquiera con el link entraba).
 * - GET  /api/driver/me, /me/orders, PATCH /me/orders/:orderId/deliver:
 *   sesión del repartidor vía Bearer token — el driverId sale del TOKEN,
 *   nunca de la URL → sin IDOR.
 *
 * La identidad del driver queda lista para FASE 3 (wallet del Real Money
 * Protocol): plata real exige login real.
 */

import express from 'express';
// @ts-ignore
import bcrypt from 'bcryptjs';
// @ts-ignore
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import Decimal from 'decimal.js';
import { signDriverToken, verifyDriverToken } from '../services/secrets';
import { appendDriverWalletMovement } from '../services/ledger';
import prisma from '../lib/prisma.js';
import { StockError } from '../services/stockService.js';
import {
    completePedidoDeliveryInTransaction,
    PedidoFulfillmentError,
} from '../services/pedidoFulfillmentService.js';
import {
    hasPhoneCredentialConflict,
    normalizeMotorizadoPhone,
    resolveUniqueDriverLogin,
} from '../services/motorizadoIdentity.js';

const router = express.Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

const registroLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: 'Demasiados registros desde esta conexión. Intenta más tarde.' },
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Demasiados intentos. Espera unos minutos.' },
});

// ── Middleware: sesión de motorizado (Bearer driver-token) ──────────────────

export const authenticateDriver = async (req: any, res: any, next: any) => {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
        return res.status(401).json({ error: 'Sesión requerida. Inicia sesión con tu teléfono y PIN.' });
    }
    try {
        const { driverId } = verifyDriverToken(token);
        const driver = await prisma.motorizado.findUnique({ where: { id: driverId } });
        if (!driver || !driver.activo) {
            return res.status(403).json({ error: 'Tu cuenta está inactiva. Contacta a Nortex.' });
        }
        req.driver = driver;
        next();
    } catch {
        return res.status(401).json({ error: 'Sesión inválida o expirada. Vuelve a iniciar sesión.' });
    }
};

// ── POST /api/driver/registro — inscripción pública (Red NORTEX) ────────────

const RegistroSchema = z.object({
    nombre: z.string().trim().min(3, 'Nombre completo requerido').max(100),
    telefono: z.string().trim().min(8, 'Teléfono requerido').max(20),
    cedula: z.string().trim().min(5, 'Cédula requerida').max(25),
    zonaCobertura: z.string().trim().min(2, 'Zona de cobertura requerida').max(100),
    vehiculoPlaca: z.string().trim().max(20).optional(),
    pin: z.string().regex(/^\d{4,6}$/, 'El PIN debe ser de 4 a 6 dígitos'),
    fotoCedulaUrl: z.string().url('Foto de cédula inválida').max(500).optional(),
    fotoVehiculoUrl: z.string().url('Foto del vehículo inválida').max(500).optional(),
});

router.post('/registro', registroLimiter, async (req: any, res: any) => {
    const parsed = RegistroSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues.map(i => i.message).join(' | ') });
    }
    const data = parsed.data;
    const telefono = normalizeMotorizadoPhone(data.telefono);
    if (telefono.length < 8) {
        return res.status(400).json({ error: 'Teléfono inválido. Usa 8 dígitos.' });
    }

    try {
        // El teléfono es la identidad de login → único entre quienes tienen PIN.
        // (Chequeo a nivel de aplicación: un @unique en DB rompería datos legacy.)
        const existing = await prisma.motorizado.findMany({
            where: { telefono, pinHash: { not: null } },
            select: { id: true, pinHash: true },
            take: 2,
        });
        if (hasPhoneCredentialConflict(existing)) {
            return res.status(409).json({ error: 'Ya existe un repartidor registrado con ese teléfono. Si es tuyo, inicia sesión.' });
        }

        const pinHash = await bcrypt.hash(data.pin, 10);

        await prisma.motorizado.create({
            data: {
                tenantId: null, // Red NORTEX global: sirve a cualquier negocio de su zona
                tipoFlota: 'NORTEX',
                nombre: data.nombre,
                telefono,
                cedula: data.cedula,
                zonaCobertura: data.zonaCobertura,
                vehiculoPlaca: data.vehiculoPlaca ?? null,
                fotoCedulaUrl: data.fotoCedulaUrl ?? null,
                fotoVehiculoUrl: data.fotoVehiculoUrl ?? null,
                pinHash,
                kycStatus: 'PENDIENTE',
                activo: false, // nadie reparte sin aprobación manual (KYC)
            },
        });

        res.status(201).json({
            message: '¡Registro recibido! Tu solicitud está en revisión. Te contactaremos al aprobar tu cuenta.',
        });
    } catch (error) {
        console.error('Driver registro error:', error);
        res.status(500).json({ error: 'Error al procesar el registro.' });
    }
});

// ── POST /api/driver/login — teléfono + PIN ─────────────────────────────────

const LoginSchema = z.object({
    telefono: z.string().trim().min(8).max(20),
    pin: z.string().regex(/^\d{4,6}$/, 'PIN inválido'),
});

router.post('/login', loginLimiter, async (req: any, res: any) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'Teléfono y PIN requeridos.' });
    }
    const telefono = normalizeMotorizadoPhone(parsed.data.telefono);

    try {
        const driverCandidates = await prisma.motorizado.findMany({
            where: { telefono, pinHash: { not: null } },
            select: {
                id: true,
                nombre: true,
                tipoFlota: true,
                zonaCobertura: true,
                activo: true,
                kycStatus: true,
                pinHash: true,
            },
            take: 2,
        });
        const { driver, ambiguous } = resolveUniqueDriverLogin(driverCandidates);

        // Mensaje genérico: no revelamos si el teléfono existe.
        if (ambiguous || !driver || !driver.pinHash || !(await bcrypt.compare(parsed.data.pin, driver.pinHash))) {
            return res.status(401).json({ error: 'Teléfono o PIN incorrectos.' });
        }
        if (driver.tipoFlota === 'NORTEX' && driver.kycStatus !== 'APROBADO') {
            return res.status(403).json({
                error: driver.kycStatus === 'RECHAZADO'
                    ? 'Tu solicitud fue rechazada. Contacta a Nortex para más información.'
                    : 'Tu cuenta está en revisión. Te avisaremos al aprobarla.',
            });
        }
        if (!driver.activo) {
            return res.status(403).json({ error: 'Tu cuenta está desactivada. Contacta a Nortex.' });
        }

        const token = signDriverToken(driver.id);
        res.json({
            token,
            driver: {
                id: driver.id,
                nombre: driver.nombre,
                tipoFlota: driver.tipoFlota,
                zonaCobertura: driver.zonaCobertura,
            },
        });
    } catch (error) {
        console.error('Driver login error:', error);
        res.status(500).json({ error: 'Error al iniciar sesión.' });
    }
});

// ── GET /api/driver/me/orders — entregas activas + liquidación del día ──────

router.get('/me/orders', authenticateDriver, async (req: any, res: any) => {
    const motorizadoId: string = req.driver.id;
    try {
        const orders = await prisma.pedido.findMany({
            where: {
                motorizadoId,
                estado: { in: ['asignado', 'preparando', 'en_tienda', 'en_ruta', 'en_camino', 'en_punto'] }
            },
            include: {
                items: { include: { producto: { select: { name: true } } } }
            },
            orderBy: { createdAt: 'asc' }
        });

        // 💰 Liquidación del día (la vista Uber). El driver NORTEX puede haber
        // repartido para varios negocios: se agrega cross-tenant a propósito —
        // es SU resumen, derivado solo de sus propios pedidos.
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const hoyPedidos = await prisma.pedido.findMany({
            where: { motorizadoId, estado: 'entregado', entregadoAt: { gte: todayStart } }
        });

        let totalCobradoEfectivo = new Decimal(0);
        let totalComisiones = new Decimal(0);
        for (const p of hoyPedidos) {
            totalCobradoEfectivo = totalCobradoEfectivo.plus(new Decimal(p.total.toString()));
            totalComisiones = totalComisiones.plus(new Decimal(p.costoEntrega.toString()));
        }
        const netoADepositar = totalCobradoEfectivo.minus(totalComisiones);

        const liquidacionDiaria = {
            pedidosEntregados: hoyPedidos.length,
            totalCobrado: totalCobradoEfectivo.toDecimalPlaces(2).toNumber(),
            comisionesGanadas: totalComisiones.toDecimalPlaces(2).toNumber(),
            netoADepositarA_Tienda: (netoADepositar.gt(0) ? netoADepositar : new Decimal(0)).toDecimalPlaces(2).toNumber()
        };

        res.json({
            driver: { id: req.driver.id, nombre: req.driver.nombre, tipoFlota: req.driver.tipoFlota },
            orders,
            liquidacionDiaria
        });
    } catch (error) {
        console.error('Driver me/orders error:', error);
        res.status(500).json({ error: 'Error al obtener tus entregas.' });
    }
});

// ── PATCH /api/driver/me/orders/:orderId/deliver ─────────────────────────────
// El driverId sale del TOKEN. Misma lógica contable que el flujo anterior:
// entrega → tracking GPS → si no hay factura, Sale+Payment+asiento contable.

router.patch('/me/orders/:orderId/deliver', authenticateDriver, async (req: any, res: any) => {
    const motorizadoId: string = req.driver.id;
    const orderId = req.params.orderId;
    const { lat, lng } = req.body || {};

    try {
        const numericLat = lat === undefined || lat === null ? null : Number(lat);
        const numericLng = lng === undefined || lng === null ? null : Number(lng);
        if ((numericLat !== null && !Number.isFinite(numericLat)) || (numericLng !== null && !Number.isFinite(numericLng))) {
            return res.status(400).json({ error: 'Coordenadas inválidas.' });
        }

        const updated = await prisma.$transaction(async (tx: any) => {
            const result = await completePedidoDeliveryInTransaction(tx, {
                pedidoId: orderId,
                motorizadoId,
                actorUserId: null,
                source: 'DRIVER_APP',
                nota: 'Entregado vía App del Motorizado',
                lat: numericLat,
                lng: numericLng,
            });

            // 💰 FASE 3 — Wallet del Real Money Protocol (solo Red NORTEX):
            // la comisión de la entrega (costoEntrega) se acredita como
            // movimiento FIRMADO en la cadena del repartidor. pedidoId @unique
            // garantiza 1 entrega = 1 comisión incluso ante carreras.
            // (Flota PROPIA liquida en efectivo con su negocio: sin wallet.)
            const comision = Number(result.costoEntrega);
            if (req.driver.tipoFlota === 'NORTEX' && comision > 0) {
                await appendDriverWalletMovement(tx, {
                    motorizadoId,
                    tenantId: result.tenantId,
                    pedidoId: orderId,
                    type: 'COMISION_ENTREGA',
                    amount: comision,
                    descripcion: `Comisión por entrega #${orderId.slice(0, 8)} (${result.clienteNombre})`,
                });
            }

            return result.pedido;
        });

        res.json({ message: 'Entregado exitosamente', pedido: updated });
    } catch (error) {
        if (error instanceof PedidoFulfillmentError) {
            return res.status(error.httpStatus).json({ error: error.message, code: error.code });
        }
        if (error instanceof StockError) {
            return res.status(error.code === 'PRODUCT_NOT_FOUND' ? 404 : 422).json({
                error: error.message,
                code: error.code,
            });
        }
        console.error('Driver deliver error:', error);
        res.status(500).json({ error: 'Error al procesar la entrega.' });
    }
});

// ── GET /api/driver/me/wallet — saldo + movimientos del repartidor ──────────
// El saldo es la proyección (Motorizado.walletBalance); la verdad es la
// cadena firmada. El driver solo LEE — los writes pasan por el helper.

router.get('/me/wallet', authenticateDriver, async (req: any, res: any) => {
    const motorizadoId: string = req.driver.id;
    try {
        const movimientos = await prisma.driverWalletMovement.findMany({
            where: { motorizadoId },
            orderBy: { createdAt: 'desc' },
            take: 50,
            select: {
                id: true, type: true, amount: true, descripcion: true,
                createdAt: true, pedidoId: true, signature: true,
            },
        });
        res.json({
            walletBalance: Number(req.driver.walletBalance),
            movimientos: movimientos.map((m: typeof movimientos[number]) => ({
                ...m,
                amount: Number(m.amount),
                firmado: !!m.signature,
                signature: undefined,
            })),
        });
    } catch (error) {
        console.error('Driver wallet error:', error);
        res.status(500).json({ error: 'Error al obtener tu billetera.' });
    }
});

export default router;
