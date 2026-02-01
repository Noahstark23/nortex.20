import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Clean up existing data
  await prisma.sale.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.tenant.deleteMany({});

  const tenant = await prisma.tenant.create({
    data: {
      name: 'Nortex Hardware',
      type: 'FERRETERIA',
      creditScore: 10,
      walletBalance: 0.0,
      products: {
        create: [
            { name: 'Hammer', price: 100.00, stock: 10, sku: 'HAM-001' },
            { name: 'Nails', price: 5.00, stock: 100, sku: 'NAL-001' }
        ]
      }
    },
    include: {
        products: true
    }
  });
  console.log('Created Tenant:', JSON.stringify(tenant, null, 2));
}

main()
  .catch(e => {
      console.error(e);
      process.exit(1);
  })
  .finally(async () => await prisma.$disconnect());
