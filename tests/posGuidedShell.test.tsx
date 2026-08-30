// @vitest-environment jsdom

import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import POSGuidedShell, {
    type POSGuidedPaymentMethod,
    type POSGuidedReceiptFormat,
    type POSGuidedSaleSnapshot,
    type POSGuidedShellProps,
} from '../components/pos/POSGuidedShell';

afterEach(cleanup);

const completedSale: POSGuidedSaleSnapshot = {
    saleKey: 'sale-1',
    receiptNumber: 'FAC-00125',
    receiptFormat: 'TICKET_80MM',
    completedAtLabel: '27 ago 2026 · 10:34 a. m.',
    customerName: 'María López Ruiz',
    paymentMethodLabel: 'Efectivo',
    lineCountLabel: '1 producto',
    subtotal: '100',
    discount: '0',
    total: '100',
    cashReceived: '120',
    change: '20',
};

const makeProps = (overrides: Partial<POSGuidedShellProps> = {}): POSGuidedShellProps => ({
    header: {
        businessName: 'Pulpería Nortex',
        registerName: 'Caja 1',
        cashierName: 'José Martínez',
        shiftLabel: 'Mañana · 08:00–14:00',
        connection: 'ONLINE',
        dateTimeLabel: '27 ago 2026\n10:34 a. m.',
    },
    checkoutOpen: false,
    completedSale: null,
    searchTerm: '',
    onSearchTermChange: vi.fn(),
    onSearchSubmit: vi.fn(),
    onOpenScanner: vi.fn(),
    catalog: <div>Catálogo controlado</div>,
    selectedCustomer: {
        id: 'customer-1',
        name: 'María López Ruiz',
        documentLabel: 'Cédula 001-150776-0001A',
        fiscalLabel: 'Factura simplificada',
        badgeLabel: 'Régimen fijo',
    },
    customerOptions: [{ id: 'customer-1', label: 'María López Ruiz' }],
    onCustomerSelect: vi.fn(),
    cartLines: [{
        key: 'line-1',
        name: 'Arroz 1 lb',
        sku: 'SKU ARZ-1',
        quantityLabel: '1',
        unitPriceLabel: 'C$ 100.00',
        subtotalLabel: 'C$ 100.00',
        editable: true,
        tierLabel: 'Detalle',
    }],
    cartCountLabel: '1 producto',
    subtotal: '100',
    discount: '0',
    total: '100',
    onIncrementLine: vi.fn(),
    onDecrementLine: vi.fn(),
    onRemoveLine: vi.fn(),
    onEditLine: vi.fn(),
    onOpenCheckout: vi.fn(),
    onBackToProducts: vi.fn(),
    onParkSale: vi.fn(),
    paymentMethod: 'CASH',
    onPaymentMethodChange: vi.fn(),
    cashReceived: '',
    onCashReceivedChange: vi.fn(),
    receiptFormat: 'TICKET_80MM',
    onReceiptFormatChange: vi.fn(),
    onCheckout: vi.fn(),
    onCashIn: vi.fn(),
    onCashOut: vi.fn(),
    onBankingAgent: vi.fn(),
    onOpenParkedSales: vi.fn(),
    onCloseRegister: vi.fn(),
    onCancelSale: vi.fn(),
    onPrintTicket: vi.fn(),
    onPrintThermal: vi.fn(),
    onPrintA4: vi.fn(),
    onShareWhatsApp: vi.fn(),
    onNewSale: vi.fn(),
    ...overrides,
});

const ControlledCheckout = ({
    onCheckout = vi.fn(),
    paymentUnavailableReasons,
}: {
    onCheckout?: (method: POSGuidedPaymentMethod) => void;
    paymentUnavailableReasons?: POSGuidedShellProps['paymentUnavailableReasons'];
}) => {
    const [checkoutOpen, setCheckoutOpen] = useState(false);
    const [paymentMethod, setPaymentMethod] = useState<POSGuidedPaymentMethod>('CASH');
    const [cashReceived, setCashReceived] = useState('');
    const [receiptFormat, setReceiptFormat] = useState<POSGuidedReceiptFormat>('TICKET_80MM');

    return (
        <POSGuidedShell
            {...makeProps()}
            checkoutOpen={checkoutOpen}
            onOpenCheckout={() => setCheckoutOpen(true)}
            onBackToProducts={() => setCheckoutOpen(false)}
            paymentMethod={paymentMethod}
            onPaymentMethodChange={setPaymentMethod}
            paymentUnavailableReasons={paymentUnavailableReasons}
            cashReceived={cashReceived}
            onCashReceivedChange={setCashReceived}
            receiptFormat={receiptFormat}
            onReceiptFormatChange={setReceiptFormat}
            onCheckout={onCheckout}
        />
    );
};

