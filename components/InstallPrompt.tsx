import React, { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { trackEvent } from '../utils/analytics';

/**
 * UX-2 — Aviso de instalación de la PWA (beforeinstallprompt).
 *
 * La palanca de retención más barata sobre la mesa: la app instalada abre al
 * toque desde el ícono (start_url /app/pos, precacheado por el SW) en vez de
 * re-descargar el sitio en cada visita. Chrome/Android solo dispara el evento
 * si la PWA es instalable y aún NO está instalada; iOS/Safari no lo dispara
 * nunca (ahí este componente no renderiza nada — no hay banner falso).
 */
const DISMISS_KEY = 'nortex_pwa_install_dismissed_at';
const DISMISS_DIAS = 14; // no insistir: si lo cerró, re-ofrecer a las 2 semanas

export default function InstallPrompt() {
    const [deferred, setDeferred] = useState<any>(null);

    useEffect(() => {
        const onPrompt = (e: Event) => {
            // Sin esto Chrome muestra su mini-infobar genérica una sola vez y
            // el momento se pierde; guardamos el evento para nuestro botón.
            e.preventDefault();
            try {
                const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || 0);
                if (dismissedAt && Date.now() - dismissedAt < DISMISS_DIAS * 86400000) return;
            } catch { /* storage bloqueado: ofrecer igual */ }
            setDeferred(e);
            trackEvent('pwa_install_shown');
        };
        const onInstalled = () => {
            setDeferred(null);
            trackEvent('pwa_installed');
        };
        window.addEventListener('beforeinstallprompt', onPrompt);
        window.addEventListener('appinstalled', onInstalled);
        return () => {
            window.removeEventListener('beforeinstallprompt', onPrompt);
            window.removeEventListener('appinstalled', onInstalled);
        };
    }, []);

    if (!deferred) return null;

    const instalar = async () => {
        const ev = deferred;
        setDeferred(null);
        try {
            ev.prompt();
            const choice = await ev.userChoice;
            trackEvent(choice?.outcome === 'accepted' ? 'pwa_install_accepted' : 'pwa_install_declined');
        } catch { /* el prompt solo puede usarse una vez; nada que hacer */ }
    };

    const cerrar = () => {
        setDeferred(null);
        try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* sin storage */ }
        trackEvent('pwa_install_dismissed');
    };

    return (
        <div className="fixed bottom-20 left-3 right-3 sm:left-auto sm:right-4 sm:w-96 z-40 bg-slate-800 border border-slate-600 rounded-xl shadow-xl p-4 flex items-start gap-3">
            <div className="bg-emerald-500/15 rounded-lg p-2 shrink-0">
                <Download size={20} className="text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-white font-semibold text-sm">Instalá Nortex en tu teléfono</p>
                <p className="text-slate-400 text-xs mt-0.5">
                    Abre al toque desde el ícono, sin gastar datos — y el POS funciona aun sin internet.
                </p>
                <button
                    onClick={instalar}
                    className="mt-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg"
                >
                    Instalar
                </button>
            </div>
            <button onClick={cerrar} aria-label="Ahora no" className="text-slate-500 hover:text-slate-300 shrink-0">
                <X size={16} />
            </button>
        </div>
    );
}
