/**
 * NORTEX — simulador de conversaciones del agente WhatsApp (sin Meta).
 *
 * Corre el cerebro REAL (MenuBot o Claude según WHATSAPP_LLM) con las tools
 * REALES contra la BD REAL, construyendo el ToolContext igual que lo haría el
 * servidor — pero sin webhook, sin cola y sin enviar nada a WhatsApp.
 *
 * Uso (requiere MySQL arriba; ver skill run-nortex):
 *   DATABASE_URL="mysql://nortex:nortex123@localhost:3306/nortex" \
 *     npx tsx .claude/skills/nortex-rag/sim.ts <tenantId|email> "hola || ¿tenés gaseosa?"
 *
 *   - 1er argumento: tenantId, o el email de un usuario (si contiene "@")
 *     para resolver su tenant.
 *   - 2do argumento: mensajes separados por "||" — se procesan en orden y el
 *     historial se acumula (prueba la memoria conversacional).
 *   - --scope B2C|B2B|BOTH  (default B2C)
 *   - --customer <id>       (simula un cliente vinculado del MISMO tenant)
 *   - WHATSAPP_LLM=claude + ANTHROPIC_API_KEY → usa ClaudeBrain.
 *
 * Este script NUNCA acepta que el "cliente" fije el tenant: lo resolvés vos al
 * invocarlo, igual que identity.ts lo resuelve del canal. Es una herramienta de
 * desarrollo; no exponerla como endpoint.
 */

import { prisma } from '../../../backend/services/whatsapp/db';
import { createBrain, AgentTurn } from '../../../backend/services/whatsapp/agent';
import { ToolContext } from '../../../backend/services/whatsapp/tools';

function parseArgs(argv: string[]): { who: string; script: string; scope: string; customerId: string | null } {
    const positional: string[] = [];
    let scope = 'B2C';
    let customerId: string | null = null;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--scope') scope = argv[++i] ?? 'B2C';
        else if (a === '--customer') customerId = argv[++i] ?? null;
        else positional.push(a);
    }
    const [who, script] = positional;
    if (!who || !script) {
        console.error('Uso: npx tsx .claude/skills/nortex-rag/sim.ts <tenantId|email> "msj1 || msj2" [--scope B2C|B2B|BOTH] [--customer <id>]');
        process.exit(1);
    }
    if (!['B2C', 'B2B', 'BOTH'].includes(scope)) {
        console.error(`--scope inválido: ${scope} (usar B2C | B2B | BOTH)`);
        process.exit(1);
    }
    return { who, script, scope, customerId };
}

async function resolveTenant(who: string): Promise<{ tenantId: string; businessName: string }> {
    if (who.includes('@')) {
        const user = await prisma.user.findFirst({
            where: { email: who },
            select: { tenantId: true, tenant: { select: { businessName: true } } },
        });
        if (!user?.tenantId) {
            console.error(`No hay usuario con email ${who}`);
            process.exit(1);
        }
        return { tenantId: user.tenantId, businessName: user.tenant?.businessName ?? 'la tienda' };
    }
    const tenant = await prisma.tenant.findUnique({
        where: { id: who },
        select: { id: true, businessName: true },
    });
    if (!tenant) {
        console.error(`No existe el tenant ${who}`);
        process.exit(1);
    }
    return { tenantId: tenant.id, businessName: tenant.businessName };
}

async function main(): Promise<void> {
    const { who, script, scope, customerId } = parseArgs(process.argv.slice(2));
    const { tenantId, businessName } = await resolveTenant(who);

    // Si simulamos un cliente vinculado, verificar que sea del MISMO tenant
    // (el simulador respeta el principio de identity.ts).
    let customerName: string | null = null;
    if (customerId) {
        const customer = await prisma.customer.findFirst({
            where: { id: customerId, tenantId },
            select: { name: true },
        });
        if (!customer) {
            console.error(`El customer ${customerId} no existe en el tenant ${tenantId} — no se simula identidad cruzada.`);
            process.exit(1);
        }
        customerName = customer.name;
    }

    const ctx: ToolContext = { tenantId, customerId, botScope: scope };
    const brain = await createBrain();
    const brainName = process.env.WHATSAPP_LLM === 'claude' && process.env.ANTHROPIC_API_KEY ? 'ClaudeBrain' : 'MenuBotBrain';

    console.log(`── sim: tenant=${tenantId} (${businessName}) · scope=${scope} · customer=${customerId ?? '—'} · cerebro=${brainName} ──\n`);

    const history: AgentTurn[] = [];
    const messages = script.split('||').map((m) => m.trim()).filter(Boolean);

    for (const text of messages) {
        console.log(`👤 ${text}`);
        const t0 = Date.now();
        const reply = await brain.reply({ text, ctx, customerName, businessName, history });
        const ms = Date.now() - t0;
        console.log(`🤖 ${reply.text}`);
        console.log(`   (handoff=${reply.handoff} · ${ms}ms)\n`);
        history.push({ role: 'user', text });
        history.push({ role: 'assistant', text: reply.text });
    }

    await prisma.$disconnect();
}

main().catch((err) => {
    console.error('sim falló:', err);
    process.exit(1);
});
