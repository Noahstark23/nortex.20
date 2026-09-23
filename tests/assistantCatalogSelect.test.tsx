// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { AssistantCatalogSelect } from '../components/assistant/AssistantCatalogSelect';
import type { AssistantCatalogItem, AssistantCatalogKind, AssistantRequest } from '../hooks/useNortexAssistant';
import type { AssistantCatalogSelectionStatus } from '../hooks/useAssistantCatalogSelection';
import { readAssistantCatalog } from '../hooks/assistantCatalogRequests';

const a: AssistantCatalogItem = { id: 'a', label: 'Cemento A', detail: 'SKU A · Marca Uno · Unidad bolsa' };
const b: AssistantCatalogItem = { id: 'b', label: 'Cemento B', detail: 'SKU B · Marca Dos · Unidad bolsa' };
const params = (path: string) => new URLSearchParams(path.slice(path.indexOf('?')));
const tick = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(251); }); };
const flush = async () => { await act(async () => { await Promise.resolve(); }); };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function Harness({ request, initialValue, kind = 'products', onSelect = () => undefined, onResolved }: {
    request: AssistantRequest; initialValue?: string; kind?: AssistantCatalogKind; onSelect?: (id?: string) => void;
    onResolved?: (item: AssistantCatalogItem | null, status: AssistantCatalogSelectionStatus) => void;
}) {
    const [value, setValue] = useState(initialValue);
    return <AssistantCatalogSelect label="Ficha" kind={kind} value={value} selectedLabel="Texto original A de la factura" request={request}
        onChange={id => { setValue(id); onSelect(id); }} onSelectionResolved={onResolved} />;
}
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('selección de catálogo H01-1', () => {
    it('200 selecciones guardadas comparten un máximo de cuatro lecturas simultáneas', async () => {
        const pending = new Map<string, ReturnType<typeof deferred<{ items: AssistantCatalogItem[] }>>>();
        let active = 0; let maximum = 0;
        const request = vi.fn((path: string) => {
            const entry = deferred<{ items: AssistantCatalogItem[] }>(); pending.set(path, entry);
            active++; maximum = Math.max(maximum, active);
            return entry.promise.finally(() => { active--; pending.delete(path); });
        });
        const resolved = vi.fn();
        render(<>{Array.from({ length: 200 }, (_, index) => <div key={index}><AssistantCatalogSelect label={`Producto ${index}`} kind="products" value={`p${index}`} request={request as AssistantRequest} onChange={vi.fn()} onSelectionResolved={resolved} /></div>)}</>);
        await flush(); expect(request).toHaveBeenCalledTimes(4); expect(active).toBe(4);
        let completed = 0;
        while (completed < 200) {
            const batch = [...pending.entries()]; expect(batch.length).toBeGreaterThan(0);
            await act(async () => {
                for (const [path, entry] of batch) {
                    const id = params(path).get('selectedId')!;
                    entry.resolve({ items: [{ id, label: `Ficha ${id}` }] }); completed++;
                }
            });
        }
        expect(maximum).toBe(4); expect(active).toBe(0); expect(request).toHaveBeenCalledTimes(200);
        expect(resolved.mock.calls.filter(([, status]) => status === 'resolved')).toHaveLength(200);
    });
    it('cerrar 200 selectores cancela lecturas en cola y permite terminar sólo las cuatro activas', async () => {
        const pending: ReturnType<typeof deferred<{ items: AssistantCatalogItem[] }>>[] = [];
        const request = vi.fn(() => { const entry = deferred<{ items: AssistantCatalogItem[] }>(); pending.push(entry); return entry.promise; });
        const { unmount } = render(<>{Array.from({ length: 200 }, (_, index) => <div key={index}><AssistantCatalogSelect label={`Producto ${index}`} kind="products" value={`p${index}`} request={request as AssistantRequest} onChange={vi.fn()} /></div>)}</>);
        await flush(); expect(request).toHaveBeenCalledTimes(4);
        unmount(); await act(async () => { pending.forEach(entry => entry.resolve({ items: [] })); }); await tick();
        expect(request).toHaveBeenCalledTimes(4);
    });
    it('un selector legacy deshabilitado no agrega tráfico a la cola', async () => {
        const request = vi.fn(async () => ({ items: [] }));
        render(<AssistantCatalogSelect label="Bodega" kind="warehouses" value="warehouse" disabled request={request as AssistantRequest} onChange={vi.fn()} />);
        await tick(); expect(request).not.toHaveBeenCalled();
    });
    it.each(['products', 'suppliers'] as const)('elegir B y cambiar búsqueda conserva su identidad, sin etiqueta de factura (%s)', async kind => {
        const request = vi.fn(async (path: string) => ({ items: params(path).get('query') ? [] : [a, b] })) as unknown as AssistantRequest;
        const changed = vi.fn(); render(<Harness request={request} kind={kind} onSelect={changed} />); await tick();
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'b' } });
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'otro' } }); await tick();
        const select = screen.getByRole('combobox') as HTMLSelectElement;
        expect(select.value).toBe('b'); expect(select.selectedOptions[0].textContent).toContain('Cemento B');
        expect(select.selectedOptions[0].textContent).toContain('SKU B'); expect(screen.queryByText(/Texto original A/)).not.toBeInTheDocument();
        expect(changed).toHaveBeenCalledTimes(1); expect(changed).toHaveBeenCalledWith('b');
    });
    it('reabre el ID guardado mediante consulta exacta aunque no aparezca en la búsqueda', async () => {
        const request = vi.fn(async (path: string) => ({ items: params(path).get('selectedId') === 'b' ? [b] : [a] }));
        render(<Harness request={request as AssistantRequest} initialValue="b" />); await tick();
        expect(request.mock.calls.some(([path]) => params(path).get('selectedId') === 'b' && params(path).get('query') === '')).toBe(true);
        const select = screen.getByRole('combobox') as HTMLSelectElement;
        expect(select.selectedOptions[0].textContent).toContain('Cemento B'); expect(select.value).toBe('b');
    });
    it('muestra advertencias aproximadas sin cambiar ni completar la selección', async () => {
        const change = vi.fn(); const request = vi.fn(async () => ({ items: [a], warnings: ['Coincidencia aproximada: verificá la concentración.'] }));
        render(<AssistantCatalogSelect label="Producto" kind="products" request={request as AssistantRequest} onChange={change} />); await tick();
        expect(screen.getByText('Coincidencia aproximada: verificá la concentración.')).toBeVisible(); expect(change).not.toHaveBeenCalled();
        expect(screen.getByRole('combobox')).toHaveValue('');
    });
    it('dos fichas indistinguibles no se pueden elegir y explican que se deben revisar', async () => {
        const issue = 'Hay fichas indistinguibles: revisá sus datos.';
        const request = vi.fn(async () => ({ items: [{ ...a, selectionIssue: issue }, { ...a, id: 'same', selectionIssue: issue }], warnings: [issue] }));
        const change = vi.fn(); render(<AssistantCatalogSelect label="Producto" kind="products" request={request as AssistantRequest} onChange={change} />); await tick();
        expect(screen.getByText(issue)).toBeVisible();
        expect(screen.getAllByRole('option', { name: /Cemento A/ }).every(option => (option as HTMLOptionElement).disabled)).toBe(true);
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'a' } }); expect(change).not.toHaveBeenCalled();
    });
    it('notifica indisponibilidad de una selección guardada ambigua sin borrar el ID', async () => {
        const item = { ...b, selectionIssue: 'Revisá fichas duplicadas.' }; const resolved = vi.fn(); const changed = vi.fn();
        const request = vi.fn(async (path: string) => ({ items: params(path).has('selectedId') ? [item] : [] }));
        render(<AssistantCatalogSelect label="Producto" kind="products" value="b" request={request as AssistantRequest} onChange={changed} onSelectionResolved={resolved} />); await tick();
        expect(resolved).toHaveBeenLastCalledWith(item, 'unavailable'); expect(changed).not.toHaveBeenCalled();
        expect(screen.getByRole('combobox')).toHaveValue('b'); expect(screen.getByText(/No se pudo verificar la selección guardada/)).toBeVisible();
    });
    it('suprime resultados y errores tardíos de una búsqueda anterior', async () => {
        const first = deferred<{ items: AssistantCatalogItem[] }>(); const lateError = deferred<{ items: AssistantCatalogItem[] }>();
        const request = vi.fn((path: string) => params(path).get('query') === 'fallará' ? lateError.promise : params(path).get('query') === '' ? first.promise : Promise.resolve({ items: [b] }));
        render(<Harness request={request as AssistantRequest} />); await tick();
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'fallará' } }); await tick();
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'vigente' } }); await tick();
        await act(async () => { first.resolve({ items: [a] }); lateError.reject(new Error('Viejo')); });
        expect(screen.getByRole('option', { name: /Cemento B/ })).toBeVisible(); expect(screen.queryByRole('option', { name: /Cemento A/ })).not.toBeInTheDocument();
        expect(screen.queryByText(/No pudimos consultar/)).not.toBeInTheDocument();
    });
    it('cambiar de request/sesión retira el nombre viejo inmediatamente y descarta su respuesta tardía', async () => {
        const late = deferred<{ items: AssistantCatalogItem[] }>(); const oldRequest = vi.fn(() => late.promise);
        const nextRequest = vi.fn(async () => ({ items: [] }));
        const resolved = vi.fn(); const { rerender } = render(<AssistantCatalogSelect label="Producto" kind="products" value="b" selectedLabel="Nombre privado antiguo" request={oldRequest as AssistantRequest} onChange={vi.fn()} onSelectionResolved={resolved} />);
        await tick();
        rerender(<AssistantCatalogSelect label="Producto" kind="products" value="b" selectedLabel="Nombre privado antiguo" request={nextRequest as AssistantRequest} onChange={vi.fn()} onSelectionResolved={resolved} />);
        expect(screen.queryByText(/Nombre privado antiguo/)).not.toBeInTheDocument();
        await act(async () => { late.resolve({ items: [b] }); }); await tick();
        expect(screen.queryByRole('option', { name: /Cemento B/ })).not.toBeInTheDocument(); expect(resolved).toHaveBeenLastCalledWith(null, 'unavailable');
    });
    it('al cambiar filtros verifica la misma ID de nuevo sin reutilizar su nombre anterior', async () => {
        const second = deferred<{ items: AssistantCatalogItem[] }>();
        const request = vi.fn((path: string) => params(path).get('warehouseId') === 'dos' ? second.promise : Promise.resolve({ items: [b] }));
        const { rerender } = render(<AssistantCatalogSelect label="Producto" kind="products" value="b" parameters={{ warehouseId: 'uno' }} request={request as AssistantRequest} onChange={vi.fn()} />); await tick();
        expect(screen.getByRole('option', { name: /Cemento B/ })).toBeVisible();
        rerender(<AssistantCatalogSelect label="Producto" kind="products" value="b" parameters={{ warehouseId: 'dos' }} request={request as AssistantRequest} onChange={vi.fn()} />);
        expect(screen.queryByRole('option', { name: /Cemento B/ })).not.toBeInTheDocument();
        await act(async () => { second.resolve({ items: [] }); }); await tick();
        expect(screen.queryByRole('option', { name: /Cemento B/ })).not.toBeInTheDocument();
    });
    it('error al recuperar ID guardado conserva el ID y permite verificar de nuevo sin elegir otro', async () => {
        let fails = true; const resolved = vi.fn(); const changed = vi.fn();
        const request = vi.fn((path: string) => params(path).has('selectedId') ? fails ? Promise.reject(new Error('Caído')) : Promise.resolve({ items: [b] }) : Promise.resolve({ items: [] }));
        render(<AssistantCatalogSelect label="Producto" kind="products" value="b" request={request as AssistantRequest} onChange={changed} onSelectionResolved={resolved} />); await tick();
        expect(resolved).toHaveBeenLastCalledWith(null, 'error'); expect(screen.getByRole('combobox')).toHaveValue('b');
        fails = false; fireEvent.click(screen.getByRole('button', { name: 'Volver a verificar selección' })); await flush();
        expect(resolved).toHaveBeenLastCalledWith(b, 'resolved'); expect(changed).not.toHaveBeenCalled();
    });
    it('productos y proveedores conservan elecciones independientes', async () => {
        const request = vi.fn(async (path: string) => ({ items: params(path).get('kind') === 'products' ? [a, b] : [{ id: 'supplier', label: 'Proveedor UNO', detail: 'RUC 123' }] }));
        render(<><Harness request={request as AssistantRequest} kind="products" /><Harness request={request as AssistantRequest} kind="suppliers" /></>); await tick();
        const [product, supplier] = screen.getAllByRole('combobox');
        fireEvent.change(product, { target: { value: 'b' } }); fireEvent.change(supplier, { target: { value: 'supplier' } });
        expect(product).toHaveValue('b'); expect(supplier).toHaveValue('supplier');
    });
    it('conserva el contrato legacy de bodega sin enviar selectedId', async () => {
        const request = vi.fn(async () => ({ items: [] }));
        render(<AssistantCatalogSelect label="Bodega" kind="warehouses" value="warehouse" selectedLabel="Bodega guardada" request={request as AssistantRequest} onChange={vi.fn()} />); await tick();
        expect(screen.getByRole('option', { name: 'Bodega guardada · revisar' })).toBeVisible(); expect(request.mock.calls).toHaveLength(1);
    });
    it('una advertencia nueva para el mismo ID invalida su estado verificado y no la revierte una lectura exacta tardía', async () => {
        const exact = deferred<{ items: AssistantCatalogItem[] }>(); const issue = { ...b, selectionIssue: 'Revisá fichas duplicadas.' }; const resolved = vi.fn();
        const request = vi.fn((path: string) => params(path).has('selectedId') ? exact.promise : Promise.resolve({ items: [issue] }));
        render(<AssistantCatalogSelect label="Producto" kind="products" value="b" request={request as AssistantRequest} onChange={vi.fn()} onSelectionResolved={resolved} />); await tick();
        await act(async () => { exact.resolve({ items: [b] }); });
        expect(resolved).toHaveBeenLastCalledWith(issue, 'unavailable');
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'nueva' } });
        expect(resolved).toHaveBeenLastCalledWith(issue, 'unavailable');
    });
    it('elegir una opción de búsqueda exige consultar su ID exacto antes de declararla resuelta', async () => {
        const exact = deferred<{ items: AssistantCatalogItem[] }>(); const resolved = vi.fn();
        const request = vi.fn((path: string) => params(path).has('selectedId') ? exact.promise : Promise.resolve({ items: [b] }));
        render(<Harness request={request as AssistantRequest} onResolved={resolved} />); await tick();
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'b' } }); await flush();
        expect(request.mock.calls.some(([path]) => params(path).get('selectedId') === 'b')).toBe(true);
        expect(resolved).not.toHaveBeenCalledWith(b, 'resolved');
        const issue = { ...b, selectionIssue: 'Otra ficha indistinguible existe fuera de esta página.' };
        await act(async () => { exact.resolve({ items: [issue] }); });
        expect(resolved).toHaveBeenLastCalledWith(issue, 'unavailable');
    });
    it('una lista válida no levanta el bloqueo de la consulta exacta ni al cambiar búsqueda', async () => {
        const issue = { ...b, selectionIssue: 'Revisá la ficha homónima.' }; const resolved = vi.fn();
        const request = vi.fn(async (path: string) => ({ items: params(path).has('selectedId') ? [issue] : [b] }));
        render(<Harness request={request as AssistantRequest} initialValue="b" onResolved={resolved} />); await tick();
        expect(resolved).toHaveBeenLastCalledWith(issue, 'unavailable');
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'cambio de búsqueda' } }); await tick();
        expect(resolved).toHaveBeenLastCalledWith(issue, 'unavailable'); expect(resolved).not.toHaveBeenCalledWith(b, 'resolved');
    });
    it('una lista válida nunca oculta el error al verificar un ID exacto', async () => {
        const resolved = vi.fn(); const request = vi.fn((path: string) => params(path).has('selectedId') ? Promise.reject(new Error('error exacto')) : Promise.resolve({ items: [b] }));
        render(<Harness request={request as AssistantRequest} initialValue="b" onResolved={resolved} />); await tick();
        expect(resolved).toHaveBeenLastCalledWith(null, 'error');
        expect(screen.getByRole('button', { name: 'Volver a verificar selección' })).toBeVisible();
    });
    it.each(['sku', 'unit', 'ruc'] as const)('cambio de %s del mismo ID invalida revisión, conserva snapshot y exige lectura exacta nueva', async field => {
        const oldItem = { ...b, [field]: 'anterior' }; const newItem = { ...oldItem, [field]: 'nuevo', detail: 'Datos NUEVOS de catálogo' };
        let exactItem = oldItem; const resolved = vi.fn();
        const request = vi.fn(async (path: string) => ({ items: params(path).has('selectedId') ? [exactItem] : params(path).get('query') ? [newItem] : [oldItem] }));
        render(<Harness request={request as AssistantRequest} initialValue="b" onResolved={resolved} kind={field === 'ruc' ? 'suppliers' : 'products'} />); await tick();
        expect(resolved).toHaveBeenLastCalledWith(oldItem, 'resolved');
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'otra búsqueda' } }); await tick();
        expect(resolved).toHaveBeenLastCalledWith(newItem, 'unavailable');
        expect((screen.getByRole('combobox') as HTMLSelectElement).selectedOptions[0].textContent).not.toContain('Datos NUEVOS');
        expect(screen.getByLabelText('Datos de ficha')).toHaveTextContent(oldItem.detail);
        expect(screen.getByLabelText('Datos de ficha')).not.toHaveTextContent('Datos NUEVOS');
        expect(screen.getByLabelText('Datos de ficha')).toHaveTextContent('Estos datos todavía no permiten revisar los efectos.');
        expect(screen.getByText(/Los datos de la ficha cambiaron/)).toBeVisible();
        exactItem = newItem; fireEvent.click(screen.getByRole('button', { name: 'Volver a verificar selección' })); await flush();
        expect(resolved).toHaveBeenLastCalledWith(newItem, 'resolved');
        expect((screen.getByRole('combobox') as HTMLSelectElement).selectedOptions[0].textContent).toContain('Datos NUEVOS');
        expect(screen.getByLabelText('Datos de ficha')).toHaveTextContent('Datos NUEVOS');
    });
    it.each([
        ['products', 'Producto del catálogo 1', 'SKU CEM-42-500-QA · Marca Dos · Unidad bolsa · Empaque pallet de 40 bolsas de catálogo'],
        ['suppliers', 'Proveedor', 'RUC QA-0123456789 · Dirección: Mercado de prueba, de la esquina sintética tres cuadras al sur'],
    ] as const)('muestra el nombre y detalle exactos completos fuera del select nativo para %s', async (kind, label, detail) => {
        const item = { ...b, label: 'Ficha exacta con nombre extenso de catálogo', detail };
        const request = vi.fn(async (path: string) => ({ items: params(path).has('selectedId') ? [item] : [] }));
        render(<AssistantCatalogSelect label={label} kind={kind} value="b" selectedLabel="Texto distinto de la factura" request={request as AssistantRequest} onChange={vi.fn()} />); await tick();
        const summary = screen.getByLabelText(`Datos de ${label.toLowerCase()}`);
        expect(summary.tagName).toBe('P'); expect(summary).toHaveTextContent(item.label); expect(summary).toHaveTextContent(detail);
        expect(summary).not.toHaveTextContent('Texto distinto de la factura');
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'otra búsqueda sin resultados' } }); await tick();
        expect(summary).toHaveTextContent(item.label); expect(summary).toHaveTextContent(detail);
    });
    it('el resumen pendiente nunca muestra identidad tomada de la búsqueda o de la factura', async () => {
        const exact = deferred<{ items: AssistantCatalogItem[] }>();
        const request = vi.fn((path: string) => params(path).has('selectedId') ? exact.promise : Promise.resolve({ items: [{ ...b, label: 'Nombre sólo de búsqueda' }] }));
        render(<AssistantCatalogSelect label="Proveedor" kind="suppliers" value="b" selectedLabel="Proveedor declarado sin verificar" request={request as AssistantRequest} onChange={vi.fn()} />); await tick();
        const summary = screen.getByLabelText('Datos de proveedor');
        expect(summary).toHaveTextContent('Verificación de la selección guardada pendiente.');
        expect(summary).not.toHaveTextContent('Nombre sólo de búsqueda'); expect(summary).not.toHaveTextContent('Proveedor declarado');
        await act(async () => { exact.resolve({ items: [b] }); });
        expect(summary).toHaveTextContent(b.label); expect(summary).toHaveTextContent(b.detail);
        expect(summary).toHaveTextContent('Estos datos todavía no permiten revisar los efectos.');
    });
});

