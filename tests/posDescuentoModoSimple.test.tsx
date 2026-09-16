// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import POS from '../components/POS';

/**
 * REGRESIÓN REPORTADA POR EL NEGOCIO (2026-09-16): "el descuento del POS
 * desapareció". No se había borrado: quedó detrás de `guidedSimpleMode`, y el
 * POS empezó a arrancar en modo simple para TODO giro menos LENDER.
 *
 * La política del POS y la del menú son deliberadamente distintas. R2.6
 * (12d91eb) las separó y dejó escrito el porqué: el modo simple del POS esconde
 * descuento, tiquetera, parqueo, devoluciones e importación, y ocultarle eso al
 * mostrador de una ferretería es una regresión real. Que el MENÚ de esa
 * ferretería arranque simple está bien; su POS, no.
 *
 * Esa separación se perdió en dos pasos: `944cc94` invirtió el cuerpo de
 * `resolvePosSimple` (`=== 'PULPERIA'` → `!== 'LENDER'`) y borró el comentario
 * que la explicaba; `5c5d307` dejó de llamarla y volvió a leer el modo del menú.
 *
 * Estas pruebas fijan la CONDUCTA que se perdió, no la fórmula: montan el POS
 * de verdad y miran si el cajero puede aplicar un descuento. Una prueba sobre
 * `resolvePosSimple` en aislamiento habría seguido en verde durante todo el
 * período roto, porque el POS ni la llamaba.
 */

const PRODUCTO = {
    id: 'p1',
    name: 'Tornillo 3/8',
    sku: '7501055363018',
    price: 25,
    cost: 15,
    stock: 40,
    minStock: 5,
    unit: 'unidad',
    category: 'Ferretería',
    ivaExento: false,
    isPublished: true,
};

const TURNO_ABIERTO = {
    id: 's1',
    status: 'OPEN',
    initialCash: '500',
    userId: 'u1',
    startTime: '2026-09-16T12:00:00.000Z',
};

const respuestasBase = (): Record<string, unknown> => ({
    '/api/products': [PRODUCTO],
    '/api/customers': [],
    '/api/shifts/current': { ...TURNO_ABIERTO, esTurnoPropio: true, turnoDe: null },
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
    ok: true,
    status: 200,
    json: async () => cuerpo,
    text: async () => JSON.stringify(cuerpo),
});

function doblarFetch() {
    vi.stubGlobal('fetch', vi.fn(async (url: any) => {
        const ruta = String(url).split('?')[0];
        if (ruta === '/api/promotions/checkout/quote') return respuestaOk({ enabled: false, quote: null });
        const cuerpo = ruta in respuestas ? respuestas[ruta] : {};
        return respuestaOk(cuerpo);
    }));
}

/** jsdom no trae matchMedia y el POS lo consulta al montar. */
function doblarMatchMedia() {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
        media: query,
        matches: query === '(min-width: 1024px)',
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: () => true,
    })));
}

/**
 * Deja el almacenamiento como lo tiene un negocio real: el giro viaja en
 * `nortex_user.tenant.type`, y `nortex_ui_mode` solo existe si el usuario tocó
 * el toggle alguna vez. `undefined` = nunca lo tocó, que es el caso del reporte.
 */
const prepararTenant = (type: string, modoGuardado?: 'simple' | 'full') => {
    localStorage.setItem('nortex_tenant_data', JSON.stringify({ id: 't1', businessName: 'QA', type }));
    localStorage.setItem('nortex_user', JSON.stringify({
        id: 'u1', name: 'Cajero', role: 'ADMIN', tenant: { id: 't1', type },
    }));
    localStorage.setItem('token', 'tok-qa');
    if (modoGuardado) localStorage.setItem('nortex_ui_mode', modoGuardado);
};

const montarPOS = () => render(<MemoryRouter initialEntries={['/app/pos']}><POS /></MemoryRouter>);

/** Espera a que el POS termine de cargar caja y catálogo antes de aseverar. */
const esperarPOSListo = async () => {
    await waitFor(() => expect(
        screen.getByPlaceholderText(/Escaneá o buscá un producto|Buscar o escanear/i),
    ).toBeInTheDocument());
};

const descuentoGlobal = () => screen.queryByLabelText('Descuento global en porcentaje');

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

describe('POS · el descuento y el giro del negocio', () => {
    it('una ferretería sin modo elegido conserva el Descuento Global', async () => {
        // EL BUG EXACTO DEL REPORTE: nadie tocó el toggle y el descuento se fue.
        prepararTenant('FERRETERIA');
        montarPOS();
        await esperarPOSListo();

        expect(descuentoGlobal()).toBeInTheDocument();
    });

    it('una farmacia sin modo elegido conserva el Descuento Global', async () => {
        prepararTenant('FARMACIA');
        montarPOS();
        await esperarPOSListo();

        expect(descuentoGlobal()).toBeInTheDocument();
    });

    it('una distribuidora sin modo elegido conserva el Descuento Global', async () => {
        prepararTenant('DISTRIBUIDORA');
        montarPOS();
        await esperarPOSListo();

        expect(descuentoGlobal()).toBeInTheDocument();
    });

    it('la elección explícita del usuario manda: "simple" esconde el descuento en ferretería', async () => {
        // El arreglo NO puede ser "mostrar siempre": quien pidió modo simple
        // sigue teniendo modo simple. Lo guardado gana, en los dos sentidos.
        prepararTenant('FERRETERIA', 'simple');
        montarPOS();
        await esperarPOSListo();

        expect(descuentoGlobal()).not.toBeInTheDocument();
    });

    it('la elección explícita del usuario manda: "full" devuelve el descuento en pulpería', async () => {
        prepararTenant('PULPERIA', 'full');
        montarPOS();
        await esperarPOSListo();

        expect(descuentoGlobal()).toBeInTheDocument();
    });

    it('la pulpería sin modo elegido sigue arrancando simple (conducta original de R2.6)', async () => {
        // Se fija para que el arreglo del descuento no se lleve por delante el
        // default que la pulpería tiene desde siempre. Si mañana se decide que
        // la pulpería también necesita descuento, que sea una decisión con su
        // propio cambio y no un efecto colateral de este.
        prepararTenant('PULPERIA');
        montarPOS();
        await esperarPOSListo();

        expect(descuentoGlobal()).not.toBeInTheDocument();
    });

    it('el prestamista nunca entra en modo simple del POS', async () => {
        prepararTenant('LENDER');
        montarPOS();
        await esperarPOSListo();

        expect(descuentoGlobal()).toBeInTheDocument();
    });
});
