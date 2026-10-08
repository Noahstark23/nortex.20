import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';

const args=process.argv.slice(2);
const value=key=>{const at=args.indexOf(key);return at<0?undefined:args[at+1];};
const corpus=path.resolve('tests/fixtures/assistant/corpus');
const manifest=JSON.parse(await readFile(path.join(corpus,'manifest.json'),'utf8'));
const failures=[];
for(const vertical of ['FERRETERIA','FARMACIA'])if(manifest.cases.filter(row=>row.vertical===vertical).length<50)failures.push(`${vertical}: requiere 50 documentos`);
const ids=new Set();
for(const row of manifest.cases) {
  if(ids.has(row.id))failures.push(`${row.id}: ID duplicado`);ids.add(row.id);
  if(path.basename(row.file)!==row.file)throw new Error('Archivo fuera del corpus.');
  const bytes=await readFile(path.join(corpus,row.file));
  if(createHash('sha256').update(bytes).digest('hex')!==row.sha256)failures.push(`${row.id}: hash distinto`);
  if(bytes.length!==row.bytes||bytes.length>10*1024*1024)failures.push(`${row.id}: tamaño inválido`);
  if(row.mediaType==='application/pdf') {
    const pdf=await PDFDocument.load(bytes);if(pdf.getPageCount()!==row.pages)failures.push(`${row.id}: páginas distintas`);
  } else if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) failures.push(`${row.id}: PNG inválido`);
}
if(failures.length)throw new Error(failures.join('\n'));
console.log(`Corpus íntegro: ${manifest.cases.length} documentos; 50 ferretería y 50 farmacia.`);

const report={createdAt:new Date().toISOString(),corpusCases:manifest.cases.length,
  corpusIntegrity:'passed',humanReview:'pending',providerEvaluation:'not_run',jobsSubmitted:0,paidCalls:0,results:[],
  limitations:['Datos sintéticos; revisión humana pendiente.','Integridad del corpus no acredita exactitud del modelo ni mejora operativa.']};
if(args.includes('--allow-paid-model')) {
  const base=new URL(value('--base-url')??'invalid:');
  if(base.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(base.hostname))throw new Error('La evaluación ejecutable requiere un backend local de QA.');
  const tokenPath=value('--session-token-file');if(!tokenPath)throw new Error('Indicá archivo privado de sesión QA, nunca el token por argumento.');
  const tokenStat=await stat(tokenPath);if((tokenStat.mode&0o077)!==0)throw new Error('El archivo de sesión debe tener permisos 0600.');
  const token=(await readFile(tokenPath,'utf8')).trim();
  const limit=Number(value('--limit')??5);if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('--limit debe ser entero entre 1 y 100.');
  async function api(endpoint,init={}) {
    const response=await fetch(new URL(endpoint,base),{...init,headers:{authorization:`Bearer ${token}`,...init.headers},signal:AbortSignal.timeout(30_000)});
    const body=await response.json();if(!response.ok)throw new Error(`HTTP ${response.status}: ${body.code??'REQUEST_FAILED'}`);return body;
  }
  const caps=await api('/api/assistant/capabilities');if(!caps.extractionEnabled)throw new Error('La extracción no está habilitada para esta sesión QA.');
  report.providerEvaluation='running';report.paidCalls=null;
  report.limitations.push('Costo y número de llamadas son autoridad de la evidencia del backend. Un trabajo puede validar sin IA o reintentar varias veces; jobsSubmitted no equivale a llamadas pagadas.');
  const selected=[...manifest.cases].sort((a,b)=>a.id.slice(-3).localeCompare(b.id.slice(-3))||a.vertical.localeCompare(b.vertical)).slice(0,limit);
  for(const row of selected) {
    const started=Date.now();
    try {
      const attachment=await api('/api/assistant/attachments',{method:'POST',headers:{'content-type':row.mediaType,'x-file-name':encodeURIComponent(row.file)},body:await readFile(path.join(corpus,row.file))});
      let job=await api('/api/assistant/extractions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({attachmentIds:[attachment.id]})});
      report.jobsSubmitted+=1;
      const deadline=Date.now()+180_000;
      while(['PENDING','PROCESSING'].includes(job.status)&&Date.now()<deadline) {await new Promise(resolve=>setTimeout(resolve,1000));job=await api(`/api/assistant/extractions/${job.id}`);}
      if(job.status!=='SUCCEEDED'||!job.proposalId)throw new Error(`EXTRACTION_${job.status}: ${job.error??'Sin propuesta'}`);
      const proposal=await api(`/api/assistant/proposals/${job.proposalId}`);
      const comparisons=['currency','invoiceNumber','date','documentSubtotal','documentTax','documentTotal'].filter(key=>!row.omittedFields.includes(key)).map(key=>({field:key,exact:proposal.draft[key]===row.expected[key]}));
      for(const [index,line]of row.expected.items.entries())for(const key of ['quantity','unitCost','purchaseUnit','batchNumber','expiryDate'])if(line[key]!==undefined)comparisons.push({field:`items.${index}.${key}`,exact:proposal.draft.items[index]?.[key]===line[key]});
      const controls={uncommitted:proposal.status==='DRAFT',receivedConfirmed:proposal.draft.receivedConfirmed===false,paymentConfirmed:proposal.draft.paymentConfirmed===false};
      report.results.push({id:row.id,status:comparisons.every(field=>field.exact)?'fields_match':'field_discrepancies',durationMs:Date.now()-started,comparisons,controls,
        expectedReviewIssues:row.expectedReviewIssues,reviewIssuesAssessment:'requires_human_review',needsHumanReview:true});
      if(Object.values(controls).some(ok=>!ok))throw new Error('EXTRACTION_CONTROL_FAILURE');
    } catch(error) {
      const message=String(error.message);
      report.results.push({id:row.id,status:'extraction_failed',durationMs:Date.now()-started,error:message,
        expectedReviewIssues:row.expectedReviewIssues,expectedRejection:row.expectedReviewIssues.length>0,
        rejectionAssessment:row.expectedReviewIssues.length?'requires_reason_review':'unexpected',needsHumanReview:true});
      // Un documento defectuoso no impide evaluar los demás. Presupuesto y controles son límites absolutos.
      if(/BUDGET_|presupuesto|EXTRACTION_CONTROL_FAILURE/i.test(message))break;
    }
  }
  report.providerEvaluation=report.results.length<selected.length?'incomplete':
    report.results.some(row=>row.status!=='fields_match')?'executed_with_discrepancies_pending_human_review':'executed_pending_human_review';
}
const output=path.resolve(value('--report')??'reports/assistant-evaluation/report.json');
await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(`Informe: ${output}. Proveedor: ${report.providerEvaluation}; revisión humana: pendiente.`);
if(['incomplete','executed_with_discrepancies_pending_human_review'].includes(report.providerEvaluation))process.exitCode=1;