describe('cola de lecturas de catálogo', () => {
    it('un rechazo libera el cupo y permite recuperar la misma ruta sin cachear el error', async () => {
        const pending = Array.from({ length: 6 }, () => deferred<{ items: AssistantCatalogItem[] }>());
        const request = vi.fn(() => pending[request.mock.calls.length - 1].promise);
        const reads = Array.from({ length: 5 }, (_, index) => readAssistantCatalog(request as AssistantRequest, `/catalog?kind=products&selectedId=${index}`));
        const firstFailure = reads[0].promise.catch(error => error.message);
        await flush(); expect(request).toHaveBeenCalledTimes(4);
        await act(async () => { pending[0].reject(new Error('Caída temporal')); });
        expect(request).toHaveBeenCalledTimes(5); expect(await firstFailure).toBe('Caída temporal');
        const retry = readAssistantCatalog(request as AssistantRequest, '/catalog?kind=products&selectedId=0');
        await flush(); expect(request).toHaveBeenCalledTimes(5);
        await act(async () => { pending[1].resolve({ items: [] }); });
        expect(request).toHaveBeenCalledTimes(6);
        await act(async () => { pending.slice(2).forEach(entry => entry.resolve({ items: [b] })); });
        expect(await retry.promise).toEqual({ items: [b], warnings: [] });
        await Promise.all(reads.slice(1).map(read => read.promise)); reads.forEach(read => read.release()); retry.release();
    });
    it('dos observadores de una ruta en cola comparten la lectura y liberar uno no cancela al otro', async () => {
        const pending = Array.from({ length: 6 }, () => deferred<{ items: AssistantCatalogItem[] }>());
        const request = vi.fn(() => pending[request.mock.calls.length - 1].promise);
        const active = Array.from({ length: 4 }, (_, index) => readAssistantCatalog(request as AssistantRequest, `/catalog?kind=products&selectedId=${index}`));
        const one = readAssistantCatalog(request as AssistantRequest, '/catalog?kind=products&selectedId=shared');
        const two = readAssistantCatalog(request as AssistantRequest, '/catalog?kind=products&selectedId=shared');
        expect(one.promise).toBe(two.promise); one.release(); one.release();
        await flush(); expect(request).toHaveBeenCalledTimes(4);
        await act(async () => { pending[0].resolve({ items: [] }); });
        expect(request).toHaveBeenCalledTimes(5);
        const three = readAssistantCatalog(request as AssistantRequest, '/catalog?kind=products&selectedId=shared');
        expect(three.promise).toBe(two.promise); two.release();
        await act(async () => { pending.slice(1, 5).forEach(entry => entry.resolve({ items: [b] })); });
        expect(await three.promise).toEqual({ items: [b], warnings: [] });
        const fresh = readAssistantCatalog(request as AssistantRequest, '/catalog?kind=products&selectedId=shared');
        expect(fresh.promise).not.toBe(three.promise); await flush(); expect(request).toHaveBeenCalledTimes(6);
        pending[5].resolve({ items: [a] }); expect(await fresh.promise).toEqual({ items: [a], warnings: [] });
        await Promise.all(active.map(read => read.promise)); active.forEach(read => read.release()); three.release(); fresh.release();
    });
    it('cancelar todos los observadores de una ruta en cola permite volver a pedirla como lectura nueva', async () => {
        const pending = Array.from({ length: 5 }, () => deferred<{ items: AssistantCatalogItem[] }>());
        const request = vi.fn(() => pending[request.mock.calls.length - 1].promise);
        const active = Array.from({ length: 4 }, (_, index) => readAssistantCatalog(request as AssistantRequest, `/catalog?kind=products&selectedId=${index}`));
        const cancelled = readAssistantCatalog(request as AssistantRequest, '/catalog?kind=products&selectedId=queued');
        const cancellation = cancelled.promise.catch(error => error.message);
        cancelled.release(); cancelled.release();
        expect(await cancellation).toBe('CATALOG_READ_CANCELLED');
        const next = readAssistantCatalog(request as AssistantRequest, '/catalog?kind=products&selectedId=queued');
        expect(next.promise).not.toBe(cancelled.promise); await flush(); expect(request).toHaveBeenCalledTimes(4);
        await act(async () => { pending[0].resolve({ items: [] }); });
        expect(request).toHaveBeenCalledTimes(5);
        pending.slice(1).forEach(entry => entry.resolve({ items: [] }));
        await Promise.all([...active, next].map(read => read.promise)); [...active, next].forEach(read => read.release());
    });
    it('la misma ruta en otra sesión jamás recibe ni reutiliza una respuesta ajena', async () => {
        const old = deferred<{ items: AssistantCatalogItem[] }>(); const current = deferred<{ items: AssistantCatalogItem[] }>();
        const oldRequest = vi.fn(() => old.promise); const currentRequest = vi.fn(() => current.promise);
        const path = '/catalog?kind=products&selectedId=shared';
        const previous = readAssistantCatalog(oldRequest as AssistantRequest, path);
        const next = readAssistantCatalog(currentRequest as AssistantRequest, path);
        expect(previous.promise).not.toBe(next.promise); await flush();
        expect(oldRequest).toHaveBeenCalledTimes(1); expect(currentRequest).toHaveBeenCalledTimes(1);
        current.resolve({ items: [{ id: 'shared', label: 'Ficha del negocio nuevo' }] });
        expect((await next.promise).items[0].label).toBe('Ficha del negocio nuevo');
        old.resolve({ items: [{ id: 'shared', label: 'Ficha privada anterior' }] });
        expect((await previous.promise).items[0].label).toBe('Ficha privada anterior');
        expect((await next.promise).items[0].label).toBe('Ficha del negocio nuevo'); previous.release(); next.release();
    });
    it.each(['throw', 'invalid'] as const)('un fallo %s también libera los cupos de la cola', async failure => {
        const pending = deferred<{ items: AssistantCatalogItem[] }>();
        const request = vi.fn(() => {
            if (request.mock.calls.length === 1) {
                if (failure === 'throw') throw new Error('Fallo síncrono');
                return Promise.resolve({ unexpected: true });
            }
            return pending.promise;
        });
        const reads = Array.from({ length: 5 }, (_, index) => readAssistantCatalog(request as AssistantRequest, `/catalog?kind=products&selectedId=${index}`));
        const failed = reads[0].promise.catch(error => error.message);
        await flush(); expect(request).toHaveBeenCalledTimes(5);
        expect(await failed).toBe(failure === 'throw' ? 'Fallo síncrono' : 'CATALOG_RESPONSE_INVALID');
        pending.resolve({ items: [] }); await Promise.all(reads.slice(1).map(read => read.promise)); reads.forEach(read => read.release());
    });
});
