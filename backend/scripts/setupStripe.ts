/**
 * Script para crear el producto y precio de suscripción en Stripe.
 * Ejecutar: npx tsx scripts/setupStripe.ts
 */
import Stripe from 'stripe';
import { readFileSync } from 'fs';

// Load .env manually
const envContent = readFileSync('.env', 'utf-8');
const envVars: Record<string, string> = {};
envContent.split('\n').forEach(line => {
    const match = line.match(/^([^#=]+)=["']?([^"'\n]*)["']?/);
    if (match) envVars[match[1].trim()] = match[2].trim();
});

const stripe = new Stripe(envVars.STRIPE_SECRET_KEY, { apiVersion: '2025-01-27.acacia' as any });

async function main() {
    console.log('💳 Configurando Stripe para Nortex...\n');

    // 1. Crear producto
    const product = await stripe.products.create({
        name: 'Nortex PRO',
        description: 'Sistema Operativo Financiero - Suscripción Mensual. POS, Inventario, Nómina, Reportes DGI y más.',
    });
    console.log(`✅ Producto creado: ${product.id}`);

    // 2. Crear precio ($25/mes)
    const price = await stripe.prices.create({
        product: product.id,
        unit_amount: 2500, // $25.00 en centavos
        currency: 'usd',
        recurring: { interval: 'month' },
    });
    console.log(`✅ Precio creado: ${price.id} ($25/mes)`);

    console.log('\n========================================');
    console.log(`STRIPE_PRICE_ID="${price.id}"`);
    console.log('========================================');
    console.log('\nCopia el STRIPE_PRICE_ID de arriba a tu backend/.env');
}

main().catch(err => {
    console.error('Error:', err.message);
});
