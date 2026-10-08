import { describe, expect, it } from 'vitest';
import {
    buildPublicRegistrationPath,
    firstPublicRegistrationError,
    normalizePublicAcquisitionSource,
    normalizeRegistrationIntent,
    PUBLIC_ACQUISITION_SOURCES,
    validatePublicRegistration,
    type PublicRegistrationInput,
} from '../utils/publicActivation';

const validRegistration: PublicRegistrationInput = {
    companyName: 'Ferretería San José',
    email: 'dueno@negocio.com',
    password: 'segura-123',
    phone: '+505 8888-8888',
    type: 'FERRETERIA',
};

describe('atribución pública acotada', () => {
    it.each(PUBLIC_ACQUISITION_SOURCES)('conserva la fuente conocida %s', (source) => {
        expect(normalizePublicAcquisitionSource(source)).toBe(source);
    });

    it('normaliza mayúsculas y espacios sin perder la atribución', () => {
        expect(normalizePublicAcquisitionSource('  LANDING_HTML ')).toBe('landing_html');
    });

    it('convierte una fuente arbitraria en direct para no contaminar analytics', () => {
        expect(normalizePublicAcquisitionSource('campaign-user-controlled-123')).toBe('direct');
        expect(normalizePublicAcquisitionSource(null)).toBe('direct');
    });

    it('solo permite intenciones de continuidad reales del demo', () => {
        expect(normalizeRegistrationIntent('own_products')).toBe('own_products');
        expect(normalizeRegistrationIntent(' COMPLETED_SALE ')).toBe('completed_sale');
        expect(normalizeRegistrationIntent('copy_demo_cart')).toBeNull();
        expect(normalizeRegistrationIntent(null)).toBeNull();
    });

    it.each([
        ['landing_spa', 'own_products', '/register?source=landing_spa&intent=own_products'],
        ['landing_html', 'completed_sale', '/register?source=landing_html&intent=completed_sale'],
        ['campaign-user-controlled-123', 'completed_sale', '/register?source=direct&intent=completed_sale'],
    ] as const)('conserva %s al pasar del demo al registro', (source, intent, expected) => {
        expect(buildPublicRegistrationPath(source, intent)).toBe(expected);
    });
});

describe('validación inmediata del registro público', () => {
    it('acepta un alta válida', () => {
        expect(validatePublicRegistration(validRegistration)).toEqual({});
    });

    it('devuelve todos los ajustes en un solo intento', () => {
        expect(validatePublicRegistration({
            companyName: ' ',
            email: 'correo-incompleto',
            password: '123',
            phone: '8888 ext. 1',
            type: '',
        })).toEqual({
            companyName: 'Escribí el nombre de tu negocio',
            email: 'Escribí un correo válido',
            type: 'Seleccioná el tipo de negocio',
            password: 'La contraseña debe tener al menos 8 caracteres',
            phone: 'Usá solo números, espacios, paréntesis, + o -',
        });
    });

    it('acepta los límites que acepta el backend', () => {
        expect(validatePublicRegistration({
            ...validRegistration,
            companyName: 'N'.repeat(120),
            password: 'p'.repeat(200),
            phone: '1'.repeat(20),
        })).toEqual({});
    });

    it('rechaza valores que exceden los límites del backend', () => {
        const errors = validatePublicRegistration({
            ...validRegistration,
            companyName: 'N'.repeat(121),
            password: 'p'.repeat(201),
            phone: '1'.repeat(21),
        });
        expect(errors.companyName).toContain('120');
        expect(errors.password).toBe('La contraseña es demasiado larga');
        expect(errors.phone).toContain('20');
    });

    it('acepta un teléfono vacío porque WhatsApp es opcional', () => {
        expect(validatePublicRegistration({ ...validRegistration, phone: '' })).toEqual({});
    });

    it('enfoca primero el campo de mayor prioridad visual', () => {
        expect(firstPublicRegistrationError({ password: 'x', email: 'x' })).toBe('email');
        expect(firstPublicRegistrationError({ type: 'x', companyName: 'x' })).toBe('companyName');
        expect(firstPublicRegistrationError({})).toBeNull();
    });
});
