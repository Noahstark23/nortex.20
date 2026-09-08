import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth';
import { ProductBatchIdentityError } from '../lib/productBatchIdentity';
import { PurchaseSalePriceError } from '../services/purchaseSalePriceService';
import { registerPurchase } from '../services/purchaseRegistrationService';
import { PurchaseRegistrationError } from '../services/purchaseRegistrationAuthority';
import { QuantityValidationError } from '../../utils/quantity';
import { PeriodLockedError } from '../services/accounting';
import { ProcurementMatchError } from '../lib/procurementMatch';
import { BatchWarehouseLedgerError } from '../services/productBatchWarehouseLedgerService';
import { StockError } from '../services/stockService';
import { SupplierPaymentError } from '../lib/supplierPayments';
import { SupplierPaymentError as SupplierPaymentCajaError } from '../services/supplierPayment';

/** Mismo contrato HTTP de Compras; el asistente importa el servicio, no esta ruta. */
export async function createPurchaseHandler(req: AuthRequest, res: Response) {
    const invoiceNumber = req.body?.invoiceNumber;
    try {
        const registered = await registerPurchase({
            principal: { tenantId: req.tenantId!, userId: req.userId!, role: req.role! },
            input: req.body,
            idempotencyKey: req.get('Idempotency-Key'),
        });
        const result = registered.purchase;
        return res.json({
            message: result.purchaseOrderId
                ? 'Factura registrada y vinculada a la Orden de Compra. El inventario se actualiza únicamente al recibir la OC.'
                : `Compra registrada. ${req.body.items.length} línea(s) ingresada(s) al inventario.`,
            purchase: result,
        });
    } catch (error: any) {
        if (error instanceof ProductBatchIdentityError || error instanceof PurchaseSalePriceError) return res.status(error.httpStatus).json({ error: error.message, code: error.code });
        if (error instanceof QuantityValidationError) return res.status(400).json({ error: error.message, code: error.code });
        if (error instanceof PurchaseRegistrationError) return res.status(error.httpStatus).json({ error: error.message, code: error.code });
        // Período cerrado (A1): la compra ahora exige asiento, así que un período
        // bloqueado la RECHAZA (423) en vez de dejar entrar mercancía sin registrar.
        if (error instanceof PeriodLockedError) {
            return res.status(423).json({ error: error.message });
        }
        if (error instanceof ProcurementMatchError) {
            return res.status(error.httpStatus).json({
                error: error.message,
                code: error.code,
                ...(error.details ? { details: error.details } : {}),
            });
        }
        if (error instanceof BatchWarehouseLedgerError) {
            return res.status(error.httpStatus).json({ error: error.message, code: error.code });
        }
        if (error?.message === 'PURCHASE_BATCH_CONCURRENT_WRITE') return res.status(409).json({ error: 'El lote cambió durante la compra. Intentá nuevamente.', code: 'PURCHASE_BATCH_CONCURRENT_WRITE' });
        if (error?.message === 'FACTURA_DUPLICADA' || error?.code === 'P2002') {
            return res.status(409).json({ error: `Ya existe la factura #${invoiceNumber} para este proveedor. No se registró nuevamente.` });
        }
        if (error instanceof StockError && error.code === 'WAREHOUSE_REQUIRED') {
            return res.status(400).json({ error: error.message, code: error.code });
        }
        if (error instanceof StockError && error.code === 'WAREHOUSE_NOT_FOUND') {
            return res.status(404).json({ error: error.message, code: error.code });
        }
        if (error?.message === 'OC_DE_OTRO_PROVEEDOR') {
            return res.status(400).json({ error: 'La orden de compra pertenece a otro proveedor' });
        }
        if (error?.message === 'OC_NO_ENCONTRADA') {
            return res.status(404).json({ error: 'Orden de compra no encontrada' });
        }
        if (error?.message === 'TENANT_NOT_FOUND') {
            return res.status(404).json({ error: 'Negocio no encontrado' });
        }
        if (error?.message?.startsWith('LOTE_REQUERIDO|')) {
            const productName = error.message.slice('LOTE_REQUERIDO|'.length);
            return res.status(400).json({ error: `Ingresá el lote y la fecha de vencimiento de ${productName}` });
        }
        if (error?.message?.startsWith('ITEM_FUERA_DE_OC|')) {
            const productName = error.message.slice('ITEM_FUERA_DE_OC|'.length);
            return res.status(400).json({ error: `${productName} no pertenece a la orden de compra vinculada` });
        }
        if (error?.message?.startsWith('ITEM_OC_INVALIDO|')) {
            const productName = error.message.slice('ITEM_OC_INVALIDO|'.length);
            return res.status(400).json({
                error: `La línea de orden indicada para ${productName} no pertenece a esta orden de compra`,
                code: 'PURCHASE_ORDER_ITEM_INVALID',
            });
        }
        if (error?.message?.startsWith('CANTIDAD_SUPERA_RECEPCION|')) {
            const [, productName, remainingQty] = error.message.split('|');
            return res.status(400).json({ error: `${productName} solo tiene ${remainingQty} unidades recibidas pendientes de facturar en esta OC` });
        }
        if (error?.message?.startsWith('OC_ESTADO:')) {
            const status = error.message.split(':')[1];
            return res.status(400).json({ error: status === 'APPROVED' ? 'Recibí la mercadería antes de facturar una orden de compra aprobada' : `No se puede facturar una orden de compra en estado ${status}` });
        }
        // Caja: sin turno abierto (409) o efectivo insuficiente en la gaveta (400).
        // El status sale del código tipado, no de un substring del mensaje.
        if (error instanceof SupplierPaymentError || error instanceof SupplierPaymentCajaError) {
            return res.status(error.httpStatus).json({ error: error.message, code: error.code });
        }
        const notFound = error?.message?.includes('no encontrado');
        res.status(notFound ? 404 : 500).json({ error: error.message || 'Error al procesar la compra' });
    }
}
