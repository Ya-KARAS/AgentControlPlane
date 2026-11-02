import { createHash } from 'node:crypto';
import { ControlPlaneError } from './errors.js';
import { readDailyReport } from './daily-report.js';
export const workflowHash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function workflowFingerprint(task){
 const delivery=task.delivery;
 return workflowHash({task:Object.fromEntries(['id','logical_task_id','parentTaskId','workspace','project_id','project_path_revision','executor','status','brief','policy','result','usage','executor_history','continuation','node_recovery'].map(key=>[key,task[key]??null])),delivery:delivery?{repository:delivery.repository,pull_request_number:delivery.pull_request_number,head_sha:delivery.head_sha,branch:delivery.branch}:null});
}
const error=code=>new ControlPlaneError(code,'Task reporting or archive operation could not be confirmed');
export class ArchiveService{
 #pending=new Map();
 constructor({store,orchestrator,enabled=false,timeZone='UTC',clock=Date.now}){
  if(typeof enabled!=='boolean'||typeof timeZone!=='string'||timeZone.length>64)throw error('invalid_config');try{new Intl.DateTimeFormat('en',{timeZone});}catch{throw error('invalid_config');}
  this.store=store;this.orchestrator=orchestrator;this.enabled=enabled;this.timeZone=timeZone;this.clock=clock;
 }
 #active(id){
  if(this.orchestrator?.store!==this.store||!(this.orchestrator.running instanceof Map)||!Array.isArray(this.orchestrator.queue))return true;
  return this.orchestrator.running.has(id)||this.orchestrator.queue.some(entry=>entry.taskId===id);
 }
 #publicError(cause){const allowed=['workflow_disabled','workflow_approval_required','workflow_task_active','workflow_report_unavailable','workflow_binding_changed','workflow_capacity_reached','workflow_update_required','task_not_found','checkpoint_store_faulted','checkpoint_store_locked','checkpoint_store_drift','checkpoint_persist_failed','checkpoint_audit_failed','checkpoint_audit_invalid'];return error(cause instanceof ControlPlaneError&&allowed.includes(cause.code)?cause.code:'workflow_state_failed');}
 async archive(id){
  if(this.#pending.has(id))return this.#pending.get(id);
  if(this.#pending.size>=32)throw error('workflow_busy');
  const operation=this.#archive(id);this.#pending.set(id,operation);
  try{return await operation;}finally{if(this.#pending.get(id)===operation)this.#pending.delete(id);}
 }
 async #archive(id){
  try{
   if(!this.enabled)throw error('workflow_disabled');if(!this.store.getTask(id))throw error('task_not_found');
   if(this.store.getWorkflowStatus(id)?.phase==='archived'&&!this.store.getWorkflowStatus(id).active)return this.store.getTask(id);
   await this.store.refreshDeliveryForWorkflow(id);
   return this.store.archiveVerifiedTask(id,{timeZone:this.timeZone,clock:this.clock,isActive:()=>this.#active(id)});
  }catch(cause){throw this.#publicError(cause);}
 }
 active({limit=20}={}){if(!Number.isInteger(limit)||limit<1||limit>100)throw error('invalid_config');return {enabled:this.enabled,tasks:this.enabled?this.store.listActiveTasks(limit):this.store.listTasks(limit)};}
 report(date){try{if(!this.enabled)throw error('workflow_disabled');return readDailyReport(this.store.stateDir,date);}catch(cause){throw this.#publicError(cause);}}
}
