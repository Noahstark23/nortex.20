import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    // Fix tenants with null subscriptionStatus
    const result = await prisma.$executeRawUnsafe(
        `UPDATE Tenant SET subscriptionStatus = 'ACTIVE' WHERE subscriptionStatus IS NULL`
    );
    console.log('Fixed tenants with NULL status:', result);
    
    // Show all tenants
    const tenants = await prisma.tenant.findMany({
        select: { id: true, businessName: true, subscriptionStatus: true, walletBalance: true }
    });
    console.log('\nAll tenants:');
    tenants.forEach(t => {
        console.log(`  ${t.businessName} | Status: ${t.subscriptionStatus} | Wallet: ${t.walletBalance}`);
    });
}

main().catch(console.error).finally(() => prisma.$disconnect());
