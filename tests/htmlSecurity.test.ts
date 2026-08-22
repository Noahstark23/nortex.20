import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { escapeHtml, fiscalPreviewCsp } from '../backend/lib/htmlSecurity';

const serverSource = readFileSync('backend/server.ts', 'utf8');
const constanciaStart = serverSource.indexOf("app.get('/api/fiscal/constancia-retencion/:purchaseId'");
const constanciaEnd = serverSource.indexOf('// 📊 SPRINT A — EXPORTACIONES FISCALES DGI', constanciaStart);
const constanciaRoute = serverSource.slice(constanciaStart, constanciaEnd);

describe('HTML autenticado', () => {
    it('trata markup persistido como texto inerte', () => {
        const attack = `</span><script>globalThis.pwned=true</script><img src=x onerror='steal()'>&`;
        const escaped = escapeHtml(attack);

        expect(escaped).toBe(
            '&lt;/span&gt;&lt;script&gt;globalThis.pwned=true&lt;/script&gt;'
            + '&lt;img src=x onerror=&#039;steal()&#039;&gt;&amp;',
        );
        expect(escaped).not.toContain('<script>');
        expect(escaped).not.toContain('<img');
    });

    it('convierte null y undefined a texto vacío', () => {
        expect(escapeHtml(null)).toBe('');
        expect(escapeHtml(undefined)).toBe('');
    });

    it('codifica literalmente los cinco caracteres con significado HTML', () => {
        expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#039;');
    });

    it('solo permite scripts con el nonce impredecible de la vista previa', () => {
        const csp = fiscalPreviewCsp('nonceSeguro_123456789');

        expect(csp).toBe(
            "default-src 'none'; base-uri 'none'; form-action 'none'; "
            + "frame-ancestors 'none'; object-src 'none'; style-src 'unsafe-inline'; "
            + "script-src 'nonce-nonceSeguro_123456789'",
        );
        expect(csp).not.toContain("script-src 'unsafe-inline'");
    });

    it('acepta exactamente los dos bordes de longitud permitidos', () => {
        expect(fiscalPreviewCsp('a'.repeat(16))).toContain(`nonce-${'a'.repeat(16)}`);
        expect(fiscalPreviewCsp('Z'.repeat(128))).toContain(`nonce-${'Z'.repeat(128)}`);
    });

    it.each([
        '',
        'a'.repeat(15),
        'a'.repeat(129),
        "bad'nonce",
        '<script>',
        `!${'a'.repeat(16)}`,
        `${'a'.repeat(16)}!`,
    ])('rechaza nonces CSP inseguros: %s', (nonce) => {
        expect(() => fiscalPreviewCsp(nonce)).toThrow('Nonce CSP inválido');
    });

    it('conecta escape, CSP y nonce con el endpoint fiscal real sin handlers inline', () => {
        expect(constanciaStart).toBeGreaterThan(-1);
        expect(constanciaEnd).toBeGreaterThan(constanciaStart);

        expect(constanciaRoute).toContain('tenantBusinessName: escapeHtml(tenant.businessName)');
        expect(constanciaRoute).toContain('supplierName: escapeHtml(purchase.supplier.name)');
        expect(constanciaRoute).toContain('invoiceNumber: escapeHtml(purchase.invoiceNumber)');
        expect(constanciaRoute).toContain('${safe.tenantBusinessName}');
        expect(constanciaRoute).toContain('${safe.supplierName}');
        expect(constanciaRoute).toContain('${safe.invoiceNumber}');
        expect(constanciaRoute).not.toMatch(
            /\$\{(?:tenant\.businessName|purchase\.supplier\.name|purchase\.invoiceNumber)\}/,
        );

        expect(constanciaRoute).toContain(
            '<meta http-equiv="Content-Security-Policy" content="${escapeHtml(previewCsp)}">',
        );
        expect(constanciaRoute).toContain("res.setHeader('Content-Security-Policy', previewCsp)");
        expect(constanciaRoute).toContain("res.setHeader('Cache-Control', 'private, no-store, max-age=0')");
        expect(constanciaRoute).toContain('<script nonce="${printNonce}">');
        expect(constanciaRoute).toContain(".addEventListener('click'");
        expect(constanciaRoute).not.toMatch(/\bonclick\s*=/i);
    });
});
