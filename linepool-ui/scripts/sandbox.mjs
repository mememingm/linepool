// Isolated local-only sandbox. No .env reads, business database resets or real providers.
import {spawn,spawnSync} from 'node:child_process';
import {mkdirSync,existsSync,writeFileSync,readFileSync,openSync,unlinkSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import pg from 'pg';
const root=resolve(fileURLToPath(new URL('..',import.meta.url))),backend=join(root,'backend');
const action=process.argv[2]||'prepare',name=process.argv[3]||'business-sandbox';
if(!/^[\w-]+$/.test(name))throw Error('Invalid isolated run name');
const folder=join(root,'output',name),meta=join(folder,'local-run.json'),bin=process.env.PG_BIN||'D:/postgresql/bin';
mkdirSync(folder,{recursive:true});let config=existsSync(meta)?JSON.parse(readFileSync(meta,'utf8')):null;
const freePort=(port=0)=>new Promise((resolve,reject)=>{const s=createServer();s.once('error',reject);s.listen(port,'127.0.0.1',()=>{const result=s.address().port;s.close(()=>resolve(result));});});
const exe=n=>join(bin,n+(process.platform==='win32'?'.exe':''));
const env=()=>({...process.env,DATABASE_URL:`postgresql://linepool_sandbox:${config.password}@127.0.0.1:${config.pgPort}/linepool_sandbox`,NODE_ENV:'development',API_HOST:'127.0.0.1',API_PORT:String(config.apiPort),WEB_ORIGIN:`http://127.0.0.1:${config.webPort}`,LINEPOOL_API_TARGET:`http://127.0.0.1:${config.apiPort}`,LOCAL_SANDBOX:'true',DEMO_EMAIL:'catalog@example.invalid',DEMO_PASSWORD:config.password});
const run=(cmd,args,opts={})=>{const r=spawnSync(cmd,args,{cwd:root,env:env(),encoding:'utf8',stdio:'pipe',timeout:45000,...opts});if(r.status!==0)throw Error(`${cmd} failed: ${r.stderr||r.error}`);return r.stdout;};
const connect=async(admin=false)=>{const c=new pg.Client({host:'127.0.0.1',port:config.pgPort,user:admin?'linepool_sandbox_admin':'linepool_sandbox',password:config.password,database:admin?'postgres':'linepool_sandbox'});await c.connect();return c;};
if(action==='prepare'){
 if(config)throw Error('Run exists. Choose a new run name; no data is reset.');
 const webPort=await freePort(Number(process.env.LINEPOOL_SANDBOX_WEB_PORT||3314)),apiPort=await freePort(Number(process.env.LINEPOOL_SANDBOX_API_PORT||3315));
 config={password:randomBytes(32).toString('hex'),pgPort:await freePort(),apiPort,webPort,data:join(folder,'pgdata')};writeFileSync(meta,JSON.stringify(config,null,2));
 const pw=join(folder,'init-password');writeFileSync(pw,config.password,{mode:0o600});
 try{run(exe('initdb'),['-D',config.data,'-U','linepool_sandbox_admin','--pwfile',pw,'--auth-host=scram-sha-256','--auth-local=scram-sha-256','-E','UTF8','--locale=C']);}finally{unlinkSync(pw);}
 run(exe('pg_ctl'),['-D',config.data,'-l',join(folder,'postgres.log'),'-o',`-p ${config.pgPort} -h 127.0.0.1`,'-w','start'],{stdio:'ignore'});
 const c=await connect(true);await c.query(`CREATE ROLE linepool_sandbox LOGIN PASSWORD '${config.password}' NOSUPERUSER NOCREATEDB NOCREATEROLE`);await c.query('CREATE DATABASE linepool_sandbox OWNER linepool_sandbox');await c.end();
 run(process.execPath,['backend/dist/backend/scripts/migrate.js']);run(process.execPath,['backend/dist/backend/scripts/seed.js']);console.log('Isolated catalog ready. New accounts have no orders or messages.');
}else{
 if(!config)throw Error('Prepare isolated run first');
 if(action==='start'){
  if(config.pids?.length){for(const pid of config.pids){try{process.kill(pid,0);throw Error('Run active');}catch(e){if(e.code!=='ESRCH')throw e;}}}
  const database=spawnSync(exe('pg_ctl'),['-D',config.data,'status'],{stdio:'ignore'});
  if(database.status===3)run(exe('pg_ctl'),['-D',config.data,'-l',join(folder,'postgres.log'),'-o',`-p ${config.pgPort} -h 127.0.0.1`,'-w','start'],{stdio:'ignore'});
  else if(database.status!==0)throw Error('Unable to inspect isolated PostgreSQL');
  config.pids=[];for(const [label,args] of [['api',['backend/dist/backend/src/main.js']],['web',['node_modules/vite/bin/vite.js','preview','--mode','web','--outDir','web-dist','--host','127.0.0.1','--port',String(config.webPort),'--strictPort']]]){const log=openSync(join(folder,label+'.log'),'a'),child=spawn(process.execPath,args,{cwd:root,env:env(),detached:true,stdio:['ignore',log,log]});child.unref();config.pids.push(child.pid);}
  writeFileSync(meta,JSON.stringify(config,null,2));console.log(JSON.stringify({url:`http://127.0.0.1:${config.webPort}/register`,apiPort:config.apiPort,pgPort:config.pgPort}));
 }else if(action==='stop'){
  for(const pid of config.pids||[])try{process.kill(pid);}catch(e){if(e.code!=='ESRCH')throw e;}delete config.pids;writeFileSync(meta,JSON.stringify(config,null,2));
 }else if(action==='migrate'){
  console.log(run(process.execPath,['backend/dist/backend/scripts/migrate.js']).trim());
 }else if(action==='test'){
  const c=await connect(true);if(!(await c.query("SELECT 1 FROM pg_database WHERE datname='linepool_sandbox_test'")).rowCount)await c.query('CREATE DATABASE linepool_sandbox_test OWNER linepool_sandbox');await c.end();
  const variables={...env(),LOCAL_SANDBOX:'false',NODE_ENV:'test',TEST_DATABASE_URL:`postgresql://linepool_sandbox:${config.password}@127.0.0.1:${config.pgPort}/linepool_sandbox_test`};
  const log=openSync(join(folder,'integration-tests.log'),'w');const test=spawnSync(process.platform==='win32'?'npm.cmd':'npm',['test'],{cwd:root,env:variables,stdio:['ignore',log,log],shell:process.platform==='win32',timeout:60000});console.log(JSON.stringify({exitCode:test.status,log:join(folder,'integration-tests.log')}));process.exitCode=test.status??1;
 }else if(action==='inspect'){
  const c=await connect(),tables={};for(const t of ['users','orders','phone_numbers','number_allocations','point_ledger','sms_messages','provider_message_receipts','mock_fulfillment_operations'])tables[t]=(await c.query(`SELECT count(*)::int AS count FROM ${t}`)).rows[0].count;
  const users=(await c.query('SELECT id,email,points_balance FROM users')).rows,orders=(await c.query('SELECT id,user_id,quantity,total_points,fulfillment_status,idempotency_key FROM orders')).rows,allocations=(await c.query('SELECT * FROM number_allocations')).rows,ledger=(await c.query('SELECT id,user_id,type,delta,balance_after,reference_id FROM point_ledger ORDER BY sequence')).rows,messages=(await c.query('SELECT id,user_id,number_id,allocation_id,is_read FROM sms_messages')).rows;await c.end();
  writeFileSync(join(folder,'database-evidence.json'),JSON.stringify({tables,users,orders,allocations,ledger,messages},null,2));console.log(JSON.stringify(tables));
 }else if(action==='expire'){
  const id=process.argv[4];if(!/^[0-9a-f-]{36}$/.test(id||''))throw Error('Provide isolated number UUID');const c=await connect();await c.query("UPDATE phone_numbers SET expires_at=now()+interval '2 seconds' WHERE id=$1 AND assigned_user_id IS NOT NULL",[id]);await c.query("UPDATE number_allocations SET expires_at=(SELECT expires_at FROM phone_numbers WHERE id=$1) WHERE number_id=$1 AND released_at IS NULL",[id]);await c.end();console.log('Only this isolated allocation expires in two seconds.');
 }else throw Error('Use prepare|start|stop|inspect|expire');
}
