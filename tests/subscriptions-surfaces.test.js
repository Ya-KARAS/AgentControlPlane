import assert from 'node:assert/strict'; import test from 'node:test';
import {EventEmitter} from 'node:events'; import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import vm from 'node:vm';
import {createApplication} from '../src/server.js';import {TaskStore} from '../src/core/store.js';import * as dashboard from '../src/dashboard.js';
class Passive extends EventEmitter {ready=true;stop(){}}
async function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acp-subscription-http-'));const store=new TaskStore(dir);const config={server:{host:'127.0.0.1',port:0,authToken:'test-secret',allowedOrigins:[],maxMcpSessions:2,mcpSessionIdleMinutes:1},stateDir:dir,limits:{maxStoredEventsPerTask:20},profiles:{},codex:{networkAccess:false}};const app=await createApplication({config,store,codex:new Passive(),orchestrator:{},startCodex:false});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(async()=>{await app.close();fs.rmSync(dir,{recursive:true,force:true});});return {base:`http://127.0.0.1:${app.server.address().port}`,store,config};}
test('subscription GET uses existing auth, is read-only and has no write route',async t=>{
 const {base,store}=await setup(t);const headers={authorization:'Bearer test-secret'};
 assert.equal((await fetch(base+'/v1/subscriptions')).status,401);
 const result=await fetch(base+'/v1/subscriptions',{headers});assert.equal(result.status,200);assert.deepEqual(await result.json(),{snapshots:[],advisory:[],advisory_only:true});
 assert.equal((await fetch(base+'/v1/subscriptions',{method:'POST',headers})).status,404);assert.deepEqual(store.listTasks(),[]);assert.equal(fs.existsSync(store.statePath),false);
});
test('MCP discovery and call expose safe read-only subscription status, without mutating state',async t=>{
 const {base,store}=await setup(t);const headers={'content-type':'application/json',accept:'application/json, text/event-stream',authorization:'Bearer test-secret'};
 let next=1;async function post(method,params,notification=false){const r=await fetch(base+'/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',...(notification?{}:{id:next++}),method,params})});const sid=r.headers.get('mcp-session-id');if(sid)headers['mcp-session-id']=sid;const raw=await r.text();const json=raw.startsWith('event:')?raw.split('\n').find(x=>x.startsWith('data: '))?.slice(6):raw;return json?JSON.parse(json):null;}
 const discovery=await post('server/discover',{});const tool=discovery.result.tools.find(x=>x.name==='subscription_status');assert.ok(tool);assert.equal(tool.annotations.readOnlyHint,true);assert.equal(discovery.result.tools.some(x=>/import_subscription|record_subscription/.test(x.name)),false);
 await post('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test',version:'1'}});await post('notifications/initialized',{},true);
 const result=await post('tools/call',{name:'subscription_status',arguments:{apiKey:'not-an-input'}});assert.deepEqual(result.result.structuredContent,{snapshots:[],advisory:[],advisory_only:true});assert.equal(fs.existsSync(store.statePath),false);
 await fetch(base+'/mcp',{method:'DELETE',headers});
});
test('subscription panel executes safely with malicious labels and represents null separately from zero',()=>{
 assert.equal(typeof dashboard.subscriptionPanelHtml,'function');
 const render=vm.runInNewContext('('+dashboard.subscriptionPanelHtml.toString()+')');
 const input={snapshots:[{provider:'x',surface:'cli',account_alias:'alias',plan:'<img src=x onerror=evil()>',model_family:null,quota_window:null,availability:'unknown',remaining_percent:null,reset_at:null,source:'manual',confidence:'user_reported',observed_at:'date',valid_until:'2099-01-01T00:00:00Z',freshness:'fresh',overage_status:'unknown'}],advisory:[]};
 const html=render(input,'en');assert.ok(!html.includes('<img'));assert.ok(html.includes('&lt;img'));assert.ok(html.includes('unknown'));assert.ok(!html.includes('0%'));
 input.snapshots[0].remaining_percent=0;assert.ok(render(input,'en').includes('0%'));
 assert.ok(render(null,'en').includes('unknown'));assert.ok(!render(null,'en').includes('available'));
});

test('failed panel refresh clears previously green information before awaiting or failing',async()=>{
 assert.equal(typeof dashboard.refreshSubscriptionPanel,'function');
 const target={innerHTML:'available 90%'};
 await dashboard.refreshSubscriptionPanel(async()=>{assert.ok(!target.innerHTML.includes('90%'));throw new Error('offline');},target,'en');
 assert.ok(target.innerHTML.includes('unknown'));assert.ok(!target.innerHTML.includes('available'));
});
