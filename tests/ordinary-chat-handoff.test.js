import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { validateChatHandoff } from '../scripts/lib/chat-handoff.js';
const hash = value => createHash('sha256').update(value).digest('hex');
function envelope(overrides={}) {
  const item={schema_version:1,logical_task_id:'logical-example',handoff_id:'handoff-1',direction:'requirements_to_chat',version:1,parent_version:0,source:'private_agent',summary:'Write an engineering document',body:'# Requirements\nKeep existing ACP.',confirmation:'pending_user_review',...overrides};
  item.body_sha256 ??= hash(item.body);
  item.idempotency_key ??= `chat-handoff:${item.logical_task_id}:${item.direction}:${item.version}:${item.body_sha256}`;
  return item;
}
test('offline package validates exact bytes without granting send/execution/merge authority',()=>{
  const item=envelope();const result=validateChatHandoff(item,{expectedParentVersion:0});
  assert.equal(result.valid,true);assert.equal(result.offline_only,true);assert.equal(result.confirmation,'pending_user_review');
  assert.equal(JSON.stringify(result).includes(item.body),false);
});
test('manual returned document requires matching logical lineage and next revision',()=>{
  const item=envelope({direction:'document_from_chat',version:2,parent_version:1,source:'ordinary_chat_manual'});
  assert.equal(validateChatHandoff(item,{expectedParentVersion:1,logicalTaskId:'logical-example'}).valid,true);
  assert.throws(()=>validateChatHandoff(item,{expectedParentVersion:0}));
  assert.throws(()=>validateChatHandoff(item,{expectedParentVersion:1,logicalTaskId:'other'}));
});
test('tampering, missing context, claimed approval, mixed surfaces and oversized data fail closed',()=>{
  for(const [item,context] of [
    [envelope({body_sha256:'0'.repeat(64)}),{expectedParentVersion:0}],
    [envelope(),{}],
    [envelope({approved:true}),{expectedParentVersion:0}],
    [envelope({source:'api'}),{expectedParentVersion:0}],
    [envelope({source:'ordinary_chat_manual'}),{expectedParentVersion:0}],
    [envelope({body:'x'.repeat(65537)}),{expectedParentVersion:0}],
    [envelope({idempotency_key:'invented'}),{expectedParentVersion:0}],
    [envelope({version:3}),{expectedParentVersion:0}],
    [envelope({confirmation:'approved'}),{expectedParentVersion:0}],
  ])assert.throws(()=>validateChatHandoff(item,context));
});

test('equivalent handoff retries share operation key; changed content cannot reuse it',()=>{
  const first=envelope();const repeat=envelope({handoff_id:'retry-2'});
  assert.equal(validateChatHandoff(first,{expectedParentVersion:0}).idempotency_key,validateChatHandoff(repeat,{expectedParentVersion:0}).idempotency_key);
  assert.throws(()=>validateChatHandoff({...first,body:'Changed requirements'},{expectedParentVersion:0}));
});

// This exercises real ACP persistence/orchestration with a fake executor, not
// a browser, model, ordinary Chat account or authenticated human decision.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TaskStore } from '../src/core/store.js';
import { Orchestrator } from '../src/core/orchestrator.js';
import { RecordingExecutor } from './fixtures/recording-executor.js';
async function until(predicate) {
  for(let count=0;count<200;count++) {if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}
  throw new Error('Offline executor did not finish');
}
test('offline handoff key deduplicates real dispatch and revision keeps ACP lineage',async(t)=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'acp-chat-contract-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const workspace=path.join(root,'work');fs.mkdirSync(workspace);
  const store=new TaskStore(path.join(root,'state')),executor=new RecordingExecutor('codex');
  const config={workspaceRoots:[root],executor:{provider:'codex',routing:{order:['codex']}},codex:{sandbox:'workspace-write',networkAccess:false,approvalPolicy:'never'},
    profiles:{economy:{model:'offline-fixture',effort:'low',maxSubagents:0,tokenBudget:30000}},limits:{maxBriefCharacters:24000,maxConcurrentTasks:1,maxQueuedTasks:10,maxTokenBudget:250000,maxStoredEventsPerTask:50,maxTaskRuntimeMinutes:1,discoveryRefreshMs:0}};
  const orchestrator=new Orchestrator({config,store,codex:executor});await orchestrator.start();
  const packet=validateChatHandoff(envelope({direction:'document_from_chat',version:2,parent_version:1,source:'ordinary_chat_manual'}),{expectedParentVersion:1});
  assert.equal(store.listTasks().length,0); // Packaging itself enqueues nothing.
  const request={workspace,objective:'Implement reviewed fixture document',profile:'economy',context:[`Document SHA256: ${packet.body_sha256}`],idempotency_key:packet.idempotency_key};
  const first=orchestrator.dispatch(request),retry=orchestrator.dispatch(request);
  assert.equal(first.id,retry.id);assert.equal(store.listTasks().length,1);
  assert.throws(()=>orchestrator.dispatch({...request,objective:'Different approved work'}),error=>error.code==='idempotency_conflict');
  await until(()=>store.getTask(first.id).status==='completed');assert.equal(executor.turnStarts.length,1);
  const revised=orchestrator.continueTask(first.id,{objective:'Apply reviewed document revision',profile:'economy',idempotency_key:'chat-revision:fixture:v3'});
  assert.equal(revised.parentTaskId,first.id);assert.equal(revised.logical_task_id,first.logical_task_id);
  await until(()=>store.getTask(revised.id).status==='completed');assert.equal(executor.turnStarts.length,2);
});
import { spawnSync } from 'node:child_process';
test('offline CLI checks a local packet without printing its body or accepting implicit parent context',(t)=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'acp-chat-cli-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(root,'packet.json');fs.writeFileSync(file,JSON.stringify(envelope()));
 const run=args=>spawnSync(process.execPath,['scripts/check-chat-handoff.js',...args],{cwd:process.cwd(),encoding:'utf8'});
 const checked=run([file,'--expected-parent','0','--logical-task','logical-example']);assert.equal(checked.status,0,checked.stderr);assert.equal(JSON.parse(checked.stdout).offline_only,true);assert.equal(checked.stdout.includes('# Requirements'),false);
 assert.notEqual(run([file]).status,0);assert.notEqual(run([file,'--expected-parent','1']).status,0);
});
