/**
 * Cliente Prisma compartido del módulo WhatsApp (evita abrir un pool por archivo).
 */
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();
