// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import AdminOverviewPanel, { readAdminOverview } from '../components/admin/AdminOverviewPanel';
import { syntheticAdminOverview } from './fixtures/adminOverview';
const swr = vi.hoisted(() => ({ data: undefined as unknown, error: null as unknown, loading: false, validating: false, mutate: vi.fn(), keys: [] as unknown[] }));
vi.mock('swr', async importOriginal => ({ ...await importOriginal<typeof import('swr')>(), default: (key: unknown) => { swr.keys.push(key); return { data: swr.data, error: swr.error, isLoading: swr.loading, isValidating: swr.validating, mutate: swr.mutate }; } }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });
beforeEach(() => { localStorage.setItem('nortex_user', JSON.stringify({ id: 'synthetic-admin', role: 'SUPER_ADMIN' })); swr.data = undefined; swr.error = null; swr.loading = false; swr.validating = false; swr.keys = []; swr.mutate.mockClear(); });
const ready = () => { localStorage.setItem('nortex_token', 'synthetic-session'); swr.data = structuredClone(syntheticAdminOverview); };

describe('admin de métricas accionables', () => {
    it('sin sesión no consulta ni monta herramientas admin', () => {
        render(<AdminOverviewPanel><button>Herramienta privada</button></AdminOverviewPanel>);
        expect(swr.keys.at(-1)).toBeNull();
        expect(screen.getByRole('alert')).toHaveTextContent('Acceso reservado');
        expect(screen.queryByRole('button', { name: 'Herramienta privada' })).not.toBeInTheDocument();
    });
    it('muestra año gratis y MRR desconocido con fechas por verificar', () => {
        ready(); render(<AdminOverviewPanel />);
        expect(screen.getByText(/Contexto confirmado por Noel/)).toHaveTextContent('nadie había pagado');
        expect(screen.getByText('Desconocido')).toBeInTheDocument();
        expect(screen.getByText('Fundador · fechas por confirmar')).toBeInTheDocument();
        expect(screen.getByText('Sin recibos conciliados registrados para este mes. Cobertura parcial.')).toBeInTheDocument();
        expect(screen.queryByText(/préstamo|wallet|capital asignado|tu ganancia/i)).not.toBeInTheDocument();
    });
    it('permite llegar del indicador a cuentas pendientes, conservando alcance global del KPI', () => {
        ready(); render(<AdminOverviewPanel />);
        fireEvent.click(screen.getByRole('button', { name: /Sin primera venta/ }));
        expect((swr.keys.at(-1) as readonly [string, string])[0]).toBe('/api/admin/metrics?page=1&kind=REAL&focus=NO_SALE');
        expect(screen.getByLabelText('Clasificación')).toHaveValue('REAL');
        expect(screen.getByLabelText('Atención')).toHaveValue('NO_SALE');
    });
    it('la lista UNKNOWN es accesible y no se confunde con negocios reales', () => {
        ready(); render(<AdminOverviewPanel />);
        fireEvent.click(screen.getByRole('button', { name: /Sin clasificar/ }));
        expect((swr.keys.at(-1) as readonly [string, string])[0]).toBe('/api/admin/metrics?page=1&kind=UNKNOWN');
    });
    it('búsqueda se codifica y vuelve a primera página', () => {
        ready(); render(<AdminOverviewPanel />);
        fireEvent.change(screen.getByLabelText('Buscar negocio'), { target: { value: 'sintético &%' } });
        fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
        expect((swr.keys.at(-1) as readonly [string, string])[0]).toBe('/api/admin/metrics?page=1&search=sint%C3%A9tico+%26%25');
    });
    it('distingue carga de cero', () => {
        localStorage.setItem('nortex_token', 'synthetic-session'); swr.loading = true;
        render(<AdminOverviewPanel />);
        expect(screen.getByRole('status')).toHaveTextContent('Leyendo evidencia');
        expect(screen.queryByRole('region', { name: 'Prioridades de negocios reales' })).not.toBeInTheDocument();
    });
    it('fallo sin datos no presenta números o lista vacía como evidencia', () => {
        localStorage.setItem('nortex_token', 'synthetic-session'); swr.error = new Error('network');
        render(<AdminOverviewPanel />);
        expect(screen.getByRole('alert')).toHaveTextContent('esto no significa cero');
        expect(screen.queryByText('Cuentas para revisar')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
        expect(swr.mutate).toHaveBeenCalledOnce();
    });
    it('marca un corte anterior como desactualizado cuando falla refresco', () => {
        ready(); swr.error = new Error('network'); render(<AdminOverviewPanel />);
        expect(screen.getByRole('alert')).toHaveTextContent('Datos anteriores');
    });
    it('recibos de distintas monedas conservan precisión y no generan MRR', () => {
        ready(); const data = swr.data as typeof syntheticAdminOverview;
        data.billing.reconciledPaymentsThisMonth = [{ currency: 'USD', count: 2, amount: '0.3000' }, { currency: 'NIO', count: 1, amount: '100.0000' }];
        render(<AdminOverviewPanel />);
        expect(screen.getByText(/US\$ 0.3000/)).toBeInTheDocument();
        expect(screen.getByText(/C\$ 100.0000/)).toBeInTheDocument();
        expect(screen.getByText('Desconocido')).toBeInTheDocument();
    });
    it('página siguiente y anterior conservan el filtro y estados de borde', () => {
        ready(); (swr.data as typeof syntheticAdminOverview).pagination.pages = 2;
        render(<AdminOverviewPanel />);
        expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
        expect((swr.keys.at(-1) as readonly [string, string])[0]).toBe('/api/admin/metrics?page=2');
        expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
        expect((swr.keys.at(-1) as readonly [string, string])[0]).toBe('/api/admin/metrics?page=1');
    });
    it('detalles presentan fuente de actividad y señales del comercio con límite explícito', () => {
        ready(); render(<AdminOverviewPanel />);
        expect(screen.getByText(/Son señales, no fallos demostrados/)).toBeInTheDocument();
        expect(screen.getByText(/ACTIVE · no acredita pago ni mora/)).toBeInTheDocument();
        expect(screen.getByText('Último login del comercio')).toBeInTheDocument();
    });
    it('el fetch real adjunta JWT y no retorna payload privado de un403', async () => {
        localStorage.setItem('nortex_token', 'synthetic-session');
        const json = vi.fn(); const fetch = vi.fn().mockResolvedValue({ ok: false, status: 403, json }); vi.stubGlobal('fetch', fetch);
        await expect(readAdminOverview('/api/admin/metrics')).rejects.toMatchObject({ status: 403 });
        expect(fetch).toHaveBeenCalledWith('/api/admin/metrics', { headers: { Authorization: 'Bearer synthetic-session' }, cache: 'no-store' });
        expect(json).not.toHaveBeenCalled();
    });
});
