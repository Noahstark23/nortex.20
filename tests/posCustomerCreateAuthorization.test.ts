// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    buildInlineCustomerCreatePayload,
    canCreateCustomerWithFinancialControls,
    type InlineCustomerCreatePayloadInput,
} from '../components/POS';

const posSource = readFileSync(resolve(process.cwd(), 'components/POS.tsx'), 'utf8');

describe('alta rápida de clientes en POS por rol', () => {
    it.each(['OWNER', 'ADMIN', 'SUPER_ADMIN'])(
        '%s puede ver y enviar el límite de fiado',
        (role) => {
            expect(canCreateCustomerWithFinancialControls(role)).toBe(true);
            expect(buildInlineCustomerCreatePayload({
                role,
                name: 'Pulpería La Esquina',
                phone: '8888 8888',
                creditLimit: '2500.50',
            })).toEqual({
                name: 'Pulpería La Esquina',
                phone: '8888 8888',
                creditLimit: '2500.50',
            });
        },
    );

    it.each(['MANAGER', 'CASHIER', 'EMPLOYEE', 'VENDEDOR'])(
        '%s crea solo identidad/contacto aunque el estado contenga controles',
        (role) => {
            expect(canCreateCustomerWithFinancialControls(role)).toBe(false);
            const input: InlineCustomerCreatePayloadInput & {
                isWholesale: boolean;
                sellerId: string;
            } = {
                role,
                name: 'Cliente operativo',
                phone: '7777 7777',
                creditLimit: '999999.99',
                isWholesale: true,
                sellerId: 'otro-vendedor',
            };

            const payload = buildInlineCustomerCreatePayload(input);

            expect(payload).toEqual({
                name: 'Cliente operativo',
                phone: '7777 7777',
            });
            expect(payload).not.toHaveProperty('creditLimit');
            expect(payload).not.toHaveProperty('isWholesale');
            expect(payload).not.toHaveProperty('sellerId');
        },
    );

    it('condiciona el campo visible y arma el POST con la misma allowlist', () => {
        const inlineForm = posSource.slice(
            posSource.indexOf('{showInlineCustomerCreate && !selectedCustomer'),
            posSource.indexOf('{/* Credit Status Indicator */}'),
        );
        const handler = posSource.slice(
            posSource.indexOf('const handleInlineCustomerCreate'),
            posSource.indexOf('// QUICK CREATE PRODUCT'),
        );
        const requestPayload = handler.slice(
            handler.indexOf('body: JSON.stringify'),
            handler.indexOf('const body = await response.json'),
        );

        expect(inlineForm).toContain('{canManageCustomerCreateControls ? (');
        expect(inlineForm).toContain('id="inline-customer-limit"');
        expect(requestPayload).toContain('body: JSON.stringify(buildInlineCustomerCreatePayload({');
        expect(requestPayload).toContain('role: operatorRole');
        expect(requestPayload).not.toContain('isWholesale');
        expect(requestPayload).not.toContain('sellerId');
    });
});
