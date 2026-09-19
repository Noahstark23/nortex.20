/** Identidad del catálogo autorizada por el servidor; nunca sustituye el texto de una factura. */
export interface AssistantCatalogIdentity {
    id: string;
    label: string;
    detail?: string;
    sku?: string;
    brand?: string | null;
    unit?: string;
    packUnit?: string | null;
    packSize?: string | null;
    saleMode?: string | null;
    quantityStep?: string | null;
    requiresBatchTracking?: boolean;
    ruc?: string | null;
    address?: string | null;
    /** Fichas que no se pueden distinguir con la información disponible. No seleccionar. */
    selectionIssue?: string;
}
