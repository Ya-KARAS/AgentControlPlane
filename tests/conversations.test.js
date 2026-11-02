import assert from 'node:assert/strict';
import test from 'node:test';
import { conversationFixture as fixture } from './fixtures/conversation-fixture.js';
test('project conversation scopes discussion, unconnected mentions and bounded older history without execution',t=>{
 const f=fixture(t);for(let i=1;i<=55;i++)f.service.post({conversation_id:f.cid,message_id:`m${i}`,text:`message ${i}`,target:'dot'});
 const view=f.service.snapshot({conversation_id:f.cid});assert.equal(view.messages.length,50);assert.equal(view.messages[0].text,'@dot\nmessage 6');assert.equal(view.agents[0].connection,'not_connected');
 const older=f.service.snapshot({conversation_id:f.cid,before_sequence:view.messages[0].sequence});assert.equal(older.messages.length,5);assert.equal(older.messages[0].text,'@dot\nmessage 1');
 assert.equal(f.executor.turnStarts.length,0);assert.equal(f.store.findTasks().length,1);assert.equal(JSON.stringify(view).includes('private-principal'),false);assert.equal(JSON.stringify(view).includes(f.workspace),false);
 for(const input of [{target:'forged'},{approved:true},{conversation_id:'task-forged'}])assert.throws(()=>f.service.post({conversation_id:f.cid,message_id:'bad',text:'no',...input}));
});
test('discussion retry and continuation retry retain one message and original task lineage',t=>{
 const f=fixture(t),m={conversation_id:f.cid,message_id:'one',text:'change this',task_id:f.task.id};
 f.service.post(m);f.service.post(m);assert.equal(f.service.snapshot({conversation_id:f.cid}).messages.length,1);
 assert.throws(()=>f.service.followUp({...m,message_id:'follow'}),e=>e.code==='conversation_task_busy');
 f.store.updateTask(f.task.id,{status:'completed',threadId:'codex-thread-1'});
 const one=f.service.followUp({...m,message_id:'follow'}),two=f.service.followUp({...m,message_id:'follow'});assert.equal(one.task.id,two.task.id);assert.equal(one.task.parentTaskId,f.task.id);assert.equal(one.task.logical_task_id,f.task.logical_task_id);assert.equal(f.orchestrator.queue.length,1);
 assert.throws(()=>f.service.followUp({...m,message_id:'follow',text:'different'}));
 assert.equal(f.executor.turnStarts.length,0);
});
test('safe stop retains active reservation until terminal notification and coalesces duplicate requests',async t=>{
 const f=fixture(t);f.store.updateTask(f.task.id,{status:'running',threadId:'codex-thread-1',turnId:'turn-1'});const active={workspace:f.workspace,turnId:'turn-1'};f.orchestrator.running.set(f.task.id,active);
 let resolve,calls=0;f.executor.interruptTurn=()=>{calls++;return new Promise(r=>{resolve=r;});};
 const a=f.orchestrator.requestStop(f.task.id),b=f.orchestrator.requestStop(f.task.id);await Promise.resolve();assert.equal(calls,1);resolve({});await Promise.all([a,b]);
 assert.equal(f.store.getTask(f.task.id).status,'running');assert.equal(f.orchestrator.running.get(f.task.id),active);assert.equal(f.service.snapshot({conversation_id:f.cid}).tasks[0].stop_requested,true);
 await f.orchestrator.requestStop(f.task.id);assert.equal(calls,1);
});
test('stop failure and missing turn never claim cancellation, permit explicit retry and preserve terminal race',async t=>{
 const f=fixture(t);f.store.updateTask(f.task.id,{status:'running',threadId:'codex-thread-1'});f.orchestrator.running.set(f.task.id,{workspace:f.workspace});
 await assert.rejects(f.orchestrator.requestStop(f.task.id),e=>e.code==='stop_not_ready');assert.equal(f.store.getTask(f.task.id).status,'running');
 f.store.updateTask(f.task.id,{turnId:'t'});f.orchestrator.running.get(f.task.id).turnId='t';f.executor.interruptTurn=async()=>{throw Error('private-error');};await assert.rejects(f.orchestrator.requestStop(f.task.id),e=>e.code==='stop_unconfirmed'&&!e.message.includes('private-error'));
 f.executor.interruptTurn=async()=>{f.store.updateTask(f.task.id,{status:'completed'});};await f.orchestrator.requestStop(f.task.id);assert.equal(f.store.getTask(f.task.id).status,'completed');
});
test('queued stop removes only original queue entry, repeat is harmless and scope mismatch rejects',async t=>{
 const f=fixture(t);f.orchestrator.queue=[{taskId:f.task.id}];await f.service.stop({conversation_id:f.cid,task_id:f.task.id});await f.service.stop({conversation_id:f.cid,task_id:f.task.id});assert.equal(f.orchestrator.queue.length,0);assert.equal(f.store.getTask(f.task.id).status,'cancelled');assert.equal(f.executor.turnStarts.length,0);
 await assert.rejects(f.service.stop({conversation_id:'task-other',task_id:f.task.id}));
});
test('synchronous interrupt exception allows explicit retry without losing running reservation',async t=>{
 const f=fixture(t);f.store.updateTask(f.task.id,{status:'running',threadId:'codex-thread-1',turnId:'t'});const active={workspace:f.workspace,turnId:'t'};f.orchestrator.running.set(f.task.id,active);f.executor.interruptTurn=()=>{throw Error('sync failure');};await assert.rejects(f.orchestrator.requestStop(f.task.id));f.executor.interruptTurn=async()=>({});await f.orchestrator.requestStop(f.task.id);assert.equal(active.stopRequested,true);assert.equal(f.store.getTask(f.task.id).status,'running');
});
