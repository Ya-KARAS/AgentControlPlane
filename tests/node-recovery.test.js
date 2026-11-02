import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TaskStore } from '../src/core/store.js';
import { NodeRecoveryCoordinator } from '../src/core/node-recovery.js';
const fail=(fn,code)=>assert.throws(fn,e=>e.code===code);

export function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acp-node-recovery-'));const workspace=path.join(dir,'workspace');fs.mkdirSync(workspace);fs.writeFileSync(path.join(workspace,'edit.txt'),'uncommitted user edit');
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new TaskStore(path.join(dir,'state'));
 const task=store.createTask({workspace,brief:{objective:'recover original task',constraints:[],acceptanceCriteria:[],context:[],evidenceRequired:[]},policy:{name:'economy',model:'fake-model',effort:'low',maxSubagents:0,tokenBudget:30000,summary:'concise'},executor:'codex',idempotencyKey:'node:one-task',requestFingerprint:'f'.repeat(64)});
 const config={enabled:true,nodes:[{id:'desktop',kind:'local',authorized:true,executor_ids:['codex']},{id:'cloud',kind:'cloud',authorized:true,executor_ids:['codex']}]};
 const source={task_id:task.id,node_id:'desktop',generation:1,stopped:true,branch:'feat/recovery',head:'a'.repeat(40),files:[{path:'edit.txt',sha256:'b'.repeat(64)}],tests:[{command:'npm run verify',status:'passed'}],observed_at:new Date().toISOString(),valid_until:new Date(Date.now()+30000).toISOString()};
 const target={task_id:task.id,node_id:'cloud',generation:1,idle:true,ready:true,persistent:true,workspace,branch:source.branch,head:source.head,files:source.files,observed_at:source.observed_at,valid_until:source.valid_until};
 const coordinator=new NodeRecoveryCoordinator({store,config,sourceNodeId:'desktop',targetNodeId:'cloud',inspectSource:()=>source,inspectTarget:()=>target});
 return {dir,workspace,store,task,config,source,target,coordinator};
}
const bind=s=>s.coordinator.bind(s.task.id);
const checkpoint=s=>s.coordinator.checkpoint(s.task.id,1);
const release=s=>s.coordinator.release(s.task.id,1);

test('same task checkpoint release and target admission survive cold restart',t=>{
 const s=setup(t);const old=s.store.getTask(s.task.id);bind(s);checkpoint(s);release(s);const stoppedHistory=s.store.getTask(s.task.id).executor_history;
 let received=0;const orchestrator={enqueueNodeRecovery(id,ticket){received++;assert.equal(id,old.id);assert.equal(ticket.nodeId,'cloud');}};
 const admitted=s.coordinator.resume(old.id,1,'resume:test-1',orchestrator);
 assert.equal(admitted.node_recovery.generation,2);assert.equal(admitted.execution_node_id,'cloud');assert.equal(received,1);
 assert.equal(s.coordinator.resume(old.id,1,'resume:test-1',orchestrator).id,old.id);assert.equal(received,1);
 const restarted=new TaskStore(s.store.stateDir);const restored=restarted.getTask(old.id);
 assert.deepEqual(restored.executor_history.slice(0,-1),stoppedHistory);assert.equal(restored.executor_history.at(-1).execution_node_id,'cloud');
 assert.equal(restored.logical_task_id,old.logical_task_id);assert.deepEqual(restored.usage,old.usage);assert.equal(restored.node_recovery.generation,2);
 assert.equal(fs.readFileSync(path.join(s.workspace,'edit.txt'),'utf8'),'uncommitted user edit');
 assert.equal(restored.threadId,null);assert.equal(restored.fresh_session,true);
});

