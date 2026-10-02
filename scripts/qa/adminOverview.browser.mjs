// Chromium headless instalado, CDP nativo; no descarga paquetes ni abre UI visible.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, access, unlink } from 'node:fs/promises';
const out = new URL(process.env.NORTEX_ADMIN_BROWSER_OUT ?? '../../../evidence/browser/', import.meta.url);
await mkdir(out, {recursive:true});
const qaDir = process.env.NORTEX_ADMIN_QA_DIR ?? '/tmp/nortex-admin-qa-20260930';
const transportFile = qaDir + '/metrics-transport-failure';
const sessions = JSON.parse(await readFile(qaDir + '/ui-session.json', 'utf8'));
const tabs = await (await fetch('http://127.0.0.1:9341/json/list')).json();
const target = tabs.find(t=>t.type==='page'); assert(target);
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
let serial=0;let sequence=0;const pending=new Map();const requests=[];const requestURLs=new Map();const responses=new Map();const canceledRequests=new Set();const failedRequests=[];const interceptionTasks=new Set();const fetchStates=new Map();const trace=[];const interceptionErrors=[];const cleanupErrors=[];let confirmedCanceledInterceptions=0;let ownsTransportFlag=false;let serverRestored=false;let uiError;
function record(event){trace.push({sequence:++sequence,...event});}
function errorDetails(error){return {message:error.message,commandId:error.commandId,command:error.command,cdpError:error.cdpError};}
ws.addEventListener('message',e=>{
 const d=JSON.parse(e.data);
 if(d.id){
  const p=pending.get(d.id);pending.delete(d.id);
  if(p?.method.startsWith('Fetch.'))record({event:'CDP_RESULT',fetchId:p.fetchId??null,commandId:d.id,command:p.method,cdpError:d.error??null});
  if(d.error){const error=Object.assign(new Error(d.error.message),{commandId:d.id,command:p?.method,cdpError:d.error});p?.reject(error);}else p?.resolve(d.result);
 }
 if(d.method==='Network.requestWillBeSent'){requests.push({url:d.params.request.url,method:d.params.request.method});requestURLs.set(d.params.requestId,d.params.request.url);}
 if(d.method==='Network.responseReceived')responses.set(d.params.requestId,{status:d.params.response.status,url:d.params.response.url});
 if(d.method==='Network.loadingFailed'){const failure={...d.params,url:requestURLs.get(d.params.requestId),transportFailureActive:ownsTransportFlag};failedRequests.push(failure);record({event:d.method,...failure});if(d.params.canceled)canceledRequests.add(d.params.requestId);}
 if(d.method==='Fetch.requestPaused'){
  interceptionErrors.push({message:'Unexpected Fetch pause while interception is disabled',fetchId:d.params.requestId});
  const fetchId=d.params.requestId;const phase=Object.hasOwn(d.params,'responseStatusCode')||Object.hasOwn(d.params,'responseErrorReason')?'Response':'Request';
  const event={event:d.method,fetchId,networkId:d.params.networkId??null,method:d.params.request.method,url:d.params.request.url,phase,responseErrorReason:d.params.responseErrorReason??null,responseStatusCode:d.params.responseStatusCode??null};record(event);
  if(fetchStates.has(fetchId)){interceptionErrors.push({message:'Duplicate Fetch.requestPaused ID; no second resolution sent',...event,first:{...fetchStates.get(fetchId)}});return;}
  const state={fetchId,networkId:event.networkId,method:event.method,url:event.url,phase,pausedSequence:sequence,status:'resolving'};fetchStates.set(fetchId,state);
  const u=new URL(d.params.request.url);const allowed=u.hostname==='127.0.0.1'||u.protocol==='data:';
  const task=send(allowed?'Fetch.continueRequest':'Fetch.failRequest',allowed?{requestId:fetchId}:{requestId:fetchId,errorReason:'BlockedByClient'}).then(()=>{state.status='resolved';}).catch(error=>{state.status='rejected';state.error=errorDetails(error);}).finally(()=>interceptionTasks.delete(task));interceptionTasks.add(task);
 }
});
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++serial;const fetchId=params.requestId;pending.set(id,{resolve,reject,method,fetchId});const state=fetchStates.get(fetchId);if(state){state.commandId=id;state.command=method;}if(method.startsWith('Fetch.'))record({event:'CDP_COMMAND',fetchId:fetchId??null,commandId:id,command:method,phase:state?.phase});ws.send(JSON.stringify({id,method,params}));});}
async function drainInterceptions(){while(interceptionTasks.size)await Promise.all([...interceptionTasks]);}
async function transportFailure(enabled){
 if(enabled){await writeFile(transportFile,'synthetic transport failure only',{flag:'wx',mode:0o600});ownsTransportFlag=true;}
 else if(ownsTransportFlag){await unlink(transportFile);ownsTransportFlag=false;}
 record({event:'FIXTURE_TRANSPORT_MODE',enabled});
}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text);return r.result?.value;}
async function wait(expression,ms=8000){const start=Date.now();while(Date.now()-start<ms){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,75));}throw new Error('UI condition timed out: '+expression);}
async function shot(name){const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(new URL(name+'.png',out),Buffer.from(r.data,'base64'));}
async function viewport(width,height){await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});}
async function navigate(){await send('Page.navigate',{url:'http://127.0.0.1:33318/admin'});await wait('document.readyState === "complete"');}
async function auth(key){await evaluate(`localStorage.setItem('nortex_token', ${JSON.stringify(sessions[key])});localStorage.setItem('nortex_user', JSON.stringify({id:'synthetic',role:${JSON.stringify(key==='admin'?'SUPER_ADMIN':'OWNER')}}));`);await navigate();}
const checks=[];async function check(name,fn){await fn();checks.push(name);}
try{
 try{await access(transportFile);throw new Error('Fixture transport flag already exists; do not overwrite unknown state.');}catch(error){if(error.code!=='ENOENT')throw error;}
 await send('Page.enable');await send('Runtime.enable');await send('Network.enable');await send('Network.setBypassServiceWorker',{bypass:true});await send('Network.setCacheDisabled',{cacheDisabled:true});await send('Fetch.disable');
 // Bloquea recursos externos observados (analytics HTTPS) sin pausar Fetch.
 await send('Network.setBlockedURLs',{urls:['https://*','ws://*','wss://*']});
 await viewport(1440,1000);await navigate();
 // Cada ejecución empieza anónima aunque un intento anterior dejó el perfil
 // descartable autenticado. Sólo limpia la sesión sintética de este origen.
 await evaluate("for(const key of ['nortex_token','nortex_user','nortex_tenant_id','nortex_tenant_data'])localStorage.removeItem(key);window.dispatchEvent(new Event('nortex:data-changed'));");
 await navigate();
 await check('Sin sesión: acceso reservado, ninguna cuenta ni herramientas privadas',async()=>{await wait('document.body.innerText.includes("Acceso reservado")');assert.equal(await evaluate('document.querySelectorAll("[aria-label=\\"Lista de negocios\\"] article").length'),0);});
 await shot('anonymous');
 await auth('admin');
 await wait('document.body.innerText.includes("Cuentas para revisar")');
 await check('Carga de admin real sobre HTTP y MySQL sintético',async()=>{assert.equal(await evaluate('document.querySelectorAll("[aria-label=\\"Lista de negocios\\"] article").length'),50);assert(await evaluate('document.body.innerText.includes("MRR: Desconocido")'));});
 await shot('desktop');
 await check('No hay acciones score, wallet, préstamos ni cobros en el panel',async()=>{const labels=await evaluate('Array.from(document.querySelectorAll("button")).map(b=>b.innerText).join(" ")');assert(!/recalcular.score|aprobar.préstamo|wallet|cobrar|reactivar/i.test(labels));});
 await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.innerText==="Siguiente").click()');
 await wait('document.body.innerText.includes("Página 2 de 2")');
 await check('Paginación llega a seis cuentas restantes',async()=>assert.equal(await evaluate('document.querySelectorAll("[aria-label=\\"Lista de negocios\\"] article").length'),6));
 await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.innerText==="Anterior").click()');await wait('document.body.innerText.includes("Página 1 de 2")');
 await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.innerText.startsWith("Sin primera venta")).click()');
 await wait('document.body.innerText.includes("1 cuentas coinciden")');
 await check('Indicador filtra el negocio real sin primera venta',async()=>assert.equal(await evaluate('document.querySelectorAll("[aria-label=\\"Lista de negocios\\"] article")[0]?.innerText.includes("real-b")'),true));
 await shot('filtered');
 await check('Cambio de vista revela evidencia, sin completar fechas',async()=>{await evaluate('document.querySelector("[aria-label=\\"Lista de negocios\\"] summary").click()');assert(await evaluate('document.querySelector("[aria-label=\\"Lista de negocios\\"] details").open'));});
 await viewport(390,844);
 await check('Móvil390px sin overflow horizontal de documento',async()=>assert(await evaluate('document.documentElement.scrollWidth <= innerWidth')));
 await shot('mobile');
 await evaluate('const i=document.querySelector("input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(i,"zz_synthetic_no_match");i.dispatchEvent(new Event("input",{bubbles:true}));');
 await evaluate('document.querySelector("form").requestSubmit()');
 await wait('document.body.innerText.includes("0 cuentas coinciden")');
 await check('Filtro vacío presenta ausencia de coincidencias, no fallo de datos',async()=>assert(await evaluate('document.body.innerText.includes("No hay cuentas en esta página")')));
 await auth('owner');
 await check('OWNER con JWT elevado no obtiene admin ni herramientas',async()=>{await wait('document.body.innerText.includes("Acceso reservado")');assert.equal(await evaluate('document.querySelectorAll("[aria-label=\\"Lista de negocios\\"] article").length'),0);});
 await shot('denied');
 await auth('admin');await wait('document.body.innerText.includes("Cuentas para revisar")');
 await evaluate(`localStorage.setItem('nortex_token', ${JSON.stringify(sessions.owner)});localStorage.setItem('nortex_user', JSON.stringify({id:'synthetic-owner',role:'OWNER'}));window.dispatchEvent(new StorageEvent('storage',{key:'nortex_token'}));`);
 await check('Cambio A a OWNER B sin recarga retira datos y herramientas cacheados',async()=>{await wait('document.body.innerText.includes("Acceso reservado")');assert.equal(await evaluate('document.querySelectorAll("[aria-label=\\\"Lista de negocios\\\"] article").length'),0);assert(await evaluate('Array.from(document.querySelectorAll("button")).some(b=>b.innerText==="LOGOUT")'));});
 await auth('admin');await wait('document.body.innerText.includes("Cuentas para revisar")');
 await evaluate(`localStorage.setItem('nortex_token', ${JSON.stringify(sessions.owner)});localStorage.setItem('nortex_user', JSON.stringify({id:'synthetic-owner',role:'SUPER_ADMIN'}));window.dispatchEvent(new StorageEvent('storage',{key:'nortex_token'}));`);
 await check('403 real del backend retira lectura y LOGOUT limpia usuario rechazado',async()=>{await wait('document.body.innerText.includes("Acceso reservado")');await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.innerText==="LOGOUT").click()');await wait('location.pathname==="/login"');assert.equal(await evaluate('localStorage.getItem("nortex_user")'),null);assert.equal(await evaluate('localStorage.getItem("nortex_token")'),null);});
 await auth('admin');await wait('document.body.innerText.includes("Cuentas para revisar")');
 await transportFailure(true);
 await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.innerText==="Actualizar").click()');
 await check('Refresco fallido conserva corte anterior con aviso explícito',async()=>{await wait('document.body.innerText.includes("Datos anteriores")');assert(await evaluate('document.body.innerText.includes("Cuentas para revisar")'));});
 await navigate();
 await check('Fallo inicial no se presenta como cero ni lista vacía',async()=>{await wait('document.body.innerText.includes("esto no significa cero")');assert(!await evaluate('document.body.innerText.includes("Cuentas para revisar")'));});
 await shot('unavailable');
 await check('Fallo inicial conserva salida y login sin bucle',async()=>{await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.innerText==="LOGOUT").click()');await wait('location.pathname==="/login"');assert.equal(await evaluate('localStorage.getItem("nortex_token")'),null);});
 await transportFailure(false);await auth('admin');await wait('document.body.innerText.includes("Cuentas para revisar")');
 await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.innerText==="LOGOUT").click()');
 await check('Cerrar sesión elimina sesión y navega al login',async()=>{await wait('location.pathname === "/login"');assert.equal(await evaluate('localStorage.getItem("nortex_token")'),null);});
 await check('Interacciones admin no ejecutaron escrituras financieras',async()=>{assert(!requests.some(r=>/\/api\/admin\/(loans|tenants\/[^/]+\/(score|suspend|reactivate)|manual-payments)|\/api\/(wallet|capital)/.test(r.url)));assert(!requests.some(r=>r.url.includes('/api/admin/metrics')&&r.method!=='GET'));});
}catch(error){uiError=error;}
finally{
 try{
  await transportFailure(false);
  try{await access(transportFile);throw new Error('Fixture transport mode did not restore.');}catch(error){if(error.code!=='ENOENT')throw error;}
  const restored=await fetch('http://127.0.0.1:33318/api/admin/metrics?page=1',{headers:{Authorization:'Bearer '+sessions.admin}});
  assert.equal(restored.status,200);assert.equal((await restored.json()).metrics.registered,56);serverRestored=true;
 }catch(error){cleanupErrors.push(errorDetails(error));}
 // Drenar en bucle, desactivar nuevas pausas y volver a drenar antes de evaluar
 // resultado. Una única instantánea de tareas no cubre las que llegan después.
 try{await drainInterceptions();}catch(error){cleanupErrors.push(errorDetails(error));}
 try{await send('Fetch.disable');}catch(error){cleanupErrors.push(errorDetails(error));}
 try{await drainInterceptions();}catch(error){cleanupErrors.push(errorDetails(error));}
 for(const state of fetchStates.values()){
  if(state.status==='rejected'){
   if(state.networkId&&state.error.message==='Invalid InterceptionId.'&&canceledRequests.has(state.networkId)){state.status='confirmed-canceled';confirmedCanceledInterceptions++;}
   else interceptionErrors.push({...state});
  }else if(state.status==='resolving')interceptionErrors.push({message:'Unresolved Fetch ID after cleanup',...state});
 }
 const transportFailures=failedRequests.filter(row=>row.transportFailureActive&&!row.canceled&&row.url?.startsWith('http://127.0.0.1:33318/api/admin/metrics?'));
 try{assert(transportFailures.length>=2,'Missing real transport failures');assert(transportFailures.every(row=>!responses.has(row.requestId)),'A simulated transport failure received HTTP response');}catch(error){cleanupErrors.push(errorDetails(error));}
 await writeFile(new URL('driver-events.json',out),JSON.stringify({trace,fetchStates:[...fetchStates.values()],interceptionErrors,cleanupErrors,failedRequests,confirmedCanceledInterceptions,tasksAfterCleanup:interceptionTasks.size,transportFailures,serverRestored},null,2));
 await writeFile(new URL('report.json',out),JSON.stringify({base:'43d8d77677bdc468ca2a3fec626b023996080903',result:uiError?'FAIL_UI':interceptionErrors.length||cleanupErrors.length?'PARTIAL_DRIVER_ERRORS':'PASS',checks,uiError:uiError?{message:uiError.message}:null,interceptionErrors,cleanupErrors,confirmedCanceledInterceptions,transportFailures,serverRestored,transportSemantics:'Fixture closes metrics socket before HTTP response; real browser fetch rejection, not503. All16UI assertions unchanged. Fetch interception disabled.',viewportDesktop:'1440x1000',viewportMobile:'390x844',renderer:'installed Chromium headless; real admin router and own synthetic MySQL',limits:['Secondary assistant/WhatsApp backends outside harness; no acceptance of those flows','Editorial pending-logout and delayed-response/session cases verified separately with real SWR in jsdom','No real-user activity or hardware tested']},null,2));
 ws.close();
}
if(uiError)throw uiError;
assert.deepEqual(interceptionErrors,[]);assert.deepEqual(cleanupErrors,[]);
console.log(`PASS: ${checks.length} recorridos Chromium headless; capturas en evidence/browser`);
