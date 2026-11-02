import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { createReadOnlyTestEntry } from '../src/readonly-test-entry.js';

async function run(fn,options={}) {
 const app=createReadOnlyTestEntry(options);await app.listen(0);const url=`http://127.0.0.1:${app.address().port}`;
 const post=async(method,params={})=>{const r=await fetch(url+'/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});return {status:r.status,body:await r.json()};};
 try{await fn({app,url,post});}finally{await app.close();}
}
test('real MCP initialize/list/call exposes only bounded read tools and honest health',async()=>run(async({url,post})=>{
 const health=await fetch(url+'/health').then(r=>r.json());assert.equal(health.mode,'read-only');assert.equal(health.executors_started,false);assert.equal(health.ordinary_chat_connected,false);
 const init=await post('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'offline-test',version:'1'}});assert.equal(init.status,200);assert.equal(init.body.result.serverInfo.name,'acp-readonly-test');
 const listed=await post('tools/list');assert.deepEqual(listed.body.result.tools.map(t=>t.name).sort(),['get_requirements','read_capabilities']);
 for(const tool of listed.body.result.tools)assert.equal(tool.annotations.readOnlyHint,true);
 const result=await post('tools/call',{name:'get_requirements',arguments:{}});assert.equal(result.body.result.structuredContent.fixture.synthetic,true);assert.equal(result.body.result.structuredContent.fixture.id,'synthetic-requirements');
 const caps=await post('tools/call',{name:'read_capabilities',arguments:{}});assert.equal(caps.body.result.structuredContent.executors_started,false);
}));
test('write operations are not implemented even when called directly',async()=>run(async({url,post})=>{
 for(const name of ['dispatch_project','approve','merge','import','write_file']){const r=await post('tools/call',{name,arguments:{human:true}});assert.ok(r.body.error||r.body.result?.isError);assert.equal(JSON.stringify(r.body).includes('human:true'),false);}
 assert.equal((await fetch(url+'/v1/tasks',{method:'POST',body:'{}'})).status,404);
}));
test('strict fixture and listen configuration reject authority, paths and unsafe binding',async()=>{
 for(const fixture of [{id:'x',summary:'x',body:'x',path:'/etc/passwd'},{id:'x',summary:'x',body:'x',approved:true},{id:'x',summary:'x',body:'x'.repeat(16385)}])assert.throws(()=>createReadOnlyTestEntry({fixture}));
 const app=createReadOnlyTestEntry();for(const host of ['0.0.0.0','localhost','::','example.com'])await assert.rejects(app.listen(0,host));await app.close();
});
test('bad origins/hosts, malformed requests and oversized bodies fail safely',async()=>run(async({url,post})=>{
 const hostileHost=await new Promise((resolve,reject)=>{const req=http.get(url+'/health',{headers:{host:'attacker.example'}},r=>{r.resume();resolve(r.statusCode);});req.on('error',reject);});assert.equal(hostileHost,403);
 for(const headers of [{origin:'https://attacker.example'},{origin:'null'}])assert.equal((await fetch(url+'/health',{headers})).status,403);
 const bad=await fetch(url+'/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:'{secret-invalid'});assert.equal(bad.status,400);assert.equal((await bad.text()).includes('secret-invalid'),false);
 const large=await fetch(url+'/mcp',{method:'POST',headers:{'content-type':'application/json'},body:'x'.repeat(32769)});assert.equal(large.status,413);
 const extra=await post('tools/call',{name:'get_requirements',arguments:{path:'/etc/passwd'}});assert.ok(extra.body.error||extra.body.result?.isError);
}));

test('explicit CLI ignores poisoned production environment under import/filesystem/process guards',async(t)=>{
 const [{spawn,spawnSync},fs,os,path]=await Promise.all([import('node:child_process'),import('node:fs'),import('node:os'),import('node:path')]);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acp-readonly-guard-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const poison=path.join(dir,'production-config.json');fs.writeFileSync(poison,'PRODUCTION-SECRET-NOT-JSON');
 const loader=`export async function resolve(s,c,n){const r=await n(s,c);if(/\\/src\\/(?:server\\.js|core\\/(?:config|store|orchestrator)\\.js|executors\\/|remote-relay\\/|companion\\/|local-review\\/)/.test(r.url))throw Error('Production import forbidden');return r;}`;
 const guard=`import fs from 'node:fs';import cp from 'node:child_process';import {register,syncBuiltinESMExports} from 'node:module';
 register(${JSON.stringify('data:text/javascript,'+encodeURIComponent(loader))},import.meta.url);
 const forbidden=p=>{const s=String(p);return s===process.env.AGENT_CONTROL_CONFIG||s.includes('config/local.json')||/(?:^|\\/)(?:\\.env|state\\.json|pairing[^/]*\\.json|remote-relay[^/]*\\.json)$/.test(s);};
 for(const k of ['readFileSync','readFile','openSync','open','existsSync','statSync']){const original=fs[k];fs[k]=function(p,...a){if(forbidden(p))throw Error('Production read forbidden');return original.call(this,p,...a);};}
 for(const k of ['writeFileSync','appendFileSync','mkdirSync','renameSync','rmSync'])fs[k]=()=>{throw Error('Runtime filesystem mutation forbidden');};
 for(const k of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[k]=()=>{throw Error('Process creation forbidden');};
 globalThis.fetch=()=>{throw Error('Outbound fetch forbidden');};globalThis.setInterval=()=>{throw Error('Polling interval forbidden');};syncBuiltinESMExports();`;
 for(const code of ["import fs from 'node:fs';fs.readFileSync(process.env.AGENT_CONTROL_CONFIG)","await import('./src/server.js')","import cp from 'node:child_process';cp.spawn('not-launched')"]){
  const negative=spawnSync(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(guard),'--input-type=module','--eval',code],{cwd:process.cwd(),env:{...process.env,AGENT_CONTROL_CONFIG:poison},encoding:'utf8'});
  assert.notEqual(negative.status,0);assert.match(negative.stderr,/Production (?:read|import) forbidden|Process creation forbidden/);
 }
 const child=spawn(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(guard),'scripts/readonly-test-entry.js','--port','0'],{cwd:process.cwd(),env:{...process.env,AGENT_CONTROL_CONFIG:poison,AGENT_CONTROL_STATE_DIR:dir,AGENT_CONTROL_HOST:'0.0.0.0',AGENT_CONTROL_PORT:'4318'}});
 let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
 const exited=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
 const waitClosed=()=>{let deadline;return Promise.race([exited,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(new Error('CLI did not close after SIGTERM')),5000);})]).finally(()=>clearTimeout(deadline));};
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');await waitClosed();});
 for(let attempt=0;attempt<200&&!stdout.includes('\n')&&child.exitCode===null;attempt++)await new Promise(r=>setTimeout(r,10));
 assert.ok(stdout.includes('\n'),stderr);const info=JSON.parse(stdout.trim());assert.match(info.address,/^http:\/\/127\.0\.0\.1:\d+$/);assert.equal(info.executors_started,false);
 const response=await fetch(info.address+'/health');assert.equal(response.status,200);assert.equal((await response.json()).production_state_loaded,false);
 const tools=await fetch(info.address+'/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})}).then(r=>r.json());assert.equal(tools.result.tools.length,2);
 const marker='diagnostic-no-log-private-marker';
 const rejected=await fetch(info.address+'/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream','x-private-test':marker},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_requirements',arguments:{[marker]:marker}}})}).then(r=>r.text());
 assert.equal(rejected.includes(marker),false);
 const diagnostic=await fetch(info.address+'/diagnostics').then(r=>r.text());assert.equal(diagnostic.includes(marker),false);
 assert.equal((await fetch(info.address+'/health').then(r=>r.text())).includes(marker),false);
 // Negative control: the announced listener really owns this port before stop.
 const port=Number(new URL(info.address).port);
 const competing=http.createServer();t.after(()=>{if(competing.listening)competing.close();});
 await assert.rejects(new Promise((resolve,reject)=>{competing.once('error',reject);competing.listen(port,'127.0.0.1',resolve);}),{code:'EADDRINUSE'});
 assert.equal(child.kill('SIGTERM'),true);
 const outcome=await waitClosed();
 // Windows emulates SIGTERM by terminating the child; it cannot run the POSIX
 // JS signal cleanup handler. Accept only that exact platform-specific outcome.
 assert.deepEqual(outcome,process.platform==='win32'?{code:null,signal:'SIGTERM'}:{code:0,signal:null});
 assert.equal(child.exitCode,outcome.code);assert.equal(child.signalCode,outcome.signal);
 const released=http.createServer();t.after(()=>{if(released.listening)released.close();});
 await new Promise((resolve,reject)=>{released.once('error',reject);released.listen(port,'127.0.0.1',resolve);});
 await new Promise((resolve,reject)=>released.close(error=>error?reject(error):resolve()));
 assert.equal(stderr,'');assert.equal(stdout.includes('PRODUCTION-SECRET'),false);assert.equal(stdout.includes(marker),false);
 assert.deepEqual(fs.readdirSync(dir),['production-config.json']);
});

test('unknown tool errors do not reflect caller payloads',async()=>run(async({post})=>{
 const response=await post('tools/call',{name:'secret-not-a-tool',arguments:{token:'fixture-secret'}});
 assert.ok(response.body.error||response.body.result?.isError);
 assert.equal(JSON.stringify(response.body).includes('secret-not-a-tool'),false);
 assert.equal(JSON.stringify(response.body).includes('fixture-secret'),false);
}));
test('unfinished requests are bounded without a session or polling registry',async()=>run(async({url})=>{
 const pending=[];
 try{
  for(let index=0;index<8;index++){
   const request=http.request(url+'/mcp',{method:'POST',headers:{'content-type':'application/json','transfer-encoding':'chunked'}});request.on('error',()=>{});request.write('{');pending.push(request);
  }
  await new Promise(r=>setTimeout(r,30));
  assert.equal((await fetch(url+'/health')).status,503);
 }finally{for(const request of pending)request.destroy();}
}));


test('known tool params and arguments fail generically before SDK validation',async()=>run(async({post})=>{
 for(const name of ['get_requirements','read_capabilities']){
  for(const params of [
   {name,arguments:{'secret-marker-controlled-repro':'fixture-secret'}},
   {name,arguments:[],extra:'fixture-secret'}, {name,arguments:'fixture-secret'},
   {name,arguments:null}, {name,arguments:{},'secret-marker-controlled-repro':true},
  ]){
   const response=await post('tools/call',params);
   assert.ok(response.body.error||response.body.result?.isError);
   assert.equal(JSON.stringify(response.body).includes('secret-marker-controlled-repro'),false);
   assert.equal(JSON.stringify(response.body).includes('fixture-secret'),false);
  }
 }
}));
test('absolute HTTP deadline releases all stalled request capacity',async()=>run(async({url})=>{
 const requests=[];
 try{
  for(let index=0;index<8;index++){
   const request=http.request(url+'/mcp',{method:'POST',headers:{'content-type':'application/json','transfer-encoding':'chunked'}});
   request.on('error',()=>{});request.write('{');requests.push(request);
  }
  await new Promise(r=>setTimeout(r,30));assert.equal((await fetch(url+'/health')).status,503);
  await new Promise(r=>setTimeout(r,250));assert.equal((await fetch(url+'/health')).status,200);
 }finally{for(const request of requests)request.destroy();}
},{deadlineMs:100}));

test('standard request metadata is accepted and ignored without becoming tool arguments',async()=>run(async({url,post})=>{
 const marker='private-metadata-marker';
 for(const name of ['get_requirements','read_capabilities']){
  for(const _meta of [{progressToken:1},{progressToken:marker},{'example.org/context':{opaque:marker}}]){
   const r=await post('tools/call',{name,arguments:{},_meta});
   assert.equal(r.body.error,undefined);assert.notEqual(r.body.result?.isError,true);assert.ok(r.body.result?.structuredContent);
   assert.equal(JSON.stringify(r.body).includes(marker),false);
  }
 }
 const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');
 const {StreamableHTTPClientTransport}=await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
 const client=new Client({name:'offline-meta-client',version:'1.0.0'});
 try{
  await client.connect(new StreamableHTTPClientTransport(new URL(url+'/mcp')));
  const result=await client.callTool({name:'read_capabilities',arguments:{}},undefined,{onprogress:()=>{}});
  assert.equal(result.structuredContent.executors_started,false);
 }finally{await client.close();}
 const health=await fetch(url+'/health').then(r=>r.text());const diag=await fetch(url+'/diagnostics').then(r=>r.text());
 assert.equal((health+diag).includes(marker),false);
}));

test('metadata compatibility cannot authorize writes relax arguments or retain hostile metadata',async()=>run(async({post})=>{
 const marker='private-metadata-invalid';
 let deep=marker;for(let i=0;i<10;i++)deep={nested:deep};
 for(const params of [
  {name:'dispatch_project',arguments:{},_meta:{progressToken:1}},
  {name:'read_capabilities',arguments:{[marker]:true},_meta:{progressToken:1}},
  {name:'read_capabilities',arguments:{},extra:marker,_meta:{}},
  ...[null,[],marker,{progressToken:{}},{progressToken:1.5},{progressToken:marker.repeat(30)},{opaque:marker.repeat(600)},{opaque:deep},{opaque:Array(129).fill(marker)}].map(_meta=>({name:'read_capabilities',arguments:{},_meta})),
 ]){
  const r=await post('tools/call',params);assert.equal(r.body.error?.code,-32602);
  assert.equal(JSON.stringify(r.body).includes(marker),false);
 }
 const ok=await post('tools/call',{name:'read_capabilities'});assert.equal(ok.body.result.structuredContent.mode,'read-only');
}));
