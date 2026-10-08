import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AssistantInvoiceReview } from '../../components/assistant/AssistantInvoiceReview';
import type { AssistantCatalogItem, AssistantRequest } from '../../hooks/useNortexAssistant';
import type { AssistantProposalDTO, InvoiceDraft } from '../../shared/assistant';
import '../../index.css';

// Recorrido visual sintético: ninguna API, proveedor o registro de compra.
const products: AssistantCatalogItem[] = [
    { id: 'qa-cement-a', label: 'Cemento gris', detail: 'SKU CEM-42 · Marca Alfa · Unidad bolsa · Empaque pallet de 20 bolsas' },
    { id: 'qa-cement-b', label: 'Cemento gris', detail: 'SKU CEM-50 · Marca Beta · Unidad bolsa · Empaque pallet de 25 bolsas' },
    { id: 'qa-iron', label: 'Hierro 3/8 de 6 m', detail: 'SKU HIE-38 · Unidad varilla' },
];
const suppliers: AssistantCatalogItem[] = [
    { id: 'qa-supplier-a', label: 'Materiales del Norte', detail: 'RUC QA-001 · Dirección Estelí, local 1' },
    { id: 'qa-supplier-b', label: 'Materiales del Norte', detail: 'RUC QA-002 · Dirección Managua, local 2' },
];
const request: AssistantRequest = async <T,>(path: string): Promise<T> => {
    const params = new URLSearchParams(path.split('?')[1]);
    const rows = params.get('kind') === 'products' ? products : params.get('kind') === 'suppliers' ? suppliers : [{ id: 'qa-warehouse', label: 'Principal' }];
    const query = params.get('query')?.toLowerCase() ?? '';
    const selectedId = params.get('selectedId');
    const items = selectedId ? rows.filter(row => row.id === selectedId) : rows.filter(row => !query || `${row.label} ${row.detail ?? ''}`.toLowerCase().includes(query));
    return { items, warnings: query === 'cemento' ? ['Verificá marca, presentación y unidad antes de elegir.'] : [] } as T;
};
const proposal: AssistantProposalDTO = {
    id: 'qa-proposal', version: 1, status: 'DRAFT', source: 'MANUAL', attachmentIds: [],
    expiresAt: '2030-01-01T00:00:00Z', issues: [], preview: null,
    draft: {
        currency: 'NIO', supplierName: 'Nombre conservado de la factura', invoiceNumber: 'QA-50', date: '2026-09-19',
        documentTotal: '', receivedConfirmed: false, paymentConfirmed: false,
        warnings: ['Datos sintéticos: costos, recepción y pago pendientes.'],
        items: [{ description: '50 bolsas de cemento, texto original', quantity: '50', unitCost: '', purchaseUnit: 'BASE' }],
    },
};
function Preview() {
    const [saved, setSaved] = useState<InvoiceDraft | null>(null);
    return <main className="mx-auto min-h-screen max-w-3xl space-y-5 p-4" style={{ background: 'var(--nx-shell-solid)', color: 'var(--nx-shell-text)' }}>
        <header><h1 className="text-2xl font-bold">NortexGPT · revisión de catálogo</h1><p>QA con datos sintéticos. Elegí productos/proveedor y cambiá la búsqueda para comprobar su identidad.</p></header>
        <AssistantInvoiceReview proposal={proposal} capabilities={{ enabled: true, help: true, overview: true, inventory: true, invoiceRead: true, invoicePrepare: false, invoiceConfirm: false, purchasePrepare: true, extractionEnabled: false, executionEnabled: false }} request={request} busy={false} operation={null}
            onSave={async draft => { setSaved(structuredClone(draft)); }} onConfirm={async () => { throw new Error('La demostración no registra operaciones.'); }} onOpenPurchases={() => {}} />
        {saved && <aside aria-label="Resultado sintético"><h2>Borrador recibido en QA</h2><p>Producto: {saved.items[0]?.productId} · Proveedor: {saved.supplierId}</p><p>Cantidad conservada: {saved.items[0]?.quantity}</p><p>Texto original: {saved.items[0]?.description}</p></aside>}
    </main>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
