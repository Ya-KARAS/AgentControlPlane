import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TaskStore } from '../src/core/store.js';
import { ArchiveService } from '../src/core/workflow.js';
import { Orchestrator } from '../src/core/orchestrator.js';
import { RecordingExecutor } from './fixtures/recording-executor.js';

function setup(t,{enabled=true,trusted=true,start=Date.parse('2026-11-02T12:00:00Z')}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acp-workflow-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let clock=start;t.mock.method(Date,'now',()=>clock);
 const store=new TaskStore(dir),executor=new RecordingExecutor('codex');const orchestrator=new Orchestrator({config:{limits:{maxConcurrentTasks:1}},store,executors:new Map([['codex',executor]]),defaultProvider:'codex'});
 const task=store.createTask({workspace:'/private/work',brief:{objective:'private-source-marker'},policy:{name:'economy'},executor:'codex'});store.updateTask(task.id,{status:'completed',result:{summary:'private-source-marker'},usage:{total_tokens:168}});
 let target={repository:'owner/repo',pull_request_number:11,head_sha:'a'.repeat(40)};
 store.recordDelivery(task.id,{...target,branch:'feat/work',observed_at:new Date(clock-1000).toISOString()});
 let decisions=[{user_id:'private-user-identity',event_id:'private-event-identity',head_sha:target.head_sha,state:'approved',occurred_at:new Date(clock-500).toISOString()}];let checks='passed';
 const options={clock:()=>clock,authorizeUser:async id=>id==='private-user-identity',adapter:{readObservation:async()=>({...target,checks,complete:true,observed_at:new Date(clock-100).toISOString(),valid_until:new Date(clock+30000).toISOString(),decisions:structuredClone(decisions)}),readHead:async()=>({...target})}};
 const host=store.createDeliveryHost(trusted?options:{});
 const service=new ArchiveService({store,orchestrator,enabled,timeZone:'UTC',clock:()=>clock});
 return {dir,store,task,executor,orchestrator,host,service,options,get clock(){return clock;},advance:ms=>clock+=ms,setDecisions:v=>decisions=v,setChecks:v=>checks=v,
  async changeHead(){clock++;target={...target,head_sha:'b'.repeat(40)};store.recordDelivery(task.id,{...target,branch:'feat/work',observed_at:new Date(clock).toISOString()});},approveNewHead(){decisions=[{user_id:'private-user-identity',event_id:'new-event',head_sha:target.head_sha,state:'approved',occurred_at:new Date(clock-200).toISOString()}];},reportPath:path.join(dir,'reports','2026-11-02.md')};
}
const rejected=(promise,code)=>assert.rejects(promise,e=>e.code===code);

test('verified acceptance and persisted dated report precede active-view archive',async t=>{
 const f=setup(t);const phases=[];const persist=f.store.persist.bind(f.store);
 t.mock.method(f.store,'persist',()=>{const current=f.store.state.tasks[f.task.id]._workflow?.current;if(current){phases.push(current.phase);if(current.phase==='archived')assert.equal(fs.existsSync(f.reportPath),true);}return persist();});
 const task=await f.service.archive(f.task.id);assert.equal(task.status,'completed');assert.equal(task.workflow.phase,'archived');assert.equal(task.workflow.active,false);assert.deepEqual(phases,['accepted','reported','archived']);
 assert.equal(f.service.active({}).tasks.length,0);assert.equal(f.store.listTasks().length,1);assert.ok(f.store.getTask(f.task.id));
 const report=f.service.report('2026-11-02');assert.equal(report.entries.length,1);assert.equal(report.entries[0].task_id,f.task.id);
 for(const secret of ['private-source-marker','private-user-identity','private-event-identity','/private/work'])assert.equal(fs.readFileSync(f.reportPath,'utf8').includes(secret),false);
 assert.equal(JSON.stringify(task).includes('_workflow'),false);assert.equal(JSON.stringify(task).includes('private-user-identity'),false);assert.equal(f.executor.turnStarts.length,0);
});

