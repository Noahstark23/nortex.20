import type { Worker } from 'tesseract.js';
import { suggestProductFields } from './productPhotoSuggestions';
/** All recognition runs in a local worker; only same-origin model assets are downloaded. */
export async function readProductPhoto(file: File, signal: AbortSignal, progress: (value: number) => void) {
    if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error('Usá una foto JPG, PNG o WebP de menos de 10 MB.');
    let worker: Worker | undefined;
    let stopped = false;
    let rejectAbort: (reason: Error) => void = () => {};
    const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
    // Register a handler even if cancellation happens during imports.
    void aborted.catch(() => {});
    const bounded = <T>(promise: Promise<T>): Promise<T> => Promise.race([promise, aborted]);
    const stop = () => { stopped = true; rejectAbort(new Error('La lectura se pausó. Podés reintentar o escribir los datos.')); void worker?.terminate(); };
    signal.addEventListener('abort', stop, {once:true});
    const deadline = setTimeout(stop, 45000);
    try {
        const [{createWorker}, {default: compress}] = await Promise.all([import('tesseract.js'), import('browser-image-compression')]);
        if (signal.aborted || stopped) throw new Error('Lectura cancelada.');
        const image = await bounded(compress(file, {maxSizeMB:1, maxWidthOrHeight:1600, useWebWorker:false, fileType:'image/jpeg', signal}));
        const root = `${window.location.origin}/product-ocr-v1`;
        const initializing = createWorker('spa', 1, {workerPath:`${root}/worker.min.js`, corePath:root, langPath:root, workerBlobURL:false, logger: m => { if(!stopped && m.status === 'recognizing text') progress(m.progress); }});
        void initializing.then(created => { if(stopped) void created.terminate(); }, () => {});
        worker = await bounded(initializing);
        if (signal.aborted || stopped) throw new Error('La lectura se pausó. Podés escribir los datos.');
        const result = await bounded(worker.recognize(image));
        if (signal.aborted || stopped) throw new Error('Lectura cancelada.');
        if (result.data.confidence < 35) throw new Error('No se lee con suficiente claridad. Probá con más luz o escribí los datos.');
        const suggestions = suggestProductFields(result.data.text);
        if (!suggestions.lines.length) throw new Error('No encontramos texto legible. Acercá el frente del empaque.');
        return suggestions;
    } finally { clearTimeout(deadline); signal.removeEventListener('abort', stop); await worker?.terminate(); }
}
