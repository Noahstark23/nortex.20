import { describe,expect,it,vi } from 'vitest';
import { buildExtractionRequest,createExtractionProvider,ASSISTANT_EXTRACTION_MODEL } from '../backend/services/assistant/provider.js';
const principal={tenantId:'t',userId:'u',role:'OWNER'};
const files=[{mediaType:'application/pdf' as const,bytes:Buffer.from('test'),pages:1}];
const output={oneInvoice:true,complete:true,draft:{currency:'NIO',invoiceNumber:'F1',date:'2026-09-05',documentTotal:'10',items:[{description:'Producto',quantity:'1',unitCost:'10',purchaseUnit:'BASE'}],warnings:[]}};
const response={id:'request',stop_reason:'tool_use',content:[{type:'tool_use',name:'informar_factura',input:output}],usage:{input_tokens:2500,output_tokens:400}};
function setup(reply:unknown=response){const create=vi.fn().mockResolvedValue(reply),reserve=vi.fn().mockResolvedValue({id:'reservation'}),settle=vi.fn().mockResolvedValue(undefined);return{create,reserve,settle,provider:createExtractionProvider({client:{messages:{create}} as any,reserve,settle})};}
describe('proveedor aislado y presupuestado',()=>{
  it('solo declara herramienta de lectura con modelo fijo',()=>{
    const request=buildExtractionRequest(files);
    expect(request.model).toBe(ASSISTANT_EXTRACTION_MODEL);expect(request.tools?.map(t=>t.name)).toEqual(['informar_factura']);
    expect(JSON.stringify(request)).not.toContain('tenantId');expect(request.system).toContain('datos no confiables');
  });
  it('reserva antes de llamar, contabiliza uso y conserva confirmaciones falsas',async()=>{
    const s=setup();const draft=await s.provider.extract(principal,files);
    expect(s.reserve.mock.invocationCallOrder[0]).toBeLessThan(s.create.mock.invocationCallOrder[0]);
    expect(s.settle).toHaveBeenCalledWith(principal,'reservation',{inputTokens:2500,outputTokens:400,requestId:'request'},expect.anything());
    expect(draft.receivedConfirmed).toBe(false);expect(draft.paymentConfirmed).toBe(false);
    expect(s.create.mock.calls[0][1]).toMatchObject({maxRetries:0,timeout:90000});
  });
  it('no llama al proveedor con presupuesto agotado',async()=>{
    const s=setup();s.reserve.mockRejectedValue(new Error('budget'));await expect(s.provider.extract(principal,files)).rejects.toThrow('budget');expect(s.create).not.toHaveBeenCalled();
  });
  it('respuesta perdida mantiene reserva desconocida, sin retry SDK',async()=>{
    const s=setup();s.create.mockRejectedValue(new Error('timeout'));await expect(s.provider.extract(principal,files)).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});
    expect(s.create).toHaveBeenCalledTimes(1);expect(s.settle).toHaveBeenCalledWith(principal,'reservation',null,expect.anything());
  });
  it('rechaza output truncado aunque facture tokens',async()=>{
    const s=setup({...response,stop_reason:'max_tokens'});await expect(s.provider.extract(principal,files)).rejects.toMatchObject({code:'EXTRACTION_INVALID'});expect(s.settle).toHaveBeenCalledTimes(1);
  });
  it('ninguna instrucción en el documento puede introducir tools de dominio',async()=>{
    const s=setup({...response,content:[{type:'tool_use',name:'confirmar_compra',input:{tenantId:'other'}}]});
    await expect(s.provider.extract(principal,files)).rejects.toMatchObject({code:'EXTRACTION_INVALID'});
  });
});