test('manual reports shared client flags and green CI cannot establish archive approval',async t=>{
 for(const trusted of [false,true]){
  const f=setup(t,{trusted});if(trusted)f.setDecisions([]);
  await rejected(f.service.archive(f.task.id),'workflow_approval_required');assert.equal(f.service.active({}).tasks.length,1);assert.equal(fs.existsSync(f.reportPath),false);
 }
 const off=setup(t,{enabled:false});await rejected(off.service.archive(off.task.id),'workflow_disabled');
});

test('report IO failure retains accepted active work and retries one row idempotently',async t=>{
 const f=setup(t);const rename=fs.renameSync;let fail=true;
 t.mock.method(fs,'renameSync',(from,to)=>{if(to===f.reportPath&&fail)throw new Error('private-report-error');return rename(from,to);});
 await rejected(f.service.archive(f.task.id),'workflow_report_unavailable');assert.equal(f.store.getTask(f.task.id).workflow.active,true);assert.equal(f.store.checkpointFaulted,false);
 fail=false;await f.service.archive(f.task.id);const before=fs.readFileSync(f.reportPath,'utf8'),audit=fs.readFileSync(f.store.auditPath,'utf8');await f.service.archive(f.task.id);
 assert.equal(f.service.report('2026-11-02').entries.length,1);assert.equal(fs.readFileSync(f.reportPath,'utf8'),before);assert.equal(fs.readFileSync(f.store.auditPath,'utf8'),audit);
});

for(const phase of ['accepted','reported','archived'])test(`${phase} state-write failure cannot hide active work`,async t=>{
 const f=setup(t);const persist=f.store.persist.bind(f.store);
 t.mock.method(f.store,'persist',()=>{if(f.store.state.tasks[f.task.id]._workflow?.current?.phase===phase)throw new Error('private-state-error');return persist();});
 await assert.rejects(f.service.archive(f.task.id));assert.equal(f.service.active({}).tasks.length,1);assert.equal(f.store.checkpointFaulted,true);
});

test('archive audit failure stays active and retry after verified clean restart reuses report',async t=>{
 const f=setup(t);const audit=f.store.audit.bind(f.store);
 t.mock.method(f.store,'audit',(type,payload)=>{if(type==='workflow.archive_intent')throw new Error('private-audit-error');return audit(type,payload);});
 await assert.rejects(f.service.archive(f.task.id));assert.equal(f.service.active({}).tasks.length,1);assert.equal(f.store.checkpointFaulted,true);
 f.store.releaseExecutorLease(); // Test knows this local owner never started an executor; no stale-lock deletion.
 const restarted=new TaskStore(f.dir);restarted.createDeliveryHost(f.options);const service=new ArchiveService({store:restarted,orchestrator:new Orchestrator({config:{limits:{maxConcurrentTasks:1}},store:restarted,executors:new Map([['codex',new RecordingExecutor('codex')]]),defaultProvider:'codex'}),enabled:true,timeZone:'UTC',clock:()=>f.clock});
 await service.archive(f.task.id);assert.equal(service.report('2026-11-02').entries.length,1);assert.equal(service.active({}).tasks.length,0);
});

test('cold restart retains historical archive without treating it as new approval',async t=>{
 const f=setup(t);await f.service.archive(f.task.id);const restarted=new TaskStore(f.dir),service=new ArchiveService({store:restarted,orchestrator:new Orchestrator({config:{limits:{maxConcurrentTasks:1}},store:restarted,executors:new Map([['codex',new RecordingExecutor('codex')]]),defaultProvider:'codex'}),enabled:true,timeZone:'UTC',clock:()=>f.clock});
 assert.equal(restarted.getDelivery(f.task.id).review_state,'unknown');assert.equal(service.active({}).tasks.length,0);assert.equal((await service.archive(f.task.id)).workflow.phase,'archived');
});

