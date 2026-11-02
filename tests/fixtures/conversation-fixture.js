import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TaskStore } from '../../src/core/store.js';
import { Orchestrator } from '../../src/core/orchestrator.js';
import { RecordingExecutor } from './recording-executor.js';
import { MessageHub } from '../../src/core/messages.js';
import { ConversationService } from '../../src/core/conversations.js';

export function conversationFixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acp-conversations-'));const workspace=path.join(dir,'work');fs.mkdirSync(workspace);
 const config={server:{host:'127.0.0.1',port:0,authToken:'test-chat-token',allowedOrigins:[]},stateDir:path.join(dir,'state'),workspaceRoots:[workspace],messages:{enabled:true,maxStoredMessages:1024},controllers:{agents:[{id:'dot',display_name:'Dot',principal_id:'private-principal'}]},executor:{provider:'codex',routing:{order:['codex']}},codex:{networkAccess:false,approvalPolicy:'never',sandbox:'workspace-write'},profiles:{economy:{model:'fake',effort:'low',maxSubagents:0,tokenBudget:30000,summary:'concise'}},limits:{maxBriefCharacters:24000,maxConcurrentTasks:1,maxQueuedTasks:10,maxTokenBudget:250000,maxStoredEventsPerTask:30,maxTaskRuntimeMinutes:1,discoveryRefreshMs:0}};
 const store=new TaskStore(config.stateDir),executor=new RecordingExecutor('codex');const orchestrator=new Orchestrator({config,store,executors:new Map([['codex',executor]]),defaultProvider:'codex'});
 const hub=new MessageHub({store,orchestrator,enabled:true});const service=new ConversationService({store,orchestrator,messageHub:hub,agents:config.controllers.agents});
 const task=orchestrator.dispatch({workspace,objective:'private task <script>marker</script>',profile:'economy'});orchestrator.queue=[];
 const cid=`task-${task.logical_task_id??task.id}`;
 t.after(async()=>{for(const v of orchestrator.running.values()){clearTimeout(v.timer);clearInterval(v.budgetTimer);}store.releaseExecutorLease();fs.rmSync(dir,{recursive:true,force:true});});
 return {dir,workspace,config,store,executor,orchestrator,hub,service,task,cid};
}
