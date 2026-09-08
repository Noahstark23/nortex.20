import type Anthropic from '@anthropic-ai/sdk';
import type { PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAssistantLanguage } from '../backend/services/assistant/language';
import type { reserveAssistantBudget, settleAssistantBudget } from '../backend/services/assistant/budget';

const principal = { tenantId: 'tenant-a', userId: 'user-a', role: 'OWNER' };
const validPlan = { intent: 'sales', query: 'Ventas del día anterior', startDate: '2026-08-30', endDate: '2026-08-30' };

function harness(plan: unknown = validPlan) {
    const response = {
        id: 'response-a', stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tool-a', name: 'interpretar_consulta', input: plan }],
        usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    };
    const create = vi.fn(async (_request: unknown, _options?: unknown) => response);
    const reserve = vi.fn(async (_principal: unknown, _amount?: unknown, _deps?: unknown) => ({ id: 'usage-a' }));
    const settle = vi.fn(async (_principal: unknown, _id: string, _usage: unknown, _deps?: unknown) => undefined);
    const db = {
        user: { findFirst: vi.fn().mockResolvedValue({ id: 'user-a', role: 'OWNER', status: 'ACTIVE' }) },
        assistantTenantConfig: { findUnique: vi.fn().mockResolvedValue({ enabled: true }) },
        // Un plan de lenguaje sólo consulta autorización; jamás invoca autoridad financiera.
        purchase: { create: vi.fn() }, $executeRaw: vi.fn(), $queryRaw: vi.fn(),
    };
    const interpret = createAssistantLanguage({
        db: db as unknown as PrismaClient,
        client: { messages: { create } } as unknown as Pick<Anthropic, 'messages'>,
        reserve: reserve as unknown as typeof reserveAssistantBudget,
        settle: settle as unknown as typeof settleAssistantBudget,
        now: () => new Date('2026-09-01T04:00:00.000Z'),
    });
    return { interpret, create, reserve, settle, db, response };
}

beforeEach(() => {
    vi.stubEnv('NORTEX_ASSISTANT_ENABLED', 'true');
    vi.stubEnv('NORTEX_ASSISTANT_LANGUAGE_ENABLED', 'true');
    vi.stubEnv('NORTEX_ASSISTANT_EXTRACTION_ENABLED', 'false');
    vi.stubEnv('NORTEX_ASSISTANT_EXECUTION_ENABLED', 'false');
});
afterEach(() => vi.unstubAllEnvs());

