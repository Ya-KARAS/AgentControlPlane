import assert from 'node:assert/strict';import test from 'node:test';import {EventEmitter} from 'node:events';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import vm from 'node:vm';
import {createApplication} from '../src/server.js';import {TaskStore} from '../src/core/store.js';import {dashboardHtml,deliverySummaryHtml} from '../src/dashboard.js';
class Passive extends EventEmitter {ready=true;stop(){}}
async function setup(callback){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acp-delivery-surface-'));const store=new TaskStore(dir);const task=store.createTask({workspace:'/private/path',brief:{objective:'private-prompt'},policy:{name:'economy'}});const app=await createApplication({config:{server:{host:'127.0.0.1',port:0,authToken:'test-token',allowedOrigins:[],maxMcpSessions:2,mcpSessionIdleMinutes:1},stateDir:dir,limits:{maxStoredEventsPerTask:20},profiles:{},codex:{networkAccess:false}},store,codex:new Passive(),orchestrator:{},startCodex:false});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;const headers={'content-type':'application/json',accept:'application/json, text/event-stream',authorization:'Bearer test-token'};let id=1;
 const rpc=async(method,params,notification=false)=>{const r=await fetch(base+'/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',...(notification?{}:{id:id++}),method,params})});const session=r.headers.get('mcp-session-id');if(session)headers['mcp-session-id']=session;const raw=await r.text();return raw?JSON.parse(raw.startsWith('event:')?raw.split('\n').find(x=>x.startsWith('data: ')).slice(6):raw):null;};
 try{await callback({store,task,base,headers,rpc});}finally{if(headers['mcp-session-id'])await fetch(base+'/mcp',{method:'DELETE',headers}).then(r=>r.text());await app.close();fs.rmSync(dir,{recursive:true,force:true});}}
test('authenticated read-only delivery endpoint returns safe null or unverified metadata only',async()=>{await setup(async({store,task,base,headers})=>{
 const url=base+'/v1/tasks/'+task.id+'/delivery';assert.equal((await fetch(url)).status,401);
 const empty=await fetch(url,{headers});assert.equal(empty.status,200);assert.deepEqual(await empty.json(),{delivery:null,approval_supported:false});
 store.recordDelivery(task.id,{repository:'owner/repo',branch:'feat/task',checks:'passed',observed_at:'2026-11-01T00:00:00Z'});const before=fs.readFileSync(store.statePath,'utf8');
 const response=await fetch(url,{headers});const json=await response.json();assert.equal(json.delivery.checks,'unknown');assert.equal(json.delivery.reported_checks,'passed');assert.equal(JSON.stringify(json).includes('private'),false);
 assert.equal(fs.readFileSync(store.statePath,'utf8'),before);assert.notEqual((await fetch(url,{method:'POST',headers,body:'{}'})).status,200);
});});
test('MCP status registration is readonly and cannot approve or merge',async()=>{await setup(async({task,rpc})=>{
 await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'client',version:'1'}});await rpc('notifications/initialized',{},true);
 const list=await rpc('tools/list',{});const tool=list.result.tools.find(x=>x.name==='delivery_status');assert.ok(tool);assert.equal(tool.annotations.readOnlyHint,true);assert.equal(list.result.tools.some(x=>/approve|merge_delivery/.test(x.name)),false);
 const result=await rpc('tools/call',{name:'delivery_status',arguments:{task_id:task.id,human:true}});assert.equal(result.result.isError,undefined);assert.deepEqual(result.result.structuredContent,{delivery:null,approval_supported:false});
});});
test('shipped dashboard renderer escapes hostile metadata and distinguishes reported from verified',()=>{
 const html=dashboardHtml({server:{}});const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];const declaration=script.slice(script.indexOf('var deliverySummaryHtml = '),script.indexOf('var STRINGS = '));const sandbox={};vm.runInNewContext(declaration,sandbox);
 const result=sandbox.deliverySummaryHtml({repository:'<img src=x onerror=alert(1)>',branch:'feat/x',reported_checks:'passed',reported_review_state:'pending_review',head_sha:'a'.repeat(40)});
 assert.equal(result.includes('<img'),false);assert.ok(result.includes('&lt;img'));assert.match(result,/unverified/);assert.match(result,/unknown/);assert.equal(deliverySummaryHtml(null),'');
});
