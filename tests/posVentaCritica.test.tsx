// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import POS from '../components/POS';

/**
 * CARACTERIZACIÓN DEL CAMINO CRÍTICO DEL POS — la red del refactor.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 * ---------------------------
 * `components/POS.tsx` es un componente de ~6.900 líneas con 122 `useState`.
 * Hay que desarmarlo, pero hasta hoy NADA verificaba que siga vendiendo: no
 * había un solo test de render en el repo. Los tests que nombran al POS leen su
 * CÓDIGO FUENTE como texto y afirman que ciertos strings están adentro del
 * archivo — o sea que clavan el monolito en su lugar y no cubren ni una venta.
 *
 * Esto es una red de CARACTERIZACIÓN, no de especificación: describe lo que el
 * POS hace HOY, no lo que debería hacer. Se escribió contra el componente sin
 * tocarlo. Su trabajo es fallar si un refactor cambia la conducta de la venta,
 * y quedarse callado si solo se movió código de lugar. Por eso no asevera
 * estructura (qué archivo, qué componente, qué hook) sino lo que ve el cajero:
 * el producto entra, el total suma, el vuelto sale, la venta se registra.
 *
 * QUÉ FIJA, EXPLÍCITAMENTE
 *   1. El escáner matchea contra el **SKU**. El POS no mapea ningún campo
 *      `barcode` del backend: `indexarProductos` arma su índice con
 *      name + sku + category y el match exacto es por SKU. Si un refactor
 *      "arregla" eso, este test lo cuenta.
 *   2. El total del carrito y el monto del botón de cobro son el mismo número.
 *   3. El vuelto se calcula sobre el efectivo recibido.
 *   4. La venta se postea a `/api/sales` con su total, y con `offlineId` para
 *      que el backend pueda deduplicar el reintento.
 *
 * NOTA DE ENTORNO: corre en jsdom con `fake-indexeddb` (la cola offline usa
 * IndexedDB) y con `fetch` doblado. No toca red ni base de datos.
 */

const PRODUCTO = {
    id: 'p1',
    name: 'Coca Cola 500ml',
    sku: '7501055363018',
    price: 25,
    cost: 15,
    stock: 40,
    minStock: 5,
    unit: 'unidad',
    category: 'Bebidas',
    ivaExento: false,
    isPublished: true,
};

const TURNO_ABIERTO = {
    id: 's1',
    status: 'OPEN',
    initialCash: '500',
    userId: 'u1',
    startTime: '2026-08-27T12:00:00.000Z',
};

/** Respuestas por defecto: catálogo con un producto y una caja abierta. */
const respuestasBase = (): Record<string, unknown> => ({
    '/api/products': [PRODUCTO],
    '/api/customers': [],
    // Forma REAL del endpoint: el turno viaja aplanado (no envuelto en `shift`),
    // con `esTurnoPropio`. Sin turno abierto el backend devuelve `null` pelado.
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
});

let respuestas: Record<string, unknown>;
/** Cuerpos posteados, para aseverar QUÉ se registró y no solo que se llamó. */
let posteos: Array<{ ruta: string; cuerpo: any }>;

function doblarFetch() {
    vi.stubGlobal('fetch', vi.fn(async (url: any, init?: any) => {
        const ruta = String(url).split('?')[0];
        if (init?.method === 'POST') {
            let cuerpo: any = null;
            try { cuerpo = JSON.parse(init.body); } catch { /* sin cuerpo JSON */ }
            posteos.push({ ruta, cuerpo });
            if (ruta === '/api/sales') {
                return respuestaOk({ id: 'venta-1', total: cuerpo?.total, invoiceNumber: '0001' });
            }
        }
        // OJO con el `??`: varios endpoints devuelven `null` a propósito
        // (`/api/shifts/current` sin turno abierto). Un `?? {}` convertiría ese
        // null en un objeto truthy y el doble mentiría, mostrando "Caja abierta"
        // donde no hay ninguna. Se distingue "no configurado" de "configurado
        // como null" con `in`.
        const cuerpo = ruta in respuestas ? respuestas[ruta] : {};
        return respuestaOk(cuerpo);
    }));
}

