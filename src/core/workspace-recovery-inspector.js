import fs from 'node:fs';
import { normalizeRecoveryObservation } from './node-recovery.js';
import { ControlPlaneError } from './errors.js';
const fail=()=>new ControlPlaneError('workspace_inventory_unavailable','Bounded workspace recovery observation unavailable');
// Measured host facts are separate capabilities, not flags inferred from Git.
// This validates/composes evidence; it never starts/stops or admits an executor.
export function createWorkspaceRecoveryInspector({enabled=false,inventory,nodeId,measureSource,measureTarget}={}){
 function inspect(kind,task){try{
  const measure=kind==='source'?measureSource:measureTarget;if(enabled!==true||inventory?.enabled!==true||typeof measure!=='function'||!task?.id||!task.node_recovery)throw fail();
  function facts(){const value=measure(task),keys=['task_id','node_id','generation','observed_at','valid_until',...(kind==='source'?['stopped','tests']:['ready','idle','persistent'])];if(!value||typeof value!=='object'||Object.keys(value).some(k=>!keys.includes(k))||value.task_id!==task.id||value.node_id!==nodeId||value.generation!==task.node_recovery.generation)throw fail();const now=Date.now(),at=Date.parse(value.observed_at),until=Date.parse(value.valid_until);if(typeof value.observed_at!=='string'||typeof value.valid_until!=='string'||!Number.isFinite(at)||!Number.isFinite(until)||at>now||until<=now||until<=at||until-at>60000)throw fail();return value;}
  const before=facts(),checkpoint=task.node_recovery.checkpoint;
  const capture=inventory.capture({workspace:task.workspace,...(kind==='target'&&checkpoint?{expectedHead:checkpoint.head,expectedBranch:checkpoint.branch}:{})});
  const after=facts(),withoutTime=({observed_at,valid_until,...value})=>value;if(JSON.stringify(withoutTime(before))!==JSON.stringify(withoutTime(after)))throw fail();
  const from=Math.max(Date.parse(capture.observed_at),Date.parse(before.observed_at),Date.parse(after.observed_at)),until=Math.min(Date.parse(capture.valid_until),Date.parse(before.valid_until),Date.parse(after.valid_until));
  const result={...capture,...after,observed_at:new Date(from).toISOString(),valid_until:new Date(until).toISOString(),...(kind==='target'?{workspace:fs.realpathSync.native(task.workspace)}:{})};
  const normalized=normalizeRecoveryObservation(kind,result);if(kind==='source'&&Buffer.byteLength(JSON.stringify({branch:normalized.branch,head:normalized.head,files:normalized.files,tests:normalized.tests}))>8192)throw fail();return normalized;
 }catch{throw fail();}}
 return Object.freeze({enabled:enabled===true,inspectSource:task=>inspect('source',task),inspectTarget:task=>inspect('target',task)});
}
