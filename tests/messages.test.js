import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MessageHub } from '../src/core/messages.js';
import { TaskStore } from '../src/core/store.js';
import { Orchestrator } from '../src/core/orchestrator.js';
import { RecordingExecutor } from './fixtures/recording-executor.js';

function setup(t,{maxMessages=1024,maxTasks=2000}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acp-messages-'));const workspace=path.join(dir,'workspace');fs.mkdirSync(workspace);t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=new TaskStore(path.join(dir,'state'),30,maxTasks);const executor=new RecordingExecutor('codex');
 const config={workspaceRoots:[workspace],executor:{provider:'codex',routing:{order:['codex']}},codex:{approvalPolicy:'never',sandbox:'workspace-write',networkAccess:false},profiles:{economy:{model:'fake',effort:'low',maxSubagents:0,tokenBudget:30000,summary:'concise'}},limits:{maxBriefCharacters:24000,maxConcurrentTasks:1,maxQueuedTasks:10,maxTokenBudget:250000,maxStoredEventsPerTask:30,maxTaskRuntimeMinutes:1,discoveryRefreshMs:0}};
 const orchestrator=new Orchestrator({config,store,executors:new Map([['codex',executor]]),defaultProvider:'codex'});
 const hub=new MessageHub({store,orchestrator,enabled:true,maxMessages});
 return {dir,workspace,store,executor,orchestrator,hub,request:{workspace,objective:'one message task',profile:'economy'}};
}
const message=(patch={})=>({message_id:'message-1',conversation_id:'group-1',channel:'foreground',kind:'discussion',text:'Reviewed local discussion',...patch});
const fails=(fn,code)=>assert.throws(fn,e=>e.code===code);
async function until(fn){for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw new Error('message task did not finish');}

test('foreground and background share one immutable message and never auto-dispatch',t=>{
 const s=setup(t);s.hub.post(message());s.hub.post(message({channel:'background'}));
 const result=s.hub.list({conversation_id:'group-1'});assert.equal(result.messages.length,1);assert.deepEqual(result.messages[0].channels,['foreground','background']);
 assert.equal(result.messages[0].sender_verified,false);assert.equal(s.store.listTasks(100).length,0);assert.equal(s.executor.turnStarts.length,0);
 fails(()=>s.hub.post(message({text:'changed intent'})),'message_conflict');
});

test('strict bounded messages reject approval identity and oversize assertions safely',t=>{
 const s=setup(t);
 for(const value of [null,{...message(),human:true},{...message(),sender:'trusted-human'},{...message(),approval:'approved'},{...message(),message_id:'../secret'},{...message(),text:'x'.repeat(4097)},{...message(),text:'😀'.repeat(3000)}])fails(()=>s.hub.post(value),'invalid_message');
 const off=new MessageHub({store:s.store,orchestrator:s.orchestrator});fails(()=>off.post(message()),'messages_disabled');assert.deepEqual(off.list({}),{enabled:false,messages:[]});
});

test('one operation key deduplicates explicit dispatch across channels and cold restart',async t=>{
 const s=setup(t);const input=message({kind:'execution_request'});
 const first=s.hub.dispatch(input,s.request);const again=s.hub.dispatch({...input,channel:'background'},s.request);assert.equal(again.task.id,first.task.id);
 await until(()=>s.store.getTask(first.task.id).status==='completed');assert.equal(s.executor.turnStarts.length,1);
 const fresh=new TaskStore(s.store.stateDir);const hub=new MessageHub({store:fresh,orchestrator:s.orchestrator,enabled:true});
 assert.equal(hub.dispatch(input,s.request).task.id,first.task.id);assert.equal(fresh.listTasks(100).length,1);
 fails(()=>s.hub.dispatch(input,{...s.request,objective:'different work'}),'idempotency_conflict');
});

test('mapping failure after dispatch retries the existing task rather than a second turn',async t=>{
 const s=setup(t);const real=s.store.linkMessageTask.bind(s.store);let once=true;
 t.mock.method(s.store,'linkMessageTask',(...args)=>{if(once){once=false;throw new Error('simulated link failure');}return real(...args);});
 assert.throws(()=>s.hub.dispatch(message({kind:'execution_request'}),s.request));
 const existing=s.store.listTasks(100)[0];await until(()=>s.store.getTask(existing.id).status==='completed');
 assert.equal(s.hub.dispatch(message({kind:'execution_request',channel:'background'}),s.request).task.id,existing.id);assert.equal(s.executor.turnStarts.length,1);
});

test('message continuation uses the existing logical lineage and parent edge',async t=>{
 const s=setup(t);const first=s.hub.dispatch(message({kind:'execution_request'}),s.request).task;await until(()=>s.store.getTask(first.id).status==='completed');
 const follow=message({message_id:'message-2',kind:'execution_request',task_id:first.id});
 const next=s.hub.dispatch(follow,{objective:'continue same work',profile:'economy'}).task;
 assert.equal(next.logical_task_id,first.logical_task_id);assert.equal(next.parentTaskId,first.id);
 assert.equal(s.hub.dispatch({...follow,channel:'background'},{objective:'continue same work',profile:'economy'}).task.id,next.id);
 await until(()=>s.store.getTask(next.id).status==='completed');assert.equal(s.executor.turnStarts.length,2);
});

test('capacity and write failures retain existing messages without logging their bodies',t=>{
 const s=setup(t,{maxMessages:1});s.hub.post(message());fails(()=>s.hub.post(message({message_id:'message-2'})),'message_capacity_reached');
 const audit=fs.readFileSync(s.store.auditPath,'utf8');assert.equal(audit.includes('Reviewed local discussion'),false);
 const before=s.hub.list({});t.mock.method(fs,'renameSync',()=>{throw new Error('private-filesystem-marker');});
 assert.throws(()=>s.hub.post(message({channel:'background'})));assert.deepEqual(s.hub.list({}),before);assert.equal(s.store.checkpointFaulted,true);
});

test('message-owned tasks remain idempotent under task capacity pressure',async t=>{
 const s=setup(t,{maxTasks:1});const input=message({kind:'execution_request'});const task=s.hub.dispatch(input,s.request).task;await until(()=>s.store.getTask(task.id).status==='completed');
 fails(()=>s.orchestrator.dispatch({...s.request,idempotency_key:'unrelated:capacity'}),'task_capacity_reached');
 assert.equal(s.hub.dispatch(input,s.request).task.id,task.id);assert.equal(s.executor.turnStarts.length,1);
});

import { NodeRecoveryCoordinator } from '../src/core/node-recovery.js';
test('task pruning cannot discard an unresolved execution-node reservation',t=>{
 const s=setup(t,{maxTasks:1});const task=s.orchestrator.dispatch(s.request);
 const clock=Date.now();const recovery=new NodeRecoveryCoordinator({store:s.store,config:{enabled:true,nodes:[{id:'desktop',kind:'local',authorized:true,executor_ids:['codex']}]},sourceNodeId:'desktop',targetNodeId:'desktop',inspectSource:()=>({task_id:task.id,node_id:'desktop',generation:1,stopped:true,branch:'feat/checkpoint',head:'a'.repeat(40),files:[],tests:[],observed_at:new Date(clock).toISOString(),valid_until:new Date(clock+30000).toISOString()})});
 recovery.bind(task.id);recovery.checkpoint(task.id,1);
 fails(()=>s.store.createTask({workspace:s.workspace,brief:task.brief,policy:task.policy,executor:'codex'}),'task_capacity_reached');
 assert.equal(s.store.getTask(task.id).node_recovery.phase,'checkpointed');
});
