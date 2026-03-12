import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function test() {
    try {
        await prisma.customer.create({ data: { tenantId: 'test1', name: 'Test' } });
        console.log('Customer OK');
        await prisma.user.create({ data: { tenantId: 'test1', name: 'MOTO', email: 'moto@test.com', password: '123', role: 'COLLECTOR' } });
        console.log('User OK');
    } catch (e) {
        console.error('Error:', e.message);
    }
}
test();
