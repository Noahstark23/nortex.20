import express from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { checkRole } from '../middleware/checkRole.js';
import {
    TENANT_CAPABILITY_CODES,
    normalizeTenantCapabilities,
} from '../../utils/tenantCapabilities.js';

const router = express.Router();

const UpdateCapabilitiesSchema = z.object({
    capabilities: z.array(z.enum(TENANT_CAPABILITY_CODES)).max(TENANT_CAPABILITY_CODES.length),
}).strict();

router.get('/', authenticate, async (req: any, res) => {
    try {
        const capabilities = await prisma.tenantCapability.findMany({
            where: { tenantId: req.tenantId },
            select: { code: true },
            orderBy: { code: 'asc' },
        });
        res.json({ capabilities: capabilities.map((entry) => entry.code) });
    } catch (error) {
        console.error('Error listing tenant capabilities:', error);
        res.status(500).json({ error: 'No pudimos cargar las capacidades del negocio.' });
    }
});

router.put('/', authenticate, checkRole(['OWNER', 'ADMIN']), async (req: any, res) => {
    const parsed = UpdateCapabilitiesSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            error: 'Capacidades inválidas',
            details: parsed.error.flatten().fieldErrors,
        });
    }

    const next = normalizeTenantCapabilities(parsed.data.capabilities);

    try {
        const result = await prisma.$transaction(async (tx) => {
            const beforeRows = await tx.tenantCapability.findMany({
                where: { tenantId: req.tenantId },
                select: { code: true },
                orderBy: { code: 'asc' },
            });
            const before = beforeRows.map((entry) => entry.code);

            // Solo administramos nuestro allowlist. Un código futuro escrito por
            // otra versión no debe desaparecer al guardar desde un cliente viejo.
            await tx.tenantCapability.deleteMany({
                where: {
                    tenantId: req.tenantId,
                    code: { in: [...TENANT_CAPABILITY_CODES] },
                },
            });
            if (next.length > 0) {
                await tx.tenantCapability.createMany({
                    data: next.map((code) => ({ tenantId: req.tenantId, code })),
                    skipDuplicates: true,
                });
            }

            await tx.auditLog.create({
                data: {
                    tenantId: req.tenantId,
                    userId: req.userId,
                    action: 'CONFIG_UPDATE',
                    details: JSON.stringify({ area: 'TENANT_CAPABILITIES', before, after: next }),
                },
            });

            return next;
        });

        res.json({ capabilities: result });
    } catch (error) {
        console.error('Error updating tenant capabilities:', error);
        res.status(500).json({ error: 'No pudimos guardar las capacidades del negocio.' });
    }
});

export default router;
