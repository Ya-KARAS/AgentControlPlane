import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { resolveWorkspace } from './workspace.js';
import { z } from 'zod';
import { ControlPlaneError } from './errors.js';
import { normalizeExecutionNodes } from './execution-node-config.js';
const commands=new WeakSet(), admissions=new WeakSet();
const error=code=>new ControlPlaneError(code,'Execution-node recovery could not be safely confirmed');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const identifier=z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const file=z.object({path:z.string().min(1).max(512).regex(/^[A-Za-z0-9._/-]+$/).refine(p=>!p.startsWith('/')&&!p.split('/').some(v=>!v||v==='.'||v==='..')),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const files=z.array(file).max(256).refine(a=>new Set(a.map(v=>v.path)).size===a.length);
const inventory={branch:z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/).refine(s=>!s.includes('..')),head:z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),files};
const binding={task_id:z.string().uuid(),node_id:identifier,generation:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)};
const times={observed_at:z.string().datetime(),valid_until:z.string().datetime()};
const sourceSchema=z.object({...inventory,...times,...binding,stopped:z.boolean(),tests:z.array(z.object({command:z.enum(['npm test','npm run verify','npm run check']),status:z.enum(['passed','failed','not_run'])}).strict()).max(16)}).strict();
const targetSchema=z.object({...inventory,...times,...binding,idle:z.boolean(),ready:z.boolean(),persistent:z.boolean(),workspace:z.string().max(4096).refine(p=>path.isAbsolute(p))}).strict();
const taskHash=task=>hash(Object.fromEntries(['id','logical_task_id','parentTaskId','workspace','project_id','project_path_revision','executor','brief','policy','continuation','executor_history','threadId','turnId','executorSessionId','usage','result'].map(k=>[k,task[k]??null])));
const manifest=data=>({...data,files:[...data.files].sort((a,b)=>a.path.localeCompare(b.path))});
function observation(schema,raw){
 const parsed=schema.safeParse(raw);if(!parsed.success)throw error('node_observation_unavailable');
 const at=Date.parse(parsed.data.observed_at),until=Date.parse(parsed.data.valid_until),now=Date.now();
 if(!Number.isFinite(at)||!Number.isFinite(until)||at>now||until<=now||until-at>60000||until<=at)throw error('node_observation_unavailable');
 return manifest(parsed.data);
}
export function sameRecoveryWorkspace(left,right){
 const canonical=value=>{try{return fs.realpathSync.native(value);}catch{return path.resolve(value);}};
 if(typeof left!=='string'||typeof right!=='string')return false;
 const a=canonical(left),b=canonical(right);return process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
}
export const isNodeRecoveryCommand=value=>value!==null&&typeof value==='object'&&commands.has(value);
export function isNodeAdmission(value,task){
 return !!value&&admissions.has(value)&&value.taskId===task?.id&&value.nodeId===task.execution_node_id&&value.generation===task.node_recovery?.generation&&task.node_recovery.phase==='admitted'&&task.status==='queued';
}
export function assertNodeFence(task,context){
 if(task?.node_recovery&&(!context||context.nodeId!==task.execution_node_id||context.generation!==task.node_recovery.generation||!['admitted','running','awaiting_stop','completed'].includes(task.node_recovery.phase)))throw error('node_generation_mismatch');
}
export function nodeRecoveryTransition(task,command){
 const current=task.node_recovery??null;
 if(command.action==='bind'){
  if(current){if(current.owner===command.nodeId)return {patch:null,duplicate:true};throw error('node_recovery_phase');}
  return {patch:{execution_node_id:command.nodeId,node_recovery:{owner:command.nodeId,generation:1,phase:'owned',checkpoint:null,resume_key:null}},duplicate:false};
 }
 if(!current)throw error('node_recovery_phase');
 if(command.action==='admit'&&current.resume_key===command.resumeKey){
  if(current.owner!==command.nodeId)throw error('node_recovery_conflict');
  return {patch:null,duplicate:true};
 }
 if(current.generation!==command.generation)throw error('node_generation_mismatch');
 if(command.action==='uncertain')return {patch:{status:'blocked',node_recovery:{...current,phase:'uncertain'}},duplicate:false};
 if(command.action==='complete'){
  if(current.owner!==command.nodeId||current.phase!=='awaiting_stop'||!['completed','failed','cancelled','blocked','partial','interrupted'].includes(task.status))throw error('node_recovery_phase');
  return {patch:{node_recovery:{...current,phase:'completed'}},duplicate:false};
 }
 if(command.action==='checkpoint'){
  if(!['owned','uncertain','awaiting_stop','completed'].includes(current.phase)||current.owner!==command.nodeId)throw error('node_recovery_phase');
  const history=structuredClone(task.executor_history??[]);
  if(history.length)history[history.length-1]={...history.at(-1),usage:structuredClone(task.usage),thread_id:task.threadId,turn_id:task.turnId,ended_at:new Date().toISOString(),ended_reason:'node_checkpointed'};
  return {patch:{status:'blocked',executor_history:history,node_recovery:{...current,phase:'checkpointed',checkpoint:{...command.checkpoint,task_hash:taskHash({...task,executor_history:history})},resume_key:null}},duplicate:false};
 }
 if(command.action==='release'){
  if(current.phase!=='checkpointed'||current.owner!==command.nodeId||current.checkpoint.task_hash!==taskHash(task))throw error('node_recovery_phase');
  return {patch:{status:'blocked',node_recovery:{...current,phase:'released'}},duplicate:false};
 }
 if(command.action==='admit'){
  if(current.phase!=='released'||current.checkpoint.task_hash!==taskHash(task)||!Number.isSafeInteger(current.generation+1))throw error('node_recovery_phase');
  return {patch:{status:'queued',execution_node_id:command.nodeId,workspace:command.workspace,threadId:null,turnId:null,executorSessionId:null,fresh_session:true,completedAt:null,error:null,
   executor_history:[...(task.executor_history??[]),{executor:task.executor,execution_node_id:command.nodeId,generation:current.generation+1,started_at:new Date().toISOString(),ended_at:null,thread_id:null,turn_id:null,attempts:1,usage:null}],
   node_recovery:{...current,owner:command.nodeId,generation:current.generation+1,phase:'admitted',resume_key:command.resumeKey}},duplicate:false};
 }
 throw error('node_recovery_phase');
}

