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
    // 0 = pendiente, 1 = sincronizada. NÚMERO, no booleano: IndexedDB no
    // acepta booleanos como clave de índice, así que un `synced: false`
    // quedaba FUERA del índice y `.where('synced').equals(0)` devolvía
    // siempre [] → toda venta offline se perdía en silencio (el POS decía
    // "Venta registrada", el badge marcaba 0 y nada se sincronizaba jamás).
    synced: 0 | 1;
}

class NortexDB extends Dexie {
    offline_sales!: Table<OfflineSale, string>;

    constructor() {
        super('nortex_offline_v1');
        this.version(1).stores({
            offline_sales: 'offlineId, synced, createdAt',
        });
        // v2 — rescate de ventas atrapadas: convierte los `synced` booleanos
        // de v1 a 0/1 para que entren al índice y se sincronicen por fin.
        this.version(2).stores({
            offline_sales: 'offlineId, synced, createdAt',
        }).upgrade(tx =>
            tx.table('offline_sales').toCollection().modify((sale: any) => {
                sale.synced = sale.synced === true || sale.synced === 1 ? 1 : 0;
            })
        );
    }
}

export const db = new NortexDB();

// Genera un UUID v4 compatible con todos los browsers modernos
export function generateOfflineId(): string {
    return crypto.randomUUID();
}

export async function saveSaleOffline(sale: Omit<OfflineSale, 'synced'>): Promise<void> {
    await db.offline_sales.put({ ...sale, synced: 0 });
}

export async function getPendingSales(): Promise<OfflineSale[]> {
    return db.offline_sales.where('synced').equals(0).toArray();
}

export async function markSalesSynced(offlineIds: string[]): Promise<void> {
    await db.offline_sales.where('offlineId').anyOf(offlineIds).modify({ synced: 1 });
}
