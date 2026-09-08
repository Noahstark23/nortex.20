import { describe, expect, it } from 'vitest';
import {
    assertIsolatedQaDatabase,
    parseArgs,
    resolveSimulatorBrainMode,
    type SimulatorEnvironment,
} from '../.claude/skills/nortex-rag/sim.ts';

const isolatedQaEnvironment: SimulatorEnvironment = {
    NORTEX_RAG_SIM_QA: 'isolated',
    DATABASE_URL: 'mysql://qa:qa@127.0.0.1:3306/nortex_rag_qa_simulator',
};

describe('simulador RAG: contrato de QA aislada', () => {
    it('acepta únicamente el marcador explícito y una MySQL loopback con nombre de QA', () => {
        expect(assertIsolatedQaDatabase(isolatedQaEnvironment)).toBe('nortex_rag_qa_simulator');
        expect(assertIsolatedQaDatabase({
            ...isolatedQaEnvironment,
            DATABASE_URL: 'mysql://qa:qa@[::1]:3306/nortex_rag_qa_ipv6',
        })).toBe('nortex_rag_qa_ipv6');
    });

    it('falla cerrado para una marca ausente, un host ambiguo/remoto o la BD compartida', () => {
        expect(() => assertIsolatedQaDatabase({ DATABASE_URL: isolatedQaEnvironment.DATABASE_URL }))
            .toThrow('NORTEX_RAG_SIM_QA=isolated');
        expect(() => assertIsolatedQaDatabase({
            ...isolatedQaEnvironment,
            DATABASE_URL: 'mysql://qa:qa@localhost:3306/nortex_rag_qa_local',
        })).toThrow('127.0.0.1 o ::1');
        expect(() => assertIsolatedQaDatabase({
            ...isolatedQaEnvironment,
            DATABASE_URL: 'mysql://qa:qa@db.example.test:3306/nortex_rag_qa_remote',
        })).toThrow('127.0.0.1 o ::1');
        expect(() => assertIsolatedQaDatabase({
            ...isolatedQaEnvironment,
            DATABASE_URL: 'mysql://qa:qa@127.0.0.1:3306/nortex_rag_qa_socket?socket=%2Ftmp%2Fmysql.sock',
        })).toThrow('no admite parámetros');
        expect(() => assertIsolatedQaDatabase({
            ...isolatedQaEnvironment,
            DATABASE_URL: 'mysql://qa:qa@127.0.0.1:3306/nortex',
        })).toThrow('nortex_rag_qa_<run>');
    });
});

describe('simulador RAG: cerebro sin integraciones externas por defecto', () => {
    const normalArgs = parseArgs(['tenant-qa', 'hola']);

    it('mantiene MenuBot aunque el shell haya heredado Claude y una clave', () => {
        expect(resolveSimulatorBrainMode(normalArgs, {
            ...isolatedQaEnvironment,
            WHATSAPP_LLM: 'claude',
            ANTHROPIC_API_KEY: 'not-a-real-key',
            NORTEX_RAG_SIM_LLM_OPT_IN: 'allow-external-api',
        })).toBe('menubot');
    });

    it('requiere flag local y opt-in externo separado antes de seleccionar Claude', () => {
        const llmArgs = parseArgs(['tenant-qa', 'hola', '--allow-llm']);
        expect(() => resolveSimulatorBrainMode(llmArgs, {
            ...isolatedQaEnvironment,
            WHATSAPP_LLM: 'claude',
            ANTHROPIC_API_KEY: 'not-a-real-key',
        })).toThrow('NORTEX_RAG_SIM_LLM_OPT_IN=allow-external-api');
        expect(resolveSimulatorBrainMode(llmArgs, {
            ...isolatedQaEnvironment,
            WHATSAPP_LLM: 'claude',
            ANTHROPIC_API_KEY: 'not-a-real-key',
            NORTEX_RAG_SIM_LLM_OPT_IN: 'allow-external-api',
        })).toBe('claude');
    });
});
