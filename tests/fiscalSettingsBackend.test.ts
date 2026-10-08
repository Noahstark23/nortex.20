import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { UpdateFiscalSettingsSchema } from '../backend/validation/schemas';

describe('configuración fiscal backend', () => {
    it('mantiene compatible el payload legacy y acepta solo regímenes conocidos', () => {
        expect(UpdateFiscalSettingsSchema.safeParse({ taxId: 'J0310000000000' }).success).toBe(true);
        expect(UpdateFiscalSettingsSchema.safeParse({ fiscalRegime: 'GENERAL' }).success).toBe(true);
        expect(UpdateFiscalSettingsSchema.safeParse({ fiscalRegime: 'CUOTA_FIJA' }).success).toBe(true);
        expect(UpdateFiscalSettingsSchema.safeParse({ fiscalRegime: 'OTRO' }).success).toBe(false);
        expect(UpdateFiscalSettingsSchema.safeParse({ fiscalRegime: 'CUOTA_FIJA', tenantId: 'ajeno' }).success).toBe(false);
        expect(UpdateFiscalSettingsSchema.safeParse({}).success).toBe(false);
    });

    it('expone lectura autenticada y mutación restringida, versionada y auditada', () => {
        const server = fs.readFileSync(path.resolve('backend/server.ts'), 'utf8');
        expect(server).toContain("app.get('/api/tenant/fiscal-settings', authenticate");
        expect(server).toContain("app.put('/api/tenant/fiscal', authenticate, checkRole(['ADMIN', 'OWNER']), validate(UpdateFiscalSettingsSchema)");
        expect(server).toContain("fiscalRegimeVersion: { increment: 1 }");
        expect(server).toContain("action: 'FISCAL_SETTINGS_UPDATED'");
        expect(server).toContain('const tenant = await prisma.$transaction');
    });
});
