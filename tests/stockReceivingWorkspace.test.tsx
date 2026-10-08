// @vitest-environment jsdom
import React from 'react';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Purchases from '../components/Purchases';
import { bodegaReceivingDraftKey, readBodegaReceivingDraft, writeBodegaReceivingDraft } from '../utils/bodegaReceivingDraft';

vi.mock('../utils/tours', () => ({ maybeAutostartTour: vi.fn() }));

const supplier = { id: 'supplier-receiving', name: 'Proveedor recepción' };
const measuredProduct = {
    id: 'product-measured', name: 'Cable por metro', sku: 'CABLE-M',
    price: 3, cost: 1.234567, stock: 5, unit: 'm',
    saleMode: 'MEASURED' as const, quantityStep: '0.001', ivaExento: false,
};
const savedProduct = {
    id: 'product-saved', name: 'Tornillo del borrador', sku: 'TORNILLO',
    price: 5, cost: 2, stock: 8, unit: 'unidad',
    saleMode: 'COUNTED' as const, quantityStep: '1', ivaExento: false,
};
const warehouses = [
    { id: 'warehouse-main', name: 'Bodega principal', isDefault: true, isActive: true },
    { id: 'warehouse-entry', name: 'Bodega de materiales', isDefault: false, isActive: true },
];
const entryContext = { product: measuredProduct, warehouseId: 'warehouse-entry' };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
type Write = { url: string; method: string; key: string | null; body: string };

/** Transporte simulado: estas aserciones ejercen el componente real, sin acreditar HTTP/MySQL. */
function install(
    post: (write: Write) => Response | Promise<Response> = () => json({ id: 'purchase-confirmed' }, 201),
    catalog: unknown[] = [savedProduct],
    catalogResponse?: Promise<Response>,
) {
    const writes: Write[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        if (method !== 'GET') {
            const write = { url, method, key: new Headers(init?.headers).get('Idempotency-Key'), body: String(init?.body) };
            writes.push(write);
            if (url !== '/api/purchases' || method !== 'POST') throw new Error(`Unexpected mutation: ${method} ${url}`);
            return post(write);
        }
        if (url === '/api/suppliers') return json([supplier]);
        // El llamador entrega la ficha contextual, fuera de esta página del catálogo.
        if (url === '/api/products') return catalogResponse ?? json(catalog);
        if (url === '/api/warehouses') return json({ data: warehouses });
        if (url === '/api/purchase-orders') return json({ data: [] });
        if (url === '/api/purchases') return json([]);
        throw new Error(`Unexpected read: ${url}`);
    });
    return writes;
}

function deferredResponse() {
    let resolve!: (response: Response) => void;
    const promise = new Promise<Response>(done => { resolve = done; });
    return { promise, resolve };
}

const quantityInput = () => screen.getByLabelText(/Cantidad a facturar de Cable por metro/);
const costInput = () => screen.getByLabelText(/Costo de Cable por metro/);
const invoiceInput = () => screen.getByLabelText('# Factura Proveedor *');
const submitButton = () => screen.getByRole('button', { name: /^(Procesar ingreso|Registrar factura)$/ });
const storageSnapshot = () => Object.fromEntries(Object.keys(sessionStorage).sort().map(key => [key, sessionStorage.getItem(key)]));

function setTestRole(role: string, tenantId = 'tenant-receiving-test', userId = 'user-receiving-test') {
    localStorage.setItem('nortex_token', `x.${btoa(JSON.stringify({ role, tenantId, userId }))}.x`);
    localStorage.setItem('nortex_user', JSON.stringify({ role, id: userId, tenant: { id: tenantId } }));
}

function currentContextDraftKind() {
    const prefix = bodegaReceivingDraftKey('')!;
    const key = Object.keys(sessionStorage).find(candidate => candidate.startsWith(prefix) && candidate !== bodegaReceivingDraftKey('purchase'));
    expect(key).toBeTruthy();
    return key!.slice(prefix.length);
}

function ReceivingHost({ onCompleted }: { onCompleted: () => void }) {
    const [open, setOpen] = React.useState(true);
    return <>
        <button type="button" onClick={() => setOpen(true)}>Volver a recibir mercadería</button>
        {open
            ? <Purchases embedded entryContext={entryContext} onCompleted={() => { onCompleted(); setOpen(false); }} />
            : <p>Recepción cerrada tras confirmar</p>}
    </>;
}