// In-process host composition only. No network route, config callable, CLI setter,
// credential loader or execution adapter is installed by this module.
export class NodeRecoveryCoordinator{
 constructor({store,config,sourceNodeId,targetNodeId,inspectSource,inspectTarget,workspaceRoots}){
  this.store=store;this.config=normalizeExecutionNodes(config);this.sourceNodeId=sourceNodeId;this.targetNodeId=targetNodeId;this.inspectSource=inspectSource;this.inspectTarget=inspectTarget;this.workspaceRoots=workspaceRoots;
 }
 #node(id,task){
  const node=this.config.nodes.find(n=>n.id===id);
  if(!this.config.enabled||!node?.authorized||!node.executor_ids.includes(task.executor))throw error('node_not_authorized');return node;
 }
 #apply(id,fields){const command=Object.freeze(fields);commands.add(command);return this.store.applyNodeRecovery(id,command);}
 #task(id){const task=this.store.getTask(id);if(!task)throw error('task_not_found');return task;}
 #inspect(schema,adapter,task){
  let raw;
  try{if(typeof adapter!=='function')throw error('node_observation_unavailable');raw=adapter(task);}catch{throw error('node_observation_unavailable');}
  return observation(schema,raw);
 }
 #source(task){return this.#inspect(sourceSchema,this.inspectSource,task);}
 bind(id){const task=this.#task(id);if(task.executor_checkpoint)throw error('node_native_checkpoint_unsupported');this.#node(this.sourceNodeId,task);return this.#apply(id,{action:'bind',nodeId:this.sourceNodeId}).task;}
 checkpoint(id,generation){
  const task=this.#task(id);this.#node(this.sourceNodeId,task);const source=this.#source(task);
  if(source.task_id!==task.id||source.node_id!==this.sourceNodeId||source.generation!==generation)throw error('node_observation_unavailable');
  if(!source.stopped)throw error('node_source_not_stopped');
  const {branch,head,files,tests}=source;
  if(Buffer.byteLength(JSON.stringify({branch,head,files,tests}),"utf8")>8192)throw error("node_checkpoint_too_large");
  return this.#apply(id,{action:'checkpoint',nodeId:this.sourceNodeId,generation,checkpoint:{branch,head,files,tests}}).task;
 }
 complete(id,generation,orchestrator){
  const task=this.#task(id);this.#node(this.sourceNodeId,task);const source=this.#source(task);
  if(!source.stopped||source.task_id!==id||source.node_id!==this.sourceNodeId||source.generation!==generation)throw error('node_source_not_stopped');
  const result=this.#apply(id,{action:'complete',nodeId:this.sourceNodeId,generation}).task;
  orchestrator?.wakeNodeQueue?.();return result;
 }
 release(id,generation){return this.#apply(id,{action:'release',nodeId:this.sourceNodeId,generation}).task;}
 quarantine(id,generation){return this.#apply(id,{action:'uncertain',generation}).task;}
 resume(id,generation,resumeKey,orchestrator){
  const task=this.#task(id);this.#node(this.targetNodeId,task);
  if(task.executor_checkpoint)throw error('node_native_checkpoint_unsupported');
  orchestrator?.validateNodeRecoveryTask?.(task);
  if(!z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/).safeParse(resumeKey).success)throw error('node_recovery_conflict');
  if(task.node_recovery?.resume_key===resumeKey){if(task.execution_node_id!==this.targetNodeId)throw error('node_recovery_conflict');return task;}
  if(task.node_recovery?.generation!==generation)throw error('node_generation_mismatch');
  const target=this.#inspect(targetSchema,this.inspectTarget,task);
  const checkpoint=task.node_recovery?.checkpoint;
  if(target.task_id!==task.id||target.node_id!==this.targetNodeId||target.generation!==generation)throw error('node_observation_unavailable');
  if(!target.ready||!target.idle||this.#node(this.targetNodeId,task).kind==='cloud'&&!target.persistent||!checkpoint||
    target.head!==checkpoint.head||target.branch!==checkpoint.branch||hash(target.files)!==hash(checkpoint.files))throw error('node_checkpoint_mismatch');
  let workspace;
  try{workspace=resolveWorkspace(target.workspace,this.workspaceRoots??[task.workspace]);}catch{throw error('node_checkpoint_mismatch');}
  if(task.project_id&&!sameRecoveryWorkspace(workspace,task.workspace))throw error('node_checkpoint_mismatch');
  const applied=this.#apply(id,{action:'admit',nodeId:this.targetNodeId,generation,resumeKey,workspace});
  if(applied.duplicate)return applied.task;
  const ticket=Object.freeze({taskId:id,nodeId:this.targetNodeId,generation:applied.task.node_recovery.generation});admissions.add(ticket);
  try{orchestrator.enqueueNodeRecovery(id,ticket);}catch{this.quarantine(id,ticket.generation);throw error('node_recovery_uncertain');}
  return this.#task(id);
 }
}
