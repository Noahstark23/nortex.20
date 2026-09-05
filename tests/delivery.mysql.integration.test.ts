import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import prisma from '../backend/lib/prisma';

/**
 * QA HTTP real del flujo Delivery aislado sobre MySQL efímero.
 *
 * Requiere un backend QA vivo apuntando a la misma base:
 *   NORTEX_QA_BASE_URL=http://127.0.0.1:3230 vitest run tests/delivery.mysql.integration.test.ts
 */
const QA_BASE_URL = process.env.NORTEX_QA_BASE_URL?.replace(/\/$/u, '');
const qaDescribe = QA_BASE_URL ? describe.sequential : describe.skip;

type ApiResult<T = any> = { status: number; body: T };
type Session = { token: string; tenantId: string; userId: string; slug: string | null };

let tenantA: Session;
let tenantB: Session;
let tenantASlug = '';
let productId = '';
let pedidoId = '';
let riderA1Id = '';
let riderA2Id = '';
let riderBId = '';
let customerName = '';
let baselineSales = 0;
let baselinePayments = 0;
let baselineJournalEntries = 0;

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

const get = <T = any>(path: string, token = ''): Promise<ApiResult<T>> =>
    api<T>(path, token);

const post = <T = any>(path: string, body: unknown, token = ''): Promise<ApiResult<T>> =>
    api<T>(path, token, { method: 'POST', body: JSON.stringify(body) });

const patch = <T = any>(path: string, body: unknown, token: string): Promise<ApiResult<T>> =>
    api<T>(path, token, { method: 'PATCH', body: JSON.stringify(body) });

const put = <T = any>(path: string, body: unknown, token: string): Promise<ApiResult<T>> =>
    api<T>(path, token, { method: 'PUT', body: JSON.stringify(body) });

function expectStatus(result: ApiResult, expected: number) {
    expect(result.status, JSON.stringify(result.body)).toBe(expected);
}

async function registerTenant(label: string, runId: string): Promise<Session> {
    const registration = await post('/api/auth/register', {
        companyName: `QA Delivery ${label} ${runId}`,
        email: `qa-delivery-${label.toLowerCase()}-${runId}@example.invalid`,
        password: `Qa-${runId}-${label}-Seguro9!`,
        type: 'MISCELANEA',
    });
    expectStatus(registration, 200);
    expect(registration.body.user.role).toBe('ADMIN');
    return {
        token: registration.body.token,
        tenantId: registration.body.tenant.id,
        userId: registration.body.user.id,
        slug: typeof registration.body.tenant.slug === 'string' ? registration.body.tenant.slug : null,
    };
}

async function ensureSlug(session: Session, slug: string): Promise<string> {
    if (session.slug && session.slug.trim() !== '') return session.slug;
    const configured = await put('/api/tenant/slug', { slug }, session.token);
    expectStatus(configured, 200);
    expect(configured.body.slug).toBe(slug);
    return slug;
}

async function createFleetRider(token: string, runId: string, label: string): Promise<string> {
    const rider = await post('/api/v1/motorizados', {
        nombre: `QA Rider ${label}`,
        telefono: `8888${runId.replace(/\D/gu, '').slice(-4)}${label === 'A1' ? '01' : label === 'A2' ? '02' : '03'}`,
        zonaCobertura: 'Managua QA',
        vehiculoPlaca: `M${label}${runId.slice(-4)}`,
        pin: '1234',
    }, token);
    expectStatus(rider, 201);
    return rider.body.motorizado.id;
}

async function currentProductStock(): Promise<number> {
    const product = await prisma.product.findFirst({
        where: { id: productId, tenantId: tenantA.tenantId },
        select: { stock: true },
    });
    return Number(product?.stock ?? 0);
}

