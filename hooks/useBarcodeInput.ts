import { useCallback, useEffect, useRef } from 'react';

/** Un resultado asíncrono pertenece a la sesión y pantalla que lo pidió. */
export function useBarcodeSession() {
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    return useCallback(() => {
        const token = localStorage.getItem('nortex_token');
        return () => mounted.current && localStorage.getItem('nortex_token') === token;
    }, []);
}

/** Único lector de teclado del POS; cámara y teclado entregan al mismo router. */
export function useBarcodeInput(onCode: (code: string) => Promise<void>, enabled: boolean) {
    useEffect(() => {
        if (!enabled) return;
        let buffer = '';
        let timer: ReturnType<typeof setTimeout> | undefined;
        const clear = () => { buffer = ''; if (timer) clearTimeout(timer); };
        const handleKey = (event: KeyboardEvent) => {
            if (document.querySelector('[data-operational-alerts], [data-camera-scanner]')) { clear(); return; }
            const target = event.target as HTMLElement;
            if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return;
            if (event.key === 'Enter') {
                const code = buffer.trim(); clear();
                if (code.length >= 2) { event.preventDefault(); void onCode(code); }
                return;
            }
            if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
            buffer += event.key;
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => { buffer = ''; }, 120);
        };
        window.addEventListener('keydown', handleKey, true);
        return () => { window.removeEventListener('keydown', handleKey, true); clear(); };
    }, [enabled, onCode]);
}
