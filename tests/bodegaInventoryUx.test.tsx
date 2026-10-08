// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import Inventory from '../components/Inventory';

vi.mock('../components/ProductImporter', () => ({ default: ({ onSuccess, onClose }: any) => <div role="dialog" aria-label="Importación"><button onClick={onSuccess}>Simular importación parcial</button><p>Fila rechazada: revisar código</p><button onClick={onClose}>Cerrar importación</button></div> }));
const products = ['A', 'B'].map(letter => ({id: letter, name: `Producto ${letter}`, sku: `SKU-${letter}`, stock: 5, minStock: 2, unit: 'unidad', price: 10, cost: 5, requiresBatchTracking: true}));
const ok = (body: unknown) => ({ok: true, status: 200, json: async () => body});
let calls: ReturnType<typeof vi.fn>;
beforeEach(() => {
 localStorage.clear();
 localStorage.setItem('nortex_user', JSON.stringify({id:'qa-user', role:'OWNER'}));
 localStorage.setItem('nortex_token','qa-fixture');
 calls=vi.fn(async(input: unknown, init?: RequestInit) => {
  const path=new URL(String(input),'http://localhost').pathname;
  if(/^\/api\/warehouses\/product\/[^/]+\/stock$/.test(path)){const id=path.split('/')[4];return ok({success:true,data:{productId:id,totalStock:'5.0000',unit:'unidad',warehouses:[{id:'w1',name:'Principal',isActive:true,isDefault:true,stock:'5.0000',implicit:false}],hasMore:false}});}
  if(path==='/api/products')return ok({products,total:2});
  if(path==='/api/inventory/batches/A')return ok([{id:'lot-a',batchNumber:'LOTE-A',expiryDate:'2027-01-01',stock:5}]);
  if(path==='/api/inventory/batches/B')return {ok:false,status:503,json:async()=>({error:'No se pudieron cargar los lotes de B.'})};
  if(path==='/api/warehouses')return ok({data:[{id:'w1',name:'Principal',isActive:true,isDefault:true}]});
  if(path==='/api/products/categories'||path==='/api/suppliers')return ok([]);
  return ok({});
 });
 vi.stubGlobal('fetch',calls);
});
afterEach(()=>{cleanup();localStorage.clear();vi.unstubAllGlobals();});
async function mount(){render(<MemoryRouter initialEntries={['/app/inventory']}><Inventory/></MemoryRouter>);await screen.findAllByText('Producto A');}
async function batches(letter:string){fireEvent.click(screen.getByRole('button',{name:`Ver Producto ${letter}`}));fireEvent.click(screen.getAllByRole('button',{name:`Más acciones de Producto ${letter}`})[0]);fireEvent.click(screen.getByRole('menuitem',{name:'Lotes y vencimientos'}));return screen.findByRole('dialog',{name:`Lotes de Producto ${letter}`});}
describe('Bodega: recuperación y ficha del producto',()=>{
 it('no presenta lotes de A bajo B cuando falla la carga de B',async()=>{
  await mount();let dialog=await batches('A');await within(dialog).findByText('LOTE-A');
  fireEvent.click(within(dialog).getByRole('button',{name:'Cerrar lotes activos'}));
  dialog=await batches('B');await within(dialog).findByRole('alert');
  expect(within(dialog).queryByText('LOTE-A')).not.toBeInTheDocument();
  expect(within(dialog).getByRole('button',{name:/Agregar lote/})).toBeDisabled();
 });
 it('conserva el resumen de importación parcial hasta que la persona cierre',async()=>{
  await mount();fireEvent.click(screen.getByRole('button',{name:'Más herramientas de productos'}));
  fireEvent.click(screen.getByRole('menuitem',{name:'Importar desde Excel'}));
  fireEvent.click(screen.getByRole('button',{name:'Simular importación parcial'}));
  expect(screen.getByRole('dialog',{name:'Importación'})).toBeInTheDocument();
  expect(screen.getByText('Fila rechazada: revisar código')).toBeInTheDocument();
 });
 it('permite corregir código y mínimo en ficha sin enviar existencias',async()=>{
  await mount();fireEvent.click(screen.getByRole('button',{name:'Ver Producto A'}));fireEvent.click(screen.getByRole('button',{name:'Editar Producto A'}));
  fireEvent.change(screen.getByRole('textbox',{name:'Código del producto'}),{target:{value:'SKU-A-NUEVO'}});
  fireEvent.change(screen.getByRole('textbox',{name:'Avisarme cuando queden'}),{target:{value:'3'}});
  fireEvent.click(screen.getByRole('button',{name:/Guardar Cambios/i}));
  await waitFor(()=>expect(calls.mock.calls.some(([url,init])=>String(url)==='/api/products/A'&&init?.method==='PUT')).toBe(true));
  const [,request]=calls.mock.calls.find(([url,init])=>String(url)==='/api/products/A'&&init?.method==='PUT')!;
  const body=JSON.parse(request!.body as string);expect(body).toMatchObject({sku:'SKU-A-NUEVO',minStock:'3'});expect(body).not.toHaveProperty('stock');
 });
});
