// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { NortexAssistantNotice } from '../components/notifications/NortexAssistantNotice';
import { OperationalNotifications } from '../components/notifications/OperationalNotifications';
import NortexAssistantLauncher from '../components/assistant/NortexAssistantLauncher';
import { VentaEnCursoProvider, useReportarVenta, useVentaEnCurso } from '../components/VentaEnCursoContext';
const caps = { enabled:true,help:true,inventory:true,purchasePrepare:true,accessScope:'OWNER' };
const ok = (body:unknown) => ({ok:true,json:async()=>body});
beforeEach(()=>{
    localStorage.clear();localStorage.setItem('nortex_token','qa-token');localStorage.setItem('nortex_user',JSON.stringify({id:'u1',tenant:{id:'t1'}}));
    vi.spyOn(navigator,'onLine','get').mockReturnValue(true);
    vi.stubGlobal('matchMedia',vi.fn(()=>({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()})));
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();});
describe('aviso de NortexGPT según disponibilidad',()=>{
    it.each([{enabled:false,help:true},{enabled:true,help:false},{sections:[]}])('no anuncia una capacidad deshabilitada o inválida: %j',async value=>{
        const fetcher=vi.fn(async()=>ok(value));vi.stubGlobal('fetch',fetcher);
        render(<NortexAssistantNotice active onOpen={()=>{}}/>);
        await waitFor(()=>expect(fetcher).toHaveBeenCalled());
        expect(screen.queryByRole('region')).not.toBeInTheDocument();
    });
    it('un fallo de red no anuncia disponibilidad',async()=>{
        vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('Offline');}));
        render(<NortexAssistantNotice active onOpen={()=>{}}/>);
        await waitFor(()=>expect(fetch).toHaveBeenCalled());expect(screen.queryByRole('region')).not.toBeInTheDocument();
    });
    it('no consulta cerrado y limita el texto a las capacidades del rol',async()=>{
        const fetcher=vi.fn(async()=>ok({...caps,purchasePrepare:false,accessScope:'BODEGUERO'}));vi.stubGlobal('fetch',fetcher);
        const open=vi.fn();const view=render(<NortexAssistantNotice active={false} onOpen={open}/>);expect(fetcher).not.toHaveBeenCalled();
        view.rerender(<NortexAssistantNotice active onOpen={open}/>);
        expect(await screen.findByRole('region',{name:'Conocé NortexGPT'})).toHaveTextContent('existencias y vencimientos');
        expect(screen.queryByText(/compré 50/)).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button',{name:'Conocer NortexGPT'}));expect(open).toHaveBeenCalledOnce();
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(fetcher).toHaveBeenCalledWith('/api/assistant/capabilities',expect.objectContaining({cache:'no-store',headers:{Authorization:'Bearer qa-token'}}));
    });
    it('descarta capacidades tardías al cambiar de sesión',async()=>{
        let finish!:(v:unknown)=>void;const pending=new Promise(resolve=>{finish=resolve;});
        vi.stubGlobal('fetch',vi.fn().mockReturnValueOnce(pending).mockResolvedValue(ok({enabled:false})));
        render(<NortexAssistantNotice active onOpen={()=>{}}/>);
        localStorage.setItem('nortex_token','qa-other');fireEvent(window,new Event('storage'));
        await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(2));finish(ok(caps));
        await waitFor(()=>expect(screen.queryByRole('region')).not.toBeInTheDocument());
    });
    it('abre el asistente desde Avisos sin navegar, alterar carrito ni enviar consultas',async()=>{
        const fetcher=vi.fn(async(url:string,_options?:RequestInit)=>ok(url.endsWith('/capabilities')?caps:url==='/api/operational-alerts'?{checkedAt:new Date().toISOString(),sections:[]}:[]));vi.stubGlobal('fetch',fetcher);
        function Sale(){const report=useReportarVenta();const sale=useVentaEnCurso();const location=useLocation();React.useEffect(()=>report({hayVenta:true,lineas:2,total:530}),[report]);return <><OperationalNotifications/><NortexAssistantLauncher/><output aria-label="Carrito de prueba">{sale.lineas}:{sale.total}:{location.pathname}</output></>;}
        render(<MemoryRouter initialEntries={['/app/pos']}><VentaEnCursoProvider><Sale/></VentaEnCursoProvider></MemoryRouter>);
        await screen.findByRole('button',{name:'Abrir NortexGPT'});
        fireEvent.click(screen.getByRole('button',{name:/^Avisos importantes/}));
        fireEvent.click(await screen.findByRole('button',{name:'Conocer NortexGPT'}));
        expect(await screen.findByRole('dialog',{name:'NortexGPT'})).toBeVisible();
        expect(screen.queryByRole('dialog',{name:'Avisos importantes'})).not.toBeInTheDocument();
        expect(screen.getByLabelText('Carrito de prueba')).toHaveTextContent('2:530:/app/pos');
        expect(fetcher.mock.calls.every(([,options])=>!(options as RequestInit|undefined)?.method || (options as RequestInit).method==='GET')).toBe(true);
    });
});
