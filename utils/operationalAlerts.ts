/** Conteos operativos: la ausencia de una sección significa que no aplica al rol. */
export type OperationalAlertSectionId =
    | 'out_of_stock'
    | 'low_stock'
    | 'expired_batches'
    | 'expiring_batches'
    | 'pending_orders';

export interface OperationalAlertSample {
    id: string;
    name: string;
    detail?: string;
}

export type OperationalAlertSection =
    | { id: OperationalAlertSectionId; status: 'ok'; count: number; samples?: OperationalAlertSample[] }
    | { id: OperationalAlertSectionId; status: 'error'; count: null };

export interface OperationalAlertsResponse {
    /** Inicio de la consulta; las secciones no constituyen un snapshot transaccional. */
    checkedAt: string;
    sections: OperationalAlertSection[];
}
