import assert from 'node:assert/strict';
import test from 'node:test';
import { conversationFixture } from './fixtures/conversation-fixture.js';
import { createApplication } from '../src/server.js';
async function setup(t){const f=conversationFixture(t);const app=await createApplication({...f,executors:new Map([['codex',f.executor]]),startCodex:false});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;t.after(()=>app.close());return {...f,call:(url,body,headers={})=>fetch(base+url,{method:body?'POST':'GET',headers:{authorization:'Bearer test-chat-token','content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})})};}
test('conversation page requires protected API auth Origin and schema; reads never execute',async t=>{
 const f=await setup(t);const page=await f.call('/conversations');assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/connect-src 'self'/);
 assert.equal((await f.call('/v1/conversations')).status,200);assert.equal((await f.call('/v1/conversations',undefined,{authorization:''})).status,401);
 const input={conversation_id:f.cid,message_id:'http-one',text:'<script>private-marker</script>',target:'dot',task_id:f.task.id};
 assert.equal((await f.call('/v1/conversations/post',input,{authorization:'Bearer invalid'})).status,401);assert.equal((await f.call('/v1/conversations/post',input,{origin:'https://evil.example'})).status,403);assert.equal(f.store.listMessages().length,0);
 assert.equal((await f.call('/v1/conversations/post',{...input,human:true})).status,400);assert.equal((await f.call('/v1/conversations/post',input)).status,201);assert.equal((await f.call('/v1/conversations/post',input)).status,201);
 const snapshot=await(await f.call('/v1/conversations/view?conversation_id='+f.cid)).json();assert.equal(snapshot.messages.length,1);assert.equal(snapshot.tasks[0].status,'queued');assert.equal(snapshot.agents[0].connection,'not_connected');assert.equal(JSON.stringify(snapshot).includes(f.workspace),false);assert.equal(f.executor.turnStarts.length,0);
 for(const route of ['post','follow-up','stop'])assert.equal((await f.call('/v1/conversations/'+route,{...input,approved:true})).status,400);
 assert.equal((await f.call('/v1/conversations/stop',{conversation_id:f.cid,task_id:f.task.id})).status,400); // staged, not in queue: cannot pretend stopped
 assert.equal(f.store.getTask(f.task.id).status,'queued');
});
test('disabled conversation API exposes no retained content and navigation has no mutation',async t=>{
 const f=await setup(t);f.config.messages.enabled=false; // application snapshots enabled at construction; test a separately disabled hub via app config below
 const disabled=await createApplication({config:{...f.config,messages:{enabled:false}},store:f.store,orchestrator:f.orchestrator,executors:new Map([['codex',f.executor]]),startCodex:false});await new Promise(r=>disabled.server.listen(0,'127.0.0.1',r));t.after(()=>disabled.close());
 const r=await fetch(`http://127.0.0.1:${disabled.server.address().port}/v1/conversations`,{headers:{authorization:'Bearer test-chat-token'}});assert.equal(r.status,400);assert.equal((await r.text()).includes('private task'),false);assert.equal(f.executor.turnStarts.length,0);
});
test('conversation write surfaces fail closed when no application bearer is configured',async t=>{
 const f=await setup(t);f.config.server.authToken='';const input={conversation_id:f.cid,message_id:'no-auth',text:'must not dispatch',task_id:f.task.id};for(const action of ['post','follow-up','stop']){const r=await f.call('/v1/conversations/'+action,input,{authorization:''});assert.equal(r.status,400);assert.equal((await r.json()).error.code,'conversation_auth_required');}assert.equal(f.store.listMessages().length,0);assert.equal(f.executor.turnStarts.length,0);
});
