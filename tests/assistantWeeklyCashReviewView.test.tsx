// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AssistantWeeklyCashReview } from '../components/assistant/AssistantWeeklyCashReview';
import type { WeeklyCashReview, WeeklyCashReviewRow } from '../shared/assistantWeeklyCashReview';
import type { AssistantJsonObject } from '../shared/assistantOperations';

afterEach(cleanup);
const row = (): WeeklyCashReviewRow => ({
    shiftId: 'turno-1', status: 'BALANCED', closedAt: '2026-09-09T02:00:00.000Z', businessDate: '2026-09-08', folio: 'Z-001',
    source: { id: 'reporte-1', version: 3, contentHash: 'a'.repeat(64), documentUrl: '/api/reports/shifts/turno-1/document' },
    cash: { expectedNio: '1200.00', countedNio: '1200.00', differenceNio: '0.00', expectedUsd: '3.1234', countedUsd: '3.1234', differenceUsd: '0.0000' },
    message: 'Comparación del reporte guardado.',
});
const review = (): WeeklyCashReview => ({
    kind: 'WEEKLY_CASH_REVIEW', status: 'ok',
    period: { startDate: '2026-09-02', endDate: '2026-09-08', cutoff: '2026-09-09T06:00:00.000Z', timeZone: 'America/Managua', completeDays: true },
    checkedAt: '2026-09-09T15:00:00.000Z', scope: 'business', truncated: false, rows: [row()],
    counts: { closed: 1, verified: 1, differences: 0, missingReports: 0, invalidReports: 0, open: 0 },
    totals: { shortageNio: '0.00', surplusNio: '0.00', shortageUsd: '0.0000', surplusUsd: '0.0000' },
    warnings: [], evidence: ['Reportes de cierre guardados'],
});
const json = (value: WeeklyCashReview): AssistantJsonObject => JSON.parse(JSON.stringify(value));
const valueFor = (scope: ReturnType<typeof within>, label: string) => scope.getByText(label).parentElement;

