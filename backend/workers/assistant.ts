import prisma from '../lib/prisma.js';
import { runAssistantWorkerOnce } from '../services/assistant/worker.js';
import { cleanupExpiredAttachments,cleanupAssistantHistory } from '../services/assistant/attachments.js';
import { cleanupAssistantOperations } from '../services/assistant/operations/retention.js';
import { runPendingAssistantRunOnce } from '../services/assistant/operations/runService.js';
import { getAssistantFlags } from '../services/assistant/config.js';

let stopping=false;
process.once('SIGTERM',()=>{stopping=true;});
process.once('SIGINT',()=>{stopping=true;});
let nextCleanup=0;
async function main() {
  while(!stopping) {
    try {
      if(Date.now()>=nextCleanup) { await cleanupExpiredAttachments(); await cleanupAssistantHistory(); await cleanupAssistantOperations(); nextCleanup=Date.now()+3600_000; }
      const worked=await runAssistantWorkerOnce();
      const answered=getAssistantFlags().operationsEnabled ? await runPendingAssistantRunOnce() : false;
      if(!worked&&!answered) await new Promise(resolve=>setTimeout(resolve,2000));
    } catch {
      // Nunca imprimir documentos, prompts, datos del proveedor o credenciales.
      console.error('NortexGPT: el worker no pudo procesar la cola; reintentará.');
      await new Promise(resolve=>setTimeout(resolve,5000));
    }
  }
}
main().finally(()=>prisma.$disconnect());
