// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import '@testing-library/jest-dom/vitest';
import {CameraProductEnrollment} from '../components/products/CameraProductEnrollment';
import {suggestProductFields} from '../utils/productPhotoSuggestions';
const capture=vi.hoisted(()=>({stop:vi.fn(),start:vi.fn()}));
vi.mock('../utils/cameraBarcode',()=>({startCameraBarcode: (...args:any[])=>{capture.start(...args);return{stop:capture.stop};}}));
vi.mock('../components/products/ProductPhotoAssist',()=>({ProductPhotoAssist:()=>null}));
const token=()=>`qa.${btoa(JSON.stringify({tenantId:'tenant-a',userId:'owner-a'}))}.qa`;
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status});
beforeEach(()=>{localStorage.clear();sessionStorage.clear();localStorage.setItem('nortex_token',token());capture.start.mockClear();capture.stop.mockClear();});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
const open=()=>{const saved=vi.fn(),close=vi.fn();const view=render(<CameraProductEnrollment onSaved={saved} onClose={close}/>);return{...view,saved,close};};
async function scan(code='0012345678905'){
    fireEvent.change(screen.getByLabelText('También podés escribir el código'),{target:{value:code}});
    fireEvent.click(screen.getByRole('button',{name:'Buscar'}));
    await screen.findByLabelText('Nombre del producto');
}
const fill=()=>{
    fireEvent.change(screen.getByLabelText('Nombre del producto'),{target:{value:'Leche'}});
    fireEvent.change(screen.getByLabelText('Marca'),{target:{value:'Marca QA'}});
    fireEvent.change(screen.getByLabelText('Presentación'),{target:{value:'500 ml'}});
    fireEvent.change(screen.getByLabelText('Precio de venta (C$)'),{target:{value:'25,50'}});
};
describe('alta continua con cámara',()=>{
    it('confirma, limpia marca y vuelve a la cámara sin cerrar ni sumar stock',async()=>{
        const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>{
            if(!init?.body)return response({code:'PRODUCT_NOT_FOUND'},404);
            const command=JSON.parse(String(init.body));return response({operationId:command.operationId,outcome:'APPLIED',product:{...command.product,id:'p1'}});
        });
        const view=open();await scan();fill();fireEvent.click(screen.getByRole('button',{name:'Guardar y escanear otro'}));
        await screen.findByLabelText('También podés escribir el código');
        expect(view.close).not.toHaveBeenCalled();expect(view.saved).toHaveBeenCalledOnce();
        expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body)).product).toMatchObject({stock:'0',price:'25.5',name:'Leche 500 ml',brand:'Marca QA'});
        await waitFor(() => expect(capture.start).toHaveBeenCalledTimes(2));
        const predicate=capture.start.mock.calls[1][4];expect(predicate('0012345678905')).toBe(false);expect(predicate('OTRO')).toBe(true);
        await scan('OTRO');expect(screen.getByLabelText('Marca')).toHaveValue('');expect(screen.getByLabelText('Presentación')).toHaveValue('');expect(screen.getByLabelText('Precio de venta (C$)')).toHaveValue('');
    });
    it('respuesta perdida conserva UUID y contenido al recargar',async()=>{
        const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>{
            if(!init?.body)return response({code:'PRODUCT_NOT_FOUND'},404);
            throw new Error('Sin conexión');
        });
        const view=open();await scan();fill();fireEvent.click(screen.getByRole('button',{name:'Guardar y escanear otro'}));
        await screen.findByRole('button',{name:'Comprobar y reintentar guardado'});
        const sent=String(fetcher.mock.calls[1][1]?.body);view.unmount();open();
        expect(screen.getByLabelText('Marca')).toBeDisabled();
        fetcher.mockImplementation(async()=>{const command=JSON.parse(sent);return response({operationId:command.operationId,outcome:'APPLIED',product:{...command.product,id:'p1'}});});
        fireEvent.click(screen.getByRole('button',{name:'Comprobar y reintentar guardado'}));
        await screen.findByLabelText('También podés escribir el código');expect(fetcher.mock.calls[2][0]).toBe(`/api/products/enrollment/${JSON.parse(sent).operationId}`);expect(fetcher.mock.calls[2][1]?.body).toBeUndefined();
    });
    it('NOT_OBSERVED reenvía la misma identidad y no libera el intento',async()=>{
        let sent='';
        const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async(url,init)=>{
            if(String(url).includes('/by-barcode/'))return response({code:'PRODUCT_NOT_FOUND'},404);
            if(!init?.body)return response({operationId:JSON.parse(sent).operationId,outcome:'NOT_OBSERVED'});
            if(!sent){sent=String(init.body);throw new Error('Sin respuesta');}
            expect(String(init.body)).toBe(sent);
            const command=JSON.parse(sent);return response({operationId:command.operationId,outcome:'APPLIED',product:{...command.product,id:'reconciled'}});
        });
        open();await scan();fill();fireEvent.click(screen.getByRole('button',{name:'Guardar y escanear otro'}));
        fireEvent.click(await screen.findByRole('button',{name:'Comprobar y reintentar guardado'}));
        await screen.findByLabelText('También podés escribir el código');expect(fetcher).toHaveBeenCalledTimes(4);
    });
    it('cambiar producto conserva el borrador para recuperarlo sin perder la marca',async()=>{
        vi.spyOn(globalThis,'fetch').mockResolvedValue(response({code:'PRODUCT_NOT_FOUND'},404));open();await scan();fill();
        fireEvent.click(screen.getByRole('button',{name:'Cambiar producto'}));
        expect(screen.getByLabelText('También podés escribir el código')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button',{name:'Leche'}));
        expect(screen.getByLabelText('Marca')).toHaveValue('Marca QA');
        expect(screen.getByLabelText('Precio de venta (C$)')).toHaveValue('25,50');
    });
    it.each([401,403,500])('lookup HTTP %s no permite crear un producto',async status=>{
        vi.spyOn(globalThis,'fetch').mockResolvedValue(response({error:'Error'},status));open();
        fireEvent.change(screen.getByLabelText('También podés escribir el código'),{target:{value:'ABC'}});fireEvent.click(screen.getByRole('button',{name:'Buscar'}));
        await screen.findByRole('alert');expect(screen.queryByLabelText('Nombre del producto')).not.toBeInTheDocument();
    });
    it('un producto existente no dispara ninguna mutación',async()=>{
        const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(response({id:'existing',name:'Ya existe',sku:'ABC'}));open();
        fireEvent.change(screen.getByLabelText('También podés escribir el código'),{target:{value:'ABC'}});fireEvent.click(screen.getByRole('button',{name:'Buscar'}));
        await screen.findByText('Ya está registrado');expect(fetcher).toHaveBeenCalledOnce();expect(fetcher.mock.calls[0][1]?.method).toBeUndefined();
    });
    it('descarta una respuesta después de cambiar de sesión',async()=>{
        let done!:(res:Response)=>void;vi.spyOn(globalThis,'fetch').mockReturnValue(new Promise(resolve=>{done=resolve;}));open();
        fireEvent.change(screen.getByLabelText('También podés escribir el código'),{target:{value:'ABC'}});fireEvent.click(screen.getByRole('button',{name:'Buscar'}));
        localStorage.setItem('nortex_token','another-session');await act(async()=>done(response({code:'PRODUCT_NOT_FOUND'},404)));
        expect(screen.queryByLabelText('Nombre del producto')).not.toBeInTheDocument();
    });
});
it('foto propone texto, no inventa marca por posición ni extrae precio o stock',()=>{
    expect(suggestProductFields('LECHE ENTERA\nMarca: Lácteos QA\n500 ml\nC$ 25')).toMatchObject({name:'LECHE ENTERA',brand:'Lácteos QA',presentation:'500 ml'});
    expect(suggestProductFields('TRUPER\nMARTILLO\n16 oz').brand).toBe('');
    expect(suggestProductFields('TRUPER\nMARTILLO\n16 oz')).not.toHaveProperty('price');
});
