import Decimal from 'decimal.js';

export interface InventoryAdjustmentScope { tenantId: string; userId: string }
export interface InventoryAdjustmentPayload {
    productId: string;
    warehouseId: string;
    quantity: number;
    reason: string;
    type: 'ADJUST_LOSS' | 'ADJUST_GAIN';
    clientEventId: string;
}
export interface InventoryAdjustmentAttempt {
    version: 1;
    scope: InventoryAdjustmentScope;
    createdAt: string;
    warehouseName: string;
    payload: InventoryAdjustmentPayload;
}

/** Only scopes browser recovery; authorization remains the authenticated API's job. */
export function inventoryAdjustmentScope(token: string | null): InventoryAdjustmentScope {
    try {
        const segment = token?.split('.')[1];
        if (!segment) throw new Error();
        const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
        const claims = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')));
        if (typeof claims.tenantId !== 'string' || !claims.tenantId || typeof claims.userId !== 'string' || !claims.userId) throw new Error();
        return { tenantId: claims.tenantId, userId: claims.userId };
    } catch {
        throw new Error('No pudimos identificar tu sesión. Volvé a iniciar sesión antes de registrar el ajuste.');
    }
}

const keyFor = (scope: InventoryAdjustmentScope, productId: string) =>
    `nortex.inventory-adjustment.v1:${[scope.tenantId, scope.userId, productId].map(encodeURIComponent).join(':')}`;
const sameScope = (a: InventoryAdjustmentScope, b: InventoryAdjustmentScope) => a?.tenantId === b.tenantId && a?.userId === b.userId;
const recoveryError = () => new Error('No pudimos recuperar la evidencia de un ajuste pendiente. Conservá esta pestaña y pedí ayuda antes de registrar otro ajuste para este producto.');

/** Uncertain attempts have no expiry: age does not prove a command failed. */
export function readInventoryAdjustmentAttempt(scope: InventoryAdjustmentScope, productId: string): InventoryAdjustmentAttempt | null {
    try {
        const raw = sessionStorage.getItem(keyFor(scope, productId));
        if (raw === null) return null;
        const attempt = JSON.parse(raw) as InventoryAdjustmentAttempt;
        const payload = attempt?.payload;
        if (attempt.version !== 1 || !sameScope(attempt.scope, scope) || payload?.productId !== productId
            || typeof attempt.warehouseName !== 'string' || !Number.isFinite(Date.parse(attempt.createdAt))
            || typeof payload.warehouseId !== 'string' || !payload.warehouseId
            || typeof payload.clientEventId !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(payload.clientEventId)
            || !Number.isFinite(payload.quantity) || payload.quantity === 0
            || typeof payload.reason !== 'string' || payload.reason.trim().length < 3
            || (payload.type !== 'ADJUST_LOSS' && payload.type !== 'ADJUST_GAIN')
            || (payload.type === 'ADJUST_LOSS') !== (payload.quantity < 0)) throw recoveryError();
        return attempt;
    } catch { throw recoveryError(); }
}

export function saveInventoryAdjustmentAttempt(attempt: InventoryAdjustmentAttempt): void {
    const previous = readInventoryAdjustmentAttempt(attempt.scope, attempt.payload.productId);
    if (previous && JSON.stringify(previous) !== JSON.stringify(attempt)) throw recoveryError();
    try {
        const key = keyFor(attempt.scope, attempt.payload.productId);
        const serialized = JSON.stringify(attempt);
        sessionStorage.setItem(key, serialized);
        if (sessionStorage.getItem(key) !== serialized) throw new Error();
    } catch {
        throw new Error('No se envió el ajuste: no pudimos guardar su identificador en esta pestaña. Conservá la pestaña y revisá el almacenamiento del navegador.');
    }
}

export function clearInventoryAdjustmentAttempt(attempt: InventoryAdjustmentAttempt): void {
    const previous = readInventoryAdjustmentAttempt(attempt.scope, attempt.payload.productId);
    if (previous && JSON.stringify(previous) !== JSON.stringify(attempt)) throw recoveryError();
    sessionStorage.removeItem(keyFor(attempt.scope, attempt.payload.productId));
    if (readInventoryAdjustmentAttempt(attempt.scope, attempt.payload.productId)) throw recoveryError();
}

export function isConfirmedInventoryAdjustment(data: any, attempt: InventoryAdjustmentAttempt): boolean {
    const movement = data?.movement;
    const payload = attempt.payload;
    try {
        return data?.clientEventId === payload.clientEventId && typeof movement?.id === 'string' && !!movement.id
            && movement.tenantId === attempt.scope.tenantId && movement.userId === attempt.scope.userId
            && movement.productId === payload.productId && movement.warehouseId === payload.warehouseId
            && movement.type === payload.type && movement.reason === payload.reason
            && new Decimal(movement.quantity).eq(payload.quantity);
    } catch { return false; }
}

/** A durable rejection also reserves the UUID, so this command cannot apply later. */
export function isRejectedInventoryAdjustment(data: any, attempt: InventoryAdjustmentAttempt): boolean {
    return data?.outcome === 'REJECTED'
        && data.rejection?.clientEventId === attempt.payload.clientEventId
        && isConfirmedInventoryAdjustment({ clientEventId: data.clientEventId, movement: data.rejection }, attempt);
}
