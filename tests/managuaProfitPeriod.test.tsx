// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { managuaProfitDates } from '../utils/managuaProfitPeriod';
import PeriodProfitCard from '../components/dashboard/PeriodProfitCard';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('utilidad visible por período', () => {
    it('elige mes y semana por fecha civil de Managua al cruzar medianoche UTC', () => {
        const now = new Date('2026-10-01T00:30:00.000Z'); // 30 septiembre en Nicaragua
        expect(managuaProfitDates('month', now)).toEqual({ startDate: '2026-09-01', endDate: '2026-09-30' });
        expect(managuaProfitDates('week', now)).toEqual({ startDate: '2026-09-28', endDate: '2026-09-30' });
    });

    it('muestra utilidad bruta y después de gastos sin convertir una falla en cero', async () => {
        const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => ({
            ok: true,
            json: async () => String(input).includes('/sales?') ? { utilidadBruta: 25.24 } : { totalExpenses: 7.13 },
        }) as Response);
        render(<PeriodProfitCard period="month" />);
        expect(await screen.findByText('C$ 25.24')).toBeTruthy();
        expect(screen.getByText('C$ 18.11')).toBeTruthy();
        expect(fetch).toHaveBeenCalledTimes(2);
        cleanup();
        fetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'Falla' }) } as Response);
        render(<PeriodProfitCard period="week" />);
        expect((await screen.findByRole('alert')).textContent).toContain('No pudimos calcular');
        expect(screen.queryByText('C$ 0.00')).toBeNull();
    });
});
