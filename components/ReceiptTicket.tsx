import React from 'react';
import { createPortal } from 'react-dom';
import Decimal from 'decimal.js';
import { CartItem } from '../types';
import { formatQuantityValue } from '../utils/quantity';

export type ReceiptLineItem = Omit<CartItem, 'presentation'> & {
    unit?: string | null;
    saleMode?: 'COUNTED' | 'MEASURED' | string | null;
    presentation?: CartItem['presentation'] | string | null;
    presentationQuantity?: Decimal.Value | null;
    presentationUnit?: string | null;
};

interface ReceiptTicketProps {
    data: {
        tenantName: string;
        ruc?: string;         // Tenant.taxId (RUC)
        address?: string;     // Tenant.address
        phone?: string;       // Tenant.phone
        dgiAuthCode?: string; // Tenant.dgiAuthCode (AIMS-xxxx)
        date: string;
        saleId?: string;
        invoiceNumber?: number; // Consecutivo fiscal
        invoiceSeries?: string; // Serie (A, B, etc.)
        customerName: string;
        customerRuc?: string;   // Cédula/RUC del cliente
        items: ReceiptLineItem[];
        subtotal: number;
        discount?: number; // monto rebajado; el IVA va incluido en los precios
        tax: number;
        total: number;
        paymentMethod: string;
        // Efectivo recibido y vuelto (solo cobro en efectivo con vuelto). Van en
        // el ticket porque es el papel que el cliente usa para reclamar si el
        // cambio no cuadra — y el cajero para defenderse.
        cashReceived?: number;
        change?: number;
        user: string;
    } | null;
}

const pad = (n: number, len = 6) => String(n).padStart(len, '0');

const finiteDecimal = (value: Decimal.Value, field: string): Decimal => {
    let parsed: Decimal;
    try {
        parsed = new Decimal(value);
    } catch {
        throw new Error(`Valor decimal invalido en ${field}`);
    }
    if (!parsed.isFinite()) throw new Error(`Valor decimal invalido en ${field}`);
    return parsed;
};

const money = (value: Decimal.Value, field: string): string =>
    finiteDecimal(value, field).toDecimalPlaces(2).toFixed(2);

const receiptLine = (item: ReceiptLineItem, index: number) => {
    const baseQuantity = finiteDecimal(item.quantity, `items[${index}].quantity`);
    const baseUnitPrice = finiteDecimal(item.price, `items[${index}].price`);
    const total = baseUnitPrice.times(baseQuantity);
    const presentationObject = item.presentation && typeof item.presentation === 'object'
        ? item.presentation
        : null;
    const presentationCode = typeof item.presentation === 'string'
        ? item.presentation.trim()
        : '';
    const isPack = presentationCode.toUpperCase() === 'PACK';
    const namedPresentation = presentationCode !== ''
        && presentationCode.toUpperCase() !== 'BASE'
        && !isPack;
    const hasPresentation = Boolean(
        presentationObject
        || isPack
        || item.presentationQuantity !== undefined && item.presentationQuantity !== null,
    );
    const visibleQuantity = presentationObject
        ? finiteDecimal(presentationObject.quantity, `items[${index}].presentation.quantity`)
        : item.presentationQuantity !== undefined && item.presentationQuantity !== null
            ? finiteDecimal(item.presentationQuantity, `items[${index}].presentationQuantity`)
            : baseQuantity;
    if (!visibleQuantity.greaterThan(0)) throw new Error(`Cantidad visible invalida en items[${index}]`);

    const unit = String(
        presentationObject?.unit
        || item.presentationUnit
        || isPack && item.packUnit
        || namedPresentation && presentationCode
        || item.unit
        || '',
    ).trim();
    const quantity = formatQuantityValue(visibleQuantity);
    const visibleUnitPrice = hasPresentation ? total.dividedBy(visibleQuantity) : baseUnitPrice;
    const quantityLabel = unit ? `${quantity} ${unit}` : `${quantity} x`;
    const equation = unit
        ? `${quantityLabel} × C$ ${money(visibleUnitPrice, `items[${index}].unitPrice`)}/${unit}`
        : `${quantityLabel} C$ ${money(visibleUnitPrice, `items[${index}].unitPrice`)}`;

    return { equation, total: money(total, `items[${index}].total`) };
};

