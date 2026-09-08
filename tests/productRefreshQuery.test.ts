import { describe, expect, it } from 'vitest';
import { parseProductRefreshIds } from '../backend/lib/productRefreshQuery';

describe('consulta acotada de productos después de vender', () => {
    it('distingue compatibilidad sin filtro de un filtro vacío inválido', () => {
        expect(parseProductRefreshIds(undefined)).toBeUndefined();
        expect(() => parseProductRefreshIds('')).toThrow();
    });
    it('admite CUID/UUID sin alterar identidad y deduplica', () => expect(parseProductRefreshIds('cm123,550e8400-e29b-41d4-a716-446655440000,cm123')).toEqual(['cm123', '550e8400-e29b-41d4-a716-446655440000']));
    it('acepta exactamente100 y rechaza101, incluidos duplicados', () => {
        expect(parseProductRefreshIds(Array.from({length:100},(_,i)=>'p'+i).join(','))).toHaveLength(100);
        expect(() => parseProductRefreshIds(Array(101).fill('same').join(','))).toThrow();
    });
    it.each([null, 0, [], {}, 'a,,b', ' a', 'a ', 'a/b', 'a?x', 'a\n', 'a'.repeat(192)])('rechaza entradas fuera de contrato %j', raw => expect(() => parseProductRefreshIds(raw)).toThrow());
});
