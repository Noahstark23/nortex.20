/**
 * Cliente Prisma COMPARTIDO (singleton del proceso).
 *
 * SCALING_AUDIT A2: el repo acumuló ~21 `new PrismaClient()` (uno por módulo),
 * cada uno con su pool de conexiones — al escalar horizontal agotan MySQL.
 * Este módulo es el punto único de consolidación: TODO código nuevo debe
 * importar `prisma` desde acá en vez de instanciar el suyo; los módulos
 * existentes migran gradualmente.
 *
 * En dev con hot-reload (tsx watch) el global evita fugas de clientes viejos.
 */
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { __nortexPrisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.__nortexPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.__nortexPrisma = prisma;
}

export default prisma;
