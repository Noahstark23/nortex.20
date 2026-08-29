// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PurchaseOrders from '../components/PurchaseOrders';
import Purchases, { purchaseOrderLineAvailability } from '../components/Purchases';

vi.mock('../utils/tours', () => ({ maybeAutostartTour: vi.fn() }));

const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
});

const purchaseOrder = {
    id: 'po-1',
    supplierId: 'supplier-1',
    orderNumber: 'OC-0001',
    status: 'APPROVED',
    createdAt: '2026-08-27T16:00:00.000Z',
    supplier: { name: 'Carnes Molina' },
    items: [
        {
            id: 'po-line-a',
            productId: 'product-meat',
            productName: 'Carne de res',
            quantityOrdered: '8',
            quantityReceived: '5.25',
            quantityOrderedExact: '8.0000',
            quantityReceivedExact: '5.2500',
            unitAtOrder: 'lb',
            saleModeAtOrder: 'MEASURED',
            quantityStepAtOrder: '0.01',
            unitCost: '91.25',
            product: {
                requiresBatchTracking: false,
                unit: 'lb',
                saleMode: 'MEASURED',
                quantityStep: '0.01',
            },
        },
    ],
    goodsReceipts: [{
        id: 'receipt-1',
        purchaseOrderId: 'po-1',
        warehouseId: 'warehouse-1',
        receiptNumber: 'REC-000001',
        status: 'POSTED',
        clientEventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        payloadVersion: 2,
        inspectionOutcome: 'PARTIAL_REJECT',
        inspectedLineCount: 1,
        rejectedLineCount: 1,
        hasSupplierFault: true,
        receivedBy: 'user-1',
        receivedAt: '2026-08-27T17:00:00.000Z',
        createdAt: '2026-08-27T17:00:00.000Z',
        warehouse: { id: 'warehouse-1', name: 'Bodega central' },
        receiver: { id: 'user-1', name: 'Ana Pérez' },
    }],
};

const receiptDetail = {
    ...purchaseOrder,
    goodsReceipts: [{
        ...purchaseOrder.goodsReceipts[0],
        supplierDeliveryRef: 'REM-551',
        items: [{
            id: 'receipt-item-1',
            purchaseOrderItemId: 'po-line-a',
            productId: 'product-meat',
            quantityExact: '2.0000',
            deliveredQuantityExact: '2.5000',
            rejectedQuantityExact: '0.5000',
            rejectionReasonCode: 'QUALITY',
            rejectionNotes: 'Temperatura fuera de rango',
            supplierFault: true,
            unitSnapshot: 'lb',
            saleModeSnapshot: 'MEASURED',
            batchId: 'batch-1',
            batchNumber: 'LOTE-CARNE-8',
            expiryDate: '2026-09-30T12:00:00.000Z',
        }],
    }],
};

const closeShortDetail = {
    id: 'close-short-1',
    purchaseOrderId: 'po-1',
    status: 'POSTED',
    clientEventId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    closedBy: 'manager-1',
    closedAt: '2026-08-27T19:00:00.000Z',
    createdAt: '2026-08-27T19:00:00.000Z',
    lineCount: 1,
    closedLineCount: 1,
    hasSupplierFault: true,
    reasonSummaryCode: 'SUPPLIER_SHORTAGE',
    note: 'Proveedor confirmó que no entregará el saldo',
    creator: { id: 'manager-1', name: 'Mario Gerente' },
    items: [{
        id: 'close-item-1',
        purchaseOrderItemId: 'po-line-a',
        quantityExact: '2.7500',
        reasonCode: 'SUPPLIER_SHORTAGE',
        supplierFault: true,
        note: 'Sin disponibilidad',
        unitSnapshot: 'lb',
    }],
};

const heldPurchase = {
    id: 'purchase-held',
    supplierId: 'supplier-1',
    supplier: { id: 'supplier-1', name: 'Carnes Molina' },
    invoiceNumber: 'FAC-440',
    date: '2026-08-27T12:00:00.000Z',
    postingDate: '2026-08-27T12:00:00.000Z',
    dueDate: '2026-09-10T12:00:00.000Z',
    subtotal: '100.00',
    tax: '15.00',
    total: '115.00',
    balanceDue: '115.00',
    status: 'PENDING_PAYMENT',
    paymentMethod: 'CREDIT',
    documentStatus: 'POSTED',
    matchStatus: 'EXCEPTION',
    paymentHold: true,
    items: [],
    createdAt: '2026-08-27T12:00:00.000Z',
};

