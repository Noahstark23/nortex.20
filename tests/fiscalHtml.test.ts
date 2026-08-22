import { describe, expect, it } from 'vitest';
import { constanciaContentSecurityPolicy, escapeHtml } from '../backend/lib/fiscalHtml';

describe('escapeHtml — documentos fiscales', () => {
    it('escapa los cinco caracteres con significado en HTML', () => {
        expect(escapeHtml(`A&B <proveedor> "factura" 'RUC'`)).toBe(
            'A&amp;B &lt;proveedor&gt; &quot;factura&quot; &#39;RUC&#39;',
        );
    });

    it('neutraliza payloads persistidos y conserva texto ordinario', () => {
        expect(escapeHtml('<script>window.print()</script>')).toBe(
            '&lt;script&gt;window.print()&lt;/script&gt;',
        );
        expect(escapeHtml('Proveedor Molina S.A.')).toBe('Proveedor Molina S.A.');
        expect(escapeHtml(186.3)).toBe('186.3');
    });
});

describe('CSP de la constancia', () => {
    it('autoriza solo el nonce del boton de imprimir y bloquea red/formularios', () => {
        const policy = constanciaContentSecurityPolicy('nonce-prueba-123');

        expect(policy).toContain("default-src 'none'");
        expect(policy).toContain("script-src 'nonce-nonce-prueba-123'");
        expect(policy).toContain("style-src 'unsafe-inline'");
        expect(policy).toContain("connect-src 'none'");
        expect(policy).toContain("base-uri 'none'");
        expect(policy).toContain("form-action 'none'");
        expect(policy).not.toContain("script-src 'unsafe-inline'");
    });

    it('queda seguro al incrustarse como atributo del meta CSP', () => {
        const policy = constanciaContentSecurityPolicy('abc123');
        expect(escapeHtml(policy)).toContain('script-src &#39;nonce-abc123&#39;');
    });
});
