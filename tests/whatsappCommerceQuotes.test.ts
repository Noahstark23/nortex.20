import { describe, expect, it, vi } from 'vitest';
import { handleCommerceMessage } from '../backend/services/whatsapp/commerce/conversation';

vi.mock('../backend/services/whatsapp/commerce/policy', () => ({
  parseCommercePolicy: () => ({eligibleProductIds:['p1','p2'],autoQuote:false,ttlHours:24,maxTotal:'1000.00',maxLines:2,eligibilityAttested:true}),
}));

const now = new Date('2026-09-29T12:00:00Z');
const channel = {id:'ch',tenantId:'tenant',commercePolicyVersion:1};
const inbox = (body:string) => ({id:'in1',providerMessageId:'mid1',tenantId:'tenant',channelId:'ch',conversationId:'conv',waId:'50588889999',body});
const conversation = (draftState:unknown=null) => ({id:'conv',tenantId:'tenant',channelId:'ch',waId:'50588889999',status:'BOT',optedOutAt:null,draftState});

describe('WhatsApp comercial: selección antes de cotizar',()=>{
  it('un nombre con dos productos exige opción exacta y conserva ambos IDs',async()=>{
    const save=vi.fn().mockResolvedValue({});
    const tx={product:{findMany:vi.fn().mockResolvedValue([
      {id:'p1',name:'Martillo de uña',sku:'M1',unit:'unidad',price:100},
      {id:'p2',name:'Martillo de goma',sku:'M2',unit:'unidad',price:80},
    ])},waCommerceConversation:{update:save}};
    const result=await handleCommerceMessage(tx as any,inbox('martillo') as any,conversation() as any,channel as any,now);
    expect(result.text).toContain('1. Martillo de uña');
    expect(result.text).toContain('2. Martillo de goma');
    expect(save.mock.calls[0][0].data.draftState.options.map((option:any)=>option.id)).toEqual(['p1','p2']);
    expect(tx.product.findMany.mock.calls[0][0].where).toMatchObject({tenantId:'tenant',isPublished:true,requiresBatchTracking:false,requiresSerialTracking:false});
  });
  it('rechaza cero antes de crear un borrador',async()=>{
    const tx={waCommerceConversation:{update:vi.fn()},product:{findFirst:vi.fn()}};
    const result=await handleCommerceMessage(tx as any,inbox('0') as any,conversation({stage:'QUANTITY',selectedId:'p1',selectedName:'Martillo'}) as any,channel as any,now);
    expect(result.text).toContain('mayor que cero');
    expect(tx.product.findFirst).not.toHaveBeenCalled();
  });
  it('no expone saldo ni atiende después de BAJA',async()=>{
    const tx={};
    const result=await handleCommerceMessage(tx as any,inbox('mi saldo') as any,{...conversation(),optedOutAt:now} as any,channel as any,now);
    expect(result.text).toBeNull();
  });
});