describe('NortexGPT: interpretación opcional con límites y autoridad cerrada', () => {
    it.each(['false', '', undefined])('flag %s hace cero consultas y cero llamadas pagadas', async flag => {
        vi.stubEnv('NORTEX_ASSISTANT_LANGUAGE_ENABLED', flag);
        const { interpret, create, reserve, settle, db } = harness();
        expect(await interpret(principal, '¿Cómo fue ayer?')).toBeNull();
        for (const operation of [create, reserve, settle, db.user.findFirst, db.$queryRaw, db.purchase.create]) expect(operation).not.toHaveBeenCalled();
    });

    it('interpreta con Haiku sin retries ocultos y liquida el consumo con la identidad del servidor', async () => {
        const { interpret, create, reserve, settle, db } = harness();
        expect(await interpret(principal, '¿Cuánto vendimos ayer?')).toEqual(validPlan);
        expect(create).toHaveBeenCalledTimes(1);
        const [request, options] = create.mock.calls[0] as [Anthropic.MessageCreateParamsNonStreaming, unknown];
        expect(request).toMatchObject({ model: 'claude-haiku-4-5-20251001', max_tokens: 1024, temperature: 0,
            tool_choice: { type: 'tool', name: 'interpretar_consulta', disable_parallel_tool_use: true } });
        expect(request.system).toContain('2026-08-31');
        expect(request.tools?.map(tool => tool.name)).toEqual(['interpretar_consulta']);
        expect(options).toEqual({ timeout: 30_000, maxRetries: 0 });
        expect(reserve).toHaveBeenCalledExactlyOnceWith(principal, undefined, expect.objectContaining({ capability: 'help', db }));
        expect(settle).toHaveBeenCalledExactlyOnceWith(principal, 'usage-a', { inputTokens: 100, outputTokens: 50, requestId: 'response-a' }, expect.objectContaining({ capability: 'help' }));
        expect(db.user.findFirst).toHaveBeenCalledTimes(2);
        expect(db.purchase.create).not.toHaveBeenCalled();
        expect(db.$executeRaw).not.toHaveBeenCalled();
    });

    it.each([
        { ...validPlan, tenantId: 'tenant-b' },
        { ...validPlan, userId: 'user-b' },
        { ...validPlan, sql: 'DELETE FROM Sale' },
        { ...validPlan, mutation: { purchaseId: 'p-1' } },
        { ...validPlan, intent: 'confirm' },
        { ...validPlan, intent: 'execute_purchase' },
        { ...validPlan, startDate: '2026-02-30' },
        { ...validPlan, query: 'x'.repeat(4001) },
    ])('rechaza plan que intenta ampliar el contrato: %j', async plan => {
        const { interpret, create, settle, db } = harness(plan);
        expect(await interpret(principal, 'Hacé lo pedido')).toBeNull();
        expect(create).toHaveBeenCalledTimes(1);
        expect(settle).toHaveBeenCalledTimes(1);
        expect(db.purchase.create).not.toHaveBeenCalled();
        expect(db.$queryRaw).not.toHaveBeenCalled();
        expect(db.$executeRaw).not.toHaveBeenCalled();
    });

    it('un pedido de registrar produce prepare sin compra ni confirmación', async () => {
        const plan = { intent: 'prepare', query: 'Registrar una compra desde una factura' };
        const { interpret, db } = harness(plan);
        expect(await interpret(principal, 'Sí, registrala')).toEqual(plan);
        expect(db.purchase.create).not.toHaveBeenCalled();
        expect(db.$executeRaw).not.toHaveBeenCalled();
    });

    it('acepta hechos tipados para preparar sin IDs ni recepción o pago implícitos',async()=>{
        const plan={intent:'purchase_intake',query:'Compré 50 bolsas de cemento',purchaseFacts:[{field:'quantity',value:'50',suppliedText:'50 bolsas'},{field:'unitText',value:'bolsas',suppliedText:'50 bolsas'}]};
        const {interpret,db}=harness(plan);expect(await interpret(principal,'Compré 50 bolsas de cemento')).toEqual(plan);
        expect(db.purchase.create).not.toHaveBeenCalled();expect(db.$executeRaw).not.toHaveBeenCalled();
    });
    it.each([
        {field:'productId',value:'p1',suppliedText:'cemento'},
        {field:'receivedConfirmed',value:'true',suppliedText:'sí'},
        {field:'paymentConfirmed',value:'true',suppliedText:'sí'},
        {field:'unitCost',value:'230',suppliedText:'230',tenantId:'other'},
        {field:'unitCost',value:'230'},
    ])('rechaza capacidades o respaldo incompleto dentro de hechos %j',async fact=>{
        const {interpret}=harness({intent:'purchase_intake',query:'Preparar',purchaseFacts:[fact]});expect(await interpret(principal,'Preparar')).toBeNull();
    });
    it('rechaza más de 20 hechos y hechos enviados con otra intención',async()=>{
        const fact={field:'quantity',value:'50',suppliedText:'50 bolsas'};
        expect(await harness({intent:'purchase_intake',query:'Preparar',purchaseFacts:Array(21).fill(fact)}).interpret(principal,'Preparar')).toBeNull();
        expect(await harness({...validPlan,purchaseFacts:[fact]}).interpret(principal,'Ventas')).toBeNull();
    });

    it('limita historial a las últimas cuatro preguntas y cada texto a 4000 caracteres', async () => {
        const { interpret, create } = harness();
        await interpret(principal, 'q'.repeat(5000), ['descartar-1', 'descartar-2', 'x'.repeat(5000), 'h-4', 'h-5', 'h-6']);
        const request = create.mock.calls[0][0] as Anthropic.MessageCreateParamsNonStreaming;
        expect(request.messages).toHaveLength(1);
        expect(request.messages[0].role).toBe('user');
        const payload = JSON.parse(request.messages[0].content as string);
        expect(payload).toEqual({ preguntasAnteriores: ['x'.repeat(4000), 'h-4', 'h-5', 'h-6'], pregunta: 'q'.repeat(4000) });
        expect(Object.keys(payload)).toEqual(['preguntasAnteriores', 'pregunta']);
        expect(JSON.stringify(request)).not.toContain('tenant-a');
        expect(JSON.stringify(request)).not.toContain('user-a');
    });

    it.each(['max_tokens', 'end_turn'])('respuesta inconclusa %s liquida consumo sin aceptar un plan', async stopReason => {
        const { interpret, response, settle } = harness();
        response.stop_reason = stopReason;
        expect(await interpret(principal, 'Ventas')).toBeNull();
        expect(settle).toHaveBeenCalledTimes(1);
    });

    it('múltiples herramientas o herramienta distinta no se ejecutan', async () => {
        const { interpret, response, db } = harness();
        response.content.push({ type: 'tool_use', id: 'tool-b', name: 'registrar_compra', input: validPlan });
        expect(await interpret(principal, 'Venta')).toBeNull();
        expect(db.purchase.create).not.toHaveBeenCalled();
    });

    it('consumo cache desconocido conserva reserva y no devuelve plan', async () => {
        const { interpret, response, settle } = harness();
        response.usage.cache_read_input_tokens = 10;
        expect(await interpret(principal, 'Ventas')).toBeNull();
        expect(settle).toHaveBeenCalledExactlyOnceWith(principal, 'usage-a', null, expect.objectContaining({ capability: 'help' }));
    });

    it('fallo del proveedor registra consumo desconocido sin retry ni acción', async () => {
        const { interpret, create, settle, db } = harness();
        create.mockRejectedValue(new Error('provider timeout'));
        expect(await interpret(principal, 'Registrá')).toBeNull();
        expect(create).toHaveBeenCalledTimes(1);
        expect(settle).toHaveBeenCalledExactlyOnceWith(principal, 'usage-a', null, expect.any(Object));
        expect(db.purchase.create).not.toHaveBeenCalled();
    });

    it('presupuesto agotado bloquea antes de llamar al proveedor', async () => {
        const { interpret, reserve, create, settle, db } = harness();
        reserve.mockRejectedValue(Object.assign(new Error('budget'), { code: 'BUDGET_EXHAUSTED' }));
        await expect(interpret(principal, 'Registrá')).rejects.toMatchObject({ code: 'BUDGET_EXHAUSTED' });
        expect(create).not.toHaveBeenCalled();
        expect(settle).not.toHaveBeenCalled();
        expect(db.purchase.create).not.toHaveBeenCalled();
    });

    it('fallo al liquidar conserva resultado como desconocido y descarta el plan', async () => {
        const { interpret, settle, db } = harness();
        settle.mockRejectedValueOnce(new Error('ledger unavailable')).mockResolvedValueOnce(undefined);
        expect(await interpret(principal, 'Ventas')).toBeNull();
        expect(settle).toHaveBeenCalledTimes(2);
        expect(settle.mock.calls[1][2]).toBeNull();
        expect(db.purchase.create).not.toHaveBeenCalled();
    });

    it('si tampoco se puede registrar desconocido, falla cerrado sin resultado ni acción', async () => {
        const { interpret, settle, db } = harness();
        settle.mockRejectedValue(new Error('ledger unavailable'));
        await expect(interpret(principal, 'Ventas')).rejects.toThrow('ledger unavailable');
        expect(db.purchase.create).not.toHaveBeenCalled();
    });

    it('revocar el usuario mientras responde el proveedor descarta su plan', async () => {
        const { interpret, db } = harness();
        db.user.findFirst.mockResolvedValueOnce({ id: 'user-a', role: 'OWNER', status: 'ACTIVE' })
            .mockResolvedValueOnce({ id: 'user-a', role: 'OWNER', status: 'DISABLED' });
        expect(await interpret(principal, 'Ventas')).toBeNull();
    });

    it('usuario ya revocado no consume presupuesto ni llama al proveedor', async () => {
        const { interpret, db, reserve, create } = harness();
        db.user.findFirst.mockResolvedValue(null);
        await expect(interpret(principal, 'Ventas')).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
        expect(reserve).not.toHaveBeenCalled();
        expect(create).not.toHaveBeenCalled();
    });
});
