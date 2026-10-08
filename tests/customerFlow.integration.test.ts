import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import prisma from '../backend/lib/prisma';

/**
 * QA HTTP real del módulo de clientes, cartera y cobranza.
 *
 * Se omite en la suite normal porque requiere una instancia descartable con
 * MySQL y la migración del customer hub aplicada. Ejecución:
 *   NORTEX_QA_BASE_URL=http://127.0.0.1:3210 vitest run tests/customerFlow.integration.test.ts
 */
const QA_BASE_URL = process.env.NORTEX_QA_BASE_URL?.replace(/\/$/, '');
const qaDescribe = QA_BASE_URL ? describe.sequential : describe.skip;

type ApiResult<T = any> = {
    status: number;
    body: T;
};

type OperationalRole = 'MANAGER' | 'VENDEDOR' | 'CASHIER' | 'EMPLOYEE';

type Session = {
    token: string;
    userId: string;
    tenantId: string;
    role: string;
};

let runId = '';
let owner: Session;
let manager: Session;
let seller: Session;
let cashier: Session;
let employee: Session;
let foreignOwner: Session;

let managerCustomerId = '';
let sellerCustomerId = '';
let cashierCustomerId = '';
let creditCustomerId = '';
let foreignCustomerId = '';

async function api<T = any>(
    path: string,
    token = '',
    init: RequestInit = {},
): Promise<ApiResult<T>> {
    if (!QA_BASE_URL) throw new Error('NORTEX_QA_BASE_URL no está definido');

    const headers = new Headers(init.headers);
    if (token) headers.set('authorization', `Bearer ${token}`);
    if (init.body) headers.set('content-type', 'application/json');

    const response = await fetch(`${QA_BASE_URL}${path}`, { ...init, headers });
    const text = await response.text();
    let body: any = null;
    if (text) {
        try {
            body = JSON.parse(text);
        } catch {
            body = text;
        }
    }
    return { status: response.status, body };
}

const get = <T = any>(path: string, token: string): Promise<ApiResult<T>> =>
    api<T>(path, token);

const post = <T = any>(path: string, body: unknown, token = ''): Promise<ApiResult<T>> =>
    api<T>(path, token, { method: 'POST', body: JSON.stringify(body) });

const put = <T = any>(path: string, body: unknown, token: string): Promise<ApiResult<T>> =>
    api<T>(path, token, { method: 'PUT', body: JSON.stringify(body) });

const patch = <T = any>(path: string, body: unknown, token: string): Promise<ApiResult<T>> =>
    api<T>(path, token, { method: 'PATCH', body: JSON.stringify(body) });

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function expectStatus(result: ApiResult, expected: number) {
    expect(result.status, JSON.stringify(result.body)).toBe(expected);
}

async function registerTenant(label: string): Promise<Session> {
    const registration = await post('/api/auth/register', {
        companyName: `QA Clientes ${label} ${runId}`,
        email: `qa-clientes-${label.toLowerCase()}-${runId}@example.invalid`,
        password: `Qa-${runId}-${label}-Seguro9!`,
        type: 'MISCELANEA',
    });
    expectStatus(registration, 200);
    // El registro público crea el usuario responsable con rol ADMIN. En las
    // políticas de clientes, ADMIN y OWNER tienen el mismo alcance.
    expect(registration.body.user.role).toBe('ADMIN');
    return {
        token: registration.body.token,
        userId: registration.body.user.id,
        tenantId: registration.body.tenant.id,
        role: registration.body.user.role,
    };
}

async function inviteAndAccept(role: OperationalRole, name: string): Promise<Session> {
    const invitation = await post('/api/team/invite', {
        email: `qa-clientes-${role.toLowerCase()}-${runId}@example.invalid`,
        role,
    }, owner.token);
    expectStatus(invitation, 200);

    const accepted = await post(`/api/invite/${invitation.body.invitation.token}/accept`, {
        name,
        password: `Qa-${runId}-${role}-Seguro9!`,
    });
    expectStatus(accepted, 200);
    expect(accepted.body.user.role).toBe(role);
    return {
        token: accepted.body.token,
        userId: accepted.body.user.id,
        tenantId: accepted.body.tenant.id,
        role: accepted.body.user.role,
    };
}

async function customerProfile(customerId: string, token = owner.token): Promise<any> {
    const result = await get(`/api/customers/${customerId}/hub`, token);
    expectStatus(result, 200);
    return result.body.profile;
}

