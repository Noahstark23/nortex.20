import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');
const pos = source('components/POS.tsx');
const practice = source('components/GuestPOS.tsx');
const onboarding = source('components/OnboardingHub.tsx');

describe('recorrido de activación', () => {
    // Las salidas de postventa se verifican ejecutando el POS en
    // posActivationFlow.test.tsx; no dependen de dónde viva el texto del botón.

    it('el alta rápida anuncia errores y conserva etiquetas programáticas', () => {
        expect(pos).toContain('aria-labelledby="quick-product-title"');
        expect(pos).toContain('aria-modal="true"');
        expect(pos).toContain('htmlFor="quick-product-name"');
        expect(pos).toContain('aria-invalid={Boolean(quickErrors.name)}');
        expect(pos).toContain('role="alert" aria-live="assertive"');
        expect(pos).not.toMatch(/price\s*\*\s*0\.7|precio\s*\*\s*0\.7/);
    });

    it('crea el cliente dentro del POS y regresa al cobro sin navegar afuera', () => {
        const inlineFlow = pos.slice(
            pos.indexOf('const handleInlineCustomerCreate'),
            pos.indexOf('// QUICK CREATE PRODUCT'),
        );
        expect(inlineFlow).toContain("fetch('/api/customers'");
        expect(inlineFlow).toContain('setSelectedCustomer(created)');
        expect(inlineFlow).toContain('setShowPaymentOptions(true)');
        expect(inlineFlow).not.toContain("navigate('/app/clients')");
        expect(pos).toContain('Crear cliente aquí');
    });

    it('un producto agotado ofrece una acción directa y no queda como botón muerto', () => {
        expect(pos).toContain("label: 'Cargar existencia'");
        expect(pos).toContain("navigate('/app/inventory')");
    });

    it('la práctica sigue aislada del backend y devuelve al POS si ya hay sesión', () => {
        expect(practice).not.toMatch(/fetch\s*\(\s*['"]\/api\//);
        expect(practice).toMatch(/isAuthenticated\s*\?\s*'\/app\/pos\?first_sale=1'/);
        expect(practice).toContain("buildPublicRegistrationPath(demoSource, 'completed_sale')");
        expect(practice).toContain("trackEvent('practice_sale_completed'");
        expect(practice).toContain("completePracticeSale('CASH')");
        expect(practice).toContain('¿Cómo pagó?');
        expect(practice).toContain('Efectivo recibido');
        expect(practice).toContain('Confirmar cobro');
        expect(practice).toContain('Esta práctica no cambió tu caja ni tu inventario');
    });

    it('el lanzador del checklist comunica su estado expandido', () => {
        expect(onboarding).toContain('aria-expanded={open}');
        expect(onboarding).toContain('aria-controls="onboarding-steps-panel"');
        expect(onboarding).toContain('id="onboarding-steps-panel"');
        expect(onboarding).toContain('bottom-[calc(5rem+env(safe-area-inset-bottom))]');
        expect(onboarding).toContain('lg:bottom-6');
        expect(onboarding).not.toContain('top-[4.5rem] right-4 lg:right-6');
    });
});
