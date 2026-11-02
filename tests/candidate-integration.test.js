import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { conversationFixture } from './fixtures/conversation-fixture.js';
import { TaskStore } from '../src/core/store.js';
import { createApplication } from '../src/server.js';
import { validateChatHandoff } from '../scripts/lib/chat-handoff.js';

test('subscription persistence preserves shared message deduplication, usage and workflow history retention',t=>{
 const f=conversationFixture(t);f.store.enableWorkflowRetention();f.service.post({conversation_id:f.cid,message_id:'integrated',text:'offline discussion',task_id:f.task.id});const usage=f.store.usageReport();
 f.store.recordManualSubscription({schema_version:1,provider:'anthropic',surface:'claude_code',account_alias:'synthetic',plan:null,availability:'available',remaining_percent:null,reset_at:null,observed_at:'2026-11-01T11:59:00.000Z',valid_until:'2026-11-01T12:10:00.000Z',source:'manual',confidence:'user_reported'});
 const restored=new TaskStore(f.config.stateDir);assert.equal(restored.state.workflow_retention,true);assert.equal(restored.listMessages().length,1);assert.equal(restored.listMessages()[0].text,'offline discussion');assert.deepEqual(restored.usageReport(),usage);
 const row=restored.listSubscriptionSnapshots(Date.parse('2026-11-01T12:10:00Z'))[0];assert.equal(row.availability,'unknown');assert.equal(row.remaining_percent,null);assert.equal(row.reset_at,null);assert.equal(restored.getTask(f.task.id).status,'queued');assert.equal(f.executor.turnStarts.length,0);
});
test('one composed application retains subscription, controller, node, message, workflow and delivery tools',async t=>{
 const f=conversationFixture(t),app=await createApplication({...f,executors:new Map([['codex',f.executor]]),startCodex:false});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());const base=`http://127.0.0.1:${app.server.address().port}`,headers={authorization:'Bearer test-chat-token','content-type':'application/json'};
 const subscriptions=await(await fetch(base+'/v1/subscriptions',{headers})).json();assert.deepEqual(subscriptions,{snapshots:[],advisory:[],advisory_only:true});assert.equal((await fetch(base+'/v1/conversations',{headers})).status,200);
 const discovery=await(await fetch(base+'/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:1,method:'server/discover',params:{}})})).json();const names=discovery.result.tools.map(t=>t.name);
 for(const name of ['subscription_status','list_controllers','execution_nodes','post_message','list_messages','list_active_tasks','daily_report','archive_task','delivery_status'])assert.ok(names.includes(name),name);
 assert.equal(names.includes('get_requirements'),false);assert.equal(f.executor.turnStarts.length,0);
});
test('candidate preserves exact uploaded design and offline handoff validation with pending user review',()=>{
 const file=fs.readFileSync(new URL('../docs/ACP_V1_ENGINEERING_DESIGN.md',import.meta.url));assert.equal(file.length,31945);assert.equal(createHash('sha256').update(file).digest('hex'),'7942d94be736dfc55dcfce66096dba0bcbe1bf08bbc1b58a534e9e7f15f8ff1a');
 const packet=JSON.parse(fs.readFileSync(new URL('../docs/examples/ordinary-chat-handoff.json',import.meta.url)));const validated=validateChatHandoff(packet,{expectedParentVersion:packet.parent_version});assert.equal(validated.offline_only,true);assert.equal(validated.confirmation,'pending_user_review');
});
