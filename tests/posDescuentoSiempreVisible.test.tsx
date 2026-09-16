// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import POS from '../components/POS';

/**
 * DECISIÓN DE PRODUCTO (2026-09-16): el descuento sale del modo.
 *
 * El modo simple del POS existe para esconder CONFIGURACIÓN de una sola vez —
 * tiquetera, escáner, importación Excel, "Nuevo" producto completo—. Eso se
 * conserva y tiene sentido: son cosas que se tocan una vez y se olvidan.
 *
 * El descuento nunca perteneció a esa bolsa. Es la operación más común del
 * mostrador después de cobrar, y en una pulpería —el giro que el modo simple
 * tiene por defecto— se regatea MÁS que en ningún otro: "te lo dejo en 20",
 * "llevate los dos por 35". Esconderlo ahí fue un error de categoría: se
 * confundió configuración poco frecuente con operación diaria.
 *
 * Esto CAMBIA A PROPÓSITO la conducta que fijaba tests/posDescuentoModoSimple:
 * ahí la pulpería en modo simple no veía descuento y eso se probaba. Aquella
 * prueba describía la conducta original de R2.6, que era la correcta mientras
 * la discusión fuera "qué esconde el modo simple". La discusión ahora es otra:
 * el descuento no se esconde nunca. No se debilitó ninguna aserción para que
 * pasara código nuevo; se cambió una decisión y se movió su prueba con ella.
 *
 * Lo que sigue dependiendo del modo —y se prueba acá para que no se caiga de
 * paso— es la tiquetera, el escáner y la importación.
 */

const PRODUCTO = {
    id: 'p1',
    name: 'Gaseosa 3 litros',
    sku: '7501055363018',
    price: 60,
    cost: 40,
    stock: 30,
    minStock: 5,
    unit: 'unidad',
    category: 'Bebidas',
    ivaExento: false,
    isPublished: true,
};

const TURNO = {
    id: 's1', status: 'OPEN', initialCash: '500', userId: 'u1',
    startTime: '2026-09-16T12:00:00.000Z', esTurnoPropio: true, turnoDe: null,
};

const respuestasBase = (): Record<string, unknown> => ({
    '/api/products': [PRODUCTO],
    '/api/customers': [],
    '/api/shifts/current': TURNO,
    '/api/cash-movements': [],
    '/api/cash-movements/balance': { efectivo: 500, efectivoNIO: 500 },
    '/api/pos/pulso': {},
    '/api/tenant/fiscal-settings': {},
    '/api/tenant/cashier-settings': {},
    '/api/tenant/inventory-settings': {},
    '/api/accounting/exchange-rate/latest': {},
    '/api/agent-banking/agreements': [],
    '/api/scale-labels/active-context': {},
    '/api/scale-labels/preview': { data: { classification: 'SKU' } },
});

let respuestas: Record<string, unknown>;

const respuestaOk = (cuerpo: unknown) => ({
    ok: true, status: 200,
    json: async () => cuerpo,
    text: async () => JSON.stringify(cuerpo),
});

function doblarFetch() {
    vi.stubGlobal('fetch', vi.fn(async (url: any) => {
        const ruta = String(url).split('?')[0];
        if (ruta === '/api/promotions/checkout/quote') return respuestaOk({ enabled: false, quote: null });
        return respuestaOk(ruta in respuestas ? respuestas[ruta] : {});
    }));
}

function doblarMatchMedia() {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
        media: query,
        matches: query === '(min-width: 1024px)',
        onchange: null,
        addEventListener: vi.fn(), removeEventListener: vi.fn(),
        addListener: vi.fn(), removeListener: vi.fn(),
        dispatchEvent: () => true,
    })));
}

const prepararTenant = (type: string, modoGuardado?: 'simple' | 'full') => {
    localStorage.setItem('nortex_tenant_data', JSON.stringify({ id: 't1', businessName: 'QA', type }));
    localStorage.setItem('nortex_user', JSON.stringify({
        id: 'u1', name: 'Cajero', role: 'ADMIN', tenant: { id: 't1', type },
    }));
    localStorage.setItem('token', 'tok-qa');
    if (modoGuardado) localStorage.setItem('nortex_ui_mode', modoGuardado);
};

