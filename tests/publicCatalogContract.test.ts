import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    CreateProductSchema,
    ProductImageUrlSchema,
    PublicCatalogQuerySchema,
    UpdateProductSchema,
} from '../backend/validation/schemas';

const serverSource = readFileSync(new URL('../backend/server.ts', import.meta.url), 'utf8');
const prismaSchemaSource = readFileSync(new URL('../backend/prisma/schema.prisma', import.meta.url), 'utf8');
const routeStart = serverSource.indexOf("app.get('/api/public/catalog/:slug'");
const routeEnd = serverSource.indexOf('// POST /api/public/orders', routeStart);
const publicCatalogRoute = serverSource.slice(routeStart, routeEnd);

describe('contrato de fotos de producto', () => {
    it('acepta vacío/null y normaliza vacío a null', () => {
        expect(ProductImageUrlSchema.parse('')).toBeNull();
        expect(ProductImageUrlSchema.parse('   ')).toBeNull();
        expect(ProductImageUrlSchema.parse(null)).toBeNull();
    });

    it('acepta únicamente HTTPS de un host exacto autorizado', () => {
        const url = 'https://res.cloudinary.com/dex1vy92h/image/upload/v1/producto.webp';
        expect(ProductImageUrlSchema.parse(`  ${url}  `)).toBe(url);

        expect(ProductImageUrlSchema.safeParse('http://res.cloudinary.com/foto.jpg').success).toBe(false);
        expect(ProductImageUrlSchema.safeParse('/imagenes/foto.jpg').success).toBe(false);
        expect(ProductImageUrlSchema.safeParse('https://res.cloudinary.com.ejemplo.test/foto.jpg').success).toBe(false);
        expect(ProductImageUrlSchema.safeParse('https://imagenes.example.test/foto.jpg').success).toBe(false);
        expect(ProductImageUrlSchema.safeParse('https://usuario:clave@res.cloudinary.com/foto.jpg').success).toBe(false);
        expect(ProductImageUrlSchema.safeParse('https://res.cloudinary.com:8443/foto.jpg').success).toBe(false);
        expect(ProductImageUrlSchema.safeParse('https://res.cloudinary.com./foto.jpg').success).toBe(false);

        expect(ProductImageUrlSchema.parse('https://res.cloudinary.com:443/dex1vy92h/image/upload/foto.jpg'))
            .toBe('https://res.cloudinary.com/dex1vy92h/image/upload/foto.jpg');
        expect(ProductImageUrlSchema.safeParse(
            'https://res.cloudinary.com/dex1vy92h/image/fetch/https://legacy.example.test/foto.jpg',
        ).success).toBe(false);
        expect(ProductImageUrlSchema.safeParse(
            'https://res.cloudinary.com/dex1vy92h/image/upload/u_fetch:aHR0cHM6Ly9ldmls/foto.jpg',
        ).success).toBe(false);
    });

    it('aplica la frontera tanto al alta como a la edición', () => {
        const base = { name: 'Martillo', sku: 'MAR-1', price: '120' };
        expect(CreateProductSchema.safeParse({ ...base, imageUrl: 'https://res.cloudinary.com/dex1vy92h/image/upload/martillo.jpg' }).success).toBe(true);
        expect(CreateProductSchema.safeParse({ ...base, imageUrl: 'https://ejemplo.test/martillo.jpg' }).success).toBe(false);
        expect(UpdateProductSchema.safeParse({ imageUrl: 'https://ejemplo.test/martillo.jpg' }).success).toBe(false);
        expect(UpdateProductSchema.parse({ imageUrl: '' }).imageUrl).toBeNull();
    });
});

describe('query del catálogo público', () => {
    it('aplica una primera página de 48 productos por defecto', () => {
        expect(PublicCatalogQuerySchema.parse({})).toEqual({ page: 1, pageSize: 48 });
    });

    it('valida paginación, búsqueda y categoría', () => {
        expect(PublicCatalogQuerySchema.parse({
            page: '2',
            pageSize: '100',
            search: '  martillo  ',
            category: '  Ferretería  ',
        })).toEqual({
            page: 2,
            pageSize: 100,
            search: 'martillo',
            category: 'Ferretería',
        });
        expect(PublicCatalogQuerySchema.parse({ search: '', category: '   ' }))
            .toEqual({ page: 1, pageSize: 48 });
    });

    it('rechaza límites abusivos, valores ambiguos y parámetros ajenos', () => {
        expect(PublicCatalogQuerySchema.safeParse({ page: '0' }).success).toBe(false);
        expect(PublicCatalogQuerySchema.safeParse({ page: '1e2' }).success).toBe(false);
        expect(PublicCatalogQuerySchema.safeParse({ page: ['1'] }).success).toBe(false);
        expect(PublicCatalogQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false);
        expect(PublicCatalogQuerySchema.safeParse({ search: 'x'.repeat(121) }).success).toBe(false);
        expect(PublicCatalogQuerySchema.safeParse({ tenantId: 'tenant-atacante' }).success).toBe(false);
    });
});

describe('ruta pública paginada', () => {
    it('conserva el scope publicado del tenant resuelto por slug', () => {
        expect(routeStart).toBeGreaterThan(-1);
        expect(publicCatalogRoute).toContain('PublicCatalogQuerySchema.safeParse(req.query)');
        expect(publicCatalogRoute).toContain("where: { slug }");
        expect(publicCatalogRoute).toContain("const where: any = { tenantId: tenant.id, isPublished: true }");
        expect(publicCatalogRoute).not.toContain('req.query.tenantId');
    });

    it('filtra en base de datos y pagina con un orden estable', () => {
        expect(publicCatalogRoute).toContain("{ name: { contains: search } }");
        expect(publicCatalogRoute).toContain("{ description: { contains: search } }");
        expect(publicCatalogRoute).toContain("{ category: null }, { category: '' }, { category: 'Otros' }");
        expect(publicCatalogRoute).toContain('skip: (page - 1) * pageSize');
        expect(publicCatalogRoute).toContain('take: pageSize');
        expect(publicCatalogRoute).toContain("orderBy: [{ name: 'asc' }, { id: 'asc' }]");
        expect(publicCatalogRoute).toContain('prisma.product.count({ where })');
        expect(prismaSchemaSource).toContain('@@index([tenantId, isPublished, name])');
        expect(prismaSchemaSource).toContain('@@index([tenantId, isPublished, category, name])');
    });

    it('devuelve el contrato público sin campos internos', () => {
        expect(publicCatalogRoute).toContain("distinct: ['category']");
        expect(publicCatalogRoute).toContain('pagination: {');
        expect(publicCatalogRoute).toContain('totalPages: Math.ceil(total / pageSize)');
        expect(publicCatalogRoute).toContain('categories,');

        const selectStart = publicCatalogRoute.indexOf('select: {', publicCatalogRoute.indexOf('prisma.product.findMany'));
        const selectEnd = publicCatalogRoute.indexOf('},\n                orderBy:', selectStart);
        const productSelect = publicCatalogRoute.slice(selectStart, selectEnd);
        expect(productSelect).toContain('imageUrl: true');
        expect(productSelect).not.toContain('cost: true');
        expect(productSelect).not.toContain('stock: true');
        expect(productSelect).not.toContain('sku: true');
        expect(productSelect).not.toContain('tenantId: true');
    });
});