test('legacy tasks default null and source stop cannot be provided through request flags',t=>{
 const s=setup(t);assert.equal(s.store.getTask(s.task.id).node_recovery,null);assert.equal(s.store.getTask(s.task.id).execution_node_id,null);
 bind(s);s.source.stopped=false;fail(()=>checkpoint(s),'node_source_not_stopped');
 fail(()=>s.store.applyNodeRecovery(s.task.id,{action:'checkpoint',stopped:true,generation:1}),'untrusted_node_recovery');
 assert.equal(s.store.getTask(s.task.id).node_recovery.phase,'owned');
});

test('release requires checkpoint and generations never become controller leases',t=>{
 const s=setup(t);bind(s);fail(()=>release(s),'node_recovery_phase');checkpoint(s);release(s);
 fail(()=>s.coordinator.resume(s.task.id,0,'resume:wrong',{}),'node_generation_mismatch');
 assert.equal(s.store.getTask(s.task.id).control_lease,null);
 fail(()=>s.coordinator.release(s.task.id,0),'node_generation_mismatch');
});

test('old generation and ordinary patches cannot change new owner or task results',t=>{
 const s=setup(t);bind(s);checkpoint(s);release(s);s.coordinator.resume(s.task.id,1,'resume:once',{enqueueNodeRecovery(){}});
 fail(()=>s.coordinator.release(s.task.id,1),'node_generation_mismatch');
 fail(()=>s.store.updateTask(s.task.id,{result:{summary:'stale'}},undefined,{nodeId:'desktop',generation:1}),'node_generation_mismatch');
 fail(()=>s.store.updateTask(s.task.id,{status:'completed'}),'node_generation_mismatch');
 fail(()=>s.store.updateTask(s.task.id,{node_recovery:null}),'node_recovery_update_required');
 fail(()=>s.store.updateTask(s.task.id,{execution_node_id:'desktop'}),'node_recovery_update_required');
 assert.equal(s.store.getTask(s.task.id).execution_node_id,'cloud');
});

for(const [name,change]of [
 ['head',s=>s.target.head='c'.repeat(40)],['dirty hash',s=>s.target.files=[{path:'edit.txt',sha256:'c'.repeat(64)}]],['extra edit',s=>s.target.files=[]],['busy',s=>s.target.idle=false],['ephemeral',s=>s.target.persistent=false],['expired',s=>s.target.valid_until=new Date(0).toISOString()],['sensitive data',s=>s.target.raw='private-secret']
])test(`target ${name} mismatch blocks transfer without overwriting edits`,t=>{
 const s=setup(t);bind(s);checkpoint(s);release(s);change(s);let starts=0;
 assert.throws(()=>s.coordinator.resume(s.task.id,1,'resume:blocked',{enqueueNodeRecovery(){starts++;}}));
 assert.equal(starts,0);assert.equal(s.store.getTask(s.task.id).node_recovery.phase,'released');
 assert.equal(fs.readFileSync(path.join(s.workspace,'edit.txt'),'utf8'),'uncommitted user edit');
});

test('durable admission with enqueue failure becomes uncertain and cannot replay',t=>{
 const s=setup(t);bind(s);checkpoint(s);release(s);let attempts=0;
 fail(()=>s.coordinator.resume(s.task.id,1,'resume:crash',{enqueueNodeRecovery(){attempts++;throw new Error('private-backend-error');}}),'node_recovery_uncertain');
 assert.equal(s.store.getTask(s.task.id).status,'blocked');assert.equal(s.store.getTask(s.task.id).node_recovery.phase,'uncertain');
 s.coordinator.resume(s.task.id,1,'resume:crash',{enqueueNodeRecovery(){attempts++;}});assert.equal(attempts,1);
});

test('write failure retains old in-memory owner and faults writer without admitting execution',t=>{
 const s=setup(t);bind(s);checkpoint(s);release(s);let starts=0;
 t.mock.method(fs,'renameSync',()=>{throw new Error('private-filesystem-error');});
 assert.throws(()=>s.coordinator.resume(s.task.id,1,'resume:write',{enqueueNodeRecovery(){starts++;}}));
 assert.equal(starts,0);assert.equal(s.store.getTask(s.task.id).node_recovery.phase,'released');assert.equal(s.store.checkpointFaulted,true);
});

