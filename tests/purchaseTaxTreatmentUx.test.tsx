// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Purchases from '../components/Purchases';

vi.mock('../utils/tours', () => ({ maybeAutostartTour: vi.fn() }));

const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
});

/** Producto GRAVADO: el caso que hoy inflaba la factura de un proveedor sin IVA. */
const taxableProduct = {
    id: 'product-cemento',
    name: 'Cemento gris',
    sku: 'CEM-1',
    price: '400.00',
    cost: '250.00',
    stock: '10',
    unit: 'unidad',
    saleMode: null,
    quantityStep: null,
    packUnit: null,
    packSize: null,
    ivaExento: false,
    requiresBatchTracking: false,
};

const exemptProduct = {
    ...taxableProduct,
    id: 'product-arroz',
    name: 'Arroz granel',
    sku: 'ARR-1',
    cost: '100.00',
    ivaExento: true,
};

const mockPurchasesApi = (suppliers: unknown[]) => {
    let postedBody: Record<string, unknown> | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input);
        if (url === '/api/suppliers') return jsonResponse(suppliers);
        if (url === '/api/products') return jsonResponse([taxableProduct, exemptProduct]);
        if (url === '/api/purchases' && (!init?.method || init.method === 'GET')) return jsonResponse([]);
        if (url === '/api/purchase-orders') return jsonResponse({ data: [] });
        if (url === '/api/warehouses') {
            return jsonResponse({ data: [{ id: 'warehouse-1', name: 'Bodega central', isActive: true, isDefault: true }] });
        }
        if (url === '/api/purchases' && init?.method === 'POST') {
            postedBody = JSON.parse(String(init.body));
            return jsonResponse({ message: 'Compra registrada' }, 201);
        }
        throw new Error(`URL no esperada: ${url} ${init?.method || 'GET'}`);
    });
    return () => postedBody;
};

const setRole = (role: string) => {
    localStorage.setItem('nortex_token', 'qa-token');
    localStorage.setItem('nortex_user', JSON.stringify({ role }));
};

const pickSupplier = async (supplierId: string) => {
    fireEvent.change(await screen.findByLabelText('Proveedor *'), { target: { value: supplierId } });
};

const addProduct = async (name: string, search: string) => {
    fireEvent.change(screen.getByPlaceholderText('Buscar producto por nombre o SKU...'), { target: { value: search } });
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(name) }));
};

const setUnitCost = (productName: string, value: string) => {
    fireEvent.change(screen.getByLabelText(`Costo de ${productName}`), { target: { value } });
};

const submitPurchase = (invoiceNumber: string) => {
    fireEvent.change(screen.getByLabelText('# Factura Proveedor *'), { target: { value: invoiceNumber } });
    fireEvent.click(screen.getByRole('button', { name: /Registrar factura|Procesar ingreso/ }));
};

/**
 * Importe de una fila del resumen leído junto a SU etiqueta. Con el total igual
 * al subtotal el mismo texto aparece tres veces, así que una búsqueda global no
 * distingue la fila y podría pasar por accidente.
 */
const summaryRow = (label: string | RegExp) =>
    screen.getByText(label).parentElement?.textContent ?? '';

const generalSupplier = { id: 'supplier-general', name: 'Distribuidora Norte', fiscalCategory: 'GENERAL' };
const cuotaFijaSupplier = { id: 'supplier-cuota', name: 'Ferretería El Clavo', fiscalCategory: 'CUOTA_FIJA' };