qaDescribe('QA integración: delivery autenticado aislado', () => {
    beforeAll(async () => {
        const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
        customerName = `Cliente Delivery ${runId}`;
        tenantA = await registerTenant('Principal', runId);
        tenantB = await registerTenant('Aislado', runId);
        tenantASlug = await ensureSlug(tenantA, `qa-delivery-${runId}`.toLowerCase());

        const product = await post('/api/products', {
            name: `QA Delivery Producto ${runId}`,
            sku: `QA-DELIVERY-${runId}`.toUpperCase(),
            category: 'QA Delivery',
            price: '25.00',
            cost: '10.00',
            stock: '10',
            minStock: '0',
            unit: 'unidad',
            saleMode: 'COUNTED',
            quantityStep: '1',
            isPublished: true,
            requiresBatchTracking: false,
            ivaExento: false,
        }, tenantA.token);
        expectStatus(product, 200);
        productId = product.body.id;

        riderA1Id = await createFleetRider(tenantA.token, runId, 'A1');
        riderA2Id = await createFleetRider(tenantA.token, runId, 'A2');
        riderBId = await createFleetRider(tenantB.token, runId, 'B1');

        const pedido = await post('/api/v1/pedidos', {
            slug: tenantASlug,
            clienteNombre: customerName,
            clienteTelefono: '88881234',
            direccionEntrega: 'Bolonia, del semáforo 1c al sur',
            referenciaDireccion: 'Casa celeste con portón negro',
            notas: 'QA sintético de delivery',
            items: [{ productoId: productId, cantidad: '2', presentation: 'BASE' }],
        });
        expectStatus(pedido, 201);
        pedidoId = pedido.body.pedidoId;
        expect(pedido.body.estado).toBe('pendiente');

        baselineSales = await prisma.sale.count({ where: { tenantId: tenantA.tenantId } });
        baselinePayments = await prisma.payment.count({
            where: { sale: { tenantId: tenantA.tenantId } },
        });
        baselineJournalEntries = await prisma.journalEntry.count({
            where: { tenantId: tenantA.tenantId },
        });
    }, 180_000);

    afterAll(async () => {
        await prisma.$disconnect();
    });

    it('aísla tenants, reserva stock, exige rider para despacho y cancela sin crear venta ni asiento', async () => {
        expect(await currentProductStock()).toBe(10);

        const foreignDetail = await get(`/api/v1/pedidos/${pedidoId}`, tenantB.token);
        expectStatus(foreignDetail, 404);

        const foreignTransition = await patch(`/api/v1/pedidos/${pedidoId}/estado`, {
            estado: 'preparando',
        }, tenantB.token);
        expectStatus(foreignTransition, 404);

        const foreignRiderAssignment = await patch(`/api/v1/pedidos/${pedidoId}/motorizado`, {
            motorizadoId: riderBId,
        }, tenantA.token);
        expectStatus(foreignRiderAssignment, 400);
        expect(foreignRiderAssignment.body.error).toContain('Motorizado inválido');

        const assignFirst = await patch(`/api/v1/pedidos/${pedidoId}/motorizado`, {
            motorizadoId: riderA1Id,
        }, tenantA.token);
        expectStatus(assignFirst, 200);
        expect(assignFirst.body.pedido.motorizadoId).toBe(riderA1Id);
        expect(Object.keys(assignFirst.body.pedido.motorizado).sort()).toEqual([
            'activo',
            'calificacionPromedio',
            'id',
            'nombre',
            'telefono',
            'tipoFlota',
            'vehiculoPlaca',
            'zonaCobertura',
        ]);

        const illegalDispatch = await patch(`/api/v1/pedidos/${pedidoId}/estado`, {
            estado: 'en_camino',
        }, tenantA.token);
        expectStatus(illegalDispatch, 409);
        expect(illegalDispatch.body.code).toBe('PEDIDO_INVALID_STATE_TRANSITION');
        expect(illegalDispatch.body.error).toContain('pendiente a en_camino');

        const prepared = await patch(`/api/v1/pedidos/${pedidoId}/estado`, {
            estado: 'preparando',
        }, tenantA.token);
        expectStatus(prepared, 200);
        expect(prepared.body.pedido.estado).toBe('preparando');
        expect(await currentProductStock()).toBe(8);

        const unassign = await patch(`/api/v1/pedidos/${pedidoId}/motorizado`, {
            motorizadoId: null,
        }, tenantA.token);
        expectStatus(unassign, 200);
        expect(unassign.body.pedido.motorizadoId).toBeNull();

        const noRiderDispatch = await patch(`/api/v1/pedidos/${pedidoId}/estado`, {
            estado: 'en_camino',
        }, tenantA.token);
        expectStatus(noRiderDispatch, 409);
        expect(noRiderDispatch.body.error).toContain('Asigná un motorizado');

        const reassign = await patch(`/api/v1/pedidos/${pedidoId}/motorizado`, {
            motorizadoId: riderA2Id,
        }, tenantA.token);
        expectStatus(reassign, 200);
        expect(reassign.body.pedido.motorizadoId).toBe(riderA2Id);

        const enCamino = await patch(`/api/v1/pedidos/${pedidoId}/estado`, {
            estado: 'en_camino',
        }, tenantA.token);
        expectStatus(enCamino, 200);
        expect(enCamino.body.pedido.estado).toBe('en_camino');

        const canceled = await patch(`/api/v1/pedidos/${pedidoId}/estado`, {
            estado: 'cancelado',
            nota: 'Cancelación QA antes de entregar',
        }, tenantA.token);
        expectStatus(canceled, 200);
        expect(canceled.body.pedido.estado).toBe('cancelado');
        expect(canceled.body.idempotentReplay).toBe(false);
        expect(canceled.body.releasedQuantity).toBe('2.0000');
        expect(await currentProductStock()).toBe(10);

        const replay = await patch(`/api/v1/pedidos/${pedidoId}/estado`, {
            estado: 'cancelado',
            nota: 'Replay de cancelación QA',
        }, tenantA.token);
        expectStatus(replay, 200);
        expect(replay.body.pedido.estado).toBe('cancelado');
        expect(replay.body.idempotentReplay).toBe(true);
        expect(replay.body.releasedQuantity).toBe('0');
        expect(await currentProductStock()).toBe(10);

        const detail = await get(`/api/v1/pedidos/${pedidoId}`, tenantA.token);
        expectStatus(detail, 200);
        expect(detail.body.pedido.facturaId).toBeNull();
        expect(detail.body.pedido.motorizadoId).toBe(riderA2Id);

        const [salesAfter, paymentsAfter, journalAfter] = await Promise.all([
            prisma.sale.count({ where: { tenantId: tenantA.tenantId } }),
            prisma.payment.count({ where: { sale: { tenantId: tenantA.tenantId } } }),
            prisma.journalEntry.count({ where: { tenantId: tenantA.tenantId } }),
        ]);
        expect(salesAfter).toBe(baselineSales);
        expect(paymentsAfter).toBe(baselinePayments);
        expect(journalAfter).toBe(baselineJournalEntries);

        const kardex = await prisma.kardexMovement.findMany({
            where: {
                tenantId: tenantA.tenantId,
                productId,
                referenceId: pedidoId,
                referenceType: { in: ['PEDIDO_RESERVA', 'PEDIDO_LIBERACION'] },
            },
            orderBy: [{ date: 'asc' }, { id: 'asc' }],
            select: {
                referenceType: true,
                quantity: true,
                stockBefore: true,
                stockAfter: true,
                warehouseId: true,
            },
        });
        expect(kardex).toHaveLength(2);
        expect(kardex.map((movement) => movement.referenceType)).toEqual([
            'PEDIDO_RESERVA',
            'PEDIDO_LIBERACION',
        ]);
        expect(Number(kardex[0].quantity)).toBe(-2);
        expect(Number(kardex[0].stockBefore)).toBe(10);
        expect(Number(kardex[0].stockAfter)).toBe(8);
        expect(Number(kardex[1].quantity)).toBe(2);
        expect(Number(kardex[1].stockBefore)).toBe(8);
        expect(Number(kardex[1].stockAfter)).toBe(10);
        expect(typeof kardex[0].warehouseId).toBe('string');

        const tracking = await prisma.trackingEvento.findMany({
            where: { pedidoId },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: { estado: true, nota: true },
        });
        expect(tracking.map((event) => event.estado)).toEqual([
            'pendiente',
            'pendiente',
            'preparando',
            'preparando',
            'preparando',
            'en_camino',
            'cancelado',
        ]);
        expect(tracking[0].nota).toContain('Pedido recibido');
        expect(tracking[1].nota).toBe('Motorizado asignado.');
        expect(tracking[3].nota).toBe('Asignación de motorizado removida.');
        expect(tracking[4].nota).toBe('Motorizado asignado.');

        const audit = await prisma.auditLog.findFirst({
            where: {
                tenantId: tenantA.tenantId,
                action: 'PEDIDO_CANCELLED',
                details: { contains: pedidoId },
            },
            orderBy: { createdAt: 'desc' },
            select: { details: true },
        });
        expect(audit).toBeTruthy();
        expect(audit?.details).toContain('"releasedQuantity":"2.0000"');

        const customerSales = await prisma.sale.count({
            where: {
                tenantId: tenantA.tenantId,
                customerName,
            },
        });
        expect(customerSales).toBe(0);
    }, 180_000);
});