test('stale writer cannot replace durable node state after another authority commits',t=>{
 const s=setup(t);const stale=new TaskStore(s.store.stateDir);bind(s);
 const other=new NodeRecoveryCoordinator({store:stale,config:s.config,sourceNodeId:'desktop',targetNodeId:'cloud',inspectSource:()=>s.source,inspectTarget:()=>s.target});
 fail(()=>other.bind(s.task.id),'checkpoint_store_drift');assert.equal(new TaskStore(s.store.stateDir).getTask(s.task.id).execution_node_id,'desktop');
});

import { Orchestrator } from '../src/core/orchestrator.js';
import { RecordingExecutor } from './fixtures/recording-executor.js';
function runtime(s,nodeId='cloud',store=s.store){
 const executor=new RecordingExecutor('codex');
 const config={workspaceRoots:[s.workspace],controllers:{enabled:false},executor:{provider:'codex',routing:{order:['codex']}},codex:{approvalPolicy:'never',sandbox:'workspace-write',networkAccess:false},profiles:{economy:{model:'fake-model',effort:'low',maxSubagents:0,tokenBudget:30000,summary:'concise'}},limits:{maxBriefCharacters:24000,maxConcurrentTasks:1,maxQueuedTasks:10,maxTokenBudget:250000,maxStoredEventsPerTask:30,maxTaskRuntimeMinutes:1,discoveryRefreshMs:0}};
 return {executor,orchestrator:new Orchestrator({config,store,executors:new Map([['codex',executor]]),defaultProvider:'codex',executionNodeId:nodeId})};
}
async function until(fn){for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw new Error('offline execution did not complete');}

test('recovery uses the same logical task and existing queue once with fresh target session',async t=>{
 const s=setup(t);bind(s);checkpoint(s);release(s);const {executor,orchestrator}=runtime(s);
 s.coordinator.resume(s.task.id,1,'resume:one-turn',orchestrator);
 s.coordinator.resume(s.task.id,1,'resume:one-turn',orchestrator);
 await until(()=>s.store.getTask(s.task.id).status==='completed');
 assert.equal(executor.turnStarts.length,1);assert.equal(executor.turnStarts[0].input[0].text.includes('a'.repeat(40)),true);assert.equal(executor.turnStarts[0].input[0].text.includes('edit.txt'),true);assert.equal(executor.resumedThreads.length,0);assert.equal(s.store.listTasks(100).length,1);
 const completed=s.store.getTask(s.task.id);assert.equal(completed.logical_task_id,s.task.logical_task_id);assert.equal(completed.node_recovery.phase,'awaiting_stop');
 const stop=new NodeRecoveryCoordinator({store:s.store,config:s.config,sourceNodeId:'cloud',targetNodeId:'desktop',inspectSource:task=>({...s.source,node_id:'cloud',task_id:task.id,generation:task.node_recovery.generation})});
 stop.complete(s.task.id,2,orchestrator);assert.equal(s.store.getTask(s.task.id).node_recovery.phase,'completed');
 s.coordinator.resume(s.task.id,1,'resume:one-turn',orchestrator);await new Promise(r=>setTimeout(r,20));assert.equal(executor.turnStarts.length,1);
 await executor.stop();
});

test('cold restart of durable admission blocks automatic replay and ignores old generation',async t=>{
 const s=setup(t);bind(s);checkpoint(s);release(s);s.coordinator.resume(s.task.id,1,'resume:before-crash',{enqueueNodeRecovery(){}});
 const restarted=new TaskStore(s.store.stateDir);const {executor,orchestrator}=runtime(s,'cloud',restarted);
 await orchestrator.start();
 assert.equal(restarted.getTask(s.task.id).status,'blocked');assert.equal(restarted.getTask(s.task.id).node_recovery.phase,'uncertain');assert.equal(executor.turnStarts.length,0);
 fail(()=>restarted.updateTask(s.task.id,{status:'completed'},undefined,{nodeId:'desktop',generation:1}),'node_generation_mismatch');
 await executor.stop();
});

