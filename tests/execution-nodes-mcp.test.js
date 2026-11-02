import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createApplication } from '../src/server.js';
import { createMcpHandler } from '../src/mcp/server.js';

async function withMcp(options,callback){
 const never=new Proxy({}, {get(){throw new Error('unexpected execution/store access');}});
 const handle=createMcpHandler({orchestrator:never,store:never,config:{server:{mcpSessionIdleMinutes:1,maxMcpSessions:2},codex:{networkAccess:false},...options.config},...options});
 let app, stateDir;
 if(options.application){
  stateDir=fs.mkdtempSync(path.join(os.tmpdir(),'acp-node-host-'));
  class OfflineExecutor extends EventEmitter { stop(){} }
  app=await createApplication({config:{server:{host:'127.0.0.1',port:0,authToken:null,allowedOrigins:[],maxMcpSessions:2,mcpSessionIdleMinutes:1},stateDir,limits:{maxStoredEventsPerTask:20},codex:{networkAccess:false},executionNodes:nodes},codex:new OfflineExecutor(),orchestrator:never,startCodex:false,executionNodeObserver:options.executionNodeObserver});
 }
 const server=app?.server??http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;await handle(req,res,body?JSON.parse(body):undefined);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const endpoint=`http://127.0.0.1:${server.address().port}/mcp`;
 const headers={'content-type':'application/json',accept:'application/json, text/event-stream'};let id=0;
 const post=async(method,params,notification=false)=>{
  const r=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',method,params,...(notification?{}:{id:++id})})});
  if(r.headers.get('mcp-session-id'))headers['mcp-session-id']=r.headers.get('mcp-session-id');
  const raw=await r.text();const data=raw.startsWith('event:')?raw.split('\n').find(line=>line.startsWith('data: '))?.slice(6):raw;
  return data?JSON.parse(data):null;
 };
 try{
  await post('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'offline-node-test',version:'1.0'}});
  await post('notifications/initialized',{},true);await callback(post);
 }finally{
  if(headers['mcp-session-id'])await fetch(endpoint,{method:'DELETE',headers}).then(r=>r.text());
  if(app)await app.close();else await new Promise(r=>server.close(r));
  if(stateDir)fs.rmSync(stateDir,{recursive:true,force:true});
 }
}
const nodes={enabled:true,nodes:[{id:'desktop',kind:'local',authorized:true,executor_ids:['codex']}]};
const now=Date.parse('2026-11-02T08:00:00Z');
const observation={node_id:'desktop',observed_at:'2026-11-02T07:59:59Z',valid_until:'2026-11-02T08:00:30Z',online:true,runtime_ready:true,workspace_ready:true,authentication_ready:true,persistent:true};

test('legacy config exposes read-only node view without contacting host observers',async()=>{
 await withMcp({executionNodeObserver:()=>{throw new Error('private-observer-secret');}},async post=>{
  const tools=(await post('tools/list',{})).result.tools;
  const tool=tools.find(t=>t.name==='execution_nodes');assert.ok(tool);assert.equal(tool.annotations.readOnlyHint,true);assert.equal(tool.annotations.destructiveHint,false);assert.equal(tool.annotations.openWorldHint,false);
  assert.ok(tools.some(t=>t.name==='dispatch_project'));
  const r=await post('tools/call',{name:'execution_nodes',arguments:{}});assert.equal(r.result.structuredContent.reason,'disabled');assert.equal(JSON.stringify(r).includes('private-observer-secret'),false);
 });
});

test('cached host observations allow only advice and expire without starting a task',async()=>{
 let clock=now;
 await withMcp({config:{executionNodes:nodes,server:{mcpSessionIdleMinutes:1,maxMcpSessions:2}},executionNodeObserver:()=>[observation],executionNodeClock:()=>clock},async post=>{
  const call=()=>post('tools/call',{name:'execution_nodes',arguments:{executor_id:'codex'}});
  let r=await call();assert.equal(r.result.structuredContent.selected_node_id,'desktop');assert.equal(r.result.structuredContent.execution_authorized,false);
  clock=now+30000;r=await call();assert.equal(r.result.structuredContent.selected_node_id,null);
 });
});

test('caller evidence and approvals cannot become host observations or leak rejected fields',async()=>{
 await withMcp({config:{executionNodes:nodes,server:{mcpSessionIdleMinutes:1,maxMcpSessions:2}}},async post=>{
  const plain=await post('tools/call',{name:'execution_nodes',arguments:{}});assert.equal(plain.result.structuredContent.nodes[0].availability,'unknown');
  for(const args of [{observations:[observation],approved:true},{'private-argument-marker':'private-value-marker'},{requested_node_id:'../private-value-marker'},{executor_id:[]},null]){
   const r=await post('tools/call',{name:'execution_nodes',arguments:args});assert.equal(r.error?.code,-32602);assert.equal(JSON.stringify(r).includes('private-'),false);
  }
  assert.equal((await post('tools/call',{name:'execution_nodes',arguments:{}})).result.structuredContent.selected_node_id,null);
 });
});

test('host failure and raw fields degrade to unknown without reflecting errors or credentials',async()=>{
 for(const observer of [()=>{throw new Error('private-host-secret');},()=>[{...observation,token:'private-host-secret'}],()=>Promise.resolve([observation]),()=>Promise.reject(new Error("private-host-secret"))]){
  await withMcp({config:{executionNodes:nodes,server:{mcpSessionIdleMinutes:1,maxMcpSessions:2}},executionNodeObserver:observer,executionNodeClock:()=>now},async post=>{
   const r=await post('tools/call',{name:'execution_nodes',arguments:{}});assert.equal(r.result.structuredContent.selected_node_id,null);assert.equal(JSON.stringify(r).includes('private-host-secret'),false);
  });
 }
});


test('application host injection reaches MCP without configuration or caller evidence substituting it',async()=>{
 const observed=Date.now();
 await withMcp({application:true,executionNodeObserver:()=>[{...observation,observed_at:new Date(observed).toISOString(),valid_until:new Date(observed+30000).toISOString()}]},async post=>{
  const r=await post('tools/call',{name:'execution_nodes',arguments:{}});
  assert.equal(r.result.structuredContent.selected_node_id,'desktop');
  assert.equal(r.result.structuredContent.execution_authorized,false);
 });
});
