import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const server = readFileSync(resolve(process.cwd(), 'backend/server.ts'), 'utf8');

describe('customer hub route safeguards', () => {
    it('filtra sobre limite con un superset seguro y deja la comparacion final al hub', () => {
        expect(server).toContain("if (segment === 'overlimit') {");
        expect(server).toContain('creditLimit: { gt: 0 },');
        expect(server).toContain('currentDebt: { gt: 0 },');
        expect(server).not.toContain('currentDebt: { gt: prisma.customer.fields.creditLimit }');
        expect(server).toContain('return matchesCustomerHubSegment(segment, customer.segment, {');
    });
});