test('unbranded admission and wrong-node runtime cannot queue execution',t=>{
 const s=setup(t);bind(s);checkpoint(s);release(s);const {orchestrator,executor}=runtime(s,'wrong-node');
 fail(()=>orchestrator.enqueueNodeRecovery(s.task.id,{nodeId:'cloud',generation:2,taskId:s.task.id}),'node_admission_required');
 fail(()=>s.coordinator.resume(s.task.id,1,'resume:wrong-node',orchestrator),'node_recovery_uncertain');
 assert.equal(executor.turnStarts.length,0);assert.equal(orchestrator.queue.length,0);
});

test('workspace reservation blocks unrelated queued execution during transfer',async t=>{
 const s=setup(t);bind(s);checkpoint(s);
 const other=s.store.createTask({workspace:s.workspace,brief:{objective:'other'},policy:s.task.policy,executor:'codex'});
 const {executor,orchestrator}=runtime(s);await orchestrator.start();await new Promise(r=>setTimeout(r,30));
 assert.equal(executor.turnStarts.length,0);assert.equal(s.store.getTask(other.id).status,'queued');await executor.stop();
});


test('measurements are bound to exact task node and generation before transfer',t=>{
 const s=setup(t);bind(s);
 for(const [key,value]of [['task_id','00000000-0000-4000-8000-000000000000'],['node_id','cloud'],['generation',0]]){
  const old=s.source[key];s.source[key]=value;assert.throws(()=>checkpoint(s));s.source[key]=old;
 }
 checkpoint(s);release(s);
 for(const [key,value]of [['task_id','00000000-0000-4000-8000-000000000000'],['node_id','desktop'],['generation',0]]){
  const old=s.target[key];s.target[key]=value;assert.throws(()=>s.coordinator.resume(s.task.id,1,'resume:bound',{enqueueNodeRecovery(){}}));s.target[key]=old;
 }
 assert.equal(s.store.getTask(s.task.id).node_recovery.phase,'released');
});

test('a second source cannot reserve the same workspace or bypass an existing running task',t=>{
 const s=setup(t);bind(s);
 const other=s.store.createTask({workspace:s.workspace,brief:s.task.brief,policy:s.task.policy,executor:'codex'});
 fail(()=>s.coordinator.bind(other.id),'node_workspace_busy');
 const s2=setup(t);const live=s2.store.createTask({workspace:s2.workspace,brief:s2.task.brief,policy:s2.task.policy,executor:'codex'});s2.store.updateTask(live.id,{status:'running'});fail(()=>bind(s2),'node_workspace_busy');
});

test('late executor readiness after quarantine cannot start a thread or overwrite the checkpoint',async t=>{
 const s=setup(t);bind(s);checkpoint(s);release(s);const {executor,orchestrator}=runtime(s);
 let ready;executor.start=()=>new Promise(r=>{ready=r;});
 s.coordinator.resume(s.task.id,1,'resume:late-start',orchestrator);
 await until(()=>typeof ready==='function');s.coordinator.quarantine(s.task.id,2);ready();
 await until(()=>orchestrator.running.size===0);
 assert.equal(executor.startedThreads.length,0);assert.equal(executor.turnStarts.length,0);assert.equal(s.store.getTask(s.task.id).node_recovery.phase,'uncertain');
});

test('audit failure after admission write never enqueues and leaves writer faulted',t=>{
 const s=setup(t);bind(s);checkpoint(s);release(s);let starts=0;
 t.mock.method(s.store,'audit',()=>{throw new Error('private-audit-error');});
 assert.throws(()=>s.coordinator.resume(s.task.id,1,'resume:audit',{enqueueNodeRecovery(){starts++;}}));
 assert.equal(starts,0);assert.equal(s.store.checkpointFaulted,true);assert.equal(fs.existsSync(s.store.checkpointLeasePath),true);
 assert.equal(new TaskStore(s.store.stateDir).getTask(s.task.id).node_recovery.phase,'admitted');
});

