/**
 * NORTEX - Script para crear usuario SUPER_ADMIN
 * Ejecutar: npx tsx scripts/createSuperAdmin.ts
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
    const email = 'noelpinedaa96@gmail.com';
    const password = 'Nortex20261996@NIC';
    const name = 'Noel Pineda (CEO)';

    console.log('🦈 NORTEX SUPER ADMIN SETUP');
    console.log('============================');

    // Check if user already exists
    const existing = await prisma.user.findUnique({ where: { email } });
    
    if (existing) {
        // Update to SUPER_ADMIN
        await prisma.user.update({
            where: { email },
            data: { role: 'SUPER_ADMIN', name }
        });
        console.log(`✅ Usuario existente actualizado a SUPER_ADMIN: ${email}`);
    } else {
        // Create tenant for SUPER_ADMIN
        const tenant = await prisma.tenant.create({
            data: {
                businessName: 'NORTEX INC. (Platform)',
                taxId: `NORTEX-HQ-${Date.now()}`,
                walletBalance: 0,
                creditLimit: 999999,
                creditScore: 999,
                subscriptionStatus: 'ACTIVE',
            }
        });

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = await prisma.user.create({
            data: {
                tenantId: tenant.id,
                email,
                password: hashedPassword,
                name,
                role: 'SUPER_ADMIN',
            }
        });

        console.log(`✅ SUPER_ADMIN creado exitosamente`);
        console.log(`   Email: ${email}`);
        console.log(`   Password: ${password}`);
        console.log(`   Tenant: ${tenant.businessName} (${tenant.id})`);
        console.log(`   User ID: ${user.id}`);
    }

    console.log('\n🚀 Ahora puedes iniciar sesión en /login y serás redirigido a /admin');
    console.log('============================');
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
