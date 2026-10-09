import { describe,expect,it } from 'vitest';
import { shouldUseOperationalRun } from '../backend/services/assistant/operations/routing';

describe('enrutamiento de operaciones en la misma conversación',()=>{
  it.each(['Compré 50 bolsas de cemento','Completar por aquí','cancelar compra','sí','C$ 230','son 60, no 50','son 60 cajas','el precio de caja es 500','son las cajas grandes'])('conserva respuestas de compra: %s',text=>{
    expect(shouldUseOperationalRun(text,true)).toBe(false);
  });
  it.each(['¿Cómo va mi negocio?','Compará ventas y gastos','Comparalo con ayer','Prepará una orden de compra','Revisá los vencidos','Explicá el aviso a56f','Buscá cemento','Revisá mis cierres de caja de la última semana','Mi semana con cuentas claras'])('permite interrumpir compra con consulta: %s',text=>{
    expect(shouldUseOperationalRun(text,true)).toBe(true);
  });
  it.each(['sí','confirmo','confirmalo','ejecutalo'])('una confirmación aislada no inicia una ejecución: %s',text=>{
    expect(shouldUseOperationalRun(text,false)).toBe(false);
  });
  it.each(['Mostrame cuáles productos','Prepará la acción','mostrame cuáles','preparala','Necesito entender qué está pasando'])('sin captura deja lenguaje libre al orquestador: %s',text=>{
    expect(shouldUseOperationalRun(text,false)).toBe(true);
  });
  it.each(['Mostrame cuáles productos','Prepará la acción','preparala'])('con compra conserva el seguimiento de la última consulta operativa: %s',text=>{
    expect(shouldUseOperationalRun(text,true,true)).toBe(true);
    expect(shouldUseOperationalRun(text,true,false)).toBe(false);
  });
  it.each(['son 60, no 50','C$ 230','sí','Retomemos la compra','2026-09-05'])('volver a la compra no hereda modo operativo: %s',text=>{
    expect(shouldUseOperationalRun(text,true,true)).toBe(false);
  });
});