describe('vista de revisión semanal de caja', () => {
    it.each(['BALANCED', 'DIFFERENCE', 'MISSING_REPORT', 'INVALID_REPORT'] as const)('permite investigar %s por referencia sin preparar una operación', status => {
        const data = review(), investigate = vi.fn(); data.rows[0].status = status;
        if (status === 'MISSING_REPORT' || status === 'INVALID_REPORT') { data.rows[0].cash = null; data.rows[0].source = null; }
        render(<AssistantWeeklyCashReview data={json(data)} onInvestigate={investigate} />);
        fireEvent.click(screen.getByRole('button', { name: 'Investigar este cierre' }));
        expect(investigate).toHaveBeenCalledExactlyOnceWith('turno-1', data.rows[0].source?.contentHash);
    });
    it('no ofrece investigar un turno abierto y bloquea un cierre cuando hay trabajo protegido', () => {
        const data = review(), investigate = vi.fn(); data.rows.push({ ...row(), shiftId: 'open', status: 'OPEN', cash: null, source: null, folio: null, closedAt: null });
        render(<AssistantWeeklyCashReview data={json(data)} onInvestigate={investigate} investigationDisabled />);
        expect(screen.getAllByRole('button', { name: 'Investigar este cierre' })).toHaveLength(1);
        const button = screen.getByRole('button', { name: 'Investigar este cierre' }); expect(button).toBeDisabled(); fireEvent.click(button); expect(investigate).not.toHaveBeenCalled();
    });

    it('presenta reporte equilibrado con alcance y referencia, sin prometer conciliación ni acciones', () => {
        render(<AssistantWeeklyCashReview data={json(review())} />);
        expect(screen.getByText(/Alcance: turnos del negocio/)).toBeVisible();
        expect(screen.getByText(/No acredita conciliación contable ni saldo bancario/)).toBeVisible();
        const card = within(screen.getByRole('article', { name: 'Cierre Z-001' }));
        expect(card.getByText('Sin diferencia de efectivo')).toBeVisible();
        expect(card.getByText(`Hash: ${'a'.repeat(64)}`)).not.toBeVisible();
        fireEvent.click(card.getByText('Ver referencia del cierre'));
        expect(card.getByText('Referencia del reporte de cierre · Versión 3')).toBeVisible();
        expect(card.getByText(`Hash: ${'a'.repeat(64)}`)).toBeVisible();
        expect(card.getByText(/Turno: turno-1 · Día del cierre: 2026-09-08/)).toBeVisible();
        const nio = within(card.getByRole('region', { name: 'Efectivo NIO' }));
        expect(valueFor(nio, 'Esperado')).toHaveTextContent('C$ 1,200.00');
        const usd = within(card.getByRole('region', { name: 'Efectivo USD' }));
        expect(valueFor(usd, 'Esperado')).toHaveTextContent('US$ 3.1234');
        expect(valueFor(usd, 'Diferencia')).toHaveTextContent('US$ 0.0000');
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('muestra el corte en Managua e identifica un período todavía en curso', () => {
        const data = review(); data.period.cutoff = '2026-09-09T15:05:06.000Z'; data.period.completeDays = false;
        render(<AssistantWeeklyCashReview data={json(data)} />);
        expect(screen.getByText('Corte: 09/09/2026, 09:05:06 · Managua · Período en curso')).toBeVisible();
    });

    it('separa faltantes y sobrantes aunque el estado de consulta sea ok', () => {
        const data = review(); data.scope = 'own-shifts';
        data.rows[0].status = 'DIFFERENCE';
        data.rows[0].cash = { expectedNio: '100', countedNio: '90', differenceNio: '-10', expectedUsd: '3.1234', countedUsd: '3.1235', differenceUsd: '0.0001' };
        data.counts.differences = 1;
        data.totals = { shortageNio: '10', surplusNio: '7', shortageUsd: '0', surplusUsd: '0.0001' };
        render(<AssistantWeeklyCashReview data={json(data)} />);
        expect(screen.getByText(/Alcance: tus turnos/)).toBeVisible();
        expect(screen.getByText('Diferencia de efectivo')).toBeVisible();
        const totals = within(screen.getByRole('region', { name: 'Faltantes y sobrantes separados' }));
        expect(valueFor(totals, 'Faltantes NIO')).toHaveTextContent('C$ 10.00');
        expect(valueFor(totals, 'Sobrantes NIO')).toHaveTextContent('C$ 7.00');
        expect(valueFor(totals, 'Sobrantes USD')).toHaveTextContent('US$ 0.0001');
        const card = within(screen.getByRole('article', { name: 'Cierre Z-001' }));
        expect(valueFor(within(card.getByRole('region', { name: 'Efectivo NIO' })), 'Diferencia')).toHaveTextContent('-C$ 10.00');
        expect(screen.queryByText('Sin diferencia de efectivo')).not.toBeInTheDocument();
    });

    it.each([
        ['OPEN', 'Turno abierto'], ['MISSING_REPORT', 'Falta el reporte de cierre'], ['INVALID_REPORT', 'Reporte no verificable'],
    ] as const)('conserva %s y los importes ausentes sin convertirlos en cero', (status, label) => {
        const data = review(); data.status = 'partial';
        data.rows = [{ ...row(), status, cash: null, source: null, folio: null, closedAt: null, businessDate: null, message: 'Revisá este turno desde Caja.' }];
        data.totals = { shortageNio: null, surplusNio: null, shortageUsd: null, surplusUsd: null };
        render(<AssistantWeeklyCashReview data={json(data)} />);
        expect(screen.getByText(label)).toBeVisible();
        expect(screen.getByText('Revisá este turno desde Caja.')).toBeVisible();
        const card = within(screen.getByRole('article', { name: 'Turno turno-1' }));
        expect(card.getAllByText('No disponible')).toHaveLength(6);
        expect(screen.queryByText(/(?:C\$|US\$) 0/)).not.toBeInTheDocument();
        expect(card.getByText('Sin referencia de un reporte verificable.')).toBeVisible();
    });

    it('no presenta conteos ni acumulados parciales como totales cuando la lista se truncó', () => {
        const data = review(); data.truncated = true; data.counts.closed = 999;
        data.totals.shortageNio = '98765.43'; data.warnings = ['Se alcanzó el límite de turnos.'];
        render(<AssistantWeeklyCashReview data={json(data)} />);
        expect(screen.queryByLabelText('Conteos del período')).not.toBeInTheDocument();
        expect(screen.queryByText('999')).not.toBeInTheDocument();
        expect(screen.queryByText('C$ 98,765.43')).not.toBeInTheDocument();
        expect(screen.getByText(/La lista está incompleta/)).toBeVisible();
        expect(screen.getByText('Se alcanzó el límite de turnos.')).toBeVisible();
        expect(within(screen.getByRole('region', { name: 'Faltantes y sobrantes separados' })).getAllByText('No disponible')).toHaveLength(4);
        expect(screen.getByRole('article', { name: 'Cierre Z-001' })).toBeVisible();
    });

    it('distingue una consulta no disponible de una consulta vacía', () => {
        const data = review(); data.status = 'unavailable'; data.rows = [];
        render(<AssistantWeeklyCashReview data={json(data)} />);
        expect(screen.getByRole('status')).toHaveTextContent('No se pudo completar la revisión');
        expect(screen.queryByLabelText('Conteos del período')).not.toBeInTheDocument();
        expect(screen.getByText('No hay turnos disponibles para mostrar.')).toBeVisible();
    });

    it('muestra una consulta vacía válida con cero turnos explícitos', () => {
        const data = review(); data.rows = []; data.counts.closed = 0; data.counts.verified = 0;
        render(<AssistantWeeklyCashReview data={json(data)} />);
        expect(screen.getByText('No hay turnos en el alcance consultado.')).toBeVisible();
        expect(screen.getByLabelText('Conteos del período')).toHaveTextContent('Turnos cerrados0');
    });

    it.each([
        { ...row(), cash: null },
        { ...row(), source: null },
        { ...row(), cash: { ...row().cash, expectedUsd: 'NaN' } },
    ])('no presenta como equilibrado un reporte sin efectivo válido y fuente: %j', invalidRow => {
        render(<AssistantWeeklyCashReview data={{ ...json(review()), rows: [JSON.parse(JSON.stringify(invalidRow))] }} />);
        expect(screen.getByRole('status')).toHaveTextContent('La revisión semanal de caja no está disponible');
        expect(screen.queryByText('Sin diferencia de efectivo')).not.toBeInTheDocument();
    });

    it.each([{}, { ...json(review()), counts: null }, { ...json(review()), scope: 'otro-negocio' }, { ...json(review()), totals: { shortageNio: 'NaN' } }])('rechaza DTO incompleto o inválido sin mostrar ceros: %j', data => {
        render(<AssistantWeeklyCashReview data={data} />);
        expect(screen.getByRole('status')).toHaveTextContent('La revisión semanal de caja no está disponible');
        expect(screen.queryByRole('article')).not.toBeInTheDocument();
        expect(screen.queryByText(/(?:C\$|US\$) 0/)).not.toBeInTheDocument();
    });

    it('escapa valores libres y no usa el enlace del documento como navegación', () => {
        const data = review(), payload = '<img src=x onerror=alert(1)>';
        data.rows[0] = { ...row(), folio: payload, message: payload, source: { id: payload, version: 1, contentHash: payload, documentUrl: 'javascript:alert(1)' } };
        data.warnings = ['<script>alert(1)</script>'];
        const { container } = render(<AssistantWeeklyCashReview data={json(data)} />);
        expect(screen.getByText(payload)).toBeVisible();
        expect(screen.getByText('<script>alert(1)</script>')).toBeVisible();
        expect(container.querySelector('img, script, a, button')).toBeNull();
    });
});
