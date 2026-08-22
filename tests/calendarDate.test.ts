import { describe, expect, it } from 'vitest';
import { normalizeCalendarDateInput } from '../backend/lib/calendarDate';

describe('normalizeCalendarDateInput', () => {
    it.each([
        ['2026-08-25', '2026-08-25T12:00:00.000Z'],
        ['2026-08-25T07:49:00-06:00', '2026-08-25T12:00:00.000Z'],
        ['2027-01-09T00:00:00.000Z', '2027-01-09T12:00:00.000Z'],
    ])('normaliza %s al día calendario UTC', (input, expectedIso) => {
        expect(normalizeCalendarDateInput(input).toISOString()).toBe(expectedIso);
    });
});
