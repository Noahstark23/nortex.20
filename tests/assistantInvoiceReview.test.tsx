// @vitest-environment jsdom

import React from 'react';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantInvoiceReview, useAssistantInvoiceReviewState } from '../components/assistant/AssistantInvoiceReview';
import { draftIssues, invoiceDraftSchema } from '../backend/services/assistant/proposalValidation';
import type { AssistantRequest } from '../hooks/useNortexAssistant';
import type { AssistantCapabilities, AssistantProposalDTO, InvoiceDraft } from '../shared/assistant';

const confirmationKey = '3b1d0c01-83ae-4b16-8096-f5c3a0250e2f';
const capabilities: AssistantCapabilities = {
    enabled: true, help: true, overview: true, inventory: true,
    invoiceRead: true, invoicePrepare: true, invoiceConfirm: true, purchasePrepare: true,
    extractionEnabled: true, executionEnabled: true,
};

function readyProposal(): AssistantProposalDTO {
    return {
        id: 'proposal-1', version: 1, status: 'READY', issues: [],
        attachmentIds: ['attachment-1'], expiresAt: '2026-09-12T23:00:00.000Z',
        draft: {
            currency: 'NIO', supplierId: 'supplier-1', supplierName: 'Proveedor de prueba',
            invoiceNumber: 'FAC-101', date: '2026-09-05', postingDate: '2026-09-05', dueDate: '2026-10-05',
            warehouseId: 'warehouse-1', paymentMethod: 'CREDIT', receivedConfirmed: true, paymentConfirmed: false,
            documentSubtotal: '100.00', documentTax: '15.00', documentTotal: '115.00',
            discount: '0', freight: '0', otherCharges: '0', notes: 'Factura sintética', warnings: [],
            items: [{ productId: 'product-1', description: 'Alcohol 70%', quantity: '2', unitCost: '50.00', purchaseUnit: 'BASE', batchNumber: 'L-101', expiryDate: '2027-09-05' }],
        },
        preview: {
            supplierName: 'Proveedor de prueba', warehouseName: 'Principal', subtotal: '100.00', tax: '15.00', total: '115.00',
            stockEffect: 'INCREASE', cashOut: '0', payable: '115.00', hash: 'server-preview-v1',
            lines: [{ productId: 'product-1', name: 'Alcohol 70%', quantity: '2', purchaseUnit: 'BASE', baseQuantity: '2', unitCost: '50.00', lineTotal: '100.00', batchNumber: 'L-101', expiryDate: '2027-09-05' }],
        },
    };
}

function propsFor(proposal = readyProposal()) {
    return {
        proposal, capabilities: { ...capabilities }, busy: false, operation: null,
        request: vi.fn(async () => ({ items: [] })) as AssistantRequest,
        onSave: vi.fn(async (_draft: InvoiceDraft) => {}),
        onConfirm: vi.fn(async (_key: string) => {}),
        onOpenPurchases: vi.fn(),
    };
}

const reviewCheckbox = () => screen.getByRole('checkbox', { name: 'Revisé el documento, los productos y estos efectos exactos.' });
const saveButton = () => screen.getByRole('button', { name: 'Guardar revisión y calcular efectos' });

// El panel permanece montado mientras FluidSheet o una pestaña ocultan su contenido.
function PersistentReview({ visible, ...props }: React.ComponentProps<typeof AssistantInvoiceReview> & { visible: boolean }) {
    const editor = useAssistantInvoiceReviewState(props.proposal);
    return visible ? <AssistantInvoiceReview {...props} editor={editor} /> : null;
}

