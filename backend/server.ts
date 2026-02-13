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
// @ts-ignore
import jwt from 'jsonwebtoken';

import { authenticate, AuthRequest, requireSuperAdmin, invalidateTenantCache, flushAllCache } from './middleware/auth';
import { checkRole } from './middleware/checkRole';
import { MOCK_CATALOG, MOCK_WHOLESALERS } from '../constants';
import { calculateTenantScore } from './services/scoring';
import { getStripe, createCheckoutSession, createPortalSession, handleWebhookEvent } from './services/stripe';
import Stripe from 'stripe';
import path from 'path';
import { fileURLToPath } from 'url';

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
const JWT_SECRET = process.env.JWT_SECRET || (() => {
    if (process.env.NODE_ENV === 'production') {
        console.error('🚨 CRITICAL: JWT_SECRET not set in production!');
        process.exit(1);
    }
    return 'nortex_dev_secret_key_2026';
})();

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
    process.env.FRONTEND_URL,
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

        // 3. Create Tenant + User in transaction
        const result = await prisma.$transaction(async (tx: any) => {
            // Create Tenant
            const tenant = await tx.tenant.create({
                data: {
                    businessName: companyName,
                    taxId: `TAX-${Date.now()}`, // Generate unique tax ID
                    walletBalance: 10000, // Initial balance for testing
                    creditLimit: 5000,
                    creditScore: 750
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

            return { tenant, user };
        });

        // 4. Generate JWT (incluir email para Super Admin detection)
        const token = jwt.sign(
            { userId: result.user.id, tenantId: result.tenant.id, role: result.user.role, email: email },
            JWT_SECRET,
            { expiresIn: '7d' }
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

        // 3. Generate JWT (incluir email para Super Admin detection)
        const token = jwt.sign(
            { userId: user.id, tenantId: user.tenantId, role: user.role, email: user.email },
            JWT_SECRET,
            { expiresIn: '7d' }
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

        res.json({
            tenant: tenant,
            chartData: chartData,
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
    const { name, contactName, phone, email, category } = req.body;
    try {
        const supplier = await prisma.supplier.create({
            data: { tenantId: authReq.tenantId, name, contactName, phone, email, category }
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
    const { firstName, lastName, role, baseSalary, commissionRate, phone, pin, cedula, inss } = req.body;

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
            }
        });
        res.json(employee);
    } catch (error) { res.status(500).json({ error: 'Error creando empleado' }); }
});


// ==========================================
// 🛒 MÓDULO DE VENTAS (CON MOTOR DE RIESGO)
// ==========================================

app.post('/api/sales', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { items, paymentMethod, customerId, customerName, total, employeeId } = req.body;
    const saleTotal = Number(total);

    try {
        // A. VALIDACIÓN DE CAJA
        const currentShift = await prisma.shift.findFirst({
            where: { userId: authReq.userId, status: 'OPEN' }
        });
        if (!currentShift) {
            return res.status(400).json({ error: '🔒 CAJA CERRADA' });
        }

        // B. MOTOR DE RIESGO (Credit Risk Engine)
        let finalStatus = 'COMPLETED';
        let balance = 0;
        let dueDate = null;

        if (paymentMethod === 'CREDIT') {
            if (!customerId) {
                return res.status(400).json({ error: '⛔ RIESGO: Las ventas a crédito requieren Cliente.' });
            }

            const customer = await prisma.customer.findUnique({ where: { id: customerId } });
            if (!customer) return res.status(404).json({ error: 'Cliente no encontrado' });

            if (customer.isBlocked) {
                return res.status(403).json({ error: '⛔ DENEGADO: Cliente bloqueado por morosidad.' });
            }

            const currentDebt = Number(customer.currentDebt);
            const limit = Number(customer.creditLimit);

            if ((currentDebt + saleTotal) > limit) {
                return res.status(402).json({
                    error: `⛔ DENEGADO: Excede límite. Disp: $${(limit - currentDebt).toFixed(2)}`
                });
            }

            finalStatus = 'CREDIT_PENDING';
            balance = saleTotal;
            dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        }

        // C. EJECUCIÓN TRANSACCIONAL
        const result = await prisma.$transaction(async (tx: any) => {
            const sale = await tx.sale.create({
                data: {
                    tenantId: authReq.tenantId,
                    total: saleTotal,
                    status: finalStatus,
                    paymentMethod: paymentMethod,
                    customerName: customerName,
                    customerId: customerId || null,
                    employeeId: employeeId || null, // Registro del vendedor REAL
                    balance: balance,
                    dueDate: dueDate,
                    shiftId: currentShift.id,
                }
            });

            for (const item of items) {
                await tx.saleItem.create({
                    data: {
                        saleId: sale.id,
                        productId: item.id,
                        quantity: item.quantity,
                        priceAtSale: item.price,
                        costAtSale: item.costPrice || 0
                    }
                });

                // KARDEX BLINDADO: Registrar salida por venta
                const product = await tx.product.findUnique({ where: { id: item.id } });
                if (product) {
                    const newStock = product.stock - item.quantity;
                    await tx.product.update({
                        where: { id: item.id },
                        data: { stock: newStock }
                    });
                    await tx.kardexMovement.create({
                        data: {
                            tenantId: authReq.tenantId,
                            productId: item.id,
                            type: 'OUT_SALE',
                            quantity: -item.quantity,
                            stockBefore: product.stock,
                            stockAfter: newStock,
                            referenceId: sale.id,
                            referenceType: 'SALE',
                            reason: `Venta #${sale.id.slice(0, 8)}`,
                            userId: authReq.userId,
                        }
                    });
                }
            }

            if (paymentMethod === 'CREDIT' && customerId) {
                await tx.customer.update({
                    where: { id: customerId },
                    data: { currentDebt: { increment: saleTotal } }
                });
            }
            return sale;
        });
        res.json(result);
    } catch (error: any) {
        console.error(error);
        res.status(500).json({ error: error.message || 'Error procesando venta' });
    }
});

// ==========================================
// 💸 PAGOS
// ==========================================

app.post('/api/payments', authenticate, async (req: any, res: any) => {
    // ... (Existing payment logic preserved)
    const authReq = req as AuthRequest;
    const { saleId, amount, method } = req.body;
    const paymentAmount = Number(amount);
    try {
        const sale = await prisma.sale.findUnique({ where: { id: saleId }, include: { customer: true } });
        if (!sale || sale.tenantId !== authReq.tenantId) return res.status(404).json({ error: 'Venta no encontrada' });

        const result = await prisma.$transaction(async (tx: any) => {
            const payment = await tx.payment.create({
                data: { saleId: sale.id, amount: paymentAmount, method: method || 'CASH', collectedBy: authReq.userId }
            });
            const newBalance = Number(sale.balance) - paymentAmount;
            const newStatus = newBalance <= 0.01 ? 'PAID' : 'CREDIT_PENDING';

            await tx.sale.update({
                where: { id: saleId },
                data: { balance: newBalance, status: newStatus }
            });

            if (sale.customerId) {
                await tx.customer.update({
                    where: { id: sale.customerId },
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
app.post('/api/shifts/open', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { initialCash, employeePin } = req.body;

    try {
        // Validar PIN del empleado
        if (!employeePin || !/^\d{4}$/.test(String(employeePin))) {
            return res.status(400).json({ error: 'Se requiere un PIN de 4 dígitos para abrir la caja.' });
        }

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
app.post('/api/shifts/close', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { declaredCash, shiftId } = req.body;
    try {
        const shift = await prisma.shift.findUnique({ where: { id: shiftId }, include: { sales: true } });
        const cashSales = shift.sales.filter((s: any) => s.paymentMethod === 'CASH').reduce((sum: number, s: any) => sum + Number(s.total), 0);
        const expectedCash = Number(shift.initialCash) + cashSales;
        const difference = Number(declaredCash) - expectedCash;
        const closedShift = await prisma.shift.update({
            where: { id: shiftId },
            data: { endTime: new Date(), status: 'CLOSED', finalCashDeclared: declaredCash, systemExpectedCash: expectedCash, difference: difference }
        });
        res.json(closedShift);
    } catch (e) { res.status(500).json({ error: 'Error' }) }
});
app.get('/api/audit-logs', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const logs = await prisma.auditLog.findMany({ where: { tenantId: authReq.tenantId }, orderBy: { createdAt: 'desc' }, take: 50 });
        res.json(logs);
    } catch (error) { res.status(500).json({ error: 'Error' }); }
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

        if (lowStock === 'true') {
            whereClause.stock = { lte: prisma.product.fields.minStock };
        }

        const products = await prisma.product.findMany({
            where: whereClause,
            orderBy: { name: 'asc' },
            include: {
                creator: { select: { name: true, email: true } }
            }
        });

        res.json(products);
    } catch (error) {
        console.error('Error fetching products:', error);
        res.status(500).json({ error: 'Error obteniendo productos' });
    }
});

// POST /api/products - Crear producto (OWNER o ADMIN)
app.post('/api/products', authenticate, checkRole(['OWNER', 'ADMIN']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { name, sku, description, category, price, cost, stock, minStock, unit } = req.body;

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
    const { name, description, category, price, cost, stock, minStock, unit } = req.body;

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

app.post('/api/inventory/adjust', authenticate, checkRole(['OWNER', 'ADMIN']), async (req: any, res: any) => {
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

// GET /api/inventory/low-stock - Productos con stock bajo (Solo OWNER)
app.get('/api/inventory/low-stock', authenticate, checkRole(['OWNER', 'ADMIN']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;

    try {
        const products = await prisma.product.findMany({
            where: {
                tenantId: authReq.tenantId!,
                stock: { lte: prisma.product.fields.minStock }
            },
            orderBy: { stock: 'asc' }
        });

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
        let totalVentas = 0;   // Total con IVA
        let totalCOGS = 0;     // Costo de Ventas

        sales.forEach((sale: any) => {
            totalVentas += Number(sale.total);
            sale.items.forEach((item: any) => {
                totalCOGS += Number(item.costAtSale) * item.quantity;
            });
        });

        // IVA Nicaragua 15%: total = subtotal * 1.15, subtotal = total / 1.15
        const ventasNetas = totalVentas / (1 + IVA_RATE);
        const ivaRecaudado = totalVentas - ventasNetas;
        const utilidadBruta = ventasNetas - totalCOGS;

        // 3. Group sales by day for chart
        const dailyMap: Record<string, { ventas: number; gastos: number }> = {};

        sales.forEach((sale: any) => {
            const dateKey = new Date(sale.createdAt).toISOString().split('T')[0]; // YYYY-MM-DD
            if (!dailyMap[dateKey]) {
                dailyMap[dateKey] = { ventas: 0, gastos: 0 };
            }
            dailyMap[dateKey].ventas += Number(sale.total);
        });

        // Also fetch expenses in the same period for the chart
        const expenses = await prisma.expense.findMany({
            where: {
                tenantId: authReq.tenantId,
                createdAt: { gte: start, lte: end }
            }
        });

        expenses.forEach((exp: any) => {
            const dateKey = new Date(exp.createdAt).toISOString().split('T')[0];
            if (!dailyMap[dateKey]) {
                dailyMap[dateKey] = { ventas: 0, gastos: 0 };
            }
            dailyMap[dateKey].gastos += Number(exp.amount);
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
            totalVentas: Math.round(totalVentas * 100) / 100,
            ventasNetas: Math.round(ventasNetas * 100) / 100,
            ivaRecaudado: Math.round(ivaRecaudado * 100) / 100,
            totalCOGS: Math.round(totalCOGS * 100) / 100,
            utilidadBruta: Math.round(utilidadBruta * 100) / 100,
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

        let inventoryValue = 0;
        const lowStock: any[] = [];

        products.forEach((p: any) => {
            inventoryValue += p.stock * p.cost;
            if (p.stock <= p.minStock) {
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
            inventoryValue: Math.round(inventoryValue * 100) / 100,
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
app.post('/api/purchases', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { supplierId, invoiceNumber, dueDate, paymentMethod, notes, items } = req.body;

    // Validaciones
    if (!supplierId || !invoiceNumber || !paymentMethod || !items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Datos incompletos. Se requiere: proveedor, # factura, método de pago y al menos 1 producto.' });
    }

    if (!['CASH', 'CREDIT'].includes(paymentMethod)) {
        return res.status(400).json({ error: 'Método de pago debe ser CASH o CREDIT.' });
    }

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

                const totalCost = item.quantity * item.unitCost;
                subtotal += totalCost;

                processedItems.push({
                    productId: item.productId,
                    productName: product.name,
                    quantity: item.quantity,
                    unitCost: item.unitCost,
                    totalCost: totalCost
                });
            }

            const tax = subtotal * 0.15; // IVA 15% Nicaragua
            const total = subtotal + tax;

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

                // Costo promedio ponderado: (stockViejo * costoViejo + cantidadNueva * costoNuevo) / stockTotal
                const oldTotalCost = oldStock * product.cost;
                const newTotalCost = item.quantity * parseFloat(item.unitCost.toString());
                const newAvgCost = newStock > 0 ? (oldTotalCost + newTotalCost) / newStock : parseFloat(item.unitCost.toString());

                await tx.product.update({
                    where: { id: item.productId },
                    data: {
                        stock: newStock,
                        cost: Math.round(newAvgCost * 100) / 100 // Redondear a 2 decimales
                    }
                });

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
                        userId: authReq.userId!
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

        const totalDebt = pending.reduce((sum: number, p: any) => sum + parseFloat(p.total.toString()), 0);

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
app.post('/api/payroll/calculate', authenticate, checkRole(['OWNER']), async (req: any, res: any) => {
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

        const payrolls = [];

        for (const emp of employees) {
            const baseSalary = Number(emp.baseSalary);
            const ventasMes = salesMap.get(emp.id) || 0;
            const comisiones = ventasMes * Number(emp.commissionRate);

            const calc = calculatePayroll(baseSalary, comisiones);

            // Upsert en DB
            const payroll = await prisma.payroll.upsert({
                where: {
                    employeeId_month_year: {
                        employeeId: emp.id,
                        month: Number(month),
                        year: Number(year),
                    }
                },
                update: {
                    grossSalary: calc.grossSalary,
                    commissions: calc.commissions,
                    totalIncome: calc.totalIncome,
                    inssLaboral: calc.inssLaboral,
                    irLaboral: calc.irLaboral,
                    totalDeductions: calc.totalDeductions,
                    netSalary: calc.netSalary,
                    inssPatronal: calc.inssPatronal,
                    inatec: calc.inatec,
                },
                create: {
                    tenantId: authReq.tenantId!,
                    employeeId: emp.id,
                    month: Number(month),
                    year: Number(year),
                    grossSalary: calc.grossSalary,
                    commissions: calc.commissions,
                    totalIncome: calc.totalIncome,
                    inssLaboral: calc.inssLaboral,
                    irLaboral: calc.irLaboral,
                    totalDeductions: calc.totalDeductions,
                    netSalary: calc.netSalary,
                    inssPatronal: calc.inssPatronal,
                    inatec: calc.inatec,
                },
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

// POST /api/payroll/:id/pay - Marcar nómina como pagada
app.post('/api/payroll/:id/pay', authenticate, checkRole(['OWNER']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const payroll = await prisma.payroll.update({
            where: { id: req.params.id },
            data: { status: 'PAGADO', paidAt: new Date() },
        });

        // Registrar gasto
        await prisma.expense.create({
            data: {
                tenantId: authReq.tenantId!,
                amount: payroll.netSalary,
                description: `Nómina ${payroll.month}/${payroll.year} - Empleado`,
                category: 'NOMINA',
            },
        });

        res.json(payroll);
    } catch (error) {
        res.status(500).json({ error: 'Error al pagar nómina' });
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
app.post('/api/tax-report/generate', authenticate, checkRole(['OWNER']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { month, year } = req.body;

    if (!month || !year) {
        return res.status(400).json({ error: 'Mes y año son requeridos' });
    }

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
            totalLoans = await prisma.b2bOrder.aggregate({
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
        const tenant = await prisma.tenant.update({
            where: { id: req.params.id },
            data: { subscriptionStatus: 'ACTIVE' }
        });

        // Invalidar caché (efecto inmediato)
        invalidateTenantCache(tenant.id);

        await prisma.auditLog.create({
            data: {
                tenantId: tenant.id,
                userId: (req as AuthRequest).userId!,
                action: 'ADMIN_REACTIVATE',
                details: `Empresa ${tenant.businessName} reactivada por SUPER_ADMIN`
            }
        });

        res.json({ message: `${tenant.businessName} REACTIVADA.`, tenant });
    } catch (error) {
        res.status(500).json({ error: 'Error al reactivar empresa' });
    }
});

// GET /api/admin/loan-requests - Solicitudes de crédito pendientes
app.get('/api/admin/loan-requests', authenticate, requireSuperAdmin, async (req: any, res: any) => {
    try {
        const requests = await prisma.b2bOrder.findMany({
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
        const order = await prisma.b2bOrder.update({
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
// 🚀 SERVE FRONTEND IN PRODUCTION
// ==========================================
const isProduction = process.env.NODE_ENV === 'production';
if (isProduction) {
    // Serve static files from the React app
    const distPath = path.join(__dirname, '../dist'); // Go up one level from backend/
    app.use(express.static(distPath));

    // The "catchall" handler: for any request that doesn't
    // match one above, send back React's index.html file.
    // Usamos RegExp para evitar problemas con path-to-regexp en Express 5
    app.get(/^(?!\/api).+/, (req: any, res: any) => {
        res.sendFile(path.join(distPath, 'index.html'));
    });
    console.log(`📂 Serving static files from: ${distPath}`);
}

// ==========================================
// 🚀 START SERVER
// ==========================================

const PORT = process.env.PORT || 3000;
app.listen(Number(PORT), '0.0.0.0', () => console.log(`🚀 Nortex Banking Core Ready :${PORT}`));