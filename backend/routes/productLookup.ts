import express from 'express';
import prisma from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { BODEGUERO_ROLE, redactBodegueroProduct } from '../security/bodegueroPolicy';

const router = express.Router();
/** Identificación exacta: un error de conexión nunca significa producto inexistente. */
router.get('/by-barcode/:code', authenticate, async (req: any, res: any) => {
    const code = req.params.code.trim();
    if (!code || code.length > 100 || /[\u0000-\u001f\u007f]/u.test(code)) return res.status(400).json({ error: 'Código inválido' });
    try {
        const product = await prisma.product.findFirst({ where: { tenantId: req.tenantId, sku: code.toUpperCase() } });
        if (!product) return res.status(404).json({ error: 'Código no registrado', code: 'PRODUCT_NOT_FOUND' });
        if (req.role === 'VENDEDOR') {
            const assigned = await prisma.sellerProduct.findFirst({ where: { tenantId: req.tenantId, sellerId: req.userId }, select: { productId: true } });
            if (assigned && !await prisma.sellerProduct.findFirst({ where: { tenantId: req.tenantId, sellerId: req.userId, productId: product.id }, select: { productId: true } })) {
                return res.status(404).json({ error: 'Código no registrado en tu catálogo', code: 'PRODUCT_NOT_FOUND' });
            }
        }
        res.json(req.role === BODEGUERO_ROLE ? redactBodegueroProduct(product) : product);
    } catch {
        res.status(500).json({ error: 'No pudimos consultar el código. Reintentá.' });
    }
});
export default router;