const matchSummary = {
    id: 'purchase-held',
    invoiceNumber: 'FAC-440',
    date: '2026-08-27T12:00:00.000Z',
    postingDate: '2026-08-27T12:00:00.000Z',
    documentStatus: 'POSTED',
    matchStatus: 'EXCEPTION',
    paymentHold: true,
    total: '115.00',
    balanceDue: '115.00',
    supplier: { id: 'supplier-1', name: 'Carnes Molina' },
    purchaseOrder: { id: 'po-1', orderNumber: 'OC-0001' },
    openExceptionCount: 1,
    varianceAmount: '5.00',
};

const basePurchasesFetch = (options?: {
    purchases?: unknown[];
    purchaseOrders?: unknown[];
    onExtra?: (url: string, init?: RequestInit) => Response | Promise<Response> | undefined;
}) => vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const extra = options?.onExtra?.(url, init);
    if (extra) return extra;
    if (url === '/api/suppliers') return jsonResponse([{ id: 'supplier-1', name: 'Carnes Molina' }]);
    if (url === '/api/products') return jsonResponse([{
        id: 'product-meat',
        name: 'Carne de res',
        sku: 'CARNE-1',
        price: '120.00',
        cost: '91.25',
        stock: '20',
        unit: 'lb',
        saleMode: 'MEASURED',
        quantityStep: '0.01',
        ivaExento: false,
        requiresBatchTracking: false,
    }]);
    if (url === '/api/purchases' && (!init?.method || init.method === 'GET')) {
        return jsonResponse(options?.purchases ?? []);
    }
    if (url === '/api/purchase-orders') return jsonResponse({ data: options?.purchaseOrders ?? [] });
    if (url === '/api/warehouses') return jsonResponse({ data: [{ id: 'warehouse-1', name: 'Bodega central', isActive: true, isDefault: true }] });
    throw new Error(`URL no esperada: ${url} ${init?.method || 'GET'}`);
});

