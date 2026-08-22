// NORTEX INC. - CORE BANCARIO (OPTIMIZADO PRODUCCIÓN)
import express from 'express';
import cors from 'cors';
// @ts-ignore
import compression from 'compression';
// @ts-ignore
import rateLimit from 'express-rate-limit';
// @ts-ignore
import { PrismaClient } from '@prisma/client';
// @ts-ignore
import bcrypt from 'bcryptjs';

import { authenticate, AuthRequest, requireSuperAdmin, invalidateTenantCache, flushAllCache } from './middleware/auth';
import { sendPasswordResetEmail, sendWelcomeEmail, sendManualPaymentAlert } from './services/email';
import { runLifecycleEmails } from './services/lifecycleEmails';
import crypto from 'crypto';
import { checkRole } from './middleware/checkRole';
import { BODEGUERO_ROLE, redactBodegueroProduct } from './security/bodegueroPolicy';
import { calculateTenantScore } from './services/scoring';
import { recordSale, recordPayment, recordPurchase, recordExpense, recordCashIn, recordCashMovement, recordFixedAssetAcquisition, recordReturn, recordPayroll, recordLaborProvision, recordAguinaldoPayment, recordSettlement, recordStockCountAdjustment, recordBadDebt, seedChartOfAccounts, getBalanceGeneral, getEstadoResultados, createJournalEntry, assertPeriodOpen, PeriodLockedError } from './services/accounting';
import { seedCatalogFor } from './data/seedCatalogs';
import { runDepreciationForTenant, runMonthlyDepreciationAllTenants, VIDA_UTIL_DEFAULT } from './services/depreciation';
import { getStripe, createCheckoutSession, createPortalSession, handleWebhookEvent, PLAN_PRICE_USD, requiereConfirmacionDePagoCorto, calcularNuevoVencimiento } from './services/stripe';
import { executeSale, SaleError } from './services/salesService';
import { calcularPulso, claveDelDiaManagua, inicioDelDiaManagua, MANAGUA_UTC_OFFSET_HOURS } from './services/pulsoPos';
import {
    applyStockDelta,
    asegurarBodegaPorDefecto,
    materializeWarehouseRow,
    resolveOperationalWarehouse,
    StockError,
    weightedAverageCost,
} from './services/stockService';
import { appendSignedCashMovement, signCapitalLoan, verifyTenantLedger, appendDriverWalletMovement, verifyDriverLedger } from './services/ledger';
import { signAuthToken, verifyAuthToken } from './services/secrets';
import { initObservability, errorTelemetry } from './services/observability';
import { isWhatsAppEnabled } from './services/whatsapp/config';
import { verifyHandler as whatsappVerify, webhookHandler as whatsappWebhook } from './services/whatsapp/webhook';
import { encryptField } from './services/crypto';
// Aritmética PURA (sin Prisma) de los números que el dueño verifica a mano:
// ganancia bruta del día, retiro seguro y efectivo esperado en la gaveta.
import { calcularMargenBruto, calcularRetiroSeguro, calcularEfectivoTurno } from '../utils/margen';
import Stripe from 'stripe';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import hrRouter from './routes/hr';
import pedidosRouter from './routes/pedidos';
import motorizadosRouter from './routes/motorizados';
import driverRouter from './routes/driver';
import loanRoutes from './routes/loans';
import purchaseOrdersRouter from './routes/purchaseOrders';
import serialsRouter from './routes/serials';
import warehousesRouter from './routes/warehouses';
import stockTransfersRouter from './routes/stockTransfers';
import syncRoutes from './routes/sync';
import agentBankingRouter from './routes/agentBanking';
import Decimal from 'decimal.js';
import { z } from 'zod';
import { normalizeCalendarDateInput } from './lib/calendarDate';
import { calculatePurchaseOrderInvoiceAvailability } from './lib/purchaseOrderAvailability';
import {
    FISCAL_REPORT_ROLES,
    fiscalCivilDate,
    fiscalPurchaseScope,
    fiscalRetentionScope,
    parseFiscalPeriod,
} from './lib/fiscalAccess';
import { constanciaContentSecurityPolicy, escapeHtml } from './lib/fiscalHtml';
import { fiscalMonthRange } from './services/nicaTax';
import {
    validate,
    CreateReturnSchema,
    CreatePaymentSchema,
    CreateCashMovementSchema,
    CreatePurchaseSchema,
    InventoryAdjustSchema,
    BulkEditProductsSchema,
    CreateBatchSchema,
    CreateStockCountSchema,
    RecordCountSchema,
    OpenShiftSchema,
    CloseShiftSchema,
    CreateExpenseSchema,
    B2BOrderSchema,
    PayrollCalculateSchema,
    TaxReportSchema,
    RegisterSchema,
    LoginSchema,
    ResetPasswordSchema,
    KardexRecordSchema,
    FinancePurchaseSchema,
} from './validation/schemas.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==========================================
// ⚡ PRISMA OPTIMIZADO (Connection Pool + Slow Query Log)
// ==========================================
const prisma = new PrismaClient({
    log: [
        { emit: 'event', level: 'query' },
        { emit: 'stdout', level: 'warn' },
        { emit: 'stdout', level: 'error' },
    ],
});

// Slow Query Logger: alerta si una query tarda > 500ms
(prisma.$on as any)('query', (e: any) => {
    if (e.duration > 500) {
        console.warn(`🐌 SLOW QUERY (${e.duration}ms): ${e.query.substring(0, 200)}`);
    }
});

const app = express();
// JWT: firma/verificación centralizada en services/secrets.ts (keyring con
// rotación). El fail-closed de arranque vive ahí.

// ==========================================
// 🛡️ MIDDLEWARE DE RENDIMIENTO
// ==========================================

// Trust Proxy (para Cloudflare / Coolify)
app.set('trust proxy', 1);

// GZIP Compression: reduce JSON en ~70% (crítico para internet lento en NI)
app.use(compression() as any);

// CORS: Permite orígenes de desarrollo y producción
const ALLOWED_ORIGINS = [
    'http://localhost:5173',
    'http://localhost:3000',
    'https://somosnortex.com',
    'https://www.somosnortex.com',
    'http://206.189.183.163:3000',
    process.env.FRONTEND_URL,
    process.env.COOLIFY_URL,
].filter(Boolean) as string[];

app.use(cors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        // Permitir requests sin origin (mobile apps, curl, server-to-server)
        if (!origin) return callback(null, true);
        if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
        callback(new Error(`CORS: Origin ${origin} not allowed`));
    },
    credentials: true,
}));

// ⚠️ Stripe Webhook DEBE ir ANTES de express.json() (necesita raw body)
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }) as any, async (req: any, res: any) => {
    const sig = req.headers['stripe-signature'];
    const stripe = getStripe();

    if (!stripe) {
        return res.status(400).json({ error: 'Stripe no configurado' });
    }

    try {
        let event: Stripe.Event;

        // La firma HMAC del webhook DEBE verificarse siempre: sin un secret real no hay
        // forma de validar el origen del evento y un atacante podría activar o cancelar
        // tenants falsificando el body. Nunca confiar en eventos sin firma.
        if (!STRIPE_WEBHOOK_SECRET || STRIPE_WEBHOOK_SECRET === 'whsec_REEMPLAZAR_CON_TU_WEBHOOK_SECRET') {
            console.error('❌ STRIPE_WEBHOOK_SECRET no configurado: webhook rechazado');
            return res.status(500).json({ error: 'Webhook no configurado correctamente' });
        }

        if (!sig) {
            return res.status(400).json({ error: 'Falta la firma del webhook' });
        }

        event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);

        console.log(`📬 Stripe Webhook: ${event.type}`);
        await handleWebhookEvent(event);

        // Invalidar caché del tenant afectado.
        // Los objetos Invoice (invoice.paid / invoice.payment_failed) NO heredan
        // metadata.tenantId — solo lo llevan checkout.session y subscription —, así que
        // en esos casos resolvemos el tenant por su stripeSubscriptionId.
        const obj = event.data.object as any;
        let tenantId: string | undefined = obj.metadata?.tenantId;
        if (!tenantId && obj.subscription) {
            const affectedTenant = await prisma.tenant.findFirst({
                where: { stripeSubscriptionId: obj.subscription as string },
                select: { id: true },
            });
            tenantId = affectedTenant?.id;
        }
        if (tenantId) invalidateTenantCache(tenantId);

        res.json({ received: true });
    } catch (error: any) {
        console.error('Webhook error:', error.message);
        res.status(400).json({ error: `Webhook Error: ${error.message}` });
    }
});

// ⚠️ WhatsApp Webhook — también ANTES de express.json (firma sobre body crudo).
// Inerte salvo WHATSAPP_ENABLED=true (no afecta la app si no está configurado).
if (isWhatsAppEnabled()) {
    app.get('/api/whatsapp/webhook', whatsappVerify as any);
    app.post('/api/whatsapp/webhook', express.raw({ type: 'application/json' }) as any, whatsappWebhook as any);
    console.log('🟢 WhatsApp webhook montado en /api/whatsapp/webhook');
}

// JSON Parser con límite de body (anti-abuse)
app.use(express.json({ limit: '2mb' }) as any);

// ── Healthcheck (Docker HEALTHCHECK, Coolify y monitoreo externo) ────────────
// Registrado ANTES del rate limiter a propósito: en pleno incidente es cuando
// más se necesita que responda, y el latido cada 30s no debe consumir el
// presupuesto anónimo del limiter. Sin auth y sin datos de negocio: solo
// vida del proceso + estado de la BD (con timeout — una BD colgada no puede
// colgar también el healthcheck).
const arranqueDelProceso = Date.now();
app.get('/api/health', async (_req: any, res: any) => {
    let db: 'up' | 'down' = 'down';
    try {
        await Promise.race([
            prisma.$queryRaw`SELECT 1`,
            new Promise((_, reject) => setTimeout(() => reject(new Error('DB_TIMEOUT')), 2000)),
        ]);
        db = 'up';
    } catch { /* db queda 'down' */ }
    res.status(db === 'up' ? 200 : 503).json({
        ok: db === 'up',
        db,
        uptimeSeconds: Math.floor((Date.now() - arranqueDelProceso) / 1000),
        // Coolify inyecta SOURCE_COMMIT en el build: permite ver QUÉ versión corre.
        commit: process.env.SOURCE_COMMIT ?? null,
    });
});

/**
 * Rate limit global — por TENANT cuando hay sesión, por IP cuando no la hay.
 *
 * Antes: 300 peticiones / 15 min por IP para todo `/api/`. Son ~20 por minuto
 * para el NEGOCIO ENTERO, y el mismo razonamiento que ya está escrito en el
 * limiter de login aplica acá con más fuerza: en Nicaragua los locales comparten
 * WiFi y el móvil va por CGNAT, así que "una IP" no es un usuario — es la
 * ferretería completa, y a veces el barrio.
 *
 * Una tienda con dos tablets vendiendo y el dueño mirando el panel agota ese
 * presupuesto en minutos: a partir de ahí TODOS comen 429 y el POS deja de
 * cobrar. Una prueba de carga local lo disparó sin proponérselo.
 *
 * Ahora la llave es el tenant del JWT: cada negocio tiene su propio presupuesto
 * y no lo comparte con quien esté detrás de la misma IP. El tráfico anónimo
 * (login, registro, catálogo público) sigue acotado por IP, y las rutas
 * sensibles conservan además su limiter estricto propio (login por email, PIN
 * de caja, registro, pedidos públicos) — esos son los que frenan el
 * brute-force; este solo frena el abuso grueso.
 *
 * ⚠️ Sigue siendo MemoryStore: el conteo es POR PROCESO. Con más de una
 * instancia el límite efectivo se multiplica por N. Pasarlo a Redis es la
 * Fase 3 de docs/PLAN_DESACOPLE_ESCALABILIDAD.md.
 */
const LIMITE_POR_TENANT = 3000;   // 200/min para todo el negocio
const LIMITE_ANONIMO = 300;       // sin sesión: se mantiene el valor conservador

/** Tenant del Bearer, VERIFICADO. Sin verificar, cualquiera forjaría su cubeta. */
function tenantDelToken(req: any): string | null {
    const auth = req.headers?.authorization;
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) return null;
    try {
        const payload = verifyAuthToken(auth.slice(7));
        return payload?.tenantId ?? null;
    } catch {
        return null; // token vencido/inválido → cae al cubo por IP
    }
}

const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: (req: any) => (tenantDelToken(req) ? LIMITE_POR_TENANT : LIMITE_ANONIMO),
    keyGenerator: (req: any) => {
        const tenantId = tenantDelToken(req);
        return tenantId ? `tenant:${tenantId}` : `ip:${req.ip || 'unknown'}`;
    },
    message: { error: '⚠️ Demasiadas peticiones. Intenta en unos minutos.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', globalLimiter as any);

// Rate Limit Estricto para Login: 10 intentos / hora POR EMAIL (anti brute-force).
// La llave es el email (no la IP): en Nicaragua el móvil va por CGNAT y los negocios
// comparten WiFi — 5/hora por IP bloqueaba a locales enteros cuando dos personas
// tipeaban mal la contraseña. Por email el brute-force sigue acotado (10/h por
// cuenta) sin castigar a toda la red. Fallback a IP si el body no trae email.
// (express.json ya corrió: este limiter se monta después, ver arriba.)
const loginLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    keyGenerator: (req: any) => {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        return email ? `login:${email}` : `ip:${req.ip || 'unknown'}`;
    },
    message: { error: '🔒 Demasiados intentos de inicio de sesión con este correo. Espera 1 hora o restablecé tu contraseña.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/auth/login', loginLimiter as any);

// Registro: evita spam de cuentas / credential-stuffing desde una misma red.
// 20/h (no 10): un cyber o WiFi compartido nica puede traer varios negocios
// registrándose desde la misma IP en la misma tarde.
const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20,
    message: { error: '🔒 Demasiados registros desde esta red. Espera 1 hora.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/auth/register', registerLimiter as any);

app.use('/api/hr', hrRouter);
app.use('/api/v1/pedidos', pedidosRouter);
app.use('/api/v1/motorizados', motorizadosRouter);
app.use('/api/driver', driverRouter); // Red NORTEX: registro, login PIN, entregas
app.use('/api/purchase-orders', purchaseOrdersRouter); // Órdenes de Compra (procurement)
app.use('/api/serials', serialsRouter); // Control de series (números de serie por unidad)
app.use('/api/warehouses', warehousesRouter); // Multi-bodega (Fase 2: fundación)
app.use('/api/stock-transfers', stockTransfersRouter); // Transferencias entre bodegas (Fase 3)
app.use('/api/loans', loanRoutes);
app.use('/api/sales/sync', syncRoutes);
app.use('/api/agent-banking', agentBankingRouter); // Agente bancario (corresponsalía en caja)

// Response time header (para monitoreo)
app.use((req: any, res: any, next: any) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        if (duration > 200) {
            console.warn(`⏱️ SLOW RESPONSE (${duration}ms): ${req.method} ${req.originalUrl}`);
        }
    });
    next();
});

// ==========================================
// 🔐 AUTHENTICATION ROUTES
// ==========================================

app.post('/api/auth/register', validate(RegisterSchema), async (req: any, res: any) => {
    const { companyName, email, password, type, phone } = req.body;
    // Normalización del WhatsApp (retención R1): solo dígitos; si no llega a un
    // número usable (8 dígitos locales NIC), se guarda null — nunca basura.
    const phoneDigits = String(phone || '').replace(/\D/g, '');
    const normalizedPhone = phoneDigits.length >= 8 ? phoneDigits : null;

    try {
        // 0. Reservar los emails con privilegio SUPER_ADMIN: no pueden auto-registrarse
        //    por vía pública (se provisionan por seed controlado). Defensa en profundidad
        //    ante una BD fresca/restaurada donde la cuenta aún no exista. Se responde con
        //    el mismo mensaje genérico para no revelar qué correos están reservados.
        const reservedSuperAdminEmails = (process.env.SUPER_ADMIN_EMAILS || 'noelpinedaa96@gmail.com')
            .split(',')
            .map((e: string) => e.trim().toLowerCase())
            .filter(Boolean);
        if (reservedSuperAdminEmails.includes((email || '').toLowerCase())) {
            return res.status(400).json({ error: 'Email ya registrado' });
        }

        // 1. Check if user already exists
        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            return res.status(400).json({ error: 'Email ya registrado' });
        }

        // 2. Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // 3. Create Tenant + User + Employee in transaction
        const result = await prisma.$transaction(async (tx: any) => {
            // Create Tenant
            const tenant = await tx.tenant.create({
                data: {
                    businessName: companyName,
                    type: type || 'FERRETERIA',
                    taxId: `TAX-${Date.now()}`,
                    // Sin números fantasma: el wallet arranca en 0 (solo sube con un
                    // desembolso real auditado o aprobación admin), la línea de crédito
                    // en 0 y el score en NULL ("sin datos") hasta que el motor real lo
                    // calcule desde historial. Los defaults del schema ya son 0/null.
                    subscriptionStatus: 'TRIAL',
                    // 30 días: debe coincidir con la promesa pública de la landing
                    // ("30 DÍAS GRATIS · NO SE COBRA HASTA EL DÍA 31").
                    trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 días
                    // WhatsApp del dueño (opcional) — el canal de seguimiento R1.
                    phone: normalizedPhone,
                }
            });

            // Create Admin User
            const user = await tx.user.create({
                data: {
                    tenantId: tenant.id,
                    email: email,
                    password: hashedPassword,
                    name: companyName,
                    role: 'ADMIN'
                }
            });

            // Auto-crear empleado cajero por defecto (PIN 1234 para cero fricción)
            const employee = await tx.employee.create({
                data: {
                    tenantId: tenant.id,
                    userId: user.id,
                    firstName: 'Admin',
                    lastName: 'Principal',
                    role: 'OWNER',
                    pin: '1234',
                    baseSalary: 0,
                    commissionRate: 0,
                }
            });

            return { tenant, user, employee };
        });

        // 4. Generate JWT (incluir email para Super Admin detection)
        const token = signAuthToken(
            { userId: result.user.id, tenantId: result.tenant.id, role: result.user.role, email: email }
        );

        res.json({
            token,
            user: { id: result.user.id, email: result.user.email, name: result.user.name, role: result.user.role },
            tenant: result.tenant
        });

        // Email de bienvenida (retención R1): fire-and-forget DESPUÉS de responder
        // — un fallo de Resend jamás rompe ni retrasa el registro.
        sendWelcomeEmail(email, companyName, '1234').catch((e) =>
            console.error('⚠️ Welcome email falló (registro OK):', e)
        );

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Error en el registro' });
    }
});

app.post('/api/auth/login', validate(LoginSchema), async (req: any, res: any) => {
    const { email, password } = req.body;

    try {
        // 1. Find user
        const user = await prisma.user.findUnique({ where: { email }, include: { tenant: true } });

        if (!user) {
            return res.status(401).json({ error: 'Credenciales incorrectas' });
        }

        // 2. Verify password
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Credenciales incorrectas' });
        }

        // 2.5 Check if user is disabled
        if (user.status === 'DISABLED') {
            return res.status(403).json({ error: 'Tu cuenta ha sido desactivada. Contacta al administrador.' });
        }

        // 3. Update lastLogin
        await prisma.user.update({
            where: { id: user.id },
            data: { lastLogin: new Date() }
        });

        // 4. Generate JWT (incluir email para Super Admin detection)
        const token = signAuthToken(
            { userId: user.id, tenantId: user.tenantId, role: user.role, email: user.email }
        );

        res.json({
            token,
            user: { id: user.id, email: user.email, name: user.name, role: user.role },
            tenant: user.tenant
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Error en el inicio de sesión' });
    }
});


// ==========================================
// 👥 TEAM MANAGEMENT (INVITE SYSTEM)
// ==========================================

// GET /api/team — Lista todos los usuarios del tenant
app.get('/api/team', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        // Solo OWNER/ADMIN pueden ver el equipo completo
        if (!['OWNER', 'ADMIN', 'SUPER_ADMIN'].includes(authReq.role || '')) {
            return res.status(403).json({ error: 'Solo el dueño puede gestionar el equipo.' });
        }

        const users = await prisma.user.findMany({
            where: { tenantId: authReq.tenantId },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                status: true,
                lastLogin: true,
                invitedBy: true,
                createdAt: true,
            },
            orderBy: { createdAt: 'asc' }
        });

        const invitations = await prisma.invitation.findMany({
            where: { tenantId: authReq.tenantId, status: 'PENDING' },
            select: {
                id: true,
                email: true,
                role: true,
                status: true,
                token: true,
                expiresAt: true,
                createdAt: true,
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json({ users, invitations });
    } catch (error) {
        console.error('Team fetch error:', error);
        res.status(500).json({ error: 'Error obteniendo equipo' });
    }
});

// POST /api/team/invite — Crear invitación
app.post('/api/team/invite', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { email, role } = req.body;

    try {
        if (!['OWNER', 'ADMIN', 'SUPER_ADMIN'].includes(authReq.role || '')) {
            return res.status(403).json({ error: 'Solo el dueño puede invitar miembros.' });
        }

        if (!email || !role) {
            return res.status(400).json({ error: 'Email y rol son requeridos.' });
        }

        const validRoles = ['MANAGER', 'CASHIER', 'VIEWER', 'EMPLOYEE', 'ACCOUNTANT', 'VENDEDOR', BODEGUERO_ROLE];
        if (!validRoles.includes(role)) {
            return res.status(400).json({ error: `Rol inválido. Opciones: ${validRoles.join(', ')}` });
        }

        // Verificar que no exista ya un usuario con ese email
        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            return res.status(400).json({ error: 'Ya existe un usuario con ese email.' });
        }

        // Verificar que no haya una invitación pendiente para ese email
        const existingInvite = await prisma.invitation.findFirst({
            where: { tenantId: authReq.tenantId, email, status: 'PENDING' }
        });
        if (existingInvite) {
            return res.status(400).json({ error: 'Ya hay una invitación pendiente para ese email.' });
        }

        // Generar token seguro
        const token = crypto.randomUUID();

        // Crear invitación (expira en 48 horas)
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 48);

        const invitation = await prisma.invitation.create({
            data: {
                tenantId: authReq.tenantId!,
                email,
                role,
                token,
                invitedBy: authReq.userId!,
                expiresAt,
            }
        });

        // Registrar en audit log
        await prisma.auditLog.create({
            data: {
                tenantId: authReq.tenantId!,
                userId: authReq.userId!,
                action: 'INVITE_TEAM_MEMBER',
                details: `Invitó a ${email} como ${role}`,
            }
        });

        // Generar link de invitación
        const baseUrl = process.env.FRONTEND_URL || 'https://somosnortex.com';
        const inviteLink = `${baseUrl}/invite/${token}`;

        res.json({
            invitation,
            inviteLink,
            message: `Invitación creada. Comparte este link con ${email}`
        });
    } catch (error) {
        console.error('Invite error:', error);
        res.status(500).json({ error: 'Error creando invitación' });
    }
});

// DELETE /api/team/:userId — Desactivar miembro
app.delete('/api/team/:userId', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { userId } = req.params;

    try {
        if (!['OWNER', 'ADMIN', 'SUPER_ADMIN'].includes(authReq.role || '')) {
            return res.status(403).json({ error: 'Solo el dueño puede gestionar el equipo.' });
        }

        // No puede desactivarse a sí mismo
        if (userId === authReq.userId) {
            return res.status(400).json({ error: 'No puedes desactivarte a ti mismo.' });
        }

        // Verificar que el usuario pertenece al mismo tenant
        const targetUser = await prisma.user.findFirst({
            where: { id: userId, tenantId: authReq.tenantId }
        });

        if (!targetUser) {
            return res.status(404).json({ error: 'Usuario no encontrado.' });
        }

        // No puede desactivar a otro OWNER
        if (['OWNER', 'ADMIN'].includes(targetUser.role)) {
            return res.status(400).json({ error: 'No puedes desactivar al dueño del negocio.' });
        }

        await prisma.user.update({
            where: { id: userId },
            data: { status: 'DISABLED' }
        });

        await prisma.auditLog.create({
            data: {
                tenantId: authReq.tenantId!,
                userId: authReq.userId!,
                action: 'DISABLE_TEAM_MEMBER',
                details: `Desactivó a ${targetUser.name} (${targetUser.email})`,
            }
        });

        res.json({ success: true, message: `${targetUser.name} ha sido desactivado.` });
    } catch (error) {
        console.error('Team delete error:', error);
        res.status(500).json({ error: 'Error desactivando usuario' });
    }
});

// PATCH /api/team/:userId/role — Cambiar rol de miembro
app.patch('/api/team/:userId/role', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { userId } = req.params;
    const { role } = req.body;

    try {
        if (!['OWNER', 'ADMIN', 'SUPER_ADMIN'].includes(authReq.role || '')) {
            return res.status(403).json({ error: 'Solo el dueño puede cambiar roles.' });
        }

        if (userId === authReq.userId) {
            return res.status(400).json({ error: 'No puedes cambiar tu propio rol.' });
        }

        const validRoles = ['MANAGER', 'CASHIER', 'VIEWER', 'EMPLOYEE', 'ACCOUNTANT', 'VENDEDOR', BODEGUERO_ROLE];
        if (!validRoles.includes(role)) {
            return res.status(400).json({ error: `Rol inválido. Opciones: ${validRoles.join(', ')}` });
        }

        const targetUser = await prisma.user.findFirst({
            where: { id: userId, tenantId: authReq.tenantId }
        });

        if (!targetUser) {
            return res.status(404).json({ error: 'Usuario no encontrado.' });
        }

        if (['OWNER', 'ADMIN'].includes(targetUser.role)) {
            return res.status(400).json({ error: 'No puedes cambiar el rol del dueño.' });
        }

        await prisma.user.update({
            where: { id: userId },
            data: { role }
        });

        await prisma.auditLog.create({
            data: {
                tenantId: authReq.tenantId!,
                userId: authReq.userId!,
                action: 'CHANGE_TEAM_ROLE',
                details: `Cambió rol de ${targetUser.name} de ${targetUser.role} a ${role}`,
            }
        });

        res.json({ success: true, message: `Rol de ${targetUser.name} actualizado a ${role}.` });
    } catch (error) {
        console.error('Role change error:', error);
        res.status(500).json({ error: 'Error cambiando rol' });
    }
});

// GET /api/invite/:token — Validar invitación (público, sin auth)
app.get('/api/invite/:token', async (req: any, res: any) => {
    const { token } = req.params;

    try {
        const invitation = await prisma.invitation.findUnique({
            where: { token },
            include: {
                tenant: { select: { businessName: true } }
            }
        });

        if (!invitation) {
            return res.status(404).json({ error: 'Invitación no encontrada.' });
        }

        if (invitation.status === 'ACCEPTED') {
            return res.status(400).json({ error: 'Esta invitación ya fue utilizada.' });
        }

        if (new Date() > invitation.expiresAt) {
            await prisma.invitation.update({
                where: { id: invitation.id },
                data: { status: 'EXPIRED' }
            });
            return res.status(400).json({ error: 'Esta invitación ha expirado. Solicita una nueva.' });
        }

        res.json({
            email: invitation.email,
            role: invitation.role,
            businessName: invitation.tenant.businessName,
            expiresAt: invitation.expiresAt,
        });
    } catch (error) {
        console.error('Invite validation error:', error);
        res.status(500).json({ error: 'Error validando invitación' });
    }
});

// POST /api/invite/:token/accept — Aceptar invitación y crear usuario
app.post('/api/invite/:token/accept', async (req: any, res: any) => {
    const { token } = req.params;
    const { name, password } = req.body;

    try {
        if (!name || !password) {
            return res.status(400).json({ error: 'Nombre y contraseña son requeridos.' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
        }

        const invitation = await prisma.invitation.findUnique({
            where: { token },
            include: { tenant: true }
        });

        if (!invitation) {
            return res.status(404).json({ error: 'Invitación no encontrada.' });
        }

        if (invitation.status !== 'PENDING') {
            return res.status(400).json({ error: 'Esta invitación ya no es válida.' });
        }

        if (new Date() > invitation.expiresAt) {
            await prisma.invitation.update({
                where: { id: invitation.id },
                data: { status: 'EXPIRED' }
            });
            return res.status(400).json({ error: 'Esta invitación ha expirado.' });
        }

        // Verificar que no exista ya un usuario con ese email
        const existingUser = await prisma.user.findUnique({ where: { email: invitation.email } });
        if (existingUser) {
            return res.status(400).json({ error: 'Ya existe una cuenta con este email.' });
        }

        // Crear usuario y marcar invitación como aceptada
        const hashedPassword = await bcrypt.hash(password, 10);

        const result = await prisma.$transaction(async (tx: any) => {
            const user = await tx.user.create({
                data: {
                    tenantId: invitation.tenantId,
                    email: invitation.email,
                    password: hashedPassword,
                    name,
                    role: invitation.role,
                    invitedBy: invitation.invitedBy,
                    lastLogin: new Date(),
                }
            });

            await tx.invitation.update({
                where: { id: invitation.id },
                data: { status: 'ACCEPTED' }
            });

            await tx.auditLog.create({
                data: {
                    tenantId: invitation.tenantId,
                    userId: user.id,
                    action: 'ACCEPT_INVITATION',
                    details: `${name} (${invitation.email}) se unió como ${invitation.role}`,
                }
            });

            return user;
        });

        // Generar JWT para auto-login
        const jwtToken = signAuthToken(
            { userId: result.id, tenantId: result.tenantId, role: result.role, email: result.email }
        );

        res.json({
            token: jwtToken,
            user: { id: result.id, email: result.email, name: result.name, role: result.role },
            tenant: invitation.tenant,
        });
    } catch (error) {
        console.error('Accept invitation error:', error);
        res.status(500).json({ error: 'Error aceptando invitación' });
    }
});

// DELETE /api/team/invite/:invitationId — Cancelar invitación pendiente
app.delete('/api/team/invite/:invitationId', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { invitationId } = req.params;

    try {
        if (!['OWNER', 'ADMIN', 'SUPER_ADMIN'].includes(authReq.role || '')) {
            return res.status(403).json({ error: 'Solo el dueño puede cancelar invitaciones.' });
        }

        const invitation = await prisma.invitation.findFirst({
            where: { id: invitationId, tenantId: authReq.tenantId }
        });

        if (!invitation) {
            return res.status(404).json({ error: 'Invitación no encontrada.' });
        }

        // Soft-cancel + auditoría, en línea con el endpoint hermano DELETE /api/team/:userId.
        // La propiedad ya se verificó arriba con findFirst por tenantId. No borrar físicamente:
        // se pierde la forensia de accesos (quién invitó/revocó a qué email con qué rol).
        await prisma.$transaction(async (tx: any) => {
            await tx.invitation.update({
                where: { id: invitationId },
                data: { status: 'CANCELLED' }
            });

            await tx.auditLog.create({
                data: {
                    tenantId: authReq.tenantId!,
                    userId: authReq.userId!,
                    action: 'CANCEL_INVITATION',
                    details: `Canceló invitación de ${invitation.email} (${invitation.role})`,
                }
            });
        });

        res.json({ success: true, message: 'Invitación cancelada.' });
    } catch (error) {
        console.error('Cancel invite error:', error);
        res.status(500).json({ error: 'Error cancelando invitación' });
    }
});


// ==========================================
// 🔑 PASSWORD RESET
// ==========================================

// Rate limiter para forgot-password (3 intentos por IP cada 15 min)
const forgotPasswordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: 'Demasiados intentos. Intenta de nuevo en 15 minutos.' }
});

// POST /api/auth/forgot-password — Solicitar reset
app.post('/api/auth/forgot-password', forgotPasswordLimiter, async (req: any, res: any) => {
    const { email } = req.body;

    try {
        if (!email) {
            return res.status(400).json({ error: 'Email es requerido.' });
        }

        // SIEMPRE devolver el mismo mensaje (seguridad: no revelar si el email existe)
        const genericMsg = 'Si el email está registrado, recibirás un link para restablecer tu contraseña.';

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            // No revelar que el email no existe
            return res.json({ message: genericMsg });
        }

        // Verificar que no haya muchos resets pendientes (anti-spam)
        const recentResets = await prisma.passwordReset.count({
            where: {
                userId: user.id,
                createdAt: { gte: new Date(Date.now() - 15 * 60 * 1000) }
            }
        });
        if (recentResets >= 3) {
            return res.json({ message: genericMsg });
        }

        // Generar token
        const token = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

        await prisma.passwordReset.create({
            data: {
                userId: user.id,
                token,
                expiresAt,
            }
        });

        // Enviar email
        const baseUrl = process.env.FRONTEND_URL || 'https://somosnortex.com';
        const resetLink = `${baseUrl}/reset-password/${token}`;

        const emailSent = await sendPasswordResetEmail(user.email, resetLink, user.name);

        if (!emailSent) {
            // No revelar al cliente que el envío falló: diferenciar la respuesta según el
            // usuario exista o no crea un oráculo de enumeración de cuentas (el caso "email
            // inexistente" ya responde 200 genericMsg). Registrar el fallo solo del lado del
            // servidor y devolver el mismo mensaje genérico.
            console.error(`❌ FAILED TO SEND RESET EMAIL to ${user.email}`);
            console.log(`🔗 Reset link (fallback): ${resetLink}`);
            return res.json({ message: genericMsg });
        }

        res.json({ message: genericMsg });
    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ error: 'Error procesando solicitud.' });
    }
});

// GET /api/auth/reset-password/:token — Validar token
app.get('/api/auth/reset-password/:token', async (req: any, res: any) => {
    const { token } = req.params;

    try {
        const resetRecord = await prisma.passwordReset.findUnique({
            where: { token },
            include: { user: { select: { email: true, name: true } } }
        });

        if (!resetRecord) {
            return res.status(404).json({ error: 'Link inválido o expirado.' });
        }

        if (resetRecord.used) {
            return res.status(400).json({ error: 'Este link ya fue utilizado.' });
        }

        if (new Date() > resetRecord.expiresAt) {
            return res.status(400).json({ error: 'Este link ha expirado. Solicita uno nuevo.' });
        }

        res.json({
            valid: true,
            email: resetRecord.user.email,
            name: resetRecord.user.name,
        });
    } catch (error) {
        console.error('Validate reset token error:', error);
        res.status(500).json({ error: 'Error validando link.' });
    }
});

// POST /api/auth/reset-password/:token — Cambiar contraseña
// Limitado: previene fuerza bruta del token de reseteo (= toma de cuenta).
app.post('/api/auth/reset-password/:token', forgotPasswordLimiter, validate(ResetPasswordSchema), async (req: any, res: any) => {
    const { token } = req.params;
    const { password } = req.body;

    try {
        if (!password || password.length < 6) {
            return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
        }

        const resetRecord = await prisma.passwordReset.findUnique({
            where: { token },
            include: { user: true }
        });

        if (!resetRecord) {
            return res.status(404).json({ error: 'Link inválido o expirado.' });
        }

        if (resetRecord.used) {
            return res.status(400).json({ error: 'Este link ya fue utilizado.' });
        }

        if (new Date() > resetRecord.expiresAt) {
            return res.status(400).json({ error: 'Este link ha expirado. Solicita uno nuevo.' });
        }

        // Hashear nueva contraseña y actualizar
        const hashedPassword = await bcrypt.hash(password, 10);

        await prisma.$transaction(async (tx: any) => {
            await tx.user.update({
                where: { id: resetRecord.userId },
                data: { password: hashedPassword }
            });

            // Invalidar este token
            await tx.passwordReset.update({
                where: { id: resetRecord.id },
                data: { used: true }
            });

            // Invalidar todos los tokens pendientes de este usuario
            await tx.passwordReset.updateMany({
                where: {
                    userId: resetRecord.userId,
                    used: false,
                    id: { not: resetRecord.id }
                },
                data: { used: true }
            });
        });

        // Auto-login
        const jwtToken = signAuthToken({
            userId: resetRecord.user.id,
            tenantId: resetRecord.user.tenantId,
            role: resetRecord.user.role,
            email: resetRecord.user.email ?? undefined
        });

        res.json({
            message: 'Contraseña actualizada exitosamente.',
            token: jwtToken,
            user: {
                id: resetRecord.user.id,
                email: resetRecord.user.email,
                name: resetRecord.user.name,
                role: resetRecord.user.role
            }
        });
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ error: 'Error restableciendo contraseña.' });
    }
});


// ==========================================
// 📊 DASHBOARD & INTELLIGENCE (REAL DATA)
// ==========================================

/**
 * Onboarding guiado: deriva los hitos de activación de los datos REALES del
 * negocio (no hay tabla de progreso — los conteos son la fuente de verdad), así
 * el checklist se auto-completa solo. Los pasos se ramifican por tipo de negocio.
 * Las banderas cosméticas (bienvenida vista / descartado) viven en localStorage.
 */
// POST /api/onboarding/seed-catalog — Carga un catálogo de EJEMPLO del giro del
// tenant (P1 retención): mata el arranque en frío (app vacía el día 1). Solo si
// el inventario está VACÍO, para no duplicar. Productos editables/borrables.
app.post('/api/onboarding/seed-catalog', authenticate, checkRole(['OWNER', 'ADMIN', 'SUPER_ADMIN']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const tenantId = authReq.tenantId!;
    try {
        const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { type: true } });
        if (!tenant) return res.status(404).json({ error: 'Negocio no encontrado' });

        const catalog = seedCatalogFor(tenant.type);
        if (!catalog || catalog.length === 0) {
            return res.status(400).json({ error: 'Tu giro no tiene un catálogo de ejemplo disponible.' });
        }

        // Guard anti-duplicado: solo sembramos con el inventario en cero.
        const existing = await prisma.product.count({ where: { tenantId } });
        if (existing > 0) {
            return res.status(409).json({ error: 'Ya tenés productos cargados; el catálogo de ejemplo es solo para empezar de cero.' });
        }

        const data = catalog.map((p, i) => ({
            tenantId,
            name:      p.name,
            sku:       `EJ-${tenant.type.slice(0, 3).toUpperCase()}-${String(i + 1).padStart(3, '0')}`,
            category:  p.category,
            price:     p.price,
            cost:      p.cost,
            stock:     p.stock,
            unit:      p.unit ?? 'unidad',
            createdBy: authReq.userId!,
        }));

        await prisma.product.createMany({ data, skipDuplicates: true });

        await prisma.auditLog.create({
            data: {
                tenantId,
                userId:  authReq.userId!,
                action:  'SEED_CATALOG',
                details: JSON.stringify({ type: tenant.type, count: data.length }),
            },
        });

        res.json({ message: `Cargamos ${data.length} productos de ejemplo. Editalos, borralos o sumá los tuyos.`, count: data.length });
    } catch (error) {
        console.error('Seed catalog error:', error);
        res.status(500).json({ error: 'No se pudo cargar el catálogo de ejemplo.' });
    }
});

app.get('/api/onboarding', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const tenantId = authReq.tenantId;
        const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
        if (!tenant) return res.status(404).json({ error: 'Negocio no encontrado' });

        const isLender = tenant.type === 'LENDER';

        // Conteos reales (alcance: este negocio). Los préstamos del prestamista se
        // identifican por lenderId; el Employee del dueño se crea al registrarse,
        // por eso "equipo" = más de 1 empleado.
        const [products, sales, customers, employees, lenderLoans] = await Promise.all([
            prisma.product.count({ where: { tenantId } }),
            prisma.sale.count({ where: { tenantId } }),
            prisma.customer.count({ where: { tenantId } }),
            prisma.employee.count({ where: { tenantId } }),
            isLender ? prisma.loan.count({ where: { lenderId: tenantId } }) : Promise.resolve(0),
        ]);

        // El registro siembra un taxId placeholder "TAX-<timestamp>"; el paso solo
        // se completa cuando el dueño guarda su RUC real (Configuración DGI).
        const hasFiscal = !!(
            tenant.taxId &&
            String(tenant.taxId).trim() &&
            !/^TAX-\d+$/.test(String(tenant.taxId))
        );
        const teamReady = employees > 1;

        const steps = isLender
            ? [
                { key: 'fiscal',    label: 'Configurá los datos de tu negocio',  done: hasFiscal,        href: '/app/dashboard', cta: 'Configurar' },
                { key: 'customer',  label: 'Registrá tu primer cliente',         done: customers > 0,    href: '/app/dashboard', cta: 'Agregar cliente' },
                { key: 'loan',      label: 'Creá tu primer préstamo',            done: lenderLoans > 0,  href: '/app/dashboard', cta: 'Crear préstamo' },
                { key: 'team',      label: 'Agregá un cobrador a tu equipo',     done: teamReady,        href: '/app/hr',        cta: 'Agregar cobrador' },
              ]
            : [
                // El activation moment real es vender: primer producto y primera venta
                // van primero; lo fiscal (RUC/DGI) queda al final porque no bloquea operar.
                { key: 'product',   label: 'Agregá tu primer producto',          done: products > 0,     href: '/app/inventory?tour=inv',     cta: 'Agregar producto' },
                { key: 'sale',      label: 'Hacé tu primera venta',              done: sales > 0,        href: '/app/pos?tour=pos',           cta: 'Ir al POS' },
                { key: 'customer',  label: 'Registrá un cliente',                done: customers > 0,    href: '/app/clients',                cta: 'Agregar cliente' },
                { key: 'team',      label: 'Invitá a tu equipo',                 done: teamReady,        href: '/app/team',                   cta: 'Invitar' },
                { key: 'fiscal',    label: 'Configurá tus datos fiscales (DGI)', done: hasFiscal,        href: '/app/dashboard?config=fiscal', cta: 'Configurar' },
              ];

        const completed = steps.filter(s => s.done).length;
        res.json({
            type: tenant.type,
            businessName: tenant.businessName ?? '',
            steps,
            completed,
            total: steps.length,
            allDone: completed === steps.length,
        });
    } catch (e: any) {
        console.error('onboarding status error', e);
        res.status(500).json({ error: 'Error al calcular el onboarding' });
    }
});

// ── Pulso del día del POS (gamificación honesta) ─────────────────────────────
// Los números REALES del negocio como motor del loop de venta: cuánto llevás
// hoy, tu racha de días vendiendo, tu meta (tu propio promedio) y si hoy es
// récord. Liviano a propósito — el POS lo consulta tras CADA venta: solo
// agregados en BD (aggregate + GROUP BY por día con LIMIT), cero filas.
// Es GET → exento de billing (el pulso nunca se paywallea). Cualquier rol lo
// ve: no expone ganancia ni costos, solo venta bruta del propio tenant.
app.get('/api/pos/pulso', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const ahora = new Date();
        const hoy0 = inicioDelDiaManagua(ahora);
        const hoyStr = claveDelDiaManagua(ahora);
        const hace45 = new Date(hoy0.getTime() - 45 * 86_400_000);

        const [agg, rows] = await Promise.all([
            prisma.sale.aggregate({
                where: { tenantId: authReq.tenantId!, createdAt: { gte: hoy0 }, status: { not: 'VOIDED' } },
                _count: { _all: true },
                _sum: { total: true },
            }),
            // Día calendario de MANAGUA (UTC-6), no del server: una venta de las
            // 10 pm nica es "hoy", aunque en UTC ya sea mañana.
            prisma.$queryRaw`
                SELECT DATE_FORMAT(DATE_SUB(createdAt, INTERVAL ${MANAGUA_UTC_OFFSET_HOURS} HOUR), '%Y-%m-%d') AS dia,
                       SUM(total) AS total,
                       COUNT(*) AS ventas
                FROM \`Sale\`
                WHERE \`tenantId\` = ${authReq.tenantId} AND createdAt >= ${hace45} AND status <> 'VOIDED'
                GROUP BY dia
                ORDER BY dia DESC
                LIMIT 45` as Promise<Array<{ dia: string; total: any; ventas: any }>>,
        ]);

        const pulso = calcularPulso(
            rows.map((r) => ({ dia: r.dia, total: (r.total ?? 0).toString(), ventas: Number(r.ventas) })),
            hoyStr
        );

        res.json({
            // Montos como string con precisión Decimal — cero float en el cable.
            totalHoy: new Decimal((agg._sum.total ?? 0).toString()).toFixed(2),
            ventasHoy: agg._count._all,
            ...pulso,
        });
    } catch (error) {
        console.error('Error calculando el pulso del POS:', error);
        res.status(500).json({ error: 'Error calculando el pulso del día' });
    }
});

app.get('/api/dashboard/stats', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const tenantId = authReq.tenantId;

        // 1. Fetch Tenant Financials
        const tenant = await prisma.tenant.findUnique({
            where: { id: tenantId }
        });

        // 2. Calculate Sales Last 7 Days (Real DB Query)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const recentSales = await prisma.sale.findMany({
            where: {
                tenantId: tenantId,
                createdAt: { gte: sevenDaysAgo }
            },
            select: {
                createdAt: true,
                total: true
            }
        });

        // Group by Day
        const days = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
        const chartData = Array.from({ length: 7 }).map((_, i) => {
            const d = new Date();
            d.setDate(d.getDate() - (6 - i));
            const dayName = days[d.getDay()];

            // Filter sales for this day (suma con decimal.js)
            const dayTotal = recentSales
                .filter((s: any) => new Date(s.createdAt).toDateString() === d.toDateString())
                .reduce((sum: Decimal, s: any) => sum.plus(new Decimal(s.total.toString())), new Decimal(0));

            return { name: dayName, sales: dayTotal.toNumber() };
        });

        // 3. Calculate Today's Expenses (Gastos operativos del día)
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const todayExpenses = await prisma.expense.findMany({
            where: {
                tenantId: tenantId,
                createdAt: { gte: todayStart }
            }
        });
        const totalExpensesToday = todayExpenses.reduce((sum: Decimal, e: any) => sum.plus(new Decimal(e.amount.toString())), new Decimal(0));

        // 4. Calculate Today's Sales
        const totalSalesToday = recentSales
            .filter((s: any) => new Date(s.createdAt).toDateString() === new Date().toDateString())
            .reduce((sum: Decimal, s: any) => sum.plus(new Decimal(s.total.toString())), new Decimal(0));

        // 5. NX-01 — GANANCIA BRUTA REAL del día (ingreso neto − costo de lo vendido).
        //
        // Antes: netProfit = ventas brutas − gastos operativos. Sin gastos cargados
        // (una cuenta nueva NO tiene gastos), "Ganancia de hoy" era la venta ENTERA:
        // C$645 de ganancia por una venta de C$645 que costó C$520 (+416%).
        //
        // Dos correcciones en una: (a) se resta el COSTO de la mercadería (COGS), y
        // (b) el ingreso se reconoce NETO de IVA — `Product.price` es precio de
        // góndola (IVA incluido) y `costAtSale` es neto, así que restarlos directo
        // inflaba la ganancia otro 15%. Se usa la MISMA fórmula del asiento contable
        // (ver utils/margen.ts) para que el KPI no discrepe del Estado de Resultados.
        //
        // Query acotada al día de hoy y con `select` cerrado (no `include` abierto):
        // solo el total, la porción exonerada y (costo, cantidad) de cada línea.
        // VOIDED se excluye igual que en el Libro de Ventas / la declaración DGI.
        const salesTodayForMargin = await prisma.sale.findMany({
            where: {
                tenantId: tenantId,
                createdAt: { gte: todayStart },
                status: { not: 'VOIDED' },
            },
            select: {
                total: true,
                exemptTotal: true,
                items: { select: { costAtSale: true, quantity: true } },
            },
            // Techo duro (guardrail de escalado: nada de findMany sin take sobre
            // Sale). Una PyME nica hace decenas o cientos de ventas al día; si
            // algún tenant llega a 5.000 en un día, este KPI hay que moverlo a una
            // agregación SQL (SUM(costAtSale * quantity)) — Prisma no expresa ese
            // producto en `aggregate`. Hasta entonces el tope evita que el handler
            // se coma la memoria del único proceso.
            take: 5000,
        });

        const margenHoy = calcularMargenBruto(
            salesTodayForMargin.map((s: any) => ({
                total: s.total.toString(),
                exemptTotal: s.exemptTotal == null ? null : s.exemptTotal.toString(),
                items: s.items.map((i: any) => ({
                    costAtSale: i.costAtSale == null ? null : i.costAtSale.toString(),
                    quantity: i.quantity,
                })),
            }))
        );

        // Utilidad REAL del día: ganancia bruta (ya sin costo de mercadería ni IVA)
        // menos los gastos operativos del día.
        const netProfitToday = margenHoy.gananciaBruta.minus(totalExpensesToday);

        // 6. Recent Theft/Surplus Alerts (últimos 7 días)
        const recentAlerts = await prisma.auditLog.findMany({
            where: {
                tenantId: tenantId,
                action: { in: ['THEFT_ALERT', 'SURPLUS_ALERT'] },
                createdAt: { gte: sevenDaysAgo }
            },
            orderBy: { createdAt: 'desc' },
            take: 10
        });

        // 7. SURVIVAL DASHBOARD (NIIF PyMES)
        const balanceData = await getBalanceGeneral(tenantId);
        const assets = balanceData.assets || [];
        const liabilities = balanceData.liabilities || [];

        const cashObj = assets.find((a: any) => a.code === '1.1.1');
        const bankObj = assets.find((a: any) => a.code === '1.1.2');
        const cxcObj = assets.find((a: any) => a.code === '1.1.3');
        const invObj = assets.find((a: any) => a.code === '1.1.4');
        const cxpObj = liabilities.find((a: any) => a.code === '2.1.1');

        // E6 — indicadores de supervivencia con decimal.js (Capa 4): la suma y
        // resta de saldos en float nativo arrastraba error binario al efectivo
        // total y la liquidez libre que ve el dueño.
        const caja = new Decimal(cashObj ? cashObj.balance.toString() : 0);
        const bancos = new Decimal(bankObj ? bankObj.balance.toString() : 0);
        const cxc = new Decimal(cxcObj ? cxcObj.balance.toString() : 0);
        const inventario = new Decimal(invObj ? invObj.balance.toString() : 0);
        const cxp = new Decimal(cxpObj ? cxpObj.balance.toString() : 0);

        const efectivoTotal = caja.plus(bancos);
        const liquidezLibre = efectivoTotal.minus(cxp);

        // NX-02 — RETIRO SEGURO = max(0, efectivo − cuentas por pagar − reposición).
        // `liquidezLibre` (efectivo − CxP) NO es lo que el dueño puede sacar: parte
        // de esa plata corresponde a la mercadería que YA salió y hay que recomprar
        // para dejar el inventario como estaba. Se descuenta el costo de lo vendido
        // hoy (costoReposicionPendiente). Sin esto la app le decía al dueño que se
        // llevara el capital de trabajo.
        const retiroSeguro = calcularRetiroSeguro(efectivoTotal, cxp, margenHoy.costoVendido);

        const survivalData = {
            cajaGeneral: caja.toNumber(),
            bancos: bancos.toNumber(),
            efectivoTotal: efectivoTotal.toNumber(),
            cuentasPorCobrar: cxc.toNumber(),
            inventario: inventario.toNumber(),
            cuentasPorPagar: cxp.toNumber(),
            liquidezLibre: liquidezLibre.toDecimalPlaces(4).toNumber(),
            // NX-02 (NUEVO): lo que SÍ se puede retirar sin descapitalizar el negocio.
            retiroSeguro: retiroSeguro.toNumber()
        };

        res.json({
            tenant: tenant,
            chartData: chartData,
            todayStats: {
                totalSales: totalSalesToday.toNumber(),
                totalExpenses: totalExpensesToday.toNumber(),
                // netProfit ahora es utilidad REAL: gananciaBruta − gastos del día
                // (antes era ventas brutas − gastos, sin costo de mercadería).
                netProfit: netProfitToday.toNumber(),
                // NX-01 (NUEVOS): desglose de la ganancia del día.
                gananciaBruta: margenHoy.gananciaBruta.toNumber(),
                ingresoNeto: margenHoy.ingresoNeto.toNumber(),
                costoVendido: margenHoy.costoVendido.toNumber(),
                // Líneas vendidas sin costo registrado: la ganancia está
                // SOBREESTIMADA y la UI debe advertirlo.
                lineasSinCosto: margenHoy.lineasSinCosto,
            },
            alerts: recentAlerts.map((a: any) => ({
                id: a.id,
                action: a.action,
                details: a.details ? JSON.parse(a.details) : {},
                createdAt: a.createdAt
            })),
            survivalData: survivalData
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error fetching dashboard stats' });
    }
});

app.get('/api/fintech/score', authenticate, checkRole(['OWNER', 'ADMIN']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const riskAnalysis = await calculateTenantScore(authReq.tenantId!);
        const updatedTenant = await prisma.tenant.update({
            where: { id: authReq.tenantId },
            data: { creditScore: riskAnalysis.score, creditLimit: riskAnalysis.creditLimit }
        });
        res.json({ tenant: updatedTenant, analysis: riskAnalysis });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error calculando riesgo crediticio.' });
    }
});

// Schema Zod inline (evita colisión en schemas.ts): monto positivo finito.
const LoanRequestSchema = z.object({
    amount: z
        .union([z.string(), z.number()])
        .transform((v) => String(v))
        .refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0, {
            message: 'El monto debe ser mayor que cero',
        }),
});

app.post('/api/loans/request', authenticate, checkRole(['OWNER', 'ADMIN']), validate(LoanRequestSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const amount = new Decimal(req.body.amount);
    try {
        const updated = await prisma.$transaction(async (tx: any) => {
            const tenant = await tx.tenant.findUnique({ where: { id: authReq.tenantId } });
            if (!tenant) throw new Error('TENANT_NOT_FOUND');

            const walletBefore = new Decimal(tenant.walletBalance.toString());
            const creditLimitBefore = new Decimal(tenant.creditLimit.toString());

            if (amount.greaterThan(creditLimitBefore)) throw new Error('RIESGO_ALTO');

            // Decremento atómico condicionado: solo aplica si la línea de crédito
            // sigue alcanzando (evita doble-giro/TOCTOU bajo concurrencia).
            const applied = await tx.tenant.updateMany({
                where: { id: authReq.tenantId, creditLimit: { gte: amount.toString() } },
                data: {
                    walletBalance: { increment: amount.toString() },
                    creditLimit: { decrement: amount.toString() },
                },
            });
            if (applied.count === 0) throw new Error('RIESGO_ALTO');

            const result = await tx.tenant.findUnique({ where: { id: authReq.tenantId } });

            // Asiento inmutable del desembolso a wallet, con before/after, dentro de la tx.
            await tx.auditLog.create({
                data: {
                    tenantId: authReq.tenantId,
                    userId: authReq.userId,
                    action: 'LOAN_WALLET_DISBURSED',
                    details: JSON.stringify({
                        amount: amount.toString(),
                        before: { walletBalance: walletBefore.toString(), creditLimit: creditLimitBefore.toString() },
                        after: {
                            walletBalance: new Decimal(result.walletBalance.toString()).toString(),
                            creditLimit: new Decimal(result.creditLimit.toString()).toString(),
                        },
                    }),
                },
            });

            return result;
        });
        res.json(updated);
    } catch (error: any) {
        if (error.message === 'TENANT_NOT_FOUND') return res.status(404).json({ error: 'Tenant not found' });
        if (error.message === 'RIESGO_ALTO') return res.status(400).json({ error: 'RIESGO ALTO' });
        console.error(error);
        res.status(500).json({ error: 'Error' });
    }
});

// ==========================================
// 🌍 B2B MARKETPLACE (ACID TRANSACTIONS + EXPENSE TRACKING)
// ==========================================

app.post('/api/b2b/order', authenticate, checkRole(['OWNER', 'ADMIN']), validate(B2BOrderSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { items, total } = req.body;
    // Zod ya garantizó total > 0 y finito; Decimal evita floats intermedios.
    const orderTotal = new Decimal(total);

    try {
        const result = await prisma.$transaction(async (tx: any) => {
            // 1. Débito CONDICIONAL atómico: la suficiencia de saldo y el decremento
            //    son la MISMA sentencia (sin ventana entre chequeo y escritura: ni
            //    sobregiro por concurrencia ni montos negativos que "acrediten").
            const debited = await tx.tenant.updateMany({
                where: { id: authReq.tenantId, walletBalance: { gte: orderTotal.toFixed(4) } },
                data: { walletBalance: { decrement: orderTotal.toFixed(4) } }
            });
            if (debited.count === 0) {
                throw new Error('SALDO_INSUFICIENTE');
            }
            const updatedTenant = await tx.tenant.findUnique({ where: { id: authReq.tenantId } });

            // 2. Create Marketplace Order Record
            const order = await tx.b2BOrder.create({
                data: {
                    tenantId: authReq.tenantId,
                    total: orderTotal.toFixed(4),
                    items: items, // Stored as JSON
                    status: 'PENDING'
                }
            });

            // 3. Register Expense (Accounting)
            await tx.expense.create({
                data: {
                    tenantId: authReq.tenantId,
                    amount: orderTotal.toFixed(2),
                    description: `Orden B2B #${order.id.slice(0, 8)}`,
                    category: 'INVENTORY'
                }
            });

            // 4. AuditLog inmutable del movimiento de wallet, en la MISMA tx
            //    (before derivado del after bajo el row-lock del débito).
            const walletAfter = new Decimal(updatedTenant.walletBalance.toString());
            await tx.auditLog.create({
                data: {
                    tenantId: authReq.tenantId,
                    userId: authReq.userId,
                    action: 'B2B_ORDER',
                    details: JSON.stringify({
                        orderId: order.id,
                        total: orderTotal.toFixed(4),
                        walletBefore: walletAfter.plus(orderTotal).toFixed(4),
                        walletAfter: walletAfter.toFixed(4)
                    })
                }
            });

            return { tenant: updatedTenant, order };
        });

        res.json(result);

    } catch (error: any) {
        if (error.message === 'SALDO_INSUFICIENTE') {
            return res.status(402).json({ error: 'Saldo insuficiente en Wallet.' });
        }
        console.error(error);
        res.status(500).json({ error: 'Error procesando la orden.' });
    }
});

// ==========================================
// 👥 CRM: CLIENTES (Risk & Profile)
// ==========================================

// Schemas Zod inline para clientes (definidos aquí para evitar colisión en schemas.ts).
const CustomerCreditLimit = z
    .union([z.string(), z.number()])
    .transform((v) => String(v))
    .refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) >= 0, {
        message: 'El límite de crédito debe ser un número mayor o igual a 0',
    });

const CreateCustomerSchema = z.object({
    name: z.string().min(1, 'El nombre es requerido'),
    taxId: z.string().optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
    email: z.string().optional(),
    creditLimit: CustomerCreditLimit.optional(),
    isWholesale: z.boolean().optional(),
    sellerId: z.string().min(1).nullable().optional(),
});

const UpdateCustomerSchema = z.object({
    creditLimit: CustomerCreditLimit.optional(),
    isBlocked: z.boolean().optional(),
    isWholesale: z.boolean().optional(),
    sellerId: z.string().min(1).nullable().optional(),
});

// Vendedores: quién puede ASIGNAR cartera. La regla tiene tres ramas para que
// el POST sin checkRole no sea una puerta lateral:
//  · OWNER/ADMIN/MANAGER asignan a quien quieran (validado contra el tenant).
//  · VENDEDOR se auto-asigna SIEMPRE: lo que venga en el body se ignora —
//    defaultearlo no basta, porque un vendedor podría crear el cliente
//    apuntado a OTRO vendedor (o una cajera inflarle la cartera a alguien).
//  · El resto de roles no asigna: sellerId se descarta en silencio.
function resolverSellerIdAlCrear(role: string | undefined, userId: string, sellerIdDelBody: string | null | undefined): string | null | undefined {
    if (role === 'VENDEDOR') return userId;
    if (role === 'OWNER' || role === 'ADMIN' || role === 'MANAGER') return sellerIdDelBody;
    return undefined;
}

// Guard cross-tenant de la asignación: el User apuntado tiene que ser del
// MISMO tenant y estar activo. Sin esto, un OWNER apunta sellerId a un userId
// de otro tenant y el include del seller filtra nombres ajenos. (Versión más
// fuerte que el precedente de loans.ts, que no chequea DISABLED.)
async function validarSellerDelTenant(sellerId: string, tenantId: string): Promise<boolean> {
    const seller = await prisma.user.findFirst({
        where: { id: sellerId, tenantId, status: { not: 'DISABLED' } },
        select: { id: true },
    });
    return seller !== null;
}

app.post('/api/customers', authenticate, validate(CreateCustomerSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { name, taxId, phone, address, creditLimit, email, isWholesale } = req.body;

    try {
        const sellerId = resolverSellerIdAlCrear(authReq.role, authReq.userId!, req.body.sellerId);
        if (sellerId != null && authReq.role !== 'VENDEDOR' && !(await validarSellerDelTenant(sellerId, authReq.tenantId!))) {
            return res.status(400).json({ error: 'Vendedor inválido' });
        }
        const customer = await prisma.customer.create({
            data: {
                tenantId: authReq.tenantId,
                name,
                taxId,
                phone,
                email,
                address,
                creditLimit: creditLimit !== undefined ? new Decimal(creditLimit).toDecimalPlaces(2).toString() : 0,
                currentDebt: 0,
                isBlocked: false,
                isWholesale: Boolean(isWholesale),
                sellerId: sellerId ?? null
            }
        });
        res.json(customer);
    } catch (error) {
        res.status(500).json({ error: 'Error creando cliente' });
    }
});

app.get('/api/customers', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { search } = req.query;
    try {
        const whereClause: any = { tenantId: authReq.tenantId };
        if (search) {
            whereClause.OR = [
                { name: { contains: String(search) } }, // Case insensitive in real DB usually
                { taxId: { contains: String(search) } }
            ];
        }
        // Cartera por vendedor: ?sellerId=<id> filtra; ?sellerId=none trae los
        // sin asignar. Un sellerId de otro tenant da lista vacía por el where
        // compuesto con tenantId — no hace falta validarlo acá.
        const { sellerId } = req.query;
        if (sellerId === 'none') whereClause.sellerId = null;
        else if (sellerId) whereClause.sellerId = String(sellerId);

        const customers = await prisma.customer.findMany({
            where: whereClause,
            orderBy: { name: 'asc' },
            take: 50,
            include: { seller: { select: { id: true, name: true, status: true } } }
        });
        res.json(customers);
    } catch (error) {
        res.status(500).json({ error: 'Error obteniendo cartera' });
    }
});

app.put('/api/customers/:id', authenticate, checkRole(['OWNER', 'ADMIN']), validate(UpdateCustomerSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { id } = req.params;
    const { creditLimit, isBlocked, isWholesale, sellerId } = req.body;

    try {
        // La REasignación de cartera es de OWNER/ADMIN (el checkRole de esta
        // ruta ya lo garantiza). Validar el destino ANTES de la transacción.
        if (sellerId != null && !(await validarSellerDelTenant(sellerId, authReq.tenantId!))) {
            return res.status(400).json({ error: 'Vendedor inválido' });
        }
        await prisma.$transaction(async (tx: any) => {
            // Verificar propiedad dentro del tenant (patrón de /api/suppliers PUT).
            const existing = await tx.customer.findFirst({ where: { id, tenantId: authReq.tenantId } });
            if (!existing) throw new Error('CUSTOMER_NOT_FOUND');

            const data: any = {};
            if (creditLimit !== undefined) data.creditLimit = new Decimal(creditLimit).toDecimalPlaces(2).toString();
            if (isBlocked !== undefined) data.isBlocked = Boolean(isBlocked);
            if (isWholesale !== undefined) data.isWholesale = Boolean(isWholesale);
            if (sellerId !== undefined) data.sellerId = sellerId; // null = desasignar

            if (Object.keys(data).length === 0) return;

            const updated = await tx.customer.update({ where: { id }, data });

            // Auditoría de controles de crédito sensibles (límite / bloqueo).
            await tx.auditLog.create({
                data: {
                    tenantId: authReq.tenantId,
                    userId: authReq.userId,
                    action: 'CUSTOMER_CREDIT_UPDATED',
                    details: JSON.stringify({
                        customerId: id,
                        before: { creditLimit: existing.creditLimit.toString(), isBlocked: existing.isBlocked, sellerId: existing.sellerId },
                        after: { creditLimit: updated.creditLimit.toString(), isBlocked: updated.isBlocked, sellerId: updated.sellerId },
                    }),
                },
            });
        });
        res.json({ success: true });
    } catch (e: any) {
        if (e.message === 'CUSTOMER_NOT_FOUND') return res.status(404).json({ error: 'Cliente no encontrado' });
        console.error(e);
        res.status(500).json({ error: 'Error' });
    }
});

// ── Vendedores Fase B: CATÁLOGO ASIGNADO ────────────────────────────────────
// Qué productos vende cada vendedor. OPT-IN: sin filas, el vendedor ve el
// catálogo completo (comportamiento de siempre). La gestión es OWNER/ADMIN.

// GET /api/sellers/:sellerId/catalog — ids de productos asignados
app.get('/api/sellers/:sellerId/catalog', authenticate, checkRole(['OWNER', 'ADMIN']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const rows = await prisma.sellerProduct.findMany({
            where: { tenantId: authReq.tenantId!, sellerId: req.params.sellerId },
            select: { productId: true },
        });
        res.json({ productIds: rows.map(r => r.productId) });
    } catch (e) {
        console.error('Catálogo de vendedor:', e);
        res.status(500).json({ error: 'Error leyendo el catálogo del vendedor' });
    }
});

const SellerCatalogSchema = z.object({
    productIds: z.array(z.string().min(1)).max(2000),
});

// PUT /api/sellers/:sellerId/catalog — REEMPLAZA el set completo (semántica
// simple y auditable: lo que mandás es lo que queda; [] = quitar el catálogo
// y volver a "ve todo").
app.put('/api/sellers/:sellerId/catalog', authenticate, checkRole(['OWNER', 'ADMIN']), validate(SellerCatalogSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const sellerId = String(req.params.sellerId);
    const productIds: string[] = [...new Set(req.body.productIds as string[])];
    try {
        // El vendedor tiene que ser del MISMO tenant y estar activo.
        if (!(await validarSellerDelTenant(sellerId, authReq.tenantId!))) {
            return res.status(400).json({ error: 'Vendedor inválido' });
        }
        // Y cada producto también es del tenant — un id ajeno no entra al set.
        const propios = await prisma.product.findMany({
            where: { id: { in: productIds }, tenantId: authReq.tenantId! },
            select: { id: true },
        });
        if (propios.length !== productIds.length) {
            return res.status(400).json({ error: 'Uno o más productos no existen en tu inventario' });
        }
        await prisma.$transaction([
            prisma.sellerProduct.deleteMany({ where: { tenantId: authReq.tenantId!, sellerId } }),
            ...(productIds.length
                ? [prisma.sellerProduct.createMany({
                      data: productIds.map(productId => ({ tenantId: authReq.tenantId!, sellerId, productId })),
                  })]
                : []),
            prisma.auditLog.create({
                data: {
                    tenantId: authReq.tenantId!,
                    userId: authReq.userId!,
                    action: 'SELLER_CATALOG_UPDATED',
                    details: JSON.stringify({ sellerId, count: productIds.length }),
                },
            }),
        ]);
        res.json({ success: true, count: productIds.length });
    } catch (e) {
        console.error('Catálogo de vendedor:', e);
        res.status(500).json({ error: 'Error guardando el catálogo del vendedor' });
    }
});

// ==========================================
// 📦 SRM: PROVEEDORES
// ==========================================

app.get('/api/suppliers', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const suppliers = await prisma.supplier.findMany({
            where: { tenantId: authReq.tenantId },
            orderBy: { name: 'asc' }
        });
        res.json(suppliers);
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

// Schema Zod inline para creación de proveedor (definido aquí para evitar colisión en schemas.ts).
const CreateSupplierSchema = z.object({
    name: z.string().trim().min(1, 'El nombre es requerido'),
    ruc: z.string().trim().optional(),
    contactName: z.string().trim().optional(),
    phone: z.string().trim().optional(),
    email: z.string().trim().email('Email inválido').optional().or(z.literal('')),
    address: z.string().trim().optional(),
    category: z.string().trim().optional(),
});

app.post('/api/suppliers', authenticate, checkRole(['OWNER', 'ADMIN']), validate(CreateSupplierSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { name, ruc, contactName, phone, email, address, category } = req.body;
    try {
        const supplier = await prisma.supplier.create({
            data: { tenantId: authReq.tenantId, name, contactName, phone, email, category, ruc, address } as any
        });
        res.json(supplier);
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

// PUT /api/suppliers/:id - Actualizar proveedor (Bodeguero C2 — completa el CRUD)
app.put('/api/suppliers/:id', authenticate, checkRole(['OWNER', 'ADMIN']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { id } = req.params;
    const { name, ruc, contactName, phone, email, address, category } = req.body;
    try {
        const existing = await prisma.supplier.findFirst({ where: { id, tenantId: authReq.tenantId! } });
        if (!existing) return res.status(404).json({ error: 'Proveedor no encontrado' });

        const data: any = {};
        if (name !== undefined) data.name = name;
        if (ruc !== undefined) data.ruc = ruc;
        if (contactName !== undefined) data.contactName = contactName;
        if (phone !== undefined) data.phone = phone;
        if (email !== undefined) data.email = email;
        if (address !== undefined) data.address = address;
        if (category !== undefined) data.category = category;

        const supplier = await prisma.supplier.update({ where: { id }, data });
        res.json(supplier);
    } catch (error: any) {
        console.error('Error updating supplier:', error);
        res.status(500).json({ error: 'Error actualizando proveedor' });
    }
});

// DELETE /api/suppliers/:id - Eliminar proveedor (solo si no tiene compras)
app.delete('/api/suppliers/:id', authenticate, checkRole(['OWNER', 'ADMIN']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { id } = req.params;
    try {
        const existing = await prisma.supplier.findFirst({ where: { id, tenantId: authReq.tenantId! } });
        if (!existing) return res.status(404).json({ error: 'Proveedor no encontrado' });

        const purchases = await prisma.purchase.count({ where: { supplierId: id, tenantId: authReq.tenantId! } });
        if (purchases > 0) {
            return res.status(409).json({ error: `No se puede eliminar: el proveedor tiene ${purchases} compra(s) registrada(s).` });
        }

        // Los productos que lo tenían por defecto quedan en null (onDelete: SetNull).
        await prisma.supplier.delete({ where: { id } });
        res.json({ message: 'Proveedor eliminado' });
    } catch (error: any) {
        console.error('Error deleting supplier:', error);
        res.status(500).json({ error: 'Error eliminando proveedor' });
    }
});


// ==========================================
// 👔 RRHH: EMPLEADOS & NÓMINA (LÓGICA REAL AGREGADA)
// ==========================================

app.get('/api/employees', authenticate, checkRole(['OWNER', 'ADMIN', 'MANAGER', 'ACCOUNTANT']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        // 1. Fetch Employees
        const employees = await prisma.employee.findMany({
            where: { tenantId: authReq.tenantId },
            orderBy: { firstName: 'asc' }
        });

        // 2. Aggregate Sales by Employee (SQL Optimized)
        const salesStats = await prisma.sale.groupBy({
            by: ['employeeId'],
            where: {
                tenantId: authReq.tenantId,
                createdAt: { gte: startOfMonth },
                employeeId: { not: null }
            },
            _sum: {
                total: true
            }
        });

        // 3. Map Results
        const employeesWithSales = employees.map((emp: any) => {
            const stat = salesStats.find((s: any) => s.employeeId === emp.id);
            // Omitir credenciales/PII sensible (PIN de asistencia y cuenta bancaria) de la respuesta.
            const { pin, bankAccount, ...safeEmp } = emp;
            return {
                ...safeEmp,
                salesMonthToDate: stat?._sum.total ? Number(stat._sum.total) : 0
            };
        });

        res.json(employeesWithSales);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error fetching employees' });
    }
});

// Schema Zod inline para creación de empleado (definido aquí para evitar colisión en schemas.ts).
const EmployeeNumericNonNeg = z
    .union([z.string(), z.number()])
    .transform((v) => Number(v))
    .refine((v) => !isNaN(v) && v >= 0, { message: 'Debe ser un número mayor o igual a 0' });

const CreateEmployeeSchema = z.object({
    firstName: z.string().trim().min(1, 'El nombre es requerido'),
    lastName: z.string().trim().min(1, 'El apellido es requerido'),
    role: z.string().trim().min(1, 'El rol es requerido'),
    baseSalary: EmployeeNumericNonNeg,
    commissionRate: EmployeeNumericNonNeg.optional().default(0),
    phone: z.string().trim().optional(),
    pin: z.union([z.string(), z.number()]).optional(),
    cedula: z.string().trim().optional(),
    inss: z.string().trim().optional(),
    jornada: z.string().trim().optional(),
});

app.post('/api/employees', authenticate, checkRole(['OWNER', 'ADMIN', 'ACCOUNTANT']), validate(CreateEmployeeSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { firstName, lastName, role, baseSalary, commissionRate, phone, pin, cedula, inss, jornada } = req.body;

    // Validar PIN de 4 dígitos
    const employeePin = pin ? String(pin).trim() : '0000';
    if (!/^\d{4}$/.test(employeePin)) {
        return res.status(400).json({ error: 'El PIN debe ser exactamente 4 dígitos numéricos.' });
    }

    try {
        // Verificar que no exista otro empleado con el mismo PIN en el tenant
        const existingPin = await prisma.employee.findFirst({
            where: { tenantId: authReq.tenantId, pin: employeePin }
        });
        if (existingPin) {
            return res.status(400).json({ error: `El PIN ${employeePin} ya está asignado a ${existingPin.firstName} ${existingPin.lastName}. Usa otro.` });
        }

        const employee = await prisma.employee.create({
            data: {
                tenantId: authReq.tenantId,
                firstName,
                lastName,
                role,
                baseSalary: Number(baseSalary),
                commissionRate: Number(commissionRate),
                phone,
                pin: employeePin,
                cedula: cedula || null,
                inss: inss || null,
                jornada: ['DIURNA', 'NOCTURNA', 'MIXTA'].includes(jornada) ? jornada : 'DIURNA',
            }
        });
        res.json(employee);
    } catch (error) { res.status(500).json({ error: 'Error creando empleado' }); }
});

// PATCH /api/employees/:id/pin — Cambiar PIN de empleado
app.patch('/api/employees/:id/pin', authenticate, checkRole(['OWNER', 'ADMIN', 'MANAGER']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { id } = req.params;
    const { pin } = req.body;

    if (!pin || !/^\d{4}$/.test(String(pin))) {
        return res.status(400).json({ error: 'El PIN debe ser exactamente 4 dígitos numéricos.' });
    }

    try {
        // Verificar que el empleado pertenece al tenant
        const employee = await prisma.employee.findFirst({
            where: { id, tenantId: authReq.tenantId }
        });
        if (!employee) return res.status(404).json({ error: 'Empleado no encontrado.' });

        // Verificar que el PIN no esté en uso por otro empleado del mismo tenant
        const pinConflict = await prisma.employee.findFirst({
            where: { tenantId: authReq.tenantId, pin: String(pin), id: { not: id } }
        });
        if (pinConflict) {
            return res.status(400).json({
                error: `PIN ${pin} ya está asignado a ${pinConflict.firstName} ${pinConflict.lastName}. Usa otro.`
            });
        }

        const updated = await prisma.employee.update({
            where: { id },
            data: { pin: String(pin) }
        });
        res.json({ message: 'PIN actualizado correctamente.', employee: updated });
    } catch (error) { res.status(500).json({ error: 'Error actualizando PIN.' }); }
});

// ==========================================
// 🛒 MÓDULO DE VENTAS — delegado a salesService
// ==========================================

app.post('/api/sales', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const currentShift = await prisma.shift.findFirst({
            // Capa 1: el tenant sale del JWT y va SIEMPRE en el where.
            where: { tenantId: authReq.tenantId, userId: authReq.userId, status: 'OPEN' },
        });
        // S36 — el canal se FIJA server-side: este es el endpoint del cajero (POS).
        // Antes `source` salía de req.body, y mandar source:'WHATSAPP'/'PUBLIC_ORDER'
        // saltaba el requisito de turno abierto (el gate `if (source === 'POS')`).
        // WHATSAPP/PUBLIC_ORDER llaman a executeSale server-side, no por esta ruta.
        const result = await executeSale(
            authReq.tenantId!,
            authReq.userId!,
            currentShift?.id ?? null,
            { ...req.body, source: 'POS' }
        );
        res.json(result);
    } catch (error) {
        if (error instanceof SaleError) {
            return res.status(error.httpStatus).json({ error: error.message, code: error.code });
        }
        console.error('Error procesando venta:', error);
        res.status(500).json({ error: 'Error procesando venta' });
    }
});

// ==========================================
// 🔄 DEVOLUCIONES / NOTAS DE CRÉDITO
// ==========================================

// Search sale for return flow
app.get('/api/sales/search', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { q } = req.query;
    try {
        const sale = await prisma.sale.findFirst({
            where: {
                tenantId: authReq.tenantId,
                id: { startsWith: String(q) }
            },
            include: {
                items: true,
                customer: { select: { id: true, name: true } }
            }
        });
        if (!sale) return res.status(404).json({ error: 'Venta no encontrada' });
        res.json(sale);
    } catch (error) { res.status(500).json({ error: 'Error buscando venta' }); }
});

// Process return
app.post('/api/returns', authenticate, checkRole(['OWNER', 'ADMIN']), validate(CreateReturnSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { saleId, items, reason } = req.body;
    // items: [{productId, quantity, price}] — price/quantity del cliente NO son de confianza.

    try {
        const sale = await prisma.sale.findFirst({
            where: { id: saleId, tenantId: authReq.tenantId },
            // Cargar cantidad, precio y costo REALES de la venta (fijados por el servidor).
            include: { items: { select: { productId: true, quantity: true, priceAtSale: true, costAtSale: true } } },
        });
        if (!sale) return res.status(404).json({ error: 'Venta no encontrada' });

        // Índices por producto tomados de la venta ORIGINAL (fuente de verdad del servidor).
        const soldQtyByProduct = new Map<string, Decimal>();
        const priceByProduct = new Map<string, Decimal>();
        const costByProduct = new Map<string, Decimal>();
        for (const it of sale.items) {
            soldQtyByProduct.set(it.productId, new Decimal(it.quantity.toString()));
            priceByProduct.set(it.productId, new Decimal(it.priceAtSale.toString()));
            costByProduct.set(it.productId, new Decimal(it.costAtSale.toString()));
        }

        // Devoluciones previas de esta venta: acumular cantidad ya devuelta por producto
        // para impedir devolver más de lo vendido a través de múltiples notas de crédito.
        const previousReturns = await prisma.productReturn.findMany({
            where: { saleId, tenantId: authReq.tenantId },
            select: { items: true },
        });
        const returnedQtyByProduct = new Map<string, Decimal>();
        for (const pr of previousReturns) {
            const prevItems = Array.isArray(pr.items) ? (pr.items as any[]) : [];
            for (const pi of prevItems) {
                const pid = String(pi.productId);
                const q = new Decimal(Number(pi.quantity) || 0);
                returnedQtyByProduct.set(pid, (returnedQtyByProduct.get(pid) ?? new Decimal(0)).plus(q));
            }
        }

        // Validar cada ítem contra la venta y construir la lista saneada (precio del servidor).
        const validatedItems: { productId: string; quantity: Decimal; price: Decimal }[] = [];
        for (const item of items) {
            const pid = String(item.productId);
            const soldQty = soldQtyByProduct.get(pid);
            const unitPrice = priceByProduct.get(pid);
            // (a) el producto debe pertenecer a la venta original.
            if (soldQty === undefined || unitPrice === undefined) {
                return res.status(400).json({ error: `El producto ${pid} no pertenece a la venta.` });
            }
            // (b) cantidad solicitada <= vendida - ya devuelta.
            const reqQty = new Decimal(Number(item.quantity) || 0);
            const alreadyReturned = returnedQtyByProduct.get(pid) ?? new Decimal(0);
            const remaining = soldQty.minus(alreadyReturned);
            if (reqQty.lessThanOrEqualTo(0) || reqQty.greaterThan(remaining)) {
                return res.status(400).json({
                    error: `Cantidad a devolver inválida para el producto ${pid} (disponible: ${remaining.toString()}).`,
                });
            }
            // (c) usar el precio de la venta (no el del cliente).
            validatedItems.push({ productId: pid, quantity: reqQty, price: unitPrice });
        }

        // returnTotal con el precio REAL de la venta, en decimal.js (Capa 4).
        const returnTotalDec = validatedItems
            .reduce((acc, it) => acc.plus(it.price.mul(it.quantity)), new Decimal(0))
            .toDecimalPlaces(2);
        const returnTotal = returnTotalDec.toNumber();

        // Persistir los ítems saneados (cantidad y precio del servidor, no los del cliente).
        const persistItems = validatedItems.map((it) => ({
            productId: it.productId,
            quantity: it.quantity.toNumber(),
            price: it.price.toNumber(),
        }));

        const result = await prisma.$transaction(async (tx: any) => {
            // 1. Create return record
            const productReturn = await tx.productReturn.create({
                data: {
                    tenantId: authReq.tenantId,
                    saleId,
                    total: returnTotal,
                    reason: reason || 'Devolución de producto',
                    items: persistItems,
                    createdBy: authReq.userId,
                }
            });

            // 2. Restore stock for each returned item (incremento atómico —
            //    stockBefore/After salen del row-lock, no de una lectura previa)
            for (const item of validatedItems) {
                const qty = item.quantity.toNumber();
                let stockResult;
                try {
                    stockResult = await applyStockDelta(tx, {
                        tenantId: authReq.tenantId,
                        productId: item.productId,
                        delta: qty,
                        enforceSufficient: false,
                    });
                } catch (err) {
                    if (err instanceof StockError && err.code === 'PRODUCT_NOT_FOUND') continue;
                    throw err;
                }

                // Kardex: register stock return
                await tx.kardexMovement.create({
                    data: {
                        tenantId: authReq.tenantId,
                        productId: item.productId,
                        type: 'RETURN',
                        quantity: qty,
                        stockBefore: stockResult.stockBefore,
                        stockAfter: stockResult.stockAfter,
                        referenceId: productReturn.id,
                        referenceType: 'RETURN',
                        reason: `Devolución: ${reason || 'Sin motivo'}`,
                        userId: authReq.userId,
                    }
                });
            }

            // 3. Update customer debt if credit sale
            let debtBefore: string | null = null;
            let debtAfter: string | null = null;
            if (sale.customerId && sale.paymentMethod === 'CREDIT') {
                // Capturar saldo previo del cliente (before) antes del decremento, para el AuditLog.
                const prevCustomer = await tx.customer.findFirst({
                    where: { id: sale.customerId, tenantId: authReq.tenantId },
                    select: { currentDebt: true },
                });
                debtBefore = prevCustomer ? String(prevCustomer.currentDebt) : null;
                const updatedCustomer = await tx.customer.update({
                    where: { id: sale.customerId, tenantId: authReq.tenantId },  // tenant isolation
                    data: { currentDebt: { decrement: returnTotal } }
                });
                debtAfter = String(updatedCustomer.currentDebt);
            }

            // 📊 MOTOR CONTABLE: Registrar devolución
            // Costo de lo devuelto: reversa el costo REAL que la venta registró
            // (SaleItem.costAtSale, fijado por el servidor), no una aproximación.
            const costTotal = validatedItems.reduce(
                (sum, item) => sum.plus((costByProduct.get(item.productId) ?? new Decimal(0)).mul(item.quantity)),
                new Decimal(0)
            ).toDecimalPlaces(2).toNumber();
            try {
                await recordReturn(tx, authReq.tenantId!, authReq.userId!, productReturn.id, returnTotal, costTotal);
            } catch (accErr) { console.warn('⚠️ Accounting hook failed (return continues):', accErr); }

            // 📝 AUDITORÍA INMUTABLE: la devolución mueve dinero e inventario (Capa 3).
            await tx.auditLog.create({
                data: {
                    tenantId: authReq.tenantId!,
                    userId: authReq.userId!,
                    action: 'RETURN_CREATED',
                    details: JSON.stringify({
                        saleId,
                        returnId: productReturn.id,
                        total: String(returnTotal),
                        costTotal: String(costTotal),
                        items: persistItems,
                        debtBefore,
                        debtAfter,
                    }),
                },
            });

            return productReturn;
        });

        res.json(result);
    } catch (error: any) {
        console.error(error);
        res.status(500).json({ error: error.message || 'Error procesando devolución' });
    }
});

// ==========================================
// 💸 PAGOS
// ==========================================

// ⚠️ DEPRECADA: ningún componente del SPA llama esta ruta — los abonos a crédito
// entran por /api/credits/payment. Se mantiene funcional por compatibilidad de API,
// pero NO construir consumidores nuevos sobre ella: unificar sobre /api/credits/payment.
app.post('/api/payments', authenticate, validate(CreatePaymentSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { saleId, amount, method } = req.body;
    const paymentAmount = new Decimal(amount).toNumber();
    try {
        // Tenant isolation: buscar venta filtrando por tenantId directamente en la query
        const sale = await prisma.sale.findFirst({
            where: { id: saleId, tenantId: authReq.tenantId },
            include: { customer: true }
        });
        if (!sale) return res.status(404).json({ error: 'Venta no encontrada' });

        // Solo se cobran ventas a crédito con saldo pendiente. Bloquear ventas
        // CASH/CARD (aunque tengan customerId) y sobrepagos que dejarían el balance
        // y la deuda del cliente en negativo. Validación autoritativa se re-hace bajo
        // lock dentro de la transacción; esta pre-validación da un 400 limpio.
        if (sale.status !== 'CREDIT_PENDING' || new Decimal(sale.balance.toString()).lessThanOrEqualTo(0)) {
            return res.status(400).json({ error: 'La venta no tiene saldo de crédito pendiente' });
        }
        if (new Decimal(amount).greaterThan(new Decimal(sale.balance.toString()))) {
            return res.status(400).json({ error: 'El monto excede el saldo pendiente de la venta' });
        }

        const result = await prisma.$transaction(async (tx: any) => {
            // Bloqueo pesimista de la fila de venta (FOR UPDATE): el balance autoritativo
            // se lee bajo lock DENTRO de la transacción para evitar lost-update entre pagos
            // concurrentes. La consulta va parametrizada (tagged template) contra inyección.
            const locked: Array<{ balance: any; status: string }> = await tx.$queryRaw`
                SELECT balance, status FROM \`Sale\`
                WHERE id = ${saleId} AND \`tenantId\` = ${authReq.tenantId}
                FOR UPDATE`;
            if (locked.length === 0) throw new Error('Venta no encontrada');
            const balanceBefore = new Decimal(locked[0].balance.toString());
            const statusBefore = locked[0].status;
            // Re-validación bajo lock (race-safe): solo crédito pendiente y sin sobrepago.
            if (statusBefore !== 'CREDIT_PENDING' || balanceBefore.lessThanOrEqualTo(0)) {
                throw new Error('La venta no tiene saldo de crédito pendiente');
            }
            if (new Decimal(amount).greaterThan(balanceBefore)) {
                throw new Error('El monto excede el saldo pendiente de la venta');
            }
            const balanceAfter = balanceBefore.minus(paymentAmount).toDecimalPlaces(2);
            const newStatus = balanceAfter.lessThanOrEqualTo(0.01) ? 'PAID' : 'CREDIT_PENDING';

            const payment = await tx.payment.create({
                data: { saleId: sale.id, amount: paymentAmount, method: method || 'CASH', collectedBy: authReq.userId }
            });

            // Decremento relativo atómico del balance; el status se recomputa desde el
            // balance resultante (calculado sobre la lectura bloqueada), sin escribir absolutos.
            await tx.sale.update({
                where: { id: saleId, tenantId: authReq.tenantId },  // tenant isolation en update
                data: { balance: { decrement: paymentAmount }, status: newStatus }
            });

            let debtBefore: string | null = null;
            let debtAfter: string | null = null;
            if (sale.customerId) {
                const prevCustomer = await tx.customer.findFirst({
                    where: { id: sale.customerId, tenantId: authReq.tenantId },
                    select: { currentDebt: true },
                });
                debtBefore = prevCustomer ? String(prevCustomer.currentDebt) : null;
                const updatedCustomer = await tx.customer.update({
                    where: { id: sale.customerId, tenantId: authReq.tenantId },  // tenant isolation
                    data: { currentDebt: { decrement: paymentAmount } }
                });
                debtAfter = String(updatedCustomer.currentDebt);
            }

            // 📊 MOTOR CONTABLE: Debe Caja (1.1.1) / Haber CxC (1.1.3). Antes nunca se invocaba.
            await recordPayment(tx, authReq.tenantId!, authReq.userId!, payment.id, paymentAmount);

            // 📝 AUDITORÍA INMUTABLE del cobro (Capa 3): before/after de balance/status/deuda.
            await tx.auditLog.create({
                data: {
                    tenantId: authReq.tenantId!,
                    userId: authReq.userId!,
                    action: 'PAYMENT_RECEIVED',
                    details: JSON.stringify({
                        saleId,
                        paymentId: payment.id,
                        amount: String(paymentAmount),
                        balanceBefore: String(balanceBefore),
                        balanceAfter: String(balanceAfter),
                        statusBefore,
                        statusAfter: newStatus,
                        method: method ?? 'CASH',
                        debtBefore,
                        debtAfter,
                    }),
                },
            });

            return payment;
        });
        res.json(result);
    } catch (error: any) {
        console.error('Error procesando pago:', error);
        res.status(500).json({ error: error.message || 'Error procesando pago' });
    }
});

// --- OPERATIONAL CONTROL (SHIFTS & AUDITS) - Preserved ---
// (Preserved endpoints for shifts and audits)
/**
 * GET /api/shifts/current — Turno de la caja donde está parado el cajero.
 *
 * CONTRATO: sigue devolviendo el objeto Shift (o null), con la misma forma de
 * siempre. NUEVO: dos campos al lado —`esTurnoPropio` y `turnoDe`—.
 *
 * Por qué devuelve también el turno AJENO: antes solo buscaba el turno del
 * userId del token, así que cuando la caja la había abierto el dueño o el
 * cajero del turno anterior, el POS se comportaba como si no hubiera caja
 * abierta —C$0.00 y botones muertos— mientras la gaveta tenía plata real.
 *
 * Pero devolverlo NO habilita a vender: `POST /api/sales` sigue exigiendo turno
 * PROPIO. Con `esTurnoPropio: false` el POS muestra de quién es la caja y ofrece
 * tomarla (`POST /api/shifts/:id/tomar`). Habilitar la venta directamente contra
 * el turno de otro dejaría el arqueo sin responsable: cuando el efectivo no
 * cuadra, tiene que haber una sola persona a quien preguntarle.
 */
app.get('/api/shifts/current', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const { shift, esTurnoPropio } = await resolverTurnoAbierto(authReq.tenantId!, authReq.userId!);
        if (!shift) return res.json(null);

        // El `include` del turno propio (empleado del PIN) se conserva.
        const completo = await prisma.shift.findFirst({
            where: { id: shift.id, tenantId: authReq.tenantId! },
            include: {
                employee: { select: { id: true, firstName: true, lastName: true, role: true } },
                user: { select: { id: true, name: true } },
            },
        });

        res.json({
            ...completo,
            esTurnoPropio,
            turnoDe: esTurnoPropio ? null : (completo as any)?.user?.name ?? null,
        });
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

/**
 * POST /api/shifts/:id/tomar — Traspaso explícito de la caja.
 *
 * El caso real: el dueño abre la caja a las 7, y a las 2 entra el cajero del
 * segundo turno. Antes tenía dos salidas malas: cerrar y reabrir la caja
 * (partiendo el arqueo del día y perdiendo el fondo inicial real), o vender con
 * el turno del dueño (dejando el faltante a nombre de quien no estaba).
 *
 * El traspaso reasigna el turno SIN cerrarlo: el efectivo, los movimientos y el
 * fondo inicial siguen siendo los mismos, y el arqueo al cierre queda a nombre
 * de quien tiene la caja en ese momento. Queda en AuditLog dentro de la misma
 * transacción (Capa 3), con el efectivo esperado AL MOMENTO del traspaso: es el
 * corte que permite, si al cierre no cuadra, saber en manos de quién se abrió
 * el faltante.
 */
app.post('/api/shifts/:id/tomar', authenticate, checkRole(['OWNER', 'ADMIN', 'MANAGER', 'CASHIER']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const { id } = req.params;

        // Capa 1: propiedad verificada por tenant ANTES de tocar nada.
        const turno = await prisma.shift.findFirst({
            where: { id, tenantId: authReq.tenantId!, status: 'OPEN' },
            include: {
                user: { select: { id: true, name: true } },
                cashMovements: true,
            },
        });
        if (!turno) return res.status(404).json({ error: 'No encontramos esa caja abierta.' });

        // Idempotente: si ya es tuyo, no hay nada que traspasar.
        if (turno.userId === authReq.userId) {
            return res.json({ ok: true, yaEraPropio: true, shiftId: turno.id });
        }

        const ventasEfectivo = await prisma.sale.aggregate({
            where: { tenantId: authReq.tenantId!, shiftId: turno.id, paymentMethod: 'CASH' },
            _sum: { total: true },
        });
        const efectivo = calcularEfectivoTurno({
            initialCash: turno.initialCash.toString(),
            initialCashUsd: turno.initialCashUsd == null ? 0 : turno.initialCashUsd.toString(),
            cashSales: ventasEfectivo._sum.total?.toString() ?? 0,
            movimientos: turno.cashMovements.map((m: any) => ({
                type: m.type,
                amount: m.amount.toString(),
                currency: m.currency,
                category: m.category,
                isVoided: m.isVoided,
            })),
        });

        const entregaDe = turno.user?.name ?? turno.userId;

        await prisma.$transaction(async (tx: any) => {
            await tx.shift.update({
                where: { id: turno.id },
                data: { userId: authReq.userId! },
            });

            await tx.auditLog.create({
                data: {
                    tenantId: authReq.tenantId,
                    userId: authReq.userId,
                    action: 'SHIFT_HANDOVER',
                    details: JSON.stringify({
                        shiftId: turno.id,
                        entregaUserId: turno.userId,
                        entregaNombre: entregaDe,
                        recibeUserId: authReq.userId,
                        // Corte del efectivo al momento del traspaso: si al cierre
                        // no cuadra, esto dice con cuánto se recibió la caja.
                        efectivoAlTraspaso: efectivo.efectivoNIO.toString(),
                        efectivoUsdAlTraspaso: efectivo.efectivoUSD.toString(),
                        fondoInicial: turno.initialCash.toString(),
                    }),
                },
            });
        });

        res.json({
            ok: true,
            shiftId: turno.id,
            entregaDe,
            efectivoRecibido: efectivo.efectivoNIO.toNumber(),
            efectivoUsdRecibido: efectivo.efectivoUSD.toNumber(),
        });
    } catch (error) {
        console.error('Error tomando el turno:', error);
        res.status(500).json({ error: 'No pudimos tomar la caja. Intentá de nuevo.' });
    }
});
// Rate limit estricto para apertura de caja: el PIN de 4 dígitos se coteja contra la
// BD, así que sin límite dedicado se puede enumerar el PIN de un compañero bajo el
// globalLimiter. 10 intentos/hora por IP corta la fuerza bruta (mismo patrón loginLimiter).
const shiftOpenLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: { error: '🔒 Demasiados intentos de apertura de caja. Espera 1 hora.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.post('/api/shifts/open', shiftOpenLimiter as any, authenticate, validate(OpenShiftSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { initialCash, initialCashUsd, employeePin } = req.body;

    try {
        // PIN ya validado por Zod (regex \d{4})
        const employee = await prisma.employee.findFirst({
            where: { tenantId: authReq.tenantId, pin: String(employeePin) }
        });

        if (!employee) {
            return res.status(401).json({ error: 'PIN incorrecto. No se encontró ningún empleado con ese PIN.' });
        }

        // Verificar que no haya ya una caja abierta
        const existingShift = await prisma.shift.findFirst({
            // Capa 1: el tenant sale del JWT y va SIEMPRE en el where.
            where: { tenantId: authReq.tenantId, userId: authReq.userId, status: 'OPEN' }
        });
        if (existingShift) {
            return res.status(400).json({ error: 'Ya tienes una caja abierta. Ciérrala primero.' });
        }

        // Apertura + asiento de auditoría inmutable en la MISMA transacción: el
        // initialCash fija el baseline del arqueo, así que su declaración debe quedar
        // registrada (before/after) igual que SHIFT_CLOSED, para poder desmentir un fondo
        // subdeclarado que se embolse al cierre.
        const shift = await prisma.$transaction(async (tx: any) => {
            const created = await tx.shift.create({
                data: {
                    tenantId: authReq.tenantId,
                    userId: authReq.userId,
                    employeeId: employee.id,
                    initialCash,
                    initialCashUsd: initialCashUsd !== undefined ? initialCashUsd : 0,
                    status: 'OPEN'
                },
                include: {
                    employee: {
                        select: { id: true, firstName: true, lastName: true, role: true }
                    }
                }
            });

            await tx.auditLog.create({
                data: {
                    tenantId: authReq.tenantId,
                    userId: authReq.userId,
                    action: 'SHIFT_OPENED',
                    details: JSON.stringify({
                        before: null,
                        after: {
                            shiftId: created.id,
                            initialCash: String(created.initialCash),
                            employeeId: employee.id,
                            cajero: `${employee.firstName} ${employee.lastName}`,
                        },
                    }),
                },
            });

            return created;
        });
        res.json(shift);
    } catch (e: any) {
        console.error('Error opening shift:', e);
        res.status(500).json({ error: e.message || 'Error abriendo caja' });
    }
});
app.post('/api/shifts/close', authenticate, validate(CloseShiftSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { declaredCash, declaredCashUsd, shiftId, auditNotes } = req.body;
    try {
        // Tenant isolation: shift debe pertenecer al tenant del token
        const shift = await prisma.shift.findFirst({
            where: { id: shiftId, tenantId: authReq.tenantId },  // tenant isolation
            include: {
                sales: true,
                cashMovements: { where: { isVoided: false } },
                employee: { select: { id: true, firstName: true, lastName: true, role: true } }
            }
        });
        if (!shift) return res.status(404).json({ error: 'Turno no encontrado o no pertenece a tu empresa' });

        // Autorización: solo el dueño del turno puede cerrarlo, o un rol administrativo
        // (force-close). Evita que un cajero cierre el turno de un colega con cifras
        // fabricadas e incrimine con auditoría inmutable. Mismo patrón inline que /monitor.
        const isAdminRole = ['OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER'].includes(authReq.role || '');
        if (shift.userId !== authReq.userId && !isAdminRole) {
            return res.status(403).json({ error: 'No autorizado a cerrar este turno.' });
        }

        // ARQUEO DINÁMICO por moneda (Fase D): las ventas son siempre C$; los
        // movimientos de caja se separan por currency. Antes se sumaban C$ y
        // US$ como si fueran la misma unidad — eso era un bug de arqueo.
        const cashSalesD = shift.sales
            .filter((s: any) => s.paymentMethod === 'CASH')
            .reduce((sum: Decimal, s: any) => sum.plus(new Decimal(s.total.toString())), new Decimal(0));
        const cashSales = cashSalesD.toNumber();
        const cardSales = shift.sales.filter((s: any) => s.paymentMethod !== 'CASH' && s.paymentMethod !== 'CREDIT').reduce((sum: number, s: any) => sum + Number(s.total), 0);

        // NX-03 — el arqueo usa LA MISMA función que la píldora del POS y el
        // monitor de cajas (`calcularEfectivoTurno`, utils/margen.ts). Antes era
        // una tercera copia de la fórmula, además sumada en float nativo: el
        // `difference` que dispara la alerta de robo hormiga no puede arrastrar
        // error binario ni discrepar de lo que el cajero vio en pantalla.
        const efectivoArqueo = calcularEfectivoTurno({
            initialCash: shift.initialCash.toString(),
            initialCashUsd: shift.initialCashUsd == null ? 0 : shift.initialCashUsd.toString(),
            cashSales: cashSalesD,
            movimientos: shift.cashMovements.map((m: any) => ({
                type: m.type,
                amount: m.amount.toString(),
                currency: m.currency,
                category: m.category,
            })),
        });
        // Manuales y de agente bancario van SEPARADOS en el desglose, pero los dos
        // están adentro del efectivo esperado (son billetes en la gaveta).
        const manualINs = efectivoArqueo.desglose.manualINs.toNumber();
        const manualOUTs = efectivoArqueo.desglose.manualOUTs.toNumber();
        const agentINs = efectivoArqueo.desglose.agentINs.toNumber();
        const agentOUTs = efectivoArqueo.desglose.agentOUTs.toNumber();
        const expectedCash = efectivoArqueo.efectivoNIO.toNumber();
        const difference = new Decimal(declaredCash).minus(efectivoArqueo.efectivoNIO).toDecimalPlaces(2).toNumber();
        const expectedUsd = efectivoArqueo.efectivoUSD.toNumber();
        // Si no declaró dólares pero hubo movimiento USD, la diferencia se
        // calcula contra 0 (faltante completo visible, no oculto).
        const declaredUsd = declaredCashUsd !== undefined ? Number(declaredCashUsd) : 0;
        const differenceUsd = declaredUsd - expectedUsd;
        const huboUsd = expectedUsd !== 0 || declaredUsd !== 0 || Number(shift.initialCashUsd || 0) !== 0;

        const cajeroName = shift.employee ? `${shift.employee.firstName} ${shift.employee.lastName}` : 'Sin asignar';

        // Fetch tenant threshold for theft alert
        const tenant = await prisma.tenant.findUnique({ where: { id: authReq.tenantId } });
        const theftThreshold = tenant ? Number(tenant.theftAlertThreshold) : 500;

        // Transacción: cerrar turno + crear audit log inmutable + alerta robo hormiga
        const closedShift = await prisma.$transaction(async (tx: any) => {
            const updated = await tx.shift.update({
                where: { id: shiftId },
                data: {
                    endTime: new Date(),
                    status: 'CLOSED',
                    finalCashDeclared: declaredCash,
                    systemExpectedCash: expectedCash,
                    difference: difference,
                    // Gaveta USD (Fase D): solo se persiste si hubo dólares.
                    ...(huboUsd ? {
                        finalCashDeclaredUsd: declaredUsd,
                        systemExpectedUsd: expectedUsd,
                        differenceUsd: differenceUsd,
                    } : {}),
                },
                include: {
                    employee: { select: { id: true, firstName: true, lastName: true, role: true } }
                }
            });

            // AUDIT LOG INMUTABLE — rastro de cierre de caja
            await tx.auditLog.create({
                data: {
                    tenantId: authReq.tenantId,
                    userId: authReq.userId,
                    action: 'SHIFT_CLOSED',
                    details: JSON.stringify({
                        esperado: expectedCash,
                        declarado: Number(declaredCash),
                        diferencia: difference,
                        cajero: cajeroName,
                        totalEfectivo: cashSales,
                        totalTarjeta: cardSales,
                        entradasManuales: manualINs,
                        salidasManuales: manualOUTs,
                        fondoInicial: Number(shift.initialCash),
                        // Gaveta USD (Fase D):
                        ...(huboUsd ? {
                            usd: { esperado: expectedUsd, declarado: declaredUsd, diferencia: differenceUsd, fondoInicial: Number(shift.initialCashUsd || 0) },
                        } : {}),
                        totalVentas: shift.sales.length,
                        totalMovimientos: shift.cashMovements.length,
                        notasRevisor: auditNotes || 'Sin notas.'
                    })
                }
            });

            // 🚨 ALERTA ROBO HORMIGA — si la diferencia supera el umbral
            if (Math.abs(difference) > theftThreshold) {
                const alertType = difference < 0 ? 'THEFT_ALERT' : 'SURPLUS_ALERT';
                await tx.auditLog.create({
                    data: {
                        tenantId: authReq.tenantId,
                        userId: authReq.userId,
                        action: alertType,
                        details: JSON.stringify({
                            tipo: difference < 0 ? '⚠️ FALTANTE EN CAJA' : '⚠️ SOBRANTE EN CAJA',
                            diferencia: difference,
                            esperado: expectedCash,
                            declarado: Number(declaredCash),
                            cajero: cajeroName,
                            umbral: theftThreshold,
                            turnoId: shiftId,
                            fecha: new Date().toISOString()
                        })
                    }
                });
                console.warn(`🚨 ${alertType}: Diferencia C$${Math.abs(difference).toFixed(2)} (umbral: C$${theftThreshold}) - Cajero: ${cajeroName}`);
            }

            return updated;
        });

        res.json({
            ...closedShift,
            // NX-03: `manualINs`/`manualOUTs` son ahora estrictamente MANUALES;
            // la corresponsalía va aparte (los dos ya están dentro de
            // `systemExpectedCash`).
            manualINs,
            manualOUTs,
            agentINs,
            agentOUTs,
            theftAlert: Math.abs(difference) > theftThreshold
        });
    } catch (e: any) {
        console.error('Error closing shift:', e);
        res.status(500).json({ error: e.message || 'Error cerrando caja' });
    }
});

// GET /api/shifts/history — Historial de cierres de caja (auditoría)
app.get('/api/shifts/history', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const shifts = await prisma.shift.findMany({
            where: { tenantId: authReq.tenantId, status: 'CLOSED' },
            orderBy: { endTime: 'desc' },
            take: 100,
            include: {
                employee: { select: { id: true, firstName: true, lastName: true, role: true } },
                user: { select: { id: true, name: true, email: true } },
                sales: { select: { id: true, total: true, paymentMethod: true } }
            }
        });

        // Enriquecer con totales por método de pago
        const enriched = shifts.map((s: any) => {
            const cashTotal = s.sales.filter((sale: any) => sale.paymentMethod === 'CASH').reduce((sum: number, sale: any) => sum + Number(sale.total), 0);
            const cardTotal = s.sales.filter((sale: any) => sale.paymentMethod !== 'CASH' && sale.paymentMethod !== 'CREDIT').reduce((sum: number, sale: any) => sum + Number(sale.total), 0);
            const creditTotal = s.sales.filter((sale: any) => sale.paymentMethod === 'CREDIT').reduce((sum: number, sale: any) => sum + Number(sale.total), 0);
            return {
                id: s.id,
                startTime: s.startTime,
                endTime: s.endTime,
                initialCash: Number(s.initialCash),
                finalCashDeclared: s.finalCashDeclared ? Number(s.finalCashDeclared) : null,
                systemExpectedCash: s.systemExpectedCash ? Number(s.systemExpectedCash) : null,
                difference: s.difference ? Number(s.difference) : null,
                employee: s.employee,
                user: s.user,
                totalSales: s.sales.length,
                cashTotal,
                cardTotal,
                creditTotal,
                grandTotal: cashTotal + cardTotal + creditTotal
            };
        });

        res.json(enriched);
    } catch (e: any) {
        console.error('Error fetching shift history:', e);
        res.status(500).json({ error: 'Error obteniendo historial de cajas' });
    }
});

// GET /api/shifts/monitor — PANÓPTICO: Monitor en vivo de todas las cajas del tenant
app.get('/api/shifts/monitor', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;

    try {
        // Role gate: solo OWNER, ADMIN, MANAGER
        if (!['OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER'].includes(authReq.role || '')) {
            return res.status(403).json({ error: 'Acceso denegado. Solo administradores pueden acceder al monitor de cajas.' });
        }

        // ====== ZONA 1: CAJAS ACTIVAS (LIVE) ======
        const activeShifts = await prisma.shift.findMany({
            where: { tenantId: authReq.tenantId, status: 'OPEN' },
            include: {
                employee: { select: { id: true, firstName: true, lastName: true, role: true } },
                user: { select: { id: true, name: true, email: true } },
                sales: { select: { id: true, total: true, paymentMethod: true, createdAt: true } },
                cashMovements: { where: { isVoided: false }, select: { id: true, type: true, amount: true, currency: true, category: true, description: true, createdAt: true } }
            },
            orderBy: { startTime: 'asc' }
        });

        const liveCards = activeShifts.map((shift: any) => {
            // Bóveda 1: Ventas (solo efectivo) — suma con decimal.js: este número
            // entra al efectivo esperado de la gaveta y no puede arrastrar error
            // binario de float.
            const cashSalesD = shift.sales
                .filter((s: any) => s.paymentMethod === 'CASH')
                .reduce((sum: Decimal, s: any) => sum.plus(new Decimal(s.total.toString())), new Decimal(0));
            const cashSales = cashSalesD.toNumber();
            // Ventas tarjeta/transferencia
            const cardSales = shift.sales
                .filter((s: any) => s.paymentMethod !== 'CASH' && s.paymentMethod !== 'CREDIT')
                .reduce((sum: number, s: any) => sum + Number(s.total), 0);
            // Ventas crédito
            const creditSales = shift.sales
                .filter((s: any) => s.paymentMethod === 'CREDIT')
                .reduce((sum: number, s: any) => sum + Number(s.total), 0);

            // NX-03 — EL NÚMERO SAGRADO sale de `calcularEfectivoTurno`
            // (utils/margen.ts), LA MISMA función que alimenta la píldora del POS
            // (`/api/cash-movements/balance`). Antes cada endpoint tenía su propia
            // fórmula sobre los mismos datos: dos verdades para una sola gaveta.
            //
            // Sigue siendo POR MONEDA (C$ y US$ separados — sumarlos fue un bug
            // real) y con la corresponsalía bancaria desglosada: entra al total
            // (son billetes en la gaveta) pero el dueño la concilia aparte.
            const efectivoTurno = calcularEfectivoTurno({
                initialCash: shift.initialCash.toString(),
                initialCashUsd: shift.initialCashUsd == null ? 0 : shift.initialCashUsd.toString(),
                cashSales: cashSalesD,
                movimientos: shift.cashMovements.map((m: any) => ({
                    type: m.type,
                    amount: m.amount.toString(),
                    currency: m.currency,
                    category: m.category,
                })),
            });

            const agentINs = efectivoTurno.desglose.agentINs.toNumber();
            const agentOUTs = efectivoTurno.desglose.agentOUTs.toNumber();
            const manualINs = efectivoTurno.desglose.manualINs.toNumber();
            const manualOUTs = efectivoTurno.desglose.manualOUTs.toNumber();
            const estimatedPhysicalUsd = efectivoTurno.efectivoUSD.toNumber();
            const estimatedPhysicalCash = efectivoTurno.efectivoNIO.toNumber();

            // Última venta
            const sortedSales = shift.sales.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            const lastSaleAt = sortedSales.length > 0 ? sortedSales[0].createdAt : null;

            // Movimientos recientes (últimos 5)
            const recentMovements = shift.cashMovements
                .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                .slice(0, 5)
                .map((m: any) => ({
                    type: m.type,
                    amount: Number(m.amount),
                    category: m.category,
                    description: m.description,
                    createdAt: m.createdAt
                }));

            return {
                id: shift.id,
                employee: shift.employee,
                user: shift.user,
                startTime: shift.startTime,
                initialCash: Number(shift.initialCash),
                // Las 3 Bóvedas:
                vaultCashSales: cashSales,
                vaultCardSales: cardSales,
                vaultCreditSales: creditSales,
                vaultManualINs: manualINs,
                vaultManualOUTs: manualOUTs,
                // Bóveda agente bancario (Fase B):
                vaultAgentINs: agentINs,
                vaultAgentOUTs: agentOUTs,
                // El Número Sagrado:
                estimatedPhysicalCash,
                // Gaveta USD (Fase D):
                estimatedPhysicalUsd,
                // Meta:
                salesCount: shift.sales.length,
                movementsCount: shift.cashMovements.length,
                lastSaleAt,
                recentMovements,
            };
        });

        // ====== ZONA 2: HISTORIAL DE CIERRES (últimos 50) ======
        const closedShifts = await prisma.shift.findMany({
            where: { tenantId: authReq.tenantId, status: 'CLOSED' },
            orderBy: { endTime: 'desc' },
            take: 50,
            include: {
                employee: { select: { id: true, firstName: true, lastName: true, role: true } },
                user: { select: { id: true, name: true } },
                sales: { select: { total: true, paymentMethod: true } }
            }
        });

        // Fetch tenant threshold
        const tenant = await prisma.tenant.findUnique({ where: { id: authReq.tenantId } });
        const theftThreshold = tenant ? Number(tenant.theftAlertThreshold) : 500;

        const closedHistory = closedShifts.map((s: any) => {
            const cashTotal = s.sales.filter((sale: any) => sale.paymentMethod === 'CASH').reduce((sum: number, sale: any) => sum + Number(sale.total), 0);
            const cardTotal = s.sales.filter((sale: any) => sale.paymentMethod !== 'CASH' && sale.paymentMethod !== 'CREDIT').reduce((sum: number, sale: any) => sum + Number(sale.total), 0);
            const creditTotal = s.sales.filter((sale: any) => sale.paymentMethod === 'CREDIT').reduce((sum: number, sale: any) => sum + Number(sale.total), 0);
            const diff = s.difference ? Number(s.difference) : 0;

            return {
                id: s.id,
                startTime: s.startTime,
                endTime: s.endTime,
                employee: s.employee,
                user: s.user,
                initialCash: Number(s.initialCash),
                finalCashDeclared: s.finalCashDeclared ? Number(s.finalCashDeclared) : null,
                systemExpectedCash: s.systemExpectedCash ? Number(s.systemExpectedCash) : null,
                difference: diff,
                // Status flag for UI coloring
                status: Math.abs(diff) === 0 ? 'PERFECT' : Math.abs(diff) <= theftThreshold ? 'WARNING' : 'ALERT',
                salesCount: s.sales.length,
                cashTotal,
                cardTotal,
                creditTotal,
                grandTotal: cashTotal + cardTotal + creditTotal,
            };
        });

        res.json({
            activeShifts: liveCards,
            closedShifts: closedHistory,
            theftThreshold,
            // Umbrales de alerta de gaveta del agente bancario (Fase C):
            agentCashMin: tenant?.agentCashMin != null ? Number(tenant.agentCashMin) : null,
            agentCashMax: tenant?.agentCashMax != null ? Number(tenant.agentCashMax) : null,
        });

    } catch (e: any) {
        console.error('Error in shift monitor:', e);
        res.status(500).json({ error: e.message || 'Error en el monitor de cajas' });
    }
});

app.get('/api/audit-logs', authenticate, checkRole(['OWNER', 'ADMIN']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const logs = await prisma.auditLog.findMany({ where: { tenantId: authReq.tenantId }, orderBy: { createdAt: 'desc' }, take: 50 });
        res.json(logs);
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});


// ==========================================
// 💰 CASH MOVEMENTS (ENTRADAS/SALIDAS DE CAJA)
// ==========================================

// POST /api/cash-movements — Registrar entrada o salida de caja
app.post('/api/cash-movements', authenticate, validate(CreateCashMovementSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { type, amount, currency, category, description } = req.body;

    try {
        // Validaciones de formato ya realizadas por Zod (type, amount, category).
        // A. VALIDAR CAJA ABIERTA — MISMO turno que ve la píldora del POS
        // (`resolverTurnoAbierto`, NX-03): si la caja donde está parado el cajero
        // la abrió otro usuario, antes el POS mostraba el saldo pero registrar un
        // movimiento respondía "No hay caja abierta". El `tenantId` del JWT va en
        // el where (antes se buscaba por `userId` suelto).
        const { shift: turnoAbierto } = await resolverTurnoAbierto(authReq.tenantId!, authReq.userId!);
        const currentShift = turnoAbierto
            ? await prisma.shift.findFirst({
                where: { id: turnoAbierto.id, tenantId: authReq.tenantId },
                include: {
                    sales: { select: { total: true, paymentMethod: true } },
                    cashMovements: { where: { isVoided: false } }
                }
            })
            : null;
        if (!currentShift) {
            return res.status(400).json({ error: 'No hay caja abierta. Abrí una caja primero.' });
        }

        // B. VALIDACIÓN DE SALDO PARA SALIDAS — CERO TOLERANCIA A SALIDAS FANTASMA
        // Pre-chequeo con decimal.js (respuesta 400 limpia). La validación autoritativa
        // race-safe se re-hace bajo lock DENTRO de la transacción (ver más abajo).
        if (type === 'OUT') {
            // Fase D: el guard es POR MONEDA — una salida en US$ se valida
            // contra los dólares de la gaveta (las ventas son siempre C$).
            const movCurrency = currency || 'NIO';
            const mismaMoneda = (m: any) => (m.currency || 'NIO') === movCurrency;
            const cashSalesTotal = movCurrency === 'NIO'
                ? currentShift.sales
                    .filter((s: any) => s.paymentMethod === 'CASH')
                    .reduce((sum: Decimal, s: any) => sum.plus(new Decimal(s.total.toString())), new Decimal(0))
                : new Decimal(0);
            const fondo = movCurrency === 'NIO'
                ? new Decimal(currentShift.initialCash.toString())
                : new Decimal((currentShift.initialCashUsd ?? 0).toString());
            const totalINs = currentShift.cashMovements
                .filter((m: any) => m.type === 'IN' && mismaMoneda(m))
                .reduce((sum: Decimal, m: any) => sum.plus(new Decimal(m.amount.toString())), new Decimal(0));
            const totalOUTs = currentShift.cashMovements
                .filter((m: any) => m.type === 'OUT' && mismaMoneda(m))
                .reduce((sum: Decimal, m: any) => sum.plus(new Decimal(m.amount.toString())), new Decimal(0));

            const availableCash = fondo.plus(cashSalesTotal).plus(totalINs).minus(totalOUTs);
            const simbolo = movCurrency === 'NIO' ? 'C$' : 'US$';

            if (new Decimal(amount).greaterThan(availableCash)) {
                return res.status(400).json({
                    error: `Saldo insuficiente. Efectivo disponible: ${simbolo}${availableCash.toFixed(2)}. Intentas sacar: ${simbolo}${new Decimal(amount).toFixed(2)}`,
                    availableCash: availableCash.toNumber()
                });
            }
        }

        // A1/A5: catálogo sembrado ANTES de la tx (ver nota en /api/purchases): el
        // auto-seed de getAccount ocurre fuera de la transacción y sus filas no son
        // visibles dentro bajo REPEATABLE READ.
        const anchorCash = await prisma.account.findUnique({
            where: { tenantId_code: { tenantId: authReq.tenantId!, code: '5.2.1' } },
            select: { id: true },
        });
        if (!anchorCash) await seedChartOfAccounts(authReq.tenantId!);

        // C. TRANSACCIÓN: crear movimiento + auto-crear Expense si es salida
        const result = await prisma.$transaction(async (tx: any) => {
            // Revalidación race-safe del saldo para salidas: se bloquea la fila del turno
            // (FOR UPDATE) y se recalcula el efectivo disponible con decimal.js DENTRO de la
            // transacción, cerrando el TOCTOU de dos OUT concurrentes que sobregiran la caja.
            if (type === 'OUT') {
                // Fase D: revalidación race-safe POR MONEDA (backticks MySQL —
                // el raw anterior usaba comillas dobles estilo PostgreSQL).
                await tx.$queryRaw`SELECT id FROM \`Shift\` WHERE id = ${currentShift.id} AND \`tenantId\` = ${authReq.tenantId} FOR UPDATE`;
                const movCurrency = currency || 'NIO';
                const freshSales: Array<{ total: any }> = movCurrency === 'NIO'
                    ? await tx.sale.findMany({
                        where: { shiftId: currentShift.id, paymentMethod: 'CASH' },
                        select: { total: true },
                    })
                    : [];
                const freshMovements: Array<{ type: string; amount: any; currency: string | null }> = await tx.cashMovement.findMany({
                    where: { shiftId: currentShift.id, isVoided: false },
                    select: { type: true, amount: true, currency: true },
                });
                const mismaMoneda = (m: any) => (m.currency || 'NIO') === movCurrency;
                const cashSalesTotal = freshSales
                    .reduce((sum: Decimal, s: any) => sum.plus(new Decimal(s.total.toString())), new Decimal(0));
                const fondo = movCurrency === 'NIO'
                    ? new Decimal(currentShift.initialCash.toString())
                    : new Decimal((currentShift.initialCashUsd ?? 0).toString());
                const totalINs = freshMovements
                    .filter((m) => m.type === 'IN' && mismaMoneda(m))
                    .reduce((sum: Decimal, m: any) => sum.plus(new Decimal(m.amount.toString())), new Decimal(0));
                const totalOUTs = freshMovements
                    .filter((m) => m.type === 'OUT' && mismaMoneda(m))
                    .reduce((sum: Decimal, m: any) => sum.plus(new Decimal(m.amount.toString())), new Decimal(0));
                const availableCash = fondo.plus(cashSalesTotal).plus(totalINs).minus(totalOUTs);
                const simbolo = movCurrency === 'NIO' ? 'C$' : 'US$';
                if (new Decimal(amount).greaterThan(availableCash)) {
                    throw new Error(`Saldo insuficiente. Efectivo disponible: ${simbolo}${availableCash.toFixed(2)}`);
                }
            }

            let expenseId = null;

            // Auto-crear Expense para salidas operativas
            if (type === 'OUT' && ['GASTO_OPERATIVO', 'PAGO_PROVEEDOR'].includes(category)) {
                const expense = await tx.expense.create({
                    data: {
                        tenantId: authReq.tenantId,
                        amount: new Decimal(amount).toNumber(),
                        description: `[CAJA] ${description}`,
                        category: category === 'PAGO_PROVEEDOR' ? 'SUPPLIER_PAYMENT' : 'OPERATIONAL',
                    }
                });
                expenseId = expense.id;
            }

            // Append firmado al libro de caja: cadena seq/prevHash por tenant +
            // HMAC de los campos inmutables (tamper-evidence). Ver services/ledger.ts.
            const movement = await appendSignedCashMovement(tx, {
                tenantId: authReq.tenantId,
                shiftId: currentShift.id,
                userId: authReq.userId,
                type,
                amount: new Decimal(amount).toNumber(),
                currency: currency || 'NIO',
                category,
                description: description.trim(),
                expenseId,
            });

            // A1: ASIENTO CONTABLE del movimiento de caja. Antes los gastos en
            // efectivo y los aportes de capital NUNCA llegaban al mayor
            // (`recordExpense`/`recordCashIn` eran código muerto): Gastos Operativos
            // (5.2.1) y Capital Social (3.1.1) quedaban en cero para siempre.
            // El mapeo por categoría vive en `cashMovementJournalLines` (pura):
            // CAMBIO/AJUSTE no generan asiento a propósito (ver su doc).
            await recordCashMovement(
                tx as Parameters<typeof recordCashMovement>[0],
                authReq.tenantId,
                authReq.userId,
                movement.id,
                type,
                category,
                new Decimal(amount).toNumber(),
                description.trim()
            );

            // AUDIT LOG inmutable
            await tx.auditLog.create({
                data: {
                    tenantId: authReq.tenantId,
                    userId: authReq.userId,
                    action: type === 'IN' ? 'CASH_IN' : 'CASH_OUT',
                    details: JSON.stringify({
                        movimientoId: movement.id,
                        tipo: type,
                        monto: new Decimal(amount).toNumber(),
                        moneda: currency || 'NIO',
                        categoria: category,
                        descripcion: description.trim(),
                        turnoId: currentShift.id,
                        expenseId,
                    })
                }
            });

            return movement;
        });

        res.json(result);
    } catch (error: any) {
        console.error('Error creating cash movement:', error);
        // Período cerrado (A1): el movimiento ahora exige asiento → 423 en vez de
        // registrar plata que sale de la gaveta sin contrapartida contable.
        if (error instanceof PeriodLockedError) {
            return res.status(423).json({ error: error.message });
        }
        const insufficient = error?.message?.includes('Saldo insuficiente');
        res.status(insufficient ? 400 : 500).json({ error: error.message || 'Error registrando movimiento de caja' });
    }
});

/**
 * NX-03 — Turno abierto sobre el que trabaja el cajero.
 *
 * Preferimos el turno que abrió ESTE usuario; si no tiene uno propio pero la
 * caja del tenant está abierta (la abrió otro cajero, el dueño, o el turno
 * quedó a nombre de quien hizo el arqueo), devolvemos ESE. Antes se buscaba
 * solo por `userId` y el POS mostraba C$0.00 / "Sin movimientos" con plata real
 * en la gaveta: el cajero tiene que ver la plata de la caja donde está parado.
 *
 * El `tenantId` sale del JWT (nunca del body/query) y va SIEMPRE en el where:
 * antes la búsqueda por `userId` suelto no lo llevaba.
 */
async function resolverTurnoAbierto(tenantId: string, userId: string) {
    const propio = await prisma.shift.findFirst({
        where: { tenantId, userId, status: 'OPEN' },
        orderBy: { startTime: 'desc' },
    });
    if (propio) return { shift: propio, esTurnoPropio: true };

    const delTenant = await prisma.shift.findFirst({
        where: { tenantId, status: 'OPEN' },
        orderBy: { startTime: 'desc' },
        include: { user: { select: { id: true, name: true } } },
    });
    if (delTenant) return { shift: delTenant, esTurnoPropio: false };

    return { shift: null, esTurnoPropio: false };
}

/**
 * GET /api/cash-movements — Movimientos del turno actual (o de `?shiftId=`).
 *
 * CONTRATO (para el frontend):
 *   Sigue devolviendo un ARRAY, con la misma forma de `CashMovement` de siempre.
 *   NUEVO: además de los movimientos manuales, el array incluye las VENTAS EN
 *   EFECTIVO del turno como filas sintéticas — el POS decía "Sin movimientos"
 *   después de vender, aunque la gaveta había subido. Cada fila trae:
 *     · `origen`: 'MOVIMIENTO' (registro manual, anulable) | 'VENTA' (venta en
 *        efectivo, sintética: NO existe en la tabla CashMovement).
 *     · Las ventas usan `id` = `venta:<saleId>`, `type` = 'IN',
 *       `category` = 'VENTA_EFECTIVO', `isVoided` = false.
 *   Las filas con `origen === 'VENTA'` NO se pueden anular (no hay movimiento
 *   que anular): la UI no debe ofrecer esa acción sobre ellas.
 *   Todo viene ordenado por `createdAt` descendente.
 */
app.get('/api/cash-movements', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { shiftId } = req.query;

    try {
        let turnoId: string;

        if (shiftId) {
            // El where lleva tenantId: un shiftId de otro tenant devuelve vacío.
            turnoId = String(shiftId);
        } else {
            const { shift } = await resolverTurnoAbierto(authReq.tenantId!, authReq.userId!);
            if (!shift) {
                return res.json([]);
            }
            turnoId = shift.id;
        }

        const [movements, cashSales] = await Promise.all([
            prisma.cashMovement.findMany({
                where: { tenantId: authReq.tenantId, shiftId: turnoId },
                orderBy: { createdAt: 'desc' },
                take: 200,
                include: {
                    user: { select: { id: true, name: true } }
                }
            }),
            prisma.sale.findMany({
                where: { tenantId: authReq.tenantId, shiftId: turnoId, paymentMethod: 'CASH' },
                orderBy: { createdAt: 'desc' },
                take: 200,
                select: { id: true, total: true, invoiceNumber: true, createdAt: true },
            }),
        ]);

        const ventasComoMovimientos = cashSales.map((s: any) => ({
            id: `venta:${s.id}`,
            saleId: s.id,
            tenantId: authReq.tenantId,
            shiftId: turnoId,
            type: 'IN',
            amount: new Decimal(s.total.toString()).toNumber(),
            currency: 'NIO',
            category: 'VENTA_EFECTIVO',
            description: s.invoiceNumber ? `Venta #${s.invoiceNumber}` : 'Venta en efectivo',
            isVoided: false,
            createdAt: s.createdAt,
            origen: 'VENTA' as const,
        }));

        const listado = [
            ...movements.map((m: any) => ({ ...m, origen: 'MOVIMIENTO' as const })),
            ...ventasComoMovimientos,
        ].sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        res.json(listado);
    } catch (error) {
        console.error('Error fetching cash movements:', error);
        res.status(500).json({ error: 'Error obteniendo movimientos de caja' });
    }
});

/**
 * GET /api/cash-movements/balance — Efectivo en la gaveta, en vivo (píldora del POS).
 *
 * NX-03: usa `calcularEfectivoTurno` (utils/margen.ts), LA MISMA función del
 * monitor de cajas ("Efectivo en Gaveta"). Antes cada endpoint tenía su fórmula
 * y podían dar números distintos para la misma gaveta.
 *
 * CONTRATO (para el frontend) — se conservan `balance`, `balanceUsd`,
 * `hasOpenShift` y `breakdown` con sus claves de siempre. NUEVO:
 *   · `shiftId`: string — turno al que corresponde el saldo.
 *   · `esTurnoPropio`: boolean — false cuando el turno abierto lo abrió OTRO
 *     usuario del tenant (antes eso devolvía `hasOpenShift:false` y C$0.00).
 *   · `turnoDe`: string | null — nombre de quien abrió el turno (si no es propio).
 *   · `breakdown.agentINs` / `breakdown.agentOUTs`: number — corresponsalía
 *     bancaria, ya incluida en `balance` pero desglosada para conciliar.
 *   · `breakdown.totalINs` / `breakdown.totalOUTs`: number — manual + agente
 *     (es el valor que ANTES traían `manualINs`/`manualOUTs`; ahora esas dos
 *     claves son estrictamente MANUALES, igual que en el monitor de cajas).
 */
app.get('/api/cash-movements/balance', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;

    try {
        const { shift, esTurnoPropio } = await resolverTurnoAbierto(authReq.tenantId!, authReq.userId!);

        if (!shift) {
            return res.json({ balance: 0, balanceUsd: 0, hasOpenShift: false, shiftId: null, esTurnoPropio: false, turnoDe: null });
        }

        // Todo se AGREGA en la BD, no se traen filas para sumarlas en JS: las
        // ventas con `aggregate` y los movimientos con `groupBy` por
        // (tipo, moneda, categoría) — a lo sumo un puñado de filas, sin `take`
        // que pueda truncar la gaveta (truncar acá sería mostrar plata que no es).
        const [ventasEfectivo, gruposMovimientos] = await Promise.all([
            prisma.sale.aggregate({
                where: { tenantId: authReq.tenantId, shiftId: shift.id, paymentMethod: 'CASH' },
                _sum: { total: true },
            }),
            prisma.cashMovement.groupBy({
                by: ['type', 'currency', 'category'],
                where: { tenantId: authReq.tenantId, shiftId: shift.id, isVoided: false },
                _sum: { amount: true },
            }),
        ]);

        const efectivo = calcularEfectivoTurno({
            initialCash: shift.initialCash.toString(),
            initialCashUsd: shift.initialCashUsd == null ? 0 : shift.initialCashUsd.toString(),
            cashSales: ventasEfectivo._sum.total == null ? 0 : ventasEfectivo._sum.total.toString(),
            // Cada grupo entra como UN movimiento con el monto ya sumado: la
            // fórmula es una suma por bucket, así que agregar antes da idéntico.
            movimientos: gruposMovimientos.map((g: any) => ({
                type: g.type,
                amount: g._sum.amount == null ? 0 : g._sum.amount.toString(),
                currency: g.currency,
                category: g.category,
            })),
        });

        const d = efectivo.desglose;
        res.json({
            balance: efectivo.efectivoNIO.toNumber(),
            balanceUsd: efectivo.efectivoUSD.toNumber(),
            hasOpenShift: true,
            shiftId: shift.id,
            esTurnoPropio,
            turnoDe: esTurnoPropio ? null : ((shift as any).user?.name ?? null),
            breakdown: {
                initialCash: d.initialCash.toNumber(),
                cashSales: d.cashSales.toNumber(),
                manualINs: d.manualINs.toNumber(),
                manualOUTs: d.manualOUTs.toNumber(),
                agentINs: d.agentINs.toNumber(),
                agentOUTs: d.agentOUTs.toNumber(),
                totalINs: d.manualINs.plus(d.agentINs).toNumber(),
                totalOUTs: d.manualOUTs.plus(d.agentOUTs).toNumber(),
                initialCashUsd: d.initialCashUsd.toNumber(),
                usdINs: d.usdINs.toNumber(),
                usdOUTs: d.usdOUTs.toNumber()
            }
        });
    } catch (error) {
        console.error('Error calculating cash balance:', error);
        res.status(500).json({ error: 'Error calculando saldo de caja' });
    }
});

// POST /api/cash-movements/:id/void — Anular movimiento (soft delete)
app.post('/api/cash-movements/:id/void', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { id } = req.params;
    const { reason } = req.body;

    try {
        if (!reason || reason.trim().length < 3) {
            return res.status(400).json({ error: 'Razón de anulación requerida (mínimo 3 caracteres).' });
        }

        // Solo OWNER/ADMIN pueden anular
        if (!['OWNER', 'ADMIN', 'SUPER_ADMIN', 'MANAGER'].includes(authReq.role || '')) {
            return res.status(403).json({ error: 'Solo el dueño o gerente puede anular movimientos.' });
        }

        const movement = await prisma.cashMovement.findFirst({
            where: { id, tenantId: authReq.tenantId }
        });

        if (!movement) {
            return res.status(404).json({ error: 'Movimiento no encontrado.' });
        }

        if (movement.isVoided) {
            return res.status(400).json({ error: 'Este movimiento ya fue anulado.' });
        }

        const result = await prisma.$transaction(async (tx: any) => {
            // Revertir el Expense auto-creado enlazado: si el movimiento OUT generó
            // un gasto (expenseId), al anular el movimiento hay que revertir también el
            // gasto para que no quede contabilizado como gasto fantasma en el P&L.
            // Verificamos propiedad por tenant antes de tocarlo. Liberamos primero la FK
            // (expenseId=null) para no depender de la acción onDelete del enlace @unique.
            let expenseRevertido: { id: string; amount: number; description: string; category: string } | null = null;
            if (movement.expenseId) {
                const expense = await tx.expense.findFirst({
                    where: { id: movement.expenseId, tenantId: authReq.tenantId }
                });
                if (expense) {
                    expenseRevertido = {
                        id: expense.id,
                        amount: new Decimal(expense.amount.toString()).toNumber(),
                        description: expense.description,
                        category: expense.category,
                    };
                }
            }

            const voided = await tx.cashMovement.update({
                where: { id },
                data: {
                    isVoided: true,
                    voidReason: reason.trim(),
                    voidedAt: new Date(),
                    voidedBy: authReq.userId,
                    ...(expenseRevertido ? { expenseId: null } : {}),
                }
            });

            if (expenseRevertido) {
                await tx.expense.delete({ where: { id: expenseRevertido.id } });
            }

            await tx.auditLog.create({
                data: {
                    tenantId: authReq.tenantId,
                    userId: authReq.userId,
                    action: 'CASH_MOVEMENT_VOIDED',
                    details: JSON.stringify({
                        movimientoId: id,
                        tipoOriginal: movement.type,
                        montoOriginal: new Decimal(movement.amount.toString()).toNumber(),
                        razon: reason.trim(),
                        expenseRevertido,
                    })
                }
            });

            return voided;
        });

        res.json(result);
    } catch (error: any) {
        console.error('Error voiding cash movement:', error);
        res.status(500).json({ error: error.message || 'Error anulando movimiento' });
    }
});


// ==========================================
// 📦 INVENTORY MANAGEMENT - PRODUCTS & KARDEX
// ==========================================

// GET /api/products - Lista todos los productos (disponible para todos)
app.get('/api/products', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { search, lowStock, category, status, sort, dir, page, pageSize } = req.query;

    try {
        const whereClause: any = { tenantId: authReq.tenantId };

        // Catálogo asignado (Vendedores Fase B): un VENDEDOR con catálogo ve
        // SOLO sus productos — en el POS y en cualquier listado. Sin filas, ve
        // todo (opt-in; el default preserva el comportamiento de siempre). El
        // filtro vive server-side: el rol sale del JWT, no de la UI.
        if (authReq.role === 'VENDEDOR') {
            const catalogo = await prisma.sellerProduct.findMany({
                where: { tenantId: authReq.tenantId!, sellerId: authReq.userId! },
                select: { productId: true },
            });
            if (catalogo.length > 0) {
                whereClause.id = { in: catalogo.map(c => c.productId) };
            }
        }

        if (search) {
            whereClause.OR = [
                { name: { contains: search } },
                { sku: { contains: search } },
                { category: { contains: search } }
            ];
        }
        if (category) whereClause.category = String(category);
        if (status === 'out') whereClause.stock = { lte: 0 };
        // "Bajo mínimo" y "punto de reorden" comparan DOS COLUMNAS de la misma
        // fila (stock contra su umbral), así que van por field reference: el
        // filtro ocurre en SQL y el `count` de la paginación cuadra. Filtrarlo en
        // JS después del findMany —como hace el viejo `lowStock=true` de abajo—
        // rompe la paginación y trae toda la tabla a memoria.
        //
        // `gt: 0` NO es decorativo: la tarjeta KPI cuenta bajo-mínimo EXCLUYENDO
        // los agotados (lowStock − outOfStock). Sin esa condición, hacer clic en
        // una tarjeta que dice 100 devolvería más de 100 filas.
        else if (status === 'low') whereClause.stock = { lte: prisma.product.fields.minStock, gt: 0 };
        else if (status === 'reorder') {
            whereClause.stock = { lte: prisma.product.fields.reorderPoint, gt: 0 };
            whereClause.reorderPoint = { gt: 0 }; // 0 = el dueño no configuró reorden
        }
        else if (status === 'published') whereClause.isPublished = true;
        else if (status === 'unpublished') whereClause.isPublished = false;

        // El bodeguero no recibe precios/costos y tampoco puede inferirlos por
        // el orden relativo de resultados usando `sort=cost|price`.
        const sortableFields = authReq.role === BODEGUERO_ROLE
            ? ['name', 'stock', 'sku', 'category']
            : ['name', 'stock', 'price', 'cost', 'sku', 'category'];
        const sortField = sortableFields.includes(String(sort)) ? String(sort) : 'name';
        const orderBy: any = { [sortField]: dir === 'desc' ? 'desc' : 'asc' };

        // Modo paginado (opt-in: solo si llega `page`) — para la vista de inventario.
        // Sin `page`, devuelve el arreglo completo (compatibilidad con POS y otros).
        if (page) {
            const take = Math.min(200, Math.max(1, parseInt(String(pageSize)) || 50));
            const skip = (Math.max(1, parseInt(String(page)) || 1) - 1) * take;
            const [products, total] = await Promise.all([
                prisma.product.findMany({ where: whereClause, orderBy, skip, take, include: { creator: { select: { name: true, email: true } } } }),
                prisma.product.count({ where: whereClause }),
            ]);
            const visibleProducts = authReq.role === BODEGUERO_ROLE
                ? products.map(redactBodegueroProduct)
                : products;
            return res.json({ products: visibleProducts, total, page: Math.max(1, parseInt(String(page)) || 1), pageSize: take });
        }

        let products = await prisma.product.findMany({
            where: whereClause,
            orderBy,
            include: {
                creator: { select: { name: true, email: true } }
            }
        });

        if (lowStock === 'true') {
            products = products.filter((p: any) => Number(p.stock) <= Number(p.minStock));
        }

        res.json(authReq.role === BODEGUERO_ROLE
            ? products.map(redactBodegueroProduct)
            : products);
    } catch (error) {
        console.error('Error fetching products:', error);
        res.status(500).json({ error: 'Error obteniendo productos' });
    }
});

// GET /api/products/categories — categorías distintas (para el filtro)
app.get('/api/products/categories', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const rows = await prisma.product.findMany({
            where: { tenantId: authReq.tenantId, category: { not: null } },
            select: { category: true },
            distinct: ['category'],
            orderBy: { category: 'asc' },
        });
        res.json(rows.map((r: any) => r.category).filter(Boolean));
    } catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({ error: 'Error obteniendo categorías' });
    }
});

// POST /api/products - Crear producto (OWNER o ADMIN)
app.post('/api/products', authenticate, checkRole(['OWNER', 'ADMIN']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { name, sku, description, category, price, cost, stock, minStock, unit, isPublished, imageUrl, requiresBatchTracking, reorderPoint, maxStock, defaultSupplierId, wholesalePrice, wholesaleMinQty, packUnit, packSize, packPrice, ivaExento } = req.body;

    // Venta por mayor: si vienen, deben ser números > 0 (null/'' = sin mayoreo).
    const wp = wholesalePrice !== undefined && wholesalePrice !== null && wholesalePrice !== '' ? parseFloat(wholesalePrice) : null;
    const wq = wholesaleMinQty !== undefined && wholesaleMinQty !== null && wholesaleMinQty !== '' ? parseFloat(wholesaleMinQty) : null;
    if ((wp !== null && (!Number.isFinite(wp) || wp <= 0)) || (wq !== null && (!Number.isFinite(wq) || wq <= 0))) {
        return res.status(400).json({ error: 'Precio de mayoreo y cantidad mínima deben ser números mayores a 0' });
    }
    // Empaque (Fase B): packSize/packPrice > 0 si vienen; packPrice exige packSize.
    const pUnit = typeof packUnit === 'string' && packUnit.trim() !== '' ? packUnit.trim() : null;
    const pSize = packSize !== undefined && packSize !== null && packSize !== '' ? parseFloat(packSize) : null;
    const pPrice = packPrice !== undefined && packPrice !== null && packPrice !== '' ? parseFloat(packPrice) : null;
    if ((pSize !== null && (!Number.isFinite(pSize) || pSize <= 0)) || (pPrice !== null && (!Number.isFinite(pPrice) || pPrice <= 0))) {
        return res.status(400).json({ error: 'Tamaño y precio del empaque deben ser números mayores a 0' });
    }
    if (pPrice !== null && pSize === null) {
        return res.status(400).json({ error: 'El precio de empaque requiere definir el tamaño del empaque (unidades por caja/fardo)' });
    }

    try {
        // Verificar que SKU no exista
        const existing = await prisma.product.findUnique({
            where: {
                tenantId_sku: {
                    tenantId: authReq.tenantId!,
                    sku
                }
            }
        });

        if (existing) {
            return res.status(400).json({ error: 'SKU ya existe en tu inventario' });
        }

        // Crear producto
        const product = await prisma.product.create({
            data: {
                tenantId: authReq.tenantId!,
                name,
                sku,
                description,
                category,
                price: parseFloat(price),
                // Costo opcional: un pulpero no siempre sabe el costo exacto al dar de
                // alta. Ausente/''/NaN → 0 (el margen se corrige luego con la compra).
                cost: parseFloat(cost) || 0,
                stock: parseFloat(stock) || 0,
                minStock: parseFloat(minStock) || 0,
                unit: unit || 'unidad',
                isPublished: Boolean(isPublished),
                // T2: exoneración de IVA (canasta básica, medicamentos). Default
                // false = gravado; la clasificación legal la decide el negocio.
                ivaExento: Boolean(ivaExento),
                imageUrl: imageUrl || null,
                requiresBatchTracking: Boolean(requiresBatchTracking),
                reorderPoint: parseFloat(reorderPoint) || 0,
                maxStock: parseFloat(maxStock) || 0,
                defaultSupplierId: defaultSupplierId || null,
                wholesalePrice: wp,
                wholesaleMinQty: wq,
                packUnit: pUnit,
                packSize: pSize,
                packPrice: pPrice,
                createdBy: authReq.userId!
            }
        });

        // Crear registro inicial en Kardex si hay stock inicial
        if (product.stock > 0) {
            await prisma.kardexMovement.create({
                data: {
                    tenantId: authReq.tenantId!,
                    productId: product.id,
                    type: 'IN',
                    quantity: product.stock,
                    stockBefore: 0,
                    stockAfter: product.stock,
                    referenceType: 'INITIAL',
                    reason: 'Stock inicial al crear producto',
                    userId: authReq.userId!
                }
            });
        }

        res.json(product);
    } catch (error) {
        console.error('Error creating product:', error);
        res.status(500).json({ error: 'Error creando producto' });
    }
});

// POST /api/products/bulk - Carga masiva de productos (Solo OWNER)
app.post('/api/products/bulk', authenticate, checkRole(['OWNER', 'ADMIN']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { products: productList } = req.body;

    if (!Array.isArray(productList) || productList.length === 0) {
        return res.status(400).json({ error: 'Se requiere un array de productos.' });
    }

    if (productList.length > 500) {
        return res.status(400).json({ error: 'Máximo 500 productos por lote.' });
    }

    try {
        let created = 0;
        let updated = 0;
        let errors: string[] = [];

        // Process in batches of 50 for efficiency
        const batchSize = 50;
        for (let i = 0; i < productList.length; i += batchSize) {
            const batch = productList.slice(i, i + batchSize);

            await prisma.$transaction(async (tx: any) => {
                for (const [batchIdx, item] of batch.entries()) {
                    // Fila REAL del Excel para el mensaje de error (R2.7): el
                    // cliente la manda como excelRow; si no viene (integraciones
                    // viejas), se calcula por posición — antes se usaba
                    // batch.indexOf(item), que ni compensaba el encabezado y
                    // con filas repetidas devolvía siempre la primera.
                    const filaExcel = Number.isFinite(Number(item.excelRow))
                        ? Number(item.excelRow)
                        : i + batchIdx + 2; // +2: 1-based + fila de encabezado
                    try {
                        const sku = String(item.sku || '').trim().toUpperCase();
                        const name = String(item.name || item.nombre || '').trim();
                        const price = parseFloat(item.price || item.precio || 0);
                        const cost = parseFloat(item.cost || item.costo || item.costPrice || 0);
                        const stock = parseFloat(item.stock || 0) || 0;
                        const minStock = parseFloat(item.minStock || 5) || 5;
                        const category = String(item.category || item.categoria || 'General').trim();
                        const unit = String(item.unit || item.unidad || 'unidad').trim();

                        // ⚠️ continue, NO return: un `return` acá sale del
                        // callback COMPLETO de la transacción (no de la
                        // iteración) — una sola fila mala descartaba en
                        // silencio hasta 49 productos restantes del lote y
                        // el resumen igual decía "Importación exitosa".
                        if (!sku || !name) {
                            errors.push(`Fila ${filaExcel}: sin código o sin nombre`);
                            continue;
                        }

                        if (!Number.isFinite(price) || price <= 0) {
                            errors.push(`Fila ${filaExcel} (${sku}): precio inválido`);
                            continue;
                        }

                        // Upsert: si SKU existe, actualiza; si no, crea
                        const existing = await tx.product.findUnique({
                            where: { tenantId_sku: { tenantId: authReq.tenantId!, sku } }
                        });

                        if (existing) {
                            const stockDiff = stock - existing.stock;
                            await tx.product.update({
                                where: { id: existing.id },
                                data: { name, price, cost, stock, minStock, category, unit }
                            });

                            // Auditoría de cambio de precio/costo en carga masiva: el PUT
                            // unitario deja rastro PRICE_CHANGED; sin esto el bulk sería una
                            // vía de evasión para reescribir la base de valuación (cost) y el
                            // precio sin asiento inmutable before/after.
                            const priceChanged = Number(existing.price) !== Number(price);
                            const costChanged  = Number(existing.cost)  !== Number(cost);
                            if (priceChanged || costChanged) {
                                await tx.auditLog.create({
                                    data: {
                                        tenantId: authReq.tenantId!,
                                        userId: authReq.userId!,
                                        action: 'PRICE_CHANGED',
                                        details: JSON.stringify({
                                            productId: existing.id,
                                            priceBefore: String(existing.price), priceAfter: String(price),
                                            costBefore: String(existing.cost), costAfter: String(cost),
                                            origen: 'BULK_IMPORT',
                                        }),
                                    }
                                });
                            }

                            // Kardex para el cambio de stock
                            if (stockDiff !== 0) {
                                await tx.kardexMovement.create({
                                    data: {
                                        tenantId: authReq.tenantId!,
                                        productId: existing.id,
                                        type: 'IN_PURCHASE',
                                        quantity: stockDiff,
                                        stockBefore: existing.stock,
                                        stockAfter: stock,
                                        referenceType: 'BULK_IMPORT',
                                        reason: 'Carga masiva - actualización',
                                        userId: authReq.userId!
                                    }
                                });
                            }
                            updated++;
                        } else {
                            const product = await tx.product.create({
                                data: {
                                    tenantId: authReq.tenantId!,
                                    name, sku, price, cost, stock, minStock, category, unit,
                                    createdBy: authReq.userId!
                                }
                            });

                            // Kardex inicial
                            if (stock > 0) {
                                await tx.kardexMovement.create({
                                    data: {
                                        tenantId: authReq.tenantId!,
                                        productId: product.id,
                                        type: 'IN_PURCHASE',
                                        quantity: stock,
                                        stockBefore: 0,
                                        stockAfter: stock,
                                        referenceType: 'BULK_IMPORT',
                                        reason: 'Carga masiva - producto nuevo',
                                        userId: authReq.userId!
                                    }
                                });
                            }
                            created++;
                        }
                    } catch (itemError: any) {
                        errors.push(`Fila ${filaExcel} (${item.sku || 'sin código'}): ${itemError.message}`);
                    }
                }
            });
        }

        res.json({
            message: `Importación completada: ${created} creados, ${updated} actualizados`,
            created,
            updated,
            // Antes se cortaba en 20: "Errores: 47" sin decir cuáles. El lote
            // máximo es 500, la lista completa cabe en la respuesta.
            errors: errors.length > 0 ? errors.slice(0, 500) : [],
            total: productList.length
        });
    } catch (error: any) {
        console.error('Error en carga masiva:', error);
        res.status(500).json({ error: error.message || 'Error en carga masiva' });
    }
});

// PUT /api/products/:id - Actualizar producto (Solo OWNER)
app.put('/api/products/:id', authenticate, checkRole(['OWNER', 'ADMIN']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { id } = req.params;
    const { name, description, category, price, cost, stock, minStock, unit, imageUrl, reorderPoint, maxStock, defaultSupplierId, wholesalePrice, wholesaleMinQty, packUnit, packSize, packPrice, ivaExento } = req.body;

    try {
        const existing = await prisma.product.findFirst({
            where: { id, tenantId: authReq.tenantId! }
        });

        if (!existing) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        const updates: any = {};
        if (name !== undefined) updates.name = name;
        if (description !== undefined) updates.description = description;
        if (category !== undefined) updates.category = category;
        if (price !== undefined) updates.price = parseFloat(price);
        if (cost !== undefined) updates.cost = parseFloat(cost);
        // Stock/minStock son Float (admiten unidades fraccionables kg/litro/metro):
        // parseFloat preserva la fracción; parseInt truncaba y perdía inventario.
        if (minStock !== undefined) updates.minStock = parseFloat(minStock);
        if (unit !== undefined) updates.unit = unit;
        // T2: reclasificar exoneración de IVA. Las ventas YA registradas no cambian
        // (SaleItem.ivaExento es una foto del momento de la venta).
        if (ivaExento !== undefined) updates.ivaExento = Boolean(ivaExento);
        if (imageUrl !== undefined) updates.imageUrl = imageUrl;
        if (reorderPoint !== undefined) updates.reorderPoint = parseFloat(reorderPoint) || 0;
        if (maxStock !== undefined) updates.maxStock = parseFloat(maxStock) || 0;
        if (defaultSupplierId !== undefined) updates.defaultSupplierId = defaultSupplierId || null;
        // Venta por mayor: '' o null limpian el mayoreo; si viene valor, debe ser > 0.
        if (wholesalePrice !== undefined) {
            const wp = wholesalePrice === null || wholesalePrice === '' ? null : parseFloat(wholesalePrice);
            if (wp !== null && (!Number.isFinite(wp) || wp <= 0)) {
                return res.status(400).json({ error: 'El precio de mayoreo debe ser un número mayor a 0' });
            }
            updates.wholesalePrice = wp;
        }
        if (wholesaleMinQty !== undefined) {
            const wq = wholesaleMinQty === null || wholesaleMinQty === '' ? null : parseFloat(wholesaleMinQty);
            if (wq !== null && (!Number.isFinite(wq) || wq <= 0)) {
                return res.status(400).json({ error: 'La cantidad mínima de mayoreo debe ser mayor a 0' });
            }
            updates.wholesaleMinQty = wq;
        }
        // Empaque (Fase B): '' o null limpian; valores > 0. La validación cruzada
        // (packPrice exige packSize) se hace sobre el ESTADO FINAL (update parcial).
        if (packUnit !== undefined) {
            updates.packUnit = typeof packUnit === 'string' && packUnit.trim() !== '' ? packUnit.trim() : null;
        }
        if (packSize !== undefined) {
            const ps = packSize === null || packSize === '' ? null : parseFloat(packSize);
            if (ps !== null && (!Number.isFinite(ps) || ps <= 0)) {
                return res.status(400).json({ error: 'El tamaño del empaque debe ser mayor a 0' });
            }
            updates.packSize = ps;
        }
        if (packPrice !== undefined) {
            const pp = packPrice === null || packPrice === '' ? null : parseFloat(packPrice);
            if (pp !== null && (!Number.isFinite(pp) || pp <= 0)) {
                return res.status(400).json({ error: 'El precio del empaque debe ser mayor a 0' });
            }
            updates.packPrice = pp;
        }
        {
            const finalSize = updates.packSize !== undefined ? updates.packSize : existing.packSize;
            const finalPackPrice = updates.packPrice !== undefined ? updates.packPrice : existing.packPrice;
            if (finalPackPrice != null && finalSize == null) {
                return res.status(400).json({ error: 'El precio de empaque requiere un tamaño de empaque definido' });
            }
        }

        // Kardex (ledger inmutable) + product.update + auditoría deben cuadrar o
        // revertirse juntos: se ejecutan dentro de una única $transaction. El ajuste
        // de stock se hace con applyStockDelta (UPDATE relativo con row-lock), de modo
        // que stockBefore/stockAfter salen sin condición de carrera y el Kardex solo
        // se escribe si el stock realmente cambió (delta != 0, sin truncar).
        const updated = await prisma.$transaction(async (tx: any) => {
            if (stock !== undefined) {
                const newStock = parseFloat(stock);
                const stockDiff = newStock - Number(existing.stock);

                if (stockDiff !== 0) {
                    const { stockBefore, stockAfter } = await applyStockDelta(tx, {
                        tenantId: authReq.tenantId!,
                        productId: id,
                        delta: stockDiff,
                        enforceSufficient: false,
                    });

                    await tx.kardexMovement.create({
                        data: {
                            tenantId: authReq.tenantId!,
                            productId: id,
                            type: 'ADJUSTMENT',
                            quantity: stockDiff,
                            stockBefore,
                            stockAfter,
                            referenceType: 'ADJUSTMENT',
                            reason: 'Ajuste manual de inventario',
                            userId: authReq.userId!
                        }
                    });
                }
            }

            const result = await tx.product.update({
                where: { id },
                data: updates
            });

            // Auditoría de cambio de precio/costo (antes no quedaba rastro de quién lo cambió).
            const priceChanged = price !== undefined && Number(existing.price) !== Number(result.price);
            const costChanged  = cost  !== undefined && Number(existing.cost)  !== Number(result.cost);
            if (priceChanged || costChanged) {
                await tx.auditLog.create({
                    data: {
                        tenantId: authReq.tenantId!,
                        userId: authReq.userId!,
                        action: 'PRICE_CHANGED',
                        details: JSON.stringify({
                            productId: id,
                            priceBefore: String(existing.price), priceAfter: String(result.price),
                            costBefore: String(existing.cost), costAfter: String(result.cost),
                        }),
                    },
                });
            }

            return result;
        });

        res.json(updated);
    } catch (error) {
        console.error('Error updating product:', error);
        res.status(500).json({ error: 'Error actualizando producto' });
    }
});

// PATCH /api/products/publish-bulk - Bulk toggle public catalog visibility (Solo OWNER/ADMIN)
app.patch('/api/products/publish-bulk', authenticate, checkRole(['OWNER', 'ADMIN']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { productIds, isPublished } = req.body;

    if (!Array.isArray(productIds) || productIds.length === 0) {
        return res.status(400).json({ error: 'Lista de productos inválida' });
    }

    try {
        const result = await prisma.product.updateMany({
            where: {
                id: { in: productIds },
                tenantId: authReq.tenantId!
            },
            data: { isPublished }
        });

        res.json({ message: `${result.count} productos actualizados`, count: result.count });
    } catch (error) {
        console.error('Error bulk updating products:', error);
        res.status(500).json({ error: 'Error actualizando productos' });
    }
});

// PATCH /api/products/bulk-edit - Edición masiva de categoría y/o precio (Solo OWNER/ADMIN)
// [Bodeguero A2] No toca stock ni costo (el costo es promedio ponderado del sistema).
//   priceMode 'set' → fija el precio; 'pct' → ajusta ± un porcentaje (redondeado a 2 dec.).
app.patch('/api/products/bulk-edit', authenticate, checkRole(['OWNER', 'ADMIN']), validate(BulkEditProductsSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { ids, category, priceMode, priceValue } = req.body;

    try {
        let count = 0;
        // before/after por producto → asiento reconstruible ante disputa/reversión.
        const priceChanges: { id: string; priceBefore: string; priceAfter: string }[] = [];

        if (priceMode === 'pct') {
            // Ajuste porcentual: requiere leer cada precio → recalcular → redondear.
            // Dinero: se calcula con decimal.js (half-up a 2 decimales), no con
            // aritmética Float nativa que arrastra errores de ±1 centavo.
            const factor = new Decimal(1).plus(new Decimal(priceValue).div(100));
            count = await prisma.$transaction(async (tx: any) => {
                const prods = await tx.product.findMany({
                    where: { id: { in: ids }, tenantId: authReq.tenantId! },
                    select: { id: true, price: true },
                });
                for (const p of prods) {
                    const priceBefore = new Decimal(p.price.toString());
                    let newPrice = priceBefore.mul(factor).toDecimalPlaces(2);
                    if (newPrice.isNegative()) newPrice = new Decimal(0);
                    const data: any = { price: newPrice.toNumber() };
                    if (category !== undefined) data.category = category;
                    await tx.product.update({ where: { id: p.id }, data });
                    priceChanges.push({ id: p.id, priceBefore: priceBefore.toFixed(2), priceAfter: newPrice.toFixed(2) });
                }
                return prods.length;
            });
        } else {
            // 'set' y/o categoría. El precio 'set' se normaliza con decimal.js.
            const newPriceSet = priceMode === 'set' ? new Decimal(priceValue).toDecimalPlaces(2) : null;
            count = await prisma.$transaction(async (tx: any) => {
                // En modo 'set' leemos los precios previos antes del updateMany para
                // registrar before/after por producto en la auditoría.
                if (newPriceSet) {
                    const prods = await tx.product.findMany({
                        where: { id: { in: ids }, tenantId: authReq.tenantId! },
                        select: { id: true, price: true },
                    });
                    for (const p of prods) {
                        priceChanges.push({ id: p.id, priceBefore: new Decimal(p.price.toString()).toFixed(2), priceAfter: newPriceSet.toFixed(2) });
                    }
                }
                const data: any = {};
                if (category !== undefined) data.category = category;
                if (newPriceSet) data.price = newPriceSet.toNumber();
                const result = await tx.product.updateMany({
                    where: { id: { in: ids }, tenantId: authReq.tenantId! },
                    data,
                });
                return result.count;
            });
        }

        // Rastro de auditoría: una mutación masiva de precios/categoría debe quedar registrada.
        await prisma.auditLog.create({
            data: {
                tenantId: authReq.tenantId!,
                userId: authReq.userId!,
                action: 'PRODUCT_BULK_EDIT',
                details: JSON.stringify({
                    count,
                    requestedIds: ids.length,
                    category: category ?? null,
                    priceMode: priceMode ?? null,
                    priceValue: priceValue ?? null,
                    priceChanges,
                    timestamp: new Date().toISOString(),
                }),
            },
        });

        res.json({ message: `${count} producto(s) actualizado(s).`, count });
    } catch (error: any) {
        console.error('Error en edición masiva:', error);
        res.status(500).json({ error: error.message || 'Error en edición masiva' });
    }
});

// PATCH /api/products/:id/publish - Toggle public catalog visibility (Solo OWNER/ADMIN)
app.patch('/api/products/:id/publish', authenticate, checkRole(['OWNER', 'ADMIN']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { id } = req.params;
    const { isPublished } = req.body;

    try {
        const product = await prisma.product.findFirst({
            where: { id, tenantId: authReq.tenantId! }
        });

        if (!product) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        const updated = await prisma.product.update({
            where: { id },
            data: { isPublished }
        });

        res.json(updated);
    } catch (error) {
        console.error('Error toggling product publish status:', error);
        res.status(500).json({ error: 'Error actualizando estado del producto' });
    }
});

// DELETE /api/products/:id - Eliminar producto (Solo OWNER, solo si stock = 0)
app.delete('/api/products/:id', authenticate, checkRole(['OWNER', 'ADMIN']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { id } = req.params;

    try {
        const product = await prisma.product.findFirst({
            where: { id, tenantId: authReq.tenantId! }
        });

        if (!product) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        if (product.stock > 0) {
            return res.status(400).json({
                error: 'No se puede eliminar un producto con stock. Ajusta el stock a 0 primero.'
            });
        }

        // Asiento inmutable ANTES de borrar (Capa 3): deja rastro de quién eliminó el
        // producto con un snapshot `before` completo, dentro de la misma transacción que
        // el borrado para que ambos cuadren o se reviertan juntos.
        // NOTA: el soft-delete (deletedAt) y el corte de las cascadas onDelete sobre
        // KardexMovement/ProductBatch/StockCountItem requieren migración de esquema y
        // quedan fuera del alcance de este archivo.
        await prisma.$transaction(async (tx: any) => {
            await tx.auditLog.create({
                data: {
                    tenantId: authReq.tenantId!,
                    userId: authReq.userId!,
                    action: 'PRODUCT_DELETED',
                    details: JSON.stringify({
                        productId: product.id,
                        before: {
                            id: product.id,
                            name: product.name,
                            sku: product.sku,
                            category: product.category,
                            price: Number(product.price),
                            cost: Number(product.cost),
                            stock: Number(product.stock),
                            minStock: Number(product.minStock),
                            unit: product.unit,
                        },
                        timestamp: new Date().toISOString(),
                    }),
                },
            });
            // Propiedad ya verificada (findFirst con tenantId); borramos por id propio.
            await tx.product.delete({ where: { id: product.id } });
        });

        res.json({ message: 'Producto eliminado exitosamente' });
    } catch (error) {
        console.error('Error deleting product:', error);
        res.status(500).json({ error: 'Error eliminando producto' });
    }
});

// GET /api/kardex/:productId - Historial de movimientos (Solo OWNER)
// [Bodeguero A5] Filtro por rango de fechas (hora Nicaragua, UTC-6) + paginación opt-in.
//   - Sin ?page  → array (compat: últimos 50, respetando from/to si vienen).
//   - Con  ?page → { entries, total, page, pageSize }.
app.get('/api/kardex/:productId', authenticate, checkRole(['OWNER', 'ADMIN', BODEGUERO_ROLE]), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { productId } = req.params;
    const { from, to, page, pageSize } = req.query;

    try {
        const where: any = { productId, tenantId: authReq.tenantId! };

        // Rango de fechas interpretado como días locales de Nicaragua (UTC-6, sin DST).
        const NI_OFFSET_MS = 6 * 3600 * 1000;
        const DAY_MS = 24 * 3600 * 1000;
        if (from || to) {
            where.date = {};
            if (from) {
                const d = String(from).slice(0, 10);
                where.date.gte = new Date(new Date(d + 'T00:00:00.000Z').getTime() + NI_OFFSET_MS);
            }
            if (to) {
                const d = String(to).slice(0, 10);
                where.date.lte = new Date(new Date(d + 'T00:00:00.000Z').getTime() + NI_OFFSET_MS + DAY_MS - 1);
            }
        }

        const include = {
            // El operador necesita saber quién hizo el movimiento, no el correo
            // privado del compañero.
            user: { select: authReq.role === BODEGUERO_ROLE ? { name: true } : { name: true, email: true } },
            product: { select: { name: true, sku: true } },
            batch: { select: { batchNumber: true, expiryDate: true } },
        };

        if (page !== undefined) {
            const take = Math.min(200, Math.max(1, parseInt(pageSize) || 50));
            const pageNum = Math.max(1, parseInt(page) || 1);
            const [entries, total] = await Promise.all([
                prisma.kardexMovement.findMany({
                    where,
                    include,
                    orderBy: { date: 'desc' },
                    skip: (pageNum - 1) * take,
                    take,
                }),
                prisma.kardexMovement.count({ where }),
            ]);
            return res.json({ entries, total, page: pageNum, pageSize: take });
        }

        const movements = await prisma.kardexMovement.findMany({
            where,
            include,
            orderBy: { date: 'desc' },
            take: 50,
        });

        res.json(movements);
    } catch (error) {
        console.error('Error fetching kardex:', error);
        res.status(500).json({ error: 'Error obteniendo historial' });
    }
});

// ==========================================
// 🛡️ AJUSTE DE INVENTARIO BLINDADO (SOLO OWNER)
// ==========================================

app.post('/api/inventory/adjust', authenticate, checkRole(['OWNER', 'ADMIN', BODEGUERO_ROLE]), validate(InventoryAdjustSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { productId, warehouseId: requestedWarehouseId, quantity, reason, type } = req.body;

    // Validaciones estrictas
    if (!productId || quantity === undefined || quantity === null) {
        return res.status(400).json({ error: 'productId y quantity son obligatorios.' });
    }

    const adjustQty = parseInt(quantity);
    if (isNaN(adjustQty) || adjustQty === 0) {
        return res.status(400).json({ error: 'La cantidad debe ser un número distinto de cero.' });
    }

    // Determinar tipo de movimiento
    const movementType = type || (adjustQty > 0 ? 'ADJUST_GAIN' : 'ADJUST_LOSS');
    const validTypes = ['ADJUST_LOSS', 'ADJUST_GAIN', 'IN_PURCHASE', 'RETURN'];
    if (!validTypes.includes(movementType)) {
        return res.status(400).json({ error: `Tipo inválido. Permitidos: ${validTypes.join(', ')}` });
    }
    if (authReq.role === BODEGUERO_ROLE && !['ADJUST_LOSS', 'ADJUST_GAIN'].includes(movementType)) {
        return res.status(403).json({
            error: 'El rol Bodeguero solo puede registrar ajustes físicos de pérdida o ganancia.',
            code: 'BODEGUERO_ADJUSTMENT_TYPE_FORBIDDEN',
        });
    }
    const isLoss = movementType === 'ADJUST_LOSS';
    if ((isLoss && adjustQty > 0) || (!isLoss && adjustQty < 0)) {
        return res.status(400).json({
            error: isLoss
                ? 'Una pérdida debe enviar una cantidad negativa.'
                : 'Las entradas y devoluciones deben enviar una cantidad positiva.',
        });
    }

    // Reason es OBLIGATORIO para ajustes manuales
    if ((movementType === 'ADJUST_LOSS' || movementType === 'ADJUST_GAIN') && (!reason || reason.trim().length < 3)) {
        return res.status(400).json({ error: 'La justificación es obligatoria para ajustes (mínimo 3 caracteres).' });
    }

    try {
        await asegurarBodegaPorDefecto(prisma, authReq.tenantId!);

        // TRANSACCIÓN ACID
        const result = await prisma.$transaction(async (tx: any) => {
            const operationWarehouse = await resolveOperationalWarehouse(
                tx,
                authReq.tenantId!,
                requestedWarehouseId,
            );

            // Orden único de locks para mutaciones: Product → ProductStock.
            const productRows: Array<{ name: string; sku: string }> = await tx.$queryRaw`
                SELECT name, sku FROM \`Product\`
                WHERE id = ${productId} AND tenantId = ${authReq.tenantId!}
                FOR UPDATE`;
            const product = productRows[0];
            if (!product) throw new StockError('PRODUCT_NOT_FOUND', 'Producto no encontrado en tu inventario.');

            await materializeWarehouseRow(tx, {
                tenantId: authReq.tenantId!,
                productId,
                warehouseId: operationWarehouse.id,
                isDefault: operationWarehouse.isDefault,
            });
            const warehouseRows: Array<{ stock: any }> = await tx.$queryRaw`
                SELECT stock FROM \`ProductStock\`
                WHERE productId = ${productId}
                  AND warehouseId = ${operationWarehouse.id}
                  AND tenantId = ${authReq.tenantId!}
                FOR UPDATE`;
            if (warehouseRows.length === 0) {
                throw new Error('No se pudo preparar el stock de la bodega seleccionada.');
            }
            const warehouseStockBefore = Number(warehouseRows[0].stock);
            if (adjustQty < 0 && warehouseStockBefore < Math.abs(adjustQty)) {
                throw new StockError(
                    'INSUFFICIENT_STOCK',
                    `Stock insuficiente en ${operationWarehouse.name}. Disponible: ${warehouseStockBefore}.`,
                );
            }

            // 2. Mutar el stock de forma ATÓMICA (UPDATE condicional con row-lock).
            //    El patrón anterior leía el stock con findFirst (lectura no bloqueante) y
            //    escribía un valor ABSOLUTO, pisando cualquier venta concurrente (lost
            //    update). applyStockDelta aplica el delta relativo con lock de fila y, en
            //    pérdidas (delta<0), rechaza si el stock no alcanza.
            const {
                stockBefore: aggregateStockBefore,
                stockAfter: aggregateStockAfter,
                warehouseId,
            } = await applyStockDelta(tx, {
                tenantId: authReq.tenantId!,
                productId,
                delta: adjustQty,
                enforceSufficient: adjustQty < 0,
                warehouseId: operationWarehouse.id,
            });
            const warehouseStockAfter = warehouseStockBefore + adjustQty;

            // 3. Crear registro Kardex inmutable
            const movement = await tx.kardexMovement.create({
                data: {
                    tenantId: authReq.tenantId!,
                    productId,
                    type: movementType,
                    quantity: adjustQty,
                    stockBefore: warehouseStockBefore,
                    stockAfter: warehouseStockAfter,
                    referenceType: 'ADJUSTMENT',
                    reason: reason?.trim() || `Ajuste manual: ${movementType}`,
                    userId: authReq.userId!,
                    warehouseId,
                }
            });

            // 4. Auditar TODO ajuste manual (pérdida Y ganancia): un ADJUST_GAIN infla el
            //    inventario valorizado y también debe dejar asiento inmutable before/after.
            await tx.auditLog.create({
                data: {
                    tenantId: authReq.tenantId!,
                    userId: authReq.userId!,
                    action: 'INVENTORY_ADJUSTMENT',
                    details: JSON.stringify({
                        productId,
                        productName: product.name,
                        sku: product.sku,
                        movementType,
                        warehouseId: operationWarehouse.id,
                        warehouseName: operationWarehouse.name,
                        direction: adjustQty < 0 ? 'LOSS' : 'GAIN',
                        quantity: adjustQty,
                        warehouseStockBefore,
                        warehouseStockAfter,
                        aggregateStockBefore,
                        aggregateStockAfter,
                        reason: reason?.trim() || null,
                        timestamp: new Date().toISOString()
                    })
                }
            });

            return {
                movement,
                productName: product.name,
                warehouseName: operationWarehouse.name,
                warehouseStock: warehouseStockAfter,
                aggregateStock: aggregateStockAfter,
            };
        });

        res.json({
            message: `Ajuste registrado en ${result.warehouseName}: ${result.productName} → ${result.warehouseStock}`,
            movement: result.movement,
            newStock: result.aggregateStock,
            warehouseStock: result.warehouseStock,
            aggregateStock: result.aggregateStock,
        });
    } catch (error: any) {
        if (error instanceof StockError) {
            const status = error.code === 'PRODUCT_NOT_FOUND' ? 404 : 400;
            return res.status(status).json({ error: error.message, code: error.code });
        }
        console.error('Error en ajuste de inventario:', error);
        res.status(error.message?.includes('no encontrado') || error.message?.includes('insuficiente') ? 400 : 500)
            .json({ error: error.message || 'Error procesando ajuste de inventario' });
    }
});

// GET /api/inventory/batches/:productId - Lotes activos de un producto
app.get('/api/inventory/batches/:productId', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { productId } = req.params;
    try {
        const batches = await prisma.productBatch.findMany({
            where: { productId, tenantId: authReq.tenantId, stock: { gt: 0 } },
            orderBy: { expiryDate: 'asc' }
        });
        res.json(batches);
    } catch (error) {
        console.error('Error fetching batches:', error);
        res.status(500).json({ error: 'Error obteniendo lotes' });
    }
});

// POST /api/inventory/batches - Alta de lote (Solo OWNER/ADMIN)
// [Bodeguero A4] Crea (o incrementa) un lote, suma el stock del producto de forma
//   atómica vía applyStockDelta y deja rastro en el Kardex enlazado al lote. Activa el
//   control de lotes del producto si aún no lo tenía (FEFO/alertas de vencimiento).
app.post('/api/inventory/batches', authenticate, checkRole(['OWNER', 'ADMIN']), validate(CreateBatchSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { productId, batchNumber, expiryDate, quantity } = req.body;

    const expiry = new Date(String(expiryDate).slice(0, 10) + 'T00:00:00.000Z');
    if (isNaN(expiry.getTime())) {
        return res.status(400).json({ error: 'Fecha de vencimiento inválida.' });
    }

    try {
        const result = await prisma.$transaction(async (tx: any) => {
            const product = await tx.product.findFirst({
                where: { id: productId, tenantId: authReq.tenantId! },
            });
            if (!product) throw new Error('Producto no encontrado en tu inventario.');

            // 1. Sumar stock del producto (atómico, row-lock).
            const { stockBefore, stockAfter } = await applyStockDelta(tx, {
                tenantId: authReq.tenantId!,
                productId,
                delta: quantity,
                enforceSufficient: false,
            });

            // 2. Crear o incrementar el lote (mismo lote = se acumula).
            const batch = await tx.productBatch.upsert({
                where: { productId_batchNumber: { productId, batchNumber } },
                update: { stock: { increment: quantity } },
                create: {
                    tenantId: authReq.tenantId!,
                    productId,
                    batchNumber,
                    expiryDate: expiry,
                    stock: quantity,
                },
            });

            // 3. Activar control de lotes si aún no estaba (habilita FEFO + alertas).
            if (!product.requiresBatchTracking) {
                await tx.product.update({
                    where: { id: productId },
                    data: { requiresBatchTracking: true },
                });
            }

            // 4. Kardex: entrada por alta de lote, enlazada al lote.
            const movement = await tx.kardexMovement.create({
                data: {
                    tenantId: authReq.tenantId!,
                    productId,
                    type: 'IN_PURCHASE',
                    quantity,
                    stockBefore,
                    stockAfter,
                    referenceType: 'BATCH',
                    reason: `Alta de lote ${batchNumber} (vence ${expiry.toISOString().slice(0, 10)})`,
                    userId: authReq.userId!,
                    batchId: batch.id,
                },
            });

            return { batch, movement, newStock: stockAfter, productName: product.name };
        });

        res.json({
            message: `Lote ${batchNumber} agregado a ${result.productName}. Stock: ${result.newStock}`,
            batch: result.batch,
            newStock: result.newStock,
        });
    } catch (error: any) {
        console.error('Error creando lote:', error);
        res.status(error.message?.includes('no encontrado') ? 400 : 500)
            .json({ error: error.message || 'Error creando lote' });
    }
});

// POST /api/inventory/batches/:batchId/writeoff - Dar de baja un lote (merma) [Bodeguero B3]
// Resta el stock restante del lote del producto, deja Kardex y asiento de merma
// (Debe 5.1.2 Pérdida por Merma / Haber 1.1.4 Inventario, valuado al costo).
app.post('/api/inventory/batches/:batchId/writeoff', authenticate, checkRole(['OWNER', 'ADMIN']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { batchId } = req.params;
    const reason = (req.body?.reason || '').toString().trim();
    try {
        await seedChartOfAccounts(authReq.tenantId!); // garantiza 5.1.2 / 1.1.4

        const result = await prisma.$transaction(async (tx: any) => {
            const batch = await tx.productBatch.findFirst({
                where: { id: batchId, tenantId: authReq.tenantId! },
                include: { product: { select: { name: true, cost: true } } },
            });
            if (!batch) throw new Error('Lote no encontrado');
            const qty = Number(batch.stock);
            if (qty <= 0) throw new Error('El lote no tiene stock para dar de baja.');
            // Período cerrado → no se permite dar de baja (aun si el costo fuese 0).
            await assertPeriodOpen(tx, authReq.tenantId!, new Date());

            // Restar del stock del producto (realidad física: el lote se descarta).
            const { stockBefore, stockAfter } = await applyStockDelta(tx, {
                tenantId: authReq.tenantId!,
                productId: batch.productId,
                delta: -qty,
                enforceSufficient: false,
            });

            await tx.productBatch.update({ where: { id: batchId }, data: { stock: 0 } });

            await tx.kardexMovement.create({
                data: {
                    tenantId: authReq.tenantId!,
                    productId: batch.productId,
                    type: 'ADJUST_LOSS',
                    quantity: -qty,
                    stockBefore,
                    stockAfter,
                    referenceId: batchId,
                    referenceType: 'BATCH_WRITEOFF',
                    reason: reason || `Baja de lote ${batch.batchNumber} (vence ${new Date(batch.expiryDate).toISOString().slice(0, 10)})`,
                    userId: authReq.userId!,
                    batchId,
                },
            });

            await tx.auditLog.create({
                data: {
                    tenantId: authReq.tenantId!,
                    userId: authReq.userId!,
                    action: 'BATCH_WRITEOFF',
                    details: JSON.stringify({ batchId, batchNumber: batch.batchNumber, productName: batch.product.name, quantity: qty, expiryDate: batch.expiryDate, reason: reason || null, timestamp: new Date().toISOString() }),
                },
            });

            const lossValue = new Decimal(qty).times(Number(batch.product.cost) || 0).toDecimalPlaces(2).toNumber();
            if (lossValue > 0) {
                await createJournalEntry(
                    tx, authReq.tenantId!, `Baja de lote vencido ${batch.batchNumber}`, batchId, 'BATCH_WRITEOFF', authReq.userId!,
                    [
                        { accountCode: '5.1.2', debit: lossValue, credit: 0 },
                        { accountCode: '1.1.4', debit: 0, credit: lossValue },
                    ]
                );
            }

            return { newStock: stockAfter, lossValue, batchNumber: batch.batchNumber, qty };
        });

        res.json({ message: `Lote ${result.batchNumber} dado de baja (${result.qty} uds). Merma: C$ ${result.lossValue.toFixed(2)}`, ...result });
    } catch (error: any) {
        console.error('Error dando de baja lote:', error);
        const msg = error?.message || 'Error dando de baja el lote';
        const code = error instanceof PeriodLockedError ? 423 : (msg.includes('no encontrado') || msg.includes('stock')) ? 400 : 500;
        res.status(code).json({ error: msg });
    }
});

// GET /api/inventory/expiring-soon - Lotes próximos a vencer (≤ 90 días)
app.get('/api/inventory/expiring-soon', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const ninetyDaysFromNow = new Date();
        ninetyDaysFromNow.setDate(ninetyDaysFromNow.getDate() + 90);

        const batches = await prisma.productBatch.findMany({
            where: { 
                tenantId: authReq.tenantId, 
                stock: { gt: 0 },
                expiryDate: { lte: ninetyDaysFromNow }
            },
            include: { product: { select: { name: true, sku: true } } },
            orderBy: { expiryDate: 'asc' },
            take: 50
        });
        res.json(batches);
    } catch (error) {
        console.error('Error fetching expiring batches:', error);
        res.status(500).json({ error: 'Error obteniendo lotes por vencer' });
    }
});

// GET /api/inventory/low-stock - Productos con stock bajo (Solo OWNER)
app.get('/api/inventory/low-stock', authenticate, checkRole(['OWNER', 'ADMIN']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;

    try {
        const allProducts = await prisma.product.findMany({
            where: { tenantId: authReq.tenantId! },
            orderBy: { stock: 'asc' }
        });

        const products = allProducts.filter((p: any) => Number(p.stock) <= Number(p.minStock));

        res.json(products);
    } catch (error) {
        console.error('Error fetching low stock:', error);
        res.status(500).json({ error: 'Error obteniendo productos con stock bajo' });
    }
});

// ==========================================
// 🧮 TOMA FÍSICA / CONTEO CÍCLICO (Bodeguero B1) — Solo OWNER/ADMIN
// ==========================================

class StockCountFlowError extends Error {
    constructor(
        public readonly statusCode: number,
        public readonly code: string,
        message: string,
        public readonly meta?: Record<string, unknown>,
    ) {
        super(message);
        this.name = 'StockCountFlowError';
    }
}

// POST /api/stock-counts - Crear conteo + snapshot del stock esperado
app.post('/api/stock-counts', authenticate, checkRole(['OWNER', 'ADMIN', BODEGUERO_ROLE]), validate(CreateStockCountSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { scope, category, notes, warehouseId: requestedWarehouseId } = req.body;
    try {
        await asegurarBodegaPorDefecto(prisma, authReq.tenantId!);

        const result = await prisma.$transaction(async (tx: any) => {
            const warehouse = await resolveOperationalWarehouse(tx, authReq.tenantId!, requestedWarehouseId);
            const legacyOpen = await tx.stockCount.findFirst({
                where: { tenantId: authReq.tenantId!, warehouseId: null, status: 'OPEN' },
                select: { id: true },
            });
            if (legacyOpen) {
                throw new StockCountFlowError(
                    409,
                    'LEGACY_STOCK_COUNT_WITHOUT_WAREHOUSE',
                    'Hay una toma física antigua sin bodega. Cancelala antes de iniciar un conteo por ubicación.',
                    { openCountId: legacyOpen.id },
                );
            }
            const open = await tx.stockCount.findFirst({
                where: { tenantId: authReq.tenantId!, warehouseId: warehouse.id, status: 'OPEN' },
                select: { id: true },
            });
            if (open) {
                throw new StockCountFlowError(
                    409,
                    'STOCK_COUNT_ALREADY_OPEN',
                    `Ya hay una toma física abierta en ${warehouse.name}.`,
                    { openCountId: open.id, warehouseId: warehouse.id },
                );
            }

            const where: any = { tenantId: authReq.tenantId! };
            if (scope === 'CATEGORY') where.category = category;
            const products = await tx.product.findMany({
                where,
                select: { id: true, stock: true },
                orderBy: { id: 'asc' },
            });
            if (products.length === 0) {
                throw new StockCountFlowError(400, 'EMPTY_STOCK_COUNT_SCOPE', 'No hay productos en el alcance seleccionado.');
            }

            const productIds = products.map((product: any) => product.id);
            const stockRows = await tx.productStock.findMany({
                where: { tenantId: authReq.tenantId!, productId: { in: productIds } },
                select: { productId: true, warehouseId: true, stock: true },
            });
            const rowsByProduct = new Map<string, Array<{ warehouseId: string; stock: number }>>();
            for (const row of stockRows) {
                const rows = rowsByProduct.get(row.productId) || [];
                rows.push({ warehouseId: row.warehouseId, stock: Number(row.stock) });
                rowsByProduct.set(row.productId, rows);
            }
            const snapshot = products.map((product: any) => {
                const rows = rowsByProduct.get(product.id) || [];
                const explicit = rows.find((row) => row.warehouseId === warehouse.id);
                const expected = explicit
                    ? explicit.stock
                    : warehouse.isDefault
                        ? Number(product.stock) - rows.reduce((sum, row) => sum + row.stock, 0)
                        : 0;
                return { productId: product.id, expected };
            });

            const created = await tx.stockCount.create({
                data: {
                    tenantId: authReq.tenantId!,
                    warehouseId: warehouse.id,
                    openWarehouseKey: warehouse.id,
                    status: 'OPEN',
                    scope,
                    category: scope === 'CATEGORY' ? category : null,
                    notes: notes || null,
                    createdBy: authReq.userId!,
                },
            });
            await tx.stockCountItem.createMany({
                data: snapshot.map((item) => ({
                    countId: created.id,
                    productId: item.productId,
                    expected: item.expected,
                    counted: null,
                    diff: 0,
                })),
            });
            return { count: { ...created, warehouse }, items: snapshot.length };
        }, { isolationLevel: 'RepeatableRead' });

        res.status(201).json({
            message: `Toma física creada en ${result.count.warehouse.name} con ${result.items} productos.`,
            ...result,
        });
    } catch (error: any) {
        if (error instanceof StockCountFlowError) {
            return res.status(error.statusCode).json({ error: error.message, code: error.code, ...error.meta });
        }
        if (error instanceof StockError && (error.code === 'WAREHOUSE_REQUIRED' || error.code === 'WAREHOUSE_NOT_FOUND')) {
            return res.status(400).json({ error: error.message, code: error.code });
        }
        if (error?.code === 'P2002') {
            return res.status(409).json({
                error: 'Ya hay una toma física abierta en esa bodega.',
                code: 'STOCK_COUNT_ALREADY_OPEN',
            });
        }
        console.error('Error creando toma física:', error);
        res.status(500).json({ error: error.message || 'Error creando toma física' });
    }
});

// GET /api/stock-counts - Historial de conteos
app.get('/api/stock-counts', authenticate, checkRole(['OWNER', 'ADMIN', BODEGUERO_ROLE]), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const counts = await prisma.stockCount.findMany({
            where: { tenantId: authReq.tenantId! },
            include: {
                creator: { select: { name: true } },
                warehouse: { select: { id: true, name: true } },
                _count: { select: { items: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: 100,
        });
        res.json(counts);
    } catch (error) {
        console.error('Error fetching stock counts:', error);
        res.status(500).json({ error: 'Error obteniendo tomas físicas' });
    }
});

// GET /api/stock-counts/:id - Detalle + ítems (para captura / revisión)
app.get('/api/stock-counts/:id', authenticate, checkRole(['OWNER', 'ADMIN', BODEGUERO_ROLE]), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { id } = req.params;
    try {
        const count = await prisma.stockCount.findFirst({
            where: { id, tenantId: authReq.tenantId! },
            include: {
                creator: { select: { name: true } },
                warehouse: { select: { id: true, name: true } },
            },
        });
        if (!count) return res.status(404).json({ error: 'Toma física no encontrada' });

        const productSelect: any = { name: true, sku: true, unit: true };
        if (authReq.role !== 'BODEGUERO') productSelect.cost = true;
        const items = await prisma.stockCountItem.findMany({
            where: { countId: id },
            include: { product: { select: productSelect } },
            orderBy: { product: { name: 'asc' } },
        });

        res.json({ count, items });
    } catch (error) {
        console.error('Error fetching stock count:', error);
        res.status(500).json({ error: 'Error obteniendo toma física' });
    }
});

// PATCH /api/stock-counts/:id/count - Capturar conteo físico de un producto (apto escáner)
app.patch('/api/stock-counts/:id/count', authenticate, checkRole(['OWNER', 'ADMIN', BODEGUERO_ROLE]), validate(RecordCountSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { id } = req.params;
    const { productId, counted } = req.body;
    try {
        const result = await prisma.$transaction(async (tx: any) => {
            const countRows: Array<{ status: string; warehouseId: string | null }> = await tx.$queryRaw`
                SELECT status, warehouseId FROM \`StockCount\`
                WHERE id = ${id} AND tenantId = ${authReq.tenantId!}
                FOR UPDATE`;
            const count = countRows[0];
            if (!count) throw new StockCountFlowError(404, 'STOCK_COUNT_NOT_FOUND', 'Toma física no encontrada.');
            if (!count.warehouseId) {
                throw new StockCountFlowError(
                    409,
                    'LEGACY_STOCK_COUNT_WITHOUT_WAREHOUSE',
                    'Este conteo histórico no tiene bodega. Cancelalo y creá uno nuevo con ubicación.',
                );
            }
            if (count.status !== 'OPEN') {
                throw new StockCountFlowError(409, 'STOCK_COUNT_NOT_OPEN', 'La toma física ya no está abierta.');
            }

            const updated = await tx.stockCountItem.updateMany({
                where: { countId: id, productId },
                data: { counted, countedAt: new Date() },
            });
            if (updated.count === 0) {
                throw new StockCountFlowError(404, 'STOCK_COUNT_ITEM_NOT_FOUND', 'Este producto no pertenece a la toma física.');
            }
            return { productId, counted };
        });

        res.json({ message: 'Conteo registrado', ...result });
    } catch (error: any) {
        if (error instanceof StockCountFlowError) {
            return res.status(error.statusCode).json({ error: error.message, code: error.code });
        }
        console.error('Error registrando conteo:', error);
        res.status(500).json({ error: error.message || 'Error registrando conteo' });
    }
});

// POST /api/stock-counts/:id/close - Cerrar: postea ajustes (Kardex) + asiento de merma/sobrante
app.post('/api/stock-counts/:id/close', authenticate, checkRole(['OWNER', 'ADMIN', BODEGUERO_ROLE]), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { id } = req.params;
    try {
        // Asegura que existan las cuentas 5.1.2 / 4.1.3 antes del asiento (auto-sanable).
        await seedChartOfAccounts(authReq.tenantId!);

        const result = await prisma.$transaction(async (tx: any) => {
            const claimed = await tx.stockCount.updateMany({
                where: { id, tenantId: authReq.tenantId!, status: 'OPEN' },
                data: { status: 'CLOSING' },
            });
            if (claimed.count === 0) {
                const existing = await tx.stockCount.findFirst({
                    where: { id, tenantId: authReq.tenantId! },
                    select: { id: true },
                });
                if (!existing) throw new StockCountFlowError(404, 'STOCK_COUNT_NOT_FOUND', 'Toma física no encontrada.');
                throw new StockCountFlowError(409, 'STOCK_COUNT_NOT_OPEN', 'La toma física ya está cerrada o cancelada.');
            }

            const count = await tx.stockCount.findFirst({
                where: { id, tenantId: authReq.tenantId! },
                include: { warehouse: { select: { id: true, name: true, isActive: true, isDefault: true } } },
            });
            if (!count) throw new StockCountFlowError(404, 'STOCK_COUNT_NOT_FOUND', 'Toma física no encontrada.');
            if (!count.warehouseId || !count.warehouse) {
                throw new StockCountFlowError(
                    409,
                    'LEGACY_STOCK_COUNT_WITHOUT_WAREHOUSE',
                    'Este conteo histórico no tiene bodega. Cancelalo y creá uno nuevo con ubicación.',
                );
            }
            if (!count.warehouse.isActive) {
                throw new StockCountFlowError(409, 'WAREHOUSE_INACTIVE', 'La bodega del conteo está inactiva.');
            }
            // Un período cerrado congela TODO ajuste de inventario, aun si el valor
            // de la merma fuese 0 (productos sin costo) y no se generara asiento.
            await assertPeriodOpen(tx, authReq.tenantId!, new Date());

            const items = await tx.stockCountItem.findMany({
                where: { countId: id },
                select: { id: true, productId: true, expected: true, counted: true },
                orderBy: { productId: 'asc' },
            });

            let lossValue = new Decimal(0); // Σ |merma| · costo
            let gainValue = new Decimal(0); // Σ sobrante · costo
            let adjusted = 0;
            let countedItems = 0;

            for (const it of items) {
                if (it.counted === null) continue; // no contado → no se toca
                countedItems++;
                const counted = Number(it.counted);

                const productRows: Array<{ cost: any }> = await tx.$queryRaw`
                    SELECT cost FROM \`Product\`
                    WHERE id = ${it.productId} AND tenantId = ${authReq.tenantId!}
                    FOR UPDATE`;
                const product = productRows[0];
                if (!product) continue;

                // `variance` = conteo vs el snapshot inicial (informativo, para el reporte).
                const variance = counted - Number(it.expected);
                await tx.stockCountItem.update({ where: { id: it.id }, data: { diff: variance } });

                await materializeWarehouseRow(tx, {
                    tenantId: authReq.tenantId!,
                    productId: it.productId,
                    warehouseId: count.warehouseId,
                    isDefault: count.warehouse.isDefault,
                });
                const lockedRows: Array<{ stock: any }> = await tx.$queryRaw`
                    SELECT stock FROM \`ProductStock\`
                    WHERE productId = ${it.productId}
                      AND warehouseId = ${count.warehouseId}
                      AND tenantId = ${authReq.tenantId!}
                    FOR UPDATE`;
                if (lockedRows.length === 0) {
                    throw new StockCountFlowError(500, 'WAREHOUSE_STOCK_ROW_MISSING', 'No se pudo preparar el stock de la bodega.');
                }
                const currentBook = Number(lockedRows[0].stock);
                const delta = counted - currentBook;
                if (delta === 0) continue;

                await applyStockDelta(tx, {
                    tenantId: authReq.tenantId!,
                    productId: it.productId,
                    delta,
                    enforceSufficient: false,
                    warehouseId: count.warehouseId,
                });

                await tx.kardexMovement.create({
                    data: {
                        tenantId: authReq.tenantId!,
                        productId: it.productId,
                        type: delta < 0 ? 'ADJUST_LOSS' : 'ADJUST_GAIN',
                        quantity: delta,
                        stockBefore: currentBook,
                        stockAfter: counted,
                        referenceId: id,
                        referenceType: 'STOCK_COUNT',
                        reason: `Toma física #${id.slice(0, 8)} en ${count.warehouse.name}: libro ${currentBook}, contado ${counted}`,
                        userId: authReq.userId!,
                        warehouseId: count.warehouseId,
                    },
                });

                const cost = new Decimal(Number(product.cost) || 0);
                if (delta < 0) lossValue = lossValue.plus(cost.times(Math.abs(delta)));
                else gainValue = gainValue.plus(cost.times(delta));
                adjusted++;
            }

            // Asiento contable de la merma/sobrante (si hubo discrepancia valuada).
            await recordStockCountAdjustment(
                tx, authReq.tenantId!, authReq.userId!, id, lossValue.toNumber(), gainValue.toNumber()
            );

            const closed = await tx.stockCount.update({
                where: { id },
                data: {
                    status: 'CLOSED',
                    openWarehouseKey: null,
                    closedAt: new Date(),
                    closedBy: authReq.userId!,
                },
            });

            // Asiento inmutable del cierre (Capa 3): el cierre aplica merma/sobrante
            // valorizado; sin este AuditLog solo quedaba el Kardex, sin traza de quién
            // cerró la toma ni del resumen de ajustes/valores.
            await tx.auditLog.create({
                data: {
                    tenantId: authReq.tenantId!,
                    userId: authReq.userId!,
                    action: 'STOCK_COUNT_CLOSED',
                    details: JSON.stringify({
                        countId: id,
                        warehouseId: count.warehouseId,
                        warehouseName: count.warehouse.name,
                        adjusted,
                        countedItems,
                        uncounted: items.length - countedItems,
                        lossValue: lossValue.toDecimalPlaces(2).toNumber(),
                        gainValue: gainValue.toDecimalPlaces(2).toNumber(),
                        timestamp: new Date().toISOString(),
                    }),
                },
            });

            return {
                count: closed,
                adjusted,
                countedItems,
                uncounted: items.length - countedItems,
                lossValue: lossValue.toDecimalPlaces(2).toNumber(),
                gainValue: gainValue.toDecimalPlaces(2).toNumber(),
            };
        }, { maxWait: 5_000, timeout: 30_000 });

        if (authReq.role === 'BODEGUERO') {
            const { lossValue: _lossValue, gainValue: _gainValue, ...operationalResult } = result;
            return res.json({ message: `Toma física cerrada. ${result.adjusted} ajuste(s) aplicado(s).`, ...operationalResult });
        }
        res.json({ message: `Toma física cerrada. ${result.adjusted} ajuste(s) aplicado(s).`, ...result });
    } catch (error: any) {
        if (error instanceof StockCountFlowError) {
            return res.status(error.statusCode).json({ error: error.message, code: error.code });
        }
        if (error instanceof StockError && error.code === 'WAREHOUSE_NOT_FOUND') {
            return res.status(409).json({ error: error.message, code: error.code });
        }
        if (error?.code === 'P2034') {
            return res.status(409).json({
                error: 'Otro movimiento actualizó el inventario al mismo tiempo; reintentá el cierre.',
                code: 'STOCK_COUNT_CONCURRENCY_CONFLICT',
            });
        }
        console.error('Error cerrando toma física:', error);
        const msg = error?.message || 'Error cerrando toma física';
        const code = error instanceof PeriodLockedError ? 423
            : 500;
        res.status(code).json({ error: msg });
    }
});

// POST /api/stock-counts/:id/cancel - Cancelar una toma física abierta (sin ajustes)
app.post('/api/stock-counts/:id/cancel', authenticate, checkRole(['OWNER', 'ADMIN', BODEGUERO_ROLE]), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { id } = req.params;
    try {
        const updated = await prisma.stockCount.updateMany({
            where: { id, tenantId: authReq.tenantId!, status: 'OPEN' },
            data: {
                status: 'CANCELLED',
                openWarehouseKey: null,
                closedAt: new Date(),
                closedBy: authReq.userId!,
            },
        });
        if (updated.count === 0) {
            return res.status(409).json({
                error: 'No se encontró una toma física abierta con ese id.',
                code: 'STOCK_COUNT_NOT_OPEN',
            });
        }
        res.json({ message: 'Toma física cancelada' });
    } catch (error: any) {
        console.error('Error cancelando toma física:', error);
        res.status(500).json({ error: error.message || 'Error cancelando toma física' });
    }
});

// POST /api/kardex/record - Registrar movimiento de inventario (interno/automático)
// NOTA: Usar POST /api/inventory/adjust para ajustes manuales (más seguro)
app.post('/api/kardex/record', authenticate, checkRole(['OWNER', 'ADMIN']), validate(KardexRecordSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { productId, type, quantity, referenceId, referenceType, reason } = req.body;

    try {
        const result = await prisma.$transaction(async (tx: any) => {
            // Verificar propiedad del producto (tenant) para datos de auditoría.
            const product = await tx.product.findFirst({
                where: { id: productId, tenantId: authReq.tenantId! },
                select: { name: true, sku: true }
            });

            if (!product) {
                throw new Error('Producto no encontrado');
            }

            // Mutación ATÓMICA (UPDATE condicional con row-lock): el patrón anterior
            // leía el stock sin bloqueo y escribía un valor ABSOLUTO, pisando decrementos
            // concurrentes (venta POS) → lost update. applyStockDelta aplica el delta
            // relativo con lock y, en salidas (quantity<0), rechaza si el stock no alcanza.
            const { stockBefore, stockAfter } = await applyStockDelta(tx, {
                tenantId: authReq.tenantId!,
                productId,
                delta: quantity,
                enforceSufficient: quantity < 0,
            });

            const movement = await tx.kardexMovement.create({
                data: {
                    tenantId: authReq.tenantId!,
                    productId,
                    type,
                    quantity,
                    stockBefore,
                    stockAfter,
                    referenceId,
                    referenceType,
                    reason,
                    userId: authReq.userId!
                }
            });

            // Asiento inmutable (Capa 3): este endpoint mueve inventario valorizado y
            // antes no dejaba AuditLog. Se registra before/after con userId/tenantId dentro
            // de la misma transacción.
            await tx.auditLog.create({
                data: {
                    tenantId: authReq.tenantId!,
                    userId: authReq.userId!,
                    action: 'KARDEX_RECORD',
                    details: JSON.stringify({
                        productId,
                        productName: product.name,
                        sku: product.sku,
                        type,
                        quantity,
                        stockBefore,
                        stockAfter,
                        referenceId: referenceId || null,
                        referenceType: referenceType || null,
                        reason: reason || null,
                        timestamp: new Date().toISOString()
                    })
                }
            });

            return { movement, newStock: stockAfter };
        });

        res.json(result);
    } catch (error: any) {
        console.error('Error recording kardex:', error);
        res.status(400).json({ error: error.message || 'Error registrando movimiento' });
    }
});

// ==========================================
// 📊 REPORTES EMPRESARIALES (NICARAGUA - IVA 15%)
// ==========================================

const IVA_RATE = 0.15;

// GET /api/reports/sales - Reporte de ventas con desglose fiscal
app.get('/api/reports/sales', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { startDate, endDate } = req.query;

    try {
        const start = startDate ? new Date(String(startDate)) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const end = endDate ? new Date(String(endDate)) : new Date();
        // Set end to end of day
        end.setHours(23, 59, 59, 999);

        // 1. Fetch all sales in the period with their items
        const sales = await prisma.sale.findMany({
            where: {
                tenantId: authReq.tenantId,
                createdAt: { gte: start, lte: end }
            },
            include: { items: true },
            orderBy: { createdAt: 'asc' }
        });

        // 2. Calculate totals
        let totalVentas = new Decimal(0);   // Total con IVA
        let totalCOGS   = new Decimal(0);   // Costo de Ventas

        sales.forEach((sale: { total: unknown; items: { costAtSale: unknown; quantity: unknown }[] }) => {
            totalVentas = totalVentas.plus(new Decimal(sale.total?.toString() ?? '0'));
            sale.items.forEach((item) => {
                totalCOGS = totalCOGS.plus(
                    new Decimal(item.costAtSale?.toString() ?? '0').mul(Number(item.quantity) || 0)
                );
            });
        });

        // IVA Nicaragua 15%: total = subtotal * 1.15, subtotal = total / 1.15
        const ventasNetas   = totalVentas.dividedBy('1.15').toDecimalPlaces(4);
        const ivaRecaudado  = totalVentas.minus(ventasNetas).toDecimalPlaces(4);
        const utilidadBruta = ventasNetas.minus(totalCOGS).toDecimalPlaces(4);

        // 3. Group sales by day for chart
        const dailyMap: Record<string, { ventas: number; gastos: number }> = {};

        sales.forEach((sale: { createdAt: unknown; total: unknown }) => {
            const dateKey = new Date(sale.createdAt as string).toISOString().split('T')[0];
            if (!dailyMap[dateKey]) dailyMap[dateKey] = { ventas: 0, gastos: 0 };
            dailyMap[dateKey].ventas = new Decimal(dailyMap[dateKey].ventas).plus(sale.total?.toString() ?? '0').toNumber();
        });

        // Also fetch expenses in the same period for the chart
        const expenses = await prisma.expense.findMany({
            where: {
                tenantId: authReq.tenantId,
                createdAt: { gte: start, lte: end }
            }
        });

        expenses.forEach((exp: { createdAt: unknown; amount: unknown }) => {
            const dateKey = new Date(exp.createdAt as string).toISOString().split('T')[0];
            if (!dailyMap[dateKey]) dailyMap[dateKey] = { ventas: 0, gastos: 0 };
            dailyMap[dateKey].gastos = new Decimal(dailyMap[dateKey].gastos).plus(exp.amount?.toString() ?? '0').toNumber();
        });

        // Convert to sorted array
        const chartData = Object.entries(dailyMap)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, data]) => {
                const d = new Date(date + 'T12:00:00');
                const label = d.toLocaleDateString('es-NI', { day: '2-digit', month: 'short' });
                return {
                    name: label,
                    ventas: Math.round(data.ventas * 100) / 100,
                    gastos: Math.round(data.gastos * 100) / 100,
                };
            });

        res.json({
            totalVentas:        new Decimal(totalVentas.toNumber()).toDecimalPlaces(2).toNumber(),
            ventasNetas:        ventasNetas.toDecimalPlaces(2).toNumber(),
            ivaRecaudado:       ivaRecaudado.toDecimalPlaces(2).toNumber(),
            totalCOGS:          totalCOGS.toDecimalPlaces(2).toNumber(),
            utilidadBruta:      utilidadBruta.toDecimalPlaces(2).toNumber(),
            totalTransacciones: sales.length,
            chartData,
        });
    } catch (error) {
        console.error('Error en reporte de ventas:', error);
        res.status(500).json({ error: 'Error generando reporte de ventas' });
    }
});

// GET /api/reports/inventory - Valor de inventario y alertas de stock
// ── VENDEDORES: cuánto vende y cuánto cobra cada uno ────────────────────────
// GET /api/reports/sellers?startDate&endDate
// Todo agregado EN LA BD (groupBy); el fold en JS es sobre grupos, no filas —
// vive puro en services/sellerReport.ts, con tests. Índices de esta query:
// Sale[tenantId, soldById, createdAt] y Payment[collectedBy, createdAt],
// agregados en la misma migración (20260818_vendedores_cartera).
app.get('/api/reports/sellers', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { startDate, endDate } = req.query;
    try {
        const start = startDate ? new Date(String(startDate)) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const end = endDate ? new Date(String(endDate)) : new Date();
        end.setHours(23, 59, 59, 999);

        // Gate server-side con else explícito: el frontend no gatea rutas, así
        // que cualquier rol puede llegar acá. Fuera de OWNER/ADMIN/MANAGER,
        // el reporte queda forzado a la fila PROPIA (soldById/collectedBy del
        // JWT) — un vendedor ve lo suyo, nunca lo del compañero.
        const propio = alcanceDelReporte(authReq.role) === 'propio';

        const whereVentas: any = {
            tenantId: authReq.tenantId,
            createdAt: { gte: start, lte: end },
            status: { not: 'VOIDED' },
        };
        if (propio) whereVentas.soldById = authReq.userId;

        // Cobros = abonos de CxC. El filtro sale.paymentMethod CREDIT resuelve
        // tres cosas a la vez: (a) scoping por tenant vía join — Payment NO
        // tiene tenantId; (b) excluye los Payment de contado que sync y
        // delivery SÍ crean (executeSale no los crea para el POS: sin este
        // filtro el reporte mediría distinto según el canal); (c) excluye las
        // filas rotas del driver (ventas CASH con collectedBy inválido).
        const wherePagos: any = {
            sale: { tenantId: authReq.tenantId, paymentMethod: 'CREDIT' },
            createdAt: { gte: start, lte: end },
        };
        if (propio) wherePagos.collectedBy = authReq.userId;

        const [ventas, cobros, usuarios] = await Promise.all([
            prisma.sale.groupBy({
                by: ['soldById', 'paymentMethod'],
                where: whereVentas,
                _sum: { total: true },
                _count: { _all: true },
            }),
            prisma.payment.groupBy({
                by: ['collectedBy'],
                where: wherePagos,
                _sum: { amount: true },
                _count: { _all: true },
            }),
            prisma.user.findMany({
                where: { tenantId: authReq.tenantId },
                select: { id: true, name: true },
            }),
        ]);

        const filas = plegarReporteVendedores(
            ventas.map((g: any) => ({ soldById: g.soldById, paymentMethod: g.paymentMethod, total: g._sum.total?.toString() ?? '0', count: g._count._all })),
            cobros.map((g: any) => ({ collectedBy: g.collectedBy, amount: g._sum.amount?.toString() ?? '0', count: g._count._all })),
            usuarios,
        );
        res.json({ startDate: start.toISOString(), endDate: end.toISOString(), alcance: propio ? 'propio' : 'todos', sellers: filas });
    } catch (error) {
        console.error('Reporte de vendedores:', error);
        res.status(500).json({ error: 'Error generando el reporte de vendedores' });
    }
});

app.get('/api/reports/inventory', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;

    try {
        const products = await prisma.product.findMany({
            where: { tenantId: authReq.tenantId },
            orderBy: { stock: 'asc' }
        });

        let inventoryValue = new Decimal(0);
        let outOfStock = 0;
        let totalUnits = 0;
        const lowStock: { id: string; name: string; sku: string; stock: number; minStock: number; cost: number }[] = [];

        products.forEach((p) => {
            inventoryValue = inventoryValue.plus(
                new Decimal(p.stock.toString()).mul(p.cost.toString())
            );
            totalUnits += Number(p.stock);
            if (Number(p.stock) <= 0) outOfStock++;
            if (Number(p.stock) <= Number(p.minStock)) {
                lowStock.push({
                    id: p.id,
                    name: p.name,
                    sku: p.sku,
                    stock: p.stock,
                    minStock: p.minStock,
                    cost: p.cost,
                });
            }
        });

        res.json({
            inventoryValue: inventoryValue.toDecimalPlaces(2).toNumber(),
            totalProducts: products.length,
            totalUnits,
            outOfStock,
            lowStock,
        });
    } catch (error) {
        console.error('Error en reporte de inventario:', error);
        res.status(500).json({ error: 'Error generando reporte de inventario' });
    }
});

// GET /api/reports/expenses - Gastos del periodo
app.get('/api/reports/expenses', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { startDate, endDate } = req.query;

    try {
        const start = startDate ? new Date(String(startDate)) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const end = endDate ? new Date(String(endDate)) : new Date();
        end.setHours(23, 59, 59, 999);

        const expenses = await prisma.expense.findMany({
            where: {
                tenantId: authReq.tenantId,
                createdAt: { gte: start, lte: end }
            },
            orderBy: { createdAt: 'desc' }
        });

        // Acumular montos con decimal.js (cero aritmética float sobre dinero).
        let totalExpenses = new Decimal(0);
        const byCategoryDec: Record<string, Decimal> = {};
        expenses.forEach((e: any) => {
            const amount = new Decimal(e.amount.toString());
            totalExpenses = totalExpenses.plus(amount);
            const cat = e.category || 'OTROS';
            byCategoryDec[cat] = (byCategoryDec[cat] || new Decimal(0)).plus(amount);
        });

        // Serializar a number sólo al responder.
        const byCategory: Record<string, number> = {};
        for (const [cat, val] of Object.entries(byCategoryDec)) {
            byCategory[cat] = val.toDecimalPlaces(2).toNumber();
        }

        res.json({
            totalExpenses: totalExpenses.toDecimalPlaces(2).toNumber(),
            count: expenses.length,
            byCategory,
        });
    } catch (error) {
        console.error('Error en reporte de gastos:', error);
        res.status(500).json({ error: 'Error generando reporte de gastos' });
    }
});

// ==========================================
// 🚚 COMPRAS & CUENTAS POR PAGAR
// ==========================================

// GET /api/purchases - Listar compras del tenant
app.get('/api/purchases', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const purchases = await prisma.purchase.findMany({
            where: { tenantId: authReq.tenantId },
            include: {
                supplier: { select: { id: true, name: true } },
                items: true
            },
            orderBy: { createdAt: 'desc' },
            take: 100
        });
        res.json(purchases);
    } catch (error) {
        console.error('Error fetching purchases:', error);
        res.status(500).json({ error: 'Error al obtener compras' });
    }
});

// POST /api/purchases - Registrar compra (Transacción ACID)
app.post('/api/purchases', authenticate, checkRole(['OWNER', 'ADMIN', 'MANAGER']), validate(CreatePurchaseSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { supplierId, invoiceNumber, date, dueDate, paymentMethod, notes, items, purchaseOrderId } = req.body;
    // Validaciones de formato ya realizadas por Zod

    try {
        // A1/A5: el asiento de la compra necesita el catálogo YA sembrado. `getAccount`
        // auto-siembra con el prisma GLOBAL (autocommit): bajo REPEATABLE READ esas filas
        // son INVISIBLES dentro de la tx y el `tx.account.update` moría con P2025 en el
        // primer movimiento de un tenant nuevo. Sembramos ANTES de abrir la transacción
        // (idempotente, y solo si falta el ancla → sin escritura extra en cada compra).
        const anchorPurchase = await prisma.account.findUnique({
            where: { tenantId_code: { tenantId: authReq.tenantId!, code: '1.1.4' } },
            select: { id: true },
        });
        if (!anchorPurchase) await seedChartOfAccounts(authReq.tenantId!);

        const result = await prisma.$transaction(async (tx: any) => {
            // Serializar las compras del proveedor antes de cualquier lectura consistente
            // de la transacción. Así, un doble envío concurrente no puede pasar dos veces
            // el chequeo de factura duplicada.
            await tx.$queryRaw`SELECT id FROM \`Supplier\` WHERE id = ${supplierId} AND \`tenantId\` = ${authReq.tenantId} FOR UPDATE`;

            // Verificar propiedad del proveedor: nunca confiar en supplierId del body sin
            // scoping por tenant. Sin esto, el include: { supplier: true } filtraría PII
            // del proveedor de otro tenant (fuga cross-tenant).
            const supplier = await tx.supplier.findFirst({
                where: { id: supplierId, tenantId: authReq.tenantId! }
            });
            if (!supplier) {
                throw new Error('Proveedor no encontrado');
            }

            const existingInvoice = await tx.purchase.findFirst({
                where: { tenantId: authReq.tenantId!, supplierId, invoiceNumber },
                select: { id: true },
            });
            if (existingInvoice) {
                throw new Error('FACTURA_DUPLICADA');
            }

            // Una OC ya mueve (o moverá) las existencias mediante su recepción. La
            // factura vinculada registra únicamente el efecto financiero para evitar
            // duplicar stock, costo promedio, lotes y Kardex.
            let linkedPurchaseOrder: {
                id: string;
                supplierId: string;
                status: string;
                items: { productId: string; productName: string; quantityReceived: number | string }[];
                receipts: { items: { productId: string; quantity: number }[] }[];
            } | null = null;
            if (purchaseOrderId) {
                linkedPurchaseOrder = await tx.purchaseOrder.findFirst({
                    where: { id: purchaseOrderId, tenantId: authReq.tenantId! },
                    select: {
                        id: true,
                        supplierId: true,
                        status: true,
                        items: { select: { productId: true, productName: true, quantityReceived: true } },
                        receipts: {
                            select: {
                                items: { select: { productId: true, quantity: true } },
                            },
                        },
                    },
                });
                if (!linkedPurchaseOrder) {
                    throw new Error('OC_NO_ENCONTRADA');
                }
                if (linkedPurchaseOrder.supplierId !== supplierId) {
                    throw new Error('OC_DE_OTRO_PROVEEDOR');
                }
                if (!['PARTIALLY_RECEIVED', 'RECEIVED'].includes(linkedPurchaseOrder.status)) {
                    throw new Error(`OC_ESTADO:${linkedPurchaseOrder.status}`);
                }
            }
            // Disponibilidad facturable por producto = recibido físicamente menos
            // lo ya incluido en facturas anteriores de la misma OC. Sin este saldo,
            // una segunda factura parcial podía volver a cobrar todas las unidades
            // recibidas desde el inicio.
            const linkedProductAvailability = linkedPurchaseOrder
                ? calculatePurchaseOrderInvoiceAvailability(
                    linkedPurchaseOrder.items,
                    linkedPurchaseOrder.receipts,
                )
                : null;
            const requestedFromLinkedPO = new Map<string, Decimal>();

            // Snapshot del saldo de billetera para el asiento de auditoría (before/after).
            const tenantBefore = await tx.tenant.findUnique({
                where: { id: authReq.tenantId! },
                select: { walletBalance: true }
            });
            const walletBefore = new Decimal(tenantBefore?.walletBalance?.toString() ?? '0');

            // 1. Calcular totales. T2 Fase 2 — el crédito fiscal (IVA de compras)
            //    se genera SOLO por los ítems GRAVADOS. Antes se aplicaba 15% a
            //    TODO el subtotal, así que una farmacia que compra medicamentos
            //    exonerados se acreditaba un crédito fiscal INEXISTENTE (menos IVA
            //    a pagar del que corresponde). `product.ivaExento` es autoritativo
            //    (viene de la BD scoped por tenant, nunca del cliente).
            let subtotal = 0;
            let taxableSubtotal = new Decimal(0);   // base gravada (no exonerada)
            const processedItems: any[] = [];

            for (const item of items) {
                if (!item.productId || !item.quantity || item.quantity <= 0 || !item.unitCost || item.unitCost <= 0) {
                    throw new Error(`Item inválido: producto=${item.productId}, cantidad=${item.quantity}, costo=${item.unitCost}`);
                }

                const product = await tx.product.findFirst({
                    where: { id: item.productId, tenantId: authReq.tenantId }
                });

                if (!product) {
                    throw new Error(`Producto no encontrado: ${item.productId}`);
                }

                const linkedItem = linkedProductAvailability?.get(item.productId);
                if (linkedProductAvailability && !linkedItem) {
                    throw new Error(`ITEM_FUERA_DE_OC|${product.name}`);
                }
                if (linkedItem) {
                    const remainingToInvoice = linkedItem.remaining;
                    const requested = (requestedFromLinkedPO.get(item.productId) ?? new Decimal(0))
                        .plus(item.quantity);
                    if (remainingToInvoice.lte(0) || requested.greaterThan(remainingToInvoice)) {
                        throw new Error(`CANTIDAD_SUPERA_RECEPCION|${linkedItem.productName}|${Decimal.max(0, remainingToInvoice).toString()}`);
                    }
                    requestedFromLinkedPO.set(item.productId, requested);
                }

                if (!linkedPurchaseOrder && product.requiresBatchTracking && (!item.batchNumber || !item.expiryDate)) {
                    throw new Error(`LOTE_REQUERIDO|${product.name}`);
                }

                const totalCost = new Decimal(item.quantity).mul(item.unitCost);
                subtotal = new Decimal(subtotal).plus(totalCost).toNumber();
                if (!product.ivaExento) taxableSubtotal = taxableSubtotal.plus(totalCost);

                processedItems.push({
                    productId:   item.productId,
                    productName: product.name,
                    quantity:    item.quantity,
                    unitCost:    item.unitCost,
                    totalCost:   totalCost.toNumber(),
                    batchNumber: item.batchNumber || null,
                    expiryDate:  item.expiryDate ? normalizeCalendarDateInput(item.expiryDate) : null
                });
            }

            // IVA solo sobre la base GRAVADA. `total = subtotal(todo) + IVA(gravado)`:
            // se paga al proveedor el costo de TODA la mercancía más el IVA de la
            // parte gravada. En recordPurchase el asiento queda Debe 1.1.4 = subtotal
            // (todo el inventario) + Debe 1.1.5 = tax (crédito solo del gravado).
            const tax   = taxableSubtotal.mul('0.15').toDecimalPlaces(4).toNumber(); // IVA 15% Nicaragua
            const total = new Decimal(subtotal).plus(tax).toDecimalPlaces(4).toNumber();

            // 2. Crear cabecera de compra
            const purchase = await tx.purchase.create({
                data: {
                    tenantId: authReq.tenantId!,
                    supplierId,
                    invoiceNumber,
                    purchaseOrderId: linkedPurchaseOrder?.id ?? null,
                    // `date` es el día civil de la factura del proveedor. Si un
                    // cliente histórico no lo envía, omitimos la propiedad para
                    // conservar el @default(now()) de Prisma.
                    ...(date ? { date: normalizeCalendarDateInput(date) } : {}),
                    dueDate: dueDate ? normalizeCalendarDateInput(dueDate) : null,
                    subtotal,
                    tax,
                    total,
                    status: paymentMethod === 'CASH' ? 'COMPLETED' : 'PENDING_PAYMENT',
                    paymentMethod,
                    notes: notes || null,
                    createdBy: authReq.userId!,
                    items: {
                        create: processedItems
                    }
                },
                include: { items: true, supplier: true }
            });

            // 3. Actualizar inventario + Kardex + Costo promedio ponderado. Si hay OC,
            // la recepción es la única responsable de estos movimientos.
            const costChanges: any[] = []; // before/after de stock y costo valorizado por producto
            for (const item of linkedPurchaseOrder ? [] : processedItems) {
                const product = await tx.product.findUnique({ where: { id: item.productId } });
                if (!product) continue;

                // Stock por applyStockDelta: incremento ATÓMICO (sin lost-update del
                // patrón leer→escribir absoluto) + doble escritura del desglose por
                // bodega (invariante multi-bodega: Σ bodegas == agregado).
                const { stockBefore, stockAfter, warehouseId: purchaseWarehouseId } = await applyStockDelta(tx, {
                    tenantId: authReq.tenantId!,
                    productId: item.productId,
                    delta: item.quantity,
                    enforceSufficient: false,
                });
                const oldStock = stockBefore;
                const newStock = stockAfter;

                // C2 — costo viejo re-leído con la fila YA BLOQUEADA por applyStockDelta
                // (FOR UPDATE). El `product.cost` de arriba viene de un findUnique
                // NO-bloqueante ANTES del lock: bajo REPEATABLE READ es el snapshot de la
                // tx y puede estar STALE si una compra concurrente del MISMO producto ya
                // movió el costo → el promedio mezclaría stock nuevo con costo viejo
                // (ej. graba 6.3333 donde lo correcto era 7.00). La lectura locking
                // devuelve el costo comprometido más reciente.
                const lockedCostRows: any[] = await tx.$queryRaw`SELECT cost FROM \`Product\` WHERE id = ${item.productId} AND \`tenantId\` = ${authReq.tenantId} FOR UPDATE`;
                const oldCost = new Decimal((lockedCostRows[0]?.cost ?? 0).toString());

                // Promedio ponderado móvil (función pura compartida — regla C1 adentro).
                const newAvgCost = weightedAverageCost(oldStock, oldCost, item.quantity, item.unitCost.toString()).toNumber();

                await tx.product.update({
                    where: { id: item.productId },
                    data: {
                        cost: newAvgCost  // ya redondeado a 4 d.p. por Decimal
                    }
                });

                costChanges.push({
                    productId: item.productId,
                    stockBefore: oldStock,
                    stockAfter: newStock,
                    costBefore: oldCost.toNumber(),
                    costAfter: newAvgCost
                });

                // Control de Lotes
                let batchId = null;
                if (product.requiresBatchTracking && item.batchNumber && item.expiryDate) {
                    const batch = await tx.productBatch.upsert({
                        where: {
                            productId_batchNumber: { productId: item.productId, batchNumber: item.batchNumber }
                        },
                        update: { stock: { increment: item.quantity } },
                        create: {
                            tenantId: authReq.tenantId!,
                            productId: item.productId,
                            batchNumber: item.batchNumber,
                            // `processedItems` ya normalizó la fecha calendario a Date.
                            // Volver a pasar el Date por el normalizador de strings
                            // produciría una fecha inválida para compras con lote.
                            expiryDate: item.expiryDate,
                            stock: item.quantity
                        }
                    });
                    batchId = batch.id;
                }

                // Kardex: Registro de entrada por compra
                await tx.kardexMovement.create({
                    data: {
                        tenantId: authReq.tenantId!,
                        productId: item.productId,
                        type: 'IN_PURCHASE',
                        quantity: item.quantity,
                        stockBefore: oldStock,
                        stockAfter: newStock,
                        referenceId: purchase.id,
                        referenceType: 'PURCHASE',
                        reason: `Compra Factura #${invoiceNumber}`,
                        userId: authReq.userId!,
                        batchId: batchId,
                        // Bodega real del movimiento (la default hoy): sin esto la
                        // reconstrucción del stock por bodega desde Kardex queda coja.
                        warehouseId: purchaseWarehouseId
                    }
                });
            }

            // 4. Registro financiero
            if (paymentMethod === 'CASH') {
                // Débito ATÓMICO: decrementa solo si hay saldo suficiente. El guard de
                // suficiencia y la escritura son el MISMO UPDATE condicional (toma el
                // row-lock), así dos compras de contado concurrentes no pueden ambas
                // pasar el chequeo y dejar la billetera en negativo (TOCTOU).
                const debited = await tx.tenant.updateMany({
                    where: { id: authReq.tenantId, walletBalance: { gte: total } },
                    data: { walletBalance: { decrement: total } }
                });
                if (debited.count === 0) {
                    const t = await tx.tenant.findUnique({
                        where: { id: authReq.tenantId },
                        select: { walletBalance: true }
                    });
                    throw new Error(`SALDO_INSUFICIENTE: disponible C$ ${Number(t?.walletBalance ?? 0).toFixed(2)}, requerido C$ ${Number(total).toFixed(2)}. Usa crédito o recarga tu billetera.`);
                }

                // Crear gasto
                await tx.expense.create({
                    data: {
                        tenantId: authReq.tenantId!,
                        amount: total,
                        description: `Compra Factura #${invoiceNumber} - ${purchase.supplier.name}`,
                        category: 'COMPRA_MERCADERIA'
                    }
                });
            }
            // Si es CREDIT, no se descuenta dinero - queda como cuenta por pagar

            // A1: ASIENTO CONTABLE de la compra. Antes NO se posteaba ninguno
            // (`recordPurchase` estaba importada pero nunca se llamaba), así que
            // Inventario (1.1.4) solo DECRECÍA por el COGS de las ventas y llegaba a
            // saldo negativo con stock físico real; IVA Crédito (1.1.5) y CxP (2.1.1)
            // quedaban permanentemente en cero y la utilidad salía inflada.
            // Va DENTRO de la tx y sin try/catch: si el asiento no se puede registrar
            // (p. ej. período cerrado), la compra entera se revierte — el dinero y el
            // inventario NO se mueven sin su contrapartida contable.
            await recordPurchase(
                tx as Parameters<typeof recordPurchase>[0],
                authReq.tenantId!,
                authReq.userId!,
                purchase.id,
                new Decimal(total).toNumber(),
                new Decimal(tax).toNumber(),
                paymentMethod
            );

            // Asiento inmutable de auditoría (Capa 3): toda compra mueve su efecto
            // financiero; solo una compra directa mueve además inventario valorizado.
            // Registrar before/after de billetera y los cambios de stock/costo aplicados.
            const walletAfter = paymentMethod === 'CASH' ? walletBefore.minus(total) : walletBefore;
            await tx.auditLog.create({
                data: {
                    tenantId: authReq.tenantId!,
                    userId: authReq.userId!,
                    action: 'PURCHASE_CREATED',
                    details: JSON.stringify({
                        purchaseId: purchase.id,
                        supplierId,
                        invoiceNumber,
                        purchaseOrderId: linkedPurchaseOrder?.id ?? null,
                        paymentMethod,
                        subtotal,
                        tax,
                        total,
                        walletBefore: walletBefore.toNumber(),
                        walletAfter: walletAfter.toNumber(),
                        productChanges: costChanges,
                        timestamp: new Date().toISOString()
                    })
                }
            });

            return purchase;
        });

        res.json({
            message: result.purchaseOrderId
                ? 'Factura registrada y vinculada a la Orden de Compra. El inventario se actualiza únicamente al recibir la OC.'
                : `Compra registrada. ${processedItemsCount(items)} productos ingresados al inventario.`,
            purchase: result
        });

    } catch (error: any) {
        console.error('Error registrando compra:', error);
        // Período cerrado (A1): la compra ahora exige asiento, así que un período
        // bloqueado la RECHAZA (423) en vez de dejar entrar mercancía sin registrar.
        if (error instanceof PeriodLockedError) {
            return res.status(423).json({ error: error.message });
        }
        if (error?.message === 'FACTURA_DUPLICADA') {
            return res.status(409).json({ error: `Ya existe la factura #${invoiceNumber} para este proveedor. No se registró nuevamente.` });
        }
        if (error?.message === 'OC_DE_OTRO_PROVEEDOR') {
            return res.status(400).json({ error: 'La orden de compra pertenece a otro proveedor' });
        }
        if (error?.message === 'OC_NO_ENCONTRADA') {
            return res.status(404).json({ error: 'Orden de compra no encontrada' });
        }
        if (error?.message?.startsWith('LOTE_REQUERIDO|')) {
            const productName = error.message.slice('LOTE_REQUERIDO|'.length);
            return res.status(400).json({ error: `Ingresá el lote y la fecha de vencimiento de ${productName}` });
        }
        if (error?.message?.startsWith('ITEM_FUERA_DE_OC|')) {
            const productName = error.message.slice('ITEM_FUERA_DE_OC|'.length);
            return res.status(400).json({ error: `${productName} no pertenece a la orden de compra vinculada` });
        }
        if (error?.message?.startsWith('CANTIDAD_SUPERA_RECEPCION|')) {
            const [, productName, remainingQty] = error.message.split('|');
            return res.status(400).json({ error: `${productName} solo tiene ${remainingQty} unidades recibidas pendientes de facturar en esta OC` });
        }
        if (error?.message?.startsWith('OC_ESTADO:')) {
            const status = error.message.split(':')[1];
            return res.status(400).json({ error: status === 'APPROVED' ? 'Recibí la mercadería antes de facturar una orden de compra aprobada' : `No se puede facturar una orden de compra en estado ${status}` });
        }
        const insufficient = error?.message?.includes('SALDO_INSUFICIENTE');
        const notFound = error?.message?.includes('no encontrado');
        res.status(insufficient ? 400 : notFound ? 404 : 500).json({ error: error.message || 'Error al procesar la compra' });
    }
});

function processedItemsCount(items: any[]) {
    return items.reduce((sum: number, i: any) => sum + (i.quantity || 0), 0);
}

// POST /api/purchases/:id/pay - Pagar cuenta pendiente
app.post('/api/purchases/:id/pay', authenticate, checkRole(['OWNER', 'ADMIN', 'MANAGER']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { id } = req.params;

    try {
        const purchase = await prisma.purchase.findFirst({
            where: { id, tenantId: authReq.tenantId },
            include: { supplier: true }
        });

        if (!purchase) {
            return res.status(404).json({ error: 'Compra no encontrada' });
        }

        if (purchase.status === 'COMPLETED') {
            return res.status(400).json({ error: 'Esta compra ya fue pagada' });
        }

        await prisma.$transaction(async (tx: any) => {
            // Guard atómico de estado + idempotencia: solo transiciona si la compra
            // sigue en PENDING_PAYMENT. Dos pagos concurrentes / doble-click: únicamente
            // uno marca COMPLETED (count===1); el otro aborta y NO vuelve a debitar la
            // billetera (evita el doble débito por TOCTOU).
            const marked = await tx.purchase.updateMany({
                where: { id, tenantId: authReq.tenantId, status: 'PENDING_PAYMENT' },
                data: { status: 'COMPLETED' }
            });
            if (marked.count === 0) {
                throw new Error('PAGO_NO_APLICABLE: la compra ya fue pagada o no está pendiente de pago.');
            }

            // Snapshot del saldo de billetera para el asiento de auditoría (before/after).
            const tenantBefore = await tx.tenant.findUnique({
                where: { id: authReq.tenantId! },
                select: { walletBalance: true }
            });
            const walletBefore = new Decimal(tenantBefore?.walletBalance?.toString() ?? '0');

            // Débito ATÓMICO: decrementa solo si hay saldo suficiente. El guard de
            // suficiencia y la escritura son el MISMO UPDATE condicional (row-lock),
            // de modo que el pago no puede dejar la billetera en negativo (TOCTOU).
            const debited = await tx.tenant.updateMany({
                where: { id: authReq.tenantId, walletBalance: { gte: purchase.total } },
                data: { walletBalance: { decrement: purchase.total } }
            });
            if (debited.count === 0) {
                throw new Error(`SALDO_INSUFICIENTE: disponible C$ ${walletBefore.toFixed(2)}, requerido C$ ${new Decimal(purchase.total.toString()).toFixed(2)}. Recarga tu billetera.`);
            }

            // Crear gasto
            await tx.expense.create({
                data: {
                    tenantId: authReq.tenantId!,
                    amount: purchase.total,
                    description: `Pago Factura #${purchase.invoiceNumber} - ${purchase.supplier.name}`,
                    category: 'PAGO_PROVEEDOR'
                }
            });

            // Asiento inmutable de auditoría (Capa 3): el pago mueve dinero (billetera +
            // gasto). Registrar quién autorizó y el before/after de saldo y estado.
            const walletAfter = walletBefore.minus(new Decimal(purchase.total.toString()));
            await tx.auditLog.create({
                data: {
                    tenantId: authReq.tenantId!,
                    userId: authReq.userId!,
                    action: 'PURCHASE_PAID',
                    details: JSON.stringify({
                        purchaseId: purchase.id,
                        invoiceNumber: purchase.invoiceNumber,
                        total: new Decimal(purchase.total.toString()).toNumber(),
                        statusBefore: 'PENDING_PAYMENT',
                        statusAfter: 'COMPLETED',
                        walletBefore: walletBefore.toNumber(),
                        walletAfter: walletAfter.toNumber(),
                        timestamp: new Date().toISOString()
                    })
                }
            });
        });

        res.json({ message: `Factura #${purchase.invoiceNumber} pagada exitosamente` });

    } catch (error: any) {
        console.error('Error pagando compra:', error);
        const insufficient = error?.message?.includes('SALDO_INSUFICIENTE');
        const notApplicable = error?.message?.includes('PAGO_NO_APLICABLE');
        res.status(insufficient ? 400 : notApplicable ? 409 : 500).json({ error: error.message || 'Error al procesar el pago' });
    }
});

// GET /api/purchases/pending - Cuentas por pagar
app.get('/api/purchases/pending', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const pending = await prisma.purchase.findMany({
            where: { tenantId: authReq.tenantId, status: 'PENDING_PAYMENT' },
            include: { supplier: { select: { name: true } } },
            orderBy: { dueDate: 'asc' }
        });

        const totalDebt = pending.reduce(
            (sum: Decimal, p: { total: unknown }) =>
                sum.plus(new Decimal(p.total?.toString() ?? '0')),
            new Decimal(0)
        ).toDecimalPlaces(4).toNumber();

        res.json({ purchases: pending, totalDebt });
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener cuentas por pagar' });
    }
});

// ==========================================
// 🇳🇮 NÓMINA NICARAGÜENSE & MOTOR FISCAL
// ==========================================

import { calculatePayroll, calculateLaborLiability } from './services/nicaLabor';
import { generateMonthlyReport, saveMonthlyReport, desglosarIvaIncluido, desglosarVentaConExoneracion } from './services/nicaTax';
import { plegarReporteVendedores, alcanceDelReporte } from './services/sellerReport';

// POST /api/payroll/calculate - Calcular nómina de todos los empleados
app.post('/api/payroll/calculate', authenticate, checkRole(['OWNER', 'ADMIN', 'ACCOUNTANT']), validate(PayrollCalculateSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { month, year } = req.body;

    if (!month || !year) {
        return res.status(400).json({ error: 'Mes y año son requeridos' });
    }

    try {
        const employees = await prisma.employee.findMany({
            where: { tenantId: authReq.tenantId },
        });

        // Calcular ventas del mes por empleado para comisiones
        const startOfMonth = new Date(year, month - 1, 1);
        const endOfMonth = new Date(year, month, 0, 23, 59, 59);

        const salesByEmployee = await prisma.sale.groupBy({
            by: ['employeeId'],
            where: {
                tenantId: authReq.tenantId,
                createdAt: { gte: startOfMonth, lte: endOfMonth },
                employeeId: { not: null },
            },
            _sum: { total: true },
        });

        const salesMap = new Map(
            salesByEmployee.map((s: any) => [s.employeeId, Number(s._sum.total || 0)])
        );

        // B4: INSS patronal según la config del tenant (21.5/22.5). Default legal.
        const taxCfg = await prisma.taxConfig.findUnique({ where: { tenantId: authReq.tenantId! } });
        const inssPatronalRate = taxCfg ? Number(taxCfg.inssPatronalRate) : undefined;

        // Fase A: horas extra del mes por empleado (turnos de asistencia cerrados).
        const overtimeByEmployee = await prisma.shift.groupBy({
            by: ['employeeId'],
            where: {
                tenantId: authReq.tenantId,
                status: 'COMPLETED',
                employeeId: { not: null },
                startTime: { gte: startOfMonth, lte: endOfMonth },
            },
            _sum: { overtimeHours: true },
        });
        const overtimeMap = new Map(
            overtimeByEmployee.map((s: any) => [s.employeeId, Number(s._sum.overtimeHours || 0)])
        );

        // Fase A p2: ausencias sin goce (UNPAID) aprobadas que solapan el mes →
        // días no trabajados por empleado.
        const unpaidLeaves = await prisma.leaveRequest.findMany({
            where: {
                tenantId: authReq.tenantId!,
                type: 'UNPAID',
                status: 'APPROVED',
                startDate: { lte: endOfMonth },
                endDate: { gte: startOfMonth },
            },
            select: { employeeId: true, startDate: true, endDate: true },
        });
        const absenceDaysByEmployee = new Map<string, number>();
        for (const lv of unpaidLeaves) {
            const from = lv.startDate > startOfMonth ? lv.startDate : startOfMonth;
            const to = lv.endDate < endOfMonth ? lv.endDate : endOfMonth;
            const days = Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86400000) + 1);
            absenceDaysByEmployee.set(lv.employeeId, (absenceDaysByEmployee.get(lv.employeeId) || 0) + days);
        }

        // Fase A p2b: IR acumulado (método DGI). Renta neta gravable e IR ya
        // retenido de los meses ANTERIORES del mismo año, por empleado.
        const prevPayrolls = await prisma.payroll.findMany({
            where: { tenantId: authReq.tenantId!, year: Number(year), month: { lt: Number(month) } },
            select: { employeeId: true, totalIncome: true, inssLaboral: true, irLaboral: true },
        });
        // N3 — acumular con decimal.js (Capa 4): hasta 11 meses de resta+suma en
        // float nativo arrastraban error binario a la base del IR acumulado (la
        // retención que se declara a la DGI). El motor Decimal recibe ahora una
        // base exacta; se materializa a number recién al armar el mapa.
        const netoPrevioDec = new Map<string, Decimal>();
        const irPrevioDec = new Map<string, Decimal>();
        for (const pp of prevPayrolls) {
            const neto = new Decimal(pp.totalIncome.toString()).minus(pp.inssLaboral.toString());
            netoPrevioDec.set(pp.employeeId, (netoPrevioDec.get(pp.employeeId) ?? new Decimal(0)).plus(neto));
            irPrevioDec.set(pp.employeeId, (irPrevioDec.get(pp.employeeId) ?? new Decimal(0)).plus(pp.irLaboral.toString()));
        }
        const netoPrevioByEmp = new Map<string, number>();
        const irPrevioByEmp = new Map<string, number>();
        for (const [id, v] of netoPrevioDec) netoPrevioByEmp.set(id, v.toDecimalPlaces(4).toNumber());
        for (const [id, v] of irPrevioDec) irPrevioByEmp.set(id, v.toDecimalPlaces(4).toNumber());

        // Fase C4: deducciones judiciales activas por empleado (orden de prioridad).
        const judiciales = await prisma.judicialDeduction.findMany({
            where: { tenantId: authReq.tenantId!, status: 'ACTIVE' },
            orderBy: { priority: 'asc' },
            select: { employeeId: true, amount: true, percentage: true },
        });
        const judicialByEmp = new Map<string, { amount?: number | null; percentage?: number | null }[]>();
        for (const j of judiciales) {
            const arr = judicialByEmp.get(j.employeeId) ?? [];
            arr.push({ amount: j.amount != null ? Number(j.amount) : null, percentage: j.percentage });
            judicialByEmp.set(j.employeeId, arr);
        }

        // Fase C2: feriados del mes trabajados por empleado (recargo Art. 68).
        const holidaysMonth = await prisma.holiday.findMany({
            where: { tenantId: authReq.tenantId!, date: { gte: startOfMonth, lte: endOfMonth } },
            select: { date: true },
        });
        const holidaySet = new Set(holidaysMonth.map(h => h.date.toISOString().slice(0, 10)));
        const holidayDaysByEmp = new Map<string, number>();
        if (holidaySet.size > 0) {
            const shiftsMes = await prisma.shift.findMany({
                where: { tenantId: authReq.tenantId!, status: 'COMPLETED', employeeId: { not: null }, startTime: { gte: startOfMonth, lte: endOfMonth } },
                select: { employeeId: true, startTime: true },
            });
            const workedByEmp = new Map<string, Set<string>>();
            for (const s of shiftsMes) {
                if (!s.employeeId) continue;
                // Día calendario LOCAL de Nicaragua (UTC-6): un turno nocturno no
                // debe contarse en el día UTC siguiente.
                const ds = new Date(s.startTime.getTime() - 6 * 3600 * 1000).toISOString().slice(0, 10);
                if (!holidaySet.has(ds)) continue;
                const set = workedByEmp.get(s.employeeId) ?? new Set<string>();
                set.add(ds);
                workedByEmp.set(s.employeeId, set);
            }
            for (const [empId, set] of workedByEmp) holidayDaysByEmp.set(empId, set.size);
        }

        const payrolls = [];

        for (const emp of employees) {
            const baseSalary = Number(emp.baseSalary);
            const ventasMes = salesMap.get(emp.id) || 0;
            // Comisión con decimal.js (Capa 4): la base gravable no puede arrastrar
            // error binario hacia INSS/IR/neto declarado al SIE.
            const comisiones = new Decimal(ventasMes.toString())
                .mul(new Decimal(emp.commissionRate.toString()))
                .toDecimalPlaces(4)
                .toNumber();
            const overtimeHours = overtimeMap.get(emp.id) || 0;
            const holidayDays = holidayDaysByEmp.get(emp.id) || 0;
            const diasAusencia = Math.min(30, absenceDaysByEmployee.get(emp.id) || 0);
            // Deducción por ausencias sin goce con decimal.js (Capa 4): (base / 30) · días.
            const absenceDeduction = new Decimal(baseSalary.toString())
                .div(30)
                .mul(diasAusencia)
                .toDecimalPlaces(4)
                .toNumber();

            const existing = await prisma.payroll.findUnique({
                where: { employeeId_month_year: { employeeId: emp.id, month: Number(month), year: Number(year) } },
            });
            // No recalcular una nómina ya PAGADA (preserva el pago y sus asientos).
            if (existing && existing.status === 'PAGADO') {
                payrolls.push({ ...existing, employeeName: `${emp.firstName} ${emp.lastName}`, cedula: emp.cedula, inss: emp.inss, ventasMes });
                continue;
            }

            // Adelantos candidatos: los ya enlazados a esta nómina (prioridad en un
            // recálculo) + los APPROVED aún sin nómina.
            const advances = await prisma.salaryAdvance.findMany({
                where: {
                    tenantId: authReq.tenantId!,
                    employeeId: emp.id,
                    OR: [
                        { status: 'APPROVED', payrollId: null },
                        ...(existing ? [{ payrollId: existing.id }] : []),
                    ],
                },
                select: { id: true, amount: true, fee: true, payrollId: true },
            });
            advances.sort((a, b) => (a.payrollId === existing?.id ? 0 : 1) - (b.payrollId === existing?.id ? 0 : 1));

            // Se calcula SIN adelanto para conocer el disponible; el judicial ya está
            // acotado, así que el disponible (= neto antes de adelantos) es ≥ 0.
            const calc = calculatePayroll(baseSalary, comisiones, {
                inssPatronalRate, overtimeHours, advanceDeduction: 0, absenceDeduction, holidayDays,
                irAcumulado: {
                    mes: Number(month),
                    netoGravablePrevio: netoPrevioByEmp.get(emp.id) || 0,
                    irRetenidoPrevio: irPrevioByEmp.get(emp.id) || 0,
                },
                judicialDeductions: judicialByEmp.get(emp.id) ?? [],
            });

            // Aplicar los adelantos en orden, solo hasta agotar el disponible (nunca
            // dejar el neto negativo). Los que no caben se difieren al mes siguiente.
            // Todo con decimal.js (Capa 4): el neto que
            // se persiste, se paga y se asienta debe salir íntegro del motor Decimal,
            // no de aritmética flotante (sin el parche del epsilon 0.001).
            const disponible = new Decimal(calc.netSalary.toString());
            let restante = disponible;
            let advanceApplied = new Decimal(0);
            const aplicados: string[] = [];
            for (const adv of advances) {
                const monto = new Decimal(adv.amount.toString()).plus(adv.fee.toString());
                // Solo se aplica si el adelanto cabe íntegro en el disponible restante
                // (nunca deja el neto negativo). Los que no caben se difieren.
                if (monto.lessThanOrEqualTo(restante)) {
                    advanceApplied = advanceApplied.plus(monto).toDecimalPlaces(2);
                    restante = restante.minus(monto).toDecimalPlaces(2);
                    aplicados.push(adv.id);
                }
            }
            const advanceAppliedNum = advanceApplied.toNumber();
            // Clamp de seguridad: el neto nunca queda negativo.
            const netFinal = Decimal.max(0, disponible.minus(advanceApplied)).toDecimalPlaces(2).toNumber();

            const data = {
                grossSalary: calc.grossSalary,
                commissions: calc.commissions,
                overtimePay: calc.overtimePay,
                horasExtra: calc.horasExtra,
                holidayPay: calc.holidayPay,
                diasFeriados: calc.diasFeriados,
                totalIncome: calc.totalIncome,
                inssLaboral: calc.inssLaboral,
                irLaboral: calc.irLaboral,
                totalDeductions: calc.totalDeductions,
                advanceDeduction: advanceAppliedNum,
                absenceDeduction: calc.absenceDeduction,
                diasAusencia,
                judicialDeduction: calc.judicialDeduction,
                netSalary: netFinal,
                inssPatronal: calc.inssPatronal,
                inatec: calc.inatec,
            };

            // Atomicidad (correctitud): el upsert de la nómina (que ya resta
            // advanceApplied del neto) y la marca DEDUCTED / diferido de los adelantos
            // deben confirmarse juntos. Sin la $transaction, un corte entre el upsert y
            // el updateMany dejaría el neto ya descontado con el SalaryAdvance aún en
            // APPROVED/payrollId null → el mismo adelanto se vuelve a tomar en la
            // siguiente corrida (doble descuento al trabajador).
            const payroll = await prisma.$transaction(async (tx: any) => {
                const upserted = await tx.payroll.upsert({
                    where: {
                        employeeId_month_year: { employeeId: emp.id, month: Number(month), year: Number(year) },
                    },
                    update: data,
                    create: { tenantId: authReq.tenantId!, employeeId: emp.id, month: Number(month), year: Number(year), ...data },
                });

                // Marcar como descontados solo los adelantos aplicados; los que no
                // cupieron y estaban enlazados a esta nómina, devolverlos a APPROVED.
                if (aplicados.length > 0) {
                    await tx.salaryAdvance.updateMany({ where: { id: { in: aplicados } }, data: { status: 'DEDUCTED', payrollId: upserted.id } });
                }
                const diferidos = advances.filter(a => !aplicados.includes(a.id)).map(a => a.id);
                if (diferidos.length > 0) {
                    await tx.salaryAdvance.updateMany({ where: { id: { in: diferidos }, payrollId: upserted.id }, data: { status: 'APPROVED', payrollId: null } });
                }

                return upserted;
            });

            payrolls.push({
                ...payroll,
                employeeName: `${emp.firstName} ${emp.lastName}`,
                cedula: emp.cedula,
                inss: emp.inss,
                ventasMes,
            });
        }

        res.json({ payrolls, month, year });

    } catch (error) {
        console.error('Error calculando nómina:', error);
        res.status(500).json({ error: 'Error al calcular nómina' });
    }
});

// GET /api/payroll/:month/:year - Obtener nómina existente
app.get('/api/payroll/:month/:year', authenticate, checkRole(['OWNER', 'ADMIN', 'ACCOUNTANT', 'MANAGER']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { month, year } = req.params;

    try {
        const payrolls = await prisma.payroll.findMany({
            where: {
                tenantId: authReq.tenantId,
                month: Number(month),
                year: Number(year),
            },
            include: {
                employee: {
                    select: { firstName: true, lastName: true, cedula: true, inss: true, role: true, baseSalary: true }
                },
            },
            orderBy: { employee: { firstName: 'asc' } },
        });

        res.json(payrolls);

    } catch (error) {
        res.status(500).json({ error: 'Error al obtener nómina' });
    }
});

// GET /api/payroll/sie/:month/:year — Reporte INSS/SIE consolidado del mes (B5)
// Datos por empleado listos para declarar al SIE del INSS (+ INATEC aparte).
app.get('/api/payroll/sie/:month/:year', authenticate, checkRole(['OWNER', 'ADMIN', 'ACCOUNTANT', 'MANAGER']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const month = Number(req.params.month);
    const year = Number(req.params.year);
    if (isNaN(month) || isNaN(year) || month < 1 || month > 12) {
        return res.status(400).json({ error: 'Mes o año inválido.' });
    }
    try {
        const payrolls = await prisma.payroll.findMany({
            where: { tenantId: authReq.tenantId!, month, year },
            include: { employee: { select: { firstName: true, lastName: true, cedula: true, inss: true } } },
            orderBy: { employee: { firstName: 'asc' } },
        });
        const tenant = await prisma.tenant.findUnique({
            where: { id: authReq.tenantId! }, select: { businessName: true, taxId: true },
        });

        const empleados = payrolls.map(p => {
            const inssLaboral = new Decimal(p.inssLaboral.toString());
            const inssPatronal = new Decimal(p.inssPatronal.toString());
            return {
                inss: p.employee.inss || '',
                cedula: p.employee.cedula || '',
                nombre: `${p.employee.firstName} ${p.employee.lastName}`.trim(),
                salario: Number(p.totalIncome),
                inssLaboral: inssLaboral.toNumber(),
                inssPatronal: inssPatronal.toNumber(),
                inatec: Number(p.inatec),
                totalInss: inssLaboral.plus(inssPatronal).toDecimalPlaces(2).toNumber(),
                sinNumeroInss: !p.employee.inss,
            };
        });

        const sum = (k: 'salario' | 'inssLaboral' | 'inssPatronal' | 'inatec' | 'totalInss') =>
            empleados.reduce((acc, e) => acc.plus(e[k]), new Decimal(0)).toDecimalPlaces(2).toNumber();

        res.json({
            empresa: tenant?.businessName ?? '', ruc: tenant?.taxId ?? '',
            month, year, empleados,
            totals: {
                salario: sum('salario'), inssLaboral: sum('inssLaboral'),
                inssPatronal: sum('inssPatronal'), inatec: sum('inatec'), totalInss: sum('totalInss'),
            },
            empleadosSinINSS: empleados.filter(e => e.sinNumeroInss).length,
        });
    } catch (error) {
        console.error('SIE report error:', error);
        res.status(500).json({ error: 'Error al generar el reporte INSS.' });
    }
});

// POST /api/payroll/:id/pay - Marcar nómina como pagada
app.post('/api/payroll/:id/pay', authenticate, checkRole(['OWNER', 'ADMIN', 'ACCOUNTANT']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        // Anti-IDOR: la nómina debe pertenecer al tenant del token.
        const owned = await prisma.payroll.findFirst({
            where: { id: req.params.id, tenantId: authReq.tenantId },
        });
        if (!owned) {
            return res.status(404).json({ error: 'Nómina no encontrada' });
        }
        // Idempotente: no re-pagar (evita doble gasto, doble provisión y doble
        // acumulación de vacaciones).
        if (owned.status === 'PAGADO') {
            return res.status(400).json({ error: 'Esta nómina ya fue pagada.' });
        }

        // Asegura que el catálogo tenga las cuentas de prestaciones (auto-sanable).
        await seedChartOfAccounts(authReq.tenantId!);

        // Trazas de asientos de partida doble omitidos (fail-soft): el pago se
        // confirma igual, pero la omisión ya no queda silenciosa (se audita y se
        // devuelve una advertencia explícita para no dejar el mayor descuadrado sin
        // aviso al operador).
        let asientoNominaOmitido: string | null = null;
        let provisionOmitida: string | null = null;

        const payroll = await prisma.$transaction(async (tx: any) => {
            const updated = await tx.payroll.update({
                where: { id: owned.id },
                data: { status: 'PAGADO', paidAt: new Date() },
            });

            // Gasto operativo de la nómina (neto pagado) — alimenta los dashboards.
            await tx.expense.create({
                data: {
                    tenantId: authReq.tenantId!,
                    amount: updated.netSalary,
                    description: `Nómina ${updated.month}/${updated.year} - Empleado`,
                    category: 'NOMINA',
                },
            });

            // Asiento de nómina en el libro de partida doble: Debe Gasto Nómina /
            // INSS Patronal / INATEC, Haber Caja + pasivos. Así la nómina aparece
            // en el Flujo de Caja, el Balance y el Estado de Resultados. Fail-soft.
            try {
                await recordPayroll(tx, authReq.tenantId!, authReq.userId!, updated.id, Number(updated.netSalary), Number(updated.inssLaboral), Number(updated.irLaboral), Number(updated.inssPatronal), Number(updated.inatec));
            } catch (payErr: any) {
                asientoNominaOmitido = payErr?.message || String(payErr);
                console.warn('⚠️ Asiento de nómina omitido (la nómina se paga igual):', payErr);
            }

            // Devengo mensual del pasivo laboral: aguinaldo + vacaciones +
            // indemnización ≈ 1/12 del salario ordinario cada uno (~25% total).
            // El cálculo fino se hace al pagar el aguinaldo (B2) y en la
            // liquidación (B3); esto es la provisión contable del mes. Fail-soft:
            // la nómina se paga aunque el período esté cerrado.
            const cuota = new Decimal(owned.grossSalary.toString()).div(12).toDecimalPlaces(2).toNumber();
            try {
                await recordLaborProvision(tx, authReq.tenantId!, authReq.userId!, owned.id, cuota, cuota, cuota);
            } catch (provErr: any) {
                provisionOmitida = provErr?.message || String(provErr);
                console.warn('⚠️ Provisión de prestaciones omitida (la nómina se paga igual):', provErr);
            }

            // Acumular las vacaciones devengadas del mes (2.5 días, Art. 76).
            await tx.employee.update({
                where: { id: owned.employeeId },
                data: { vacationDays: { increment: 2.5 } },
            });

            // Asiento de auditoría inmutable (Capa 3): el pago de nómina mueve
            // efectivo, así que dentro de la misma $transaction dejamos before/after
            // del estado y los montos con userId/tenantId.
            await tx.auditLog.create({
                data: {
                    tenantId: authReq.tenantId!,
                    userId: authReq.userId!,
                    action: 'PAYROLL_PAID',
                    details: JSON.stringify({
                        payrollId: owned.id,
                        employeeId: owned.employeeId,
                        month: owned.month,
                        year: owned.year,
                        before: { status: owned.status },
                        after: {
                            status: updated.status,
                            netSalary: updated.netSalary.toString(),
                            inssLaboral: updated.inssLaboral.toString(),
                            irLaboral: updated.irLaboral.toString(),
                            inssPatronal: updated.inssPatronal.toString(),
                            inatec: updated.inatec.toString(),
                        },
                        timestamp: new Date().toISOString(),
                    }),
                },
            });

            return updated;
        });

        // Si algún asiento de partida doble se omitió (fail-soft), dejar traza
        // inmutable de la omisión: el pago quedó confirmado pero el mayor puede estar
        // descuadrado, por lo que además se avisa explícitamente al operador.
        if (asientoNominaOmitido || provisionOmitida) {
            await prisma.auditLog.create({
                data: {
                    tenantId: authReq.tenantId!,
                    userId: authReq.userId!,
                    action: 'PAYROLL_JOURNAL_SKIPPED',
                    details: JSON.stringify({
                        payrollId: owned.id,
                        employeeId: owned.employeeId,
                        month: owned.month,
                        year: owned.year,
                        asientoNominaOmitido,
                        provisionOmitida,
                        timestamp: new Date().toISOString(),
                    }),
                },
            });
        }

        if (asientoNominaOmitido || provisionOmitida) {
            return res.json({
                ...payroll,
                advertencia: 'La nómina se pagó, pero el asiento contable no se registró (período cerrado o cuentas faltantes). Revíselo: el mayor puede quedar descuadrado.',
            });
        }

        res.json(payroll);
    } catch (error) {
        console.error('Error al pagar nómina:', error);
        res.status(500).json({ error: 'Error al pagar nómina' });
    }
});

// ==========================================
// 🎄 AGUINALDO (TRECEAVO MES) — Art. 93-95 Ley 185
// ==========================================

// Aguinaldo proporcional = salario × min(1, díasLaborados / 360) en el período
// dic[year-1] → nov[year], desde la fecha de ingreso si es posterior, y solo
// hasta hoy si el período aún no termina.
function computeAguinaldo(baseSalary: number, hireDate: Date, year: number, today: Date) {
    const periodStart = new Date(year - 1, 11, 1); // 1 dic año anterior
    const periodEnd = new Date(year, 10, 30);      // 30 nov del año
    const effectiveEnd = today < periodEnd ? today : periodEnd;
    const start = hireDate > periodStart ? hireDate : periodStart;
    let dias = 0;
    if (effectiveEnd >= start) {
        dias = Math.min(360, Math.floor((effectiveEnd.getTime() - start.getTime()) / 86400000) + 1);
    }
    // Precisión financiera (Capa 4): salario × min(1, días/360) con decimal.js para
    // no divergir del motor Decimal de la liquidación (nicaLabor) al conciliar.
    const monto = new Decimal(baseSalary.toString())
        .mul(Decimal.min(1, new Decimal(dias).div(360)))
        .toDecimalPlaces(2)
        .toNumber();
    return { dias, monto };
}

// GET /api/payroll/aguinaldo/:year — previsualización + estado de la corrida.
app.get('/api/payroll/aguinaldo/:year', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const tenantId = authReq.tenantId!;
    const year = parseInt(req.params.year);
    if (isNaN(year)) return res.status(400).json({ error: 'Año inválido.' });
    try {
        const today = new Date();
        const employees = await prisma.employee.findMany({ where: { tenantId, status: 'ACTIVE' }, orderBy: { firstName: 'asc' } });
        const existing = await prisma.aguinaldo.findMany({ where: { tenantId, year } });
        const paidMap = new Map(existing.map(a => [a.employeeId, a]));

        const items = employees.map(emp => {
            const paid = paidMap.get(emp.id);
            const base = Number(emp.baseSalary);
            const calc = computeAguinaldo(base, new Date(emp.hireDate), year, today);
            return {
                employeeId: emp.id,
                name: `${emp.firstName} ${emp.lastName}`,
                cedula: emp.cedula,
                baseSalary: base,
                diasLaborados: paid ? paid.diasLaborados : calc.dias,
                monto: paid ? Number(paid.monto) : calc.monto,
                pagado: !!paid,
                paidAt: paid?.paidAt ?? null,
            };
        });

        const totalMonto = Number(items.reduce((s, i) => s + i.monto, 0).toFixed(2));
        const dueDate = new Date(year, 11, 10); // 10 de diciembre (fecha límite legal)
        const diasParaVencer = Math.ceil((dueDate.getTime() - today.getTime()) / 86400000);
        const pendientes = items.filter(i => !i.pagado && i.monto > 0).length;

        res.json({ year, periodo: `Dic ${year - 1} – Nov ${year}`, items, totalMonto, dueDate, diasParaVencer, pendientes });
    } catch (error) {
        console.error('Aguinaldo preview error:', error);
        res.status(500).json({ error: 'Error al calcular el aguinaldo.' });
    }
});

// POST /api/payroll/aguinaldo/:year/run — corre y paga el aguinaldo (idempotente).
app.post('/api/payroll/aguinaldo/:year/run', authenticate, checkRole(['OWNER', 'ADMIN', 'ACCOUNTANT']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const tenantId = authReq.tenantId!;
    const year = parseInt(req.params.year);
    if (isNaN(year)) return res.status(400).json({ error: 'Año inválido.' });
    try {
        await seedChartOfAccounts(tenantId);
        const today = new Date();
        const employees = await prisma.employee.findMany({ where: { tenantId, status: 'ACTIVE' } });
        const existing = await prisma.aguinaldo.findMany({ where: { tenantId, year }, select: { employeeId: true } });
        const alreadyPaid = new Set(existing.map(a => a.employeeId));

        let pagados = 0;
        let total = 0;
        for (const emp of employees) {
            if (alreadyPaid.has(emp.id)) continue; // ya tiene aguinaldo este año
            const base = Number(emp.baseSalary);
            const { dias, monto } = computeAguinaldo(base, new Date(emp.hireDate), year, today);
            if (monto <= 0) continue;
            try {
                await prisma.$transaction(async (tx: any) => {
                    const ag = await tx.aguinaldo.create({
                        data: { tenantId, employeeId: emp.id, year, diasLaborados: dias, baseSalary: base, monto, status: 'PAGADO' },
                    });
                    // Exento de INSS/IR: Debe Aguinaldo por Pagar / Haber Caja.
                    // Fail-soft: el aguinaldo se paga aunque el período esté cerrado.
                    try {
                        await recordAguinaldoPayment(tx, tenantId, authReq.userId!, ag.id, monto);
                    } catch (accErr) {
                        console.warn('⚠️ Asiento de aguinaldo omitido:', accErr);
                    }
                    // Asiento de auditoría inmutable (Capa 3): la corrida mueve efectivo
                    // por empleado, así que dentro de la misma $transaction dejamos userId,
                    // tenantId y los montos del pago de aguinaldo.
                    await tx.auditLog.create({
                        data: {
                            tenantId,
                            userId: authReq.userId!,
                            action: 'AGUINALDO_PAID',
                            details: JSON.stringify({
                                aguinaldoId: ag.id,
                                employeeId: emp.id,
                                year,
                                diasLaborados: dias,
                                baseSalary: base,
                                monto,
                                timestamp: new Date().toISOString(),
                            }),
                        },
                    });
                });
                pagados++;
                total += monto;
            } catch (e: any) {
                if (e?.code === 'P2002') continue; // carrera: ya pagado
                console.error('Aguinaldo empleado error:', e);
            }
        }

        res.json({ message: `Aguinaldo procesado para ${pagados} colaborador(es).`, pagados, total: Number(total.toFixed(2)), year });
    } catch (error) {
        console.error('Aguinaldo run error:', error);
        res.status(500).json({ error: 'Error al correr el aguinaldo.' });
    }
});

// GET /api/labor-liabilities - Pasivos laborales (Aguinaldo, Vacaciones, Indemnización)
app.get('/api/labor-liabilities', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        // N1: un empleado TERMINATED ya fue liquidado — su pasivo se pagó en el
        // finiquito; incluirlo inflaba el total reportado.
        const employees = await prisma.employee.findMany({
            where: { tenantId: authReq.tenantId, status: { not: 'TERMINATED' } },
        });

        const liabilities = employees.map(emp =>
            calculateLaborLiability(
                emp.id,
                `${emp.firstName} ${emp.lastName}`,
                emp.hireDate,
                Number(emp.baseSalary),
                Number(emp.vacationDays || 0) // saldo REAL (nómina/licencias lo mantienen)
            )
        );

        const totalPasivo = liabilities.reduce((sum, l) => sum + l.totalPasivo, 0);

        res.json({ liabilities, totalPasivo });

    } catch (error) {
        res.status(500).json({ error: 'Error calculando pasivos laborales' });
    }
});

// POST /api/tax-report/generate - Generar reporte fiscal mensual
app.post('/api/tax-report/generate', authenticate, checkRole(FISCAL_REPORT_ROLES), validate(TaxReportSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { month, year } = req.body; // Validado por Zod (int, 1-12, 2020-2100)

    try {
        const report = await generateMonthlyReport(authReq.tenantId!, Number(month), Number(year));

        // Guardar en DB
        await saveMonthlyReport(authReq.tenantId!, report);

        res.json(report);

    } catch (error) {
        console.error('Error generando reporte fiscal:', error);
        res.status(500).json({ error: 'Error al generar reporte fiscal' });
    }
});

// GET /api/tax-report/:month/:year - Obtener reporte fiscal
app.get('/api/tax-report/:month/:year', authenticate, checkRole(FISCAL_REPORT_ROLES), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const period = parseFiscalPeriod(req.params.month, req.params.year);
    if (!period) return res.status(400).json({ error: 'Mes o año inválido.' });
    const { month, year } = period;

    try {
        const report = await prisma.taxReport.findUnique({
            where: {
                tenantId_month_year: {
                    tenantId: authReq.tenantId!,
                    month,
                    year,
                },
            },
        });

        if (!report) {
            return res.status(404).json({ error: 'Reporte no encontrado. Genera uno primero.' });
        }

        res.json(report);

    } catch (error) {
        res.status(500).json({ error: 'Error al obtener reporte fiscal' });
    }
});

// ==========================================
// 🦈 SUPER ADMIN - CENTRO DE COMANDO
// ==========================================

// GET /api/admin/ledger/verify/:tenantId — Verificación de integridad del
// libro de caja (cadena seq/prevHash + firmas HMAC). Detecta UPDATE/DELETE
// manuales en la DB. Ver services/ledger.ts.
app.get('/api/admin/ledger/verify/:tenantId', authenticate, requireSuperAdmin, async (req: any, res: any) => {
    try {
        const report = await verifyTenantLedger(prisma, req.params.tenantId);
        res.status(report.ok ? 200 : 409).json(report);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Error verificando libro';
        res.status(500).json({ error: message });
    }
});

// POST /api/admin/whatsapp/channels — registra/actualiza el número WhatsApp de
// un tenant. El access token se guarda CIFRADO (crypto.encryptField). Requiere
// NORTEX_DATA_KEYS configurado. SUPER_ADMIN (manejo de credenciales).
app.post('/api/admin/whatsapp/channels', authenticate, requireSuperAdmin, async (req: any, res: any) => {
    try {
        const { tenantId, phoneNumberId, wabaId, displayPhone, accessToken, botScope, defaultMode } = req.body ?? {};
        if (!tenantId || !phoneNumberId || !accessToken) {
            return res.status(400).json({ error: 'tenantId, phoneNumberId y accessToken son requeridos' });
        }
        const accessTokenEnc = encryptField(String(accessToken));
        const channel = await prisma.whatsAppChannel.upsert({
            where: { phoneNumberId: String(phoneNumberId) },
            create: {
                tenantId: String(tenantId),
                phoneNumberId: String(phoneNumberId),
                wabaId: wabaId ? String(wabaId) : null,
                displayPhone: displayPhone ? String(displayPhone) : null,
                accessTokenEnc,
                botScope: botScope ? String(botScope) : 'B2C',
                defaultMode: defaultMode ? String(defaultMode) : 'BOT',
            },
            update: {
                tenantId: String(tenantId),
                wabaId: wabaId ? String(wabaId) : null,
                displayPhone: displayPhone ? String(displayPhone) : null,
                accessTokenEnc,
                botScope: botScope ? String(botScope) : 'B2C',
                defaultMode: defaultMode ? String(defaultMode) : 'BOT',
                active: true,
            },
        });
        res.json({ id: channel.id, tenantId: channel.tenantId, phoneNumberId: channel.phoneNumberId, botScope: channel.botScope });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Error registrando canal';
        res.status(500).json({ error: message });
    }
});

// ==========================================
// 🛵 KYC RED NORTEX — revisión manual de motorizados (SUPER_ADMIN)
// ==========================================

// GET /api/admin/motorizados?status=PENDIENTE — cola de revisión KYC
app.get('/api/admin/motorizados', authenticate, requireSuperAdmin, async (req: any, res: any) => {
    try {
        const status = typeof req.query.status === 'string' ? req.query.status : undefined;
        const motorizados = await prisma.motorizado.findMany({
            where: {
                tipoFlota: 'NORTEX',
                ...(status ? { kycStatus: status } : {}),
            },
            select: {
                id: true, nombre: true, telefono: true, cedula: true,
                zonaCobertura: true, vehiculoPlaca: true, fotoCedulaUrl: true,
                fotoVehiculoUrl: true, kycStatus: true, kycNota: true,
                activo: true, calificacionPromedio: true, createdAt: true,
                walletBalance: true,
            },
            orderBy: { createdAt: 'desc' },
        });
        res.json({ motorizados });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Error listando motorizados';
        res.status(500).json({ error: message });
    }
});

// PATCH /api/admin/motorizados/:id/kyc — aprobar / rechazar (KYC manual)
app.patch('/api/admin/motorizados/:id/kyc', authenticate, requireSuperAdmin, async (req: any, res: any) => {
    try {
        const { decision, nota } = req.body ?? {};
        if (decision !== 'APROBADO' && decision !== 'RECHAZADO') {
            return res.status(400).json({ error: 'decision debe ser APROBADO o RECHAZADO' });
        }
        const existing = await prisma.motorizado.findFirst({
            where: { id: req.params.id, tipoFlota: 'NORTEX' },
            select: { id: true },
        });
        if (!existing) return res.status(404).json({ error: 'Motorizado no encontrado' });

        const motorizado = await prisma.motorizado.update({
            where: { id: existing.id },
            data: {
                kycStatus: decision,
                // La aprobación ACTIVA al repartidor; el rechazo lo desactiva.
                activo: decision === 'APROBADO',
                kycNota: typeof nota === 'string' && nota.trim() ? nota.trim() : null,
            },
            select: { id: true, nombre: true, kycStatus: true, activo: true },
        });
        res.json({ message: `Motorizado ${decision === 'APROBADO' ? 'aprobado' : 'rechazado'}.`, motorizado });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Error procesando KYC';
        res.status(500).json({ error: message });
    }
});

// GET /api/admin/motorizados/:id/wallet — saldo + libro + verificación de la
// cadena firmada (FASE 3): detecta UPDATE/DELETE manual y proyección alterada.
app.get('/api/admin/motorizados/:id/wallet', authenticate, requireSuperAdmin, async (req: any, res: any) => {
    try {
        const motorizado = await prisma.motorizado.findUnique({
            where: { id: req.params.id },
            select: { id: true, nombre: true, tipoFlota: true, walletBalance: true },
        });
        if (!motorizado) return res.status(404).json({ error: 'Motorizado no encontrado' });

        const [movimientos, verification] = await Promise.all([
            prisma.driverWalletMovement.findMany({
                where: { motorizadoId: motorizado.id },
                orderBy: { createdAt: 'desc' },
                take: 100,
            }),
            verifyDriverLedger(prisma, motorizado.id),
        ]);

        res.status(verification.ok ? 200 : 409).json({
            motorizado: { ...motorizado, walletBalance: Number(motorizado.walletBalance) },
            verification,
            movimientos: movimientos.map((m: typeof movimientos[number]) => ({ ...m, amount: Number(m.amount) })),
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Error consultando wallet';
        res.status(500).json({ error: message });
    }
});

// POST /api/admin/motorizados/:id/wallet/payout — registrar el pago de Nortex
// al repartidor (debita el wallet con un movimiento FIRMADO; no permite
// sobregiro). El dinero físico se mueve fuera; aquí queda el rastro inmutable.
app.post('/api/admin/motorizados/:id/wallet/payout', authenticate, requireSuperAdmin, async (req: any, res: any) => {
    try {
        const authReq = req as AuthRequest;
        const { amount, nota } = req.body ?? {};
        // Dinero con decimal.js (Capa 4): el monto y el chequeo de sobregiro se
        // calculan en Decimal —nunca en float—, redondeando a 2 decimales igual que
        // la columna Decimal(12,2), para que el control valide EXACTAMENTE lo que se debita.
        let monto: Decimal;
        try {
            monto = new Decimal(String(amount)).toDecimalPlaces(2);
        } catch {
            return res.status(400).json({ error: 'amount debe ser un número > 0' });
        }
        if (!monto.isFinite() || monto.lte(0)) {
            return res.status(400).json({ error: 'amount debe ser un número > 0' });
        }

        const movement = await prisma.$transaction(async (tx) => {
            // Pre-chequeo para un 400 limpio; la validación AUTORITATIVA del
            // sobregiro es el read-back de después del débito (ver abajo).
            const driver = await tx.motorizado.findUnique({
                where: { id: req.params.id },
                select: { id: true, nombre: true, walletBalance: true },
            });
            if (!driver) throw new Error('DRIVER_NOT_FOUND');
            if (new Decimal(driver.walletBalance.toString()).lt(monto)) throw new Error('SALDO_INSUFICIENTE');

            // S44 — dedupe del doble-click: un payout idéntico al mismo repartidor
            // en los últimos 10s es un duplicado casi seguro → 409. Cubre el
            // reintento secuencial (refresh/re-submit); el doble-click estrictamente
            // concurrente se cierra con llave de idempotencia + unique en el lote
            // DDL post-dump.
            const reciente = await tx.driverWalletMovement.findFirst({
                where: {
                    motorizadoId: driver.id,
                    type: 'PAGO_NORTEX',
                    amount: monto.negated().toNumber(),
                    createdAt: { gte: new Date(Date.now() - 10_000) },
                },
                select: { id: true },
            });
            if (reciente) throw new Error('PAYOUT_DUPLICADO');

            const mov = await appendDriverWalletMovement(tx, {
                motorizadoId: driver.id,
                tenantId: null,
                pedidoId: null,
                type: 'PAGO_NORTEX',
                amount: monto.negated().toNumber(),
                descripcion: typeof nota === 'string' && nota.trim()
                    ? `Pago Nortex: ${nota.trim()}`
                    : 'Pago de comisiones Nortex al repartidor',
            });

            // S44 — el pre-chequeo de arriba lee un snapshot (TOCTOU): dos payouts
            // concurrentes lo pasaban ambos y el wallet quedaba NEGATIVO (se pagaba
            // de más). La proyección del ledger debita con increment atómico y deja
            // el row-lock hasta el commit, así que este read-back (misma tx, ve su
            // propio débito y serializa con el rival) es el guard real: si el saldo
            // resultante es negativo, el rival ganó → rollback completo del payout.
            // Funciona con y sin firma del libro (NORTEX_LEDGER_KEYS).
            const despues = await tx.motorizado.findUnique({
                where: { id: driver.id },
                select: { walletBalance: true },
            });
            if (!despues || new Decimal(despues.walletBalance.toString()).lt(0)) {
                throw new Error('SALDO_INSUFICIENTE');
            }

            // Auditoría inmutable (Capa 3): el payout saca dinero real, así que dentro
            // de la MISMA $transaction dejamos el actor (SUPER_ADMIN) y el monto.
            await tx.auditLog.create({
                data: {
                    tenantId: authReq.tenantId!,
                    userId: authReq.userId!,
                    action: 'DRIVER_PAYOUT',
                    details: JSON.stringify({
                        movementId: mov.id,
                        motorizadoId: driver.id,
                        nombre: driver.nombre,
                        monto: monto.toFixed(2),
                        timestamp: new Date().toISOString(),
                    }),
                },
            });

            return mov;
        });

        res.json({ message: 'Pago registrado en el libro del repartidor.', movementId: movement.id, amount: monto.negated().toNumber() });
    } catch (error: unknown) {
        if (error instanceof Error && error.message === 'DRIVER_NOT_FOUND') {
            return res.status(404).json({ error: 'Motorizado no encontrado' });
        }
        if (error instanceof Error && error.message === 'SALDO_INSUFICIENTE') {
            return res.status(400).json({ error: 'El monto excede el saldo del wallet del repartidor.' });
        }
        if (error instanceof Error && error.message === 'PAYOUT_DUPLICADO') {
            return res.status(409).json({ error: 'Pago idéntico registrado hace unos segundos — parece un doble envío. Si es intencional, esperá 10 segundos y repetilo.' });
        }
        const message = error instanceof Error ? error.message : 'Error registrando pago';
        res.status(500).json({ error: message });
    }
});

// ── Command Center: contrato de métricas globales (tipado estricto) ──
// Todos los montos viajan como string con precisión Decimal(18,4): cero float en el cable.
interface AdminMetricsResponse {
    totalTenants: number;
    activeTenants: number;       // RETENCIÓN: uso real (venta o login en 30d), NO "no suspendido"
    activeSubscriptions: number; // suscripciones vigentes (no morosas) — métrica de negocio distinta
    activeUsers30d: number;      // usuarios con login en 30d (actividad real)
    newTenantsThisMonth: number; // altas del mes en curso
    dormantTenants: number;      // registradas hace >7d y SIN uso en 30d (el "se registran pero no se quedan")
    morosos: number;
    activeUsers: number;
    monthlyTransactions: number;
    totalDebtLent: string;   // Capital asignado vigente
    totalWallet: string;     // Suma de wallets de los tenants
    monthlySales: string;    // Ventas del mes en curso
    platformFee: string;     // 2% sobre ventas
    interestIncome: string;  // 5% de retención sobre capital
    monthlyRevenue: string;  // platformFee + interestIncome
}

// GET /api/admin/metrics - KPIs globales de la plataforma (Decimal-safe, sin mock)
app.get('/api/admin/metrics', authenticate, requireSuperAdmin, async (_req: express.Request, res: express.Response) => {
    try {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const sevenDaysAgo  = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        // Una sola ronda de queries reales; si la BD cae, el endpoint falla (el panel lo refleja).
        // RETENCIÓN: "activo" se mide por USO real (venta o login en 30d), no por
        // "no suspendido". Los tenantIds activos salen de dos señales que ya viven
        // en la BD —Sale.createdAt y User.lastLogin— agregadas en la BD (distinct),
        // no traídas fila por fila (guardrail de escalabilidad #2).
        const [tenants, loanAgg, salesAgg, activeUsers, activeUsers30d, newTenantsThisMonth, salesTenantIds, loginTenantIds] = await Promise.all([
            prisma.tenant.findMany({ select: { id: true, subscriptionStatus: true, walletBalance: true, createdAt: true } }),
            prisma.b2BOrder.aggregate({
                where: { status: { in: ['PENDING', 'APPROVED', 'DELIVERED'] } },
                _sum: { total: true },
            }),
            prisma.sale.aggregate({
                where: { createdAt: { gte: monthStart } },
                _sum: { total: true },
                _count: true,
            }),
            prisma.user.count(),
            prisma.user.count({ where: { lastLogin: { gte: thirtyDaysAgo } } }),
            prisma.tenant.count({ where: { createdAt: { gte: monthStart } } }),
            prisma.sale.findMany({ where: { createdAt: { gte: thirtyDaysAgo } }, select: { tenantId: true }, distinct: ['tenantId'] }),
            prisma.user.findMany({ where: { lastLogin: { gte: thirtyDaysAgo } }, select: { tenantId: true }, distinct: ['tenantId'] }),
        ]);

        const morosos = tenants.filter(t => t.subscriptionStatus === 'PAST_DUE' || t.subscriptionStatus === 'CANCELLED').length;

        // Set de tenants ACTIVOS por uso (unión de "vendió en 30d" ∪ "entró en 30d").
        const activeSet = new Set<string>();
        for (const s of salesTenantIds) activeSet.add(s.tenantId);
        for (const u of loginTenantIds) { if (u.tenantId) activeSet.add(u.tenantId); }
        const activeByUsage = activeSet.size;
        // DORMIDAS: registradas hace >7d (ya tuvieron tiempo de arrancar) y sin uso
        // en 30d. Es la medida directa de "se registran pero no se quedan".
        const dormantTenants = tenants.filter(t => t.createdAt < sevenDaysAgo && !activeSet.has(t.id)).length;

        // ── Todo el dinero con Decimal.js, extraído de columnas Decimal(18,4) ──
        const totalWallet    = tenants.reduce((acc, t) => acc.plus(new Decimal(t.walletBalance.toString())), new Decimal(0));
        const capitalLent    = new Decimal((loanAgg._sum.total ?? 0).toString());
        const monthlySales   = new Decimal((salesAgg._sum.total ?? 0).toString());
        const platformFee    = monthlySales.mul('0.02');   // 2% sobre ventas del mes
        const retentionFee   = capitalLent.mul('0.05');    // 5% de retención sobre el capital asignado
        const monthlyRevenue = platformFee.plus(retentionFee);

        const money = (d: Decimal): string => d.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);

        const body: AdminMetricsResponse = {
            totalTenants:        tenants.length,
            activeTenants:       activeByUsage,            // uso real (venta o login 30d)
            activeSubscriptions: tenants.length - morosos, // suscripciones no morosas (métrica de negocio)
            activeUsers30d,
            newTenantsThisMonth,
            dormantTenants,
            morosos,
            activeUsers,
            monthlyTransactions: salesAgg._count,
            totalDebtLent:       money(capitalLent),
            totalWallet:         money(totalWallet),
            monthlySales:        money(monthlySales),
            platformFee:         money(platformFee),
            interestIncome:      money(retentionFee),
            monthlyRevenue:      money(monthlyRevenue),
        };
        res.json(body);
    } catch (error) {
        console.error('Admin metrics error:', error);
        res.status(500).json({ error: 'Error al obtener métricas' });
    }
});

// GET /api/admin/tenants - Lista completa de empresas
// Retención R1: incluye contacto (email/phone), última actividad y la marca
// `dormant` (>7 días registrada y sin venta NI login en 30 días — la misma
// definición que el KPI "DORMIDAS" de /api/admin/metrics). Con ?dormant=1
// devuelve solo esas: la lista de llamadas del CEO. Antes el KPI era un número
// muerto: se sabía CUÁNTAS dormían pero no QUIÉNES ni cómo contactarlas.
app.get('/api/admin/tenants', authenticate, requireSuperAdmin, async (req: any, res: express.Response) => {
    try {
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        // Actividad agregada en la BD (guardrail #2): máx lastLogin por tenant y
        // tenants con ventas en 30d (distinct) — sin traer filas de negocio.
        const [tenants, lastLoginByTenant, salesTenantIds] = await Promise.all([
            prisma.tenant.findMany({
                include: {
                    users: {
                        select: { id: true, name: true, email: true, role: true },
                        take: 1,
                        orderBy: { createdAt: 'asc' }
                    },
                    _count: {
                        select: { sales: true, products: true, employees: true }
                    }
                },
                orderBy: { createdAt: 'desc' }
            }),
            prisma.user.groupBy({ by: ['tenantId'], _max: { lastLogin: true } }),
            prisma.sale.findMany({ where: { createdAt: { gte: thirtyDaysAgo } }, select: { tenantId: true }, distinct: ['tenantId'] }),
        ]);

        const lastLoginMap = new Map(lastLoginByTenant.map(g => [g.tenantId, g._max.lastLogin]));
        const soldRecently = new Set(salesTenantIds.map(s => s.tenantId));

        const tenantsWithOwner = tenants.map(t => {
            const lastLogin = lastLoginMap.get(t.id) || null;
            const dormant =
                t.createdAt < sevenDaysAgo &&
                !soldRecently.has(t.id) &&
                (!lastLogin || lastLogin < thirtyDaysAgo);
            return {
                id: t.id,
                businessName: t.businessName,
                taxId: t.taxId,
                type: t.type,
                phone: t.phone || null,
                walletBalance: new Decimal(t.walletBalance.toString()).toFixed(4),
                creditLimit: new Decimal(t.creditLimit.toString()).toFixed(4),
                creditScore: t.creditScore,
                subscriptionStatus: t.subscriptionStatus || 'ACTIVE',
                createdAt: t.createdAt,
                trialEndsAt: t.trialEndsAt,
                lastLogin,
                dormant,
                owner: t.users[0] || null,
                stats: {
                    sales: t._count.sales,
                    products: t._count.products,
                    employees: t._count.employees,
                }
            };
        });

        const onlyDormant = req.query?.dormant === '1' || req.query?.dormant === 'true';
        res.json(onlyDormant ? tenantsWithOwner.filter(t => t.dormant) : tenantsWithOwner);
    } catch (error) {
        console.error('Admin tenants error:', error);
        res.status(500).json({ error: 'Error al obtener empresas' });
    }
});

// POST /api/admin/tenants/:id/suspend - Suspender empresa
app.post('/api/admin/tenants/:id/suspend', authenticate, requireSuperAdmin, async (req: any, res: any) => {
    try {
        const tenant = await prisma.tenant.update({
            where: { id: req.params.id },
            data: { subscriptionStatus: 'PAST_DUE' }
        });

        // Invalidar caché de este tenant (efecto inmediato)
        invalidateTenantCache(tenant.id);

        // Registrar en audit log
        await prisma.auditLog.create({
            data: {
                tenantId: tenant.id,
                userId: (req as AuthRequest).userId!,
                action: 'ADMIN_SUSPEND',
                details: `Empresa ${tenant.businessName} suspendida por SUPER_ADMIN`
            }
        });

        res.json({ message: `${tenant.businessName} SUSPENDIDA.`, tenant });
    } catch (error) {
        res.status(500).json({ error: 'Error al suspender empresa' });
    }
});

// POST /api/admin/tenants/:id/reactivate - Reactivar empresa
app.post('/api/admin/tenants/:id/reactivate', authenticate, requireSuperAdmin, async (req: any, res: any) => {
    try {
        // Extend by 30 days from now so the hourly cron doesn't immediately
        // revert ACTIVE→PAST_DUE because subscriptionEndsAt is still in the past.
        const newEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

        const tenant = await prisma.tenant.update({
            where: { id: req.params.id },
            data: {
                subscriptionStatus:  'ACTIVE',
                subscriptionEndsAt:  newEndsAt,
                trialEndsAt:         null,   // clear expired trial so it doesn't re-trigger
            }
        });

        // Invalidar caché (efecto inmediato)
        invalidateTenantCache(tenant.id);

        await prisma.auditLog.create({
            data: {
                tenantId: tenant.id,
                userId: (req as AuthRequest).userId!,
                action: 'ADMIN_REACTIVATE',
                details: `Empresa ${tenant.businessName} reactivada por SUPER_ADMIN. Vence: ${newEndsAt.toISOString().slice(0, 10)}`
            }
        });

        res.json({ message: `${tenant.businessName} REACTIVADA hasta ${newEndsAt.toISOString().slice(0, 10)}.`, tenant });
    } catch (error) {
        res.status(500).json({ error: 'Error al reactivar empresa' });
    }
});

// GET /api/admin/loan-requests - Solicitudes de crédito pendientes
app.get('/api/admin/loan-requests', authenticate, requireSuperAdmin, async (_req: express.Request, res: express.Response) => {
    try {
        const requests = await prisma.b2BOrder.findMany({
            where: { status: 'PENDING' },
            include: {
                tenant: {
                    select: { businessName: true, creditScore: true, walletBalance: true, creditLimit: true }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        // Forma normalizada y tipada: montos Decimal(18,4) como string.
        const body = requests.map(r => ({
            id: r.id,
            tenantId: r.tenantId,
            total: new Decimal(r.total.toString()).toFixed(4),
            status: r.status,
            createdAt: r.createdAt,
            tenant: {
                businessName: r.tenant.businessName,
                creditScore: r.tenant.creditScore,
                walletBalance: new Decimal(r.tenant.walletBalance.toString()).toFixed(4),
                creditLimit: new Decimal(r.tenant.creditLimit.toString()).toFixed(4),
            },
        }));

        res.json(body);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener solicitudes' });
    }
});

// Validación estricta del body (Capa 5). Definido INLINE para no colisionar con
// backend/schemas.ts. amount debe ser decimal > 0 (se valida con decimal.js, sin float).
const ApproveLoanSchema = z.object({
    orderId: z.string().min(1, 'Se requiere orderId'),
    amount: z
        .union([z.string(), z.number()])
        .transform((v) => String(v))
        .refine((v) => {
            try {
                const d = new Decimal(v);
                return d.isFinite() && d.gt(0);
            } catch {
                return false;
            }
        }, { message: 'El monto debe ser mayor que cero' }),
});

// POST /api/admin/loans/approve - Aprobar préstamo
app.post('/api/admin/loans/approve', authenticate, requireSuperAdmin, validate(ApproveLoanSchema), async (req: any, res: any) => {
    const { orderId, amount } = req.body;

    try {
        await prisma.$transaction(async (tx: any) => {
            // Idempotencia + concurrencia: aprobar SOLO si la orden sigue PENDING.
            // El updateMany condicional toma el row-lock; si count===0 la orden ya no
            // estaba pendiente (doble clic/reintento) y abortamos sin re-desembolsar.
            const approved = await tx.b2BOrder.updateMany({
                where: { id: orderId, status: 'PENDING' },
                data: { status: 'APPROVED' },
            });
            if (approved.count === 0) throw new Error('ORDER_NOT_PENDING');

            // Delegate correcto: b2BOrder (el modelo es B2BOrder). El typo previo
            // (b2bOrder) era undefined y hacía fallar toda la aprobación.
            const order = await tx.b2BOrder.findUnique({
                where: { id: orderId },
                include: { tenant: true }
            });
            if (!order) throw new Error('ORDER_NOT_FOUND');

            // Desembolsar fondos al wallet del tenant (Capa 4: decimal.js estricto,
            // nada de Number sobre dinero; escala 2 al acreditar el saldo gastable).
            await tx.tenant.update({
                where: { id: order.tenantId },
                data: { walletBalance: { increment: new Decimal(String(amount)).toDecimalPlaces(2) } }
            });

            // Registrar auditoría
            await tx.auditLog.create({
                data: {
                    tenantId: order.tenantId,
                    userId: (req as AuthRequest).userId!,
                    action: 'LOAN_APPROVED',
                    details: `Préstamo de $${amount} aprobado para ${order.tenant.businessName}`
                }
            });
        });

        res.json({ message: `Préstamo de $${amount} aprobado y desembolsado.` });
    } catch (error) {
        if (error instanceof Error && error.message === 'ORDER_NOT_PENDING') {
            return res.status(409).json({ error: 'La solicitud ya no está pendiente (ya fue aprobada o rechazada).' });
        }
        if (error instanceof Error && error.message === 'ORDER_NOT_FOUND') {
            return res.status(404).json({ error: 'Solicitud no encontrada' });
        }
        console.error('Loan approval error:', error);
        res.status(500).json({ error: 'Error al aprobar préstamo' });
    }
});

// POST /api/admin/loans/reject - Rechazar préstamo
app.post('/api/admin/loans/reject', authenticate, requireSuperAdmin, async (req: any, res: any) => {
    const { orderId } = req.body;

    try {
        const order = await prisma.b2BOrder.update({
            where: { id: orderId },
            data: { status: 'REJECTED' }
        });
        res.json({ message: 'Solicitud rechazada.', order });
    } catch (error) {
        res.status(500).json({ error: 'Error al rechazar solicitud' });
    }
});

// ==========================================
// 💳 BILLING & SUSCRIPCIONES (STRIPE)
// ==========================================

// POST /api/billing/create-session - Crear sesión de pago Stripe
app.post('/api/billing/create-session', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const url = await createCheckoutSession(authReq.tenantId!);
        res.json({ url });
    } catch (error: any) {
        console.error('Stripe checkout error:', error.message);
        res.status(500).json({ error: error.message || 'Error al crear sesión de pago' });
    }
});

// POST /api/billing/portal - Crear sesión del portal de cliente Stripe
app.post('/api/billing/portal', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const url = await createPortalSession(authReq.tenantId!);
        res.json({ url });
    } catch (error: any) {
        console.error('Stripe portal error:', error.message);
        res.status(500).json({ error: error.message || 'Error al crear portal de facturación' });
    }
});

// GET /api/billing/status - Estado de suscripción del tenant actual
// Cuentas de depósito desde env (BANK_ACCOUNTS_JSON). Validación defensiva:
// un JSON malformado en Coolify no debe tumbar el endpoint de billing —
// se loguea y se devuelve [] (el frontend cae al canal de WhatsApp).
function parseBankAccounts(): Array<{ bank: string; type: string; number: string; name: string }> {
    const raw = process.env.BANK_ACCOUNTS_JSON;
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter((a: any) => a && typeof a.bank === 'string' && typeof a.number === 'string')
            .map((a: any) => ({
                bank: String(a.bank),
                type: String(a.type || 'Cuenta'),
                number: String(a.number),
                name: String(a.name || 'NORTEX'),
            }));
    } catch (e) {
        console.error('BANK_ACCOUNTS_JSON malformado:', e);
        return [];
    }
}

app.get('/api/billing/status', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const tenant = await prisma.tenant.findUnique({
            where: { id: authReq.tenantId },
            select: {
                subscriptionStatus: true,
                stripeCustomerId: true,
                stripeSubscriptionId: true,
                subscriptionEndsAt: true,
                businessName: true,
            }
        });

        if (!tenant) {
            return res.status(404).json({ error: 'Tenant no encontrado' });
        }

        res.json({
            status: tenant.subscriptionStatus || 'TRIAL',
            hasStripe: !!tenant.stripeCustomerId,
            subscriptionId: tenant.stripeSubscriptionId,
            endsAt: tenant.subscriptionEndsAt,
            businessName: tenant.businessName,
            stripeConfigured: !!getStripe(),
            // Cuentas bancarias REALES para el pago por depósito (el único
            // método viable en Nicaragua). Vienen de env — nunca hardcodeadas
            // en el bundle del cliente. Antes el frontend mostraba cuentas
            // placeholder XXXX-XXXX-XXXX-4521: el cliente que quería pagar
            // no tenía a dónde transferir. Sin configurar → [] y el frontend
            // manda al WhatsApp (fallback honesto, no números falsos).
            // Formato: BANK_ACCOUNTS_JSON = [{"bank","type","number","name"}]
            bankAccounts: parseBankAccounts(),
            supportWhatsapp: process.env.SUPPORT_WHATSAPP || '+505 7664-4030',
        });
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener estado de suscripción' });
    }
});

// ==========================================
// 🏦 PAGOS MANUALES (DEPÓSITO / TRANSFERENCIA)
// ==========================================

// Validación del pago manual reportado por el cliente (Capa 5): monto positivo y
// finito, banco y referencia no vacíos, moneda de un catálogo cerrado. Definido
// inline en este archivo para no colisionar con edición paralela de schemas.ts.
const ReportManualPaymentSchema = z.object({
    amount: z.coerce.number().finite().positive('El monto debe ser mayor a cero'),
    currency: z.enum(['USD', 'NIO']).optional(),
    bank: z.string().trim().min(1, 'El banco es requerido'),
    referenceNumber: z.string().trim().min(1, 'El número de referencia es requerido'),
    proofUrl: z.string().trim().optional(),
    notes: z.string().trim().optional(),
});

// POST /api/billing/report-manual - Cliente reporta pago manual
app.post('/api/billing/report-manual', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;

    // Capa 5: validar el cuerpo con Zod antes de tocar la BD (rechaza montos
    // negativos, NaN, strings no numéricos y campos vacíos).
    const parsed = ReportManualPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Datos de pago inválidos.' });
    }
    const { amount, currency, bank, referenceNumber, proofUrl, notes } = parsed.data;
    // Capa 4: el monto se persiste como Decimal con escala 2, nunca como Number.
    const monto = new Decimal(String(amount)).toDecimalPlaces(2);

    try {
        // Verificar que no tenga un pago pendiente
        const pending = await prisma.manualPayment.findFirst({
            where: { tenantId: authReq.tenantId, status: 'PENDING' }
        });
        if (pending) {
            return res.status(400).json({ error: 'Ya tienes un pago pendiente de revisión. Espera la confirmación.' });
        }

        const payment = await prisma.manualPayment.create({
            data: {
                tenantId: authReq.tenantId!,
                amount: monto,
                currency: currency || 'USD',
                bank,
                referenceNumber: String(referenceNumber),
                proofUrl: proofUrl || null,
                notes: notes || null,
            }
        });

        // Aviso al operador: el rail de cobro es manual, así que sin esto el
        // cliente transfiere y su suscripción espera a que alguien entre al panel
        // por casualidad. Fire-and-forget — nunca hace fallar el reporte del pago.
        const tenantDelPago = await prisma.tenant.findUnique({
            where: { id: authReq.tenantId! },
            select: { businessName: true },
        });
        void sendManualPaymentAlert({
            businessName: tenantDelPago?.businessName ?? authReq.tenantId!,
            amount: monto.toFixed(2),
            currency: currency || 'USD',
            bank,
            referenceNumber: String(referenceNumber),
            hasProof: Boolean(proofUrl),
        }).catch((e) => console.error('Aviso de pago manual falló:', e));

        res.json({ message: 'Pago reportado exitosamente. Será revisado en las próximas horas.', payment });
    } catch (error) {
        console.error('Manual payment error:', error);
        res.status(500).json({ error: 'Error al reportar pago' });
    }
});

// GET /api/billing/manual-status - Estado del pago manual del tenant actual
app.get('/api/billing/manual-status', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const payments = await prisma.manualPayment.findMany({
            where: { tenantId: authReq.tenantId },
            orderBy: { createdAt: 'desc' },
            take: 5,
        });
        res.json(payments);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener pagos manuales' });
    }
});

// GET /api/admin/manual-payments - Lista pagos manuales (SUPER_ADMIN)
app.get('/api/admin/manual-payments', authenticate, requireSuperAdmin, async (_req: express.Request, res: express.Response) => {
    try {
        const payments = await prisma.manualPayment.findMany({
            include: {
                tenant: {
                    select: {
                        businessName: true,
                        subscriptionStatus: true,
                        users: { select: { email: true, name: true }, take: 1, orderBy: { createdAt: 'asc' } },
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
        res.json(payments);
    } catch (error) {
        console.error('Admin manual payments error:', error);
        res.status(500).json({ error: 'Error al obtener pagos manuales' });
    }
});

// POST /api/admin/manual-payments/:id/approve - Aprobar pago manual
app.post('/api/admin/manual-payments/:id/approve', authenticate, requireSuperAdmin, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const payment = await prisma.manualPayment.findUnique({ where: { id: req.params.id } });
        if (!payment) return res.status(404).json({ error: 'Pago no encontrado' });
        if (payment.status !== 'PENDING') return res.status(400).json({ error: 'Este pago ya fue procesado' });

        const tenant = await prisma.tenant.findUnique({
            where: { id: payment.tenantId },
            select: { subscriptionEndsAt: true },
        });

        // El monto no se miraba: aprobar daba 30 días con cualquier cifra, así que
        // un pago reportado de $1 activaba el mes completo. No se bloquea de plano
        // —hay pagos en córdobas, parciales y acuerdos puntuales—, pero un pago en
        // dólares por debajo del precio del plan exige que el admin lo confirme.
        const montoPagado = new Decimal(payment.amount.toString());
        const esPagoCorto = requiereConfirmacionDePagoCorto(montoPagado, payment.currency);
        if (esPagoCorto && req.body?.confirmUnderpaid !== true) {
            return res.status(409).json({
                error: `El pago es de $${montoPagado.toFixed(2)} y el plan cuesta $${PLAN_PRICE_USD}. `
                     + 'Confirmá que lo querés aprobar igual.',
                needsConfirmation: true,
                amountPaid: montoPagado.toNumber(),
                expected: PLAN_PRICE_USD,
            });
        }

        // Se extiende desde el vencimiento vigente, no desde hoy: quien renovaba
        // antes de tiempo perdía los días que le quedaban.
        const endsAt = calcularNuevoVencimiento(tenant?.subscriptionEndsAt, new Date());

        await prisma.$transaction(async (tx: any) => {
            // Concurrencia (TOCTOU): el chequeo status==='PENDING' de arriba está FUERA
            // de la transacción, así que dos aprobaciones simultáneas del mismo pago
            // pasarían ambas. Aquí aprobamos con un updateMany condicional que toma el
            // row-lock; si count===0 otra request ya lo aprobó (doble clic) y abortamos
            // para no duplicar el AuditLog ni reactivar la suscripción dos veces.
            const approved = await tx.manualPayment.updateMany({
                where: { id: req.params.id, status: 'PENDING' },
                data: { status: 'APPROVED', reviewedBy: authReq.userId, reviewedAt: new Date() },
            });
            if (approved.count === 0) throw new Error('PAYMENT_NOT_PENDING');

            // Activar tenant
            await tx.tenant.update({
                where: { id: payment.tenantId },
                data: { subscriptionStatus: 'ACTIVE', subscriptionEndsAt: endsAt }
            });

            // Audit log
            await tx.auditLog.create({
                data: {
                    tenantId: payment.tenantId,
                    userId: authReq.userId!,
                    action: 'MANUAL_PAYMENT_APPROVED',
                    // Deja rastro de lo que se cobró CONTRA lo esperado y hasta cuándo
                    // se extendió: sin eso, un pago corto aprobado es indistinguible
                    // de uno completo al revisar el log meses después.
                    details: `Pago manual de ${payment.currency === 'USD' ? '$' : 'C$'}${montoPagado.toFixed(2)} `
                           + `${payment.currency} aprobado (plan $${PLAN_PRICE_USD}`
                           + `${esPagoCorto ? ' — APROBADO CORTO por decisión del admin' : ''}). `
                           + `Ref: ${payment.referenceNumber}. Vence ${endsAt.toISOString().slice(0, 10)}. `
                           + `Comprobante: ${payment.proofUrl ? 'sí' : 'NO ADJUNTO'}`
                }
            });
        });

        // Invalidar caché del tenant
        invalidateTenantCache(payment.tenantId);

        res.json({ message: `Pago aprobado. Suscripción activada hasta ${endsAt.toLocaleDateString()}.` });
    } catch (error) {
        if (error instanceof Error && error.message === 'PAYMENT_NOT_PENDING') {
            return res.status(409).json({ error: 'Este pago ya fue procesado por otra sesión.' });
        }
        console.error('Approve manual payment error:', error);
        res.status(500).json({ error: 'Error al aprobar pago' });
    }
});

// ==========================================
// 📜 COTIZACIONES (QUOTATIONS)
// ==========================================

// GET /api/quotations - Historial
app.get('/api/quotations', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const quotes = await prisma.quotation.findMany({
            where: { tenantId: authReq.tenantId },
            orderBy: { createdAt: 'desc' },
            take: 50
        });
        // Frontend expects numbers, Prisma returns Decimal
        const safeQuotes = quotes.map((q: any) => ({
            ...q,
            subtotal: Number(q.subtotal),
            tax: Number(q.tax),
            total: Number(q.total)
        }));
        res.json(safeQuotes);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener cotizaciones' });
    }
});

// POST /api/quotations - Crear
app.post('/api/quotations', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { customerName, customerRuc, items, expiresAt } = req.body;

    if (!items || items.length === 0) return res.status(400).json({ error: 'Faltan items' });

    try {
        // Totales server-side (nunca confiar en los del cliente), con decimal.js.
        // T1: `item.price` es precio de GÓNDOLA — YA trae el IVA incluido, igual
        // que en la venta (`recordSale` hace neto = total / 1.15). Antes se le
        // sumaba 15% ENCIMA (`tax = subtotal * 0.15; total = subtotal + tax`), así
        // que la cotización cobraba el IVA dos veces y NUNCA cuadraba con lo que
        // el POS le cobra al cliente: un producto de C$115 se vendía a C$115 pero
        // se cotizaba a C$132.25. Ahora se DESGLOSA desde el precio inclusivo.
        let totalD = new Decimal(0);
        const formattedItems = items.map((item: any) => {
            totalD = totalD.plus(new Decimal(item.price).mul(item.quantity));
            return {
                productId: item.id || item.productId,
                name: item.name,
                price: item.price,
                quantity: item.quantity
            };
        });

        const { neto, iva } = desglosarIvaIncluido(totalD);
        const subtotal = neto.toNumber();
        const tax = iva.toNumber();
        const total = neto.plus(iva).toNumber();   // === totalD: lo que paga el cliente

        const quote = await prisma.quotation.create({
            data: {
                tenantId: authReq.tenantId!,
                customerName,
                customerRuc,
                subtotal,
                tax,
                total,
                expiresAt: new Date(expiresAt),
                items: {
                    create: formattedItems
                }
            }
        });

        res.json({ ...quote, subtotal, tax, total });
    } catch (error) {
        console.error('Create quotation error:', error);
        res.status(500).json({ error: 'Error al crear cotización' });
    }
});

// ==========================================
// 💰 COBRANZA & CRÉDITOS (RECEIVABLES)
// ==========================================

// GET /api/credits/debtors - Clientes con deuda pendiente
app.get('/api/credits/debtors', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        // Buscar ventas a CRÉDITO con saldo pendiente > 0
        const sales = await prisma.sale.findMany({
            where: {
                tenantId: authReq.tenantId,
                paymentMethod: 'CREDIT',
                balance: { gt: 0 }
            },
            include: {
                payments: { orderBy: { createdAt: 'desc' } },
                customer: { select: { name: true, phone: true } }
            },
            orderBy: { dueDate: 'asc' }
        });

        const formatted = sales.map((s: any) => ({
            id: s.id,
            customerName: s.customer?.name || s.customerName || 'Cliente General',
            date: s.createdAt,
            dueDate: s.dueDate,
            total: Number(s.total),
            balance: Number(s.balance),
            status: Number(s.balance) > 0 ? 'CREDIT_PENDING' : 'PAID',
            payments: s.payments.map((p: any) => ({
                id: p.id,
                amount: Number(p.amount),
                date: p.createdAt,
                method: p.method
            }))
        }));

        res.json(formatted);
    } catch (error) {
        console.error('Error fetching debtors:', error);
        res.status(500).json({ error: 'Error al obtener deudores' });
    }
});

// GET /api/collections/worklist - "Cobrar hoy" (Cobranza A1): deudas a crédito por
// urgencia (vencidas primero) + KPIs de cobranza. dueSoonDays = ventana "por vencer".
app.get('/api/collections/worklist', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const tenantId = authReq.tenantId!;
    const dueSoonDays = Math.min(60, Math.max(1, parseInt(req.query.dueSoonDays) || 7));
    try {
        const now = new Date();
        const hoy = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const MS_DAY = 86400000;
        // Días vencidos desde la referencia (vence ?? emisión); >0 vencido, <0 por vencer.
        const diasVencido = (ref: Date) => {
            const r = new Date(ref);
            const refMid = new Date(r.getFullYear(), r.getMonth(), r.getDate()).getTime();
            return Math.floor((hoy.getTime() - refMid) / MS_DAY);
        };
        const bucketDe = (d: number) => d <= 0 ? 'corriente' : d <= 30 ? 'b1_30' : d <= 60 ? 'b31_60' : d <= 90 ? 'b61_90' : 'b90';

        const sales = await prisma.sale.findMany({
            where: { tenantId, paymentMethod: 'CREDIT', balance: { gt: 0 } },
            include: { customer: { select: { id: true, name: true, phone: true } } },
        });

        let totalReceivable = new Decimal(0);
        let totalOverdue = new Decimal(0);
        let dueSoonAmount = new Decimal(0);
        let overdueCount = 0, dueSoonCount = 0;

        const items = sales.map((s: any) => {
            const ref = s.dueDate ?? s.createdAt;
            const dias = diasVencido(ref);
            const balance = new Decimal(s.balance.toString());
            totalReceivable = totalReceivable.plus(balance);
            const overdue = dias > 0;
            const dueSoon = !overdue && dias >= -dueSoonDays; // vence hoy o dentro de la ventana
            if (overdue) { totalOverdue = totalOverdue.plus(balance); overdueCount++; }
            else if (dueSoon) { dueSoonAmount = dueSoonAmount.plus(balance); dueSoonCount++; }
            return {
                saleId: s.id,
                customerId: s.customer?.id ?? null,
                customerName: s.customer?.name ?? s.customerName ?? 'Cliente General',
                phone: s.customer?.phone ?? null,
                invoiceNumber: s.invoiceNumber != null ? String(s.invoiceNumber) : null,
                date: s.createdAt,
                dueDate: s.dueDate,
                total: Number(s.total),
                balance: balance.toDecimalPlaces(2).toNumber(),
                daysOverdue: dias,
                bucket: bucketDe(dias),
                status: overdue ? 'OVERDUE' : dueSoon ? 'DUE_SOON' : 'CURRENT',
            };
        });
        // Más vencido primero; luego por vencer (más cerca de hoy), luego corriente.
        items.sort((a, b) => b.daysOverdue - a.daysOverdue);

        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const collectedToday = await prisma.payment.aggregate({
            where: { sale: { tenantId }, createdAt: { gte: startOfDay } },
            _sum: { amount: true },
        });

        res.json({
            summary: {
                totalReceivable: totalReceivable.toDecimalPlaces(2).toNumber(),
                totalOverdue: totalOverdue.toDecimalPlaces(2).toNumber(),
                overdueCount,
                dueSoon: dueSoonAmount.toDecimalPlaces(2).toNumber(),
                dueSoonCount,
                collectedToday: Number(collectedToday._sum.amount || 0),
                dueSoonDays,
            },
            items,
        });
    } catch (error) {
        console.error('Error fetching worklist:', error);
        res.status(500).json({ error: 'Error obteniendo la lista de cobro' });
    }
});

// GET /api/customers/:id/statement - Estado de cuenta del cliente (Cobranza A2):
// facturas a crédito con saldo/abonos + aging + totales. Para imprimir/enviar.
app.get('/api/customers/:id/statement', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const tenantId = authReq.tenantId!;
    const { id } = req.params;
    try {
        const customer = await prisma.customer.findFirst({ where: { id, tenantId } });
        if (!customer) return res.status(404).json({ error: 'Cliente no encontrado' });

        const sales = await prisma.sale.findMany({
            where: { tenantId, customerId: id, paymentMethod: 'CREDIT' },
            include: { payments: { orderBy: { createdAt: 'asc' }, include: { user: { select: { name: true } } } } },
            orderBy: { createdAt: 'desc' },
        });

        const now = new Date();
        const hoy = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const MS_DAY = 86400000;
        const diasVencido = (ref: Date) => {
            const r = new Date(ref);
            const refMid = new Date(r.getFullYear(), r.getMonth(), r.getDate()).getTime();
            return Math.floor((hoy.getTime() - refMid) / MS_DAY);
        };

        let totalBilled = new Decimal(0), totalPaid = new Decimal(0), totalBalance = new Decimal(0), totalOverdue = new Decimal(0);
        const invoices = sales.map((s: any) => {
            const total = new Decimal(s.total.toString());
            const balance = new Decimal(s.balance.toString());
            const paid = total.minus(balance);
            const dias = diasVencido(s.dueDate ?? s.createdAt);
            const open = balance.greaterThan(0);
            const overdue = open && dias > 0;
            totalBilled = totalBilled.plus(total);
            totalPaid = totalPaid.plus(paid);
            totalBalance = totalBalance.plus(balance);
            if (overdue) totalOverdue = totalOverdue.plus(balance);
            return {
                id: s.id,
                invoiceNumber: s.invoiceNumber != null ? String(s.invoiceNumber) : null,
                date: s.createdAt,
                dueDate: s.dueDate,
                total: total.toDecimalPlaces(2).toNumber(),
                paid: paid.toDecimalPlaces(2).toNumber(),
                balance: balance.toDecimalPlaces(2).toNumber(),
                daysOverdue: dias,
                status: s.status === 'UNCOLLECTIBLE' ? 'WRITTEN_OFF' : !open ? 'PAID' : overdue ? 'OVERDUE' : 'PENDING',
                payments: s.payments.map((p: any) => ({
                    id: p.id, amount: Number(p.amount), method: p.method, date: p.createdAt, collectedBy: p.user?.name || null,
                })),
            };
        });

        res.json({
            customer: {
                id: customer.id, name: customer.name, phone: customer.phone,
                creditLimit: Number(customer.creditLimit), currentDebt: Number(customer.currentDebt), isBlocked: customer.isBlocked,
            },
            invoices,
            totals: {
                billed: totalBilled.toDecimalPlaces(2).toNumber(),
                paid: totalPaid.toDecimalPlaces(2).toNumber(),
                balance: totalBalance.toDecimalPlaces(2).toNumber(),
                overdue: totalOverdue.toDecimalPlaces(2).toNumber(),
            },
            generatedAt: now,
        });
    } catch (error) {
        console.error('Error fetching statement:', error);
        res.status(500).json({ error: 'Error obteniendo el estado de cuenta' });
    }
});

// POST /api/credits/payment - Registrar abono
app.post('/api/credits/payment', authenticate, validate(CreatePaymentSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { saleId, amount, method } = req.body;

    if (!saleId || !amount) return res.status(400).json({ error: 'Faltan datos' });
    if (isNaN(Number(amount)) || Number(amount) <= 0) return res.status(400).json({ error: 'Monto de abono inválido' });

    try {
        await prisma.$transaction(async (tx: any) => {
            // Aislamiento multi-tenant: la venta debe pertenecer a este negocio.
            const sale = await tx.sale.findFirst({ where: { id: saleId, tenantId: authReq.tenantId } });
            if (!sale) throw new Error('Venta no encontrada');

            // Capa 4: dinero con decimal.js (nada de Number). Saldo previo y monto del
            // abono a escala 2; el saldo nuevo es una resta exacta.
            const saldoPrevio = new Decimal(sale.balance.toString());
            const monto = new Decimal(String(amount)).toDecimalPlaces(2);
            const newBalance = saldoPrevio.minus(monto).toDecimalPlaces(2);
            // Tolerancia de 1 centavo por redondeo, igual que el hermano /api/payments.
            if (newBalance.lessThan(new Decimal('-0.01'))) throw new Error('El abono excede el saldo pendiente');

            // 1. Crear Pago (monto persistido como Decimal, sin float).
            await tx.payment.create({
                data: {
                    saleId,
                    amount: monto,
                    method: method || 'CASH',
                    collectedBy: authReq.userId!
                }
            });

            // 2. Actualizar Venta con decremento condicionado (anti lost-update): el
            // where exige que el saldo siga siendo EXACTAMENTE el que leímos, tomando el
            // row-lock; si count===0 otra transacción concurrente (doble clic/reintento)
            // ya movió el saldo y abortamos para no aplicar dos veces el mismo abono.
            const completada = newBalance.lessThanOrEqualTo(new Decimal('0.01'));
            const applied = await tx.sale.updateMany({
                where: { id: saleId, tenantId: authReq.tenantId, balance: sale.balance },
                data: {
                    balance: { decrement: monto },
                    status: completada ? 'COMPLETED' : 'PENDING' // Update status if fully paid
                },
            });
            if (applied.count === 0) throw new Error('El saldo de la venta cambió; reintente el abono');

            // 3. Bajar la deuda del cliente (Capa correctitud): sin esto currentDebt
            // queda inflado y bloquea ventas a crédito legítimas. Clamp a 0 como el
            // castigo de incobrables (writeoff), con decimal.js.
            if (sale.customerId) {
                const cust = await tx.customer.findUnique({ where: { id: sale.customerId }, select: { currentDebt: true } });
                const newDebt = Decimal.max(new Decimal(0), new Decimal((cust?.currentDebt ?? 0).toString()).minus(monto)).toDecimalPlaces(2);
                await tx.customer.update({ where: { id: sale.customerId }, data: { currentDebt: newDebt } });
            }

            // Releer la venta ya actualizada para armar la respuesta.
            const updatedSale = await tx.sale.findUnique({
                where: { id: saleId },
                include: {
                    payments: { orderBy: { createdAt: 'desc' } },
                    customer: { select: { name: true } }
                }
            });

            await tx.auditLog.create({
                data: {
                    tenantId: authReq.tenantId!,
                    userId: authReq.userId!,
                    action: 'CREDIT_PAYMENT',
                    details: JSON.stringify({
                        saleId,
                        customerId: sale.customerId,
                        amount: monto.toString(),
                        balanceBefore: saldoPrevio.toString(),
                        balanceAfter: newBalance.toString(),
                        method: method ?? 'CASH',
                    }),
                },
            });

            // Format response
            const formatted = {
                id: updatedSale.id,
                customerName: updatedSale.customer?.name || updatedSale.customerName,
                date: updatedSale.createdAt,
                dueDate: updatedSale.dueDate,
                total: Number(updatedSale.total),
                balance: Number(updatedSale.balance),
                status: Number(updatedSale.balance) > 0 ? 'CREDIT_PENDING' : 'PAID',
                payments: updatedSale.payments.map((p: any) => ({
                    id: p.id,
                    amount: Number(p.amount),
                    date: p.createdAt,
                    method: p.method
                }))
            };

            res.json(formatted);
        });
    } catch (error: any) {
        console.error('Register payment error:', error);
        res.status(400).json({ error: error.message || 'Error al registrar pago' });
    }
});

// POST /api/credits/:saleId/writeoff - Castigar una venta a crédito como incobrable
// (Cobranza B1). Postea el asiento Debe 5.2.7 / Haber 1.1.3, salda la venta y baja
// la deuda del cliente. Solo OWNER/ADMIN; respeta el lock de período.
app.post('/api/credits/:saleId/writeoff', authenticate, checkRole(['OWNER', 'ADMIN']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { saleId } = req.params;
    const reason = (req.body?.reason || '').toString().trim();
    if (reason.length < 3) {
        return res.status(400).json({ error: 'La justificación es obligatoria (mínimo 3 caracteres).' });
    }
    try {
        await seedChartOfAccounts(authReq.tenantId!); // garantiza 5.2.7

        const result = await prisma.$transaction(async (tx: any) => {
            const sale = await tx.sale.findFirst({ where: { id: saleId, tenantId: authReq.tenantId! } });
            if (!sale) throw new Error('Venta no encontrada');
            if (sale.paymentMethod !== 'CREDIT') throw new Error('Solo se castigan ventas a crédito.');
            const balance = new Decimal(sale.balance.toString());
            if (balance.lessThanOrEqualTo(0)) throw new Error('Esta venta no tiene saldo pendiente.');

            // Asiento de incobrable (assertPeriodOpen vive dentro de createJournalEntry).
            await recordBadDebt(tx, authReq.tenantId!, authReq.userId!, saleId, balance.toNumber());

            // Saldar la venta y marcarla como incobrable.
            await tx.sale.update({ where: { id: saleId }, data: { balance: 0, status: 'UNCOLLECTIBLE' } });

            // Bajar la deuda del cliente (clamp a 0 por si el contador venía desfasado).
            if (sale.customerId) {
                const cust = await tx.customer.findUnique({ where: { id: sale.customerId }, select: { currentDebt: true } });
                const newDebt = Math.max(0, Number(cust?.currentDebt || 0) - balance.toNumber());
                await tx.customer.update({ where: { id: sale.customerId }, data: { currentDebt: newDebt } });
            }

            await tx.auditLog.create({
                data: {
                    tenantId: authReq.tenantId!,
                    userId: authReq.userId!,
                    action: 'BAD_DEBT_WRITEOFF',
                    details: JSON.stringify({ saleId, customerId: sale.customerId, amount: balance.toDecimalPlaces(2).toNumber(), reason, timestamp: new Date().toISOString() }),
                },
            });

            return { amount: balance.toDecimalPlaces(2).toNumber() };
        });

        res.json({ message: `Venta castigada como incobrable. Pérdida reconocida: C$ ${result.amount.toFixed(2)}`, ...result });
    } catch (error: any) {
        console.error('Error castigando incobrable:', error);
        const msg = error?.message || 'Error castigando la venta';
        const code = error instanceof PeriodLockedError ? 423
            : (msg.includes('no encontrada') || msg.includes('crédito') || msg.includes('saldo')) ? 400 : 500;
        res.status(code).json({ error: msg });
    }
});

app.post('/api/admin/manual-payments/:id/reject', authenticate, requireSuperAdmin, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { reason } = req.body;

    try {
        const payment = await prisma.manualPayment.findUnique({ where: { id: req.params.id } });
        if (!payment) return res.status(404).json({ error: 'Pago no encontrado' });
        if (payment.status !== 'PENDING') return res.status(400).json({ error: 'Este pago ya fue procesado' });

        await prisma.manualPayment.update({
            where: { id: req.params.id },
            data: {
                status: 'REJECTED',
                rejectionReason: reason || 'Comprobante inválido o no verificable.',
                reviewedBy: authReq.userId,
                reviewedAt: new Date(),
            }
        });

        res.json({ message: 'Pago rechazado.' });
    } catch (error) {
        res.status(500).json({ error: 'Error al rechazar pago' });
    }
});

// ==========================================
// 🧾 FACTURACIÓN COMPUTARIZADA DGI
// ==========================================

import { generateDMIReport } from './services/nicaTax';

// Generar Reporte DMI-V2.1 para la DGI
app.get('/api/tax-report/dmi', authenticate, checkRole(FISCAL_REPORT_ROLES), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const period = parseFiscalPeriod(req.query.month, req.query.year);
    if (!period) return res.status(400).json({ error: 'Mes o año inválido.' });
    const { month, year } = period;

    try {
        const report = await generateDMIReport(authReq.tenantId!, month, year);
        res.json(report);
    } catch (error: any) {
        res.status(500).json({ error: 'Error al generar reporte DMI', details: error.message });
    }
});

// Configurar datos fiscales del Tenant
app.put('/api/tenant/fiscal', authenticate, checkRole(['ADMIN', 'OWNER']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { taxId, address, phone, dgiAuthCode } = req.body;

    try {
        const tenant = await prisma.tenant.update({
            where: { id: authReq.tenantId! },
            data: {
                taxId: taxId || undefined,
                address: address !== undefined ? address : undefined,
                phone: phone !== undefined ? phone : undefined,
                dgiAuthCode: dgiAuthCode !== undefined ? dgiAuthCode : undefined,
            }
        });
        res.json(tenant);
    } catch (error: any) {
        res.status(500).json({ error: 'Error al actualizar configuración fiscal', details: error.message });
    }
});

// GET /api/tenant/inventory-settings — política de inventario del tenant.
// Sin `checkRole`: el CAJERO es quien necesita el dato. El POS avisa en el
// carrito cuando una línea excede la existencia, y la consecuencia real depende
// de esta política (con la política apagada el backend RECHAZA la venta; con
// ella encendida la venta pasa y el stock queda en negativo). Sin este GET el
// POS tendría que adivinar la consecuencia, que es exactamente lo que no se
// puede hacer con un cliente enfrente. Solo lectura, tenant del JWT.
app.get('/api/tenant/inventory-settings', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const tenant = await prisma.tenant.findUnique({
            where: { id: authReq.tenantId! },
            select: { allowNegativeStock: true },
        });
        if (!tenant) return res.status(404).json({ error: 'Negocio no encontrado' });
        res.json({ allowNegativeStock: tenant.allowNegativeStock });
    } catch (error: any) {
        console.error('Error al leer configuración de inventario:', error);
        res.status(500).json({ error: 'Error al leer configuración de inventario' });
    }
});

// PUT /api/tenant/inventory-settings — política de inventario (0a: stock negativo)
app.put('/api/tenant/inventory-settings', authenticate, checkRole(['ADMIN', 'OWNER']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { allowNegativeStock } = req.body;
    if (typeof allowNegativeStock !== 'boolean') {
        return res.status(400).json({ error: 'allowNegativeStock debe ser booleano (true/false)' });
    }
    try {
        const tenant = await prisma.tenant.update({
            where: { id: authReq.tenantId! },
            data: { allowNegativeStock },
            select: { id: true, allowNegativeStock: true },
        });
        await prisma.auditLog.create({
            data: {
                tenantId: authReq.tenantId!,
                userId: authReq.userId!,
                action: 'INVENTORY_SETTINGS_UPDATED',
                details: JSON.stringify({ allowNegativeStock }),
            },
        });
        res.json({ success: true, data: tenant });
    } catch (error: any) {
        res.status(500).json({ error: 'Error al actualizar configuración de inventario', details: error.message });
    }
});

// ==========================================
// 📊 CONTABILIDAD - FINANCIAL STATEMENT ENDPOINTS
// ==========================================

// Seed chart of accounts on first access
app.post('/api/accounting/seed', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        await seedChartOfAccounts(authReq.tenantId!);
        res.json({ message: 'Chart of Accounts seeded successfully' });
    } catch (error) { res.status(500).json({ error: 'Error seeding accounts' }); }
});

// Balance General
app.get('/api/accounting/balance-general', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const balance = await getBalanceGeneral(authReq.tenantId!);
        res.json(balance);
    } catch (error) { res.status(500).json({ error: 'Error generating Balance General' }); }
});

// Estado de Resultados
app.get('/api/accounting/estado-resultados', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { month, year } = req.query;
    try {
        const estado = await getEstadoResultados(
            authReq.tenantId!,
            month ? parseInt(month) : undefined,
            year ? parseInt(year) : undefined
        );
        res.json(estado);
    } catch (error) { res.status(500).json({ error: 'Error generating Estado de Resultados' }); }
});

// Chart of Accounts (Catálogo de cuentas)
app.get('/api/accounting/chart', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        await seedChartOfAccounts(authReq.tenantId!);
        const accounts = await prisma.account.findMany({
            where: { tenantId: authReq.tenantId },
            orderBy: { code: 'asc' }
        });
        res.json(accounts);
    } catch (error) { res.status(500).json({ error: 'Error fetching accounts' }); }
});

// Libro Diario (Journal Entries)
app.get('/api/accounting/journal', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { month, year } = req.query;
    try {
        const where: any = { tenantId: authReq.tenantId };
        if (month && year) {
            const startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
            const endDate = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59);
            where.date = { gte: startDate, lte: endDate };
        }
        const entries = await prisma.journalEntry.findMany({
            where,
            include: { lines: { include: { account: { select: { code: true, name: true, type: true } } } } },
            orderBy: { date: 'desc' },
            take: 200
        });
        res.json(entries);
    } catch (error) { res.status(500).json({ error: 'Error fetching journal' }); }
});

// ══════════════════════════════════════════════════════════════════════════
// 📒 FASE A — CONTABILIDAD DEL CONTADOR (asiento manual, libros, períodos)
// ══════════════════════════════════════════════════════════════════════════

// POST /api/accounting/journal — Asiento de diario MANUAL (A1) / apertura (A2)
// Body: { date, description, type?: 'MANUAL'|'OPENING', lines: [{accountCode, debit, credit}] }
app.post('/api/accounting/journal', authenticate, checkRole(['OWNER', 'ADMIN', 'ACCOUNTANT']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const { date, description, type, lines } = req.body ?? {};
        if (!description || typeof description !== 'string' || !description.trim()) {
            return res.status(400).json({ error: 'La descripción del asiento es requerida.' });
        }
        if (!Array.isArray(lines) || lines.length < 2) {
            return res.status(400).json({ error: 'Un asiento requiere al menos 2 líneas (debe y haber).' });
        }
        const entryDate = date ? new Date(date) : new Date();
        if (isNaN(entryDate.getTime())) {
            return res.status(400).json({ error: 'Fecha inválida.' });
        }

        // Normalizar + validar líneas: cada línea tiene SOLO debe o SOLO haber > 0.
        const normLines = lines.map((l: any) => ({
            accountCode: String(l.accountCode ?? '').trim(),
            debit: new Decimal(Number(l.debit) || 0).toDecimalPlaces(2).toNumber(),
            credit: new Decimal(Number(l.credit) || 0).toDecimalPlaces(2).toNumber(),
        }));
        for (const l of normLines) {
            if (!l.accountCode) return res.status(400).json({ error: 'Cada línea debe indicar una cuenta.' });
            if (l.debit < 0 || l.credit < 0) return res.status(400).json({ error: 'Los montos no pueden ser negativos.' });
            if ((l.debit > 0) === (l.credit > 0)) {
                return res.status(400).json({ error: `La cuenta ${l.accountCode} debe llevar monto en debe O en haber, no ambos ni cero.` });
            }
        }

        // Las cuentas deben EXISTIR (evita que createJournalEntry descarte una
        // línea con código inválido y deje el asiento descuadrado).
        await seedChartOfAccounts(authReq.tenantId!);
        const codes = [...new Set(normLines.map((l: { accountCode: string }) => l.accountCode))];
        const found = await prisma.account.findMany({
            where: { tenantId: authReq.tenantId!, code: { in: codes } },
            select: { code: true },
        });
        const missing = codes.filter(c => !found.some(f => f.code === c));
        if (missing.length > 0) {
            return res.status(400).json({ error: `Cuentas inexistentes en tu catálogo: ${missing.join(', ')}` });
        }

        const refType = type === 'OPENING' ? 'OPENING' : 'MANUAL';
        await prisma.$transaction(async (tx: any) => {
            await createJournalEntry(
                tx, authReq.tenantId!, description.trim(), '', refType, authReq.userId!, normLines,
                { isAutomatic: false, date: entryDate }
            );
            await tx.auditLog.create({
                data: {
                    tenantId: authReq.tenantId!,
                    userId: authReq.userId!,
                    action: refType === 'OPENING' ? 'OPENING_BALANCE' : 'MANUAL_JOURNAL_ENTRY',
                    details: JSON.stringify({ date: entryDate.toISOString(), description: description.trim(), lines: normLines }),
                },
            });
        });

        res.status(201).json({ message: refType === 'OPENING' ? 'Saldos de apertura registrados.' : 'Asiento manual registrado.' });
    } catch (error: unknown) {
        if (error instanceof PeriodLockedError) return res.status(409).json({ error: error.message });
        const msg = error instanceof Error ? error.message : 'Error al registrar el asiento';
        if (msg.includes('DESCUADRADO')) return res.status(400).json({ error: msg });
        console.error('Manual journal error:', error);
        res.status(500).json({ error: msg });
    }
});

// GET /api/accounting/libro-diario/:year/:month — Libro Diario (A4)
app.get('/api/accounting/libro-diario/:year/:month', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month);
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
        return res.status(400).json({ error: 'Año o mes inválido.' });
    }
    try {
        const start = new Date(year, month - 1, 1);
        const end = new Date(year, month, 0, 23, 59, 59);
        const entries = await prisma.journalEntry.findMany({
            where: { tenantId: authReq.tenantId!, date: { gte: start, lte: end } },
            include: { lines: { include: { account: { select: { code: true, name: true } } } } },
            orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
        });
        const period = await prisma.fiscalPeriod.findUnique({
            where: { tenantId_year_month: { tenantId: authReq.tenantId!, year, month } },
        });
        let totalDebe = new Decimal(0);
        let totalHaber = new Decimal(0);
        const asientos = entries.map((e, i) => {
            const lineas = e.lines.map(l => ({
                cuenta: l.account.code, nombre: l.account.name,
                debe: Number(l.debit), haber: Number(l.credit),
            }));
            for (const l of lineas) { totalDebe = totalDebe.plus(l.debe); totalHaber = totalHaber.plus(l.haber); }
            return {
                numero: i + 1, id: e.id, fecha: e.date, descripcion: e.description,
                tipo: e.referenceType, esManual: !e.isAutomatic, lineas,
            };
        });
        res.json({
            period: `${year}-${String(month).padStart(2, '0')}`,
            locked: period?.status === 'CLOSED',
            totalDebe: totalDebe.toNumber(), totalHaber: totalHaber.toNumber(),
            asientos,
        });
    } catch (error) {
        console.error('Libro diario error:', error);
        res.status(500).json({ error: 'Error al generar el libro diario.' });
    }
});

// GET /api/accounting/libro-mayor/:year/:month?accountCode= — Mayor / Balanza (A4)
// Sin accountCode → balanza de comprobación (saldo inicial + debe + haber + final
// por cuenta). Con accountCode → detalle de movimientos de esa cuenta.
app.get('/api/accounting/libro-mayor/:year/:month', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const tenantId = authReq.tenantId!;
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month);
    const accountCode = typeof req.query.accountCode === 'string' ? req.query.accountCode : null;
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
        return res.status(400).json({ error: 'Año o mes inválido.' });
    }
    try {
        const start = new Date(year, month - 1, 1);
        const end = new Date(year, month, 0, 23, 59, 59);
        const accounts = await prisma.account.findMany({
            where: { tenantId }, select: { id: true, code: true, name: true, type: true },
        });
        const byId = new Map(accounts.map(a => [a.id, a]));
        const normalDebit = (type: string) => type === 'ASSET' || type === 'EXPENSE';

        if (accountCode) {
            const acc = accounts.find(a => a.code === accountCode);
            if (!acc) return res.status(404).json({ error: 'Cuenta no encontrada.' });
            // Saldo inicial: líneas de esta cuenta antes del período.
            const prev = await prisma.journalLine.aggregate({
                where: { accountId: acc.id, entry: { tenantId, date: { lt: start } } },
                _sum: { debit: true, credit: true },
            });
            const prevDebe = new Decimal(prev._sum.debit?.toString() ?? '0');
            const prevHaber = new Decimal(prev._sum.credit?.toString() ?? '0');
            let saldo = normalDebit(acc.type) ? prevDebe.minus(prevHaber) : prevHaber.minus(prevDebe);
            const saldoInicial = saldo.toNumber();

            const lines = await prisma.journalLine.findMany({
                where: { accountId: acc.id, entry: { tenantId, date: { gte: start, lte: end } } },
                include: { entry: { select: { date: true, description: true } } },
                orderBy: { entry: { date: 'asc' } },
            });
            const movimientos = lines.map(l => {
                const debe = Number(l.debit), haber = Number(l.credit);
                saldo = normalDebit(acc.type) ? saldo.plus(debe).minus(haber) : saldo.plus(haber).minus(debe);
                return { fecha: l.entry.date, descripcion: l.entry.description, debe, haber, saldo: saldo.toNumber() };
            });
            return res.json({ cuenta: acc.code, nombre: acc.name, saldoInicial, movimientos, saldoFinal: saldo.toNumber() });
        }

        // Balanza de comprobación: agregados por cuenta.
        const [prevAgg, periodAgg] = await Promise.all([
            prisma.journalLine.groupBy({ by: ['accountId'], where: { entry: { tenantId, date: { lt: start } } }, _sum: { debit: true, credit: true } }),
            prisma.journalLine.groupBy({ by: ['accountId'], where: { entry: { tenantId, date: { gte: start, lte: end } } }, _sum: { debit: true, credit: true } }),
        ]);
        const prevMap = new Map(prevAgg.map(p => [p.accountId, p]));
        const periodMap = new Map(periodAgg.map(p => [p.accountId, p]));
        const ids = new Set([...prevMap.keys(), ...periodMap.keys()]);

        const balanza = [...ids].map(id => {
            const acc = byId.get(id)!;
            const pd = new Decimal(prevMap.get(id)?._sum.debit?.toString() ?? '0');
            const ph = new Decimal(prevMap.get(id)?._sum.credit?.toString() ?? '0');
            const debe = new Decimal(periodMap.get(id)?._sum.debit?.toString() ?? '0');
            const haber = new Decimal(periodMap.get(id)?._sum.credit?.toString() ?? '0');
            const saldoInicial = normalDebit(acc.type) ? pd.minus(ph) : ph.minus(pd);
            const movimiento = normalDebit(acc.type) ? debe.minus(haber) : haber.minus(debe);
            return {
                cuenta: acc.code, nombre: acc.name, tipo: acc.type,
                saldoInicial: saldoInicial.toNumber(),
                debe: debe.toNumber(), haber: haber.toNumber(),
                saldoFinal: saldoInicial.plus(movimiento).toNumber(),
            };
        }).sort((a, b) => a.cuenta.localeCompare(b.cuenta));

        const totDebe = balanza.reduce((s, b) => s.plus(b.debe), new Decimal(0)).toNumber();
        const totHaber = balanza.reduce((s, b) => s.plus(b.haber), new Decimal(0)).toNumber();
        res.json({ period: `${year}-${String(month).padStart(2, '0')}`, balanza, totales: { debe: totDebe, haber: totHaber } });
    } catch (error) {
        console.error('Libro mayor error:', error);
        res.status(500).json({ error: 'Error al generar el libro mayor.' });
    }
});

// GET /api/accounting/periods — estado de los períodos cerrados/reabiertos (A3)
app.get('/api/accounting/periods', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const periods = await prisma.fiscalPeriod.findMany({
            where: { tenantId: authReq.tenantId! },
            orderBy: [{ year: 'desc' }, { month: 'desc' }],
        });
        res.json({ periods });
    } catch (error) {
        res.status(500).json({ error: 'Error al listar los períodos.' });
    }
});

// POST /api/accounting/periods/:year/:month/reopen — Reabrir período (solo OWNER)
app.post('/api/accounting/periods/:year/:month/reopen', authenticate, checkRole(['OWNER']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month);
    const { reason } = req.body ?? {};
    if (isNaN(year) || isNaN(month)) return res.status(400).json({ error: 'Año o mes inválido.' });
    if (!reason || typeof reason !== 'string' || !reason.trim()) {
        return res.status(400).json({ error: 'Reabrir un período exige un motivo (queda auditado).' });
    }
    try {
        const period = await prisma.fiscalPeriod.findUnique({
            where: { tenantId_year_month: { tenantId: authReq.tenantId!, year, month } },
        });
        if (!period || period.status !== 'CLOSED') {
            return res.status(404).json({ error: 'El período no está cerrado.' });
        }
        await prisma.$transaction([
            prisma.fiscalPeriod.update({
                where: { id: period.id },
                data: { status: 'OPEN', reopenedBy: authReq.userId!, reopenedAt: new Date(), reopenReason: reason.trim() },
            }),
            prisma.auditLog.create({
                data: {
                    tenantId: authReq.tenantId!, userId: authReq.userId!, action: 'PERIOD_REOPENED',
                    details: JSON.stringify({ year, month, reason: reason.trim() }),
                },
            }),
        ]);
        res.json({ message: `Período ${year}-${String(month).padStart(2, '0')} reabierto.` });
    } catch (error) {
        console.error('Reopen period error:', error);
        res.status(500).json({ error: 'Error al reabrir el período.' });
    }
});

// ══════════════════════════════════════════════════════════════════════════
// 🧾 FASE B — Parametrización fiscal + tipo de cambio + retenciones sufridas
// ══════════════════════════════════════════════════════════════════════════

// B4 — GET/PUT configuración fiscal del tenant
app.get('/api/accounting/tax-config', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const cfg = await prisma.taxConfig.findUnique({ where: { tenantId: authReq.tenantId! } });
        res.json(cfg ?? { tenantId: authReq.tenantId, inssPatronalRate: 0.225, anticipoIrRate: 0.01, imiRate: 0.01, salarioMinimo: 0, isDefault: true });
    } catch { res.status(500).json({ error: 'Error al obtener la configuración fiscal.' }); }
});

app.put('/api/accounting/tax-config', authenticate, checkRole(['OWNER', 'ADMIN', 'ACCOUNTANT']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const { inssPatronalRate, anticipoIrRate, imiRate, salarioMinimo } = req.body ?? {};
        const rate = (v: unknown, name: string) => {
            const n = new Decimal(Number(v) || 0);
            if (n.lessThan(0) || n.greaterThan(1)) throw new Error(`${name} debe ser una fracción entre 0 y 1 (ej. 0.225 = 22.5%).`);
            return n.toDecimalPlaces(4).toNumber();
        };
        const data = {
            inssPatronalRate: rate(inssPatronalRate, 'INSS patronal'),
            anticipoIrRate: rate(anticipoIrRate, 'Anticipo IR'),
            imiRate: rate(imiRate, 'IMI'),
            salarioMinimo: new Decimal(Number(salarioMinimo) || 0).toDecimalPlaces(2).toNumber(),
        };
        const cfg = await prisma.taxConfig.upsert({
            where: { tenantId: authReq.tenantId! },
            create: { tenantId: authReq.tenantId!, ...data },
            update: data,
        });
        res.json({ message: 'Configuración fiscal actualizada.', config: cfg });
    } catch (error: unknown) {
        res.status(400).json({ error: error instanceof Error ? error.message : 'Error al guardar.' });
    }
});

// B6 — Tipo de cambio: último vigente, listado, y registrar
app.get('/api/accounting/exchange-rate/latest', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const today = new Date(); today.setHours(23, 59, 59, 999);
        const latest = await prisma.exchangeRate.findFirst({
            where: { tenantId: authReq.tenantId!, fecha: { lte: today } },
            orderBy: { fecha: 'desc' },
        });
        res.json(latest ? { rate: Number(latest.rate), fecha: latest.fecha, source: latest.source } : { rate: null });
    } catch { res.status(500).json({ error: 'Error al obtener el tipo de cambio.' }); }
});

app.get('/api/accounting/exchange-rate', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const rates = await prisma.exchangeRate.findMany({
            where: { tenantId: authReq.tenantId! }, orderBy: { fecha: 'desc' }, take: 60,
        });
        res.json({ rates: rates.map(r => ({ id: r.id, fecha: r.fecha, rate: Number(r.rate), source: r.source })) });
    } catch { res.status(500).json({ error: 'Error al listar tipos de cambio.' }); }
});

app.post('/api/accounting/exchange-rate', authenticate, checkRole(['OWNER', 'ADMIN', 'ACCOUNTANT']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const { fecha, rate } = req.body ?? {};
        const r = new Decimal(Number(rate) || 0);
        if (r.lessThanOrEqualTo(0) || r.greaterThan(10000)) return res.status(400).json({ error: 'Tipo de cambio inválido.' });
        const day = fecha ? new Date(fecha) : new Date();
        if (isNaN(day.getTime())) return res.status(400).json({ error: 'Fecha inválida.' });
        day.setHours(0, 0, 0, 0);
        const saved = await prisma.exchangeRate.upsert({
            where: { tenantId_fecha: { tenantId: authReq.tenantId!, fecha: day } },
            create: { tenantId: authReq.tenantId!, fecha: day, rate: r.toDecimalPlaces(4).toNumber(), source: 'MANUAL' },
            update: { rate: r.toDecimalPlaces(4).toNumber() },
        });
        res.status(201).json({ message: 'Tipo de cambio registrado.', rate: Number(saved.rate), fecha: saved.fecha });
    } catch (error) {
        console.error('Exchange rate error:', error);
        res.status(500).json({ error: 'Error al registrar el tipo de cambio.' });
    }
});

// B1 — Retenciones SUFRIDAS (crédito contra el anticipo IR / IMI)
app.post('/api/accounting/retenciones-sufridas', authenticate, checkRole(['OWNER', 'ADMIN', 'ACCOUNTANT']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const { fecha, clienteRetenedor, tipo, baseAmount, amount, numeroConstancia, saleId } = req.body ?? {};
        if (!clienteRetenedor || typeof clienteRetenedor !== 'string') return res.status(400).json({ error: 'El cliente retenedor es requerido.' });
        if (tipo !== 'IR_2' && tipo !== 'IMI_1') return res.status(400).json({ error: 'Tipo inválido (IR_2 | IMI_1).' });
        const amt = new Decimal(Number(amount) || 0).toDecimalPlaces(2);
        const base = new Decimal(Number(baseAmount) || 0).toDecimalPlaces(2);
        if (amt.lessThanOrEqualTo(0)) return res.status(400).json({ error: 'El monto retenido debe ser mayor a cero.' });
        const day = fecha ? new Date(fecha) : new Date();
        if (isNaN(day.getTime())) return res.status(400).json({ error: 'Fecha inválida.' });

        await prisma.$transaction(async (tx: any) => {
            await tx.retencionSufrida.create({
                data: {
                    tenantId: authReq.tenantId!, fecha: day, clienteRetenedor: clienteRetenedor.trim(),
                    tipo, baseAmount: base.toNumber(), amount: amt.toNumber(),
                    numeroConstancia: numeroConstancia ? String(numeroConstancia).trim() : null,
                    saleId: saleId ? String(saleId) : null, createdBy: authReq.userId!,
                },
            });
            // Asiento: el crédito fiscal (activo) sube; la CxC del cliente baja
            // (el cliente liquidó parte del saldo vía retención).
            await createJournalEntry(
                tx, authReq.tenantId!,
                `Retención ${tipo === 'IR_2' ? 'IR 2%' : 'IMI 1%'} sufrida — ${clienteRetenedor.trim()}`,
                '', 'RETENCION_SUFRIDA', authReq.userId!,
                [
                    { accountCode: '1.1.6', debit: amt.toNumber(), credit: 0 },
                    { accountCode: '1.1.3', debit: 0, credit: amt.toNumber() },
                ],
                { isAutomatic: true, date: day }
            );
        });
        res.status(201).json({ message: 'Retención sufrida registrada — se acreditará contra tu anticipo IR del mes.' });
    } catch (error: unknown) {
        if (error instanceof PeriodLockedError) return res.status(409).json({ error: error.message });
        console.error('Retención sufrida error:', error);
        res.status(500).json({ error: error instanceof Error ? error.message : 'Error al registrar la retención.' });
    }
});

app.get('/api/accounting/retenciones-sufridas', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const where: any = { tenantId: authReq.tenantId! };
        const { month, year } = req.query;
        if (month && year) {
            const s = new Date(parseInt(year), parseInt(month) - 1, 1);
            const e = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59);
            where.fecha = { gte: s, lte: e };
        }
        const items = await prisma.retencionSufrida.findMany({ where, orderBy: { fecha: 'desc' }, take: 200 });
        res.json({ retenciones: items.map(r => ({ ...r, baseAmount: Number(r.baseAmount), amount: Number(r.amount) })) });
    } catch { res.status(500).json({ error: 'Error al listar las retenciones.' }); }
});

// ── B2 — Activos fijos + depreciación ───────────────────────────────────────

// GET lista (con valor en libros)
app.get('/api/accounting/fixed-assets', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const assets = await prisma.fixedAsset.findMany({
            where: { tenantId: authReq.tenantId! }, orderBy: { createdAt: 'desc' },
        });
        res.json({
            assets: assets.map(a => {
                const costo = Number(a.costo);
                const acum = Number(a.depreciacionAcumulada);
                return {
                    id: a.id, nombre: a.nombre, categoria: a.categoria, costo,
                    fechaAdquisicion: a.fechaAdquisicion, vidaUtilMeses: a.vidaUtilMeses,
                    depreciacionAcumulada: acum, mesesDepreciados: a.mesesDepreciados,
                    valorEnLibros: Number((costo - acum).toFixed(2)), estado: a.estado,
                    ultimoPeriodoDep: a.ultimoPeriodoDep,
                };
            }),
        });
    } catch { res.status(500).json({ error: 'Error al listar activos.' }); }
});

// POST registrar activo
app.post('/api/accounting/fixed-assets', authenticate, checkRole(['OWNER', 'ADMIN', 'ACCOUNTANT']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const { nombre, categoria, costo, fechaAdquisicion, vidaUtilMeses } = req.body ?? {};
        if (!nombre || typeof nombre !== 'string') return res.status(400).json({ error: 'Nombre requerido.' });
        const cat = String(categoria || 'OTRO').toUpperCase();
        if (!(cat in VIDA_UTIL_DEFAULT)) return res.status(400).json({ error: 'Categoría inválida.' });
        const costoD = new Decimal(Number(costo) || 0);
        if (costoD.lessThanOrEqualTo(0)) return res.status(400).json({ error: 'El costo debe ser mayor a cero.' });
        const fecha = fechaAdquisicion ? new Date(fechaAdquisicion) : new Date();
        if (isNaN(fecha.getTime())) return res.status(400).json({ error: 'Fecha inválida.' });
        const vida = Number(vidaUtilMeses) > 0 ? Math.floor(Number(vidaUtilMeses)) : VIDA_UTIL_DEFAULT[cat];

        // E1: el alta ahora CAPITALIZA el activo (Debe 1.2.1) dentro de una
        // transacción. Antes solo se creaba la fila: 1.2.1 nunca se debitaba, así
        // que la depreciación (Haber 1.2.2) dejaba el PP&E NETO en NEGATIVO y la
        // baja (Haber 1.2.1 por el costo) inventaba una pérdida por un valor en
        // libros jamás registrado. `formaPago` es opcional: CASH (default) acredita
        // Caja; CREDIT acredita CxP Proveedores.
        const formaPago = String(req.body?.formaPago || 'CASH').toUpperCase() === 'CREDIT' ? 'CREDIT' : 'CASH';
        // A5: catálogo sembrado ANTES de la tx (ver nota en /api/purchases).
        const anchorAsset = await prisma.account.findUnique({
            where: { tenantId_code: { tenantId: authReq.tenantId!, code: '1.2.1' } },
            select: { id: true },
        });
        if (!anchorAsset) await seedChartOfAccounts(authReq.tenantId!);

        const asset = await prisma.$transaction(async (tx: any) => {
            const created = await tx.fixedAsset.create({
                data: {
                    tenantId: authReq.tenantId!, nombre: nombre.trim(), categoria: cat,
                    costo: costoD.toDecimalPlaces(2).toNumber(), fechaAdquisicion: fecha,
                    vidaUtilMeses: vida, createdBy: authReq.userId!,
                },
            });
            await recordFixedAssetAcquisition(
                tx as Parameters<typeof recordFixedAssetAcquisition>[0],
                authReq.tenantId!, authReq.userId!, created.id, created.nombre,
                costoD.toDecimalPlaces(2).toNumber(), formaPago,
                // El asiento va con la FECHA DE ADQUISICIÓN para que caiga en el
                // mismo período que su primera cuota de depreciación.
                fecha
            );
            return created;
        });
        res.status(201).json({ message: 'Activo registrado.', asset });
    } catch (error: any) {
        console.error('Create fixed asset error:', error);
        if (error instanceof PeriodLockedError) {
            return res.status(423).json({ error: error.message });
        }
        res.status(500).json({ error: 'Error al registrar el activo.' });
    }
});

// PATCH dar de baja
app.patch('/api/accounting/fixed-assets/:id/baja', authenticate, checkRole(['OWNER', 'ADMIN', 'ACCOUNTANT']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const asset = await prisma.fixedAsset.findFirst({ where: { id: req.params.id, tenantId: authReq.tenantId! } });
        if (!asset) return res.status(404).json({ error: 'Activo no encontrado.' });
        if (asset.estado === 'BAJA') return res.status(409).json({ error: 'El activo ya está dado de baja.' });

        // Valor en libros = costo − depreciación acumulada (todo con Decimal).
        const costo = new Decimal(asset.costo.toString());
        const depAcum = new Decimal(asset.depreciacionAcumulada.toString());
        const valorEnLibros = costo.minus(depAcum);

        await prisma.$transaction(async (tx) => {
            // Flip atómico: solo si sigue ACTIVO → evita doble baja/derecognición en carrera.
            const flip = await tx.fixedAsset.updateMany({
                where: { id: asset.id, tenantId: authReq.tenantId!, estado: 'ACTIVO' },
                data: { estado: 'BAJA' },
            });
            if (flip.count === 0) throw new Error('BAJA_CONFLICT'); // otra baja ganó la carrera → abortar tx

            // Asiento de derecognición: Debe 1.2.2 (dep. acum.) + Debe 5.2.1 (pérdida por
            // valor en libros) / Haber 1.2.1 (costo). Saca el activo del Balance General.
            await createJournalEntry(
                tx as Parameters<typeof createJournalEntry>[0],
                authReq.tenantId!,
                `Baja de activo fijo — ${asset.nombre}`,
                asset.id, 'FIXED_ASSET_DISPOSAL', authReq.userId!,
                [
                    { accountCode: '1.2.2', debit: depAcum.toNumber(), credit: 0 },
                    { accountCode: '5.2.1', debit: valorEnLibros.toNumber(), credit: 0 },
                    { accountCode: '1.2.1', debit: 0, credit: costo.toNumber() },
                ],
                { isAutomatic: false, date: new Date() }
            );

            await tx.auditLog.create({
                data: {
                    tenantId: authReq.tenantId!,
                    userId: authReq.userId!,
                    action: 'FIXED_ASSET_DISPOSAL',
                    details: JSON.stringify({
                        assetId: asset.id,
                        nombre: asset.nombre,
                        categoria: asset.categoria,
                        before: { estado: asset.estado },
                        after: { estado: 'BAJA' },
                        costo: costo.toNumber(),
                        depreciacionAcumulada: depAcum.toNumber(),
                        valorEnLibros: valorEnLibros.toNumber(),
                    }),
                },
            });
        });
        res.json({ message: 'Activo dado de baja.' });
    } catch (error) {
        if (error instanceof Error && error.message === 'BAJA_CONFLICT') {
            return res.status(409).json({ error: 'El activo ya está dado de baja.' });
        }
        if (error instanceof PeriodLockedError) {
            return res.status(409).json({ error: error.message });
        }
        console.error('Fixed asset disposal error:', error);
        res.status(500).json({ error: 'Error al dar de baja.' });
    }
});

// POST correr depreciación (manual; el cron hace lo mismo mensual)
app.post('/api/accounting/depreciacion/run', authenticate, checkRole(['OWNER', 'ADMIN', 'ACCOUNTANT']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const now = new Date();
        const year = Number(req.body?.year) || now.getFullYear();
        const month = Number(req.body?.month) || (now.getMonth() + 1);
        const result = await runDepreciationForTenant(authReq.tenantId!, year, month, authReq.userId!);
        res.json({ message: `Depreciación ${result.period}: ${result.depreciados} cuotas posteadas.`, ...result });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Error al correr la depreciación';
        res.status(500).json({ error: msg });
    }
});

// ── B3 — Declaración anual de IR ────────────────────────────────────────────
app.get('/api/fiscal/renta-anual/:year', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const year = parseInt(req.params.year);
    if (isNaN(year) || year < 2000 || year > 2100) return res.status(400).json({ error: 'Año inválido.' });
    try {
        const { generateAnnualIR } = await import('./services/nicaTax');
        const report = await generateAnnualIR(authReq.tenantId!, year);
        res.json(report);
    } catch (error) {
        console.error('Annual IR error:', error);
        res.status(500).json({ error: 'Error al generar la declaración anual.' });
    }
});

// ══════════════════════════════════════════════════════════════════════════
// FASE C — Panel del contador: checklist de obligaciones del mes
// ══════════════════════════════════════════════════════════════════════════
const OBLIGATION_KEYS = ['IVA', 'ANTICIPO_IR', 'IMI', 'INSS', 'INATEC', 'IR_LABORAL'];

app.get('/api/accounting/cierre-mensual/:year/:month', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const tenantId = authReq.tenantId!;
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month);
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
        return res.status(400).json({ error: 'Año o mes inválido.' });
    }
    try {
        const { generateMonthlyReport } = await import('./services/nicaTax');
        const vet = await generateMonthlyReport(tenantId, month, year);

        // INSS / INATEC / IR laboral retenido desde la nómina del período
        const payrolls = await prisma.payroll.findMany({
            where: { tenantId, month, year },
            select: { inssLaboral: true, inssPatronal: true, inatec: true, irLaboral: true },
        });
        const inssTotal = payrolls.reduce((a, p) => a.plus(p.inssLaboral.toString()).plus(p.inssPatronal.toString()), new Decimal(0)).toDecimalPlaces(2).toNumber();
        const inatecTotal = payrolls.reduce((a, p) => a.plus(p.inatec.toString()), new Decimal(0)).toDecimalPlaces(2).toNumber();
        const irLaboralTotal = payrolls.reduce((a, p) => a.plus(p.irLaboral.toString()), new Decimal(0)).toDecimalPlaces(2).toNumber();
        const planillaCalculada = payrolls.length > 0;

        const period = await prisma.fiscalPeriod.findUnique({ where: { tenantId_year_month: { tenantId, year, month } } });
        const statuses = await prisma.obligationStatus.findMany({ where: { tenantId, year, month } });
        const declared = (k: string) => statuses.find(s => s.key === k)?.declarado ?? false;

        // Vencimientos: DGI al 15 del mes siguiente, INSS/INATEC al 17.
        const nm = month === 12 ? 1 : month + 1;
        const ny = month === 12 ? year + 1 : year;
        const dgiDue = new Date(ny, nm - 1, 15);
        const inssDue = new Date(ny, nm - 1, 17);
        // IR rentas del trabajo: primeros 5 días hábiles del mes siguiente.
        const irLaboralDue = new Date(ny, nm - 1, 1);
        for (let habiles = 0; ;) {
            const dow = irLaboralDue.getDay();
            if (dow !== 0 && dow !== 6 && ++habiles === 5) break;
            irLaboralDue.setDate(irLaboralDue.getDate() + 1);
        }

        const obligaciones = [
            { key: 'IVA', label: 'IVA Neto', entidad: 'DGI (VET)', monto: vet.ivaNeto, vence: dgiDue, dataLista: true, declarado: declared('IVA'), nota: vet.ivaCredito > 0 ? `Crédito a favor C$ ${vet.ivaCredito.toFixed(2)}` : undefined },
            { key: 'ANTICIPO_IR', label: 'Anticipo IR', entidad: 'DGI (VET)', monto: vet.anticipoIRaPagar, vence: dgiDue, dataLista: true, declarado: declared('ANTICIPO_IR'), nota: vet.retencionIRSufrida > 0 ? `Neto de C$ ${vet.retencionIRSufrida.toFixed(2)} retenido` : undefined },
            { key: 'IMI', label: 'IMI Alcaldía', entidad: 'Alcaldía', monto: vet.imiAPagar, vence: dgiDue, dataLista: true, declarado: declared('IMI') },
            { key: 'INSS', label: 'INSS (obrero-patronal)', entidad: 'INSS / SIE', monto: inssTotal, vence: inssDue, dataLista: planillaCalculada, declarado: declared('INSS'), nota: planillaCalculada ? undefined : 'Falta calcular la nómina del mes' },
            { key: 'INATEC', label: 'INATEC 2%', entidad: 'INATEC', monto: inatecTotal, vence: inssDue, dataLista: planillaCalculada, declarado: declared('INATEC'), nota: planillaCalculada ? undefined : 'Falta calcular la nómina del mes' },
            { key: 'IR_LABORAL', label: 'IR Rentas del Trabajo (retenido)', entidad: 'DGI', monto: irLaboralTotal, vence: irLaboralDue, dataLista: planillaCalculada, declarado: declared('IR_LABORAL'), nota: planillaCalculada ? undefined : 'Falta calcular la nómina del mes' },
        ];

        const totalDeclarar = new Decimal(vet.ivaNeto).plus(vet.anticipoIRaPagar).plus(vet.imiAPagar).plus(inssTotal).plus(inatecTotal).plus(irLaboralTotal).toDecimalPlaces(2).toNumber();
        const pendientes = obligaciones.filter(o => o.monto > 0 && !o.declarado).length;

        res.json({
            period: `${year}-${String(month).padStart(2, '0')}`,
            obligaciones, totalDeclarar, pendientes,
            periodoCerrado: period?.status === 'CLOSED',
            planillaCalculada,
            vetSummary: vet.vetSummary,
        });
    } catch (error) {
        console.error('Cierre mensual error:', error);
        res.status(500).json({ error: 'Error al generar el panel de cierre.' });
    }
});

app.put('/api/accounting/cierre-mensual/:year/:month/:key', authenticate, checkRole(['OWNER', 'ADMIN', 'ACCOUNTANT']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month);
    const key = String(req.params.key);
    if (isNaN(year) || isNaN(month) || !OBLIGATION_KEYS.includes(key)) {
        return res.status(400).json({ error: 'Parámetros inválidos.' });
    }
    const declarado = Boolean(req.body?.declarado);
    try {
        await prisma.obligationStatus.upsert({
            where: { tenantId_year_month_key: { tenantId: authReq.tenantId!, year, month, key } },
            create: { tenantId: authReq.tenantId!, year, month, key, declarado, markedBy: authReq.userId!, markedAt: declarado ? new Date() : null },
            update: { declarado, markedBy: authReq.userId!, markedAt: declarado ? new Date() : null },
        });
        res.json({ message: declarado ? 'Marcado como declarado.' : 'Desmarcado.', key, declarado });
    } catch (error) {
        console.error('Toggle obligation error:', error);
        res.status(500).json({ error: 'Error al actualizar el estado.' });
    }
});

// ==========================================
// 📅 ANTIGÜEDAD DE SALDOS — Aging CxC / CxP (Fase C3)
// ==========================================

// GET /api/accounting/aging — ¿quién me debe y a quién le debo, por antigüedad?
app.get('/api/accounting/aging', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const tenantId = authReq.tenantId!;
    try {
        type BucketKey = 'corriente' | 'b1_30' | 'b31_60' | 'b61_90' | 'b90';
        interface Factura { id: string; numero: string | null; fecha: Date; vence: Date | null; monto: number; saldo: number; dias: number; bucket: BucketKey; }
        interface EntAcc { id: string; nombre: string; telefono: string | null; buckets: Record<BucketKey, Decimal>; total: Decimal; vencido: Decimal; facturas: Factura[]; }
        interface RawItem { id: string; entidadId: string; entidadNombre: string; telefono: string | null; numero: string | null; fecha: Date; vence: Date | null; monto: number; saldo: Decimal; }

        const now = new Date();
        const hoy = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const MS_DAY = 86400000;

        // Días vencidos desde la fecha de referencia (vence ?? fecha de emisión).
        const diasVencido = (ref: Date) => {
            const r = new Date(ref);
            const refMid = new Date(r.getFullYear(), r.getMonth(), r.getDate()).getTime();
            return Math.floor((hoy.getTime() - refMid) / MS_DAY);
        };
        const bucketDe = (d: number): BucketKey => d <= 0 ? 'corriente' : d <= 30 ? 'b1_30' : d <= 60 ? 'b31_60' : d <= 90 ? 'b61_90' : 'b90';
        const zero = (): Record<BucketKey, Decimal> => ({ corriente: new Decimal(0), b1_30: new Decimal(0), b31_60: new Decimal(0), b61_90: new Decimal(0), b90: new Decimal(0) });
        const numBuckets = (b: Record<BucketKey, Decimal>) => ({
            corriente: b.corriente.toDecimalPlaces(2).toNumber(),
            b1_30: b.b1_30.toDecimalPlaces(2).toNumber(),
            b31_60: b.b31_60.toDecimalPlaces(2).toNumber(),
            b61_90: b.b61_90.toDecimalPlaces(2).toNumber(),
            b90: b.b90.toDecimalPlaces(2).toNumber(),
        });

        // Agrupa las facturas por entidad y las reparte en los cinco tramos de antigüedad.
        const buildAging = (items: RawItem[]) => {
            const map = new Map<string, EntAcc>();
            const totals = zero();
            for (const it of items) {
                const dias = diasVencido(it.vence ?? it.fecha);
                const bk = bucketDe(dias);
                let e = map.get(it.entidadId);
                if (!e) { e = { id: it.entidadId, nombre: it.entidadNombre, telefono: it.telefono, buckets: zero(), total: new Decimal(0), vencido: new Decimal(0), facturas: [] }; map.set(it.entidadId, e); }
                e.buckets[bk] = e.buckets[bk].plus(it.saldo);
                e.total = e.total.plus(it.saldo);
                if (bk !== 'corriente') e.vencido = e.vencido.plus(it.saldo);
                totals[bk] = totals[bk].plus(it.saldo);
                e.facturas.push({ id: it.id, numero: it.numero, fecha: it.fecha, vence: it.vence, monto: it.monto, saldo: it.saldo.toDecimalPlaces(2).toNumber(), dias, bucket: bk });
            }
            const entidades = [...map.values()]
                .map(e => ({ id: e.id, nombre: e.nombre, telefono: e.telefono, total: e.total.toDecimalPlaces(2).toNumber(), vencido: e.vencido.toDecimalPlaces(2).toNumber(), ...numBuckets(e.buckets), facturas: e.facturas }))
                .sort((a, b) => b.vencido - a.vencido || b.total - a.total);
            const total = totals.corriente.plus(totals.b1_30).plus(totals.b31_60).plus(totals.b61_90).plus(totals.b90).toDecimalPlaces(2).toNumber();
            const vencido = totals.b1_30.plus(totals.b31_60).plus(totals.b61_90).plus(totals.b90).toDecimalPlaces(2).toNumber();
            return { total, vencido, buckets: numBuckets(totals), entidades };
        };

        // CxC: ventas a crédito con saldo pendiente (mismo filtro que /api/credits/debtors).
        const sales = await prisma.sale.findMany({
            where: { tenantId, paymentMethod: 'CREDIT', balance: { gt: 0 } },
            include: { customer: { select: { name: true, phone: true } } },
            orderBy: { dueDate: 'asc' },
        });
        // CxP: compras a crédito pendientes (mismo filtro que /api/purchases/pending).
        const purchases = await prisma.purchase.findMany({
            where: { tenantId, status: 'PENDING_PAYMENT' },
            include: { supplier: { select: { name: true } } },
            orderBy: { dueDate: 'asc' },
        });

        const cxc = buildAging(sales.map((s): RawItem => ({
            id: s.id,
            entidadId: s.customerId ?? `name:${s.customerName ?? 'general'}`,
            entidadNombre: s.customer?.name ?? s.customerName ?? 'Cliente General',
            telefono: s.customer?.phone ?? null,
            numero: s.invoiceNumber != null ? String(s.invoiceNumber) : null,
            fecha: s.createdAt,
            vence: s.dueDate,
            monto: new Decimal(s.total.toString()).toDecimalPlaces(2).toNumber(),
            saldo: new Decimal(s.balance.toString()),
        })));
        const cxp = buildAging(purchases.map((p): RawItem => ({
            id: p.id,
            entidadId: p.supplierId,
            entidadNombre: p.supplier?.name ?? 'Proveedor',
            telefono: null,
            numero: p.invoiceNumber,
            fecha: p.date,
            vence: p.dueDate,
            monto: new Decimal(p.total.toString()).toDecimalPlaces(2).toNumber(),
            saldo: new Decimal(p.total.toString()),
        })));

        res.json({ asOf: hoy, cxc, cxp });
    } catch (error) {
        console.error('Aging error:', error);
        res.status(500).json({ error: 'Error al generar la antigüedad de saldos.' });
    }
});

// ==========================================
// 💵 FLUJO DE EFECTIVO — Estado de flujo de caja (Fase C2)
// ==========================================

// GET /api/accounting/flujo-efectivo/:year/:month — ¿cuánta plata real entró y salió?
// Método directo, derivado del mayor de las cuentas de efectivo (Caja 1.1.1 + Bancos
// 1.1.2). Un débito a efectivo es entrada; un crédito, salida. Reconcilia con el
// balance: saldoInicial + flujoNeto = saldoFinal.
app.get('/api/accounting/flujo-efectivo/:year/:month', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const tenantId = authReq.tenantId!;
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month);
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
        return res.status(400).json({ error: 'Año o mes inválido.' });
    }
    try {
        const CASH_CODES = ['1.1.1', '1.1.2'];
        const periodStart = new Date(year, month - 1, 1);
        const periodEnd = new Date(year, month, 1); // exclusivo (primer día del mes siguiente)

        type Section = 'operacion' | 'inversion' | 'financiamiento';
        interface ContraLine { account: { code: string; name: string; type: string; subtype: string | null }; debit: unknown; credit: unknown; }

        // Saldo de efectivo al inicio del período = Σ(débito − crédito) de todo lo anterior.
        const before = await prisma.journalLine.aggregate({
            where: { account: { tenantId, code: { in: CASH_CODES } }, entry: { date: { lt: periodStart } } },
            _sum: { debit: true, credit: true },
        });
        const saldoInicial = new Decimal(before._sum.debit?.toString() ?? '0').minus(before._sum.credit?.toString() ?? '0');

        // Asientos del período que tocan efectivo, con todas sus líneas y cuentas.
        const entries = await prisma.journalEntry.findMany({
            where: { tenantId, date: { gte: periodStart, lt: periodEnd }, lines: { some: { account: { code: { in: CASH_CODES } } } } },
            include: { lines: { include: { account: { select: { code: true, name: true, type: true, subtype: true } } } } },
            orderBy: { date: 'asc' },
        });

        const CONCEPTO: Record<string, string> = {
            SALE: 'Ventas de contado',
            PAYMENT: 'Cobros a clientes (créditos)',
            PURCHASE: 'Compras a proveedores',
            EXPENSE: 'Gastos',
            PAYROLL: 'Planilla (sueldos netos)',
            RETURN: 'Devoluciones a clientes',
        };
        const absAmt = (l: ContraLine) => new Decimal(l.debit?.toString() ?? '0').minus(l.credit?.toString() ?? '0').abs();

        const clasificar = (contra: ContraLine[]): Section => {
            if (contra.some(l => l.account.subtype === 'FIXED_ASSET')) return 'inversion';
            if (contra.some(l => l.account.type === 'EQUITY' || l.account.code === '2.1.8')) return 'financiamiento';
            return 'operacion';
        };
        const concepto = (refType: string | null, contra: ContraLine[]): string => {
            if (refType && CONCEPTO[refType]) return CONCEPTO[refType];
            const dom = contra.slice().sort((a, b) => absAmt(b).minus(absAmt(a)).toNumber())[0];
            return dom ? dom.account.name : 'Otros movimientos';
        };

        // sección → concepto → { entrada, salida }
        const acc: Record<Section, Map<string, { entrada: Decimal; salida: Decimal }>> = {
            operacion: new Map(), inversion: new Map(), financiamiento: new Map(),
        };
        for (const e of entries) {
            const cashDelta = e.lines
                .filter(l => CASH_CODES.includes(l.account.code))
                .reduce((s, l) => s.plus(l.debit.toString()).minus(l.credit.toString()), new Decimal(0));
            if (cashDelta.isZero()) continue; // transferencia interna Caja↔Bancos: no es flujo
            const contra = e.lines.filter(l => !CASH_CODES.includes(l.account.code));
            const sec = clasificar(contra);
            const label = concepto(e.referenceType, contra);
            const m = acc[sec];
            const cur = m.get(label) ?? { entrada: new Decimal(0), salida: new Decimal(0) };
            if (cashDelta.greaterThan(0)) cur.entrada = cur.entrada.plus(cashDelta);
            else cur.salida = cur.salida.plus(cashDelta.abs());
            m.set(label, cur);
        }

        const buildSection = (m: Map<string, { entrada: Decimal; salida: Decimal }>) => {
            const conceptos = [...m.entries()]
                .map(([label, v]) => ({ label, entrada: v.entrada.toDecimalPlaces(2).toNumber(), salida: v.salida.toDecimalPlaces(2).toNumber(), neto: v.entrada.minus(v.salida).toDecimalPlaces(2).toNumber() }))
                .sort((a, b) => Math.abs(b.neto) - Math.abs(a.neto));
            const entradas = conceptos.reduce((s, c) => s + c.entrada, 0);
            const salidas = conceptos.reduce((s, c) => s + c.salida, 0);
            return { entradas: Number(entradas.toFixed(2)), salidas: Number(salidas.toFixed(2)), neto: Number((entradas - salidas).toFixed(2)), conceptos };
        };

        const operacion = buildSection(acc.operacion);
        const inversion = buildSection(acc.inversion);
        const financiamiento = buildSection(acc.financiamiento);
        const flujoNeto = new Decimal(operacion.neto).plus(inversion.neto).plus(financiamiento.neto).toDecimalPlaces(2).toNumber();
        const saldoFinal = saldoInicial.plus(flujoNeto).toDecimalPlaces(2).toNumber();
        const entradasTotal = Number((operacion.entradas + inversion.entradas + financiamiento.entradas).toFixed(2));
        const salidasTotal = Number((operacion.salidas + inversion.salidas + financiamiento.salidas).toFixed(2));

        res.json({
            period: `${year}-${String(month).padStart(2, '0')}`,
            saldoInicial: saldoInicial.toDecimalPlaces(2).toNumber(),
            saldoFinal,
            flujoNeto,
            entradasTotal,
            salidasTotal,
            secciones: { operacion, inversion, financiamiento },
        });
    } catch (error) {
        console.error('Flujo de efectivo error:', error);
        res.status(500).json({ error: 'Error al generar el flujo de efectivo.' });
    }
});

// ==========================================
// 🔮 ORÁCULO DE INVENTARIO (COMPRAS INTELIGENTES)
// ==========================================

// GET /api/inventory/oracle — Detecta productos que se agotarán en ≤5 días
app.get('/api/inventory/oracle', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        // Obtener movimientos de venta de los últimos 30 días
        const saleMovements = await prisma.kardexMovement.findMany({
            where: {
                tenantId: authReq.tenantId,
                type: 'SALE',
                date: { gte: thirtyDaysAgo }
            },
            select: { productId: true, quantity: true }
        });

        // Agrupar ventas por producto (quantity es negativo en SALE)
        const salesByProduct: Record<string, number> = {};
        for (const m of saleMovements) {
            salesByProduct[m.productId] = (salesByProduct[m.productId] || 0) + Math.abs(m.quantity);
        }

        // Obtener productos activos con stock > 0
        const products = await prisma.product.findMany({
            where: {
                tenantId: authReq.tenantId,
                stock: { gt: 0 }
            },
            select: { id: true, name: true, stock: true, cost: true, price: true }
        });

        const alerts = [];
        for (const p of products) {
            const totalSold = salesByProduct[p.id] || 0;
            if (totalSold === 0) continue; // Sin ventas = sin predicción

            const vpd = totalSold / 30; // Venta Diaria Promedio
            const daysRemaining = p.stock / vpd;

            if (daysRemaining <= 5) {
                const suggestedQty = Math.ceil(vpd * 15); // Restock para 15 días
                const cost = Number(p.cost) || 0;
                // No sugerir como financiable lo que no tiene costo/cantidad válidos:
                // /api/capital/finance-purchase exige unitCost y quantity > 0 (Zod).
                if (cost <= 0 || suggestedQty <= 0) continue;
                alerts.push({
                    productId: p.id,
                    name: p.name,
                    currentStock: p.stock,
                    price: Number(p.price),
                    cost,
                    vpd: Math.round(vpd * 100) / 100,
                    daysRemaining: Math.round(daysRemaining * 10) / 10,
                    suggestedQty,
                    suggestedCost: Math.round(suggestedQty * cost * 100) / 100
                });
            }
        }

        // Ordenar por urgencia (menos días restantes primero)
        alerts.sort((a, b) => a.daysRemaining - b.daysRemaining);

        res.json({ alerts, totalEstimatedCost: alerts.reduce((s, a) => s + a.suggestedCost, 0) });
    } catch (error) {
        console.error('Oracle Error:', error);
        res.status(500).json({ error: 'Error calculando predicciones del Oráculo' });
    }
});

// GET /api/inventory/reorder — ¿Qué reponer? (Bodeguero B2)
// Combina el punto de reorden estático (stock ≤ reorderPoint) con la velocidad de
// venta (VPD, mismo cálculo del oráculo) en una sola lista, con cantidad sugerida.
app.get('/api/inventory/reorder', authenticate, checkRole(['OWNER', 'ADMIN']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const saleMovements = await prisma.kardexMovement.findMany({
            where: { tenantId: authReq.tenantId, type: 'SALE', date: { gte: thirtyDaysAgo } },
            select: { productId: true, quantity: true },
        });
        const salesByProduct: Record<string, number> = {};
        for (const m of saleMovements) {
            salesByProduct[m.productId] = (salesByProduct[m.productId] || 0) + Math.abs(m.quantity);
        }

        const products = await prisma.product.findMany({
            where: { tenantId: authReq.tenantId },
            select: {
                id: true, name: true, sku: true, stock: true, cost: true, minStock: true,
                reorderPoint: true, maxStock: true, category: true, defaultSupplierId: true,
                defaultSupplier: { select: { id: true, name: true } },
            },
        });

        const items = [];
        for (const p of products) {
            const stock = Number(p.stock);
            const reorderPoint = Number(p.reorderPoint) || 0;
            const maxStock = Number(p.maxStock) || 0;
            const totalSold = salesByProduct[p.id] || 0;
            const vpd = totalSold / 30; // Venta Diaria Promedio
            const daysRemaining = vpd > 0 ? stock / vpd : Infinity;

            const belowReorder = reorderPoint > 0 && stock <= reorderPoint;
            const fastMoving = vpd > 0 && daysRemaining <= 7;
            if (!belowReorder && !fastMoving) continue;

            // Cuánto reponer: llevar al máximo si está definido; si no, a 15 días de
            // venta o al doble del punto de reorden.
            const target = maxStock > 0 ? maxStock : (vpd > 0 ? vpd * 15 : reorderPoint * 2);
            const suggestedQty = Math.max(0, Math.ceil(target - stock));
            const cost = Number(p.cost) || 0;

            items.push({
                productId: p.id,
                name: p.name,
                sku: p.sku,
                category: p.category,
                currentStock: stock,
                reorderPoint,
                maxStock,
                cost,
                supplierId: p.defaultSupplier?.id || null,
                supplierName: p.defaultSupplier?.name || null,
                vpd: Math.round(vpd * 100) / 100,
                daysRemaining: daysRemaining === Infinity ? null : Math.round(daysRemaining * 10) / 10,
                reason: belowReorder && fastMoving ? 'BOTH' : belowReorder ? 'REORDER_POINT' : 'VELOCITY',
                suggestedQty,
                suggestedCost: Math.round(suggestedQty * cost * 100) / 100,
            });
        }

        items.sort((a, b) => (a.daysRemaining ?? 9999) - (b.daysRemaining ?? 9999));

        res.json({ items, total: items.length, totalEstimatedCost: items.reduce((s, i) => s + i.suggestedCost, 0) });
    } catch (error) {
        console.error('Reorder Error:', error);
        res.status(500).json({ error: 'Error calculando reposición' });
    }
});

// POST /api/capital/finance-purchase — Financiar compra con Nortex Capital
app.post('/api/capital/finance-purchase', authenticate, validate(FinancePurchaseSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { supplierId, items } = req.body;
    // items: [{ productId, productName, quantity, unitCost }]

    if (!supplierId || !items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'supplierId e items son requeridos.' });
    }

    try {
        // 1. Validar límite de crédito del tenant
        const tenant = await prisma.tenant.findUnique({ where: { id: authReq.tenantId } });
        if (!tenant) return res.status(404).json({ error: 'Tenant no encontrado.' });

        // A2 — montos con decimal.js (antes float nativo: se ALMACENAN en
        // Purchase/CapitalLoan y alimentan el asiento; el float acumula centavos).
        // El costo del proveedor (unitCost) NO trae IVA → el IVA se SUMA (15%),
        // igual que en /api/purchases (correcto para compras).
        const subtotalD = items.reduce(
            (s: Decimal, i: any) => s.plus(new Decimal(i.quantity).mul(i.unitCost)),
            new Decimal(0)
        ).toDecimalPlaces(4);
        const taxD = subtotalD.mul('0.15').toDecimalPlaces(4);
        const totalD = subtotalD.plus(taxD).toDecimalPlaces(4);
        const interestRate = 0.05; // 5% flat
        const totalDueD = totalD.mul(new Decimal(1).plus(interestRate)).toDecimalPlaces(4);
        const subtotal = subtotalD.toNumber();
        const tax = taxD.toNumber();
        const total = totalD.toNumber();
        const totalDue = totalDueD.toNumber();

        const creditLimit = Number(tenant.creditLimit);
        if (total > creditLimit) {
            return res.status(403).json({
                error: `Monto C$ ${total.toFixed(2)} excede tu límite de crédito C$ ${creditLimit.toFixed(2)}. Mejora tu Nortex Score vendiendo más.`,
                creditLimit,
                requested: total
            });
        }

        // 2. Transacción atómica: Purchase + CapitalLoan + JournalEntry
        const result = await prisma.$transaction(async (tx: any) => {

            // Aislamiento multi-tenant: el proveedor y TODOS los productos deben ser del
            // tenant del JWT. No confiar en los ids del body (cross-tenant); abortar si no.
            const supplier = await tx.supplier.findFirst({
                where: { id: supplierId, tenantId: authReq.tenantId! },
                select: { id: true },
            });
            if (!supplier) throw new Error('SUPPLIER_NOT_FOUND');

            const productIds: string[] = [...new Set(items.map((i: any) => i.productId))];
            const ownedProducts = await tx.product.count({
                where: { id: { in: productIds }, tenantId: authReq.tenantId! },
            });
            if (ownedProducts !== productIds.length) throw new Error('PRODUCT_NOT_FOUND');

            // a) Crear la compra al proveedor con estado PENDING_PAYMENT
            const purchase = await tx.purchase.create({
                data: {
                    tenantId: authReq.tenantId!,
                    supplierId,
                    invoiceNumber: `NXC-${Date.now()}`,
                    subtotal,
                    tax,
                    total,
                    status: 'PENDING_PAYMENT',
                    paymentMethod: 'NORTEX_CAPITAL',
                    notes: 'Compra financiada por Nortex Capital - Oráculo de Inventario',
                    createdBy: authReq.userId!,
                    items: {
                        create: items.map((i: any) => ({
                            productId: i.productId,
                            productName: i.productName,
                            quantity: i.quantity,
                            unitCost: i.unitCost,
                            totalCost: i.quantity * i.unitCost
                        }))
                    }
                }
            });

            // b) Crear el préstamo de Nortex Capital
            const dueDate = new Date();
            dueDate.setDate(dueDate.getDate() + 30);

            const loan = await tx.capitalLoan.create({
                data: {
                    tenantId: authReq.tenantId!,
                    amount: total,
                    interestRate,
                    totalDue,
                    dueDate,
                    status: 'ACTIVE',
                    linkedPurchaseId: purchase.id
                }
            });
            // Tamper-evidence: firma de los términos de origen del préstamo
            await signCapitalLoan(tx, loan);

            // c) Asiento contable (Partida Doble)
            // A2 — antes se debitaba TODO el `total` (con IVA) a Inventario (1.1.4)
            // y se omitía IVA Crédito Fiscal (1.1.5): el inventario quedaba
            // sobrevaluado en el 15% y se PERDÍA el crédito fiscal del IVA de la
            // compra. Ahora se separa igual que `recordPurchase`:
            //   Debe: Inventario (1.1.4) = subtotal SIN IVA
            //   Debe: IVA Crédito Fiscal (1.1.5) = IVA de la compra
            //   Haber: Préstamos Nortex Capital por Pagar (2.1.8) = total
            const { createJournalEntry } = await import('./services/accounting');
            await createJournalEntry(
                tx,
                authReq.tenantId!,
                `Compra financiada por Nortex Capital - ${items.length} productos`,
                purchase.id,
                'CAPITAL_LOAN',
                authReq.userId!,
                [
                    { accountCode: '1.1.4', debit: subtotal, credit: 0 },  // Inventario ↑ (sin IVA)
                    { accountCode: '1.1.5', debit: tax, credit: 0 },       // IVA Crédito Fiscal ↑
                    { accountCode: '2.1.8', debit: 0, credit: total },     // Préstamo por Pagar ↑
                ]
            );

            return { purchase, loan };
        });

        res.json({
            message: '✅ Compra financiada exitosamente con Nortex Capital',
            purchaseId: result.purchase.id,
            loanId: result.loan.id,
            loanTerms: {
                amount: total,
                interest: `${interestRate * 100}%`,
                totalDue,
                dueDate: result.loan.dueDate
            }
        });
    } catch (error) {
        if (error instanceof Error && error.message === 'SUPPLIER_NOT_FOUND') {
            return res.status(404).json({ error: 'Proveedor no encontrado.' });
        }
        if (error instanceof Error && error.message === 'PRODUCT_NOT_FOUND') {
            return res.status(404).json({ error: 'Uno o más productos no pertenecen a tu negocio.' });
        }
        console.error('Capital Finance Error:', error);
        res.status(500).json({ error: 'Error procesando el financiamiento' });
    }
});

// ==========================================
// 📊 SALUD FINANCIERA & AUDITORÍA FORENSE
// ==========================================

// GET /api/financial-health — Dashboard de salud financiera del tenant
app.get('/api/financial-health', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const { getBalanceGeneral, getEstadoResultados, seedChartOfAccounts } = await import('./services/accounting');
        const { calculateTenantScore } = await import('./services/scoring');

        await seedChartOfAccounts(authReq.tenantId!);
        const balance = await getBalanceGeneral(authReq.tenantId!);
        const estado = await getEstadoResultados(authReq.tenantId!);
        const score = await calculateTenantScore(authReq.tenantId!);

        // Punto de equilibrio: Gastos fijos / (1 - (Costo Ventas / Ventas)) — bases en Decimal.
        const revenue = estado.revenue.total || 1;
        const cogsRatioD = new Decimal(estado.costOfSales).div(revenue);
        const opExpTotal = new Decimal(estado.operatingExpenses.total);
        const breakEven = cogsRatioD.lessThan(1)
            ? opExpTotal.div(new Decimal(1).minus(cogsRatioD)).toDecimalPlaces(2).toNumber()
            : 0;

        // Margen de utilidad real
        const profitMargin = revenue > 0
            ? new Decimal(estado.netIncome).div(revenue).mul(100).toDecimalPlaces(2).toNumber()
            : 0;

        // EBITDA = utilidad bruta − gastos operativos (Decimal, sin resta float).
        const ebitda = new Decimal(estado.grossProfit).minus(opExpTotal).toDecimalPlaces(2).toNumber();

        res.json({
            kpis: {
                profitMargin,
                breakEven,
                ebitda,
                liquidityRatio: score.financialRatios?.liquidityRatio || 0,
                debtToEquity: score.financialRatios?.debtToEquity || 0,
                netMargin: score.financialRatios?.netMargin || 0,
            },
            score: {
                value: score.score,
                rating: score.rating,
                creditLimit: score.creditLimit,
                factors: score.factors,
            },
            balance: balance,
            estadoResultados: estado,
        });
    } catch (error) {
        console.error('Financial health error:', error);
        res.status(500).json({ error: 'Error al calcular salud financiera' });
    }
});

// Query de rango de fechas para los reportes forenses. z.coerce.date rechaza
// strings inválidos (Invalid Date) → 400 claro en vez de un 500 desde Prisma.
const AuditDateRangeQuerySchema = z.object({
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
});

// GET /api/audit/feed — Feed de alertas forenses (últimas 50)
app.get('/api/audit/feed', authenticate, checkRole(['OWNER', 'ADMIN']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const { getAuditFeed } = await import('./services/audit');
        const feed = await getAuditFeed(authReq.tenantId!);
        res.json(feed);
    } catch (error) {
        console.error('Audit feed error:', error);
        res.status(500).json({ error: 'Error al obtener alertas' });
    }
});

// GET /api/audit/kardex-suspicious — Movimientos de kardex sospechosos
app.get('/api/audit/kardex-suspicious', authenticate, checkRole(['OWNER', 'ADMIN']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const parsed = AuditDateRangeQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Fechas inválidas.', details: parsed.error.flatten().fieldErrors });
    try {
        const { detectSuspiciousKardex } = await import('./services/audit');
        const { startDate, endDate } = parsed.data;
        const results = await detectSuspiciousKardex(authReq.tenantId!, startDate, endDate);
        res.json(results);
    } catch (error) {
        console.error('Kardex suspicious error:', error);
        res.status(500).json({ error: 'Error al analizar kardex' });
    }
});

// GET /api/audit/voided-movements — Análisis de anulaciones por usuario
app.get('/api/audit/voided-movements', authenticate, checkRole(['OWNER', 'ADMIN']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const parsed = AuditDateRangeQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Fechas inválidas.', details: parsed.error.flatten().fieldErrors });
    try {
        const { analyzeVoidedMovements } = await import('./services/audit');
        const { startDate, endDate } = parsed.data;
        const results = await analyzeVoidedMovements(authReq.tenantId!, startDate, endDate);
        res.json(results);
    } catch (error) {
        console.error('Voided movements error:', error);
        res.status(500).json({ error: 'Error al analizar anulaciones' });
    }
});

// GET /api/audit/discounts — Reporte de descuentos por cajero
app.get('/api/audit/discounts', authenticate, checkRole(['OWNER', 'ADMIN']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const parsed = AuditDateRangeQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Fechas inválidas.', details: parsed.error.flatten().fieldErrors });
    try {
        const { analyzeDiscounts } = await import('./services/audit');
        const { startDate, endDate } = parsed.data;
        const results = await analyzeDiscounts(authReq.tenantId!, startDate, endDate);
        res.json(results);
    } catch (error) {
        console.error('Discount analysis error:', error);
        res.status(500).json({ error: 'Error al analizar descuentos' });
    }
});

// Body {month, year} para operaciones contables sensibles (retenciones, cierre fiscal).
const AccountingPeriodBodySchema = z.object({
    month: z.coerce.number().int().min(1).max(12),
    year: z.coerce.number().int().min(2000).max(2100),
});

// POST /api/accounting/retentions — Generar retenciones DGI del mes
app.post('/api/accounting/retentions', authenticate, checkRole(['OWNER', 'ADMIN', 'ACCOUNTANT']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const parsed = AccountingPeriodBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'month y year inválidos', details: parsed.error.flatten().fieldErrors });
    const { month, year } = parsed.data;

    try {
        const { generateRetentions } = await import('./services/accounting');
        const result = await generateRetentions(authReq.tenantId!, month, year);
        res.json(result);
    } catch (error) {
        console.error('Generate retentions error:', error);
        res.status(500).json({ error: 'Error al generar retenciones' });
    }
});

// GET /api/accounting/retentions/:period — Consultar retenciones de un periodo
app.get('/api/accounting/retentions/:period', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { period } = req.params; // "2026-03"

    try {
        const retentions = await prisma.fiscalRetention.findMany({
            where: { tenantId: authReq.tenantId!, period },
            orderBy: { createdAt: 'desc' },
        });

        // Agrupar por tipo
        const grouped = {
            IR_2PCT: retentions.filter((r: any) => r.type === 'IR_2PCT'),
            IMI_1PCT: retentions.filter((r: any) => r.type === 'IMI_1PCT'),
            IVA_RETENIDO: retentions.filter((r: any) => r.type === 'IVA_RETENIDO'),
        };

        const totals = {
            ir: grouped.IR_2PCT.reduce((s: number, r: any) => s + Number(r.amount), 0),
            imi: grouped.IMI_1PCT.reduce((s: number, r: any) => s + Number(r.amount), 0),
            iva: grouped.IVA_RETENIDO.reduce((s: number, r: any) => s + Number(r.amount), 0),
        };

        res.json({ period, retentions: grouped, totals, grandTotal: totals.ir + totals.imi + totals.iva });
    } catch (error) {
        console.error('Fetch retentions error:', error);
        res.status(500).json({ error: 'Error al obtener retenciones' });
    }
});

// POST /api/accounting/fiscal-close — Cierre fiscal mensual
// Solo OWNER puede CERRAR (bloquear) el período, igual que su inverso (reopen).
app.post('/api/accounting/fiscal-close', authenticate, checkRole(['OWNER']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const parsed = AccountingPeriodBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'month y year inválidos', details: parsed.error.flatten().fieldErrors });
    const { month, year } = parsed.data;

    try {
        const { fiscalClose } = await import('./services/accounting');
        const result = await fiscalClose(authReq.tenantId!, month, year, authReq.userId!);
        res.json({ message: `Cierre fiscal ${month}/${year} completado y período BLOQUEADO`, ...result });
    } catch (error) {
        console.error('Fiscal close error:', error);
        res.status(500).json({ error: 'Error al realizar cierre fiscal' });
    }
});

// POST /api/accounting/annual-close — Cierre ANUAL (E4): asiento que salda el
// Estado de Resultados contra Utilidades Retenidas (3.1.2). Solo OWNER, como el
// cierre mensual. Idempotente por año.
app.post('/api/accounting/annual-close', authenticate, checkRole(['OWNER']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const year = Number(req.body?.year);
    if (!Number.isInteger(year) || year < 2000 || year > 2200) {
        return res.status(400).json({ error: 'year inválido' });
    }
    try {
        const { cierreAnual } = await import('./services/accounting');
        const result = await cierreAnual(authReq.tenantId!, year, authReq.userId!);
        res.json({ message: `Cierre anual del ejercicio ${year} completado`, ...result });
    } catch (error: any) {
        console.error('Annual close error:', error);
        if (error?.message?.startsWith('AÑO_YA_CERRADO')) {
            return res.status(409).json({ error: error.message });
        }
        if (error?.message?.startsWith('SIN_MOVIMIENTOS')) {
            return res.status(400).json({ error: error.message });
        }
        res.status(500).json({ error: 'Error al realizar el cierre anual' });
    }
});

// Salario mensual base de la liquidación: promedio de los últimos 6 meses de
// nómina (Art. 78, salario variable) o el salario base si no hay historial.
async function salarioBaseLiquidacion(tenantId: string, employeeId: string, baseSalary: number): Promise<number> {
    // Art. 78: base = salario ORDINARIO (salario + comisiones), promedio de los
    // últimos 6 meses. Se excluyen horas extra y feriado (extraordinarios).
    const recientes = await prisma.payroll.findMany({
        where: { tenantId, employeeId },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        take: 6,
        select: { grossSalary: true, commissions: true },
    });
    if (recientes.length === 0) return baseSalary;
    const suma = recientes.reduce((s, p) => s.plus(p.grossSalary.toString()).plus(p.commissions.toString()), new Decimal(0));
    return suma.dividedBy(recientes.length).toDecimalPlaces(2).toNumber();
}

const SETTLEMENT_REASONS = ['DISMISSAL', 'RESIGNATION', 'MUTUAL'];

// GET /api/hrm/settlement-preview/:employeeId?reason=&date= — Previsualizar finiquito
app.get('/api/hrm/settlement-preview/:employeeId', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { employeeId } = req.params;
    const reason = SETTLEMENT_REASONS.includes(String(req.query.reason)) ? String(req.query.reason) : 'DISMISSAL';
    const terminationDate = req.query.date ? new Date(String(req.query.date)) : new Date();

    try {
        const employee = await prisma.employee.findFirst({
            where: { id: employeeId, tenantId: authReq.tenantId! },
        });
        if (!employee) return res.status(404).json({ error: 'Empleado no encontrado' });

        const { calculateSettlement } = await import('./services/nicaLabor');
        const salarioMensual = await salarioBaseLiquidacion(authReq.tenantId!, employee.id, Number(employee.baseSalary || 0));

        const settlement = calculateSettlement({
            hireDate: employee.hireDate,
            terminationDate,
            reason: reason as 'DISMISSAL' | 'RESIGNATION' | 'MUTUAL',
            salarioMensual,
            vacationDaysBalance: Number(employee.vacationDays || 0),
        });

        const existing = await prisma.terminationSettlement.findUnique({ where: { employeeId: employee.id } });

        res.json({
            employee: {
                id: employee.id,
                name: `${employee.firstName} ${employee.lastName}`,
                cedula: employee.cedula,
                hireDate: employee.hireDate,
                baseSalary: Number(employee.baseSalary || 0),
                status: employee.status,
            },
            settlement,
            yaLiquidado: !!existing,
        });
    } catch (error) {
        console.error('Settlement preview error:', error);
        res.status(500).json({ error: 'Error al calcular liquidación' });
    }
});

// POST /api/hrm/settlement/:employeeId — Ejecuta la liquidación (paga + contabiliza)
app.post('/api/hrm/settlement/:employeeId', authenticate, checkRole(['OWNER', 'ADMIN', 'ACCOUNTANT']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const tenantId = authReq.tenantId!;
    const { employeeId } = req.params;
    const reason = SETTLEMENT_REASONS.includes(String(req.body?.reason)) ? String(req.body.reason) : 'DISMISSAL';
    const terminationDate = req.body?.terminationDate ? new Date(String(req.body.terminationDate)) : new Date();

    try {
        const employee = await prisma.employee.findFirst({ where: { id: employeeId, tenantId } });
        if (!employee) return res.status(404).json({ error: 'Empleado no encontrado' });

        const existing = await prisma.terminationSettlement.findUnique({ where: { employeeId: employee.id } });
        if (existing) return res.status(400).json({ error: 'Este colaborador ya fue liquidado.' });

        const { calculateSettlement } = await import('./services/nicaLabor');
        const salarioMensual = await salarioBaseLiquidacion(tenantId, employee.id, Number(employee.baseSalary || 0));
        const s = calculateSettlement({
            hireDate: employee.hireDate,
            terminationDate,
            reason: reason as 'DISMISSAL' | 'RESIGNATION' | 'MUTUAL',
            salarioMensual,
            vacationDaysBalance: Number(employee.vacationDays || 0),
        });

        await seedChartOfAccounts(tenantId);

        const settlement = await prisma.$transaction(async (tx: any) => {
            const created = await tx.terminationSettlement.create({
                data: {
                    tenantId,
                    employeeId: employee.id,
                    terminationDate,
                    reason,
                    aguinaldoAmount: s.aguinaldo,
                    vacationAmount: s.vacaciones,
                    severanceAmount: s.indemnizacion,
                    totalAmount: s.total,
                },
            });
            // Cancela las provisiones y paga; fail-soft con el lock de períodos.
            try {
                await recordSettlement(tx, tenantId, authReq.userId!, created.id, s.aguinaldo, s.vacaciones, s.indemnizacion);
            } catch (accErr) {
                console.warn('⚠️ Asiento de liquidación omitido:', accErr);
            }
            // Empleado liquidado: TERMINATED y saldo de vacaciones en cero.
            await tx.employee.update({
                where: { id: employee.id },
                data: { status: 'TERMINATED', vacationDays: 0 },
            });
            // Cierra solicitudes que quedan sin sentido tras la baja (no dejarlas colgando).
            await tx.leaveRequest.updateMany({
                where: { tenantId, employeeId: employee.id, status: 'PENDING' },
                data: { status: 'REJECTED' },
            });
            await tx.salaryAdvance.updateMany({
                where: { tenantId, employeeId: employee.id, status: 'PENDING' },
                data: { status: 'REJECTED' },
            });
            // Asiento inmutable de auditoría: liquidación mueve dinero y termina al empleado.
            await tx.auditLog.create({
                data: {
                    tenantId,
                    userId: authReq.userId!,
                    action: 'SETTLEMENT_PROCESSED',
                    details: JSON.stringify({
                        settlementId: created.id,
                        employeeId: employee.id,
                        reason,
                        aguinaldo: s.aguinaldo,
                        vacaciones: s.vacaciones,
                        indemnizacion: s.indemnizacion,
                        total: s.total,
                        salarioMensual,
                        before: { status: employee.status, vacationDays: Number(employee.vacationDays || 0) },
                        after: { status: 'TERMINATED', vacationDays: 0 },
                    }),
                },
            });
            return created;
        });

        res.json({ message: 'Liquidación procesada.', settlement, detalle: s });
    } catch (error) {
        console.error('Settlement run error:', error);
        res.status(500).json({ error: 'Error al procesar la liquidación' });
    }
});

// GET /api/hrm/dashboard/:year/:month — Tablero gerencial de RRHH (solo lectura)
app.get('/api/hrm/dashboard/:year/:month', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const tenantId = authReq.tenantId!;
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month);
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
        return res.status(400).json({ error: 'Año o mes inválido.' });
    }
    try {
        const [employees, payrolls, taxCfg, bajasAnio] = await Promise.all([
            prisma.employee.findMany({
                where: { tenantId, status: 'ACTIVE' },
                select: { id: true, firstName: true, lastName: true, baseSalary: true, role: true },
            }),
            prisma.payroll.findMany({
                where: { tenantId, year, month },
                select: { grossSalary: true, totalIncome: true, netSalary: true, inssPatronal: true, inatec: true, diasAusencia: true },
            }),
            prisma.taxConfig.findUnique({ where: { tenantId } }),
            prisma.terminationSettlement.count({
                where: { tenantId, terminationDate: { gte: new Date(year, 0, 1), lte: new Date(year, 11, 31, 23, 59, 59) } },
            }),
        ]);

        const r2 = (n: number) => Number(n.toFixed(2));
        const sum = (fn: (p: typeof payrolls[number]) => number) => payrolls.reduce((s, p) => s + fn(p), 0);

        const headcount = employees.length;
        const planillaCalculada = payrolls.length > 0;
        const totalDevengado = sum(p => Number(p.totalIncome));
        const nominaNeta = sum(p => Number(p.netSalary));
        const aportesPatronales = sum(p => Number(p.inssPatronal) + Number(p.inatec));
        // Provisión mensual del pasivo laboral ≈ 25% del salario ordinario (B1).
        const provisionMensual = sum(p => Number(p.grossSalary)) / 4;
        const costoLaboralReal = totalDevengado + aportesPatronales + provisionMensual;

        const diasAusencia = sum(p => Number(p.diasAusencia || 0));
        const empleadosConAusencia = payrolls.filter(p => Number(p.diasAusencia || 0) > 0).length;

        const salarioMinimo = taxCfg ? Number(taxCfg.salarioMinimo) : 0;
        const bajoMinimo = salarioMinimo > 0
            ? employees
                .filter(e => Number(e.baseSalary) < salarioMinimo)
                .map(e => ({ id: e.id, name: `${e.firstName} ${e.lastName}`, baseSalary: Number(e.baseSalary) }))
            : [];

        const tasaRotacion = (headcount + bajasAnio) > 0 ? (bajasAnio / (headcount + bajasAnio)) * 100 : 0;

        res.json({
            period: `${year}-${String(month).padStart(2, '0')}`,
            headcount,
            planillaCalculada,
            costoLaboralReal: r2(costoLaboralReal),
            totalDevengado: r2(totalDevengado),
            nominaNeta: r2(nominaNeta),
            aportesPatronales: r2(aportesPatronales),
            provisionMensual: r2(provisionMensual),
            ausentismo: { diasAusencia: r2(diasAusencia), empleadosConAusencia },
            rotacion: { bajasAnio, tasaRotacion: r2(tasaRotacion) },
            salarioMinimo,
            bajoMinimo,
        });
    } catch (error) {
        console.error('HR dashboard error:', error);
        res.status(500).json({ error: 'Error al generar el tablero.' });
    }
});

// ==========================================
// 👤 MI ESPACIO — Autoservicio del colaborador (Fase C3)
// ==========================================

// Encuentra el expediente del usuario autenticado (vínculo Employee.userId).
async function findMyEmployee(authReq: AuthRequest) {
    return prisma.employee.findFirst({ where: { tenantId: authReq.tenantId!, userId: authReq.userId! } });
}

// GET /api/me/profile — datos del propio colaborador
app.get('/api/me/profile', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const emp = await findMyEmployee(authReq);
        if (!emp) return res.status(404).json({ error: 'Tu usuario no está vinculado a un expediente. Pídele a Recursos Humanos que lo vincule.' });
        const now = new Date();
        const meses = Math.max(0, Math.floor((now.getTime() - new Date(emp.hireDate).getTime()) / (86400000 * 30.44)));
        res.json({
            id: emp.id,
            name: `${emp.firstName} ${emp.lastName}`,
            role: emp.role,
            cedula: emp.cedula,
            inss: emp.inss,
            baseSalary: Number(emp.baseSalary),
            vacationDays: emp.vacationDays,
            jornada: emp.jornada,
            hireDate: emp.hireDate,
            antiguedadTexto: `${Math.floor(meses / 12)} año(s) ${meses % 12} mes(es)`,
        });
    } catch (error) {
        console.error('Mi perfil error:', error);
        res.status(500).json({ error: 'Error al obtener tu perfil.' });
    }
});

// GET /api/me/payrolls — historial de colillas del propio colaborador
app.get('/api/me/payrolls', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const emp = await findMyEmployee(authReq);
        if (!emp) return res.json([]);
        const payrolls = await prisma.payroll.findMany({
            where: { tenantId: authReq.tenantId!, employeeId: emp.id },
            orderBy: [{ year: 'desc' }, { month: 'desc' }],
            take: 24,
        });
        res.json(payrolls);
    } catch (error) {
        console.error('Mis colillas error:', error);
        res.status(500).json({ error: 'Error al obtener tus colillas.' });
    }
});

// POST /api/me/leave — el colaborador solicita una ausencia (queda PENDING)
app.post('/api/me/leave', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { type, startDate, endDate, reason } = req.body;
    if (!['SICK', 'VACATION', 'UNPAID', 'MATERNITY'].includes(type) || !startDate || !endDate) {
        return res.status(400).json({ error: 'Tipo y fechas son requeridos.' });
    }
    if (new Date(endDate) < new Date(startDate)) {
        return res.status(400).json({ error: 'La fecha final no puede ser anterior a la inicial.' });
    }
    try {
        const emp = await findMyEmployee(authReq);
        if (!emp) return res.status(404).json({ error: 'Tu usuario no está vinculado a un expediente.' });
        // Evita apilar solicitudes solapadas (de cualquier tipo); el saldo de
        // vacaciones se valida al aprobar.
        const solapada = await prisma.leaveRequest.findFirst({
            where: {
                tenantId: authReq.tenantId!, employeeId: emp.id,
                status: { in: ['PENDING', 'APPROVED'] },
                startDate: { lte: new Date(endDate) }, endDate: { gte: new Date(startDate) },
            },
            select: { id: true },
        });
        if (solapada) return res.status(400).json({ error: 'Ya tenés una ausencia que se solapa con esas fechas.' });
        const leave = await prisma.leaveRequest.create({
            data: {
                tenantId: authReq.tenantId!, employeeId: emp.id, type,
                startDate: new Date(startDate), endDate: new Date(endDate),
                reason: reason || null, status: 'PENDING',
            },
        });
        res.json({ message: 'Solicitud enviada. Queda pendiente de aprobación.', leave });
    } catch (error) {
        console.error('Mi solicitud de ausencia error:', error);
        res.status(500).json({ error: 'Error al enviar la solicitud.' });
    }
});

// POST /api/me/advance — el colaborador solicita un adelanto (queda PENDING)
app.post('/api/me/advance', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    let monto: Decimal;
    try { monto = new Decimal(String(req.body?.amount ?? '')); } catch { return res.status(400).json({ error: 'Monto inválido.' }); }
    if (monto.isNaN() || monto.lessThanOrEqualTo(0)) return res.status(400).json({ error: 'Monto inválido.' });
    try {
        const emp = await findMyEmployee(authReq);
        if (!emp) return res.status(404).json({ error: 'Tu usuario no está vinculado a un expediente.' });
        const max = new Decimal(emp.baseSalary.toString()).times('0.30');
        if (monto.greaterThan(max)) return res.status(400).json({ error: `El monto excede tu límite permitido de C$ ${max.toFixed(2)} (30% del salario).` });
        const pendiente = await prisma.salaryAdvance.findFirst({ where: { tenantId: authReq.tenantId!, employeeId: emp.id, status: 'PENDING' }, select: { id: true } });
        if (pendiente) return res.status(400).json({ error: 'Ya tenés un adelanto pendiente de aprobación.' });
        const advance = await prisma.salaryAdvance.create({
            data: { tenantId: authReq.tenantId!, employeeId: emp.id, amount: monto.toDecimalPlaces(2).toNumber(), fee: monto.times('0.05').toDecimalPlaces(2).toNumber(), status: 'PENDING' },
        });
        res.json({ message: 'Solicitud de adelanto enviada.', advance });
    } catch (error) {
        console.error('Mi adelanto error:', error);
        res.status(500).json({ error: 'Error al solicitar el adelanto.' });
    }
});

// GET /api/me/requests — mis solicitudes (ausencias + adelantos) con su estado
app.get('/api/me/requests', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const emp = await findMyEmployee(authReq);
        if (!emp) return res.json({ leaves: [], advances: [] });
        const [leaves, advances] = await Promise.all([
            prisma.leaveRequest.findMany({ where: { tenantId: authReq.tenantId!, employeeId: emp.id }, orderBy: { startDate: 'desc' }, take: 12 }),
            prisma.salaryAdvance.findMany({ where: { tenantId: authReq.tenantId!, employeeId: emp.id }, orderBy: { id: 'desc' }, take: 12 }),
        ]);
        res.json({
            leaves: leaves.map(l => ({ id: l.id, type: l.type, startDate: l.startDate, endDate: l.endDate, status: l.status, reason: l.reason })),
            advances: advances.map(a => ({ id: a.id, amount: Number(a.amount), fee: Number(a.fee), status: a.status })),
        });
    } catch (error) {
        console.error('Mis solicitudes error:', error);
        res.status(500).json({ error: 'Error al obtener tus solicitudes.' });
    }
});

// GET /api/hr/alerts — centro de alertas proactivas de RRHH (Fase C6)
app.get('/api/hr/alerts', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const tenantId = authReq.tenantId!;
    try {
        const now = new Date();
        const DAY = 86400000;
        const [employees, contracts, pendingLeaves, pendingAdvances] = await Promise.all([
            prisma.employee.findMany({ where: { tenantId, status: 'ACTIVE' }, select: { id: true, cedula: true, inss: true } }),
            prisma.employmentContract.findMany({ where: { tenantId, status: 'ACTIVE' }, select: { employeeId: true, endDate: true, probationEnd: true } }),
            prisma.leaveRequest.count({ where: { tenantId, status: 'PENDING' } }),
            prisma.salaryAdvance.count({ where: { tenantId, status: 'PENDING' } }),
        ]);

        const alerts: { severity: 'danger' | 'warning' | 'info'; message: string }[] = [];

        let porVencer = 0, vencidos = 0, prueba = 0;
        for (const c of contracts) {
            if (c.endDate) {
                const d = Math.ceil((c.endDate.getTime() - now.getTime()) / DAY);
                if (d < 0) vencidos++; else if (d <= 30) porVencer++;
            }
            if (c.probationEnd) {
                const d = Math.ceil((c.probationEnd.getTime() - now.getTime()) / DAY);
                if (d >= 0 && d <= 7) prueba++;
            }
        }
        if (vencidos > 0) alerts.push({ severity: 'danger', message: `${vencidos} contrato(s) vencido(s) — renovar o liquidar.` });
        if (porVencer > 0) alerts.push({ severity: 'warning', message: `${porVencer} contrato(s) por vencer en ≤30 días.` });
        if (prueba > 0) alerts.push({ severity: 'warning', message: `${prueba} período(s) de prueba terminando en ≤7 días.` });

        const conContrato = new Set(contracts.map(c => c.employeeId));
        const sinContrato = employees.filter(e => !conContrato.has(e.id)).length;
        if (sinContrato > 0) alerts.push({ severity: 'warning', message: `${sinContrato} colaborador(es) sin contrato registrado (el MITRAB exige contrato escrito).` });

        const sinInss = employees.filter(e => !e.inss).length;
        const sinCedula = employees.filter(e => !e.cedula).length;
        if (sinInss > 0) alerts.push({ severity: 'danger', message: `${sinInss} colaborador(es) sin número INSS — bloquea la declaración al SIE.` });
        if (sinCedula > 0) alerts.push({ severity: 'warning', message: `${sinCedula} colaborador(es) sin cédula registrada.` });

        const dueAg = new Date(now.getFullYear(), 11, 10);
        const diasAg = Math.ceil((dueAg.getTime() - now.getTime()) / DAY);
        if (diasAg >= 0 && diasAg <= 45) {
            alerts.push({ severity: diasAg <= 10 ? 'danger' : 'info', message: `Faltan ${diasAg} día(s) para pagar el aguinaldo (10 de diciembre).` });
        }

        const pend = pendingLeaves + pendingAdvances;
        if (pend > 0) alerts.push({ severity: 'info', message: `${pend} solicitud(es) pendiente(s) de aprobación.` });

        res.json({ alerts, total: alerts.length });
    } catch (error) {
        console.error('HR alerts error:', error);
        res.status(500).json({ error: 'Error al obtener las alertas.' });
    }
});

// ==========================================
// 🌐 PORTAL DE PEDIDOS PÚBLICOS (NO AUTH)
// ==========================================

// GET /api/tenant/info — Info básica del negocio (requiere autenticación)
app.get('/api/tenant/info', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const tenant = await prisma.tenant.findUnique({
            where: { id: authReq.tenantId! },
            select: {
                id: true,
                businessName: true,
                slug: true,
                phone: true,
                address: true,
            }
        });

        if (!tenant) {
            return res.status(404).json({ error: 'Tenant no encontrado' });
        }

        res.json(tenant);
    } catch (error) {
        console.error('Error fetching tenant info:', error);
        res.status(500).json({ error: 'Error al obtener información del negocio' });
    }
});

// PUT /api/tenant/slug — Configurar slug (INMUTABLE una vez creado)
app.put('/api/tenant/slug', authenticate, checkRole(['ADMIN', 'OWNER']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { slug } = req.body;

    if (!slug || typeof slug !== 'string') {
        return res.status(400).json({ error: 'Slug es requerido' });
    }

    // Validar formato: solo letras minúsculas, números y guiones
    const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
    const cleanSlug = slug.toLowerCase().trim();
    if (!slugRegex.test(cleanSlug) || cleanSlug.length < 3 || cleanSlug.length > 60) {
        return res.status(400).json({ error: 'Slug inválido. Usa solo letras, números y guiones (3-60 caracteres). Ej: "ferreteria-jose"' });
    }

    try {
        // Verificar si ya tiene slug (INMUTABLE)
        const current = await prisma.tenant.findUnique({
            where: { id: authReq.tenantId! },
            select: { slug: true }
        });

        if (current?.slug) {
            return res.status(400).json({
                error: `Tu slug ya está configurado como "${current.slug}" y no puede ser cambiado. Los links compartidos por WhatsApp dependen de él.`
            });
        }

        // Verificar que no esté en uso
        const existing = await prisma.tenant.findUnique({ where: { slug: cleanSlug } });
        if (existing) {
            return res.status(409).json({ error: 'Este slug ya está en uso. Prueba otro.' });
        }

        const updated = await prisma.tenant.update({
            where: { id: authReq.tenantId! },
            data: { slug: cleanSlug }
        });

        res.json({
            message: `Slug configurado: "${cleanSlug}". Tu catálogo público estará en /pedidos/${cleanSlug}`,
            slug: cleanSlug
        });
    } catch (error) {
        console.error('Set slug error:', error);
        res.status(500).json({ error: 'Error al configurar slug' });
    }
});

// Rate limiter estricto para endpoints públicos
const publicLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: { error: 'Demasiadas solicitudes. Intenta en unos minutos.' }
});

// ── Agente de ventas de la landing (R2.8) ────────────────────────────────────
// Chat público SIN auth y SIN datos de negocio (cero Prisma): solo el pitch.
// El costo se acota acá (por IP) + historial recortado + max_tokens en el
// servicio. MemoryStore per-proceso, igual que el resto de limiters (A1).
const landingChatLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 8, // 8 mensajes/minuto por IP: sobra para conversar, corta el abuso
    message: { error: 'Muy rápido. Esperá un momento y seguimos.' },
});
const landingChatDailyLimiter = rateLimit({
    windowMs: 24 * 60 * 60 * 1000,
    max: 120, // techo diario por IP contra scripts de drenaje de tokens
    message: { error: 'Llegaste al límite de hoy. Escribinos al WhatsApp +505 7664-4030.' },
});

app.post('/api/landing-chat', landingChatLimiter, landingChatDailyLimiter, async (req: any, res: any) => {
    const { landingChatAvailable, landingChatSchema, sanitizeHistory, landingChatReply } =
        await import('./services/landingChat');

    if (!landingChatAvailable()) {
        // Sin API key configurada: la landing degrada al WhatsApp, sin romper.
        return res.status(503).json({
            error: 'El chat no está disponible ahora. Escribinos al WhatsApp +505 7664-4030.',
        });
    }

    const parsed = landingChatSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'Mensaje inválido.' });
    }

    const history = sanitizeHistory(parsed.data.messages);
    if (!history) {
        return res.status(400).json({ error: 'Mensaje inválido.' });
    }

    try {
        const reply = await landingChatReply(history);
        res.json({ reply });
    } catch (error) {
        console.error('🟥 [landing-chat]', error);
        res.status(502).json({
            error: 'Se nos trabó el chat. Escribinos al WhatsApp +505 7664-4030 y te respondemos ya.',
        });
    }
});

// GET /api/debug/catalog/:slug — Diagnóstico del catálogo (solo SUPER_ADMIN)
app.get('/api/debug/catalog/:slug', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    if (authReq.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Solo SUPER_ADMIN' });
    const { slug } = req.params;
    try {
        const tenant = await prisma.tenant.findUnique({
            where: { slug },
            select: { id: true, businessName: true, slug: true, phone: true }
        });
        if (!tenant) return res.json({ found: false, slug, message: 'No existe ningún tenant con este slug en la BD.' });
        const totalProducts = await prisma.product.count({ where: { tenantId: tenant.id } });
        const publishedProducts = await prisma.product.count({ where: { tenantId: tenant.id, isPublished: true } });
        res.json({ found: true, tenant, totalProducts, publishedProducts });
    } catch (e) { res.status(500).json({ error: 'Error de diagnóstico' }); }
});

// GET /api/public/catalog/:slug — Catálogo público (NO requiere JWT)
// 🔒 AUDITORÍA: Solo expone name, price, description, imageUrl, category, unit
// JAMÁS: cost, stock, tenantId, createdBy, sku, minStock
app.get('/api/public/catalog/:slug', publicLimiter, async (req: any, res: any) => {
    const { slug } = req.params;

    try {
        const tenant = await prisma.tenant.findUnique({
            where: { slug },
            select: { id: true, businessName: true, slug: true, phone: true }
        });

        if (!tenant) {
            return res.status(404).json({ error: 'Negocio no encontrado' });
        }

        // 🔒 BLINDAJE: select explícito — NUNCA usar findMany sin select en endpoint público
        // 🔒 Solo productos publicados: JAMÁS exponer inventario interno/borrador.
        const products = await prisma.product.findMany({
            where: { tenantId: tenant.id, isPublished: true },
            select: {
                id: true, name: true, price: true, description: true,
                imageUrl: true, category: true, unit: true,
            },
            orderBy: { name: 'asc' }
        });

        res.json({
            business: {
                id: tenant.id,
                name: tenant.businessName,
                slug: tenant.slug,
                phone: tenant.phone,
            },
            products,
            // Si el tenant no ha publicado productos, se devuelve lista vacía (nunca el catálogo interno).
            message: products.length === 0 ? 'Catálogo en construcción.' : undefined,
        });

    } catch (error) {
        console.error('Public catalog error:', error);
        res.status(500).json({ error: 'Error al obtener catálogo' });
    }
});

// POST /api/public/orders — Crear pedido público (NO requiere JWT)
const orderLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Demasiados pedidos. Intenta en unos minutos.' }
});

// Validación del pedido público: el cliente NUNCA fija precios (se resuelven de la BD).
const PublicOrderSchema = z.object({
    slug: z.string().min(1, 'slug requerido'),
    customerName: z.string().trim().min(1, 'Nombre requerido').max(200),
    customerPhone: z.string().trim().max(20).optional(),
    items: z.array(z.object({
        productId: z.string().min(1).max(50),
        quantity: z.number().positive().max(9999),
    })).min(1, 'Se requiere al menos 1 producto').max(50, 'Máximo 50 productos por pedido'),
});

app.post('/api/public/orders', orderLimiter, async (req: any, res: any) => {
    const parsed = PublicOrderSchema.safeParse(req.body);
    if (!parsed.success) {
        const msg = parsed.error.issues.map(i => i.message).join(' | ');
        return res.status(400).json({ error: msg || 'Datos del pedido inválidos.' });
    }
    const { slug, customerName, customerPhone, items } = parsed.data;

    // 🔒 Validar teléfono Nicaragua (8 dígitos) si se proporciona
    if (customerPhone) {
        const phoneDigits = String(customerPhone).replace(/\D/g, '');
        // Acepta: 8 dígitos locales o con código de país (505 + 8 dígitos)
        if (phoneDigits.length !== 8 && phoneDigits.length !== 11) {
            return res.status(400).json({ error: 'Número de teléfono inválido. Usa 8 dígitos (ej: 8888-0000)' });
        }
    }

    try {
        // Buscar tenant por slug
        const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
        if (!tenant) {
            return res.status(404).json({ error: 'Negocio no encontrado' });
        }

        // 🔒 El precio SIEMPRE sale de la BD (productos del tenant y publicados);
        // el cliente no puede fijar precios en el snapshot del pedido.
        const productIds = items.map(i => i.productId);
        const productsDB = await prisma.product.findMany({
            where: { tenantId: tenant.id, id: { in: productIds }, isPublished: true },
            select: { id: true, name: true, price: true },
        });
        if (productsDB.length !== items.length) {
            return res.status(400).json({ error: 'Algunos productos no fueron encontrados o no están disponibles.' });
        }

        // Snapshot con precios congelados desde la BD (nunca del body)
        const sanitizedItems = items.map(item => {
            const prod = productsDB.find(p => p.id === item.productId)!;
            return {
                productId: prod.id,
                name: prod.name,
                quantity: item.quantity,
                price: new Decimal(prod.price.toString()).toDecimalPlaces(2).toNumber(), // 🔒 SNAPSHOT server-side
            };
        });

        const order = await prisma.publicOrder.create({
            data: {
                tenantId: tenant.id,
                customerName: customerName.substring(0, 200),
                customerPhone: customerPhone ? String(customerPhone).replace(/\D/g, '').substring(0, 15) : null,
                items: sanitizedItems,
            }
        });

        res.json({
            message: '¡Pedido enviado! El negocio lo revisará pronto.',
            orderId: order.id,
        });

    } catch (error) {
        console.error('Public order error:', error);
        res.status(500).json({ error: 'Error al crear pedido' });
    }
});

// GET /api/public-orders — Pedidos web del tenant (requiere JWT)
app.get('/api/public-orders', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const orders = await prisma.publicOrder.findMany({
            where: { tenantId: authReq.tenantId },
            orderBy: { createdAt: 'desc' },
            take: 100,
        });
        res.json(orders);
    } catch (error) {
        console.error('Fetch public orders error:', error);
        res.status(500).json({ error: 'Error al obtener pedidos web' });
    }
});

// PATCH /api/public-orders/:id/convert — Convertir PublicOrder → Quotation
app.patch('/api/public-orders/:id/convert', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { id } = req.params;

    try {
        const order = await prisma.publicOrder.findUnique({ where: { id } });
        if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
        if (order.tenantId !== authReq.tenantId) return res.status(403).json({ error: 'No autorizado' });
        if (order.status === 'CONVERTED') return res.status(400).json({ error: 'Este pedido ya fue convertido' });

        const items = order.items as any[];

        // Calcular totales con decimal.js (cero aritmética float sobre dinero)
        let subtotalD = new Decimal(0);
        const formattedItems = items.map((item: any) => {
            const precio = new Decimal(String(item.price)).toDecimalPlaces(2);
            const cantidad = new Decimal(String(item.quantity));
            subtotalD = subtotalD.plus(precio.mul(cantidad));
            return {
                productId: item.productId,
                name: item.name,
                price: precio.toNumber(),
                quantity: cantidad.toNumber(),
            };
        });
        // T1: los precios del pedido público son de GÓNDOLA (IVA incluido), igual
        // que en la venta. Antes se sumaba 15% encima → doble IVA y un total que
        // no coincidía con lo que el POS le cobra al cliente. Se desglosa.
        const brutoD = subtotalD.toDecimalPlaces(2);
        const { neto, iva } = desglosarIvaIncluido(brutoD);
        const subtotal = neto.toNumber();
        const tax = iva.toNumber();
        const total = neto.plus(iva).toNumber();   // === brutoD

        // Transacción: crear Quotation + marcar PublicOrder como CONVERTED
        const result = await prisma.$transaction(async (tx: any) => {
            const quotation = await tx.quotation.create({
                data: {
                    tenantId: authReq.tenantId!,
                    customerName: order.customerName,
                    customerRuc: null,
                    subtotal,
                    tax,
                    total,
                    expiresAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
                    items: {
                        create: formattedItems,
                    },
                },
            });

            await tx.publicOrder.update({
                where: { id },
                data: { status: 'CONVERTED' },
            });

            return quotation;
        });

        res.json({
            message: 'Pedido convertido en cotización exitosamente',
            quotation: { ...result, subtotal, tax, total },
        });

    } catch (error) {
        console.error('Create public order error:', error);
        res.status(500).json({ error: 'Error al procesar el pedido' });
    }
});

// ==========================================
// DRIVER APP — movida a routes/driver.ts (/api/driver/*)
// El magic-link /api/public/driver/:id fue REEMPLAZADO por login
// teléfono+PIN con token firmado (FASE 2): cualquiera que reenviara el
// link podía entrar y marcar entregas/cobros de otro repartidor.
// ==========================================

// ==========================================
// 🧾 SPRINT B — CONSTANCIA DE RETENCIÓN DGI
// ==========================================

// GET /api/fiscal/constancia-retencion/:purchaseId
// Devuelve HTML listo para imprimir como PDF via window.print()
app.get('/api/fiscal/constancia-retencion/:purchaseId', authenticate, checkRole(FISCAL_REPORT_ROLES), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { purchaseId } = req.params;

    try {
        // 1. Obtener la compra + proveedor
        const purchase = await prisma.purchase.findFirst({
            where: fiscalPurchaseScope(authReq.tenantId!, purchaseId),
            include: { supplier: true },
        });
        if (!purchase) return res.status(404).json({ error: 'Compra no encontrada.' });

        // 2. Obtener el tenant (datos del retenedor)
        const tenant = await prisma.tenant.findUnique({
            where: { id: authReq.tenantId! },
            select: { businessName: true, taxId: true, address: true, phone: true, dgiAuthCode: true },
        });
        if (!tenant) return res.status(404).json({ error: 'Tenant no encontrado.' });

        // 3. Obtener retenciones de esta compra
        const retentions = await prisma.fiscalRetention.findMany({
            where: fiscalRetentionScope(authReq.tenantId!, purchaseId),
            orderBy: { type: 'asc' },
        });

        // Si no hay retenciones registradas, calcularlas al vuelo (documento fiscal
        // legal → precisión Decimal, sin float ni Math.round sobre montos).
        const baseAmountD = new Decimal(purchase.subtotal.toString());
        const baseAmount = baseAmountD.toNumber();
        const computedRetentions = retentions.length > 0 ? retentions : [
            { type: 'IR_2PCT',  amount: baseAmountD.mul('0.02').toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(), baseAmount },
            { type: 'IMI_1PCT', amount: baseAmountD.mul('0.01').toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(), baseAmount },
            ...(new Decimal(purchase.tax.toString()).greaterThan(0)
                ? [{
                    type: 'IVA_RETENIDO',
                    amount: new Decimal(purchase.tax.toString()).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
                    baseAmount,
                }]
                : []),
        ];

        const totalRetenido = computedRetentions
            .reduce((s, r) => s.plus(r.amount.toString()), new Decimal(0))
            .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        // `Purchase.date` es la fecha de la factura del proveedor. Es un día de
        // calendario civil de Managua, no el instante en que el usuario digitó
        // la compra ni la zona horaria accidental del proceso.
        const fiscalInvoiceDate = fiscalCivilDate(purchase.date);
        const fecha = fiscalInvoiceDate.longLabel;
        const numeroConstancia = `RET-${purchase.id.slice(-8).toUpperCase()}`;
        const period = retentions[0]?.period || fiscalInvoiceDate.period;

        const typeLabel: Record<string, string> = {
            IR_2PCT: 'Retención IR (Renta) 2%',
            IMI_1PCT: 'Retención IMI (Municipal) 1%',
            IVA_RETENIDO: 'IVA Retenido',
        };

        const retentionRows = computedRetentions.map(r => `
            <tr>
                <td>${escapeHtml(typeLabel[r.type] || r.type)}</td>
                <td class="num">C$ ${escapeHtml(Number(r.baseAmount || baseAmount).toFixed(2))}</td>
                <td class="num">${escapeHtml(r.type === 'IR_2PCT' ? '2%' : r.type === 'IMI_1PCT' ? '1%' : '15%')}</td>
                <td class="num bold">C$ ${escapeHtml(Number(r.amount).toFixed(2))}</td>
            </tr>
        `).join('');

        // Script con nonce: conserva el boton de imprimir sin habilitar scripts
        // inline arbitrarios en un documento construido con datos persistidos.
        const printNonce = crypto.randomBytes(16).toString('base64');
        const safePrintNonce = escapeHtml(printNonce);
        const contentSecurityPolicy = constanciaContentSecurityPolicy(printNonce);

        const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(contentSecurityPolicy)}">
<title>Constancia de Retención ${escapeHtml(numeroConstancia)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 11px; color: #1a1a1a; padding: 20mm; }
  .header { text-align: center; border-bottom: 2px solid #1a1a1a; padding-bottom: 12px; margin-bottom: 16px; }
  .header h1 { font-size: 16px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; }
  .header h2 { font-size: 12px; margin-top: 4px; color: #444; }
  .numero { font-size: 13px; font-weight: bold; color: #1a56a0; margin-top: 6px; }
  .section { margin-bottom: 14px; }
  .section-title { font-size: 10px; font-weight: bold; text-transform: uppercase; color: #666; border-bottom: 1px solid #ddd; padding-bottom: 3px; margin-bottom: 8px; letter-spacing: 0.5px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; }
  .field { display: flex; flex-direction: column; }
  .field label { font-size: 9px; color: #888; text-transform: uppercase; }
  .field span { font-weight: bold; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { background: #1a56a0; color: white; padding: 6px 8px; text-align: left; font-size: 10px; }
  td { padding: 5px 8px; border-bottom: 1px solid #eee; }
  .num { text-align: right; }
  .bold { font-weight: bold; }
  .total-row td { background: #f0f4ff; font-weight: bold; border-top: 2px solid #1a56a0; }
  .footer { margin-top: 32px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
  .firma { border-top: 1px solid #1a1a1a; padding-top: 6px; text-align: center; }
  .firma p { font-size: 9px; color: #666; margin-top: 2px; }
  .legal { margin-top: 24px; font-size: 9px; color: #888; border-top: 1px solid #eee; padding-top: 8px; text-align: center; }
  .badge { display: inline-block; background: #f0f4ff; border: 1px solid #1a56a0; color: #1a56a0; padding: 2px 8px; border-radius: 4px; font-size: 9px; font-weight: bold; margin-top: 4px; }
  @media print {
    body { padding: 12mm; }
    @page { size: letter; margin: 15mm; }
    .no-print { display: none; }
  }
</style>
</head>
<body>

<div class="no-print" style="background:#1a56a0;color:white;padding:10px 16px;margin:-20mm -20mm 16px;display:flex;justify-content:space-between;align-items:center;">
  <span style="font-weight:bold;">Constancia de Retención — Vista Previa</span>
  <button id="print-constancia" type="button" style="background:white;color:#1a56a0;border:none;padding:6px 16px;border-radius:4px;font-weight:bold;cursor:pointer;">🖨️ Imprimir / Guardar PDF</button>
</div>

<div class="header">
  <h1>Constancia de Retención en la Fuente</h1>
  <h2>República de Nicaragua — Dirección General de Ingresos (DGI)</h2>
  <div class="numero">N° ${escapeHtml(numeroConstancia)}</div>
  <div class="badge">Período: ${escapeHtml(period)}</div>
</div>

<div class="section">
  <div class="section-title">Agente Retenedor (Quien retiene)</div>
  <div class="grid">
    <div class="field"><label>Razón Social</label><span>${escapeHtml(tenant.businessName)}</span></div>
    <div class="field"><label>RUC / Cédula</label><span>${escapeHtml(tenant.taxId || 'Por configurar')}</span></div>
    <div class="field"><label>Dirección Fiscal</label><span>${escapeHtml(tenant.address || 'Por configurar')}</span></div>
    <div class="field"><label>Teléfono</label><span>${escapeHtml(tenant.phone || '---')}</span></div>
    ${tenant.dgiAuthCode ? `<div class="field"><label>Código Autorización DGI</label><span>${escapeHtml(tenant.dgiAuthCode)}</span></div>` : ''}
  </div>
</div>

<div class="section">
  <div class="section-title">Sujeto Retenido (Proveedor)</div>
  <div class="grid">
    <div class="field"><label>Razón Social / Nombre</label><span>${escapeHtml(purchase.supplier.name)}</span></div>
    <div class="field"><label>RUC / Cédula</label><span>${escapeHtml((purchase.supplier as any).ruc || 'Por registrar')}</span></div>
    <div class="field"><label>Teléfono</label><span>${escapeHtml((purchase.supplier as any).phone || '---')}</span></div>
    <div class="field"><label>N° Factura del Proveedor</label><span>${escapeHtml(purchase.invoiceNumber)}</span></div>
  </div>
</div>

<div class="section">
  <div class="section-title">Detalle de la Retención</div>
  <table>
    <thead>
      <tr>
        <th>Concepto</th>
        <th style="text-align:right">Base Gravable</th>
        <th style="text-align:right">Tasa</th>
        <th style="text-align:right">Monto Retenido</th>
      </tr>
    </thead>
    <tbody>
      ${retentionRows}
      <tr class="total-row">
        <td colspan="3">TOTAL RETENIDO</td>
        <td class="num">C$ ${escapeHtml(totalRetenido.toFixed(2))}</td>
      </tr>
    </tbody>
  </table>
</div>

<div class="section">
  <div class="grid">
    <div class="field"><label>Fecha de Emisión</label><span>${escapeHtml(fecha)}</span></div>
    <div class="field"><label>Monto Total Factura</label><span>C$ ${escapeHtml(Number(purchase.total).toFixed(2))}</span></div>
    <div class="field"><label>Neto a Pagar al Proveedor</label><span style="color:#1a56a0;font-size:13px;">C$ ${escapeHtml(new Decimal(purchase.total.toString()).minus(totalRetenido).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2))}</span></div>
  </div>
</div>

<div class="footer">
  <div class="firma">
    <p>_________________________________</p>
    <p><strong>Firma y Sello del Agente Retenedor</strong></p>
    <p>${escapeHtml(tenant.businessName)}</p>
  </div>
  <div class="firma">
    <p>_________________________________</p>
    <p><strong>Firma de Recibido — Proveedor</strong></p>
    <p>${escapeHtml(purchase.supplier.name)}</p>
  </div>
</div>

<div class="legal">
  Constancia generada por Nortex ERP. Documento válido conforme Arto. 44 LCT y Arto. 73 RLCT de Nicaragua.
  El agente retenedor está obligado a entregar esta constancia al momento de efectuar el pago.
</div>

<script nonce="${safePrintNonce}">
  document.getElementById('print-constancia')?.addEventListener('click', () => window.print());
</script>

</body>
</html>`;

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'private, no-store, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        res.setHeader(
            'Content-Security-Policy',
            `${contentSecurityPolicy}; frame-ancestors 'self'`,
        );
        res.send(html);

    } catch (error) {
        console.error('Constancia error:', error);
        res.status(500).json({ error: 'Error generando constancia.' });
    }
});

// ==========================================
// 📊 SPRINT A — EXPORTACIONES FISCALES DGI
// ==========================================

// El rango fiscal del mes vive en services/nicaTax.ts (fuente única): los libros,
// el resumen VET y la declaración mensual TIENEN que recortar las mismas ventas.
// Antes había una copia acá y otra fórmula distinta en generateMonthlyReport.

// ── A1: LIBRO DE VENTAS (Excel) ─────────────────────────────────────────────
// GET /api/fiscal/libro-ventas/:month/:year
app.get('/api/fiscal/libro-ventas/:month/:year', authenticate, checkRole(FISCAL_REPORT_ROLES), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const fiscalPeriod = parseFiscalPeriod(req.params.month, req.params.year);
    if (!fiscalPeriod) return res.status(400).json({ error: 'Mes o año inválido.' });
    const { month, year } = fiscalPeriod;

    try {
        const { start, end } = fiscalMonthRange(month, year);
        const XLSX = await import('xlsx');

        const sales = await prisma.sale.findMany({
            where: { tenantId: authReq.tenantId!, createdAt: { gte: start, lt: end }, status: { not: 'VOIDED' } },
            include: { customer: true },
            orderBy: { createdAt: 'asc' },
        });

        // Precisión fiscal: el desglose sale de `desglosarVentaConExoneracion`, la
        // MISMA función que usan el asiento contable y la declaración mensual.
        // Antes acá se hacía `total / 1.15` sobre la venta ENTERA, ignorando
        // `Sale.exemptTotal`: en un negocio que marca productos de canasta básica
        // como exentos (Inventory.tsx tiene el toggle), este libro declaraba IVA
        // por ventas exoneradas que nunca se le cobraron al cliente — y no cuadraba
        // con la declaración del mismo mes, que sí las respetaba.
        const rows = sales.map((s, i) => {
            const fiscalSaleDate = fiscalCivilDate(s.createdAt);
            const d = desglosarVentaConExoneracion(
                s.total.toString(),
                s.exemptTotal?.toString() ?? '0',
            );
            return {
                'N°':            i + 1,
                'Fecha':         fiscalSaleDate.shortLabel,
                'N° Factura':    s.invoiceNumber ? `${s.invoiceSeries || 'A'}-${String(s.invoiceNumber).padStart(6, '0')}` : 'CF',
                'Cliente':       s.customerName || s.customer?.name || 'Consumidor Final',
                'RUC/Cédula':    s.customer?.taxId || '---',
                'Método Pago':   s.paymentMethod,
                'Exento C$':     d.exonerado.toDecimalPlaces(2).toNumber(),
                'Subtotal C$':   d.netoGravado.toDecimalPlaces(2).toNumber(),
                'IVA 15% C$':    d.iva.toDecimalPlaces(2).toNumber(),
                'Total C$':      d.exonerado.plus(d.netoGravado).plus(d.iva).toDecimalPlaces(2).toNumber(),
            };
        });

        // Totales (acumulados con Decimal; se convierten a number solo al escribir la celda)
        const totals = {
            'N°': '', 'Fecha': '', 'N° Factura': '', 'Cliente': 'TOTALES',
            'RUC/Cédula': '', 'Método Pago': '',
            'Exento C$':   rows.reduce((s, r) => s.plus(r['Exento C$']), new Decimal(0)).toNumber(),
            'Subtotal C$': rows.reduce((s, r) => s.plus(r['Subtotal C$']), new Decimal(0)).toNumber(),
            'IVA 15% C$':  rows.reduce((s, r) => s.plus(r['IVA 15% C$']), new Decimal(0)).toNumber(),
            'Total C$':    rows.reduce((s, r) => s.plus(r['Total C$']), new Decimal(0)).toNumber(),
        };
        rows.push(totals as any);

        const ws = XLSX.utils.json_to_sheet(rows);
        ws['!cols'] = [4, 12, 14, 28, 16, 12, 14, 14, 14, 14].map(w => ({ wch: w }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, `Ventas ${month}-${year}`);

        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="libro-ventas-${year}-${String(month).padStart(2,'0')}.xlsx"`);
        res.send(buf);

    } catch (error) {
        console.error('Libro ventas error:', error);
        res.status(500).json({ error: 'Error generando Libro de Ventas.' });
    }
});

// ── A2: LIBRO DE COMPRAS (Excel) ─────────────────────────────────────────────
// GET /api/fiscal/libro-compras/:month/:year
app.get('/api/fiscal/libro-compras/:month/:year', authenticate, checkRole(FISCAL_REPORT_ROLES), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const fiscalPeriod = parseFiscalPeriod(req.params.month, req.params.year);
    if (!fiscalPeriod) return res.status(400).json({ error: 'Mes o año inválido.' });
    const { month, year } = fiscalPeriod;

    try {
        const { start, end } = fiscalMonthRange(month, year);
        const XLSX = await import('xlsx');

        // Mismo criterio que generateMonthlyReport (nicaTax.ts): filtrar por `date` y por
        // estado válido de compra, para que el Libro reconcilie con el crédito fiscal del
        // reporte mensual y no infle el IVA acreditable con compras no válidas.
        const purchases = await prisma.purchase.findMany({
            where: {
                tenantId: authReq.tenantId!,
                date: { gte: start, lt: end },
                status: { in: ['COMPLETED', 'PENDING_PAYMENT'] },
            },
            include: { supplier: true },
            orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        });

        // Retenciones del período para cruzar con compras (acumuladas con Decimal).
        const retentions = await prisma.fiscalRetention.findMany({
            where: { tenantId: authReq.tenantId!, period: `${year}-${String(month).padStart(2,'0')}` },
        });
        const irByPurchase = new Map<string, Decimal>();
        const imiByPurchase = new Map<string, Decimal>();
        retentions.forEach(r => {
            if (!r.purchaseId) return;
            if (r.type === 'IR_2PCT')  irByPurchase.set(r.purchaseId,  (irByPurchase.get(r.purchaseId)  || new Decimal(0)).plus(r.amount.toString()));
            if (r.type === 'IMI_1PCT') imiByPurchase.set(r.purchaseId, (imiByPurchase.get(r.purchaseId) || new Decimal(0)).plus(r.amount.toString()));
        });

        const rows = purchases.map((p, i) => {
            const fiscalInvoiceDate = fiscalCivilDate(p.date);
            const subtotalD = new Decimal(p.subtotal.toString());
            const ivaD      = new Decimal(p.tax.toString());
            const totalD    = new Decimal(p.total.toString());
            const irD       = irByPurchase.get(p.id)  || new Decimal(0);
            const imiD      = imiByPurchase.get(p.id) || new Decimal(0);
            const netoD     = totalD.minus(irD).minus(imiD).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
            return {
                'N°':              i + 1,
                'Fecha':           fiscalInvoiceDate.shortLabel,
                'N° Factura Prov.': p.invoiceNumber,
                'Proveedor':       p.supplier.name,
                'RUC Proveedor':   (p.supplier as any).ruc || '---',
                'Subtotal C$':     subtotalD.toNumber(),
                'IVA Crédito C$':  ivaD.toNumber(),
                'IR Ret. 2% C$':   irD.toNumber(),
                'IMI Ret. 1% C$':  imiD.toNumber(),
                'Neto Pagado C$':  netoD.toNumber(),
                'Total Factura C$': totalD.toNumber(),
            };
        });

        const totals: any = {
            'N°': '', 'Fecha': '', 'N° Factura Prov.': '', 'Proveedor': 'TOTALES', 'RUC Proveedor': '',
            'Subtotal C$':     rows.reduce((s, r) => s.plus(r['Subtotal C$']), new Decimal(0)).toNumber(),
            'IVA Crédito C$':  rows.reduce((s, r) => s.plus(r['IVA Crédito C$']), new Decimal(0)).toNumber(),
            'IR Ret. 2% C$':   rows.reduce((s, r) => s.plus(r['IR Ret. 2% C$']), new Decimal(0)).toNumber(),
            'IMI Ret. 1% C$':  rows.reduce((s, r) => s.plus(r['IMI Ret. 1% C$']), new Decimal(0)).toNumber(),
            'Neto Pagado C$':  rows.reduce((s, r) => s.plus(r['Neto Pagado C$']), new Decimal(0)).toNumber(),
            'Total Factura C$': rows.reduce((s, r) => s.plus(r['Total Factura C$']), new Decimal(0)).toNumber(),
        };
        rows.push(totals);

        const ws = XLSX.utils.json_to_sheet(rows);
        ws['!cols'] = [4, 12, 16, 28, 16, 14, 14, 14, 14, 14, 14].map(w => ({ wch: w }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, `Compras ${month}-${year}`);

        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="libro-compras-${year}-${String(month).padStart(2,'0')}.xlsx"`);
        res.send(buf);

    } catch (error) {
        console.error('Libro compras error:', error);
        res.status(500).json({ error: 'Error generando Libro de Compras.' });
    }
});

// ── A3: ARCHIVO VET DGI (.TXT pipe-delimitado) ──────────────────────────────
// GET /api/fiscal/vet-export/:month/:year
// Formato: TIPO|FECHA|N_FACTURA|RUC_CLIENTE|NOMBRE|SUBTOTAL|IVA|TOTAL
app.get('/api/fiscal/vet-export/:month/:year', authenticate, checkRole(FISCAL_REPORT_ROLES), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const fiscalPeriod = parseFiscalPeriod(req.params.month, req.params.year);
    if (!fiscalPeriod) return res.status(400).json({ error: 'Mes o año inválido.' });
    const { month, year } = fiscalPeriod;

    try {
        const { start, end } = fiscalMonthRange(month, year);
        const period = `${year}${String(month).padStart(2, '0')}`;

        // Ventas
        const sales = await prisma.sale.findMany({
            where: { tenantId: authReq.tenantId!, createdAt: { gte: start, lt: end }, status: { not: 'VOIDED' } },
            include: { customer: true },
            orderBy: { createdAt: 'asc' },
        });

        // Compras — mismo criterio que generateMonthlyReport (nicaTax.ts): `date` + estado válido.
        const purchases = await prisma.purchase.findMany({
            where: {
                tenantId: authReq.tenantId!,
                date: { gte: start, lt: end },
                status: { in: ['COMPLETED', 'PENDING_PAYMENT'] },
            },
            include: { supplier: true },
            orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        });

        const lines: string[] = [];
        // OJO: este NO es un archivo cargable en la Ventanilla Electrónica
        // Tributaria. El formato de abajo es propio de Nortex — no hay en el repo
        // ninguna referencia a una especificación publicada por la DGI. Sirve para
        // TRANSCRIBIR los montos a la VET, no para subirlos. Mientras no se
        // incorpore la spec oficial, el nombre tiene que decir la verdad: prometer
        // un archivo que la DGI rechaza quema al contador en su primer intento.
        lines.push(`# RESUMEN PARA TRANSCRIBIR A LA VET | PERIODO: ${period} | GENERADO: ${new Date().toISOString()}`);
        lines.push(`# NO es un archivo cargable en la VET: formato propio de Nortex, para transcripcion manual.`);
        lines.push(`# FORMATO: TIPO|FECHA(YYYYMMDD)|N_FACTURA|RUC|NOMBRE|EXENTO|SUBTOTAL|IVA|TOTAL`);
        lines.push('');
        lines.push('## LIBRO DE VENTAS');

        for (const s of sales) {
            // Mismo desglose que el Libro de Ventas y la declaración mensual.
            const d = desglosarVentaConExoneracion(
                s.total.toString(),
                s.exemptTotal?.toString() ?? '0',
            );
            const exentoD   = d.exonerado.toDecimalPlaces(2);
            const subtotalD = d.netoGravado.toDecimalPlaces(2);
            const ivaD      = d.iva.toDecimalPlaces(2);
            const totalD    = exentoD.plus(subtotalD).plus(ivaD);
            const fecha    = fiscalCivilDate(s.createdAt).compact;
            const factura  = s.invoiceNumber
                ? `${s.invoiceSeries || 'A'}${String(s.invoiceNumber).padStart(6,'0')}`
                : 'CF';
            const nombre   = (s.customerName || s.customer?.name || 'CONSUMIDOR FINAL').toUpperCase().substring(0, 60);
            const rucV     = s.customer?.taxId || '000-000000-0000X';
            lines.push(`V|${fecha}|${factura}|${rucV}|${nombre}|${exentoD.toFixed(2)}|${subtotalD.toFixed(2)}|${ivaD.toFixed(2)}|${totalD.toFixed(2)}`);
        }

        lines.push('');
        lines.push('## LIBRO DE COMPRAS');

        for (const p of purchases) {
            const subtotalD = new Decimal(p.subtotal.toString()).toDecimalPlaces(2);
            const ivaD      = new Decimal(p.tax.toString()).toDecimalPlaces(2);
            const totalD    = new Decimal(p.total.toString()).toDecimalPlaces(2);
            // La compra guarda subtotal/IVA/total por separado; lo que no cuadra
            // contra el total es la parte exenta (proveedor exonerado, canasta
            // básica). Se acota a ≥0 para que un dato inconsistente no salga en
            // negativo. Misma columna que las ventas, para que el archivo alinee.
            const exentoD = Decimal.max(0, totalD.minus(subtotalD).minus(ivaD)).toDecimalPlaces(2);
            const fecha    = fiscalCivilDate(p.date).compact;
            const nombre   = p.supplier.name.toUpperCase().substring(0, 60);
            const rucC     = (p.supplier as any).ruc || '000-000000-0000X';
            lines.push(`C|${fecha}|${p.invoiceNumber}|${rucC}|${nombre}|${exentoD.toFixed(2)}|${subtotalD.toFixed(2)}|${ivaD.toFixed(2)}|${totalD.toFixed(2)}`);
        }

        const content = lines.join('\r\n'); // CRLF como exige la VET
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="VET-${period}.txt"`);
        res.send(content);

    } catch (error) {
        console.error('VET export error:', error);
        res.status(500).json({ error: 'Error generando archivo VET.' });
    }
});

// ==========================================
// 🚀 SERVE FRONTEND IN PRODUCTION
// ==========================================
const isProduction = process.env.NODE_ENV === 'production';
if (isProduction) {
    const distPath = path.join(__dirname, '../dist');

    // Landing page en la raíz — tiene prioridad sobre el SPA
    app.get('/', (req: any, res: any) => {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.sendFile(path.join(distPath, 'landing.html'));
    });

    // Assets con hash (JS/CSS) → cache agresivo 1 año
    app.use('/assets', express.static(path.join(distPath, 'assets'), {
        maxAge: '1y',
        immutable: true,
    }));

    // Resto de archivos estáticos (favicon, logos, etc.).
    // redirect:false → no redirige /ruta → /ruta/ (controlamos el HTML por-ruta abajo).
    app.use(express.static(distPath, { maxAge: 0, redirect: false }));

    // SPA catch-all: cualquier ruta que no sea /api.
    // Sirve el HTML prerenderizado por-ruta (dist/<ruta>/index.html) si existe — cada uno
    // con su <title>, description y canonical únicos (SEO). Si no, cae al shell del SPA.
    app.get(/^(?!\/api).+/, (req: any, res: any) => {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        const rel = req.path.replace(/^\/+|\/+$/g, '');
        if (rel) {
            const prerendered = path.join(distPath, rel, 'index.html');
            // Guard anti-traversal: el archivo debe quedar dentro de distPath.
            if (prerendered.startsWith(distPath + path.sep) && fs.existsSync(prerendered)) {
                return res.sendFile(prerendered);
            }
        }
        res.sendFile(path.join(distPath, 'index.html'));
    });
    console.log(`📂 Serving static files from: ${distPath}`);
}

// ==========================================
// ⏰ CRON: EXPIRACIÓN AUTOMÁTICA DE SUSCRIPCIONES
// Corre cada hora — marca PAST_DUE a tenants con:
//   1. status ACTIVE y subscriptionEndsAt vencido (webhook de Stripe perdido)
//   2. status TRIAL y trialEndsAt vencido (30 días de prueba cumplidos)
// ==========================================
async function checkExpiredSubscriptions() {
    try {
        const now = new Date();

        const expiredActive = await prisma.tenant.updateMany({
            where: { subscriptionStatus: 'ACTIVE', subscriptionEndsAt: { lt: now } },
            data: { subscriptionStatus: 'PAST_DUE' },
        });

        const expiredTrials = await prisma.tenant.updateMany({
            where: { subscriptionStatus: 'TRIAL', trialEndsAt: { lt: now } },
            data: { subscriptionStatus: 'PAST_DUE' },
        });

        const total = expiredActive.count + expiredTrials.count;
        if (total > 0) {
            console.log(`⏰ Suscripciones vencidas: ${expiredActive.count} activas, ${expiredTrials.count} trials → PAST_DUE`);
            flushAllCache();
        }
    } catch (err) {
        console.error('⚠️ Error en checkExpiredSubscriptions:', err);
    }
}

checkExpiredSubscriptions();
setInterval(checkExpiredSubscriptions, 60 * 60 * 1000); // cada hora

// ⏰ CRON: depreciación mensual automática (Ley 822). Idempotente por
// período/activo → correr a diario es seguro; solo postea la cuota una vez.
runMonthlyDepreciationAllTenants();
setInterval(runMonthlyDepreciationAllTenants, 24 * 60 * 60 * 1000); // cada 24h

// ⏰ CRON: emails de ciclo de vida del trial (retención R1). Idempotente por
// AuditLog (claim antes de enviar) → correr a diario es seguro. Arranque
// diferido 60s para no competir con el boot.
setTimeout(runLifecycleEmails, 60 * 1000);
setInterval(runLifecycleEmails, 24 * 60 * 60 * 1000); // cada 24h

// ==========================================
// 🚀 START SERVER
// ==========================================

initObservability();

// Middleware de errores: registra estructurado (y a Sentry si hay DSN) — SIEMPRE al final.
app.use(errorTelemetry);

const PORT = process.env.PORT || 3000;
app.listen(Number(PORT), '0.0.0.0', () => console.log(`🚀 Nortex Banking Core Ready :${PORT}`));
