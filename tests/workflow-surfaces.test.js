import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApplication } from '../src/server.js';
import { TaskStore } from '../src/core/store.js';
import { Orchestrator } from '../src/core/orchestrator.js';
import { RecordingExecutor } from './fixtures/recording-executor.js';
import { loadConfig } from '../src/core/config.js';
import { taskListUrl } from '../src/dashboard.js';

async function setup(t,{enabled=true,trusted=true}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acp-workflow-api-'));const now=Date.parse('2026-11-02T12:00:00Z');t.mock.method(Date,'now',()=>now);
 const config={server:{host:'127.0.0.1',port:0,authToken:'test-workflow-token',allowedOrigins:[],maxMcpSessions:8,mcpSessionIdleMinutes:1},stateDir:dir,workspaceRoots:[],workflow:enabled===null?undefined:{enabled,timeZone:'UTC'},codex:{networkAccess:false},profiles:{},limits:{maxStoredEventsPerTask:30,maxConcurrentTasks:1}};
 const store=new TaskStore(dir),executor=new RecordingExecutor('codex');const orchestrator=new Orchestrator({config,store,executors:new Map([['codex',executor]]),defaultProvider:'codex'});
 const task=store.createTask({workspace:'/private/workflow',brief:{objective:'private-body-marker'},policy:{name:'economy'},executor:'codex'});store.updateTask(task.id,{status:'completed',result:{summary:'private-result-marker'}});
 const target={repository:'owner/repo',pull_request_number:12,head_sha:'a'.repeat(40)};store.recordDelivery(task.id,{...target,branch:'feat/api',observed_at:new Date(now-1000).toISOString()});
 const evidence={clock:()=>now,authorizeUser:async id=>id==='private-user-marker',adapter:{readObservation:async()=>({...target,checks:'passed',complete:true,observed_at:new Date(now-100).toISOString(),valid_until:new Date(now+30000).toISOString(),decisions:[{user_id:'private-user-marker',event_id:'private-event-marker',head_sha:target.head_sha,state:'approved',occurred_at:new Date(now-500).toISOString()}]}),readHead:async()=>target}};
 const app=await createApplication({config,store,orchestrator,executors:new Map([['codex',executor]]),startCodex:false,deliveryEvidence:trusted?evidence:{}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;
 const headers={'content-type':'application/json',authorization:'Bearer test-workflow-token',accept:'application/json, text/event-stream'};
 const call=(url,body,override={})=>fetch(base+url,{method:body===undefined?'GET':'POST',headers:{...headers,...override},...(body===undefined?{}:{body:JSON.stringify(body)})});let id=0;
 const rpc=async(method,params,notification=false)=>{const r=await fetch(base+'/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',method,params,...(notification?{}:{id:++id})})});if(r.headers.get('mcp-session-id'))headers['mcp-session-id']=r.headers.get('mcp-session-id');const text=await r.text(),data=text.startsWith('event:')?text.split('\n').find(s=>s.startsWith('data: '))?.slice(6):text;return data?JSON.parse(data):null;};
 t.after(async()=>{if(headers['mcp-session-id'])await fetch(base+'/mcp',{method:'DELETE',headers}).then(r=>r.text());await app.close();fs.rmSync(dir,{recursive:true,force:true});});return {app,store,executor,task,call,rpc};
}
async function init(rpc){await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'workflow-offline-test',version:'1'}});await rpc('notifications/initialized',{},true);}

test('HTTP archive removes only active view after safe report and preserves historical task API',async t=>{
 const f=await setup(t);assert.equal((await (await f.call('/v1/tasks?view=active')).json()).tasks.length,1);
 assert.equal((await f.call(`/v1/tasks/${f.task.id}/archive`,{})).status,200);
 assert.equal((await (await f.call('/v1/tasks?view=active')).json()).tasks.length,0);assert.equal((await (await f.call('/v1/tasks')).json()).tasks.length,1);assert.equal((await f.call(`/v1/tasks/${f.task.id}`)).status,200);
 const report=await (await f.call('/v1/reports/2026-11-02')).json();assert.equal(report.report.entries.length,1);
 for(const marker of ['private-body-marker','private-result-marker','private-user-marker','private-event-marker','/private/workflow'])assert.equal(JSON.stringify(report).includes(marker),false);
 assert.equal(f.executor.turnStarts.length,0);
});