const respuestaOk = (cuerpo: unknown) => ({
    ok: true,
    status: 200,
    json: async () => cuerpo,
    text: async () => JSON.stringify(cuerpo),
});

beforeEach(() => {
    respuestas = respuestasBase();
    posteos = [];
    localStorage.setItem('nortex_tenant_data', JSON.stringify({ id: 't1', businessName: 'Pulpería QA' }));
    localStorage.setItem('nortex_user', JSON.stringify({ id: 'u1', name: 'Cajera', role: 'CASHIER' }));
    localStorage.setItem('token', 'tok-qa');
    doblarFetch();
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
});

const montarPOS = () => render(<MemoryRouter><POS /></MemoryRouter>);

/** El buscador es el control donde el cajero pasa el turno; tiene autoFocus. */
const buscador = () => screen.findByPlaceholderText(/Escaneá o buscá un producto/i);

/** Deja que corran los efectos y las promesas del fetch doblado. */
const asentar = (ms = 250) => new Promise((r) => setTimeout(r, ms));

describe('POS · escanear y armar la venta', () => {
    it('escanear un SKU exacto mete el producto y el total refleja su precio', async () => {
        const user = userEvent.setup();
        montarPOS();

        await user.type(await buscador(), `${PRODUCTO.sku}{Enter}`);
        await asentar();

        const cuerpo = document.body.textContent ?? '';
        expect(cuerpo).toContain('Coca Cola 500ml agregado');
        expect(cuerpo).toContain('1 unidad × C$ 25.00');
        // El total y el botón de cobro dicen el MISMO número: es la cifra que el
        // cajero le canta al cliente.
        expect(await screen.findByRole('button', { name: /Cobrar C\$ 25\.00 en efectivo/i })).toBeTruthy();
    });

    it('escanear dos veces el mismo código acumula cantidad en una sola línea', async () => {
        const user = userEvent.setup();
        montarPOS();

        const campo = await buscador();
        await user.type(campo, `${PRODUCTO.sku}{Enter}`);
        await asentar(150);
        await user.type(campo, `${PRODUCTO.sku}{Enter}`);
        await asentar();

        const cuerpo = document.body.textContent ?? '';
        // OJO — se asevera "2 unidad", en singular, porque es LO QUE DICE HOY:
        // la línea no pluraliza la unidad. Es un defecto de copy que este test
        // deja registrado en vez de tapar. Cuando se arregle, hay que cambiar
        // esta línea A PROPÓSITO; lo que no puede pasar es que se arregle o se
        // rompa sin que nadie se entere.
        expect(cuerpo).toContain('2 unidad × C$ 25.00');
        expect(cuerpo).not.toContain('1 unidad × C$ 25.00');
        expect(await screen.findByRole('button', { name: /Cobrar C\$ 50\.00 en efectivo/i })).toBeTruthy();
    });

    it('un código que no existe no ensucia el carrito y lo dice con el código adentro', async () => {
        const user = userEvent.setup();
        montarPOS();

        await user.type(await buscador(), '0000000000000{Enter}');
        await asentar();

        const cuerpo = document.body.textContent ?? '';
        expect(cuerpo).toContain('No encontramos');
        expect(cuerpo).toContain('0000000000000');
        expect(cuerpo).toContain('Tu venta está vacía');
    });
});

