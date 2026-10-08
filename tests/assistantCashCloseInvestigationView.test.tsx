// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AssistantCashCloseInvestigation } from '../components/assistant/AssistantCashCloseInvestigation';
import { AssistantRunView } from '../components/assistant/AssistantRunView';
import type { CashCloseInvestigation } from '../shared/assistantCashCloseInvestigation';
import type { AssistantJsonObject, AssistantRunDTO } from '../shared/assistantOperations';

afterEach(cleanup);
const investigation = (): CashCloseInvestigation => ({
    kind: 'CASH_CLOSE_INVESTIGATION', status: 'ok', checkedAt: '2026-09-09T15:00:00Z', scope: 'business',
    shift: { id: 'shift-1', openedAt: '2026-09-08T14:00:00Z', closedAt: '2026-09-09T02:00:00Z', folio: 'Z-001', businessDate: '2026-09-08' },
    snapshot: {
        source: { id: 'report-1', version: 1, contentHash: 'a'.repeat(64), documentUrl: '/api/reports/shifts/shift-1/document' },
        cash: { expectedNio: '100.00', countedNio: '90.00', differenceNio: '-10.00', expectedUsd: '3.1234', countedUsd: '3.1235', differenceUsd: '0.0001', openingNio: '20.00', grossCashSalesNio: '85.00', cashRefundsNio: '5.00', paidInNio: '0.00', paidOutNio: '0.00', openingUsd: '3.1234', paidInUsd: '0.0000', paidOutUsd: '0.0000' },
        payments: [{ method: 'CASH', transactionCount: 2, grossSalesNio: '85.00' }],
        movements: [{ type: 'OUT', currency: 'NIO', category: 'DEVOLUCION', count: 1, amount: '5.00' }],
    },
    currentMovements: { status: 'available', rows: [{ id: 'movement-1', type: 'OUT', currency: 'USD', category: 'GASTO_OPERATIVO', amount: '0.0001', createdAt: '2026-09-08T16:00:00Z', isVoided: true, voidedAt: '2026-09-09T14:00:00Z', expenseId: 'expense-1' }] },
    pendingChecks: [{ code: 'PHYSICAL_COUNT_REVIEW', message: 'Compará el conteo con la evidencia física.', references: ['shift-1'] }], warnings: ['La coherencia del hash no demuestra la causa.'], evidence: ['ShiftCloseReport autorizado', 'CashMovement del turno'],
});
const json = (value: unknown): AssistantJsonObject => JSON.parse(JSON.stringify(value));

