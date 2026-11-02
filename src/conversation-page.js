// Serialized into the page as fixed application code; untrusted data is DOM text.
export function createConversationClient({request,onChange=()=>{},uuid=()=>crypto.randomUUID()}) {
 const drafts=new Map(),views=new Map(),pending=new Map(),reads=new Map();let selected=null,epoch=0;
 const state={selected:null,view:null,draft:'',busy:false};
 const emit=()=>{state.selected=selected;state.draft=drafts.get(selected)??'';state.view=views.get(selected)??null;state.busy=[...pending.values()].some(p=>p.cid===selected&&p.promise);onChange(state);};
 const merge=(old,next)=>{const all=new Map((old?.messages??[]).map(m=>[m.key??m.message_id,m]));for(const m of next.messages??[])all.set(m.key??m.message_id,m);return {...next,messages:[...all.values()].sort((a,b)=>a.sequence-b.sequence).slice(-1024)};};
 async function read(cid,older=false){
  const nav=epoch,n=(reads.get(cid)??0)+1;reads.set(cid,n);const old=views.get(cid),before=older?old?.messages?.[0]?.sequence:null;
  const url='/v1/conversations/view?conversation_id='+encodeURIComponent(cid)+(before?'&before_sequence='+before:'');const value=await request(url);
  if(value.conversation_id!==cid)throw Error('invalid_response');
  if(reads.get(cid)===n){views.set(cid,merge(views.get(cid),value));if(epoch===nav&&selected===cid)emit();}
  return value;
 }
 function mutate(action,extra={}){
  if(!selected)return Promise.reject(Error('select_conversation'));const cid=selected,text=drafts.get(cid)??'',key=cid+':'+action+(action==='stop'?':'+(extra.task_id??''):'');
  const signature=JSON.stringify(action==='stop'?extra:{text,...extra});let p=pending.get(key);
  if(p){if(p.signature!==signature)return Promise.reject(Error('retry_previous'));if(p.promise)return p.promise;}
  else{p={cid,signature,body:{conversation_id:cid,...extra,...(action==='stop'?{}:{message_id:uuid(),text})}};pending.set(key,p);}
  p.promise=Promise.resolve().then(async()=>{try{const value=await request('/v1/conversations/'+action,p.body);pending.delete(key);if(action!=='stop'&&drafts.get(cid)===text)drafts.set(cid,'');try{await read(cid);}catch{/* durable mutation succeeded; refresh is separately retryable */}return value;}finally{p.promise=null;if(selected===cid)emit();}});emit();return p.promise;
 }
 return {state,select:async cid=>{selected=cid;epoch++;emit();return read(cid);},refresh:()=>selected?read(selected):Promise.resolve(),older:()=>selected?read(selected,true):Promise.resolve(),setDraft:value=>{drafts.set(selected,value);emit();},post:extra=>mutate('post',extra),followUp:extra=>mutate('follow-up',extra),stop:task_id=>mutate('stop',{task_id})};
}

