import { z } from 'zod';
import { normalizeAgentRegistry } from '../controllers/registry.js';
import { ControlPlaneError } from './errors.js';
const id=z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const terminal=new Set(['completed','partial','blocked','failed','cancelled']);
const scope=task=>task.project_id?`project-${task.project_id}`:`task-${task.logical_task_id??task.id}`;
const fail=code=>new ControlPlaneError(code,'Conversation operation could not be confirmed');
export const conversationQuery=z.object({conversation_id:id,before_sequence:z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional()}).strict();
export const conversationPost=z.object({conversation_id:id,message_id:id,text:z.string().min(1).max(4000),target:id.nullable().optional(),task_id:z.string().uuid().nullable().optional()}).strict();
export const conversationStop=z.object({conversation_id:id,task_id:z.string().uuid()}).strict();
function parse(schema,input){const v=schema.safeParse(input);if(!v.success)throw fail('invalid_conversation_request');return v.data;}

// Local application authorization only. Mentions are data, never identity or routing.
export class ConversationService {
 constructor({store,orchestrator,messageHub,agents=[]}){Object.assign(this,{store,orchestrator,messageHub});this.agents=normalizeAgentRegistry(agents).map(a=>({...a,connection:'not_connected'}));}
 #enabled(){if(!this.messageHub.enabled)throw fail('messages_disabled');}
 #tasks(){return this.store.findTasks({limit:100});}
 #target(cid,taskId=null){
  this.#enabled();const task=taskId?this.store.getTask(taskId):this.#tasks().find(t=>scope(t)===cid);
  if(!task||scope(task)!==cid)throw fail('conversation_not_found');return task;
 }
 list(){this.#enabled();const groups=new Map();for(const t of this.#tasks())if(!groups.has(scope(t)))groups.set(scope(t),{id:scope(t),label:t.project_id??t.brief?.objective?.slice(0,80)??t.id});return {conversations:[...groups.values()],task_window_limit:100};}
 snapshot(input){
  const q=parse(conversationQuery,input);this.#target(q.conversation_id);
  return {conversation_id:q.conversation_id,agents:this.agents,connection:'offline',messages:this.messageHub.list({...q,limit:50}).messages,
   tasks:this.#tasks().filter(t=>scope(t)===q.conversation_id).map(t=>({id:t.id,logical_task_id:t.logical_task_id,parentTaskId:t.parentTaskId??null,status:t.status,objective:t.brief?.objective??'',summary:t.result?.summary??null,executor:t.executor??null,stop_requested:this.orchestrator.running.get(t.id)?.stopRequested===true,can_stop:['queued','running'].includes(t.status),can_follow_up:terminal.has(t.status)&&Boolean(t.threadId)&&!this.orchestrator.running.has(t.id)}))};
 }
 #message(input,kind){const m=parse(conversationPost,input);this.#target(m.conversation_id,m.task_id);if(m.target&&!this.agents.some(a=>a.id===m.target))throw fail('invalid_conversation_target');return {message_id:m.message_id,conversation_id:m.conversation_id,channel:'foreground',kind,text:m.target?`@${m.target}\n${m.text}`:m.text,task_id:m.task_id??null};}
 post(input){return {message:this.messageHub.post(this.#message(input,'discussion'))};}
 followUp(input){
  const m=this.#message(input,'execution_request');if(!m.task_id)throw fail('invalid_conversation_request');const t=this.#target(m.conversation_id,m.task_id);
  if(!terminal.has(t.status)||this.orchestrator.running.has(t.id)||!t.threadId)throw fail('conversation_task_busy');
  return this.messageHub.dispatch(m,{objective:parse(conversationPost,input).text});
 }
 async stop(input){const q=parse(conversationStop,input);this.#target(q.conversation_id,q.task_id);return {task:await this.orchestrator.requestStop(q.task_id)};}
}
