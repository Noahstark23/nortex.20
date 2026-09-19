// @vitest-environment jsdom
import React from 'react';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {QuotationCatalog} from '../components/quotations/QuotationCatalog';
import type {Product} from '../types';
afterEach(cleanup);
const product={id:'p',name:'Lámina gris',sku:'LAM-01',brand:'Acme',price:115,stock:0,unit:'unidad',category:'Construcción'} as Product;
const props=()=>({products:[product],cart:[],loading:false,error:false,onRetry:vi.fn(),onAdd:vi.fn()});
describe('catálogo de proformas',()=>{
 it('busca sin tildes, por marca y agrega un código exacto con Enter',()=>{
  const p=props();render(<QuotationCatalog {...p}/>);const input=screen.getByLabelText('Buscá o escaneá un producto');
  for(const value of ['lamina','Acme','LAM-01']){fireEvent.change(input,{target:{value}});expect(screen.getByRole('button',{name:/Agregar Lámina gris/})).toBeVisible();}
  fireEvent.keyDown(input,{key:'Enter'});expect(p.onAdd).toHaveBeenCalledWith(product);expect(input).toHaveValue('');
 });
 it('no escoge arbitrariamente entre coincidencias',()=>{
  const p=props();render(<QuotationCatalog {...p} products={[product,{...product,id:'p2',sku:'LAM-02'}]}/>);
  fireEvent.change(screen.getByLabelText('Buscá o escaneá un producto'),{target:{value:'lamina'}});
  fireEvent.keyDown(screen.getByLabelText('Buscá o escaneá un producto'),{key:'Enter'});
  expect(p.onAdd).not.toHaveBeenCalled();expect(screen.getByRole('status')).toHaveTextContent('varias coincidencias');
 });
 it('distingue error de catálogo vacío y permite reintentar',()=>{
  const p=props();render(<QuotationCatalog {...p} products={[]} error/>);
  expect(screen.getByRole('alert')).toHaveTextContent('No pudimos cargar');expect(screen.queryByText('Tu catálogo está vacío')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Reintentar'}));expect(p.onRetry).toHaveBeenCalledOnce();
 });
 it('declara el recorte y permite mostrar más',()=>{
  render(<QuotationCatalog {...props()} products={Array.from({length:30},(_,i)=>({...product,id:String(i),sku:String(i)}))}/>);
  expect(screen.getByText('24 de 30')).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'Mostrar más productos'}));expect(screen.getByText('30 productos')).toBeVisible();
 });
});
