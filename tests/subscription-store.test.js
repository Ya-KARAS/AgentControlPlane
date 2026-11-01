import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto'; import {spawnSync} from 'node:child_process';
import {TaskStore} from '../src/core/store.js';
const now=Date.parse('2026-11-01T12:00:00Z');
const sample={schema_version:1,provider:'anthropic',surface:'claude_code',account_alias:'personal',plan:null,availability:'available',remaining_percent:null,reset_at:null,observed_at:'2026-11-01T11:59:00.000Z',valid_until:'2026-11-01T12:10:00.000Z',source:'manual',confidence:'user_reported'};
function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acp-subscriptions-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true})); t.mock.method(Date,'now',()=>now); return {dir,store:new TaskStore(path.join(dir,'state'))};}
test('legacy state, manual persistence and read expiry preserve tasks and usage',t=>{
 const {store}=setup(t);assert.deepEqual(store.listSubscriptionSnapshots(),[]);
 const task=store.createTask({workspace:'/test',brief:{objective:'same'},policy:{name:'economy'}});store.updateTask(task.id,{usage:{total_tokens:123}});
 store.recordManualSubscription(sample); const restarted=new TaskStore(store.stateDir);
 assert.equal(restarted.listSubscriptionSnapshots()[0].remaining_percent,null);
 assert.equal(restarted.listSubscriptionSnapshots(now+600000)[0].availability,'unknown');
 assert.equal(restarted.getTask(task.id).usage.total_tokens,123);
 const before=fs.readFileSync(store.statePath,'utf8');restarted.listSubscriptionSnapshots(); assert.equal(fs.readFileSync(store.statePath,'utf8'),before);
 const lines=fs.readFileSync(store.auditPath,'utf8').trim().split('\n').map(JSON.parse);let prev=null;
 for(const {h,...entry} of lines){assert.equal(entry.prev,prev);assert.equal(h,crypto.createHash('sha256').update(JSON.stringify(entry)).digest('hex'));prev=h;}
});
test('older/conflicting snapshots cannot overwrite current scope; identical retry is no-op',t=>{
 const {store}=setup(t);store.recordManualSubscription(sample);const before=fs.readFileSync(store.auditPath,'utf8');store.recordManualSubscription(sample);assert.equal(fs.readFileSync(store.auditPath,'utf8'),before);
 for(const input of [{...sample,availability:'exhausted'},{...sample,observed_at:'2026-11-01T11:58:00.000Z'}]) assert.throws(()=>store.recordManualSubscription(input),e=>e.code==='subscription_conflict');
 assert.equal(store.listSubscriptionSnapshots()[0].availability,'available');
});
test('manual admission rejects official provenance, arbitrary fields and future observations',t=>{const {store}=setup(t);for(const extra of [{source:'official_ui'},{confidence:'observed'},{apiKey:'do-not-save'},{observed_at:'2027-01-01T00:00:00Z'}]) assert.throws(()=>store.recordManualSubscription({...sample,...extra}));assert.deepEqual(store.listSubscriptionSnapshots(),[]);});
test('stale writer and bounded scopes fail closed',t=>{const {store}=setup(t);const stale=new TaskStore(store.stateDir);store.recordManualSubscription(sample);assert.throws(()=>stale.recordManualSubscription({...sample,account_alias:'second'}),e=>e.code==='checkpoint_store_drift');assert.equal(new TaskStore(store.stateDir).listSubscriptionSnapshots().length,1);
 const full=new TaskStore(path.join(store.stateDir,'full'));full.state.subscription_snapshots=Array.from({length:256},(_,i)=>({...sample,account_alias:'alias'+i}));full.persist();assert.throws(()=>full.recordManualSubscription(sample),e=>e.code==='subscription_limit');
});
test('operator CLI imports only local manual file into configured state and hides invalid input',t=>{const {dir}=setup(t);const input=path.join(dir,'input.json'),cfg=path.join(dir,'config.json'),state=path.join(dir,'cli-state');fs.mkdirSync(path.join(dir,'work'));fs.writeFileSync(cfg,JSON.stringify({workspaceRoots:[path.join(dir,'work')],codex:{command:'missing-passive-cli'}}));fs.writeFileSync(input,JSON.stringify(sample));
 const run=(offline=true)=>spawnSync(process.execPath,['scripts/import-subscription.js',...(offline?['--offline']:[]),input],{cwd:process.cwd(),encoding:'utf8',env:{...process.env,AGENT_CONTROL_CONFIG:cfg,AGENT_CONTROL_STATE_DIR:state}});
 assert.equal(run(false).status,1);
 const imported=run();assert.equal(imported.status,0,imported.stderr);assert.equal(new TaskStore(state).listSubscriptionSnapshots().length,1);
 fs.writeFileSync(input,JSON.stringify({...sample,apiKey:'PRIVATE-SENTINEL'}));const invalid=run();assert.equal(invalid.status,1);assert.equal((invalid.stdout+invalid.stderr).includes('PRIVATE-SENTINEL'),false);
});

test('manual import omits malformed persisted observations without bypassing valid newer conflicts',t=>{
 const {store}=setup(t);
 store.state.subscription_snapshots=[null,{...sample,observed_at:'broken'},sample,{apiKey:'corrupt-entry'}];store.persist();
 assert.equal(store.listSubscriptionSnapshots().length,1);
 const restarted=new TaskStore(store.stateDir);
 assert.throws(()=>restarted.recordManualSubscription({...sample,observed_at:'2026-11-01T11:58:00.000Z'}),e=>e.code==='subscription_conflict');
 assert.equal(restarted.recordManualSubscription({...sample,account_alias:'second'}).account_alias,'second');
 const restored=new TaskStore(store.stateDir);
 assert.deepEqual(restored.listSubscriptionSnapshots().map(x=>x.account_alias),['personal','second']);
 assert.equal(restored.state.subscription_snapshots.includes(null),false);
 assert.equal(JSON.stringify(restored.state.subscription_snapshots).includes('corrupt-entry'),false);
});
