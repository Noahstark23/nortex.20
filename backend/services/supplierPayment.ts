/**
 * NORTEX — Pago de factura a proveedor (cuenta por pagar) CONTRA LA CAJA.
 *
 * EL BUG QUE ESTE MÓDULO CIERRA
 * -----------------------------
 * `POST /api/purchases/:id/pay` debitaba `Tenant.walletBalance` — la billetera
 * FINTECH de Nortex (se fondea con `/api/loans/request` y se gasta en el
 * marketplace B2B). Ninguna ferretería la tiene fondeada, así que el pago
 * siempre moría con "SALDO_INSUFICIENTE: disponible C$ 0.00 … Recarga tu
 * billetera", aunque el modal prometía "se descontará de tu caja" y hubiera
 * plata real en la gaveta.
 *
 * Y el asiento contable lo confirmaba: `recordPurchase` acredita CxP (2.1.1)
 * al comprar a crédito, pero el pago no posteaba NADA — la CxP quedaba abierta
 * en el mayor para siempre. La billetera nunca fue la contrapartida correcta.
 *
 * QUÉ HACE AHORA (una sola transacción)
 * -------------------------------------
 *   1. Toma el row-lock del turno abierto (FOR UPDATE) y recalcula el efectivo
 *      con la fórmula ÚNICA (`calcularEfectivoTurno`) — cierra el TOCTOU de dos
 *      pagos/salidas concurrentes que sobregirarían la gaveta.
 *   2. Marca la factura COMPLETED con UPDATE condicional (idempotencia: dos
 *      doble-clicks → un solo débito).
 *   3. Expense + CashMovement OUT/PAGO_PROVEEDOR FIRMADO (libro encadenado).
 *   4. Asiento contable: Debe CxP (2.1.1) / Haber Caja (1.1.1).
 *   5. AuditLog con before/after de la gaveta y del estado de la factura.
 *
 * Si NO hay caja abierta el error lo DICE ("Abrí una caja…"), no manda a
 * recargar una billetera que no interviene.
 */

import Decimal from 'decimal.js';
import { calcularEfectivoTurno, MovimientoDeCaja } from '../../utils/margen';
import { appendSignedCashMovement } from './ledger';
import type { recordCashMovement } from './accounting';
import { ESTADO_ANULADA } from './saleCancellation';

/** Categoría del libro de caja para una salida que cancela una CxP. */
export const CATEGORIA_PAGO_PROVEEDOR = 'PAGO_PROVEEDOR';

/**
 * El mensaje del camino "no hay dónde sacar la plata". Es una constante para
 * que el handler y la evaluación pura digan LO MISMO: el bug reportado fue
 * justamente que este caso salía disfrazado de "recarga tu billetera".
 */
export const MENSAJE_SIN_CAJA_ABIERTA =
    'No hay caja abierta. Abrí una caja para registrar el pago al proveedor.';

export type CodigoPagoProveedor =
    | 'SIN_CAJA_ABIERTA'
    | 'EFECTIVO_INSUFICIENTE'
    | 'PAGO_NO_APLICABLE';

const HTTP_POR_CODIGO: Record<CodigoPagoProveedor, number> = {
    SIN_CAJA_ABIERTA: 409,
    EFECTIVO_INSUFICIENTE: 400,
    PAGO_NO_APLICABLE: 409,
};

/** Error tipado: el handler traduce `code` → status sin adivinar por substring. */
export class SupplierPaymentError extends Error {
    public readonly code: CodigoPagoProveedor;
    public readonly httpStatus: number;

    constructor(code: CodigoPagoProveedor, message: string) {
        super(message);
        this.name = 'SupplierPaymentError';
        this.code = code;
        this.httpStatus = HTTP_POR_CODIGO[code];
    }
}

/**
 * Forma PLANA a propósito (un solo objeto, no una unión discriminada): el
 * tsconfig del repo no corre en modo `strict`, así que el narrowing por
 * discriminante no aplica y los callers terminarían con `as any`.
 * `code`/`message` son null exactamente cuando `ok === true`.
 */
export interface VeredictoPago {
    ok: boolean;
    code: CodigoPagoProveedor | null;
    message: string | null;
}

