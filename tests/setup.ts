if (typeof window !== 'undefined') {
    class MemoryStorage {
        private store: Record<string, string> = {};
        get length(): number {
            return Object.keys(this.store).length;
        }
        clear(): void {
            this.store = {};
        }
        getItem(key: string): string | null {
            return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null;
        }
        key(index: number): string | null {
            return Object.keys(this.store)[index] ?? null;
        }
        removeItem(key: string): void {
            delete this.store[key];
        }
        setItem(key: string, value: string): void {
            this.store[key] = String(value);
        }
    }
    const memStorage = new MemoryStorage();
    Object.defineProperty(globalThis, 'localStorage', {
        value: memStorage,
        configurable: true,
        writable: true,
    });
    Object.defineProperty(window, 'localStorage', {
        value: memStorage,
        configurable: true,
        writable: true,
    });
}