describe('investigación de cierre en NortexGPT', () => {
    it('separa fuentes históricas y actuales sin sumar, conserva precisión USD y pendientes', () => {
        const { container } = render(<AssistantCashCloseInvestigation data={json(investigation())} />);
        const snapshot = within(screen.getByRole('region', { name: 'Reporte guardado al cierre' }));
        expect(snapshot.getByText('-C$ 10.00')).toBeVisible();
        expect(snapshot.getByText('US$ 0.0001')).toBeVisible();
        expect(snapshot.getByText(/no acreditan el efectivo recibido/)).toBeVisible();
        expect(screen.getByText(/No se suma al reporte ni reemplaza/)).toBeVisible();
        expect(screen.getByText('Compará el conteo con la evidencia física.')).toBeVisible();
        expect(screen.getByText(/Esta lectura no determina una causa/)).toBeVisible();
        const current = within(screen.getByRole('region', { name: 'Movimientos actuales del turno' }));
        expect(current.getByText('US$ 0.0001')).toBeVisible(); expect(current.getByText(/Anulado/)).toBeVisible();
        expect(snapshot.getByText(`Hash: ${'a'.repeat(64)}`)).not.toBeVisible();
        fireEvent.click(snapshot.getByText('Ver referencia del cierre')); expect(snapshot.getByText('Versión 1')).toBeVisible();
        fireEvent.click(snapshot.getByText('Ver ventas por forma de pago al cierre')); expect(snapshot.getByText(/Transacciones: 2/)).toBeVisible();
        expect(container.querySelector('a,button')).toBeNull();
    });
    it('null mantiene importes no disponibles sin reemplazarlos por cero aunque existan movimientos actuales', () => {
        const data = investigation(); data.snapshot = null; data.status = 'unavailable'; data.scope = 'own-shifts'; data.shift.folio = null;
        render(<AssistantCashCloseInvestigation data={json(data)} />);
        expect(screen.getByText('Alcance: tus turnos.')).toBeVisible();
        const snapshot = within(screen.getByRole('region', { name: 'Reporte guardado al cierre' }));
        expect(snapshot.getAllByText('No disponible')).toHaveLength(14);
        expect(snapshot.queryByText(/C\$|US\$/)).not.toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Movimientos actuales del turno' })).toHaveTextContent('US$ 0.0001');
    });
    it.each(['truncated', 'unavailable'] as const)('señala movimientos %s sin anunciar lista completa ni total', status => {
        const data = investigation(); data.status = 'partial'; data.currentMovements.status = status;
        render(<AssistantCashCloseInvestigation data={json(data)} />);
        const current = within(screen.getByRole('region', { name: 'Movimientos actuales del turno' }));
        expect(current.getByText(status === 'truncated' ? /Lista incompleta/ : /Movimientos actuales no disponibles/)).toBeVisible();
        if (status === 'unavailable') expect(current.queryByText('US$ 0.0001')).not.toBeInTheDocument();
    });
    it.each(['NaN', 'Infinity', '1e3', '1.001'])('rechaza importe NIO inválido %s', amount => {
        const data = investigation(); data.snapshot.cash.expectedNio = amount;
        render(<AssistantCashCloseInvestigation data={json(data)} />);
        expect(screen.getByRole('status')).toHaveTextContent('La investigación del cierre no está disponible');
    });
    it.each(['0.00001', 'NaN'])('rechaza importe USD inválido %s', amount => {
        const data = investigation(); data.currentMovements.rows[0].amount = amount;
        render(<AssistantCashCloseInvestigation data={json(data)} />);
        expect(screen.getByRole('status')).toHaveTextContent('La investigación del cierre no está disponible');
    });
    it('una lista de caja vacía no equivale a ausencia de ventas', () => {
        const data = investigation(); data.currentMovements.rows = [];
        render(<AssistantCashCloseInvestigation data={json(data)} />);
        expect(screen.getByText(/Esto no significa que no hubo ventas ni actividad/)).toBeVisible();
        expect(screen.getByText(/Movimientos registrados de caja, sin listado de ventas/)).toBeVisible();
    });
    it('rechaza precisión NIO excesiva también en filas de movimientos', () => {
        const data = investigation(); data.currentMovements.rows[0].currency = 'NIO';
        render(<AssistantCashCloseInvestigation data={json(data)} />);
        expect(screen.getByRole('status')).toHaveTextContent('La investigación del cierre no está disponible');
    });
    it('rechaza moneda no compatible y no la rotula como NIO', () => {
        const data = investigation(); data.currentMovements.rows[0].currency = 'EUR';
        render(<AssistantCashCloseInvestigation data={json(data)} />); expect(screen.getByRole('status')).toBeVisible();
        expect(screen.queryByText(/C\$/)).not.toBeInTheDocument();
    });
    it('escapa texto libre y omite campos privados y enlaces enviados fuera del DTO', () => {
        const data = investigation(), payload = '<img src=x onerror=alert(1)>';
        data.shift.folio = payload; data.pendingChecks[0].message = payload; data.snapshot.source.contentHash = payload;
        data.snapshot.source.documentUrl = 'javascript:alert(1)';
        const { container } = render(<AssistantCashCloseInvestigation data={{ ...json(data), notes: 'NOTA_PRIVADA', costs: 'COSTO_PRIVADO' }} />);
        expect(screen.getByText(payload)).toBeVisible(); expect(container.querySelector('img,script,a')).toBeNull();
        expect(screen.queryByText(/NOTA_PRIVADA|COSTO_PRIVADO/)).not.toBeInTheDocument();
    });
    it('run degradado con investigación muestra consulta directa sin inventar una falta de datos', () => {
        const run: AssistantRunDTO = { id: 'r1', conversationId: 'c1', requestId: 'q1', status: 'SUCCEEDED', version: 1, iterations: 0, steps: [], createdAt: '2026-09-09T15:00:00Z', updatedAt: '2026-09-09T15:00:00Z', result: { text: 'Fuentes consultadas.', degraded: true, actionProposalIds: [], evidence: [{ id: 'e1', tool: 'inspect_cash_close', label: 'Cierre', data: json(investigation()) }] } };
        render(<AssistantRunView run={run} busy={false} onCancel={vi.fn()} onRecover={vi.fn()} onReview={vi.fn()} />);
        expect(screen.getByText(/Consulta directa de fuentes/)).toBeVisible();
        expect(screen.queryByText(/Parte de la información no estuvo disponible/)).not.toBeInTheDocument();
    });
});
