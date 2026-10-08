import { describe, expect, it } from 'vitest';
import { offlineSaleSchema, normalizeOfflineSalePayload } from '../backend/routes/syncPayload';
import { CreateSaleSchema } from '../backend/validation/schemas';

const offline={offlineId:'attempt-123',tenantId:'tenant-test',paymentMethod:'CASH',items:[{id:'product-test',quantity:'2',price:'100'}],createdAt:'2026-09-05T18:00:00Z'};
describe('promociones: frontera offline independiente',()=>{
  it('conserva la identidad y el comportamiento de una venta offline habitual',()=>{
    const value=offlineSaleSchema.parse(offline);
    expect(normalizeOfflineSalePayload(value)).toMatchObject({offlineId:'attempt-123',source:'OFFLINE_SYNC',items:[{id:'product-test',quantity:'2',price:'100'}]});
  });
  it.each(['promotionQuote','promotionSnapshot'])('rechaza %s en la venta offline sin reinterpretarla como venta ordinaria',field=>{
    expect(offlineSaleSchema.safeParse({...offline,[field]:{id:'promo-test',version:1}}).success).toBe(false);
  });
  it('no admite un snapshot de promoción enviado en una línea offline',()=>{
    expect(offlineSaleSchema.safeParse({...offline,items:[{...offline.items[0],promotionSnapshot:{unitPrice:'1'}}]}).success).toBe(false);
  });
  it('la frontera legacy rechaza una referencia que no sabe ejecutar',()=>{
    const old={items:[{productId:'product-test',quantity:2,price:100}],paymentMethod:'CASH'};
    expect(CreateSaleSchema.safeParse(old).success).toBe(true);
    expect(CreateSaleSchema.safeParse({...old,promotionQuote:{id:'quote-test',version:1}}).success).toBe(false);
    expect(CreateSaleSchema.safeParse({...old,items:[{...old.items[0],promotionSnapshot:{unitPrice:'1'}}]}).success).toBe(false);
  });
});
