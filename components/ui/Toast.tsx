import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export interface ToastMessage {
    id: number;
    tone: ToastTone;
    title: string;
    message?: string;
}

interface ShowToastOptions {
    tone?: ToastTone;
    title: string;
    message?: string;
    durationMs?: number;
}

const toneStyles: Record<ToastTone, { panel: string; icon: string; Icon: typeof Info }> = {
    success: {
        panel: 'border-emerald-500/60 bg-emerald-950/95',
        icon: 'text-emerald-300',
        Icon: CheckCircle2,
    },
    error: {
        panel: 'border-red-500/60 bg-red-950/95',
        icon: 'text-red-300',
        Icon: AlertCircle,
    },
    warning: {
        panel: 'border-amber-500/60 bg-amber-950/95',
        icon: 'text-amber-300',
        Icon: TriangleAlert,
    },
    info: {
        panel: 'border-sky-500/60 bg-sky-950/95',
        icon: 'text-sky-300',
        Icon: Info,
    },
};

let nextToastId = 1;

/**
 * Aviso no bloqueante para acciones dentro de un módulo. Reemplaza `alert()`:
 * deja que React libere estados de carga y conserva el contexto que el usuario
 * estaba llenando.
 */
export function useToast() {
    const [toast, setToast] = useState<ToastMessage | null>(null);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const dismissToast = useCallback(() => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
        setToast(null);
    }, []);

    const showToast = useCallback(({
        tone = 'info',
        title,
        message,
        durationMs,
    }: ShowToastOptions) => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);

        setToast({ id: nextToastId++, tone, title, message });
        const visibleFor = durationMs ?? (tone === 'error' ? 9_000 : 5_500);
        if (visibleFor > 0) {
            timeoutRef.current = setTimeout(() => {
                timeoutRef.current = null;
                setToast(null);
            }, visibleFor);
        }
    }, []);

    useEffect(() => () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
    }, []);

    return { toast, showToast, dismissToast };
}

export function ToastViewport({
    toast,
    onDismiss,
}: {
    toast: ToastMessage | null;
    onDismiss: () => void;
}) {
    if (!toast) return null;

    const { Icon, panel, icon } = toneStyles[toast.tone];
    const isError = toast.tone === 'error';

    return (
        <div className="fixed top-4 left-4 right-4 sm:left-auto sm:w-full sm:max-w-md z-toast pointer-events-none print:hidden">
            <div
                key={toast.id}
                role={isError ? 'alert' : 'status'}
                aria-live={isError ? 'assertive' : 'polite'}
                className={`pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3.5 shadow-2xl backdrop-blur animate-in fade-in slide-in-from-top-2 duration-200 ${panel}`}
            >
                <Icon className={`mt-0.5 shrink-0 ${icon}`} size={20} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                    <p className="font-semibold text-white leading-5">{toast.title}</p>
                    {toast.message && (
                        <p className="mt-1 text-sm leading-5 text-slate-200">{toast.message}</p>
                    )}
                </div>
                <button
                    type="button"
                    onClick={onDismiss}
                    className="-mr-1 -mt-1 rounded-lg p-1.5 text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
                    aria-label="Cerrar aviso"
                >
                    <X size={17} />
                </button>
            </div>
        </div>
    );
}
