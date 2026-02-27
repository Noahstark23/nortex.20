import React from 'react';
import { CartItem } from '../types';

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
        items: CartItem[];
        subtotal: number;
        tax: number;
        total: number;
        paymentMethod: string;
        user: string;
    } | null;
}

const pad = (n: number, len = 6) => String(n).padStart(len, '0');

export const ReceiptTicket: React.FC<ReceiptTicketProps> = ({ data }) => {
    return (
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
                                <th className="w-8">Cant</th>
                                <th>Desc</th>
                                <th className="text-right">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.items.map((item, i) => (
                                <tr key={i}>
                                    <td className="align-top py-0.5">{item.quantity}</td>
                                    <td className="align-top py-0.5">{item.name}</td>
                                    <td className="align-top text-right py-0.5">
                                        {(item.price * item.quantity).toFixed(2)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    <div className="border-b border-black border-dashed my-1"></div>

                    {/* ═══ TOTALES ═══ */}
                    <div className="flex justify-between">
                        <span>Subtotal:</span>
                        <span>C$ {data.subtotal.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>IVA (15%):</span>
                        <span>C$ {data.tax.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-sm mt-1">
                        <span>TOTAL:</span>
                        <span>C$ {data.total.toFixed(2)}</span>
                    </div>

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
};
