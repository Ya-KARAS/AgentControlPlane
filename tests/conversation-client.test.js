import assert from 'node:assert/strict';
import test from 'node:test';
import { createConversationClient } from '../src/conversation-page.js';
const view=(id,messages=[])=>({conversation_id:id,connection:'offline',agents:[],messages,tasks:[]});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {resolve,reject,promise};};
test('late refresh and navigation cannot replace current project or replay actions',async()=>{
 const a=deferred(),b=deferred(),calls=[];const c=createConversationClient({request:async(url,body)=>{calls.push({url,body});return url.includes('task-a')?a.promise:b.promise;}});
 const first=c.select('task-a');c.setDraft('draft A');const second=c.select('task-b');c.setDraft('draft B');b.resolve(view('task-b',[{message_id:'b',sequence:2}]));await second;a.resolve(view('task-a',[{message_id:'a',sequence:1}]));await first;
 assert.equal(c.state.selected,'task-b');assert.equal(c.state.view.messages[0].message_id,'b');assert.equal(c.state.draft,'draft B');assert.equal(calls.every(v=>v.body===undefined),true);
});
test('double click and failed transport retry use one frozen envelope; success preserves concurrently edited draft',async()=>{
 let pending=deferred(),n=0;const sent=[];const c=createConversationClient({uuid:()=>`id-${++n}`,request:async(url,body)=>{if(!body)return view('task-a');sent.push(structuredClone(body));return pending.promise;}});
 await c.select('task-a');c.setDraft('change once');const one=c.post({target:'dot'}),two=c.post({target:'dot'});await Promise.resolve();assert.equal(sent.length,1);pending.reject(Error('transport'));await Promise.allSettled([one,two]);assert.equal(c.state.draft,'change once');
 pending=deferred();const retry=c.post({target:'dot'});c.setDraft('new concurrent draft');pending.resolve({message:{}});await retry;assert.equal(sent.length,2);assert.equal(sent[0].message_id,sent[1].message_id);assert.equal(n,1);assert.equal(c.state.draft,'new concurrent draft');
});
test('pending operation cannot silently change target, task or text; switch project does not leak its completion',async()=>{
 const p=deferred();const c=createConversationClient({uuid:()=> 'stable',request:async(url,body)=>body?p.promise:view(url.includes('task-b')?'task-b':'task-a')});await c.select('task-a');c.setDraft('one');const operation=c.followUp({task_id:'task-1'});await c.select('task-b');c.setDraft('other');p.resolve({task:{id:'child'}});await operation;assert.equal(c.state.selected,'task-b');assert.equal(c.state.draft,'other');
 const reject=createConversationClient({request:async(url,body)=>{if(body)throw Error('network');return view('task-a');}});await reject.select('task-a');reject.setDraft('one');await assert.rejects(reject.post({target:'dot'}));reject.setDraft('two');await assert.rejects(reject.post({target:'other'}),/retry_previous/);
});
test('older page merges by key while refreshing preserves already loaded history and new background messages',async()=>{
 let current=view('task-a',[{key:'new',sequence:51,text:'new'}]);const c=createConversationClient({request:async url=>url.includes('before_sequence')?view('task-a',[{key:'old',sequence:1,text:'old'}]):current});await c.select('task-a');await c.older();current=view('task-a',[{key:'new',sequence:51,text:'new'},{key:'bg',sequence:52,text:'background'}]);await c.refresh();assert.deepEqual(c.state.view.messages.map(m=>m.key),['old','new','bg']);
});
test('stop duplicate and retry make no optimistic terminal status or mutation on refresh',async()=>{
 let calls=0,p=deferred();const v=view('task-a');v.tasks=[{id:'t',status:'running'}];const c=createConversationClient({request:async(url,body)=>{if(!body)return v;calls++;return p.promise;}});await c.select('task-a');const a=c.stop('t'),b=c.stop('t');await Promise.resolve();assert.equal(calls,1);assert.equal(c.state.view.tasks[0].status,'running');p.reject(Error('unknown'));await Promise.allSettled([a,b]);p=deferred();const retry=c.stop('t');p.resolve({task:{status:'running'}});await retry;assert.equal(calls,2);await c.refresh();assert.equal(calls,2);assert.equal(c.state.view.tasks[0].status,'running');
});
test('changing a draft does not prevent retry of a failed stop request',async()=>{
 let fail=true;const c=createConversationClient({request:async(url,body)=>{if(body&&fail)throw Error('network');return view('task-a');}});await c.select('task-a');c.setDraft('draft one');await assert.rejects(c.stop('t'));c.setDraft('draft two');fail=false;await c.stop('t');assert.equal(c.state.draft,'draft two');
});
test('uncertain follow-up cannot be bypassed by choosing another parent task',async()=>{
 const sent=[];const c=createConversationClient({uuid:()=>`id-${sent.length}`,request:async(url,body)=>{if(!body)return view('task-a');sent.push(body);throw Error('uncertain');}});await c.select('task-a');c.setDraft('one change');await assert.rejects(c.followUp({task_id:'parent-one'}));await assert.rejects(c.followUp({task_id:'parent-two'}),/retry_previous/);assert.equal(sent.length,1);
});
