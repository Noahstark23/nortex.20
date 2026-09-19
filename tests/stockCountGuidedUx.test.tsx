// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StockCount from '../components/StockCount';
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status});
const count={id:'c',warehouseId:'w',warehouse:{id:'w',name:'Principal'},status:'OPEN',scope:'ALL',createdAt:'2026-09-19T12:00:00Z'};
const items=[
 {id:'i1',productId:'p1',expected:4,counted:null,product:{name:'Lámina',sku:'LAM-1',unit:'unidad'}},
 {id:'i2',productId:'p2',expected:3,counted:3,bookStockAtCapture:'3',product:{name:'Pintura',sku:'PIN-1',unit:'unidad'}},
];
function setup(save=(body:any)=>Promise.resolve(response({...body,bookStockAtCapture:'4'}))) {
 return vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
  const url=String(input);
  if(url==='/api/stock-counts')return response([count]);
  if(url==='/api/stock-counts/c')return response({count,items});
  if(url==='/api/warehouses')return response({data:[{id:'w',name:'Principal',isActive:true,isDefault:true}]});
  if(url==='/api/products/categories')return response([]);
  if(url.endsWith('/count'))return save(JSON.parse(String(init?.body)));
  return response({error:'Ruta inesperada'},500);
 });
}
async function open(){render(<MemoryRouter><StockCount/></MemoryRouter>);fireEvent.click(await screen.findByRole('button',{name:/Continuar/}));await screen.findAllByLabelText('Conteo físico de Lámina');}
const field=(name='Lámina')=>screen.getAllByLabelText(`Conteo físico de ${name}`)[0] as HTMLInputElement;
beforeEach(()=>{localStorage.clear();sessionStorage.clear();localStorage.setItem('nortex_user',JSON.stringify({role:'OWNER'}));});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
describe('conteo guiado sin confundir captura y confirmación',()=>{
 it('filtra pendientes y la búsqueda sin tildes incluye el catálogo completo',async()=>{
  setup();await open();fireEvent.click(screen.getByRole('button',{name:'Por contar 1'}));
  expect(screen.queryByLabelText('Conteo físico de Pintura')).toBeNull();
  fireEvent.change(screen.getByLabelText('Buscar producto o SKU'),{target:{value:'pintura'}});
  expect(field('Pintura')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Buscar producto o SKU'),{target:{value:'lamina'}});
  expect(field()).toBeInTheDocument();
 });
 it('no cuenta como guardado hasta recibir confirmación y conserva cero como captura',async()=>{
  let resolve!:(r:Response)=>void;const save=vi.fn(()=>new Promise<Response>(r=>{resolve=r;}));setup(save);await open();
  fireEvent.change(field(),{target:{value:'0'}});fireEvent.blur(field());
  expect(screen.getByRole('button',{name:'Guardados 1'})).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Revisar y terminar'})).toBeDisabled();
  expect(save).toHaveBeenCalledWith({productId:'p1',counted:0});
  await act(async()=>resolve(response({counted:0,bookStockAtCapture:'4'})));
  await screen.findByRole('button',{name:'Guardados 2'});
  fireEvent.click(screen.getByRole('button',{name:'Con diferencias 1'}));
  expect(field()).toHaveValue('0');expect(screen.queryByLabelText('Conteo físico de Pintura')).toBeNull();
  expect(screen.getByRole('checkbox',{name:'Comparar con el sistema'})).toBeChecked();
 });
 it('permite editar un guardado sin que el filtro retire el campo mientras escribís',async()=>{
  setup();await open();fireEvent.click(screen.getByRole('button',{name:'Guardados 1'}));
  const input=field('Pintura');fireEvent.focus(input);fireEvent.change(input,{target:{value:'5'}});
  expect(input).toBeInTheDocument();expect(input).toHaveValue('5');
  expect(screen.getByRole('button',{name:'Revisar y terminar'})).toBeDisabled();
 });
 it('un fallo sigue pendiente y no aparenta una captura guardada',async()=>{
  setup(async()=>response({error:'Sin conexión'},503));await open();
  fireEvent.change(field(),{target:{value:'2'}});fireEvent.blur(field());
  await waitFor(()=>expect(screen.getAllByText('No se guardó').length).toBeGreaterThan(0));
  expect(screen.getByRole('button',{name:'Guardados 1'})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Por contar 1'}));expect(field()).toHaveValue('2');
  expect(screen.getByRole('button',{name:'Revisar y terminar'})).toBeDisabled();
 });
});
