import { useEffect, useRef, useState } from 'react';
import { emptyEnrollmentFields, enrollmentStorage, type EnrollmentFields, type EnrollmentRecord } from '../utils/productEnrollmentDraft';
import { normalizeProductMoneyInput, productValidationMessage } from '../utils/productForm';

export function useCameraProductEnrollment(onSaved: (product: any) => void, onClose: () => void, initialCode = '') {
    const session = useRef(localStorage.getItem('nortex_token') ?? '');
    const store = useRef<ReturnType<typeof enrollmentStorage> | null>(null);
    const alive = useRef(true), busy = useRef(false);
    const [error, setError] = useState('');
    const [recoverable, setRecoverable] = useState<Array<{key:string;name:string;pending:boolean}>>([]);
    const [record, setRecord] = useState<EnrollmentRecord>(() => {
        try { store.current = enrollmentStorage(session.current); return store.current.read() ?? { version: 1, fields: {...emptyEnrollmentFields(), sku: initialCode}, confirmed: [] }; }
        catch { store.current = null; return { version: 1, fields: emptyEnrollmentFields(), confirmed: [] }; }
    });
    const current = useRef(record); current.current = record;
    const [phase, setPhase] = useState<'scan'|'edit'|'found'|'busy'|'uncertain'>(() => record.attempt ? 'uncertain' : record.fields.sku || record.fields.name ? 'edit' : 'scan');
    const [found, setFound] = useState<any>(null);
    const [lastCode, setLastCode] = useState('');
    const valid = () => alive.current && localStorage.getItem('nortex_token') === session.current;
    useEffect(() => {
        alive.current = true;
        if (!store.current) setError('No pudimos recuperar el almacenamiento. No se reemplazó ningún borrador.');
        else setRecoverable(store.current.recoverable());
        const check = () => { if (!valid()) onClose(); };
        window.addEventListener('storage', check); window.addEventListener('focus', check);
        return () => { alive.current = false; window.removeEventListener('storage', check); window.removeEventListener('focus', check); };
    }, []);
    const persist = (next: EnrollmentRecord) => {
        if (!valid()) throw new Error('La sesión cambió. Volvé a ingresar.');
        if (!store.current) throw new Error('No pudimos abrir el almacenamiento del borrador.');
        store.current.write(next); current.current = next; setRecord(next);
    };
    const update = (patch: Partial<EnrollmentFields>) => {
        if (busy.current || current.current.attempt) return;
        try { persist({ ...current.current, fields: {...current.current.fields, ...patch} }); }
        catch (e) { setError((e as Error).message); }
    };
    const request = (path: string, body?: unknown) => fetch(path, { headers: { authorization: `Bearer ${session.current}`, ...(body ? {'content-type':'application/json'} : {}) }, ...(body ? {method:'POST', body:JSON.stringify(body)} : {}), signal: AbortSignal.timeout(20000) });
    const scan = async (raw: string) => {
        const code = raw.trim().toUpperCase();
        if (busy.current || !valid() || current.current.attempt) return;
        if (!code || code.length > 100 || /[\u0000-\u001f\u007f]/u.test(code)) { setError('Revisá el código.'); return; }
        busy.current = true; setPhase('busy'); setError('');
        try {
            const res = await request(`/api/products/by-barcode/${encodeURIComponent(code)}`); const data = await res.json();
            if (!valid()) return;
            if (res.ok && data.id && data.sku?.toUpperCase() === code) { setFound(data); setPhase('found'); return; }
            if (res.status !== 404 || data.code !== 'PRODUCT_NOT_FOUND') throw new Error('No pudimos comprobar el código. Reintentá antes de crear.');
            persist({...current.current, fields: {...emptyEnrollmentFields(), sku: code}}); setPhase('edit');
        } catch (e) { if (valid()) { setError((e as Error).message); setPhase('scan'); } }
        finally { busy.current = false; }
    };
    const noCode = async () => {
        if (busy.current || !valid() || current.current.attempt) return;
        busy.current = true; setError('');
        try {
            const res = await request('/api/products/enrollment-code'); const data = await res.json();
            if (!valid()) return;
            if (!res.ok || typeof data.sku !== 'string') throw new Error('No pudimos generar el código interno. Reintentá.');
            persist({...current.current, fields:{...emptyEnrollmentFields(), sku:data.sku}}); setPhase('edit');
        } catch(e) { if(valid()) setError((e as Error).message); }
        finally { busy.current = false; }
    };
    const save = async (exit = false) => {
        if (busy.current || !valid()) return false;
        busy.current = true; setError(''); setPhase('busy');
        const wasPending = Boolean(current.current.attempt);
        try {
            let attempt = current.current.attempt;
            if (!attempt) {
                const f = current.current.fields;
                const name = [f.name.trim(), f.presentation.trim()].filter(Boolean).join(' ');
                if (!name || name.length > 200 || !f.sku || !f.price.trim()) throw new Error('Completá nombre, código y precio antes de guardar.');
                attempt = {operationId: crypto.randomUUID(), product: {name, sku:f.sku, brand:f.brand.trim() || null, price:normalizeProductMoneyInput(f.price), stock:'0', minStock:'0', unit:f.unit, saleMode:f.saleMode, quantityStep:f.quantityStep.replace(',','.'), requiresBatchTracking:f.requiresBatchTracking, ivaExento:f.ivaExento}};
                persist({...current.current, attempt});
            }
            let res: Response;
            let data: any;
            if (wasPending) {
                res = await request(`/api/products/enrollment/${attempt.operationId}`); data = await res.json();
                if (!valid()) return false;
                if (!res.ok || data.operationId !== attempt.operationId) throw new Error('No pudimos comprobar el intento. Conservamos los datos.');
                if (data.outcome === 'NOT_OBSERVED') {
                    // Absence is not rejection: resend the SAME identity and immutable contents.
                    res = await request('/api/products/enrollment', attempt); data = await res.json();
                }
            } else { res = await request('/api/products/enrollment', attempt); data = await res.json(); }
            if (!valid()) return false;
            if (res.status === 400 && !wasPending) {
                persist({...current.current, attempt:undefined});
                throw new Error(productValidationMessage(data, 'Revisá los datos del producto.'));
            }
            if (!res.ok || data.operationId !== attempt.operationId || !['APPLIED','REJECTED'].includes(data.outcome)) throw new Error('No pudimos confirmar el guardado. Reintentá el mismo producto.');
            if (data.outcome === 'REJECTED') {
                persist({...current.current, attempt:undefined}); setFound({id:data.productId, name:current.current.fields.name, sku:current.current.fields.sku}); setPhase('found'); setError(data.error); return false;
            }
            if (!data.product?.id || data.product.sku !== String(attempt.product.sku).toUpperCase()) throw new Error('La confirmación no corresponde al producto. Conservá el intento.');
            const product = data.product;
            persist({version:1, fields:emptyEnrollmentFields(), confirmed:[{id:product.id,name:product.name,sku:product.sku,brand:product.brand}, ...current.current.confirmed].slice(0,100)});
            setLastCode(product.sku); setPhase('scan');
            // A consumer refresh failure never changes the authoritative saved result.
            try { onSaved(product); } catch { /* Already confirmed; visible in session history. */ }
            if (exit) onClose();
            return true;
        } catch (e) { if (valid()) { setError((e as Error).message); setPhase(current.current.attempt ? 'uncertain' : 'edit'); } return false; }
        finally { busy.current = false; }
    };
    const next = () => {
        if (busy.current || current.current.attempt) return;
        try { persist({...current.current, fields:emptyEnrollmentFields()}); setLastCode(found?.sku ?? current.current.fields.sku); setFound(null); setError(''); setPhase('scan'); }
        catch(e) { setError((e as Error).message); }
    };
    const defer = () => {
        if (busy.current || current.current.attempt || !store.current) return;
        try {
            store.current.park(current.current);
            persist({...current.current,fields:emptyEnrollmentFields()});
            setRecoverable(store.current.recoverable()); setError(''); setPhase('scan');
        } catch(e) { setError((e as Error).message); }
    };
    const recover = (key: string) => {
        if (busy.current || current.current.attempt || current.current.fields.sku || current.current.fields.name) return;
        try {
            const draft=store.current!.recover(key);
            const confirmed=[...new Map([...current.current.confirmed,...draft.confirmed].map(item=>[item.id,item])).values()].slice(0,100);
            persist({...draft,confirmed});
            store.current!.consume(key,draft);
            setPhase(draft.attempt?'uncertain':'edit'); setRecoverable(store.current!.recoverable());
        }
        catch(e) { setError((e as Error).message); }
    };
    return {record, phase, error, found, lastCode, recoverable, recover, defer, update, scan, noCode, save, next, canClose:phase !== 'busy'};
}
