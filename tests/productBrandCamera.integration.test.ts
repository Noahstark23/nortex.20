import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import prisma from '../backend/lib/prisma';
import { assertDisposableDatabase } from './fixtures/assistant/integrationHelpers';
const base = process.env.NORTEX_QA_BASE_URL;
const qa = base && process.env.NORTEX_MYSQL_INTEGRATION === '1' ? describe.sequential : describe.skip;
let token = '', foreign = '', product: any;
async function api(path: string, body?: unknown, session = token, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${session}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
}
async function register() {
    const result = await api('/api/auth/register', { companyName: 'QA Marca Cámara', email: `brand-${randomUUID()}@example.invalid`, password: `QA-${randomUUID()}!`, type: 'FERRETERIA' }, '');
    expect(result.status).toBe(200); return result.body.token;
}
qa('marca y lector exacto con HTTP/MySQL', () => {
    beforeAll(async () => {
        assertDisposableDatabase();
        expect(['127.0.0.1', 'localhost']).toContain(new URL(base!).hostname);
        token = await register(); foreign = await register();
        const created = await api('/api/products', { name: 'Martillo 16oz', sku: `BC-${randomUUID()}`, brand: '  Truper  ', price: '85', stock: '0' });
        expect(created.status).toBe(200); product = created.body;
    }, 60000);
    it('guarda marca y la devuelve en búsqueda, refresco y lectura exacta', async () => {
        expect(product.brand).toBe('Truper');
        const search = await api('/api/products?search=truper&page=1');
        expect(search.status).toBe(200); expect(search.body.products.map((p: any) => p.id)).toContain(product.id);
        expect((await api(`/api/products?ids=${product.id}`)).body[0].brand).toBe('Truper');
        const exact = await api(`/api/products/by-barcode/${product.sku}`);
        expect(exact.status).toBe(200); expect(exact.body).toMatchObject({ id: product.id, brand: 'Truper', stock: 0 });
    });
    it('no usa coincidencias parciales ni tenant del cliente', async () => {
        expect((await api(`/api/products/by-barcode/${product.sku.slice(0, 10)}`)).status).toBe(404);
        expect((await api(`/api/products/by-barcode/${product.sku}?tenantId=${product.tenantId}`, undefined, foreign)).status).toBe(404);
        expect((await api(`/api/products/${product.id}`, { brand: 'Ajena' }, foreign, 'PUT')).status).toBe(404);
        expect((await api(`/api/products/by-barcode/${product.sku}`)).body.brand).toBe('Truper');
    });
    it('editar otros campos conserva marca; vaciarla es explícito y longitud está validada', async () => {
        expect((await api(`/api/products/${product.id}`, { name: 'Martillo' }, token, 'PUT')).status).toBe(200);
        expect((await api(`/api/products/by-barcode/${product.sku}`)).body.brand).toBe('Truper');
        expect((await api(`/api/products/${product.id}`, { brand: 'x'.repeat(101) }, token, 'PUT')).status).toBe(400);
        expect((await api(`/api/products/${product.id}`, { brand: null }, token, 'PUT')).status).toBe(200);
        expect((await api(`/api/products/by-barcode/${product.sku}`)).body.brand).toBeNull();
    });
    it('Excel acepta marca y conserva la marca si el siguiente archivo la omite', async () => {
        const row = { sku: product.sku, nombre: 'Martillo', precio: '85' };
        expect((await api('/api/products/bulk', { products: [{ ...row, marca: 'Stanley' }] })).body.errors).toEqual([]);
        expect((await api('/api/products/bulk', { products: [row] })).body.errors).toEqual([]);
        expect((await api(`/api/products/by-barcode/${product.sku}`)).body).toMatchObject({ brand: 'Stanley', stock: 0 });
    });
    it('bodeguero ve marca sin precios y no puede cambiar catálogo', async () => {
        const password = `QA-${randomUUID()}`;
        const user = await prisma.user.create({ data: { tenantId: product.tenantId, name: 'Bodega QA', role: 'BODEGUERO', email: `${randomUUID()}@example.invalid`, password: await bcrypt.hash(password, 4) } });
        const login = await api('/api/auth/login', { email: user.email, password }, ''); expect(login.status).toBe(200);
        const scopedToken = login.body.token;
        const lookup = await api(`/api/products/by-barcode/${product.sku}`, undefined, scopedToken);
        expect(lookup.status).toBe(200); expect(lookup.body.brand).toBe('Stanley');
        for (const field of ['price', 'cost', 'wholesalePrice', 'packPrice', 'createdBy']) expect(lookup.body).not.toHaveProperty(field);
        expect((await api(`/api/products/${product.id}`, { brand: 'No autorizado' }, scopedToken, 'PUT')).status).toBe(403);
    });
    it('vendedor asignado no descubre productos fuera de su catálogo exacto', async () => {
        const password = `QA-${randomUUID()}`;
        const user = await prisma.user.create({ data: { tenantId: product.tenantId, name: 'Vendedor QA', role: 'VENDEDOR', email: `${randomUUID()}@example.invalid`, password: await bcrypt.hash(password, 4) } });
        const own = await api('/api/products', { name: 'Asignado', sku: `ASSIGNED-${randomUUID()}`, price: '10', brand: 'Truper', stock: '0' }); expect(own.status).toBe(200);
        await prisma.sellerProduct.create({ data: { tenantId: product.tenantId, sellerId: user.id, productId: own.body.id } });
        const login = await api('/api/auth/login', { email: user.email, password }, ''); expect(login.status).toBe(200);
        expect((await api(`/api/products/by-barcode/${product.sku}`, undefined, login.body.token)).status).toBe(404);
        expect((await api(`/api/products/by-barcode/${own.body.sku}`, undefined, login.body.token)).body.id).toBe(own.body.id);
    });
});