async function completeEntry(invoice = 'FAC-ENTRADA-125') {
    await screen.findByRole('option', { name: supplier.name });
    fireEvent.change(screen.getByLabelText('Proveedor *'), { target: { value: supplier.id } });
    fireEvent.change(invoiceInput(), { target: { value: invoice } });
    fireEvent.change(quantityInput(), { target: { value: '0,125' } });
    fireEvent.change(costInput(), { target: { value: '1,234567' } });
}

/** Genera el borrador previo desde el formulario existente, sin copiar su estructura privada. */
async function saveGenericDraft() {
    const view = render(<Purchases />);
    await screen.findByRole('option', { name: supplier.name });
    fireEvent.change(screen.getByLabelText('Proveedor *'), { target: { value: supplier.id } });
    fireEvent.change(screen.getByLabelText(/^Bodega/), { target: { value: 'warehouse-main' } });
    fireEvent.change(invoiceInput(), { target: { value: 'FAC-BORRADOR-ANTERIOR' } });
    fireEvent.change(screen.getByPlaceholderText('Buscar producto por nombre o SKU...'), { target: { value: savedProduct.name } });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${savedProduct.name}`) }));
    await waitFor(() => expect(sessionStorage.getItem(bodegaReceivingDraftKey('purchase')!)).toContain('FAC-BORRADOR-ANTERIOR'));
    view.unmount();
    return sessionStorage.getItem(bodegaReceivingDraftKey('purchase')!);
}

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState({}, '', '/app/inventory');
    setTestRole('OWNER');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('recepción integrada desde la bodega', () => {
    it('precarga el producto y destino sin buscar otra vez ni abrir el módulo de compras', async () => {
        const writes = install();
        const onClose = vi.fn();
        render(<Purchases embedded entryContext={entryContext} onClose={onClose} />);

        expect(await screen.findByLabelText(/Cantidad a facturar de Cable por metro/)).toBeInTheDocument();
        expect(costInput()).toHaveValue('1.234567');
        await waitFor(() => expect(screen.getByLabelText('Bodega de destino *')).toHaveValue('warehouse-entry'));
        expect(screen.queryByRole('heading', { name: 'Compras' })).not.toBeInTheDocument();
        expect(screen.queryByText('Total de compras cargadas')).not.toBeInTheDocument();
        expect(screen.queryByText('Saldo de compras cargadas')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Historial/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Conciliación/ })).not.toBeInTheDocument();
        expect(writes).toHaveLength(0);

        fireEvent.click(screen.getByRole('button', { name: 'Cerrar recepción' }));
        expect(onClose).toHaveBeenCalledOnce();
        expect(writes).toHaveLength(0);
    });

    it('confirma 0,125 a costo 1,234567 mediante una sola compra directa', async () => {
        const writes = install();
        const onCompleted = vi.fn();
        render(<Purchases embedded entryContext={entryContext} onCompleted={onCompleted} />);
        await completeEntry();
        expect(writes).toHaveLength(0);

        fireEvent.click(submitButton());
        await waitFor(() => expect(onCompleted).toHaveBeenCalledOnce());
        expect(writes).toHaveLength(1);
        expect(writes[0]).toMatchObject({ url: '/api/purchases', method: 'POST' });
        expect(writes[0].key).toBeTruthy();
        const body = JSON.parse(writes[0].body);
        expect(body).toMatchObject({ supplierId: supplier.id, warehouseId: 'warehouse-entry', invoiceNumber: 'FAC-ENTRADA-125' });
        expect(body.purchaseOrderId).toBeUndefined();
        expect(body.items).toHaveLength(1);
        expect(body.items[0]).toMatchObject({ productId: measuredProduct.id, quantity: '0.125', unitCost: '1.234567', purchaseUnit: 'BASE' });
    });

    it('limpia la factura confirmada antes del cierre inmediato y vuelve a abrir una recepción nueva', async () => {
        const writes = install();
        let kind = '';
        const completed = vi.fn(() => readBodegaReceivingDraft<Record<string, unknown>>(kind));
        render(<ReceivingHost onCompleted={completed} />);
        const initialQuantity = (await screen.findByLabelText(/Cantidad a facturar de Cable por metro/) as HTMLInputElement).value;
        await completeEntry('FAC-YA-CONFIRMADA');
        kind = currentContextDraftKind();
        fireEvent.click(submitButton());
        await screen.findByText('Recepción cerrada tras confirmar');

        expect(completed).toHaveBeenCalledOnce();
        const snapshotAtCompletion = completed.mock.results[0].value;
        expect(snapshotAtCompletion?.invoiceNumber ?? '').toBe('');
        expect(snapshotAtCompletion?.attempt).toBeFalsy();
        expect(snapshotAtCompletion?.cart ?? []).toEqual([]);
        fireEvent.click(screen.getByRole('button', { name: 'Volver a recibir mercadería' }));
        expect(screen.queryByRole('button', { name: 'Continuar borrador' })).not.toBeInTheDocument();
        expect(await screen.findByLabelText(/Cantidad a facturar de Cable por metro/)).toHaveValue(initialQuantity);
        expect(invoiceInput()).toHaveValue('');
        expect(screen.getByLabelText('Bodega de destino *')).toHaveValue(entryContext.warehouseId);
        expect(readBodegaReceivingDraft<Record<string, unknown>>(kind)?.attempt).toBeFalsy();
        expect(writes).toHaveLength(1);
    });

    it('limpia solo la recepción confirmada al cerrar y conserva intacto el borrador general independiente', async () => {
        const writes = install();
        const genericBefore = await saveGenericDraft();
        let kind = '';
        const completed = vi.fn(() => ({
            contextual: readBodegaReceivingDraft<Record<string, unknown>>(kind),
            generic: sessionStorage.getItem(bodegaReceivingDraftKey('purchase')!),
        }));
        render(<ReceivingHost onCompleted={completed} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Conservar y recibir este producto' }));
        const initialQuantity = (await screen.findByLabelText(/Cantidad a facturar de Cable por metro/) as HTMLInputElement).value;
        await completeEntry('FAC-CONTEXTUAL-CONFIRMADA');
        kind = currentContextDraftKind();
        fireEvent.click(submitButton());
        await screen.findByText('Recepción cerrada tras confirmar');

        expect(completed).toHaveBeenCalledOnce();
        const snapshotAtCompletion = completed.mock.results[0].value;
        expect(snapshotAtCompletion.generic).toBe(genericBefore);
        expect(snapshotAtCompletion.contextual?.invoiceNumber ?? '').toBe('');
        expect(snapshotAtCompletion.contextual?.attempt).toBeFalsy();
        expect(snapshotAtCompletion.contextual?.cart ?? []).toEqual([]);
        expect(sessionStorage.getItem(bodegaReceivingDraftKey('purchase')!)).toBe(genericBefore);
        fireEvent.click(screen.getByRole('button', { name: 'Volver a recibir mercadería' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Conservar y recibir este producto' }));
        expect(await screen.findByLabelText(/Cantidad a facturar de Cable por metro/)).toHaveValue(initialQuantity);
        expect(invoiceInput()).toHaveValue('');
        expect(readBodegaReceivingDraft<Record<string, unknown>>(kind)?.attempt).toBeFalsy();
        expect(sessionStorage.getItem(bodegaReceivingDraftKey('purchase')!)).toBe(genericBefore);
        expect(writes).toHaveLength(1);
    });

    it.each([
        { missing: 'proveedor', label: 'Proveedor *', message: 'Seleccioná un proveedor.' },
        { missing: 'bodega', label: 'Bodega de destino *', message: 'Seleccioná la bodega donde entra la mercadería.' },
        { missing: 'número de factura', label: '# Factura Proveedor *', message: 'Ingresá el número de factura del proveedor.' },
        { missing: 'fecha de factura', label: 'Fecha de la factura *', message: 'Ingresá la fecha de la factura.' },
        { missing: 'vencimiento de crédito', label: 'Fecha de vencimiento *', message: 'Ingresá la fecha de vencimiento.' },
        { missing: 'productos', label: 'Agregar producto a la recepción', message: 'Agregá al menos un producto.' },
    ])('explica y enfoca el dato faltante: $missing, sin registrar la compra', async ({ missing, label, message }) => {
        const writes = install();
        const onCompleted = vi.fn();
        render(<Purchases embedded entryContext={entryContext} onCompleted={onCompleted} />);
        await completeEntry();
        await waitFor(() => expect(submitButton()).toBeEnabled());

        if (missing === 'vencimiento de crédito') fireEvent.click(screen.getByRole('button', { name: 'Credito' }));
        if (missing === 'productos') fireEvent.click(screen.getByRole('button', { name: 'Quitar Cable por metro' }));
        const field = screen.getByLabelText(label);
        if (missing !== 'productos') fireEvent.change(field, { target: { value: '' } });

        const submit = submitButton();
        expect(submit).toBeEnabled();
        fireEvent.click(submit);
        expect((await screen.findAllByText(message)).length).toBeGreaterThan(0);
        await waitFor(() => expect(field).toHaveFocus());
        expect(field).toHaveAttribute('aria-invalid', 'true');
        expect(writes).toHaveLength(0);
        expect(onCompleted).not.toHaveBeenCalled();
    });

    it('mantiene bloqueada la acción mientras carga los datos necesarios para recibir', async () => {
        const response = deferredResponse();
        const writes = install(undefined, [savedProduct], response.promise);
        render(<Purchases embedded entryContext={entryContext} />);

        expect(submitButton()).toBeDisabled();
        fireEvent.click(submitButton());
        expect(writes).toHaveLength(0);
        await act(async () => { response.resolve(json([savedProduct])); });
        await completeEntry();
        await waitFor(() => expect(submitButton()).toBeEnabled());
        expect(writes).toHaveLength(0);
    });

    it('recupera del catálogo el costo ausente en la ficha contextual de un gerente', async () => {
        setTestRole('MANAGER');
        const writes = install(undefined, [{ ...measuredProduct, cost: 2.5 }]);
        render(<Purchases embedded entryContext={{ ...entryContext, product: { ...measuredProduct, cost: undefined } }} />);

        expect(await screen.findByLabelText(/Cantidad a facturar de Cable por metro/)).toBeInTheDocument();
        await waitFor(() => expect(costInput()).toHaveValue('2.5'));
        expect(costInput()).toBeEnabled();
        expect(writes).toHaveLength(0);
    });

    it('mantiene el costo ausente vacío y editable sin registrar nada hasta que el gerente lo ingrese', async () => {
        setTestRole('MANAGER');
        const missingCost = { ...measuredProduct, cost: undefined };
        const writes = install(undefined, [missingCost]);
        const onCompleted = vi.fn();
        render(<Purchases embedded entryContext={{ ...entryContext, product: missingCost }} onCompleted={onCompleted} />);

        await screen.findByRole('option', { name: supplier.name });
        await screen.findByLabelText(/Costo de Cable por metro/);
        expect(costInput()).toHaveValue('');
        expect(costInput()).toBeEnabled();
        fireEvent.change(screen.getByLabelText('Proveedor *'), { target: { value: supplier.id } });
        fireEvent.change(invoiceInput(), { target: { value: 'FAC-COSTO-INGRESADO' } });
        fireEvent.change(quantityInput(), { target: { value: '0,125' } });
        fireEvent.click(submitButton());
        expect(writes).toHaveLength(0);
        expect(onCompleted).not.toHaveBeenCalled();
        expect(costInput()).toHaveValue('');

        fireEvent.change(costInput(), { target: { value: '2,5' } });
        fireEvent.click(submitButton());
        await waitFor(() => expect(onCompleted).toHaveBeenCalledOnce());
        expect(writes).toHaveLength(1);
        expect(JSON.parse(writes[0].body).items[0]).toMatchObject({ productId: measuredProduct.id, quantity: '0.125', unitCost: '2.5' });
    });

    it('bloquea formulario y cierre mientras espera la confirmación y notifica el estado ocupado', async () => {
        const response = deferredResponse();
        const writes = install(() => response.promise);
        const onClose = vi.fn();
        const onCompleted = vi.fn();
        const onBusyChange = vi.fn();
        render(<Purchases embedded entryContext={entryContext} onClose={onClose} onCompleted={onCompleted} onBusyChange={onBusyChange} />);
        await completeEntry();
        const submit = submitButton();
        fireEvent.click(submit);
        await waitFor(() => expect(writes).toHaveLength(1));

        expect(onBusyChange).toHaveBeenCalledWith(true);
        expect(quantityInput()).toBeDisabled();
        expect(costInput()).toBeDisabled();
        expect(invoiceInput()).toBeDisabled();
        expect(screen.getByLabelText('Proveedor *')).toBeDisabled();
        expect(screen.getByLabelText('Bodega de destino *')).toBeDisabled();
        expect(submit).toBeDisabled();
        const close = screen.getByRole('button', { name: 'Cerrar recepción' });
        expect(close).toBeDisabled();
        fireEvent.click(close);
        fireEvent.click(submit);
        expect(onClose).not.toHaveBeenCalled();
        expect(onCompleted).not.toHaveBeenCalled();
        expect(writes).toHaveLength(1);

        await act(async () => { response.resolve(json({ id: 'purchase-confirmed' }, 201)); });
        await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
        expect(onCompleted).toHaveBeenCalledOnce();
    });

    it('una respuesta pendiente de la sesión anterior no confirma en la sesión nueva ni modifica su borrador', async () => {
        const response = deferredResponse();
        const writes = install(() => response.promise);
        const onCompleted = vi.fn();
        const view = render(<Purchases embedded entryContext={entryContext} onCompleted={onCompleted} />);
        await completeEntry('FAC-SESION-A');
        fireEvent.click(submitButton());
        await waitFor(() => expect(writes).toHaveLength(1));

        // Obtiene el tipo contextual mediante la clave pública, sin fijar su nombre interno.
        const scopeA = bodegaReceivingDraftKey('')!;
        const keyA = Object.keys(sessionStorage).find(key => key.startsWith(scopeA));
        expect(keyA).toBeTruthy();
        const kind = keyA!.slice(scopeA.length);
        const draftA = readBodegaReceivingDraft<Record<string, unknown>>(kind);
        expect(draftA?.invoiceNumber).toBe('FAC-SESION-A');
        setTestRole('OWNER', 'tenant-session-b', 'user-session-b');
        expect(writeBodegaReceivingDraft(kind, { ...draftA, invoiceNumber: 'FAC-SESION-B', notes: 'Borrador de otra sesión', attempt: null })).toBe(true);
        const keyB = bodegaReceivingDraftKey(kind)!;
        const savedB = sessionStorage.getItem(keyB);

        await act(async () => { response.resolve(json({ id: 'purchase-session-a' }, 201)); });
        expect(onCompleted).not.toHaveBeenCalled();
        expect(sessionStorage.getItem(keyB)).toBe(savedB);
        expect(readBodegaReceivingDraft<Record<string, unknown>>(kind)?.invoiceNumber).toBe('FAC-SESION-B');
        expect(writes).toHaveLength(1);
        view.unmount();
        expect(sessionStorage.getItem(keyB)).toBe(savedB);
    });

    it('conserva contenido y clave al reintentar tras una respuesta incierta, incluso al volver a abrir', async () => {
        let attempt = 0;
        const writes = install(() => ++attempt === 1 ? json({ error: 'Resultado todavía no confirmado' }, 503) : json({ id: 'purchase-confirmed' }, 201));
        const onCompleted = vi.fn();
        const onBusyChange = vi.fn();
        const view = render(<Purchases embedded entryContext={entryContext} onCompleted={onCompleted} onBusyChange={onBusyChange} />);
        await completeEntry();
        fireEvent.click(submitButton());
        await screen.findByText('Resultado todavía no confirmado');
        expect(onCompleted).not.toHaveBeenCalled();
        expect(onBusyChange).toHaveBeenLastCalledWith(false);
        expect(invoiceInput()).toHaveValue('FAC-ENTRADA-125');
        expect(quantityInput()).toHaveValue('0.125');
        view.unmount();

        render(<Purchases embedded entryContext={entryContext} onCompleted={onCompleted} />);
        const resume = screen.queryByRole('button', { name: 'Continuar borrador' });
        if (resume) fireEvent.click(resume);
        await screen.findByRole('option', { name: supplier.name });
        expect(invoiceInput()).toHaveValue('FAC-ENTRADA-125');
        expect(quantityInput()).toHaveValue('0.125');
        expect(writes).toHaveLength(1);
        fireEvent.click(submitButton());
        await waitFor(() => expect(onCompleted).toHaveBeenCalledOnce());
        expect(writes).toHaveLength(2);
        expect(writes[0].key).toBeTruthy();
        expect(writes[1]).toEqual(writes[0]);
    });

    it('conserva un decimal ambiguo visible y no lo convierte en una entrada de inventario', async () => {
        const writes = install();
        const onCompleted = vi.fn();
        render(<Purchases embedded entryContext={entryContext} onCompleted={onCompleted} />);
        await completeEntry();
        fireEvent.change(quantityInput(), { target: { value: '0,1.25' } });
        expect(quantityInput()).toHaveValue('0,1.25');
        fireEvent.click(submitButton());
        expect(writes).toHaveLength(0);
        expect(onCompleted).not.toHaveBeenCalled();
        expect(quantityInput()).toHaveValue('0,1.25');
    });

    it('no pisa el borrador general antes de elegir y lo conserva al recibir el producto actual', async () => {
        const writes = install();
        const saved = await saveGenericDraft();
        const view = render(<Purchases embedded entryContext={entryContext} />);
        await screen.findByRole('button', { name: 'Continuar borrador' });
        expect(sessionStorage.getItem(bodegaReceivingDraftKey('purchase')!)).toBe(saved);
        expect(writes).toHaveLength(0);

        fireEvent.click(screen.getByRole('button', { name: 'Conservar y recibir este producto' }));
        await completeEntry('FAC-CONTEXTUAL-NUEVA');
        expect(screen.queryByLabelText(/Cantidad a facturar de Tornillo del borrador/)).not.toBeInTheDocument();
        expect(sessionStorage.getItem(bodegaReceivingDraftKey('purchase')!)).toBe(saved);
        view.unmount();

        render(<Purchases embedded entryContext={entryContext} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Continuar borrador' }));
        expect(invoiceInput()).toHaveValue('FAC-CONTEXTUAL-NUEVA');
        expect(quantityInput()).toHaveValue('0.125');
        expect(sessionStorage.getItem(bodegaReceivingDraftKey('purchase')!)).toBe(saved);
        expect(writes).toHaveLength(0);
    });

    it('continuar el borrador general conserva sus líneas y su destino sin añadir el producto contextual', async () => {
        const writes = install();
        await saveGenericDraft();
        render(<Purchases embedded entryContext={entryContext} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Continuar borrador' }));
        await screen.findByLabelText(/Cantidad a facturar de Tornillo del borrador/);
        expect(invoiceInput()).toHaveValue('FAC-BORRADOR-ANTERIOR');
        await waitFor(() => expect(screen.getByLabelText('Bodega de destino *')).toHaveValue('warehouse-main'));
        expect(screen.queryByLabelText(/Cantidad a facturar de Cable por metro/)).not.toBeInTheDocument();
        expect(writes).toHaveLength(0);
    });

    it('ofrece conservar y volver si ya existe un borrador contextual, sin modificarlo ni sincronizarlo', async () => {
        const writes = install();
        const view = render(<Purchases embedded entryContext={entryContext} />);
        await completeEntry('FAC-CONTEXTUAL-GUARDADA');
        view.unmount();
        const saved = storageSnapshot();
        const onClose = vi.fn();
        render(<Purchases embedded entryContext={entryContext} onClose={onClose} />);
        await screen.findByRole('button', { name: 'Continuar borrador' });
        const back = screen.getByRole('button', { name: 'Conservar y volver' });
        expect(screen.queryByRole('button', { name: 'Conservar y recibir este producto' })).not.toBeInTheDocument();
        expect(storageSnapshot()).toEqual(saved);
        fireEvent.click(back);
        expect(onClose).toHaveBeenCalledOnce();
        expect(storageSnapshot()).toEqual(saved);
        expect(writes).toHaveLength(0);
    });
});
