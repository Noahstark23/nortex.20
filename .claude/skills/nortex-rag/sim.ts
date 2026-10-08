/**
 * NORTEX — simulador de conversaciones del agente WhatsApp (sin Meta).
 *
 * Corre MenuBot por defecto con las tools reales, pero SOLO contra una MySQL
 * temporal de QA marcada explícitamente. No abre webhooks, colas ni envíos a
 * WhatsApp. Claude es una excepción deliberada: requiere dos opt-ins separados
 * porque puede consumir la API externa de Anthropic.
 *
 * Uso seguro (datos sintéticos y BD descartable):
 *   NORTEX_RAG_SIM_QA=isolated \
 *   DATABASE_URL="mysql://qa:qa@127.0.0.1:3306/nortex_rag_qa_local" \
 *   npx --no-install tsx .claude/skills/nortex-rag/sim.ts <tenantId|email> "hola || ¿tenés gaseosa?"
 *
 *   - 1er argumento: tenantId, o el email de un usuario DE QA (si contiene "@")
 *     para resolver su tenant.
 *   - 2do argumento: mensajes separados por "||" — se procesan en orden y el
 *     historial se acumula (prueba la memoria conversacional).
 *   - --scope B2C|B2B|BOTH  (default B2C)
 *   - --customer <id>       (simula un cliente sintético del MISMO tenant)
 *   - --allow-llm           (requiere además el opt-in externo documentado abajo)
 *
 * El script no emula autenticación ni identidad de producción: el operador elige
 * el tenant dentro de una BD de QA aislada. Nunca exponerlo como endpoint ni
 * usarlo contra datos de desarrollo compartidos, staging o producción.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentBrain, AgentTurn } from '../../../backend/services/whatsapp/agent';
import type { ToolContext } from '../../../backend/services/whatsapp/tools';

const ISOLATED_QA_MARKER = 'isolated';
const EXTERNAL_LLM_OPT_IN = 'allow-external-api';
const QA_DATABASE_PREFIX = 'nortex_rag_qa_';

export interface SimulatorEnvironment {
    DATABASE_URL?: string;
    NORTEX_RAG_SIM_QA?: string;
    NORTEX_RAG_SIM_LLM_OPT_IN?: string;
    WHATSAPP_LLM?: string;
    ANTHROPIC_API_KEY?: string;
}

export interface SimulatorArgs {
    who: string;
    script: string;
    scope: 'B2C' | 'B2B' | 'BOTH';
    customerId: string | null;
    allowLlm: boolean;
}

export type SimulatorBrainMode = 'menubot' | 'claude';

type SimulatorDependencies = {
    prisma: typeof import('../../../backend/services/whatsapp/db').prisma;
    createBrain: typeof import('../../../backend/services/whatsapp/agent').createBrain;
    MenuBotBrain: typeof import('../../../backend/services/whatsapp/agent').MenuBotBrain;
};

function usage(): string {
    return 'Uso: NORTEX_RAG_SIM_QA=isolated DATABASE_URL="mysql://...@127.0.0.1:3306/nortex_rag_qa_<run>" npx --no-install tsx .claude/skills/nortex-rag/sim.ts <tenantId|email> "msj1 || msj2" [--scope B2C|B2B|BOTH] [--customer <id>] [--allow-llm]';
}

export function parseArgs(argv: string[]): SimulatorArgs {
    const positional: string[] = [];
    let scope: SimulatorArgs['scope'] = 'B2C';
    let customerId: string | null = null;
    let allowLlm = false;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--scope') {
            const value = argv[++i];
            if (value !== 'B2C' && value !== 'B2B' && value !== 'BOTH') {
                throw new Error('--scope requiere B2C, B2B o BOTH.');
            }
            scope = value;
        } else if (arg === '--customer') {
            const value = argv[++i];
            if (!value || value.startsWith('--')) {
                throw new Error('--customer requiere un id de cliente sintético.');
            }
            customerId = value;
        } else if (arg === '--allow-llm') {
            allowLlm = true;
        } else if (arg.startsWith('--')) {
            throw new Error(`Flag no reconocido: ${arg}.`);
        } else {
            positional.push(arg);
        }
    }

    const [who, script] = positional;
    if (!who || !script || positional.length !== 2) {
        throw new Error(usage());
    }

    return { who, script, scope, customerId, allowLlm };
}

/**
 * Rechaza antes de importar Prisma o cualquier brain. El marcador es una
 * declaración explícita del operador; el host numérico, URL sin parámetros y
 * nombre acotado reducen que una ejecución accidental alcance una BD compartida.
 */