test('MCP worklist and report reads do not approve; archive requires existing trusted user decision',async t=>{
 const f=await setup(t);await init(f.rpc);const tools=(await f.rpc('tools/list',{})).result.tools;
 assert.equal(tools.find(t=>t.name==='list_active_tasks').annotations.readOnlyHint,true);assert.equal(tools.find(t=>t.name==='daily_report').annotations.readOnlyHint,true);assert.equal(tools.find(t=>t.name==='archive_task').annotations.readOnlyHint,false);
 assert.equal((await f.rpc('tools/call',{name:'list_active_tasks',arguments:{}})).result.structuredContent.tasks.length,1);
 const archived=await f.rpc('tools/call',{name:'archive_task',arguments:{task_id:f.task.id}});assert.notEqual(archived.result.isError,true);
 assert.equal((await f.rpc('tools/call',{name:'daily_report',arguments:{date:'2026-11-02'}})).result.structuredContent.report.entries.length,1);
 assert.equal((await f.rpc('tools/call',{name:'list_tasks',arguments:{}})).result.structuredContent.tasks.length,1);
});

test('unconfigured policy disabled defaults auth and caller approval flags remain fail-closed',async t=>{
 const f=await setup(t,{trusted:false});assert.equal((await f.call(`/v1/tasks/${f.task.id}/archive`,{}, {authorization:'Bearer wrong'})).status,401);assert.equal((await f.call(`/v1/tasks/${f.task.id}/archive`,{}, {origin:'https://evil.example'})).status,403);
 assert.equal((await f.call(`/v1/tasks/${f.task.id}/archive`,{approved:true})).status,400);assert.equal((await f.call(`/v1/tasks/${f.task.id}/archive`,{})).status,400);assert.equal((await (await f.call('/v1/tasks?view=active')).json()).tasks.length,1);
 const off=await setup(t,{enabled:null});assert.equal((await off.call(`/v1/tasks/${off.task.id}/archive`,{})).status,400);assert.equal((await off.call('/v1/reports/2026-11-02')).status,400);
});

test('unknown workflow tool fields and report paths never reflect sensitive markers',async t=>{
 const f=await setup(t);await init(f.rpc);const marker='private-request-marker';
 for(const [name,args]of [['archive_task',{task_id:f.task.id,human:true,[marker]:marker}],['daily_report',{date:'../'+marker}],['list_active_tasks',{[marker]:marker}]]){
  const r=await f.rpc('tools/call',{name,arguments:args});assert.equal(r.error?.code,-32602);assert.equal(JSON.stringify(r).includes(marker),false);
 }
 assert.equal((await (await f.call('/v1/tasks?view=active')).json()).tasks.length,1);
});

test('workflow configuration and dashboard request helper preserve default history behavior',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acp-workflow-config-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'config.json');fs.writeFileSync(file,'{}');assert.deepEqual(loadConfig(file).workflow,{enabled:false,timeZone:'UTC'});
 for(const workflow of [{enabled:'yes'},{timeZone:'not/a/timezone'},{approved:true}]){fs.writeFileSync(file,JSON.stringify({workflow}));assert.throws(()=>loadConfig(file),e=>e.code==='invalid_config');}
 assert.equal(new URL(taskListUrl('code & review',false),'http://local').searchParams.has('view'),false);assert.equal(new URL(taskListUrl('code & review',true),'http://local').searchParams.get('view'),'active');assert.equal(new URL(taskListUrl('code & review',true),'http://local').searchParams.get('query'),'code & review');
});