describe('Procurement Fase 2 en frontend', () => {
    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem('nortex_token', 'qa-token');
        localStorage.setItem('nortex_user', JSON.stringify({ role: 'OWNER' }));
        vi.stubGlobal('crypto', {
            randomUUID: vi.fn(() => '11111111-1111-4111-8111-111111111111'),
            getRandomValues: (bytes: Uint8Array) => bytes.fill(1),
        });
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('mantiene una recepción idempotente en retry y muestra comprobante y replay', async () => {
        const bodies: Array<Record<string, unknown>> = [];
        let finishFirst!: () => void;
        let listCalls = 0;
        vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
            const url = String(input);
            if (url === '/api/purchase-orders' && (!init?.method || init.method === 'GET')) {
                listCalls += 1;
                return Promise.resolve(jsonResponse({ data: [purchaseOrder] }));
            }
            if (url === '/api/suppliers') return Promise.resolve(jsonResponse([{ id: 'supplier-1', name: 'Carnes Molina' }]));
            if (url === '/api/warehouses') return Promise.resolve(jsonResponse({ data: [{ id: 'warehouse-1', name: 'Bodega central', isActive: true, isDefault: true }] }));
            if (url === '/api/purchase-orders/po-1/receive' && init?.method === 'POST') {
                bodies.push(JSON.parse(String(init.body)));
                if (bodies.length === 1) {
                    return new Promise<Response>(resolve => {
                        finishFirst = () => resolve(jsonResponse({ error: 'No confirmado' }, 503));
                    });
                }
                return Promise.resolve(jsonResponse({
                    success: true,
                    data: { ...purchaseOrder, status: 'PARTIALLY_RECEIVED' },
                    receipt: receiptDetail.goodsReceipts[0],
                    replay: true,
                }));
            }
            throw new Error(`URL no esperada: ${url}`);
        });

        render(<PurchaseOrders />);
        fireEvent.click(await screen.findByRole('button', { name: 'Recibir' }));
        await screen.findByRole('dialog', { name: 'Recibir OC-0001' });
        fireEvent.change(screen.getByLabelText('Cantidad recibida de Carne de res'), { target: { value: '2.5' } });

        const submit = screen.getByRole('button', { name: 'Confirmar recepción' });
        fireEvent.click(submit);
        fireEvent.click(submit);
        await waitFor(() => expect(bodies).toHaveLength(1));
        finishFirst();
        expect((await screen.findAllByText('No confirmado')).length).toBeGreaterThan(0);

        fireEvent.click(screen.getByRole('button', { name: 'Confirmar recepción' }));
        await waitFor(() => expect(bodies).toHaveLength(2));
        expect(bodies[0]).toEqual({
            clientEventId: '11111111-1111-4111-8111-111111111111',
            warehouseId: 'warehouse-1',
            items: [{ itemId: 'po-line-a', quantityReceived: '2.5' }],
        });
        expect(bodies[1]).toEqual(bodies[0]);
        expect(await screen.findByText('Recepción recuperada sin duplicar')).toBeTruthy();
        expect(screen.getByText('REC-000001')).toBeTruthy();
        expect(listCalls).toBeGreaterThanOrEqual(2);
    });

    it('envía una inspección mixta con aceptado, rechazado, motivo y responsabilidad explícita', async () => {
        let receiveBody: Record<string, unknown> | undefined;
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const url = String(input);
            if (url === '/api/purchase-orders' && (!init?.method || init.method === 'GET')) {
                return jsonResponse({ data: [purchaseOrder] });
            }
            if (url === '/api/suppliers') return jsonResponse([]);
            if (url === '/api/warehouses') {
                return jsonResponse({ data: [{ id: 'warehouse-1', name: 'Bodega central', isActive: true, isDefault: true }] });
            }
            if (url === '/api/purchase-orders/po-1/receive' && init?.method === 'POST') {
                receiveBody = JSON.parse(String(init.body));
                return jsonResponse({
                    success: true,
                    data: { ...purchaseOrder, status: 'PARTIALLY_RECEIVED' },
                    receipt: receiptDetail.goodsReceipts[0],
                    replay: false,
                });
            }
            throw new Error(`URL no esperada: ${url}`);
        });

        render(<PurchaseOrders />);
        fireEvent.click(await screen.findByRole('button', { name: 'Recibir' }));
        fireEvent.change(await screen.findByLabelText('Cantidad recibida de Carne de res'), { target: { value: '1.25' } });
        fireEvent.change(screen.getByLabelText('Cantidad rechazada de Carne de res'), { target: { value: '0.5' } });
        fireEvent.change(screen.getByLabelText('Motivo del rechazo de Carne de res'), { target: { value: 'QUALITY' } });
        fireEvent.change(screen.getByLabelText('Responsabilidad del proveedor en rechazo de Carne de res'), { target: { value: 'true' } });
        fireEvent.change(screen.getByLabelText('Observación física (opcional)'), { target: { value: 'Temperatura fuera de rango' } });
        fireEvent.change(screen.getByLabelText('Referencia de entrega (opcional)'), { target: { value: 'REM-551' } });
        fireEvent.click(screen.getByRole('button', { name: 'Confirmar recepción' }));

        await waitFor(() => expect(receiveBody).toBeDefined());
        expect(receiveBody).toEqual({
            clientEventId: '11111111-1111-4111-8111-111111111111',
            warehouseId: 'warehouse-1',
            supplierDeliveryRef: 'REM-551',
            items: [{
                itemId: 'po-line-a',
                quantityReceived: '1.25',
                quantityRejected: '0.5',
                rejectionReasonCode: 'QUALITY',
                rejectionNotes: 'Temperatura fuera de rango',
                supplierFault: true,
            }],
        });
    });

    it('exige motivo y responsabilidad en rechazo total y envía aceptado cero', async () => {
        const bodies: Array<Record<string, unknown>> = [];
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const url = String(input);
            if (url === '/api/purchase-orders' && (!init?.method || init.method === 'GET')) {
                return jsonResponse({ data: [purchaseOrder] });
            }
            if (url === '/api/suppliers') return jsonResponse([]);
            if (url === '/api/warehouses') {
                return jsonResponse({ data: [{ id: 'warehouse-1', name: 'Bodega central', isActive: true, isDefault: true }] });
            }
            if (url === '/api/purchase-orders/po-1/receive' && init?.method === 'POST') {
                bodies.push(JSON.parse(String(init.body)));
                return jsonResponse({ success: true, data: purchaseOrder, receipt: receiptDetail.goodsReceipts[0], replay: false });
            }
            throw new Error(`URL no esperada: ${url}`);
        });

        render(<PurchaseOrders />);
        fireEvent.click(await screen.findByRole('button', { name: 'Recibir' }));
        fireEvent.change(await screen.findByLabelText('Cantidad rechazada de Carne de res'), { target: { value: '1' } });
        fireEvent.click(screen.getByRole('button', { name: 'Confirmar recepción' }));
        expect(await screen.findByText('Falta el motivo del rechazo')).toBeTruthy();
        expect(bodies).toHaveLength(0);

        fireEvent.change(screen.getByLabelText('Motivo del rechazo de Carne de res'), { target: { value: 'DAMAGE' } });
        fireEvent.click(screen.getByRole('button', { name: 'Confirmar recepción' }));
        expect(await screen.findByText('Falta asignar responsabilidad')).toBeTruthy();
        expect(bodies).toHaveLength(0);

        fireEvent.change(screen.getByLabelText('Responsabilidad del proveedor en rechazo de Carne de res'), { target: { value: 'false' } });
        fireEvent.click(screen.getByRole('button', { name: 'Confirmar recepción' }));
        await waitFor(() => expect(bodies).toHaveLength(1));
        expect(bodies[0]).toEqual({
            clientEventId: '11111111-1111-4111-8111-111111111111',
            warehouseId: 'warehouse-1',
            items: [{
                itemId: 'po-line-a',
                quantityReceived: '0',
                quantityRejected: '1',
                rejectionReasonCode: 'DAMAGE',
                supplierFault: false,
            }],
        });
    });

    it('carga el timeline físico con resultado, remisión, usuario y cantidades inspeccionadas', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url === '/api/purchase-orders') return jsonResponse({ data: [purchaseOrder] });
            if (url === '/api/purchase-orders/po-1') return jsonResponse({ data: receiptDetail });
            if (url === '/api/suppliers') return jsonResponse([]);
            throw new Error(`URL no esperada: ${url}`);
        });

        render(<PurchaseOrders />);
        fireEvent.click(await screen.findByRole('button', { name: /1 recepción/ }));

        expect(await screen.findByText(/Bodega central · Ana Pérez/)).toBeTruthy();
        expect(screen.getByText('Aceptación con rechazo')).toBeTruthy();
        expect(screen.getByText(/Entregado 2\.5 lb/)).toBeTruthy();
        expect(screen.getByText('Aceptado 2')).toBeTruthy();
        expect(screen.getByText('Rechazado 0.5')).toBeTruthy();
        expect(screen.getByText(/Motivo: Calidad · Proveedor responsable: Sí/)).toBeTruthy();
        expect(screen.getByText('Observación: Temperatura fuera de rango')).toBeTruthy();
        expect(screen.getByText(/Lote LOTE-CARNE-8/)).toBeTruthy();
        expect(screen.getByText('Remisión REM-551')).toBeTruthy();
    });

    it('muestra la inspección física al BODEGUERO sin costos ni datos privados del cierre corto', async () => {
        localStorage.setItem('nortex_user', JSON.stringify({ role: 'BODEGUERO' }));
        vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
            const url = String(input);
            if (url === '/api/purchase-orders') {
                return jsonResponse({ data: [{ ...purchaseOrder, closeShorts: [closeShortDetail] }] });
            }
            if (url === '/api/purchase-orders/po-1') {
                return jsonResponse({ data: { ...receiptDetail, closeShorts: [closeShortDetail] } });
            }
            throw new Error(`URL no esperada: ${url}`);
        });

        render(<PurchaseOrders />);

        expect(await screen.findByText('Carne de res')).toBeTruthy();
        expect(screen.queryByText(/91\.25/)).toBeNull();
        expect(screen.queryByRole('button', { name: 'Nueva OC' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Cerrar faltante' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Recibir' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: /1 recepción/ }));
        expect(await screen.findByText('Rechazado 0.5')).toBeTruthy();
        expect(screen.getByText(/Motivo: Calidad · Proveedor responsable: Sí/)).toBeTruthy();
        expect(screen.queryByText('Mario Gerente')).toBeNull();
        expect(screen.queryByText(/Proveedor confirmó que no entregará/)).toBeNull();
        expect(screen.queryByText('Cierre de faltante')).toBeNull();
    });

    it('mantiene el UUID y el body Decimal al reintentar un cierre corto', async () => {
        const bodies: Array<Record<string, unknown>> = [];
        let finishFirst!: () => void;
        vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
            const url = String(input);
            if (url === '/api/purchase-orders' && (!init?.method || init.method === 'GET')) {
                return Promise.resolve(jsonResponse({ data: [purchaseOrder] }));
            }
            if (url === '/api/suppliers') return Promise.resolve(jsonResponse([]));
            if (url === '/api/purchase-orders/po-1/close-short' && init?.method === 'POST') {
                bodies.push(JSON.parse(String(init.body)));
                if (bodies.length === 1) {
                    return new Promise<Response>(resolve => {
                        finishFirst = () => resolve(jsonResponse({ error: 'No confirmado' }, 503));
                    });
                }
                return Promise.resolve(jsonResponse({
                    success: true,
                    data: { ...purchaseOrder, status: 'CLOSED_SHORT', closeShorts: [closeShortDetail] },
                    closeShort: closeShortDetail,
                    replay: true,
                }));
            }
            throw new Error(`URL no esperada: ${url}`);
        });

        render(<PurchaseOrders />);
        fireEvent.click(await screen.findByRole('button', { name: 'Cerrar faltante' }));
        expect(screen.getByRole('dialog', { name: 'Cerrar faltante de OC-0001' })).toBeTruthy();
        expect((screen.getByLabelText('Cantidad a cerrar de Carne de res') as HTMLInputElement).value).toBe('2.7500');
        fireEvent.change(screen.getByLabelText('Motivo general (opcional)'), { target: { value: 'SUPPLIER_SHORTAGE' } });
        fireEvent.change(screen.getByLabelText('Nota general (opcional)'), { target: { value: 'Proveedor confirmó faltante' } });
        fireEvent.change(screen.getByLabelText('Motivo del faltante de Carne de res'), { target: { value: 'SUPPLIER_SHORTAGE' } });
        fireEvent.change(screen.getByLabelText('Responsabilidad del proveedor en faltante de Carne de res'), { target: { value: 'true' } });
        fireEvent.change(screen.getByLabelText('Nota de la línea (opcional)'), { target: { value: 'Sin disponibilidad' } });
        fireEvent.click(screen.getByLabelText(/Entiendo que la orden quedará cerrada con faltante/));

        const submit = screen.getByRole('button', { name: 'Confirmar cierre' });
        fireEvent.click(submit);
        fireEvent.click(submit);
        await waitFor(() => expect(bodies).toHaveLength(1));
        finishFirst();
        expect((await screen.findAllByText('No confirmado')).length).toBeGreaterThan(0);

        fireEvent.click(screen.getByRole('button', { name: 'Confirmar cierre' }));
        await waitFor(() => expect(bodies).toHaveLength(2));
        expect(bodies[0]).toEqual({
            clientEventId: '11111111-1111-4111-8111-111111111111',
            reasonSummaryCode: 'SUPPLIER_SHORTAGE',
            note: 'Proveedor confirmó faltante',
            items: [{
                itemId: 'po-line-a',
                quantity: '2.7500',
                reasonCode: 'SUPPLIER_SHORTAGE',
                supplierFault: true,
                note: 'Sin disponibilidad',
            }],
        });
        expect(bodies[1]).toEqual(bodies[0]);
        expect(await screen.findByText('Cierre recuperado sin duplicar')).toBeTruthy();
    });

    it.each(['VIEWER', 'ACCOUNTANT'])('mantiene el cierre corto fuera del rol %s', async role => {
        localStorage.setItem('nortex_user', JSON.stringify({ role }));
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ data: [purchaseOrder] }));

        render(<PurchaseOrders />);

        expect(await screen.findByText('Carne de res')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Cerrar faltante' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Recibir' })).toBeNull();
    });

    it('muestra CLOSED_SHORT como terminal sin permitir nuevas recepciones ni cierres', async () => {
        const closedOrder = {
            ...purchaseOrder,
            status: 'CLOSED_SHORT',
            items: [{ ...purchaseOrder.items[0], quantityClosedShortExact: '2.7500' }],
            closeShorts: [closeShortDetail],
        };
        vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
            if (String(input) === '/api/purchase-orders') return jsonResponse({ data: [closedOrder] });
            if (String(input) === '/api/suppliers') return jsonResponse([]);
            throw new Error(`URL no esperada: ${String(input)}`);
        });

        render(<PurchaseOrders />);

        expect(await screen.findByText('CERRADA CON FALTANTE')).toBeTruthy();
        expect(screen.getByText('Cerrado 2.75')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Recibir' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Cerrar faltante' })).toBeNull();
    });

    it('calcula disponibilidad por línea aunque el mismo SKU aparezca dos veces', () => {
        const availability = purchaseOrderLineAvailability({
            id: 'po-duplicate',
            supplierId: 'supplier-1',
            orderNumber: 'OC-DUP',
            status: 'PARTIALLY_RECEIVED',
            items: [
                { id: 'line-a', productId: 'same-product', productName: 'Carne', quantityOrdered: '8', quantityReceived: '5', unitCost: '10' },
                { id: 'line-b', productId: 'same-product', productName: 'Carne', quantityOrdered: '10', quantityReceived: '7', unitCost: '12' },
            ],
            receipts: [{ items: [
                { productId: 'same-product', purchaseOrderItemId: 'line-a', quantity: '2' },
                { productId: 'same-product', purchaseOrderItemId: 'line-b', quantity: '3' },
            ] }],
        });

        expect(availability.map(line => ({
            id: line.id,
            ordered: line.orderedQuantity,
            received: line.receivedQuantity,
            invoiced: line.invoicedQuantity,
            available: line.availableQuantity,
        }))).toEqual([
            { id: 'line-a', ordered: '8', received: '5', invoiced: '2', available: '3' },
            { id: 'line-b', ordered: '10', received: '7', invoiced: '3', available: '4' },
        ]);
    });

    it('factura cada línea de OC con su purchaseOrderItemId y decimales como string', async () => {
        const poWithDuplicateSku = {
            ...purchaseOrder,
            status: 'PARTIALLY_RECEIVED',
            items: [
                { ...purchaseOrder.items[0], id: 'line-a', quantityOrdered: '8', quantityReceived: '5', quantityOrderedExact: '8.0000', quantityReceivedExact: '5.0000' },
                { ...purchaseOrder.items[0], id: 'line-b', quantityOrdered: '10', quantityReceived: '7', quantityOrderedExact: '10.0000', quantityReceivedExact: '7.0000' },
            ],
            receipts: [{ items: [
                { productId: 'product-meat', purchaseOrderItemId: 'line-a', quantity: '2', quantityExact: '2.0000' },
                { productId: 'product-meat', purchaseOrderItemId: 'line-b', quantity: '3', quantityExact: '3.0000' },
            ] }],
        };
        let purchaseBody: Record<string, unknown> | undefined;
        basePurchasesFetch({
            purchaseOrders: [poWithDuplicateSku],
            onExtra: (url, init) => {
                if (url === '/api/purchases' && init?.method === 'POST') {
                    purchaseBody = JSON.parse(String(init.body));
                    return jsonResponse({ message: 'Compra registrada' }, 201);
                }
                return undefined;
            },
        });

        render(<Purchases />);
        await screen.findByLabelText('Proveedor *');
        fireEvent.change(screen.getByLabelText('Proveedor *'), { target: { value: 'supplier-1' } });
        fireEvent.change(await screen.findByLabelText('Orden de compra (opcional)'), { target: { value: 'po-1' } });

        expect(screen.getAllByText('Ordenado')).toHaveLength(2);
        expect(screen.getAllByText('Disponible')).toHaveLength(2);
        fireEvent.change(screen.getByLabelText('# Factura Proveedor *'), { target: { value: 'FAC-DUP-1' } });
        fireEvent.click(screen.getByRole('button', { name: 'Registrar factura' }));

        await waitFor(() => expect(purchaseBody).toBeDefined());
        const body = purchaseBody as { postingDate: string; items: Array<Record<string, unknown>> };
        expect(body.postingDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(body.items).toEqual([
            expect.objectContaining({ purchaseOrderItemId: 'line-a', productId: 'product-meat', quantity: '3', unitCost: '91.25' }),
            expect.objectContaining({ purchaseOrderItemId: 'line-b', productId: 'product-meat', quantity: '4', unitCost: '91.25' }),
        ]);
        for (const item of body.items) {
            expect(typeof item.quantity).toBe('string');
            expect(typeof item.unitCost).toBe('string');
        }
    });

    it('acepta costo exacto a 6 decimales al facturar una línea recibida', async () => {
        let purchaseBody: Record<string, unknown> | undefined;
        basePurchasesFetch({
            purchaseOrders: [{
                ...purchaseOrder,
                status: 'PARTIALLY_RECEIVED',
                receipts: [{ items: [{ productId: 'product-meat', purchaseOrderItemId: 'po-line-a', quantity: '2', quantityExact: '2.0000' }] }],
            }],
            onExtra: (url, init) => {
                if (url === '/api/purchases' && init?.method === 'POST') {
                    purchaseBody = JSON.parse(String(init.body));
                    return jsonResponse({ message: 'Compra registrada' }, 201);
                }
                return undefined;
            },
        });

        render(<Purchases />);
        fireEvent.change(await screen.findByLabelText('Proveedor *'), { target: { value: 'supplier-1' } });
        fireEvent.change(screen.getByLabelText('Orden de compra (opcional)'), { target: { value: 'po-1' } });
        fireEvent.change(screen.getByLabelText(/Costo de Carne de res · línea po-line-a/i), { target: { value: '91.253456' } });
        fireEvent.change(screen.getByLabelText('# Factura Proveedor *'), { target: { value: 'FAC-6DP-1' } });
        fireEvent.click(screen.getByRole('button', { name: 'Registrar factura' }));

        await waitFor(() => expect(purchaseBody).toBeDefined());
        const body = purchaseBody as { items: Array<Record<string, unknown>> };
        expect(body.items[0]).toEqual(expect.objectContaining({
            purchaseOrderItemId: 'po-line-a',
            unitCost: '91.253456',
        }));
    });

    it('acepta costo exacto a 6 decimales al crear una orden de compra', async () => {
        let purchaseOrderBody: Record<string, unknown> | undefined;
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const url = String(input);
            if (url === '/api/purchase-orders' && (!init?.method || init.method === 'GET')) {
                return jsonResponse({ data: [] });
            }
            if (url === '/api/suppliers') {
                return jsonResponse([{ id: 'supplier-1', name: 'Carnes Molina' }]);
            }
            if (url.startsWith('/api/products?search=')) {
                return jsonResponse([{
                    id: 'product-meat',
                    name: 'Carne de res',
                    sku: 'CARNE-1',
                    cost: 91.25,
                    unit: 'lb',
                    saleMode: 'MEASURED',
                    quantityStep: '0.01',
                }]);
            }
            if (url === '/api/purchase-orders' && init?.method === 'POST') {
                purchaseOrderBody = JSON.parse(String(init.body));
                return jsonResponse({ data: { id: 'po-new' } }, 201);
            }
            throw new Error(`URL no esperada: ${url} ${init?.method || 'GET'}`);
        });

        render(<PurchaseOrders />);
        fireEvent.click(await screen.findByRole('button', { name: 'Nueva OC' }));
        fireEvent.change(screen.getByLabelText('Proveedor *'), { target: { value: 'supplier-1' } });
        fireEvent.change(screen.getByPlaceholderText('Buscar producto para agregar…'), { target: { value: 'carne' } });
        fireEvent.click(await screen.findByRole('button', { name: /Carne de res/i }));
        fireEvent.change(screen.getByLabelText('Costo de Carne de res'), { target: { value: '91.253456' } });
        fireEvent.click(screen.getByRole('button', { name: 'Crear borrador' }));

        await waitFor(() => expect(purchaseOrderBody).toBeDefined());
        const body = purchaseOrderBody as { items: Array<Record<string, unknown>> };
        expect(body.items[0]).toEqual(expect.objectContaining({
            productId: 'product-meat',
            unitCost: '91.253456',
        }));
    });

    it('retiene el pago y ofrece la conciliación en vez de Abonar', async () => {
        localStorage.setItem('nortex_user', JSON.stringify({ role: 'ACCOUNTANT' }));
        basePurchasesFetch({ purchases: [heldPurchase] });

        render(<Purchases />);

        expect(await screen.findByText('Pago retenido hasta resolver la conciliación')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Abonar' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Revisar diferencia' })).toBeTruthy();
    });

    it('mantiene el UUID al resolver tras un fallo y bloquea el doble submit', async () => {
        localStorage.setItem('nortex_user', JSON.stringify({ role: 'ACCOUNTANT' }));
        const resolutionBodies: Array<Record<string, unknown>> = [];
        let finishFirst!: () => void;
        basePurchasesFetch({
            purchases: [heldPurchase],
            onExtra: (url, init) => {
                if (url.startsWith('/api/procurement/matches?')) {
                    return jsonResponse({ data: [matchSummary], pageInfo: { nextCursor: null } });
                }
                if (url === '/api/procurement/matches/purchase-held/resolve' && init?.method === 'POST') {
                    resolutionBodies.push(JSON.parse(String(init.body)));
                    if (resolutionBodies.length === 1) {
                        return new Promise<Response>(resolve => {
                            finishFirst = () => resolve(jsonResponse({ error: 'No confirmado' }, 503));
                        });
                    }
                    return jsonResponse({
                        data: {
                            purchaseId: 'purchase-held',
                            matchStatus: 'RESOLVED',
                            paymentHold: false,
                            matchResolvedBy: 'accountant-1',
                            matchResolvedAt: '2026-08-27T18:00:00.000Z',
                            matchResolutionNote: 'Ajuste aprobado por gerencia',
                        },
                        replay: true,
                    });
                }
                return undefined;
            },
        });

        render(<Purchases />);
        fireEvent.click(screen.getByRole('button', { name: /Conciliación/ }));
        fireEvent.click(await screen.findByRole('button', { name: 'Resolver' }));
        fireEvent.change(screen.getByLabelText('Motivo de la resolución'), { target: { value: 'Ajuste aprobado por gerencia' } });

        const submit = screen.getByRole('button', { name: 'Resolver y liberar' });
        fireEvent.click(submit);
        fireEvent.click(submit);
        await waitFor(() => expect(resolutionBodies).toHaveLength(1));
        finishFirst();
        expect(await screen.findByText('No confirmado')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Resolver y liberar' }));
        await waitFor(() => expect(resolutionBodies).toHaveLength(2));
        expect(resolutionBodies[0]).toEqual({
            clientEventId: '11111111-1111-4111-8111-111111111111',
            reason: 'Ajuste aprobado por gerencia',
        });
        expect(resolutionBodies[1]).toEqual(resolutionBodies[0]);
        expect(await screen.findByText('Resolución ya confirmada')).toBeTruthy();
    });

    it('deja la bandeja en solo lectura para VIEWER', async () => {
        localStorage.setItem('nortex_user', JSON.stringify({ role: 'VIEWER' }));
        basePurchasesFetch({
            purchases: [heldPurchase],
            onExtra: url => {
                if (url.startsWith('/api/procurement/matches?')) {
                    return jsonResponse({ data: [matchSummary], pageInfo: { nextCursor: null } });
                }
                if (url === '/api/procurement/matches/purchase-held') {
                    return jsonResponse({ data: {
                        purchase: matchSummary,
                        lines: [{
                            id: 'purchase-line-1',
                            productId: 'product-meat',
                            productName: 'Carne de res',
                            purchaseOrderItemId: 'po-line-a',
                            quantityExact: '5.0000',
                            unitCostExact: '21.00',
                            expectedUnitCostExact: '20.00',
                            priceVarianceExact: '5.00',
                            allocations: [{ id: 'allocation-1', goodsReceiptItemId: 'receipt-item-1', quantityExact: '5.0000' }],
                        }],
                        exceptions: [{
                            id: 'exception-1',
                            purchaseItemId: 'purchase-line-1',
                            type: 'PRICE',
                            status: 'OPEN',
                            expectedValueExact: '20.00',
                            actualValueExact: '21.00',
                            varianceExact: '5.00',
                            toleranceExact: '0.01',
                            resolutionNote: null,
                            resolvedBy: null,
                            resolvedAt: null,
                            createdAt: '2026-08-27T18:00:00.000Z',
                        }],
                        totals: { expectedAmount: '100.00', invoiceAmount: '105.00', varianceAmount: '5.00' },
                    } });
                }
                return undefined;
            },
        });

        render(<Purchases />);
        fireEvent.click(screen.getByRole('button', { name: /Conciliación/ }));

        expect(await screen.findByText('Pago retenido')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Ver diferencias' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Resolver' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Ver diferencias' }));
        expect(await screen.findByRole('dialog', { name: 'Conciliación #FAC-440' })).toBeTruthy();
        expect(screen.getByText('Precio')).toBeTruthy();
        expect(screen.getByText('Carne de res')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Resolver diferencia' })).toBeNull();
    });
});
