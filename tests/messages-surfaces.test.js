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

async function app(t,enabled=true){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acp-message-api-'));const workspace=path.join(dir,'workspace');fs.mkdirSync(workspace);
 const config={server:{host:'127.0.0.1',port:0,authToken:'test-message-token',allowedOrigins:[],maxMcpSessions:4,mcpSessionIdleMinutes:1},stateDir:path.join(dir,'state'),workspaceRoots:[workspace],messages:enabled===null?undefined:{enabled,maxStoredMessages:1024},executor:{provider:'codex',routing:{order:['codex']}},codex:{networkAccess:false,approvalPolicy:'never',sandbox:'workspace-write'},profiles:{economy:{model:'fake',effort:'low',maxSubagents:0,tokenBudget:30000,summary:'concise'}},limits:{maxBriefCharacters:24000,maxConcurrentTasks:1,maxQueuedTasks:10,maxTokenBudget:250000,maxStoredEventsPerTask:30,maxTaskRuntimeMinutes:1,discoveryRefreshMs:0}};
 const store=new TaskStore(config.stateDir),executor=new RecordingExecutor('codex');const orchestrator=new Orchestrator({config,store,executors:new Map([['codex',executor]]),defaultProvider:'codex'});
 const application=await createApplication({config,store,orchestrator,executors:new Map([['codex',executor]]),startCodex:false});await new Promise(r=>application.server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${application.server.address().port}`,headers={'content-type':'application/json',authorization:'Bearer test-message-token',accept:'application/json, text/event-stream'};
 const call=(url,body,override={})=>fetch(base+url,{method:body===undefined?'GET':'POST',headers:{...headers,...override},...(body===undefined?{}:{body:JSON.stringify(body)})});
 let id=0;const rpc=async(method,params,notification=false)=>{const r=await fetch(base+'/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',method,params,...(notification?{}:{id:++id})})});if(r.headers.get('mcp-session-id'))headers['mcp-session-id']=r.headers.get('mcp-session-id');const text=await r.text();const data=text.startsWith('event:')?text.split('\n').find(l=>l.startsWith('data: '))?.slice(6):text;return data?JSON.parse(data):null;};
 t.after(async()=>{if(headers['mcp-session-id'])await fetch(base+'/mcp',{method:'DELETE',headers}).then(r=>r.text());await application.close();fs.rmSync(dir,{recursive:true,force:true});});
 return {call,rpc,store,executor,request:{workspace,objective:'surface fake task',profile:'economy'}};
}
const msg=(extra={})=>({message_id:'surface-1',conversation_id:'group-1',channel:'foreground',kind:'discussion',text:'untrusted local text',...extra});
async function init(rpc){await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'message-test',version:'1'}});await rpc('notifications/initialized',{},true);}

test('HTTP foreground and MCP background share one message without starting a turn',async t=>{
 const s=await app(t);let r=await s.call('/v1/messages',msg());assert.equal(r.status,201);
 await init(s.rpc);const tools=(await s.rpc('tools/list',{})).result.tools;assert.equal(tools.find(t=>t.name==='list_messages').annotations.readOnlyHint,true);
 const posted=await s.rpc('tools/call',{name:'post_message',arguments:msg({channel:'background'})});assert.notEqual(posted.result.isError,true);
 const messages=(await (await s.call('/v1/messages?conversation_id=group-1')).json()).messages;assert.equal(messages.length,1);assert.deepEqual(messages[0].channels,['foreground','background']);
 assert.equal((await s.rpc('tools/call',{name:'list_messages',arguments:{}})).result.structuredContent.messages.length,1);assert.equal(s.executor.turnStarts.length,0);assert.equal(s.store.listTasks().length,0);
});

test('existing HTTP auth Origin and disabled defaults protect both message writes and reads',async t=>{
 const s=await app(t,null);assert.equal((await s.call('/v1/messages',undefined,{authorization:'Bearer wrong'})).status,401);
 assert.equal((await s.call('/v1/messages',msg(),{origin:'https://evil.example'})).status,403);
 assert.deepEqual(await (await s.call('/v1/messages')).json(),{enabled:false,messages:[]});
 assert.equal((await s.call('/v1/messages',msg())).status,400);assert.equal(s.store.listMessages().length,0);
});

test('HTTP explicit dispatch replays one task across foreground and background',async t=>{
 const s=await app(t);const message=msg({kind:'execution_request'});
 const a=await (await s.call('/v1/messages/dispatch',{message,request:s.request})).json();
 const b=await (await s.call('/v1/messages/dispatch',{message:{...message,channel:'background'},request:s.request})).json();
 assert.equal(a.task.id,b.task.id);assert.equal(a.message.execution_task_id,a.task.id);
 for(let i=0;i<200&&s.store.getTask(a.task.id).status!=='completed';i++)await new Promise(r=>setTimeout(r,5));
 assert.equal(s.executor.turnStarts.length,1);assert.equal(s.store.getTask(a.task.id).status,'completed');
});

test('claimed human identity and unknown fields are rejected without reflecting bodies',async t=>{
 const s=await app(t);const marker='private-message-marker';await init(s.rpc);
 for(const args of [{...msg(),human:true},{...msg(),[marker]:marker}]){
  const reply=await s.rpc('tools/call',{name:'post_message',arguments:args});assert.equal(reply.error?.code,-32602);assert.equal(JSON.stringify(reply).includes(marker),false);
  const response=await s.call('/v1/messages',args);assert.equal(response.status,400);assert.equal((await response.text()).includes(marker),false);
 }
 assert.equal(s.store.listTasks().length,0);
});

test('real config retains disabled defaults and bounds message capacity without optional dependencies',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acp-message-config-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'config.json');fs.writeFileSync(file,'{}');assert.deepEqual(loadConfig(file).messages,{enabled:false,maxStoredMessages:1024});
 for(const messages of [{enabled:'yes'},{maxStoredMessages:0},{maxStoredMessages:4097},{approved:true}]){fs.writeFileSync(file,JSON.stringify({messages}));assert.throws(()=>loadConfig(file),e=>e.code==='invalid_config');}
});

test('unknown prototype-like tool names remain protocol errors and leave the session usable',async t=>{
 const s=await app(t);await init(s.rpc);
 for(const name of ['constructor','toString','__proto__']){
  const reply=await s.rpc('tools/call',{name,arguments:{}});assert.equal(typeof reply.error?.code==='number'||reply.result?.isError===true,true);
 }
 assert.equal((await s.rpc('tools/call',{name:'list_messages',arguments:{}})).result.structuredContent.messages.length,0);
});

test('unexpected storage failures return fixed errors without private details',async t=>{
 const s=await app(t);t.mock.method(s.store,'audit',()=>{throw new Error('private-audit-marker');});
 const response=await s.call('/v1/messages',msg());assert.equal((await response.text()).includes('private-audit-marker'),false);
});
