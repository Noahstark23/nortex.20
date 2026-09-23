export type ProfitPeriod = 'today' | 'week' | 'month';

export function managuaCivilDay(now = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Managua', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now);
    const read = (type: string) => parts.find(part => part.type === type)?.value ?? '';
    const year = Number(read('year'));
    const month = Number(read('month'));
    const day = Number(read('day'));
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function managuaProfitDates(period: Exclude<ProfitPeriod, 'today'>, now = new Date()) {
    const endDate = managuaCivilDay(now);
    const [year, month, day] = endDate.split('-').map(Number);
    if (period === 'month') return { startDate: `${year}-${String(month).padStart(2, '0')}-01`, endDate };
    const utc = new Date(Date.UTC(year, month - 1, day));
    const offset = (utc.getUTCDay() + 6) % 7;
    utc.setUTCDate(utc.getUTCDate() - offset);
    return { startDate: utc.toISOString().slice(0, 10), endDate };
}
