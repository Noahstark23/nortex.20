import { describe, expect, it } from 'vitest';
import { assertKnowledgeMysqlTarget, isolatedEnvironment } from '../scripts/qa/knowledge-mysql.mjs';

describe('guardas del lanzador editorial descartable (sin acreditar integración MySQL)', () => {
  const marker = 'a'.repeat(32), password = 'b'.repeat(48);
  const local = `mysql://root:${password}@127.0.0.1:45678/nortex_knowledge_qa`;
  it('construye entorno de lista blanca sin heredar conexiones ni proveedor', () => {
    expect(isolatedEnvironment({ PATH: '/test', HOME: '/fixture', DATABASE_URL: 'not-inherited', ANTHROPIC_API_KEY: 'not-inherited',
      MYSQL_PWD: 'not-inherited', NODE_OPTIONS: 'not-inherited' })).toEqual({ PATH: '/test', HOME: '/fixture' });
  });
  it('exige marcador, loopback numérico, puerto alto y base exclusiva', () => {
    expect(assertKnowledgeMysqlTarget(local, marker).pathname).toBe('/nortex_knowledge_qa');
    for (const invalid of [local.replace('127.0.0.1', 'localhost'), local.replace('127.0.0.1', '203.0.113.1'),
      local.replace('45678', '330'), local.replace('nortex_knowledge_qa', 'other'), local.replace('root:', 'other:')]) {
      expect(() => assertKnowledgeMysqlTarget(invalid, marker)).toThrow();
    }
    expect(() => assertKnowledgeMysqlTarget(local, undefined)).toThrow('KNOWLEDGE_QA_MARKER_REQUIRED');
  });
});
