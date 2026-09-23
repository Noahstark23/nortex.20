import { cleanupAssistantWorkItems } from '../services/assistant/workItems/cleanup.js';
import prisma from '../lib/prisma.js';
import { runAssistantWorkerOnce } from '../services/assistant/worker.js';
import { cleanupExpiredAttachments,cleanupAssistantHistory } from '../services/assistant/attachments.js';
import { cleanupAssistantOperations } from '../services/assistant/operations/retention.js';
import { runPendingAssistantRunOnce } from '../services/assistant/operations/runService.js';
import { getAssistantFlags } from '../services/assistant/config.js';
import { runAssistantWorkerCycle } from '../services/assistant/operations/workerCycle.js';
import { recordAssistantWorkerHeartbeat } from '../services/assistant/operations/workerHeartbeat.js';

let stopping=false;
process.once('SIGTERM',()=>{stopping=true;});
process.once('SIGINT',()=>{stopping=true;});
let nextCleanup=0;
let nextHeartbeat=0;
async function main() {
  while(!stopping) {
    try {
      const flags=getAssistantFlags();
      const cycle=await runAssistantWorkerCycle({
        enabled:flags.enabled,extractionEnabled:flags.extractionEnabled,operationsEnabled:flags.operationsEnabled,
        nowMs:Date.now(),nextCleanupAt:nextCleanup,
        cleanup:async()=>{await cleanupExpiredAttachments();await cleanupAssistantWorkItems();await cleanupAssistantHistory();await cleanupAssistantOperations();},
        extract:()=>runAssistantWorkerOnce(),operate:()=>runPendingAssistantRunOnce(),
      });
      nextCleanup=cycle.nextCleanupAt;
      if(Date.now()>=nextHeartbeat) {
        await recordAssistantWorkerHeartbeat(!flags.enabled?'disabled':cycle.worked?'working':'idle');
        nextHeartbeat=Date.now()+30_000;
      }
      if(!cycle.worked) await new Promise(resolve=>setTimeout(resolve,flags.enabled?2000:5000));
    } catch {
      // Nunca imprimir documentos, prompts, datos del proveedor o credenciales.
      console.error('NortexGPT: el worker no pudo procesar la cola; reintentará.');
      await recordAssistantWorkerHeartbeat('error').catch(()=>undefined);
      await new Promise(resolve=>setTimeout(resolve,5000));
    }
  }
}
main().finally(()=>prisma.$disconnect());
