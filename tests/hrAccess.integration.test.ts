import { beforeAll, describe, expect, it } from 'vitest';
const base = process.env.NORTEX_QA_BASE_URL;
const run = base ? describe.sequential : describe.skip;
let owner = '', employee = '', cashier = '';
const api = async (path: string, token = '', body?: unknown) => {
    const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
};
run('QA HTTP: privacidad de expedientes y nómina', () => {
    beforeAll(async () => {
        const id = crypto.randomUUID();
        const registration = await api('/api/auth/register', '', { companyName: `QA HR ${id}`, email: `qa-hr-${id}@example.invalid`, password: `Qa-${id}-Seguro!`, type: 'RETAIL' });
        expect(registration.status).toBe(200); owner = registration.body.token;
        for (const role of ['EMPLOYEE', 'CASHIER']) {
            const invite = await api('/api/team/invite', owner, { email: `qa-hr-${role}-${id}@example.invalid`, role });
            expect(invite.status, JSON.stringify(invite.body)).toBe(200);
            const accepted = await api(`/api/invite/${invite.body.invitation.token}/accept`, '', { name: `QA ${role}`, password: `Qa-${id}-${role}!` });
            expect(accepted.status).toBe(200);
            if (role === 'EMPLOYEE') employee = accepted.body.token; else cashier = accepted.body.token;
        }
    }, 30_000);
    it('rechaza lectura de terceros antes de consultar sus sueldos o identificadores', async () => {
        for (const token of [employee, cashier]) {
            for (const path of ['/api/payroll/aguinaldo/2026', '/api/hrm/settlement-preview/no-existe-qa', '/api/hrm/dashboard/2026/9']) {
                const result = await api(path, token);
                expect(result.status, path + ': ' + JSON.stringify(result.body)).toBe(403);
            }
        }
    });
    it('no permite fichar con PIN vacío, ausente o mal formado', async () => {
        for (const endpoint of ['/api/hr/clock-in', '/api/hr/clock-out']) {
            for (const body of [{}, { pin: '' }, { pin: '12' }, { pin: null }]) {
                expect((await api(endpoint, employee, body)).status).toBe(400);
            }
        }
    });
    it('conserva el autoservicio propio y las lecturas administrativas', async () => {
        expect((await api('/api/me/payrolls', employee)).status).toBe(200);
        expect((await api('/api/payroll/aguinaldo/2026', owner)).status).toBe(200);
        expect((await api('/api/hrm/dashboard/2026/9', owner)).status).toBe(200);
        for (const path of ['/api/payroll/foo/2026', '/api/payroll/13/2026', '/api/payroll/9/invalid']) expect((await api(path, owner)).status).toBe(400);
    });
});
