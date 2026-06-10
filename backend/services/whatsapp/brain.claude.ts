/**
 * NORTEX — WhatsApp · ClaudeBrain (tool-calling real).
 *
 * Carga perezosa desde agent.createBrain() solo si WHATSAPP_LLM=claude.
 * Usa @anthropic-ai/sdk (ya en dependencias). Loop acotado de tool-use:
 * el modelo elige tools → el servidor las ejecuta con el ToolContext seguro
 * → se devuelve el resultado → hasta end_turn o tope de iteraciones.
 *
 * El modelo nunca ve ni fija tenantId/customerId: van en el ToolContext del
 * servidor. El system prompt restringe el dominio (tienda, no asesoría general).
 */

import Anthropic from '@anthropic-ai/sdk';
import { AgentBrain, AgentInput, AgentReply } from './agent';
import { toolsForScope } from './tools';

const MODEL = process.env.WHATSAPP_LLM_MODEL || 'claude-haiku-4-5-20251001';
const MAX_TOOL_ITERATIONS = 4;

export class ClaudeBrain implements AgentBrain {
    private readonly client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    async reply(input: AgentInput): Promise<AgentReply> {
        const tools = toolsForScope(input.ctx.botScope);
        const sdkTools: Anthropic.Tool[] = tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.jsonSchema as Anthropic.Tool.InputSchema,
        }));

        const system =
            `Sos el asistente de WhatsApp de "${input.businessName}", una tienda en Nicaragua. ` +
            `Respondé en español nicaragüense, breve y cordial. Usá SOLO las herramientas para datos ` +
            `de inventario, deuda o ventas; nunca inventes precios ni stock. Si el cliente pide hablar ` +
            `con una persona o se muestra molesto, respondé exactamente "[HANDOFF]". ` +
            (input.customerName ? `El cliente se llama ${input.customerName}.` : `El cliente aún no está registrado.`);

        const messages: Anthropic.MessageParam[] = [{ role: 'user', content: input.text }];

        for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
            const response = await this.client.messages.create({
                model: MODEL,
                max_tokens: 700,
                system,
                tools: sdkTools,
                messages,
            });

            const toolUses = response.content.filter(
                (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
            );

            if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
                const text = response.content
                    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
                    .map((b) => b.text)
                    .join('\n')
                    .trim();
                if (text.includes('[HANDOFF]')) {
                    return { text: 'Te paso con un asesor de la tienda, en un momento te responden. 🙌', handoff: true };
                }
                return { text: text || 'Disculpá, no te entendí. ¿Podés reformularlo?', handoff: false };
            }

            // Ejecutar tools y devolver resultados al modelo.
            // Cast acotado al borde del SDK (ContentBlock → ContentBlockParam).
            messages.push({ role: 'assistant', content: response.content as Anthropic.ContentBlockParam[] });
            const results: Anthropic.ToolResultBlockParam[] = [];
            for (const use of toolUses) {
                const tool = tools.find((t) => t.name === use.name);
                let content = 'Herramienta no disponible.';
                if (tool) {
                    try {
                        content = await tool.run(input.ctx, use.input);
                    } catch (err) {
                        console.error(`🟥 [wa-claude-tool:${use.name}]`, err);
                        content = 'Error ejecutando la herramienta.';
                    }
                }
                results.push({ type: 'tool_result', tool_use_id: use.id, content });
            }
            messages.push({ role: 'user', content: results });
        }

        return { text: 'Estoy teniendo problemas para completar tu consulta. ¿Querés que te pase con un asesor?', handoff: false };
    }
}
