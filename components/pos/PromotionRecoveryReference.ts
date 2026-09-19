/** Sólo correlación opaca; no contiene carrito, importes, credenciales ni datos del cliente. */
export function promotionRecoveryStorage(scope: string) {
    const key = `nortex_promotion_pending_v1:${scope}`;
    return {
        read(): string | null { try { const value = sessionStorage.getItem(key); return value && /^[a-zA-Z0-9_-]{1,160}$/.test(value) ? value : null; } catch { return null; } },
        write(id: string) { sessionStorage.setItem(key, id); },
        clear() { try { sessionStorage.removeItem(key); } catch { /* Una referencia persistida sigue siendo sólo consulta. */ } },
    };
}