export const ReceiptTicket: React.FC<ReceiptTicketProps> = ({ data }) => {
    const receipt = (
        <div id="receipt-area" className="fixed top-0 left-0 w-full bg-white text-black font-mono text-[11px] leading-tight p-2 opacity-0 h-0 overflow-hidden pointer-events-none print:opacity-100 print:h-auto print:overflow-visible print:pointer-events-auto print:z-[9999]">
            {!data ? null : <>
                {/* 80mm Container */}
                <div className="max-w-[80mm] mx-auto">
                    {/* ═══ HEADER FISCAL ═══ */}
                    <div className="text-center mb-1">
                        <div className="border-t-2 border-black mb-1"></div>
                        <h1 className="font-bold text-sm uppercase">{data.tenantName}</h1>
                        {data.ruc && <p className="text-[10px]">RUC: {data.ruc}</p>}
                        {data.address && <p className="text-[10px] text-gray-600">{data.address}</p>}
                        {data.phone && <p className="text-[10px]">Tel: {data.phone}</p>}
                        {data.dgiAuthCode && <p className="text-[9px] text-gray-500">Aut. DGI: {data.dgiAuthCode}</p>}
                        <div className="border-t-2 border-black mt-1"></div>
                    </div>

                    {/* ═══ NÚMERO DE FACTURA ═══ */}
                    {data.invoiceNumber && (
                        <div className="text-center font-bold text-xs bg-gray-100 py-1 my-1 border border-gray-300">
                            FACTURA {data.invoiceSeries ? `Serie ${data.invoiceSeries} ` : ''}No. {pad(data.invoiceNumber)}
                        </div>
                    )}

                    <div className="border-b border-black border-dashed my-1"></div>

                    {/* ═══ INFO TRANSACCIÓN ═══ */}
                    <div className="flex justify-between">
                        <span>Fecha:</span>
                        <span>{data.date}</span>
                    </div>
                    {data.saleId && (
                        <div className="flex justify-between">
                            <span>Ticket #:</span>
                            <span>{data.saleId.slice(-6)}</span>
                        </div>
                    )}
                    <div className="flex justify-between">
                        <span>Cajero:</span>
                        <span>{data.user}</span>
                    </div>

                    <div className="border-b border-black border-dashed my-1"></div>

                    {/* ═══ DATOS CLIENTE ═══ */}
                    <div>
                        <span>Cliente:</span>
                        <span className="block font-bold truncate">{data.customerName}</span>
                    </div>
                    {data.customerRuc && (
                        <div className="flex justify-between text-[10px]">
                            <span>RUC/Cédula:</span>
                            <span>{data.customerRuc}</span>
                        </div>
                    )}

                    <div className="border-b border-black border-dashed my-1"></div>

                    {/* ═══ ITEMS ═══ */}
                    <table className="w-full text-left">
                        <thead>
                            <tr className="uppercase text-[9px]">
                                <th colSpan={2}>Artículo / cantidad / P. unit.</th>
                                <th className="text-right">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.items.map((item, i) => {
                                const line = receiptLine(item, i);
                                return (
                                    <React.Fragment key={item.cartLineId || `${item.id}-${i}`}>
                                        <tr>
                                            <td colSpan={3} className="align-top pt-1 font-bold">{item.name}</td>
                                        </tr>
                                        <tr>
                                            <td colSpan={2} className="align-top pb-1 text-[10px]">{line.equation}</td>
                                            <td className="align-top text-right pb-1 whitespace-nowrap">C$ {line.total}</td>
                                        </tr>
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>

                    <div className="border-b border-black border-dashed my-1"></div>

                    {/* ═══ TOTALES ═══
                        R2.9 · NX-12 — antes se imprimía "Subtotal" con el mismo
                        número que "TOTAL" y el IVA suelto en medio: sin descuento
                        el ticket mostraba dos veces la misma cifra y no había
                        forma de verificar el IVA a ojo. Ahora se imprime el
                        desglose fiscal real: base imponible + IVA = total. */}
                    {(data.discount ?? 0) > 0 && (
                        <>
                            <div className="flex justify-between">
                                <span>Subtotal:</span>
                                <span>C$ {money(data.subtotal, 'subtotal')}</span>
                            </div>
                            <div className="flex justify-between">
                                <span>Descuento:</span>
                                <span>-C$ {money(data.discount ?? 0, 'discount')}</span>
                            </div>
                        </>
                    )}
                    <div className="flex justify-between">
                        <span>Base imponible:</span>
                        <span>C$ {money(new Decimal(data.total).minus(data.tax), 'taxBase')}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>IVA (15%):</span>
                        <span>C$ {money(data.tax, 'tax')}</span>
                    </div>
                    <div className="flex justify-between font-bold text-sm mt-1">
                        <span>TOTAL:</span>
                        <span>C$ {money(data.total, 'total')}</span>
                    </div>

                    {/* ═══ EFECTIVO Y VUELTO ═══ */}
                    {typeof data.cashReceived === 'number' && data.cashReceived > 0 && (
                        <>
                            <div className="flex justify-between">
                                <span>Efectivo recibido:</span>
                                <span>C$ {money(data.cashReceived, 'cashReceived')}</span>
                            </div>
                            <div className="flex justify-between font-bold">
                                <span>Vuelto:</span>
                                <span>C$ {money(data.change ?? 0, 'change')}</span>
                            </div>
                        </>
                    )}

                    <div className="border-b border-black border-dashed my-1"></div>

                    {/* ═══ PIE FISCAL ═══ */}
                    <div className="text-center mt-2">
                        <p>Método de Pago: <span className="font-bold">{data.paymentMethod}</span></p>
                        <p className="mt-2 text-[10px]">¡Gracias por su compra!</p>
                        <div className="border-t border-dashed border-gray-400 mt-2 pt-1">
                            <p className="text-[8px] text-gray-500">
                                {data.dgiAuthCode
                                    ? 'Este documento es válido como factura según Resolución DGI Nicaragua.'
                                    : 'Nortex POS v2.0 — Sistema de Facturación Computarizada'}
                            </p>
                            <p className="text-[8px] text-gray-400 mt-0.5">Generado por Nortex POS</p>
                        </div>
                    </div>

                    {/* Space for cutter */}
                    <div className="h-4"></div>
                </div>
            </>}
        </div>
    );

    // Fuera de #root: al imprimir, los contenedores del dashboard quedan con
    // altura 0/overflow hidden. Como hijo directo de body el ticket no puede
    // quedar recortado por ninguno de esos ancestros.
    return typeof document === 'undefined' ? receipt : createPortal(receipt, document.body);
};
