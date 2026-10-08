from pathlib import Path
import subprocess,json,time,hashlib,os
ROOT=Path(os.environ['NORTEX_IMAGE_QA_ROOT']);D=['docker','--host','unix:///var/run/docker.sock']; E=ROOT/'evidence'; cfg=json.loads((E/'synthetic-db.json').read_text()); ids=json.loads((E/'candidate-identities.json').read_text()); name=cfg['container'];network=cfg['network'];volume=cfg['volume'];checks=[]
def command(args,**kwargs):return subprocess.check_output(D+args,text=True,stderr=subprocess.PIPE,**kwargs).strip()
def sql(q,db=None):return command(['exec','-i',name,'mysql','-uroot','--batch','--raw','--skip-column-names']+([db] if db else []),input=q)
assert command(['inspect','--format','{{.Id}}',name])==cfg['containerId']
for attempt in range(90):
 try:
  if sql('SELECT 1')=='1':break
 except subprocess.CalledProcessError:pass
 time.sleep(.5)
else:raise RuntimeError('QA DB readiness timeout')
images=cfg['images']
identity=[]
for candidate,image in images.items():
 info=json.loads(command(['image','inspect','--format','{"id":{{json .Id}},"os":{{json .Os}},"arch":{{json .Architecture}},"cmd":{{json .Config.Cmd}}}',image]));assert info['cmd']==['sh','scripts/nortex-start.sh'];assert info['os']=='linux' and info['arch']=='amd64'
 receipt=json.loads(command(['run','--rm','--network','none','--entrypoint','cat',image,'/app/deploy/nortex/image-receipt.json']));assert receipt['previousCommit']==ids[candidate]
 identity.append({'candidate':candidate,**info,'commit':receipt['previousCommit'],'node':command(['run','--rm','--network','none','--entrypoint','node',image,'--version']),'receiptSha256':hashlib.sha256(json.dumps(receipt,sort_keys=True).encode()).hexdigest()})
 (E/(candidate+'-image-receipt.json')).write_text(json.dumps(receipt,indent=2)+'\n')
(E/'image-identities.json').write_text(json.dumps(identity,indent=2)+'\n')
def env(candidate,profile):
 db='nortex_prime_'+profile
 return {'DATABASE_URL':'mysql://root@db:3306/'+db,'NORTEX_ROLLBACK_DATABASE':db,'NORTEX_ROLLBACK_MYSQL_UUID':cfg['uuid'],'NORTEX_ROLLBACK_CONFIRMATION':'PRESERVE_SCHEMA '+ids[candidate]+' '+db,'NORTEX_SCHEMA_PROFILE':profile,'SOURCE_COMMIT':ids[candidate],'JWT_SECRET':'prime-synthetic-only-never-used-remotely','NORTEX_ASSISTANT_ENABLED':'false','NODE_ENV':'production','PORT':'3000'}
def args_env(values):return [part for k,v in values.items() for part in ['-e',k+'='+v]]
for profile in ['staging','production']:
 if sql("SELECT COUNT(*) FROM Customer WHERE id='prime-synthetic-customer'",'nortex_prime_'+profile)=='0':
  command(['run','--rm','--network',network,*args_env(env('Bprime',profile)),'--mount',f'type=bind,src={Path(__file__).resolve().with_name("seed.mjs")},dst=/qa/seed.mjs,readonly','--entrypoint','node',images['Bprime'],'/qa/seed.mjs'])
start=sql('SELECT NOW(6)')
for candidate in images:
 for profile in ['staging','production']:
  for change,error in [({},None),({'SOURCE_COMMIT':'f'*40},'ROLLBACK_SOURCE_COMMIT_MISMATCH'),({'NORTEX_ROLLBACK_MYSQL_UUID':'00000000-0000-0000-0000-000000000000'},'ROLLBACK_TARGET_MISMATCH'),({'NORTEX_ROLLBACK_CONFIRMATION':'wrong'},'ROLLBACK_CONFIRMATION_REQUIRED'),({'NORTEX_SCHEMA_PROFILE':'production' if profile=='staging' else 'staging'},'ROLLBACK_SCHEMA_MISMATCH' if profile=='staging' else 'ROLLBACK_EXPANSION_MISSING')]:
   p=subprocess.run(D+['run','--rm','--network',network,*args_env({**env(candidate,profile),**change}),'--entrypoint','node',images[candidate],'scripts/nortex-schema-gate.mjs'],text=True,capture_output=True,timeout=140)
   if error: assert p.returncode!=0 and p.stderr.strip()==error,(candidate,profile,error,p.stderr)
   else:
    assert p.returncode==0,(candidate,profile,p.stderr);out=json.loads(p.stdout);assert out['ddlStatements']==0 and out['previousCommit']==ids[candidate]
   checks.append({'candidate':candidate,'profile':profile,'case':error or 'exact schema accepted','status':'PASS'})
