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
import {
    ACCOUNTING_READ_ROLES,
    CUSTOMER_CREATE_ROLES,
    CUSTOMER_INTERACTION_WRITE_ROLES,
    CUSTOMER_PAYMENT_ROLES,
    CUSTOMER_HUB_READ_ROLES,
    CUSTOMER_READ_ROLES,
    CUSTOMER_UPDATE_ROLES,
    isCustomerCreateAuthorized,
    isCustomerUpdateAuthorized,
    POS_SALE_ROLES,
    PURCHASE_PAYMENT_ROLES,
    PURCHASE_READ_ROLES,
    PURCHASE_WRITE_ROLES,
    QUOTATION_READ_ROLES,
    QUOTATION_WRITE_ROLES,
    RETURN_SEARCH_ROLES,
    resolveCustomerSellerIdForCreate,
} from './middleware/accessPolicies';
import { sendPasswordResetEmail, sendWelcomeEmail, sendManualPaymentAlert } from './services/email';
import { runLifecycleEmails } from './services/lifecycleEmails';
import crypto from 'crypto';
import { checkRole } from './middleware/checkRole';
import { BODEGUERO_ROLE, redactBodegueroProduct } from './security/bodegueroPolicy';
import { calculateTenantScore } from './services/scoring';
import { ESTADO_ANULADA, puedeAnularse, planDeReversion, textoUtil } from './services/saleCancellation';
import { isSameManaguaBusinessDay } from './lib/saleCorrections';
import {
    pagarFacturaProveedorEnCaja,
    registrarSalidaDeCajaPorCompra,
    SupplierPaymentError as CashSupplierPaymentError,
    MENSAJE_SIN_CAJA_ABIERTA,
} from './services/supplierPayment';
import { decidirIdentidadCajero, pinNormalizado, explicarModo } from './services/shiftIdentity';
import { closeShiftWithReport, ShiftCloseError } from './services/shiftCloseService';
import { recordSale, recordPayment, recordPurchase, recordExpense, recordCashIn, recordCashMovement, recordFixedAssetAcquisition, recordReturn, recordPayroll, recordLaborProvision, recordAguinaldoPayment, recordSettlement, recordStockCountAdjustment, recordBadDebt, seedChartOfAccounts, getBalanceGeneral, getEstadoResultados, createJournalEntry, buildSaleJournalLines, assertPeriodOpen, PeriodLockedError } from './services/accounting';
import { composeSeedCatalog } from './data/seedCatalogs';
import { runDepreciationForTenant, runMonthlyDepreciationAllTenants, VIDA_UTIL_DEFAULT } from './services/depreciation';
import { getStripe, createCheckoutSession, createPortalSession, handleWebhookEvent, PLAN_PRICE_USD, requiereConfirmacionDePagoCorto, calcularNuevoVencimiento } from './services/stripe';
import { executeSale, SaleError } from './services/salesService';
import { executeSupplierPaymentTransaction } from './services/supplierPaymentService';
import { executeProcurementMatch } from './services/procurementMatchService';
import {
    applyLinkedPurchaseSalePriceIntents,
    buildPurchaseSalePriceChange,
    canSetPurchaseSalePrice,
    createPurchaseSalePriceAudits,
    hasPurchaseSalePriceIntent,
    PurchaseSalePriceError,
    resolvePurchaseSalePriceIntents,
} from './services/purchaseSalePriceService';
import {
    applyBatchWarehouseDelta,
    BatchWarehouseLedgerError,
    resolveBatchWarehouseLedgerMode,
} from './services/productBatchWarehouseLedgerService';
import {
    applyProductBatchHoldDelta,
    ProductBatchHoldError,
} from './services/productBatchHoldService';
import {
    MAX_PHARMACY_AVAILABILITY_PRODUCTS,
    PharmacyAvailabilityError,
    resolvePharmacyProductAvailability,
} from './services/pharmacyAvailabilityService';
import { calcularPulso, claveDelDiaManagua, inicioDelDiaManagua, MANAGUA_UTC_OFFSET_HOURS } from './services/pulsoPos';
import {
    BatchRestorationError,
    restoreSaleItemBatchesForReturn,
    type BatchRestorationResult,
} from './services/saleBatchAllocationService.js';
import {
    allowedReturnRefundMethods,
    assertMatchingReturnReplay,
    buildReturnAvailability,
    buildReturnPayloadHash,
    planReturnBatchRestoration,
    resolveReturnRefundMethod,
    resolveReturnWarehouseId,
    resolveRequestedReturnItems,
    ReturnResolutionError,
    type ReturnBatchRestorationPlan,
    type ReturnProductAuthority,
    type ReturnSaleItemSnapshot,
} from './services/returnService';
import { applyStockDelta, asegurarBodegaPorDefecto, materializeWarehouseRow, resolveOperationalWarehouse, StockError, weightedAverageCost } from './services/stockService';
import { appendSignedCashMovement, verifyTenantLedger, appendDriverWalletMovement, verifyDriverLedger } from './services/ledger';
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
import suppliersRouter from './routes/suppliers';
import procurementMatchesRouter from './routes/procurementMatches';
import serialsRouter from './routes/serials';
import warehousesRouter from './routes/warehouses';
import stockTransfersRouter from './routes/stockTransfers';
import batchWarehouseLedgerRouter from './routes/batchWarehouseLedger';
import pharmacyInventorySettingsRouter from './routes/pharmacyInventorySettings';
import syncRoutes from './routes/sync';
import scaleLabelsRouter, { scaleDevicesRouter } from './routes/scaleLabels';
import tenantCapabilitiesRouter from './routes/tenantCapabilities';
import agentBankingRouter from './routes/agentBanking';
import saleCorrectionsRouter from './routes/saleCorrections';
import salesReportsRouter from './routes/salesReports.js';
import Decimal from 'decimal.js';
import { z } from 'zod';
import { normalizeCalendarDateInput } from './lib/calendarDate';
import {
    daysSinceManaguaCivilDate,
    managuaBusinessDate,
    managuaCalendarDateFloor,
    parseManaguaCivilDateInput,
} from './lib/managuaBusinessDate';
import {
    assertProductBatchExpiryIdentity,
    ProductBatchIdentityError,
} from './lib/productBatchIdentity';
import {
    QuotationItemError,
    resolveQuotationItems,
    serializeQuotationItemsForClient,
    type QuotationProductAuthority,
} from './lib/quotationItems';
import { calculatePurchaseOrderInvoiceAvailability } from './lib/purchaseOrderAvailability';
import { calculatePurchaseMoney } from './lib/purchaseMoney';
import {
    assertAggregateBatchMutationAllowed,
    assertBatchTrackingTransitionAllowed,
    assertManualBatchReplay,
    buildManualBatchCommandId,
    buildManualBatchPayloadHash,
    buildManualBatchRelatedId,
    ManualBatchMovementError,
    parseManualBatchCommandClaim,
    type ManualBatchCommandType,
} from './lib/manualBatchMovements';
import { normalizeBatchWarehouseLedgerMode } from './lib/batchWarehouseLedger';
import { CUSTOMER_RETURN_HOLD_REASON_CODE } from './lib/productBatchHold';
import { buildPharmacyExpiryAlert } from './lib/pharmacyExpiryAlerts';
import { ProcurementMatchError } from './lib/procurementMatch';
import {
    PURCHASE_FISCAL_STATUSES,
    PURCHASE_PAYABLE_STATUSES,
    resolveEffectiveSupplierBalance,
    SupplierPaymentError as PayableSupplierPaymentError,
} from './lib/supplierPayments';
import { escapeHtml, fiscalPreviewCsp } from './lib/htmlSecurity';
import {
    resolveReturnShiftAttribution,
    ReturnShiftAttributionError,
} from './lib/returnShiftAttribution';
import {
    publicOrderItemsForQuotation,
    PublicOrderItemError,
    resolvePublicOrderItems,
    type PublicOrderProductAuthority,
} from './services/publicOrderItemService.js';
import {
    FISCAL_REPORT_ROLES,
    fiscalCivilDate,
    fiscalPurchaseScope,
    fiscalRetentionScope,
    parseFiscalPeriod,
} from './lib/fiscalAccess';
import { fiscalMonthRange } from './services/nicaTax';
import {
    validate,
    CreateReturnSchema,
    CancelSaleSchema,
    CreatePaymentSchema,
    SupplierPaymentRequestSchema,
    CreateCashMovementSchema,
    CreatePurchaseSchema,
    InventoryAdjustSchema,
    CreateProductSchema,
    UpdateProductSchema,
    PublicCatalogQuerySchema,
    BulkImportProductsSchema,
    BulkEditProductsSchema,
    CreateBatchSchema,
    WriteoffBatchSchema,
    CreateStockCountSchema,
    RecordCountSchema,
    OpenShiftSchema,
    CloseShiftSchema,
    canonicalizeCloseShiftPayload,
    CreateExpenseSchema,
    B2BOrderSchema,
    PayrollCalculateSchema,
    TaxReportSchema,
    RegisterSchema,
    LoginSchema,
    ResetPasswordSchema,
    KardexRecordSchema,
    UpdateFiscalSettingsSchema,
    CreateRetencionSufridaSchema,
} from './validation/schemas.js';
import {
    assertBaseUnitChangeAllowed,
    validateQuantity,
    QuantityValidationError,
    type SaleMode,
} from '../utils/quantity.js';
import {
    matchesCustomerHubSegment,
    resolveCustomerHubNextAction,
    resolveCustomerHubSegment,
} from '../utils/customerHub.js';
import { resolvePurchaseLine } from '../utils/purchasePackaging.js';
import {
    FISCAL_REGIME_CUOTA_FIJA,
    normalizeFiscalRegime,
    vatCollectedFromSale,
} from '../utils/fiscalRegime.js';
import {
    normalizeTenantCapabilities,
    suggestedCapabilitiesForBusinessType,
} from '../utils/tenantCapabilities.js';
import { isPlaceholderTaxId } from '../utils/tenantTaxId.js';

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
app.use('/api/suppliers', suppliersRouter); // Proveedor 360, contactos y metadata documental
app.use('/api/procurement/matches', procurementMatchesRouter); // Conciliación OC-recepción-factura
app.use('/api/serials', serialsRouter); // Control de series (números de serie por unidad)
app.use('/api/warehouses', warehousesRouter); // Multi-bodega (Fase 2: fundación)
app.use('/api/stock-transfers', stockTransfersRouter); // Transferencias entre bodegas (Fase 3)
app.use('/api/batch-warehouse-ledger', batchWarehouseLedgerRouter);
app.use('/api/tenant/pharmacy-inventory-settings', pharmacyInventorySettingsRouter);
app.use('/api/loans', loanRoutes);
app.use('/api/sales/sync', syncRoutes);
app.use('/api/scale-labels', scaleLabelsRouter);
app.use('/api/scale-devices', scaleDevicesRouter);
app.use('/api/tenant/capabilities', tenantCapabilitiesRouter);
app.use('/api/agent-banking', agentBankingRouter); // Agente bancario (corresponsalía en caja)
app.use('/api', saleCorrectionsRouter); // Historial, aprobaciones, reembolsos e inspecciones de venta
app.use('/api/reports', salesReportsRouter); // Ventas integrales y snapshots inmutables de cierre

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
    const { companyName, email, password, type, phone, capabilities } = req.body;
    const resolvedType = type || 'FERRETERIA';
    const selectedCapabilities = normalizeTenantCapabilities(
        capabilities ?? suggestedCapabilitiesForBusinessType(resolvedType),
    );
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
                    type: resolvedType,
                    // UUID evita colisión cuando dos registros llegan en el
                    // mismo milisegundo; sigue siendo un marcador, no un RUC.
                    taxId: `TAX-${crypto.randomUUID()}`,
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

            if (selectedCapabilities.length > 0) {
                await tx.tenantCapability.createMany({
                    data: selectedCapabilities.map((code) => ({ tenantId: tenant.id, code })),
                    skipDuplicates: true,
                });
            }

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
        const tenant = await prisma.tenant.findUnique({
            where: { id: tenantId },
            select: {
                type: true,
                tenantCapabilities: { select: { code: true } },
            },
        });
        if (!tenant) return res.status(404).json({ error: 'Negocio no encontrado' });

        const capabilityCodes = tenant.tenantCapabilities.map((entry) => entry.code);
        const catalog = composeSeedCatalog(tenant.type, capabilityCodes);
        if (!catalog || catalog.length === 0) {
            return res.status(400).json({ error: 'Tu giro no tiene un catálogo de ejemplo disponible.' });
        }

        const batchWarehouseLedgerMode = await resolveBatchWarehouseLedgerMode(prisma, tenantId);
        for (const sample of catalog) {
            assertAggregateBatchMutationAllowed({
                mode: batchWarehouseLedgerMode,
                requiresBatchTracking: sample.requiresBatchTracking === true,
                delta: sample.stock,
                // El seed histórico crea ProductBatch, pero todavía no tiene un
                // comando lote+bodega idempotente; activo queda fail-closed.
                hasExplicitBatch: false,
            });
        }

        // Guard anti-duplicado: solo sembramos con el inventario en cero.
        const existing = await prisma.product.count({ where: { tenantId } });
        if (existing > 0) {
            return res.status(409).json({ error: 'Ya tenés productos cargados; el catálogo de ejemplo es solo para empezar de cero.' });
        }

        if (catalog.some((product) => product.stock > 0)) {
            // `applyStockDelta` necesita la ubicación operativa ya materializada;
            // se crea fuera de la tx para evitar la carrera de primer uso MySQL.
            await asegurarBodegaPorDefecto(prisma, tenantId);
        }

        const createdCount = await prisma.$transaction(async (tx: any) => {
            const authoritativeBatchMode = await resolveBatchWarehouseLedgerMode(tx, tenantId);
            for (const sample of catalog) {
                assertAggregateBatchMutationAllowed({
                    mode: authoritativeBatchMode,
                    requiresBatchTracking: sample.requiresBatchTracking === true,
                    delta: sample.stock,
                });
            }
            let count = 0;
            const now = new Date();

            for (let i = 0; i < catalog.length; i += 1) {
                const sample = catalog[i];
                const sku = `EJ-${tenant.type.slice(0, 3).toUpperCase()}-${String(i + 1).padStart(3, '0')}`;
                const product = await tx.product.create({
                    data: {
                        tenantId,
                        name: sample.name,
                        sku,
                        category: sample.category,
                        price: sample.price,
                        cost: sample.cost,
                        // El agregado y la bodega se mueven juntos abajo; crear la
                        // fila ya cargada volvería a sumar la existencia dos veces.
                        stock: 0,
                        unit: sample.unit ?? 'unidad',
                        saleMode: sample.saleMode ?? null,
                        quantityStep: sample.quantityStep ?? null,
                        productFamily: sample.productFamily ?? null,
                        packUnit: sample.packUnit ?? null,
                        packSize: sample.packSize ?? null,
                        packPrice: sample.packPrice ?? null,
                        requiresBatchTracking: sample.requiresBatchTracking ?? false,
                        createdBy: authReq.userId!,
                    },
                });

                if (sample.stock > 0) {
                    const stock = await applyStockDelta(tx, {
                        tenantId,
                        productId: product.id,
                        delta: sample.stock,
                        enforceSufficient: false,
                    });
                    await tx.kardexMovement.create({
                        data: {
                            tenantId,
                            productId: product.id,
                            type: 'IN',
                            quantity: sample.stock,
                            stockBefore: stock.stockBefore,
                            stockAfter: stock.stockAfter,
                            referenceType: 'INITIAL',
                            reason: 'Catálogo de ejemplo',
                            userId: authReq.userId!,
                            warehouseId: stock.warehouseId,
                        },
                    });

                    if (sample.requiresBatchTracking) {
                        const shelfLifeDays = sample.productFamily === 'MEAT' || sample.productFamily === 'POULTRY'
                            ? 14
                            : 365;
                        await tx.productBatch.create({
                            data: {
                                tenantId,
                                productId: product.id,
                                batchNumber: `EJEMPLO-${String(i + 1).padStart(3, '0')}`,
                                expiryDate: new Date(now.getTime() + shelfLifeDays * 24 * 60 * 60 * 1000),
                                stock: sample.stock,
                            },
                        });
                    }
                }
                count += 1;
            }

            await tx.auditLog.create({
                data: {
                    tenantId,
                    userId: authReq.userId!,
                    action: 'SEED_CATALOG',
                    details: JSON.stringify({
                        type: tenant.type,
                        capabilities: capabilityCodes,
                        count,
                        source: 'EXAMPLE_DATA',
                    }),
                },
            });
            return count;
        });

        res.json({ message: `Cargamos ${createdCount} productos de ejemplo. Editalos, borralos o sumá los tuyos.`, count: createdCount });
    } catch (error) {
        if (manualBatchErrorResponse(res, error)) return;
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
        const capabilityRows = isLender
            ? []
            : await prisma.tenantCapability.findMany({
                where: { tenantId },
                select: { code: true },
            });
        const capabilities = new Set(capabilityRows.map(row => row.code));
        const wantsMeasured = tenant.type === 'CARNICERIA_POLLERIA'
            || capabilities.has('CARNES_AVES')
            || capabilities.has('ALIMENTO_ANIMAL');
        const wantsPack = tenant.type === 'AGROPECUARIA'
            || capabilities.has('ALIMENTO_ANIMAL')
            || capabilities.has('MAYOREO');
        const wantsBatch = capabilities.has('PERECEDEROS')
            || capabilities.has('CARNES_AVES');

        // Conteos reales (alcance: este negocio). Los préstamos del prestamista se
        // identifican por lenderId; el Employee del dueño se crea al registrarse,
        // por eso "equipo" = más de 1 empleado.
        const [products, sales, customers, employees, lenderLoans, measuredProducts, packedProducts, batches] = await Promise.all([
            prisma.product.count({ where: { tenantId } }),
            prisma.sale.count({ where: { tenantId } }),
            prisma.customer.count({ where: { tenantId } }),
            prisma.employee.count({ where: { tenantId } }),
            isLender ? prisma.loan.count({ where: { lenderId: tenantId } }) : Promise.resolve(0),
            wantsMeasured
                ? prisma.product.count({ where: { tenantId, saleMode: 'MEASURED' } })
                : Promise.resolve(0),
            wantsPack
                ? prisma.product.count({ where: { tenantId, packUnit: { not: null }, packSize: { gt: 0 } } })
                : Promise.resolve(0),
            wantsBatch
                ? prisma.productBatch.count({ where: { tenantId } })
                : Promise.resolve(0),
        ]);

        // El registro siembra un taxId placeholder "TAX-<uuid>" (y existen
        // filas legacy TAX-<timestamp>); el paso solo
        // se completa cuando el dueño guarda su RUC real (Configuración DGI).
        const hasFiscal = !!(
            tenant.taxId &&
            String(tenant.taxId).trim() &&
            !isPlaceholderTaxId(tenant.taxId)
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
                // Activación retail = tres resultados concretos. Equipo y DGI
                // siguen disponibles en contexto, pero ya no compiten con la
                // primera venta ni convierten el onboarding en una configuración
                // de ERP antes de que la persona reciba valor.
                {
                    key: 'product',
                    label: wantsMeasured ? 'Configurá tu primer producto por peso o medida' : 'Agregá tu primer producto',
                    done: wantsMeasured ? measuredProducts > 0 : products > 0,
                    href: '/app/inventory',
                    cta: 'Configurar',
                },
                ...(wantsPack ? [{
                    key: 'pack',
                    label: 'Registrá una presentación por empaque o saco',
                    done: packedProducts > 0,
                    href: '/app/inventory',
                    cta: 'Configurar empaque',
                }] : []),
                ...(wantsBatch ? [{
                    key: 'batch',
                    label: 'Registrá tu primer lote y vencimiento',
                    done: batches > 0,
                    href: '/app/inventory',
                    cta: 'Registrar lote',
                }] : []),
                { key: 'sale',      label: 'Hacé tu primera venta',     done: sales > 0,     href: '/app/pos?first_sale=1', cta: 'Vender' },
                { key: 'customer',  label: 'Registrá un cliente',       done: customers > 0, href: '/app/clients',          cta: 'Agregar' },
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
                where: { tenantId: authReq.tenantId!, createdAt: { gte: hoy0 }, status: { not: ESTADO_ANULADA } },
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
                WHERE \`tenantId\` = ${authReq.tenantId} AND createdAt >= ${hace45} AND status <> ${ESTADO_ANULADA}
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
                createdAt: { gte: sevenDaysAgo },
                status: { not: ESTADO_ANULADA },
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
                status: { not: ESTADO_ANULADA },
            },
            select: {
                total: true,
                exemptTotal: true,
                fiscalRegimeAtSale: true,
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
                fiscalRegimeAtSale: s.fiscalRegimeAtSale,
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
const CustomerOptionalText = (maxLength: number) => z.union([
    z.string().trim().max(maxLength),
    z.null(),
]).optional();
const CustomerOptionalEmail = z.union([
    z.string().trim().max(160).email('Ingresá un correo válido'),
    z.literal(''),
    z.null(),
]).optional();
const CustomerCreditLimit = z
    .union([z.string(), z.number()])
    .transform((value) => String(value).trim())
    .superRefine((value, ctx) => {
        if (value === '') {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'El límite de crédito es requerido cuando se envía' });
            return;
        }
        try {
            const amount = new Decimal(value);
            if (!amount.isFinite() || amount.isNegative()) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'El límite de crédito debe ser un número mayor o igual a 0' });
            } else if (amount.decimalPlaces() > 2) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'El límite de crédito admite como máximo 2 decimales' });
            } else if (amount.greaterThan('99999999.99')) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'El límite de crédito excede el máximo permitido' });
            }
        } catch {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'El límite de crédito debe ser un decimal válido' });
        }
    });

const CustomerInteractionType = z.enum(['NOTE', 'CALL', 'WHATSAPP', 'VISIT', 'PROMISE']);
const CustomerInteractionStatus = z.enum(['OPEN', 'COMPLETED', 'CANCELLED']);
const CustomerInteractionMoney = z.union([z.string(), z.number()])
    .transform((value) => String(value).trim())
    .superRefine((value, ctx) => {
        try {
            const amount = new Decimal(value);
            if (!amount.isFinite() || !amount.greaterThan(0)) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'La promesa debe ser mayor que cero' });
            } else if (amount.decimalPlaces() > 2 || amount.greaterThan('99999999.99')) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'La promesa no cabe en el rango monetario permitido' });
            }
        } catch {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'La promesa debe ser un decimal válido' });
        }
    });

const CreateCustomerSchema = z.object({
    name: z.string().trim().min(1, 'El nombre es requerido').max(160),
    taxId: CustomerOptionalText(80),
    phone: CustomerOptionalText(40),
    address: CustomerOptionalText(240),
    email: CustomerOptionalEmail,
    creditLimit: CustomerCreditLimit.optional(),
    isWholesale: z.boolean().optional(),
    sellerId: z.string().min(1).nullable().optional(),
});

const UpdateCustomerSchema = z.object({
    name: z.string().trim().min(1, 'El nombre es requerido').max(160).optional(),
    taxId: CustomerOptionalText(80),
    phone: CustomerOptionalText(40),
    email: CustomerOptionalEmail,
    address: CustomerOptionalText(240),
    creditLimit: CustomerCreditLimit.optional(),
    isBlocked: z.boolean().optional(),
    isWholesale: z.boolean().optional(),
    sellerId: z.string().min(1).nullable().optional(),
}).refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Indicá al menos un cambio',
    path: ['_form'],
});

const CreateCustomerInteractionSchema = z.object({
    type: CustomerInteractionType,
    note: z.string().trim().min(2, 'Escribí el resultado de la gestión').max(2000),
    promisedAmount: CustomerInteractionMoney.nullable().optional(),
    promisedAt: z.string().datetime({ offset: true }).nullable().optional(),
    followUpAt: z.string().datetime({ offset: true }).nullable().optional(),
}).superRefine((value, ctx) => {
    if (value.type === 'PROMISE' && !value.promisedAt) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['promisedAt'], message: 'Indicá cuándo prometió pagar' });
    }
    if (value.type !== 'PROMISE' && value.promisedAmount != null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['promisedAmount'], message: 'El monto solo aplica a promesas de pago' });
    }
});

const UpdateCustomerInteractionSchema = z.object({
    status: CustomerInteractionStatus,
}).refine((value) => value.status !== 'OPEN', {
    message: 'Una gestión abierta solo puede completarse o cancelarse',
});

function normalizeOptionalCustomerText(value: unknown): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const text = String(value).trim();
    return text === '' ? null : text;
}

function startOfTodayManaguaBusiness(asOf: Date = new Date()) {
    return managuaBusinessDate(asOf);
}

function formatCustomerMoney(value: Decimal.Value | null | undefined) {
    return new Decimal(value ?? 0).toDecimalPlaces(2).toNumber();
}

function customerSearchWhere(searchRaw: unknown) {
    const search = typeof searchRaw === 'string' ? searchRaw.trim() : '';
    if (!search) return {};
    return {
        OR: [
            { name: { contains: search } },
            { taxId: { contains: search } },
            { phone: { contains: search } },
            { email: { contains: search } },
        ],
    };
}

function customerSellerWhere(sellerIdRaw: unknown) {
    if (sellerIdRaw === 'none') return { sellerId: null };
    if (typeof sellerIdRaw === 'string' && sellerIdRaw.trim()) return { sellerId: sellerIdRaw.trim() };
    return {};
}

const CUSTOMER_HUB_SEGMENTS = new Set(['all', 'withDebt', 'overlimit', 'blocked', 'wholesale', 'inactive', 'unassigned']);

function customerHubOrderBy(segment: string) {
    if (segment === 'inactive') {
        return [
            { currentDebt: 'desc' as const },
            { createdAt: 'asc' as const },
            { name: 'asc' as const },
        ];
    }
    return [
        { currentDebt: 'desc' as const },
        { name: 'asc' as const },
    ];
}

function customerHubSegmentWhere(segment: string, asOf: Date = new Date()) {
    if (segment === 'withDebt') return { currentDebt: { gt: 0 } };
    if (segment === 'overlimit') {
        return {
            creditLimit: { gt: 0 },
            // Prisma no garantiza esta comparación campo-a-campo dentro de
            // findMany en todas las versiones/rutas. Traemos el superset
            // "tiene cupo y tiene deuda" y el hub termina el filtro con las
            // métricas ya calculadas por cliente.
            currentDebt: { gt: 0 },
        };
    }
    if (segment === 'blocked') return { isBlocked: true };
    if (segment === 'wholesale') {
        return { isWholesale: true, isBlocked: false, currentDebt: 0 };
    }
    if (segment === 'inactive') {
        // Un cliente pasa a inactivo cuando su última actividad quedó en un
        // día civil <= hoy-60. El primer instante todavía activo es el inicio
        // de Managua de hace 59 días (p. ej. 29-jun 00:00 para hoy 27-ago).
        const cutoff = new Date(inicioDelDiaManagua(asOf).getTime() - 59 * 86400000);
        return {
            isBlocked: false,
            isWholesale: false,
            currentDebt: 0,
            createdAt: { lt: cutoff },
            sales: {
                none: {
                    status: { not: ESTADO_ANULADA },
                    createdAt: { gte: cutoff },
                },
            },
        };
    }
    if (segment === 'unassigned') return { sellerId: null };
    return {};
}

async function buildCustomerHubList(tenantId: string, customers: any[], asOf: Date = new Date()) {
    if (customers.length === 0) return [];

    const customerIds = customers.map((customer) => customer.id);
    const today = startOfTodayManaguaBusiness(asOf);
    const baseSaleWhere = {
        tenantId,
        customerId: { in: customerIds },
        status: { not: ESTADO_ANULADA },
    };

    // El hub puede abrir clientes con años de ventas. Traer cada Sale a Node
    // agotaba memoria y latencia; cinco groupBy acotados devuelven una fila por
    // cliente y preservan exactamente los mismos indicadores.
    const [allSalesRows, creditSalesRows, openCreditRows, overdueRows, overdueLegacyRows] = await Promise.all([
        prisma.sale.groupBy({
            by: ['customerId'],
            where: baseSaleWhere,
            _count: { _all: true },
            _sum: { total: true, balance: true },
            _max: { createdAt: true },
        }),
        prisma.sale.groupBy({
            by: ['customerId'],
            where: { ...baseSaleWhere, paymentMethod: 'CREDIT' },
            _count: { _all: true },
        }),
        prisma.sale.groupBy({
            by: ['customerId'],
            where: { ...baseSaleWhere, paymentMethod: 'CREDIT', balance: { gt: 0 } },
            _count: { _all: true },
        }),
        prisma.sale.groupBy({
            by: ['customerId'],
            where: {
                ...baseSaleWhere,
                paymentMethod: 'CREDIT',
                balance: { gt: 0 },
                dueDate: { not: null, lt: today },
            },
            _count: { _all: true },
        }),
        prisma.sale.groupBy({
            by: ['customerId'],
            where: {
                ...baseSaleWhere,
                paymentMethod: 'CREDIT',
                balance: { gt: 0 },
                dueDate: null,
                createdAt: { lt: today },
            },
            _count: { _all: true },
        }),
    ]);

    const rowsByCustomer = (rows: any[]) => new Map<string, any>(
        rows.filter((row) => row.customerId).map((row) => [row.customerId, row]),
    );
    const allSalesByCustomer = rowsByCustomer(allSalesRows);
    const creditSalesByCustomer = rowsByCustomer(creditSalesRows);
    const openCreditByCustomer = rowsByCustomer(openCreditRows);
    const overdueByCustomer = rowsByCustomer(overdueRows);
    const overdueLegacyByCustomer = rowsByCustomer(overdueLegacyRows);

    return customers
        .map((customer) => {
            const allSales = allSalesByCustomer.get(customer.id);
            const totalSales = new Decimal(allSales?._sum?.total ?? 0);
            const totalOutstanding = new Decimal(allSales?._sum?.balance ?? 0);
            const salesCount = Number(allSales?._count?._all ?? 0);
            const creditSales = Number(creditSalesByCustomer.get(customer.id)?._count?._all ?? 0);
            const openInvoices = Number(openCreditByCustomer.get(customer.id)?._count?._all ?? 0);
            const overdueInvoices = Number(overdueByCustomer.get(customer.id)?._count?._all ?? 0)
                + Number(overdueLegacyByCustomer.get(customer.id)?._count?._all ?? 0);
            const lastSaleAt: Date | null = allSales?._max?.createdAt ?? null;

            const segment = resolveCustomerHubSegment({
                creditLimit: Number(customer.creditLimit),
                currentDebt: Number(customer.currentDebt),
                isBlocked: customer.isBlocked,
                isWholesale: customer.isWholesale,
                overdueInvoices,
                openInvoices,
                lastSaleAt,
                createdAt: customer.createdAt,
            }, asOf);

            return {
                id: customer.id,
                name: customer.name,
                taxId: customer.taxId,
                phone: customer.phone,
                email: customer.email,
                address: customer.address,
                creditLimit: formatCustomerMoney(customer.creditLimit),
                currentDebt: formatCustomerMoney(customer.currentDebt),
                isBlocked: customer.isBlocked,
                isWholesale: Boolean(customer.isWholesale),
                sellerId: customer.sellerId,
                seller: customer.seller,
                createdAt: customer.createdAt,
                lastSaleAt,
                segment,
                nextAction: resolveCustomerHubNextAction(segment, {
                    creditLimit: Number(customer.creditLimit),
                    currentDebt: Number(customer.currentDebt),
                    isBlocked: customer.isBlocked,
                    isWholesale: customer.isWholesale,
                    overdueInvoices,
                    openInvoices,
                }),
                stats: {
                    salesCount,
                    creditSalesCount: creditSales,
                    openInvoices,
                    overdueInvoices,
                    totalSales: totalSales.toDecimalPlaces(2).toNumber(),
                    outstandingBalance: totalOutstanding.toDecimalPlaces(2).toNumber(),
                },
            };
        })
        .sort((a, b) => {
            const debtDelta = b.currentDebt - a.currentDebt;
            if (debtDelta !== 0) return debtDelta;
            const aDate = a.lastSaleAt ? new Date(a.lastSaleAt).getTime() : 0;
            const bDate = b.lastSaleAt ? new Date(b.lastSaleAt).getTime() : 0;
            if (bDate !== aDate) return bDate - aDate;
            return a.name.localeCompare(b.name, 'es');
        });
}

function applySellerCustomerScope(authReq: AuthRequest, whereClause: Record<string, unknown>) {
    if (authReq.role === 'VENDEDOR') whereClause.sellerId = authReq.userId!;
    return whereClause;
}

function receivableCustomerScope(authReq: AuthRequest) {
    if (authReq.role !== 'VENDEDOR') return {};
    return { customer: { sellerId: authReq.userId! } };
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

app.post('/api/customers', authenticate, checkRole(CUSTOMER_CREATE_ROLES), validate(CreateCustomerSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { name, creditLimit, isWholesale, sellerId: requestedSellerId } = req.body;

    try {
        if (!isCustomerCreateAuthorized(authReq.role, {
            financialControls: creditLimit !== undefined || isWholesale !== undefined,
            sellerAssignment: requestedSellerId !== undefined,
        })) {
            return res.status(403).json({ error: 'No tenés permiso para crear clientes con controles administrativos' });
        }

        const sellerId = resolveCustomerSellerIdForCreate(
            authReq.role,
            authReq.userId!,
            requestedSellerId,
        );
        if (sellerId != null && authReq.role !== 'VENDEDOR' && !(await validarSellerDelTenant(sellerId, authReq.tenantId!))) {
            return res.status(400).json({ error: 'Vendedor inválido' });
        }
        const customer = await prisma.$transaction(async (tx: any) => {
            const created = await tx.customer.create({
                data: {
                    tenantId: authReq.tenantId,
                    name: String(name).trim(),
                    taxId: normalizeOptionalCustomerText(req.body.taxId),
                    phone: normalizeOptionalCustomerText(req.body.phone),
                    email: normalizeOptionalCustomerText(req.body.email),
                    address: normalizeOptionalCustomerText(req.body.address),
                    creditLimit: creditLimit !== undefined ? new Decimal(creditLimit).toFixed(2) : 0,
                    currentDebt: 0,
                    isBlocked: false,
                    isWholesale: Boolean(isWholesale),
                    sellerId: sellerId ?? null,
                },
            });
            await tx.auditLog.create({
                data: {
                    tenantId: authReq.tenantId!,
                    userId: authReq.userId!,
                    action: 'CUSTOMER_CREATED',
                    details: JSON.stringify({
                        customerId: created.id,
                        sellerId: created.sellerId,
                        isWholesale: created.isWholesale,
                        hasTaxId: created.taxId != null,
                        hasPhone: created.phone != null,
                        hasEmail: created.email != null,
                        hasAddress: created.address != null,
                    }),
                },
            });
            return created;
        });
        res.json(customer);
    } catch (error) {
        res.status(500).json({ error: 'Error creando cliente' });
    }
});

app.get('/api/customers', authenticate, checkRole(CUSTOMER_READ_ROLES), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const whereClause: any = applySellerCustomerScope(authReq, {
            tenantId: authReq.tenantId,
            ...customerSearchWhere(req.query.search),
        });
        // Cartera por vendedor: ?sellerId=<id> filtra; ?sellerId=none trae los
        // sin asignar. Un sellerId de otro tenant da lista vacía por el where
        // compuesto con tenantId — no hace falta validarlo acá.
        if (authReq.role !== 'VENDEDOR') {
            Object.assign(whereClause, customerSellerWhere(req.query.sellerId));
        }

        const hasPage = req.query.page !== undefined || req.query.pageSize !== undefined;
        const take = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize ?? '50'), 10) || 50));
        const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
        const skip = (page - 1) * take;
        const include = { seller: { select: { id: true, name: true, status: true } } };

        if (hasPage) {
            const [customers, total] = await prisma.$transaction([
                prisma.customer.findMany({
                    where: whereClause,
                    orderBy: { name: 'asc' },
                    skip,
                    take,
                    include,
                }),
                prisma.customer.count({ where: whereClause }),
            ]);
            return res.json({ customers, total, page, pageSize: take });
        }

        const customers = await prisma.customer.findMany({
            where: whereClause,
            orderBy: { name: 'asc' },
            take,
            include,
        });
        res.json(customers);
    } catch (error) {
        res.status(500).json({ error: 'Error obteniendo cartera' });
    }
});

app.get('/api/customers/hub', authenticate, checkRole(CUSTOMER_HUB_READ_ROLES), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const tenantId = authReq.tenantId!;
    const segment = typeof req.query.segment === 'string' ? req.query.segment : 'all';
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '50'), 10) || 50));

    if (!CUSTOMER_HUB_SEGMENTS.has(segment)) {
        return res.status(400).json({ error: 'Segmento de clientes inválido' });
    }

    try {
        const asOf = new Date();
        const whereClause: any = applySellerCustomerScope(authReq, {
            tenantId,
            ...customerSearchWhere(req.query.search),
            ...customerHubSegmentWhere(segment, asOf),
        });
        if (authReq.role !== 'VENDEDOR') {
            Object.assign(whereClause, customerSellerWhere(req.query.sellerId));
        }

        const customers = await prisma.customer.findMany({
            where: whereClause,
            orderBy: customerHubOrderBy(segment),
            take: limit,
            include: { seller: { select: { id: true, name: true, status: true } } },
        });

        const hub = await buildCustomerHubList(tenantId, customers, asOf);
        let visibleHub = hub;
        if (authReq.role === 'VENDEDOR' && hub.length > 0) {
            // La asignación puede cambiar mientras se agregan las ventas. Antes
            // de responder, revalidar contra el estado actual y fallar cerrado.
            const stillAssigned = await prisma.customer.findMany({
                where: {
                    tenantId,
                    sellerId: authReq.userId!,
                    id: { in: hub.map((customer) => customer.id) },
                },
                select: { id: true },
            });
            const assignedIds = new Set(stillAssigned.map((customer) => customer.id));
            visibleHub = hub.filter((customer) => assignedIds.has(customer.id));
        }

        const filtered = visibleHub.filter((customer) => {
            return matchesCustomerHubSegment(segment, customer.segment, {
                creditLimit: customer.creditLimit,
                currentDebt: customer.currentDebt,
                isBlocked: customer.isBlocked,
                isWholesale: customer.isWholesale,
                overdueInvoices: customer.stats.overdueInvoices,
                openInvoices: customer.stats.openInvoices,
                lastSaleAt: customer.lastSaleAt,
                createdAt: customer.createdAt,
            });
        });

        res.json(filtered);
    } catch (error) {
        console.error('Error construyendo customer hub:', error);
        res.status(500).json({ error: 'Error obteniendo clientes' });
    }
});

app.get('/api/customers/:id/hub', authenticate, checkRole(CUSTOMER_HUB_READ_ROLES), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const tenantId = authReq.tenantId!;
    const { id } = req.params;

    try {
        const customerWhere: any = applySellerCustomerScope(authReq, { id, tenantId });
        const customer = await prisma.customer.findFirst({
            where: customerWhere,
            include: { seller: { select: { id: true, name: true, status: true } } },
        });
        if (!customer) return res.status(404).json({ error: 'Cliente no encontrado' });

        const now = new Date();
        const [profile] = await buildCustomerHubList(tenantId, [customer], now);
        const saleScope = {
            tenantId,
            customerId: id,
            status: { not: ESTADO_ANULADA },
            ...receivableCustomerScope(authReq),
        };
        const today = managuaBusinessDate(now);

        const [
            creditSales,
            recentSales,
            recentPayments,
            auditTrail,
            interactions,
            creditTotals,
            overdueDueTotals,
            overdueLegacyTotals,
        ] = await Promise.all([
            prisma.sale.findMany({
                where: { ...saleScope, paymentMethod: 'CREDIT' },
                include: {
                    payments: {
                        orderBy: { createdAt: 'asc' },
                        include: { user: { select: { name: true } } },
                    },
                    soldBy: { select: { id: true, name: true } },
                },
                orderBy: { createdAt: 'desc' },
                take: 12,
            }),
            prisma.sale.findMany({
                where: saleScope,
                orderBy: { createdAt: 'desc' },
                take: 8,
                include: {
                    soldBy: { select: { id: true, name: true } },
                    payments: {
                        orderBy: { createdAt: 'desc' },
                        take: 2,
                        include: { user: { select: { name: true } } },
                    },
                },
            }),
            prisma.payment.findMany({
                where: { sale: { tenantId, customerId: id, ...receivableCustomerScope(authReq) } },
                orderBy: { createdAt: 'desc' },
                take: 8,
                include: {
                    user: { select: { id: true, name: true } },
                    sale: { select: { id: true, invoiceNumber: true, total: true, balance: true, createdAt: true } },
                },
            }),
            authReq.role === 'VENDEDOR' ? Promise.resolve([]) : prisma.auditLog.findMany({
                where: {
                    tenantId,
                    action: { in: ['CUSTOMER_CREATED', 'CUSTOMER_UPDATED', 'CREDIT_PAYMENT', 'BAD_DEBT_WRITEOFF'] },
                    details: { contains: `"customerId":"${id}"` },
                },
                orderBy: { createdAt: 'desc' },
                take: 12,
                include: { user: { select: { id: true, name: true } } },
            }),
            prisma.customerInteraction.findMany({
                where: {
                    tenantId,
                    customerId: id,
                    ...(authReq.role === 'VENDEDOR'
                        ? { customer: { sellerId: authReq.userId! } }
                        : {}),
                },
                orderBy: { createdAt: 'desc' },
                take: 20,
                include: { creator: { select: { id: true, name: true } } },
            }),
            prisma.sale.aggregate({
                where: { ...saleScope, paymentMethod: 'CREDIT' },
                _sum: { total: true, balance: true },
            }),
            prisma.sale.aggregate({
                where: {
                    ...saleScope,
                    paymentMethod: 'CREDIT',
                    balance: { gt: 0 },
                    dueDate: { not: null, lt: today },
                },
                _sum: { balance: true },
            }),
            prisma.sale.aggregate({
                where: {
                    ...saleScope,
                    paymentMethod: 'CREDIT',
                    balance: { gt: 0 },
                    dueDate: null,
                    createdAt: { lt: today },
                },
                _sum: { balance: true },
            }),
        ]);

        // La cartera puede reasignarse mientras se calculan los paneles. Antes
        // de devolver datos sensibles, el vendedor debe seguir siendo dueño de
        // la ficha; si cambió, la respuesta falla cerrada.
        if (authReq.role === 'VENDEDOR') {
            const stillAuthorized = await prisma.customer.findFirst({
                where: customerWhere,
                select: { id: true },
            });
            if (!stillAuthorized) return res.status(404).json({ error: 'Cliente no encontrado' });
        }

        const totalBilled = new Decimal(creditTotals._sum.total ?? 0);
        const totalBalance = new Decimal(creditTotals._sum.balance ?? 0);
        const totalPaid = totalBilled.minus(totalBalance);
        const totalOverdue = new Decimal(overdueDueTotals._sum.balance ?? 0)
            .plus(overdueLegacyTotals._sum.balance ?? 0);

        const invoices = creditSales.map((sale: any) => {
            const total = new Decimal(sale.total.toString());
            const balance = new Decimal(sale.balance.toString());
            const paid = total.minus(balance);
            const ref = sale.dueDate ?? sale.createdAt;
            const overdueDays = daysSinceManaguaCivilDate(ref, now);
            const overdue = balance.greaterThan(0) && overdueDays > 0;

            return {
                id: sale.id,
                invoiceNumber: sale.invoiceNumber != null ? String(sale.invoiceNumber) : null,
                total: total.toDecimalPlaces(2).toNumber(),
                paid: paid.toDecimalPlaces(2).toNumber(),
                balance: balance.toDecimalPlaces(2).toNumber(),
                dueDate: sale.dueDate,
                date: sale.createdAt,
                status: overdue ? 'OVERDUE' : balance.greaterThan(0) ? 'PENDING' : 'PAID',
                soldBy: sale.soldBy,
                payments: sale.payments.map((payment: any) => ({
                    id: payment.id,
                    amount: Number(payment.amount),
                    method: payment.method,
                    date: payment.createdAt,
                    collectedBy: payment.user?.name ?? null,
                })),
            };
        });

        const timeline = [
            ...recentSales.map((sale: any) => ({
                id: `sale-${sale.id}`,
                type: 'sale',
                happenedAt: sale.createdAt,
                title: sale.paymentMethod === 'CREDIT' ? 'Venta al crédito' : 'Venta registrada',
                subtitle: sale.invoiceNumber != null ? `Factura #${sale.invoiceNumber}` : 'Venta sin correlativo visible',
                amount: Number(sale.total),
                meta: sale.soldBy?.name ? `Vendió ${sale.soldBy.name}` : null,
            })),
            ...recentPayments.map((payment: any) => ({
                id: `payment-${payment.id}`,
                type: 'payment',
                happenedAt: payment.createdAt,
                title: 'Abono registrado',
                subtitle: payment.sale?.invoiceNumber != null ? `Factura #${payment.sale.invoiceNumber}` : 'Abono sin factura visible',
                amount: Number(payment.amount),
                meta: payment.user?.name ? `Cobró ${payment.user.name}` : null,
            })),
            ...interactions.map((interaction: any) => ({
                id: `interaction-${interaction.id}`,
                type: 'interaction',
                happenedAt: interaction.createdAt,
                title: interaction.type === 'PROMISE'
                    ? 'Promesa de pago'
                    : interaction.type === 'CALL'
                        ? 'Llamada registrada'
                        : interaction.type === 'WHATSAPP'
                            ? 'Gestión por WhatsApp'
                            : interaction.type === 'VISIT'
                                ? 'Visita registrada'
                                : 'Nota de cliente',
                subtitle: interaction.note,
                amount: interaction.promisedAmount == null ? null : Number(interaction.promisedAmount),
                meta: interaction.creator?.name ? `Registró ${interaction.creator.name}` : null,
            })),
            ...auditTrail.map((log: any) => ({
                id: `audit-${log.id}`,
                type: log.action.toLowerCase(),
                happenedAt: log.createdAt,
                title: log.action === 'BAD_DEBT_WRITEOFF'
                    ? 'Castigo de incobrable'
                    : log.action === 'CUSTOMER_CREATED'
                        ? 'Cliente creado'
                    : log.action === 'CUSTOMER_UPDATED'
                        ? 'Cliente actualizado'
                        : 'Movimiento de crédito auditado',
                subtitle: log.user?.name ? `Acción de ${log.user.name}` : 'Bitácora del sistema',
                amount: null,
                meta: null,
            })),
        ].sort((a, b) => new Date(b.happenedAt).getTime() - new Date(a.happenedAt).getTime()).slice(0, 16);

        res.json({
            profile,
            receivables: {
                invoices,
                totals: {
                    billed: totalBilled.toDecimalPlaces(2).toNumber(),
                    paid: totalPaid.toDecimalPlaces(2).toNumber(),
                    balance: totalBalance.toDecimalPlaces(2).toNumber(),
                    overdue: totalOverdue.toDecimalPlaces(2).toNumber(),
                },
            },
            recentSales: recentSales.map((sale: any) => ({
                id: sale.id,
                createdAt: sale.createdAt,
                total: Number(sale.total),
                balance: Number(sale.balance),
                paymentMethod: sale.paymentMethod,
                invoiceNumber: sale.invoiceNumber != null ? String(sale.invoiceNumber) : null,
                soldBy: sale.soldBy,
            })),
            recentPayments: recentPayments.map((payment: any) => ({
                id: payment.id,
                createdAt: payment.createdAt,
                amount: Number(payment.amount),
                method: payment.method,
                collectedBy: payment.user?.name ?? null,
                saleId: payment.sale?.id ?? null,
                invoiceNumber: payment.sale?.invoiceNumber != null ? String(payment.sale.invoiceNumber) : null,
            })),
            interactions: interactions.map((interaction: any) => ({
                id: interaction.id,
                type: interaction.type,
                note: interaction.note,
                status: interaction.status,
                promisedAmount: interaction.promisedAmount == null ? null : Number(interaction.promisedAmount),
                promisedAt: interaction.promisedAt,
                followUpAt: interaction.followUpAt,
                completedAt: interaction.completedAt,
                createdAt: interaction.createdAt,
                creator: interaction.creator,
            })),
            timeline,
        });
    } catch (error) {
        console.error('Error construyendo detalle del cliente:', error);
        res.status(500).json({ error: 'Error obteniendo el detalle del cliente' });
    }
});

app.post(
    '/api/customers/:id/interactions',
    authenticate,
    checkRole(CUSTOMER_INTERACTION_WRITE_ROLES),
    validate(CreateCustomerInteractionSchema),
    async (req: any, res: any) => {
        const authReq = req as AuthRequest;
        const tenantId = authReq.tenantId!;
        const customerId = req.params.id;

        try {
            const interaction = await prisma.$transaction(async (tx: any) => {
                const customer = await tx.customer.findFirst({
                    where: applySellerCustomerScope(authReq, { id: customerId, tenantId }),
                    select: { id: true },
                });
                if (!customer) throw new Error('CUSTOMER_NOT_FOUND');

                const interactionStartsOpen = Boolean(req.body.followUpAt) || req.body.type === 'PROMISE';
                const created = await tx.customerInteraction.create({
                    data: {
                        tenantId,
                        customerId,
                        type: req.body.type,
                        note: req.body.note.trim(),
                        status: interactionStartsOpen ? 'OPEN' : 'COMPLETED',
                        promisedAmount: req.body.promisedAmount == null ? null : new Decimal(req.body.promisedAmount).toFixed(2),
                        promisedAt: req.body.promisedAt ? new Date(req.body.promisedAt) : null,
                        followUpAt: req.body.followUpAt ? new Date(req.body.followUpAt) : null,
                        completedAt: interactionStartsOpen ? null : new Date(),
                        createdBy: authReq.userId!,
                    },
                    include: { creator: { select: { id: true, name: true } } },
                });

                await tx.auditLog.create({
                    data: {
                        tenantId,
                        userId: authReq.userId!,
                        action: 'CUSTOMER_INTERACTION_CREATED',
                        details: JSON.stringify({
                            customerId,
                            interactionId: created.id,
                            type: created.type,
                            status: created.status,
                            hasPromise: created.promisedAt != null,
                            followUpAt: created.followUpAt,
                        }),
                    },
                });

                return created;
            });

            res.status(201).json({
                ...interaction,
                promisedAmount: interaction.promisedAmount == null ? null : Number(interaction.promisedAmount),
            });
        } catch (error: any) {
            if (error?.message === 'CUSTOMER_NOT_FOUND') return res.status(404).json({ error: 'Cliente no encontrado' });
            console.error('Error registrando gestión de cliente:', error);
            res.status(500).json({ error: 'No se pudo registrar la gestión' });
        }
    },
);

app.patch(
    '/api/customers/:customerId/interactions/:interactionId',
    authenticate,
    checkRole(CUSTOMER_INTERACTION_WRITE_ROLES),
    validate(UpdateCustomerInteractionSchema),
    async (req: any, res: any) => {
        const authReq = req as AuthRequest;
        const tenantId = authReq.tenantId!;
        const { customerId, interactionId } = req.params;

        try {
            const result = await prisma.$transaction(async (tx: any) => {
                const customer = await tx.customer.findFirst({
                    where: applySellerCustomerScope(authReq, { id: customerId, tenantId }),
                    select: { id: true },
                });
                if (!customer) throw new Error('INTERACTION_NOT_FOUND');

                const lockedInteractions: Array<{ id: string }> = await tx.$queryRaw`
                    SELECT id FROM \`CustomerInteraction\`
                    WHERE id = ${interactionId}
                      AND tenantId = ${tenantId}
                      AND customerId = ${customerId}
                    FOR UPDATE`;
                if (lockedInteractions.length === 0) throw new Error('INTERACTION_NOT_FOUND');

                const existing = await tx.customerInteraction.findFirst({
                    where: { id: interactionId, tenantId, customerId },
                });
                if (!existing) throw new Error('INTERACTION_NOT_FOUND');
                if (existing.status !== 'OPEN') return existing;

                const updated = await tx.customerInteraction.update({
                    where: { id: interactionId },
                    data: { status: req.body.status, completedAt: new Date() },
                });
                await tx.auditLog.create({
                    data: {
                        tenantId,
                        userId: authReq.userId!,
                        action: 'CUSTOMER_INTERACTION_RESOLVED',
                        details: JSON.stringify({
                            customerId,
                            interactionId,
                            beforeStatus: existing.status,
                            afterStatus: updated.status,
                        }),
                    },
                });
                return updated;
            });

            res.json({
                ...result,
                promisedAmount: result.promisedAmount == null ? null : Number(result.promisedAmount),
            });
        } catch (error: any) {
            if (error?.message === 'INTERACTION_NOT_FOUND') return res.status(404).json({ error: 'Gestión no encontrada' });
            console.error('Error actualizando gestión de cliente:', error);
            res.status(500).json({ error: 'No se pudo actualizar la gestión' });
        }
    },
);

app.put('/api/customers/:id', authenticate, checkRole(CUSTOMER_UPDATE_ROLES), validate(UpdateCustomerSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { id } = req.params;
    const { name, taxId, phone, email, address, creditLimit, isBlocked, isWholesale, sellerId } = req.body;

    try {
        const wantsIdentityChange = [name, taxId].some((value) => value !== undefined);
        const wantsContactChange = [phone, email, address].some((value) => value !== undefined);
        const wantsControlChange = [creditLimit, isBlocked, isWholesale, sellerId].some((value) => value !== undefined);

        if (!isCustomerUpdateAuthorized(authReq.role, {
            identity: wantsIdentityChange,
            contact: wantsContactChange,
            controls: wantsControlChange,
        })) {
            return res.status(403).json({ error: 'No tenés permiso para actualizar este cliente' });
        }

        // La REasignación de cartera es administrativa (el guard de grupos
        // anterior ya lo garantiza). Validar el destino ANTES de la transacción.
        if (sellerId != null && !(await validarSellerDelTenant(sellerId, authReq.tenantId!))) {
            return res.status(400).json({ error: 'Vendedor inválido' });
        }
        await prisma.$transaction(async (tx: any) => {
            // Verificar propiedad dentro del tenant (patrón de /api/suppliers PUT).
            const existingWhere = applySellerCustomerScope(authReq, { id, tenantId: authReq.tenantId });
            const existing = await tx.customer.findFirst({ where: existingWhere });
            if (!existing) throw new Error('CUSTOMER_NOT_FOUND');

            const data: any = {};
            if (name !== undefined) data.name = name.trim();
            if (taxId !== undefined) data.taxId = normalizeOptionalCustomerText(taxId);
            if (phone !== undefined) data.phone = normalizeOptionalCustomerText(phone);
            if (email !== undefined) data.email = normalizeOptionalCustomerText(email);
            if (address !== undefined) data.address = normalizeOptionalCustomerText(address);
            if (creditLimit !== undefined) data.creditLimit = new Decimal(creditLimit).toDecimalPlaces(2).toString();
            if (isBlocked !== undefined) data.isBlocked = Boolean(isBlocked);
            if (isWholesale !== undefined) data.isWholesale = Boolean(isWholesale);
            if (sellerId !== undefined) data.sellerId = sellerId; // null = desasignar

            // Repetir tenant/cartera en el sink cierra la ventana entre el
            // lookup y la escritura si un admin reasigna al cliente en paralelo.
            const updateResult = await tx.customer.updateMany({ where: existingWhere, data });
            if (updateResult.count !== 1) throw new Error('CUSTOMER_NOT_FOUND');
            const updated = await tx.customer.findFirst({
                where: { id, tenantId: authReq.tenantId },
            });
            if (!updated) throw new Error('CUSTOMER_NOT_FOUND');

            // Auditoría sin duplicar PII cruda (teléfono, email, documento o
            // dirección). La fila Customer conserva el valor vigente; la
            // bitácora registra qué cambió y los controles financieros.
            await tx.auditLog.create({
                data: {
                    tenantId: authReq.tenantId,
                    userId: authReq.userId,
                    action: 'CUSTOMER_UPDATED',
                    details: JSON.stringify({
                        customerId: id,
                        changedFields: Object.keys(data),
                        before: {
                            creditLimit: existing.creditLimit.toString(),
                            isBlocked: existing.isBlocked,
                            isWholesale: existing.isWholesale,
                            sellerId: existing.sellerId,
                        },
                        after: {
                            creditLimit: updated.creditLimit.toString(),
                            isBlocked: updated.isBlocked,
                            isWholesale: updated.isWholesale,
                            sellerId: updated.sellerId,
                        },
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
                status: { not: ESTADO_ANULADA },
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

/**
 * POST /api/employees/verify-pin — ¿este PIN es de alguien que puede autorizar?
 *
 * QUÉ ARREGLA: el "fiado inteligente" del POS (autorizar crédito por encima del
 * límite del cliente) verificaba el PIN **en el navegador**: pedía
 * `GET /api/employees` y comparaba `empleado.pin === pinTecleado`. Pero ese
 * endpoint BORRA el PIN de la respuesta —y hace bien—, así que `empleado.pin`
 * era siempre `undefined`, la comparación siempre falsa y la autorización
 * **nunca funcionó**: respondía "PIN incorrecto" al dueño tecleando su propio
 * PIN. Estaba muerta desde que se blindó la respuesta.
 *
 * Y si el PIN sí hubiera viajado, habría sido peor: cualquiera con la consola
 * abierta leía los PINes de todo el personal.
 *
 * La verificación va donde tiene que ir. El PIN entra, el veredicto sale; el PIN
 * nunca sale. Solo confirma si quien lo tecleó tiene rango para autorizar —no
 * devuelve el nombre ni el id—: para decidir si se fía no hace falta más, y
 * menos superficie es menos que filtrar.
 */
const verifyPinLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15,
    message: { error: '🔒 Demasiados intentos de autorización. Esperá 15 minutos.' },
    standardHeaders: true,
    legacyHeaders: false,
    // Por usuario del JWT, no por IP: una tienda entera comparte el router.
    keyGenerator: (req: any) => {
        const userId = (req as AuthRequest).userId;
        return userId ? `u:${userId}` : `ip:${req.ip}`;
    },
});
app.post('/api/employees/verify-pin', authenticate, verifyPinLimiter as any, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const pin = pinNormalizado(req.body?.pin);
    if (pin === null || !/^\d{4}$/.test(pin)) {
        return res.status(400).json({ error: 'El PIN debe ser exactamente 4 dígitos numéricos.' });
    }
    try {
        // Capa 1: el tenant sale del JWT. Un PIN de otro negocio no autoriza acá.
        const empleado = await prisma.employee.findFirst({
            where: { tenantId: authReq.tenantId!, pin, status: 'ACTIVE' },
            select: { role: true },
        });
        const autoriza = !!empleado && ['OWNER', 'MANAGER', 'ADMIN'].includes(empleado.role);
        // Mismo cuerpo para "no existe" y "existe pero no tiene rango": si la
        // respuesta los distinguiera, este endpoint serviría para enumerar los
        // PINes del personal a razón de un intento por consulta.
        if (!autoriza) {
            return res.status(403).json({ autorizado: false, error: 'PIN incorrecto o sin permisos de Dueño/Gerente.' });
        }
        await prisma.auditLog.create({
            data: {
                tenantId: authReq.tenantId!,
                userId: authReq.userId!,
                action: 'CREDIT_OVERRIDE_AUTHORIZED',
                details: JSON.stringify({ rolAutorizante: empleado!.role }),
            },
        });
        res.json({ autorizado: true });
    } catch (error: any) {
        res.status(500).json({ error: 'Error verificando el PIN.' });
    }
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

app.post('/api/sales', authenticate, checkRole(POS_SALE_ROLES), async (req: any, res: any) => {
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
            {
                ...req.body,
                source: 'POS',
                // La atribución de RRHH sale del turno autenticado. El cliente
                // no puede adjudicar la venta a otro empleado del mismo tenant.
                employeeId: currentShift?.employeeId ?? null,
            }
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
app.post('/api/sales/:id/cancel', authenticate, checkRole(['OWNER', 'ADMIN', 'MANAGER', 'CASHIER']), validate(CancelSaleSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const saleId = String(req.params.id);
    const motivo = textoUtil(req.body.motivo);
    const correctionRequestId = String(req.body.correctionRequestId);

    try {
        const saleExists = await prisma.sale.findFirst({
            where: { id: saleId, tenantId: authReq.tenantId! },
            select: { id: true },
        });
        if (!saleExists) return res.status(404).json({ error: 'Factura no encontrada' });

        const resultado = await prisma.$transaction(async (tx: any) => {
            const lockedSale: Array<{ id: string }> = await tx.$queryRaw`
                SELECT id FROM \`Sale\`
                WHERE id = ${saleId} AND \`tenantId\` = ${authReq.tenantId}
                FOR UPDATE`;
            if (lockedSale.length === 0) {
                throw new ReturnResolutionError('SALE_NOT_FOUND', 404, 'Factura no encontrada');
            }

            // Esta relectura es la autoridad. Una devolución pudo haber
            // commiteado mientras esta solicitud esperaba el lock de Sale; usar
            // el snapshot externo permitiría anular y restaurar por segunda vez.
            const sale = await tx.sale.findFirst({
                where: { id: saleId, tenantId: authReq.tenantId! },
                include: {
                    items: { select: { id: true, productId: true, quantity: true, costAtSale: true } },
                    pedidos: { select: { id: true } },
                    shift: { select: { status: true } },
                    _count: { select: { productReturns: true, payments: true } },
                },
            });
            if (!sale) {
                throw new ReturnResolutionError('SALE_NOT_FOUND', 404, 'Factura no encontrada');
            }
            const correctionRequest = await tx.saleCorrectionRequest.findFirst({
                where: {
                    id: correctionRequestId,
                    tenantId: authReq.tenantId!,
                    saleId,
                    kind: 'VOID',
                },
            });
            if (
                correctionRequest?.status === 'COMPLETED'
                && textoUtil(correctionRequest.reason) === motivo
                && (sale.status === ESTADO_ANULADA || sale.cancelledAt !== null)
            ) {
                return { id: saleId, status: ESTADO_ANULADA, motivo, idempotentReplay: true };
            }
            if (!correctionRequest || correctionRequest.status !== 'APPROVED' || textoUtil(correctionRequest.reason) !== motivo) {
                throw new ReturnResolutionError(
                    'APPROVED_CORRECTION_REQUIRED',
                    409,
                    'La anulación requiere una solicitud aprobada que coincida con este motivo',
                );
            }
            if (!isSameManaguaBusinessDay(sale.createdAt) || sale.shift?.status !== 'OPEN') {
                throw new ReturnResolutionError(
                    'VOID_WINDOW_CLOSED',
                    409,
                    'La caja original ya cerró o la venta no es de hoy. Corregí mediante devolución o nota de crédito.',
                );
            }

            let periodoCerrado = false;
            try {
                await assertPeriodOpen(tx, authReq.tenantId!, sale.createdAt);
            } catch (error) {
                if (error instanceof PeriodLockedError) periodoCerrado = true;
                else throw error;
            }
            const veredicto = puedeAnularse({
                status: sale.status,
                cancelledAt: sale.cancelledAt,
                devoluciones: sale._count.productReturns,
                pagos: sale._count.payments,
                periodoCerrado,
            }, motivo);
            if (!veredicto.ok) {
                throw new ReturnResolutionError(veredicto.codigo, 409, veredicto.mensaje);
            }

            const plan = planDeReversion({
                total: sale.total.toString(),
                paymentMethod: sale.paymentMethod,
                items: sale.items.map(item => ({
                    productId: item.productId,
                    quantity: item.quantity.toString(),
                    costAtSale: item.costAtSale.toString(),
                })),
            });

            const batchWarehouseLedgerMode = await resolveBatchWarehouseLedgerMode(
                tx,
                authReq.tenantId!,
            );
            const batchTrackingByProduct = new Map<string, boolean>();
            const productsWithBatchKardex = new Set<string>();
            if (batchWarehouseLedgerMode !== 'OFF') {
                const cancellationProductIds = [...new Set(sale.items.map(item => item.productId))];
                const cancellationProducts = await tx.product.findMany({
                    where: {
                        tenantId: authReq.tenantId!,
                        id: { in: cancellationProductIds },
                    },
                    select: { id: true, requiresBatchTracking: true },
                });
                if (cancellationProducts.length !== cancellationProductIds.length) {
                    throw new ReturnResolutionError(
                        'RETURN_PRODUCT_NOT_FOUND',
                        409,
                        'Un producto de la venta ya no está disponible para restaurar stock',
                    );
                }
                for (const product of cancellationProducts) {
                    batchTrackingByProduct.set(product.id, product.requiresBatchTracking);
                }

                const pedidoReferenceIds = sale.pedidos.map((pedido: { id: string }) => pedido.id);
                const cancellationBatchKardex = await tx.kardexMovement.findMany({
                    where: {
                        tenantId: authReq.tenantId!,
                        OR: [
                            { referenceId: saleId, referenceType: 'SALE', type: 'SALE' },
                            ...(pedidoReferenceIds.length > 0
                                ? [{
                                    referenceId: { in: pedidoReferenceIds },
                                    referenceType: { in: ['PEDIDO_RESERVA', 'PEDIDO_VENTA'] },
                                    type: 'OUT',
                                }]
                                : []),
                        ],
                        batchId: { not: null },
                    },
                    select: { productId: true },
                });
                for (const movement of cancellationBatchKardex) {
                    productsWithBatchKardex.add(movement.productId);
                }
            }
            const cancellationBatchPlans = new Map<string, ReturnBatchRestorationPlan>();
            {
                const allocationRows = await tx.saleItemBatchAllocation.findMany({
                    where: {
                        tenantId: authReq.tenantId!,
                        saleItemId: { in: sale.items.map(item => item.id) },
                        saleItem: { saleId, sale: { tenantId: authReq.tenantId! } },
                        batch: { tenantId: authReq.tenantId! },
                    },
                    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                    select: {
                        id: true,
                        saleItemId: true,
                        batchId: true,
                        warehouseId: true,
                        quantity: true,
                        batch: { select: { productId: true, batchNumber: true } },
                    },
                });
                const allocationsBySaleItem = new Map<string, any[]>();
                for (const allocation of allocationRows) {
                    const bucket = allocationsBySaleItem.get(allocation.saleItemId) ?? [];
                    bucket.push({
                        id: allocation.id,
                        saleItemId: allocation.saleItemId,
                        productId: allocation.batch.productId,
                        batchId: allocation.batchId,
                        batchNumber: allocation.batch.batchNumber,
                        warehouseId: allocation.warehouseId,
                        quantity: allocation.quantity,
                    });
                    allocationsBySaleItem.set(allocation.saleItemId, bucket);
                }
                const productLineCounts = new Map<string, number>();
                for (const item of sale.items) {
                    productLineCounts.set(
                        item.productId,
                        (productLineCounts.get(item.productId) ?? 0) + 1,
                    );
                }
                for (const item of sale.items) {
                    cancellationBatchPlans.set(item.id, planReturnBatchRestoration({
                        saleItem: item,
                        requestedQuantity: item.quantity,
                        sameProductLineCount: productLineCounts.get(item.productId) ?? 0,
                        requiresBatchTracking:
                            batchTrackingByProduct.get(item.productId) === true
                            || productsWithBatchKardex.has(item.productId)
                            || (allocationsBySaleItem.get(item.id)?.length ?? 0) > 0,
                        previousReturns: [],
                        allocations: allocationsBySaleItem.get(item.id) ?? [],
                        ledgerMode: batchWarehouseLedgerMode,
                    }));
                }
            }

            // 1 · MARCAR PRIMERO, con la guarda en el WHERE. Dos anulaciones
            //     simultáneas (doble clic, dos pestañas) revertirían el stock
            //     DOS VECES si esto se hiciera al final: acá la primera gana y
            //     la segunda ve count === 0 y aborta la transacción entera.
            const marcada = await tx.sale.updateMany({
                where: {
                    id: saleId,
                    tenantId: authReq.tenantId!,
                    status: { not: ESTADO_ANULADA },
                    cancelledAt: null,
                },
                data: {
                    status: ESTADO_ANULADA,
                    cancelledAt: new Date(),
                    cancelledById: authReq.userId!,
                    cancelReason: motivo,
                    // Una factura anulada no tiene saldo por cobrar.
                    balance: 0,
                },
            });
            if (marcada.count === 0) {
                throw new Error('La factura ya fue anulada por otra operación.');
            }

            // 2 · OFF conserva el agregado legacy. En SHADOW/ENFORCED cada
            //     allocation vuelve primero al sidecar de su bodega y después
            //     a ProductBatch + agregado + Kardex, todo dentro de esta tx.
            if (batchWarehouseLedgerMode === 'OFF') {
                for (const linea of plan.lineas) {
                    const cantidad = linea.cantidad.toNumber();
                    let stockResult;
                    try {
                        stockResult = await applyStockDelta(tx, {
                            tenantId: authReq.tenantId!,
                            productId: linea.productId,
                            delta: cantidad,
                            enforceSufficient: false,
                        });
                    } catch (err) {
                        // Producto borrado del catálogo: la venta se anula igual, no
                        // se puede rehacer inventario de algo que ya no existe.
                        if (err instanceof StockError && err.code === 'PRODUCT_NOT_FOUND') continue;
                        throw err;
                    }

                    await tx.kardexMovement.create({
                        data: {
                            tenantId: authReq.tenantId!,
                            productId: linea.productId,
                            type: 'RETURN',
                            quantity: cantidad,
                            stockBefore: stockResult.stockBefore,
                            stockAfter: stockResult.stockAfter,
                            referenceId: saleId,
                            referenceType: 'SALE_VOIDED',
                            reason: `Anulación de factura: ${motivo}`,
                            userId: authReq.userId!,
                        },
                    });
                }
            } else {
                const cancellationItemsInLockOrder = [...sale.items].sort(
                    (left, right) => left.productId.localeCompare(right.productId)
                        || left.id.localeCompare(right.id),
                );
                for (const item of cancellationItemsInLockOrder) {
                    const batchPlan = cancellationBatchPlans.get(item.id);
                    if (!batchPlan) {
                        throw new ReturnResolutionError(
                            'RECONCILIATION_REQUIRED',
                            409,
                            'No se pudo reconstruir la evidencia lote-bodega de la venta',
                        );
                    }
                    let appliedQuantity = new Decimal(0);
                    const restorationsInLockOrder = [...batchPlan.batchRestorations].sort(
                        (left, right) => left.batchId.localeCompare(right.batchId),
                    );
                    for (const restoration of restorationsInLockOrder) {
                        if (restoration.warehouseId) {
                            await applyBatchWarehouseDelta({
                                tx,
                                mode: batchWarehouseLedgerMode,
                                tenantId: authReq.tenantId!,
                                productId: item.productId,
                                batchId: restoration.batchId,
                                warehouseId: restoration.warehouseId,
                                delta: restoration.quantity.toFixed(4),
                                movementType: 'SALE_RETURN',
                                referenceId: saleId,
                                referenceType: 'SALE_VOIDED',
                                userId: authReq.userId!,
                                reason: `Anulación de venta ${saleId}`,
                                sourceKey: `sale-void:${saleId}:item:${item.id}:allocation:${restoration.allocationId}:batch:${restoration.batchId}`,
                                allowNegative: false,
                            });
                        }

                        const updatedBatch = await tx.productBatch.updateMany({
                            where: {
                                id: restoration.batchId,
                                tenantId: authReq.tenantId!,
                                productId: item.productId,
                            },
                            // ProductBatch.stock sigue siendo la proyección Float legacy.
                            // La autoridad exacta ya se aplicó al sidecar Decimal arriba;
                            // convertimos solo en esta frontera exigida por Prisma.
                            data: { stock: { increment: restoration.quantity.toNumber() } },
                        });
                        if (updatedBatch.count !== 1) {
                            throw new ReturnResolutionError(
                                'RETURN_BATCH_TARGET_NOT_FOUND',
                                409,
                                'Un lote original ya no está disponible para restaurar',
                            );
                        }

                        const stockResult = await applyStockDelta(tx, {
                            tenantId: authReq.tenantId!,
                            productId: item.productId,
                            delta: restoration.quantity.toNumber(),
                            enforceSufficient: false,
                            warehouseId: restoration.warehouseId ?? undefined,
                        });
                        await tx.kardexMovement.create({
                            data: {
                                tenantId: authReq.tenantId!,
                                productId: item.productId,
                                type: 'RETURN',
                                quantity: restoration.quantity.toNumber(),
                                stockBefore: stockResult.stockBefore,
                                stockAfter: stockResult.stockAfter,
                                referenceId: saleId,
                                referenceType: 'SALE_VOIDED',
                                reason: `Anulación de factura: ${motivo} - lote ${restoration.batchNumber}`,
                                userId: authReq.userId!,
                                ...(restoration.warehouseId
                                    ? { batchId: restoration.batchId }
                                    : {}),
                                warehouseId: stockResult.warehouseId,
                            },
                        });
                        appliedQuantity = appliedQuantity.plus(restoration.quantity);
                    }

                    if (batchPlan.aggregateOnlyQuantity.greaterThan(0)) {
                        const stockResult = await applyStockDelta(tx, {
                            tenantId: authReq.tenantId!,
                            productId: item.productId,
                            delta: batchPlan.aggregateOnlyQuantity.toNumber(),
                            enforceSufficient: false,
                        });
                        await tx.kardexMovement.create({
                            data: {
                                tenantId: authReq.tenantId!,
                                productId: item.productId,
                                type: 'RETURN',
                                quantity: batchPlan.aggregateOnlyQuantity.toNumber(),
                                stockBefore: stockResult.stockBefore,
                                stockAfter: stockResult.stockAfter,
                                referenceId: saleId,
                                referenceType: 'SALE_VOIDED',
                                reason: `Anulación de factura: ${motivo} - sin lote asignado`,
                                userId: authReq.userId!,
                                warehouseId: stockResult.warehouseId,
                            },
                        });
                        appliedQuantity = appliedQuantity.plus(batchPlan.aggregateOnlyQuantity);
                    }

                    for (const gap of batchPlan.reconciliationGaps) {
                        await tx.auditLog.create({
                            data: {
                                tenantId: authReq.tenantId!,
                                userId: authReq.userId!,
                                action: 'BATCH_WAREHOUSE_RETURN_RECONCILIATION_REQUIRED',
                                details: JSON.stringify({
                                    saleId,
                                    returnId: null,
                                    saleItemId: item.id,
                                    productId: item.productId,
                                    allocationId: gap.allocationId,
                                    batchId: gap.batchId,
                                    quantity: gap.quantity.toFixed(4),
                                    reason: gap.reason,
                                }),
                            },
                        });
                    }

                    if (!appliedQuantity.equals(new Decimal(item.quantity.toString()))) {
                        throw new ReturnResolutionError(
                            'RETURN_BATCH_RESTORATION_INVALID',
                            500,
                            'El movimiento por lote no coincide con la cantidad anulada',
                        );
                    }
                }
            }

            // 3 · Bajar la deuda del cliente si era venta a crédito.
            let deudaAntes: string | null = null;
            let deudaDespues: string | null = null;
            const deudaAReversar = Decimal.min(plan.deudaAReversar, new Decimal(sale.balance.toString()));
            if (sale.customerId && deudaAReversar.greaterThan(0)) {
                const previo = await tx.customer.findFirst({
                    where: { id: sale.customerId, tenantId: authReq.tenantId! },
                    select: { currentDebt: true },
                });
                if (previo) {
                    deudaAntes = String(previo.currentDebt);
                    // Piso en 0: si el contador venía desfasado, la anulación no
                    // puede dejar al cliente con deuda NEGATIVA (saldo a favor
                    // fantasma que después alguien cobra).
                    const nueva = Decimal.max(
                        new Decimal(previo.currentDebt.toString()).minus(deudaAReversar),
                        new Decimal(0)
                    ).toDecimalPlaces(2);
                    const act = await tx.customer.update({
                        where: { id: sale.customerId, tenantId: authReq.tenantId! },
                        data: { currentDebt: nueva.toNumber() },
                    });
                    deudaDespues = String(act.currentDebt);
                }
            }

            const saldoFavorARestaurar = new Decimal(sale.storeCreditApplied?.toString() ?? 0);
            if (saldoFavorARestaurar.greaterThan(0)) {
                if (!sale.customerId) throw new ReturnResolutionError('STORE_CREDIT_CUSTOMER_REQUIRED', 409, 'La venta consumió saldo sin un cliente verificable');
                await tx.$queryRaw`SELECT id FROM \`Customer\` WHERE id = ${sale.customerId} AND tenantId = ${authReq.tenantId} FOR UPDATE`;
                const customer = await tx.customer.findFirst({
                    where: { id: sale.customerId, tenantId: authReq.tenantId! },
                    select: { storeCreditBalance: true },
                });
                if (!customer) throw new ReturnResolutionError('STORE_CREDIT_CUSTOMER_REQUIRED', 409, 'El cliente de la venta ya no está disponible');
                const balanceAfter = new Decimal(customer.storeCreditBalance.toString()).plus(saldoFavorARestaurar).toDecimalPlaces(4);
                const restoredCustomer = await tx.customer.updateMany({
                    where: { id: sale.customerId, tenantId: authReq.tenantId! },
                    data: { storeCreditBalance: balanceAfter.toFixed(4) },
                });
                if (restoredCustomer.count !== 1) throw new ReturnResolutionError('STORE_CREDIT_CUSTOMER_REQUIRED', 409, 'No se pudo restaurar el saldo del cliente');
                await tx.customerCreditEntry.create({ data: {
                    tenantId: authReq.tenantId!, customerId: sale.customerId, saleId,
                    type: 'VOID_RESTORE', amount: saldoFavorARestaurar.toFixed(4),
                    balanceAfter: balanceAfter.toFixed(4), createdBy: authReq.userId!,
                } });
            }

            // 4 · Asiento de REVERSIÓN: los mismos renglones de la venta con
            //     débito y crédito INVERTIDOS. Cuadra por construcción (el
            //     original cuadraba) y deja el rastro contable visible, en vez
            //     de borrar el asiento original — que sería falsear el libro.
            const lineasVenta = buildSaleJournalLines(
                Number(sale.total),
                plan.costoTotal.toNumber(),
                sale.paymentMethod,
                sale.exemptTotal == null ? null : Number(sale.exemptTotal),
                {
                    fiscalRegime: sale.fiscalRegimeAtSale,
                    vatAmount: sale.vatAmountAtSale?.toString() ?? null,
                    storeCreditApplied: sale.storeCreditApplied?.toString() ?? 0,
                },
            );
            // Una anulación mueve inventario y dinero: si el asiento no puede
            // persistirse, el error debe abortar esta misma transacción.
            await createJournalEntry(
                tx, authReq.tenantId!,
                `Anulación de venta #${saleId.slice(0, 8)}`,
                saleId, 'SALE_CANCELLED', authReq.userId!,
                lineasVenta.map(line => ({
                    accountCode: line.accountCode,
                    debit: line.credit,
                    credit: line.debit,
                })),
            );

            // 5 · AUDITORÍA INMUTABLE, en la MISMA transacción (Capa 3).
            await tx.auditLog.create({
                data: {
                    tenantId: authReq.tenantId!,
                    userId: authReq.userId!,
                    action: 'SALE_VOIDED',
                    details: JSON.stringify({
                        saleId,
                        invoiceSeries: sale.invoiceSeries,
                        invoiceNumber: sale.invoiceNumber,
                        motivo,
                        before: { status: sale.status, balance: String(sale.balance), cancelledAt: null },
                        after: { status: ESTADO_ANULADA, balance: '0' },
                        total: String(sale.total),
                        costoRevertido: plan.costoTotal.toString(),
                        // El efectivo NO se compensa con un movimiento de caja: el
                        // arqueo del turno suma las ventas en efectivo desde las
                        // filas de Sale, así que excluir las anuladas YA lo
                        // revierte. Crear además un movimiento contaría doble.
                        efectivoQueDejaDeContar: Decimal.max(
                            plan.efectivoAReversar.minus(saldoFavorARestaurar), 0,
                        ).toString(),
                        deudaAntes,
                        deudaDespues,
                        items: plan.lineas.map(l => ({
                            productId: l.productId,
                            cantidad: l.cantidad.toString(),
                        })),
                    }),
                },
            });

            const correctionCompleted = await tx.saleCorrectionRequest.updateMany({
                where: { id: correctionRequest.id, tenantId: authReq.tenantId!, status: 'APPROVED' },
                data: { status: 'COMPLETED', executedBy: authReq.userId!, executedAt: new Date() },
            });
            if (correctionCompleted.count !== 1) {
                throw new ReturnResolutionError('CORRECTION_CONCURRENCY_CONFLICT', 409, 'La solicitud cambió mientras se anulaba la venta');
            }

            return { id: saleId, status: ESTADO_ANULADA, motivo };
        });

        res.json({ success: true, ...resultado });
    } catch (error: any) {
        if (error instanceof ReturnResolutionError || error instanceof BatchWarehouseLedgerError) {
            return res.status(error.httpStatus).json({ error: error.message, code: error.code });
        }
        if (error instanceof StockError) {
            return res.status(error.code === 'PRODUCT_NOT_FOUND' ? 409 : 400).json({
                error: error.message,
                code: error.code,
            });
        }
        console.error('Error anulando factura:', error instanceof Error ? error.name : 'UNKNOWN_ERROR');
        res.status(500).json({ error: error?.message || 'No se pudo anular la factura' });
    }
});

// ==========================================
// 💸 PAGOS
// ==========================================

// ⚠️ DEPRECADA: ningún componente del SPA llama esta ruta — los abonos a crédito
// entran por /api/credits/payment. Se mantiene funcional por compatibilidad de API,
// pero NO construir consumidores nuevos sobre ella: unificar sobre /api/credits/payment.
app.get('/api/sales/search', authenticate, checkRole(RETURN_SEARCH_ROLES), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const q = String(req.query.q ?? '').trim();
    if (!q) return res.status(400).json({ error: 'Ingresá el ID de la venta', code: 'SALE_ID_REQUIRED' });
    try {
        const sale = await prisma.sale.findFirst({
            where: {
                tenantId: authReq.tenantId,
                id: { startsWith: q }
            },
            include: {
                items: {
                    select: {
                        id: true,
                        productId: true,
                        quantity: true,
                        priceAtSale: true,
                        unitPriceExactAtSale: true,
                        costAtSale: true,
                        discount: true,
                        ivaExento: true,
                        productNameAtSale: true,
                        unitAtSale: true,
                        saleModeAtSale: true,
                        quantityStepAtSale: true,
                        presentationAtSale: true,
                        presentationQuantityAtSale: true,
                        measurement: { select: { source: true, sourceValue: true, sourceUnit: true } },
                    },
                },
                customer: { select: { id: true, name: true } },
                payments: { select: { method: true } },
            }
        });
        if (!sale) return res.status(404).json({ error: 'Venta no encontrada' });

        const productIds = [...new Set(sale.items.map((item) => item.productId))];
        const [previousReturns, products] = await Promise.all([
            prisma.productReturn.findMany({
                where: { saleId: sale.id, tenantId: authReq.tenantId },
                select: { items: true },
            }),
            prisma.product.findMany({
                where: { tenantId: authReq.tenantId, id: { in: productIds } },
                select: { id: true, name: true, unit: true },
            }),
        ]);
        const productsById = new Map<string, ReturnProductAuthority>(
            products.map((product): [string, ReturnProductAuthority] => [product.id, product]),
        );
        const availability = buildReturnAvailability({
            saleItems: sale.items as ReturnSaleItemSnapshot[],
            previousReturns,
            productsById,
            globalDiscount: sale.globalDiscount,
        });
        const rawById = new Map(sale.items.map((item) => [item.id, item]));
        const allowedRefundMethods = allowedReturnRefundMethods({
            salePaymentMethod: sale.paymentMethod,
            payments: sale.payments,
        });
        // Los métodos individuales de los abonos son autoridad interna. La UI
        // recibe solo el conjunto deduplicado de opciones permitidas.
        const { payments: _payments, ...saleForClient } = sale;

        res.json({
            ...saleForClient,
            allowedRefundMethods,
            items: availability.map((line) => ({
                id: line.saleItemId,
                saleItemId: line.saleItemId,
                productId: line.productId,
                productNameAtSale: line.name,
                unitAtSale: line.unit,
                saleModeAtSale: line.saleMode,
                presentationAtSale: line.presentation,
                presentationQuantityAtSale: line.presentationQuantity.toString(),
                quantity: line.soldQuantity.toString(),
                returnedQuantity: line.returnedQuantity.toString(),
                returnableQuantity: line.returnableQuantity.toString(),
                quantityStep: line.quantityStep.toString(),
                priceAtSale: line.priceAtSale.toFixed(2),
                refundUnitPrice: line.refundUnitPrice.toFixed(4),
                ivaExento: line.ivaExento,
                measurement: rawById.get(line.saleItemId)?.measurement
                    ? {
                        source: rawById.get(line.saleItemId)!.measurement!.source,
                        sourceValue: rawById.get(line.saleItemId)!.measurement!.sourceValue.toString(),
                        sourceUnit: rawById.get(line.saleItemId)!.measurement!.sourceUnit,
                    }
                    : null,
            })),
        });
    } catch (error) {
        if (error instanceof ReturnResolutionError) {
            return res.status(error.httpStatus).json({ error: error.message, code: error.code });
        }
        console.error('Error buscando venta para devolución:', error);
        res.status(500).json({ error: 'Error buscando venta' });
    }
});

// Process return
app.post('/api/returns', authenticate, checkRole(['OWNER', 'ADMIN', 'MANAGER', 'CASHIER']), validate(CreateReturnSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { correctionRequestId, clientEventId, saleId, items, reason, refundMethod: explicitRefundMethod } = req.body;
    const payloadHash = buildReturnPayloadHash({
        correctionRequestId,
        saleId,
        items,
        reason,
        refundMethod: explicitRefundMethod,
    });
    try {
        // Fast path para retries ya confirmados y conflicto estable aun cuando
        // el payload nuevo apunte a otra venta. La verificación se repite bajo
        // lock dentro de la transacción para cerrar la carrera con este read.
        const preexistingReturn = await prisma.productReturn.findFirst({
            where: { tenantId: authReq.tenantId, clientEventId },
        });
        if (preexistingReturn) {
            assertMatchingReturnReplay(preexistingReturn, payloadHash);
            return res.json({ ...preexistingReturn, idempotentReplay: true });
        }

        const result = await prisma.$transaction(async (tx: any) => {
            // Orden global de locks para este flujo: Tenant -> Sale -> Product.
            // La activación farmacéutica también empieza por Tenant y después
            // inspecciona ventas; conservar el mismo orden evita el ciclo
            // Tenant -> Sale / Sale -> Tenant durante un cambio de modo.
            // Además, la creación de cuarentenas queda serializada contra OFF.
            const inventorySettingsRows: Array<{
                type: string;
                batchWarehouseLedgerMode: string;
                pharmacyInventoryMode: string;
            }> = await tx.$queryRaw`
                SELECT type, batchWarehouseLedgerMode, pharmacyInventoryMode
                FROM \`Tenant\`
                WHERE id = ${authReq.tenantId}
                FOR UPDATE`;
            const inventorySettings = inventorySettingsRows[0];
            if (!inventorySettings) {
                throw new ReturnResolutionError(
                    'RETURN_TENANT_NOT_FOUND',
                    404,
                    'El negocio autenticado ya no está disponible',
                );
            }
            const batchWarehouseLedgerMode = normalizeBatchWarehouseLedgerMode(
                inventorySettings.batchWarehouseLedgerMode,
            );
            if (inventorySettings.pharmacyInventoryMode !== 'OFF'
                && inventorySettings.pharmacyInventoryMode !== 'ENFORCED') {
                throw new ReturnResolutionError(
                    'PHARMACY_INVENTORY_CONFIGURATION_INVALID',
                    500,
                    'La configuración farmacéutica guardada no es válida',
                );
            }
            const pharmacyQuarantineEnabled = inventorySettings.pharmacyInventoryMode === 'ENFORCED';
            if (pharmacyQuarantineEnabled
                && (inventorySettings.type !== 'FARMACIA' || batchWarehouseLedgerMode !== 'ENFORCED')) {
                throw new ReturnResolutionError(
                    'PHARMACY_INVENTORY_ENFORCEMENT_REQUIRED',
                    409,
                    'La cuarentena farmacéutica exige un tenant FARMACIA y lote-bodega ENFORCED',
                );
            }

            // Todas las devoluciones de una venta se serializan sobre la misma
            // fila. La segunda solicitud concurrente espera, vuelve a sumar el
            // historial y no puede sobrepasar la cantidad de la línea.
            const locked: Array<{ id: string }> = await tx.$queryRaw`
                SELECT id FROM \`Sale\`
                WHERE id = ${saleId} AND \`tenantId\` = ${authReq.tenantId}
                FOR UPDATE`;
            if (locked.length === 0) {
                throw new ReturnResolutionError('SALE_NOT_FOUND', 404, 'Venta no encontrada');
            }

            // Releer después de Tenant y Sale cierra la carrera para retries de
            // una misma venta. El UNIQUE tenant+clientEventId arbitra requests
            // que intenten reutilizar la clave en ventas distintas; el INSERT
            // ocurre dentro de esta tx y cualquier perdedor revierte completo.
            const existingReturn = await tx.productReturn.findFirst({
                where: { tenantId: authReq.tenantId, clientEventId },
            });
            if (existingReturn) {
                assertMatchingReturnReplay(existingReturn, payloadHash);
                return { productReturn: existingReturn, idempotentReplay: true };
            }

            // Serializa el consecutivo por negocio. El lock de Tenant evita que
            // dos devoluciones de ventas distintas obtengan el mismo número.
            await tx.$queryRaw`
                SELECT id FROM \`Tenant\`
                WHERE id = ${authReq.tenantId}
                FOR UPDATE`;
            const lastReturnNumber = await tx.productReturn.aggregate({
                where: { tenantId: authReq.tenantId, returnNumber: { not: null } },
                _max: { returnNumber: true },
            });
            const returnNumber = (lastReturnNumber._max.returnNumber ?? 0) + 1;

            const sale = await tx.sale.findFirst({
                where: { id: saleId, tenantId: authReq.tenantId },
                include: {
                    payments: { select: { method: true, amount: true } },
                    // Una venta creada al entregar conserva el Pedido que hizo
                    // el movimiento físico. Sus filas Kardex usan el id del
                    // pedido, así que se necesitan para restaurar la bodega
                    // original en una devolución posterior.
                    pedidos: { select: { id: true } },
                    items: {
                        select: {
                            id: true,
                            productId: true,
                            quantity: true,
                            priceAtSale: true,
                            unitPriceExactAtSale: true,
                            costAtSale: true,
                            discount: true,
                            ivaExento: true,
                            productNameAtSale: true,
                            unitAtSale: true,
                            saleModeAtSale: true,
                            quantityStepAtSale: true,
                            presentationAtSale: true,
                            presentationQuantityAtSale: true,
                        },
                    },
                },
            });
            if (!sale) throw new ReturnResolutionError('SALE_NOT_FOUND', 404, 'Venta no encontrada');

            const correctionRequest = await tx.saleCorrectionRequest.findFirst({
                where: {
                    id: correctionRequestId,
                    tenantId: authReq.tenantId!,
                    saleId,
                    kind: 'RETURN',
                    status: 'APPROVED',
                },
                include: { lines: true },
            });
            if (!correctionRequest || textoUtil(correctionRequest.reason) !== textoUtil(reason)) {
                throw new ReturnResolutionError(
                    'APPROVED_CORRECTION_REQUIRED',
                    409,
                    'La devolución requiere una solicitud aprobada que coincida con este motivo',
                );
            }
            const approvedLines = new Map<string, { quantity: Decimal; disposition: string; id: string }>(correctionRequest.lines.map((line: any) => [
                line.saleItemId,
                { quantity: new Decimal(line.quantity.toString()), disposition: line.disposition, id: line.id },
            ]));
            if (items.length !== approvedLines.size) {
                throw new ReturnResolutionError('CORRECTION_PAYLOAD_MISMATCH', 409, 'Las líneas no coinciden con la solicitud aprobada');
            }
            for (const requested of items) {
                const approved = requested.saleItemId ? approvedLines.get(requested.saleItemId) : null;
                if (!approved || !approved.quantity.equals(new Decimal(requested.quantity))) {
                    throw new ReturnResolutionError('CORRECTION_PAYLOAD_MISMATCH', 409, 'Las cantidades no coinciden con la solicitud aprobada');
                }
            }
            if (
                correctionRequest.resolution === 'REFUND'
                && correctionRequest.refundMethod !== explicitRefundMethod
            ) {
                throw new ReturnResolutionError('CORRECTION_PAYLOAD_MISMATCH', 409, 'El canal de reembolso no coincide con la aprobación');
            }

            // ESPEJO de la guarda de anulación (DGI-5). La regla pura ya rechaza
            // ANULAR una venta que tiene devoluciones; este es el otro lado de la
            // misma moneda y sin él la anulación abriría un hueco que antes no
            // existía: al anular, la mercadería YA volvió al inventario y el
            // documento ya dejó de contar. Una nota de crédito encima sumaría el
            // stock por SEGUNDA vez y le acreditaría al cliente un dinero que ya
            // se le había revertido.
            //
            // Va DENTRO de la transacción y DESPUÉS del `FOR UPDATE` sobre Sale:
            // afuera sería una lectura sin lock y una anulación concurrente
            // podría colarse entre el chequeo y el movimiento de stock.
            if (sale.status === ESTADO_ANULADA || sale.cancelledAt !== null) {
                throw new ReturnResolutionError(
                    'SALE_VOIDED',
                    400,
                    'Esta factura está anulada: la mercadería ya volvió al inventario y la venta ya no cuenta. No se devuelve sobre una factura anulada.'
                );
            }

            const productIds = [...new Set(sale.items.map((item: any) => item.productId as string))];
            const pedidoReferenceIds = sale.pedidos.map((pedido: { id: string }) => pedido.id);
            const [previousReturns, products, saleKardexLocations] = await Promise.all([
                tx.productReturn.findMany({
                    where: { saleId, tenantId: authReq.tenantId },
                    select: { items: true, total: true },
                }),
                tx.product.findMany({
                    where: { tenantId: authReq.tenantId, id: { in: productIds } },
                    select: { id: true, name: true, unit: true, requiresBatchTracking: true },
                }),
                tx.kardexMovement.findMany({
                    where: {
                        tenantId: authReq.tenantId,
                        OR: [
                            { referenceId: saleId, referenceType: 'SALE', type: 'SALE' },
                            ...(pedidoReferenceIds.length > 0
                                ? [{
                                    referenceId: { in: pedidoReferenceIds },
                                    referenceType: { in: ['PEDIDO_RESERVA', 'PEDIDO_VENTA'] },
                                    type: 'OUT',
                                }]
                                : []),
                        ],
                    },
                    select: { productId: true, batchId: true, warehouseId: true },
                }),
            ]);
            if (products.length !== productIds.length) {
                throw new ReturnResolutionError('RETURN_PRODUCT_NOT_FOUND', 409, 'Un producto de la venta ya no está disponible para restaurar stock');
            }
            const productsById = new Map<string, ReturnProductAuthority>(
                products.map((product: ReturnProductAuthority): [string, ReturnProductAuthority] => [product.id, product]),
            );
            const productsWithBatchKardex = new Set(
                saleKardexLocations
                    .filter((movement: { batchId?: string | null }) => Boolean(movement.batchId))
                    .map((movement: { productId: string }) => movement.productId),
            );
            const returnWarehouseId = resolveReturnWarehouseId(saleKardexLocations);
            const resolved = resolveRequestedReturnItems({
                saleItems: sale.items as ReturnSaleItemSnapshot[],
                previousReturns,
                requestedItems: items,
                productsById,
                globalDiscount: sale.globalDiscount,
            });

            // ORDEN DE BLOQUEO GLOBAL: Sale → Product → Shift.
            //
            // Las compras de contado también bloquean Product antes que Shift.
            // Prebloqueamos todos los productos de la devolución en un orden
            // determinista para que `applyStockDelta` reutilice estos locks más
            // adelante y no pueda ciclar contra una compra concurrente.
            const returnProductIdsInLockOrder = [
                ...new Set(resolved.items.map((item) => item.productId)),
            ].sort();
            for (const productId of returnProductIdsInLockOrder) {
                const lockedProductRows: Array<{ id: string }> = await tx.$queryRaw`
                    SELECT id
                    FROM \`Product\`
                    WHERE id = ${productId}
                      AND \`tenantId\` = ${authReq.tenantId}
                    FOR UPDATE`;
                if (lockedProductRows.length !== 1) {
                    throw new ReturnResolutionError(
                        'RETURN_PRODUCT_NOT_FOUND',
                        409,
                        'Un producto de la venta ya no está disponible para restaurar stock',
                    );
                }
            }

            // OFF conserva exactamente el restaurador legacy. SHADOW/ENFORCED
            // leen la evidencia nueva bajo el mismo lock de Sale y solo la
            // PLANEAN acá: ENFORCED debe poder rechazar evidencia incompleta
            // antes de ProductReturn, stock, caja o contabilidad.
            const allocationsBySaleItem = new Map<string, any[]>();
            if (batchWarehouseLedgerMode !== 'OFF') {
                const allocationRows = await tx.saleItemBatchAllocation.findMany({
                    where: {
                        tenantId: authReq.tenantId!,
                        saleItemId: { in: resolved.items.map(item => item.saleItemId) },
                        saleItem: { saleId, sale: { tenantId: authReq.tenantId! } },
                        batch: { tenantId: authReq.tenantId! },
                    },
                    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                    select: {
                        id: true,
                        saleItemId: true,
                        batchId: true,
                        warehouseId: true,
                        quantity: true,
                        batch: { select: { productId: true, batchNumber: true } },
                    },
                });
                for (const allocation of allocationRows) {
                    const bucket = allocationsBySaleItem.get(allocation.saleItemId) ?? [];
                    bucket.push({
                        id: allocation.id,
                        saleItemId: allocation.saleItemId,
                        productId: allocation.batch.productId,
                        batchId: allocation.batchId,
                        batchNumber: allocation.batch.batchNumber,
                        warehouseId: allocation.warehouseId,
                        quantity: allocation.quantity,
                    });
                    allocationsBySaleItem.set(allocation.saleItemId, bucket);
                }
            }

            const lineById = new Map<string, ReturnSaleItemSnapshot>(
                sale.items.map((line: any): [string, ReturnSaleItemSnapshot] => [line.id, line]),
            );
            const productLineCounts = new Map<string, number>();
            for (const line of sale.items) {
                productLineCounts.set(
                    line.productId,
                    (productLineCounts.get(line.productId) ?? 0) + 1,
                );
            }
            const shouldQuarantineReturnItem = (item: { saleItemId: string; productId: string }): boolean =>
                pharmacyQuarantineEnabled && (
                    productsById.get(item.productId)?.requiresBatchTracking === true
                    || productsWithBatchKardex.has(item.productId)
                    || (allocationsBySaleItem.get(item.saleItemId)?.length ?? 0) > 0
                );
            const resolvedWithBatches: Array<{
                item: typeof resolved.items[number];
                batchRestoration: BatchRestorationResult | ReturnBatchRestorationPlan;
            }> = [];
            for (const item of resolved.items) {
                const saleItem = lineById.get(item.saleItemId);
                if (!saleItem) {
                    throw new ReturnResolutionError(
                        'SALE_ITEM_NOT_FOUND',
                        404,
                        'La línea de venta ya no está disponible',
                    );
                }
                const disposition = approvedLines.get(item.saleItemId)?.disposition ?? 'RESTOCK';
                const requiresBatchTracking =
                    productsById.get(item.productId)?.requiresBatchTracking === true
                    || productsWithBatchKardex.has(item.productId)
                    || (allocationsBySaleItem.get(item.saleItemId)?.length ?? 0) > 0;
                const batchRestoration = disposition === 'RESTOCK' && batchWarehouseLedgerMode === 'OFF'
                    ? await restoreSaleItemBatchesForReturn(tx, {
                        tenantId: authReq.tenantId!,
                        saleItemId: item.saleItemId,
                        productId: item.productId,
                        quantity: item.quantity,
                        previousReturns,
                    })
                    : planReturnBatchRestoration({
                        saleItem,
                        requestedQuantity: item.quantity,
                        sameProductLineCount: productLineCounts.get(item.productId) ?? 0,
                        requiresBatchTracking,
                        previousReturns,
                        allocations: allocationsBySaleItem.get(item.saleItemId) ?? [],
                        ledgerMode: batchWarehouseLedgerMode,
                    });
                const restoredQuantity = (batchRestoration.batchRestorations as readonly { quantity: Decimal }[]).reduce(
                    (sum, restoration) => sum.plus(restoration.quantity),
                    new Decimal(batchRestoration.aggregateOnlyQuantity),
                );
                if (!restoredQuantity.equals(item.quantity)) {
                    throw new ReturnResolutionError(
                        'RETURN_BATCH_RESTORATION_INVALID',
                        500,
                        'El desglose por lote no coincide con la cantidad devuelta',
                    );
                }
                if (shouldQuarantineReturnItem(item)
                    && (batchRestoration.aggregateOnlyQuantity.greaterThan(0)
                        || batchRestoration.batchRestorations.some(
                            restoration => !('warehouseId' in restoration) || !restoration.warehouseId,
                        ))) {
                    throw new ReturnResolutionError(
                        'PHARMACY_RETURN_EXACT_BATCH_REQUIRED',
                        409,
                        'La devolución farmacéutica requiere lote y bodega exactos para entrar en cuarentena',
                    );
                }
                resolvedWithBatches.push({ item, batchRestoration });
            }

            const persistItems = resolvedWithBatches.map(({ item, batchRestoration }) => ({
                saleItemId: item.saleItemId,
                productId: item.productId,
                name: item.name,
                productNameAtSale: item.name,
                unit: item.unit,
                unitAtSale: item.unit,
                saleModeAtSale: item.saleMode,
                quantityStepAtSale: item.quantityStep.toString(),
                presentation: item.presentation,
                presentationAtSale: item.presentation,
                presentationQuantity: item.presentationQuantity.toString(),
                presentationQuantityAtSale: item.presentationQuantity.toString(),
                soldQuantityAtSale: item.soldQuantity.toString(),
                quantity: item.quantity.toString(),
                priceAtSale: item.priceAtSale.toFixed(4),
                refundUnitPrice: item.refundUnitPrice.toFixed(4),
                lineTotal: item.lineTotal.toDecimalPlaces(2).toFixed(2),
                ivaExento: item.ivaExento,
                disposition: approvedLines.get(item.saleItemId)?.disposition ?? 'RESTOCK',
                batchRestorationMode: batchRestoration.mode,
                batchRestorations: batchRestoration.batchRestorations.map((restoration) => ({
                    batchId: restoration.batchId,
                    batchNumber: restoration.batchNumber,
                    quantity: restoration.quantity.toString(),
                    ...('allocationId' in restoration
                        ? {
                            allocationId: restoration.allocationId,
                            warehouseId: restoration.warehouseId,
                        }
                        : {}),
                })),
                aggregateOnlyQuantity: batchRestoration.aggregateOnlyQuantity.toString(),
                ...(batchWarehouseLedgerMode === 'OFF'
                    ? {}
                    : { batchWarehouseLedgerMode }),
                inventoryDisposition: shouldQuarantineReturnItem(item)
                    ? 'QUARANTINE'
                    : 'SELLABLE',
            }));

            const balanceStored = new Decimal(sale.balance.toString());
            const balanceBefore = Decimal.max(balanceStored, 0).toDecimalPlaces(2);
            let creditReduction = new Decimal(0);
            let settledRefund = resolved.total;
            let balanceAfter = balanceBefore;

            if (sale.paymentMethod === 'CREDIT') {
                creditReduction = Decimal.min(resolved.total, balanceBefore).toDecimalPlaces(2);
                settledRefund = resolved.total.minus(creditReduction).toDecimalPlaces(2);
                balanceAfter = balanceBefore.minus(creditReduction).toDecimalPlaces(2);
            }

            const resolution = correctionRequest.resolution ?? 'REFUND';
            const storeCreditAppliedAtSale = new Decimal(sale.storeCreditApplied?.toString() ?? 0);
            let storeCreditRestoration = new Decimal(0);
            if (resolution === 'REFUND' && storeCreditAppliedAtSale.greaterThan(0)) {
                const saleTotal = new Decimal(sale.total.toString());
                const priorReturnedTotal = previousReturns.reduce(
                    (sum: Decimal, previous: any) => sum.plus(new Decimal(previous.total?.toString() ?? 0)),
                    new Decimal(0),
                );
                const priorRestored = await tx.customerCreditEntry.aggregate({
                    where: { tenantId: authReq.tenantId!, saleId, type: 'SALE_RETURN_CREDIT' },
                    _sum: { amount: true },
                });
                const restoredBefore = new Decimal(priorRestored._sum.amount?.toString() ?? 0);
                const targetCumulative = Decimal.min(
                    storeCreditAppliedAtSale,
                    priorReturnedTotal.plus(resolved.total).mul(storeCreditAppliedAtSale).div(saleTotal),
                ).toDecimalPlaces(2);
                storeCreditRestoration = Decimal.max(targetCumulative.minus(restoredBefore), 0)
                    .toDecimalPlaces(2);
                storeCreditRestoration = Decimal.min(storeCreditRestoration, settledRefund);
                settledRefund = settledRefund.minus(storeCreditRestoration).toDecimalPlaces(2);
            }
            const refundMethod = resolution === 'REFUND'
                ? resolveReturnRefundMethod({
                    salePaymentMethod: sale.paymentMethod,
                    payments: sale.payments,
                    explicitRefundMethod: correctionRequest.refundMethod as any,
                    settledRefund,
                })
                : null;
            const requiresCashDrawer = settledRefund.greaterThan(0) && refundMethod === 'CASH';

            // ORDEN DE BLOQUEO GLOBAL: Sale → Product → Shift. El cierre Z solo
            // acepta devoluciones con un turno procesador inequívoco. Una
            // devolución no efectiva nunca puede caer en el turno de otro
            // usuario; el fallback del tenant existe únicamente para ubicar el
            // cajón físico de un reembolso CASH.
            type ReturnProcessingShift = { id: string; initialCash: any; initialCashUsd: any };
            const ownProcessingShifts: ReturnProcessingShift[] = await tx.$queryRaw`
                SELECT id, initialCash, initialCashUsd
                FROM \`Shift\`
                WHERE \`tenantId\` = ${authReq.tenantId}
                  AND \`userId\` = ${authReq.userId}
                  AND status = 'OPEN'
                ORDER BY startTime DESC, id ASC
                LIMIT 2
                FOR UPDATE`;
            let tenantProcessingShifts: ReturnProcessingShift[] = [];
            if (requiresCashDrawer && ownProcessingShifts.length === 0) {
                tenantProcessingShifts = await tx.$queryRaw`
                    SELECT id, initialCash, initialCashUsd
                    FROM \`Shift\`
                    WHERE \`tenantId\` = ${authReq.tenantId}
                      AND status = 'OPEN'
                    ORDER BY startTime DESC, id ASC
                    LIMIT 2
                    FOR UPDATE`;
            }

            const shiftAttribution = (() => {
                try {
                    return resolveReturnShiftAttribution({
                        ownOpenShifts: ownProcessingShifts,
                        tenantOpenShifts: tenantProcessingShifts,
                        requiresCashDrawer,
                    });
                } catch (error) {
                    if (error instanceof ReturnShiftAttributionError) {
                        throw new ReturnResolutionError(error.code, error.httpStatus, error.message);
                    }
                    throw error;
                }
            })();
            const processingShift = shiftAttribution.processingShift;
            const processedShiftId = shiftAttribution.processedShiftId;
            const refundShiftId = shiftAttribution.refundShiftId;

            // La atribución se resuelve antes del INSERT: toda fila aceptada
            // participa de exactamente un cierre Z y processedShiftId nunca es
            // nulo. En CASH coincide además con el cajón que recibe el OUT.
            const productReturn = await tx.productReturn.create({
                data: {
                    tenantId: authReq.tenantId,
                    saleId,
                    processedShiftId,
                    total: resolved.total.toFixed(2),
                    reason,
                    items: persistItems,
                    createdBy: authReq.userId,
                    clientEventId,
                    payloadHash,
                    correctionRequestId: correctionRequest.id,
                    returnNumber,
                    resolution: correctionRequest.resolution ?? 'REFUND',
                    refundStatus: 'NOT_REQUIRED',
                }
            });

            await tx.productReturnItem.createMany({
                data: resolved.items.map((item) => ({
                    tenantId: authReq.tenantId!,
                    productReturnId: productReturn.id,
                    saleItemId: item.saleItemId,
                    productId: item.productId,
                    quantity: item.quantity.toFixed(4),
                    refundUnitPrice: item.refundUnitPrice.toFixed(4),
                    lineTotal: item.lineTotal.toFixed(4),
                    costTotal: item.lineCost.toFixed(4),
                    disposition: approvedLines.get(item.saleItemId)?.disposition ?? 'RESTOCK',
                    productNameAtReturn: item.name,
                    unitAtReturn: item.unit,
                })),
            });

            let debtBefore: string | null = null;
            let debtAfter: string | null = null;

            if (sale.paymentMethod === 'CREDIT') {

                // El lock de Sale serializa devoluciones/pagos de esta factura;
                // el predicado de balance deja un segundo guard ante escrituras
                // externas y evita cualquier saldo negativo.
                const saleUpdated = await tx.sale.updateMany({
                    where: { id: saleId, tenantId: authReq.tenantId, balance: sale.balance },
                    data: {
                        balance: balanceAfter.toFixed(2),
                        status: balanceAfter.isZero() ? 'PAID' : 'CREDIT_PENDING',
                    },
                });
                if (saleUpdated.count !== 1) {
                    throw new ReturnResolutionError(
                        'RETURN_CREDIT_CONCURRENCY_CONFLICT',
                        409,
                        'El saldo de la venta cambió mientras se procesaba la devolución; volvé a intentarlo',
                    );
                }

                if (creditReduction.greaterThan(0)) {
                    if (!sale.customerId) {
                        throw new ReturnResolutionError(
                            'RETURN_CREDIT_CUSTOMER_REQUIRED',
                            409,
                            'La venta a crédito no tiene un cliente válido para reducir su deuda',
                        );
                    }
                    const customer = await tx.customer.findFirst({
                        where: { id: sale.customerId, tenantId: authReq.tenantId },
                        select: { currentDebt: true },
                    });
                    if (!customer) {
                        throw new ReturnResolutionError(
                            'RETURN_CREDIT_CUSTOMER_REQUIRED',
                            409,
                            'El cliente de la venta ya no está disponible para reducir su deuda',
                        );
                    }
                    const currentDebt = new Decimal(customer.currentDebt.toString());
                    debtBefore = currentDebt.toFixed(2);
                    if (currentDebt.isNegative() || currentDebt.lessThan(creditReduction)) {
                        throw new ReturnResolutionError(
                            'RETURN_CREDIT_DEBT_RECONCILIATION_REQUIRED',
                            409,
                            'La deuda del cliente no coincide con el saldo de la venta; requiere conciliación',
                        );
                    }
                    const customerUpdated = await tx.customer.updateMany({
                        where: {
                            id: sale.customerId,
                            tenantId: authReq.tenantId,
                            currentDebt: customer.currentDebt,
                        },
                        data: { currentDebt: { decrement: creditReduction.toFixed(2) } },
                    });
                    if (customerUpdated.count !== 1) {
                        throw new ReturnResolutionError(
                            'RETURN_CREDIT_CONCURRENCY_CONFLICT',
                            409,
                            'La deuda del cliente cambió mientras se procesaba la devolución; volvé a intentarlo',
                        );
                    }
                    debtAfter = currentDebt.minus(creditReduction).toFixed(2);
                }
            }

            let cashMovementId: string | null = null;
            if (requiresCashDrawer) {
                // La plata sale de la gaveta ABIERTA ahora, no del turno histórico
                // de la venta. Solo se acepta la caja propia o un único fallback
                // abierto del tenant; dos cajas abiertas sin dueña propia vuelve
                // ambigua la atribución del arqueo.
                const lockedShift = processingShift;

                // Los OUT se serializan por Shift y las filas CashMovement se leen
                // como lectura corriente. Las ventas solo SUMAN efectivo: no se
                // bloquean para evitar invertir el orden Sale→Shift entre dos
                // devoluciones concurrentes; una venta nueva omitida solo vuelve
                // este guard más conservador, nunca permite sobregirar.
                const cashSales: Array<{ total: any; storeCreditApplied: any }> = await tx.$queryRaw`
                    SELECT total, storeCreditApplied FROM \`Sale\`
                    WHERE \`tenantId\` = ${authReq.tenantId}
                      AND shiftId = ${lockedShift.id}
                      AND paymentMethod = 'CASH'`;
                const cashMovements: Array<{
                    type: string;
                    amount: any;
                    currency: string | null;
                    category: string | null;
                    isVoided: boolean;
                }> = await tx.$queryRaw`
                    SELECT type, amount, currency, category, isVoided
                    FROM \`CashMovement\`
                    WHERE \`tenantId\` = ${authReq.tenantId}
                      AND shiftId = ${lockedShift.id}
                    FOR UPDATE`;
                const availableCash = calcularEfectivoTurno({
                    initialCash: lockedShift.initialCash,
                    initialCashUsd: lockedShift.initialCashUsd,
                    cashSales: cashSales.reduce(
                        (sum, cashSale) => sum.plus(
                            new Decimal(cashSale.total.toString()).minus(cashSale.storeCreditApplied?.toString() ?? 0),
                        ),
                        new Decimal(0),
                    ),
                    movimientos: cashMovements.map((movement) => ({
                        ...movement,
                        amount: movement.amount.toString(),
                    })),
                }).efectivoNIO;
                if (settledRefund.greaterThan(availableCash)) {
                    throw new ReturnResolutionError(
                        'RETURN_CASH_INSUFFICIENT',
                        409,
                        `Efectivo insuficiente en caja: disponible C$${availableCash.toFixed(2)}, reembolso C$${settledRefund.toFixed(2)}`,
                    );
                }

                const cashMovement = await appendSignedCashMovement(tx, {
                    tenantId: authReq.tenantId!,
                    shiftId: lockedShift.id,
                    userId: authReq.userId!,
                    type: 'OUT',
                    amount: settledRefund.toFixed(2),
                    currency: 'NIO',
                    category: 'DEVOLUCION',
                    description: `Reembolso devolución #${productReturn.id.slice(0, 8)}`,
                    expenseId: null,
                });
                cashMovementId = cashMovement.id;
            }

            // OFF queda byte-a-byte en su semántica anterior: ProductBatch se
            // restauró en el helper legacy y el agregado vuelve a la bodega
            // derivada del Kardex. Los modos 2B.0 ejecutan primero el sidecar
            // exacto, luego ProductBatch, stock agregado y Kardex en ESTA tx.
            const returnLinesInLockOrder = batchWarehouseLedgerMode === 'OFF'
                ? resolvedWithBatches
                : [...resolvedWithBatches].sort(
                    (left, right) => left.item.productId.localeCompare(right.item.productId)
                        || left.item.saleItemId.localeCompare(right.item.saleItemId),
                );
            for (const { item, batchRestoration } of returnLinesInLockOrder) {
                const approvedLine = approvedLines.get(item.saleItemId);
                if (approvedLine?.disposition === 'QUARANTINE') {
                    await tx.returnInspection.create({
                        data: {
                            tenantId: authReq.tenantId!,
                            correctionLineId: approvedLine.id,
                            productId: item.productId,
                            quantity: item.quantity.toFixed(4),
                            batchEvidence: {
                                ledgerMode: batchWarehouseLedgerMode,
                                requiresBatchTracking: productsById.get(item.productId)?.requiresBatchTracking === true,
                                returnWarehouseId,
                                aggregateOnlyQuantity: batchRestoration.aggregateOnlyQuantity.toString(),
                                restorations: batchRestoration.batchRestorations.map((restoration) => ({
                                    batchId: restoration.batchId,
                                    batchNumber: restoration.batchNumber,
                                    quantity: restoration.quantity.toString(),
                                    ...('allocationId' in restoration ? {
                                        allocationId: restoration.allocationId,
                                        warehouseId: restoration.warehouseId,
                                    } : {}),
                                })),
                            },
                        },
                    });
                    continue;
                }
                if (approvedLine?.disposition === 'LOSS') continue;
                if (batchWarehouseLedgerMode === 'OFF') {
                    const qty = item.quantity.toNumber();
                    const stockResult = await applyStockDelta(tx, {
                        tenantId: authReq.tenantId,
                        productId: item.productId,
                        delta: qty,
                        enforceSufficient: false,
                        warehouseId: returnWarehouseId ?? undefined,
                    });

                    let stockCursor = new Decimal(stockResult.stockBefore);
                    for (const restoration of batchRestoration.batchRestorations) {
                        const stockAfter = stockCursor.plus(restoration.quantity);
                        await tx.kardexMovement.create({
                            data: {
                                tenantId: authReq.tenantId,
                                productId: item.productId,
                                type: 'RETURN',
                                quantity: restoration.quantity.toNumber(),
                                stockBefore: stockCursor.toNumber(),
                                stockAfter: stockAfter.toNumber(),
                                referenceId: productReturn.id,
                                referenceType: 'RETURN',
                                reason: `Devolución: ${reason} - lote ${restoration.batchNumber}`,
                                userId: authReq.userId,
                                batchId: restoration.batchId,
                                warehouseId: stockResult.warehouseId,
                            },
                        });
                        stockCursor = stockAfter;
                    }

                    if (batchRestoration.aggregateOnlyQuantity.greaterThan(0)) {
                        const stockAfter = stockCursor.plus(batchRestoration.aggregateOnlyQuantity);
                        await tx.kardexMovement.create({
                            data: {
                                tenantId: authReq.tenantId,
                                productId: item.productId,
                                type: 'RETURN',
                                quantity: batchRestoration.aggregateOnlyQuantity.toNumber(),
                                stockBefore: stockCursor.toNumber(),
                                stockAfter: stockAfter.toNumber(),
                                referenceId: productReturn.id,
                                referenceType: 'RETURN',
                                reason: batchRestoration.batchRestorations.length === 0
                                    ? `Devolución: ${reason}`
                                    : `Devolución: ${reason} - sin lote asignado`,
                                userId: authReq.userId,
                                warehouseId: stockResult.warehouseId,
                            },
                        });
                        stockCursor = stockAfter;
                    }

                    if (stockCursor.minus(stockResult.stockAfter).abs().greaterThan('0.000001')) {
                        throw new ReturnResolutionError(
                            'RETURN_BATCH_RESTORATION_INVALID',
                            500,
                            'El Kardex por lote no coincide con el stock restaurado',
                        );
                    }
                    continue;
                }

                const exactPlan = batchRestoration as ReturnBatchRestorationPlan;
                let appliedQuantity = new Decimal(0);
                const restorationsInLockOrder = [...exactPlan.batchRestorations].sort(
                    (left, right) => left.batchId.localeCompare(right.batchId),
                );
                for (const restoration of restorationsInLockOrder) {
                    if (restoration.warehouseId) {
                        await applyBatchWarehouseDelta({
                            tx,
                            mode: batchWarehouseLedgerMode,
                            tenantId: authReq.tenantId!,
                            productId: item.productId,
                            batchId: restoration.batchId,
                            warehouseId: restoration.warehouseId,
                            delta: restoration.quantity.toFixed(4),
                            movementType: 'SALE_RETURN',
                            referenceId: productReturn.id,
                            referenceType: 'PRODUCT_RETURN',
                            userId: authReq.userId!,
                            reason: `Devolución ${productReturn.id}`,
                            sourceKey: `product-return:${productReturn.id}:return-item:${item.saleItemId}:allocation:${restoration.allocationId}:batch:${restoration.batchId}`,
                            allowNegative: false,
                        });

                        // En farmacia ENFORCED la devolución aumenta el stock
                        // físico, pero no vuelve al pool vendible. La retención
                        // exacta comparte esta transacción y deja trazabilidad
                        // append-only por lote+bodega.
                        if (shouldQuarantineReturnItem(item)) {
                            await applyProductBatchHoldDelta({
                                tx,
                                tenantId: authReq.tenantId!,
                                productId: item.productId,
                                batchId: restoration.batchId,
                                warehouseId: restoration.warehouseId,
                                quantityDelta: restoration.quantity.toFixed(4),
                                holdReasonCode: CUSTOMER_RETURN_HOLD_REASON_CODE,
                                referenceId: productReturn.id,
                                referenceType: 'PRODUCT_RETURN',
                                sourceKey: `product-return:${productReturn.id}:quarantine:${restoration.allocationId}`,
                                userId: authReq.userId!,
                                notes: `Devolución de cliente: ${reason}`,
                            });
                        }
                    }

                    const updatedBatch = await tx.productBatch.updateMany({
                        where: {
                            id: restoration.batchId,
                            tenantId: authReq.tenantId!,
                            productId: item.productId,
                        },
                        // ProductBatch.stock sigue siendo la proyección Float legacy.
                        // La autoridad exacta ya se aplicó al sidecar Decimal arriba;
                        // convertimos solo en esta frontera exigida por Prisma.
                        data: { stock: { increment: restoration.quantity.toNumber() } },
                    });
                    if (updatedBatch.count !== 1) {
                        throw new ReturnResolutionError(
                            'RETURN_BATCH_TARGET_NOT_FOUND',
                            409,
                            'Un lote original ya no está disponible para restaurar',
                        );
                    }

                    const stockResult = await applyStockDelta(tx, {
                        tenantId: authReq.tenantId!,
                        productId: item.productId,
                        delta: restoration.quantity.toNumber(),
                        enforceSufficient: false,
                        warehouseId: restoration.warehouseId ?? returnWarehouseId ?? undefined,
                    });
                    await tx.kardexMovement.create({
                        data: {
                            tenantId: authReq.tenantId!,
                            productId: item.productId,
                            type: 'RETURN',
                            quantity: restoration.quantity.toNumber(),
                            stockBefore: stockResult.stockBefore,
                            stockAfter: stockResult.stockAfter,
                            referenceId: productReturn.id,
                            referenceType: 'RETURN',
                            reason: `Devolución: ${reason} - lote ${restoration.batchNumber}`,
                            userId: authReq.userId!,
                            ...(restoration.warehouseId
                                ? { batchId: restoration.batchId }
                                : {}),
                            warehouseId: stockResult.warehouseId,
                        },
                    });
                    appliedQuantity = appliedQuantity.plus(restoration.quantity);
                }

                if (exactPlan.aggregateOnlyQuantity.greaterThan(0)) {
                    const stockResult = await applyStockDelta(tx, {
                        tenantId: authReq.tenantId!,
                        productId: item.productId,
                        delta: exactPlan.aggregateOnlyQuantity.toNumber(),
                        enforceSufficient: false,
                        warehouseId: returnWarehouseId ?? undefined,
                    });
                    await tx.kardexMovement.create({
                        data: {
                            tenantId: authReq.tenantId!,
                            productId: item.productId,
                            type: 'RETURN',
                            quantity: exactPlan.aggregateOnlyQuantity.toNumber(),
                            stockBefore: stockResult.stockBefore,
                            stockAfter: stockResult.stockAfter,
                            referenceId: productReturn.id,
                            referenceType: 'RETURN',
                            reason: exactPlan.batchRestorations.length === 0
                                ? `Devolución: ${reason}`
                                : `Devolución: ${reason} - sin lote asignado`,
                            userId: authReq.userId!,
                            warehouseId: stockResult.warehouseId,
                        },
                    });
                    appliedQuantity = appliedQuantity.plus(exactPlan.aggregateOnlyQuantity);
                }

                for (const gap of exactPlan.reconciliationGaps) {
                    await tx.auditLog.create({
                        data: {
                            tenantId: authReq.tenantId!,
                            userId: authReq.userId!,
                            action: 'BATCH_WAREHOUSE_RETURN_RECONCILIATION_REQUIRED',
                            details: JSON.stringify({
                                saleId,
                                returnId: productReturn.id,
                                saleItemId: item.saleItemId,
                                productId: item.productId,
                                allocationId: gap.allocationId,
                                batchId: gap.batchId,
                                quantity: gap.quantity.toFixed(4),
                                reason: gap.reason,
                            }),
                        },
                    });
                }

                if (!appliedQuantity.equals(item.quantity)) {
                    throw new ReturnResolutionError(
                        'RETURN_BATCH_RESTORATION_INVALID',
                        500,
                        'El movimiento por lote no coincide con la cantidad devuelta',
                    );
                }
            }

            let customerCreditEntryId: string | null = null;
            const customerCreditToAdd = resolution === 'STORE_CREDIT' || resolution === 'EXCHANGE'
                ? settledRefund
                : storeCreditRestoration;
            if (customerCreditToAdd.greaterThan(0)) {
                if (!sale.customerId) {
                    throw new ReturnResolutionError('STORE_CREDIT_CUSTOMER_REQUIRED', 409, 'El saldo a favor requiere un cliente identificado');
                }
                const customer = await tx.customer.findFirst({
                    where: { id: sale.customerId, tenantId: authReq.tenantId! },
                    select: { storeCreditBalance: true },
                });
                if (!customer) throw new ReturnResolutionError('STORE_CREDIT_CUSTOMER_REQUIRED', 409, 'El cliente ya no está disponible');
                const balanceAfterCredit = new Decimal(customer.storeCreditBalance.toString()).plus(customerCreditToAdd).toDecimalPlaces(4);
                const updatedCustomer = await tx.customer.updateMany({
                    where: { id: sale.customerId, tenantId: authReq.tenantId!, storeCreditBalance: customer.storeCreditBalance },
                    data: { storeCreditBalance: balanceAfterCredit.toFixed(4) },
                });
                if (updatedCustomer.count !== 1) throw new ReturnResolutionError('STORE_CREDIT_CONCURRENCY_CONFLICT', 409, 'El saldo a favor cambió; volvé a intentarlo');
                const creditEntry = await tx.customerCreditEntry.create({ data: {
                    tenantId: authReq.tenantId!, customerId: sale.customerId, productReturnId: productReturn.id,
                    saleId,
                    type: resolution === 'REFUND' ? 'SALE_RETURN_CREDIT' : 'RETURN_CREDIT',
                    amount: customerCreditToAdd.toFixed(4), balanceAfter: balanceAfterCredit.toFixed(4), createdBy: authReq.userId!,
                } });
                customerCreditEntryId = creditEntry.id;
            }

            let refundRecordId: string | null = null;
            if (settledRefund.greaterThan(0) && resolution === 'REFUND' && refundMethod) {
                const refundRecord = await tx.returnRefund.create({ data: {
                    tenantId: authReq.tenantId!, saleId, productReturnId: productReturn.id,
                    correctionRequestId: correctionRequest.id, amount: settledRefund.toFixed(4), method: refundMethod,
                    status: refundMethod === 'CASH' ? 'COMPLETED' : 'PENDING',
                    ...(refundMethod === 'CASH' ? {
                        externalReference: cashMovementId ?? 'CASH_DRAWER',
                        evidenceNote: 'Reembolso entregado desde la caja abierta',
                        completedBy: authReq.userId!, completedAt: new Date(),
                    } : {}),
                } });
                refundRecordId = refundRecord.id;
                await tx.productReturn.update({
                    where: { id: productReturn.id },
                    data: { refundStatus: refundMethod === 'CASH' ? 'COMPLETED' : 'PENDING' },
                });
            }

            const restockCostTotal = resolved.items.reduce((sum, item) => (
                approvedLines.get(item.saleItemId)?.disposition === 'RESTOCK'
                    ? sum.plus(item.lineCost)
                    : sum
            ), new Decimal(0)).toDecimalPlaces(4);

            await recordReturn(
                tx,
                authReq.tenantId!,
                authReq.userId!,
                productReturn.id,
                resolved.total.toNumber(),
                restockCostTotal.toNumber(),
                {
                    exemptTotal: resolved.exemptTotal,
                    fiscalRegime: sale.fiscalRegimeAtSale,
                    creditReduction,
                    settledRefund,
                    storeCreditRestoration,
                    refundMethod: resolution === 'REFUND' ? (refundMethod ?? 'CASH') : 'STORE_CREDIT',
                    refundPending: resolution === 'REFUND' && refundMethod !== 'CASH' && settledRefund.greaterThan(0),
                },
            );

            await tx.auditLog.create({
                data: {
                    tenantId: authReq.tenantId!,
                    userId: authReq.userId!,
                    action: 'RETURN_CREATED',
                    details: JSON.stringify({
                        saleId,
                        returnId: productReturn.id,
                        total: resolved.total.toFixed(2),
                        costTotal: restockCostTotal.toFixed(2),
                        exemptTotal: resolved.exemptTotal.toFixed(2),
                        fiscalRegime: normalizeFiscalRegime(sale.fiscalRegimeAtSale),
                        items: persistItems,
                        balanceBefore: balanceBefore.toFixed(2),
                        balanceAfter: balanceAfter.toFixed(2),
                        creditReduction: creditReduction.toFixed(2),
                        settledRefund: settledRefund.toFixed(2),
                        refundMethod,
                        processedShiftId,
                        shiftAttributionSource: shiftAttribution.source,
                        debtBefore,
                        debtAfter,
                        cashMovementId,
                        refundShiftId,
                        refundRecordId,
                        customerCreditEntryId,
                        storeCreditRestoration: storeCreditRestoration.toFixed(2),
                        warehouseId: returnWarehouseId,
                    }),
                },
            });

            const correctionCompleted = await tx.saleCorrectionRequest.updateMany({
                where: { id: correctionRequest.id, tenantId: authReq.tenantId!, status: 'APPROVED' },
                data: { status: 'COMPLETED', executedBy: authReq.userId!, executedAt: new Date() },
            });
            if (correctionCompleted.count !== 1) {
                throw new ReturnResolutionError('CORRECTION_CONCURRENCY_CONFLICT', 409, 'La solicitud cambió mientras se procesaba la devolución');
            }

            return { productReturn, idempotentReplay: false };
        });

        res.json({ ...result.productReturn, idempotentReplay: result.idempotentReplay });
    } catch (error: any) {
        // Cinturón de carrera para motores/aislamientos donde dos locking reads
        // sobre una clave aún inexistente alcancen el INSERT. El unique revierte
        // íntegra la transacción perdedora; luego se clasifica replay/conflicto.
        if (error?.code === 'P2002') {
            const existingReturn = await prisma.productReturn.findFirst({
                where: { tenantId: authReq.tenantId, clientEventId },
            });
            if (existingReturn) {
                try {
                    assertMatchingReturnReplay(existingReturn, payloadHash);
                    return res.json({ ...existingReturn, idempotentReplay: true });
                } catch (idempotencyError) {
                    if (idempotencyError instanceof ReturnResolutionError) {
                        return res.status(idempotencyError.httpStatus).json({
                            error: idempotencyError.message,
                            code: idempotencyError.code,
                        });
                    }
                    throw idempotencyError;
                }
            }
        }
        if (error instanceof BatchRestorationError) {
            return res.status(error.httpStatus).json({ error: error.message, code: error.code });
        }
        if (error instanceof BatchWarehouseLedgerError) {
            return res.status(error.httpStatus).json({ error: error.message, code: error.code });
        }
        if (error instanceof ProductBatchHoldError) {
            return res.status(error.httpStatus).json({ error: error.message, code: error.code });
        }
        if (error instanceof ReturnResolutionError) {
            return res.status(error.httpStatus).json({ error: error.message, code: error.code });
        }
        if (productQuantityErrorResponse(res, error)) return;
        if (error instanceof StockError) {
            return res.status(error.code === 'PRODUCT_NOT_FOUND' ? 409 : 400).json({ error: error.message, code: error.code });
        }
        console.error('Error procesando devolución:', error instanceof Error ? error.name : 'UNKNOWN_ERROR');
        res.status(500).json({ error: 'Error procesando devolución' });
    }
});

// ==========================================
// 🚫 ANULACIÓN DE COMPROBANTES (DGI-5)
// ==========================================
//
// Anular NO es devolver. Devolver mercadería es una operación nueva sobre una
// venta que SÍ ocurrió; anular es declarar que el documento no debió emitirse
// (error de digitación, cobro duplicado, cliente equivocado). Sin este camino,
// ante una factura mal emitida al operario solo le quedaban dos salidas peores:
// dejarla como venta real —y declarar de más— o improvisar una devolución que
// descuadra el inventario con mercadería que nunca se movió.
//
// El comprobante anulado NO se borra: queda visible, marcado, con motivo y
// autor. Su número NO se reutiliza — un correlativo con huecos o repetidos es
// justo lo que la Disposición Técnica 09-2007 prohíbe.
// Alias legacy: comparte exactamente la misma autorización, idempotencia,
// locks y auditoría que el endpoint canónico de cobranza.
app.post(
    '/api/payments',
    authenticate,
    checkRole(CUSTOMER_PAYMENT_ROLES),
    validate(CreatePaymentSchema),
    registerCreditPayment,
);

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
            where: { tenantId: authReq.tenantId!, shiftId: turno.id, paymentMethod: 'CASH', status: { not: ESTADO_ANULADA } },
            _sum: { total: true, storeCreditApplied: true },
        });
        const efectivo = calcularEfectivoTurno({
            initialCash: turno.initialCash.toString(),
            initialCashUsd: turno.initialCashUsd == null ? 0 : turno.initialCashUsd.toString(),
            cashSales: new Decimal(ventasEfectivo._sum.total?.toString() ?? 0)
                .minus(ventasEfectivo._sum.storeCreditApplied?.toString() ?? 0),
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
// Rate limit para apertura de caja: el PIN de 4 dígitos se coteja contra la BD,
// así que sin límite dedicado se puede enumerar el PIN de un compañero bajo el
// globalLimiter.
//
// DOS CORRECCIONES sobre la versión anterior, que era 10/hora por IP a secas:
//
// 1. `skip`: una apertura SIN PIN no adivina nada —la identidad la resuelve el
//    servidor desde el JWT—, así que no tiene por qué gastar cupo. Antes, con
//    el PIN obligatorio, todo intento consumía; ahora el cupo se reserva para
//    lo único que es adivinable.
// 2. `keyGenerator` por usuario del JWT y no por IP. Una tienda entera comparte
//    el router, y las telefónicas de Nicaragua ponen a miles de clientes detrás
//    del mismo NAT: con la llave por IP, un cajero que tecleaba mal su PIN diez
//    veces dejaba sin abrir caja a todo el local —y potencialmente a otros
//    negocios— durante una hora. El que fuerza un PIN necesita un JWT válido
//    igual, así que la llave por usuario acota mejor sin abrir la puerta.
//    Fallback a IP para las peticiones sin token (que igual mueren en
//    `authenticate`).
const shiftOpenLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: { error: '🔒 Demasiados intentos con PIN incorrecto. Esperá 1 hora o abrí la caja sin PIN.' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req: any) => pinNormalizado(req.body?.employeePin) === null,
    keyGenerator: (req: any) => {
        const userId = (req as AuthRequest).userId;
        return userId ? `u:${userId}` : `ip:${req.ip}`;
    },
});
// OJO con el ORDEN: `authenticate` va ANTES del limiter porque `keyGenerator`
// necesita `req.userId`, que lo pone ese middleware. Al revés, la llave caía
// siempre al fallback por IP y el cambio no servía de nada. Las peticiones sin
// token igual mueren en `authenticate` y están cubiertas por el globalLimiter.
app.post('/api/shifts/open', authenticate, shiftOpenLimiter as any, validate(OpenShiftSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { initialCash, initialCashUsd, employeePin } = req.body;

    try {
        // ── Quién abre esta caja ───────────────────────────────────────────
        // El PIN dejó de ser obligatorio. La decisión vive en la función PURA
        // `decidirIdentidadCajero` (services/shiftIdentity.ts) y acá solo se
        // juntan los datos que necesita. Regla dura: cuando no se puede saber
        // quién es el cajero, NO se inventa — `employeeId` queda en null (el
        // schema lo permite) y la auditoría dice por qué. Adivinar pondría el
        // faltante del arqueo a nombre de quien quizá ni estaba en el local.
        const pinDado = pinNormalizado(employeePin);

        const tenantCfg = await prisma.tenant.findUnique({
            where: { id: authReq.tenantId! },
            select: { requireCashierPin: true },
        });

        // El PIN solo se consulta si vino: sin PIN no hay nada que cotejar.
        const empleadoDelPin = pinDado
            ? await prisma.employee.findFirst({
                where: { tenantId: authReq.tenantId, pin: pinDado },
                select: { id: true, firstName: true, lastName: true },
            })
            : null;

        // Empleado enlazado al usuario del JWT. `Employee.userId` es @unique, y
        // el registro del negocio ya lo enlaza: por acá entra el dueño y nunca
        // ve un PIN.
        const empleadoDelUsuario = (!pinDado && authReq.userId)
            ? await prisma.employee.findFirst({
                where: { tenantId: authReq.tenantId, userId: authReq.userId },
                select: { id: true, firstName: true, lastName: true },
            })
            : null;

        // `take: 2` a propósito: solo interesa distinguir "exactamente uno" de
        // "más de uno". Traer la lista entera sería un findMany sin límite
        // sobre una tabla que crece con el negocio (guardrail 2 de escalado).
        const empleadosActivos = (!pinDado && !empleadoDelUsuario)
            ? await prisma.employee.findMany({
                where: { tenantId: authReq.tenantId, status: 'ACTIVE' },
                select: { id: true, firstName: true, lastName: true },
                take: 2,
            })
            : [];

        const identidad = decidirIdentidadCajero({
            requierePin: tenantCfg?.requireCashierPin ?? false,
            pinDado,
            empleadoDelPin: empleadoDelPin?.id ?? null,
            empleadoDelUsuario: empleadoDelUsuario?.id ?? null,
            empleadosActivos: empleadosActivos.map(e => e.id),
        });

        if (!identidad.ok) {
            // 401 para el PIN equivocado (credencial), 400 para el PIN que
            // falta (petición incompleta): son problemas distintos y el POS
            // reacciona distinto a cada uno.
            const codigoHttp = identidad.codigo === 'PIN_INCORRECTO' ? 401 : 400;
            return res.status(codigoHttp).json({ error: identidad.mensaje, codigo: identidad.codigo });
        }

        // Nombre del cajero para la auditoría, si se pudo determinar.
        const employee =
            identidad.employeeId === null ? null :
            [empleadoDelPin, empleadoDelUsuario, ...empleadosActivos]
                .find(e => e?.id === identidad.employeeId) ?? null;

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
                    employeeId: identidad.employeeId,
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
                            employeeId: identidad.employeeId,
                            // `null` cuando no se pudo determinar el cajero. NO
                            // se rellena con el nombre del usuario: quien lea
                            // esto en seis meses tiene que poder distinguir
                            // "no se supo quién" de "fue el dueño".
                            cajero: employee ? `${employee.firstName} ${employee.lastName}` : null,
                            // Cómo se determinó. Es el dato que permite auditar
                            // un faltante: un turno abierto en modo PIN tiene
                            // prueba de presencia; uno en SIN_IDENTIDAD, no.
                            modoIdentidad: identidad.modo,
                            comoSeSupo: explicarModo(identidad.modo),
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
    if (!authReq.tenantId || !authReq.userId) {
        return res.status(401).json({ error: 'Sesión inválida para cerrar caja' });
    }

    try {
        const result = await closeShiftWithReport({
            tenantId: authReq.tenantId!,
            userId: authReq.userId!,
            role: authReq.role,
            shiftId: req.body.shiftId,
            declaredCash: req.body.declaredCash,
            declaredCashUsd: req.body.declaredCashUsd,
            auditNotes: req.body.auditNotes,
        });
        res.json({
            ...result.shift,
            closeReport: result.closeReport,
            manualINs: result.manualINs,
            manualOUTs: result.manualOUTs,
            agentINs: result.agentINs,
            agentOUTs: result.agentOUTs,
            theftAlert: result.theftAlert,
            idempotentReplay: result.idempotentReplay,
        });
    } catch (error) {
        if (error instanceof ShiftCloseError) {
            return res.status(error.httpStatus).json({ error: error.message, code: error.code });
        }
        console.error('Error closing shift:', error);
        res.status(500).json({ error: 'Error cerrando caja' });
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
                sales: { where: { status: { not: ESTADO_ANULADA } }, select: { id: true, total: true, storeCreditApplied: true, paymentMethod: true } }
            }
        });

        // Enriquecer con totales por método de pago
        const enriched = shifts.map((s: any) => {
            const tender = (sale: any) => Number(new Decimal(sale.total.toString()).minus(sale.storeCreditApplied?.toString() ?? 0));
            const cashTotal = s.sales.filter((sale: any) => sale.paymentMethod === 'CASH').reduce((sum: number, sale: any) => sum + tender(sale), 0);
            const cardTotal = s.sales.filter((sale: any) => sale.paymentMethod !== 'CASH' && sale.paymentMethod !== 'CREDIT').reduce((sum: number, sale: any) => sum + tender(sale), 0);
            const creditTotal = s.sales.filter((sale: any) => sale.paymentMethod === 'CREDIT').reduce((sum: number, sale: any) => sum + tender(sale), 0);
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
                sales: { where: { status: { not: ESTADO_ANULADA } }, select: { id: true, total: true, storeCreditApplied: true, paymentMethod: true, createdAt: true } },
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
                .reduce((sum: Decimal, s: any) => sum.plus(
                    new Decimal(s.total.toString()).minus(s.storeCreditApplied?.toString() ?? 0),
                ), new Decimal(0));
            const cashSales = cashSalesD.toNumber();
            // Ventas tarjeta/transferencia
            const cardSales = shift.sales
                .filter((s: any) => s.paymentMethod !== 'CASH' && s.paymentMethod !== 'CREDIT')
                .reduce((sum: number, s: any) => sum + Number(new Decimal(s.total.toString()).minus(s.storeCreditApplied?.toString() ?? 0)), 0);
            // Ventas crédito
            const creditSales = shift.sales
                .filter((s: any) => s.paymentMethod === 'CREDIT')
                .reduce((sum: number, s: any) => sum + Number(new Decimal(s.total.toString()).minus(s.storeCreditApplied?.toString() ?? 0)), 0);

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
                sales: { where: { status: { not: ESTADO_ANULADA } }, select: { total: true, storeCreditApplied: true, paymentMethod: true } }
            }
        });

        // Fetch tenant threshold
        const tenant = await prisma.tenant.findUnique({ where: { id: authReq.tenantId } });
        const theftThreshold = tenant ? Number(tenant.theftAlertThreshold) : 500;

        const closedHistory = closedShifts.map((s: any) => {
            const tender = (sale: any) => Number(new Decimal(sale.total.toString()).minus(sale.storeCreditApplied?.toString() ?? 0));
            const cashTotal = s.sales.filter((sale: any) => sale.paymentMethod === 'CASH').reduce((sum: number, sale: any) => sum + tender(sale), 0);
            const cardTotal = s.sales.filter((sale: any) => sale.paymentMethod !== 'CASH' && sale.paymentMethod !== 'CREDIT').reduce((sum: number, sale: any) => sum + tender(sale), 0);
            const creditTotal = s.sales.filter((sale: any) => sale.paymentMethod === 'CREDIT').reduce((sum: number, sale: any) => sum + tender(sale), 0);
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
    const cashMovementRouteError = (code: string, httpStatus: number, message: string): Error & {
        code: string;
        httpStatus: number;
    } => Object.assign(new Error(message), { code, httpStatus });

    // Los pagos a proveedores pertenecen al subledger de CxP. El atajo
    // histórico de caja no tiene purchaseId, idempotencia ni los guards de
    // documentStatus/paymentHold; permitirlo descuadraría el mayor respecto de
    // Purchase.balanceDue. Las filas históricas siguen siendo legibles/anulables,
    // pero toda escritura nueva debe pasar por /api/purchases/:id/pay.
    if (category.trim().toUpperCase() === 'PAGO_PROVEEDOR') {
        return res.status(409).json({
            error: 'Registrá el pago desde la factura del proveedor en Compras.',
            code: 'SUPPLIER_PAYMENT_REQUIRES_PURCHASE',
        });
    }

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
                    sales: { where: { status: { not: ESTADO_ANULADA } }, select: { total: true, storeCreditApplied: true, paymentMethod: true } },
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
                    .reduce((sum: Decimal, s: any) => sum.plus(
                        new Decimal(s.total.toString()).minus(s.storeCreditApplied?.toString() ?? 0),
                    ), new Decimal(0))
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
            const lockedShiftRows: Array<{
                id: string;
                initialCash: unknown;
                initialCashUsd: unknown;
            }> = await tx.$queryRaw`
                SELECT \`id\`, \`initialCash\`, \`initialCashUsd\`
                  FROM \`Shift\`
                 WHERE \`id\` = ${currentShift.id}
                   AND \`tenantId\` = ${authReq.tenantId}
                   AND \`status\` = 'OPEN'
                 LIMIT 1
                 FOR UPDATE
            `;
            if (lockedShiftRows.length !== 1) {
                throw cashMovementRouteError(
                    'NO_SHIFT',
                    409,
                    'CAJA CERRADA: El turno ya no está abierto para registrar movimientos',
                );
            }
            const lockedShift = lockedShiftRows[0];

            // Revalidación race-safe del saldo para salidas: se bloquea la fila del turno
            // (FOR UPDATE) y se recalcula el efectivo disponible con decimal.js DENTRO de la
            // transacción, cerrando el TOCTOU de dos OUT concurrentes que sobregiran la caja.
            if (type === 'OUT') {
                const movCurrency = currency || 'NIO';
                const freshSales: Array<{ total: any; storeCreditApplied: any }> = movCurrency === 'NIO'
                    ? await tx.sale.findMany({
                        where: { shiftId: currentShift.id, paymentMethod: 'CASH', status: { not: ESTADO_ANULADA } },
                        select: { total: true, storeCreditApplied: true },
                    })
                    : [];
                const freshMovements: Array<{ type: string; amount: any; currency: string | null }> = await tx.cashMovement.findMany({
                    where: { shiftId: currentShift.id, isVoided: false },
                    select: { type: true, amount: true, currency: true },
                });
                const mismaMoneda = (m: any) => (m.currency || 'NIO') === movCurrency;
                const cashSalesTotal = freshSales
                    .reduce((sum: Decimal, s: any) => sum.plus(
                        new Decimal(s.total.toString()).minus(s.storeCreditApplied?.toString() ?? 0),
                    ), new Decimal(0));
                const fondo = movCurrency === 'NIO'
                    ? new Decimal(String(lockedShift.initialCash))
                    : new Decimal(String(lockedShift.initialCashUsd ?? 0));
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

            // Auto-crear Expense solo para salidas operativas. Un pago a
            // proveedor nunca es Expense y se registra por el subledger de CxP.
            if (type === 'OUT' && category === 'GASTO_OPERATIVO') {
                const expense = await tx.expense.create({
                    data: {
                        tenantId: authReq.tenantId,
                        amount: new Decimal(amount).toNumber(),
                        description: `[CAJA] ${description}`,
                        category: 'OPERATIONAL',
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
        if (error?.httpStatus) {
            return res.status(error.httpStatus).json({ error: error.message, code: error.code });
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
                where: { tenantId: authReq.tenantId, shiftId: turnoId, paymentMethod: 'CASH', status: { not: ESTADO_ANULADA } },
                orderBy: { createdAt: 'desc' },
                take: 200,
                select: { id: true, total: true, storeCreditApplied: true, invoiceNumber: true, createdAt: true },
            }),
        ]);

        const ventasComoMovimientos = cashSales.map((s: any) => ({
            id: `venta:${s.id}`,
            saleId: s.id,
            tenantId: authReq.tenantId,
            shiftId: turnoId,
            type: 'IN',
            amount: new Decimal(s.total.toString()).minus(s.storeCreditApplied?.toString() ?? 0).toNumber(),
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
                where: { tenantId: authReq.tenantId, shiftId: shift.id, paymentMethod: 'CASH', status: { not: ESTADO_ANULADA } },
                _sum: { total: true, storeCreditApplied: true },
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
            cashSales: new Decimal(ventasEfectivo._sum.total?.toString() ?? 0)
                .minus(ventasEfectivo._sum.storeCreditApplied?.toString() ?? 0),
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

        // Un COBRO_CREDITO es la proyección de un Payment ya aplicado a Sale y
        // Customer. Anular solo la fila de gaveta dejaría CxC/contabilidad
        // cobradas pero borraría el efectivo del cierre Z. Hasta que exista una
        // reversión integral de abonos, este movimiento derivado es inmutable.
        if (movement.category === 'COBRO_CREDITO') {
            return res.status(409).json({
                error: 'Este movimiento pertenece a un abono. Revertí el abono desde cobranza para mantener caja y contabilidad conciliadas.',
                code: 'CREDIT_PAYMENT_CASH_MOVEMENT_IMMUTABLE',
            });
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

type QuantityConfiguredProduct = {
    saleMode?: string | null;
    quantityStep?: Decimal.Value | null;
};

/**
 * D6: null legado conserva la semántica fraccionaria que Product.stock Float
 * siempre tuvo. Solo COUNTED explícito exige enteros; el adaptador legado usa
 * el paso mínimo persistible de 0.0001 sin reescribir filas históricas.
 */
const quantityRulesForProduct = (product: QuantityConfiguredProduct): { saleMode: SaleMode; quantityStep: Decimal.Value } => ({
    saleMode: product.saleMode === 'COUNTED' ? 'COUNTED' : 'MEASURED',
    quantityStep: product.quantityStep?.toString() || (product.saleMode === 'COUNTED' ? '1' : '0.0001'),
});

/**
 * Valida una cantidad contra el modo/paso autoritativo del producto y devuelve
 * Number únicamente en el borde de las columnas Float legacy.
 */
const contextualProductQuantityDecimal = (
    raw: Decimal.Value,
    product: QuantityConfiguredProduct,
    options: { allowZero?: boolean; signed?: boolean } = {},
): Decimal => {
    let decimal: Decimal;
    try {
        decimal = new Decimal(raw);
    } catch {
        throw new QuantityValidationError('INVALID_QUANTITY', 'La cantidad no es un decimal válido');
    }
    if (!decimal.isFinite()) {
        throw new QuantityValidationError('NON_FINITE_QUANTITY', 'La cantidad debe ser finita');
    }
    if (decimal.isZero() && options.allowZero) return new Decimal(0);
    if (decimal.isNegative() && !options.signed) {
        throw new QuantityValidationError('NON_POSITIVE_QUANTITY', 'La cantidad no puede ser negativa');
    }

    const magnitude = validateQuantity(decimal.abs(), quantityRulesForProduct(product));
    return decimal.isNegative() ? magnitude.negated() : magnitude;
};

const contextualProductQuantity = (
    raw: Decimal.Value,
    product: QuantityConfiguredProduct,
    options: { allowZero?: boolean; signed?: boolean } = {},
): number => contextualProductQuantityDecimal(raw, product, options).toNumber();

/**
 * Una unidad base tampoco puede cambiar mientras existan documentos abiertos
 * expresados en esa unidad. Aunque el stock sea cero, recibir o entregar luego
 * reinterpretaría la cantidad histórica y corrompería inventario/Kardex.
 */
const hasOpenProductUnitCommitments = async (
    tx: any,
    tenantId: string,
    productId: string,
): Promise<boolean> => {
    const [purchaseOrderItem, pedidoItem, quotationItem, publicOrders] = await Promise.all([
        tx.purchaseOrderItem.findFirst({
            where: {
                productId,
                purchaseOrder: {
                    tenantId,
                    status: { in: ['DRAFT', 'APPROVED', 'PARTIALLY_RECEIVED'] },
                },
            },
            select: { id: true },
        }),
        tx.pedidoItem.findFirst({
            where: {
                productoId: productId,
                pedido: { tenantId, estado: { notIn: ['entregado', 'cancelado'] } },
            },
            select: { id: true },
        }),
        tx.quotationItem.findFirst({
            where: {
                productId,
                quotation: { tenantId, status: 'SENT', expiresAt: { gte: new Date() } },
            },
            select: { id: true },
        }),
        tx.publicOrder.findMany({
            where: { tenantId, status: 'PENDING' },
            select: { items: true },
        }),
    ]);
    const pendingPublicOrder = publicOrders.some((order: { items: unknown }) => (
        Array.isArray(order.items)
        && order.items.some((item) => (
            item !== null
            && typeof item === 'object'
            && !Array.isArray(item)
            && (item as Record<string, unknown>).productId === productId
        ))
    ));
    return Boolean(purchaseOrderItem || pedidoItem || quotationItem || pendingPublicOrder);
};

const productQuantityErrorResponse = (res: any, error: unknown, productName?: string) => {
    if (!(error instanceof QuantityValidationError)) return false;
    res.status(400).json({
        error: productName ? `${productName}: ${error.message}` : error.message,
        code: error.code,
    });
    return true;
};

/**
 * PurchaseItem.quantity es Int legacy. `quantityExact` es la autoridad nueva;
 * para fracciones guardamos ceil en la sombra vieja (nunca cero ni menor que
 * lo recibido). Ningún cálculo tocado vuelve a leer este surrogate.
 */
const legacyPurchaseQuantity = (quantity: Decimal): number => {
    if (quantity.isInteger() && quantity.lessThanOrEqualTo(2_147_483_647)) return quantity.toNumber();
    return Decimal.min(quantity.ceil(), 2_147_483_647).toNumber();
};

/**
 * Fusiona disponibilidad farmacéutica sin reemplazar `Product.stock`, que
 * conserva su significado físico. Los listados legacy permanecen byte-compatible
 * y solo el consumidor que pide `includeSellableStock=true` recibe la proyección
 * por la misma bodega que usará la venta. Los chunks evitan IN gigantes.
 */
const withPharmacySellableStock = async <T extends { id: string; requiresBatchTracking?: boolean }>(
    products: T[],
    authReq: AuthRequest,
): Promise<Array<T & { sellableStock?: number; availabilityWarehouseId?: string }>> => {
    if (products.length === 0) return products;

    const availabilityByProductId = new Map<string, Decimal>();
    let enforced = false;
    let warehouseId: string | null = null;
    for (let offset = 0; offset < products.length; offset += MAX_PHARMACY_AVAILABILITY_PRODUCTS) {
        const chunk = products.slice(offset, offset + MAX_PHARMACY_AVAILABILITY_PRODUCTS);
        const result = await resolvePharmacyProductAvailability(prisma, {
            tenantId: authReq.tenantId!,
            userId: authReq.userId!,
            productIds: chunk.map(product => product.id),
        });
        if (offset === 0 && !result.enforced) return products;
        if (!result.enforced || !result.warehouse) {
            throw new PharmacyAvailabilityError(
                'INVALID_CONFIGURATION',
                'La configuración farmacéutica cambió durante la lectura; reintentá',
            );
        }
        if (warehouseId !== null && warehouseId !== result.warehouse.id) {
            throw new PharmacyAvailabilityError(
                'INVALID_CONFIGURATION',
                'La bodega operativa cambió durante la lectura; reintentá',
            );
        }
        enforced = true;
        warehouseId = result.warehouse.id;
        for (const [productId, availability] of result.byProductId) {
            availabilityByProductId.set(productId, availability.sellableStock);
        }
    }

    if (!enforced || !warehouseId) return products;
    return products.map(product => {
        const sellableStock = availabilityByProductId.get(product.id);
        if (sellableStock === undefined) {
            throw new PharmacyAvailabilityError(
                'INVALID_CONFIGURATION',
                `No se pudo calcular la existencia vendible de ${product.id}`,
            );
        }
        return {
            ...product,
            sellableStock: sellableStock.toDecimalPlaces(4).toNumber(),
            availabilityWarehouseId: warehouseId!,
        };
    });
};

// GET /api/products - Lista todos los productos (disponible para todos)
app.get('/api/products', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const includeSellableStock = req.query.includeSellableStock === 'true';
    const { search, lowStock, category, status, family, mode, sort, dir, page, pageSize } = req.query;

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
        if (family) whereClause.productFamily = String(family);
        if (mode === 'LEGACY') whereClause.saleMode = null;
        else if (mode === 'COUNTED' || mode === 'MEASURED') whereClause.saleMode = mode;
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
            const productsWithAvailability = includeSellableStock
                ? await withPharmacySellableStock(products, authReq)
                : products;
            const visibleProducts = authReq.role === BODEGUERO_ROLE
                ? productsWithAvailability.map(redactBodegueroProduct)
                : productsWithAvailability;
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

        const productsWithAvailability = includeSellableStock
            ? await withPharmacySellableStock(products, authReq)
            : products;
        res.json(authReq.role === BODEGUERO_ROLE
            ? productsWithAvailability.map(redactBodegueroProduct)
            : productsWithAvailability);
    } catch (error) {
        if (error instanceof PharmacyAvailabilityError) {
            const httpStatus = error.code === 'AUTHORITY_NOT_FOUND' ? 403
                : error.code === 'WAREHOUSE_REQUIRED'
                    || error.code === 'WAREHOUSE_NOT_FOUND'
                    || error.code === 'BATCH_WAREHOUSE_LEDGER_REQUIRED'
                    ? 409
                    : error.code === 'INVALID_AUTHORITY'
                        || error.code === 'INVALID_PRODUCT_IDS'
                        || error.code === 'TOO_MANY_PRODUCTS'
                        ? 400
                        : 500;
            return res.status(httpStatus).json({ error: error.message, code: error.code });
        }
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
app.post('/api/products', authenticate, checkRole(['OWNER', 'ADMIN']), validate(CreateProductSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const {
        name, sku, description, category, price, cost, stock, minStock, unit,
        saleMode, quantityStep, productFamily, isPublished, imageUrl,
        requiresBatchTracking, reorderPoint, maxStock, defaultSupplierId,
        wholesalePrice, wholesaleMinQty, packUnit, packSize, packPrice, ivaExento,
    } = req.body;

    const decimalOrNull = (value: unknown): number | null =>
        value === undefined || value === null || value === '' ? null : new Decimal(value as Decimal.Value).toNumber();
    const wp = decimalOrNull(wholesalePrice);
    const wq = decimalOrNull(wholesaleMinQty);
    const pUnit = typeof packUnit === 'string' && packUnit.trim() !== '' ? packUnit.trim() : null;
    const pSize = decimalOrNull(packSize);
    const pPrice = decimalOrNull(packPrice);
    if (pPrice !== null && pSize === null) {
        return res.status(400).json({ error: 'El precio de empaque requiere definir el tamaño del empaque (unidades por caja/fardo)' });
    }

    try {
        const config = { saleMode, quantityStep };
        const initialStock = contextualProductQuantity(stock ?? '0', config, { allowZero: true });
        const initialMinStock = contextualProductQuantity(minStock ?? '5', config, { allowZero: true });
        const reorder = contextualProductQuantity(reorderPoint ?? '0', config, { allowZero: true });
        const maximum = contextualProductQuantity(maxStock ?? '0', config, { allowZero: true });

        // Verificar que SKU no exista
        const existing = await prisma.product.findUnique({
            where: {
                tenantId_sku: {
                    tenantId: authReq.tenantId!,
                    sku: sku.toUpperCase(),
                }
            }
        });

        if (existing) {
            return res.status(400).json({ error: 'SKU ya existe en tu inventario' });
        }

        if (initialStock > 0 && Boolean(requiresBatchTracking)) {
            const batchWarehouseLedgerMode = await resolveBatchWarehouseLedgerMode(prisma, authReq.tenantId!);
            assertAggregateBatchMutationAllowed({
                mode: batchWarehouseLedgerMode,
                requiresBatchTracking: true,
                delta: initialStock,
            });
        }

        // La bodega default se materializa antes de la tx para evitar la carrera
        // de creación bajo REPEATABLE READ documentada en stockService.
        if (initialStock > 0) await asegurarBodegaPorDefecto(prisma, authReq.tenantId!);

        const product = await prisma.$transaction(async (tx: any) => {
            if (initialStock > 0 && Boolean(requiresBatchTracking)) {
                const authoritativeBatchMode = await resolveBatchWarehouseLedgerMode(tx, authReq.tenantId!);
                assertAggregateBatchMutationAllowed({
                    mode: authoritativeBatchMode,
                    requiresBatchTracking: true,
                    delta: initialStock,
                });
            }
            if (defaultSupplierId) {
                const supplier = await tx.supplier.findFirst({
                    where: { id: defaultSupplierId, tenantId: authReq.tenantId! },
                    select: { id: true },
                });
                if (!supplier) throw new Error('PROVEEDOR_NO_ENCONTRADO');
            }

            // Nace en cero y el stock inicial entra por el mismo camino atómico
            // que cualquier otro movimiento, manteniendo ProductStock y Kardex.
            const created = await tx.product.create({
                data: {
                    tenantId: authReq.tenantId!,
                    name,
                    sku: sku.toUpperCase(),
                    description: description || null,
                    category: category || null,
                    price: new Decimal(price).toNumber(),
                    cost: new Decimal(cost ?? 0).toNumber(),
                    stock: 0,
                    minStock: initialMinStock,
                    unit,
                    saleMode: saleMode ?? null,
                    quantityStep: quantityStep || null,
                    productFamily: productFamily ?? null,
                    isPublished: Boolean(isPublished),
                    ivaExento: Boolean(ivaExento),
                    imageUrl: imageUrl || null,
                    requiresBatchTracking: Boolean(requiresBatchTracking),
                    reorderPoint: reorder,
                    maxStock: maximum,
                    defaultSupplierId: defaultSupplierId || null,
                    wholesalePrice: wp,
                    wholesaleMinQty: wq,
                    packUnit: pUnit,
                    packSize: pSize,
                    packPrice: pPrice,
                    createdBy: authReq.userId!,
                },
            });

            if (initialStock > 0) {
                const stockResult = await applyStockDelta(tx, {
                    tenantId: authReq.tenantId!,
                    productId: created.id,
                    delta: initialStock,
                    enforceSufficient: false,
                });
                await tx.kardexMovement.create({
                    data: {
                        tenantId: authReq.tenantId!,
                        productId: created.id,
                        type: 'IN',
                        quantity: initialStock,
                        stockBefore: stockResult.stockBefore,
                        stockAfter: stockResult.stockAfter,
                        referenceType: 'INITIAL',
                        reason: 'Stock inicial al crear producto',
                        userId: authReq.userId!,
                        warehouseId: stockResult.warehouseId,
                    },
                });
            }

            await tx.auditLog.create({
                data: {
                    tenantId: authReq.tenantId!,
                    userId: authReq.userId!,
                    action: 'PRODUCT_CREATED',
                    details: JSON.stringify({
                        productId: created.id,
                        after: {
                            sku: created.sku,
                            name: created.name,
                            unit: created.unit,
                            saleMode: created.saleMode,
                            quantityStep: created.quantityStep?.toString() ?? null,
                            productFamily: created.productFamily,
                            stock: initialStock,
                        },
                    }),
                },
            });

            return tx.product.findUniqueOrThrow({ where: { id: created.id } });
        });

        res.json(product);
    } catch (error: any) {
        if (productQuantityErrorResponse(res, error)) return;
        if (manualBatchErrorResponse(res, error)) return;
        if (error?.message === 'PROVEEDOR_NO_ENCONTRADO') {
            return res.status(400).json({ error: 'El proveedor por defecto no pertenece a tu negocio' });
        }
        console.error('Error creating product:', error);
        res.status(500).json({ error: 'Error creando producto' });
    }
});

// POST /api/products/bulk - Carga masiva de productos (Solo OWNER)
app.post('/api/products/bulk', authenticate, checkRole(['OWNER', 'ADMIN']), validate(BulkImportProductsSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { products: productList } = req.body;

    try {
        let created = 0;
        let updated = 0;
        let errors: string[] = [];

        // applyStockDelta mantiene también ProductStock. Materializar la bodega
        // fuera de las transacciones evita carreras de primer uso.
        await asegurarBodegaPorDefecto(prisma, authReq.tenantId!);

        // Process in batches of 50 for efficiency
        const batchSize = 50;
        for (let i = 0; i < productList.length; i += batchSize) {
            const batch = productList.slice(i, i + batchSize);

            await prisma.$transaction(async (tx: any) => {
                const batchWarehouseLedgerMode = await resolveBatchWarehouseLedgerMode(tx, authReq.tenantId!);
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
                        const sku = String(item.sku ?? '').trim().toUpperCase();
                        const name = String(item.name ?? item.nombre ?? '').trim();

                        // ⚠️ continue, NO return: un `return` acá sale del
                        // callback COMPLETO de la transacción (no de la
                        // iteración) — una sola fila mala descartaba en
                        // silencio hasta 49 productos restantes del lote y
                        // el resumen igual decía "Importación exitosa".
                        if (!sku || !name) {
                            errors.push(`Fila ${filaExcel}: sin código o sin nombre`);
                            continue;
                        }

                        // Resolver primero la fila existente: una plantilla vieja que no
                        // trae las columnas nuevas NO debe reclasificarla ni borrar stock.
                        const existing = await tx.product.findUnique({
                            where: { tenantId_sku: { tenantId: authReq.tenantId!, sku } }
                        });

                        const has = (key: string) => Object.prototype.hasOwnProperty.call(item, key)
                            && item[key] !== undefined && item[key] !== null && item[key] !== '';
                        const firstPresent = (...keys: string[]) => {
                            const key = keys.find(has);
                            return key ? item[key] : undefined;
                        };
                        const rawSaleMode = firstPresent('saleMode', 'modoVenta', 'modo_venta');
                        const rawStep = firstPresent('quantityStep', 'pasoCantidad', 'paso_cantidad');
                        const rawFamily = firstPresent('productFamily', 'familiaProducto', 'familia_producto');
                        const rawStock = firstPresent('stock', 'existencia');
                        const rawPackUnit = firstPresent('packUnit', 'unidadEmpaque', 'unidad_empaque');
                        const rawPackSize = firstPresent('packSize', 'tamanoEmpaque', 'tamano_empaque');
                        const rawPackPrice = firstPresent('packPrice', 'precioEmpaque', 'precio_empaque');
                        const rawBatchTracking = firstPresent('requiresBatchTracking', 'requiereLote', 'requiere_lote');
                        const rawIvaExento = firstPresent('ivaExento', 'iva_exento');

                        const parsed = CreateProductSchema.safeParse({
                            name,
                            sku,
                            description: firstPresent('description', 'descripcion')
                                ?? existing?.description ?? undefined,
                            category: firstPresent('category', 'categoria')
                                ?? existing?.category ?? 'General',
                            price: firstPresent('price', 'precio') ?? existing?.price ?? 0,
                            cost: firstPresent('cost', 'costo', 'costPrice') ?? existing?.cost ?? 0,
                            stock: rawStock ?? existing?.stock ?? 0,
                            minStock: firstPresent('minStock', 'stockMinimo', 'stock_minimo')
                                ?? existing?.minStock ?? 5,
                            unit: firstPresent('unit', 'unidad') ?? existing?.unit ?? 'unidad',
                            saleMode: rawSaleMode !== undefined
                                ? String(rawSaleMode).trim().toUpperCase()
                                : existing?.saleMode ?? null,
                            quantityStep: rawStep ?? existing?.quantityStep?.toString() ?? null,
                            productFamily: rawFamily !== undefined
                                ? String(rawFamily).trim().toUpperCase()
                                : existing?.productFamily ?? null,
                            packUnit: rawPackUnit ?? existing?.packUnit ?? null,
                            packSize: rawPackSize ?? existing?.packSize ?? null,
                            packPrice: rawPackPrice ?? existing?.packPrice ?? null,
                            requiresBatchTracking: rawBatchTracking ?? existing?.requiresBatchTracking ?? false,
                            ivaExento: rawIvaExento ?? existing?.ivaExento ?? false,
                        });
                        if (!parsed.success) {
                            errors.push(`Fila ${filaExcel} (${sku}): ${parsed.error.issues.map(issue => issue.message).join('; ')}`);
                            continue;
                        }

                        const normalized = parsed.data;
                        const config = { saleMode: normalized.saleMode, quantityStep: normalized.quantityStep };
                        const targetStock = contextualProductQuantity(normalized.stock, config, { allowZero: true });
                        const normalizedMinStock = contextualProductQuantity(normalized.minStock, config, { allowZero: true });
                        const normalizedPrice = new Decimal(normalized.price).toNumber();
                        const normalizedCost = new Decimal(normalized.cost ?? 0).toNumber();
                        const normalizedPackSize = normalized.packSize
                            ? new Decimal(normalized.packSize).toNumber()
                            : null;
                        const normalizedPackPrice = normalized.packPrice
                            ? new Decimal(normalized.packPrice).toNumber()
                            : null;

                        if (existing) {
                            const lockedRows: Array<{
                                stock: Decimal.Value;
                                requiresBatchTracking: boolean;
                            }> = await tx.$queryRaw`
                                SELECT stock, requiresBatchTracking FROM \`Product\`
                                WHERE id = ${existing.id} AND tenantId = ${authReq.tenantId!}
                                FOR UPDATE`;
                            if (lockedRows.length === 0) throw new Error('Producto no encontrado');
                            const stockBeforeLocked = new Decimal(lockedRows[0].stock);
                            // Una plantilla sin columna stock preserva la fila
                            // bloqueada actual, no el snapshot `existing` leído
                            // antes de una venta concurrente.
                            const targetStockUnderLock = rawStock === undefined
                                ? contextualProductQuantity(stockBeforeLocked, config, { allowZero: true })
                                : targetStock;
                            const stockDiff = new Decimal(targetStockUnderLock).minus(stockBeforeLocked);
                            const lockedRequiresBatchTracking = lockedRows[0].requiresBatchTracking;
                            const nextRequiresBatchTracking = rawBatchTracking === undefined
                                ? lockedRequiresBatchTracking
                                : Boolean(normalized.requiresBatchTracking);
                            if (lockedRequiresBatchTracking !== nextRequiresBatchTracking) {
                                const batchHistory = lockedRequiresBatchTracking && !nextRequiresBatchTracking
                                    ? await tx.productBatch.findFirst({
                                        where: { tenantId: authReq.tenantId!, productId: existing.id },
                                        select: { id: true },
                                    })
                                    : null;
                                assertBatchTrackingTransitionAllowed({
                                    mode: batchWarehouseLedgerMode,
                                    currentRequiresBatchTracking: lockedRequiresBatchTracking,
                                    nextRequiresBatchTracking,
                                    currentStock: stockBeforeLocked,
                                    hasBatchHistory: batchHistory !== null,
                                });
                            }
                            assertAggregateBatchMutationAllowed({
                                mode: batchWarehouseLedgerMode,
                                requiresBatchTracking: Boolean(lockedRequiresBatchTracking || nextRequiresBatchTracking),
                                delta: stockDiff,
                            });

                            if (normalized.unit.trim().toLowerCase() !== existing.unit.trim().toLowerCase()) {
                                const [movement, hasOpenCommitments] = await Promise.all([
                                    tx.kardexMovement.findFirst({
                                        where: { tenantId: authReq.tenantId!, productId: existing.id },
                                        select: { id: true },
                                    }),
                                    hasOpenProductUnitCommitments(tx, authReq.tenantId!, existing.id),
                                ]);
                                assertBaseUnitChangeAllowed({
                                    currentUnit: existing.unit,
                                    nextUnit: normalized.unit,
                                    stock: stockBeforeLocked,
                                    hasMovements: movement !== null,
                                    hasOpenCommitments,
                                });
                            }

                            await tx.product.update({
                                where: { id: existing.id },
                                data: {
                                    name: normalized.name,
                                    description: normalized.description || null,
                                    price: normalizedPrice,
                                    cost: normalizedCost,
                                    minStock: normalizedMinStock,
                                    category: normalized.category || null,
                                    unit: normalized.unit,
                                    saleMode: normalized.saleMode ?? null,
                                    quantityStep: normalized.quantityStep || null,
                                    productFamily: normalized.productFamily ?? null,
                                    packUnit: normalized.packUnit || null,
                                    packSize: normalizedPackSize,
                                    packPrice: normalizedPackPrice,
                                    requiresBatchTracking: nextRequiresBatchTracking,
                                    ivaExento: Boolean(normalized.ivaExento),
                                }
                            });

                            let stockAfter = stockBeforeLocked.toNumber();
                            if (!stockDiff.isZero()) {
                                const stockResult = await applyStockDelta(tx, {
                                    tenantId: authReq.tenantId!,
                                    productId: existing.id,
                                    delta: stockDiff.toNumber(),
                                    enforceSufficient: false,
                                });
                                stockAfter = stockResult.stockAfter;
                                await tx.kardexMovement.create({
                                    data: {
                                        tenantId: authReq.tenantId!,
                                        productId: existing.id,
                                        type: 'ADJUSTMENT',
                                        quantity: stockDiff.toNumber(),
                                        stockBefore: stockResult.stockBefore,
                                        stockAfter: stockResult.stockAfter,
                                        referenceType: 'BULK_IMPORT',
                                        reason: 'Carga masiva - actualización',
                                        userId: authReq.userId!,
                                        warehouseId: stockResult.warehouseId,
                                    }
                                });
                            }

                            // Auditoría de cambio de precio/costo en carga masiva: el PUT
                            // unitario deja rastro PRICE_CHANGED; sin esto el bulk sería una
                            // vía de evasión para reescribir la base de valuación (cost) y el
                            // precio sin asiento inmutable before/after.
                            const priceChanged = !new Decimal(existing.price).equals(normalizedPrice);
                            const costChanged  = !new Decimal(existing.cost).equals(normalizedCost);
                            if (priceChanged || costChanged) {
                                await tx.auditLog.create({
                                    data: {
                                        tenantId: authReq.tenantId!,
                                        userId: authReq.userId!,
                                        action: 'PRICE_CHANGED',
                                        details: JSON.stringify({
                                            productId: existing.id,
                                            priceBefore: String(existing.price), priceAfter: String(normalizedPrice),
                                            costBefore: String(existing.cost), costAfter: String(normalizedCost),
                                            origen: 'BULK_IMPORT',
                                        }),
                                    }
                                });
                            }

                            await tx.auditLog.create({
                                data: {
                                    tenantId: authReq.tenantId!,
                                    userId: authReq.userId!,
                                    action: 'PRODUCT_BULK_UPDATED',
                                    details: JSON.stringify({
                                        productId: existing.id,
                                        before: {
                                            unit: existing.unit,
                                            saleMode: existing.saleMode,
                                            quantityStep: existing.quantityStep?.toString() ?? null,
                                            productFamily: existing.productFamily,
                                            packUnit: existing.packUnit,
                                            packSize: existing.packSize,
                                            packPrice: existing.packPrice,
                                            requiresBatchTracking: lockedRequiresBatchTracking,
                                            ivaExento: existing.ivaExento,
                                            stock: stockBeforeLocked.toString(),
                                        },
                                        after: {
                                            unit: normalized.unit,
                                            saleMode: normalized.saleMode ?? null,
                                            quantityStep: normalized.quantityStep || null,
                                            productFamily: normalized.productFamily ?? null,
                                            packUnit: normalized.packUnit || null,
                                            packSize: normalizedPackSize,
                                            packPrice: normalizedPackPrice,
                                            requiresBatchTracking: nextRequiresBatchTracking,
                                            ivaExento: Boolean(normalized.ivaExento),
                                            stock: String(stockAfter),
                                        },
                                    }),
                                },
                            });
                            updated++;
                        } else {
                            assertAggregateBatchMutationAllowed({
                                mode: batchWarehouseLedgerMode,
                                requiresBatchTracking: Boolean(normalized.requiresBatchTracking),
                                delta: targetStock,
                            });
                            const product = await tx.product.create({
                                data: {
                                    tenantId: authReq.tenantId!,
                                    name: normalized.name,
                                    sku,
                                    description: normalized.description || null,
                                    price: normalizedPrice,
                                    cost: normalizedCost,
                                    stock: 0,
                                    minStock: normalizedMinStock,
                                    category: normalized.category || null,
                                    unit: normalized.unit,
                                    saleMode: normalized.saleMode ?? null,
                                    quantityStep: normalized.quantityStep || null,
                                    productFamily: normalized.productFamily ?? null,
                                    packUnit: normalized.packUnit || null,
                                    packSize: normalizedPackSize,
                                    packPrice: normalizedPackPrice,
                                    requiresBatchTracking: Boolean(normalized.requiresBatchTracking),
                                    ivaExento: Boolean(normalized.ivaExento),
                                    createdBy: authReq.userId!
                                }
                            });

                            // Kardex inicial
                            if (targetStock > 0) {
                                const stockResult = await applyStockDelta(tx, {
                                    tenantId: authReq.tenantId!,
                                    productId: product.id,
                                    delta: targetStock,
                                    enforceSufficient: false,
                                });
                                await tx.kardexMovement.create({
                                    data: {
                                        tenantId: authReq.tenantId!,
                                        productId: product.id,
                                        type: 'IN',
                                        quantity: targetStock,
                                        stockBefore: stockResult.stockBefore,
                                        stockAfter: stockResult.stockAfter,
                                        referenceType: 'BULK_IMPORT',
                                        reason: 'Carga masiva - producto nuevo',
                                        userId: authReq.userId!,
                                        warehouseId: stockResult.warehouseId,
                                    }
                                });
                            }
                            await tx.auditLog.create({
                                data: {
                                    tenantId: authReq.tenantId!,
                                    userId: authReq.userId!,
                                    action: 'PRODUCT_CREATED',
                                    details: JSON.stringify({
                                        productId: product.id,
                                        source: 'BULK_IMPORT',
                                        after: {
                                            sku,
                                            unit: normalized.unit,
                                            saleMode: normalized.saleMode ?? null,
                                            quantityStep: normalized.quantityStep || null,
                                            productFamily: normalized.productFamily ?? null,
                                            packUnit: normalized.packUnit || null,
                                            packSize: normalizedPackSize,
                                            packPrice: normalizedPackPrice,
                                            requiresBatchTracking: Boolean(normalized.requiresBatchTracking),
                                            ivaExento: Boolean(normalized.ivaExento),
                                            stock: targetStock,
                                        },
                                    }),
                                },
                            });
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
app.put('/api/products/:id', authenticate, checkRole(['OWNER', 'ADMIN']), validate(UpdateProductSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { id } = req.params;
    const {
        name, sku, description, category, price, cost, stock, minStock, unit,
        saleMode, quantityStep, productFamily, imageUrl, reorderPoint, maxStock,
        defaultSupplierId, wholesalePrice, wholesaleMinQty, packUnit, packSize,
        packPrice, ivaExento, isPublished, requiresBatchTracking,
    } = req.body;

    try {
        const existing = await prisma.product.findFirst({
            where: { id, tenantId: authReq.tenantId! }
        });

        if (!existing) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        const finalSaleMode = saleMode !== undefined ? saleMode : existing.saleMode;
        const finalQuantityStep = quantityStep !== undefined
            ? (quantityStep || null)
            : existing.quantityStep?.toString() ?? null;
        const finalConfig = { saleMode: finalSaleMode, quantityStep: finalQuantityStep };

        // Al reclasificar, también el stock/umbrales ya guardados deben ser
        // representables con el nuevo paso; no dejamos una configuración rota.
        const targetStock = contextualProductQuantity(stock ?? existing.stock, finalConfig, { allowZero: true });
        const targetMinStock = contextualProductQuantity(minStock ?? existing.minStock, finalConfig, { allowZero: true });
        const targetReorder = contextualProductQuantity(reorderPoint ?? existing.reorderPoint, finalConfig, { allowZero: true });
        const targetMaximum = contextualProductQuantity(maxStock ?? existing.maxStock, finalConfig, { allowZero: true });
        if (wholesaleMinQty !== undefined && wholesaleMinQty !== null && wholesaleMinQty !== '') {
            contextualProductQuantity(wholesaleMinQty, finalConfig);
        } else if (wholesaleMinQty === undefined && existing.wholesaleMinQty != null) {
            contextualProductQuantity(existing.wholesaleMinQty, finalConfig);
        }

        const updates: any = {};
        if (name !== undefined) updates.name = name;
        if (sku !== undefined) updates.sku = sku.toUpperCase();
        if (description !== undefined) updates.description = description;
        if (category !== undefined) updates.category = category;
        if (price !== undefined) updates.price = new Decimal(price).toNumber();
        if (cost !== undefined) updates.cost = new Decimal(cost).toNumber();
        if (minStock !== undefined) updates.minStock = targetMinStock;
        if (unit !== undefined) updates.unit = unit;
        if (saleMode !== undefined) updates.saleMode = saleMode;
        if (quantityStep !== undefined) updates.quantityStep = quantityStep || null;
        if (productFamily !== undefined) updates.productFamily = productFamily;
        // T2: reclasificar exoneración de IVA. Las ventas YA registradas no cambian
        // (SaleItem.ivaExento es una foto del momento de la venta).
        if (ivaExento !== undefined) updates.ivaExento = Boolean(ivaExento);
        if (isPublished !== undefined) updates.isPublished = Boolean(isPublished);
        if (requiresBatchTracking !== undefined) updates.requiresBatchTracking = Boolean(requiresBatchTracking);
        if (imageUrl !== undefined) updates.imageUrl = imageUrl || null;
        if (reorderPoint !== undefined) updates.reorderPoint = targetReorder;
        if (maxStock !== undefined) updates.maxStock = targetMaximum;
        if (defaultSupplierId !== undefined) updates.defaultSupplierId = defaultSupplierId || null;
        if (wholesalePrice !== undefined) {
            updates.wholesalePrice = wholesalePrice === null || wholesalePrice === ''
                ? null : new Decimal(wholesalePrice).toNumber();
        }
        if (wholesaleMinQty !== undefined) {
            updates.wholesaleMinQty = wholesaleMinQty === null || wholesaleMinQty === ''
                ? null : new Decimal(wholesaleMinQty).toNumber();
        }
        // Empaque (Fase B): '' o null limpian; valores > 0. La validación cruzada
        // (packPrice exige packSize) se hace sobre el ESTADO FINAL (update parcial).
        if (packUnit !== undefined) {
            updates.packUnit = typeof packUnit === 'string' && packUnit.trim() !== '' ? packUnit.trim() : null;
        }
        if (packSize !== undefined) {
            updates.packSize = packSize === null || packSize === '' ? null : new Decimal(packSize).toNumber();
        }
        if (packPrice !== undefined) {
            updates.packPrice = packPrice === null || packPrice === '' ? null : new Decimal(packPrice).toNumber();
        }
        {
            const finalPackUnit = updates.packUnit !== undefined ? updates.packUnit : existing.packUnit;
            const finalSize = updates.packSize !== undefined ? updates.packSize : existing.packSize;
            const finalPackPrice = updates.packPrice !== undefined ? updates.packPrice : existing.packPrice;
            const hasPackUnit = typeof finalPackUnit === 'string' && finalPackUnit.trim() !== '';
            const hasPackSize = finalSize !== null && finalSize !== undefined;
            if (hasPackUnit !== hasPackSize) {
                return res.status(400).json({
                    error: 'El empaque requiere definir juntos la unidad y el tamaño',
                    code: 'INVALID_PACK_CONFIGURATION',
                });
            }
            if (finalPackPrice != null && finalSize == null) {
                return res.status(400).json({ error: 'El precio de empaque requiere un tamaño de empaque definido' });
            }
            if (hasPackSize) {
                contextualProductQuantity(finalSize, finalConfig);
            }
        }

        if (sku !== undefined && sku.toUpperCase() !== existing.sku) {
            const duplicate = await prisma.product.findUnique({
                where: { tenantId_sku: { tenantId: authReq.tenantId!, sku: sku.toUpperCase() } },
                select: { id: true },
            });
            if (duplicate) return res.status(400).json({ error: 'SKU ya existe en tu inventario' });
        }
        if (defaultSupplierId) {
            const supplier = await prisma.supplier.findFirst({
                where: { id: defaultSupplierId, tenantId: authReq.tenantId! },
                select: { id: true },
            });
            if (!supplier) return res.status(400).json({ error: 'El proveedor por defecto no pertenece a tu negocio' });
        }
        if (stock !== undefined) await asegurarBodegaPorDefecto(prisma, authReq.tenantId!);

        const updated = await prisma.$transaction(async (tx: any) => {
            const batchWarehouseLedgerMode = await resolveBatchWarehouseLedgerMode(tx, authReq.tenantId!);
            const lockedRows: Array<{
                stock: Decimal.Value;
                requiresBatchTracking: boolean;
            }> = await tx.$queryRaw`
                SELECT stock, requiresBatchTracking FROM \`Product\`
                WHERE id = ${id} AND tenantId = ${authReq.tenantId!}
                FOR UPDATE`;
            if (lockedRows.length === 0) throw new Error('PRODUCTO_NO_ENCONTRADO');
            const lockedStock = new Decimal(lockedRows[0].stock);
            const lockedRequiresBatchTracking = lockedRows[0].requiresBatchTracking;
            const nextRequiresBatchTracking = requiresBatchTracking === undefined
                ? lockedRequiresBatchTracking
                : Boolean(requiresBatchTracking);
            const batchTrackingChanges = nextRequiresBatchTracking !== lockedRequiresBatchTracking;

            if (batchTrackingChanges) {
                const batchHistory = lockedRequiresBatchTracking && !nextRequiresBatchTracking
                    ? await tx.productBatch.findFirst({
                        where: { tenantId: authReq.tenantId!, productId: id },
                        select: { id: true },
                    })
                    : null;
                assertBatchTrackingTransitionAllowed({
                    mode: batchWarehouseLedgerMode,
                    currentRequiresBatchTracking: lockedRequiresBatchTracking,
                    nextRequiresBatchTracking,
                    currentStock: lockedStock,
                    hasBatchHistory: batchHistory !== null,
                });
            }

            if (unit !== undefined) {
                const [movement, hasOpenCommitments] = await Promise.all([
                    tx.kardexMovement.findFirst({
                        where: { tenantId: authReq.tenantId!, productId: id },
                        select: { id: true },
                    }),
                    hasOpenProductUnitCommitments(tx, authReq.tenantId!, id),
                ]);
                assertBaseUnitChangeAllowed({
                    currentUnit: existing.unit,
                    nextUnit: unit,
                    stock: lockedStock,
                    hasMovements: movement !== null,
                    hasOpenCommitments,
                });
            }

            // Revalidar el stock actual bajo lock si se cambió el modo/paso.
            if (saleMode !== undefined || quantityStep !== undefined) {
                contextualProductQuantity(lockedStock, finalConfig, { allowZero: true });
            }

            let stockAfter = lockedStock.toNumber();
            if (stock !== undefined) {
                const stockDiff = new Decimal(targetStock).minus(lockedStock);

                if (!stockDiff.isZero()) {
                    assertAggregateBatchMutationAllowed({
                        mode: batchWarehouseLedgerMode,
                        requiresBatchTracking: Boolean(lockedRequiresBatchTracking || nextRequiresBatchTracking),
                        delta: stockDiff,
                    });
                    const stockResult = await applyStockDelta(tx, {
                        tenantId: authReq.tenantId!,
                        productId: id,
                        delta: stockDiff.toNumber(),
                        enforceSufficient: false,
                    });
                    stockAfter = stockResult.stockAfter;

                    await tx.kardexMovement.create({
                        data: {
                            tenantId: authReq.tenantId!,
                            productId: id,
                            type: 'ADJUSTMENT',
                            quantity: stockDiff.toNumber(),
                            stockBefore: stockResult.stockBefore,
                            stockAfter: stockResult.stockAfter,
                            referenceType: 'ADJUSTMENT',
                            reason: 'Ajuste manual de inventario',
                            userId: authReq.userId!,
                            warehouseId: stockResult.warehouseId,
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

            await tx.auditLog.create({
                data: {
                    tenantId: authReq.tenantId!,
                    userId: authReq.userId!,
                    action: 'PRODUCT_UPDATED',
                    details: JSON.stringify({
                        productId: id,
                        before: {
                            unit: existing.unit,
                            saleMode: existing.saleMode,
                            quantityStep: existing.quantityStep?.toString() ?? null,
                            productFamily: existing.productFamily,
                            stock: lockedStock.toString(),
                        },
                        after: {
                            unit: result.unit,
                            saleMode: result.saleMode,
                            quantityStep: result.quantityStep?.toString() ?? null,
                            productFamily: result.productFamily,
                            stock: String(stockAfter),
                        },
                    }),
                },
            });

            return tx.product.findUniqueOrThrow({ where: { id } });
        });

        res.json(updated);
    } catch (error: any) {
        if (productQuantityErrorResponse(res, error)) return;
        if (manualBatchErrorResponse(res, error)) return;
        if (error?.message === 'PRODUCTO_NO_ENCONTRADO') return res.status(404).json({ error: 'Producto no encontrado' });
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

    const requestedDelta = new Decimal(quantity);

    // Determinar tipo de movimiento
    const movementType = type || (requestedDelta.isPositive() ? 'ADJUST_GAIN' : 'ADJUST_LOSS');
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
    const lossMovement = movementType === 'ADJUST_LOSS';
    if ((lossMovement && !requestedDelta.isNegative()) || (!lossMovement && !requestedDelta.isPositive())) {
        return res.status(400).json({
            error: lossMovement
                ? 'Una pérdida debe enviar una cantidad negativa.'
                : 'Las entradas y devoluciones deben enviar una cantidad positiva.',
        });
    }

    // Reason es OBLIGATORIO para ajustes manuales
    if ((movementType === 'ADJUST_LOSS' || movementType === 'ADJUST_GAIN') && (!reason || reason.trim().length < 3)) {
        return res.status(400).json({ error: 'La justificación es obligatoria para ajustes (mínimo 3 caracteres).' });
    }

    try {
        // Compatibilidad segura: si un cliente histórico omite warehouseId y el
        // tenant todavía no tiene bodegas creadas, la "Principal" debe existir
        // antes del snapshot transaccional para evitar la carrera del primer uso.
        await asegurarBodegaPorDefecto(prisma, authReq.tenantId!);

        // TRANSACCIÓN ACID
        const result = await prisma.$transaction(async (tx: any) => {
            const batchWarehouseLedgerMode = await resolveBatchWarehouseLedgerMode(tx, authReq.tenantId!);
            const operationWarehouse = await resolveOperationalWarehouse(
                tx,
                authReq.tenantId!,
                requestedWarehouseId,
            );

            // Orden único de locks para toda mutación: Product → ProductStock.
            // Evita invertirlo frente a ventas, compras y cierres de conteo.
            const productRows: Array<{
                name: string;
                sku: string;
                saleMode: string | null;
                quantityStep: any;
                requiresBatchTracking: boolean;
            }> = await tx.$queryRaw`
                SELECT name, sku, saleMode, quantityStep, requiresBatchTracking
                FROM \`Product\`
                WHERE id = ${productId} AND tenantId = ${authReq.tenantId!}
                FOR UPDATE`;
            const product = productRows[0];
            if (!product) throw new StockError('PRODUCT_NOT_FOUND', 'Producto no encontrado en tu inventario.');

            const adjustQty = contextualProductQuantity(requestedDelta, product, { signed: true });
            assertAggregateBatchMutationAllowed({
                mode: batchWarehouseLedgerMode,
                requiresBatchTracking: product.requiresBatchTracking,
                delta: adjustQty,
            });

            // Materializar y bloquear SIEMPRE la ubicación permite que Kardex,
            // respuesta y auditoría usen before/after locales, no el agregado.
            await materializeWarehouseRow(tx, {
                tenantId: authReq.tenantId!,
                productId,
                warehouseId: operationWarehouse.id,
                isDefault: operationWarehouse.isDefault,
            });
            const warehouseRows: Array<{ stock: any }> = await tx.$queryRaw`
                SELECT stock
                FROM \`ProductStock\`
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
                    `Stock insuficiente en ${operationWarehouse.name}. Disponible: ${warehouseStockBefore}, se pidió ${Math.abs(adjustQty)}.`,
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

            // 3. Kardex por bodega: con warehouseId presente, before/after son
            // los de ESA ubicación (misma semántica que transferencias/conteos).
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
            // Compatibilidad: newStock conserva el agregado que consumían
            // clientes anteriores. La UI de bodega usa warehouseStock.
            newStock: result.aggregateStock,
            warehouseStock: result.warehouseStock,
            aggregateStock: result.aggregateStock,
        });
    } catch (error: any) {
        if (productQuantityErrorResponse(res, error)) return;
        if (manualBatchErrorResponse(res, error)) return;
        if (error instanceof StockError) {
            const status =
                error.code === 'PRODUCT_NOT_FOUND' ? 404
                    : error.code === 'WAREHOUSE_NOT_FOUND' || error.code === 'WAREHOUSE_REQUIRED' ? 400
                        : 400;
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
type ManualBatchCommandResponse = Record<string, unknown>;

const manualBatchResultDetails = (raw: string | null, expected: {
    commandId: string;
    commandType: ManualBatchCommandType;
    payloadHash: string;
}): ManualBatchCommandResponse => {
    let parsed: unknown;
    try {
        parsed = raw === null ? null : JSON.parse(raw);
    } catch {
        parsed = null;
    }
    if (
        typeof parsed !== 'object'
        || parsed === null
        || Array.isArray(parsed)
        || (parsed as any).version !== 1
        || (parsed as any).commandId !== expected.commandId
        || (parsed as any).commandType !== expected.commandType
        || (parsed as any).payloadHash !== expected.payloadHash
        || typeof (parsed as any).response !== 'object'
        || (parsed as any).response === null
        || Array.isArray((parsed as any).response)
    ) {
        throw new ManualBatchMovementError(
            'MANUAL_BATCH_COMMAND_CORRUPT',
            500,
            'El resultado idempotente del movimiento manual está incompleto o corrupto.',
        );
    }
    return (parsed as any).response as ManualBatchCommandResponse;
};

/**
 * Relee fuera de la transacción perdedora. Un claim sin resultado nunca se
 * reejecuta: eso indicaría corrupción manual, porque ambos se confirman juntos.
 */
const loadManualBatchReplay = async (input: {
    tenantId: string;
    commandId: string;
    commandType: ManualBatchCommandType;
    payloadHash: string;
}): Promise<ManualBatchCommandResponse | null> => {
    const command = await prisma.auditLog.findFirst({
        where: { id: input.commandId, tenantId: input.tenantId },
        select: { action: true, details: true },
    });
    if (!command) return null;
    if (command.action !== 'MANUAL_BATCH_COMMAND') {
        throw new ManualBatchMovementError(
            'MANUAL_BATCH_COMMAND_CORRUPT',
            500,
            'El identificador idempotente colisionó con una auditoría incompatible.',
        );
    }
    const claim = parseManualBatchCommandClaim(command.details);
    assertManualBatchReplay(claim, input);
    if (
        claim.resultAuditId !== buildManualBatchRelatedId(input.commandId, 'RESULT')
        || claim.movementId !== buildManualBatchRelatedId(input.commandId, 'MOVEMENT')
    ) {
        throw new ManualBatchMovementError(
            'MANUAL_BATCH_COMMAND_CORRUPT',
            500,
            'Los identificadores derivados del comando manual no coinciden.',
        );
    }
    const result = await prisma.auditLog.findFirst({
        where: { id: claim.resultAuditId, tenantId: input.tenantId },
        select: { action: true, details: true },
    });
    if (!result) {
        throw new ManualBatchMovementError(
            'MANUAL_BATCH_COMMAND_INCOMPLETE',
            500,
            'El movimiento ya fue reclamado, pero su resultado inmutable no existe.',
        );
    }
    const expectedResultAction = input.commandType === 'MANUAL_BATCH_CREATE'
        ? 'PRODUCT_BATCH_ADDED'
        : 'BATCH_WRITEOFF';
    if (result.action !== expectedResultAction) {
        throw new ManualBatchMovementError(
            'MANUAL_BATCH_COMMAND_CORRUPT',
            500,
            'La auditoría de resultado del movimiento manual es incompatible.',
        );
    }
    return manualBatchResultDetails(result.details, input);
};

const isUniqueConstraintFailure = (error: unknown): boolean =>
    typeof error === 'object' && error !== null && 'code' in error && (error as any).code === 'P2002';

function manualBatchErrorResponse(res: any, error: unknown): boolean {
    if (error instanceof ManualBatchMovementError) {
        res.status(error.httpStatus).json({ error: error.message, code: error.code });
        return true;
    }
    if (error instanceof BatchWarehouseLedgerError) {
        res.status(error.httpStatus).json({ error: error.message, code: error.code });
        return true;
    }
    if (error instanceof StockError) {
        const status = error.code === 'PRODUCT_NOT_FOUND' ? 404
            : error.code === 'WAREHOUSE_NOT_FOUND' ? 404
                : error.code === 'WAREHOUSE_REQUIRED' || error.code === 'INSUFFICIENT_STOCK' ? 409
                    : 400;
        res.status(status).json({ error: error.message, code: error.code });
        return true;
    }
    return false;
}

app.post('/api/inventory/batches', authenticate, checkRole(['OWNER', 'ADMIN']), validate(CreateBatchSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { clientEventId, productId, warehouseId: requestedWarehouseId, batchNumber, expiryDate, quantity } = req.body;

    const expiry = parseManaguaCivilDateInput(expiryDate);
    if (!expiry) {
        return res.status(400).json({ error: 'Fecha de vencimiento inválida.' });
    }

    const commandType = 'MANUAL_BATCH_CREATE' as const;
    const quantityExact = new Decimal(quantity).toFixed(4);
    const commandId = buildManualBatchCommandId({
        tenantId: authReq.tenantId!,
        clientEventId,
        commandType,
    });
    const payloadHash = buildManualBatchPayloadHash(commandType, [
        authReq.tenantId!,
        authReq.userId!,
        productId,
        requestedWarehouseId,
        batchNumber,
        expiryDate,
        quantityExact,
    ]);
    const resultAuditId = buildManualBatchRelatedId(commandId, 'RESULT');
    const movementId = buildManualBatchRelatedId(commandId, 'MOVEMENT');

    try {
        const replay = await loadManualBatchReplay({
            tenantId: authReq.tenantId!, commandId, commandType, payloadHash,
        });
        if (replay) return res.json(replay);

        const response = await prisma.$transaction(async (tx: any) => {
            const mode = await resolveBatchWarehouseLedgerMode(tx, authReq.tenantId!);
            const actor = await tx.user.findFirst({
                where: { id: authReq.userId!, tenantId: authReq.tenantId!, status: 'ACTIVE' },
                select: { id: true },
            });
            if (!actor) {
                throw new BatchWarehouseLedgerError(
                    'BATCH_WAREHOUSE_USER_NOT_FOUND', 404,
                    'El usuario no está activo en este negocio para registrar el lote.',
                );
            }
            const operationWarehouse = await resolveOperationalWarehouse(
                tx, authReq.tenantId!, requestedWarehouseId,
            );
            const productRows: Array<{
                id: string;
                name: string;
                unit: string;
                stock: any;
                saleMode: string | null;
                quantityStep: any;
                requiresBatchTracking: boolean;
            }> = await tx.$queryRaw`
                SELECT id, name, unit, stock, saleMode, quantityStep, requiresBatchTracking
                FROM \`Product\`
                WHERE id = ${productId} AND tenantId = ${authReq.tenantId!}
                FOR UPDATE`;
            const product = productRows[0];
            if (!product) throw new StockError('PRODUCT_NOT_FOUND', 'Producto no encontrado en tu inventario.');
            if (!product.requiresBatchTracking) {
                assertBatchTrackingTransitionAllowed({
                    mode,
                    currentRequiresBatchTracking: false,
                    nextRequiresBatchTracking: true,
                    currentStock: product.stock,
                    hasBatchHistory: false,
                });
            }
            const batchQuantityDecimal = contextualProductQuantityDecimal(quantity, product);
            const batchQuantity = batchQuantityDecimal.toNumber();
            const exactDelta = batchQuantityDecimal.toFixed(4);
            const existingBatch = await tx.productBatch.findFirst({
                where: { productId, batchNumber, tenantId: authReq.tenantId! },
                select: { id: true, expiryDate: true },
            });
            if (existingBatch) {
                try {
                    assertProductBatchExpiryIdentity({
                        productId,
                        productName: product.name,
                        batchNumber,
                        existingExpiryDate: existingBatch.expiryDate,
                        incomingExpiryDate: expiry,
                    });
                } catch (error) {
                    if (!(error instanceof ProductBatchIdentityError)) throw error;
                    // El código histórico de alta manual se conserva para no
                    // romper clientes; la regla de identidad ya es la misma que
                    // usa compras directas y recepciones.
                    throw new ManualBatchMovementError(
                        'MANUAL_BATCH_IDEMPOTENCY_CONFLICT',
                        error.httpStatus,
                        'Ese número de lote ya existe con otra fecha de vencimiento.',
                    );
                }
            }
            const batchId = existingBatch?.id ?? buildManualBatchRelatedId(commandId, 'BATCH');

            // Claim único antes de ProductStock, ProductBatch, Kardex o contabilidad.
            await tx.auditLog.create({
                data: {
                    id: commandId,
                    tenantId: authReq.tenantId!,
                    userId: authReq.userId!,
                    action: 'MANUAL_BATCH_COMMAND',
                    details: JSON.stringify({
                        version: 1,
                        commandType,
                        payloadHash,
                        resultAuditId,
                        movementId,
                        resourceId: batchId,
                    }),
                },
            });

            await materializeWarehouseRow(tx, {
                tenantId: authReq.tenantId!,
                productId,
                warehouseId: operationWarehouse.id,
                isDefault: operationWarehouse.isDefault,
            });
            const localRows: Array<{ stock: any }> = await tx.$queryRaw`
                SELECT stock FROM \`ProductStock\`
                WHERE tenantId = ${authReq.tenantId!}
                  AND productId = ${productId}
                  AND warehouseId = ${operationWarehouse.id}
                FOR UPDATE`;
            if (!localRows[0]) throw new Error('No se pudo preparar el stock de la bodega seleccionada.');
            const localStockBefore = new Decimal(localRows[0].stock.toString());

            // El warehouseId retornado por applyStockDelta es la autoridad final.
            const stockResult = await applyStockDelta(tx, {
                tenantId: authReq.tenantId!,
                productId,
                delta: batchQuantity,
                enforceSufficient: false,
                warehouseId: operationWarehouse.id,
            });
            if (stockResult.warehouseId !== operationWarehouse.id) {
                throw new Error('La bodega autoritativa del movimiento cambió inesperadamente.');
            }

            const batch = await tx.productBatch.upsert({
                where: { productId_batchNumber: { productId, batchNumber } },
                update: { stock: { increment: batchQuantity } },
                create: {
                    id: batchId,
                    tenantId: authReq.tenantId!,
                    productId,
                    batchNumber,
                    expiryDate: expiry,
                    stock: batchQuantity,
                },
            });

            const batchLedger = await applyBatchWarehouseDelta({
                tx,
                mode,
                tenantId: authReq.tenantId!,
                productId,
                batchId: batch.id,
                warehouseId: stockResult.warehouseId,
                delta: exactDelta,
                movementType: 'ADJUSTMENT_IN',
                referenceId: movementId,
                referenceType: 'KARDEX_MOVEMENT',
                userId: authReq.userId!,
                reason: `Alta manual de lote ${batchNumber}`,
                sourceKey: `manual-batch-create:${clientEventId}`,
                allowNegative: false,
            });
            if (batchLedger.replay) {
                throw new ManualBatchMovementError(
                    'MANUAL_BATCH_COMMAND_CORRUPT', 500,
                    'El subledger ya contenía este evento sin su claim de comando.',
                );
            }

            if (!product.requiresBatchTracking) {
                await tx.product.update({
                    where: { id: productId },
                    data: { requiresBatchTracking: true },
                });
            }

            const localStockAfter = localStockBefore.plus(batchQuantityDecimal);
            await tx.kardexMovement.create({
                data: {
                    id: movementId,
                    tenantId: authReq.tenantId!,
                    productId,
                    type: 'IN_PURCHASE',
                    quantity: batchQuantity,
                    stockBefore: localStockBefore.toNumber(),
                    stockAfter: localStockAfter.toNumber(),
                    referenceType: 'BATCH',
                    reason: `Alta de lote ${batchNumber} (vence ${expiry.toISOString().slice(0, 10)})`,
                    userId: authReq.userId!,
                    batchId: batch.id,
                    warehouseId: stockResult.warehouseId,
                },
            });

            const response: ManualBatchCommandResponse = {
                message: `Lote ${batchNumber} agregado a ${product.name}. Stock: ${stockResult.stockAfter}`,
                batch: {
                    id: batch.id,
                    batchNumber: batch.batchNumber,
                    expiryDate: batch.expiryDate.toISOString(),
                    stock: batch.stock,
                },
                newStock: stockResult.stockAfter,
                warehouseId: stockResult.warehouseId,
                quantity: exactDelta,
                batchWarehouseStatus: batchLedger.status,
            };
            await tx.auditLog.create({
                data: {
                    id: resultAuditId,
                    tenantId: authReq.tenantId!,
                    userId: authReq.userId!,
                    action: 'PRODUCT_BATCH_ADDED',
                    details: JSON.stringify({
                        version: 1,
                        commandId,
                        commandType,
                        payloadHash,
                        response,
                    }),
                },
            });

            return response;
        }, { isolationLevel: 'ReadCommitted' });

        res.json(response);
    } catch (error: any) {
        if (isUniqueConstraintFailure(error)) {
            try {
                const replay = await loadManualBatchReplay({
                    tenantId: authReq.tenantId!, commandId, commandType, payloadHash,
                });
                if (replay) return res.json(replay);
            } catch (replayError) {
                if (manualBatchErrorResponse(res, replayError)) return;
                throw replayError;
            }
        }
        if (productQuantityErrorResponse(res, error)) return;
        if (manualBatchErrorResponse(res, error)) return;
        console.error('Error creando lote:', error);
        res.status(500).json({ error: 'Error creando lote' });
    }
});

// POST /api/inventory/batches/:batchId/writeoff - Dar de baja un lote (merma) [Bodeguero B3]
// Resta el stock restante del lote del producto, deja Kardex y asiento de merma
// (Debe 5.1.2 Pérdida por Merma / Haber 1.1.4 Inventario, valuado al costo).
app.post('/api/inventory/batches/:batchId/writeoff', authenticate, checkRole(['OWNER', 'ADMIN']), validate(WriteoffBatchSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { batchId } = req.params;
    const { clientEventId, warehouseId: requestedWarehouseId, quantity, reason } = req.body;
    const commandType = 'MANUAL_BATCH_WRITEOFF' as const;
    const quantityExact = new Decimal(quantity).toFixed(4);
    const commandId = buildManualBatchCommandId({
        tenantId: authReq.tenantId!, clientEventId, commandType,
    });
    const payloadHash = buildManualBatchPayloadHash(commandType, [
        authReq.tenantId!, authReq.userId!, batchId, requestedWarehouseId, quantityExact, reason,
    ]);
    const resultAuditId = buildManualBatchRelatedId(commandId, 'RESULT');
    const movementId = buildManualBatchRelatedId(commandId, 'MOVEMENT');

    try {
        const replay = await loadManualBatchReplay({
            tenantId: authReq.tenantId!, commandId, commandType, payloadHash,
        });
        if (replay) return res.json(replay);

        await seedChartOfAccounts(authReq.tenantId!); // garantiza 5.1.2 / 1.1.4

        const response = await prisma.$transaction(async (tx: any) => {
            const mode = await resolveBatchWarehouseLedgerMode(tx, authReq.tenantId!);
            const actor = await tx.user.findFirst({
                where: { id: authReq.userId!, tenantId: authReq.tenantId!, status: 'ACTIVE' },
                select: { id: true },
            });
            if (!actor) {
                throw new BatchWarehouseLedgerError(
                    'BATCH_WAREHOUSE_USER_NOT_FOUND', 404,
                    'El usuario no está activo en este negocio para registrar la merma.',
                );
            }
            const operationWarehouse = await resolveOperationalWarehouse(
                tx, authReq.tenantId!, requestedWarehouseId,
            );
            const batchHint = await tx.productBatch.findFirst({
                where: { id: batchId, tenantId: authReq.tenantId! },
                select: { productId: true },
            });
            if (!batchHint) throw new BatchWarehouseLedgerError(
                'BATCH_WAREHOUSE_BATCH_NOT_FOUND', 404, 'Lote no encontrado.',
            );
            const productRows: Array<{
                id: string;
                name: string;
                cost: any;
                saleMode: string | null;
                quantityStep: any;
            }> = await tx.$queryRaw`
                SELECT id, name, cost, saleMode, quantityStep
                FROM \`Product\`
                WHERE id = ${batchHint.productId} AND tenantId = ${authReq.tenantId!}
                FOR UPDATE`;
            const product = productRows[0];
            if (!product) throw new StockError('PRODUCT_NOT_FOUND', 'Producto no encontrado en tu inventario.');
            const batchRows: Array<{
                id: string;
                productId: string;
                batchNumber: string;
                expiryDate: Date;
                stock: any;
            }> = await tx.$queryRaw`
                SELECT id, productId, batchNumber, expiryDate, stock
                FROM \`ProductBatch\`
                WHERE id = ${batchId} AND tenantId = ${authReq.tenantId!}
                FOR UPDATE`;
            const batch = batchRows[0];
            if (!batch || batch.productId !== product.id) throw new BatchWarehouseLedgerError(
                'BATCH_WAREHOUSE_BATCH_NOT_FOUND', 404, 'Lote no encontrado.',
            );
            const writeoffQuantity = contextualProductQuantityDecimal(quantity, product);
            const writeoffQuantityExact = writeoffQuantity.toFixed(4);
            const batchStockBefore = new Decimal(batch.stock.toString());
            if (batchStockBefore.lessThan(writeoffQuantity)) {
                throw new StockError(
                    'INSUFFICIENT_STOCK',
                    `El lote solo tiene ${batchStockBefore.toString()} disponibles en total.`,
                );
            }
            await assertPeriodOpen(tx, authReq.tenantId!, new Date());

            await tx.auditLog.create({
                data: {
                    id: commandId,
                    tenantId: authReq.tenantId!,
                    userId: authReq.userId!,
                    action: 'MANUAL_BATCH_COMMAND',
                    details: JSON.stringify({
                        version: 1,
                        commandType,
                        payloadHash,
                        resultAuditId,
                        movementId,
                        resourceId: batchId,
                    }),
                },
            });

            const batchLedger = await applyBatchWarehouseDelta({
                tx,
                mode,
                tenantId: authReq.tenantId!,
                productId: product.id,
                batchId,
                warehouseId: operationWarehouse.id,
                delta: writeoffQuantity.negated().toFixed(4),
                movementType: 'WRITEOFF',
                referenceId: movementId,
                referenceType: 'KARDEX_MOVEMENT',
                userId: authReq.userId!,
                reason,
                sourceKey: `manual-batch-writeoff:${clientEventId}`,
                allowNegative: false,
            });
            if (batchLedger.replay) {
                throw new ManualBatchMovementError(
                    'MANUAL_BATCH_COMMAND_CORRUPT', 500,
                    'El subledger ya contenía esta merma sin su claim de comando.',
                );
            }

            await materializeWarehouseRow(tx, {
                tenantId: authReq.tenantId!,
                productId: product.id,
                warehouseId: operationWarehouse.id,
                isDefault: operationWarehouse.isDefault,
            });
            const localRows: Array<{ stock: any }> = await tx.$queryRaw`
                SELECT stock FROM \`ProductStock\`
                WHERE tenantId = ${authReq.tenantId!}
                  AND productId = ${product.id}
                  AND warehouseId = ${operationWarehouse.id}
                FOR UPDATE`;
            if (!localRows[0]) throw new Error('No se pudo preparar el stock de la bodega seleccionada.');
            const localStockBefore = new Decimal(localRows[0].stock.toString());
            if (localStockBefore.lessThan(writeoffQuantity)) {
                throw new StockError(
                    'INSUFFICIENT_STOCK',
                    `Stock insuficiente en ${operationWarehouse.name}. Disponible: ${localStockBefore.toString()}.`,
                );
            }

            const stockResult = await applyStockDelta(tx, {
                tenantId: authReq.tenantId!,
                productId: product.id,
                delta: writeoffQuantity.negated().toNumber(),
                enforceSufficient: true,
                warehouseId: operationWarehouse.id,
            });
            const updatedBatch = await tx.productBatch.updateMany({
                where: {
                    id: batchId,
                    tenantId: authReq.tenantId!,
                    stock: { gte: writeoffQuantity.toNumber() },
                },
                data: { stock: { decrement: writeoffQuantity.toNumber() } },
            });
            if (updatedBatch.count !== 1) {
                throw new StockError('INSUFFICIENT_STOCK', 'El saldo agregado del lote cambió concurrentemente.');
            }

            await tx.kardexMovement.create({
                data: {
                    id: movementId,
                    tenantId: authReq.tenantId!,
                    productId: product.id,
                    type: 'ADJUST_LOSS',
                    quantity: writeoffQuantity.negated().toNumber(),
                    stockBefore: localStockBefore.toNumber(),
                    stockAfter: localStockBefore.minus(writeoffQuantity).toNumber(),
                    referenceId: batchId,
                    referenceType: 'BATCH_WRITEOFF',
                    reason,
                    userId: authReq.userId!,
                    batchId,
                    warehouseId: operationWarehouse.id,
                },
            });

            const lossValue = writeoffQuantity
                .times(new Decimal(product.cost?.toString() ?? '0'))
                .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
            if (lossValue.greaterThan(0)) {
                // createJournalEntry conserva un contrato number legado; la
                // conversión ocurre solo después de cerrar el Decimal a 2dp.
                const journalValue = lossValue.toNumber();
                await createJournalEntry(
                    tx, authReq.tenantId!, `Baja de lote vencido ${batch.batchNumber}`, batchId, 'BATCH_WRITEOFF', authReq.userId!,
                    [
                        { accountCode: '5.1.2', debit: journalValue, credit: 0 },
                        { accountCode: '1.1.4', debit: 0, credit: journalValue },
                    ]
                );
            }

            const response: ManualBatchCommandResponse = {
                message: `Lote ${batch.batchNumber}: baja de ${writeoffQuantityExact} uds. Merma: C$ ${lossValue.toFixed(2)}`,
                batchId,
                batchNumber: batch.batchNumber,
                quantity: writeoffQuantityExact,
                newStock: stockResult.stockAfter,
                warehouseId: operationWarehouse.id,
                warehouseStock: localStockBefore.minus(writeoffQuantity).toFixed(4),
                batchStock: batchStockBefore.minus(writeoffQuantity).toFixed(4),
                lossValue: lossValue.toFixed(2),
                batchWarehouseStatus: batchLedger.status,
            };
            await tx.auditLog.create({
                data: {
                    id: resultAuditId,
                    tenantId: authReq.tenantId!,
                    userId: authReq.userId!,
                    action: 'BATCH_WRITEOFF',
                    details: JSON.stringify({
                        version: 1,
                        commandId,
                        commandType,
                        payloadHash,
                        response,
                    }),
                },
            });
            return response;
        }, { isolationLevel: 'ReadCommitted' });

        res.json(response);
    } catch (error: any) {
        if (isUniqueConstraintFailure(error)) {
            try {
                const replay = await loadManualBatchReplay({
                    tenantId: authReq.tenantId!, commandId, commandType, payloadHash,
                });
                if (replay) return res.json(replay);
            } catch (replayError) {
                if (manualBatchErrorResponse(res, replayError)) return;
                throw replayError;
            }
        }
        if (productQuantityErrorResponse(res, error)) return;
        if (manualBatchErrorResponse(res, error)) return;
        if (error instanceof PeriodLockedError) {
            return res.status(423).json({ error: error.message, code: 'PERIOD_LOCKED' });
        }
        console.error('Error dando de baja lote:', error);
        res.status(500).json({ error: 'Error dando de baja el lote' });
    }
});

// GET /api/inventory/expiring-soon - Lotes próximos a vencer (≤ 90 días)
app.get('/api/inventory/expiring-soon', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const asOf = new Date();
        const todayFloor = managuaCalendarDateFloor(asOf);
        // lt del día 91 incluye completo el día civil 90, tanto para fechas
        // históricas 00Z como para las normalizadas 12Z.
        const horizonExclusive = new Date(todayFloor.getTime() + 91 * 86_400_000);
        const [tenantInventory, batches] = await Promise.all([
            prisma.tenant.findFirst({
                where: { id: authReq.tenantId! },
                select: {
                    pharmacyInventoryMode: true,
                    batchWarehouseLedgerMode: true,
                },
            }),
            prisma.productBatch.findMany({
                where: {
                    tenantId: authReq.tenantId,
                    stock: { gt: 0 },
                    expiryDate: { lt: horizonExclusive },
                },
                select: {
                    id: true,
                    productId: true,
                    batchNumber: true,
                    expiryDate: true,
                    stock: true,
                    product: { select: { name: true, sku: true } },
                },
                orderBy: [{ expiryDate: 'asc' }, { id: 'asc' }],
                take: 50,
            }),
        ]);
        if (!tenantInventory) return res.status(404).json({ error: 'Negocio no encontrado' });

        const pharmacyEnforced = tenantInventory.pharmacyInventoryMode === 'ENFORCED';
        if (pharmacyEnforced && tenantInventory.batchWarehouseLedgerMode !== 'ENFORCED') {
            return res.status(409).json({
                error: 'La farmacia requiere lote-bodega ENFORCED para calcular vencimientos',
                code: 'BATCH_WAREHOUSE_LEDGER_REQUIRED',
            });
        }
        if (tenantInventory.pharmacyInventoryMode !== 'OFF' && !pharmacyEnforced) {
            return res.status(500).json({
                error: 'La configuración farmacéutica guardada no es válida',
                code: 'PHARMACY_INVENTORY_CONFIGURATION_INVALID',
            });
        }

        const exactByBatchId = new Map<string, { stock: Decimal; heldStock: Decimal }>();
        if (pharmacyEnforced && batches.length > 0) {
            const exactBalances = await prisma.productBatchWarehouseStock.groupBy({
                by: ['batchId'],
                where: {
                    tenantId: authReq.tenantId!,
                    batchId: { in: batches.map(batch => batch.id) },
                },
                _sum: { stock: true, heldStock: true },
            });
            for (const balance of exactBalances) {
                exactByBatchId.set(balance.batchId, {
                    stock: new Decimal(balance._sum.stock?.toString() ?? 0),
                    heldStock: new Decimal(balance._sum.heldStock?.toString() ?? 0),
                });
            }
        }

        const response = batches.map(batch => buildPharmacyExpiryAlert({
            batch,
            exactBalance: exactByBatchId.get(batch.id),
            pharmacyEnforced,
            asOf,
        }));
        res.json(response);
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

// POST /api/stock-counts - Crear conteo + snapshot exclusivo de una bodega.
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

            // Product.stock es agregado. Para la default, una fila ausente es
            // stock implícito = agregado - Σ otras bodegas; para una no-default
            // una fila ausente equivale a cero. Todas las lecturas pertenecen al
            // mismo snapshot transaccional.
            const productIds = products.map((product: any) => product.id);
            const warehouseRows = await tx.productStock.findMany({
                where: { tenantId: authReq.tenantId!, productId: { in: productIds } },
                select: { productId: true, warehouseId: true, stock: true },
            });
            const rowsByProduct = new Map<string, Array<{ warehouseId: string; stock: number }>>();
            for (const row of warehouseRows) {
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
            return {
                count: { ...created, warehouse },
                items: snapshot.length,
            };
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
            // PATCH, cierre y cancelación toman primero este mismo row-lock.
            // Así un valor no puede entrar mientras el cierre ya lo está usando.
            const countRows: Array<{ status: string; warehouseId: string | null }> = await tx.$queryRaw`
                SELECT status, warehouseId
                FROM \`StockCount\`
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

            const countItem = await tx.stockCountItem.findFirst({
                where: { countId: id, productId },
                include: { product: { select: { name: true, unit: true, saleMode: true, quantityStep: true } } },
            });
            if (!countItem) {
                throw new StockCountFlowError(404, 'STOCK_COUNT_ITEM_NOT_FOUND', 'Este producto no pertenece a la toma física.');
            }
            const countedQuantity = contextualProductQuantity(counted, countItem.product, { allowZero: true });

            const updated = await tx.stockCountItem.updateMany({
                where: { countId: id, productId },
                data: { counted: countedQuantity, countedAt: new Date() },
            });
            if (updated.count === 0) {
                throw new StockCountFlowError(404, 'STOCK_COUNT_ITEM_NOT_FOUND', 'Este producto no pertenece a la toma física.');
            }
            return { productId, counted: countedQuantity, unit: countItem.product.unit };
        });

        res.json({ message: 'Conteo registrado', ...result });
    } catch (error: any) {
        if (error instanceof StockCountFlowError) {
            return res.status(error.statusCode).json({ error: error.message, code: error.code });
        }
        if (productQuantityErrorResponse(res, error)) return;
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
            // Claim atómico del cierre. Un segundo cierre, una captura o una
            // cancelación esperan este row-lock y luego observan el estado final.
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
                throw new StockCountFlowError(409, 'WAREHOUSE_INACTIVE', 'La bodega del conteo está inactiva; reactívala antes de cerrar.');
            }
            // Un período cerrado congela TODO ajuste de inventario, aun si el valor
            // de la merma fuese 0 (productos sin costo) y no se generara asiento.
            await assertPeriodOpen(tx, authReq.tenantId!, new Date());

            const items = await tx.stockCountItem.findMany({
                where: { countId: id },
                select: { id: true, productId: true, expected: true, counted: true },
                orderBy: { productId: 'asc' },
            });

            const batchWarehouseLedgerMode = await resolveBatchWarehouseLedgerMode(tx, authReq.tenantId!);
            const preparedItems: Array<{
                item: typeof items[number];
                product: {
                    stock: any;
                    cost: any;
                    name: string;
                    saleMode: string | null;
                    quantityStep: any;
                    requiresBatchTracking: boolean;
                };
                counted: Decimal;
                variance: Decimal;
                currentBook: Decimal;
                delta: Decimal;
            }> = [];
            let countedItems = 0;

            // Preflight completo: bloquea y calcula TODAS las líneas antes de la
            // primera mutación. Así un solo producto con lotes aborta el cierre
            // entero sin haber aplicado ajustes anteriores.
            for (const it of items) {
                if (it.counted === null) continue;
                countedItems++;

                const productRows: Array<{
                    stock: any;
                    cost: any;
                    name: string;
                    saleMode: string | null;
                    quantityStep: any;
                    requiresBatchTracking: boolean;
                }> = await tx.$queryRaw`
                    SELECT stock, cost, name, saleMode, quantityStep, requiresBatchTracking
                    FROM \`Product\`
                    WHERE id = ${it.productId} AND tenantId = ${authReq.tenantId!}
                    FOR UPDATE`;
                const product = productRows[0];
                if (!product) continue;
                const counted = contextualProductQuantityDecimal(it.counted, product, { allowZero: true });

                const warehouseStockRows: Array<{ stock: any }> = await tx.$queryRaw`
                    SELECT stock FROM \`ProductStock\`
                    WHERE productId = ${it.productId}
                      AND warehouseId = ${count.warehouseId}
                      AND tenantId = ${authReq.tenantId!}
                    FOR UPDATE`;
                // Una fila ausente todavía no se materializa: el Product lock
                // ya impide movimientos concurrentes. En default conserva el
                // agregado legado; en una secundaria su saldo inicial es cero.
                const currentBook = warehouseStockRows[0]
                    ? new Decimal(warehouseStockRows[0].stock)
                    : count.warehouse.isDefault
                        ? new Decimal(product.stock)
                        : new Decimal(0);
                preparedItems.push({
                    item: it,
                    product,
                    counted,
                    variance: counted.minus(new Decimal(it.expected)),
                    currentBook,
                    delta: counted.minus(currentBook),
                });
            }

            for (const prepared of preparedItems) {
                assertAggregateBatchMutationAllowed({
                    mode: batchWarehouseLedgerMode,
                    requiresBatchTracking: prepared.product.requiresBatchTracking,
                    delta: prepared.delta,
                });
            }

            let lossValue = new Decimal(0); // Σ |merma| · costo
            let gainValue = new Decimal(0); // Σ sobrante · costo
            let adjusted = 0;
            for (const prepared of preparedItems) {
                const { item: it, product, counted, variance, currentBook, delta } = prepared;

                // Solo después de aprobar TODAS las líneas se permite la
                // primera escritura de desglose/diff/stock.
                await materializeWarehouseRow(tx, {
                    tenantId: authReq.tenantId!,
                    productId: it.productId,
                    warehouseId: count.warehouseId,
                    isDefault: count.warehouse.isDefault,
                });
                const materializedRows: Array<{ stock: any }> = await tx.$queryRaw`
                    SELECT stock FROM \`ProductStock\`
                    WHERE productId = ${it.productId}
                      AND warehouseId = ${count.warehouseId}
                      AND tenantId = ${authReq.tenantId!}
                    FOR UPDATE`;
                if (!materializedRows[0]) {
                    throw new StockCountFlowError(500, 'WAREHOUSE_STOCK_ROW_MISSING', 'No se pudo materializar el stock de la bodega.');
                }
                if (!new Decimal(materializedRows[0].stock).equals(currentBook)) {
                    throw new StockCountFlowError(
                        409,
                        'STOCK_COUNT_CONCURRENCY_CONFLICT',
                        'El stock cambió durante el preflight del conteo; reintentá el cierre.',
                    );
                }
                await tx.stockCountItem.update({ where: { id: it.id }, data: { diff: variance.toNumber() } });
                if (delta.isZero()) continue;

                await applyStockDelta(tx, {
                    tenantId: authReq.tenantId!,
                    productId: it.productId,
                    delta: delta.toNumber(),
                    enforceSufficient: false,
                    warehouseId: count.warehouseId,
                });

                await tx.kardexMovement.create({
                    data: {
                        tenantId: authReq.tenantId!,
                        productId: it.productId,
                        type: delta.isNegative() ? 'ADJUST_LOSS' : 'ADJUST_GAIN',
                        quantity: delta.toNumber(),
                        // Con warehouseId presente, before/after son los de la
                        // ubicación (misma semántica que una transferencia).
                        stockBefore: currentBook.toNumber(),
                        stockAfter: counted.toNumber(),
                        referenceId: id,
                        referenceType: 'STOCK_COUNT',
                        reason: `Toma física #${id.slice(0, 8)} en ${count.warehouse.name}: libro ${currentBook.toString()}, contado ${counted.toString()}`,
                        userId: authReq.userId!,
                        warehouseId: count.warehouseId,
                    },
                });

                const cost = new Decimal(product.cost || 0);
                if (delta.isNegative()) lossValue = lossValue.plus(cost.times(delta.abs()));
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
        if (manualBatchErrorResponse(res, error)) return;
        if (productQuantityErrorResponse(res, error)) return;
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
            const batchWarehouseLedgerMode = await resolveBatchWarehouseLedgerMode(tx, authReq.tenantId!);
            // La política batch debe salir del mismo Product row-lock que
            // applyStockDelta respetará después; una lectura snapshot permitiría
            // un false→true concurrente entre guard y mutación.
            const productRows: Array<{
                name: string;
                sku: string;
                requiresBatchTracking: boolean;
            }> = await tx.$queryRaw`
                SELECT name, sku, requiresBatchTracking
                FROM \`Product\`
                WHERE id = ${productId} AND tenantId = ${authReq.tenantId!}
                FOR UPDATE`;
            const product = productRows[0];

            if (!product) {
                throw new Error('Producto no encontrado');
            }
            assertAggregateBatchMutationAllowed({
                mode: batchWarehouseLedgerMode,
                requiresBatchTracking: product.requiresBatchTracking,
                delta: quantity,
            });

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
        if (manualBatchErrorResponse(res, error)) return;
        console.error('Error recording kardex:', error);
        res.status(400).json({ error: error.message || 'Error registrando movimiento' });
    }
});

// ==========================================
// 📊 REPORTES EMPRESARIALES (NICARAGUA - IVA 15%)
// ==========================================

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
            status: { not: ESTADO_ANULADA },
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
        const lowStock: {
            id: string;
            name: string;
            sku: string;
            stock: number;
            minStock: number;
            cost: number;
            unit: string;
            saleMode: SaleMode;
            productFamily: string | null;
        }[] = [];

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
                    unit: String(p.unit || 'unidad'),
                    saleMode: p.saleMode === 'COUNTED' ? 'COUNTED' : 'MEASURED',
                    productFamily: p.productFamily ?? null,
                });
            }
        });

        res.json({
            inventoryValue: inventoryValue.toDecimalPlaces(2).toNumber(),
            totalProducts: products.length,
            totalUnits,
            outOfStock,
            lowStock,
            products: products.map((p) => ({
                id: p.id,
                name: p.name,
                sku: p.sku,
                stock: Number(p.stock),
                minStock: Number(p.minStock),
                cost: Number(p.cost),
                price: Number(p.price),
                unit: String(p.unit || 'unidad'),
                saleMode: p.saleMode === 'COUNTED' ? 'COUNTED' : 'MEASURED',
                productFamily: p.productFamily ?? null,
            })),
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
app.get(
    '/api/purchases',
    authenticate,
    checkRole(PURCHASE_READ_ROLES),
    async (req: any, res: any) => {
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
        const productIds = [...new Set(purchases.flatMap((purchase: any) =>
            purchase.items.map((item: any) => item.productId),
        ))];
        const purchaseProducts = productIds.length > 0
            ? await prisma.product.findMany({
                where: { tenantId: authReq.tenantId!, id: { in: productIds } },
                select: { id: true, unit: true },
                take: 20_000,
            })
            : [];
        const unitsByProduct = new Map(purchaseProducts.map((product: any) => [product.id, product.unit]));
        res.json(purchases.map((purchase: any) => ({
            ...purchase,
            items: purchase.items.map((item: any) => ({
                ...item,
                quantityExact: item.quantityExact?.toString() ?? null,
                unit: unitsByProduct.get(item.productId) ?? 'unidad',
            })),
        })));
    } catch (error) {
        console.error('Error fetching purchases:', error);
        res.status(500).json({ error: 'Error al obtener compras' });
    }
});

// POST /api/purchases - Registrar compra (Transacción ACID)
app.post('/api/purchases', authenticate, checkRole(PURCHASE_WRITE_ROLES), validate(CreatePurchaseSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { supplierId, warehouseId, invoiceNumber, date, postingDate, dueDate, paymentMethod, notes, items, purchaseOrderId } = req.body;
    // Validaciones de formato ya realizadas por Zod

    // MANAGER puede registrar la compra operativa, pero cambiar el precio de
    // venta reescribe el catálogo comercial y conserva el permiso histórico de
    // OWNER/ADMIN/SUPER_ADMIN. Este guard corre antes de cualquier lectura o tx.
    if (hasPurchaseSalePriceIntent(items) && !canSetPurchaseSalePrice(authReq.role)) {
        return res.status(403).json({
            error: 'No tenés permiso para modificar precios de venta desde una compra',
            code: 'PURCHASE_SALE_PRICE_FORBIDDEN',
        });
    }

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
        const ppvAccount = purchaseOrderId
            ? await prisma.account.findUnique({
                where: { tenantId_code: { tenantId: authReq.tenantId!, code: '5.1.3' } },
                select: { id: true },
            })
            : { id: 'NOT_REQUIRED' };
        if (!anchorPurchase || !ppvAccount) await seedChartOfAccounts(authReq.tenantId!);
        if (!purchaseOrderId) await asegurarBodegaPorDefecto(prisma, authReq.tenantId!);

        // Compra de CONTADO: el efectivo sale de la gaveta, así que exige una
        // caja abierta. Se resuelve ANTES de la tx (el turno es el mismo que ve
        // la píldora del POS) y el error DICE que falta abrir caja — antes se
        // debitaba la billetera fintech y respondía "recarga tu billetera".
        const { shift: turnoDeContado } = paymentMethod === 'CASH'
            ? await resolverTurnoAbierto(authReq.tenantId!, authReq.userId!)
            : { shift: null };
        if (paymentMethod === 'CASH' && !turnoDeContado) {
            const sinCaja = new CashSupplierPaymentError(
                'SIN_CAJA_ABIERTA',
                'No hay caja abierta. Abrí una caja para registrar una compra de contado, o registrala a crédito.'
            );
            return res.status(sinCaja.httpStatus).json({ error: sinCaja.message, code: sinCaja.code });
        }
        // Snapshot de la gaveta para la auditoría (se llena dentro de la tx).
        let efectivoAntesCompra: Decimal | null = null;
        let efectivoDespuesCompra: Decimal | null = null;

        const result = await prisma.$transaction(async (tx: any) => {
            // Consolidar dentro de la misma unidad ACID: repetir el mismo precio
            // para un SKU es idempotente; dos precios distintos son una intención
            // ambigua y abortan la compra completa con 400.
            const salePriceIntents = resolvePurchaseSalePriceIntents(items);
            const salePriceIntentByProduct = new Map(
                salePriceIntents.map((intent) => [intent.productId, intent]),
            );

            // Serializar las compras del proveedor antes de cualquier lectura consistente
            // de la transacción. Así, un doble envío concurrente no puede pasar dos veces
            // el chequeo de factura duplicada.
            await tx.$queryRaw`SELECT id FROM \`Supplier\` WHERE id = ${supplierId} AND \`tenantId\` = ${authReq.tenantId} FOR UPDATE`;

            // ORDEN DE BLOQUEO — Product ANTES que Shift, a propósito.
            //
            // El turno NO se bloquea acá: lo toma `registrarSalidaDeCajaPorCompra`
            // en el punto 4, DESPUÉS de los locks de Product del punto 3. Ese es
            // el mismo orden que usa la devolución en efectivo, que es la otra
            // transacción del sistema que bloquea las dos tablas:
            //   /api/returns:   Sale → Product (pre-lock ordenado) → Shift
            //   /api/purchases: Supplier → Product → Shift
            // Un intento anterior adelantó el lock del turno hasta acá creyendo
            // que la devolución era Shift → Product. No lo es: la devolución
            // prebloquea Product y `applyStockDelta` reutiliza ese lock después.
            // Adelantar este lock de Shift INVERTIRÍA el orden y abriría el
            // deadlock que pretendía cerrar: una devolución y una compra de
            // contado del mismo producto, en el mismo turno, se trababan.
            // Si algún día se cambia este orden, hay que cambiar los DOS lados.

            // Verificar propiedad del proveedor: nunca confiar en supplierId del body sin
            // scoping por tenant. Sin esto, el include: { supplier: true } filtraría PII
            // del proveedor de otro tenant (fuga cross-tenant).
            const supplier = await tx.supplier.findFirst({
                where: {
                    id: supplierId,
                    tenantId: authReq.tenantId!,
                    status: 'ACTIVE',
                    deletedAt: null,
                },
            });
            if (!supplier) {
                throw new Error('Proveedor no encontrado o no está activo');
            }
            // Una compra directa siempre tiene ubicación. Clientes anteriores
            // pueden omitirla solo cuando el negocio mantiene una única bodega
            // activa; con multi-bodega la ambigüedad se rechaza.
            const operationWarehouse = purchaseOrderId
                ? null
                : await resolveOperationalWarehouse(tx, authReq.tenantId!, warehouseId);

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
                items: {
                    id: string;
                    productId: string;
                    productName: string;
                    quantityReceived: number | string;
                    quantityReceivedExact: Decimal | null;
                }[];
                receipts: {
                    items: { productId: string; quantity: number; quantityExact: Decimal | null }[];
                }[];
            } | null = null;
            if (purchaseOrderId) {
                linkedPurchaseOrder = await tx.purchaseOrder.findFirst({
                    where: { id: purchaseOrderId, tenantId: authReq.tenantId! },
                    select: {
                        id: true,
                        supplierId: true,
                        status: true,
                        items: {
                            select: {
                                id: true,
                                productId: true,
                                productName: true,
                                quantityReceived: true,
                                quantityReceivedExact: true,
                            },
                        },
                        receipts: {
                            select: {
                                items: {
                                    select: { productId: true, quantity: true, quantityExact: true },
                                },
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

            // El régimen sale del tenant autenticado y se congela junto con la
            // compra dentro de esta misma transacción. Nunca se acepta del body.
            const tenantFiscal = await tx.tenant.findUnique({
                where: { id: authReq.tenantId! },
                select: { fiscalRegime: true },
            });
            if (!tenantFiscal) throw new Error('TENANT_NOT_FOUND');
            const fiscalRegimeAtPurchase = normalizeFiscalRegime(tenantFiscal.fiscalRegime);
            const cuotaFijaPurchase = fiscalRegimeAtPurchase === FISCAL_REGIME_CUOTA_FIJA;

            // 1. Calcular totales. T2 Fase 2 — el crédito fiscal (IVA de compras)
            //    se genera SOLO por los ítems GRAVADOS. Antes se aplicaba 15% a
            //    TODO el subtotal, así que una farmacia que compra medicamentos
            //    exonerados se acreditaba un crédito fiscal INEXISTENTE (menos IVA
            //    a pagar del que corresponde). `product.ivaExento` es autoritativo
            //    (viene de la BD scoped por tenant, nunca del cliente).
            interface PreparedPurchaseItem {
                productId: string;
                productName: string;
                purchaseOrderItemId: string | null;
                quantity: number;
                quantityExact: string;
                baseQuantity: Decimal;
                stockQuantity: number;
                unit: string;
                unitCost: string;
                unitCostExact: string;
                lineNet: Decimal;
                taxable: boolean;
                batchNumber: string | null;
                expiryDate: Date | null;
            }
            const preparedItems: PreparedPurchaseItem[] = [];

            const productIds = [...new Set(items.map((item: any) => String(item.productId)))];
            const ownedProducts: Array<{
                id: string;
                name: string;
                unit: string;
                ivaExento: boolean;
                requiresBatchTracking: boolean;
                saleMode: SaleMode | null;
                quantityStep: any;
                packUnit: string | null;
                packSize: number | null;
            }> = await tx.product.findMany({
                where: { id: { in: productIds }, tenantId: authReq.tenantId! },
                select: {
                    id: true,
                    name: true,
                    unit: true,
                    ivaExento: true,
                    requiresBatchTracking: true,
                    saleMode: true,
                    quantityStep: true,
                    packUnit: true,
                    packSize: true,
                },
            });
            const productsById = new Map<string, (typeof ownedProducts)[number]>(
                ownedProducts.map((product) => [product.id, product]),
            );

            for (const item of items) {
                const product = productsById.get(item.productId);

                if (!product) {
                    throw new Error(`Producto no encontrado: ${item.productId}`);
                }

                let resolvedLine: ReturnType<typeof resolvePurchaseLine>;
                try {
                    resolvedLine = resolvePurchaseLine(item, product);
                } catch (error) {
                    if (error instanceof QuantityValidationError) {
                        throw new QuantityValidationError(error.code, `${product.name}: ${error.message}`);
                    }
                    throw error;
                }
                const exactQuantity = resolvedLine.baseQuantity;
                // PurchaseItem.unitCost sigue siendo Decimal(10,2) legacy; el
                // snapshot nuevo conserva seis decimales del costo base resuelto.
                const unitCost = resolvedLine.baseUnitCost.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
                const linkedItem = linkedProductAvailability?.get(item.productId);
                if (linkedProductAvailability && !linkedItem) {
                    throw new Error(`ITEM_FUERA_DE_OC|${product.name}`);
                }
                if (item.purchaseOrderItemId) {
                    const explicitOrderItem = linkedPurchaseOrder?.items.find(
                        (orderItem) => orderItem.id === item.purchaseOrderItemId,
                    );
                    if (!explicitOrderItem || explicitOrderItem.productId !== item.productId) {
                        throw new Error(`ITEM_OC_INVALIDO|${product.name}`);
                    }
                }
                if (linkedItem) {
                    const remainingToInvoice = linkedItem.remaining;
                    const requested = (requestedFromLinkedPO.get(item.productId) ?? new Decimal(0))
                        .plus(exactQuantity);
                    if (remainingToInvoice.lte(0) || requested.greaterThan(remainingToInvoice)) {
                        throw new Error(`CANTIDAD_SUPERA_RECEPCION|${linkedItem.productName}|${Decimal.max(0, remainingToInvoice).toString()}`);
                    }
                    requestedFromLinkedPO.set(item.productId, requested);
                }

                if (!linkedPurchaseOrder && product.requiresBatchTracking && (!item.batchNumber || !item.expiryDate)) {
                    throw new Error(`LOTE_REQUERIDO|${product.name}`);
                }

                preparedItems.push({
                    productId:   item.productId,
                    productName: product.name,
                    purchaseOrderItemId: item.purchaseOrderItemId ?? null,
                    quantity:    legacyPurchaseQuantity(exactQuantity),
                    quantityExact: exactQuantity.toFixed(),
                    baseQuantity: exactQuantity,
                    stockQuantity: exactQuantity.toNumber(),
                    unit: product.unit,
                    unitCost:    unitCost.toFixed(2),
                    unitCostExact: resolvedLine.baseUnitCost
                        .toDecimalPlaces(6, Decimal.ROUND_HALF_UP)
                        .toFixed(6),
                    // Recalcular desde los operandos Decimal preserva el importe
                    // previo al redondeo; purchaseMoney aplica HALF_UP explícito.
                    lineNet: resolvedLine.visibleQuantity.mul(resolvedLine.visibleUnitCost),
                    taxable: !product.ivaExento,
                    batchNumber: item.batchNumber || null,
                    expiryDate:  item.expiryDate ? normalizeCalendarDateInput(item.expiryDate) : null
                });
            }

            // La factura, el subledger y el mayor se liquidan por línea a centavos.
            // Sumar IVA sobre la base agregada dejaba casos como C$0.10 + C$0.015
            // persistidos en balanceDue (4dp) aunque Purchase.total y el mayor son 2dp.
            const purchaseMoney = calculatePurchaseMoney(
                preparedItems.map((item) => ({ lineNet: item.lineNet, taxable: item.taxable })),
                !cuotaFijaPurchase,
            );
            const subtotalAmount = purchaseMoney.subtotal;
            const taxAmount = purchaseMoney.tax;
            const totalAmount = purchaseMoney.total;
            const creditableTax = purchaseMoney.creditableTax;
            // El modo es configuración persistida del tenant, jamás del payload. Se
            // resuelve una sola vez por documento y solo cuando realmente hay una
            // entrada directa con lote; las compras sin lote y las facturas de OC no
            // pagan una lectura ni materializan filas del sidecar.
            // La identidad de PurchaseItem responde al tipo de documento, no al
            // sidecar: toda compra directa necesita una línea retornable aunque el
            // producto no maneje lotes o el ledger esté OFF. La lectura del modo sí
            // queda limitada al subconjunto que realmente puede usar el sidecar.
            const isDirectPurchase = !linkedPurchaseOrder;
            const hasTrackedDirectPurchaseItem = isDirectPurchase && preparedItems.some((item) =>
                productsById.get(item.productId)?.requiresBatchTracking === true);
            const batchWarehouseLedgerMode = hasTrackedDirectPurchaseItem
                ? await resolveBatchWarehouseLedgerMode(tx, authReq.tenantId!)
                : null;
            const processedItems = preparedItems.map((item, index) => {
                const lineMoney = purchaseMoney.lines[index];
                // `calculatePurchaseMoney` conserva exactamente una salida por
                // entrada; este guard evita persistir una línea sin snapshots si
                // ese contrato cambiara accidentalmente.
                if (!lineMoney) throw new Error('TOTAL_COMPRA_INCONSISTENTE');
                const {
                    baseQuantity,
                    lineNet: _lineNet,
                    taxable,
                    ...persisted
                } = item;
                const inventoryLineCost = cuotaFijaPurchase && taxable
                    ? lineMoney.lineTotal
                    : lineMoney.lineNet;
                return {
                    ...persisted,
                    // Identidad interna de la línea: el sidecar lote+bodega usa este
                    // mismo id persistido y nunca depende del orden de retorno de MySQL.
                    // Va después del snapshot para que ninguna ampliación futura del
                    // payload preparado pueda reemplazar la autoridad del servidor.
                    // Toda línea directa recibe identidad server-side antes de los
                    // efectos físicos. Así incluso SKUs duplicados conservan una
                    // evidencia de bodega/lote/costo inequívoca para devoluciones.
                    ...(isDirectPurchase ? { id: crypto.randomUUID() } : {}),
                    averageUnitCost: inventoryLineCost.div(baseQuantity).toString(),
                    totalCost: lineMoney.lineNet.toFixed(2),
                    taxAmountExact: lineMoney.lineTax.toFixed(2),
                    creditableTaxExact: lineMoney.creditableTax.toFixed(2),
                };
            });

            // CASH nace pagada y liquidada en el mismo instante autoritativo.
            const settledNow = paymentMethod === 'CASH' ? new Date() : null;

            // 2. Crear cabecera de compra
            const purchase = await tx.purchase.create({
                data: {
                    tenantId: authReq.tenantId!,
                    supplierId,
                    invoiceNumber,
                    purchaseOrderId: linkedPurchaseOrder?.id ?? null,
                    // `date` es obligatorio: inferirlo desde createdAt clasifica
                    // mal las facturas retroactivas en constancias/libros/DGI.
                    date: normalizeCalendarDateInput(date),
                    postingDate: normalizeCalendarDateInput(postingDate ?? date),
                    dueDate: dueDate ? normalizeCalendarDateInput(dueDate) : null,
                    subtotal: subtotalAmount.toFixed(2),
                    tax: taxAmount.toFixed(2),
                    fiscalRegimeAtPurchase,
                    creditableTax: creditableTax.toFixed(2),
                    total: totalAmount.toFixed(2),
                    documentStatus: 'POSTED',
                    matchStatus: 'NOT_REQUIRED',
                    paymentHold: false,
                    status: paymentMethod === 'CASH' ? 'COMPLETED' : 'PENDING_PAYMENT',
                    paymentMethod,
                    // El saldo de CxP nace junto con la compra. Los NULL quedan
                    // reservados exclusivamente para filas históricas previas al
                    // subledger; así un abono parcial nunca depende de inferencias.
                    balanceDue: paymentMethod === 'CASH' ? '0.00' : totalAmount.toFixed(2),
                    paidAt: settledNow,
                    settledAt: settledNow,
                    notes: notes || null,
                    createdBy: authReq.userId!,
                    items: {
                        create: processedItems.map(({
                            stockQuantity: _stockQuantity,
                            unit: _unit,
                            averageUnitCost: _averageUnitCost,
                            ...persisted
                        }) => persisted),
                    }
                },
                include: { items: true, supplier: true }
            });

            // La conciliación toma la línea de OC como identidad y reserva las
            // recepciones antes de cualquier efecto financiero. Una compra CASH
            // fuera de tolerancia falla aquí y revierte la factura completa.
            const procurementMatch = await executeProcurementMatch({
                tx,
                tenantId: authReq.tenantId!,
                userId: authReq.userId!,
                purchaseId: purchase.id,
            });
            // executeProcurementMatch materializa identidad OC y snapshots exactos
            // mediante UPDATE SQL. El objeto devuelto por purchase.create conserva
            // los items previos; refrescarlos evita responder costos/variancias stale.
            const matchedPurchaseItems = await tx.purchaseItem.findMany({
                where: {
                    purchaseId: purchase.id,
                    purchase: { tenantId: authReq.tenantId! },
                },
                orderBy: { id: 'asc' },
            });
            if (matchedPurchaseItems.length !== purchase.items.length) {
                throw new ProcurementMatchError(
                    'PURCHASE_ITEM_REFRESH_FAILED',
                    409,
                    'No se pudieron confirmar todas las líneas conciliadas de la factura',
                );
            }

            // 3. Actualizar inventario + Kardex + Costo promedio ponderado. Si hay OC,
            // la recepción es la única responsable de estos movimientos.
            const costChanges: any[] = []; // before/after de stock y costo valorizado por producto
            const priceChanges: Array<{
                productId: string;
                priceBefore: string;
                priceAfter: string;
            }> = [];
            const directSalePriceProductsProcessed = new Set<string>();
            // Dos compras directas de proveedores distintos no comparten el lock
            // inicial del Supplier. Ejecutar [P1,P2] y [P2,P1] en paralelo podía
            // ciclar los locks Product/ProductStock. La copia ordenada afecta solo
            // efectos físicos; no cambia el orden ni la identidad de PurchaseItem.
            const inventoryMutationItems = linkedPurchaseOrder
                ? []
                : [...processedItems].sort((left, right) =>
                    left.productId.localeCompare(right.productId)
                    || (left.batchNumber ?? '').localeCompare(right.batchNumber ?? '')
                    || (left.id ?? '').localeCompare(right.id ?? ''));
            for (const item of inventoryMutationItems) {
                const product = productsById.get(item.productId);
                if (!product) continue;

                // Stock por applyStockDelta: incremento ATÓMICO (sin lost-update del
                // patrón leer→escribir absoluto) + doble escritura del desglose por
                // bodega (invariante multi-bodega: Σ bodegas == agregado).
                const { stockBefore, stockAfter, warehouseId: purchaseWarehouseId } = await applyStockDelta(tx, {
                    tenantId: authReq.tenantId!,
                    productId: item.productId,
                    delta: item.stockQuantity,
                    enforceSufficient: false,
                    warehouseId: operationWarehouse?.id,
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
                const lockedProductRows: any[] = await tx.$queryRaw`SELECT cost, price FROM \`Product\` WHERE id = ${item.productId} AND \`tenantId\` = ${authReq.tenantId} FOR UPDATE`;
                const lockedProduct = lockedProductRows[0];
                if (!lockedProduct) {
                    throw new PurchaseSalePriceError(
                        'PURCHASE_PRODUCT_NOT_FOUND',
                        404,
                        `Producto no encontrado: ${item.productId}`,
                    );
                }
                const oldCost = new Decimal(lockedProduct.cost.toString());
                const priceChange = buildPurchaseSalePriceChange(
                    item.productId,
                    lockedProduct.price,
                    directSalePriceProductsProcessed.has(item.productId)
                        ? undefined
                        : salePriceIntentByProduct.get(item.productId),
                );

                // Promedio ponderado móvil (función pura compartida — regla C1 adentro).
                const newAvgCost = weightedAverageCost(
                    oldStock,
                    oldCost,
                    item.quantityExact,
                    item.averageUnitCost,
                ).toNumber();

                await tx.product.update({
                    where: { id: item.productId, tenantId: authReq.tenantId! },
                    data: {
                        cost: newAvgCost, // ya redondeado a 4 d.p. por Decimal
                        // Ausente o igual conserva Product.price; nunca se reescribe
                        // por el mero hecho de registrar una compra.
                        ...(priceChange
                            ? { price: new Decimal(priceChange.priceAfter).toNumber() }
                            : {}),
                    }
                });
                directSalePriceProductsProcessed.add(item.productId);
                if (priceChange) priceChanges.push(priceChange);

                costChanges.push({
                    productId: item.productId,
                    stockBefore: oldStock,
                    stockAfter: newStock,
                    costBefore: oldCost.toNumber(),
                    costAfter: newAvgCost,
                    quantityExact: item.quantityExact,
                    unit: item.unit,
                });

                // Control de Lotes
                let batchId = null;
                if (product.requiresBatchTracking && item.batchNumber && item.expiryDate) {
                    // `applyStockDelta` ya bloqueó Product. Esta lectura locking
                    // conserva ese orden global y cierra la carrera entre dos
                    // compras que intenten crear el mismo número de lote con
                    // vencimientos distintos.
                    const existingBatches: Array<{ id: string; expiryDate: Date }> = await tx.$queryRaw`
                        SELECT id, expiryDate
                        FROM \`ProductBatch\`
                        WHERE tenantId = ${authReq.tenantId!}
                          AND productId = ${item.productId}
                          AND batchNumber = ${item.batchNumber}
                        FOR UPDATE`;
                    const existingBatch = existingBatches[0] ?? null;
                    if (existingBatch) {
                        assertProductBatchExpiryIdentity({
                            productId: item.productId,
                            productName: product.name,
                            batchNumber: item.batchNumber,
                            existingExpiryDate: existingBatch.expiryDate,
                            incomingExpiryDate: item.expiryDate,
                        });
                    }
                    if (existingBatch) {
                        const updatedBatch = await tx.productBatch.updateMany({
                            where: {
                                id: existingBatch.id,
                                tenantId: authReq.tenantId!,
                                productId: item.productId,
                            },
                            data: { stock: { increment: item.stockQuantity } },
                        });
                        if (updatedBatch.count !== 1) {
                            throw new Error('PURCHASE_BATCH_CONCURRENT_WRITE');
                        }
                        batchId = existingBatch.id;
                    } else {
                        const createdBatch = await tx.productBatch.create({
                            data: {
                                tenantId: authReq.tenantId!,
                                productId: item.productId,
                                batchNumber: item.batchNumber,
                                // `processedItems` ya normalizó la fecha calendario a Date.
                                expiryDate: item.expiryDate,
                                stock: item.stockQuantity,
                            },
                            select: { id: true },
                        });
                        batchId = createdBatch.id;
                    }

                    // Sidecar exacto lote+bodega. Product/ProductStock, ProductBatch
                    // y Kardex siguen siendo los agregados legacy; cualquier fallo
                    // acá aborta la misma tx antes del Kardex y la auditoría final.
                    if (batchWarehouseLedgerMode === 'SHADOW' || batchWarehouseLedgerMode === 'ENFORCED') {
                        if (!item.id) throw new Error('PURCHASE_ITEM_ID_REQUIRED');
                        await applyBatchWarehouseDelta({
                            tx,
                            mode: batchWarehouseLedgerMode,
                            tenantId: authReq.tenantId!,
                            productId: item.productId,
                            batchId,
                            warehouseId: purchaseWarehouseId,
                            delta: item.quantityExact,
                            movementType: 'DIRECT_PURCHASE',
                            referenceId: purchase.id,
                            referenceType: 'PURCHASE',
                            userId: authReq.userId!,
                            reason: `Compra Factura #${invoiceNumber}`,
                            sourceKey: `direct-purchase:${purchase.id}:item:${item.id}`,
                            allowNegative: false,
                        });
                    }
                }

                // Evidencia física de la entrada directa. Se escribe únicamente
                // después de confirmar stock y lote; count!=1 aborta toda la tx.
                if (!item.id) throw new Error('PURCHASE_ITEM_ID_REQUIRED');
                const evidenceWrite = await tx.purchaseItem.updateMany({
                    where: { id: item.id, purchaseId: purchase.id },
                    data: {
                        inventoryWarehouseId: purchaseWarehouseId,
                        inventoryBatchId: batchId,
                        inventoryUnitCostExact: new Decimal(item.averageUnitCost)
                            .toDecimalPlaces(6, Decimal.ROUND_HALF_UP)
                            .toFixed(6),
                    },
                });
                if (evidenceWrite.count !== 1) {
                    throw new Error('PURCHASE_ITEM_INVENTORY_EVIDENCE_WRITE_FAILED');
                }

                // Kardex: Registro de entrada por compra
                await tx.kardexMovement.create({
                    data: {
                        tenantId: authReq.tenantId!,
                        productId: item.productId,
                        type: 'IN_PURCHASE',
                        quantity: item.stockQuantity,
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

            // La factura de una OC no toca stock/costo y, por tanto, no entra al
            // bucle anterior. Sus precios explícitos toman Product locks propios en
            // orden estable, todavía antes del posible lock de Shift (CASH).
            if (linkedPurchaseOrder && salePriceIntents.length > 0) {
                priceChanges.push(...await applyLinkedPurchaseSalePriceIntents({
                    tx,
                    tenantId: authReq.tenantId!,
                    intents: salePriceIntents,
                }));
            }

            // 4. Registro financiero — LA PLATA SALE DE LA GAVETA, no de la
            //    billetera fintech (`Tenant.walletBalance`, que se fondea con
            //    /api/loans/request y solo se gasta en el marketplace B2B).
            //    Antes se debitaba esa billetera y, como ninguna PyME la tiene
            //    fondeada, TODA compra de contado moría con "SALDO_INSUFICIENTE …
            //    recarga tu billetera" aunque hubiera efectivo real en la caja.
            //    El asiento de `recordPurchase` ya acreditaba Caja (1.1.1): la
            //    billetera nunca fue la contrapartida correcta.
            if (paymentMethod === 'CASH') {
                // `turnoDeContado` se resolvió y validó ANTES de abrir la tx.
                const salida = await registrarSalidaDeCajaPorCompra(tx, {
                    tenantId: authReq.tenantId!,
                    userId: authReq.userId!,
                    shiftId: turnoDeContado!.id,
                    invoiceNumber,
                    supplierName: purchase.supplier.name,
                    total: totalAmount,
                });
                efectivoAntesCompra = salida.efectivoAntes;
                efectivoDespuesCompra = salida.efectivoDespues;
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
                totalAmount.toFixed(2),
                taxAmount.toFixed(2),
                paymentMethod,
                creditableTax.toFixed(2),
                normalizeCalendarDateInput(postingDate ?? date),
                linkedPurchaseOrder ? procurementMatch.plan.expectedAmount : undefined,
            );

            // Auditoría granular del catálogo, dentro de la misma tx que compra,
            // stock, caja y mayor. Un fallo posterior revierte también el precio.
            await createPurchaseSalePriceAudits({
                tx,
                tenantId: authReq.tenantId!,
                userId: authReq.userId!,
                purchaseId: purchase.id,
                purchaseOrderId: linkedPurchaseOrder?.id ?? null,
                invoiceNumber,
                changes: priceChanges,
            });

            // Asiento inmutable de auditoría (Capa 3): toda compra mueve su efecto
            // financiero; solo una compra directa mueve además inventario valorizado.
            // Registrar el before/after de la GAVETA (null si fue a crédito: ahí no
            // sale efectivo) y los cambios de stock/costo aplicados.
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
                        warehouseId: operationWarehouse?.id ?? null,
                        paymentMethod,
                        subtotal: subtotalAmount.toString(),
                        tax: taxAmount.toString(),
                        creditableTax: creditableTax.toString(),
                        fiscalRegime: fiscalRegimeAtPurchase,
                        total: totalAmount.toString(),
                        matchStatus: procurementMatch.matchStatus,
                        paymentHold: procurementMatch.paymentHold,
                        priceTolerancePct: procurementMatch.priceTolerancePct,
                        shiftId: paymentMethod === 'CASH' ? turnoDeContado?.id ?? null : null,
                        efectivoAntes: efectivoAntesCompra?.toFixed(2) ?? null,
                        efectivoDespues: efectivoDespuesCompra?.toFixed(2) ?? null,
                        productChanges: costChanges,
                        priceChanges,
                        timestamp: new Date().toISOString()
                    })
                }
            });

            return {
                ...purchase,
                items: matchedPurchaseItems,
                matchStatus: procurementMatch.matchStatus,
                paymentHold: procurementMatch.paymentHold,
            };
        });

        res.json({
            message: result.purchaseOrderId
                ? 'Factura registrada y vinculada a la Orden de Compra. El inventario se actualiza únicamente al recibir la OC.'
                : `Compra registrada. ${items.length} línea(s) ingresada(s) al inventario.`,
            purchase: result
        });

    } catch (error: any) {
        console.error('Error registrando compra:', error);
        if (productQuantityErrorResponse(res, error)) return;
        // Período cerrado (A1): la compra ahora exige asiento, así que un período
        // bloqueado la RECHAZA (423) en vez de dejar entrar mercancía sin registrar.
        if (error instanceof PeriodLockedError) {
            return res.status(423).json({ error: error.message });
        }
        if (error instanceof ProcurementMatchError) {
            return res.status(error.httpStatus).json({
                error: error.message,
                code: error.code,
                ...(error.details ? { details: error.details } : {}),
            });
        }
        if (error instanceof BatchWarehouseLedgerError) {
            return res.status(error.httpStatus).json({ error: error.message, code: error.code });
        }
        if (error instanceof PurchaseSalePriceError) {
            return res.status(error.httpStatus).json({ error: error.message, code: error.code });
        }
        if (error instanceof ProductBatchIdentityError) {
            return res.status(error.httpStatus).json({
                error: error.message,
                code: error.code,
                details: error.details,
            });
        }
        if (error?.message === 'PURCHASE_BATCH_CONCURRENT_WRITE') {
            return res.status(409).json({
                error: 'El lote cambió mientras se registraba la compra; intentá nuevamente',
                code: 'PURCHASE_BATCH_CONCURRENT_WRITE',
            });
        }
        if (error?.message === 'FACTURA_DUPLICADA' || error?.code === 'P2002') {
            return res.status(409).json({ error: `Ya existe la factura #${invoiceNumber} para este proveedor. No se registró nuevamente.` });
        }
        if (error instanceof StockError && error.code === 'WAREHOUSE_REQUIRED') {
            return res.status(400).json({ error: error.message, code: error.code });
        }
        if (error instanceof StockError && error.code === 'WAREHOUSE_NOT_FOUND') {
            return res.status(404).json({ error: error.message, code: error.code });
        }
        if (error?.message === 'OC_DE_OTRO_PROVEEDOR') {
            return res.status(400).json({ error: 'La orden de compra pertenece a otro proveedor' });
        }
        if (error?.message === 'OC_NO_ENCONTRADA') {
            return res.status(404).json({ error: 'Orden de compra no encontrada' });
        }
        if (error?.message === 'TENANT_NOT_FOUND') {
            return res.status(404).json({ error: 'Negocio no encontrado' });
        }
        if (error?.message?.startsWith('LOTE_REQUERIDO|')) {
            const productName = error.message.slice('LOTE_REQUERIDO|'.length);
            return res.status(400).json({ error: `Ingresá el lote y la fecha de vencimiento de ${productName}` });
        }
        if (error?.message?.startsWith('ITEM_FUERA_DE_OC|')) {
            const productName = error.message.slice('ITEM_FUERA_DE_OC|'.length);
            return res.status(400).json({ error: `${productName} no pertenece a la orden de compra vinculada` });
        }
        if (error?.message?.startsWith('ITEM_OC_INVALIDO|')) {
            const productName = error.message.slice('ITEM_OC_INVALIDO|'.length);
            return res.status(400).json({
                error: `La línea de orden indicada para ${productName} no pertenece a esta orden de compra`,
                code: 'PURCHASE_ORDER_ITEM_INVALID',
            });
        }
        if (error?.message?.startsWith('CANTIDAD_SUPERA_RECEPCION|')) {
            const [, productName, remainingQty] = error.message.split('|');
            return res.status(400).json({ error: `${productName} solo tiene ${remainingQty} unidades recibidas pendientes de facturar en esta OC` });
        }
        if (error?.message?.startsWith('OC_ESTADO:')) {
            const status = error.message.split(':')[1];
            return res.status(400).json({ error: status === 'APPROVED' ? 'Recibí la mercadería antes de facturar una orden de compra aprobada' : `No se puede facturar una orden de compra en estado ${status}` });
        }
        // Caja: sin turno abierto (409) o efectivo insuficiente en la gaveta (400).
        // El status sale del código tipado, no de un substring del mensaje.
        if (error instanceof CashSupplierPaymentError || error instanceof PayableSupplierPaymentError) {
            return res.status(error.httpStatus).json({ error: error.message, code: error.code });
        }
        const notFound = error?.message?.includes('no encontrado');
        res.status(notFound ? 404 : 500).json({ error: error.message || 'Error al procesar la compra' });
    }
});

// POST /api/purchases/:id/pay — abono o liquidación de una CxP.
app.post(
    '/api/purchases/:id/pay',
    authenticate,
    checkRole(PURCHASE_PAYMENT_ROLES),
    validate(SupplierPaymentRequestSchema),
    async (req: any, res: any) => {
        const authReq = req as AuthRequest;
        try {
            // createJournalEntry resuelve el catálogo desde el cliente compartido.
            // Sembrar antes de abrir la tx evita que REPEATABLE READ oculte cuentas
            // recién creadas dentro del pago.
            const payableAccount = await prisma.account.findUnique({
                where: { tenantId_code: { tenantId: authReq.tenantId!, code: '2.1.1' } },
                select: { id: true },
            });
            if (!payableAccount) await seedChartOfAccounts(authReq.tenantId!);

            const result = await executeSupplierPaymentTransaction({
                db: prisma,
                tenantId: authReq.tenantId!,
                userId: authReq.userId!,
                purchaseId: req.params.id,
                request: req.body,
            });

            return res.json({
                ...result,
                message: result.replay
                    ? 'El pago ya había sido registrado; no se duplicó.'
                    : result.purchase.status === 'COMPLETED'
                        ? 'Factura pagada completamente.'
                        : 'Abono a proveedor registrado.',
            });
        } catch (error: unknown) {
            if (error instanceof PayableSupplierPaymentError) {
                return res.status(error.httpStatus).json({ error: error.message, code: error.code });
            }
            if (error instanceof PeriodLockedError) {
                return res.status(409).json({ error: error.message, code: 'PERIOD_LOCKED' });
            }
            console.error('Pago a proveedor falló', {
                name: error instanceof Error ? error.name : 'UnknownError',
                code: typeof error === 'object' && error !== null && 'code' in error
                    ? String((error as { code?: unknown }).code ?? '')
                    : undefined,
            });
            return res.status(500).json({ error: 'No pudimos registrar el pago al proveedor' });
        }
    },
);

// GET /api/purchases/pending - Cuentas por pagar
app.get('/api/purchases/pending', authenticate, checkRole(PURCHASE_PAYMENT_ROLES), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const pending = await prisma.purchase.findMany({
            where: {
                tenantId: authReq.tenantId,
                documentStatus: 'POSTED',
                status: { in: [...PURCHASE_PAYABLE_STATUSES] },
                paymentMethod: { not: 'NORTEX_CAPITAL' },
            },
            include: { supplier: { select: { name: true } } },
            orderBy: { dueDate: 'asc' },
            take: 500,
        });

        const serialized = pending.map((purchase) => ({
            ...purchase,
            balanceDue: resolveEffectiveSupplierBalance(purchase).toFixed(4),
        }));
        const totalDebt = serialized.reduce(
            (sum, purchase) => sum.plus(purchase.balanceDue),
            new Decimal(0),
        ).toDecimalPlaces(4);

        res.json({
            purchases: serialized,
            totalDebt: totalDebt.toNumber(),
            totalDebtExact: totalDebt.toFixed(4),
        });
    } catch (error) {
        if (error instanceof PayableSupplierPaymentError) {
            return res.status(error.httpStatus).json({ error: error.message, code: error.code });
        }
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
                status: { not: ESTADO_ANULADA },
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
app.get('/api/quotations', authenticate, checkRole(QUOTATION_READ_ROLES), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const quotes = await prisma.quotation.findMany({
            where: { tenantId: authReq.tenantId },
            orderBy: { createdAt: 'desc' },
            take: 50,
            include: {
                items: {
                    orderBy: { id: 'asc' },
                },
            },
        });
        const productIds = [...new Set(quotes.flatMap((quote) => quote.items.map((item) => item.productId)))];
        const products: QuotationProductAuthority[] = productIds.length === 0
            ? []
            : await prisma.product.findMany({
                where: { tenantId: authReq.tenantId, id: { in: productIds } },
                select: {
                    id: true,
                    name: true,
                    price: true,
                    unit: true,
                    ivaExento: true,
                    saleMode: true,
                    quantityStep: true,
                },
            });
        const safeQuotes = quotes.map((q: any) => ({
            ...q,
            subtotal: Number(q.subtotal),
            tax: Number(q.tax),
            total: Number(q.total),
            items: serializeQuotationItemsForClient(q.items, products),
        }));
        res.json(safeQuotes);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener cotizaciones' });
    }
});

// POST /api/quotations - Crear
app.post('/api/quotations', authenticate, checkRole(QUOTATION_WRITE_ROLES), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { customerName, customerRuc, items, expiresAt } = req.body;

    if (!items || items.length === 0) return res.status(400).json({ error: 'Faltan items' });

    try {
        const parsedItems = z.array(z.object({
            id: z.string().trim().min(1).max(191).optional(),
            productId: z.string().trim().min(1).max(191).optional(),
            quantity: z.union([z.string(), z.number()]),
            price: z.union([z.string(), z.number()]).optional(),
            name: z.string().trim().min(1).max(255).optional(),
        }).strict()).min(1).max(500).parse(items).map((item) => ({
            ...item,
            quantity: item.quantity,
        }));

        const productIds = [...new Set(parsedItems.map((item) => String(item.productId ?? item.id)))];
        const [products, tenantFiscal] = await Promise.all([
            prisma.product.findMany({
                where: { tenantId: authReq.tenantId!, id: { in: productIds } },
                select: {
                    id: true,
                    name: true,
                    price: true,
                    unit: true,
                    ivaExento: true,
                    saleMode: true,
                    quantityStep: true,
                },
            }) as Promise<QuotationProductAuthority[]>,
            prisma.tenant.findUnique({
                where: { id: authReq.tenantId! },
                select: { fiscalRegime: true },
            }),
        ]);
        if (!tenantFiscal) return res.status(404).json({ error: 'Negocio no encontrado' });
        const fiscalRegimeAtQuote = normalizeFiscalRegime(tenantFiscal.fiscalRegime);
        const resolvedItems = resolveQuotationItems(parsedItems, products);

        let subtotalD = new Decimal(0);
        let taxD = new Decimal(0);
        let grossTotalD = new Decimal(0);
        for (const item of resolvedItems) {
            const lineTotal = item.price.mul(item.quantityExact).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
            grossTotalD = grossTotalD.plus(lineTotal);
            if (item.ivaExento) {
                subtotalD = subtotalD.plus(lineTotal);
                continue;
            }
            const { neto, iva } = desglosarIvaIncluido(lineTotal);
            subtotalD = subtotalD.plus(neto);
            taxD = taxD.plus(iva);
        }

        const cuotaFija = fiscalRegimeAtQuote === FISCAL_REGIME_CUOTA_FIJA;
        const subtotal = (cuotaFija ? grossTotalD : subtotalD)
            .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
            .toNumber();
        const tax = cuotaFija ? 0 : taxD.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
        const total = cuotaFija
            ? grossTotalD.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber()
            : new Decimal(subtotal).plus(tax).toNumber();

        const quote = await prisma.quotation.create({
            data: {
                tenantId: authReq.tenantId!,
                customerName,
                customerRuc,
                subtotal,
                tax,
                fiscalRegimeAtQuote,
                total,
                expiresAt: new Date(expiresAt),
                items: {
                    create: resolvedItems.map((item) => ({
                        productId: item.productId,
                        name: item.name,
                        price: item.price.toNumber(),
                        unitPriceExact: item.price.toFixed(4),
                        quantity: item.quantityLegacy,
                        quantityExact: item.quantityExact.toFixed(),
                        unitAtQuote: item.unit,
                        saleModeAtQuote: item.saleMode,
                        quantityStepAtQuote: item.quantityStep,
                        presentationAtQuote: item.presentationAtQuote,
                        presentationQuantityAtQuote: item.presentationQuantityAtQuote.toFixed(4),
                        ivaExentoAtQuote: item.ivaExento,
                    })),
                },
            },
            include: {
                items: {
                    orderBy: { id: 'asc' },
                },
            },
        });

        res.json({
            ...quote,
            subtotal,
            tax,
            total,
            items: serializeQuotationItemsForClient(quote.items, products),
        });
    } catch (error) {
        if (error instanceof QuotationItemError) {
            return res.status(error.code === 'PRODUCT_NOT_FOUND' ? 404 : 400).json({ error: error.message, code: error.code });
        }
        if (error instanceof QuantityValidationError) {
            return res.status(400).json({ error: error.message, code: error.code });
        }
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: error.issues.map((issue) => issue.message).join(' | ') || 'Items inválidos' });
        }
        console.error('Create quotation error:', error);
        res.status(500).json({ error: 'Error al crear cotización' });
    }
});

// ==========================================
// 💰 COBRANZA & CRÉDITOS (RECEIVABLES)
// ==========================================

// GET /api/credits/debtors - Clientes con deuda pendiente
app.get('/api/credits/debtors', authenticate, checkRole(CUSTOMER_HUB_READ_ROLES), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        // Buscar ventas a CRÉDITO con saldo pendiente > 0
        const sales = await prisma.sale.findMany({
            where: {
                tenantId: authReq.tenantId,
                paymentMethod: 'CREDIT',
                balance: { gt: 0 },
                ...receivableCustomerScope(authReq),
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
app.get('/api/collections/worklist', authenticate, checkRole(CUSTOMER_HUB_READ_ROLES), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const tenantId = authReq.tenantId!;
    const dueSoonDays = Math.min(60, Math.max(1, parseInt(req.query.dueSoonDays) || 7));
    try {
        const now = new Date();
        // Días vencidos desde la referencia (vence ?? emisión); >0 vencido, <0 por vencer.
        const diasVencido = (ref: Date) => daysSinceManaguaCivilDate(ref, now);
        const bucketDe = (d: number) => d <= 0 ? 'corriente' : d <= 30 ? 'b1_30' : d <= 60 ? 'b31_60' : d <= 90 ? 'b61_90' : 'b90';

        const sales = await prisma.sale.findMany({
            where: {
                tenantId,
                paymentMethod: 'CREDIT',
                balance: { gt: 0 },
                ...receivableCustomerScope(authReq),
            },
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

        const startOfDay = inicioDelDiaManagua(now);
        const collectedToday = await prisma.payment.aggregate({
            where: {
                sale: {
                    tenantId,
                    ...receivableCustomerScope(authReq),
                },
                createdAt: { gte: startOfDay },
            },
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
app.get('/api/customers/:id/statement', authenticate, checkRole(CUSTOMER_HUB_READ_ROLES), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const tenantId = authReq.tenantId!;
    const { id } = req.params;
    try {
        const customer = await prisma.customer.findFirst({
            where: applySellerCustomerScope(authReq, { id, tenantId }),
        });
        if (!customer) return res.status(404).json({ error: 'Cliente no encontrado' });

        const sales = await prisma.sale.findMany({
            where: {
                tenantId,
                customerId: id,
                paymentMethod: 'CREDIT',
                ...receivableCustomerScope(authReq),
            },
            include: { payments: { orderBy: { createdAt: 'asc' }, include: { user: { select: { name: true } } } } },
            orderBy: { createdAt: 'desc' },
        });

        const now = new Date();
        const diasVencido = (ref: Date) => daysSinceManaguaCivilDate(ref, now);

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

        if (authReq.role === 'VENDEDOR') {
            const stillAuthorized = await prisma.customer.findFirst({
                where: applySellerCustomerScope(authReq, { id, tenantId }),
                select: { id: true },
            });
            if (!stillAuthorized) return res.status(404).json({ error: 'Cliente no encontrado' });
        }

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
app.post(
    '/api/credits/payment',
    authenticate,
    checkRole(CUSTOMER_PAYMENT_ROLES),
    validate(CreatePaymentSchema),
    registerCreditPayment,
);

async function registerCreditPayment(req: any, res: any) {
    const authReq = req as AuthRequest;
    const { saleId, amount, clientEventId } = req.body;
    const method = req.body.method || 'CASH';
    const paymentAmount = new Decimal(amount).toDecimalPlaces(2);
    const payloadHash = clientEventId
        ? crypto.createHash('sha256').update(JSON.stringify({
            saleId,
            amount: paymentAmount.toFixed(2),
            method,
        })).digest('hex')
        : null;

    try {
        const result = await prisma.$transaction(async (tx: any) => {
            // Sale y Customer quedan bloqueados en orden estable: primero venta,
            // luego cliente. Así dos cobros de facturas distintas no pisan la
            // deuda agregada y dos cobros de la misma factura se serializan.
            const lockedSales: Array<{
                id: string;
                customerId: string | null;
                customerName: string | null;
                sellerId: string | null;
                paymentMethod: string;
                status: string;
                balance: any;
            }> = await tx.$queryRaw`
                SELECT s.id, s.customerId, s.customerName, s.paymentMethod,
                       s.status, s.balance, c.sellerId
                FROM \`Sale\` s
                LEFT JOIN \`Customer\` c ON c.id = s.customerId AND c.tenantId = s.tenantId
                WHERE s.id = ${saleId} AND s.tenantId = ${authReq.tenantId!}
                FOR UPDATE`;
            const lockedSale = lockedSales[0];
            if (!lockedSale || (authReq.role === 'VENDEDOR' && lockedSale.sellerId !== authReq.userId)) {
                throw new Error('PAYMENT_SALE_NOT_FOUND');
            }

            if (clientEventId) {
                const replay = await tx.payment.findFirst({
                    where: { saleId, clientEventId },
                });
                if (replay) {
                    if (!replay.payloadHash || replay.payloadHash !== payloadHash) {
                        throw new Error('PAYMENT_IDEMPOTENCY_CONFLICT');
                    }
                    return { replayed: true, paymentId: replay.id };
                }
            }

            if (lockedSale.paymentMethod !== 'CREDIT') throw new Error('PAYMENT_NOT_CREDIT');
            const balanceBefore = new Decimal(lockedSale.balance.toString());
            if (!balanceBefore.greaterThan(0)) throw new Error('PAYMENT_ALREADY_SETTLED');
            if (paymentAmount.greaterThan(balanceBefore)) throw new Error('PAYMENT_EXCEEDS_BALANCE');

            // Un abono CASH entra físicamente en una gaveta y debe quedar en el
            // mismo libro que consume el cierre Z. El turno nunca viene del
            // cliente: se resuelve y bloquea dentro de ESTA transacción, después
            // del lock de Sale (orden global Sale -> Shift -> Customer).
            //
            // Preferimos la caja propia. Si el cobrador no tiene una, solo es
            // seguro atribuir el efectivo cuando existe exactamente una caja
            // abierta en todo el tenant; con dos, adivinar falsearía el arqueo.
            let cashShiftId: string | null = null;
            if (method === 'CASH') {
                const ownOpenShifts: Array<{ id: string }> = await tx.$queryRaw`
                    SELECT id
                    FROM \`Shift\`
                    WHERE \`tenantId\` = ${authReq.tenantId!}
                      AND \`userId\` = ${authReq.userId!}
                      AND status = 'OPEN'
                    ORDER BY startTime DESC, id ASC
                    LIMIT 2
                    FOR UPDATE`;
                if (ownOpenShifts.length > 1) {
                    throw new Error('PAYMENT_OPEN_SHIFT_AMBIGUOUS');
                }
                cashShiftId = ownOpenShifts[0]?.id ?? null;

                if (!cashShiftId) {
                    const tenantOpenShifts: Array<{ id: string }> = await tx.$queryRaw`
                        SELECT id
                        FROM \`Shift\`
                        WHERE \`tenantId\` = ${authReq.tenantId!}
                          AND status = 'OPEN'
                        ORDER BY startTime DESC, id ASC
                        LIMIT 2
                        FOR UPDATE`;
                    if (tenantOpenShifts.length > 1) {
                        throw new Error('PAYMENT_OPEN_SHIFT_AMBIGUOUS');
                    }
                    cashShiftId = tenantOpenShifts[0]?.id ?? null;
                }

                if (!cashShiftId) throw new Error('PAYMENT_OPEN_SHIFT_REQUIRED');
            }

            const balanceAfter = balanceBefore.minus(paymentAmount).toDecimalPlaces(2);
            const payment = await tx.payment.create({
                data: {
                    saleId,
                    amount: paymentAmount.toFixed(2),
                    method,
                    collectedBy: authReq.userId!,
                    clientEventId: clientEventId ?? null,
                    payloadHash,
                },
            });

            const saleUpdated = await tx.sale.updateMany({
                where: { id: saleId, tenantId: authReq.tenantId! },
                data: {
                    balance: balanceAfter.toFixed(2),
                    status: balanceAfter.isZero() ? 'PAID' : 'CREDIT_PENDING',
                },
            });
            if (saleUpdated.count !== 1) throw new Error('PAYMENT_SALE_NOT_FOUND');

            let debtBefore: Decimal | null = null;
            let debtAfter: Decimal | null = null;
            if (lockedSale.customerId) {
                const lockedCustomers: Array<{ currentDebt: any }> = await tx.$queryRaw`
                    SELECT currentDebt FROM \`Customer\`
                    WHERE id = ${lockedSale.customerId} AND tenantId = ${authReq.tenantId!}
                    FOR UPDATE`;
                if (lockedCustomers.length === 0) throw new Error('PAYMENT_CUSTOMER_NOT_FOUND');
                debtBefore = new Decimal(lockedCustomers[0].currentDebt.toString());
                debtAfter = Decimal.max(0, debtBefore.minus(paymentAmount)).toDecimalPlaces(2);
                const customerUpdated = await tx.customer.updateMany({
                    where: { id: lockedSale.customerId, tenantId: authReq.tenantId! },
                    data: { currentDebt: debtAfter.toFixed(2) },
                });
                if (customerUpdated.count !== 1) throw new Error('PAYMENT_CUSTOMER_NOT_FOUND');
            }

            // No se llama recordCashMovement: recordPayment ya postea el asiento
            // Debe Caja/Bancos -> Haber CxC. Este movimiento solo materializa la
            // entrada física para gaveta, arqueo y Reporte Z; duplicar el asiento
            // inflaría contabilidad. Al vivir en la misma tx, si falla el ledger
            // también revierten Payment, Sale.balance y Customer.currentDebt.
            let cashMovementId: string | null = null;
            if (cashShiftId) {
                const cashMovement = await appendSignedCashMovement(tx, {
                    tenantId: authReq.tenantId!,
                    shiftId: cashShiftId,
                    userId: authReq.userId!,
                    type: 'IN',
                    amount: paymentAmount.toFixed(2),
                    currency: 'NIO',
                    category: 'COBRO_CREDITO',
                    description: `Abono en efectivo ${payment.id} de venta ${saleId}`,
                    expenseId: null,
                });
                cashMovementId = cashMovement.id;
            }

            await recordPayment(
                tx,
                authReq.tenantId!,
                authReq.userId!,
                payment.id,
                paymentAmount.toNumber(),
                method,
            );
            await tx.auditLog.create({
                data: {
                    tenantId: authReq.tenantId!,
                    userId: authReq.userId!,
                    action: 'CREDIT_PAYMENT',
                    details: JSON.stringify({
                        saleId,
                        customerId: lockedSale.customerId,
                        paymentId: payment.id,
                        clientEventId: clientEventId ?? null,
                        amount: paymentAmount.toFixed(2),
                        balanceBefore: balanceBefore.toFixed(2),
                        balanceAfter: balanceAfter.toFixed(2),
                        debtBefore: debtBefore?.toFixed(2) ?? null,
                        debtAfter: debtAfter?.toFixed(2) ?? null,
                        method,
                        cashShiftId,
                        cashMovementId,
                    }),
                },
            });

            return { replayed: false, paymentId: payment.id };
        });

        const updatedSale = await prisma.sale.findFirst({
            where: { id: saleId, tenantId: authReq.tenantId! },
            include: {
                payments: { orderBy: { createdAt: 'desc' } },
                customer: { select: { name: true } },
            },
        });
        if (!updatedSale) return res.status(404).json({ error: 'Venta no encontrada' });

        res.json({
            id: updatedSale.id,
            customerName: updatedSale.customer?.name || updatedSale.customerName,
            date: updatedSale.createdAt,
            dueDate: updatedSale.dueDate,
            total: Number(updatedSale.total),
            balance: Number(updatedSale.balance),
            status: Number(updatedSale.balance) > 0 ? 'CREDIT_PENDING' : 'PAID',
            payments: updatedSale.payments.map((payment: any) => ({
                id: payment.id,
                amount: Number(payment.amount),
                date: payment.createdAt,
                method: payment.method,
            })),
            idempotentReplay: result.replayed,
            paymentId: result.paymentId,
        });
    } catch (error: any) {
        console.error('Register payment error:', error);
        if (error?.message === 'PAYMENT_SALE_NOT_FOUND' || error?.message === 'PAYMENT_CUSTOMER_NOT_FOUND') {
            return res.status(404).json({ error: 'Venta o cliente no encontrado' });
        }
        if (error?.message === 'PAYMENT_IDEMPOTENCY_CONFLICT') {
            return res.status(409).json({ error: 'La misma operación ya se usó con datos distintos', code: error.message });
        }
        if (error?.message === 'PAYMENT_OPEN_SHIFT_REQUIRED') {
            return res.status(409).json({
                error: 'Abrí una caja antes de registrar un abono en efectivo',
                code: error.message,
            });
        }
        if (error?.message === 'PAYMENT_OPEN_SHIFT_AMBIGUOUS') {
            return res.status(409).json({
                error: 'Hay varias cajas abiertas. Abrí o tomá tu propia caja antes de registrar el efectivo',
                code: error.message,
            });
        }
        if (error instanceof PeriodLockedError) {
            return res.status(423).json({ error: error.message, code: 'PERIOD_LOCKED' });
        }
        const messages: Record<string, string> = {
            PAYMENT_NOT_CREDIT: 'Solo se pueden abonar ventas a crédito',
            PAYMENT_ALREADY_SETTLED: 'Esta venta ya no tiene saldo pendiente',
            PAYMENT_EXCEEDS_BALANCE: 'El abono excede el saldo pendiente',
        };
        res.status(400).json({ error: messages[error?.message] || 'No se pudo registrar el abono' });
    }
}

// POST /api/credits/:saleId/writeoff - Castigar una venta a crédito como incobrable
// (Cobranza B1). Postea el asiento Debe 5.2.7 / Haber 1.1.3, salda la venta y baja
// la deuda del cliente. Solo OWNER/ADMIN; respeta el lock de período.
app.post('/api/credits/:saleId/writeoff', authenticate, checkRole(['OWNER', 'ADMIN', 'SUPER_ADMIN']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { saleId } = req.params;
    const reason = (req.body?.reason || '').toString().trim();
    if (reason.length < 3) {
        return res.status(400).json({ error: 'La justificación es obligatoria (mínimo 3 caracteres).' });
    }
    try {
        await seedChartOfAccounts(authReq.tenantId!); // garantiza 5.2.7

        const result = await prisma.$transaction(async (tx: any) => {
            const lockedSales: Array<{
                id: string;
                customerId: string | null;
                paymentMethod: string;
                status: string;
                balance: any;
            }> = await tx.$queryRaw`
                SELECT id, customerId, paymentMethod, status, balance
                FROM \`Sale\`
                WHERE id = ${saleId} AND tenantId = ${authReq.tenantId!}
                FOR UPDATE`;
            const sale = lockedSales[0];
            if (!sale) throw new Error('Venta no encontrada');
            if (sale.paymentMethod !== 'CREDIT') throw new Error('Solo se castigan ventas a crédito.');
            const balance = new Decimal(sale.balance.toString());
            if (balance.lessThanOrEqualTo(0)) throw new Error('Esta venta no tiene saldo pendiente.');

            // Mantener el mismo orden global que abonos y retenciones: Sale →
            // Customer → asientos. Así dos movimientos de la misma cartera no
            // invierten locks entre el subledger y las cuentas del mayor.
            let currentDebt: Decimal | null = null;
            let newDebt: Decimal | null = null;
            if (sale.customerId) {
                const lockedCustomers: Array<{ currentDebt: any }> = await tx.$queryRaw`
                    SELECT currentDebt FROM \`Customer\`
                    WHERE id = ${sale.customerId} AND tenantId = ${authReq.tenantId!}
                    FOR UPDATE`;
                if (lockedCustomers.length === 0) throw new Error('Cliente no encontrado');
                currentDebt = new Decimal(lockedCustomers[0].currentDebt.toString());
                newDebt = Decimal.max(0, currentDebt.minus(balance)).toDecimalPlaces(2);
            }

            // Asiento de incobrable (assertPeriodOpen vive dentro de createJournalEntry).
            await recordBadDebt(tx, authReq.tenantId!, authReq.userId!, saleId, balance);

            // Saldar la venta y marcarla como incobrable.
            const saleUpdated = await tx.sale.updateMany({
                where: { id: saleId, tenantId: authReq.tenantId! },
                data: { balance: 0, status: 'UNCOLLECTIBLE' },
            });
            if (saleUpdated.count !== 1) throw new Error('Venta no encontrada');

            // Bajar la deuda del cliente (clamp a 0 por si el contador venía desfasado).
            if (sale.customerId && newDebt) {
                const customerUpdated = await tx.customer.updateMany({
                    where: { id: sale.customerId, tenantId: authReq.tenantId! },
                    data: { currentDebt: newDebt.toFixed(2) },
                });
                if (customerUpdated.count !== 1) throw new Error('Cliente no encontrado');
            }

            await tx.auditLog.create({
                data: {
                    tenantId: authReq.tenantId!,
                    userId: authReq.userId!,
                    action: 'BAD_DEBT_WRITEOFF',
                    details: JSON.stringify({
                        saleId,
                        customerId: sale.customerId,
                        amount: balance.toFixed(2),
                        reason,
                        before: {
                            sale: { status: sale.status, balance: balance.toFixed(2) },
                            customer: sale.customerId
                                ? { currentDebt: currentDebt?.toFixed(2) ?? null }
                                : null,
                        },
                        after: {
                            sale: { status: 'UNCOLLECTIBLE', balance: '0.00' },
                            customer: sale.customerId
                                ? { currentDebt: newDebt?.toFixed(2) ?? null }
                                : null,
                        },
                        timestamp: new Date().toISOString(),
                    }),
                },
            });

            return { amount: balance.toDecimalPlaces(2).toNumber() };
        });

        res.json({ message: `Venta castigada como incobrable. Pérdida reconocida: C$ ${result.amount.toFixed(2)}`, ...result });
    } catch (error: any) {
        console.error('Error castigando incobrable:', error);
        const msg = error?.message || 'Error castigando la venta';
        const code = error instanceof PeriodLockedError ? 423
            : (msg.includes('no encontrada') || msg.includes('no encontrado')) ? 404
            : (msg.includes('crédito') || msg.includes('saldo')) ? 400 : 500;
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

// Configuración fiscal efectiva para POS/cotizaciones. El tenant siempre sale
// del JWT; un cajero puede leerla porque la necesita para emitir el documento,
// pero solo dueño/administrador puede cambiarla.
app.get('/api/tenant/fiscal-settings', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const tenant = await prisma.tenant.findUnique({
            where: { id: authReq.tenantId! },
            select: { fiscalRegime: true, fiscalRegimeVersion: true },
        });
        if (!tenant) return res.status(404).json({ error: 'Negocio no encontrado' });
        res.setHeader('Cache-Control', 'private, no-store, max-age=0');
        return res.json({
            fiscalRegime: normalizeFiscalRegime(tenant.fiscalRegime),
            fiscalRegimeVersion: tenant.fiscalRegimeVersion,
        });
    } catch (error) {
        console.error('Error al leer configuración fiscal:', error);
        return res.status(500).json({ error: 'Error al leer configuración fiscal' });
    }
});

// Configurar datos fiscales del Tenant. El cambio de régimen y su auditoría
// confirman en la misma transacción; la versión solo avanza cuando cambia la
// regla que afectará ventas futuras.
app.put('/api/tenant/fiscal', authenticate, checkRole(['ADMIN', 'OWNER']), validate(UpdateFiscalSettingsSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { taxId, address, phone, dgiAuthCode, fiscalRegime } = req.body;

    try {
        const tenant = await prisma.$transaction(async (tx) => {
            const before = await tx.tenant.findUnique({
                where: { id: authReq.tenantId! },
                select: {
                    id: true,
                    taxId: true,
                    address: true,
                    phone: true,
                    dgiAuthCode: true,
                    fiscalRegime: true,
                    fiscalRegimeVersion: true,
                },
            });
            if (!before) return null;

            const nextRegime = fiscalRegime === undefined
                ? normalizeFiscalRegime(before.fiscalRegime)
                : normalizeFiscalRegime(fiscalRegime);
            const regimeChanged = nextRegime !== normalizeFiscalRegime(before.fiscalRegime);
            const data: Record<string, unknown> = {
                ...(taxId !== undefined ? { taxId: taxId || null } : {}),
                ...(address !== undefined ? { address: address || null } : {}),
                ...(phone !== undefined ? { phone: phone || null } : {}),
                ...(dgiAuthCode !== undefined ? { dgiAuthCode: dgiAuthCode || null } : {}),
                ...(fiscalRegime !== undefined ? { fiscalRegime: nextRegime } : {}),
                ...(regimeChanged ? { fiscalRegimeVersion: { increment: 1 } } : {}),
            };

            const updated = await tx.tenant.update({
                where: { id: before.id },
                data,
            });
            const changedFields = [
                taxId !== undefined ? 'taxId' : null,
                address !== undefined ? 'address' : null,
                phone !== undefined ? 'phone' : null,
                dgiAuthCode !== undefined ? 'dgiAuthCode' : null,
                fiscalRegime !== undefined ? 'fiscalRegime' : null,
            ].filter((field): field is string => field !== null);
            await tx.auditLog.create({
                data: {
                    tenantId: before.id,
                    userId: authReq.userId!,
                    action: 'FISCAL_SETTINGS_UPDATED',
                    details: JSON.stringify({
                        changedFields,
                        before: {
                            fiscalRegime: normalizeFiscalRegime(before.fiscalRegime),
                            fiscalRegimeVersion: before.fiscalRegimeVersion,
                        },
                        after: {
                            fiscalRegime: normalizeFiscalRegime(updated.fiscalRegime),
                            fiscalRegimeVersion: updated.fiscalRegimeVersion,
                        },
                    }),
                },
            });
            return updated;
        });
        if (!tenant) return res.status(404).json({ error: 'Negocio no encontrado' });
        res.json(tenant);
    } catch (error: any) {
        if (error?.code === 'P2002') {
            return res.status(409).json({ error: 'El RUC ya está registrado' });
        }
        console.error('Error al actualizar configuración fiscal:', error);
        res.status(500).json({ error: 'Error al actualizar configuración fiscal' });
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

// GET /api/tenant/cashier-settings — ¿este negocio exige PIN para abrir caja?
//
// Sin `checkRole`, mismo criterio que inventory-settings: el CAJERO es quien
// necesita el dato, porque de él depende si la pantalla de apertura le pide un
// PIN o no. Si el POS tuviera que adivinarlo, o mostraría un campo que no hace
// falta (la fricción que este cambio saca) o lo escondería en el negocio que sí
// lo exige, y el backend rechazaría la apertura sin que el cajero entienda por
// qué. Solo lectura, tenant del JWT.
app.get('/api/tenant/cashier-settings', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const tenant = await prisma.tenant.findUnique({
            where: { id: authReq.tenantId! },
            select: { requireCashierPin: true },
        });
        if (!tenant) return res.status(404).json({ error: 'Negocio no encontrado' });
        res.json({ requireCashierPin: tenant.requireCashierPin });
    } catch (error: any) {
        console.error('Error al leer configuración de caja:', error);
        res.status(500).json({ error: 'Error al leer configuración de caja' });
    }
});

// PUT /api/tenant/cashier-settings — prender/apagar el PIN obligatorio.
// Solo OWNER/ADMIN: es una política del negocio, no una preferencia del cajero
// (si el cajero pudiera apagarla, la protección no protegería de nada).
app.put('/api/tenant/cashier-settings', authenticate, checkRole(['ADMIN', 'OWNER']), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { requireCashierPin } = req.body;
    if (typeof requireCashierPin !== 'boolean') {
        return res.status(400).json({ error: 'requireCashierPin debe ser booleano (true/false)' });
    }
    try {
        const tenant = await prisma.tenant.update({
            where: { id: authReq.tenantId! },
            data: { requireCashierPin },
            select: { id: true, requireCashierPin: true },
        });
        // Queda en auditoría: apagar el PIN afloja quién responde por un
        // faltante del arqueo, así que tiene que saberse quién lo apagó y cuándo.
        await prisma.auditLog.create({
            data: {
                tenantId: authReq.tenantId!,
                userId: authReq.userId!,
                action: 'CASHIER_SETTINGS_UPDATED',
                details: JSON.stringify({ requireCashierPin }),
            },
        });
        res.json({ success: true, data: tenant });
    } catch (error: any) {
        res.status(500).json({ error: 'Error al actualizar configuración de caja', details: error.message });
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
app.get('/api/accounting/balance-general', authenticate, checkRole(ACCOUNTING_READ_ROLES), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const balance = await getBalanceGeneral(authReq.tenantId!);
        res.json(balance);
    } catch (error) { res.status(500).json({ error: 'Error generating Balance General' }); }
});

// Estado de Resultados
app.get('/api/accounting/estado-resultados', authenticate, checkRole(ACCOUNTING_READ_ROLES), async (req: any, res: any) => {
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
app.get('/api/accounting/chart', authenticate, checkRole(ACCOUNTING_READ_ROLES), async (req: any, res: any) => {
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
app.get('/api/accounting/journal', authenticate, checkRole(ACCOUNTING_READ_ROLES), async (req: any, res: any) => {
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
app.get('/api/accounting/libro-diario/:year/:month', authenticate, checkRole(ACCOUNTING_READ_ROLES), async (req: any, res: any) => {
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
app.get('/api/accounting/libro-mayor/:year/:month', authenticate, checkRole(ACCOUNTING_READ_ROLES), async (req: any, res: any) => {
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
app.get('/api/accounting/periods', authenticate, checkRole(ACCOUNTING_READ_ROLES), async (req: any, res: any) => {
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
app.get('/api/accounting/tax-config', authenticate, checkRole(ACCOUNTING_READ_ROLES), async (req: any, res: any) => {
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
        const day = fecha ? parseManaguaCivilDateInput(fecha) : managuaBusinessDate();
        if (!day) return res.status(400).json({ error: 'Fecha inválida.' });
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
app.post('/api/accounting/retenciones-sufridas', authenticate, checkRole(['OWNER', 'ADMIN', 'ACCOUNTANT']), validate(CreateRetencionSufridaSchema), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const {
        fecha,
        clienteRetenedor,
        tipo,
        baseAmount,
        amount,
        numeroConstancia,
        saleId,
        clientEventId,
    } = req.body;
    const day = normalizeCalendarDateInput(fecha);
    const base = new Decimal(baseAmount);
    const amt = new Decimal(amount);
    const payloadHash = crypto.createHash('sha256').update(JSON.stringify({
        fecha,
        clienteRetenedor,
        tipo,
        baseAmount: base.toFixed(2),
        amount: amt.toFixed(2),
        numeroConstancia: numeroConstancia ?? null,
        saleId,
    })).digest('hex');

    try {
        const result = await prisma.$transaction(async (tx: any) => {
            // La retención liquida CxC igual que un abono: se bloquea primero la
            // venta y después su cliente. Este orden estable serializa retenciones
            // simultáneas sin perder saldo ni deuda agregada.
            const lockedSales: Array<{
                id: string;
                customerId: string | null;
                paymentMethod: string;
                status: string;
                balance: any;
            }> = await tx.$queryRaw`
                SELECT id, customerId, paymentMethod, status, balance
                FROM \`Sale\`
                WHERE id = ${saleId} AND tenantId = ${authReq.tenantId!}
                FOR UPDATE`;
            const lockedSale = lockedSales[0];
            if (!lockedSale) throw new Error('RETENCION_SALE_NOT_FOUND');
            if (!lockedSale.customerId) throw new Error('RETENCION_CUSTOMER_NOT_FOUND');

            const lockedCustomers: Array<{
                id: string;
                name: string;
                currentDebt: any;
            }> = await tx.$queryRaw`
                SELECT id, name, currentDebt
                FROM \`Customer\`
                WHERE id = ${lockedSale.customerId} AND tenantId = ${authReq.tenantId!}
                FOR UPDATE`;
            const lockedCustomer = lockedCustomers[0];
            if (!lockedCustomer) throw new Error('RETENCION_CUSTOMER_NOT_FOUND');

            // Debe ocurrir después de ambos locks: una solicitud gemela que
            // esperaba a la ganadora observa el replay antes de revalidar saldos.
            const replay = await tx.retencionSufrida.findFirst({
                where: { tenantId: authReq.tenantId!, clientEventId },
            });
            if (replay) {
                if (!replay.payloadHash || replay.payloadHash !== payloadHash) {
                    throw new Error('RETENCION_IDEMPOTENCY_CONFLICT');
                }
                return { retencionId: replay.id, idempotentReplay: true };
            }

            if (lockedSale.paymentMethod !== 'CREDIT') throw new Error('RETENCION_SALE_NOT_CREDIT');
            const balanceBefore = new Decimal(lockedSale.balance.toString());
            if (!balanceBefore.greaterThan(0)) throw new Error('RETENCION_SALE_SETTLED');
            if (amt.greaterThan(balanceBefore)) throw new Error('RETENCION_EXCEEDS_BALANCE');

            const balanceAfter = balanceBefore.minus(amt).toDecimalPlaces(2);
            const statusAfter = balanceAfter.isZero() ? 'PAID' : 'CREDIT_PENDING';
            const debtBefore = new Decimal(lockedCustomer.currentDebt.toString());
            const debtAfter = Decimal.max(0, debtBefore.minus(amt)).toDecimalPlaces(2);

            const retencion = await tx.retencionSufrida.create({
                data: {
                    tenantId: authReq.tenantId!,
                    fecha: day,
                    clienteRetenedor,
                    tipo,
                    baseAmount: base.toFixed(2),
                    amount: amt.toFixed(2),
                    numeroConstancia: numeroConstancia ?? null,
                    saleId,
                    clientEventId,
                    payloadHash,
                    createdBy: authReq.userId!,
                },
            });

            const saleUpdated = await tx.sale.updateMany({
                where: { id: saleId, tenantId: authReq.tenantId! },
                data: { balance: balanceAfter.toFixed(2), status: statusAfter },
            });
            if (saleUpdated.count !== 1) throw new Error('RETENCION_SALE_NOT_FOUND');

            const customerUpdated = await tx.customer.updateMany({
                where: { id: lockedCustomer.id, tenantId: authReq.tenantId! },
                data: { currentDebt: debtAfter.toFixed(2) },
            });
            if (customerUpdated.count !== 1) throw new Error('RETENCION_CUSTOMER_NOT_FOUND');

            // Asiento: el crédito fiscal (activo) sube; la CxC del cliente baja
            // (el cliente liquidó parte del saldo vía retención).
            await createJournalEntry(
                tx, authReq.tenantId!,
                `Retención ${tipo === 'IR_2' ? 'IR 2%' : 'IMI 1%'} sufrida — ${clienteRetenedor}`,
                retencion.id, 'RETENCION_SUFRIDA', authReq.userId!,
                [
                    { accountCode: '1.1.6', debit: amt.toNumber(), credit: 0 },
                    { accountCode: '1.1.3', debit: 0, credit: amt.toNumber() },
                ],
                { isAutomatic: true, date: day }
            );

            await tx.auditLog.create({
                data: {
                    tenantId: authReq.tenantId!,
                    userId: authReq.userId!,
                    action: 'RETENCION_SUFRIDA_CREATE',
                    details: JSON.stringify({
                        retencionId: retencion.id,
                        clientEventId,
                        before: {
                            sale: {
                                id: lockedSale.id,
                                paymentMethod: lockedSale.paymentMethod,
                                status: lockedSale.status,
                                balance: balanceBefore.toFixed(2),
                            },
                            customer: {
                                id: lockedCustomer.id,
                                name: lockedCustomer.name,
                                currentDebt: debtBefore.toFixed(2),
                            },
                        },
                        after: {
                            retencionId: retencion.id,
                            fecha,
                            clienteRetenedor,
                            tipo,
                            baseAmount: base.toFixed(2),
                            amount: amt.toFixed(2),
                            numeroConstancia: numeroConstancia ?? null,
                            sale: {
                                id: lockedSale.id,
                                status: statusAfter,
                                balance: balanceAfter.toFixed(2),
                            },
                            customer: {
                                id: lockedCustomer.id,
                                currentDebt: debtAfter.toFixed(2),
                            },
                        },
                    }),
                },
            });

            return { retencionId: retencion.id, idempotentReplay: false };
        });

        return res.status(result.idempotentReplay ? 200 : 201).json({
            message: result.idempotentReplay
                ? 'La retención ya estaba registrada; no se duplicó el crédito fiscal.'
                : 'Retención sufrida registrada — se acreditará contra tu anticipo IR del mes.',
            id: result.retencionId,
            idempotentReplay: result.idempotentReplay,
        });
    } catch (error: any) {
        // Dos transacciones pueden observar una clave ausente. El UNIQUE arbitra
        // la carrera y revierte por completo asiento + auditoría del perdedor.
        if (error?.code === 'P2002' && clientEventId) {
            try {
                const replay = await prisma.retencionSufrida.findFirst({
                    where: { tenantId: authReq.tenantId!, clientEventId },
                });
                if (replay) {
                    if (!replay.payloadHash || replay.payloadHash !== payloadHash) {
                        return res.status(409).json({
                            error: 'La misma operación ya se usó con datos distintos.',
                            code: 'RETENCION_IDEMPOTENCY_CONFLICT',
                        });
                    }
                    return res.status(200).json({
                        message: 'La retención ya estaba registrada; no se duplicó el crédito fiscal.',
                        id: replay.id,
                        idempotentReplay: true,
                    });
                }
            } catch (lookupError) {
                console.error('Retención sufrida replay lookup error:', lookupError);
                return res.status(500).json({ error: 'Error al comprobar el reintento de la retención.' });
            }
        }
        if (error?.message === 'RETENCION_IDEMPOTENCY_CONFLICT') {
            return res.status(409).json({
                error: 'La misma operación ya se usó con datos distintos.',
                code: error.message,
            });
        }
        if (error?.message === 'RETENCION_SALE_NOT_FOUND' || error?.message === 'RETENCION_CUSTOMER_NOT_FOUND') {
            return res.status(404).json({
                error: 'La venta o su cliente no existe en este negocio.',
                code: error.message,
            });
        }
        const businessErrors: Record<string, string> = {
            RETENCION_SALE_NOT_CREDIT: 'La factura seleccionada no es una venta a crédito.',
            RETENCION_SALE_SETTLED: 'La factura seleccionada ya no tiene saldo pendiente.',
            RETENCION_EXCEEDS_BALANCE: 'La retención excede el saldo pendiente de la factura.',
        };
        if (businessErrors[error?.message]) {
            return res.status(400).json({ error: businessErrors[error.message], code: error.message });
        }
        if (error instanceof PeriodLockedError) {
            return res.status(409).json({ error: error.message, code: 'PERIOD_LOCKED' });
        }
        console.error('Retención sufrida error:', error);
        res.status(500).json({ error: 'Error al registrar la retención.' });
    }
});

app.get('/api/accounting/retenciones-sufridas', authenticate, checkRole(ACCOUNTING_READ_ROLES), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const where: any = { tenantId: authReq.tenantId! };
        const fiscalPeriod = parseFiscalPeriod(req.query.month, req.query.year);
        if ((req.query.month != null || req.query.year != null) && !fiscalPeriod) {
            return res.status(400).json({ error: 'Periodo inválido. Usa month=1-12 y year=YYYY.' });
        }
        if (fiscalPeriod) {
            const start = normalizeCalendarDateInput(
                `${fiscalPeriod.year}-${String(fiscalPeriod.month).padStart(2, '0')}-01`,
            );
            const nextMonth = fiscalPeriod.month === 12
                ? { year: fiscalPeriod.year + 1, month: 1 }
                : { year: fiscalPeriod.year, month: fiscalPeriod.month + 1 };
            const endExclusive = normalizeCalendarDateInput(
                `${nextMonth.year}-${String(nextMonth.month).padStart(2, '0')}-01`,
            );
            where.fecha = { gte: start, lt: endExclusive };
        }
        const items = await prisma.retencionSufrida.findMany({ where, orderBy: { fecha: 'desc' }, take: 200 });
        res.json({ retenciones: items.map(r => ({ ...r, baseAmount: Number(r.baseAmount), amount: Number(r.amount) })) });
    } catch { res.status(500).json({ error: 'Error al listar las retenciones.' }); }
});

// ── B2 — Activos fijos + depreciación ───────────────────────────────────────

// GET lista (con valor en libros)
app.get('/api/accounting/fixed-assets', authenticate, checkRole(ACCOUNTING_READ_ROLES), async (req: any, res: any) => {
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
        const fecha = fechaAdquisicion
            ? parseManaguaCivilDateInput(fechaAdquisicion)
            : managuaBusinessDate();
        if (!fecha) return res.status(400).json({ error: 'Fecha inválida.' });
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
app.get('/api/fiscal/renta-anual/:year', authenticate, checkRole(ACCOUNTING_READ_ROLES), async (req: any, res: any) => {
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

app.get('/api/accounting/cierre-mensual/:year/:month', authenticate, checkRole(ACCOUNTING_READ_ROLES), async (req: any, res: any) => {
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
app.get('/api/accounting/aging', authenticate, checkRole(ACCOUNTING_READ_ROLES), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const tenantId = authReq.tenantId!;
    try {
        type BucketKey = 'corriente' | 'b1_30' | 'b31_60' | 'b61_90' | 'b90';
        interface Factura { id: string; numero: string | null; fecha: Date; vence: Date | null; monto: number; saldo: number; dias: number; bucket: BucketKey; }
        interface EntAcc { id: string; nombre: string; telefono: string | null; buckets: Record<BucketKey, Decimal>; total: Decimal; vencido: Decimal; facturas: Factura[]; }
        interface RawItem { id: string; entidadId: string; entidadNombre: string; telefono: string | null; numero: string | null; fecha: Date; vence: Date | null; monto: number; saldo: Decimal; }

        const now = new Date();
        const hoy = managuaBusinessDate(now);

        // Días vencidos desde la fecha de referencia (vence ?? fecha de emisión).
        const diasVencido = (ref: Date) => daysSinceManaguaCivilDate(ref, now);
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
            where: {
                tenantId,
                documentStatus: 'POSTED',
                status: { in: [...PURCHASE_PAYABLE_STATUSES] },
                paymentMethod: { not: 'NORTEX_CAPITAL' },
            },
            include: { supplier: { select: { name: true, phone: true } } },
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
            telefono: p.supplier?.phone ?? null,
            numero: p.invoiceNumber,
            fecha: p.date,
            vence: p.dueDate,
            monto: new Decimal(p.total.toString()).toDecimalPlaces(2).toNumber(),
            saldo: resolveEffectiveSupplierBalance(p),
        })));

        res.json({ asOf: hoy, cxc, cxp });
    } catch (error) {
        if (error instanceof PayableSupplierPaymentError) {
            return res.status(error.httpStatus).json({ error: error.message, code: error.code });
        }
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
app.get('/api/accounting/flujo-efectivo/:year/:month', authenticate, checkRole(ACCOUNTING_READ_ROLES), async (req: any, res: any) => {
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
                unit: true, saleMode: true, quantityStep: true,
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
            const target = new Decimal(maxStock > 0 ? maxStock : (vpd > 0 ? vpd * 15 : reorderPoint * 2));
            const rawSuggested = Decimal.max(target.minus(new Decimal(stock)), 0);
            const quantityRules = quantityRulesForProduct(p);
            let step: Decimal;
            try {
                step = new Decimal(quantityRules.quantityStep);
                if (!step.isFinite() || !step.greaterThan(0) || step.decimalPlaces() > 4) throw new Error('invalid step');
                if (quantityRules.saleMode === 'COUNTED' && !step.isInteger()) throw new Error('invalid counted step');
            } catch {
                // Catálogo legado mal configurado no debe romper toda la lista;
                // el endpoint de OC vuelve a validar autoritativamente y lo
                // rechazará hasta corregir el producto.
                step = new Decimal(quantityRules.saleMode === 'COUNTED' ? 1 : '0.0001');
            }
            const suggestedQtyDecimal = rawSuggested.isZero()
                ? new Decimal(0)
                : rawSuggested.div(step).ceil().mul(step).toDecimalPlaces(4);
            const suggestedQty = suggestedQtyDecimal.toNumber();
            const cost = Number(p.cost) || 0;

            items.push({
                productId: p.id,
                name: p.name,
                sku: p.sku,
                category: p.category,
                unit: p.unit,
                saleMode: p.saleMode,
                quantityStep: p.quantityStep?.toString() ?? null,
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
app.post(
    '/api/capital/finance-purchase',
    authenticate,
    checkRole(['OWNER', 'ADMIN', 'SUPER_ADMIN']),
    (_req: any, res: any) => {
    // El flujo heredado creaba deuda y asiento de inventario sin recepción,
    // lotes, Kardex ni existencias físicas. Se mantiene fail-closed hasta que
    // Capital financie una OC y pase por el mismo workflow de recepción.
    return res.status(409).json({
        error: 'Las compras financiadas requieren una orden de compra y recepción de inventario.',
        code: 'CAPITAL_PURCHASE_REQUIRES_RECEIPT_WORKFLOW',
    });
    },
);

// ==========================================
// 📊 SALUD FINANCIERA & AUDITORÍA FORENSE
// ==========================================

// GET /api/financial-health — Dashboard de salud financiera del tenant
app.get('/api/financial-health', authenticate, checkRole(ACCOUNTING_READ_ROLES), async (req: any, res: any) => {
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
        const result = await prisma.$transaction((tx: any) =>
            generateRetentions(authReq.tenantId!, month, year, tx));
        res.json(result);
    } catch (error) {
        console.error('Generate retentions error:', error);
        if (error instanceof PeriodLockedError) {
            return res.status(409).json({ error: error.message, code: 'PERIOD_LOCKED' });
        }
        res.status(500).json({ error: 'Error al generar retenciones' });
    }
});

// GET /api/accounting/retentions/:period — Consultar retenciones de un periodo
app.get('/api/accounting/retentions/:period', authenticate, checkRole(ACCOUNTING_READ_ROLES), async (req: any, res: any) => {
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
        if (error instanceof PeriodLockedError) {
            return res.status(409).json({ error: error.message, code: 'PERIOD_LOCKED' });
        }
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
const publicCatalogLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    // La búsqueda se ejecuta con debounce desde el catálogo. Este techo cubre
    // más de 5,000 productos a 48 por página y búsquedas normales, a la vez que
    // acota la amplificación de las tres consultas por request. Sigue siendo
    // MemoryStore/per-proceso (SCALING_AUDIT A1).
    max: 120,
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
// 🔒 AUDITORÍA: Solo expone datos comerciales públicos y reglas de cantidad.
// JAMÁS: cost, stock, tenantId, createdBy, sku, minStock
app.get('/api/public/catalog/:slug', publicCatalogLimiter, async (req: any, res: any) => {
    const { slug } = req.params;
    const parsedQuery = PublicCatalogQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
        return res.status(400).json({
            error: 'Parámetros del catálogo inválidos',
            details: parsedQuery.error.flatten().fieldErrors,
        });
    }
    const { page, pageSize, search, category } = parsedQuery.data;

    try {
        const tenant = await prisma.tenant.findUnique({
            where: { slug },
            select: { id: true, businessName: true, slug: true, phone: true }
        });

        if (!tenant) {
            return res.status(404).json({ error: 'Negocio no encontrado' });
        }

        // El tenant siempre deriva del slug resuelto server-side. Búsqueda y
        // categoría solo estrechan ese scope; nunca aceptan tenantId del cliente.
        const where: any = { tenantId: tenant.id, isPublished: true };
        const filters: any[] = [];
        if (search) {
            filters.push({
                OR: [
                    { name: { contains: search } },
                    { description: { contains: search } },
                ],
            });
        }
        if (category === 'Otros') {
            filters.push({ OR: [{ category: null }, { category: '' }, { category: 'Otros' }] });
        } else if (category) {
            filters.push({ category });
        }
        if (filters.length > 0) where.AND = filters;

        // 🔒 BLINDAJE: select explícito — NUNCA usar findMany sin select en endpoint público.
        // Las categorías se agregan sobre TODO el catálogo publicado; total sí
        // corresponde a los filtros vigentes para que la paginación sea exacta.
        const [products, total, categoryRows] = await prisma.$transaction([
            prisma.product.findMany({
                where,
                select: {
                    id: true, name: true, price: true, description: true,
                    imageUrl: true, category: true, unit: true,
                    saleMode: true, quantityStep: true,
                    packUnit: true, packSize: true, packPrice: true,
                },
                orderBy: [{ name: 'asc' }, { id: 'asc' }],
                skip: (page - 1) * pageSize,
                take: pageSize,
            }),
            prisma.product.count({ where }),
            prisma.product.findMany({
                where: { tenantId: tenant.id, isPublished: true },
                select: { category: true },
                distinct: ['category'],
                orderBy: { category: 'asc' },
                // Una interfaz de filtros no es operable con cientos de
                // categorías; el límite también evita otro listado Product
                // sin cota en este endpoint público.
                take: 500,
            }),
        ]);

        const categories = Array.from(new Set(categoryRows.map((row: { category: string | null }) => (
            row.category?.trim() || 'Otros'
        )))).sort((a, b) => a.localeCompare(b, 'es'));

        res.json({
            business: {
                name: tenant.businessName,
                slug: tenant.slug,
                phone: tenant.phone,
            },
            products,
            pagination: {
                page,
                pageSize,
                total,
                totalPages: Math.ceil(total / pageSize),
            },
            categories,
            // Solo anuncia construcción cuando no existe ningún producto publicado;
            // un filtro sin coincidencias no debe ocultar que el catálogo sí existe.
            message: categoryRows.length === 0 ? 'Catálogo en construcción.' : undefined,
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
    slug: z.string().trim().min(1, 'slug requerido').max(191),
    customerName: z.string().trim().min(1, 'Nombre requerido').max(200),
    customerPhone: z.string().trim().max(20).optional(),
    items: z.array(z.object({
        productId: z.string().trim().min(1).max(191),
        quantity: z.union([z.string().trim().min(1).max(64), z.number().finite()]),
        presentation: z.enum(['BASE', 'PACK']).optional(),
        // Compatibilidad del cliente anterior: se aceptan y descartan; nombre y
        // precio autoritativos siempre salen de Product.
        name: z.string().max(255).optional(),
        price: z.union([z.string(), z.number()]).optional(),
    }).strict()).min(1, 'Se requiere al menos 1 producto').max(50, 'Máximo 50 productos por pedido'),
}).strict();

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
        const created = await prisma.$transaction(async (tx) => {
            const tenant = await tx.tenant.findUnique({ where: { slug }, select: { id: true } });
            if (!tenant) {
                throw new PublicOrderItemError('PRODUCT_NOT_FOUND', 'Negocio no encontrado', 404);
            }
            const productIds = [...new Set(items.map((item) => item.productId))];
            const productsDB: PublicOrderProductAuthority[] = await tx.product.findMany({
                where: { tenantId: tenant.id, id: { in: productIds }, isPublished: true },
                select: {
                    id: true, tenantId: true, isPublished: true, name: true, unit: true,
                    price: true, cost: true, ivaExento: true, saleMode: true, quantityStep: true,
                    wholesalePrice: true, wholesaleMinQty: true, packUnit: true, packSize: true,
                    packPrice: true, requiresBatchTracking: true,
                },
            });
            const resolvedItems = resolvePublicOrderItems(
                tenant.id,
                items.map((item) => ({
                    productId: item.productId,
                    quantity: item.quantity,
                    presentation: item.presentation,
                })),
                productsDB,
            );
            const productsById = new Map(productsDB.map((product) => [product.id, product]));
            const confirmationItems = resolvedItems.map((item) => {
                const product = productsById.get(item.productId);
                const presentationUnit = item.presentationAtSale === 'PACK'
                    ? product?.packUnit?.trim()
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
            const total = resolvedItems.reduce(
                (sum, item) => sum.plus(item.subtotal),
                new Decimal(0),
            ).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
            const order = await tx.publicOrder.create({
                data: {
                    tenantId: tenant.id,
                    customerName: customerName.substring(0, 200),
                    customerPhone: customerPhone ? String(customerPhone).replace(/\D/g, '').substring(0, 15) : null,
                    items: resolvedItems.map((item) => ({
                        productId: item.productId,
                        name: item.productName,
                        quantity: item.quantityExact.toFixed(),
                        quantityExact: item.quantityExact.toFixed(),
                        price: Number(item.unitPrice.toFixed(2)),
                        unitPriceExact: item.unitPrice.toFixed(4),
                        subtotal: item.subtotal.toFixed(2),
                        unit: item.unit,
                        saleMode: item.saleMode,
                        quantityStep: item.quantityStep,
                        ivaExento: item.ivaExento,
                        presentationAtSale: item.presentationAtSale,
                        presentationQuantityAtSale: item.presentationQuantityAtSale.toFixed(),
                    })),
                },
            });
            return { order, total, confirmationItems };
        });

        res.json({
            message: '¡Pedido enviado! El negocio lo revisará pronto.',
            orderId: created.order.id,
            total: created.total.toNumber(),
            // El cliente confirma/manda por WhatsApp exclusivamente este
            // snapshot ya validado; nunca reusa nombres o precios cacheados.
            items: created.confirmationItems,
        });

    } catch (error) {
        if (error instanceof PublicOrderItemError) {
            return res.status(error.httpStatus).json({ error: error.message, code: error.code });
        }
        console.error('Public order error:', error);
        res.status(500).json({ error: 'Error al crear pedido' });
    }
});

// GET /api/public-orders — Pedidos web del tenant (requiere JWT)
app.get('/api/public-orders', authenticate, checkRole(QUOTATION_READ_ROLES), async (req: any, res: any) => {
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
app.patch('/api/public-orders/:id/convert', authenticate, checkRole(QUOTATION_WRITE_ROLES), async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { id } = req.params;

    try {
        const outcome = await prisma.$transaction(async (tx: any) => {
            const order = await tx.publicOrder.findFirst({
                where: { id, tenantId: authReq.tenantId! },
            });
            if (!order) {
                throw new PublicOrderItemError('PRODUCT_NOT_FOUND', 'Pedido no encontrado', 404);
            }

            // Claim condicional dentro de la misma tx: dos clicks/reintentos no
            // pueden crear dos cotizaciones para el mismo pedido.
            const claimed = await tx.publicOrder.updateMany({
                where: { id, tenantId: authReq.tenantId!, status: { not: 'CONVERTED' } },
                data: { status: 'CONVERTED' },
            });
            if (claimed.count !== 1) {
                throw new PublicOrderItemError(
                    'INVALID_QUANTITY',
                    'Este pedido ya fue convertido',
                    409,
                );
            }

            const items = publicOrderItemsForQuotation(order.items);
            const tenantFiscal = await tx.tenant.findUnique({
                where: { id: authReq.tenantId! },
                select: { fiscalRegime: true },
            });
            if (!tenantFiscal) {
                throw new PublicOrderItemError('PRODUCT_NOT_FOUND', 'Negocio no encontrado', 404);
            }
            const fiscalRegimeAtQuote = normalizeFiscalRegime(tenantFiscal.fiscalRegime);
            // Los precios públicos ya incluyen IVA: desglosar línea por línea
            // usando la clasificación congelada evita gravar productos exentos.
            let subtotalD = new Decimal(0);
            let taxD = new Decimal(0);
            let totalD = new Decimal(0);
            for (const item of items) {
                totalD = totalD.plus(item.lineTotal);
                if (item.ivaExento) {
                    subtotalD = subtotalD.plus(item.lineTotal);
                } else {
                    const { neto, iva } = desglosarIvaIncluido(item.lineTotal);
                    subtotalD = subtotalD.plus(neto);
                    taxD = taxD.plus(iva);
                }
            }
            const cuotaFija = fiscalRegimeAtQuote === FISCAL_REGIME_CUOTA_FIJA;
            const subtotal = (cuotaFija ? totalD : subtotalD)
                .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
                .toNumber();
            const tax = cuotaFija ? 0 : taxD.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
            const total = totalD.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
            const quotation = await tx.quotation.create({
                data: {
                    tenantId: authReq.tenantId!,
                    customerName: order.customerName,
                    customerRuc: null,
                    subtotal,
                    tax,
                    fiscalRegimeAtQuote,
                    total,
                    expiresAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
                    items: {
                        create: items.map((item) => ({
                            productId: item.productId,
                            name: item.name,
                            price: item.priceLegacy.toFixed(2),
                            unitPriceExact: item.unitPriceExact.toFixed(4),
                            quantity: item.quantityLegacy,
                            quantityExact: item.quantityExact.toFixed(4),
                            unitAtQuote: item.unit,
                            saleModeAtQuote: item.saleMode,
                            quantityStepAtQuote: item.quantityStep.toFixed(4),
                            presentationAtQuote: item.presentationAtQuote,
                            presentationQuantityAtQuote: item.presentationQuantityAtQuote.toFixed(4),
                            ivaExentoAtQuote: item.ivaExento,
                        })),
                    },
                },
            });
            return { quotation, subtotal, tax, total };
        });

        res.json({
            message: 'Pedido convertido en cotización exitosamente',
            quotation: {
                ...outcome.quotation,
                subtotal: outcome.subtotal,
                tax: outcome.tax,
                total: outcome.total,
            },
        });

    } catch (error) {
        if (error instanceof PublicOrderItemError) {
            return res.status(error.httpStatus).json({ error: error.message, code: error.code });
        }
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
            where: {
                ...fiscalPurchaseScope(authReq.tenantId!, purchaseId),
                documentStatus: 'POSTED',
            },
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
        const printNonce = crypto.randomBytes(18).toString('base64url');
        const previewCsp = fiscalPreviewCsp(printNonce);

        // Todos estos campos son persistidos y algunos pueden ser capturados por
        // MANAGER. La constancia se abre como HTML autenticado en un `blob:`;
        // por eso jamás se interpolan sin codificación, aunque el dato pertenezca
        // al mismo tenant.
        const safe = {
            numeroConstancia: escapeHtml(numeroConstancia),
            period: escapeHtml(period),
            fecha: escapeHtml(fecha),
            tenantBusinessName: escapeHtml(tenant.businessName),
            tenantTaxId: escapeHtml(tenant.taxId || 'Por configurar'),
            tenantAddress: escapeHtml(tenant.address || 'Por configurar'),
            tenantPhone: escapeHtml(tenant.phone || '---'),
            tenantDgiAuthCode: escapeHtml(tenant.dgiAuthCode || ''),
            supplierName: escapeHtml(purchase.supplier.name),
            supplierRuc: escapeHtml((purchase.supplier as any).ruc || 'Por registrar'),
            supplierPhone: escapeHtml((purchase.supplier as any).phone || '---'),
            invoiceNumber: escapeHtml(purchase.invoiceNumber),
        };

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

        const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(previewCsp)}">
<title>Constancia de Retención ${safe.numeroConstancia}</title>
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
  <button id="print-document" type="button" style="background:white;color:#1a56a0;border:none;padding:6px 16px;border-radius:4px;font-weight:bold;cursor:pointer;">🖨️ Imprimir / Guardar PDF</button>
</div>

<div class="header">
  <h1>Constancia de Retención en la Fuente</h1>
  <h2>República de Nicaragua — Dirección General de Ingresos (DGI)</h2>
  <div class="numero">N° ${safe.numeroConstancia}</div>
  <div class="badge">Período: ${safe.period}</div>
</div>

<div class="section">
  <div class="section-title">Agente Retenedor (Quien retiene)</div>
  <div class="grid">
    <div class="field"><label>Razón Social</label><span>${safe.tenantBusinessName}</span></div>
    <div class="field"><label>RUC / Cédula</label><span>${safe.tenantTaxId}</span></div>
    <div class="field"><label>Dirección Fiscal</label><span>${safe.tenantAddress}</span></div>
    <div class="field"><label>Teléfono</label><span>${safe.tenantPhone}</span></div>
    ${tenant.dgiAuthCode ? `<div class="field"><label>Código Autorización DGI</label><span>${safe.tenantDgiAuthCode}</span></div>` : ''}
  </div>
</div>

<div class="section">
  <div class="section-title">Sujeto Retenido (Proveedor)</div>
  <div class="grid">
    <div class="field"><label>Razón Social / Nombre</label><span>${safe.supplierName}</span></div>
    <div class="field"><label>RUC / Cédula</label><span>${safe.supplierRuc}</span></div>
    <div class="field"><label>Teléfono</label><span>${safe.supplierPhone}</span></div>
    <div class="field"><label>N° Factura del Proveedor</label><span>${safe.invoiceNumber}</span></div>
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
    <div class="field"><label>Fecha de Emisión</label><span>${safe.fecha}</span></div>
    <div class="field"><label>Monto Total Factura</label><span>C$ ${escapeHtml(Number(purchase.total).toFixed(2))}</span></div>
    <div class="field"><label>Neto a Pagar al Proveedor</label><span style="color:#1a56a0;font-size:13px;">C$ ${escapeHtml(new Decimal(purchase.total.toString()).minus(totalRetenido).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2))}</span></div>
  </div>
</div>

<div class="footer">
  <div class="firma">
    <p>_________________________________</p>
    <p><strong>Firma y Sello del Agente Retenedor</strong></p>
    <p>${safe.tenantBusinessName}</p>
  </div>
  <div class="firma">
    <p>_________________________________</p>
    <p><strong>Firma de Recibido — Proveedor</strong></p>
    <p>${safe.supplierName}</p>
  </div>
</div>

<div class="legal">
  Constancia generada por Nortex ERP. Documento válido conforme Arto. 44 LCT y Arto. 73 RLCT de Nicaragua.
  El agente retenedor está obligado a entregar esta constancia al momento de efectuar el pago.
</div>

<script nonce="${printNonce}">
  document.getElementById('print-document').addEventListener('click', function () { window.print(); });
</script>

</body>
</html>`;

        res.setHeader('Content-Security-Policy', previewCsp);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'private, no-store, max-age=0');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
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

const fiscalSaleSnapshotBreakdown = (sale: {
    total: { toString(): string } | string | number;
    exemptTotal?: { toString(): string } | string | number | null;
    fiscalRegimeAtSale?: unknown;
    vatAmountAtSale?: { toString(): string } | string | number | null;
}) => {
    const total = new Decimal(sale.total.toString()).toDecimalPlaces(4);
    const fiscalRegime = normalizeFiscalRegime(sale.fiscalRegimeAtSale);
    if (fiscalRegime === FISCAL_REGIME_CUOTA_FIJA) {
        return {
            fiscalRegime,
            exonerado: new Decimal(0),
            netoGravado: new Decimal(0),
            iva: new Decimal(0),
            cuotaFija: total,
            total,
        };
    }

    const legacy = desglosarVentaConExoneracion(
        total,
        sale.exemptTotal?.toString() ?? '0',
    );
    let iva = legacy.iva;
    if (sale.vatAmountAtSale != null) {
        const snapshot = new Decimal(sale.vatAmountAtSale.toString());
        const maxVat = total.minus(legacy.exonerado);
        if (snapshot.isFinite() && snapshot.greaterThanOrEqualTo(0) && snapshot.lessThanOrEqualTo(maxVat)) {
            iva = snapshot.toDecimalPlaces(4);
        }
    }
    return {
        fiscalRegime,
        exonerado: legacy.exonerado,
        netoGravado: total.minus(legacy.exonerado).minus(iva).toDecimalPlaces(4),
        iva,
        cuotaFija: new Decimal(0),
        total,
    };
};

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
            where: { tenantId: authReq.tenantId!, createdAt: { gte: start, lt: end }, status: { not: ESTADO_ANULADA } },
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
            const d = fiscalSaleSnapshotBreakdown(s);
            return {
                'N°':            i + 1,
                'Fecha':         fiscalSaleDate.shortLabel,
                'N° Factura':    s.invoiceNumber ? `${s.invoiceSeries || 'A'}-${String(s.invoiceNumber).padStart(6, '0')}` : 'CF',
                'Cliente':       s.customerName || s.customer?.name || 'Consumidor Final',
                'RUC/Cédula':    s.customer?.taxId || '---',
                'Método Pago':   s.paymentMethod,
                'Régimen':       d.fiscalRegime,
                'Exento C$':     d.exonerado.toDecimalPlaces(2).toNumber(),
                'Subtotal C$':   d.netoGravado.toDecimalPlaces(2).toNumber(),
                'IVA 15% C$':    d.iva.toDecimalPlaces(2).toNumber(),
                'Cuota Fija C$': d.cuotaFija.toDecimalPlaces(2).toNumber(),
                'Total C$':      d.total.toDecimalPlaces(2).toNumber(),
            };
        });

        // Totales (acumulados con Decimal; se convierten a number solo al escribir la celda)
        const totals = {
            'N°': '', 'Fecha': '', 'N° Factura': '', 'Cliente': 'TOTALES',
            'RUC/Cédula': '', 'Método Pago': '', 'Régimen': '',
            'Exento C$':   rows.reduce((s, r) => s.plus(r['Exento C$']), new Decimal(0)).toNumber(),
            'Subtotal C$': rows.reduce((s, r) => s.plus(r['Subtotal C$']), new Decimal(0)).toNumber(),
            'IVA 15% C$':  rows.reduce((s, r) => s.plus(r['IVA 15% C$']), new Decimal(0)).toNumber(),
            'Cuota Fija C$': rows.reduce((s, r) => s.plus(r['Cuota Fija C$']), new Decimal(0)).toNumber(),
            'Total C$':    rows.reduce((s, r) => s.plus(r['Total C$']), new Decimal(0)).toNumber(),
        };
        rows.push(totals as any);

        const ws = XLSX.utils.json_to_sheet(rows);
        ws['!cols'] = [4, 12, 14, 28, 16, 12, 14, 14, 14, 14, 14, 14].map(w => ({ wch: w }));
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
                documentStatus: 'POSTED',
                status: { in: [...PURCHASE_FISCAL_STATUSES] },
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
            const ivaFacturadoD = new Decimal(p.tax.toString());
            const ivaD = new Decimal(p.creditableTax?.toString() ?? p.tax.toString());
            const ivaNoAcreditableD = Decimal.max(0, ivaFacturadoD.minus(ivaD)).toDecimalPlaces(2);
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
                'Régimen':         normalizeFiscalRegime(p.fiscalRegimeAtPurchase),
                'Subtotal C$':     subtotalD.toNumber(),
                'IVA Facturado C$': ivaFacturadoD.toNumber(),
                'IVA Crédito C$':  ivaD.toNumber(),
                'IVA no acreditable C$': ivaNoAcreditableD.toNumber(),
                'IR Ret. 2% C$':   irD.toNumber(),
                'IMI Ret. 1% C$':  imiD.toNumber(),
                'Neto Pagado C$':  netoD.toNumber(),
                'Total Factura C$': totalD.toNumber(),
            };
        });

        const totals: any = {
            'N°': '', 'Fecha': '', 'N° Factura Prov.': '', 'Proveedor': 'TOTALES', 'RUC Proveedor': '', 'Régimen': '',
            'Subtotal C$':     rows.reduce((s, r) => s.plus(r['Subtotal C$']), new Decimal(0)).toNumber(),
            'IVA Facturado C$': rows.reduce((s, r) => s.plus(r['IVA Facturado C$']), new Decimal(0)).toNumber(),
            'IVA Crédito C$':  rows.reduce((s, r) => s.plus(r['IVA Crédito C$']), new Decimal(0)).toNumber(),
            'IVA no acreditable C$': rows.reduce((s, r) => s.plus(r['IVA no acreditable C$']), new Decimal(0)).toNumber(),
            'IR Ret. 2% C$':   rows.reduce((s, r) => s.plus(r['IR Ret. 2% C$']), new Decimal(0)).toNumber(),
            'IMI Ret. 1% C$':  rows.reduce((s, r) => s.plus(r['IMI Ret. 1% C$']), new Decimal(0)).toNumber(),
            'Neto Pagado C$':  rows.reduce((s, r) => s.plus(r['Neto Pagado C$']), new Decimal(0)).toNumber(),
            'Total Factura C$': rows.reduce((s, r) => s.plus(r['Total Factura C$']), new Decimal(0)).toNumber(),
        };
        rows.push(totals);

        const ws = XLSX.utils.json_to_sheet(rows);
        ws['!cols'] = [4, 12, 16, 28, 16, 14, 14, 14, 14, 14, 14, 14, 14, 14].map(w => ({ wch: w }));
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
            where: { tenantId: authReq.tenantId!, createdAt: { gte: start, lt: end }, status: { not: ESTADO_ANULADA } },
            include: { customer: true },
            orderBy: { createdAt: 'asc' },
        });

        // Compras — mismo criterio que generateMonthlyReport (nicaTax.ts): `date` + estado válido.
        const purchases = await prisma.purchase.findMany({
            where: {
                tenantId: authReq.tenantId!,
                date: { gte: start, lt: end },
                documentStatus: 'POSTED',
                status: { in: [...PURCHASE_FISCAL_STATUSES] },
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
            const d = fiscalSaleSnapshotBreakdown(s);
            const exentoD   = d.exonerado.toDecimalPlaces(2);
            const subtotalD = (d.fiscalRegime === FISCAL_REGIME_CUOTA_FIJA
                ? d.cuotaFija
                : d.netoGravado).toDecimalPlaces(2);
            const ivaD      = d.iva.toDecimalPlaces(2);
            const totalD    = d.total.toDecimalPlaces(2);
            const fecha    = fiscalCivilDate(s.createdAt).compact;
            const factura  = s.invoiceNumber
                ? `${s.invoiceSeries || 'A'}${String(s.invoiceNumber).padStart(6,'0')}`
                : 'CF';
            const nombre   = (s.customerName || s.customer?.name || 'CONSUMIDOR FINAL').toUpperCase().substring(0, 60);
            const rucV     = s.customer?.taxId || '000-000000-0000X';
            if (d.fiscalRegime === FISCAL_REGIME_CUOTA_FIJA) {
                lines.push(`# REGIMEN CUOTA_FIJA | FACTURA ${factura} | IVA TRASLADADO 0.00`);
            }
            lines.push(`V|${fecha}|${factura}|${rucV}|${nombre}|${exentoD.toFixed(2)}|${subtotalD.toFixed(2)}|${ivaD.toFixed(2)}|${totalD.toFixed(2)}`);
        }

        lines.push('');
        lines.push('## LIBRO DE COMPRAS');

        for (const p of purchases) {
            const totalD    = new Decimal(p.total.toString()).toDecimalPlaces(2);
            const ivaD      = new Decimal(p.creditableTax?.toString() ?? p.tax.toString()).toDecimalPlaces(2);
            // El IVA no acreditable se capitaliza; por eso el subtotal contable
            // de cuota fija es el total completo y el crédito mostrado queda en 0.
            const subtotalD = totalD.minus(ivaD).toDecimalPlaces(2);
            // La compra guarda subtotal/IVA/total por separado; lo que no cuadra
            // contra el total es la parte exenta (proveedor exonerado, canasta
            // básica). Se acota a ≥0 para que un dato inconsistente no salga en
            // negativo. Misma columna que las ventas, para que el archivo alinee.
            const exentoD = Decimal.max(0, totalD.minus(subtotalD).minus(ivaD)).toDecimalPlaces(2);
            const fecha    = fiscalCivilDate(p.date).compact;
            const nombre   = p.supplier.name.toUpperCase().substring(0, 60);
            const rucC     = (p.supplier as any).ruc || '000-000000-0000X';
            if (normalizeFiscalRegime(p.fiscalRegimeAtPurchase) === FISCAL_REGIME_CUOTA_FIJA) {
                lines.push(`# COMPRA CUOTA_FIJA | FACTURA ${p.invoiceNumber} | IVA ACREDITABLE 0.00`);
            }
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
const HOST = process.env.HOST || '0.0.0.0';
app.listen(Number(PORT), HOST, () => console.log(`🚀 Nortex Banking Core Ready ${HOST}:${PORT}`));
