import { describe,expect,it } from 'vitest';
import Decimal from 'decimal.js';
import { calculateQuotationTotals } from '../backend/lib/quotationTotals';
const row=(price:string,quantity:string,ivaExento=false)=>({price:new Decimal(price),quantityExact:new Decimal(quantity),ivaExento});
const formatted=(items:ReturnType<typeof row>[],regime='GENERAL')=>Object.fromEntries(Object.entries(calculateQuotationTotals(items,regime)).map(([key,value])=>[key,value.toFixed(2)]));
describe('Totales compartidos de proforma',()=>{
 it('IVA incluido y exentos en varias líneas',()=>expect(formatted([row('115','2'),row('12.34','3',true)])).toEqual({subtotal:'237.02',tax:'30.00',total:'267.02'}));
 it('cuota fija mantiene bruto sin IVA',()=>expect(formatted([row('115','2'),row('12.34','3',true)],'CUOTA_FIJA')).toEqual({subtotal:'267.02',tax:'0.00',total:'267.02'}));
 it('redondea cada línea antes del desglose',()=>expect(formatted([row('0.03','0.5'),row('0.03','0.5'),row('0.03','0.5',true)])).toEqual({subtotal:'0.06',tax:'0.00',total:'0.06'}));
 it('redondeo fraccionario con IVA conserva centavos',()=>expect(formatted([row('1.15','0.5'),row('1.15','0.5')])).toEqual({subtotal:'1.00',tax:'0.16',total:'1.16'}));
 it('vacía no crea dinero',()=>expect(formatted([])).toEqual({subtotal:'0.00',tax:'0.00',total:'0.00'}));
 it('precios exactos de cuatro decimales y cantidades grandes',()=>expect(formatted([row('0.0150','1000',true)])).toEqual({subtotal:'15.00',tax:'0.00',total:'15.00'}));
});
