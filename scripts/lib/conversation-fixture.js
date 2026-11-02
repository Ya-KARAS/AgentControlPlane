import http from 'node:http';
import { z } from 'zod';
import { conversationHtml } from '../../src/conversation-page.js';
// Synthetic UI transport only. No production composition root, filesystem,
// configuration, credentials, executors, queue, MCP or external network client.
const scope=z.enum(['task-fixture-a','task-fixture-b']);
const identifier=z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const post=z.object({conversation_id:scope,message_id:identifier,text:z.string().trim().min(1).max(4000),target:z.enum(['fixture-dot']).nullable().optional(),task_id:z.string().uuid().nullable().optional()}).strict();
const stop=z.object({conversation_id:scope,task_id:z.string().uuid()}).strict();
const query=z.object({conversation_id:scope,before_sequence:z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional()}).strict();
const flags={fixture_only:true,production_state_loaded:false,executors_started:false,ordinary_chat_connected:false,authentication:false,persisted:false};
function json(res,status,value){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff','x-acp-fixture':'synthetic-only'});res.end(JSON.stringify({...value,...flags}));}
function body(req){return new Promise((resolve,reject)=>{let size=0,chunks=[],done=false;req.on('data',chunk=>{if(done)return;size+=chunk.length;if(size>16384){done=true;chunks=[];reject(413);}else chunks.push(chunk);});req.once('end',()=>{if(done)return;try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(400);}});req.once('error',()=>reject(400));req.once('aborted',()=>reject(400));});}
export function createConversationFixture({deadlineMs=5000}={}){
 if(!Number.isInteger(deadlineMs)||deadlineMs<50||deadlineMs>5000)throw Error('Invalid fixture deadline');
 let sequence=2;const operations=new Map();const views=new Map(['a','b'].map((letter,i)=>{
  const id=`task-fixture-${letter}`,taskId=`00000000-0000-4000-8000-00000000000${i+1}`;
  return [id,{conversation_id:id,connection:'offline',agents:[{id:'fixture-dot',display_name:'Synthetic Dot',connection:'not_connected'}],messages:[{key:id+'-1',sequence:1,text:'Synthetic foreground discussion — no vendor sent this.',channels:['foreground'],created_at:'2026-11-02T00:00:00Z'},{key:id+'-2',sequence:2,text:'Synthetic background review <img src=x onerror=alert(1)>',channels:['background'],created_at:'2026-11-02T00:01:00Z'}],tasks:[{id:taskId,logical_task_id:taskId,parentTaskId:null,status:i?'completed':'running',objective:'Synthetic fixture task — no executor',summary:i?'Synthetic result; not live test evidence.':null,executor:'synthetic-none',stop_requested:false,can_stop:!i,can_follow_up:Boolean(i)}]}];
 }));
 let active=0;const sockets=new Set();
 const server=http.createServer(async(req,res)=>{
  const authority=`127.0.0.1:${server.address().port}`;
  if(req.headers.host!==authority||(req.headers.origin!==undefined&&req.headers.origin!==`http://${authority}`)){json(res,403,{error:'loopback_required'});return;}
  if(req.headers.authorization&&!/^Bearer\s*$/.test(req.headers.authorization)){json(res,400,{error:'no_credentials_allowed'});return;}
  if(active>=8){json(res,503,{error:'fixture_capacity'});return;}active++;const timeout=setTimeout(()=>req.socket.destroy(),deadlineMs);let complete=false;const finish=()=>{if(!complete){complete=true;clearTimeout(timeout);active--;}};res.once('finish',finish);res.once('close',finish);
  try{
   const url=new URL(req.url,'http://'+authority);
   if(req.method==='GET'&&url.pathname==='/'&&!url.search){const html=conversationHtml().replace('<header>','<header><p role="alert"><strong>SYNTHETIC UI FIXTURE — 无认证、无持久化、无执行器。保持令牌为空，点击连接。不可填写任何秘密；此页不是生产 ACP。</strong></p>');res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});res.end(html);return;}
   if(req.method==='GET'&&url.pathname==='/health'&&!url.search){json(res,200,{mode:'synthetic-ui-fixture',credentials_required:false});return;}
   if(req.method==='GET'&&url.pathname==='/v1/conversations'&&!url.search){json(res,200,{conversations:[...views.keys()].map(id=>({id,label:id+' (synthetic)'}))});return;}
   if(req.method==='GET'&&url.pathname==='/v1/conversations/view'){
    const q=query.parse(Object.fromEntries(url.searchParams)),view=views.get(q.conversation_id);json(res,200,{...view,messages:view.messages.filter(m=>!q.before_sequence||m.sequence<q.before_sequence).slice(-50)});return;
   }
   if(req.method!=='POST'||url.search||!['/v1/conversations/post','/v1/conversations/follow-up','/v1/conversations/stop'].includes(url.pathname)){json(res,404,{error:'fixture_route_not_found'});return;}
   if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']??''))throw 415;
   const data=await body(req),action=url.pathname.split('/').at(-1);
   if(action==='stop'){const q=stop.parse(data),view=views.get(q.conversation_id),task=view.tasks.find(t=>t.id===q.task_id);if(!task)throw 400;if(task.can_stop)task.stop_requested=true;json(res,200,{task});return;}
   const m=post.parse(data),view=views.get(m.conversation_id);if(m.task_id&&!view.tasks.some(t=>t.id===m.task_id))throw 400;
   const key=m.conversation_id+':'+m.message_id,fingerprint=JSON.stringify([action,m.text,m.target??null,m.task_id??null]),old=operations.get(key);if(old){if(old.fingerprint!==fingerprint)throw 400;json(res,action==='post'?201:202,old.result);return;}if(operations.size>=100)throw 503;
   let task=null;if(action==='follow-up'){const parent=view.tasks.find(t=>t.id===m.task_id);if(!parent?.can_follow_up)throw 400;const id=`00000000-0000-4000-8000-${String(sequence+1).padStart(12,'0')}`;task={...parent,id,parentTaskId:parent.id,status:'queued',objective:m.text,summary:null,can_stop:true,can_follow_up:false,stop_requested:false};view.tasks.push(task);}
   const message={key,message_id:m.message_id,sequence:++sequence,text:m.target?'@'+m.target+'\n'+m.text:m.text,channels:['foreground'],created_at:new Date().toISOString()};view.messages.push(message);const result={message,...(task?{task}:{})};operations.set(key,{fingerprint,result});json(res,action==='post'?201:202,result);
  }catch(error){json(res,[400,413,415,503].includes(error)?error:400,{error:'invalid_fixture_request'});}
 });
 server.on('connection',socket=>{sockets.add(socket);const deadline=setTimeout(()=>socket.destroy(),deadlineMs);deadline.unref();socket.once('close',()=>{clearTimeout(deadline);sockets.delete(socket);});});server.maxConnections=16;server.headersTimeout=deadlineMs;server.requestTimeout=deadlineMs;server.keepAliveTimeout=1000;server.maxHeadersCount=32;
 return {listen:port=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve();});}),address:()=>server.address(),close:()=>new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());for(const s of sockets)s.destroy();})};
}