/**
 * ¿Alcanza la gaveta para este pago? FUNCIÓN PURA (sin DB, sin turno abierto
 * implícito). `hayCajaAbierta === false` NO es "saldo insuficiente": es otro
 * problema y merece otro mensaje — ese fue justamente el bug reportado.
 *
 * Se paga con lo que hay: `disponible === monto` es válido (deja la gaveta en
 * cero, no es sobregiro).
 */
export function evaluarPagoContraCaja(input: {
    hayCajaAbierta: boolean;
    disponible: Decimal.Value;
    monto: Decimal.Value;
}): VeredictoPago {
    if (!input.hayCajaAbierta) {
        return { ok: false, code: 'SIN_CAJA_ABIERTA', message: MENSAJE_SIN_CAJA_ABIERTA };
    }

    const disponible = new Decimal(input.disponible);
    const monto = new Decimal(input.monto);

    if (monto.greaterThan(disponible)) {
        return {
            ok: false,
            code: 'EFECTIVO_INSUFICIENTE',
            message: `Efectivo insuficiente en caja: disponible C$ ${disponible.toFixed(2)}, requerido C$ ${monto.toFixed(2)}. Registrá una entrada de caja o pagá desde otra caja.`,
        };
    }

    return { ok: true, code: null, message: null };
}

/**
 * Efectivo en CÓRDOBAS del turno, con la MISMA fórmula del arqueo y de la
 * píldora del POS. Reexpuesta acá para que el pago no invente una tercera copia
 * (ya pasó: tres fórmulas daban tres números para la misma gaveta).
 *
 * El fondo inicial en dólares NO se recibe a propósito: solo alimenta
 * `efectivoUSD`, que acá se descarta — las facturas de proveedor se pagan en
 * C$, y sumar monedas distintas ya fue un bug real de arqueo. Los movimientos
 * en US$ sí viajan en la lista: `calcularEfectivoTurno` los deja fuera del
 * total en córdobas, y ese filtrado es justamente lo que hay que preservar.
 */
export function efectivoDisponibleDelTurno(turno: {
    initialCash: Decimal.Value;
    ventasEfectivo: Decimal.Value;
    movimientos: MovimientoDeCaja[];
}): Decimal {
    return calcularEfectivoTurno({
        initialCash: turno.initialCash,
        initialCashUsd: 0,
        cashSales: turno.ventasEfectivo,
        movimientos: turno.movimientos,
    }).efectivoNIO;
}

export interface DebitoDeGaveta {
    movimientoId: string;
    expenseId: string;
    efectivoAntes: Decimal;
    efectivoDespues: Decimal;
}

interface DebitoInput {
    tenantId: string;
    userId: string;
    shiftId: string;
    monto: Decimal;
    descripcion: string;
    /** Categoría del libro de caja (`CashMovement.category`). */
    categoriaCaja: string;
    /** Categoría del `Expense` (agrupador de los reportes de gastos). */
    categoriaGasto: string;
}

/**
 * NÚCLEO COMPARTIDO: saca efectivo de la gaveta del turno, bajo row-lock, con
 * su `Expense` y su `CashMovement` FIRMADO. NO postea asiento — cada caller
 * decide su contrapartida contable (pagar una CxP y comprar de contado NO son
 * el mismo asiento).
 *
 * Debe llamarse DENTRO de una transacción interactiva.
 */
