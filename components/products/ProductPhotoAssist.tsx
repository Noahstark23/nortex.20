import { useEffect, useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { readProductPhoto } from '../../utils/productPhotoReader';
import type { ProductPhotoSuggestions } from '../../utils/productPhotoSuggestions';
export function ProductPhotoAssist({onApply, disabled}: {onApply:(fields:{name:string;brand:string;presentation:string})=>void;disabled:boolean}) {
    const [preview,setPreview] = useState(''), [file,setFile] = useState<File|null>(null), [error,setError] = useState('');
    const [working,setWorking] = useState(false), [progress,setProgress] = useState(0);
    const [suggestions,setSuggestions] = useState<ProductPhotoSuggestions|null>(null);
    const controller = useRef<AbortController|null>(null);
    const session = useRef(localStorage.getItem('nortex_token'));
    useEffect(() => () => { controller.current?.abort(); }, []);
    useEffect(() => () => { if(preview) URL.revokeObjectURL(preview); }, [preview]);
    useEffect(() => { if(disabled) { controller.current?.abort(); setWorking(false); } },[disabled]);
    const read = async () => {
        if(!file || working) return;
        const abort = new AbortController(); controller.current=abort; setWorking(true); setError(''); setProgress(0);
        try { const result=await readProductPhoto(file,abort.signal,setProgress); if(!abort.signal.aborted && session.current===localStorage.getItem('nortex_token')) setSuggestions(result); }
        catch(e) { if(!abort.signal.aborted) setError((e as Error).message); }
        finally { if(!abort.signal.aborted) setWorking(false); }
    };
    return <section className="nx-enrollment-photo" aria-label="Datos desde una foto">
        <label className="nx-enrollment-photo-trigger"><Camera size={18}/> Fotografiar empaque<input aria-label="Fotografiar empaque" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={disabled||working} onChange={e=>{ const next=e.target.files?.[0]; if(!next) return; setFile(next);setPreview(URL.createObjectURL(next));setSuggestions(null);setError(''); }}/></label>
        <p>Mostrá el frente con nombre y marca. La foto se lee en este dispositivo y no se publica.</p>
        {preview && <img src={preview} alt="Foto del empaque para revisar"/>}
        {file && !suggestions && <button type="button" disabled={working||disabled} onClick={()=>void read()}>{working ? `Leyendo… ${Math.round(progress*100)}%` : 'Leer datos de esta foto'}</button>}
        {working && <button type="button" onClick={()=>{controller.current?.abort();setWorking(false);}}>Cancelar lectura</button>}
        {error && <p role="alert">{error}</p>}
        {suggestions && <div><p><strong>Sugerencias: revisalas antes de usarlas.</strong></p>
            {(['name','brand','presentation'] as const).map((field,index)=><label key={field}>{['Nombre sugerido','Marca sugerida','Presentación sugerida'][index]}<input value={suggestions[field]} maxLength={field==='name'?200:100} onChange={e=>setSuggestions({...suggestions,[field]:e.target.value})} list={`photo-${field}`}/><datalist id={`photo-${field}`}>{suggestions.lines.map((line,i)=><option key={i} value={line}/>)}</datalist></label>)}
            <p>Si la marca no está clara, elegí el texto reconocido o escribila. No se completan precios ni existencias.</p>
            <button type="button" disabled={disabled} onClick={()=>{onApply(suggestions);setSuggestions(null);setFile(null);setPreview('');}}>Usar estos datos</button>
        </div>}
    </section>;
}
