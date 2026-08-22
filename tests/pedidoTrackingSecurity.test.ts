import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toPublicPedidoTrackingDto } from '../backend/services/pedidoTrackingService';

const routeSource = readFileSync('backend/routes/pedidos.ts', 'utf8');
const trackingComponentSource = readFileSync('components/TrackPedido.tsx', 'utf8');
const fulfillmentSource = readFileSync('backend/services/pedidoFulfillmentService.ts', 'utf8');

const between = (source: string, start: string, end: string): string => {
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex + start.length);
    return source.slice(startIndex, endIndex === -1 ? undefined : endIndex);
};

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.resetModules();
});

describe('capacidad pública de tracking', () => {
    it('queda ligada a pedido y tenant, expira y no puede usarse como sesión', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-22T12:00:00.000Z'));
        vi.stubEnv('JWT_SECRETS', 'tracking-test-secret-with-enough-entropy');
        const {
            signPedidoTrackingToken,
            verifyAuthToken,
            verifyPedidoTrackingToken,
        } = await import('../backend/services/secrets');

        const token = signPedidoTrackingToken('pedido-a', 'tenant-a');
        expect(verifyPedidoTrackingToken(token, 'pedido-a')).toEqual({
            pedidoId: 'pedido-a',
            tenantId: 'tenant-a',
            kind: 'PEDIDO_TRACKING',
        });
        expect(() => verifyPedidoTrackingToken(token, 'pedido-b')).toThrow();
        expect(() => verifyAuthToken(token)).toThrow();

        const [header, payload, signature] = token.split('.');
        const changed = signature[0] === 'a' ? 'b' : 'a';
        const tampered = `${header}.${payload}.${changed}${signature.slice(1)}`;
        expect(() => verifyPedidoTrackingToken(tampered, 'pedido-a')).toThrow();

        vi.setSystemTime(new Date('2026-08-30T12:00:01.000Z'));
        expect(() => verifyPedidoTrackingToken(token, 'pedido-a')).toThrowError(
            expect.objectContaining({ name: 'TokenExpiredError' }),
        );
    });

    it('proyecta solo estado, fechas y nombre público del conductor', () => {
        const dto = toPublicPedidoTrackingDto({
            estado: 'en_camino',
            createdAt: new Date('2026-08-22T12:00:00.000Z'),
            clienteNombre: 'Nombre Completo',
            clienteTelefono: '88888888',
            direccionEntrega: 'dirección privada',
            motorizado: { nombre: 'Repartidor', telefono: '87777777' },
            eventos: [{
                estado: 'en_camino',
                createdAt: new Date('2026-08-22T12:10:00.000Z'),
                nota: 'nota interna',
                lat: 12.1,
                lng: -86.2,
            }],
        } as any);

        expect(dto).toEqual({
            estado: 'en_camino',
            createdAt: new Date('2026-08-22T12:00:00.000Z'),
            motorizado: { nombre: 'Repartidor' },
            eventos: [{
                estado: 'en_camino',
                createdAt: new Date('2026-08-22T12:10:00.000Z'),
            }],
        });
        expect(JSON.stringify(dto)).not.toMatch(/Nombre Completo|88888888|87777777|nota interna|12\.1|-86\.2/);
    });

    it('el endpoint falla cerrado sin header y consulta después de verificar la capacidad', () => {
        const trackingRoute = between(
            routeSource,
            "router.get('/:id/tracking'",
            "router.patch('/:id/estado'",
        );
        expect(trackingRoute).toContain("req.get('x-pedido-tracking-token')");
        expect(trackingRoute).toContain('verifyPedidoTrackingToken(token, id)');
        expect(trackingRoute.indexOf('verifyPedidoTrackingToken(token, id)')).toBeLessThan(
            trackingRoute.indexOf('prisma.pedido.findFirst'),
        );
        expect(trackingRoute).toContain('tenantId: capability.tenantId');
        expect(trackingRoute).toContain('PUBLIC_PEDIDO_TRACKING_SELECT');
        expect(trackingRoute).not.toMatch(/clienteNombre|clienteTelefono|telefono: true|nota: true|lat: true|lng: true/);

        expect(trackingComponentSource).toContain("headers: { 'X-Pedido-Tracking-Token': trackingToken }");
        expect(trackingComponentSource).not.toContain('href={`tel:${data.motorizado.telefono}`}');
    });
});

describe('serialización de fulfillment', () => {
    const operations: Array<[string, string, string | null]> = [
        ['reserva', 'export async function reservePedidoInTransaction', 'type PedidoReservationMovement'],
        ['cancelación', 'export async function cancelPedidoInTransaction', 'const accountingUserForTenant'],
        ['entrega', 'export async function completePedidoDeliveryInTransaction', null],
    ];

    it.each(operations)('%s toma Pedido antes de su primer snapshot', (_name, start, end) => {
        const operation = end
            ? between(fulfillmentSource, start, end)
            : fulfillmentSource.slice(fulfillmentSource.indexOf(start));
        const lockCall = operation.indexOf(
            start.includes('complete') ? 'await claimPedidoDelivery(tx, params)' : 'await lockPedidoForFulfillment',
        );
        expect(lockCall).toBeGreaterThan(-1);
        expect(lockCall).toBeLessThan(operation.indexOf('tx.pedido.findFirst'));
    });

    it('usa el mismo lock de Pedido antes de Product/stock/lotes', () => {
        const lockHelper = between(
            fulfillmentSource,
            'export async function lockPedidoForFulfillment',
            'export const validatePedidoReservationTotals',
        );
        expect(lockHelper).toContain('SELECT id FROM');
        expect(lockHelper).toContain('Pedido');
        expect(lockHelper).toContain('FOR UPDATE');
        expect(fulfillmentSource).toContain('Pedido → Product/warehouse stock → ProductBatch → Kardex');
        expect(fulfillmentSource).toContain('.sort((left, right) => (');
    });
});
