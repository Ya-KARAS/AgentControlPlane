import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';
import {TaskStore} from '../src/core/store.js';
const observation={repository:'Ya-KARAS/AgentControlPlane',branch:'feat/test',pull_request_number:23,head_sha:'a'.repeat(40),checks:'passed',review_state:'changes_requested',observed_at:'2026-11-01T00:00:00Z'};
function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acp-delivery-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new TaskStore(path.join(dir,'state'));const task=store.createTask({workspace:dir,brief:{objective:'private-prompt'},policy:{name:'economy'}});return {dir,store,task};}
const fails=(fn,code)=>assert.throws(fn,e=>e.code===code);
test('legacy records default null; rejected PR revisions persist without changing task/lineage or audit history',(t)=>{
 const {store,task}=setup(t);assert.equal(store.getTask(task.id).delivery,null);
 const before=store.getTask(task.id);const d=store.recordDelivery(task.id,observation);assert.equal(d.review_state,'unknown');assert.equal(d.reported_review_state,'changes_requested');
 const restarted=new TaskStore(store.stateDir);assert.deepEqual(restarted.getDelivery(task.id),d);
 restarted.recordDelivery(task.id,{...observation,head_sha:'b'.repeat(40),observed_at:'2026-11-01T00:01:00Z'});
 const after=restarted.getTask(task.id);assert.equal(after.status,before.status);assert.equal(after.logical_task_id,before.logical_task_id);assert.deepEqual(after.executor_history,before.executor_history);assert.equal(after.delivery.reported_review_state,'pending_review');
 let prev=null;for(const line of fs.readFileSync(store.auditPath,'utf8').trim().split('\n')){const {h,...entry}=JSON.parse(line);assert.equal(entry.prev,prev);assert.equal(h,crypto.createHash('sha256').update(JSON.stringify(entry)).digest('hex'));prev=h;}
});
test('approval claims and generic patches cannot bypass; invalid update cannot write partially',(t)=>{
 const {store,task}=setup(t);store.recordDelivery(task.id,observation);const before=fs.readFileSync(store.statePath,'utf8');
 fails(()=>store.recordDelivery(task.id,{...observation,review_state:'approved'}),'human_approval_unavailable');
 fails(()=>store.updateTask(task.id,{delivery:{...observation,review_state:'approved'}}),'delivery_update_required');
 fails(()=>store.recordDelivery(task.id,{...observation,human:true}),'invalid_delivery');
 assert.equal(fs.readFileSync(store.statePath,'utf8'),before);
 assert.equal(store.updateTask(task.id,{...store.getTask(task.id),status:'blocked'}).status,'blocked');
});
test('stale process cannot replace new delivery, and malformed persisted approval never escapes reads',(t)=>{
 const {store,task}=setup(t);const stale=new TaskStore(store.stateDir);store.recordDelivery(task.id,observation);
 fails(()=>stale.recordDelivery(task.id,{...observation,observed_at:'2026-11-01T00:01:00Z'}),'checkpoint_store_drift');
 const state=JSON.parse(fs.readFileSync(store.statePath));state.tasks[task.id].delivery={...observation,review_state:'approved',prompt:'private-secret'};fs.writeFileSync(store.statePath,JSON.stringify(state));
 assert.equal(new TaskStore(store.stateDir).getTask(task.id).delivery,null);
});
test('offline CLI imports only safe observations and never accepts human assertions',(t)=>{
 const {dir,store,task}=setup(t);const config=path.join(dir,'config.json'),file=path.join(dir,'observation.json');
 fs.writeFileSync(config,JSON.stringify({workspaceRoots:[path.join(dir,'workspace')],codex:{command:'missing-cli'}}));fs.writeFileSync(file,JSON.stringify(observation));
 const run=(args)=>spawnSync(process.execPath,['scripts/import-delivery.js',...args],{encoding:'utf8',env:{...process.env,AGENT_CONTROL_CONFIG:config,AGENT_CONTROL_STATE_DIR:store.stateDir}});
 assert.notEqual(run([task.id,file]).status,0);
 const ok=run(['--offline',task.id,file]);assert.equal(ok.status,0,ok.stderr);assert.equal(new TaskStore(store.stateDir).getDelivery(task.id).reported_checks,'passed');
 fs.writeFileSync(file,JSON.stringify({...observation,review_state:'approved',human:true}));const denied=run(['--offline',task.id,file]);assert.notEqual(denied.status,0);assert.doesNotMatch(denied.stdout+denied.stderr,/private-prompt|observation.json|human:true/);
});
