// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {readProductPhoto} from '../utils/productPhotoReader';
const mocks=vi.hoisted(()=>({recognize:vi.fn(),terminate:vi.fn(),create:vi.fn()}));
vi.mock('tesseract.js',()=>({createWorker:mocks.create}));
vi.mock('browser-image-compression',()=>({default:vi.fn(async(file:File)=>file)}));
afterEach(()=>{vi.clearAllMocks();vi.useRealTimers();});
const file=()=>new File(['synthetic'],'label.png',{type:'image/png'});
it('lee con assets propios y termina el worker; devuelve solo sugerencias',async()=>{
    mocks.create.mockResolvedValue({recognize:mocks.recognize,terminate:mocks.terminate});mocks.recognize.mockResolvedValue({data:{confidence:90,text:'Leche entera\nMarca: QA\n500 ml'}});
    expect(await readProductPhoto(file(),new AbortController().signal,vi.fn())).toMatchObject({name:'Leche entera',brand:'QA',presentation:'500 ml'});
    expect(mocks.create.mock.calls[0][2]).toMatchObject({workerPath:`${location.origin}/product-ocr-v1/worker.min.js`,langPath:`${location.origin}/product-ocr-v1`,workerBlobURL:false});expect(mocks.terminate).toHaveBeenCalled();
});
it('cancelar no espera indefinidamente a una operación del worker',async()=>{
    mocks.create.mockResolvedValue({recognize:mocks.recognize,terminate:mocks.terminate});mocks.recognize.mockReturnValue(new Promise(()=>{}));
    const abort=new AbortController();const promise=readProductPhoto(file(),abort.signal,vi.fn());
    await vi.waitFor(()=>expect(mocks.recognize).toHaveBeenCalled());abort.abort();await expect(promise).rejects.toThrow('se pausó');expect(mocks.terminate).toHaveBeenCalled();
});
it('rechaza lecturas poco claras y archivos fuera de límites',async()=>{
    mocks.create.mockResolvedValue({recognize:mocks.recognize,terminate:mocks.terminate});mocks.recognize.mockResolvedValue({data:{confidence:10,text:'NO CONFIABLE'}});
    await expect(readProductPhoto(file(),new AbortController().signal,vi.fn())).rejects.toThrow('suficiente claridad');
    await expect(readProductPhoto(new File(['x'],'x.svg',{type:'image/svg+xml'}),new AbortController().signal,vi.fn())).rejects.toThrow('JPG');
});