export function mountConversationPage(){
 const $=id=>document.getElementById(id);let client=null,timer=null,connection=null,generation=0;
 const text=(tag,value)=>{const e=document.createElement(tag);e.textContent=value;return e;};
 const status=value=>{$('notice').textContent=value;};
 function disconnect(){
  generation++;clearInterval(timer);if(connection){connection.closed=true;connection.token='';for(const abort of connection.controllers)abort.abort();}connection=null;client=null;
  for(const id of ['messages','tasks','projects','target','task'])$(id).replaceChildren();$('draft').value='';$('token').value='';$('compose').hidden=true;
 }
 async function request(session,url,body){
  if(session.closed||session!==connection)throw Error('connection_closed');
  const abort=new AbortController(),deadline=setTimeout(()=>abort.abort(),10000);session.controllers.add(abort);
  try{
   const r=await fetch(url,{method:body?'POST':'GET',headers:{authorization:'Bearer '+session.token,'content-type':'application/json'},credentials:'omit',cache:'no-store',redirect:'error',signal:abort.signal,...(body?{body:JSON.stringify(body)}:{})});
   if(session.closed||session!==connection||!r.ok)throw Error('request_failed');const result=await r.json();if(session.closed||session!==connection)throw Error('connection_closed');return result;
  }finally{clearTimeout(deadline);session.controllers.delete(abort);}
 }
 const safe=fn=>async()=>{const entered=generation;try{const result=await fn();if(entered===generation&&result!==false)status('已刷新。目标 Agent 均未连接；未调用模型。');}catch{if(entered===generation)status('操作未确认。请检查连接/授权并刷新；重试会保留原请求标识，不会自动创建新任务。');}};
 function render(s){
  $('compose').hidden=!s.selected;$('draft').value=s.draft;$('send').disabled=s.busy||!s.draft.trim();$('follow').disabled=s.busy||!s.draft.trim();
  const target=$('target'),chosen=target.value;target.replaceChildren(new Option('不指定 Agent',''));for(const a of s.view?.agents??[])target.append(new Option('@'+a.display_name+' · 未连接',a.id));target.value=[...target.options].some(o=>o.value===chosen)?chosen:'';
  $('messages').replaceChildren();for(const m of s.view?.messages??[]){const row=text('article','');row.append(text('small',`${m.channels?.join(' / ')??''} · 未验证来源 · ${m.created_at??''}`),text('pre',m.text));$('messages').append(row);}
  const selection=$('task'),previous=selection.value;selection.replaceChildren(new Option('选择任务（可选）',''));$('tasks').replaceChildren();
  for(const t of s.view?.tasks??[]){selection.append(new Option(t.id.slice(0,8)+' · '+t.status,t.id));const row=text('article','');row.append(text('strong',`${t.status} · ${t.id.slice(0,8)} · ${t.executor??'未知执行器'}`),text('p',t.objective),text('pre',t.summary??'尚无结果'),text('small',t.stop_requested?'停止请求已接收，仍等待执行器终态；占用保留。':''));
   if(t.can_stop){const b=text('button',t.stop_requested?'等待停止确认':'请求停止');b.disabled=s.busy||t.stop_requested;b.addEventListener('click',safe(async()=>{if(confirm('请求停止此任务？实际终止前仍保留执行占用。'))await client.stop(t.id);}));row.append(b);}
   $('tasks').append(row);
  }selection.value=[...selection.options].some(o=>o.value===previous)?previous:'';
 }
 async function select(){const id=decodeURIComponent(location.hash.slice(1));if([...$('projects').options].some(o=>o.value===id)){$('projects').value=id;await client.select(id);}}
 $('connect').addEventListener('click',safe(async()=>{
  const token=$('token').value;disconnect();const session={token,closed:false,controllers:new Set()},ticket=generation;connection=session;
  const own=createConversationClient({request:(url,body)=>request(session,url,body),onChange:s=>{if(connection===session&&generation===ticket)render(s);}});client=own;
  try{
   const list=await request(session,'/v1/conversations');$('projects').replaceChildren();for(const p of list.conversations)$('projects').append(new Option(p.label,p.id));
   if(!list.conversations.length){status('没有已有项目任务；此页面不会新建或启动执行器。');return false;}
   const desired=decodeURIComponent(location.hash.slice(1));if(!list.conversations.some(p=>p.id===desired))history.replaceState(null,'','#'+list.conversations[0].id);await select();
   if(connection!==session)return false;
   timer=setInterval(()=>{if(document.visibilityState==='visible'&&connection===session)own.refresh().catch(()=>{if(connection===session)status('刷新失败；当前显示可能已过期。');});},5000);
   status('已连接本地 ACP。目标 Agent 均未连接；未调用模型。');
  }catch{if(connection===session)status('连接未确认。请检查现有服务授权；没有自动启动执行器。');}
  return false;
 }));
 $('projects').addEventListener('change',()=>{location.hash=$('projects').value;});window.addEventListener('hashchange',safe(async()=>{if(client)await select();}));
 $('draft').addEventListener('input',()=>client?.setDraft($('draft').value));
 const fields=()=>({target:$('target').value||null,task_id:$('task').value||null});
 $('send').addEventListener('click',safe(()=>client.post(fields())));
 $('follow').addEventListener('click',safe(async()=>{const t=client.state.view?.tasks.find(t=>t.id===$('task').value);if(!t?.can_follow_up){status('请先选择具有会话的已结束任务；运行中修改先保存讨论。');return false;}if(confirm('将修改作为后续工程任务加入既有队列？这可能启动已配置执行器。'))await client.followUp(fields());}));
 $('refresh').addEventListener('click',safe(()=>client?.refresh()));$('older').addEventListener('click',safe(()=>client?.older()));
 window.addEventListener('pagehide',disconnect);
}

export function conversationHtml(){return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ACP 项目对话</title><style>
body{font:16px system-ui;margin:0;color:#172332;background:#f3f6fa}header,main{max-width:1120px;margin:auto;padding:20px}a{color:#1556b3}h1{margin:8px 0}input,select,textarea,button{font:inherit;padding:9px;border:1px solid #94a3b8;border-radius:6px;max-width:100%;box-sizing:border-box}button{cursor:pointer;background:#fff;color:#183650}button:disabled{opacity:.5;cursor:default}section{background:white;border:1px solid #d3dce7;border-radius:10px;padding:16px;margin:12px 0}.columns{display:grid;grid-template-columns:1.5fr 1fr;gap:16px}article{padding:12px 0;border-bottom:1px solid #dde4ee}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}small{color:#52677b}textarea{width:100%;min-height:100px}#notice{min-height:1.5em}label{display:inline-block;margin:5px}nav{display:flex;gap:8px;flex-wrap:wrap} @media(max-width:760px){.columns{display:block}}
</style><header><a href="/dashboard">← 只读面板</a><h1>项目对话</h1><p>离线协作界面 · @Agent 仅标记目标，全部未连接 · 讨论不会自动执行</p><label>本地服务访问令牌 <input id="token" type="password" maxlength="4096" autocomplete="off"></label><button id="connect">连接现有 ACP</button><p id="notice" role="status" aria-live="polite">令牌仅保留在此页内存，不保存。需启用 messages 并配置现有服务令牌。</p></header><main><nav><label>项目/任务对话 <select id="projects"></select></label><button id="refresh">刷新</button><button id="older">更早消息</button></nav><p><small>项目列表最多含最近100个任务；消息分页每次50条，页面最多保留1024条。服务端历史保留。</small></p><div class="columns"><section aria-label="共享对话"><h2>对话历史</h2><div id="messages"></div><div id="compose" hidden><label>@目标 <select id="target"></select></label><label>关联任务 <select id="task"></select></label><label for="draft">讨论 / 修改建议</label><textarea id="draft" maxlength="4000"></textarea><nav><button id="send">发送讨论（不执行）</button><button id="follow">确认修改并续作</button></nav><p><small>发送失败请原样重试。刷新/离开会丢失内存草稿；返回仅重新读取，不自动重放。续作沿原任务谱系，目标标记不改变执行器。</small></p></div></section><section aria-label="任务进度结果"><h2>任务进度与结果</h2><div id="tasks"></div><p><small>“停止请求已接收”不代表进程已退出。未收到终态前保留占用。没有独立的暂停/恢复承诺。</small></p></section></div></main><script>const createConversationClient=${createConversationClient.toString()};(${mountConversationPage.toString()})();</script></html>`;}
