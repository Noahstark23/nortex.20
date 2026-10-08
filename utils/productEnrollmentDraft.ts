import { z } from 'zod';
import { inventoryAdjustmentScope } from './inventoryAdjustmentAttempt';
export interface EnrollmentFields { sku: string; name: string; brand: string; presentation: string; price: string; unit: string; saleMode: 'COUNTED' | 'MEASURED'; quantityStep: string; requiresBatchTracking: boolean; ivaExento: boolean; }
export const emptyEnrollmentFields = (): EnrollmentFields => ({ sku: '', name: '', brand: '', presentation: '', price: '', unit: 'unidad', saleMode: 'COUNTED', quantityStep: '1', requiresBatchTracking: false, ivaExento: false });
export interface EnrollmentRecord {
    version: 1;
    fields: EnrollmentFields;
    attempt?: { operationId: string; product: Record<string, unknown> };
    confirmed: Array<{id: string; name: string; sku: string; brand?: string | null}>;
}
const fieldsSchema = z.object({sku:z.string().max(100),name:z.string().max(200),brand:z.string().max(100),presentation:z.string().max(100),price:z.string().max(100),unit:z.string().max(40),saleMode:z.enum(['COUNTED','MEASURED']),quantityStep:z.string().max(100),requiresBatchTracking:z.boolean(),ivaExento:z.boolean()}).strict();
const recordSchema = z.object({version:z.literal(1),fields:fieldsSchema,attempt:z.object({operationId:z.uuid(),product:z.record(z.string(),z.unknown())}).strict().optional(),confirmed:z.array(z.object({id:z.string(),name:z.string(),sku:z.string(),brand:z.string().nullable().optional()})).max(100)}).strict();
function parseRecord(raw: string): EnrollmentRecord {
    try { return recordSchema.parse(JSON.parse(raw)) as EnrollmentRecord; }
    catch { throw new Error('No pudimos recuperar el borrador. No lo reemplazamos.'); }
}
export function enrollmentStorage(token: string) {
    const { tenantId, userId } = inventoryAdjustmentScope(token);
    // A tab owns its draft; other tabs cannot silently overwrite it.
    const prefix = `nortex.enrollment.v1:${encodeURIComponent(tenantId)}:${encodeURIComponent(userId)}:`;
    let tab = sessionStorage.getItem(`${prefix}tab`);
    if (!tab) { tab = crypto.randomUUID(); sessionStorage.setItem(`${prefix}tab`, tab); }
    const key = `${prefix}${tab}`;
    return {
        read(): EnrollmentRecord | null {
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            return parseRecord(raw);
        },
        park(value: EnrollmentRecord) {
            const archived = `${prefix}${crypto.randomUUID()}`;
            const raw = JSON.stringify({...value, confirmed: []});
            localStorage.setItem(archived,raw);
            if(localStorage.getItem(archived)!==raw) throw new Error('No pudimos conservar el borrador anterior.');
        },
        recoverable() {
            const drafts: Array<{key:string;name:string;pending:boolean}> = [];
            for (let index=0; index<localStorage.length && drafts.length<20; index++) {
                const candidate=localStorage.key(index);
                if(!candidate || candidate===key || !candidate.startsWith(prefix)) continue;
                try { const item=parseRecord(localStorage.getItem(candidate)!); if(item.fields.sku || item.fields.name || item.attempt) drafts.push({key:candidate,name:item.fields.name || item.fields.sku || 'Producto pendiente',pending:Boolean(item.attempt)}); } catch { /* Preserve unreadable evidence. */ }
            }
            return drafts;
        },
        recover(candidate: string) {
            if(!candidate.startsWith(prefix) || candidate===key) throw new Error('Borrador fuera de esta sesión.');
            const raw=localStorage.getItem(candidate);
            if(!raw) throw new Error('El borrador ya no está disponible.');
            return parseRecord(raw);
        },
        consume(candidate: string, expected: EnrollmentRecord) {
            if (!candidate.startsWith(prefix) || candidate === key) return;
            const raw = localStorage.getItem(candidate);
            if (raw && JSON.stringify(parseRecord(raw)) === JSON.stringify(expected)) localStorage.removeItem(candidate);
        },
        write(value: EnrollmentRecord) {
            const raw = JSON.stringify(value);
            localStorage.setItem(key, raw);
            if (localStorage.getItem(key) !== raw) throw new Error('No pudimos conservar el borrador. No se envió el producto.');
        },
    };
}