describe('revisión y confirmación de facturas de NortexGPT', () => {
    beforeEach(() => {
        vi.stubGlobal('crypto', { randomUUID: vi.fn(() => confirmationKey) });
        vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('exige revisar efectos exactos y confirma únicamente con la referencia UUID', async () => {
        const user = userEvent.setup();
        const props = propsFor();
        render(<AssistantInvoiceReview {...props} />);

        const confirm = screen.getByRole('button', { name: 'Confirmar y registrar compra por C$ 115.00' });
        expect(reviewCheckbox()).not.toBeChecked();
        expect(confirm).toBeDisabled();
        await user.click(confirm);
        expect(props.onConfirm).not.toHaveBeenCalled();
        await user.click(reviewCheckbox());
        expect(confirm).toBeEnabled();
        await user.click(confirm);

        expect(props.onConfirm.mock.calls).toEqual([[confirmationKey]]);
        expect(props.onSave).not.toHaveBeenCalled();
    });

    it('oculta efectos antiguos al editar y espera una nueva versión del servidor para confirmar', async () => {
        const user = userEvent.setup();
        const props = propsFor();
        const { rerender } = render(<AssistantInvoiceReview {...props} />);
        await user.click(reviewCheckbox());
        await user.clear(screen.getByRole('textbox', { name: 'Costo 1' }));
        await user.type(screen.getByRole('textbox', { name: 'Costo 1' }), '55.25');

        expect(screen.queryByRole('region', { name: 'Efectos de la compra' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Confirmar y registrar compra/ })).not.toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('Guardá la revisión para recalcular sus efectos.');
        await user.click(saveButton());
        expect(props.onSave).toHaveBeenCalledTimes(1);
        expect(props.onSave.mock.calls[0][0].items[0].unitCost).toBe('55.25');
        expect(props.proposal.draft.items[0].unitCost).toBe('50.00');
        expect(screen.queryByRole('region', { name: 'Efectos de la compra' })).not.toBeInTheDocument();
        expect(props.onConfirm).not.toHaveBeenCalled();

        const updated: AssistantProposalDTO = {
            ...props.proposal, version: 2, draft: props.onSave.mock.calls[0][0],
            preview: { ...props.proposal.preview!, subtotal: '110.50', tax: '16.58', total: '127.08', payable: '127.08', hash: 'server-preview-v2' },
        };
        rerender(<AssistantInvoiceReview {...props} proposal={updated} />);
        expect(screen.getByRole('region', { name: 'Efectos de la compra' })).toBeInTheDocument();
        expect(reviewCheckbox()).not.toBeChecked();
        expect(screen.getByRole('button', { name: 'Confirmar y registrar compra por C$ 127.08' })).toBeDisabled();
        expect(saveButton()).toBeDisabled();
    });

    it('conserva la referencia y bloquea el borrador tras una confirmación sin resultado concluyente', async () => {
        const user = userEvent.setup();
        const props = propsFor();
        let finishAttempt!: () => void;
        // El hook captura el timeout y resuelve el callback, conservando operation=null.
        props.onConfirm.mockImplementationOnce(() => new Promise<void>(resolve => { finishAttempt = resolve; }));
        const { rerender } = render(<AssistantInvoiceReview {...props} />);
        await user.click(reviewCheckbox());
        await user.click(screen.getByRole('button', { name: /Confirmar y registrar compra/ }));
        expect(props.onConfirm.mock.calls).toEqual([[confirmationKey]]);
        rerender(<AssistantInvoiceReview {...props} busy />);

        expect(screen.getByRole('button', { name: 'Comprobando registro…' })).toBeDisabled();
        expect(screen.getByRole('textbox', { name: 'Número de factura' })).toBeDisabled();
        expect(screen.getByRole('textbox', { name: 'Cantidad 1' })).toBeDisabled();
        expect(screen.getByRole('combobox', { name: 'Pago' })).toBeDisabled();
        expect(reviewCheckbox()).toBeDisabled();
        await act(async () => { finishAttempt(); });
        rerender(<AssistantInvoiceReview {...props} busy={false} />);

        expect(screen.getByRole('status')).toHaveTextContent(confirmationKey);
        expect(screen.getByRole('textbox', { name: 'Número de factura' })).toBeDisabled();
        expect(screen.queryByRole('button', { name: /Guardar revisión/ })).not.toBeInTheDocument();
        await user.type(screen.getByRole('textbox', { name: 'Cantidad 1' }), '9');
        expect(screen.getByRole('textbox', { name: 'Cantidad 1' })).toHaveValue('2');
        await user.click(screen.getByRole('button', { name: 'Reintentar confirmación con la misma referencia' }));
        expect(props.onConfirm.mock.calls).toEqual([[confirmationKey], [confirmationKey]]);
    });

    it('conserva correcciones pendientes cuando se desmonta la revisión al cambiar pestaña o cerrar', async () => {
        const user = userEvent.setup();
        const props = propsFor();
        const { rerender } = render(<PersistentReview {...props} visible />);
        await user.clear(screen.getByRole('textbox', { name: 'Costo 1' }));
        await user.type(screen.getByRole('textbox', { name: 'Costo 1' }), '55.25');
        rerender(<PersistentReview {...props} visible={false} />);
        expect(screen.queryByRole('region', { name: 'Revisar factura' })).not.toBeInTheDocument();
        rerender(<PersistentReview {...props} visible />);

        expect(screen.getByRole('textbox', { name: 'Costo 1' })).toHaveValue('55.25');
        expect(screen.getByRole('status')).toHaveTextContent('Guardá la revisión para recalcular sus efectos.');
        expect(screen.queryByRole('region', { name: 'Efectos de la compra' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Confirmar y registrar compra/ })).not.toBeInTheDocument();
        await user.click(saveButton());
        expect(props.onSave.mock.calls[0][0].items[0].unitCost).toBe('55.25');
        expect(props.proposal.draft.items[0].unitCost).toBe('50.00');
    });

    it('retoma el intento incierto con la misma referencia y el borrador bloqueado tras desmontar', async () => {
        const user = userEvent.setup();
        const props = propsFor();
        // Si el editor se regenerara al reabrir, recibiría una referencia diferente.
        vi.mocked(crypto.randomUUID).mockReturnValueOnce(confirmationKey)
            .mockReturnValue('ef79c872-4f89-49ee-a834-7f672eae9801');
        const { rerender } = render(<PersistentReview {...props} visible />);
        await user.click(reviewCheckbox());
        await user.click(screen.getByRole('button', { name: /Confirmar y registrar compra/ }));
        expect(props.onConfirm.mock.calls).toEqual([[confirmationKey]]);
        rerender(<PersistentReview {...props} visible={false} />);
        rerender(<PersistentReview {...props} visible />);

        expect(screen.getByRole('status')).toHaveTextContent(confirmationKey);
        expect(screen.getByRole('textbox', { name: 'Número de factura' })).toBeDisabled();
        expect(screen.getByRole('textbox', { name: 'Cantidad 1' })).toBeDisabled();
        expect(reviewCheckbox()).toBeChecked();
        expect(reviewCheckbox()).toBeDisabled();
        expect(screen.queryByRole('button', { name: /Guardar revisión/ })).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Reintentar confirmación con la misma referencia' }));
        expect(props.onConfirm.mock.calls).toEqual([[confirmationKey], [confirmationKey]]);
    });

    it('muestra el comprobante consultable cuando existe evidencia de registro', async () => {
        const user = userEvent.setup();
        const props = propsFor();
        render(<AssistantInvoiceReview {...props} operation={{ id: 'operation-1', proposalId: 'proposal-1', purchaseId: 'purchase-1', message: 'La compra quedó registrada.', replayed: true }} />);

        const receipt = screen.getByRole('region', { name: 'Comprobante de compra' });
        expect(within(receipt).getByRole('heading', { name: 'Compra registrada' })).toBeInTheDocument();
        expect(within(receipt).getByText('purchase-1')).toBeInTheDocument();
        expect(within(receipt).getByText('operation-1')).toBeInTheDocument();
        expect(screen.queryByRole('region', { name: 'Revisar factura' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Confirmar y registrar compra/ })).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Consultar en Compras' }));
        expect(props.onOpenPurchases).toHaveBeenCalledTimes(1);
        expect(props.onConfirm).not.toHaveBeenCalled();
    });

    it.each([
        { label: 'rol sin permiso', patch: { invoiceConfirm: false }, message: 'Tu rol permite revisar, pero no registrar compras.' },
        { label: 'ejecución desactivada', patch: { executionEnabled: false }, message: 'El registro desde NortexGPT está desactivado.' },
    ])('no ofrece confirmación con $label', ({ patch, message }) => {
        const props = propsFor();
        render(<AssistantInvoiceReview {...props} capabilities={{ ...capabilities, ...patch }} />);
        expect(screen.queryByRole('button', { name: /Confirmar y registrar compra/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('checkbox', { name: /Revisé el documento/ })).not.toBeInTheDocument();
        expect(screen.getByText(message)).toBeInTheDocument();
        expect(props.onConfirm).not.toHaveBeenCalled();
    });

    it('mantiene visible el motivo bloqueante y no permite registrar una propuesta con problemas', () => {
        const proposal = readyProposal();
        proposal.issues = ['La moneda USD requiere revisión en Compras.'];
        render(<AssistantInvoiceReview {...propsFor(proposal)} />);
        expect(screen.getByRole('alert')).toHaveTextContent('La moneda USD requiere revisión en Compras.');
        expect(screen.queryByRole('button', { name: /Confirmar y registrar compra/ })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Revisar en Compras' })).toBeEnabled();
    });

    it('expone moneda, importes, cargos y fechas para comprobar el documento original', async () => {
        const user = userEvent.setup();
        const props = propsFor();
        render(<AssistantInvoiceReview {...props} />);

        const fields = [
            ['Moneda', 'NIO'], ['Subtotal del documento', '100.00'], ['IVA del documento', '15.00'],
            ['Total del documento', '115.00'], ['Descuento del documento', '0'], ['Flete del documento', '0'],
            ['Otros cargos', '0'], ['Fecha de factura', '2026-09-05'], ['Fecha contable', '2026-09-05'],
            ['Vencimiento del crédito', '2026-10-05'], ['Vencimiento del lote 1', '2027-09-05'],
        ];
        for (const [label, value] of fields) expect(screen.getByLabelText(label)).toHaveValue(value);
        await user.clear(screen.getByLabelText('Flete del documento'));
        await user.type(screen.getByLabelText('Flete del documento'), '12.50');
        await user.click(saveButton());
        expect(props.onSave.mock.calls[0][0].freight).toBe('12.50');
        expect(props.onConfirm).not.toHaveBeenCalled();
        await waitFor(() => expect(props.request).toHaveBeenCalledWith('/catalog?kind=suppliers&query='));
    });

    it('exige volver a confirmar el pago al cambiar de crédito a efectivo', async () => {
        const user = userEvent.setup();
        const props = propsFor();
        render(<AssistantInvoiceReview {...props} />);
        expect(screen.queryByRole('checkbox', { name: 'Confirmo que quedará pendiente de pago al proveedor.' })).not.toBeInTheDocument();
        await user.selectOptions(screen.getByRole('combobox', { name: 'Pago' }), 'CASH');
        const cashConfirmation = screen.getByRole('checkbox', { name: 'Confirmo que el pago en efectivo corresponde a esta caja.' });
        expect(cashConfirmation).not.toBeChecked();
        expect(screen.queryByRole('button', { name: /Confirmar y registrar compra/ })).not.toBeInTheDocument();
        await user.click(saveButton());
        expect(props.onSave.mock.calls[0][0]).toMatchObject({ paymentMethod: 'CASH', paymentConfirmed: false });
        expect(draftIssues(props.onSave.mock.calls[0][0])).toContain('Confirmá el pago de contado: se descontará de la caja abierta.');
        await user.click(cashConfirmation);
        await user.click(saveButton());
        expect(props.onSave.mock.calls[1][0]).toMatchObject({ paymentMethod: 'CASH', paymentConfirmed: true });
        expect(draftIssues(props.onSave.mock.calls[1][0])).toEqual([]);
    });

    it('corrige una compra a crédito marcada como pagada antes de guardar su revisión', async () => {
        const user = userEvent.setup();
        const proposal = readyProposal();
        proposal.status = 'DRAFT';
        proposal.preview = null;
        proposal.draft.paymentConfirmed = true;
        proposal.issues = draftIssues(proposal.draft);
        const props = propsFor(proposal);
        render(<AssistantInvoiceReview {...props} />);

        expect(screen.getByRole('alert')).toHaveTextContent('Una compra a crédito no puede marcarse como ya pagada.');
        expect(screen.queryByRole('checkbox', { name: 'Confirmo que quedará pendiente de pago al proveedor.' })).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Marcar como pendiente de pago' }));
        expect(screen.queryByRole('button', { name: 'Marcar como pendiente de pago' })).not.toBeInTheDocument();
        await user.click(saveButton());
        expect(props.onSave.mock.calls[0][0]).toMatchObject({ paymentMethod: 'CREDIT', paymentConfirmed: false });
        expect(draftIssues(invoiceDraftSchema.parse(props.onSave.mock.calls[0][0]))).toEqual([]);
        expect(proposal.draft.paymentConfirmed).toBe(true);
        expect(props.onConfirm).not.toHaveBeenCalled();
    });

    it('completar las confirmaciones de una compra a crédito produce un borrador aceptado por el dominio', async () => {
        const user = userEvent.setup();
        const proposal = readyProposal();
        proposal.status = 'DRAFT';
        proposal.preview = null;
        proposal.draft.receivedConfirmed = false;
        proposal.issues = draftIssues(proposal.draft);
        const props = propsFor(proposal);
        render(<AssistantInvoiceReview {...props} />);

        // La persona completa las confirmaciones que solicita la pantalla.
        for (const checkbox of screen.getAllByRole('checkbox', { name: /^Confirmo que/ })) await user.click(checkbox);
        await user.click(saveButton());
        expect(props.onSave).toHaveBeenCalledTimes(1);
        const saved = invoiceDraftSchema.parse(props.onSave.mock.calls[0][0]);
        expect(draftIssues(saved)).toEqual([]);
        expect(saved).toMatchObject({ receivedConfirmed: true, paymentMethod: 'CREDIT', paymentConfirmed: false });
    });

    it('elimina la confirmación de efectivo al cambiar una compra a crédito', async () => {
        const user = userEvent.setup();
        const proposal = readyProposal();
        proposal.draft.paymentMethod = 'CASH';
        proposal.draft.paymentConfirmed = true;
        const props = propsFor(proposal);
        render(<AssistantInvoiceReview {...props} />);
        expect(screen.getByRole('checkbox', { name: 'Confirmo que el pago en efectivo corresponde a esta caja.' })).toBeChecked();
        await user.selectOptions(screen.getByRole('combobox', { name: 'Pago' }), 'CREDIT');
        expect(screen.queryByRole('checkbox', { name: /Confirmo que el pago|Confirmo que quedará pendiente/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Marcar como pendiente de pago' })).not.toBeInTheDocument();
        await user.click(saveButton());
        expect(props.onSave.mock.calls[0][0]).toMatchObject({ paymentMethod: 'CREDIT', paymentConfirmed: false });
        expect(draftIssues(props.onSave.mock.calls[0][0])).toEqual([]);
    });

    it('identifica la caja exacta que registra el egreso antes de confirmar una compra en efectivo', async () => {
        const user = userEvent.setup();
        const proposal = readyProposal();
        proposal.draft.paymentMethod = 'CASH';
        proposal.draft.paymentConfirmed = true;
        proposal.preview = { ...proposal.preview!, cashOut: '115.00', payable: '0', cashShiftId: 'shift-A', cashShiftLabel: 'Ana QA · abierta 05/09' };
        const props = propsFor(proposal);
        render(<AssistantInvoiceReview {...props} />);

        const effects = screen.getByRole('region', { name: 'Efectos de la compra' });
        expect(effects).toHaveTextContent('Caja que registra el egreso:');
        expect(effects).toHaveTextContent('Ana QA · abierta 05/09');
        expect(within(effects).getByText('shift-A')).toBeInTheDocument();
        const confirm = screen.getByRole('button', { name: 'Confirmar y registrar compra por C$ 115.00' });
        expect(confirm).toBeDisabled();
        await user.click(reviewCheckbox());
        await user.click(confirm);
        expect(props.onConfirm.mock.calls).toEqual([[confirmationKey]]);
    });

    it.each(['cashShiftId', 'cashShiftLabel'] as const)('bloquea un egreso sin %s aunque la propuesta figure lista', missingField => {
        const proposal = readyProposal();
        proposal.draft.paymentMethod = 'CASH';
        proposal.draft.paymentConfirmed = true;
        proposal.preview = { ...proposal.preview!, cashOut: '115.00', payable: '0', cashShiftId: 'shift-A', cashShiftLabel: 'Ana QA · abierta 05/09' };
        delete proposal.preview[missingField];
        const props = propsFor(proposal);
        render(<AssistantInvoiceReview {...props} />);

        expect(screen.getByRole('region', { name: 'Efectos de la compra' })).toHaveTextContent('Salida de caja');
        expect(screen.queryByRole('button', { name: /Confirmar y registrar compra/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('checkbox', { name: /Revisé el documento/ })).not.toBeInTheDocument();
        expect(props.onConfirm).not.toHaveBeenCalled();
    });

    it('conserva advertencias hasta revisarlas explícitamente y guardar la nueva revisión', async () => {
        const user = userEvent.setup();
        const proposal = readyProposal();
        proposal.status = 'DRAFT';
        proposal.preview = null;
        proposal.draft.warnings = ['La fotografía no permite comprobar el lote.'];
        proposal.issues = ['Revisá los datos señalados antes de registrar.'];
        const props = propsFor(proposal);
        const { rerender } = render(<AssistantInvoiceReview {...props} />);
        const warningReview = screen.getByRole('checkbox', { name: 'Revisé y corregí los datos señalados' });
        expect(warningReview).not.toBeChecked();
        expect(saveButton()).toBeEnabled();

        await user.type(screen.getByRole('textbox', { name: 'Notas' }), ' · Lote verificado');
        await user.click(saveButton());
        expect(props.onSave.mock.calls[0][0].warnings).toEqual(['La fotografía no permite comprobar el lote.']);
        props.onSave.mockClear();
        await user.click(warningReview);
        expect(warningReview).toBeChecked();
        expect(screen.getByText('La fotografía no permite comprobar el lote.')).toBeInTheDocument();
        expect(props.onSave).not.toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: /Confirmar y registrar compra/ })).not.toBeInTheDocument();
        await user.click(saveButton());
        expect(props.onSave.mock.calls[0][0].warnings).toEqual([]);
        expect(proposal.draft.warnings).toEqual(['La fotografía no permite comprobar el lote.']);
        expect(screen.getByText('La fotografía no permite comprobar el lote.')).toBeInTheDocument();

        rerender(<AssistantInvoiceReview {...props} proposal={{ ...readyProposal(), version: 2, draft: props.onSave.mock.calls[0][0] }} />);
        expect(screen.queryByText('La fotografía no permite comprobar el lote.')).not.toBeInTheDocument();
        expect(screen.queryByRole('checkbox', { name: 'Revisé y corregí los datos señalados' })).not.toBeInTheDocument();
        expect(reviewCheckbox()).not.toBeChecked();
        expect(screen.getByRole('button', { name: /Confirmar y registrar compra/ })).toBeDisabled();
    });

    it('no permite resolver advertencias si falta permiso para preparar compras', async () => {
        const user = userEvent.setup();
        const proposal = readyProposal();
        proposal.status = 'DRAFT';
        proposal.draft.warnings = ['Comprobá el número de factura.'];
        const props = propsFor(proposal);
        render(<AssistantInvoiceReview {...props} capabilities={{ ...capabilities, invoicePrepare: false, invoiceConfirm: false }} />);

        const warningReview = screen.getByRole('checkbox', { name: 'Revisé y corregí los datos señalados' });
        expect(warningReview).toBeDisabled();
        await user.click(warningReview);
        expect(warningReview).not.toBeChecked();
        expect(screen.getByRole('textbox', { name: 'Número de factura' })).toBeDisabled();
        expect(screen.queryByRole('button', { name: /Guardar revisión/ })).not.toBeInTheDocument();
        expect(props.onSave).not.toHaveBeenCalled();
    });

    it('explica que una factura vinculada a recepción no ingresa existencias otra vez', () => {
        const proposal = readyProposal();
        proposal.draft.purchaseOrderId = 'order-1';
        proposal.draft.items[0].purchaseOrderItemId = 'order-line-1';
        proposal.preview!.stockEffect = 'ALREADY_RECEIVED';
        render(<AssistantInvoiceReview {...propsFor(proposal)} />);
        expect(screen.getByText('Existencias: ya ingresaron con la recepción de OC; no se ingresan otra vez.')).toBeInTheDocument();
        expect(screen.getByRole('combobox', { name: 'Origen de la mercadería' })).toHaveValue('ORDER');
        expect(screen.getByRole('combobox', { name: 'Renglón de la OC 1' })).toHaveValue('order-line-1');
    });

    it('revisa y confirma una compra manual sin adjuntos ni permiso de extracción', async () => {
        const user = userEvent.setup();
        const proposal: AssistantProposalDTO = {
            ...readyProposal(), source: 'MANUAL', status: 'DRAFT', attachmentIds: [], preview: null,
            issues: ['Confirmá la recepción y la forma de pago.'],
        };
        proposal.draft = { ...proposal.draft, receivedConfirmed: false, paymentConfirmed: false };
        const props = propsFor(proposal);
        props.capabilities = { ...capabilities, purchasePrepare: true, invoicePrepare: false, extractionEnabled: false };
        const { rerender } = render(<AssistantInvoiceReview {...props} />);

        expect(screen.getByRole('heading', { name: 'Revisá la compra' })).toBeInTheDocument();
        expect(screen.getByLabelText('Subtotal declarado')).toHaveValue('100.00');
        expect(screen.getByLabelText('IVA declarado')).toHaveValue('15.00');
        expect(screen.getByLabelText('Total declarado')).toHaveValue('115.00');
        expect(screen.queryByLabelText('Total del documento')).not.toBeInTheDocument();
        expect(screen.queryByText(/Compará cada dato con el documento/)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Ver documento original' })).not.toBeInTheDocument();
        const received = screen.getByRole('checkbox', { name: 'Confirmo que la mercadería fue recibida y comprobé si ya existe una recepción de OC.' });
        expect(received).not.toBeChecked();
        expect(screen.queryByRole('checkbox', { name: 'Confirmo que quedará pendiente de pago al proveedor.' })).not.toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'Costo 1' })).toBeEnabled();
        await waitFor(() => expect(props.request).toHaveBeenCalledWith('/catalog?kind=products&query='));

        await user.clear(screen.getByRole('textbox', { name: 'Costo 1' }));
        await user.type(screen.getByRole('textbox', { name: 'Costo 1' }), '55.25');
        await user.click(saveButton());
        expect(props.onSave.mock.calls[0][0]).toMatchObject({ receivedConfirmed: false, paymentConfirmed: false });
        expect(props.onSave.mock.calls[0][0].items[0].unitCost).toBe('55.25');
        expect(props.onConfirm).not.toHaveBeenCalled();

        await user.click(received);
        for (const [label, value] of [['Subtotal declarado', '110.50'], ['IVA declarado', '16.58'], ['Total declarado', '127.08']]) {
            await user.clear(screen.getByLabelText(label));
            await user.type(screen.getByLabelText(label), value);
        }
        await user.click(saveButton());
        const saved = props.onSave.mock.calls[1][0];
        expect(saved).toMatchObject({ receivedConfirmed: true, paymentConfirmed: false, documentTotal: '127.08' });
        expect(draftIssues(invoiceDraftSchema.parse(saved))).toEqual([]);
        expect(saved).not.toHaveProperty('attachmentIds');
        expect(screen.queryByRole('button', { name: /Confirmar y registrar compra/ })).not.toBeInTheDocument();

        rerender(<AssistantInvoiceReview {...props} proposal={{
            ...proposal, version: 2, status: 'READY', issues: [], draft: saved,
            preview: { ...readyProposal().preview!, subtotal: '110.50', tax: '16.58', total: '127.08', payable: '127.08', hash: 'manual-server-preview-v2' },
        }} />);
        const review = screen.getByRole('checkbox', { name: 'Revisé los datos y los efectos de esta compra exacta.' });
        const confirm = screen.getByRole('button', { name: 'Confirmar y registrar compra por C$ 127.08' });
        expect(review).not.toBeChecked();
        expect(confirm).toBeDisabled();
        expect(screen.queryByRole('checkbox', { name: /Revisé el documento/ })).not.toBeInTheDocument();
        await user.click(review);
        await user.click(confirm);
        expect(props.onConfirm.mock.calls).toEqual([[confirmationKey]]);
        expect(vi.mocked(props.request).mock.calls.every(([path]) => path.startsWith('/catalog?'))).toBe(true);
    });

    it('calcula los efectos de un DRAFT manual completo sin obligar a modificar datos correctos', async () => {
        const user = userEvent.setup();
        const proposal: AssistantProposalDTO = { ...readyProposal(), source: 'MANUAL', status: 'DRAFT', preview: null, attachmentIds: [] };
        const props = propsFor(proposal);
        props.capabilities = { ...capabilities, purchasePrepare: true, invoicePrepare: false, extractionEnabled: false };
        render(<AssistantInvoiceReview {...props} />);

        expect(draftIssues(proposal.draft)).toEqual([]);
        expect(saveButton()).toBeEnabled();
        expect(screen.queryByRole('button', { name: /Confirmar y registrar compra/ })).not.toBeInTheDocument();
        await user.click(saveButton());
        expect(props.onSave.mock.calls).toEqual([[proposal.draft]]);
        expect(props.onSave.mock.calls[0][0].paymentConfirmed).toBe(false);
        expect(draftIssues(invoiceDraftSchema.parse(props.onSave.mock.calls[0][0]))).toEqual([]);
        expect(props.onConfirm).not.toHaveBeenCalled();
    });

    it.each([false, undefined])('no usa invoicePrepare como sustituto si purchasePrepare es %s en una propuesta manual', async purchasePrepare => {
        const user = userEvent.setup();
        const proposal: AssistantProposalDTO = { ...readyProposal(), source: 'MANUAL', status: 'DRAFT', preview: null, attachmentIds: [] };
        const props = propsFor(proposal);
        props.capabilities = { ...capabilities, purchasePrepare, invoicePrepare: true };
        render(<AssistantInvoiceReview {...props} />);

        expect(screen.getByRole('heading', { name: 'Revisá la compra' })).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'Costo 1' })).toBeDisabled();
        expect(screen.getByLabelText('Total declarado')).toBeDisabled();
        expect(screen.queryByRole('button', { name: /Guardar revisión/ })).not.toBeInTheDocument();
        await user.type(screen.getByRole('textbox', { name: 'Costo 1' }), '9');
        expect(screen.getByRole('textbox', { name: 'Costo 1' })).toHaveValue('50.00');
        expect(props.onSave).not.toHaveBeenCalled();
    });

    it.each([false, undefined])('no confirma una compra manual READY si purchasePrepare es %s aunque invoiceConfirm esté habilitado', purchasePrepare => {
        const proposal: AssistantProposalDTO = { ...readyProposal(), source: 'MANUAL', attachmentIds: [] };
        const props = propsFor(proposal);
        props.capabilities = { ...capabilities, purchasePrepare, invoiceConfirm: true, executionEnabled: true };
        render(<AssistantInvoiceReview {...props} />);

        expect(screen.getByRole('region', { name: 'Efectos de la compra' })).toBeInTheDocument();
        expect(screen.getByLabelText('Total declarado')).toBeDisabled();
        expect(screen.queryByRole('checkbox', { name: 'Revisé los datos y los efectos de esta compra exacta.' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Confirmar y registrar compra/ })).not.toBeInTheDocument();
        expect(props.onConfirm).not.toHaveBeenCalled();
    });

    it.each([
        { source: 'DOCUMENT' as const, label: 'documental', attachmentIds: ['attachment-1'] },
        { source: undefined, label: 'sin origen declarado', attachmentIds: [] },
    ])('no habilita una propuesta $label con sólo permiso manual', async ({ source, attachmentIds }) => {
        const user = userEvent.setup();
        const proposal: AssistantProposalDTO = { ...readyProposal(), source, status: 'DRAFT', preview: null, attachmentIds };
        const props = propsFor(proposal);
        props.capabilities = { ...capabilities, purchasePrepare: true, invoicePrepare: false, extractionEnabled: false };
        render(<AssistantInvoiceReview {...props} />);

        expect(screen.getByRole('heading', { name: 'Revisá la factura' })).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'Costo 1' })).toBeDisabled();
        expect(screen.getByLabelText('Total del documento')).toBeDisabled();
        expect(screen.queryByRole('button', { name: /Guardar revisión/ })).not.toBeInTheDocument();
        await user.type(screen.getByRole('textbox', { name: 'Costo 1' }), '9');
        expect(screen.getByRole('textbox', { name: 'Costo 1' })).toHaveValue('50.00');
        expect(props.onSave).not.toHaveBeenCalled();
    });

    it('impide confirmar sin conexión aunque los efectos ya estén revisados', async () => {
        const user = userEvent.setup();
        vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
        const props = propsFor();
        render(<AssistantInvoiceReview {...props} />);
        await user.click(reviewCheckbox());
        const confirm = screen.getByRole('button', { name: /Confirmar y registrar compra/ });
        expect(confirm).toBeDisabled();
        await user.click(confirm);
        expect(props.onConfirm).not.toHaveBeenCalled();
    });
});
