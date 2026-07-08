/**
 * NORTEX — WhatsApp · registro de herramientas del agente.
 *
 * Cada tool:
 *  - declara su schema Zod (validación en runtime) y su JSON Schema (para el LLM).
 *  - recibe SIEMPRE el ToolContext con tenantId/customerId resueltos por el
 *    servidor (identity.ts). NUNCA acepta tenantId ni customerId del modelo ni
 *    del usuario → prompt injection no puede cruzar tenants ni clientes.
 *  - llama a datos tenant-scoped y devuelve texto listo para WhatsApp.
 *
 * `scope` filtra qué tools ve el agente según el canal (B2C/B2B/BOTH).
 */

import { z } from 'zod';
import Decimal from 'decimal.js';
import { prisma } from './db';
import { catalogRetriever } from './rag';

export interface ToolContext {
    tenantId: string;
    customerId: string | null;
    botScope: string; // B2C | B2B | BOTH
}

export interface AgentTool {
    name: string;
    description: string;
    scope: 'B2C' | 'B2B';
    zod: z.ZodTypeAny;
    jsonSchema: Record<string, unknown>;
    run(ctx: ToolContext, rawArgs: unknown): Promise<string>;
}

const money = (n: Decimal.Value) => `C$${new Decimal(n).toFixed(2)}`;

// ── consultarInventario ──────────────────────────────────────────────────────
const buscarProducto: AgentTool = {
    name: 'buscar_producto',
    description: 'Busca productos en el inventario de la tienda por nombre, categoría o código.',
    scope: 'B2C',
    zod: z.object({ query: z.string().min(1) }),
    jsonSchema: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Qué producto busca el cliente' } },
        required: ['query'],
    },
    async run(ctx, rawArgs) {
        const { query } = (this.zod as z.ZodType<{ query: string }>).parse(rawArgs);
        const publicOnly = ctx.botScope === 'B2C';
        const hits = await catalogRetriever.search(ctx.tenantId, query, { publicOnly, limit: 5 });
        if (hits.length === 0) {
            return `No encontré productos para "${query}". ¿Querés que lo busque de otra forma?`;
        }
        const lines = hits.map((h) => {
            const avail = h.stock > 0 ? `${h.stock} ${h.unit} disp.` : 'sin stock';
            return `• ${h.name} — ${money(h.price)} (${avail})`;
        });
        return `Esto es lo que tengo para "${query}":\n${lines.join('\n')}`;
    },
};

// ── consultarDeuda ───────────────────────────────────────────────────────────
const consultarDeuda: AgentTool = {
    name: 'consultar_deuda',
    description: 'Consulta el saldo de crédito (deuda) del cliente que está escribiendo.',
    scope: 'B2C',
    zod: z.object({}),
    jsonSchema: { type: 'object', properties: {} },
    async run(ctx) {
        if (!ctx.customerId) {
            return 'No tengo tu cuenta vinculada todavía. Acercate a la tienda para registrar tu número y poder consultar tu saldo. 🙏';
        }
        const customer = await prisma.customer.findFirst({
            where: { id: ctx.customerId, tenantId: ctx.tenantId },
            select: { name: true, currentDebt: true, creditLimit: true, isBlocked: true },
        });
        if (!customer) return 'No pude encontrar tu cuenta. Contactá a la tienda, por favor.';

        const debt = new Decimal(customer.currentDebt.toString());
        const limit = new Decimal(customer.creditLimit.toString());
        const availableRaw = limit.minus(debt);
        const available = availableRaw.lessThan(0) ? new Decimal(0) : availableRaw;
        if (debt.lessThanOrEqualTo(0)) return `${customer.name}, no tenés saldo pendiente. ¡Estás al día! ✅`;
        const blocked = customer.isBlocked ? '\n⚠️ Tu cuenta está bloqueada por mora; regularizá para seguir comprando a crédito.' : '';
        return `${customer.name}, tu saldo pendiente es ${money(debt)}.\nCrédito disponible: ${money(available)}.${blocked}`;
    },
};

// ── consultarVentasHoy (B2B: dueño) ─────────────────────────────────────────
const ventasHoy: AgentTool = {
    name: 'ventas_hoy',
    description: 'Resume las ventas del día de hoy del negocio (uso del dueño).',
    scope: 'B2B',
    zod: z.object({}),
    jsonSchema: { type: 'object', properties: {} },
    async run(ctx) {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const agg = await prisma.sale.aggregate({
            where: { tenantId: ctx.tenantId, createdAt: { gte: start }, status: { not: 'CANCELLED' } },
            _sum: { total: true },
            _count: { _all: true },
        });
        const total = new Decimal((agg._sum.total ?? 0).toString());
        const count = agg._count._all;
        if (count === 0) return 'Hoy todavía no hay ventas registradas.';
        return `📊 Hoy: ${count} ventas por un total de ${money(total)}.`;
    },
};

const ALL_TOOLS: AgentTool[] = [buscarProducto, consultarDeuda, ventasHoy];

/** Tools visibles para un canal según su scope. */
export function toolsForScope(botScope: string): AgentTool[] {
    if (botScope === 'BOTH') return ALL_TOOLS;
    if (botScope === 'B2B') return ALL_TOOLS.filter((t) => t.scope === 'B2B' || t.name === 'buscar_producto');
    return ALL_TOOLS.filter((t) => t.scope === 'B2C'); // B2C por defecto
}

export function getTool(name: string): AgentTool | undefined {
    return ALL_TOOLS.find((t) => t.name === name);
}
