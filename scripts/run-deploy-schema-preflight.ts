import prisma from '../backend/lib/prisma';
import {
    applyDeploySchemaPreflight,
    UnsafeSchemaStateError,
    UNSAFE_SCHEMA_STATE_EXIT_CODE,
} from './deploy-schema-preflight';

try {
    await applyDeploySchemaPreflight({
        query: statement => prisma.$queryRaw(statement),
        execute: statement => prisma.$executeRaw(statement),
    });
} catch (error) {
    if (error instanceof UnsafeSchemaStateError) {
        console.error(`❌ Estado de schema inseguro: ${error.message}`);
        process.exitCode = UNSAFE_SCHEMA_STATE_EXIT_CODE;
    } else {
        console.error('❌ Falló el preflight DDL seguro.', error);
        process.exitCode = 1;
    }
} finally {
    await prisma.$disconnect();
}