test('new head reopens active view and cannot use old acceptance; new verified head keeps history',async t=>{
 const f=setup(t);await f.service.archive(f.task.id);await f.changeHead();assert.equal(f.service.active({}).tasks.length,1);await rejected(f.service.archive(f.task.id),'workflow_approval_required');
 f.approveNewHead();await f.service.archive(f.task.id);assert.equal(f.service.report('2026-11-02').entries.length,2);assert.equal(f.store.state.tasks[f.task.id]._workflow.history.length,1);
});

test('head race while report writes prevents archive and preserves the earlier report as history',async t=>{
 const f=setup(t);const rename=fs.renameSync;let once=true;
 t.mock.method(fs,'renameSync',(from,to)=>{const result=rename(from,to);if(to===f.reportPath&&once){once=false;f.store.recordDelivery(f.task.id,{repository:'owner/repo',pull_request_number:11,head_sha:'b'.repeat(40),branch:'feat/work',observed_at:new Date(f.clock).toISOString()});}return result;});
 await assert.rejects(f.service.archive(f.task.id));assert.equal(f.service.active({}).tasks.length,1);assert.equal(f.service.report('2026-11-02').entries.length,1);
});

test('revocation expiry missing report and active runtime all prevent hiding unfinished work',async t=>{
 const f=setup(t);f.setDecisions([{user_id:'private-user-identity',event_id:'revoked',head_sha:'a'.repeat(40),state:'revoked',occurred_at:new Date(f.clock-150).toISOString()}]);await rejected(f.service.archive(f.task.id),'workflow_approval_required');
 const f2=setup(t);f2.orchestrator.running.set(f2.task.id,{workspace:'/private/work'});await rejected(f2.service.archive(f2.task.id),'workflow_task_active');f2.orchestrator.running.clear();await f2.service.archive(f2.task.id);fs.unlinkSync(f2.reportPath);assert.equal(f2.service.active({}).tasks.length,1);
});

test('generic patches cannot fabricate workflow records and archived history is not pruned',async t=>{
 const f=setup(t);assert.throws(()=>f.store.updateTask(f.task.id,{workflow:{phase:'archived',active:false}}),e=>e.code==='workflow_update_required');assert.throws(()=>f.store.updateTask(f.task.id,{_workflow:{approved:true}}),e=>e.code==='workflow_update_required');
 await f.service.archive(f.task.id);f.store.maxTasks=1;assert.throws(()=>f.store.createTask({workspace:'/new',brief:{objective:'new'},policy:{name:'economy'}}),e=>e.code==='task_capacity_reached');assert.ok(f.store.getTask(f.task.id));
});

test('approval expiry during report write cannot complete archive',async t=>{
 const f=setup(t);const rename=fs.renameSync;let once=true;t.mock.method(fs,'renameSync',(from,to)=>{const result=rename(from,to);if(to===f.reportPath&&once){once=false;f.advance(30001);}return result;});
 await rejected(f.service.archive(f.task.id),'workflow_approval_required');assert.equal(f.service.active({}).tasks.length,1);
});

test('concurrent archive calls produce one acceptance and one dated row',async t=>{
 const f=setup(t);await Promise.all([f.service.archive(f.task.id),f.service.archive(f.task.id)]);assert.equal(f.service.report('2026-11-02').entries.length,1);
 const events=fs.readFileSync(f.store.auditPath,'utf8').trim().split('\n').map(JSON.parse);assert.equal(events.filter(e=>e.type==='workflow.archive_intent').length,1);assert.equal(events.filter(e=>e.type==='workflow.accepted').length,1);
});

import { NodeRecoveryCoordinator } from '../src/core/node-recovery.js';
test('unconfirmed node stop blocks archive even when execution status and PR are completed',async t=>{
 const f=setup(t);const recovery=new NodeRecoveryCoordinator({store:f.store,config:{enabled:true,nodes:[{id:'desktop',kind:'local',authorized:true,executor_ids:['codex']}]},sourceNodeId:'desktop',targetNodeId:'desktop'});recovery.bind(f.task.id);
 await rejected(f.service.archive(f.task.id),'workflow_task_active');assert.equal(fs.existsSync(f.reportPath),false);
});

