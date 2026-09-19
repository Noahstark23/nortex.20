import express from 'express';
import prisma from '../lib/prisma';
import { authenticate, type AuthRequest } from '../middleware/auth';
import { BODEGUERO_ROLE, redactBodegueroProduct } from '../security/bodegueroPolicy';
import { parseProductRefreshIds } from '../lib/productRefreshQuery';
const router = express.Router();

// GET /api/products - Lista todos los productos (disponible para todos)
router.get('/', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    const { search, lowStock, category, status, family, mode, sort, dir, page, pageSize } = req.query;
    let refreshIds: string[] | undefined;
    try { refreshIds = parseProductRefreshIds(req.query.ids); }
    catch { return res.status(400).json({ error: 'Solicitá entre 1 y 100 referencias válidas.', code: 'INVALID_PRODUCT_IDS' }); }

    try {
        const whereClause: any = { tenantId: authReq.tenantId };
        // AND conserva la intersección con el catálogo asignado del vendedor.
        if (refreshIds) whereClause.AND = [{ id: { in: refreshIds } }];

        // Catálogo asignado (Vendedores Fase B): un VENDEDOR con catálogo ve
        // SOLO sus productos — en el POS y en cualquier listado. Sin filas, ve
        // todo (opt-in; el default preserva el comportamiento de siempre). El
        // filtro vive server-side: el rol sale del JWT, no de la UI.
        if (authReq.role === 'VENDEDOR') {
            const catalogo = await prisma.sellerProduct.findMany({
                where: { tenantId: authReq.tenantId!, sellerId: authReq.userId! },
                select: { productId: true },
            });
            if (catalogo.length > 0) {
                whereClause.id = { in: catalogo.map(c => c.productId) };
            }
        }

        if (search) {
            whereClause.OR = [
                { name: { contains: search } },
                { sku: { contains: search } },
                { category: { contains: search } },
                { brand: { contains: search } }
            ];
        }
        if (category) whereClause.category = String(category);
        if (family) whereClause.productFamily = String(family);
        if (mode === 'LEGACY') whereClause.saleMode = null;
        else if (mode === 'COUNTED' || mode === 'MEASURED') whereClause.saleMode = mode;
        if (status === 'out') whereClause.stock = { lte: 0 };
        // "Bajo mínimo" y "punto de reorden" comparan DOS COLUMNAS de la misma
        // fila (stock contra su umbral), así que van por field reference: el
        // filtro ocurre en SQL y el `count` de la paginación cuadra. Filtrarlo en
        // JS después del findMany —como hace el viejo `lowStock=true` de abajo—
        // rompe la paginación y trae toda la tabla a memoria.
        //
        // `gt: 0` NO es decorativo: la tarjeta KPI cuenta bajo-mínimo EXCLUYENDO
        // los agotados (lowStock − outOfStock). Sin esa condición, hacer clic en
        // una tarjeta que dice 100 devolvería más de 100 filas.
        else if (status === 'low') whereClause.stock = { lte: prisma.product.fields.minStock, gt: 0 };
        else if (status === 'reorder') {
            whereClause.stock = { lte: prisma.product.fields.reorderPoint, gt: 0 };
            whereClause.reorderPoint = { gt: 0 }; // 0 = el dueño no configuró reorden
        }
        else if (status === 'published') whereClause.isPublished = true;
        else if (status === 'unpublished') whereClause.isPublished = false;

        // El bodeguero no recibe precios/costos y tampoco puede inferirlos por
        // el orden relativo de resultados usando `sort=cost|price`.
        const sortableFields = authReq.role === BODEGUERO_ROLE
            ? ['name', 'stock', 'sku', 'category']
            : ['name', 'stock', 'price', 'cost', 'sku', 'category'];
        const sortField = sortableFields.includes(String(sort)) ? String(sort) : 'name';
        const orderBy: any = { [sortField]: dir === 'desc' ? 'desc' : 'asc' };

        // Modo paginado (opt-in: solo si llega `page`) — para la vista de inventario.
        // Sin `page`, devuelve el arreglo completo (compatibilidad con POS y otros).
        if (page) {
            const take = Math.min(200, Math.max(1, parseInt(String(pageSize)) || 50));
            const skip = (Math.max(1, parseInt(String(page)) || 1) - 1) * take;
            const [products, total] = await Promise.all([
                prisma.product.findMany({ where: whereClause, orderBy, skip, take, include: { creator: { select: { name: true, email: true } } } }),
                prisma.product.count({ where: whereClause }),
            ]);
            const visibleProducts = authReq.role === BODEGUERO_ROLE
                ? products.map(redactBodegueroProduct)
                : products;
            return res.json({ products: visibleProducts, total, page: Math.max(1, parseInt(String(page)) || 1), pageSize: take });
        }

        let products = await prisma.product.findMany({
            where: whereClause,
            ...(refreshIds ? { take: refreshIds.length } : {}),
            orderBy,
            include: {
                creator: { select: { name: true, email: true } }
            }
        });

        if (lowStock === 'true') {
            products = products.filter((p: any) => Number(p.stock) <= Number(p.minStock));
        }

        res.json(authReq.role === BODEGUERO_ROLE
            ? products.map(redactBodegueroProduct)
            : products);
    } catch (error) {
        console.error('Error fetching products:', error);
        res.status(500).json({ error: 'Error obteniendo productos' });
    }
});

// GET /api/products/categories — categorías distintas (para el filtro)
router.get('/categories', authenticate, async (req: any, res: any) => {
    const authReq = req as AuthRequest;
    try {
        const rows = await prisma.product.findMany({
            where: { tenantId: authReq.tenantId, category: { not: null } },
            select: { category: true },
            distinct: ['category'],
            orderBy: { category: 'asc' },
        });
        res.json(rows.map((r: any) => r.category).filter(Boolean));
    } catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({ error: 'Error obteniendo categorías' });
    }
});

export default router;
