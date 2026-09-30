import { useEffect, useRef, useState } from 'react';

interface ActivationRequest {id:string;phone:string;status:string;createdAt:string}
interface ActivationResponse {request:ActivationRequest|null}

/** Solicitar ayuda no registra el número en Meta ni activa la atención a compradores. */
export default function CommerceActivation({canRequest}:{canRequest:boolean}) {
  const [phone,setPhone]=useState(''),[request,setRequest]=useState<ActivationRequest|null>(null);
  const [loading,setLoading]=useState(canRequest),[busy,setBusy]=useState(false),[loadError,setLoadError]=useState(''),[submitError,setSubmitError]=useState('');
  const [mustCheck,setMustCheck]=useState(false);
  const lock=useRef(false);
  async function call<T>(method:'GET'|'POST',body?:{phone:string}):Promise<T> {
    const token=localStorage.getItem('nortex_token');
    const response=await fetch('/api/whatsapp-commerce/activation-request',{method,headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(typeof payload.error==='string'?payload.error:'No pudimos comprobar la solicitud.');
    return payload as T;
  }
  async function refresh() {
    setLoading(true);setLoadError('');
    try {const result=await call<ActivationResponse>('GET');setRequest(result.request);setMustCheck(false);if(result.request)setSubmitError('');}
    catch {setLoadError('No pudimos comprobar si ya existe una solicitud. Volvé a consultar antes de enviar otra.');setMustCheck(true);}
    finally {setLoading(false);}
  }
  useEffect(()=>{if(canRequest)void refresh();},[canRequest]);
  async function submit() {
    if(lock.current||!phone.trim()||loading||mustCheck||loadError)return;
    lock.current=true;setBusy(true);setSubmitError('');
    try {const result=await call<{request:ActivationRequest;replayed:boolean}>('POST',{phone:phone.trim()});setRequest(result.request);}
    catch (error) {
      // Un timeout puede haber guardado la petición. Leer su identidad antes de ofrecer otro POST.
      setMustCheck(true);
      try {const result=await call<ActivationResponse>('GET');setRequest(result.request);setMustCheck(false);
        if(!result.request)setSubmitError(error instanceof Error?error.message:'No se pudo guardar. Conservamos tu número para reintentar.');
      } catch {setLoadError('No pudimos comprobar si la solicitud se guardó. Comprobá su estado antes de reintentar.');}
    } finally {lock.current=false;setBusy(false);}
  }
  return <div className="nx-shell-control rounded-control border p-4 space-y-3" aria-label="Ayuda para conectar WhatsApp">
    <h3 className="nx-shell-text text-base font-semibold">Llevá tu negocio a WhatsApp</h3>
    <p className="nx-shell-muted text-sm">Dejanos el número del negocio y Nortex te ayudará con los pasos para conectarlo. Todavía no recibirás mensajes de compradores desde aquí.</p>
    {!canRequest?<p className="nx-shell-muted text-sm">Pedile al dueño o administrador del negocio que solicite la ayuda.</p>:<>
      {loading&&<p role="status" className="nx-shell-muted text-sm">Comprobando solicitud…</p>}
      {loadError&&<p role="alert" className="nx-tone-warning rounded-control border p-3 text-sm">{loadError}</p>}
      {request?<div className="nx-tone-success rounded-control border p-3 text-sm"><p role="status">Solicitud guardada. Falta conectar y verificar tu número.</p><p className="mt-1">Número solicitado: {request.phone}</p></div>:!loading&&!loadError&&<form onSubmit={event=>{event.preventDefault();void submit()}} className="flex flex-wrap items-end gap-2">
        <label className="nx-shell-text flex-1 text-sm">Número de WhatsApp del negocio<input type="tel" autoComplete="tel" inputMode="tel" className="nx-shell-control mt-1 block w-full rounded-control border px-3 py-2" value={phone} onChange={event=>setPhone(event.target.value)} placeholder="+505 8888 8888"/></label>
        <button type="submit" className="nx-shell-control rounded-control border px-3 py-2" disabled={busy||!phone.trim()}>Que Nortex me ayude</button>
      </form>}
      {submitError&&<p role="alert" className="nx-tone-warning text-sm">{submitError}</p>}
      {!loading&&(request||loadError||mustCheck)&&<button type="button" className="nx-shell-control rounded-control border px-3 py-2 text-sm" disabled={busy} onClick={()=>void refresh()}>Comprobar solicitud</button>}
    </>}
  </div>;
}