async function debitarGaveta(
    tx: any,
    input: DebitoInput,
    deps: PagoProveedorDeps
): Promise<DebitoDeGaveta> {
    // 1. ROW-LOCK del turno. Se relee DENTRO de la tx: entre que el handler lo
    //    resolvió y acá, el turno pudo cerrarse (o no ser del tenant).
    await tx.$queryRaw`SELECT id FROM \`Shift\` WHERE id = ${input.shiftId} AND \`tenantId\` = ${input.tenantId} FOR UPDATE`;
    const turno = await tx.shift.findFirst({
        where: { id: input.shiftId, tenantId: input.tenantId, status: 'OPEN' },
        select: { id: true, initialCash: true },
    });
    if (!turno) {
        throw new SupplierPaymentError(
            'SIN_CAJA_ABIERTA',
            'La caja se cerró antes de aplicar el pago. Abrí una caja y volvé a intentar.'
        );
    }

    // 2. Efectivo real de la gaveta, releído bajo el lock (cierra el TOCTOU de
    //    dos salidas concurrentes que juntas la sobregirarían).
    const ventas: Array<{ total: unknown; storeCreditApplied: unknown }> = await tx.sale.findMany({
        where: { shiftId: turno.id, paymentMethod: 'CASH', status: { not: ESTADO_ANULADA } },
        select: { total: true, storeCreditApplied: true },
    });
    const movimientos: MovimientoDeCaja[] = await tx.cashMovement.findMany({
        where: { shiftId: turno.id, isVoided: false },
        select: { type: true, amount: true, currency: true, category: true },
    });
    const ventasEfectivo = ventas.reduce(
        (suma: Decimal, v) => suma.plus(
            new Decimal(String(v.total ?? 0)).minus(String(v.storeCreditApplied ?? 0)),
        ),
        new Decimal(0)
    );
    const efectivoAntes = efectivoDisponibleDelTurno({
        initialCash: String(turno.initialCash ?? 0),
        ventasEfectivo,
        movimientos,
    });

    const veredicto = evaluarPagoContraCaja({
        hayCajaAbierta: true,
        disponible: efectivoAntes,
        monto: input.monto,
    });
    if (!veredicto.ok) {
        throw new SupplierPaymentError(veredicto.code!, veredicto.message!);
    }

    const montoCaja = input.monto.toDecimalPlaces(2).toNumber();

    // 3. Gasto (registro del desembolso, agrupador de los reportes).
    const expense = await tx.expense.create({
        data: {
            tenantId: input.tenantId,
            amount: montoCaja,
            description: input.descripcion,
            category: input.categoriaGasto,
        },
    });

    // 4. Salida FIRMADA del libro de caja (cadena seq/prevHash del tenant).
    const movimiento = await deps.appendCashMovement(tx, {
        tenantId: input.tenantId,
        shiftId: turno.id,
        userId: input.userId,
        type: 'OUT',
        amount: montoCaja,
        currency: 'NIO',
        category: input.categoriaCaja,
        description: input.descripcion,
        expenseId: expense.id,
    });

    return {
        movimientoId: movimiento.id,
        expenseId: expense.id,
        efectivoAntes,
        efectivoDespues: efectivoAntes.minus(input.monto).toDecimalPlaces(2),
    };
}

export interface PagoProveedorInput {
    tenantId: string;
    userId: string;
    purchaseId: string;
    shiftId: string;
    invoiceNumber: string;
    supplierName: string;
    total: Decimal.Value;
}

export interface PagoProveedorResultado extends DebitoDeGaveta {}

/**
 * Dependencias inyectables: `recordCashMovement` resuelve cuentas con el
 * cliente Prisma global (auto-seed del catálogo), así que no se puede correr
 * contra un `tx` falso — se inyecta para que el test de regresión pueda
 * recorrer TODO el camino sin base de datos.
 */
export interface PagoProveedorDeps {
    appendCashMovement: typeof appendSignedCashMovement;
    recordCashMovement: typeof recordCashMovement;
}

const DEPS_REALES: PagoProveedorDeps = {
    appendCashMovement: appendSignedCashMovement,
    // IMPORT PEREZOSO a propósito: `accounting` importa el singleton de Prisma,
    // que instancia el PrismaClient al CARGARSE el módulo. Traerlo estático
    // obligaría a cualquier test de este archivo a levantar el engine de Prisma
    // (el sandbox de Stryker no tiene DATABASE_URL y el engine revienta ahí).
    // El pago real sí lo carga, una vez, dentro de su transacción.
    recordCashMovement: async (...args) => {
        const { recordCashMovement } = await import('./accounting');
        return recordCashMovement(...args);
    },
};

/**
 * PAGO DE UNA CUENTA POR PAGAR (factura de proveedor a crédito).
 *
 * Ejecuta el pago DENTRO de una transacción interactiva ya abierta por el
 * caller: salida de caja + factura COMPLETED + asiento (Debe CxP 2.1.1 / Haber
 * Caja 1.1.1) + auditoría. Lanza `SupplierPaymentError` (o `PeriodLockedError`
 * desde el asiento) y en cualquier caso la tx revierte: nunca queda factura
 * pagada sin salida de caja, ni salida de caja sin asiento.
 */
