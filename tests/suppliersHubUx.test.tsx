// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Suppliers from '../components/Suppliers';
import { authFetch } from '../utils/auth';

vi.mock('../utils/auth', () => ({ authFetch: vi.fn() }));

const mockedAuthFetch = vi.mocked(authFetch);

const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
});

const supplier = {
    id: 'supplier-1',
    name: 'Carnes Molina',
    ruc: 'J0310000000012',
    contactName: 'Ana Molina',
    phone: '8888 1111',
    email: 'ventas@carnes.test',
    address: 'Mercado Mayoreo',
    category: 'Carnes',
    status: 'ACTIVE',
    legalType: 'JURIDICAL',
    fiscalCategory: 'GENERAL',
    currency: 'NIO',
    paymentTermsDays: 15,
    creditLimit: '50000.0000',
    leadTimeDays: 2,
    minimumOrderAmount: '1500.0000',
    notes: 'Entrega refrigerada por la mañana.',
};

const detailPayload = {
    data: {
        supplier,
        contacts: [{
            id: 'contact-1',
            name: 'Ana Molina',
            title: 'Ventas',
            phone: '8888 1111',
            email: 'ana@carnes.test',
            isPrimary: true,
            notes: null,
        }],
        documents: [{
            id: 'document-1',
            kind: 'TAX_CERTIFICATE',
            fileName: 'constancia-ruc.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 2048,
            sha256: 'a'.repeat(64),
            expiresAt: null,
            createdAt: '2026-08-20T12:00:00.000Z',
        }],
        recentPurchases: [{
            id: 'purchase-1',
            invoiceNumber: 'FAC-101',
            date: '2026-08-25T12:00:00.000Z',
            total: '2400.00',
            balanceDue: '900.00',
            status: 'PARTIALLY_PAID',
            paymentMethod: 'CREDIT',
        }],
        recentPayments: [{
            id: 'payment-1',
            amount: '1500.00',
            method: 'TRANSFER',
            reference: 'TRX-1',
            paidAt: '2026-08-26T12:00:00.000Z',
            purchase: { invoiceNumber: 'FAC-101' },
        }],
        aggregates: {
            purchaseCount: 3,
            paymentCount: 1,
            totalPurchased: '7200.00',
            totalCreditPurchased: '2400.00',
            totalPaid: '1500.00',
            outstandingBalance: '900.00',
            unappliedCredit: '0.00',
        },
    },
};

describe('Proveedor 360', () => {
    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem('nortex_token', 'qa-token');
    });

    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it('mantiene loading explícito, pide todas las fichas y no presenta un falso vacío', async () => {
        localStorage.setItem('nortex_user', JSON.stringify({ role: 'MANAGER' }));
        let resolveList!: (response: Response) => void;
        mockedAuthFetch.mockImplementation((url: string) => {
            if (url === '/api/suppliers?limit=120&status=ALL') {
                return new Promise<Response>((resolve) => { resolveList = resolve; });
            }
            if (url === '/api/suppliers/supplier-1') return Promise.resolve(jsonResponse(detailPayload));
            throw new Error(`URL no esperada: ${url}`);
        });

        render(<Suppliers />);

        expect(await screen.findByLabelText('Cargando proveedores')).toBeTruthy();
        expect(screen.queryByText('No hay proveedores en esta búsqueda')).toBeNull();

        resolveList(jsonResponse([supplier]));
        expect(await screen.findByRole('heading', { name: 'Carnes Molina' })).toBeTruthy();
        expect(await screen.findByText('constancia-ruc.pdf')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Nuevo/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /Editar expediente/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /Agregar/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /Descargar/i })).toBeNull();
    });

    it('permite a administración editar la ficha y crear contactos con el contrato exacto', async () => {
        localStorage.setItem('nortex_user', JSON.stringify({ role: 'OWNER' }));
        mockedAuthFetch.mockImplementation(async (url: string, init?: RequestInit) => {
            if (url === '/api/suppliers?limit=120&status=ALL') return jsonResponse([supplier]);
            if (url === '/api/suppliers/supplier-1' && !init?.method) return jsonResponse(detailPayload);
            if (url === '/api/suppliers/supplier-1/contacts' && init?.method === 'POST') {
                return jsonResponse({ data: { id: 'contact-2' } }, 201);
            }
            throw new Error(`URL no esperada: ${url} ${init?.method || 'GET'}`);
        });

        render(<Suppliers />);

        expect(await screen.findByRole('heading', { name: 'Carnes Molina' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Editar expediente' }));
        expect((screen.getByLabelText('Tipo legal') as HTMLSelectElement).value).toBe('JURIDICAL');
        expect(screen.getByLabelText('Límite de crédito')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

        fireEvent.click(screen.getByRole('button', { name: 'Agregar' }));
        fireEvent.change(screen.getByLabelText('Nombre del contacto'), { target: { value: 'Carlos Frío' } });
        fireEvent.change(screen.getByLabelText('Cargo'), { target: { value: 'Despacho' } });
        fireEvent.change(screen.getByLabelText('Teléfono del contacto'), { target: { value: '7777 2222' } });
        fireEvent.change(screen.getByLabelText('Correo del contacto'), { target: { value: 'despacho@carnes.test' } });
        fireEvent.click(screen.getByLabelText('Contacto principal del proveedor'));
        fireEvent.click(screen.getByRole('button', { name: 'Guardar contacto' }));

        await waitFor(() => {
            const call = mockedAuthFetch.mock.calls.find(([url, init]) => (
                url === '/api/suppliers/supplier-1/contacts' && init?.method === 'POST'
            ));
            expect(call).toBeTruthy();
            expect(JSON.parse(String(call?.[1]?.body))).toEqual({
                name: 'Carlos Frío',
                title: 'Despacho',
                phone: '7777 2222',
                email: 'despacho@carnes.test',
                isPrimary: true,
                notes: null,
            });
        });
    });

    it('debouncea la búsqueda y la envía al backend sin perder el filtro ALL', async () => {
        localStorage.setItem('nortex_user', JSON.stringify({ role: 'ACCOUNTANT' }));
        mockedAuthFetch.mockImplementation(async (url: string) => {
            if (url === '/api/suppliers?limit=120&status=ALL') return jsonResponse([supplier]);
            if (url === '/api/suppliers/supplier-1') return jsonResponse(detailPayload);
            if (url === '/api/suppliers?limit=120&status=ALL&search=pollo') return jsonResponse([]);
            throw new Error(`URL no esperada: ${url}`);
        });

        render(<Suppliers />);
        expect(await screen.findByRole('heading', { name: 'Carnes Molina' })).toBeTruthy();
        fireEvent.change(screen.getByLabelText('Buscar proveedores'), { target: { value: 'pollo' } });

        await waitFor(() => {
            expect(mockedAuthFetch).toHaveBeenCalledWith('/api/suppliers?limit=120&status=ALL&search=pollo');
        });
        expect(await screen.findByText('No hay proveedores en esta búsqueda')).toBeTruthy();
    });
});
