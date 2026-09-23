import { describe, expect, it, vi } from 'vitest';
import { runAssistantWorkerCycle } from '../backend/services/assistant/operations/workerCycle';

function fixture() {
  return { enabled:true,extractionEnabled:false,operationsEnabled:false,nowMs:3_600_000,nextCleanupAt:0,
    cleanup:vi.fn(async()=>undefined),extract:vi.fn(async()=>true),operate:vi.fn(async()=>true) };
}

describe('ciclo del worker NortexGPT', () => {
  it('conserva retención sin reclamar trabajos cuando el asistente está apagado', async () => {
    const deps=fixture();deps.enabled=false;
    expect(await runAssistantWorkerCycle(deps)).toEqual({worked:false,nextCleanupAt:7_200_000});
    expect(deps.cleanup).toHaveBeenCalledOnce();
    expect(deps.extract).not.toHaveBeenCalled();
    expect(deps.operate).not.toHaveBeenCalled();
  });
  it('conserva la cola de facturas cuando extracción está apagada', async () => {
    const deps=fixture();deps.operationsEnabled=true;
    expect(await runAssistantWorkerCycle(deps)).toEqual({worked:true,nextCleanupAt:7_200_000});
    expect(deps.cleanup).toHaveBeenCalledOnce();
    expect(deps.extract).not.toHaveBeenCalled();
    expect(deps.operate).toHaveBeenCalledOnce();
  });
  it('ejecuta únicamente las capacidades habilitadas y respeta la cadencia de limpieza', async () => {
    const deps=fixture();deps.extractionEnabled=true;deps.nextCleanupAt=3_600_001;
    expect(await runAssistantWorkerCycle(deps)).toEqual({worked:true,nextCleanupAt:3_600_001});
    expect(deps.cleanup).not.toHaveBeenCalled();
    expect(deps.extract).toHaveBeenCalledOnce();
    expect(deps.operate).not.toHaveBeenCalled();
  });
});
