// @vitest-environment jsdom
import React from 'react';
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { db, saveSaleOffline, recordOfflineSyncResults, type OfflineSale } from '../lib/db';
import { usePosOfflineQueue } from '../hooks/usePosOfflineQueue';
import { OperationalNotifications } from '../components/notifications/OperationalNotifications';
import { VentaEnCursoProvider, useReportarVenta } from '../components/VentaEnCursoContext';

const a = { tenantId: 'tenant-panel-a', userId: 'cashier-panel-a' };
const b = { tenantId: 'tenant-panel-b', userId: 'cashier-panel-b' };
const sale = (offlineId = 'offline-panel-a', identity = a): Omit<OfflineSale, 'synced'> => ({
    offlineId, ...identity, shiftId: 'shift-a', employeeId: null, customerId: null,
    customerName: 'No exportar cliente', paymentMethod: 'CASH', total: 25, globalDiscount: 0,
    fiscalRegimeVersion: 1, createdAt: '2026-09-02T02:00:00.000Z',
    items: [{ id: 'p1', name: 'Cable', quantity: '1', price: 25, costPrice: 10 }],
});
const session = (identity = a) => {
    localStorage.setItem('nortex_token', `token-${identity.userId}`);
    localStorage.setItem('nortex_tenant_data', JSON.stringify({ id: identity.tenantId }));
    localStorage.setItem('nortex_user', JSON.stringify({ id: identity.userId, tenant: { id: identity.tenantId }, role: 'CASHIER' }));
};
function Harness({ identity = a, isOnline = true }: { identity?: typeof a; isOnline?: boolean }) {
    const queue = usePosOfflineQueue(identity, async () => {});
    const route = useLocation();
    const report = useReportarVenta();
    const [cartQuantity, setCartQuantity] = React.useState('2');
    React.useEffect(() => { report({ hayVenta: true, lineas: 1, total: 50 }); }, [report]);
    return <><input aria-label="Cantidad en carrito" value={cartQuantity} onChange={event => setCartQuantity(event.target.value)} />
        <output aria-label="Ruta">{route.pathname}</output>
        <OperationalNotifications local={{ isOnline, pendingCount: queue.pendingCount, reconciliationCount: queue.reconciliationCount,
            syncing: queue.syncing, onSync: queue.sync, onRefresh: queue.refresh, recovery: queue.recovery }} /></>;
}
const shell = (identity = a, isOnline = true) => <MemoryRouter initialEntries={['/app/pos']}><VentaEnCursoProvider><Harness identity={identity} isOnline={isOnline} /></VentaEnCursoProvider></MemoryRouter>;
const open = async () => {
    fireEvent.click(screen.getByRole('button', { name: /^Avisos importantes/ }));
    return screen.findByRole('dialog', { name: 'Avisos importantes' });
};
beforeEach(async () => {
    await db.offline_sales.clear(); localStorage.clear(); session();
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => url.includes('operational-alerts')
        ? { checkedAt: '2026-09-04T17:00:00Z', sections: [] }
        : { offlineId: 'offline-panel-a', checkedAt: '2026-09-04T17:00:00Z', status: 'not_found' } })));
});
afterEach(async () => { cleanup(); await db.offline_sales.clear(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Avisos: recuperación dentro del POS', () => {
    it('abrir, revisar fecha original de Managua y cerrar conserva carrito, ruta y fila pendiente', async () => {
        await saveSaleOffline(sale()); render(shell());
        fireEvent.change(screen.getByLabelText('Cantidad en carrito'), { target: { value: '3' } });
        await open();
        fireEvent.click(await screen.findByRole('button', { name: /offline-panel-a/ }));
        expect(screen.getByRole('heading', { name: 'Referencia offline-panel-a' })).toHaveFocus();
        expect(screen.getByText('Fecha original · Managua')).toBeVisible();
        expect(screen.getByText(/1 sept 2026, 8:00/)).toBeVisible();
        expect(screen.getByText('Importe guardado')).toBeVisible();
        fireEvent.click(screen.getByRole('button', { name: 'Consultar referencia en servidor' }));
        expect(await screen.findByText(/No se encontró un registro accesible/)).toBeVisible();
        fireEvent.click(screen.getByRole('button', { name: 'Cerrar avisos' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(screen.getByLabelText('Cantidad en carrito')).toHaveValue('3');
        expect(screen.getByLabelText('Ruta')).toHaveTextContent('/app/pos');
        expect(await db.offline_sales.get('offline-panel-a')).toMatchObject({ createdAt: sale().createdAt, synced: 0 });
        expect(vi.mocked(fetch).mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
    });

    it('una revisión muestra motivo y descarga local sin botones de confirmar, borrar ni recrear', async () => {
        await saveSaleOffline(sale());
        await recordOfflineSyncResults([{ offlineId: 'offline-panel-a', status: 'reconciliation_required', code: 'OFFLINE_PAYLOAD_MISMATCH', error: 'El contenido no coincide' }]);
        const create = vi.fn(() => 'blob:local-qa'); vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }));
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        render(shell(a, false)); await open();
        fireEvent.click(await screen.findByRole('button', { name: /offline-panel-a/ }));
        const panel = screen.getByRole('region', { name: 'Ventas guardadas en este dispositivo' });
        expect(within(panel).getByText('El contenido no coincide')).toBeVisible();
        expect(within(panel).queryByRole('button', { name: /Reintentar esta venta|Marcar|Eliminar|Borrar|Recrear/ })).not.toBeInTheDocument();
        expect(within(panel).getByRole('button', { name: 'Consultar referencia en servidor' })).toBeDisabled();
        fireEvent.click(within(panel).getByRole('button', { name: 'Descargar evidencia para soporte' }));
        expect(await screen.findByText(/Archivo de evidencia descargado/)).toBeVisible();
        expect(click).toHaveBeenCalledOnce(); expect(create).toHaveBeenCalledOnce();
        expect(await db.offline_sales.get('offline-panel-a')).toMatchObject({ synced: 0, syncState: 'RECONCILIATION_REQUIRED' });
    });

    it('al cambiar de sesión cierra el detalle y no muestra la referencia anterior', async () => {
        await saveSaleOffline(sale()); await saveSaleOffline(sale('offline-panel-b', b));
        const { rerender } = render(shell()); await open();
        fireEvent.click(await screen.findByRole('button', { name: /offline-panel-a/ }));
        act(() => { session(b); window.dispatchEvent(new Event('storage')); rerender(shell(b)); });
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        await open();
        expect(await screen.findByRole('button', { name: /offline-panel-b/ })).toBeVisible();
        expect(screen.queryByText(/offline-panel-a/)).not.toBeInTheDocument();
        expect(screen.getByLabelText('Cantidad en carrito')).toHaveValue('2');
    });
});
