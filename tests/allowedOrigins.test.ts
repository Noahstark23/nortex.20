import { describe, expect, it } from 'vitest';

import { buildAllowedOrigins, isAllowedOrigin } from '../backend/lib/allowedOrigins';

describe('buildAllowedOrigins', () => {
    it('permite los dos orígenes locales canónicos de Nortex', () => {
        const allowed = buildAllowedOrigins();

        expect(allowed).toContain('http://127.0.0.1:3210');
        expect(allowed).toContain('http://127.0.0.1:4174');
    });

    it('conserva orígenes dinámicos sin duplicarlos', () => {
        const allowed = buildAllowedOrigins(
            'http://127.0.0.1:4174',
            'https://staging.somosnortex.com',
            'https://staging.somosnortex.com',
        );

        expect(allowed.filter((origin) => origin === 'http://127.0.0.1:4174')).toHaveLength(1);
        expect(allowed.filter((origin) => origin === 'https://staging.somosnortex.com')).toHaveLength(1);
    });
});

describe('isAllowedOrigin', () => {
    const allowed = buildAllowedOrigins('https://staging.somosnortex.com');

    it('permite requests sin origin y loopback local', () => {
        expect(isAllowedOrigin(allowed, undefined)).toBe(true);
        expect(isAllowedOrigin(allowed, 'http://127.0.0.1:4174')).toBe(true);
        expect(isAllowedOrigin(allowed, 'http://127.0.0.1:3210')).toBe(true);
    });

    it('rechaza orígenes ajenos', () => {
        expect(isAllowedOrigin(allowed, 'https://malicioso.example')).toBe(false);
    });
});