describe('POS · cobrar en efectivo', () => {
    it('abre el panel de efectivo con el total de la venta', async () => {
        const user = userEvent.setup();
        montarPOS();

        await user.type(await buscador(), `${PRODUCTO.sku}{Enter}`);
        await asentar(150);
        await user.click(await screen.findByRole('button', { name: /Cobrar C\$ 25\.00 en efectivo/i }));
        await asentar();

        const cuerpo = document.body.textContent ?? '';
        expect(cuerpo).toContain('Efectivo recibido');
        expect(cuerpo).toContain('Confirmá el vuelto antes de registrar');
    });

    it('calcula el vuelto sobre el efectivo recibido', async () => {
        const user = userEvent.setup();
        montarPOS();

        await user.type(await buscador(), `${PRODUCTO.sku}{Enter}`);
        await asentar(150);
        await user.click(await screen.findByRole('button', { name: /Cobrar C\$ 25\.00 en efectivo/i }));
        await asentar(150);
        // Billete de C$50 sobre una venta de C$25.
        await user.click(await screen.findByRole('button', { name: /^C\$ 50$/ }));
        await asentar();

        const cuerpo = document.body.textContent ?? '';
        expect(cuerpo).toContain('Vuelto');
        expect(cuerpo).toContain('C$ 25.00');
    });

    it('registra la venta con el total y con clave de idempotencia', async () => {
        const user = userEvent.setup();
        montarPOS();

        await user.type(await buscador(), `${PRODUCTO.sku}{Enter}`);
        await asentar(150);
        await user.click(await screen.findByRole('button', { name: /Cobrar C\$ 25\.00 en efectivo/i }));
        await asentar(150);
        await user.click(await screen.findByRole('button', { name: /^C\$ 50$/ }));
        await asentar(150);
        await user.click(await screen.findByRole('button', { name: /Registrar efectivo y seguir/i }));
        await asentar(400);

        const venta = posteos.find((p) => p.ruta === '/api/sales');
        expect(venta, 'la venta tiene que llegar a /api/sales').toBeTruthy();
        expect(Number(venta!.cuerpo.total)).toBe(25);
        expect(venta!.cuerpo.paymentMethod).toBe('CASH');
        // `offlineId` es la clave con la que el backend deduplica el reintento
        // (`executeSale`). Sin ella, un reintento por lie-fi cobra dos veces.
        expect(typeof venta!.cuerpo.offlineId).toBe('string');
        expect(venta!.cuerpo.offlineId.length).toBeGreaterThan(0);
        // La línea vendida viaja con su producto y su cantidad. Dos detalles del
        // contrato real que conviene tener fijados: la línea identifica el
        // producto con `id` (no `productId`), y `quantity` viaja como STRING —
        // el dominio de cantidades del repo es decimal exacto (utils/quantity.ts),
        // así que mandarlo como número sería perder precisión en balanza.
        expect(venta!.cuerpo.items).toHaveLength(1);
        expect(venta!.cuerpo.items[0]).toMatchObject({ id: 'p1', quantity: '1' });
    });
});

describe('POS · sin caja abierta', () => {
    it('avisa que la caja está cerrada y no ofrece el saldo de la gaveta', async () => {
        // El backend devuelve `null` PELADO cuando no hay turno abierto
        // (`server.ts`: `if (!shift) return res.json(null)`).
        respuestas['/api/shifts/current'] = null;
        const user = userEvent.setup();
        montarPOS();

        await user.type(await buscador(), `${PRODUCTO.sku}{Enter}`);
        await asentar();

        const cuerpo = document.body.textContent ?? '';
        // El estado de la caja se dice en la cabecera, no se adivina.
        expect(cuerpo).toContain('Caja cerrada');
        expect(cuerpo).not.toContain('Caja abierta');
        // El carrito SÍ se arma: la cajera puede ir marcando mientras se abre
        // la caja. Lo que no puede es cerrar la venta sin turno.
        expect(cuerpo).toContain('1 unidad × C$ 25.00');
    });

    it('intentar cobrar sin turno no manda la venta al servidor', async () => {
        respuestas['/api/shifts/current'] = null;
        const user = userEvent.setup();
        montarPOS();

        await user.type(await buscador(), `${PRODUCTO.sku}{Enter}`);
        await asentar(150);
        await user.click(await screen.findByRole('button', { name: /Cobrar C\$ 25\.00 en efectivo/i }));
        await asentar(400);

        // Sea cual sea la pantalla que muestre, lo que NO puede pasar es que se
        // registre una venta que el backend va a rechazar por NO_SHIFT y que
        // después nadie sepa reconciliar contra la gaveta.
        expect(posteos.find((p) => p.ruta === '/api/sales')).toBeUndefined();
    });
});
