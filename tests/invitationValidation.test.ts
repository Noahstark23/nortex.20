import { describe, expect, it } from 'vitest';
import { AcceptInvitationSchema } from '../backend/validation/schemas.js';

describe('frontera de aceptación pública de invitaciones', () => {
    it('usa la misma contraseña mínima de ocho caracteres que registro y recuperación', () => {
        expect(AcceptInvitationSchema.safeParse({ name: 'Ana', password: '1234567' }).success).toBe(false);
        expect(AcceptInvitationSchema.safeParse({ name: ' Ana ', password: 'segura123' })).toMatchObject({
            success: true,
            data: { name: 'Ana', password: 'segura123' },
        });
    });

    it('rechaza objetos o valores no textuales antes de bcrypt', () => {
        expect(AcceptInvitationSchema.safeParse({ name: {}, password: 'segura123' }).success).toBe(false);
        expect(AcceptInvitationSchema.safeParse({ name: 'Ana', password: 12345678 }).success).toBe(false);
    });
});
