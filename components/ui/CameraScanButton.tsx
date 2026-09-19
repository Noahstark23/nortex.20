import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, X } from 'lucide-react';
import { FluidSheet } from './FluidSheet';
import { startCameraBarcode } from '../../utils/cameraBarcode';
import './cameraScanner.css';

interface Props { onCreateProduct?: (code: string) => void; onCode: (code: string) => void | Promise<void>; disabled?: boolean; label?: string; }
function Scanner({ onCode, onClose, onCreateProduct }: Props & { onClose: () => void }) {
    const video = useRef<HTMLVideoElement>(null);
    const capture = useRef<ReturnType<typeof startCameraBarcode>>();
    const busy = useRef(false);
    const alive = useRef(true);
    const session = useRef(localStorage.getItem('nortex_token'));
    const [attempt, setAttempt] = useState(0);
    const [error, setError] = useState('');
    const [manual, setManual] = useState('');
    const [missingCode, setMissingCode] = useState('');
    const [processing, setProcessing] = useState(false);
    const callback = useRef(onCode); callback.current = onCode;
    const accept = async (value: string) => {
        const code = value.trim();
        if (busy.current || !alive.current || !code || code.length > 100 || /[\u0000-\u001f\u007f]/u.test(code)) return;
        if (localStorage.getItem('nortex_token') !== session.current) { onClose(); return; }
        busy.current = true; capture.current?.stop(); setProcessing(true); setError(''); setMissingCode('');
        try { await callback.current(code); if (alive.current) onClose(); }
        catch (reason) { if (alive.current) { setError(reason instanceof Error ? reason.message : 'No pudimos buscar el código. Reintentá.'); if ((reason as { code?: string })?.code === 'PRODUCT_NOT_FOUND') setMissingCode(code); } }
        finally { busy.current = false; if (alive.current) setProcessing(false); }
    };
    const acceptRef = useRef(accept); acceptRef.current = accept;
    useEffect(() => {
        alive.current = true;
        capture.current = startCameraBarcode(video.current!, code => { void acceptRef.current(code); }, setError);
        const pause = () => { capture.current?.stop(); setError('Cámara pausada. Tocá Reintentar cámara para continuar.'); };
        const visibility = () => { if (document.hidden) pause(); };
        const changedSession = () => { if (localStorage.getItem('nortex_token') !== session.current) onClose(); };
        document.addEventListener('visibilitychange', visibility);
        window.addEventListener('pagehide', pause);
        window.addEventListener('storage', changedSession);
        window.addEventListener('focus', changedSession);
        return () => { alive.current = false; capture.current?.stop(); document.removeEventListener('visibilitychange', visibility);
            window.removeEventListener('pagehide', pause); window.removeEventListener('storage', changedSession); window.removeEventListener('focus', changedSession); };
    }, [attempt]);
    return createPortal(<div data-camera-scanner>
        <FluidSheet open onClose={onClose} ariaLabel="Escanear código de barras" panelClassName="nx-camera-panel" dragToDismiss={false}>
            <header><h2>Escanear código</h2><button type="button" className="nx-fluid-press" aria-label="Cerrar cámara" onClick={onClose}><X size={22}/></button></header>
            <p>Apuntá al código de barras. Leemos un producto por captura.</p>
            <video ref={video} hidden={!!error} muted playsInline aria-label="Vista de la cámara" />
            {processing && <p role="status">Buscando producto…</p>}
            {error && <p role="alert">{error}</p>}
            {missingCode && onCreateProduct && <button type="button" className="nx-fluid-press nx-camera-primary" onClick={() => { if (session.current !== localStorage.getItem('nortex_token')) { onClose(); return; } onCreateProduct(missingCode); onClose(); }}>Crear producto con código {missingCode}</button>}
            <form onSubmit={event => { event.preventDefault(); void accept(manual); }}>
                <label>Código de barras<input aria-label="Código de barras manual" maxLength={100} value={manual} onChange={event => setManual(event.target.value)} autoComplete="off" /></label>
                <button type="submit" className="nx-fluid-press nx-camera-primary" disabled={processing || !manual.trim()}>Usar código</button>
            </form>
            <button type="button" className="nx-fluid-press" disabled={processing} onClick={() => { setError(''); setAttempt(value => value + 1); }}>Reintentar cámara</button>
        </FluidSheet>
    </div>, document.body);
}
export function CameraScanButton({ onCode, onCreateProduct, disabled = false, label = 'Escanear con cámara' }: Props) {
    const [open, setOpen] = useState(false);
    return <><button type="button" className="nx-camera-trigger nx-fluid-press" aria-label={label} title={label} disabled={disabled} onClick={() => setOpen(true)}><Camera size={21}/><span>Cámara</span></button>
        {open && <Scanner onCode={onCode} onCreateProduct={onCreateProduct} onClose={() => setOpen(false)}/>}</>;
}
