/**
 * NORTEX - Servicio de Stripe (Pasarela de Pagos)
 * Maneja suscripciones mensuales de $25 USD.
 */
import Stripe from 'stripe';
// @ts-ignore
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || '';
const BASE_URL = process.env.FRONTEND_URL || 'https://somosnortex.com';

// Inicializar Stripe (solo si hay key configurada)
let stripe: Stripe | null = null;
if (STRIPE_SECRET_KEY && STRIPE_SECRET_KEY.startsWith('sk_')) {
    stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2025-01-27.acacia' as any });
    console.log('💳 Stripe inicializado correctamente');
} else {
    console.warn('⚠️ Stripe NO configurado. Agrega STRIPE_SECRET_KEY en .env');
}

export function getStripe(): Stripe | null {
    return stripe;
}

/**
 * Crea o recupera un Stripe Customer para un Tenant.
 */
export async function getOrCreateStripeCustomer(tenantId: string): Promise<string> {
    if (!stripe) throw new Error('Stripe no configurado');

    const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        include: { users: { take: 1, orderBy: { createdAt: 'asc' } } }
    });

    if (!tenant) throw new Error('Tenant no encontrado');

    // Si ya tiene un customer ID, retornarlo
    if (tenant.stripeCustomerId) {
        return tenant.stripeCustomerId;
    }

    // Crear nuevo customer en Stripe
    const ownerEmail = tenant.users[0]?.email || 'sin-email@nortex.com';
    const customer = await stripe.customers.create({
        name: tenant.businessName,
        email: ownerEmail,
        metadata: {
            tenantId: tenant.id,
            taxId: tenant.taxId,
        },
    });

    // Guardar en DB
    await prisma.tenant.update({
        where: { id: tenantId },
        data: { stripeCustomerId: customer.id },
    });

    return customer.id;
}

/**
 * Crea una sesión de Stripe Checkout para suscripción.
 */
export async function createCheckoutSession(tenantId: string): Promise<string> {
    if (!stripe) throw new Error('Stripe no configurado. Agrega tu Secret Key en backend/.env');

    const customerId = await getOrCreateStripeCustomer(tenantId);

    const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [
            {
                price: STRIPE_PRICE_ID,
                quantity: 1,
            },
        ],
        metadata: {
            tenantId: tenantId,
        },
        subscription_data: {
            metadata: {
                tenantId: tenantId,
            },
        },
        success_url: `${BASE_URL}/app/billing?status=success`,
        cancel_url: `${BASE_URL}/app/billing?status=cancelled`,
    });

    if (!session.url) throw new Error('No se pudo crear la sesión de pago');
    return session.url;
}

/**
 * Crea una sesión del Portal de Cliente de Stripe.
 * Permite al usuario gestionar su suscripción, descargar facturas, cancelar.
 */
export async function createPortalSession(tenantId: string): Promise<string> {
    if (!stripe) throw new Error('Stripe no configurado');

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant?.stripeCustomerId) throw new Error('No tiene suscripción activa');

    const session = await stripe.billingPortal.sessions.create({
        customer: tenant.stripeCustomerId,
        return_url: `${BASE_URL}/app/billing`,
    });

    return session.url;
}

/**
 * Procesa los webhooks de Stripe.
 * Eventos manejados:
 * - checkout.session.completed -> Activar suscripción
 * - invoice.paid -> Renovar suscripción
 * - customer.subscription.deleted -> Cancelar servicio
 * - invoice.payment_failed -> Marcar como moroso
 */
export async function handleWebhookEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
        case 'checkout.session.completed': {
            const session = event.data.object as Stripe.Checkout.Session;
            const tenantId = session.metadata?.tenantId;

            if (tenantId) {
                const endsAt = new Date();
                endsAt.setDate(endsAt.getDate() + 30);

                await prisma.tenant.update({
                    where: { id: tenantId },
                    data: {
                        subscriptionStatus: 'ACTIVE',
                        stripeSubscriptionId: session.subscription as string,
                        subscriptionEndsAt: endsAt,
                    },
                });
                console.log(`✅ Tenant ${tenantId} ACTIVADO via Stripe Checkout`);
            }
            break;
        }

        case 'invoice.paid': {
            const invoice = event.data.object as Stripe.Invoice;
            const subscriptionId = invoice.subscription as string;

            if (subscriptionId) {
                const tenant = await prisma.tenant.findFirst({
                    where: { stripeSubscriptionId: subscriptionId },
                });

                if (tenant) {
                    const endsAt = new Date();
                    endsAt.setDate(endsAt.getDate() + 30);

                    await prisma.tenant.update({
                        where: { id: tenant.id },
                        data: {
                            subscriptionStatus: 'ACTIVE',
                            subscriptionEndsAt: endsAt,
                        },
                    });
                    console.log(`💰 Invoice paid - Tenant ${tenant.id} renovado hasta ${endsAt.toISOString()}`);
                }
            }
            break;
        }

        case 'customer.subscription.deleted': {
            const subscription = event.data.object as Stripe.Subscription;
            const tenantId = subscription.metadata?.tenantId;

            if (tenantId) {
                await prisma.tenant.update({
                    where: { id: tenantId },
                    data: {
                        subscriptionStatus: 'CANCELLED',
                        stripeSubscriptionId: null,
                    },
                });
                console.log(`🚫 Tenant ${tenantId} CANCELADO - Suscripción eliminada`);
            }
            break;
        }

        case 'invoice.payment_failed': {
            const invoice = event.data.object as Stripe.Invoice;
            const subscriptionId = invoice.subscription as string;

            if (subscriptionId) {
                const tenant = await prisma.tenant.findFirst({
                    where: { stripeSubscriptionId: subscriptionId },
                });

                if (tenant) {
                    await prisma.tenant.update({
                        where: { id: tenant.id },
                        data: { subscriptionStatus: 'PAST_DUE' },
                    });
                    console.log(`⚠️ Pago fallido - Tenant ${tenant.id} marcado como PAST_DUE`);
                }
            }
            break;
        }

        default:
            console.log(`📬 Evento Stripe no manejado: ${event.type}`);
    }
}