import { normalizeAgentRegistry, resolveControllerActor } from '../src/controllers/registry.js';
test('controller ownership changes leave the execution generation and checkpoint unchanged',t=>{
 const s=setup(t);bind(s);const registry=normalizeAgentRegistry([{id:'dot',principal_id:'trusted-dot'}]);
 const actor=resolveControllerActor({principalId:'trusted-dot',registry});
 s.store.updateControlLease(s.task.id,{actor,action:'claim',generation:0});
 assert.equal(s.store.getTask(s.task.id).control_lease.generation,1);
 assert.equal(s.store.getTask(s.task.id).node_recovery.generation,1);
 s.store.updateControlLease(s.task.id,{actor,action:'renew',generation:1});
 assert.equal(s.store.getTask(s.task.id).execution_node_id,'desktop');
 fail(()=>s.store.updateTask(s.task.id,{status:'running'},{actor,generation:1}),'node_generation_mismatch');
});


test('checkpoint package is bounded before persistence and never copies file contents',t=>{
 const s=setup(t);bind(s);s.source.files=Array.from({length:40},(_,i)=>({path:`f${i}${'x'.repeat(220)}.txt`,sha256:'b'.repeat(64)}));
 assert.throws(()=>checkpoint(s));assert.equal(s.store.getTask(s.task.id).node_recovery.checkpoint,null);
});

test('failed interruption keeps workspace reserved until host measures stop',async t=>{
 const s=setup(t);bind(s);checkpoint(s);release(s);const {executor,orchestrator}=runtime(s);
 executor.startTurn=async params=>{executor.turnStarts.push(params);return {turn:{id:'held-turn'}};};
 executor.interruptTurn=async()=>{throw new Error('still running');};
 s.coordinator.resume(s.task.id,1,'resume:held',orchestrator);await until(()=>s.store.getTask(s.task.id).turnId==='held-turn');
 await orchestrator.cancel(s.task.id);await until(()=>orchestrator.running.size===0);
 assert.equal(s.store.getTask(s.task.id).node_recovery.phase,'awaiting_stop');
 orchestrator.dispatch({workspace:s.workspace,objective:'must remain queued',profile:'economy'});await new Promise(r=>setTimeout(r,20));
 assert.equal(executor.turnStarts.length,1);
});

test('canonical target aliases cannot bypass existing workspace reservation',t=>{
 const s=setup(t);const other=s.store.createTask({workspace:s.workspace,brief:s.task.brief,policy:s.task.policy,executor:'codex'});bind(s);checkpoint(s);release(s);
 s.store.updateTask(other.id,{status:'running'});s.target.workspace=s.workspace+path.sep;let starts=0;
 fail(()=>s.coordinator.resume(s.task.id,1,'resume:alias',{enqueueNodeRecovery(){starts++;}}),'node_workspace_busy');assert.equal(starts,0);
});

test('native checkpoint modes fail closed before admission and keep unmanaged route intact',t=>{
 const s=setup(t);bind(s);checkpoint(s);release(s);const {executor,orchestrator}=runtime(s);executor.recoveryEnabled=true;
 fail(()=>s.coordinator.resume(s.task.id,1,'resume:native',orchestrator),'node_native_checkpoint_unsupported');
 assert.equal(s.store.getTask(s.task.id).node_recovery.phase,'released');assert.equal(executor.turnStarts.length,0);
 const s2=setup(t);s2.store.updateTask(s2.task.id,{executor_checkpoint:{phase:'intent'}});fail(()=>bind(s2),'node_native_checkpoint_unsupported');
});

