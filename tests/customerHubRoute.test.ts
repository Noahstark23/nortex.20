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

    it('prefiltra inactivos con el mismo dia civil Managua que usa la clasificacion final', () => {
        expect(server).toContain('function customerHubSegmentWhere(segment: string, asOf: Date = new Date())');
        expect(server).toContain('const cutoff = new Date(managuaBusinessDate(asOf).getTime() - 60 * 86400000);');
        expect(server).toContain('...customerHubSegmentWhere(segment, asOf),');
        expect(server).toContain('const hub = await buildCustomerHubList(tenantId, customers, asOf);');
        expect(server).toContain('const segment = resolveCustomerHubSegment({');
        expect(server).toContain('}, asOf);');
    });
});
