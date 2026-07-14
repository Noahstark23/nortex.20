/**
 * NORTEX — Cliente Prisma COMPARTIDO (SCALING_AUDIT A2).
 *
 * Regla del repo: NO crear `new PrismaClient()` por módulo — cada instancia
 * abre su propio pool y al escalar réplicas se agota `max_connections` de
 * MySQL (~21 instancias legacy pendientes de consolidar hacia este módulo).
 * Todo código nuevo importa ESTE cliente; los módulos existentes migran
 * gradualmente en el sweep A2.
 */
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();
