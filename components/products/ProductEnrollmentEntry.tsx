import {useState} from 'react';
import {Camera} from 'lucide-react';
import {currentSessionRole,roleCapabilitiesFor} from '../../utils/roleCapabilities';
import {CameraProductEnrollment} from './CameraProductEnrollment';
export function ProductEnrollmentEntry({onSaved,completionLabel}: {onSaved:(product:any)=>void;completionLabel?:string}) {
    const [open,setOpen]=useState(false);
    if(!roleCapabilitiesFor(currentSessionRole()).canManageProducts) return null;
    return <><button type="button" className="nx-camera-trigger nx-fluid-press" onClick={()=>setOpen(true)}><Camera size={18}/> Agregar con cámara</button>
        {open && <CameraProductEnrollment completionLabel={completionLabel} onClose={()=>setOpen(false)} onSaved={onSaved}/>}</>;
}