qaDescribe('QA integración: clientes, cartera y cobranza', () => {
    beforeAll(async () => {
        runId = crypto.randomUUID();
        owner = await registerTenant('Principal');
        manager = await inviteAndAccept('MANAGER', 'Gerencia QA');
        seller = await inviteAndAccept('VENDEDOR', 'Ventas QA');
        cashier = await inviteAndAccept('CASHIER', 'Caja QA');
        employee = await inviteAndAccept('EMPLOYEE', 'Operación POS QA');
        foreignOwner = await registerTenant('Aislado');
    }, 120_000);

    afterAll(async () => {
        await prisma.$disconnect();
    });

    it('no revela los datos de una invitación que el responsable ya canceló', async () => {
        const invitation = await post('/api/team/invite', {
            email: `qa-clientes-cancelled-${runId}@example.invalid`,
            role: 'CASHIER',
        }, owner.token);
        expectStatus(invitation, 200);

        const cancelled = await api(`/api/team/invite/${invitation.body.invitation.id}`, owner.token, {
            method: 'DELETE',
        });
        expectStatus(cancelled, 200);

        const validation = await api(`/api/invite/${invitation.body.invitation.token}`);
        expectStatus(validation, 400);
        expect(validation.body).toEqual({ error: 'Esta invitación ya no es válida.' });
        expect(JSON.stringify(validation.body)).not.toContain('qa-clientes-cancelled');
    });

    it('acepta una invitación concurrente una sola vez y nunca responde 500 al segundo intento', async () => {
        const invitation = await post('/api/team/invite', {
            email: `qa-clientes-concurrent-${runId}@example.invalid`,
            role: 'CASHIER',
        }, owner.token);
        expectStatus(invitation, 200);

        const payload = {
            name: 'Caja Concurrente QA',
            password: `Qa-${runId}-Concurrente-Seguro9!`,
        };
        const [first, second] = await Promise.all([
            api(`/api/invite/${invitation.body.invitation.token}/accept`, '', {
                method: 'POST', body: JSON.stringify(payload),
            }),
            api(`/api/invite/${invitation.body.invitation.token}/accept`, '', {
                method: 'POST', body: JSON.stringify(payload),
            }),
        ]);

        const outcomes = [first, second];
        expect(outcomes.filter(result => result.status === 200)).toHaveLength(1);
        expect(outcomes.filter(result => result.status === 500)).toHaveLength(0);
        expect(outcomes.filter(result => result.status === 400 || result.status === 409)).toHaveLength(1);
        expect(outcomes.find(result => result.status === 200)?.body.user).toMatchObject({
            email: `qa-clientes-concurrent-${runId}@example.invalid`,
            role: 'CASHIER',
        });
    });

    it('devuelve al invitado solo la identidad mínima del negocio', async () => {
        const invitation = await post('/api/team/invite', {
            email: `qa-clientes-minimal-${runId}@example.invalid`,
            role: 'CASHIER',
        }, owner.token);
        expectStatus(invitation, 200);

        const accepted = await post(`/api/invite/${invitation.body.invitation.token}/accept`, {
            name: 'Caja Mínima QA',
            password: `Qa-${runId}-Minima-Seguro9!`,
        });
        expectStatus(accepted, 200);
        expect(accepted.body.tenant).toEqual({
            id: owner.tenantId,
            businessName: `QA Clientes Principal ${runId}`,
        });
        expect(Object.keys(accepted.body.tenant).sort()).toEqual(['businessName', 'id']);
        for (const forbidden of [
            'walletBalance', 'creditLimit', 'creditScore', 'stripeCustomerId',
            'stripeSubscriptionId', 'dgiAuthCode', 'theftAlertThreshold',
            'agentCashMin', 'agentCashMax',
        ]) {
            expect(accepted.body.tenant).not.toHaveProperty(forbidden);
        }
    });

    it('un GET vencido no reescribe una cancelación que ya ganó la carrera', async () => {
        const invitation = await post('/api/team/invite', {
            email: `qa-clientes-expiry-race-${runId}@example.invalid`,
            role: 'CASHIER',
        }, owner.token);
        expectStatus(invitation, 200);
        await prisma.invitation.update({
            where: { id: invitation.body.invitation.id },
            data: { expiresAt: new Date(Date.now() - 1_000) },
        });

        let releaseLock!: () => void;
        let announceLock!: () => void;
        const lockReady = new Promise<void>((resolve) => { announceLock = resolve; });
        const release = new Promise<void>((resolve) => { releaseLock = resolve; });
        const lockTransaction = prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT \`id\` FROM \`Invitation\` WHERE \`id\` = ${invitation.body.invitation.id} FOR UPDATE`;
            announceLock();
            await release;
        }, { maxWait: 5_000, timeout: 10_000 });

        await lockReady;
        const cancellation = api(`/api/team/invite/${invitation.body.invitation.id}`, owner.token, {
            method: 'DELETE',
        });
        await wait(50);
        const validation = api(`/api/invite/${invitation.body.invitation.token}`);
        await wait(50);
        releaseLock();
        await lockTransaction;

        const [cancelled, expiredView] = await Promise.all([cancellation, validation]);
        expectStatus(cancelled, 200);
        expectStatus(expiredView, 400);
        await expect(prisma.invitation.findUniqueOrThrow({
            where: { id: invitation.body.invitation.id },
            select: { status: true },
        })).resolves.toEqual({ status: 'CANCELLED' });
    });

    it('limita los reintentos públicos de una invitación antes del handler costoso', async () => {
        const invitation = await post('/api/team/invite', {
            email: `qa-clientes-limit-${runId}@example.invalid`,
            role: 'CASHIER',
        }, owner.token);
        expectStatus(invitation, 200);
        await prisma.invitation.update({
            where: { id: invitation.body.invitation.id },
            data: { expiresAt: new Date(Date.now() - 1_000) },
        });

        for (let attempt = 0; attempt < 10; attempt += 1) {
            const rejected = await post(`/api/invite/${invitation.body.invitation.token}/accept`, {
                name: 'Caja Límite QA',
                password: `Qa-${runId}-Limite-Seguro9!`,
            });
            expectStatus(rejected, 400);
        }
        const limited = await post(`/api/invite/${invitation.body.invitation.token}/accept`, {
            name: 'Caja Límite QA',
            password: `Qa-${runId}-Limite-Seguro9!`,
        });
        expectStatus(limited, 429);
    });

    it('no confirma una cancelación si la misma invitación ya ganó aceptación', async () => {
        const invitation = await post('/api/team/invite', {
            email: `qa-clientes-race-${runId}@example.invalid`,
            role: 'CASHIER',
        }, owner.token);
        expectStatus(invitation, 200);

        const acceptance = api(`/api/invite/${invitation.body.invitation.token}/accept`, '', {
            method: 'POST',
            body: JSON.stringify({
                name: 'Caja Carrera QA',
                password: `Qa-${runId}-Carrera-Seguro9!`,
            }),
        });
        const cancellation = api(`/api/team/invite/${invitation.body.invitation.id}`, owner.token, {
            method: 'DELETE',
        });
        const [accepted, cancelled] = await Promise.all([acceptance, cancellation]);

        expect([accepted.status, cancelled.status]).not.toContain(500);
        expect([accepted.status === 200, cancelled.status === 200].filter(Boolean)).toHaveLength(1);
        if (accepted.status === 200) {
            expect(cancelled.status).toBe(409);
            expect(cancelled.body).toEqual({ error: 'Esta invitación ya no está pendiente.' });
        } else {
            expect(cancelled.status).toBe(200);
            expect([400, 409]).toContain(accepted.status);
        }
    });

    it('permite el alta básica por rol operativo y reserva los controles para el responsable', async () => {
        const managerCustomer = await post('/api/customers', {
            name: `Cliente Gerencia ${runId}`,
            taxId: `DOC-MANAGER-${runId}`,
            phone: '0000-1001',
            email: `cliente-manager-${runId}@example.invalid`,
            address: 'Dirección sintética de QA',
        }, manager.token);
        expectStatus(managerCustomer, 200);
        expect(managerCustomer.body.sellerId).toBeNull();
        expect(Number(managerCustomer.body.creditLimit)).toBe(0);
        managerCustomerId = managerCustomer.body.id;

        const sellerCustomer = await post('/api/customers', {
            name: `Cliente Vendedor ${runId}`,
            taxId: `DOC-SELLER-${runId}`,
            phone: '0000-1002',
            email: `cliente-vendedor-${runId}@example.invalid`,
        }, seller.token);
        expectStatus(sellerCustomer, 200);
        expect(sellerCustomer.body.sellerId).toBe(seller.userId);
        expect(Number(sellerCustomer.body.creditLimit)).toBe(0);
        sellerCustomerId = sellerCustomer.body.id;

        const cashierCustomer = await post('/api/customers', {
            name: `Cliente Caja ${runId}`,
            taxId: `DOC-CASHIER-${runId}`,
            phone: '0000-1003',
        }, cashier.token);
        expectStatus(cashierCustomer, 200);
        expect(cashierCustomer.body.sellerId).toBeNull();
        expect(Number(cashierCustomer.body.creditLimit)).toBe(0);
        cashierCustomerId = cashierCustomer.body.id;

        const creditCustomer = await post('/api/customers', {
            name: `Cliente Crédito ${runId}`,
            taxId: `DOC-CREDIT-${runId}`,
            phone: '0000-1004',
            creditLimit: '400.00',
            isWholesale: false,
            sellerId: seller.userId,
        }, owner.token);
        expectStatus(creditCustomer, 200);
        expect(creditCustomer.body.sellerId).toBe(seller.userId);
        expect(Number(creditCustomer.body.creditLimit)).toBe(400);
        creditCustomerId = creditCustomer.body.id;

        const forbiddenManagerControls = await post('/api/customers', {
            name: `Cliente Control Rechazado ${runId}`,
            creditLimit: '10.00',
        }, manager.token);
        expectStatus(forbiddenManagerControls, 403);
    }, 60_000);

    it('aísla los clientes por tenant y limita al vendedor a su propia cartera', async () => {
        const foreignCustomer = await post('/api/customers', {
            name: `Cliente Tenant Aislado ${runId}`,
            taxId: `DOC-FOREIGN-${runId}`,
            phone: '0000-2001',
        }, foreignOwner.token);
        expectStatus(foreignCustomer, 200);
        foreignCustomerId = foreignCustomer.body.id;

        const sellerPortfolio = await get<any[]>('/api/customers', seller.token);
        expectStatus(sellerPortfolio, 200);
        const sellerIds = sellerPortfolio.body.map((customer) => customer.id);
        expect(sellerIds).toContain(sellerCustomerId);
        expect(sellerIds).toContain(creditCustomerId);
        expect(sellerIds).not.toContain(managerCustomerId);
        expect(sellerIds).not.toContain(cashierCustomerId);
        expect(sellerIds).not.toContain(foreignCustomerId);

        const managerPortfolio = await get<any[]>('/api/customers', manager.token);
        expectStatus(managerPortfolio, 200);
        const managerIds = managerPortfolio.body.map((customer) => customer.id);
        expect(managerIds).toEqual(expect.arrayContaining([
            managerCustomerId,
            sellerCustomerId,
            cashierCustomerId,
            creditCustomerId,
        ]));
        expect(managerIds).not.toContain(foreignCustomerId);

        const employeeBasicLookup = await get<any[]>('/api/customers', employee.token);
        expectStatus(employeeBasicLookup, 200);
        for (const richPath of [
            '/api/customers/hub',
            `/api/customers/${managerCustomerId}/hub`,
            '/api/credits/debtors',
            '/api/collections/worklist',
            `/api/customers/${managerCustomerId}/statement`,
        ]) {
            expectStatus(await get(richPath, employee.token), 403);
        }

        expectStatus(await get(`/api/customers/${managerCustomerId}/hub`, seller.token), 404);
        expectStatus(await get(`/api/customers/${managerCustomerId}/hub`, foreignOwner.token), 404);
        expectStatus(await get(`/api/customers/${foreignCustomerId}/hub`, owner.token), 404);

        const foreignWrite = await put(`/api/customers/${managerCustomerId}`, {
            phone: '0000-9999',
        }, foreignOwner.token);
        expectStatus(foreignWrite, 404);
    }, 60_000);

    it('permite contacto a MANAGER/VENDEDOR, rechaza identidad y deja el payload mixto sin aplicar', async () => {
        const emptyUpdate = await put(`/api/customers/no-existe-${runId}`, {}, manager.token);
        expectStatus(emptyUpdate, 400);
        expect(emptyUpdate.body.error).toBe('Datos de entrada inválidos');
        expect(emptyUpdate.body.details?._form).toContain('Indicá al menos un cambio');

        const managerContact = {
            phone: '0000-3101',
            email: `contacto-manager-${runId}@example.invalid`,
            address: 'Contacto actualizado por gerencia',
        };
        expectStatus(await put(
            `/api/customers/${managerCustomerId}`,
            managerContact,
            manager.token,
        ), 200);

        const managerMixed = await put(`/api/customers/${managerCustomerId}`, {
            name: `Identidad Gerencia Prohibida ${runId}`,
            taxId: `DOC-MANAGER-ALTERADO-${runId}`,
            phone: '0000-3199',
        }, manager.token);
        expectStatus(managerMixed, 403);

        const managerProfile = await customerProfile(managerCustomerId);
        expect(managerProfile.name).toBe(`Cliente Gerencia ${runId}`);
        expect(managerProfile.taxId).toBe(`DOC-MANAGER-${runId}`);
        expect(managerProfile.phone).toBe(managerContact.phone);
        expect(managerProfile.email).toBe(managerContact.email);
        expect(managerProfile.address).toBe(managerContact.address);

        const sellerContact = {
            phone: '0000-3201',
            email: `contacto-vendedor-${runId}@example.invalid`,
            address: 'Contacto actualizado por vendedor',
        };
        expectStatus(await put(
            `/api/customers/${sellerCustomerId}`,
            sellerContact,
            seller.token,
        ), 200);

        const sellerMixed = await put(`/api/customers/${sellerCustomerId}`, {
            name: `Identidad Vendedor Prohibida ${runId}`,
            taxId: `DOC-SELLER-ALTERADO-${runId}`,
            phone: '0000-3299',
        }, seller.token);
        expectStatus(sellerMixed, 403);

        const sellerProfile = await customerProfile(sellerCustomerId);
        expect(sellerProfile.name).toBe(`Cliente Vendedor ${runId}`);
        expect(sellerProfile.taxId).toBe(`DOC-SELLER-${runId}`);
        expect(sellerProfile.phone).toBe(sellerContact.phone);
        expect(sellerProfile.email).toBe(sellerContact.email);
        expect(sellerProfile.address).toBe(sellerContact.address);

        expectStatus(await put(`/api/customers/${managerCustomerId}`, {
            phone: '0000-3301',
        }, seller.token), 404);
    }, 60_000);

    it('permite al responsable cambiar identidad legal y controles administrativos', async () => {
        const updatedName = `Cliente Crédito Controlado ${runId}`;
        const updatedTaxId = `DOC-CREDIT-CONTROLADO-${runId}`;
        const result = await put(`/api/customers/${creditCustomerId}`, {
            name: updatedName,
            taxId: updatedTaxId,
            phone: '0000-4001',
            creditLimit: '500.00',
            isBlocked: false,
            isWholesale: true,
            sellerId: seller.userId,
        }, owner.token);
        expectStatus(result, 200);

        const profile = await customerProfile(creditCustomerId);
        expect(profile.name).toBe(updatedName);
        expect(profile.taxId).toBe(updatedTaxId);
        expect(profile.phone).toBe('0000-4001');
        expect(profile.creditLimit).toBe(500);
        expect(profile.isBlocked).toBe(false);
        expect(profile.isWholesale).toBe(true);
        expect(profile.sellerId).toBe(seller.userId);
    }, 60_000);

    it('crea y resuelve una gestión sin cruzar tenant ni cartera', async () => {
        const interaction = await post(`/api/customers/${managerCustomerId}/interactions`, {
            type: 'PROMISE',
            note: 'Promesa sintética registrada durante QA',
            promisedAmount: '25.50',
            promisedAt: '2099-01-02T12:00:00.000Z',
            followUpAt: '2099-01-01T12:00:00.000Z',
        }, manager.token);
        expectStatus(interaction, 201);
        expect(interaction.body.status).toBe('OPEN');
        expect(interaction.body.promisedAmount).toBe(25.5);
        const interactionId = interaction.body.id;

        const foreignResolve = await patch(
            `/api/customers/${managerCustomerId}/interactions/${interactionId}`,
            { status: 'COMPLETED' },
            foreignOwner.token,
        );
        expectStatus(foreignResolve, 404);

        const sellerResolve = await patch(
            `/api/customers/${managerCustomerId}/interactions/${interactionId}`,
            { status: 'COMPLETED' },
            seller.token,
        );
        expectStatus(sellerResolve, 404);

        const resolved = await patch(
            `/api/customers/${managerCustomerId}/interactions/${interactionId}`,
            { status: 'COMPLETED' },
            manager.token,
        );
        expectStatus(resolved, 200);
        expect(resolved.body.status).toBe('COMPLETED');
        expect(typeof resolved.body.completedAt).toBe('string');

        const detail = await get(`/api/customers/${managerCustomerId}/hub`, manager.token);
        expectStatus(detail, 200);
        expect(detail.body.interactions).toContainEqual(expect.objectContaining({
            id: interactionId,
            status: 'COMPLETED',
            promisedAmount: 25.5,
        }));
    }, 60_000);

    it('factura a crédito y hace el abono TRANSFER idempotente por ambas rutas', async () => {
        expectStatus(await post('/api/shifts/open', {
            initialCash: '0.00',
        }, owner.token), 200);

        const product = await post('/api/products', {
            name: `Producto Crédito QA ${runId}`,
            sku: `QA-CUSTOMER-FLOW-${runId}`,
            category: 'QA Clientes',
            price: 100,
            cost: 50,
            stock: 5,
            minStock: 0,
            unit: 'unidad',
            saleMode: 'COUNTED',
            quantityStep: 1,
            isPublished: false,
            requiresBatchTracking: false,
            ivaExento: true,
        }, owner.token);
        expectStatus(product, 200);

        const sale = await post('/api/sales', {
            items: [{ id: product.body.id, quantity: 1 }],
            paymentMethod: 'CREDIT',
            customerId: creditCustomerId,
            offlineId: crypto.randomUUID(),
        }, owner.token);
        expectStatus(sale, 200);
        expect(Number(sale.body.total)).toBe(100);
        expect(Number(sale.body.balance)).toBe(100);
        expect(sale.body.status).toBe('CREDIT_PENDING');
        const saleId = sale.body.id;

        for (const endpoint of ['/api/credits/payment', '/api/payments']) {
            const paymentWithoutIdempotencyKey = await post(endpoint, {
                saleId,
                amount: '1.00',
                method: 'TRANSFER',
            }, seller.token);
            expectStatus(paymentWithoutIdempotencyKey, 400);
            expect(paymentWithoutIdempotencyKey.body.error).toBe('Datos de entrada inválidos');
            expect(paymentWithoutIdempotencyKey.body.details?.clientEventId).toBeDefined();
        }

        const foreignPayment = await post('/api/credits/payment', {
            saleId,
            amount: '1.00',
            method: 'TRANSFER',
            clientEventId: crypto.randomUUID(),
        }, foreignOwner.token);
        expectStatus(foreignPayment, 404);

        const clientEventId = crypto.randomUUID();
        const paymentPayload = {
            saleId,
            amount: '25.50',
            method: 'TRANSFER',
            clientEventId,
        };
        const firstPayment = await post('/api/credits/payment', paymentPayload, seller.token);
        expectStatus(firstPayment, 200);
        expect(firstPayment.body.idempotentReplay).toBe(false);
        expect(firstPayment.body.balance).toBe(74.5);
        expect(firstPayment.body.payments).toHaveLength(1);
        expect(firstPayment.body.payments[0].method).toBe('TRANSFER');

        const aliasReplay = await post('/api/payments', paymentPayload, seller.token);
        expectStatus(aliasReplay, 200);
        expect(aliasReplay.body.idempotentReplay).toBe(true);
        expect(aliasReplay.body.paymentId).toBe(firstPayment.body.paymentId);
        expect(aliasReplay.body.balance).toBe(74.5);
        expect(aliasReplay.body.payments).toHaveLength(1);

        const conflictingReplay = await post('/api/payments', {
            ...paymentPayload,
            amount: '25.00',
        }, seller.token);
        expectStatus(conflictingReplay, 409);
        expect(conflictingReplay.body.code).toBe('PAYMENT_IDEMPOTENCY_CONFLICT');

        const overpayment = await post('/api/credits/payment', {
            saleId,
            amount: '75.00',
            method: 'TRANSFER',
            clientEventId: crypto.randomUUID(),
        }, seller.token);
        expectStatus(overpayment, 400);
        expect(overpayment.body.error).toBe('El abono excede el saldo pendiente');

        const statement = await get(`/api/customers/${creditCustomerId}/statement`, seller.token);
        expectStatus(statement, 200);
        expect(statement.body.totals.paid).toBe(25.5);
        expect(statement.body.totals.balance).toBe(74.5);
        expect(statement.body.invoices).toHaveLength(1);
        expect(statement.body.invoices[0].payments).toHaveLength(1);
        expect(statement.body.invoices[0].payments[0].method).toBe('TRANSFER');
    }, 120_000);
});
