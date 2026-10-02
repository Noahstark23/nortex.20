import { createRequire } from 'node:module';
const require=createRequire('/app/package.json');
const db=new (require('@prisma/client').PrismaClient)({log:[]});
try {
 await db.tenant.create({data:{id:'prime-synthetic-tenant',businessName:'Prime Synthetic QA',taxId:'PRIME-SYNTHETIC',subscriptionStatus:'ACTIVE',subscriptionEndsAt:new Date('2099-01-01')}});
 await db.customer.create({data:{id:'prime-synthetic-customer',tenantId:'prime-synthetic-tenant',name:'Prime Synthetic Customer',creditLimit:'30000',currentDebt:'900'}});
 console.log('Two synthetic sentinels created.');
} finally {await db.$disconnect();}
