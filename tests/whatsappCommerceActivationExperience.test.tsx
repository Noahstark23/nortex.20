// @vitest-environment jsdom
import React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import CommerceInbox from '../components/whatsapp/CommerceInbox';

let activation:{id:string;phone:string;status:string;createdAt:string}|null=null;
let getFails=false,getFailsAfterPost=false,postFails=false,postUnknown=false,postCalls=0;
beforeEach(()=>{
  activation=null;getFails=false;getFailsAfterPost=false;postFails=false;postUnknown=false;postCalls=0;
  localStorage.clear();localStorage.setItem('nortex_token','synthetic');localStorage.setItem('nortex_user',JSON.stringify({id:'user-1',role:'OWNER'}));
  vi.stubGlobal('fetch',vi.fn(async(input,init)=>{
    const path=String(input),method=init?.method??'GET';
    if(path.endsWith('/channels'))return Response.json({items:[]});
    if(path.endsWith('/activation-request')&&method==='GET')return getFails||(getFailsAfterPost&&postCalls>0)?new Response(JSON.stringify({error:'No se pudo comprobar la solicitud'}),{status:503}):Response.json({request:activation});
    if(path.endsWith('/activation-request')&&method==='POST'){
      postCalls++;
      if(postFails)throw new Error('Sin conexión');
      const phone=JSON.parse(String(init?.body)).phone;
      activation={id:'request-1',phone,status:'REQUESTED',createdAt:'2026-09-29T14:00:00.000Z'};
      if(postUnknown)throw new Error('Respuesta perdida');
      return Response.json({request:activation,replayed:false},{status:201});
    }
    return Response.json({});
  }));
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

describe('entrada asistida WhatsApp comercial',()=>{
  it('ofrece pedir ayuda con sólo el número cuando todavía no hay canal',async()=>{
    render(<CommerceInbox/>);
    expect(await screen.findByRole('button',{name:'Que Nortex me ayude'})).toBeVisible();
    expect(screen.getByRole('textbox',{name:'Número de WhatsApp del negocio'})).toBeVisible();
    expect(screen.queryByText(/WABA|token|tenant/i)).not.toBeInTheDocument();
  });
  it('guarda la solicitud y al recargar muestra pendiente de conexión sin fingir activación',async()=>{
    const view=render(<CommerceInbox/>);
    fireEvent.change(await screen.findByRole('textbox',{name:'Número de WhatsApp del negocio'}),{target:{value:'+505 8888 8888'}});
    fireEvent.click(screen.getByRole('button',{name:'Que Nortex me ayude'}));
    expect(await screen.findByText('Solicitud guardada. Falta conectar y verificar tu número.')).toBeVisible();
    expect(postCalls).toBe(1);expect(screen.queryByText(/ya está conectado|canal activo/i)).not.toBeInTheDocument();
    view.unmount();render(<CommerceInbox/>);
    expect(await screen.findByText('Solicitud guardada. Falta conectar y verificar tu número.')).toBeVisible();
    expect(postCalls).toBe(1);
  });
  it('distingue fallo de consulta de solicitud inexistente y evita alta duplicada',async()=>{
    getFails=true;render(<CommerceInbox/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos comprobar si ya existe una solicitud');
    expect(screen.queryByRole('button',{name:'Que Nortex me ayude'})).not.toBeInTheDocument();
    getFails=false;fireEvent.click(screen.getByRole('button',{name:'Comprobar solicitud'}));
    expect(await screen.findByRole('button',{name:'Que Nortex me ayude'})).toBeVisible();
    fireEvent.change(screen.getByRole('textbox',{name:'Número de WhatsApp del negocio'}),{target:{value:'50588889999'}});
    expect(screen.getByRole('button',{name:'Que Nortex me ayude'})).toBeEnabled();
    expect(postCalls).toBe(0);
  });
  it('conserva el número ante fallo POST y consulta antes de permitir otro intento',async()=>{
    postFails=true;render(<CommerceInbox/>);
    const input=await screen.findByRole('textbox',{name:'Número de WhatsApp del negocio'});
    fireEvent.change(input,{target:{value:'50588889999'}});fireEvent.click(screen.getByRole('button',{name:'Que Nortex me ayude'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sin conexión');
    expect(input).toHaveValue('50588889999');expect(postCalls).toBe(1);
  });
  it('ante respuesta perdida recupera la solicitud por GET sin repetir POST',async()=>{
    postUnknown=true;render(<CommerceInbox/>);
    fireEvent.change(await screen.findByRole('textbox',{name:'Número de WhatsApp del negocio'}),{target:{value:'50588889999'}});
    fireEvent.click(screen.getByRole('button',{name:'Que Nortex me ayude'}));
    expect(await screen.findByText('Solicitud guardada. Falta conectar y verificar tu número.')).toBeVisible();
    expect(postCalls).toBe(1);expect(screen.queryByRole('button',{name:'Que Nortex me ayude'})).not.toBeInTheDocument();
  });
  it('bloquea otra alta cuando también falla la comprobación tras el timeout',async()=>{
    postUnknown=true;getFailsAfterPost=true;render(<CommerceInbox/>);
    fireEvent.change(await screen.findByRole('textbox',{name:'Número de WhatsApp del negocio'}),{target:{value:'50588889999'}});
    fireEvent.click(screen.getByRole('button',{name:'Que Nortex me ayude'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Comprobá su estado antes de reintentar');
    expect(postCalls).toBe(1);expect(screen.queryByRole('button',{name:'Que Nortex me ayude'})).not.toBeInTheDocument();
    getFailsAfterPost=false;fireEvent.click(screen.getByRole('button',{name:'Comprobar solicitud'}));
    expect(await screen.findByText('Solicitud guardada. Falta conectar y verificar tu número.')).toBeVisible();expect(postCalls).toBe(1);
  });
  it('reserva la solicitud al dueño o administrador',async()=>{
    localStorage.setItem('nortex_user',JSON.stringify({id:'user-2',role:'MANAGER'}));render(<CommerceInbox/>);
    expect(await screen.findByText(/Pedile al dueño o administrador/)).toBeVisible();
    expect(screen.queryByRole('button',{name:'Que Nortex me ayude'})).not.toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.some(([url])=>String(url).endsWith('/activation-request'))).toBe(false);
  });
});
