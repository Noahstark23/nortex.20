// @vitest-environment jsdom
import React from 'react';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantInvoiceReview } from '../components/assistant/AssistantInvoiceReview';
import { AssistantCatalogSelect } from '../components/assistant/AssistantCatalogSelect';
import type { AssistantCatalogItem, AssistantRequest } from '../hooks/useNortexAssistant';
import type { AssistantCapabilities, AssistantProposalDTO, InvoiceDraft } from '../shared/assistant';

const capabilities: AssistantCapabilities = { enabled: true, help: true, overview: true, inventory: true,
    invoiceRead: true, invoicePrepare: true, invoiceConfirm: false, purchasePrepare: true,
    extractionEnabled: false, executionEnabled: false };
const catalog = {
    products: [{ id: 'product-a', label: 'Producto catálogo A' }, { id: 'product-b', label: 'Producto catálogo B' }],
    suppliers: [{ id: 'supplier-a', label: 'Proveedor catálogo A' }, { id: 'supplier-b', label: 'Proveedor catálogo B' }],
};
function proposal(): AssistantProposalDTO {
    return { id: 'identity-proposal', version: 1, status: 'DRAFT', issues: ['Comprobá la identidad del catálogo.'],
        attachmentIds: ['synthetic-file'], expiresAt: '2030-09-19T23:00:00Z', preview: null,
        draft: { currency: '', supplierId: 'supplier-a', supplierName: 'Proveedor escrito en factura', invoiceNumber: '', date: '',
            documentTotal: '', receivedConfirmed: false, paymentConfirmed: false, warnings: ['Cantidad por verificar contra el documento.'],
            items: [{ productId: 'product-a', description: 'Descripción original de factura', quantity: '50', unitCost: '', purchaseUnit: 'BASE' }] } };
}
const flushSearch = () => act(async () => { await vi.advanceTimersByTimeAsync(251); });
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}
beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => '674539fd-01e4-4d15-a65c-6ee1e54a5533') });
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No se permite red en esta reproducción'); }));
});
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('H01-1: etiquetas e identidad en componentes reales', () => {
    it.each([
        ['products', 'Producto del catálogo 1', 'product-b', 'Producto catálogo B'],
        ['suppliers', 'Proveedor', 'supplier-b', 'Proveedor catálogo B'],
    ] as const)('%s mantiene la etiqueta B fuera de resultados y conserva el texto original', async (kind, label, id, selectedName) => {
        const source = proposal();
        const request = vi.fn(async (path: string) => {
            const params = new URL(path, 'http://catalog.invalid').searchParams;
            const items = catalog[params.get('kind') as keyof typeof catalog] ?? [];
            if (params.has('selectedId')) return { items: items.filter(item => item.id === params.get('selectedId')) };
            if (params.get('query')) return { items: [{ id: 'unrelated', label: 'Otra coincidencia' }] };
            return { items };
        }) as AssistantRequest;
        const onSave = vi.fn(async (_draft: InvoiceDraft) => {}), onConfirm = vi.fn(async (_key: string) => {});
        render(<AssistantInvoiceReview proposal={source} capabilities={capabilities} busy={false} operation={null}
            request={request} onSave={onSave} onConfirm={onConfirm} onOpenPurchases={vi.fn()} />);
        await flushSearch();
        const select = screen.getByRole('combobox', { name: label }) as HTMLSelectElement;
        await act(async () => { fireEvent.change(select, { target: { value: id } }); });
        expect(request).toHaveBeenCalledWith(`/catalog?kind=${kind}&query=&selectedId=${id}`);
        expect(select).toHaveValue(id);
        expect(select.selectedOptions[0]).toHaveTextContent(selectedName);
        fireEvent.change(screen.getByRole('searchbox', { name: `Buscar ${label.toLowerCase()}` }), { target: { value: 'otra cosa' } });
        await flushSearch();
        expect(within(select).getByRole('option', { name: 'Otra coincidencia' })).toBeInTheDocument();
        expect(select).toHaveValue(id);

        // Guardar sólo entrega el borrador a un espía; no invoca preview ni registro.
        fireEvent.click(screen.getByRole('button', { name: 'Guardar revisión y calcular efectos' }));
        expect(onSave).toHaveBeenCalledTimes(1);
        const saved = onSave.mock.calls[0][0];
        expect(saved.supplierName).toBe('Proveedor escrito en factura');
        expect(saved.items[0]).toMatchObject({ description: 'Descripción original de factura', quantity: '50', unitCost: '', purchaseUnit: 'BASE' });
        expect(saved).toMatchObject({ currency: '', invoiceNumber: '', date: '', documentTotal: '', receivedConfirmed: false, paymentConfirmed: false,
            warnings: ['Cantidad por verificar contra el documento.'] });
        expect(saved.paymentMethod).toBeUndefined();
        expect(kind === 'products' ? saved.items[0].productId : saved.supplierId).toBe(id);
        expect(onConfirm).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
        expect(screen.getByText('Cantidad por verificar contra el documento.')).toBeVisible();
        expect(select.selectedOptions[0]).toHaveTextContent(selectedName);
    });

    it.each([
        ['products', 'missing'], ['products', 'error'], ['products', 'selectionIssue'],
        ['suppliers', 'missing'], ['suppliers', 'error'], ['suppliers', 'selectionIssue'],
    ] as const)('bloquea Guardar ante %s/%s y recupera sin modificar los hechos', async (kind, failure) => {
        const source = proposal();
        source.draft.items[0].productId = 'product-b';
        const onSave = vi.fn(async (_draft: InvoiceDraft) => {}), onConfirm = vi.fn(async (_key: string) => {});
        const response = (path: string) => {
            const params = new URL(path, 'http://catalog.invalid').searchParams;
            const items = catalog[params.get('kind') as keyof typeof catalog] ?? [];
            return { items: params.has('selectedId') ? items.filter(item => item.id === params.get('selectedId')) : items };
        };
        const initialRequest = vi.fn(async (path: string) => response(path)) as AssistantRequest;
        let recovered = false;
        const currentRequest = vi.fn(async (path: string) => {
            const params = new URL(path, 'http://catalog.invalid').searchParams;
            if (params.get('kind') !== kind) return response(path);
            // La página de búsqueda no tiene que contener la ficha guardada.
            if (!params.has('selectedId')) return { items: [{ id: 'unrelated', label: 'Otra coincidencia' }] };
            if (recovered) return response(path);
            if (failure === 'error') throw new Error('CATALOG_SYNTHETIC_UNAVAILABLE');
            if (failure === 'missing') return { items: [] };
            return { items: response(path).items.map(item => ({ ...item, selectionIssue: 'Fichas ambiguas: revisá el catálogo.' })) };
        }) as AssistantRequest;
        const view = (request: AssistantRequest) => <AssistantInvoiceReview proposal={source} capabilities={capabilities} busy={false}
            operation={null} request={request} onSave={onSave} onConfirm={onConfirm} onOpenPurchases={vi.fn()} />;
        const { rerender } = render(view(initialRequest));
        await flushSearch();
        const save = screen.getByRole('button', { name: 'Guardar revisión y calcular efectos' });
        expect(save).toBeEnabled();

        // Un alcance nuevo debe verificar otra vez; no conservar una identidad verificada por el anterior.
        rerender(view(currentRequest));
        expect(save).toBeDisabled();
        await flushSearch();
        expect(save).toBeDisabled();
        fireEvent.click(save);
        expect(onSave).not.toHaveBeenCalled();
        expect(screen.getByText(/No pudimos verificar una selección del catálogo/)).toBeVisible();
        if (failure === 'selectionIssue') expect(screen.getAllByText(/Fichas ambiguas: revisá el catálogo/).length).toBeGreaterThan(0);
        expect(screen.getByRole('combobox', { name: 'Producto del catálogo 1' })).toHaveValue('product-b');
        expect(screen.getByRole('combobox', { name: 'Proveedor' })).toHaveValue('supplier-a');
        expect(screen.getByRole('textbox', { name: 'Cantidad 1' })).toHaveValue('50');
        expect(screen.getByRole('textbox', { name: 'Descripción en la factura' })).toHaveValue('Descripción original de factura');
        expect(screen.getByRole('textbox', { name: 'Proveedor escrito en la factura' })).toHaveValue('Proveedor escrito en factura');
        const expectedId = kind === 'products' ? 'product-b' : 'supplier-a';
        expect(currentRequest).toHaveBeenCalledWith(`/catalog?kind=${kind}&query=&selectedId=${expectedId}`);

        recovered = true;
        fireEvent.click(screen.getByRole('button', { name: 'Volver a verificar selección' }));
        await flushSearch();
        expect(save).toBeEnabled();
        expect(screen.queryByText(/No pudimos verificar una selección del catálogo/)).not.toBeInTheDocument();
        fireEvent.click(save);
        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onSave.mock.calls[0][0]).toEqual(source.draft);
        expect(onSave.mock.calls[0][0].items[0].productId).toBe('product-b');
        expect(onSave.mock.calls[0][0].supplierId).toBe('supplier-a');
        expect(onConfirm).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
    });

    it('una búsqueda tardía no sustituye las opciones de la búsqueda vigente', async () => {
        const first = deferred<{ items: AssistantCatalogItem[] }>(), second = deferred<{ items: AssistantCatalogItem[] }>();
        const request = vi.fn((path: string) => path.endsWith('query=actual') ? second.promise : first.promise) as AssistantRequest;
        const onChange = vi.fn();
        render(<AssistantCatalogSelect label="Producto" kind="products" request={request} onChange={onChange} />);
        await flushSearch();
        fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar producto' }), { target: { value: 'actual' } });
        await flushSearch();
        await act(async () => { second.resolve({ items: [{ id: 'current', label: 'Respuesta vigente' }] }); });
        await act(async () => { first.resolve({ items: [{ id: 'old', label: 'Respuesta obsoleta' }] }); });
        expect(screen.getByRole('option', { name: 'Respuesta vigente' })).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: 'Respuesta obsoleta' })).not.toBeInTheDocument();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('otra función request no comparte la respuesta pendiente del alcance anterior', async () => {
        const previous = deferred<{ items: AssistantCatalogItem[] }>();
        const requestA = vi.fn(() => previous.promise) as AssistantRequest;
        const requestB = vi.fn(async () => ({ items: [{ id: 'tenant-b-product', label: 'Catálogo vigente B' }] })) as AssistantRequest;
        const onChange = vi.fn();
        const { rerender } = render(<AssistantCatalogSelect label="Producto" kind="products" request={requestA} onChange={onChange} />);
        await flushSearch();
        rerender(<AssistantCatalogSelect label="Producto" kind="products" request={requestB} onChange={onChange} />);
        await flushSearch();
        await act(async () => { previous.resolve({ items: [{ id: 'tenant-a-product', label: 'Catálogo anterior A' }] }); });
        expect(screen.getByRole('option', { name: 'Catálogo vigente B' })).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: 'Catálogo anterior A' })).not.toBeInTheDocument();
        expect(onChange).not.toHaveBeenCalled();
    });
});
