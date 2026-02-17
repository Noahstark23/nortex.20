import React from 'react';

interface ShiftReportData {
    businessName: string;
    cashierName: string;
    startTime: string;
    endTime: string;
    initialCash: number;
    cashTotal: number;
    cardTotal: number;
    creditTotal: number;
    grandTotal: number;
    systemExpectedCash: number;
    finalCashDeclared: number;
    difference: number;
    totalSales: number;
}

interface ShiftReportTicketProps {
    data: ShiftReportData | null;
}

export const ShiftReportTicket: React.FC<ShiftReportTicketProps> = ({ data }) => {
    return (
        <div id="shift-report-area" className="fixed top-0 left-0 w-full bg-white text-black font-mono text-[11px] leading-tight p-2 opacity-0 h-0 overflow-hidden pointer-events-none print:opacity-100 print:h-auto print:overflow-visible print:pointer-events-auto print:z-[9999]">
            {!data ? null : <>
                <div className="max-w-[80mm] mx-auto">
                    {/* Header */}
                    <div className="text-center mb-2">
                        <h1 className="font-bold text-sm uppercase">{data.businessName}</h1>
                        <p className="text-[10px] text-gray-600">Sistema Nortex</p>
                        <div className="border-b-2 border-black border-double my-2"></div>
                        <p className="font-bold text-xs tracking-wider">═══ REPORTE Z ═══</p>
                        <p className="font-bold text-xs">CIERRE DE CAJA</p>
                        <div className="border-b-2 border-black border-double my-2"></div>
                    </div>

                    {/* Shift Info */}
                    <div className="mb-2">
                        <div className="flex justify-between">
                            <span>Cajero:</span>
                            <span className="font-bold">{data.cashierName}</span>
                        </div>
                        <div className="flex justify-between">
                            <span>Apertura:</span>
                            <span>{data.startTime}</span>
                        </div>
                        <div className="flex justify-between">
                            <span>Cierre:</span>
                            <span>{data.endTime}</span>
                        </div>
                        <div className="flex justify-between">
                            <span>Transacciones:</span>
                            <span className="font-bold">{data.totalSales}</span>
                        </div>
                    </div>

                    <div className="border-b border-black border-dashed my-1"></div>

                    {/* Sales Breakdown */}
                    <div className="mb-2">
                        <p className="font-bold text-center text-[10px] mb-1">DESGLOSE DE VENTAS</p>
                        <div className="flex justify-between">
                            <span>Fondo Inicial:</span>
                            <span>C$ {data.initialCash.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                            <span>Ventas Efectivo:</span>
                            <span>C$ {data.cashTotal.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                            <span>Ventas Tarjeta:</span>
                            <span>C$ {data.cardTotal.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                            <span>Ventas Crédito:</span>
                            <span>C$ {data.creditTotal.toFixed(2)}</span>
                        </div>
                        <div className="border-b border-black border-dashed my-1"></div>
                        <div className="flex justify-between font-bold">
                            <span>TOTAL VENTAS:</span>
                            <span>C$ {data.grandTotal.toFixed(2)}</span>
                        </div>
                    </div>

                    <div className="border-b border-black border-dashed my-1"></div>

                    {/* Cash Reconciliation */}
                    <div className="mb-2">
                        <p className="font-bold text-center text-[10px] mb-1">CUADRE DE CAJA</p>
                        <div className="flex justify-between">
                            <span>Efectivo Esperado:</span>
                            <span className="font-bold">C$ {data.systemExpectedCash.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                            <span>Efectivo Declarado:</span>
                            <span className="font-bold">C$ {data.finalCashDeclared.toFixed(2)}</span>
                        </div>

                        <div className="border-b-2 border-black my-1"></div>

                        <div className="flex justify-between text-sm font-bold mt-1">
                            <span>DIFERENCIA:</span>
                            <span className={data.difference < 0 ? 'text-black' : ''}>
                                {data.difference > 0 ? '+' : ''}C$ {data.difference.toFixed(2)}
                            </span>
                        </div>

                        {data.difference !== 0 && (
                            <div className="text-center mt-1 font-bold text-xs border border-black p-1">
                                {data.difference < 0
                                    ? `⚠ FALTANTE: C$ ${Math.abs(data.difference).toFixed(2)}`
                                    : `△ SOBRANTE: C$ ${data.difference.toFixed(2)}`
                                }
                            </div>
                        )}

                        {data.difference === 0 && (
                            <div className="text-center mt-1 font-bold text-xs border border-black p-1">
                                ✓ CAJA CUADRADA
                            </div>
                        )}
                    </div>

                    <div className="border-b border-black border-dashed my-1"></div>

                    {/* Footer */}
                    <div className="text-center mt-2">
                        <p className="text-[9px] text-gray-500">Documento generado por Nortex POS v2.0</p>
                        <p className="text-[9px] text-gray-500">Este reporte es parte del sistema de auditoría</p>
                        <p className="text-[9px] text-gray-400 mt-1">— Reporte Z inmutable —</p>
                    </div>

                    <div className="h-4"></div>
                </div>
            </>}
        </div>
    );
};

export type { ShiftReportData };