export async function pagarFacturaProveedorEnCaja(
    tx: any,
    input: PagoProveedorInput,
    deps: PagoProveedorDeps = DEPS_REALES
): Promise<PagoProveedorResultado> {
    const monto = new Decimal(input.total);
    const descripcion = `Pago Factura #${input.invoiceNumber} - ${input.supplierName}`;

    // Guard atómico de estado + idempotencia: solo transiciona si la factura
    // sigue PENDING_PAYMENT. Dos doble-clicks: uno marca COMPLETED
    // (count === 1), el otro aborta y NO vuelve a sacar plata de la gaveta.
    const marcada = await tx.purchase.updateMany({
        where: { id: input.purchaseId, tenantId: input.tenantId, status: 'PENDING_PAYMENT' },
        data: { status: 'COMPLETED' },
    });
    if (marcada.count === 0) {
        throw new SupplierPaymentError(
            'PAGO_NO_APLICABLE',
            'La compra ya fue pagada o no está pendiente de pago.'
        );
    }

    const debito = await debitarGaveta(tx, {
        tenantId: input.tenantId,
        userId: input.userId,
        shiftId: input.shiftId,
        monto,
        descripcion,
        categoriaCaja: CATEGORIA_PAGO_PROVEEDOR,
        categoriaGasto: CATEGORIA_PAGO_PROVEEDOR,
    }, deps);

    // Asiento: Debe CxP (2.1.1) / Haber Caja (1.1.1) — cancelar una cuenta por
    // pagar NO es un gasto nuevo (el gasto/inventario ya se reconoció al
    // comprar). Sin try/catch: período cerrado ⇒ el pago entero se revierte.
    await deps.recordCashMovement(
        tx,
        input.tenantId,
        input.userId,
        debito.movimientoId,
        'OUT',
        CATEGORIA_PAGO_PROVEEDOR,
        monto.toDecimalPlaces(2).toNumber(),
        `Factura #${input.invoiceNumber} - ${input.supplierName}`
    );

    // Auditoría inmutable (Capa 3) con before/after de gaveta y estado.
    await tx.auditLog.create({
        data: {
            tenantId: input.tenantId,
            userId: input.userId,
            action: 'PURCHASE_PAID',
            details: JSON.stringify({
                purchaseId: input.purchaseId,
                invoiceNumber: input.invoiceNumber,
                total: monto.toNumber(),
                statusBefore: 'PENDING_PAYMENT',
                statusAfter: 'COMPLETED',
                shiftId: input.shiftId,
                cashMovementId: debito.movimientoId,
                expenseId: debito.expenseId,
                efectivoAntes: debito.efectivoAntes.toNumber(),
                efectivoDespues: debito.efectivoDespues.toNumber(),
                timestamp: new Date().toISOString(),
            }),
        },
    });

    return debito;
}

/** Categoría del libro de caja para la salida de una compra de contado. */
export const CATEGORIA_COMPRA_CONTADO = 'COMPRA_CONTADO';

export interface SalidaPorCompraInput {
    tenantId: string;
    userId: string;
    shiftId: string;
    invoiceNumber: string;
    supplierName: string;
    total: Decimal.Value;
}

/**
 * COMPRA DE CONTADO: la mercadería entra y el efectivo sale de la gaveta.
 *
 * NO postea asiento propio a propósito: `recordPurchase` ya arma el asiento
 * completo de la compra (Debe Inventario 1.1.4 + IVA Crédito 1.1.5 / Haber
 * Caja 1.1.1). Postear además el asiento genérico de salida de caja
 * (Debe CxP 2.1.1 / Haber Caja 1.1.1) acreditaría Caja DOS VECES y abriría una
 * CxP que nunca existió. Por eso la categoría es `COMPRA_CONTADO` y no
 * `PAGO_PROVEEDOR`, que sí tiene asiento propio en `cashMovementJournalLines`.
 */
export async function registrarSalidaDeCajaPorCompra(
    tx: any,
    input: SalidaPorCompraInput,
    deps: PagoProveedorDeps = DEPS_REALES
): Promise<DebitoDeGaveta> {
    return debitarGaveta(tx, {
        tenantId: input.tenantId,
        userId: input.userId,
        shiftId: input.shiftId,
        monto: new Decimal(input.total),
        descripcion: `Compra Factura #${input.invoiceNumber} - ${input.supplierName}`,
        categoriaCaja: CATEGORIA_COMPRA_CONTADO,
        categoriaGasto: 'COMPRA_MERCADERIA',
    }, deps);
}