export function assertIsolatedQaDatabase(env: SimulatorEnvironment): string {
    if (env.NORTEX_RAG_SIM_QA !== ISOLATED_QA_MARKER) {
        throw new Error(`El simulador exige NORTEX_RAG_SIM_QA=${ISOLATED_QA_MARKER}; no se ejecuta con un entorno implícito.`);
    }
    if (!env.DATABASE_URL) {
        throw new Error('El simulador exige DATABASE_URL de una MySQL temporal de QA.');
    }

    let url: URL;
    try {
        url = new URL(env.DATABASE_URL);
    } catch {
        throw new Error('DATABASE_URL debe ser una URL mysql válida de una instancia local temporal.');
    }

    if (url.protocol !== 'mysql:') {
        throw new Error('DATABASE_URL debe usar el protocolo mysql.');
    }
    if (url.search || url.hash) {
        throw new Error('DATABASE_URL no admite parámetros ni fragmentos; un socket u otro transporte alterno invalida el contrato aislado.');
    }

    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host !== '127.0.0.1' && host !== '::1') {
        throw new Error('DATABASE_URL debe usar 127.0.0.1 o ::1; no se aceptan hosts compartidos ni localhost ambiguo.');
    }

    let pathname: string;
    try {
        pathname = decodeURIComponent(url.pathname);
    } catch {
        throw new Error('DATABASE_URL contiene una ruta de base de datos inválida.');
    }
    const databaseName = pathname.slice(1);
    if (!new RegExp(`^${QA_DATABASE_PREFIX}[a-z0-9_]+$`, 'i').test(databaseName) || pathname !== `/${databaseName}`) {
        throw new Error(`La base debe llamarse ${QA_DATABASE_PREFIX}<run>; la base compartida \"nortex\" no es válida para este simulador.`);
    }
    return databaseName;
}

/**
 * MenuBot es el único default incluso si el shell heredó WHATSAPP_LLM=claude.
 * Claude necesita el flag local y un marcador de costo externo independiente.
 */
export function resolveSimulatorBrainMode(args: SimulatorArgs, env: SimulatorEnvironment): SimulatorBrainMode {
    if (!args.allowLlm) return 'menubot';
    if (env.NORTEX_RAG_SIM_LLM_OPT_IN !== EXTERNAL_LLM_OPT_IN) {
        throw new Error(`--allow-llm exige NORTEX_RAG_SIM_LLM_OPT_IN=${EXTERNAL_LLM_OPT_IN}; Claude puede consumir una API externa.`);
    }
    if (env.WHATSAPP_LLM !== 'claude' || !env.ANTHROPIC_API_KEY) {
        throw new Error('--allow-llm exige WHATSAPP_LLM=claude y una clave de Anthropic suministrada por separado.');
    }
    return 'claude';
}

async function loadSimulatorDependencies(): Promise<SimulatorDependencies> {
    const [dbModule, agentModule] = await Promise.all([
        import('../../../backend/services/whatsapp/db'),
        import('../../../backend/services/whatsapp/agent'),
    ]);
    return {
        prisma: dbModule.prisma,
        createBrain: agentModule.createBrain,
        MenuBotBrain: agentModule.MenuBotBrain,
    };
}