describe('traslación del IVA en el registro de una compra', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('cobra el 15% por defecto sobre un producto gravado', async () => {
        setRole('OWNER');
        const postedBody = mockPurchasesApi([generalSupplier]);

        render(<Purchases />);
        await pickSupplier(generalSupplier.id);
        await addProduct('Cemento gris', 'Cemento');
        setUnitCost('Cemento gris', '1000');

        expect(summaryRow('IVA (15%)')).toContain('C$ 150.00');
        expect(summaryRow('TOTAL')).toContain('C$ 1,150.00');

        submitPurchase('FAC-CON-IVA');
        await waitFor(() => expect(postedBody()).toBeDefined());
        expect(postedBody()).toEqual(expect.objectContaining({ taxTreatment: 'IVA_TRASLADADO' }));
        expect(postedBody()).not.toHaveProperty('noTaxReason');
    });

    it('deja el total igual al subtotal al marcar que la factura no trae IVA', async () => {
        setRole('OWNER');
        const postedBody = mockPurchasesApi([generalSupplier]);

        render(<Purchases />);
        await pickSupplier(generalSupplier.id);
        await addProduct('Cemento gris', 'Cemento');
        setUnitCost('Cemento gris', '1000');

        // El caso reportado: la factura dice C$1,000 y ahora Nortex la registra así.
        fireEvent.click(screen.getByRole('button', { name: /No trae IVA/ }));
        fireEvent.change(screen.getByLabelText(/¿Por qué no trae IVA\?/), {
            target: { value: 'PROVEEDOR_CUOTA_FIJA' },
        });

        expect(summaryRow('IVA (no trasladado)')).toContain('C$ 0.00');
        expect(summaryRow('Subtotal')).toContain('C$ 1,000.00');
        expect(summaryRow('TOTAL')).toContain('C$ 1,000.00');
        expect(screen.queryByText('C$ 1,150.00')).toBeNull();

        submitPurchase('FAC-SIN-IVA');
        await waitFor(() => expect(postedBody()).toBeDefined());
        expect(postedBody()).toEqual(expect.objectContaining({
            taxTreatment: 'SIN_TRASLADO',
            noTaxReason: 'PROVEEDOR_CUOTA_FIJA',
        }));
    });

    it('no registra la compra sin traslación mientras falte el motivo', async () => {
        setRole('OWNER');
        const postedBody = mockPurchasesApi([generalSupplier]);

        render(<Purchases />);
        await pickSupplier(generalSupplier.id);
        await addProduct('Cemento gris', 'Cemento');
        setUnitCost('Cemento gris', '1000');
        fireEvent.click(screen.getByRole('button', { name: /No trae IVA/ }));

        submitPurchase('FAC-SIN-MOTIVO');

        // El aviso aparece en el toast, en el resumen de errores y junto al campo.
        await waitFor(() => expect(
            screen.getAllByText('Indicá por qué la factura no trae IVA.').length,
        ).toBeGreaterThan(0));
        // Lo que importa: NO se envió nada al servidor.
        expect(postedBody()).toBeUndefined();
    });

    it('sugiere no traslación cuando el proveedor es de cuota fija, sin decidirlo', async () => {
        setRole('OWNER');
        const postedBody = mockPurchasesApi([cuotaFijaSupplier]);

        render(<Purchases />);
        await pickSupplier(cuotaFijaSupplier.id);

        // La sugerencia llega precargada con su motivo, pero sigue siendo editable:
        // el operador manda contra el papel, no la ficha del proveedor.
        expect(screen.getByRole('button', { name: /No trae IVA/ }).getAttribute('aria-pressed')).toBe('true');
        expect((screen.getByLabelText(/¿Por qué no trae IVA\?/) as HTMLSelectElement).value)
            .toBe('PROVEEDOR_CUOTA_FIJA');

        await addProduct('Cemento gris', 'Cemento');
        setUnitCost('Cemento gris', '1000');
        expect(summaryRow('TOTAL')).toContain('C$ 1,000.00');

        // El operador corrige: esta factura sí trajo IVA.
        fireEvent.click(screen.getByRole('button', { name: /Trae IVA/ }));
        expect(screen.queryByLabelText(/¿Por qué no trae IVA\?/)).toBeNull();
        expect(summaryRow('TOTAL')).toContain('C$ 1,150.00');

        submitPurchase('FAC-CORREGIDA');
        await waitFor(() => expect(postedBody()).toBeDefined());
        expect(postedBody()).toEqual(expect.objectContaining({ taxTreatment: 'IVA_TRASLADADO' }));
        expect(postedBody()).not.toHaveProperty('noTaxReason');
    });

    it('conserva el desglose de base gravada y exenta con la factura sin IVA', async () => {
        setRole('OWNER');
        mockPurchasesApi([generalSupplier]);

        render(<Purchases />);
        await pickSupplier(generalSupplier.id);
        await addProduct('Cemento gris', 'Cemento');
        setUnitCost('Cemento gris', '500');
        await addProduct('Arroz granel', 'Arroz');
        setUnitCost('Arroz granel', '300');

        fireEvent.click(screen.getByRole('button', { name: /No trae IVA/ }));

        // Las bases siguen separadas aunque las dos tengan IVA cero: el libro
        // fiscal necesita distinguir la exenta de la gravada sin traslación.
        expect(summaryRow('Base gravada')).toContain('C$ 500.00');
        expect(summaryRow('Productos exentos')).toContain('C$ 300.00');
        expect(summaryRow('IVA (no trasladado)')).toContain('C$ 0.00');
        expect(summaryRow('TOTAL')).toContain('C$ 800.00');
    });
});
