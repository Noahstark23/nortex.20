import { vi } from 'vitest';
import { referenceKey } from '../backend/services/assistant/knowledge/model';

/** Doble transaccional acotado: acredita contratos; no pretende demostrar locks/InnoDB. */
export function knowledgeDb() {
  const state = { control: null as any, releases: [] as any[], versions: [] as any[], audits: [] as any[], active: true, auditFails: false };
  const matches = (row: any, where: any): boolean => Object.entries(where ?? {}).every(([key, value]: [string, any]) => {
    if (key === 'OR') return value.some((part: any) => matches(row, part));
    if (key === 'documentId_version_sectionId') return referenceKey(row) === referenceKey(value);
    return row[key] === value;
  });
  const model = (key: 'releases' | 'versions') => ({
    findUnique: vi.fn(async ({ where }) => state[key].find(row => matches(row, where)) ?? null),
    findMany: vi.fn(async ({ where, take }) => state[key].filter(row => matches(row, where)).slice(0, take)),
    create: vi.fn(async ({ data }) => { state[key].push({ ...data }); return state[key].at(-1); }),
    createMany: vi.fn(async ({ data }) => { state[key].push(...data.map((row: any) => ({ ...row }))); return { count: data.length }; }),
    update: vi.fn(async ({ where, data }) => { const row = state[key].find(item => matches(item, where)); Object.assign(row, data); return row; }),
    updateMany: vi.fn(async ({ where, data }) => { const rows = state[key].filter(row => matches(row, where)); rows.forEach(row => Object.assign(row, data)); return { count: rows.length }; }),
  });
  const db: any = {
    user: { findFirst: vi.fn(async () => state.active ? { id: 'editor', role: 'SUPER_ADMIN', status: 'ACTIVE' } : null) },
    assistantKnowledgeControl: {
      findUnique: vi.fn(async () => state.control), findUniqueOrThrow: vi.fn(async () => state.control),
      upsert: vi.fn(async () => state.control ??= { id: 'official', generation: 0, activeReleaseId: null }),
      update: vi.fn(async ({ data }) => { const generation = state.control.generation + (data.generation?.increment ?? 0); Object.assign(state.control, data, { generation }); return state.control; }),
    },
    assistantKnowledgeRelease: model('releases'), assistantKnowledgeVersion: model('versions'),
    auditLog: { create: vi.fn(async ({ data }) => { if (state.auditFails) throw new Error('synthetic audit failure'); state.audits.push(data); return data; }) },
    $queryRaw: vi.fn(async () => []),
    $executeRaw: vi.fn(async () => { state.control ??= { id: 'official', generation: 0, activeReleaseId: null }; return 1; }),
  };
  db.$transaction = vi.fn(async (work: any) => {
    const before = structuredClone(state);
    try { return await work(db); }
    catch (error) { Object.assign(state, before); throw error; }
  });
  return { state, db };
}