async function resolveTenant(
    prisma: SimulatorDependencies['prisma'],
    who: string
): Promise<{ tenantId: string; businessName: string }> {
    if (who.includes('@')) {
        const user = await prisma.user.findFirst({
            where: { email: who },
            select: { tenantId: true, tenant: { select: { businessName: true } } },
        });
        if (!user?.tenantId) {
            throw new Error('No hay usuario de QA con ese email.');
        }
        return { tenantId: user.tenantId, businessName: user.tenant?.businessName ?? 'la tienda' };
    }
    const tenant = await prisma.tenant.findUnique({
        where: { id: who },
        select: { id: true, businessName: true },
    });
    if (!tenant) {
        throw new Error('No existe ese tenant de QA.');
    }
    return { tenantId: tenant.id, businessName: tenant.businessName };
}

function simulatorEnvironmentFromProcess(): SimulatorEnvironment {
    return {
        DATABASE_URL: process.env.DATABASE_URL,
        NORTEX_RAG_SIM_QA: process.env.NORTEX_RAG_SIM_QA,
        NORTEX_RAG_SIM_LLM_OPT_IN: process.env.NORTEX_RAG_SIM_LLM_OPT_IN,
        WHATSAPP_LLM: process.env.WHATSAPP_LLM,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    };
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const environment = simulatorEnvironmentFromProcess();
    assertIsolatedQaDatabase(environment);
    const brainMode = resolveSimulatorBrainMode(args, environment);

    // Importar después de validar evita crear siquiera el cliente de Prisma o
    // cargar el SDK de Claude ante una invocación insegura.
    const { prisma, createBrain, MenuBotBrain } = await loadSimulatorDependencies();
    try {
        const { tenantId, businessName } = await resolveTenant(prisma, args.who);

        // Si simulamos un cliente vinculado, verificar que sea del MISMO tenant
        // sintético (el simulador conserva el scoping de identity.ts).
        let customerName: string | null = null;
        if (args.customerId) {
            const customer = await prisma.customer.findFirst({
                where: { id: args.customerId, tenantId },
                select: { name: true },
            });
            if (!customer) {
                throw new Error('El customer de QA no existe en el tenant de QA seleccionado; no se simula identidad cruzada.');
            }
            customerName = customer.name;
        }

        const ctx: ToolContext = { tenantId, customerId: args.customerId, botScope: args.scope };
        const brain: AgentBrain = brainMode === 'claude' ? await createBrain() : new MenuBotBrain();
        const brainName = brainMode === 'claude' ? 'ClaudeBrain (opt-in externo)' : 'MenuBotBrain';

        console.log(`── sim QA: tenant=${tenantId} (${businessName}) · scope=${args.scope} · customer=${args.customerId ?? '—'} · cerebro=${brainName} ──\n`);

        const history: AgentTurn[] = [];
        const messages = args.script.split('||').map((message) => message.trim()).filter(Boolean);
        if (messages.length === 0) {
            throw new Error('Ingresá al menos un mensaje no vacío.');
        }

        for (const text of messages) {
            console.log(`👤 ${text}`);
            const startedAt = Date.now();
            const reply = await brain.reply({ text, ctx, customerName, businessName, history });
            const elapsedMs = Date.now() - startedAt;
            console.log(`🤖 ${reply.text}`);
            console.log(`   (handoff=${reply.handoff} · ${elapsedMs}ms)\n`);
            history.push({ role: 'user', text });
            history.push({ role: 'assistant', text: reply.text });
        }
    } finally {
        await prisma.$disconnect();
    }
}

function isDirectExecution(): boolean {
    const entrypoint = process.argv[1];
    return Boolean(entrypoint && resolve(entrypoint) === fileURLToPath(import.meta.url));
}

if (isDirectExecution()) {
    void main().catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'error desconocido';
        console.error(`sim falló: ${message}`);
        process.exitCode = 1;
    });
}
