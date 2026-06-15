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
import { sendPasswordResetEmail } from './services/email';
import crypto from 'crypto';
import { checkRole } from './middleware/checkRole';
import { MOCK_CATALOG, MOCK_WHOLESALERS } from '../constants';
import { calculateTenantScore } from './services/scoring';
import { recordSale, recordPayment, recordPurchase, recordExpense, recordCashIn, recordReturn, recordPayroll, recordLaborProvision, recordAguinaldoPayment, recordSettlement, seedChartOfAccounts, getBalanceGeneral, getEstadoResultados, createJournalEntry, PeriodLockedError } from './services/accounting';
import { runDepreciationForTenant, runMonthlyDepreciationAllTenants, VIDA_UTIL_DEFAULT } from './services/depreciation';
import { getStripe, createCheckoutSession, createPortalSession, handleWebhookEvent } from './services/stripe';
import { executeSale, SaleError } from './services/salesService';
import { applyStockDelta, StockError } from './services/stockService';
import { appendSignedCashMovement, signCapitalLoan, verifyTenantLedger, appendDriverWalletMovement, verifyDriverLedger } from './services/ledger';
import { signAuthToken } from './services/secrets';
import { isWhatsAppEnabled } from './services/whatsapp/config';
import { verifyHandler as whatsappVerify, webhookHandler as whatsappWebhook } from './services/whatsapp/webhook';
import { encryptField } from './services/crypto';
import Stripe from 'stripe';
import path from 'path';
import { fileURLToPath } from 'url';
import hrRouter from './routes/hr';
import pedidosRouter from './routes/pedidos';
import motorizadosRouter from './routes/motorizados';
import driverRouter from './routes/driver';
import loanRoutes from './routes/loans';
import syncRoutes from './routes/sync';
import Decimal from 'decimal.js';
import {
    validate,
    CreateReturnSchema,
    CreatePaymentSchema,
    CreateCashMovementSchema,
    CreatePurchaseSchema,
    InventoryAdjustSchema,
    OpenShiftSchema,
    CloseShiftSchema,
    CreateExpenseSchema,
    PayrollCalculateSchema,
    TaxReportSchema,
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

        if (STRIPE_WEBHOOK_SECRET && STRIPE_WEBHOOK_SECRET !== 'whsec_REEMPLAZAR_CON_TU_WEBHOOK_SECRET') {
            event = stripe.webhooks.constructEvent(req.body, sig!, STRIPE_WEBHOOK_SECRET);
        } else {
            // Modo desarrollo: confiar en el evento sin verificar firma
            event = JSON.parse(req.body.toString());
            console.warn('⚠️ Webhook sin verificación de firma (dev mode)');
        }

        console.log(`📬 Stripe Webhook: ${event.type}`);
        await handleWebhookEvent(event);

        // Invalidar caché del tenant afectado
        const obj = event.data.object as any;
        const tenantId = obj.metadata?.tenantId;
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

// Rate Limit Global: 100 req / 15 min por IP
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    message: { error: '⚠️ Demasiadas peticiones. Intenta en unos minutos.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', globalLimiter as any);

// Rate Limit Estricto para Login: 5 intentos / hora (anti brute-force)
const loginLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: { error: '🔒 Demasiados intentos de inicio de sesión. Espera 1 hora.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/auth/login', loginLimiter as any);
app.use('/api/hr', hrRouter);
app.use('/api/v1/pedidos', pedidosRouter);
app.use('/api/v1/motorizados', motorizadosRouter);
app.use('/api/driver', driverRouter); // Red NORTEX: registro, login PIN, entregas
app.use('/api/loans', loanRoutes);
app.use('/api/sales/sync', syncRoutes);

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

app.post('/api/auth/register', async (req: any, res: any) => {
    const { companyName, email, password, type } = req.body;

    try {
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
                    walletBalance: 10000,
                    creditLimit: 5000,
                    creditScore: 750,
                    subscriptionStatus: 'TRIAL',
                    trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 días
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

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Error en el registro' });
    }
});

app.post('/api/auth/login', async (req: any, res: any) => {
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

        const validRoles = ['MANAGER', 'CASHIER', 'VIEWER', 'EMPLOYEE', 'ACCOUNTANT'];
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

        const validRoles = ['MANAGER', 'CASHIER', 'VIEWER', 'EMPLOYEE', 'ACCOUNTANT'];
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

        await prisma.invitation.delete({ where: { id: invitationId } });

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
            console.error(`❌ FAILED TO SEND RESET EMAIL to ${user.email}`);
            console.log(`🔗 Reset link (fallback): ${resetLink}`);
            return res.status(500).json({ error: 'Error interno: No se pudo enviar el correo. Revisa los logs del servidor.' });
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
app.post('/api/auth/reset-password/:token', async (req: any, res: any) => {
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

            // Filter sales for this day
            const dayTotal = recentSales
                .filter((s: any) => new Date(s.createdAt).toDateString() === d.toDateString())
                .reduce((sum: number, s: any) => sum + Number(s.total), 0);

            return { name: dayName, sales: dayTotal };
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
        const totalExpensesToday = todayExpenses.reduce((sum: number, e: any) => sum + Number(e.amount), 0);

        // 4. Calculate Today's Sales
        const totalSalesToday = recentSales
            .filter((s: any) => new Date(s.createdAt).toDateString() === new Date().toDateString())
            .reduce((sum: number, s: any) => sum + Number(s.total), 0);

        // 5. Net Profit = Ventas Brutas - Gastos Operativos
        const netProfitToday = totalSalesToday - totalExpensesToday;

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

        const caja = cashObj ? Number(cashObj.balance) : 0;
        const bancos = bankObj ? Number(bankObj.balance) : 0;
        const cxc = cxcObj ? Number(cxcObj.balance) : 0;
        const inventario = invObj ? Number(invObj.balance) : 0;
        const cxp = cxpObj ? Number(cxpObj.balance) : 0;

        const liquidezLibre = (caja + bancos) - cxp;

        const survivalData = {
            cajaGeneral: caja,
            bancos: bancos,
            efectivoTotal: caja + bancos,
            cuentasPorCobrar: cxc,
            inventario: inventario,
            cuentasPorPagar: cxp,
            liquidezLibre: liquidezLibre
        };

        res.json({
            tenant: tenant,
            chartData: chartData,
            todayStats: {
                totalSales: totalSalesToday,
                totalExpenses: totalExpensesToday,
                netProfit: netProfitToday,
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

app.get('/api/fintech/score', authenticate, async (req: any, res: any) => {
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

app.post('/api/loans/request', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { amount } = req.body;
    try {
        const tenant = await prisma.tenant.findUnique({ where: { id: authReq.tenantId } });
        if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
        if (Number(amount) > Number(tenant.creditLimit)) return res.status(400).json({ error: `RIESGO ALTO` });

        const updated = await prisma.tenant.update({
            where: { id: authReq.tenantId },
            data: { walletBalance: { increment: Number(amount) }, creditLimit: { decrement: Number(amount) } }
        });
        await prisma.auditLog.create({ data: { tenantId: authReq.tenantId, userId: authReq.userId, action: 'SURPLUS_ALERT', details: `Préstamo: $${amount}` } });
        res.json(updated);
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

// ==========================================
// 🌍 B2B MARKETPLACE (ACID TRANSACTIONS + EXPENSE TRACKING)
// ==========================================

app.post('/api/b2b/order', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { items, total } = req.body;
    const orderTotal = Number(total);

    try {
        // Transaction: Check Balance -> Deduct -> Create Order -> Register Expense
        const result = await prisma.$transaction(async (tx: any) => {
            // 1. Lock & Fetch Tenant
            const tenant = await tx.tenant.findUnique({ where: { id: authReq.tenantId } });

            if (Number(tenant.walletBalance) < orderTotal) {
                throw new Error('SALDO_INSUFICIENTE');
            }

            // 2. Deduct Balance
            const updatedTenant = await tx.tenant.update({
                where: { id: authReq.tenantId },
                data: { walletBalance: { decrement: orderTotal } }
            });

            // 3. Create Marketplace Order Record
            const order = await tx.b2BOrder.create({
                data: {
                    tenantId: authReq.tenantId,
                    total: orderTotal,
                    items: items, // Stored as JSON
                    status: 'PENDING'
                }
            });

            // 4. Register Expense (Accounting)
            await tx.expense.create({
                data: {
                    tenantId: authReq.tenantId,
                    amount: orderTotal,
                    description: `Orden B2B #${order.id.slice(0, 8)}`,
                    category: 'INVENTORY'
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

app.post('/api/customers', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { name, taxId, phone, address, creditLimit, email } = req.body;

    try {
        const customer = await prisma.customer.create({
            data: {
                tenantId: authReq.tenantId,
                name,
                taxId,
                phone,
                email,
                address,
                creditLimit: creditLimit || 0,
                currentDebt: 0,
                isBlocked: false
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

        const customers = await prisma.customer.findMany({
            where: whereClause,
            orderBy: { name: 'asc' },
            take: 50
        });
        res.json(customers);
    } catch (error) {
        res.status(500).json({ error: 'Error obteniendo cartera' });
    }
});

app.put('/api/customers/:id', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { id } = req.params;
    const { creditLimit, isBlocked } = req.body;

    try {
        const updated = await prisma.customer.updateMany({
            where: { id, tenantId: authReq.tenantId },
            data: {
                creditLimit: creditLimit !== undefined ? Number(creditLimit) : undefined,
                isBlocked: isBlocked !== undefined ? Boolean(isBlocked) : undefined
            }
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Error' }); }
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

app.post('/api/suppliers', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { name, ruc, contactName, phone, email, address, category } = req.body;
    try {
        const supplier = await prisma.supplier.create({
            data: { tenantId: authReq.tenantId, name, contactName, phone, email, category, ruc, address } as any
        });
        res.json(supplier);
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});


// ==========================================
// 👔 RRHH: EMPLEADOS & NÓMINA (LÓGICA REAL AGREGADA)
// ==========================================

app.get('/api/employees', authenticate, async (req: any, res: any) => {
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
            return {
                ...emp,
                salesMonthToDate: stat?._sum.total ? Number(stat._sum.total) : 0
            };
        });

        res.json(employeesWithSales);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error fetching employees' });
    }
});

app.post('/api/employees', authenticate, async (req: any, res: any) => {
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
app.patch('/api/employees/:id/pin', authenticate, async (req: any, res: any) => {
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
            where: { userId: authReq.userId, status: 'OPEN' },
        });
        const result = await executeSale(
            authReq.tenantId!,
            authReq.userId!,
            currentShift?.id ?? null,
            req.body
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
app.post('/api/returns', authenticate, validate(CreateReturnSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { saleId, items, reason } = req.body;
    // items: [{productId, name, quantity, price}]

    try {
        const sale = await prisma.sale.findFirst({
            where: { id: saleId, tenantId: authReq.tenantId },
            include: { items: { select: { productId: true, costAtSale: true } } },
        });
        if (!sale) return res.status(404).json({ error: 'Venta no encontrada' });

        const returnTotal = items.reduce((sum: number, item: any) => sum + Number(item.price) * Number(item.quantity), 0);
        // Costo de lo devuelto: reversa el costo REAL que la venta registró
        // (SaleItem.costAtSale, fijado por el servidor), no una aproximación.
        const costByProduct = new Map(sale.items.map(it => [it.productId, new Decimal(it.costAtSale.toString())]));

        const result = await prisma.$transaction(async (tx: any) => {
            // 1. Create return record
            const productReturn = await tx.productReturn.create({
                data: {
                    tenantId: authReq.tenantId,
                    saleId,
                    total: returnTotal,
                    reason: reason || 'Devolución de producto',
                    items: items,
                    createdBy: authReq.userId,
                }
            });

            // 2. Restore stock for each returned item (incremento atómico —
            //    stockBefore/After salen del row-lock, no de una lectura previa)
            for (const item of items) {
                let stockResult;
                try {
                    stockResult = await applyStockDelta(tx, {
                        tenantId: authReq.tenantId,
                        productId: item.productId,
                        delta: Number(item.quantity),
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
                        quantity: Number(item.quantity),
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
            if (sale.customerId && sale.paymentMethod === 'CREDIT') {
                await tx.customer.update({
                    where: { id: sale.customerId },
                    data: { currentDebt: { decrement: returnTotal } }
                });
            }

            // 📊 MOTOR CONTABLE: Registrar devolución
            const costTotal = items.reduce(
                (sum: Decimal, item: { productId?: unknown; quantity?: unknown }) =>
                    sum.plus((costByProduct.get(String(item.productId)) ?? new Decimal(0)).mul(Number(item.quantity) || 0)),
                new Decimal(0)
            ).toNumber();
            try {
                await recordReturn(tx, authReq.tenantId!, authReq.userId!, productReturn.id, returnTotal, costTotal);
            } catch (accErr) { console.warn('⚠️ Accounting hook failed (return continues):', accErr); }

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

        const result = await prisma.$transaction(async (tx: any) => {
            const payment = await tx.payment.create({
                data: { saleId: sale.id, amount: paymentAmount, method: method || 'CASH', collectedBy: authReq.userId }
            });
            const newBalance = new Decimal(sale.balance.toString()).minus(paymentAmount).toNumber();
            const newStatus = newBalance <= 0.01 ? 'PAID' : 'CREDIT_PENDING';

            await tx.sale.update({
                where: { id: saleId, tenantId: authReq.tenantId },  // tenant isolation en update
                data: { balance: newBalance, status: newStatus }
            });

            if (sale.customerId) {
                await tx.customer.update({
                    where: { id: sale.customerId, tenantId: authReq.tenantId },  // tenant isolation
                    data: { currentDebt: { decrement: paymentAmount } }
                });
            }
            return payment;
        });
        res.json(result);
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});

// --- OPERATIONAL CONTROL (SHIFTS & AUDITS) - Preserved ---
// (Preserved endpoints for shifts and audits)
app.get('/api/shifts/current', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const shift = await prisma.shift.findFirst({
            where: { userId: authReq.userId, status: 'OPEN' },
            include: {
                employee: {
                    select: { id: true, firstName: true, lastName: true, role: true }
                }
            }
        });
        res.json(shift);
    } catch (error) { res.status(500).json({ error: 'Error' }); }
});
app.post('/api/shifts/open', authenticate, validate(OpenShiftSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { initialCash, employeePin } = req.body;

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
            where: { userId: authReq.userId, status: 'OPEN' }
        });
        if (existingShift) {
            return res.status(400).json({ error: 'Ya tienes una caja abierta. Ciérrala primero.' });
        }

        const shift = await prisma.shift.create({
            data: {
                tenantId: authReq.tenantId,
                userId: authReq.userId,
                employeeId: employee.id,
                initialCash,
                status: 'OPEN'
            },
            include: {
                employee: {
                    select: { id: true, firstName: true, lastName: true, role: true }
                }
            }
        });
        res.json(shift);
    } catch (e: any) {
        console.error('Error opening shift:', e);
        res.status(500).json({ error: e.message || 'Error abriendo caja' });
    }
});
app.post('/api/shifts/close', authenticate, validate(CloseShiftSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { declaredCash, shiftId, auditNotes } = req.body;
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

        // ARQUEO DINÁMICO: initialCash + cashSales + manualINs - manualOUTs = expectedCash
        const cashSales = shift.sales.filter((s: any) => s.paymentMethod === 'CASH').reduce((sum: number, s: any) => sum + Number(s.total), 0);
        const cardSales = shift.sales.filter((s: any) => s.paymentMethod !== 'CASH' && s.paymentMethod !== 'CREDIT').reduce((sum: number, s: any) => sum + Number(s.total), 0);
        const manualINs = shift.cashMovements.filter((m: any) => m.type === 'IN').reduce((sum: number, m: any) => sum + Number(m.amount), 0);
        const manualOUTs = shift.cashMovements.filter((m: any) => m.type === 'OUT').reduce((sum: number, m: any) => sum + Number(m.amount), 0);
        const expectedCash = Number(shift.initialCash) + cashSales + manualINs - manualOUTs;
        const difference = Number(declaredCash) - expectedCash;

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
                    difference: difference
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
            manualINs,
            manualOUTs,
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
                cashMovements: { where: { isVoided: false }, select: { id: true, type: true, amount: true, category: true, description: true, createdAt: true } }
            },
            orderBy: { startTime: 'asc' }
        });

        const liveCards = activeShifts.map((shift: any) => {
            // Bóveda 1: Ventas (solo efectivo)
            const cashSales = shift.sales
                .filter((s: any) => s.paymentMethod === 'CASH')
                .reduce((sum: number, s: any) => sum + Number(s.total), 0);
            // Ventas tarjeta/transferencia
            const cardSales = shift.sales
                .filter((s: any) => s.paymentMethod !== 'CASH' && s.paymentMethod !== 'CREDIT')
                .reduce((sum: number, s: any) => sum + Number(s.total), 0);
            // Ventas crédito
            const creditSales = shift.sales
                .filter((s: any) => s.paymentMethod === 'CREDIT')
                .reduce((sum: number, s: any) => sum + Number(s.total), 0);

            // Bóveda 2: Entradas manuales
            const manualINs = shift.cashMovements
                .filter((m: any) => m.type === 'IN')
                .reduce((sum: number, m: any) => sum + Number(m.amount), 0);

            // Bóveda 3: Salidas manuales
            const manualOUTs = shift.cashMovements
                .filter((m: any) => m.type === 'OUT')
                .reduce((sum: number, m: any) => sum + Number(m.amount), 0);

            // EL NÚMERO SAGRADO: Efectivo físico estimado en la gaveta
            const estimatedPhysicalCash = Number(shift.initialCash) + cashSales + manualINs - manualOUTs;

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
                // El Número Sagrado:
                estimatedPhysicalCash,
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
        });

    } catch (e: any) {
        console.error('Error in shift monitor:', e);
        res.status(500).json({ error: e.message || 'Error en el monitor de cajas' });
    }
});

app.get('/api/audit-logs', authenticate, async (req: any, res: any) => {
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
        // A. VALIDAR CAJA ABIERTA
        const currentShift = await prisma.shift.findFirst({
            where: { userId: authReq.userId, status: 'OPEN' },
            include: {
                sales: true,
                cashMovements: { where: { isVoided: false } }
            }
        });
        if (!currentShift) {
            return res.status(400).json({ error: 'No hay caja abierta. Abre una caja primero.' });
        }

        // B. VALIDACIÓN DE SALDO PARA SALIDAS — CERO TOLERANCIA A SALIDAS FANTASMA
        if (type === 'OUT') {
            const cashSalesTotal = currentShift.sales
                .filter((s: any) => s.paymentMethod === 'CASH')
                .reduce((sum: number, s: any) => sum + Number(s.total), 0);
            const totalINs = currentShift.cashMovements
                .filter((m: any) => m.type === 'IN')
                .reduce((sum: number, m: any) => sum + Number(m.amount), 0);
            const totalOUTs = currentShift.cashMovements
                .filter((m: any) => m.type === 'OUT')
                .reduce((sum: number, m: any) => sum + Number(m.amount), 0);

            const availableCash = Number(currentShift.initialCash) + cashSalesTotal + totalINs - totalOUTs;

            if (Number(amount) > availableCash) {
                return res.status(400).json({
                    error: `Saldo insuficiente. Efectivo disponible: C$${availableCash.toFixed(2)}. Intentas sacar: C$${Number(amount).toFixed(2)}`,
                    availableCash
                });
            }
        }

        // C. TRANSACCIÓN: crear movimiento + auto-crear Expense si es salida
        const result = await prisma.$transaction(async (tx: any) => {
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
        res.status(500).json({ error: error.message || 'Error registrando movimiento de caja' });
    }
});

// GET /api/cash-movements — Listar movimientos del turno actual o de un turno específico
app.get('/api/cash-movements', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { shiftId } = req.query;

    try {
        let whereClause: any = { tenantId: authReq.tenantId };

        if (shiftId) {
            whereClause.shiftId = shiftId;
        } else {
            // Default: turno actual abierto del usuario
            const currentShift = await prisma.shift.findFirst({
                where: { userId: authReq.userId, status: 'OPEN' }
            });
            if (!currentShift) {
                return res.json([]);
            }
            whereClause.shiftId = currentShift.id;
        }

        const movements = await prisma.cashMovement.findMany({
            where: whereClause,
            orderBy: { createdAt: 'desc' },
            include: {
                user: { select: { id: true, name: true } }
            }
        });

        res.json(movements);
    } catch (error) {
        console.error('Error fetching cash movements:', error);
        res.status(500).json({ error: 'Error obteniendo movimientos de caja' });
    }
});

// GET /api/cash-movements/balance — Saldo de efectivo en caja en tiempo real
app.get('/api/cash-movements/balance', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;

    try {
        const currentShift = await prisma.shift.findFirst({
            where: { userId: authReq.userId, status: 'OPEN' },
            include: {
                sales: { select: { total: true, paymentMethod: true } },
                cashMovements: { where: { isVoided: false } }
            }
        });

        if (!currentShift) {
            return res.json({ balance: 0, hasOpenShift: false });
        }

        const cashSales = currentShift.sales
            .filter((s: any) => s.paymentMethod === 'CASH')
            .reduce((sum: number, s: any) => sum + Number(s.total), 0);
        const totalINs = currentShift.cashMovements
            .filter((m: any) => m.type === 'IN')
            .reduce((sum: number, m: any) => sum + Number(m.amount), 0);
        const totalOUTs = currentShift.cashMovements
            .filter((m: any) => m.type === 'OUT')
            .reduce((sum: number, m: any) => sum + Number(m.amount), 0);

        const balance = Number(currentShift.initialCash) + cashSales + totalINs - totalOUTs;

        res.json({
            balance,
            hasOpenShift: true,
            breakdown: {
                initialCash: Number(currentShift.initialCash),
                cashSales,
                manualINs: totalINs,
                manualOUTs: totalOUTs
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
            const voided = await tx.cashMovement.update({
                where: { id },
                data: {
                    isVoided: true,
                    voidReason: reason.trim(),
                    voidedAt: new Date(),
                    voidedBy: authReq.userId,
                }
            });

            await tx.auditLog.create({
                data: {
                    tenantId: authReq.tenantId,
                    userId: authReq.userId,
                    action: 'CASH_MOVEMENT_VOIDED',
                    details: JSON.stringify({
                        movimientoId: id,
                        tipoOriginal: movement.type,
                        montoOriginal: Number(movement.amount),
                        razon: reason.trim(),
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
    const { search, lowStock } = req.query;

    try {
        const whereClause: any = { tenantId: authReq.tenantId };

        if (search) {
            whereClause.OR = [
                { name: { contains: search } },
                { sku: { contains: search } },
                { category: { contains: search } }
            ];
        }

        let products = await prisma.product.findMany({
            where: whereClause,
            orderBy: { name: 'asc' },
            include: {
                creator: { select: { name: true, email: true } }
            }
        });

        if (lowStock === 'true') {
            products = products.filter((p: any) => Number(p.stock) <= Number(p.minStock));
        }

        res.json(products);
    } catch (error) {
        console.error('Error fetching products:', error);
        res.status(500).json({ error: 'Error obteniendo productos' });
    }
});

// POST /api/products - Crear producto (OWNER o ADMIN)
app.post('/api/products', authenticate, checkRole(['OWNER', 'ADMIN']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { name, sku, description, category, price, cost, stock, minStock, unit, isPublished, imageUrl, requiresBatchTracking } = req.body;

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
                cost: parseFloat(cost),
                stock: parseInt(stock) || 0,
                minStock: parseInt(minStock) || 0,
                unit: unit || 'unidad',
                isPublished: Boolean(isPublished),
                imageUrl: imageUrl || null,
                requiresBatchTracking: Boolean(requiresBatchTracking),
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
                for (const item of batch) {
                    try {
                        const sku = String(item.sku || '').trim().toUpperCase();
                        const name = String(item.name || item.nombre || '').trim();
                        const price = parseFloat(item.price || item.precio || 0);
                        const cost = parseFloat(item.cost || item.costo || item.costPrice || 0);
                        const stock = parseInt(item.stock || 0) || 0;
                        const minStock = parseInt(item.minStock || 5) || 5;
                        const category = String(item.category || item.categoria || 'General').trim();
                        const unit = String(item.unit || item.unidad || 'unidad').trim();

                        if (!sku || !name) {
                            errors.push(`Fila ${i + batch.indexOf(item) + 1}: SKU o Nombre vacío`);
                            return;
                        }

                        if (price <= 0) {
                            errors.push(`${sku}: Precio inválido`);
                            return;
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
                        errors.push(`Error en ${item.sku || 'sin SKU'}: ${itemError.message}`);
                    }
                }
            });
        }

        res.json({
            message: `Importación completada: ${created} creados, ${updated} actualizados`,
            created,
            updated,
            errors: errors.length > 0 ? errors.slice(0, 20) : [],
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
    const { name, description, category, price, cost, stock, minStock, unit, imageUrl } = req.body;

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
        if (minStock !== undefined) updates.minStock = parseInt(minStock);
        if (unit !== undefined) updates.unit = unit;
        if (imageUrl !== undefined) updates.imageUrl = imageUrl;

        // Si se cambia el stock, crear registro en Kardex
        if (stock !== undefined) {
            const newStock = parseInt(stock);
            const stockDiff = newStock - existing.stock;

            updates.stock = newStock;

            // Registrar movimiento
            await prisma.kardexMovement.create({
                data: {
                    tenantId: authReq.tenantId!,
                    productId: id,
                    type: 'ADJUSTMENT',
                    quantity: stockDiff,
                    stockBefore: existing.stock,
                    stockAfter: newStock,
                    referenceType: 'ADJUSTMENT',
                    reason: 'Ajuste manual de inventario',
                    userId: authReq.userId!
                }
            });
        }

        const updated = await prisma.product.update({
            where: { id },
            data: updates
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

        await prisma.product.delete({ where: { id } });

        res.json({ message: 'Producto eliminado exitosamente' });
    } catch (error) {
        console.error('Error deleting product:', error);
        res.status(500).json({ error: 'Error eliminando producto' });
    }
});

// GET /api/kardex/:productId - Historial de movimientos (Solo OWNER)
app.get('/api/kardex/:productId', authenticate, checkRole(['OWNER', 'ADMIN']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { productId } = req.params;

    try {
        const movements = await prisma.kardexMovement.findMany({
            where: {
                productId,
                tenantId: authReq.tenantId!
            },
            include: {
                user: { select: { name: true, email: true } },
                product: { select: { name: true, sku: true } }
            },
            orderBy: { date: 'desc' },
            take: 50
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

app.post('/api/inventory/adjust', authenticate, checkRole(['OWNER', 'ADMIN']), validate(InventoryAdjustSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { productId, quantity, reason, type } = req.body;

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

    // Reason es OBLIGATORIO para ajustes manuales
    if ((movementType === 'ADJUST_LOSS' || movementType === 'ADJUST_GAIN') && (!reason || reason.trim().length < 3)) {
        return res.status(400).json({ error: 'La justificación es obligatoria para ajustes (mínimo 3 caracteres).' });
    }

    try {
        // TRANSACCIÓN ACID
        const result = await prisma.$transaction(async (tx: any) => {
            // 1. Leer stock actual CON LOCK (serializable en la transacción)
            const product = await tx.product.findFirst({
                where: { id: productId, tenantId: authReq.tenantId! }
            });

            if (!product) {
                throw new Error('Producto no encontrado en tu inventario.');
            }

            const currentStock = product.stock;
            const newStock = currentStock + adjustQty;

            if (newStock < 0) {
                throw new Error(`Stock insuficiente. Actual: ${currentStock}, Ajuste: ${adjustQty}`);
            }

            // 2. Actualizar stock del producto
            await tx.product.update({
                where: { id: productId },
                data: { stock: newStock }
            });

            // 3. Crear registro Kardex inmutable
            const movement = await tx.kardexMovement.create({
                data: {
                    tenantId: authReq.tenantId!,
                    productId,
                    type: movementType,
                    quantity: adjustQty,
                    stockBefore: currentStock,
                    stockAfter: newStock,
                    referenceType: 'ADJUSTMENT',
                    reason: reason?.trim() || `Ajuste manual: ${movementType}`,
                    userId: authReq.userId!
                }
            });

            // 4. Si es una pérdida, registrar en auditoría
            if (movementType === 'ADJUST_LOSS') {
                await tx.auditLog.create({
                    data: {
                        tenantId: authReq.tenantId!,
                        userId: authReq.userId!,
                        action: 'INVENTORY_LOSS',
                        details: JSON.stringify({
                            productId,
                            productName: product.name,
                            sku: product.sku,
                            quantity: adjustQty,
                            stockBefore: currentStock,
                            stockAfter: newStock,
                            reason: reason?.trim(),
                            timestamp: new Date().toISOString()
                        })
                    }
                });
            }

            return { movement, newStock, productName: product.name };
        });

        res.json({
            message: `Ajuste registrado: ${result.productName} → Stock: ${result.newStock}`,
            movement: result.movement,
            newStock: result.newStock
        });
    } catch (error: any) {
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

// POST /api/kardex/record - Registrar movimiento de inventario (interno/automático)
// NOTA: Usar POST /api/inventory/adjust para ajustes manuales (más seguro)
app.post('/api/kardex/record', authenticate, checkRole(['OWNER', 'ADMIN']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { productId, type, quantity, referenceId, referenceType, reason } = req.body;

    try {
        const result = await prisma.$transaction(async (tx: any) => {
            const product = await tx.product.findFirst({
                where: { id: productId, tenantId: authReq.tenantId! }
            });

            if (!product) {
                throw new Error('Producto no encontrado');
            }

            const newStock = product.stock + quantity;

            if (newStock < 0) {
                throw new Error('Stock insuficiente');
            }

            await tx.product.update({
                where: { id: productId },
                data: { stock: newStock }
            });

            const movement = await tx.kardexMovement.create({
                data: {
                    tenantId: authReq.tenantId!,
                    productId,
                    type,
                    quantity,
                    stockBefore: product.stock,
                    stockAfter: newStock,
                    referenceId,
                    referenceType,
                    reason,
                    userId: authReq.userId!
                }
            });

            return { movement, newStock };
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
app.get('/api/reports/inventory', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;

    try {
        const products = await prisma.product.findMany({
            where: { tenantId: authReq.tenantId },
            orderBy: { stock: 'asc' }
        });

        let inventoryValue = new Decimal(0);
        const lowStock: { id: string; name: string; sku: string; stock: number; minStock: number; cost: number }[] = [];

        products.forEach((p) => {
            inventoryValue = inventoryValue.plus(
                new Decimal(p.stock.toString()).mul(p.cost.toString())
            );
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

        const totalExpenses = expenses.reduce((sum: number, e: any) => sum + Number(e.amount), 0);

        // Group by category
        const byCategory: Record<string, number> = {};
        expenses.forEach((e: any) => {
            const cat = e.category || 'OTROS';
            byCategory[cat] = (byCategory[cat] || 0) + Number(e.amount);
        });

        res.json({
            totalExpenses: Math.round(totalExpenses * 100) / 100,
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
app.post('/api/purchases', authenticate, validate(CreatePurchaseSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { supplierId, invoiceNumber, dueDate, paymentMethod, notes, items } = req.body;
    // Validaciones de formato ya realizadas por Zod

    try {
        const result = await prisma.$transaction(async (tx: any) => {
            // 1. Calcular totales
            let subtotal = 0;
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

                const totalCost = new Decimal(item.quantity).mul(item.unitCost);
                subtotal = new Decimal(subtotal).plus(totalCost).toNumber();

                processedItems.push({
                    productId:   item.productId,
                    productName: product.name,
                    quantity:    item.quantity,
                    unitCost:    item.unitCost,
                    totalCost:   totalCost.toNumber(),
                    batchNumber: item.batchNumber || null,
                    expiryDate:  item.expiryDate ? new Date(item.expiryDate) : null
                });
            }

            const tax   = new Decimal(subtotal).mul('0.15').toDecimalPlaces(4).toNumber(); // IVA 15% Nicaragua
            const total = new Decimal(subtotal).plus(tax).toDecimalPlaces(4).toNumber();

            // 2. Crear cabecera de compra
            const purchase = await tx.purchase.create({
                data: {
                    tenantId: authReq.tenantId!,
                    supplierId,
                    invoiceNumber,
                    dueDate: dueDate ? new Date(dueDate) : null,
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

            // 3. Actualizar inventario + Kardex + Costo promedio ponderado
            for (const item of processedItems) {
                const product = await tx.product.findUnique({ where: { id: item.productId } });
                if (!product) continue;

                const oldStock = product.stock;
                const newStock = oldStock + item.quantity;

                // Costo promedio ponderado: (stockViejo*costoViejo + cantidadNueva*costoNuevo) / stockTotal
                const oldTotalCost = new Decimal(oldStock).mul(product.cost.toString());
                const newTotalCost = new Decimal(item.quantity).mul(item.unitCost.toString());
                const newAvgCost   = newStock > 0
                    ? oldTotalCost.plus(newTotalCost).dividedBy(newStock).toDecimalPlaces(4).toNumber()
                    : new Decimal(item.unitCost.toString()).toNumber();

                await tx.product.update({
                    where: { id: item.productId },
                    data: {
                        stock: newStock,
                        cost: newAvgCost  // ya redondeado a 4 d.p. por Decimal
                    }
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
                            expiryDate: new Date(item.expiryDate),
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
                        batchId: batchId
                    }
                });
            }

            // 4. Registro financiero
            if (paymentMethod === 'CASH') {
                // Descontar de wallet del tenant
                await tx.tenant.update({
                    where: { id: authReq.tenantId },
                    data: { walletBalance: { decrement: total } }
                });

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

            return purchase;
        });

        res.json({
            message: `Compra registrada. ${processedItemsCount(items)} productos ingresados al inventario.`,
            purchase: result
        });

    } catch (error: any) {
        console.error('Error registrando compra:', error);
        res.status(500).json({ error: error.message || 'Error al procesar la compra' });
    }
});

function processedItemsCount(items: any[]) {
    return items.reduce((sum: number, i: any) => sum + (i.quantity || 0), 0);
}

// POST /api/purchases/:id/pay - Pagar cuenta pendiente
app.post('/api/purchases/:id/pay', authenticate, async (req: any, res: any) => {
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
            // Actualizar estado
            await tx.purchase.update({
                where: { id },
                data: { status: 'COMPLETED' }
            });

            // Descontar de wallet
            await tx.tenant.update({
                where: { id: authReq.tenantId },
                data: { walletBalance: { decrement: purchase.total } }
            });

            // Crear gasto
            await tx.expense.create({
                data: {
                    tenantId: authReq.tenantId!,
                    amount: purchase.total,
                    description: `Pago Factura #${purchase.invoiceNumber} - ${purchase.supplier.name}`,
                    category: 'PAGO_PROVEEDOR'
                }
            });
        });

        res.json({ message: `Factura #${purchase.invoiceNumber} pagada exitosamente` });

    } catch (error) {
        console.error('Error pagando compra:', error);
        res.status(500).json({ error: 'Error al procesar el pago' });
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
import { generateMonthlyReport, saveMonthlyReport } from './services/nicaTax';

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
        const netoPrevioByEmp = new Map<string, number>();
        const irPrevioByEmp = new Map<string, number>();
        for (const pp of prevPayrolls) {
            const neto = Number(pp.totalIncome) - Number(pp.inssLaboral);
            netoPrevioByEmp.set(pp.employeeId, (netoPrevioByEmp.get(pp.employeeId) || 0) + neto);
            irPrevioByEmp.set(pp.employeeId, (irPrevioByEmp.get(pp.employeeId) || 0) + Number(pp.irLaboral));
        }

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
                const ds = s.startTime.toISOString().slice(0, 10);
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
            const comisiones = ventasMes * Number(emp.commissionRate);
            const overtimeHours = overtimeMap.get(emp.id) || 0;
            const holidayDays = holidayDaysByEmp.get(emp.id) || 0;
            const diasAusencia = Math.min(30, absenceDaysByEmployee.get(emp.id) || 0);
            const absenceDeduction = (baseSalary / 30) * diasAusencia;

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
            const disponible = calc.netSalary;
            let restante = disponible;
            let advanceApplied = 0;
            const aplicados: string[] = [];
            for (const adv of advances) {
                const monto = Number(adv.amount) + Number(adv.fee);
                if (monto <= restante + 0.005) {
                    advanceApplied = Number((advanceApplied + monto).toFixed(2));
                    restante = Number((restante - monto).toFixed(2));
                    aplicados.push(adv.id);
                }
            }
            const netFinal = Number((disponible - advanceApplied).toFixed(2));

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
                advanceDeduction: advanceApplied,
                absenceDeduction: calc.absenceDeduction,
                diasAusencia,
                judicialDeduction: calc.judicialDeduction,
                netSalary: netFinal,
                inssPatronal: calc.inssPatronal,
                inatec: calc.inatec,
            };

            const payroll = await prisma.payroll.upsert({
                where: {
                    employeeId_month_year: { employeeId: emp.id, month: Number(month), year: Number(year) },
                },
                update: data,
                create: { tenantId: authReq.tenantId!, employeeId: emp.id, month: Number(month), year: Number(year), ...data },
            });

            // Marcar como descontados solo los adelantos aplicados; los que no
            // cupieron y estaban enlazados a esta nómina, devolverlos a APPROVED.
            if (aplicados.length > 0) {
                await prisma.salaryAdvance.updateMany({ where: { id: { in: aplicados } }, data: { status: 'DEDUCTED', payrollId: payroll.id } });
            }
            const diferidos = advances.filter(a => !aplicados.includes(a.id)).map(a => a.id);
            if (diferidos.length > 0) {
                await prisma.salaryAdvance.updateMany({ where: { id: { in: diferidos }, payrollId: payroll.id }, data: { status: 'APPROVED', payrollId: null } });
            }

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
app.get('/api/payroll/:month/:year', authenticate, async (req: any, res: any) => {
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
app.get('/api/payroll/sie/:month/:year', authenticate, async (req: any, res: any) => {
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
                await recordPayroll(tx, authReq.tenantId!, authReq.userId!, updated.id, Number(updated.netSalary), Number(updated.inssPatronal), Number(updated.inatec));
            } catch (payErr) {
                console.warn('⚠️ Asiento de nómina omitido (la nómina se paga igual):', payErr);
            }

            // Devengo mensual del pasivo laboral: aguinaldo + vacaciones +
            // indemnización ≈ 1/12 del salario ordinario cada uno (~25% total).
            // El cálculo fino se hace al pagar el aguinaldo (B2) y en la
            // liquidación (B3); esto es la provisión contable del mes. Fail-soft:
            // la nómina se paga aunque el período esté cerrado.
            const cuota = Number(owned.grossSalary) / 12;
            try {
                await recordLaborProvision(tx, authReq.tenantId!, authReq.userId!, owned.id, cuota, cuota, cuota);
            } catch (provErr) {
                console.warn('⚠️ Provisión de prestaciones omitida (la nómina se paga igual):', provErr);
            }

            // Acumular las vacaciones devengadas del mes (2.5 días, Art. 76).
            await tx.employee.update({
                where: { id: owned.employeeId },
                data: { vacationDays: { increment: 2.5 } },
            });

            return updated;
        });

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
    const monto = Number((baseSalary * Math.min(1, dias / 360)).toFixed(2));
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
        const employees = await prisma.employee.findMany({
            where: { tenantId: authReq.tenantId },
        });

        const liabilities = employees.map(emp =>
            calculateLaborLiability(
                emp.id,
                `${emp.firstName} ${emp.lastName}`,
                emp.hireDate,
                Number(emp.baseSalary)
            )
        );

        const totalPasivo = liabilities.reduce((sum, l) => sum + l.totalPasivo, 0);

        res.json({ liabilities, totalPasivo });

    } catch (error) {
        res.status(500).json({ error: 'Error calculando pasivos laborales' });
    }
});

// POST /api/tax-report/generate - Generar reporte fiscal mensual
app.post('/api/tax-report/generate', authenticate, checkRole(['OWNER']), validate(TaxReportSchema), async (req: any, res: any) => {
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
app.get('/api/tax-report/:month/:year', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { month, year } = req.params;

    try {
        const report = await prisma.taxReport.findUnique({
            where: {
                tenantId_month_year: {
                    tenantId: authReq.tenantId!,
                    month: Number(month),
                    year: Number(year),
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
        const { amount, nota } = req.body ?? {};
        const monto = Number(amount);
        if (!Number.isFinite(monto) || monto <= 0) {
            return res.status(400).json({ error: 'amount debe ser un número > 0' });
        }

        const movement = await prisma.$transaction(async (tx) => {
            // Lectura DENTRO de la tx: el saldo no puede cambiar entre chequeo y débito
            // (el row-lock del update de proyección serializa con las comisiones).
            const driver = await tx.motorizado.findUnique({
                where: { id: req.params.id },
                select: { id: true, nombre: true, walletBalance: true },
            });
            if (!driver) throw new Error('DRIVER_NOT_FOUND');
            if (Number(driver.walletBalance) < monto) throw new Error('SALDO_INSUFICIENTE');

            return appendDriverWalletMovement(tx, {
                motorizadoId: driver.id,
                tenantId: null,
                pedidoId: null,
                type: 'PAGO_NORTEX',
                amount: -monto,
                descripcion: typeof nota === 'string' && nota.trim()
                    ? `Pago Nortex: ${nota.trim()}`
                    : 'Pago de comisiones Nortex al repartidor',
            });
        });

        res.json({ message: 'Pago registrado en el libro del repartidor.', movementId: movement.id, amount: -monto });
    } catch (error: unknown) {
        if (error instanceof Error && error.message === 'DRIVER_NOT_FOUND') {
            return res.status(404).json({ error: 'Motorizado no encontrado' });
        }
        if (error instanceof Error && error.message === 'SALDO_INSUFICIENTE') {
            return res.status(400).json({ error: 'El monto excede el saldo del wallet del repartidor.' });
        }
        const message = error instanceof Error ? error.message : 'Error registrando pago';
        res.status(500).json({ error: message });
    }
});

// GET /api/admin/stats - KPIs globales de la plataforma
app.get('/api/admin/stats', authenticate, requireSuperAdmin, async (req: any, res: any) => {
    try {
        // Queries independientes para que si una falla no mate todo
        let tenants: any[] = [];
        let totalLoans = { _sum: { total: null }, _count: 0 };
        let allSales = { _sum: { total: null }, _count: 0 };
        let activeUsers = 0;

        try {
            tenants = await prisma.tenant.findMany({
                select: { id: true, subscriptionStatus: true, walletBalance: true, creditScore: true }
            });
        } catch (e) { console.error('Stats: tenants query failed', e); }

        try {
            totalLoans = await prisma.b2BOrder.aggregate({
                where: { status: { in: ['PENDING', 'APPROVED', 'DELIVERED'] } },
                _sum: { total: true },
                _count: true,
            }) as any;
        } catch (e) { console.error('Stats: b2bOrder query failed', e); }

        try {
            allSales = await prisma.sale.aggregate({
                where: {
                    createdAt: {
                        gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
                    }
                },
                _sum: { total: true },
                _count: true,
            }) as any;
        } catch (e) { console.error('Stats: sales query failed', e); }

        try {
            activeUsers = await prisma.user.count();
        } catch (e) { console.error('Stats: user count failed', e); }

        const activeTenants = tenants.filter((t: any) => !t.subscriptionStatus || (t.subscriptionStatus !== 'PAST_DUE' && t.subscriptionStatus !== 'CANCELLED')).length;
        const morosos = tenants.filter((t: any) => t.subscriptionStatus === 'PAST_DUE' || t.subscriptionStatus === 'CANCELLED').length;
        const totalWallet = tenants.reduce((s: number, t: any) => s + Number(t.walletBalance || 0), 0);
        const totalDebtLent = Number((totalLoans._sum as any)?.total || 0);
        const monthlySales = Number(allSales._sum?.total || 0);

        // MRR: 2% de ventas mensuales como fee de plataforma
        const platformFee = Math.round(monthlySales * 0.02 * 100) / 100;
        // Intereses: 5% mensual sobre deuda prestada
        const interestIncome = Math.round(totalDebtLent * 0.05 * 100) / 100;
        const monthlyRevenue = Math.round((platformFee + interestIncome) * 100) / 100;

        res.json({
            totalTenants: tenants.length,
            activeTenants,
            morosos,
            activeUsers,
            totalDebtLent,
            totalWallet,
            monthlySales,
            monthlyTransactions: allSales._count || 0,
            platformFee,
            interestIncome,
            monthlyRevenue,
        });
    } catch (error) {
        console.error('Admin stats error:', error);
        res.status(500).json({ error: 'Error al obtener estadísticas' });
    }
});

// GET /api/admin/tenants - Lista completa de empresas
app.get('/api/admin/tenants', authenticate, requireSuperAdmin, async (req: any, res: any) => {
    try {
        const tenants = await prisma.tenant.findMany({
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
        });

        const tenantsWithOwner = tenants.map((t: any) => ({
            id: t.id,
            businessName: t.businessName,
            taxId: t.taxId,
            walletBalance: Number(t.walletBalance),
            creditLimit: Number(t.creditLimit),
            creditScore: t.creditScore,
            subscriptionStatus: t.subscriptionStatus || 'ACTIVE',
            createdAt: t.createdAt,
            owner: t.users[0] || null,
            stats: {
                sales: t._count.sales,
                products: t._count.products,
                employees: t._count.employees,
            }
        }));

        res.json(tenantsWithOwner);
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
app.get('/api/admin/loan-requests', authenticate, requireSuperAdmin, async (req: any, res: any) => {
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

        res.json(requests);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener solicitudes' });
    }
});

// POST /api/admin/loans/approve - Aprobar préstamo
app.post('/api/admin/loans/approve', authenticate, requireSuperAdmin, async (req: any, res: any) => {
    const { orderId, amount } = req.body;

    if (!orderId || !amount) {
        return res.status(400).json({ error: 'Se requiere orderId y amount' });
    }

    try {
        await prisma.$transaction(async (tx: any) => {
            // Actualizar orden
            const order = await tx.b2bOrder.update({
                where: { id: orderId },
                data: { status: 'APPROVED' },
                include: { tenant: true }
            });

            // Desembolsar fondos al wallet del tenant
            await tx.tenant.update({
                where: { id: order.tenantId },
                data: { walletBalance: { increment: Number(amount) } }
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
        });
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener estado de suscripción' });
    }
});

// ==========================================
// 🏦 PAGOS MANUALES (DEPÓSITO / TRANSFERENCIA)
// ==========================================

// POST /api/billing/report-manual - Cliente reporta pago manual
app.post('/api/billing/report-manual', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { amount, currency, bank, referenceNumber, proofUrl, notes } = req.body;

    if (!amount || !bank || !referenceNumber) {
        return res.status(400).json({ error: 'Monto, banco y número de referencia son requeridos.' });
    }

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
                amount: Number(amount),
                currency: currency || 'USD',
                bank,
                referenceNumber: String(referenceNumber),
                proofUrl: proofUrl || null,
                notes: notes || null,
            }
        });

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
app.get('/api/admin/manual-payments', authenticate, requireSuperAdmin, async (req: any, res: any) => {
    try {
        const payments = await prisma.manualPayment.findMany({
            include: {
                tenant: {
                    select: { businessName: true, subscriptionStatus: true },
                    include: { users: { select: { email: true, name: true }, take: 1, orderBy: { createdAt: 'asc' as any } } }
                }
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

        const endsAt = new Date();
        endsAt.setDate(endsAt.getDate() + 30);

        await prisma.$transaction([
            // Aprobar pago
            prisma.manualPayment.update({
                where: { id: req.params.id },
                data: { status: 'APPROVED', reviewedBy: authReq.userId, reviewedAt: new Date() }
            }),
            // Activar tenant
            prisma.tenant.update({
                where: { id: payment.tenantId },
                data: { subscriptionStatus: 'ACTIVE', subscriptionEndsAt: endsAt }
            }),
            // Audit log
            prisma.auditLog.create({
                data: {
                    tenantId: payment.tenantId,
                    userId: authReq.userId!,
                    action: 'MANUAL_PAYMENT_APPROVED',
                    details: `Pago manual de $${payment.amount} ${payment.currency} aprobado. Ref: ${payment.referenceNumber}`
                }
            })
        ]);

        // Invalidar caché del tenant
        invalidateTenantCache(payment.tenantId);

        res.json({ message: `Pago aprobado. Suscripción activada hasta ${endsAt.toLocaleDateString()}.` });
    } catch (error) {
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
        // Calculate totals server-side for security
        let subtotal = 0;
        const formattedItems = items.map((item: any) => {
            const total = Number(item.price) * Number(item.quantity);
            subtotal += total;
            return {
                productId: item.id || item.productId,
                name: item.name,
                price: item.price,
                quantity: item.quantity
            };
        });

        const tax = subtotal * 0.15;
        const total = subtotal + tax;

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

// POST /api/credits/payment - Registrar abono
app.post('/api/credits/payment', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { saleId, amount, method } = req.body;

    if (!saleId || !amount) return res.status(400).json({ error: 'Faltan datos' });

    try {
        await prisma.$transaction(async (tx: any) => {
            const sale = await tx.sale.findUnique({ where: { id: saleId } });
            if (!sale) throw new Error('Venta no encontrada');

            const newBalance = Number(sale.balance) - Number(amount);
            if (newBalance < -0.01) throw new Error('El abono excede el saldo pendiente');

            // 1. Crear Pago
            await tx.payment.create({
                data: {
                    saleId,
                    amount: Number(amount),
                    method: method || 'CASH',
                    collectedBy: authReq.userId!
                }
            });

            // 2. Actualizar Venta
            const updatedSale = await tx.sale.update({
                where: { id: saleId },
                data: {
                    balance: newBalance,
                    status: newBalance <= 0.01 ? 'COMPLETED' : 'PENDING' // Update status if fully paid
                },
                include: {
                    payments: { orderBy: { createdAt: 'desc' } },
                    customer: { select: { name: true } }
                }
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
app.get('/api/tax-report/dmi', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const month = parseInt(req.query.month as string) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year as string) || new Date().getFullYear();

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

        const asset = await prisma.fixedAsset.create({
            data: {
                tenantId: authReq.tenantId!, nombre: nombre.trim(), categoria: cat,
                costo: costoD.toDecimalPlaces(2).toNumber(), fechaAdquisicion: fecha,
                vidaUtilMeses: vida, createdBy: authReq.userId!,
            },
        });
        res.status(201).json({ message: 'Activo registrado.', asset });
    } catch (error) {
        console.error('Create fixed asset error:', error);
        res.status(500).json({ error: 'Error al registrar el activo.' });
    }
});

// PATCH dar de baja
app.patch('/api/accounting/fixed-assets/:id/baja', authenticate, checkRole(['OWNER', 'ADMIN', 'ACCOUNTANT']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const owned = await prisma.fixedAsset.findFirst({ where: { id: req.params.id, tenantId: authReq.tenantId! }, select: { id: true } });
        if (!owned) return res.status(404).json({ error: 'Activo no encontrado.' });
        await prisma.fixedAsset.update({ where: { id: owned.id }, data: { estado: 'BAJA' } });
        res.json({ message: 'Activo dado de baja.' });
    } catch { res.status(500).json({ error: 'Error al dar de baja.' }); }
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

// POST /api/capital/finance-purchase — Financiar compra con Nortex Capital
app.post('/api/capital/finance-purchase', authenticate, async (req: any, res: any) => {
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

        const subtotal = items.reduce((s: number, i: any) => s + (i.quantity * i.unitCost), 0);
        const tax = subtotal * 0.15; // IVA 15%
        const total = subtotal + tax;
        const interestRate = 0.05; // 5% flat
        const totalDue = total * (1 + interestRate);

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
            // Debe: Inventario de Mercancías (1.1.4) — aumenta activo
            // Haber: Préstamos Nortex Capital por Pagar (2.1.8) — aumenta pasivo
            const { createJournalEntry } = await import('./services/accounting');
            await createJournalEntry(
                tx,
                authReq.tenantId!,
                `Compra financiada por Nortex Capital - ${items.length} productos`,
                purchase.id,
                'CAPITAL_LOAN',
                authReq.userId!,
                [
                    { accountCode: '1.1.4', debit: total, credit: 0 },    // Inventario ↑
                    { accountCode: '2.1.8', debit: 0, credit: total },    // Préstamo por Pagar ↑
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

        // Punto de equilibrio: Gastos fijos / (1 - (Costo Ventas / Ventas))
        const revenue = estado.revenue.total || 1;
        const cogsRatio = estado.costOfSales / revenue;
        const breakEven = cogsRatio < 1 ? estado.operatingExpenses.total / (1 - cogsRatio) : 0;

        // Margen de utilidad real
        const profitMargin = revenue > 0 ? ((estado.netIncome / revenue) * 100) : 0;

        res.json({
            kpis: {
                profitMargin: Math.round(profitMargin * 100) / 100,
                breakEven: Math.round(breakEven * 100) / 100,
                ebitda: Math.round((estado.grossProfit - estado.operatingExpenses.total) * 100) / 100,
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

// GET /api/audit/feed — Feed de alertas forenses (últimas 50)
app.get('/api/audit/feed', authenticate, async (req: any, res: any) => {
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
app.get('/api/audit/kardex-suspicious', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const { detectSuspiciousKardex } = await import('./services/audit');
        const startDate = req.query.startDate ? new Date(req.query.startDate) : undefined;
        const endDate = req.query.endDate ? new Date(req.query.endDate) : undefined;
        const results = await detectSuspiciousKardex(authReq.tenantId!, startDate, endDate);
        res.json(results);
    } catch (error) {
        console.error('Kardex suspicious error:', error);
        res.status(500).json({ error: 'Error al analizar kardex' });
    }
});

// GET /api/audit/voided-movements — Análisis de anulaciones por usuario
app.get('/api/audit/voided-movements', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const { analyzeVoidedMovements } = await import('./services/audit');
        const startDate = req.query.startDate ? new Date(req.query.startDate) : undefined;
        const endDate = req.query.endDate ? new Date(req.query.endDate) : undefined;
        const results = await analyzeVoidedMovements(authReq.tenantId!, startDate, endDate);
        res.json(results);
    } catch (error) {
        console.error('Voided movements error:', error);
        res.status(500).json({ error: 'Error al analizar anulaciones' });
    }
});

// GET /api/audit/discounts — Reporte de descuentos por cajero
app.get('/api/audit/discounts', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const { analyzeDiscounts } = await import('./services/audit');
        const startDate = req.query.startDate ? new Date(req.query.startDate) : undefined;
        const endDate = req.query.endDate ? new Date(req.query.endDate) : undefined;
        const results = await analyzeDiscounts(authReq.tenantId!, startDate, endDate);
        res.json(results);
    } catch (error) {
        console.error('Discount analysis error:', error);
        res.status(500).json({ error: 'Error al analizar descuentos' });
    }
});

// POST /api/accounting/retentions — Generar retenciones DGI del mes
app.post('/api/accounting/retentions', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { month, year } = req.body;
    if (!month || !year) return res.status(400).json({ error: 'month y year son requeridos' });

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
app.post('/api/accounting/fiscal-close', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { month, year } = req.body;
    if (!month || !year) return res.status(400).json({ error: 'month y year son requeridos' });

    try {
        const { fiscalClose } = await import('./services/accounting');
        const result = await fiscalClose(authReq.tenantId!, month, year, authReq.userId!);
        res.json({ message: `Cierre fiscal ${month}/${year} completado y período BLOQUEADO`, ...result });
    } catch (error) {
        console.error('Fiscal close error:', error);
        res.status(500).json({ error: 'Error al realizar cierre fiscal' });
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
    const monto = Number(req.body?.amount);
    if (!monto || monto <= 0) return res.status(400).json({ error: 'Monto inválido.' });
    try {
        const emp = await findMyEmployee(authReq);
        if (!emp) return res.status(404).json({ error: 'Tu usuario no está vinculado a un expediente.' });
        const max = Number(emp.baseSalary) * 0.30;
        if (monto > max) return res.status(400).json({ error: `El monto excede tu límite permitido de C$ ${max.toFixed(2)} (30% del salario).` });
        const advance = await prisma.salaryAdvance.create({
            data: { tenantId: authReq.tenantId!, employeeId: emp.id, amount: monto, fee: monto * 0.05, status: 'PENDING' },
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
app.put('/api/tenant/slug', authenticate, async (req: any, res: any) => {
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
        let products = await prisma.product.findMany({
            where: { tenantId: tenant.id, isPublished: true },
            select: {
                id: true, name: true, price: true, description: true,
                imageUrl: true, category: true, unit: true,
            },
            orderBy: { name: 'asc' }
        });

        // Si el tenant no ha publicado ningún producto aún, mostramos TODO el catálogo
        // para que el cliente vea algo en lugar de una página vacía
        if (products.length === 0) {
            products = await prisma.product.findMany({
                where: { tenantId: tenant.id },
                select: {
                    id: true, name: true, price: true, description: true,
                    imageUrl: true, category: true, unit: true,
                },
                orderBy: { name: 'asc' }
            });
        }

        res.json({
            business: {
                id: tenant.id,
                name: tenant.businessName,
                slug: tenant.slug,
                phone: tenant.phone,
            },
            products,
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

app.post('/api/public/orders', orderLimiter, async (req: any, res: any) => {
    const { slug, customerName, customerPhone, items } = req.body;

    if (!slug || !customerName || !items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Faltan datos: slug, customerName y items son requeridos' });
    }

    // 🔒 Anti-abuso: máximo 50 items por pedido
    if (items.length > 50) {
        return res.status(400).json({ error: 'Máximo 50 productos por pedido' });
    }

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
        const tenant = await prisma.tenant.findUnique({ where: { slug } });
        if (!tenant) {
            return res.status(404).json({ error: 'Negocio no encontrado' });
        }

        // Sanitizar items — snapshot con precios congelados al momento del pedido
        const sanitizedItems = items.map((item: any) => {
            const price = Math.min(Math.max(Number(item.price) || 0, 0), 999999); // Techo de precio
            const quantity = Math.min(Math.max(Number(item.quantity) || 1, 0.01), 9999); // Techo de cantidad
            return {
                productId: String(item.productId || item.id).substring(0, 50),
                name: String(item.name).substring(0, 200),
                quantity,
                price, // 🔒 SNAPSHOT: precio congelado al momento del pedido
            };
        });

        const order = await prisma.publicOrder.create({
            data: {
                tenantId: tenant.id,
                customerName: String(customerName).substring(0, 200),
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

        // Calcular totales
        let subtotal = 0;
        const formattedItems = items.map((item: any) => {
            const total = Number(item.price) * Number(item.quantity);
            subtotal += total;
            return {
                productId: item.productId,
                name: item.name,
                price: Number(item.price),
                quantity: Number(item.quantity),
            };
        });
        const tax = subtotal * 0.15;
        const total = subtotal + tax;

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
app.get('/api/fiscal/constancia-retencion/:purchaseId', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { purchaseId } = req.params;

    try {
        // 1. Obtener la compra + proveedor
        const purchase = await prisma.purchase.findFirst({
            where: { id: purchaseId, tenantId: authReq.tenantId! },
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
            where: { purchaseId, tenantId: authReq.tenantId! },
            orderBy: { type: 'asc' },
        });

        // Si no hay retenciones registradas, calcularlas al vuelo
        const baseAmount = Number(purchase.subtotal);
        const computedRetentions = retentions.length > 0 ? retentions : [
            { type: 'IR_2PCT',  amount: Math.round(baseAmount * 0.02 * 100) / 100, baseAmount },
            { type: 'IMI_1PCT', amount: Math.round(baseAmount * 0.01 * 100) / 100, baseAmount },
        ];

        const totalRetenido = computedRetentions.reduce((s, r) => s + Number(r.amount), 0);
        const fecha = new Date(purchase.createdAt).toLocaleDateString('es-NI', {
            day: '2-digit', month: 'long', year: 'numeric'
        });
        const numeroConstancia = `RET-${purchase.id.slice(-8).toUpperCase()}`;
        const period = retentions[0]?.period || `${new Date(purchase.createdAt).getFullYear()}-${String(new Date(purchase.createdAt).getMonth()+1).padStart(2,'0')}`;

        const typeLabel: Record<string, string> = {
            IR_2PCT: 'Retención IR (Renta) 2%',
            IMI_1PCT: 'Retención IMI (Municipal) 1%',
            IVA_RETENIDO: 'IVA Retenido',
        };

        const retentionRows = computedRetentions.map(r => `
            <tr>
                <td>${typeLabel[r.type] || r.type}</td>
                <td class="num">C$ ${Number(r.baseAmount || baseAmount).toFixed(2)}</td>
                <td class="num">${r.type === 'IR_2PCT' ? '2%' : r.type === 'IMI_1PCT' ? '1%' : '15%'}</td>
                <td class="num bold">C$ ${Number(r.amount).toFixed(2)}</td>
            </tr>
        `).join('');

        const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Constancia de Retención ${numeroConstancia}</title>
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
  <button onclick="window.print()" style="background:white;color:#1a56a0;border:none;padding:6px 16px;border-radius:4px;font-weight:bold;cursor:pointer;">🖨️ Imprimir / Guardar PDF</button>
</div>

<div class="header">
  <h1>Constancia de Retención en la Fuente</h1>
  <h2>República de Nicaragua — Dirección General de Ingresos (DGI)</h2>
  <div class="numero">N° ${numeroConstancia}</div>
  <div class="badge">Período: ${period}</div>
</div>

<div class="section">
  <div class="section-title">Agente Retenedor (Quien retiene)</div>
  <div class="grid">
    <div class="field"><label>Razón Social</label><span>${tenant.businessName}</span></div>
    <div class="field"><label>RUC / Cédula</label><span>${tenant.taxId || 'Por configurar'}</span></div>
    <div class="field"><label>Dirección Fiscal</label><span>${tenant.address || 'Por configurar'}</span></div>
    <div class="field"><label>Teléfono</label><span>${tenant.phone || '---'}</span></div>
    ${tenant.dgiAuthCode ? `<div class="field"><label>Código Autorización DGI</label><span>${tenant.dgiAuthCode}</span></div>` : ''}
  </div>
</div>

<div class="section">
  <div class="section-title">Sujeto Retenido (Proveedor)</div>
  <div class="grid">
    <div class="field"><label>Razón Social / Nombre</label><span>${purchase.supplier.name}</span></div>
    <div class="field"><label>RUC / Cédula</label><span>${(purchase.supplier as any).ruc || 'Por registrar'}</span></div>
    <div class="field"><label>Teléfono</label><span>${(purchase.supplier as any).phone || '---'}</span></div>
    <div class="field"><label>N° Factura del Proveedor</label><span>${purchase.invoiceNumber}</span></div>
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
        <td class="num">C$ ${totalRetenido.toFixed(2)}</td>
      </tr>
    </tbody>
  </table>
</div>

<div class="section">
  <div class="grid">
    <div class="field"><label>Fecha de Emisión</label><span>${fecha}</span></div>
    <div class="field"><label>Monto Total Factura</label><span>C$ ${Number(purchase.total).toFixed(2)}</span></div>
    <div class="field"><label>Neto a Pagar al Proveedor</label><span style="color:#1a56a0;font-size:13px;">C$ ${(Number(purchase.total) - totalRetenido).toFixed(2)}</span></div>
  </div>
</div>

<div class="footer">
  <div class="firma">
    <p>_________________________________</p>
    <p><strong>Firma y Sello del Agente Retenedor</strong></p>
    <p>${tenant.businessName}</p>
  </div>
  <div class="firma">
    <p>_________________________________</p>
    <p><strong>Firma de Recibido — Proveedor</strong></p>
    <p>${purchase.supplier.name}</p>
  </div>
</div>

<div class="legal">
  Constancia generada por Nortex ERP. Documento válido conforme Arto. 44 LCT y Arto. 73 RLCT de Nicaragua.
  El agente retenedor está obligado a entregar esta constancia al momento de efectuar el pago.
</div>

</body>
</html>`;

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);

    } catch (error) {
        console.error('Constancia error:', error);
        res.status(500).json({ error: 'Error generando constancia.' });
    }
});

// ==========================================
// 📊 SPRINT A — EXPORTACIONES FISCALES DGI
// ==========================================

// Helper: rango de fechas para un mes/año
function fiscalMonthRange(month: number, year: number) {
    const start = new Date(year, month - 1, 1, 0, 0, 0);
    const end   = new Date(year, month, 0, 23, 59, 59);
    return { start, end };
}

// ── A1: LIBRO DE VENTAS (Excel) ─────────────────────────────────────────────
// GET /api/fiscal/libro-ventas/:month/:year
app.get('/api/fiscal/libro-ventas/:month/:year', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const month = parseInt(req.params.month);
    const year  = parseInt(req.params.year);
    if (isNaN(month) || isNaN(year) || month < 1 || month > 12) {
        return res.status(400).json({ error: 'Mes o año inválido.' });
    }

    try {
        const { start, end } = fiscalMonthRange(month, year);
        const XLSX = await import('xlsx');

        const sales = await prisma.sale.findMany({
            where: { tenantId: authReq.tenantId!, createdAt: { gte: start, lte: end }, status: { not: 'VOIDED' } },
            include: { customer: true },
            orderBy: { createdAt: 'asc' },
        });

        const IVA_RATE = 0.15;
        const rows = sales.map((s, i) => {
            const total    = Number(s.total);
            const subtotal = parseFloat((total / (1 + IVA_RATE)).toFixed(2));
            const iva      = parseFloat((total - subtotal).toFixed(2));
            return {
                'N°':            i + 1,
                'Fecha':         new Date(s.createdAt).toLocaleDateString('es-NI'),
                'N° Factura':    s.invoiceNumber ? `${s.invoiceSeries || 'A'}-${String(s.invoiceNumber).padStart(6, '0')}` : 'CF',
                'Cliente':       s.customerName || s.customer?.name || 'Consumidor Final',
                'RUC/Cédula':    s.customer?.taxId || '---',
                'Método Pago':   s.paymentMethod,
                'Subtotal C$':   subtotal,
                'IVA 15% C$':    iva,
                'Total C$':      total,
            };
        });

        // Totales
        const totals = {
            'N°': '', 'Fecha': '', 'N° Factura': '', 'Cliente': 'TOTALES',
            'RUC/Cédula': '', 'Método Pago': '',
            'Subtotal C$': rows.reduce((s, r) => s + r['Subtotal C$'], 0),
            'IVA 15% C$':  rows.reduce((s, r) => s + r['IVA 15% C$'], 0),
            'Total C$':    rows.reduce((s, r) => s + r['Total C$'], 0),
        };
        rows.push(totals as any);

        const ws = XLSX.utils.json_to_sheet(rows);
        ws['!cols'] = [4, 12, 14, 28, 16, 12, 14, 14, 14].map(w => ({ wch: w }));
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
app.get('/api/fiscal/libro-compras/:month/:year', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const month = parseInt(req.params.month);
    const year  = parseInt(req.params.year);
    if (isNaN(month) || isNaN(year) || month < 1 || month > 12) {
        return res.status(400).json({ error: 'Mes o año inválido.' });
    }

    try {
        const { start, end } = fiscalMonthRange(month, year);
        const XLSX = await import('xlsx');

        const purchases = await prisma.purchase.findMany({
            where: { tenantId: authReq.tenantId!, createdAt: { gte: start, lte: end } },
            include: { supplier: true },
            orderBy: { createdAt: 'asc' },
        });

        // Retenciones del período para cruzar con compras
        const retentions = await prisma.fiscalRetention.findMany({
            where: { tenantId: authReq.tenantId!, period: `${year}-${String(month).padStart(2,'0')}` },
        });
        const irByPurchase = new Map<string, number>();
        const imiByPurchase = new Map<string, number>();
        retentions.forEach(r => {
            if (!r.purchaseId) return;
            if (r.type === 'IR_2PCT')  irByPurchase.set(r.purchaseId,  (irByPurchase.get(r.purchaseId)  || 0) + Number(r.amount));
            if (r.type === 'IMI_1PCT') imiByPurchase.set(r.purchaseId, (imiByPurchase.get(r.purchaseId) || 0) + Number(r.amount));
        });

        const rows = purchases.map((p, i) => {
            const subtotal = Number(p.subtotal);
            const iva      = Number(p.tax);
            const total    = Number(p.total);
            const ir       = irByPurchase.get(p.id)  || 0;
            const imi      = imiByPurchase.get(p.id) || 0;
            return {
                'N°':              i + 1,
                'Fecha':           new Date(p.createdAt).toLocaleDateString('es-NI'),
                'N° Factura Prov.': p.invoiceNumber,
                'Proveedor':       p.supplier.name,
                'RUC Proveedor':   (p.supplier as any).ruc || '---',
                'Subtotal C$':     subtotal,
                'IVA Crédito C$':  iva,
                'IR Ret. 2% C$':   ir,
                'IMI Ret. 1% C$':  imi,
                'Neto Pagado C$':  parseFloat((total - ir - imi).toFixed(2)),
                'Total Factura C$': total,
            };
        });

        const totals: any = {
            'N°': '', 'Fecha': '', 'N° Factura Prov.': '', 'Proveedor': 'TOTALES', 'RUC Proveedor': '',
            'Subtotal C$':     rows.reduce((s, r) => s + r['Subtotal C$'], 0),
            'IVA Crédito C$':  rows.reduce((s, r) => s + r['IVA Crédito C$'], 0),
            'IR Ret. 2% C$':   rows.reduce((s, r) => s + r['IR Ret. 2% C$'], 0),
            'IMI Ret. 1% C$':  rows.reduce((s, r) => s + r['IMI Ret. 1% C$'], 0),
            'Neto Pagado C$':  rows.reduce((s, r) => s + r['Neto Pagado C$'], 0),
            'Total Factura C$': rows.reduce((s, r) => s + r['Total Factura C$'], 0),
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
app.get('/api/fiscal/vet-export/:month/:year', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const month = parseInt(req.params.month);
    const year  = parseInt(req.params.year);
    if (isNaN(month) || isNaN(year) || month < 1 || month > 12) {
        return res.status(400).json({ error: 'Mes o año inválido.' });
    }

    try {
        const { start, end } = fiscalMonthRange(month, year);
        const IVA_RATE = 0.15;
        const period = `${year}${String(month).padStart(2, '0')}`;

        // Ventas
        const sales = await prisma.sale.findMany({
            where: { tenantId: authReq.tenantId!, createdAt: { gte: start, lte: end }, status: { not: 'VOIDED' } },
            include: { customer: true },
            orderBy: { createdAt: 'asc' },
        });

        // Compras
        const purchases = await prisma.purchase.findMany({
            where: { tenantId: authReq.tenantId!, createdAt: { gte: start, lte: end } },
            include: { supplier: true },
            orderBy: { createdAt: 'asc' },
        });

        const lines: string[] = [];
        lines.push(`# ARCHIVO VET DGI | PERIODO: ${period} | GENERADO: ${new Date().toISOString()}`);
        lines.push(`# FORMATO: TIPO|FECHA(YYYYMMDD)|N_FACTURA|RUC|NOMBRE|SUBTOTAL|IVA|TOTAL`);
        lines.push('');
        lines.push('## LIBRO DE VENTAS');

        for (const s of sales) {
            const total    = Number(s.total);
            const subtotal = parseFloat((total / (1 + IVA_RATE)).toFixed(2));
            const iva      = parseFloat((total - subtotal).toFixed(2));
            const fecha    = new Date(s.createdAt).toISOString().slice(0,10).replace(/-/g,'');
            const factura  = s.invoiceNumber
                ? `${s.invoiceSeries || 'A'}${String(s.invoiceNumber).padStart(6,'0')}`
                : 'CF';
            const nombre   = (s.customerName || s.customer?.name || 'CONSUMIDOR FINAL').toUpperCase().substring(0, 60);
            const rucV     = s.customer?.taxId || '000-000000-0000X';
            lines.push(`V|${fecha}|${factura}|${rucV}|${nombre}|${subtotal.toFixed(2)}|${iva.toFixed(2)}|${total.toFixed(2)}`);
        }

        lines.push('');
        lines.push('## LIBRO DE COMPRAS');

        for (const p of purchases) {
            const subtotal = Number(p.subtotal);
            const iva      = Number(p.tax);
            const total    = Number(p.total);
            const fecha    = new Date(p.createdAt).toISOString().slice(0,10).replace(/-/g,'');
            const nombre   = p.supplier.name.toUpperCase().substring(0, 60);
            const rucC     = (p.supplier as any).ruc || '000-000000-0000X';
            lines.push(`C|${fecha}|${p.invoiceNumber}|${rucC}|${nombre}|${subtotal.toFixed(2)}|${iva.toFixed(2)}|${total.toFixed(2)}`);
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

    // Resto de archivos estáticos (favicon, logos, etc.)
    app.use(express.static(distPath, { maxAge: 0 }));

    // SPA catch-all: cualquier ruta que no sea /api → index.html sin cache
    app.get(/^(?!\/api).+/, (req: any, res: any) => {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.sendFile(path.join(distPath, 'index.html'));
    });
    console.log(`📂 Serving static files from: ${distPath}`);
}

// ==========================================
// ⏰ CRON: EXPIRACIÓN AUTOMÁTICA DE SUSCRIPCIONES
// Corre cada hora — marca PAST_DUE a tenants con:
//   1. status ACTIVE y subscriptionEndsAt vencido (webhook de Stripe perdido)
//   2. status TRIAL y trialEndsAt vencido (14 días de prueba cumplidos)
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

// ==========================================
// 🚀 START SERVER
// ==========================================

const PORT = process.env.PORT || 3000;
app.listen(Number(PORT), '0.0.0.0', () => console.log(`🚀 Nortex Banking Core Ready :${PORT}`));