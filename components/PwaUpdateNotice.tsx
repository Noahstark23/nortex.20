import React, { useEffect, useState } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { subscribeToPwaControllerUpdates } from '../utils/pwaUpdate';

type PwaUpdateBannerProps = {
    onReload: () => void;
};

export function PwaUpdateBanner({ onReload }: PwaUpdateBannerProps) {
    return (
        <section
            role="alert"
            aria-labelledby="pwa-update-title"
            className="fixed top-4 left-3 right-3 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:w-full sm:max-w-lg z-toast print:hidden rounded-card border border-amber-400/40 bg-surface-900 shadow-premium p-4"
        >
            <div className="flex items-start gap-3">
                <div className="shrink-0 rounded-control bg-amber-400/15 p-2" aria-hidden="true">
                    <TriangleAlert size={20} className="text-amber-400" />
                </div>
                <div className="min-w-0 flex-1">
                    <h2 id="pwa-update-title" className="text-sm font-bold text-slate-100">
                        Actualización lista
                    </h2>
                    <p className="mt-1 text-sm text-slate-300">
                        Aparcá o terminá la venta antes de recargar. Después, usá la versión nueva de Nortex.
                    </p>
                    <button
                        type="button"
                        onClick={onReload}
                        className="mt-3 inline-flex min-h-tap items-center gap-2 rounded-control bg-brand px-4 py-2 text-sm font-bold text-brand-on transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
                    >
                        <RefreshCw size={17} aria-hidden="true" />
                        Recargar Nortex
                    </button>
                </div>
            </div>
        </section>
    );
}

/**
 * No recarga automáticamente: una recarga inesperada puede cortar un cobro.
 * El aviso queda visible hasta que la persona confirma la acción.
 */
export default function PwaUpdateNotice() {
    const [updateReady, setUpdateReady] = useState(false);

    useEffect(() => {
        const serviceWorker = typeof navigator !== 'undefined' && 'serviceWorker' in navigator
            ? navigator.serviceWorker
            : undefined;

        return subscribeToPwaControllerUpdates(serviceWorker, () => setUpdateReady(true));
    }, []);

    if (!updateReady) return null;

    return <PwaUpdateBanner onReload={() => window.location.reload()} />;
}
