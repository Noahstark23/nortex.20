import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const server = readFileSync(resolve(process.cwd(), 'backend/server.ts'), 'utf8');
const schemas = readFileSync(resolve(process.cwd(), 'backend/validation/schemas.ts'), 'utf8');
const resetUi = readFileSync(resolve(process.cwd(), 'components/ResetPassword.tsx'), 'utf8');
const resetHandlers = readFileSync(resolve(process.cwd(), 'backend/routes/passwordReset.ts'), 'utf8');

const routeStart = server.indexOf("app.post(\n    '/api/auth/reset-password/:token'");
const resetRoute = resetHandlers;

describe('contrato de sesión después de restablecer contraseña', () => {
    it('valida en GET el mismo principal activo y tenant consistente que exige POST', () => {
        expect(server).toContain("app.get('/api/auth/reset-password/:token', createValidatePasswordResetHandler");
        expect(resetHandlers).toMatch(/tenantId:\s*true/);
        expect(resetHandlers).toMatch(/status:\s*true/);
        expect(resetHandlers).toMatch(/tenant:\s*\{[\s\S]*?select:\s*\{[\s\S]*?id:\s*true/);

        const integrityGuard = resetHandlers.indexOf('tenant.id === record.user.tenantId');
        const validResponse = resetHandlers.indexOf('valid: true');

        expect(integrityGuard).toBeGreaterThan(-1);
        expect(validResponse).toBeGreaterThan(integrityGuard);
        expect(resetHandlers).toContain("record.user.status === 'ACTIVE'");
        expect(resetHandlers).toContain("res.status(404).json({ error: INVALID_LINK })");
    });

    it('mantiene el mínimo de 8 caracteres en schema, handler y cliente', () => {
        expect(schemas).toMatch(/ResetPasswordSchema[\s\S]*?password:\s*z\.string\(\)\.min\(8,/);
        expect(resetRoute).toContain('password.length < 8');
        expect(resetUi).toContain('const PASSWORD_MIN = 8;');
        expect(resetUi).toContain('minLength={PASSWORD_MIN}');
    });

    it('mantiene rate limit, validación de schema y handler en el montaje productivo', () => {
        expect(server).toMatch(/app\.post\(\s*'\/api\/auth\/reset-password\/:token',\s*forgotPasswordLimiter,\s*validate\(ResetPasswordSchema\),\s*createCompletePasswordResetHandler\(/);
    });

    it('selecciona solo la identidad necesaria y devuelve el tenant mínimo seguro', () => {
        expect(routeStart).toBeGreaterThan(-1);
        expect(resetRoute).toMatch(/user:\s*\{\s*select:\s*\{/);
        expect(resetRoute).toMatch(/tenant:\s*\{\s*select:\s*\{[\s\S]*?id:\s*true,[\s\S]*?type:\s*true,[\s\S]*?businessName:\s*true/);
        expect(resetRoute).not.toMatch(/user:\s*\{\s*include:/);
        expect(resetRoute).toMatch(/tenant:\s*\{\s*id:\s*tenant\.id,[\s\S]*?type:\s*tenant\.type,[\s\S]*?businessName:\s*tenant\.businessName/);
    });

    it('falla antes de mutar si la relación tenant/usuario está dañada', () => {
        const integrityGuard = resetRoute.indexOf('tenant.id === record.user.tenantId');
        const passwordMutation = resetRoute.indexOf('data: { password: hashedPassword }');

        expect(integrityGuard).toBeGreaterThan(-1);
        expect(passwordMutation).toBeGreaterThan(integrityGuard);
        expect(resetRoute).toContain("record.user.status === 'ACTIVE'");
    });

    it('reclama el token una sola vez y scopea la actualización al tenant asociado', () => {
        expect(resetRoute).toMatch(/tx\.passwordReset\.updateMany\(\{[\s\S]*?used:\s*false,[\s\S]*?expiresAt:\s*\{\s*gt:/);
        expect(resetRoute).toMatch(/tx\.user\.updateMany\(\{[\s\S]*?id:\s*resetRecord\.userId,[\s\S]*?tenantId:\s*resetRecord\.user\.tenantId,[\s\S]*?status:\s*'ACTIVE',[\s\S]*?role:\s*resetRecord\.user\.role/);
        expect(resetRoute).toContain('if (tokenClaim.count !== 1 || userUpdate.count !== 1)');
    });
});
