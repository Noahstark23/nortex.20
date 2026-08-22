import { Prisma } from '@prisma/client';

/**
 * Proyección pública deliberadamente mínima. TrackingEvento guarda notas y GPS
 * para auditoría interna, pero esos campos nunca atraviesan esta frontera.
 */
export const PUBLIC_PEDIDO_TRACKING_SELECT = {
    estado: true,
    createdAt: true,
    eventos: {
        orderBy: { createdAt: 'desc' },
        select: {
            estado: true,
            createdAt: true,
        },
    },
    motorizado: {
        select: { nombre: true },
    },
} as const satisfies Prisma.PedidoSelect;

type PublicPedidoTrackingRow = Prisma.PedidoGetPayload<{
    select: typeof PUBLIC_PEDIDO_TRACKING_SELECT;
}>;

export type PublicPedidoTrackingDto = {
    estado: string;
    createdAt: Date;
    eventos: Array<{ estado: string; createdAt: Date }>;
    motorizado: { nombre: string } | null;
};

export function toPublicPedidoTrackingDto(
    pedido: PublicPedidoTrackingRow,
): PublicPedidoTrackingDto {
    return {
        estado: pedido.estado,
        createdAt: pedido.createdAt,
        eventos: pedido.eventos.map((evento) => ({
            estado: evento.estado,
            createdAt: evento.createdAt,
        })),
        motorizado: pedido.motorizado ? { nombre: pedido.motorizado.nombre } : null,
    };
}
