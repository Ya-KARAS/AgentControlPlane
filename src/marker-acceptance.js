import {buildDisabledMcpOverride} from './core/marker-mcp-isolation.js';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {CodexExecutor} from './executors/codex-executor.js';import {resolveExecutable} from './executors/discovery.js';import {TaskStore} from './core/store.js';import {Orchestrator} from './core/orchestrator.js';import {createOwnedProcessTree} from './core/owned-process-tree.js';
const fail=()=>new Error('Isolated marker acceptance unavailable');
const MARKER='ACP acceptance marker v1\n',name='acceptance-marker.txt';
const DISABLED=['multi_agent','apps','plugins','browser_use','computer_use','image_generation','hooks','memories'];
const terminal=task=>task&&['completed','partial','failed','blocked','cancelled','interrupted'].includes(task.status);
const json=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff',connection:'close'});res.end(JSON.stringify(data));};
// Only explicit local CLI/host composition. No configuration loader, existing
// application startup, old state, relay, companion or authentication enrollment.
export function createMarkerAcceptance(options={}){
 const {enabled=false,model,command='codex',timeoutMs=120000,executorFactory,processTreeFactory=createOwnedProcessTree}=options;
 if(enabled!==true){const off=async()=>{throw fail();};return Object.freeze({enabled:false,listen:off,run:off,close:async()=>{},status:()=>({mode:'disabled'}),address:()=>null,receiptPath:null});}
 if(Object.keys(options).some(k=>!['enabled','model','command','timeoutMs','executorFactory','processTreeFactory'].includes(k))||typeof model!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(model)||typeof command!=='string'||!command||!Number.isInteger(timeoutMs)||timeoutMs<50||timeoutMs>120000||executorFactory!==undefined&&typeof executorFactory!=='function'||typeof processTreeFactory!=='function'||!executorFactory&&process.platform!=='win32')throw fail();
 const mode=executorFactory?'offline-fixture':'windows-live-marker',sockets=new Set();let phase='idle',cancelled=false,timedOut=false,promise,result,root,receipt,store,orchestrator,executor,child,capture,tree,taskId,started=false,spawnEvent=false,exitEvent=false,exitCode=null,exitSignal=null,diagnostics=0,usageSeen=false,transportFailed=false,closing=false;
 const status=()=>({mode,phase,task_started:!!taskId,finished:!!result,executors_started:started,production_config_loaded:false,old_queue_restored:false,remote_worker_started:false,authentication_enrolled:false,...(result?{outcome:result.outcome}:{} )});
 const server=http.createServer((req,res)=>{const port=server.address()?.port,origin=`http://127.0.0.1:${port}`;if(!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||req.headers.host!==`127.0.0.1:${port}`||req.headers.origin!==undefined&&req.headers.origin!==origin){json(res,403,{error:'acceptance_unavailable'});return;}if(req.method!=='GET'||!['/health','/status'].includes(req.url)){json(res,404,{error:'acceptance_route_unavailable'});return;}json(res,200,status());});
 server.maxConnections=8;server.maxHeadersCount=32;server.requestTimeout=2000;server.headersTimeout=2000;server.keepAliveTimeout=500;
 server.on('connection',socket=>{sockets.add(socket);const timer=setTimeout(()=>socket.destroy(),2000);socket.once('close',()=>{clearTimeout(timer);sockets.delete(socket);});});
 const closeServer=async()=>{await new Promise(resolve=>{if(server.listening)server.close(()=>resolve());else resolve();for(const socket of sockets)socket.destroy();});};
 async function execute(){const at=Date.now();let finalizing=false;let task=null,marker={verified:false},processResult={state:'not_started',root_pid:null,observed_processes:0},outcome='blocked',reason=null,baseline=null,timer,mcpOverride=null,probeProcess=null,mcpIsolation={state:'not_checked',configured_count:0},launchPermitted=false;
 const check=()=>{if(finalizing)return;if(transportFailed)throw fail();if(cancelled||timedOut||Date.now()-at>=timeoutMs){if(!cancelled)timedOut=true;throw fail();}};
 const step=async work=>{check();const value=await work;check();return value;};
 const git=(...args)=>{check();const env={GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'/dev/null':os.devNull,GIT_TERMINAL_PROMPT:'0'};for(const key of ['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP','TMPDIR'])if(process.env[key])env[key]=process.env[key];try{return execFileSync('git',['-c','core.autocrlf=false','-c','core.hooksPath='+path.join(root,'no-hooks'),'-c','user.name=ACP acceptance','-c','user.email=acceptance@example.invalid',...args],{cwd:path.join(root,'workspace'),env,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:3000,maxBuffer:32768,windowsHide:true}).trim();}catch(e){if(args[0]==='diff'&&e.status===1&&typeof e.stdout==='string'&&e.stdout.length<32768)return e.stdout.trim();throw e;}};
 try{
  phase='preparing';root=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'acp-marker-')));fs.chmodSync(root,0o700);receipt=path.join(root,'receipt.json');const workspace=path.join(root,'workspace'),state=path.join(root,'state');fs.mkdirSync(workspace,{mode:0o700});fs.mkdirSync(state,{mode:0o700});
  fs.writeFileSync(path.join(workspace,'README.md'),'ACP isolated acceptance fixture.\n');fs.writeFileSync(path.join(workspace,'AGENTS.md'),'Only create acceptance-marker.txt with exact UTF-8 LF text: ACP acceptance marker v1 followed by one newline. Do not read outside this workspace, use network, spawn background processes or subagents, modify .git, or change credentials/settings.\n');git('init','-b','main');git('add','README.md','AGENTS.md');git('commit','-m','Initialize isolated marker fixture');baseline=git('rev-parse','HEAD');
  store=new TaskStore(state,100,1,1024*1024);if(store.listTasks().length)throw fail();
  const resolved=executorFactory?null:resolveExecutable(command);if(!executorFactory&&(!resolved||/\.(?:cmd|bat|ps1)$/i.test(resolved))){reason='native_codex_executable_required';throw fail();}
  executor=executorFactory?executorFactory({workspace,mcpOverride:()=>mcpOverride}):new CodexExecutor({command:resolved,requestTimeoutMs:5000,launch:()=>({cwd:workspace,detached:false,args:['app-server','--listen','stdio://',...DISABLED.flatMap(feature=>['--disable',feature]),'-c','forced_login_method="chatgpt"','-c','model_provider="openai"','-c','web_search="disabled"','-c','notify=[]','-c','sandbox_workspace_write.exclude_tmpdir_env_var=true','-c','sandbox_workspace_write.exclude_slash_tmp=true',...(mcpOverride?['-c',mcpOverride]:[])]})});
  if(!(executor instanceof CodexExecutor)||typeof executor.client.launch!=='function')throw fail();
  // The normal orchestrator may call start() again. Only this host's measured
  // launchProcess can admit an actual spawn; a lost child must never be replaced
  // behind preflight/tree tracking, even when the ordinary adapter would retry.
  const launch=executor.client.launch;executor.client.launch=()=>{if(!launchPermitted){reason='unexpected_app_server_restart';mcpIsolation.state='process_lost';throw fail();}launchPermitted=false;return launch();};
  executor.executionPolicy={approvalPolicy:'never',sandbox:'workspace-write',sandboxPolicy:{type:'workspaceWrite',writableRoots:[workspace],networkAccess:false,excludeTmpdirEnvVar:true,excludeSlashTmp:true}};
  executor.client.on('error',()=>{diagnostics++;transportFailed=true;});executor.on('notification',message=>{if(message.method==='thread/tokenUsage/updated'&&taskId&&message.params?.threadId===store?.getTask(taskId)?.threadId)usageSeen=true;});
  timer=setTimeout(()=>{timedOut=true;},timeoutMs);
  const processEvidence=value=>({...value,spawn_event_seen:spawnEvent,exit_event_seen:exitEvent,exit_code:exitCode,exit_signal:exitSignal});
  const launchProcess=async()=>{
   tree=processTreeFactory({isRootCurrent:()=>!exitEvent&&child?.exitCode===null&&child?.signalCode===null});if(typeof tree.prepare==='function')try{await step(tree.prepare());}catch(error){reason=error?.code==='ETIMEDOUT'?'process_measurement_timeout':'process_measurement_unavailable';throw error;}check();
   let starting;launchPermitted=true;try{starting=executor.start();}finally{launchPermitted=false;}starting.catch(()=>{});child=executor.client.process;const ownedChild=child;
   child?.once('spawn',()=>{if(child===ownedChild)spawnEvent=true;});child?.once('exit',(code,signal)=>{if(child!==ownedChild)return;exitEvent=true;exitCode=Number.isInteger(code)?code:null;exitSignal=['SIGTERM','SIGKILL','SIGINT'].includes(signal)?signal:null;});for(const pipe of [child?.stdin,child?.stdout,child?.stderr])pipe?.on('error',()=>{if(child===ownedChild){diagnostics++;transportFailed=true;}});started=!!child?.pid;if(!started)throw fail();capture=tree.capture(child.pid);await capture;await step(starting);
  };
  const preflight=async()=>{
   const account=await step(executor.request('account/read',{refreshToken:false}));if(account?.account?.type!=='chatgpt'){reason='chatgpt_login_required';throw fail();}
   const quota=await step(executor.request('account/rateLimits/read',{})),rate=quota?.rateLimits;const used=rate?.primary?.usedPercent;if(!rate?.credits||rate.credits.hasCredits!==false||rate.credits.unlimited!==false){reason='billing_policy_unverified';throw fail();}if(!Number.isFinite(used)||used<0||used>=100||rate?.secondary?.usedPercent>=100||rate?.rateLimitReachedType||rate?.credits?.hasCredits===true){reason='subscription_route_unavailable';throw fail();}
   const settings=await step(executor.request('config/read',{includeLayers:false,cwd:workspace})),c=settings?.config;
   if(!c||c.model_provider!==undefined&&c.model_provider!=='openai'||c.hooks&&Object.keys(c.hooks).length||DISABLED.some(feature=>c.features?.[feature]===true)){reason='unsupported_codex_configuration';throw fail();}
   try{buildDisabledMcpOverride(c.mcp_servers);}catch{reason='unsupported_codex_configuration';throw fail();}
   return c.mcp_servers;
  };
  await launchProcess();let servers=await preflight();
  mcpIsolation.configured_count=Object.keys(servers).length;
  if(Object.values(servers).some(row=>row.enabled!==false)){
   mcpOverride=buildDisabledMcpOverride(servers);servers=null;mcpIsolation.state='isolating';
   // This probe has never created a thread or called MCP discovery/tools. Prove
   // its own process tree gone before reusing the adapter with process-only -c.
   const stopped=await tree.stop();if(stopped.state!=='confirmed_observed_tree'){reason='mcp_probe_stop_unconfirmed';throw fail();}
   await executor.stop();probeProcess=processEvidence(stopped);check();
   child=null;tree=null;capture=null;started=false;spawnEvent=false;exitEvent=false;exitCode=null;exitSignal=null;
   await launchProcess();servers=await preflight();
   if(Object.values(servers).some(row=>row.enabled!==false)){mcpIsolation.state='unverified';reason='unsupported_codex_configuration';throw fail();}
   mcpIsolation.state='verified_disabled';
  }else mcpIsolation.state='already_disabled';
  servers=null;
  const config={workspaceRoots:[workspace],codex:{approvalPolicy:'never',sandbox:'workspace-write',networkAccess:false,defaultModel:model},executor:{provider:'codex',reroute:{enabled:false},relays:[]},profiles:{economy:{model,effort:'low',maxSubagents:0,tokenBudget:4000,summary:'concise'}},limits:{maxBriefCharacters:8000,maxConcurrentTasks:1,maxQueuedTasks:1,maxTokenBudget:4000,maxTaskRuntimeMinutes:2,tokenUsagePollIntervalMs:1000,discoveryRefreshMs:0},reconciliation:{intervalMinutes:0}};
  orchestrator=new Orchestrator({config,store,executors:new Map([['codex',executor]]),defaultProvider:'codex'});orchestrator.on('diagnostic',()=>diagnostics++);await step(orchestrator.start());check();
  const request={workspace,executor:'codex',profile:'economy',model,idempotency_key:'isolated-marker-v1',kind:'acceptance',objective:'Create only acceptance-marker.txt containing exactly "ACP acceptance marker v1" followed by a single LF newline, UTF-8 without BOM. Verify its bytes and return the required compact report. Do not change any other file.',constraints:['No network, credentials, global files, background processes or subagents.','Do not edit .git or existing fixture files. Stop after this one marker task.'],acceptance_criteria:['Only acceptance-marker.txt is untracked; baseline Git HEAD unchanged.'],evidence_required:['Report marker verification; no raw environment, account, private paths or unrelated output.']};
  task=orchestrator.dispatch(request);taskId=task.id;phase='running';
  while(!terminal(store.getTask(taskId))||orchestrator.running.size){check();await new Promise(r=>setTimeout(r,25));}
  task=store.getTask(taskId);outcome=task.status==='completed'&&task.result?.status==='completed'?'candidate':'failed';if(outcome==='failed')reason=['windows_sandbox_not_ready','codex_rpc_error','codex_request_timeout','token_budget_exceeded','task_runtime_exceeded'].includes(task.error?.code)?task.error.code:'executor_task_failed';
 }catch(error){if(!reason&&['unknown_model','unsupported_reasoning_effort','windows_sandbox_not_ready','codex_rpc_error','codex_request_timeout'].includes(error?.code))reason=error.code;outcome=cancelled?'cancelled':timedOut?'timed_out':taskId?'failed':'blocked';reason??=outcome==='blocked'?'preflight_unavailable':outcome;}
 finally{
  clearTimeout(timer);phase='stopping';if(orchestrator){orchestrator.config.limits.maxConcurrentTasks=0;orchestrator.queue.length=0;if(taskId&&orchestrator.running.size)try{await Promise.race([orchestrator.requestStop(taskId),new Promise(resolve=>setTimeout(resolve,1000))]);}catch{}}
  if(capture)await capture.catch(()=>{});if(started&&tree){processResult=await tree.stop();if(processResult.state==='unconfirmed')processResult={...processResult,root_pid:processResult.root_pid??child?.pid??null,operation:processResult.operation??'process_snapshot',reason:processResult.reason??'ownership_not_observed'};}else if(started)processResult={state:'unconfirmed',root_pid:child?.pid??null,observed_processes:0};
  if(processResult.state==='confirmed_observed_tree'&&orchestrator&&taskId&&!terminal(store.getTask(taskId)))await orchestrator.cancel(taskId).catch(()=>{});
  if(orchestrator)for(const active of orchestrator.running.values()){clearTimeout(active.timer);clearInterval(active.budgetTimer);}
  if(processResult.state==='unconfirmed'){outcome='cleanup_unconfirmed';if(!(processResult.operation==='terminate_own_tree'&&processResult.denied===true))try{child?.kill();}catch{}child?.unref();for(const pipe of [child?.stdin,child?.stdout,child?.stderr])pipe?.destroy();}
  processResult={...processResult,spawn_event_seen:spawnEvent,exit_event_seen:exitEvent,exit_code:exitCode,exit_signal:exitSignal};
  await closeServer();task=taskId?store?.getTask(taskId):null;
  finalizing=true;
  if(outcome==='candidate'&&processResult.state==='confirmed_observed_tree')try{
   const workspace=path.join(root,'workspace'),file=path.join(workspace,name),s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>256)throw fail();const bytes=fs.readFileSync(file);
   const {createWorkspaceInventory}=await import('./core/workspace-inventory.js');const inventory=createWorkspaceInventory({enabled:true,workspaceRoots:[workspace]}).capture({workspace,expectedHead:baseline,expectedBranch:'main'});
   const digest=createHash('sha256').update(bytes).digest('hex'),exact=bytes.equals(Buffer.from(MARKER))&&inventory.files.length===1&&inventory.files[0].path===name&&inventory.files[0].sha256===digest&&git('status','--porcelain=v1','--untracked-files=all')==='?? '+name;
   marker={verified:exact,path:name,bytes:s.size,sha256:digest,...(exact?{diff:git('diff','--no-index','--no-ext-diff','--','/dev/null',name)}:{})};outcome=task?.status==='completed'&&task.result?.status==='completed'&&exact?'passed':'failed';
  }catch{outcome='failed';reason='marker_verification_failed';}

  const counts=task?.usage;const usage=usageSeen&&counts&&['input_tokens','output_tokens','total_tokens'].every(k=>Number.isSafeInteger(counts[k])&&counts[k]>=0)?Object.fromEntries(['input_tokens','cached_input_tokens','uncached_input_tokens','output_tokens','reasoning_output_tokens','total_tokens'].map(k=>[k,Number.isSafeInteger(counts[k])?counts[k]:null])):null;
  result={schema_version:1,mode,outcome,reason,mcp_isolation:mcpIsolation,...(probeProcess?{probe_process:probeProcess}:{}),task_id:taskId??null,task_count:store?.listTasks().length??0,task_status:task?.status??null,result_status:task?.result?.status??null,marker,usage,usage_state:usage?'observed':'unknown',process:processResult,runtime_removed:false,production_state_loaded:false,remote_worker_started:false,human_approval_verified:false,cash_spend:'unknown',no_purchase_requested:true,elapsed_ms:Date.now()-at,diagnostics};
  if(root&&processResult.state!=='unconfirmed'){store?.releaseExecutorLease();try{for(const part of ['workspace','state']){const p=path.join(root,part);if(fs.lstatSync(p).isSymbolicLink()||fs.realpathSync.native(p)!==p)throw fail();fs.rmSync(p,{recursive:true,force:true});}result.runtime_removed=true;}catch{result.outcome='cleanup_unconfirmed';}}
  if(receipt)try{fs.writeFileSync(receipt,JSON.stringify(result,null,2)+'\n',{mode:0o600});}catch{result.outcome='receipt_failed';}phase='finished';
 }
 return result;
 }
 return Object.freeze({enabled:true,listen(port=18891){if(closing||server.listening||!Number.isInteger(port)||port<0||port>65535)return Promise.reject(fail());return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve();});});},address:()=>server.address(),status,get receiptPath(){return receipt??null;},run(){if(closing&&!promise)return Promise.reject(fail());return promise??=execute();},async close(){closing=true;if(!result)cancelled=true;await closeServer();if(promise)await promise;}});
}
