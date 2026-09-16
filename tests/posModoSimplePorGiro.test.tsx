// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import POS from '../components/POS';

/**
 * EN QUÉ MODO DE POS CAE CADA GIRO.
 *
 * La política del POS y la del menú son deliberadamente distintas. R2.6
 * (12d91eb) las separó: que el MENÚ de una ferretería arranque simple está
 * bien; su POS, no, porque el modo simple esconde herramientas de mostrador.
 * Esa separación se perdió en dos pasos —`944cc94` invirtió el cuerpo de
 * `resolvePosSimple` y borró el comentario que la explicaba; `5c5d307` dejó de
 * llamarla y volvió a leer el modo del menú— y el negocio lo reportó el
 * 2026-09-16 como "el descuento del POS desapareció".
 *
 * ESTE ARCHIVO YA NO USA EL DESCUENTO COMO SONDA. Antes lo hacía, porque el
 * descuento dependía del modo. Desde la decisión de producto del 2026-09-16 es
 * visible SIEMPRE, en los dos modos (ver posDescuentoSiempreVisible.test.tsx):
 * ya no distingue un modo del otro, y seguir usándolo sería medir con una regla
 * que dejó de marcar.
 *
 * La sonda ahora es el rótulo del buscador, que sí cambia con el modo:
 *   simple   → "Escaneá o buscá un producto"
 *   completo → "Buscar o escanear"
 *
 * Lo que se protege es lo mismo y sigue importando: que nadie vuelva a unificar
 * `resolvePosSimple` con `resolveUiMode`. Se fija montando el POS, no la
 * fórmula: una prueba sobre la función en aislamiento habría seguido en verde
 * durante todo el período roto, porque el POS ni la llamaba.
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

/**
 * La sonda del modo. El rótulo del buscador es lo más estable que distingue los
 * dos modos: existe siempre, no depende del carrito ni del turno, y no hay que
 * abrir ningún menú para verlo.
 */
const modoDelPOS = (): 'simple' | 'completo' =>
    screen.queryByPlaceholderText('Escaneá o buscá un producto') ? 'simple' : 'completo';

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

describe('POS · en qué modo cae cada giro', () => {
    it('una ferretería sin modo elegido arranca en POS completo', async () => {
        // EL BUG EXACTO DEL REPORTE: nadie tocó el toggle y el POS se simplificó.
        prepararTenant('FERRETERIA');
        montarPOS();
        await esperarPOSListo();

        expect(modoDelPOS()).toBe('completo');
    });

    it('una farmacia sin modo elegido arranca en POS completo', async () => {
        prepararTenant('FARMACIA');
        montarPOS();
        await esperarPOSListo();

        expect(modoDelPOS()).toBe('completo');
    });

    it('una distribuidora sin modo elegido arranca en POS completo', async () => {
        prepararTenant('DISTRIBUIDORA');
        montarPOS();
        await esperarPOSListo();

        expect(modoDelPOS()).toBe('completo');
    });

    it('la elección explícita del usuario manda: "simple" simplifica la ferretería', async () => {
        // El arreglo NO puede ser "todos en completo": quien pidió modo simple
        // sigue teniendo modo simple. Lo guardado gana, en los dos sentidos.
        prepararTenant('FERRETERIA', 'simple');
        montarPOS();
        await esperarPOSListo();

        expect(modoDelPOS()).toBe('simple');
    });

    it('la elección explícita del usuario manda: "full" saca del simple a la pulpería', async () => {
        prepararTenant('PULPERIA', 'full');
        montarPOS();
        await esperarPOSListo();

        expect(modoDelPOS()).toBe('completo');
    });

    it('la pulpería sin modo elegido sigue arrancando simple (conducta original de R2.6)', async () => {
        // El modo simple sigue existiendo y sigue siendo el default de la
        // pulpería: lo que cambió el 2026-09-16 es QUÉ esconde (ya no el
        // descuento), no a quién le toca.
        prepararTenant('PULPERIA');
        montarPOS();
        await esperarPOSListo();

        expect(modoDelPOS()).toBe('simple');
    });

    it('el prestamista nunca entra en modo simple del POS', async () => {
        prepararTenant('LENDER');
        montarPOS();
        await esperarPOSListo();

        expect(modoDelPOS()).toBe('completo');
    });
});