const montarPOS = () => render(<MemoryRouter initialEntries={['/app/pos']}><POS /></MemoryRouter>);

const buscador = () => screen.getByPlaceholderText(/Escaneá o buscá un producto|Buscar o escanear/i);

const esperarPOSListo = async () => {
    await waitFor(() => expect(buscador()).toBeInTheDocument());
};

const agregarProducto = async () => {
    fireEvent.change(buscador(), { target: { value: PRODUCTO.sku } });
    fireEvent.keyDown(buscador(), { key: 'Enter', code: 'Enter' });
    await screen.findByRole('button', { name: `Quitar ${PRODUCTO.name} del ticket` });
};

const descuentoGlobal = () => screen.queryByLabelText('Descuento global en porcentaje');
const descuentoLinea = () => screen.queryByRole('button', { name: 'Aplicar descuento' });

beforeEach(() => {
    respuestas = respuestasBase();
    doblarFetch();
    doblarMatchMedia();
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
});

describe('POS · el descuento no depende del modo', () => {
    // La pulpería en modo simple es EL caso: es el giro donde más se regatea y
    // el único que el modo simple tiene por defecto.
    it('una pulpería en modo simple ve el Descuento Global', async () => {
        prepararTenant('PULPERIA');
        montarPOS();
        await esperarPOSListo();

        expect(descuentoGlobal()).toBeInTheDocument();
    });

    it('una pulpería en modo simple puede aplicar descuento por línea', async () => {
        prepararTenant('PULPERIA');
        montarPOS();
        await esperarPOSListo();
        await agregarProducto();

        expect(descuentoLinea()).toBeInTheDocument();
    });

    it('quien eligió modo simple a propósito igual conserva el descuento', async () => {
        // Elegir "simple" pide una pantalla más corta, no perder el regateo.
        prepararTenant('FERRETERIA', 'simple');
        montarPOS();
        await esperarPOSListo();
        await agregarProducto();

        expect(descuentoGlobal()).toBeInTheDocument();
        expect(descuentoLinea()).toBeInTheDocument();
    });

    it('la ferretería en modo completo lo conserva — no se rompe lo ya arreglado', async () => {
        prepararTenant('FERRETERIA');
        montarPOS();
        await esperarPOSListo();
        await agregarProducto();

        expect(descuentoGlobal()).toBeInTheDocument();
        expect(descuentoLinea()).toBeInTheDocument();
    });

    it('el descuento por línea rebaja el total, no sólo aparece', async () => {
        prepararTenant('PULPERIA');
        montarPOS();
        await esperarPOSListo();
        await agregarProducto();

        fireEvent.click(descuentoLinea()!);
        const campo = screen.getByRole('textbox', { name: `Descuento de ${PRODUCTO.name} en porcentaje` });
        fireEvent.change(campo, { target: { value: '25' } });
        fireEvent.blur(campo);

        // 60 − 25% = 45. Si el control se ve pero no aplica, no sirve de nada.
        // Se asevera contra el BOTÓN DE COBRO: es el número que el cajero toca
        // y el que tiene que cuadrar con lo que el cliente paga. El mismo 45
        // aparece en la línea y en el total, pero esos son reflejo de este.
        expect(await screen.findByRole('button', { name: /Cobrar C\$\s*45\.00 en efectivo/i })).toBeInTheDocument();
    });
});

describe('POS · lo que el modo simple SÍ sigue escondiendo', () => {
    // El modo simple no se vació: lo que sale es el descuento, no su razón de ser.
    it('la pulpería en modo simple no ve tiquetera ni escáner ni importación', async () => {
        prepararTenant('PULPERIA');
        montarPOS();
        await esperarPOSListo();

        expect(screen.queryByRole('button', { name: /Tiquetera/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Escáner$/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Importar desde Excel|^Excel$/i })).not.toBeInTheDocument();
    });
});
