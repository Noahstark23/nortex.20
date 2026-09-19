// @vitest-environment jsdom
import React from 'react';
import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,it,expect} from 'vitest';
import {StockCountCloseReview} from '../components/inventory/StockCountCloseReview';
afterEach(cleanup);
it('revisa solo diferencias confirmadas y usa el saldo de la captura, sin convertir vacíos en cero',()=>{
 render(<StockCountCloseReview items={[
  {id:'a',counted:0,expected:9,bookStockAtCapture:'2',product:{name:'Clavo',unit:'unidad'}},
  {id:'b',counted:null,expected:9,product:{name:'Sin contar',unit:'unidad'}},
  {id:'c',counted:3,expected:9,bookStockAtCapture:'3',product:{name:'Igual',unit:'unidad'}},
 ]}/>);
 expect(screen.getByText('1 producto con diferencia')).toBeTruthy();
 expect(screen.getByText('Sistema: 2 unidad → Contado: 0 unidad')).toBeTruthy();
 expect(screen.queryByText('Sin contar')).toBeNull();expect(screen.queryByText('Igual')).toBeNull();
});
