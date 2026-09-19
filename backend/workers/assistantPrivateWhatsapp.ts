import prisma from '../lib/prisma.js';
import { processPrivateWaInboxOnce } from '../services/assistant/privateWhatsapp/processor.js';
import { dispatchPrivateWaOutboxOnce,recoverPrivateWaSending } from '../services/assistant/privateWhatsapp/outbox.js';
import { cleanupPrivateWaHistory } from '../services/assistant/privateWhatsapp/retention.js';
import { privateWhatsappConfig } from '../services/assistant/privateWhatsapp/config.js';

let stopping=false,nextCleanup=0;
process.once('SIGTERM',()=>{stopping=true;});process.once('SIGINT',()=>{stopping=true;});
async function main() {
  while(!stopping) {
    try {
      if(!privateWhatsappConfig().enabled){await new Promise(resolve=>setTimeout(resolve,5000));continue;}
      await recoverPrivateWaSending();
      if(Date.now()>=nextCleanup){await cleanupPrivateWaHistory();nextCleanup=Date.now()+3600_000;}
      const processed=await processPrivateWaInboxOnce(),sent=await dispatchPrivateWaOutboxOnce();
      if(!processed&&!sent)await new Promise(resolve=>setTimeout(resolve,1000));
    }catch {console.error('NortexGPT: el canal privado no pudo completar una tarea.');await new Promise(resolve=>setTimeout(resolve,5000));}
  }
}
main().finally(()=>prisma.$disconnect());