test('source usage and session evidence are snapshotted before target history is appended',t=>{
 const s=setup(t);s.store.updateTask(s.task.id,{usage:{input_tokens:100,output_tokens:68,total_tokens:168},threadId:'source-thread',turnId:'source-turn'});
 bind(s);checkpoint(s);release(s);s.coordinator.resume(s.task.id,1,'resume:usage',{enqueueNodeRecovery(){}});
 const history=s.store.getTask(s.task.id).executor_history;
 assert.equal(history[0].usage.total_tokens,168);assert.equal(history[0].thread_id,'source-thread');assert.equal(history[0].turn_id,'source-turn');assert.ok(history[0].ended_at);assert.equal(history[0].ended_reason,'node_checkpointed');
});

test('stale running runtime entry rejects newer admission instead of silently dropping it',t=>{
 const s=setup(t);bind(s);checkpoint(s);release(s);const {executor,orchestrator}=runtime(s);
 orchestrator.running.set(s.task.id,{workspace:s.workspace,nodeFence:{nodeId:'desktop',generation:1}});
 fail(()=>s.coordinator.resume(s.task.id,1,'resume:conflict',orchestrator),'node_recovery_uncertain');
 assert.equal(s.store.getTask(s.task.id).node_recovery.phase,'uncertain');assert.equal(executor.turnStarts.length,0);
});

import { ControlPlaneError } from '../src/core/errors.js';
test('host adapter typed errors are not reused as public recovery errors',t=>{
 const s=setup(t);bind(s);s.coordinator.inspectSource=()=>{throw new ControlPlaneError('adapter_error','private-adapter-marker');};
 assert.throws(()=>checkpoint(s),e=>e.code==='node_observation_unavailable'&&!e.message.includes('private-adapter-marker'));
});

test('late timeout acknowledgement after quarantine cannot overwrite the newer state',async t=>{
 const s=setup(t);bind(s);checkpoint(s);release(s);const {executor,orchestrator}=runtime(s);
 const timeout=globalThis.setTimeout;t.mock.method(globalThis,'setTimeout',(fn,ms,...args)=>timeout(fn,ms===60000?5:ms,...args));
 executor.startTurn=async params=>{executor.turnStarts.push(params);return {turn:{id:'timed-turn'}};};let acknowledged;
 executor.interruptTurn=()=>new Promise(r=>{acknowledged=r;});
 s.coordinator.resume(s.task.id,1,'resume:timeout',orchestrator);await until(()=>typeof acknowledged==='function');
 s.coordinator.quarantine(s.task.id,2);acknowledged();await until(()=>orchestrator.running.size===0);
 assert.equal(s.store.getTask(s.task.id).node_recovery.phase,'uncertain');assert.equal(executor.turnStarts.length,1);
});

for(const outcome of ['failed','interrupted'])test(`uncertain ${outcome} does not release workspace ownership`,async t=>{
 const s=setup(t);bind(s);checkpoint(s);release(s);const {executor,orchestrator}=runtime(s);
 if(outcome==='interrupted'){
  const timeout=globalThis.setTimeout;t.mock.method(globalThis,'setTimeout',(fn,ms,...args)=>timeout(fn,ms===60000?5:ms,...args));
  executor.startTurn=async params=>{executor.turnStarts.push(params);return {turn:{id:'unknown-stop'}};};executor.interruptTurn=async()=>{throw new Error('still running');};
 }else executor.startTurn=async params=>{executor.turnStarts.push(params);throw new Error('execution outcome unknown');};
 s.coordinator.resume(s.task.id,1,`resume:${outcome}`,orchestrator);await until(()=>s.store.getTask(s.task.id).status===outcome);await until(()=>orchestrator.running.size===0);
 assert.equal(s.store.getTask(s.task.id).node_recovery.phase,'awaiting_stop');
 const next=orchestrator.dispatch({workspace:s.workspace,objective:'keep queued',profile:'economy'});await new Promise(r=>setTimeout(r,20));
 assert.equal(s.store.getTask(next.id).status,'queued');assert.equal(executor.turnStarts.length,1);
});