describe('POSGuidedShell', () => {
    it('avanza de Productos a Cobro mediante estado controlado y permite volver', () => {
        render(<ControlledCheckout />);

        expect(screen.getByRole('heading', { name: 'Agregá productos' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /Ir a cobro/i }));

        expect(screen.getByRole('heading', { name: 'Método de cobro' })).toBeTruthy();
        expect(screen.getByText('Paso 2 de 3')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: /Editar venta/i }));
        expect(screen.getByRole('heading', { name: 'Agregá productos' })).toBeTruthy();
    });

    it('selecciona un método y confirma exactamente el método controlado', () => {
        const onCheckout = vi.fn();
        render(<ControlledCheckout onCheckout={onCheckout} />);
        fireEvent.click(screen.getByRole('button', { name: /Ir a cobro/i }));

        const transfer = screen.getByRole('button', { name: /Transferencia/i });
        fireEvent.click(transfer);
        expect(transfer.getAttribute('aria-pressed')).toBe('true');

        fireEvent.click(screen.getByRole('button', { name: 'Confirmar cobro' }));
        expect(onCheckout).toHaveBeenCalledTimes(1);
        expect(onCheckout).toHaveBeenCalledWith('TRANSFER');
    });

    it('explica efectivo insuficiente, monto exacto y cambio antes de confirmar', () => {
        const onCheckout = vi.fn();
        render(<ControlledCheckout onCheckout={onCheckout} />);
        fireEvent.click(screen.getByRole('button', { name: /Ir a cobro/i }));

        const received = screen.getByRole('textbox', { name: 'Recibido en efectivo' }) as HTMLInputElement;
        const confirm = screen.getByRole('button', { name: 'Confirmar cobro' }) as HTMLButtonElement;

        fireEvent.change(received, { target: { value: '50' } });
        expect(screen.getByText('Falta C$ 50.00')).toBeTruthy();
        expect(confirm.disabled).toBe(true);

        fireEvent.click(screen.getByRole('button', { name: 'Monto exacto' }));
        expect(received.value).toBe('100');
        expect(screen.getByText('No hay vuelto')).toBeTruthy();
        expect(confirm.disabled).toBe(false);

        fireEvent.change(received, { target: { value: '120' } });
        expect(screen.getByText('C$ 20.00')).toBeTruthy();
        fireEvent.keyDown(received, { key: 'Enter' });
        expect(onCheckout).toHaveBeenCalledWith('CASH');
    });

    it('mantiene Mixto visible y bloqueado con una explicación', () => {
        const onPaymentMethodChange = vi.fn();
        render(<POSGuidedShell {...makeProps({ checkoutOpen: true, onPaymentMethodChange })} />);

        const mixed = screen.getByRole('button', { name: /Mixto/i }) as HTMLButtonElement;
        expect(mixed.disabled).toBe(true);
        expect(screen.getByText(/todavía no registra pagos divididos/i)).toBeTruthy();
        fireEvent.click(mixed);
        expect(onPaymentMethodChange).not.toHaveBeenCalled();
    });

    it('usa el snapshot postventa para imprimir, compartir e iniciar otra venta', () => {
        const onPrintTicket = vi.fn();
        const onPrintThermal = vi.fn();
        const onPrintA4 = vi.fn();
        const onShareWhatsApp = vi.fn();
        const onNewSale = vi.fn();
        render(
            <POSGuidedShell
                {...makeProps({
                    completedSale,
                    onPrintTicket,
                    onPrintThermal,
                    onPrintA4,
                    onShareWhatsApp,
                    onNewSale,
                })}
            />,
        );

        expect(screen.getByRole('heading', { name: 'Comprobante listo' })).toBeTruthy();
        expect(screen.getByText('FAC-00125')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Imprimir ticket 80 mm' }));
        fireEvent.click(screen.getByRole('button', { name: 'Enviar a impresora térmica' }));
        fireEvent.click(screen.getByRole('button', { name: 'Imprimir factura A4' }));
        fireEvent.click(screen.getByRole('button', { name: 'Enviar por WhatsApp' }));
        fireEvent.click(screen.getByRole('button', { name: 'Iniciar nueva venta' }));

        expect(onPrintTicket).toHaveBeenCalledWith(completedSale);
        expect(onPrintThermal).toHaveBeenCalledWith(completedSale);
        expect(onPrintA4).toHaveBeenCalledWith(completedSale);
        expect(onShareWhatsApp).toHaveBeenCalledWith(completedSale);
        expect(onNewSale).toHaveBeenCalledTimes(1);
    });

    it('requiere una segunda acción explícita para cancelar la venta', () => {
        const onCancelSale = vi.fn();
        render(<POSGuidedShell {...makeProps({ onCancelSale })} />);

        fireEvent.click(screen.getByRole('button', { name: 'Cancelar venta' }));
        expect(onCancelSale).not.toHaveBeenCalled();
        expect(screen.getByRole('group', { name: 'Confirmar cancelación de venta' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Sí, cancelar venta' }));
        expect(onCancelSale).toHaveBeenCalledTimes(1);
    });

    it('expone landmarks, nombres y estado de progreso básicos', () => {
        render(<POSGuidedShell {...makeProps()} />);

        expect(screen.getByRole('main')).toBeTruthy();
        expect(screen.getByRole('navigation', { name: 'Progreso de la venta' })).toBeTruthy();
        expect(screen.getByRole('search')).toBeTruthy();
        expect(screen.getByRole('searchbox', { name: 'Buscar un producto' })).toBeTruthy();
        expect(screen.getByRole('combobox', { name: 'Cliente de la venta' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Abrir lector de código' })).toBeTruthy();
        expect(screen.getByText('En línea')).toBeTruthy();
        expect(screen.getByRole('list', { name: 'Productos en la venta' })).toBeTruthy();
    });
});
