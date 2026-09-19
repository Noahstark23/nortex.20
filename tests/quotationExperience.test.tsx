// @vitest-environment jsdom
import React from 'react';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {MemoryRouter} from 'react-router-dom';
import QuotationManager from '../components/QuotationManager';
const product={id:'p1',name:'Cemento gris',sku:'CEM-01',price:115,stock:10,unit:'unidad',saleMode:'COUNTED',quantityStep:1,category:'Construcción'};
let posted:any;
let failSave=false;
beforeEach(()=>{posted=undefined;failSave=false;localStorage.clear();vi.spyOn(window,'alert').mockImplementation(()=>{});vi.stubGlobal('fetch',vi.fn(async(input,init)=>{
 const url=String(input);
 if(url==='/api/products')return new Response(JSON.stringify([product]));
 if(url==='/api/tenant/fiscal-settings')return new Response(JSON.stringify({fiscalRegime:'GENERAL',fiscalRegimeVersion:1}));
 if(url==='/api/quotations'&&init?.method==='POST'){posted=JSON.parse(init.body);return new Response(JSON.stringify(failSave?{error:'No se pudo guardar'}:{...posted,id:'Q1',createdAt:new Date().toISOString(),total:230,status:'SENT'}),{status:failSave?503:200});}
 return new Response(JSON.stringify(url.includes('/tenant/')?{}:[]));
}));});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
const mount=()=>render(<MemoryRouter><QuotationManager/></MemoryRouter>);
describe('crear proforma',()=>{
 it('envía identidad y cantidad al servidor y muestra la proforma confirmada',async()=>{
  mount();fireEvent.click(await screen.findByRole('button',{name:/Cemento gris/}));
  fireEvent.change(screen.getByLabelText('Cantidad de Cemento gris'),{target:{value:'2'}});
  fireEvent.change(screen.getByPlaceholderText('Nombre del Cliente'),{target:{value:'Cliente QA'}});
  fireEvent.click(screen.getByRole('button',{name:/guardar/i}));
  await waitFor(()=>expect(posted).toMatchObject({customerName:'Cliente QA',items:[{productId:'p1',quantity:'2'}]}));
  expect(posted.items[0]).not.toHaveProperty('price');
  expect(await screen.findByText('Cliente QA')).toBeVisible();
 });
 it('conserva productos y cliente si falla el guardado',async()=>{
  failSave=true;mount();fireEvent.click(await screen.findByRole('button',{name:/Cemento gris/}));
  fireEvent.change(screen.getByPlaceholderText('Nombre del Cliente'),{target:{value:'Cliente QA'}});
  fireEvent.click(screen.getByRole('button',{name:/guardar/i}));
  await waitFor(()=>expect(posted).toBeDefined());
  expect(screen.getByLabelText('Cantidad de Cemento gris')).toHaveValue('1');
  expect(screen.getByPlaceholderText('Nombre del Cliente')).toHaveValue('Cliente QA');
 });
 it('conserva el borrador al consultar guardadas y al quitar una línea inválida',async()=>{
  mount();fireEvent.click(await screen.findByRole('button',{name:/Agregar Cemento gris,/}));
  fireEvent.change(screen.getByLabelText('Cliente o empresa'),{target:{value:'Cliente QA'}});
  fireEvent.click(screen.getByRole('button',{name:'Guardadas'}));
  fireEvent.click(screen.getByRole('button',{name:'Nueva proforma'}));
  expect(screen.getByLabelText('Cliente o empresa')).toHaveValue('Cliente QA');
  expect(screen.getByLabelText('Cantidad de Cemento gris')).toHaveValue('1');
  fireEvent.change(screen.getByLabelText('Cantidad de Cemento gris'),{target:{value:''}});
  fireEvent.click(screen.getByRole('button',{name:'Quitar Cemento gris'}));
  fireEvent.click(screen.getByRole('button',{name:/Agregar Cemento gris,/}));
  expect(screen.getByRole('button',{name:'Guardar proforma'})).toBeEnabled();
 });
 it('bloquea doble envío mientras espera la confirmación',async()=>{
  const fetchOriginal=globalThis.fetch;let resolvePost:(response:Response)=>void;
  vi.stubGlobal('fetch',vi.fn((input,init)=>init?.method==='POST'?new Promise<Response>(resolve=>{resolvePost=resolve;}):fetchOriginal(input,init)));
  mount();fireEvent.click(await screen.findByRole('button',{name:/Agregar Cemento gris,/}));
  fireEvent.change(screen.getByLabelText('Cliente o empresa'),{target:{value:'Cliente QA'}});
  fireEvent.click(screen.getByRole('button',{name:'Guardar proforma'}));
  expect(screen.getByRole('button',{name:'Guardando…'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Guardando…'}));
  expect(vi.mocked(fetch).mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1);
  resolvePost!(new Response('{}',{status:503}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Tu proforma sigue aquí');
 });

});
