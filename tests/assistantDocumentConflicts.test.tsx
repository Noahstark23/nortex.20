// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssistantInvoiceReview, useAssistantInvoiceReviewState } from '../components/assistant/AssistantInvoiceReview';
import type { AssistantCapabilities, AssistantProposalDTO, InvoiceDraft } from '../shared/assistant';
import type { AssistantDocumentDecision } from '../shared/assistantDocumentReview';
import type { AssistantRequest } from '../hooks/useNortexAssistant';

const capabilities: AssistantCapabilities = { enabled: true, help: true, overview: true, inventory: true, invoiceRead: true, invoicePrepare: true, invoiceConfirm: true, purchasePrepare: true, extractionEnabled: true, executionEnabled: true };
function proposal(): AssistantProposalDTO {
    const declared: InvoiceDraft = { currency: 'NIO', supplierId: 'supplier', supplierName: 'Proveedor sintético', invoiceNumber: 'QA-50', date: '2026-09-19', documentTotal: '', receivedConfirmed: false, paymentConfirmed: false, items: [{ productId: 'cement', description: 'Cemento declarado', quantity: '50', unitCost: '', purchaseUnit: 'BASE' }], warnings: ['La cantidad declarada difiere del documento.'] };
    return {
        id: 'proposal-50-40', version: 1, status: 'DRAFT', source: 'DOCUMENT', draft: structuredClone(declared), issues: [], preview: null, attachmentIds: ['synthetic-file'], expiresAt: '2026-09-26T06:00:00Z',
        documentReview: { version: 1, declared: structuredClone(declared), document: { ...structuredClone(declared), items: [{ ...declared.items[0], description: 'Cemento facturado', quantity: '40' }] }, hasUnresolved: true, conflicts: [{ id: 'quantity-1', kind: 'VALUE', path: 'items.0.quantity', label: 'Cantidad del producto 1', declaredValue: '50', documentValue: '40', status: 'PENDING' }] },
    };
}
const resolvedRequest = vi.fn(async (path: string) => {
    const params = new URLSearchParams(path.split('?')[1]); const supplier = params.get('kind') === 'suppliers';
    return { items: [{ id: supplier ? 'supplier' : 'cement', label: supplier ? 'Proveedor sintético' : 'Cemento del catálogo' }], warnings: [] };
}) as AssistantRequest;
function propsFor(value = proposal()) {
    return { proposal: value, capabilities, request: resolvedRequest, busy: false, operation: null,
        onSave: vi.fn(async (_draft: InvoiceDraft, _decisions?: AssistantDocumentDecision[]) => {}), onConfirm: vi.fn(async (_key: string) => {}), onOpenPurchases: vi.fn() };
}
function Persistent({ visible = true, ...props }: React.ComponentProps<typeof AssistantInvoiceReview> & { visible?: boolean }) {
    const editor = useAssistantInvoiceReviewState(props.proposal);
    return visible ? <AssistantInvoiceReview {...props} editor={editor} /> : null;
}
const conflict = () => screen.getByRole('group', { name: 'Cantidad del producto 1' });
const save = () => screen.getByRole('button', { name: 'Guardar borrador y decisiones' });
const chooseDocument = (reason = 'Comprobé el documento original.') => {
    fireEvent.click(within(conflict()).getByRole('radio', { name: 'Usar lo facturado' }));
    fireEvent.change(within(conflict()).getByRole('textbox', { name: 'Explicá tu elección' }), { target: { value: reason } });
};
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('revisión humana de fuentes H01-2', () => {
    it('conserva 50 declarado y 40 facturado en fuentes de sólo lectura', () => {
        const props = propsFor(); render(<AssistantInvoiceReview {...props} />);
        expect(within(conflict()).getByLabelText('Valor declarado')).toHaveTextContent('50');
        expect(within(conflict()).getByLabelText('Valor facturado')).toHaveTextContent('40');
        expect(within(conflict()).queryAllByRole('spinbutton')).toHaveLength(0);
        expect(screen.getByRole('textbox', { name: 'Cantidad 1' })).toHaveValue('50');
        expect(screen.getByText(/comprado o facturado no equivale a recibido ni pagado/i)).toBeInTheDocument();
        expect(props.onSave).not.toHaveBeenCalled(); expect(props.onConfirm).not.toHaveBeenCalled();
    });
    it('permite guardar pendientes sin catálogo resuelto; editar cantidad o quitar advertencias no resuelve el conflicto', async () => {
        const props = propsFor(); const request = vi.fn(async () => ({ items: [], warnings: [] })) as AssistantRequest;
        render(<AssistantInvoiceReview {...props} request={request} />);
        fireEvent.change(screen.getByRole('textbox', { name: 'Cantidad 1' }), { target: { value: '40' } });
        fireEvent.click(screen.getByRole('checkbox', { name: 'Revisé y corregí los datos señalados' }));
        expect(save()).toBeEnabled(); fireEvent.click(save()); await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(1));
        expect(props.onSave.mock.calls[0]).toEqual([{ ...props.proposal.draft, items: [{ ...props.proposal.draft.items[0], quantity: '40' }], warnings: [] }]);
        expect(screen.queryByRole('button', { name: /Confirmar y registrar/ })).not.toBeInTheDocument();
        expect(within(conflict()).getByLabelText('Valor declarado')).toHaveTextContent('50');
    });
    it('envía sólo elección y explicación; no cambia ni envía las fuentes originales', async () => {
        const props = propsFor(); const original = structuredClone(props.proposal.documentReview);
        render(<AssistantInvoiceReview {...props} />); chooseDocument('  Revisé la factura original.  ');
        expect(screen.getByRole('textbox', { name: 'Cantidad 1' })).toHaveValue('50');
        fireEvent.click(save()); await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(1));
        expect(props.onSave.mock.calls[0]).toEqual([props.proposal.draft, [{ conflictId: 'quantity-1', choice: 'DOCUMENT', reason: 'Revisé la factura original.' }]]);
        expect(props.proposal.documentReview).toEqual(original); expect(props.onConfirm).not.toHaveBeenCalled();
    });
    it('una elección requiere explicación y puede dejarse pendiente sin perder el borrador', () => {
        const props = propsFor(); render(<AssistantInvoiceReview {...props} />);
        fireEvent.click(within(conflict()).getByRole('radio', { name: 'Conservar lo declarado' }));
        expect(save()).toBeDisabled(); expect(within(conflict()).getByRole('textbox')).toHaveAttribute('maxLength', '500');
        fireEvent.change(within(conflict()).getByRole('textbox'), { target: { value: '  ' } }); expect(save()).toBeDisabled();
        fireEvent.click(within(conflict()).getByRole('button', { name: 'Dejar pendiente' })); expect(save()).toBeEnabled();
        expect(screen.getByRole('textbox', { name: 'Cantidad 1' })).toHaveValue('50');
    });
    it('conserva decisiones sin enviar al ocultar/reabrir y cuando el servidor aún no entrega una versión nueva', async () => {
        const props = propsFor(); const { rerender } = render(<Persistent {...props} />);
        chooseDocument('Confirmé el original en papel.');
        rerender(<Persistent {...props} visible={false} />); rerender(<Persistent {...props} />);
        expect(within(conflict()).getByRole('radio', { name: 'Usar lo facturado' })).toBeChecked();
        expect(within(conflict()).getByRole('textbox')).toHaveValue('Confirmé el original en papel.');
        fireEvent.click(save()); await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(1));
        rerender(<Persistent {...props} proposal={{ ...props.proposal }} />);
        expect(within(conflict()).getByRole('textbox')).toHaveValue('Confirmé el original en papel.');
        rerender(<Persistent {...props} proposal={{ ...props.proposal, version: 2 }} />);
        expect(within(conflict()).getByRole('textbox')).toHaveValue('');
    });
    it('guardar una decisión es un borrador; calcular exige otro paso y no reenvía la decisión resuelta', async () => {
        const props = propsFor(); const { rerender } = render(<AssistantInvoiceReview {...props} />); chooseDocument();
        fireEvent.click(save()); await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(1));
        const updated: AssistantProposalDTO = { ...props.proposal, version: 2, draft: { ...props.proposal.draft, items: [{ ...props.proposal.draft.items[0], quantity: '40' }] }, documentReview: { ...props.proposal.documentReview!, hasUnresolved: false, conflicts: [{ ...props.proposal.documentReview!.conflicts[0], status: 'RESOLVED', resolution: { conflictId: 'quantity-1', choice: 'DOCUMENT', reason: 'Comprobé el documento original.', resolvedBy: 'reviewer-qa', resolvedAt: '2026-09-19T18:00:00Z', proposalVersion: 2 } }] } };
        rerender(<AssistantInvoiceReview {...props} proposal={updated} />);
        const calculate = screen.getByRole('button', { name: 'Guardar revisión y calcular efectos' }); await waitFor(() => expect(calculate).toBeEnabled());
        expect(screen.queryByRole('button', { name: /Confirmar y registrar/ })).not.toBeInTheDocument();
        expect(screen.getByText('Comprobé el documento original.')).toBeVisible();
        fireEvent.click(calculate); await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(2));
        expect(props.onSave.mock.calls[1]).toEqual([updated.draft]);
        expect(within(conflict()).getByLabelText('Valor declarado')).toHaveTextContent('50');
        expect(within(conflict()).getByLabelText('Valor facturado')).toHaveTextContent('40');
    });
    it('un emparejamiento bloqueado deriva a Compras sin ofrecer decisiones automáticas', () => {
        const value = proposal(); value.documentReview!.conflicts[0] = { ...value.documentReview!.conflicts[0], kind: 'LINE_MATCH', status: 'BLOCKED' };
        const props = propsFor(value); render(<AssistantInvoiceReview {...props} />);
        expect(within(conflict()).queryByRole('radio')).not.toBeInTheDocument();
        expect(within(conflict()).getByText(/Revisá estos renglones en Compras/)).toBeVisible();
        fireEvent.click(screen.getByRole('button', { name: 'Revisar en Compras' })); expect(props.onOpenPurchases).toHaveBeenCalledTimes(1);
    });
    it('un rol de consulta ve fuentes pero no puede elegir ni guardar', () => {
        const props = propsFor(); render(<AssistantInvoiceReview {...props} capabilities={{ ...capabilities, invoicePrepare: false, invoiceConfirm: false }} />);
        expect(within(conflict()).getByRole('radio', { name: 'Conservar lo declarado' })).toBeDisabled();
        expect(within(conflict()).getByRole('textbox')).toBeDisabled();
        expect(screen.queryByRole('button', { name: 'Guardar borrador y decisiones' })).not.toBeInTheDocument(); expect(props.onSave).not.toHaveBeenCalled();
    });
    it('un preview READY inconsistente nunca permite confirmar con conflictos pendientes', async () => {
        const value = proposal(); value.status = 'READY'; value.documentReview!.hasUnresolved = false;
        value.preview = { supplierName: 'Proveedor sintético', subtotal: '0', tax: '0', total: '0', stockEffect: 'INCREASE', cashOut: '0', payable: '0', hash: 'preview-inconsistent', lines: [] };
        const props = propsFor(value); render(<AssistantInvoiceReview {...props} />); await act(async () => { await Promise.resolve(); });
        expect(screen.queryByRole('region', { name: 'Efectos de la compra' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Confirmar y registrar/ })).not.toBeInTheDocument(); expect(props.onConfirm).not.toHaveBeenCalled();
    });
    it('un valor desconocido no se convierte en cero', () => {
        const value = proposal(); value.documentReview!.conflicts[0] = { ...value.documentReview!.conflicts[0], declaredValue: null, documentValue: '0' };
        render(<AssistantInvoiceReview {...propsFor(value)} />);
        expect(within(conflict()).getByLabelText('Valor declarado')).toHaveTextContent('Sin dato');
        expect(within(conflict()).getByLabelText('Valor facturado')).toHaveTextContent(/^0$/);
    });
    it('permite guardar una parte de las decisiones sin inventar una elección para las demás', async () => {
        const value = proposal(); value.documentReview!.conflicts.push({ id: 'price-1', kind: 'VALUE', path: 'items.0.unitCost', label: 'Costo del producto 1', declaredValue: null, documentValue: '125', status: 'PENDING' });
        const props = propsFor(value); render(<AssistantInvoiceReview {...props} />); chooseDocument();
        fireEvent.click(save()); await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(1));
        expect(props.onSave.mock.calls[0][1]).toEqual([{ conflictId: 'quantity-1', choice: 'DOCUMENT', reason: 'Comprobé el documento original.' }]);
        expect(within(screen.getByRole('group', { name: 'Costo del producto 1' })).getByRole('radio', { name: 'Usar lo facturado' })).not.toBeChecked();
    });
    it('cambiar de propuesta descarta las decisiones locales de la identidad anterior', () => {
        const props = propsFor(); const { rerender } = render(<Persistent {...props} />); chooseDocument('Motivo de la propuesta anterior.');
        rerender(<Persistent {...props} proposal={{ ...props.proposal, id: 'otra-propuesta' }} />);
        expect(within(conflict()).getByRole('textbox')).toHaveValue('');
        expect(within(conflict()).getByRole('radio', { name: 'Usar lo facturado' })).not.toBeChecked();
    });
    it('una resolución sin procedencia acreditada no habilita cálculo ni confirmación', () => {
        const value = proposal(); value.documentReview!.hasUnresolved = false; value.documentReview!.conflicts[0].status = 'RESOLVED';
        render(<AssistantInvoiceReview {...propsFor(value)} />);
        expect(screen.getByText('No se pudo acreditar esta decisión. Revisá el caso en Compras.')).toBeVisible();
        expect(save()).toBeEnabled(); expect(screen.queryByRole('button', { name: 'Guardar revisión y calcular efectos' })).not.toBeInTheDocument();
    });
    it('conserva la referencia de confirmación incierta al ocultar y reabrir, aunque no responda el catálogo', async () => {
        const value = proposal(); value.documentReview!.hasUnresolved = false;
        value.documentReview!.conflicts[0] = { ...value.documentReview!.conflicts[0], status: 'RESOLVED', resolution: { conflictId: 'quantity-1', choice: 'DECLARED', reason: 'Revisé la declaración.', resolvedBy: 'reviewer', resolvedAt: '2026-09-19T18:00:00Z', proposalVersion: 1 } };
        value.status = 'READY'; value.draft.warnings = [];
        value.preview = { supplierName: 'Proveedor sintético', subtotal: '100', tax: '0', total: '100', stockEffect: 'INCREASE', cashOut: '0', payable: '100', hash: 'synthetic-preview', lines: [] };
        const props = propsFor(value); const { rerender } = render(<Persistent {...props} />);
        const reviewed = screen.getByRole('checkbox', { name: 'Revisé el documento, los productos y estos efectos exactos.' });
        await waitFor(() => expect(reviewed).toBeEnabled()); fireEvent.click(reviewed);
        fireEvent.click(screen.getByRole('button', { name: /Confirmar y registrar compra/ }));
        await waitFor(() => expect(props.onConfirm).toHaveBeenCalledTimes(1)); const key = props.onConfirm.mock.calls[0][0];
        rerender(<Persistent {...props} visible={false} />);
        rerender(<Persistent {...props} request={vi.fn(async () => ({ items: [] })) as AssistantRequest} />);
        const retry = screen.getByRole('button', { name: 'Reintentar confirmación con la misma referencia' });
        expect(retry).toBeEnabled(); fireEvent.click(retry);
        await waitFor(() => expect(props.onConfirm.mock.calls).toEqual([[key], [key]])); expect(props.onSave).not.toHaveBeenCalled();
    });
});
