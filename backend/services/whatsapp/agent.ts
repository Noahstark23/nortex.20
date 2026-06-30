/**
 * NORTEX — WhatsApp · agente (orquestador).
 *
 * AgentBrain es la costura del "cerebro". Dos implementaciones:
 *  - MenuBotBrain (default): enrutador de intención determinístico. Funciona
 *    SIN API key de LLM → la infraestructura es end-to-end desde el día 1.
 *  - ClaudeBrain (opcional): tool-calling real con @anthropic-ai/sdk. Se carga
 *    de forma perezosa solo si WHATSAPP_LLM=claude (ver createBrain).
 *
 * El brain NUNCA recibe ni infiere tenantId/customerId: se los inyecta el
 * servidor en el ToolContext (identity.ts). El brain solo elige QUÉ tool correr.
 */

import { AgentTool, ToolContext, toolsForScope } from './tools';

export interface AgentTurn {
    role: 'user' | 'assistant';
    text: string;
}

export interface AgentInput {
    text: string;
    ctx: ToolContext;
    customerName: string | null;
    businessName: string;
    /** Turnos previos de la conversación (cronológico). Lo usa ClaudeBrain; MenuBot lo ignora. */
    history?: AgentTurn[];
}

export interface AgentReply {
    text: string;
    handoff: boolean; // true → pausar el bot y avisar a un humano
}

export interface AgentBrain {
    reply(input: AgentInput): Promise<AgentReply>;
}

const HANDOFF_RX = /\b(humano|asesor|persona|representante|operador|alguien real)\b/i;
const GREETING_RX = /\b(hola|buenas|buenos d[ií]as|buenas tardes|men[uú]|ayuda|hi)\b/i;
const DEUDA_RX = /\b(deuda|saldo|debo|cu[aá]nto debo|cr[eé]dito)\b/i;
const VENTAS_RX = /\b(ventas?|vend[ií]|cu[aá]nto vend|caja de hoy|ingresos? de hoy)\b/i;

function menu(businessName: string, tools: AgentTool[]): string {
    const opciones: string[] = [];
    if (tools.some((t) => t.name === 'buscar_producto')) opciones.push('🔎 Escribí lo que buscás y te digo precio y disponibilidad.');
    if (tools.some((t) => t.name === 'consultar_deuda')) opciones.push('💳 "saldo" — consultá tu deuda.');
    if (tools.some((t) => t.name === 'ventas_hoy')) opciones.push('📊 "ventas hoy" — resumen del día.');
    opciones.push('🧑‍💼 "asesor" — hablar con una persona.');
    return `¡Hola! Soy el asistente de ${businessName}.\n${opciones.join('\n')}`;
}

/**
 * Cerebro determinístico (sin LLM). Cubre los intents principales con regex y
 * delega en las mismas tools que usaría el LLM → al enchufar Claude no cambia
 * nada del resto de la infraestructura.
 */
export class MenuBotBrain implements AgentBrain {
    async reply(input: AgentInput): Promise<AgentReply> {
        const tools = toolsForScope(input.ctx.botScope);
        const text = input.text.trim();

        if (HANDOFF_RX.test(text)) {
            return { text: 'Dale, te paso con un asesor de la tienda. En un momento te responden por aquí. 🙌', handoff: true };
        }

        const isB2B = input.ctx.botScope === 'B2B' || input.ctx.botScope === 'BOTH';
        if (isB2B && VENTAS_RX.test(text) && tools.some((t) => t.name === 'ventas_hoy')) {
            return { text: await this.runTool(tools, 'ventas_hoy', input.ctx, {}), handoff: false };
        }
        if (DEUDA_RX.test(text) && tools.some((t) => t.name === 'consultar_deuda')) {
            return { text: await this.runTool(tools, 'consultar_deuda', input.ctx, {}), handoff: false };
        }
        if (GREETING_RX.test(text) || text.length < 3) {
            return { text: menu(input.businessName, tools), handoff: false };
        }
        // Por defecto: buscar en el catálogo.
        if (tools.some((t) => t.name === 'buscar_producto')) {
            return { text: await this.runTool(tools, 'buscar_producto', input.ctx, { query: text }), handoff: false };
        }
        return { text: menu(input.businessName, tools), handoff: false };
    }

    private async runTool(tools: AgentTool[], name: string, ctx: ToolContext, args: unknown): Promise<string> {
        const tool = tools.find((t) => t.name === name);
        if (!tool) return 'Esa opción no está disponible por ahora.';
        try {
            return await tool.run(ctx, args);
        } catch (err) {
            console.error(`🟥 [wa-tool:${name}]`, err);
            return 'Tuve un problema procesando eso. ¿Lo intentamos de nuevo?';
        }
    }
}

/**
 * Selecciona el cerebro. Default = MenuBot (sin dependencias externas).
 * WHATSAPP_LLM=claude carga ClaudeBrain de forma perezosa (no impacta el
 * arranque ni el bundle si no se usa).
 */
export async function createBrain(): Promise<AgentBrain> {
    if (process.env.WHATSAPP_LLM === 'claude' && process.env.ANTHROPIC_API_KEY) {
        const { ClaudeBrain } = await import('./brain.claude');
        return new ClaudeBrain();
    }
    return new MenuBotBrain();
}
