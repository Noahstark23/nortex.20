import Dexie, { Table } from 'dexie';

export interface OfflineCartItem {
    id: string;
    name: string;
    quantity: number;
    price: number;
    costPrice: number;
    discount?: number;
}

export interface OfflineSale {
    offlineId: string;          // UUID v4 — clave de idempotencia
    tenantId: string;
    userId: string;
    shiftId: string | null;
    employeeId: string | null;
    customerName: string;
    customerId: string | null;
    paymentMethod: string;
    total: number;
    globalDiscount: number;
    items: OfflineCartItem[];
    createdAt: string;          // ISO string
    synced: boolean;
}

class NortexDB extends Dexie {
    offline_sales!: Table<OfflineSale, string>;

    constructor() {
        super('nortex_offline_v1');
        this.version(1).stores({
            offline_sales: 'offlineId, synced, createdAt',
        });
    }
}

export const db = new NortexDB();

// Genera un UUID v4 compatible con todos los browsers modernos
export function generateOfflineId(): string {
    return crypto.randomUUID();
}

export async function saveSaleOffline(sale: Omit<OfflineSale, 'synced'>): Promise<void> {
    await db.offline_sales.put({ ...sale, synced: false });
}

export async function getPendingSales(): Promise<OfflineSale[]> {
    return db.offline_sales.where('synced').equals(0).toArray();
}

export async function markSalesSynced(offlineIds: string[]): Promise<void> {
    await db.offline_sales.where('offlineId').anyOf(offlineIds).modify({ synced: true });
}
