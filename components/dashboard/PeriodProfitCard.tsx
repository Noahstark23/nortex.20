import React, { useEffect, useState } from 'react';
import Decimal from 'decimal.js';
import { formatMoney } from '../../utils/money';
import { managuaProfitDates, type ProfitPeriod } from '../../utils/managuaProfitPeriod';

interface Summary { gross: string; afterExpenses: string; expenses: string; startDate: string; endDate: string }

export default function PeriodProfitCard({ period }: { period: Exclude<ProfitPeriod, 'today'> }) {
    const [summary, setSummary] = useState<Summary | null>(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const controller = new AbortController();
        const { startDate, endDate } = managuaProfitDates(period);
        const params = new URLSearchParams({ startDate, endDate });
        const headers = { Authorization: `Bearer ${localStorage.getItem('nortex_token') ?? ''}` };
        setLoading(true); setError(''); setSummary(null);
        void Promise.all([
            fetch(`/api/reports/sales?${params}`, { headers, signal: controller.signal }),
            fetch(`/api/reports/expenses?${params}`, { headers, signal: controller.signal }),
        ]).then(async ([salesResponse, expensesResponse]) => {
            const [sales, expenses] = await Promise.all([salesResponse.json(), expensesResponse.json()]);
            if (!salesResponse.ok || !expensesResponse.ok) throw new Error('No pudimos calcular la utilidad de este período.');
            const gross = new Decimal(String(sales.utilidadBruta));
            const spent = new Decimal(String(expenses.totalExpenses));
            if (!gross.isFinite() || !spent.isFinite()) throw new Error('El reporte no devolvió montos válidos.');
            if (!controller.signal.aborted) setSummary({ gross: gross.toFixed(2), afterExpenses: gross.minus(spent).toFixed(2), expenses: spent.toFixed(2), startDate, endDate });
        }).catch(() => { if (!controller.signal.aborted) setError('No pudimos calcular la utilidad de este período.'); })
            .finally(() => { if (!controller.signal.aborted) setLoading(false); });
        return () => controller.abort();
    }, [period]);

    return <section aria-live="polite" className="nx-canvas-card mb-6 p-5 sm:p-6 lg:p-8">
        <h2 className="text-lg font-bold text-slate-950">{period === 'week' ? 'Esta semana' : 'Este mes'}</h2>
        {loading ? <p className="mt-3 text-slate-600">Calculando utilidad…</p> : error ? <p role="alert" className="mt-3 text-red-700">{error}</p> : summary && <>
            <p className="mt-1 text-sm text-slate-600">Del {summary.startDate} al {summary.endDate} · hora de Nicaragua</p>
            <dl className="mt-4 grid gap-4 sm:grid-cols-3">
                <div><dt className="text-sm text-slate-600">Utilidad bruta</dt><dd className="nx-total text-slate-950">{formatMoney(summary.gross)}</dd></div>
                <div><dt className="text-sm text-slate-600">Gastos del período</dt><dd className="text-xl font-semibold text-slate-950">{formatMoney(summary.expenses)}</dd></div>
                <div><dt className="text-sm text-slate-600">Después de gastos</dt><dd className="text-xl font-semibold text-slate-950">{formatMoney(summary.afterExpenses)}</dd></div>
            </dl>
            <p className="mt-4 text-xs text-slate-600">Utilidad bruta = ventas sin IVA menos costo de lo vendido. Si faltan costos de productos, puede estar sobreestimada.</p>
        </>}
    </section>;
}
