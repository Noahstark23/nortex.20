import React,{useRef,useState} from 'react';
interface QueueState {counts:Record<string,number>;oldestPendingAgeMs:number|null;expiredLeases:number}
interface Operations {checkedAt:string;inbox:QueueState;outbox:QueueState;worker:{state:string}}
const labels:Record<string,string>={RUNNING:'En ejecución',PAUSED:'Pausada',ERROR:'Requiere atención',STOPPED:'Detenida',STALE:'Sin señal reciente',MISSING:'Sin comprobar'};
export default function CommerceOperations(){
 const [data,setData]=useState<Operations|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);const lock=useRef(false);
 async function check(){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{
  const response=await fetch('/api/whatsapp-commerce/operations',{headers:{Authorization:`Bearer ${localStorage.getItem('nortex_token')??''}`}});
  if(!response.ok)throw new Error('No se pudo comprobar la atención. Volvé a actualizar.');setData(await response.json());
 }catch(e){setData(null);setError(e instanceof Error?e.message:'No se pudo comprobar la atención.')}finally{lock.current=false;setBusy(false)}}
 return <details className="nx-shell-control rounded-control border p-3"><summary className="nx-shell-text cursor-pointer font-medium">Estado de atención</summary><button type="button" disabled={busy} onClick={()=>void check()} className="nx-shell-control mt-3 rounded-control border px-3 py-2">{busy?'Comprobando…':'Comprobar atención'}</button>
 {error&&<p role="alert" className="nx-tone-warning mt-2 rounded-control border p-2">{error}</p>}
 {!data&&!error&&<p className="nx-shell-muted mt-2 text-sm">Comprobá el estado para ver las consultas pendientes.</p>}
 {data&&<div className="nx-shell-text mt-3 space-y-2 text-sm"><p>Atención automática: {labels[data.worker.state]??'Sin comprobar'}</p><p>Consultas pendientes: {(data.inbox.counts.PENDING??0)+(data.inbox.counts.PROCESSING??0)}</p><p>Respuestas pendientes: {(data.outbox.counts.PENDING??0)+(data.outbox.counts.SENDING??0)}</p><p>Envíos inciertos: {data.outbox.counts.UNKNOWN??0}</p><p>Consultas con fallo: {data.inbox.counts.FAILED??0}</p>{(data.outbox.counts.UNKNOWN??0)>0&&<p className="nx-tone-warning">Revisá los envíos inciertos antes de responder otra vez.</p>}<p className="nx-shell-muted">Comprobado: {new Date(data.checkedAt).toLocaleString('es-NI')}</p></div>}
 </details>;
}
