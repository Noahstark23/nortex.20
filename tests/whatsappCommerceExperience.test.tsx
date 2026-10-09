// @vitest-environment jsdom
import React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import CommerceInbox from '../components/whatsapp/CommerceInbox';

const channel={id:'channel-1',displayPhone:'+505 2222 3333',active:true,commerceEnabled:true,commercePolicyVersion:1,commercePolicy:{eligibleProductIds:['p1'],autoQuote:false,ttlHours:24,maxTotal:'5000.00',maxLines:5,eligibilityAttested:true}};
const convo={id:'conversation-1',channelId:'channel-1',waId:'50588889999',status:'HUMAN',version:2,assignedUserId:'user-1',optedOutAt:null,lastInboundAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
const draft={id:'draft-1',version:1,status:'DRAFT',items:[{productId:'p1',quantity:'2',presentation:'BASE'}],snapshot:null,reviewHash:null,quotationId:null};
let failure=false,unknown=false,issueCalls=0,reviewCalls=0,draftStatus='DRAFT';
beforeEach(()=>{
  failure=false;unknown=false;issueCalls=0;reviewCalls=0;draftStatus='DRAFT';localStorage.clear();localStorage.setItem('nortex_token','synthetic');localStorage.setItem('nortex_user',JSON.stringify({id:'user-1',role:'OWNER'}));
  vi.stubGlobal('fetch',vi.fn(async(input,init)=>{
    const url=String(input),method=init?.method??'GET';
    if(failure&&url.endsWith('/channels'))return new Response(JSON.stringify({error:'No se pudieron cargar canales'}),{status:503});
    if(url.endsWith('/channels'))return Response.json({items:[channel]});
    if(url.endsWith('/channels/channel-1/products'))return Response.json({items:[{id:'p1',name:'Cemento gris',sku:'CEM-01',unit:'saco',price:200,stock:10}]});
    if(url.includes('/conversations?'))return Response.json({items:[convo]});
    if(url.endsWith('/conversations/conversation-1'))return Response.json({conversation:convo,inbox:[{id:'in-1',body:'Dos sacos de cemento',status:'DONE',eventAt:new Date().toISOString()}],outbox:unknown?[{id:'out-1',body:'Mensaje anterior',status:'UNKNOWN',errorCode:'SEND_INTERRUPTED'}]:[],drafts:[{...draft,status:draftStatus}]});
    if(url.endsWith('/drafts/draft-1/review')&&method==='POST'){reviewCalls++;return Response.json({draftId:'draft-1',version:1,reviewHash:'hash-1',snapshot:{total:'400.00'},text:'Dos sacos de cemento. Total C$400.00.'});}
    if(url.endsWith('/drafts/draft-1/issue')&&method==='POST'){issueCalls++;return Response.json({quotationId:'Q-1',outboxId:'out-1'},{status:201});}
    return Response.json({});
  }));
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

describe('bandeja comercial',()=>{
  it('muestra un error de carga en lugar de una bandeja vacía',async()=>{failure=true;render(<CommerceInbox/>);expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar canales');expect(screen.queryByText('Este negocio aún no tiene un canal comercial configurado.')).not.toBeInTheDocument();});
  it('revisa antes de emitir y no afirma entrega del mensaje encolado',async()=>{
    render(<CommerceInbox/>);fireEvent.click(await screen.findByRole('button',{name:/50588889999/}));
    fireEvent.click(await screen.findByRole('button',{name:'Revisar proforma'}));expect(await screen.findByText('Dos sacos de cemento. Total C$400.00.')).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'Emitir proforma revisada'}));
    await waitFor(()=>expect(issueCalls).toBe(1));expect(reviewCalls).toBe(1);
    expect(await screen.findByText(/Proforma Q-1 emitida\. Mensaje encolado/)).toBeVisible();
    expect(screen.queryByText(/entregado al cliente/i)).not.toBeInTheDocument();
  });
  it('expone entrega incierta sin un reintento automático',async()=>{unknown=true;render(<CommerceInbox/>);fireEvent.click(await screen.findByRole('button',{name:/50588889999/}));expect(await screen.findByText(/Entrega incierta/)).toBeVisible();expect(screen.getByText(/SEND_INTERRUPTED/)).toBeVisible();expect(screen.queryByRole('button',{name:/reintentar/i})).not.toBeInTheDocument();});
  it('permite revisar PENDING_REVIEW y conserva la conversación al actualizar',async()=>{draftStatus='PENDING_REVIEW';render(<CommerceInbox/>);fireEvent.click(await screen.findByRole('button',{name:/50588889999/}));expect(await screen.findByText(/Pendiente de revisión/)).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'Actualizar'}));await waitFor(()=>expect(screen.getByRole('button',{name:/50588889999/})).toHaveAttribute('aria-pressed','true'));expect(screen.getByRole('button',{name:'Revisar proforma'})).toBeEnabled();fireEvent.click(screen.getByRole('button',{name:'Revisar proforma'}));await waitFor(()=>expect(reviewCalls).toBe(1));});
  it('muestra una proforma emitida sin permitir editar sus productos',async()=>{draftStatus='ISSUED';render(<CommerceInbox/>);fireEvent.click(await screen.findByRole('button',{name:/50588889999/}));expect(await screen.findByText(/Proforma emitida/)).toBeVisible();expect(screen.getByRole('combobox',{name:'Producto línea 1'})).toBeDisabled();expect(screen.getByRole('textbox',{name:'Cantidad línea 1'})).toBeDisabled();expect(screen.queryByRole('button',{name:'Revisar proforma'})).not.toBeInTheDocument();});
  it('descarta una lectura atrasada del canal anterior y limpia respuesta y revisión al cambiar',async()=>{
    const secondChannel={...channel,id:'channel-2',displayPhone:'+505 2222 4444'};
    const secondConversation={...convo,id:'conversation-2',channelId:'channel-2',waId:'50588887777'};
    const initialFetch=vi.mocked(fetch).getMockImplementation()!;
    let delayed=false,resolveOld:(response:Response)=>void;
    vi.mocked(fetch).mockImplementation(async(input,init)=>{
      const url=String(input);
      if(url.endsWith('/channels'))return Response.json({items:[channel,secondChannel]});
      if(url.includes('conversations?channelId=channel-2'))return Response.json({items:[secondConversation]});
      if(url.endsWith('/channels/channel-2/products'))return Response.json({items:[]});
      if(url.endsWith('/conversations/conversation-2'))return Response.json({conversation:secondConversation,inbox:[{id:'in-2',body:'Consulta del segundo canal',status:'DONE'}],outbox:[],drafts:[]});
      if(delayed&&url.endsWith('/conversations/conversation-1'))return new Promise<Response>(resolve=>{resolveOld=resolve;});
      return initialFetch(input,init);
    });
    render(<CommerceInbox/>);fireEvent.click(await screen.findByRole('button',{name:/50588889999/}));
    fireEvent.change(await screen.findByRole('textbox',{name:'Respuesta humana'}),{target:{value:'Texto para primer comprador'}});
    fireEvent.click(screen.getByRole('button',{name:'Revisar proforma'}));
    expect(await screen.findByText('Dos sacos de cemento. Total C$400.00.')).toBeVisible();
    delayed=true;
    fireEvent.click(screen.getByRole('button',{name:'Actualizar'}));
    await waitFor(()=>expect(resolveOld).toBeDefined());
    fireEvent.change(screen.getByRole('combobox',{name:'Canal WhatsApp'}),{target:{value:'channel-2'}});
    fireEvent.click(await screen.findByRole('button',{name:/50588887777/}));
    expect(await screen.findByText('Consulta del segundo canal')).toBeVisible();
    expect(screen.getByRole('textbox',{name:'Respuesta humana'})).toHaveValue('');
    expect(screen.queryByRole('button',{name:'Emitir proforma revisada'})).not.toBeInTheDocument();
    await act(async()=>{resolveOld(Response.json({conversation:convo,inbox:[{id:'old',body:'Lectura atrasada del primero',status:'DONE'}],outbox:[],drafts:[draft]}));});
    expect(screen.getByText('Consulta del segundo canal')).toBeVisible();
    expect(screen.queryByText('Lectura atrasada del primero')).not.toBeInTheDocument();
    expect(screen.queryByText('Dos sacos de cemento. Total C$400.00.')).not.toBeInTheDocument();
  });

});