mutations=sql("SELECT COUNT(*) FROM mysql.general_log WHERE event_time > '"+start+"' AND command_type='Query' AND argument REGEXP '^[[:space:]]*(ALTER|CREATE|DROP|TRUNCATE|RENAME|INSERT|UPDATE|DELETE|REPLACE)[[:space:]]'")
assert mutations=='0',mutations
print('20 image gate scenarios PASS; actual SQL log: 0 DDL, 0 DML',flush=True)
private=cfg['privateVolume'];command(['volume','create','--label',cfg['label'],private])
command(['run','--rm','--network','none','--mount',f'type=volume,src={private},dst=/data','alpine:3.22','sh','-c','printf synthetic-only > /data/sentinel'])
queries=json.loads((Path(__file__).with_name('fixtures')/'schema-fingerprint-queries.json').read_text())
def fingerprint(db):
 metadata=[[line.split('\t') for line in sql(q,db).splitlines()] for q in queries]
 return hashlib.sha256(json.dumps(metadata,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
cycle=[]
for profile in ['staging','production']:
 expected=json.loads((ROOT/f'integration/deploy/nortex/{profile}.contract.json').read_text())['schemaFingerprintSha256'];db='nortex_prime_'+profile
 for index,candidate in enumerate(['Cprime','Bprime','Cprime']):
  assert fingerprint(db)==expected
  before=sql("SELECT CONCAT(id,':',currentDebt,':',creditLimit) FROM Customer WHERE id='prime-synthetic-customer'",db)
  command(['stop',name]);command(['rm',name])
  command(['run','-d','--name',name,'--label',cfg['label'],'--network',network,'--network-alias','db','--mount',f'type=volume,src={volume},dst=/var/lib/mysql','-e','MYSQL_ALLOW_EMPTY_PASSWORD=yes','mysql:8.0.43','--general-log=1','--log-output=TABLE'])
  for attempt in range(90):
   try:
    if sql('SELECT 1')=='1':break
   except subprocess.CalledProcessError:pass
   time.sleep(.5)
  else:raise RuntimeError('QA DB recovery timeout')
  assert sql('SELECT @@server_uuid')==cfg['uuid'];assert fingerprint(db)==expected
  app=cfg['appContainer'];start=sql('SELECT NOW(6)')
  command(['run','-d','--name',app,'--label',cfg['label'],'--network',network,'--mount',f'type=volume,src={private},dst=/var/lib/nortex/assistant',*args_env(env(candidate,profile)),images[candidate]])
  try:
   health=None
   for attempt in range(90):
    try:
     health=json.loads(command(['exec',app,'node','-e',"fetch('http://127.0.0.1:3000/api/health').then(async r=>{if(!r.ok)process.exit(1);console.log(await r.text())}).catch(()=>process.exit(1))"]));break
    except (subprocess.CalledProcessError,json.JSONDecodeError):time.sleep(.5)
   logs=command(['logs',app]);(E/f'{profile}-{index}-{candidate}.log').write_text(logs+'\n')
   assert health and health['commit']==ids[candidate] and health['db']=='up',(profile,candidate,health,logs[-2000:])
   assert fingerprint(db)==expected
   assert sql("SELECT CONCAT(id,':',currentDebt,':',creditLimit) FROM Customer WHERE id='prime-synthetic-customer'",db)==before
   assert command(['exec',app,'cat','/var/lib/nortex/assistant/sentinel'])=='synthetic-only'
   ddl=sql("SELECT COUNT(*) FROM mysql.general_log WHERE event_time > '"+start+"' AND command_type='Query' AND argument REGEXP '^[[:space:]]*(ALTER|CREATE|DROP|TRUNCATE|RENAME)[[:space:]]'");assert ddl=='0'
   cycle.append({'profile':profile,'candidate':candidate,'commit':health['commit'],'health':health,'sameDbUuid':True,'sameMysqlVolume':volume,'samePrivateVolume':private,'sentinelUnchanged':True,'schemaUnchanged':True,'ddlStatements':0,'status':'PASS'})
   print(profile,candidate,'default CMD health and volume recovery PASS',flush=True)
  finally:command(['stop',app]);command(['rm',app])
(E/'runtime-check.json').write_text(json.dumps({'status':'PASS','architecture':identity[0]['arch'],'gateChecks':checks,'gateDdlStatements':0,'gateDmlStatements':0,'cycles':cycle,'limits':'Own synthetic data only; native amd64 app image/default CMD. Not remote or smoke/PWA release evidence.'},indent=2)+'\n')
command(['stop',name]);print('QA DB stopped; named synthetic volumes preserved.',flush=True)
