import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { createWriteStream, createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { PDFDocument } from 'pdf-lib';
import { validateQualityDatabase } from './quality-gate-contract.mjs';

// Sólo dos bases NUEVAS con nombre aleatorio, derivadas de un MySQL local de QA.
// No inspecciona .env ni usa configuración del proveedor. No imprime URLs.
const base=validateQualityDatabase(process.env.DATABASE_URL,process.env.NORTEX_QA_DATABASE_ACK);
const previous=process.env.ASSISTANT_PREVIOUS_SCHEMA;
const container=process.env.NORTEX_QA_MYSQL_CONTAINER;
if(!previous||!container||!/^nortex-[a-z0-9-]+$/.test(container))throw new Error('Falta schema previo y contenedor descartable explícitos.');
const suffix=randomUUID().replaceAll('-','').slice(0,12);
const names=[`nortex_quality_upgrade_${suffix}`,`nortex_quality_restore_${suffix}`];
const urlFor=name=>{const url=new URL(base);url.pathname='/'+name;return url.toString();};
const output=path.resolve('reports/assistant-schema');await mkdir(output,{recursive:true});
const primaryFiles=await mkdtemp(path.join(tmpdir(),'nortex-private-restore-source-'));
const restoredFiles=await mkdtemp(path.join(tmpdir(),'nortex-private-restore-target-'));
const admin=new PrismaClient({datasources:{db:{url:base.toString()}}});
const db=new PrismaClient({datasources:{db:{url:urlFor(names[0])}}});
const restored=new PrismaClient({datasources:{db:{url:urlFor(names[1])}}});
let completed=false;
const cleanupFailures=[];
await writeFile(path.join(output,'resources.json'),JSON.stringify({databases:names,privateDirectories:[primaryFiles,restoredFiles]},null,2));
const report={passed:false,upgrade:false,schemaMatches:false,oldSalePreserved:false,oldPurchasePreserved:false,restore:false,privateAttachment:false,newTables:0};
await writeFile(path.join(output,'summary.json'),JSON.stringify(report));
async function command(args,env,input,outputPath) {
  await new Promise((resolve,reject)=>{
    const child=spawn(args[0],args.slice(1),{env,stdio:['pipe','pipe','pipe']});
    let error='';child.stderr.on('data',chunk=>{error+=chunk.toString();});
    const destination=outputPath?createWriteStream(outputPath):null;
    if(destination)child.stdout.pipe(destination);else child.stdout.resume();
    if(input)createReadStream(input).pipe(child.stdin);else child.stdin.end();
    child.once('error',reject);child.once('close',code=>{
      const safe=error.replaceAll(base.password,'[redacted]').replace(/mysql:\/\/[^\s]+/g,'[database]');
      const done=()=>code===0?resolve():reject(new Error(`Verificación local falló (${code}): ${safe.slice(0,1500)}`));
      if(destination&&!destination.writableFinished)destination.once('finish',done);else done();
    });
  });
}
const prisma=(args,database)=>command([process.execPath,'node_modules/prisma/build/index.js',...args],{PATH:process.env.PATH,DATABASE_URL:urlFor(database)});
const selectTenant={id:true,businessName:true,taxId:true};
try {
  for(const name of names)await admin.$executeRawUnsafe(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await prisma(['db','push','--skip-generate','--schema',previous],names[0]);
  const tenant=await db.tenant.create({data:{businessName:'QA migración y restauración',taxId:randomUUID()},select:selectTenant});
  const user=await db.user.create({data:{tenantId:tenant.id,name:'QA sintético',password:'NO_LOGIN',role:'OWNER'}});
  const product={id:randomUUID()};
  await db.$executeRaw`INSERT INTO Product (id,tenantId,createdBy,name,sku,price,cost,stock,updatedAt) VALUES (${product.id},${tenant.id},${user.id},'Cemento de QA',${randomUUID()},100,60,5,UTC_TIMESTAMP(3))`;
  const supplier=await db.supplier.create({data:{tenantId:tenant.id,name:'Proveedor de QA'}});
  const sale=await db.sale.create({data:{tenantId:tenant.id,total:'200',paymentMethod:'CASH',status:'COMPLETED'},select:{id:true,total:true,status:true}});
  const item=await db.saleItem.create({data:{saleId:sale.id,productId:product.id,quantity:2,priceAtSale:'100',costAtSale:'60'},select:{id:true,priceAtSale:true,costAtSale:true,quantity:true}});
  const purchase=await db.purchase.create({data:{tenantId:tenant.id,supplierId:supplier.id,invoiceNumber:'QA-MIGRATION-01',total:'300',subtotal:'300',tax:'0',status:'PENDING_PAYMENT',paymentMethod:'CREDIT',createdBy:user.id,date:new Date('2026-09-01T18:00:00Z')},select:{id:true,total:true,status:true,invoiceNumber:true}});
  await prisma(['db','execute','--schema','backend/prisma/schema.prisma','--file','backend/prisma/migrations/20260905_nortex_assistant_z_operations/migration.sql'],names[0]);
  report.upgrade=true;
  await prisma(['migrate','diff','--from-schema-datasource','backend/prisma/schema.prisma','--to-schema-datamodel','backend/prisma/schema.prisma','--exit-code'],names[0]);
  report.schemaMatches=true;
  assert.deepEqual(await db.sale.findUnique({where:{id:sale.id},select:{id:true,total:true,status:true}}),sale);
  const after=await db.saleItem.findUnique({where:{id:item.id},select:{id:true,priceAtSale:true,costAtSale:true,quantity:true,promotionSnapshot:true}});
  assert.deepEqual(after,{...item,promotionSnapshot:null});report.oldSalePreserved=true;
  assert.deepEqual(await db.purchase.findUnique({where:{id:purchase.id},select:{id:true,total:true,status:true,invoiceNumber:true}}),purchase);report.oldPurchasePreserved=true;
  await db.assistantTenantConfig.create({data:{tenantId:tenant.id,enabled:true,extractionEnabled:true,operationsEnabled:true}});
  const conversation=await db.assistantConversation.create({data:{tenantId:tenant.id,userId:user.id,roleAtCreation:'OWNER',expiresAt:new Date(Date.now()+86400_000)}});
  await db.assistantRun.create({data:{tenantId:tenant.id,userId:user.id,roleAtCreation:'OWNER',conversationId:conversation.id,requestId:randomUUID(),payloadHash:'a'.repeat(64),inputText:'Consulta sintética de restauración',expiresAt:conversation.expiresAt}});
  for(const flag of ['NORTEX_ASSISTANT_ENABLED','NORTEX_ASSISTANT_EXTRACTION_ENABLED'])process.env[flag]='true';
  const {saveAssistantAttachment,readAssistantAttachment}=await import('../backend/services/assistant/attachments.ts');
  const principal={tenantId:tenant.id,userId:user.id,role:'OWNER'};
  const document=await PDFDocument.create();document.addPage().drawText('QA synthetic restore evidence');const bytes=Buffer.from(await document.save());
  const attachment=await saveAssistantAttachment(principal,bytes,'application/pdf','QA-restore.pdf',{db,storageRoot:primaryFiles});
  const dump=path.join(output,'synthetic-backup.sql');
  await command(['docker','exec',container,'sh','-c',`MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --no-tablespaces --single-transaction --skip-add-drop-table --set-gtid-purged=OFF ${names[0]}`],{PATH:process.env.PATH},undefined,dump);
  await command(['docker','exec','-i',container,'sh','-c',`MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot ${names[1]}`],{PATH:process.env.PATH},dump);
  await cp(primaryFiles,restoredFiles,{recursive:true});
  assert.equal(await restored.assistantRun.count({where:{tenantId:tenant.id}}),1);
  assert.deepEqual(await restored.tenant.findUnique({where:{id:tenant.id},select:selectTenant}),tenant);
  await prisma(['migrate','diff','--from-schema-datasource','backend/prisma/schema.prisma','--to-schema-datamodel','backend/prisma/schema.prisma','--exit-code'],names[1]);
  const read=await readAssistantAttachment(principal,attachment.id,{db:restored,storageRoot:restoredFiles});
  assert.equal(createHash('sha256').update(read.bytes).digest('hex'),createHash('sha256').update(bytes).digest('hex'));
  report.privateAttachment=true;report.restore=true;
  report.newTables=(await readFile('backend/prisma/migrations/20260905_nortex_assistant_z_operations/migration.sql','utf8')).match(/CREATE TABLE/g)?.length??0;
  completed=true;
} finally {
  await db.$disconnect();await restored.$disconnect();
  // Los nombres de estas bases se generaron en este proceso; no limpia otras bases.
  for(const name of names) {
    try {await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${name}\``);}
    catch {cleanupFailures.push(name);}
  }
  await admin.$disconnect();
  await rm(primaryFiles,{recursive:true,force:true});await rm(restoredFiles,{recursive:true,force:true});
  await rm(path.join(output,'synthetic-backup.sql'),{force:true});
  await writeFile(path.join(output,'summary.json'),JSON.stringify({...report,passed:completed,cleanupComplete:cleanupFailures.length===0,cleanupFailures},null,2));
}
if(cleanupFailures.length)throw new Error('No se pudo limpiar una base generada por el ensayo; revisar reports/assistant-schema/resources.json.');
console.log('Migración aditiva, preservación histórica y restauración privada verificadas en MySQL 8 descartable.');
