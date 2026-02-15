import React from 'react';
import { CartItem } from '../types';

interface ReceiptTicketProps {
    data: {
        tenantName: string;
        address?: string; // TBD
        phone?: string;   // TBD
        date: string;
        saleId?: string;
        customerName: string;
        items: CartItem[];
        subtotal: number;
        tax: number;
        total: number;
        paymentMethod: string;
        user: string; // Cashier
    } | null;
}

export const ReceiptTicket: React.FC<ReceiptTicketProps> = ({ data }) => {
    if (!data) return null;

    return (
        <div id="receipt-area" className="hidden print:block absolute top-0 left-0 w-full bg-white text-black font-mono text-[11px] leading-tight p-2">
            {/* 80mm Container */}
            <div className="max-w-[80mm] mx-auto">
                <div className="text-center mb-2">
                    <h1 className="font-bold text-sm uppercase">{data.tenantName}</h1>
                    <p className="text-[10px] text-gray-600">Sistema Nortex</p>
                    {data.phone && <p>{data.phone}</p>}
                </div>

                <div className="border-b border-black border-dashed my-1"></div>

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
                <div>
                    <span>Cliente:</span>
                    <span className="block font-bold truncate">{data.customerName}</span>
                </div>

                <div className="border-b border-black border-dashed my-1"></div>

                {/* ITEMS */}
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

                {/* TOTALS */}
                <div className="flex justify-between">
                    <span>Subtotal:</span>
                    <span>{data.subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                    <span>IVA (15%):</span>
                    <span>{data.tax.toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-bold text-sm mt-1">
                    <span>TOTAL:</span>
                    <span>C$ {data.total.toFixed(2)}</span>
                </div>

                <div className="border-b border-black border-dashed my-1"></div>

                <div className="text-center mt-2">
                    <p>Metodo de Pago: <span className="font-bold">{data.paymentMethod}</span></p>
                    <p className="mt-2 text-[10px]">¡Gracias por su compra!</p>
                    <p className="text-[9px] text-gray-500 mt-1">Nortex POS v2.0</p>
                </div>

                {/* Space for cutter */}
                <div className="h-4"></div>
            </div>
        </div>
    );
};
