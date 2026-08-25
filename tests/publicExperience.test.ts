import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');

const registration = source('components/RegisterTenant.tsx');
const login = source('components/Login.tsx');
const demo = source('components/GuestPOS.tsx');
const spaLanding = source('components/LandingPage.tsx');
const staticLanding = source('public/landing.html');
const staticLandingCss = source('public/landing.css');

describe('experiencia pública del release', () => {
    it('nunca copia productos ficticios del demo al negocio real', () => {
        expect(registration).not.toContain('nortex_pending_cart');
        expect(registration).not.toContain('MOCK-SKU');
        expect(registration).not.toMatch(/price\s*\*\s*0\.7/);
        expect(registration).not.toMatch(/stock:\s*100/);
        expect(demo).not.toContain('onHook');
    });

    it('preserva la atribución de landing sin aceptar fuentes arbitrarias', () => {
        expect(demo).toContain('normalizePublicAcquisitionSource');
        expect(demo).toContain('buildPublicRegistrationPath(demoSource');
        expect(demo).toContain("source: demoSource, onboarding_step: 'practice'");
        expect(demo).toContain("source: demoSource, onboarding_step: 'completed'");
        expect(demo).not.toContain("source: 'demo_route'");
        expect(registration).toContain('normalizePublicAcquisitionSource');
        expect(demo).not.toContain("? raw : 'other'");
    });

    it('el registro asocia etiquetas, errores y ayudas con cada control', () => {
        for (const field of ['companyName', 'type', 'email', 'phone', 'password']) {
            expect(registration).toContain(`htmlFor="register-${field}"`);
            expect(registration).toContain(`id="register-${field}"`);
        }
        expect(registration).toContain('role="alert" aria-live="assertive"');
        expect(registration).toContain("aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}");
        expect(registration).toContain('Opciones de inventario (opcional)');
    });

    it('el login conserva semántica y permite revisar la contraseña', () => {
        expect(login).toContain('htmlFor="login-email"');
        expect(login).toContain('id="login-email"');
        expect(login).toContain('autoComplete="email"');
        expect(login).toContain('htmlFor="login-password"');
        expect(login).toContain('autoComplete="current-password"');
        expect(login).toContain('role="alert" aria-live="assertive"');
        expect(login).toContain("aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}");
    });

    it('la landing publicada no inventa reseñas ni muestra placeholders', () => {
        expect(staticLanding).not.toContain('<image-slot');
        expect(staticLanding).not.toContain('Foto cliente');
        expect(staticLanding).not.toContain('Doña Marta Hernández');
        expect(staticLanding).not.toContain('Carlos Salinas');
        expect(staticLanding).not.toContain('C$ 2.3M');
        expect(staticLanding).not.toContain('★</span> 4.8');
        expect(staticLanding).toContain('La venta queda en cola');
        expect(staticLanding).toContain('Compatible con facturación');
    });

    it('la navegación móvil reserva espacio para entrar y probar', () => {
        expect(staticLandingCss).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.nav-whats \{ display: none; \}/);
        expect(staticLandingCss).toContain('.nav-cta');
        expect(staticLandingCss).toContain('white-space: nowrap;');
        expect(spaLanding).toContain('<span className="sm:hidden">Probar</span>');
        expect(spaLanding).toContain('<span className="block text-transparent');
    });

    it('el copy público evita liderazgo, cumplimiento y crédito no demostrados', () => {
        expect(spaLanding).not.toContain('El Sistema #1');
        expect(spaLanding).not.toContain('al 100%');
        expect(spaLanding).not.toContain('te pre-aprueba');
        expect(spaLanding).toContain('Hoy Nortex no promete ni pre-aprueba crédito');
    });
});
