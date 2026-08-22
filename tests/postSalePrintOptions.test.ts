import { describe, expect, it } from 'vitest';
import { buildPostSalePrintOptions } from '../utils/postSalePrintOptions';

describe('post-sale print options', () => {
    it('keeps Ticket 80 mm as the primary action even with thermal printer linked', () => {
        expect(buildPostSalePrintOptions(true)).toEqual([
            { id: 'ticket80', label: 'Ticket 80 mm', primary: true },
            { id: 'thermal', label: 'Enviar a tiquetera', primary: false },
        ]);
    });

    it('does not hide Ticket 80 mm when there is no thermal printer', () => {
        expect(buildPostSalePrintOptions(false)).toEqual([
            { id: 'ticket80', label: 'Ticket 80 mm', primary: true },
        ]);
    });
});
