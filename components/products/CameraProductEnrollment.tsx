import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Check, X } from 'lucide-react';
import { FluidSheet } from '../ui/FluidSheet';
import { startCameraBarcode } from '../../utils/cameraBarcode';
import { useCameraProductEnrollment } from '../../hooks/useCameraProductEnrollment';
import { ProductPhotoAssist } from './ProductPhotoAssist';
import './productEnrollment.css';

function Capture({onCode,lastCode}: {onCode:(code:string)=>Promise<void>;lastCode:string}) {
    const video=useRef<HTMLVideoElement>(null), callback=useRef(onCode);callback.current=onCode;
    const [error,setError]=useState(''), [attempt,setAttempt]=useState(0), [manual,setManual]=useState('');
    useEffect(()=>{
        let active=true;
        const capture=startCameraBarcode(video.current!,code=>{if(active) void callback.current(code);},message=>{if(active)setError(message);},undefined,code=>code.toUpperCase()!==lastCode.toUpperCase());
        const pause=()=>{capture.stop();setError('Cámara pausada. Tocá Activar cámara para continuar.');};
        const visibility=()=>{if(document.hidden)pause();};
        document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',pause);
        return ()=>{active=false;capture.stop();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',pause);};
    },[attempt,lastCode]);
    return <div className="nx-enrollment-capture">
        <div className="nx-enrollment-view"><video ref={video} muted playsInline aria-label="Cámara para agregar productos"/><span aria-hidden="true"/></div>
        <p>Apuntá al código del producto{lastCode ? ' siguiente' : ''}.</p>
        {error && <><p role="alert">{error}</p><button type="button" onClick={()=>{setError('');setAttempt(v=>v+1);}}>Activar cámara</button></>}
        <form onSubmit={e=>{e.preventDefault();void onCode(manual);}}><label htmlFor="enrollment-code">También podés escribir el código</label><div className="nx-enrollment-manual"><input id="enrollment-code" maxLength={100} autoComplete="off" value={manual} onChange={e=>setManual(e.target.value)}/><button type="submit" disabled={!manual.trim()}>Buscar</button></div></form>
    </div>;
}
export function CameraProductEnrollment({onClose,onSaved,initialCode='',completionLabel}:{completionLabel?:string;onClose:()=>void;onSaved:(product:any)=>void;initialCode?:string}) {
    const flow=useCameraProductEnrollment(onSaved,onClose,initialCode);
    const fields=flow.record.fields;
    const editing=flow.phase==='edit';
    const saving=flow.phase==='busy';
    const close=()=>{if(flow.canClose)onClose();};
    return createPortal(<div data-camera-scanner className="nx-product-enrollment">
        <FluidSheet open onClose={close} closeOnBackdrop={false} dragToDismiss={false} ariaLabel="Agregar productos con cámara" panelClassName="nx-enrollment-panel">
            <header><div><span className="nx-enrollment-eyebrow">PRODUCTOS</span><h2>Agregar con cámara</h2></div><button type="button" aria-label="Cerrar alta con cámara" disabled={!flow.canClose} onClick={close}><X size={22}/></button></header>
            <div className="nx-enrollment-body">
                {flow.record.confirmed.length>0 && <div className="nx-enrollment-confirmed" role="status"><Check size={18}/><span>{flow.record.confirmed.length} guardados · Último: {flow.record.confirmed[0].name}</span></div>}
                {flow.error && <p role="alert" className="nx-enrollment-error">{flow.error}</p>}
                {flow.phase==='scan' && flow.recoverable.length>0 && <details><summary>Recuperar un borrador anterior</summary><p>Los datos se conservan. Si está abierto en otra pestaña, cerrala antes de continuar aquí.</p>{flow.recoverable.map(draft=><button type="button" key={draft.key} onClick={()=>flow.recover(draft.key)}>{draft.name}{draft.pending?' · guardado pendiente':''}</button>)}</details>}
                {flow.phase==='scan' && <><Capture onCode={flow.scan} lastCode={flow.lastCode}/><button type="button" className="nx-enrollment-no-code" onClick={()=>void flow.noCode()}>Este producto no tiene código</button></>}
                {flow.phase==='found' && <div className="nx-enrollment-existing"><Check size={28}/><h3>Ya está registrado</h3><strong>{flow.found?.name}</strong><p>{[flow.found?.brand,flow.found?.sku].filter(Boolean).join(' · ')}</p><p>No agregamos otro producto ni cambiamos sus existencias.</p><button type="button" className="nx-enrollment-primary" onClick={flow.next}>Escanear otro</button></div>}
                {saving && <p role="status">{flow.record.attempt ? 'Guardando producto…' : 'Comprobando código…'}</p>}
                {(editing || flow.phase==='uncertain' || (saving && !!flow.record.attempt)) && <form id="enrollment-form" onSubmit={e=>{e.preventDefault();void flow.save(Boolean(completionLabel));}}>
                    <fieldset disabled={!editing}>
                        <div className="nx-enrollment-code-row"><p className="nx-enrollment-code"><Camera size={16}/> {fields.sku}</p>{editing && <button type="button" onClick={flow.defer}>Cambiar producto</button>}</div>
                        <ProductPhotoAssist disabled={!editing} onApply={suggested=>flow.update({name:suggested.name||fields.name,brand:suggested.brand||fields.brand,presentation:suggested.presentation||fields.presentation})}/>
                        <label htmlFor="enrollment-name">Nombre del producto<input id="enrollment-name" required maxLength={200} value={fields.name} onChange={e=>flow.update({name:e.target.value})} placeholder="Ej. Leche entera"/></label>
                        <div className="nx-enrollment-grid"><label htmlFor="enrollment-brand">Marca<input id="enrollment-brand" maxLength={100} value={fields.brand} onChange={e=>flow.update({brand:e.target.value})} placeholder="Sin marca / no identificada"/></label><label htmlFor="enrollment-presentation">Presentación<input id="enrollment-presentation" maxLength={100} value={fields.presentation} onChange={e=>flow.update({presentation:e.target.value})} placeholder="Ej. 500 ml"/></label></div>
                        <div className="nx-enrollment-grid"><label htmlFor="enrollment-price">Precio de venta (C$)<input id="enrollment-price" required inputMode="decimal" value={fields.price} onChange={e=>flow.update({price:e.target.value})} placeholder="0.00"/></label><label htmlFor="enrollment-unit">Se vende por<select id="enrollment-unit" value={fields.unit} onChange={e=>{const unit=e.target.value;const measured=['kg','lb','litro','metro'].includes(unit);flow.update({unit,saleMode:measured?'MEASURED':'COUNTED',quantityStep:measured?'0.001':'1'});}}>{['unidad','caja','bolsa','frasco','par','kg','lb','litro','metro'].map(unit=><option key={unit}>{unit}</option>)}</select></label></div>
                        <p className="nx-enrollment-hint">El precio es por {fields.unit}. Una botella de 500 ml puede venderse por unidad.</p>
                        <details><summary>Opciones del producto</summary><label htmlFor="enrollment-mode">Forma de venta<select id="enrollment-mode" value={fields.saleMode} onChange={e=>flow.update({saleMode:e.target.value as 'COUNTED'|'MEASURED',quantityStep:e.target.value==='COUNTED'?'1':'0.001'})}><option value="COUNTED">Unidades enteras</option><option value="MEASURED">Peso o medida</option></select></label><label htmlFor="enrollment-step">Salto de venta<input id="enrollment-step" inputMode="decimal" value={fields.quantityStep} onChange={e=>flow.update({quantityStep:e.target.value})}/></label><label className="nx-enrollment-check"><input type="checkbox" checked={fields.requiresBatchTracking} onChange={e=>flow.update({requiresBatchTracking:e.target.checked})}/>Controlar lotes y vencimiento</label><label className="nx-enrollment-check"><input type="checkbox" checked={fields.ivaExento} onChange={e=>flow.update({ivaExento:e.target.checked})}/>Exento de IVA según su clasificación fiscal</label></details>
                    </fieldset>
                    <p className="nx-enrollment-hint">Guardamos la ficha sin existencias. Registrá cantidad, costo y bodega al recibir la mercadería.</p>
                </form>}
                {flow.phase==='uncertain' && <div><p>El resultado está pendiente de confirmación. Conservamos los datos y el mismo identificador para evitar duplicados.</p><button type="button" className="nx-enrollment-primary" onClick={()=>void flow.save()}>Comprobar y reintentar guardado</button></div>}
            </div>
            {editing && <footer><button type="submit" form="enrollment-form" className="nx-enrollment-primary">{completionLabel ?? 'Guardar y escanear otro'}</button>{!completionLabel && <button type="button" onClick={()=>{const form=document.getElementById('enrollment-form') as HTMLFormElement; if(form.reportValidity())void flow.save(true);}}>Guardar y salir</button>}<small>El borrador se conserva en este dispositivo.</small></footer>}
        </FluidSheet>
    </div>,document.body);
}