test('report time zone uses acceptance day rather than client supplied dates',async t=>{
 const f=setup(t,{start:Date.parse('2026-11-02T00:30:00Z')});const service=new ArchiveService({store:f.store,orchestrator:f.orchestrator,enabled:true,timeZone:'America/Los_Angeles',clock:()=>f.clock});
 const result=await service.archive(f.task.id);assert.equal(result.workflow.report_date,'2026-11-01');assert.equal(service.report('2026-11-01').entries.length,1);
});

test('oversized or tampered report fails closed without reflecting its content',async t=>{
 const f=setup(t);await f.service.archive(f.task.id);fs.writeFileSync(f.reportPath,'private-report-marker'.repeat(60000));
 assert.throws(()=>f.service.report('2026-11-02'),e=>e.code==='workflow_report_unavailable'&&!e.message.includes('private-report-marker'));assert.equal(f.service.active({}).tasks.length,1);
 assert.throws(()=>f.service.report('../private-report-marker'),e=>e.code==='workflow_report_unavailable');
});

test('workflow-enabled capacity cannot prune unaccepted active work before its report exists',t=>{
 const f=setup(t);f.store.maxTasks=1;
 assert.throws(()=>f.store.createTask({workspace:'/new',brief:{objective:'new'},policy:{name:'economy'}}),e=>e.code==='task_capacity_reached');
 const restarted=new TaskStore(f.dir);restarted.maxTasks=1;assert.throws(()=>restarted.createTask({workspace:'/new',brief:{objective:'new'},policy:{name:'economy'}}),e=>e.code==='task_capacity_reached');
 assert.ok(restarted.getTask(f.task.id));
});

test('corrupt audit evidence blocks archival before any new acceptance is persisted',async t=>{
 const f=setup(t);fs.appendFileSync(f.store.auditPath,'broken private-audit-marker\n');const before=fs.readFileSync(f.store.auditPath,'utf8');
 await rejected(f.service.archive(f.task.id),'checkpoint_audit_invalid');assert.equal(f.service.active({}).tasks.length,1);assert.equal(f.store.checkpointFaulted,true);assert.equal(fs.readFileSync(f.store.auditPath,'utf8'),before);assert.equal(fs.existsSync(f.reportPath),false);
});

for(const negativeState of ['revoked','changes_requested'])test(`verified ${negativeState} stays active after expiry and restart until new acceptance is reported`,async t=>{
 const f=setup(t);const initial=(await f.options.adapter.readObservation()).decisions[0];await f.service.archive(f.task.id);
 f.advance(200);const revoked={...initial,event_id:'revocation-2',state:negativeState,occurred_at:new Date(f.clock-150).toISOString()};f.setDecisions([initial,revoked]);await f.host.refresh(f.task.id);
 assert.equal(f.service.active({}).tasks.length,1);f.advance(30001);assert.equal(f.service.active({}).tasks.length,1);
 const store=new TaskStore(f.dir),executor=new RecordingExecutor('codex'),orchestrator=new Orchestrator({config:{limits:{maxConcurrentTasks:1}},store,executors:new Map([['codex',executor]]),defaultProvider:'codex'}),service=new ArchiveService({store,orchestrator,enabled:true,timeZone:'UTC',clock:()=>f.clock});
 assert.equal(service.active({}).tasks.length,1);await rejected(service.archive(f.task.id),'workflow_approval_required');assert.equal(service.report('2026-11-02').entries.length,1);
 store.createDeliveryHost(f.options);f.advance(200);f.setDecisions([initial,revoked,{...initial,event_id:'reapproved-3',occurred_at:new Date(f.clock-150).toISOString()}]);
 await service.archive(f.task.id);assert.equal(service.active({}).tasks.length,0);assert.equal(service.report('2026-11-02').entries.length,2);
});
